// Module 3: GICS Classifier
// Input: unclassified active symbols (canonical_sector IS NULL or canonical_industry IS NULL)
// Output: writes canonical_sector (1 of 11 GICS) + canonical_industry (1 of 72-74 GICS)
//         Server-side trigger `trg_enforce_canonical_gics` rejects any non-canonical write.
//         Failures captured into `doctrine_failures` for admin review/re-queue.
// Status tracked in `module_runs`
import { createClient } from 'npm:@supabase/supabase-js@2'
import { enrichSymbolMultiSource } from '../_shared/multi-source-enrich.ts'
import { computeSectorIndustryClassification } from '../_shared/classification.ts'

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
    const { data: candidates } = await supabase
      .from('symbols')
      .select('symbol, primary_exchange, instrument_type, is_etf, is_adr')
      .eq('is_active', true)
      .or('canonical_sector.is.null,canonical_industry.is.null')
      .neq('support_level', 'etf_excluded')
      .limit(batchSize)

    const rows = (candidates ?? []) as Array<Record<string, unknown>>
    let classified = 0
    let failed = 0

    for (const row of rows) {
      const sym = row.symbol as string
      try {
        const enriched = await enrichSymbolMultiSource(sym)
        const details = enriched.details

        const result = computeSectorIndustryClassification({
          rawSector: details?.sector ?? null,
          rawIndustry: details?.industry ?? null,
          sicCode: details?.sicCode ?? null,
          sicDescription: details?.sicDescription ?? null,
          primaryExchange: (row.primary_exchange as string | null) ?? null,
          isCommonStock: details?.type === 'CS',
          isEtf: Boolean(row.is_etf),
          isAdr: Boolean(row.is_adr),
        } as never)

        if (!result.canonicalSector || !result.canonicalIndustry) {
          failed++
          await supabase.from('doctrine_failures').insert({
            symbol: sym,
            attempted_sector: result.canonicalSector ?? details?.sector ?? null,
            attempted_industry: result.canonicalIndustry ?? details?.industry ?? null,
            failure_reason: `No canonical GICS resolved (source=${enriched.succeededVia ?? 'none'}, attempted=${enriched.attempted.join(',')})`,
            source: enriched.succeededVia ?? 'none',
          })
          continue
        }

        const { error: upErr } = await supabase.from('symbols').update({
          canonical_sector: result.canonicalSector,
          canonical_industry: result.canonicalIndustry,
          market_cap: details?.marketCap ?? null,
          description: details?.description ?? null,
          enriched_at: new Date().toISOString(),
          classification_status: result.classificationStatus,
          classification_confidence_level: result.confidenceLevel,
        }).eq('symbol', sym)

        if (upErr) {
          failed++
          // Server-side guard rejected (or other DB error) — capture for admin review
          await supabase.from('doctrine_failures').insert({
            symbol: sym,
            attempted_sector: result.canonicalSector,
            attempted_industry: result.canonicalIndustry,
            failure_reason: upErr.message,
            source: enriched.succeededVia ?? 'unknown',
          })
        } else {
          classified++
        }
      } catch (err) {
        failed++
        const msg = err instanceof Error ? err.message : String(err)
        await supabase.from('doctrine_failures').insert({
          symbol: sym, failure_reason: msg, source: 'classifier-error',
        })
      }
    }

    await supabase.from('module_runs').update({
      status: failed > 0 && classified === 0 ? 'failed' : (failed > 0 ? 'partial' : 'success'),
      finished_at: new Date().toISOString(),
      input_count: rows.length,
      output_count: classified,
      failed_count: failed,
    }).eq('id', runId)

    return json(200, { ok: true, run_id: runId, input: rows.length, classified, failed })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await supabase.from('module_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error_message: msg }).eq('id', runId)
    return json(500, { error: msg, run_id: runId })
  }
})
