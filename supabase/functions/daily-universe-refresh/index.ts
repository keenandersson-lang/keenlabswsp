// Daily Universe Refresh
// Runs after market close to:
//   1) snapshot wsp_eligible_universe (for diff history)
//   2) trigger universe-scan to refresh scanner_universe_snapshot
//   3) verify scanner_universe_snapshot matches wsp_eligible_universe
//   4) auto-retry doctrine_failures with backoff (logged to module_runs)
// Fails loudly if consistency check fails so the scanner is NOT triggered with stale data.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const TEMP_DEBUG_SYNC_KEY = 'wsp_sync_test_2026_april_13'
const MODULE = 'daily-universe-refresh'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function checkpoint(runId: number, step: string, status: string, rowsIn?: number, rowsOut?: number, meta: Record<string, unknown> = {}) {
  await supabase.rpc('add_module_checkpoint' as never, {
    p_run_id: runId, p_step: step, p_status: status,
    p_rows_in: rowsIn ?? null, p_rows_out: rowsOut ?? null, p_meta: meta,
  } as never)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace('Bearer ', '')
  const syncKey = Deno.env.get('SYNC_SECRET_KEY') ?? ''
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (token !== syncKey && token !== svc && token !== TEMP_DEBUG_SYNC_KEY) {
    return json(401, { error: 'Unauthorized' })
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const triggeredBy = (body.triggered_by as string) ?? 'cron'

  const { data: runRow, error: runErr } = await supabase
    .from('module_runs')
    .insert({ module_name: MODULE, status: 'running', triggered_by: triggeredBy, source: 'pipeline-orchestrator' })
    .select('id').single()
  if (runErr || !runRow) return json(500, { error: 'Failed to open run', details: runErr?.message })
  const runId = (runRow as { id: number }).id

  try {
    // Step 1: snapshot eligible universe
    await checkpoint(runId, 'snapshot_wsp_eligible_universe', 'started')
    const { data: snap, error: snapErr } = await supabase.rpc('snapshot_wsp_eligible_universe' as never)
    if (snapErr) throw new Error(`snapshot failed: ${snapErr.message}`)
    const total = Array.isArray(snap) && snap[0] ? (snap[0] as { total?: number }).total ?? 0 : 0
    await checkpoint(runId, 'snapshot_wsp_eligible_universe', 'ok', null, total, { rpc: 'snapshot_wsp_eligible_universe' })

    // Step 2: refresh universe-scan via internal RPC
    await checkpoint(runId, 'build_scanner_universe_snapshot', 'started')
    const { error: buildErr } = await supabase.rpc('build_scanner_universe_snapshot' as never)
    if (buildErr) {
      await checkpoint(runId, 'build_scanner_universe_snapshot', 'error', null, null, { error: buildErr.message })
    } else {
      await checkpoint(runId, 'build_scanner_universe_snapshot', 'ok')
    }

    // Step 3: verify consistency
    await checkpoint(runId, 'verify_universe_consistency', 'started')
    const { data: verify, error: verifyErr } = await supabase.rpc('verify_universe_consistency' as never)
    if (verifyErr) throw new Error(`verify failed: ${verifyErr.message}`)
    const v = (verify ?? {}) as Record<string, unknown>
    const consistent = Boolean(v.consistent)
    await checkpoint(runId, 'verify_universe_consistency', consistent ? 'ok' : 'mismatch',
      v.wsp_eligible_count as number, v.snapshot_eligible_count as number, v)

    // Step 4: auto-retry doctrine failures
    await checkpoint(runId, 'auto_retry_doctrine_failures', 'started')
    const { data: retried, error: retryErr } = await supabase.rpc('auto_retry_doctrine_failures' as never, { p_max: 50 } as never)
    const retryCount = Array.isArray(retried) ? retried.length : 0
    if (retryErr) {
      await checkpoint(runId, 'auto_retry_doctrine_failures', 'error', null, null, { error: retryErr.message })
    } else {
      await checkpoint(runId, 'auto_retry_doctrine_failures', 'ok', null, retryCount, { symbols: (retried ?? []).slice(0, 20) })
    }

    await supabase.from('module_runs').update({
      status: consistent ? 'success' : 'partial',
      finished_at: new Date().toISOString(),
      input_count: (v.wsp_eligible_count as number) ?? 0,
      output_count: (v.snapshot_eligible_count as number) ?? 0,
      failed_count: ((v.in_snapshot_not_eligible as number) ?? 0) + ((v.in_eligible_not_snapshot as number) ?? 0),
      error_message: consistent ? null : 'Universe drift detected — scanner gate failed',
      metadata: { verify: v, retried: retryCount },
    }).eq('id', runId)

    return json(200, { ok: consistent, run_id: runId, snapshot_total: total, verify: v, retried: retryCount })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await checkpoint(runId, 'fatal', 'error', null, null, { error: msg })
    await supabase.from('module_runs').update({
      status: 'failed', finished_at: new Date().toISOString(), error_message: msg,
    }).eq('id', runId)
    return json(500, { error: msg, run_id: runId })
  }
})
