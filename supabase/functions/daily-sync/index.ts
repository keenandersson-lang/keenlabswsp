import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const POLYGON_KEY = Deno.env.get('POLYGON_API_KEY')!

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${Deno.env.get('SYNC_SECRET_KEY')}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const targetDate = getLastTradingDay()

  // Fetch ALL symbols (bypass 1000-row default)
  const allSymbols: string[] = []
  let from = 0
  while (true) {
    const { data: page } = await supabase
      .from('symbols')
      .select('symbol')
      .eq('is_active', true)
      .order('symbol')
      .range(from, from + 999)
    if (!page || page.length === 0) break
    allSymbols.push(...page.map((r: any) => r.symbol))
    if (page.length < 1000) break
    from += 1000
  }
  const symbols = allSymbols

  if (symbols.length === 0) {
    return jsonRes({ error: 'No symbols found. Seed symbols first.' })
  }

  const { data: logRow } = await supabase
    .from('data_sync_log')
    .insert({
      sync_type: 'daily',
      status: 'running',
      data_source: 'polygon',
      metadata: { symbols_total: symbols.length, target_date: targetDate },
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  let fetched = 0
  let failed = 0

  try {
    const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${targetDate}?adjusted=true&apiKey=${POLYGON_KEY}`
    const res = await fetch(url)

    if (!res.ok) {
      throw new Error(`Polygon grouped endpoint: ${res.status}`)
    }

    const data = await res.json()

    if (data.results?.length) {
      const polygonMap: Record<string, any> = {}
      for (const r of data.results) {
        polygonMap[r.T] = r
      }

      const upserts: any[] = []
      for (const symbol of symbols) {
        const r = polygonMap[symbol]
        if (!r) { failed++; continue }
        upserts.push({
          symbol,
          date: targetDate,
          open: r.o,
          high: r.h,
          low: r.l,
          close: r.c,
          volume: r.v,
          data_source: 'polygon',
          has_full_volume: true,
        })
        fetched++
      }

      if (upserts.length > 0) {
        const batches = chunkArray(upserts, 500)
        for (const batch of batches) {
          const { error: upsertErr, count } = await supabase
            .from('daily_prices')
            .upsert(batch, { onConflict: 'symbol,date', ignoreDuplicates: false })
          if (upsertErr) {
            console.error('Daily prices upsert error:', upsertErr.message, upsertErr.details, upsertErr.hint)
            failed += batch.length
            fetched -= batch.length
          } else {
            console.log(`Upserted batch of ${batch.length} daily prices`)
          }
        }
      }

      // NOTE: WSP indicator calculation moved to a separate pass
      // to avoid edge function timeout. The backfill must complete first.
      console.log(`Daily sync complete: ${fetched} prices upserted, ${failed} missing from Polygon`)
    }
  } catch (err) {
    console.error('Daily sync error:', err)
    failed = symbols.length
  }

  await supabase
    .from('data_sync_log')
    .update({
      status: failed === 0 ? 'success' : 'partial',
      symbols_processed: fetched,
      symbols_failed: failed,
      completed_at: new Date().toISOString(),
    })
    .eq('id', logRow?.id)

  return jsonRes({ ok: true, date: targetDate, fetched, failed })
})

function getLastTradingDay(): string {
  const now = new Date()
  const et = new Date(now.getTime() - 5 * 60 * 60 * 1000)
  const day = et.getDay()
  if (day === 0) et.setDate(et.getDate() - 2)
  else if (day === 6) et.setDate(et.getDate() - 1)
  else et.setDate(et.getDate() - 1)
  return et.toISOString().slice(0, 10)
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, (i + 1) * size)
  )
}

function jsonRes(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
