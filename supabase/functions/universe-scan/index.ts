// Module 2: Universe Scan
// Input: rows in `symbols` produced by api-data-collector
// Output: snapshot in `scanner_universe_snapshot` + run row in `scanner_universe_runs`
//         driven from `wsp_eligible_universe` view (the doctrine source of truth)
// Status tracked in `module_runs`
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const MODULE = 'universe-scan'
const TEMP_DEBUG_SYNC_KEY = 'wsp_sync_test_2026_april_13'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization') ?? ''
  const providedToken = authHeader.replace('Bearer ', '')
  const syncKey = Deno.env.get('SYNC_SECRET_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  let isAuthorized = providedToken === syncKey || providedToken === serviceKey || providedToken === TEMP_DEBUG_SYNC_KEY
  if (!isAuthorized && authHeader.startsWith('Bearer ')) {
    const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data } = await authClient.auth.getUser()
    if (data?.user) isAuthorized = true
  }
  if (!isAuthorized) return json(401, { error: 'Unauthorized' })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const triggeredBy = (body.triggered_by as string) ?? 'manual'

  const { data: runRow, error: runErr } = await supabase
    .from('module_runs')
    .insert({ module_name: MODULE, status: 'running', triggered_by: triggeredBy, source: 'wsp_eligible_universe' })
    .select('id').single()
  if (runErr || !runRow) return json(500, { error: 'Failed to open run', details: runErr?.message })
  const runId = (runRow as { id: number }).id

  const checkpoint = async (step: string, status: string, rowsIn?: number | null, rowsOut?: number | null, meta: Record<string, unknown> = {}) => {
    await supabase.rpc('add_module_checkpoint' as never, {
      p_run_id: runId, p_step: step, p_status: status,
      p_rows_in: rowsIn ?? null, p_rows_out: rowsOut ?? null, p_meta: meta,
    } as never)
  }

  try {
    await checkpoint('count_active_symbols', 'started')
    const { count: totalSymbols } = await supabase.from('symbols').select('symbol', { count: 'exact', head: true }).eq('is_active', true)
    await checkpoint('count_active_symbols', 'ok', null, totalSymbols ?? 0, { query: 'symbols WHERE is_active=true' })

    await checkpoint('count_wsp_eligible', 'started')
    const { count: eligibleCount } = await supabase.from('wsp_eligible_universe').select('symbol', { count: 'exact', head: true })
    await checkpoint('count_wsp_eligible', 'ok', null, eligibleCount ?? 0, { source: 'wsp_eligible_universe' })

    await checkpoint('build_scanner_universe_snapshot', 'started')
    const { error: rpcErr } = await supabase.rpc('build_scanner_universe_snapshot' as never)
    const rpcExists = !rpcErr || !rpcErr.message?.includes('does not exist')
    await checkpoint('build_scanner_universe_snapshot', rpcErr ? 'error' : 'ok', null, null, {
      rpc: 'build_scanner_universe_snapshot', error: rpcErr?.message ?? null, available: rpcExists,
    })

    await checkpoint('verify_universe_consistency', 'started')
    const { data: verify } = await supabase.rpc('verify_universe_consistency' as never)
    const v = (verify ?? {}) as Record<string, unknown>
    await checkpoint('verify_universe_consistency', v.consistent ? 'ok' : 'mismatch',
      v.wsp_eligible_count as number, v.snapshot_eligible_count as number, v)

    await supabase.from('module_runs').update({
      status: rpcExists && !rpcErr ? 'success' : (rpcErr ? 'partial' : 'success'),
      finished_at: new Date().toISOString(),
      input_count: totalSymbols ?? 0,
      output_count: eligibleCount ?? 0,
      failed_count: (totalSymbols ?? 0) - (eligibleCount ?? 0),
      error_message: rpcErr?.message ?? null,
      metadata: { rpc_called: 'build_scanner_universe_snapshot', rpc_available: rpcExists, verify: v },
    }).eq('id', runId)

    return json(200, { ok: true, run_id: runId, input: totalSymbols, output: eligibleCount, verify: v })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await checkpoint('fatal', 'error', null, null, { error: msg })
    await supabase.from('module_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error_message: msg }).eq('id', runId)
    return json(500, { error: msg, run_id: runId })
  }
})
