import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const POLYGON_API_KEY = Deno.env.get('POLYGON_API_KEY') ?? ''

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${Deno.env.get('SYNC_SECRET_KEY')}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    // 1. Get active symbols that have price data
    const { data: symbols, error: symErr } = await supabase
      .from('symbols')
      .select('symbol')
      .eq('is_active', true)
      .eq('eligible_for_backfill', true)
      .limit(2000)

    if (symErr) throw new Error(`Symbol fetch error: ${symErr.message}`)

    const symbolList = (symbols ?? []).map((s: { symbol: string }) => s.symbol)
    if (symbolList.length === 0) {
      return new Response(JSON.stringify({ ok: true, symbolsTotal: 0, message: 'No eligible symbols' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Determine the date to fetch (previous trading day)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    // Skip weekends
    const day = yesterday.getDay()
    if (day === 0) yesterday.setDate(yesterday.getDate() - 2) // Sunday -> Friday
    if (day === 6) yesterday.setDate(yesterday.getDate() - 1) // Saturday -> Friday
    const dateStr = yesterday.toISOString().slice(0, 10)

    // 3. Fetch grouped bars from Polygon
    const BATCH_SIZE = 50
    let totalFetched = 0
    let totalFailed = 0
    let rowsWritten = 0
    const errors: string[] = []

    for (let i = 0; i < symbolList.length; i += BATCH_SIZE) {
      const batch = symbolList.slice(i, i + BATCH_SIZE)

      for (const symbol of batch) {
        try {
          const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${dateStr}/${dateStr}?adjusted=true&apiKey=${POLYGON_API_KEY}`
          const res = await fetch(url)

          if (res.status === 429) {
            // Rate limited - wait and retry once
            await sleep(13000)
            const retry = await fetch(url)
            if (!retry.ok) {
              totalFailed++
              errors.push(`${symbol}: rate_limited`)
              continue
            }
            const retryData = await retry.json()
            const bars = retryData.results ?? []
            if (bars.length > 0) {
              const bar = bars[0]
              const { error: upsertErr } = await supabase
                .from('daily_prices')
                .upsert({
                  symbol,
                  date: dateStr,
                  open: bar.o,
                  high: bar.h,
                  low: bar.l,
                  close: bar.c,
                  volume: Math.round(bar.v),
                  data_source: 'polygon',
                }, { onConflict: 'symbol,date' })
              if (upsertErr) {
                totalFailed++
                errors.push(`${symbol}: upsert_error`)
              } else {
                rowsWritten++
                totalFetched++
              }
            }
            continue
          }

          if (!res.ok) {
            totalFailed++
            errors.push(`${symbol}: http_${res.status}`)
            continue
          }

          const data = await res.json()
          const bars = data.results ?? []

          if (bars.length > 0) {
            const bar = bars[0]
            const { error: upsertErr } = await supabase
              .from('daily_prices')
              .upsert({
                symbol,
                date: dateStr,
                open: bar.o,
                high: bar.h,
                low: bar.l,
                close: bar.c,
                volume: Math.round(bar.v),
                data_source: 'polygon',
              }, { onConflict: 'symbol,date' })
            if (upsertErr) {
              totalFailed++
              errors.push(`${symbol}: upsert_error`)
            } else {
              rowsWritten++
              totalFetched++
            }
          }
        } catch (err) {
          totalFailed++
          errors.push(`${symbol}: ${String(err).slice(0, 80)}`)
        }
      }

      // Rate limit: 5 req/min on free tier = ~2s between requests
      if (i + BATCH_SIZE < symbolList.length) {
        await sleep(2000)
      }
    }

    // 4. Materialize WSP indicators for all symbols
    let indicatorResult = null
    try {
      const { data: matData, error: matErr } = await supabase.rpc(
        'materialize_wsp_indicators_from_prices',
        { p_as_of_date: dateStr }
      )
      if (matErr) {
        indicatorResult = { ok: false, error: matErr.message }
      } else {
        indicatorResult = matData
      }
    } catch (err) {
      indicatorResult = { ok: false, error: String(err).slice(0, 200) }
    }

    return new Response(JSON.stringify({
      ok: true,
      date: dateStr,
      symbolsTotal: symbolList.length,
      symbolsFetched: totalFetched,
      symbolsFailed: totalFailed,
      rowsWritten,
      indicatorMaterialization: indicatorResult,
      errors: errors.slice(0, 20),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err).slice(0, 500) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
