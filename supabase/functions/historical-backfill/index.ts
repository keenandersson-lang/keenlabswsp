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

  // Auth check
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${Deno.env.get('SYNC_SECRET_KEY')}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json().catch(() => ({})) as Record<string, any>
  const { yearsBack = 5, symbols: specificSymbols, batchSize = 5, offset = 0 } = body

  const endDate = getYesterdayNYT()
  const startDate = subtractYears(endDate, yearsBack)

  // Get symbols to backfill
  let symbolsToProcess: string[]
  if (specificSymbols?.length) {
    symbolsToProcess = specificSymbols
  } else {
    // Fetch ALL symbols using range to bypass 1000-row default
    const allSymbols: string[] = []
    let from = offset
    const pageSize = batchSize
    const { data, error: fetchErr } = await supabase
      .from('symbols')
      .select('symbol')
      .eq('is_active', true)
      .order('symbol')
      .range(from, from + pageSize - 1)
    
    if (fetchErr) {
      return jsonRes({ error: `Symbol fetch error: ${fetchErr.message}` })
    }
    allSymbols.push(...(data?.map((r: any) => r.symbol) ?? []))
    symbolsToProcess = allSymbols
  }

  if (symbolsToProcess.length === 0) {
    return jsonRes({ ok: true, message: 'No more symbols at this offset.', offset, done: true })
  }

  // Log start
  const { data: logRow, error: logErr } = await supabase
    .from('data_sync_log')
    .insert({
      sync_type: 'backfill',
      status: 'running',
      data_source: 'polygon',
      metadata: { symbols_total: symbolsToProcess.length, years_back: yearsBack, offset, batch_size: batchSize },
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (logErr) console.error('Log insert error:', logErr.message)

  let fetched = 0
  let failed = 0
  const errors: string[] = []

  for (const symbol of symbolsToProcess) {
    try {
      // Check if we already have sufficient data
      const { count } = await supabase
        .from('daily_prices')
        .select('*', { count: 'exact', head: true })
        .eq('symbol', symbol)
        .gte('date', startDate)

      const expectedDays = yearsBack * 252
      if (count && count > expectedDays * 0.8) {
        fetched++
        continue
      }

      const bars = await fetchPolygonBars(symbol, startDate, endDate)

      if (bars.length === 0) {
        failed++
        errors.push(`${symbol}: no data`)
        continue
      }

      // Save in batches of 500
      const batches = chunkArray(bars, 500)
      for (const batch of batches) {
        const { error: upsertErr } = await supabase
          .from('daily_prices')
          .upsert(
            batch.map((b: any) => ({
              symbol,
              date: b.date,
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
              volume: b.volume,
              data_source: 'polygon',
              has_full_volume: true,
            })),
            { onConflict: 'symbol,date', ignoreDuplicates: false }
          )
        if (upsertErr) {
          console.error(`Upsert error for ${symbol}:`, upsertErr.message)
          errors.push(`${symbol}: upsert failed: ${upsertErr.message}`)
          failed++
          continue
        }
      }

      fetched++

      // Rate limiting: 5 req/min on free tier
      await sleep(13000)
    } catch (err) {
      failed++
      errors.push(`${symbol}: ${String(err).slice(0, 100)}`)
    }
  }

  // Update log
  await supabase
    .from('data_sync_log')
    .update({
      status: failed === 0 ? 'success' : 'partial',
      symbols_processed: fetched,
      symbols_failed: failed,
      completed_at: new Date().toISOString(),
      error_message: errors.slice(0, 10).join('\n') || null,
    })
    .eq('id', logRow?.id)

  const nextOffset = offset + batchSize
  return jsonRes({ ok: true, fetched, failed, errors: errors.slice(0, 5), offset, nextOffset, hasMore: symbolsToProcess.length === batchSize })
})

async function fetchPolygonBars(symbol: string, start: string, end: string) {
  const bars: any[] = []
  let url: string | null =
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${start}/${end}?adjusted=true&sort=asc&limit=50000&apiKey=${POLYGON_KEY}`

  while (url) {
    const res = await fetch(url)
    if (!res.ok) {
      if (res.status === 429) {
        await sleep(12000)
        continue
      }
      throw new Error(`Polygon ${res.status}`)
    }
    const data = await res.json()
    if (data.results) {
      bars.push(
        ...data.results.map((r: any) => ({
          date: new Date(r.t).toISOString().slice(0, 10),
          open: r.o,
          high: r.h,
          low: r.l,
          close: r.c,
          volume: r.v,
        }))
      )
    }
    url = data.next_url ? `${data.next_url}&apiKey=${POLYGON_KEY}` : null
  }
  return bars
}

function getYesterdayNYT(): string {
  const now = new Date()
  // Simple UTC-5 offset for ET
  const et = new Date(now.getTime() - 5 * 60 * 60 * 1000)
  et.setDate(et.getDate() - 1)
  return et.toISOString().slice(0, 10)
}

function subtractYears(date: string, years: number): string {
  const d = new Date(date)
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, (i + 1) * size)
  )
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function jsonRes(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
