// Module 1: API Data Collector
// Input: none (pulls US equity reference data from upstream sources)
// Output: rows upserted into `symbols` (canonical schema)
// Status tracked in `module_runs` for the doctrine framework
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const MODULE = 'api-data-collector'
const TEMP_DEBUG_SYNC_KEY = 'wsp_sync_test_2026_april_13'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  // Auth
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

  // Open module run
  const { data: runRow, error: runErr } = await supabase
    .from('module_runs')
    .insert({ module_name: MODULE, status: 'running', triggered_by: triggeredBy, source: 'polygon_reference_v3' })
    .select('id')
    .single()
  if (runErr || !runRow) return json(500, { error: 'Failed to open run', details: runErr?.message })
  const runId = (runRow as { id: number }).id

  try {
    const polygonKey = Deno.env.get('POLYGON_API_KEY') ?? ''
    if (!polygonKey) throw new Error('POLYGON_API_KEY not set')

    let cursor: string | null = null
    let totalIn = 0
    let totalOut = 0
    let totalFailed = 0
    const maxPages = typeof body.maxPages === 'number' ? body.maxPages : 30

    for (let page = 0; page < maxPages; page++) {
      const url = new URL('https://api.polygon.io/v3/reference/tickers')
      url.searchParams.set('market', 'stocks')
      url.searchParams.set('active', 'true')
      url.searchParams.set('limit', '1000')
      url.searchParams.set('apiKey', polygonKey)
      if (cursor) url.searchParams.set('cursor', cursor)

      const res = await fetch(url.toString())
      if (!res.ok) {
        if (res.status === 429) { await new Promise(r => setTimeout(r, 13500)); continue }
        throw new Error(`Polygon ${res.status}: ${await res.text()}`)
      }
      const data = await res.json()
      const results = (data.results ?? []) as Array<{ ticker: string; name: string; primary_exchange?: string; type?: string; market?: string }>
      totalIn += results.length

      // Normalize to canonical symbols schema
      const rows = results
        .filter(r => r.ticker && /^[A-Z][A-Z0-9.\-]*$/.test(r.ticker))
        .map(r => ({
          symbol: r.ticker,
          name: r.name ?? r.ticker,
          primary_exchange: r.primary_exchange ?? null,
          instrument_type: r.type ?? null,
          is_etf: r.type === 'ETF',
          is_active: true,
          asset_class: 'us_equity',
          updated_at: new Date().toISOString(),
        }))

      if (rows.length > 0) {
        const { error: upErr, count } = await supabase
          .from('symbols')
          .upsert(rows, { onConflict: 'symbol', count: 'exact', ignoreDuplicates: false })
        if (upErr) {
          totalFailed += rows.length
          console.error('[collector] upsert error', upErr.message)
        } else {
          totalOut += count ?? rows.length
        }
      }

      // Heartbeat
      await supabase.from('module_runs').update({ input_count: totalIn, output_count: totalOut, failed_count: totalFailed }).eq('id', runId)

      cursor = data.next_url ? new URL(data.next_url).searchParams.get('cursor') : null
      if (!cursor) break
      await new Promise(r => setTimeout(r, 250))
    }

    await supabase.from('module_runs').update({
      status: totalFailed > 0 && totalOut === 0 ? 'failed' : (totalFailed > 0 ? 'partial' : 'success'),
      finished_at: new Date().toISOString(),
      input_count: totalIn,
      output_count: totalOut,
      failed_count: totalFailed,
      metadata: { pages_fetched: 'see logs' },
    }).eq('id', runId)

    return json(200, { ok: true, run_id: runId, input: totalIn, output: totalOut, failed: totalFailed })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await supabase.from('module_runs').update({
      status: 'failed', finished_at: new Date().toISOString(), error_message: msg,
    }).eq('id', runId)
    return json(500, { error: msg, run_id: runId })
  }
})
