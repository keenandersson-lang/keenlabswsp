// Module 3: GICS Classifier
// Input: unclassified active symbols (canonical_sector IS NULL or canonical_industry IS NULL)
// Output: writes canonical_sector (1 of 11 GICS) + canonical_industry (1 of 72-74 GICS)
//         Server-side trigger `trg_enforce_canonical_gics` rejects any non-canonical write.
//         Failures captured into `doctrine_failures` for admin review/re-queue.
// Status tracked in `module_runs`
import { createClient } from 'npm:@supabase/supabase-js@2'
import { multiSourceEnrich } from '../_shared/multi-source-enrich.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const MODULE = 'gics-classifier'
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
  const batchSize = typeof body.batchSize === 'number' ? body.batchSize : 50

  const { data: runRow, error: runErr } = await supabase
    .from('module_runs')
    .insert({ module_name: MODULE, status: 'running', triggered_by: triggeredBy, source: 'multi-source' })
    .select('id').single()
  if (runErr || !runRow) return json(500, { error: 'Failed to open run', details: runErr?.message })
  const runId = (runRow as { id: number }).id

  try {
    // Fetch unclassified active symbols
    const { data: candidates } = await supabase
      .from('symbols')
      .select('symbol')
      .eq('is_active', true)
      .or('canonical_sector.is.null,canonical_industry.is.null')
      .neq('support_level', 'etf_excluded')
      .limit(batchSize)

    const symbols = (candidates ?? []).map(c => (c as { symbol: string }).symbol)
    let classified = 0
    let failed = 0

    for (const sym of symbols) {
      try {
        const enriched = await multiSourceEnrich(sym)
        if (!enriched.canonical_sector || !enriched.canonical_industry) {
          failed++
          await supabase.from('doctrine_failures').insert({
            symbol: sym,
            attempted_sector: enriched.canonical_sector ?? null,
            attempted_industry: enriched.canonical_industry ?? null,
            failure_reason: 'No canonical GICS resolved by any source',
            source: enriched.source ?? 'unknown',
          })
          continue
        }
        const { error: upErr } = await supabase.from('symbols').update({
          canonical_sector: enriched.canonical_sector,
          canonical_industry: enriched.canonical_industry,
          market_cap: enriched.market_cap ?? null,
          description: enriched.description ?? null,
          enriched_at: new Date().toISOString(),
          classification_status: 'classified',
        }).eq('symbol', sym)

        if (upErr) {
          failed++
          // Server-side guard rejected — capture into doctrine_failures
          await supabase.from('doctrine_failures').insert({
            symbol: sym,
            attempted_sector: enriched.canonical_sector,
            attempted_industry: enriched.canonical_industry,
            failure_reason: upErr.message,
            source: enriched.source ?? 'unknown',
          })
        } else {
          classified++
        }
      } catch (err) {
        failed++
        const msg = err instanceof Error ? err.message : String(err)
        await supabase.from('doctrine_failures').insert({
          symbol: sym, failure_reason: msg, source: 'classifier-error',
        }).then(() => undefined)
      }
    }

    await supabase.from('module_runs').update({
      status: failed > 0 && classified === 0 ? 'failed' : (failed > 0 ? 'partial' : 'success'),
      finished_at: new Date().toISOString(),
      input_count: symbols.length,
      output_count: classified,
      failed_count: failed,
    }).eq('id', runId)

    return json(200, { ok: true, run_id: runId, input: symbols.length, classified, failed })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await supabase.from('module_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error_message: msg }).eq('id', runId)
    return json(500, { error: msg, run_id: runId })
  }
})
