import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

  // Get all active symbols
  const { data: symbolRows } = await supabase
    .from('symbols')
    .select('symbol')
    .eq('is_active', true)
  const symbols = symbolRows?.map((r: any) => r.symbol) ?? []

  if (symbols.length === 0) {
    return jsonRes({ error: 'No symbols found. Seed symbols first.' })
  }

  // Log start
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
    // Use grouped daily endpoint — ONE call for ALL symbols
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

      // Save prices for tracked symbols
      const upserts: any[] = []
      for (const symbol of symbols) {
        const r = polygonMap[symbol]
        if (!r) {
          failed++
          continue
        }
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

      // Batch upsert all at once
      if (upserts.length > 0) {
        const batches = chunkArray(upserts, 500)
        for (const batch of batches) {
          await supabase
            .from('daily_prices')
            .upsert(batch, { onConflict: 'symbol,date' })
        }
      }

      // Calculate WSP indicators for each symbol
      for (const symbol of symbols) {
        if (!polygonMap[symbol]) continue
        try {
          await calculateAndSaveWSP(symbol, targetDate)
        } catch (err) {
          console.error(`WSP calc error for ${symbol}:`, err)
        }
      }
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

async function calculateAndSaveWSP(symbol: string, calcDate: string) {
  // Get last 300 trading days from cache
  const { data: rows } = await supabase
    .from('daily_prices')
    .select('date, close, high, low, volume')
    .eq('symbol', symbol)
    .lte('date', calcDate)
    .order('date', { ascending: true })
    .limit(300)

  if (!rows || rows.length < 20) return

  const closes = rows.map((r: any) => Number(r.close))
  const highs = rows.map((r: any) => Number(r.high))
  const volumes = rows.map((r: any) => Number(r.volume))
  const len = closes.length

  const ma50 = len >= 50 ? avg(closes.slice(-50)) : null
  const ma150 = len >= 150 ? avg(closes.slice(-150)) : null

  // MA50 slope
  const ma50_10ago = len >= 60 ? avg(closes.slice(-60, -10)) : null
  let ma50Slope: string = 'flat'
  if (ma50 && ma50_10ago) {
    const slopePct = ((ma50 - ma50_10ago) / ma50_10ago) * 100
    if (slopePct > 0.3) ma50Slope = 'up'
    else if (slopePct < -0.3) ma50Slope = 'down'
  }

  const currentClose = closes[len - 1]
  const prevClose = closes[len - 2] ?? currentClose
  const pctChange1d = ((currentClose - prevClose) / prevClose) * 100

  // Volume ratio
  const avgVol5d = len >= 6 ? avg(volumes.slice(-6, -1)) : volumes[len - 1]
  const volumeRatio = avgVol5d > 0 ? volumes[len - 1] / avgVol5d : 1

  // 52-week high
  const barsFor52w = Math.min(252, len)
  const high52w = Math.max(...highs.slice(-barsFor52w))
  const pctFrom52wHigh = ((currentClose - high52w) / high52w) * 100

  const above50 = ma50 ? currentClose > ma50 : false
  const above150 = ma150 ? currentClose > ma150 : false

  // Mansfield RS vs SPY
  let mansfieldRs: number | null = null
  if (len >= 50) {
    const { data: spyRows } = await supabase
      .from('daily_prices')
      .select('close')
      .eq('symbol', 'SPY')
      .lte('date', calcDate)
      .order('date', { ascending: true })
      .limit(300)

    if (spyRows && spyRows.length >= 50) {
      const spyCloses = spyRows.map((r: any) => Number(r.close))
      const symMA = avg(closes.slice(-Math.min(252, len)))
      const spyMA = avg(spyCloses.slice(-Math.min(252, spyCloses.length)))
      if (symMA > 0 && spyMA > 0) {
        const symRatio = currentClose / symMA
        const spyRatio = spyCloses[spyCloses.length - 1] / spyMA
        mansfieldRs = parseFloat(((symRatio / spyRatio - 1) * 100).toFixed(2))
      }
    }
  }

  // WSP Pattern
  let pattern: string
  if (!above150) pattern = 'DOWNHILL'
  else if (above50 && ma50Slope === 'up' && above150 && volumeRatio >= 2)
    pattern = 'CLIMBING'
  else if (pctFrom52wHigh >= -5 && ma50Slope !== 'up') pattern = 'TIRED'
  else if (above150) pattern = 'BASE'
  else pattern = 'DOWNHILL'

  // WSP Score
  let score = 0
  if (above50) score += 20
  if (ma50Slope === 'up') score += 15
  if (above150) score += 15
  if (volumeRatio >= 2) score += 20
  else if (volumeRatio >= 1.5) score += 10
  if (mansfieldRs !== null && mansfieldRs > 0) score += 15
  if (pctFrom52wHigh >= -10) score += 15

  await supabase.from('wsp_indicators').upsert(
    {
      symbol,
      calc_date: calcDate,
      close: currentClose,
      ma50: ma50 ? parseFloat(ma50.toFixed(2)) : null,
      ma150: ma150 ? parseFloat(ma150.toFixed(2)) : null,
      ma50_slope: ma50Slope,
      above_ma50: above50,
      above_ma150: above150,
      volume: volumes[len - 1],
      avg_volume_5d: Math.round(avgVol5d),
      volume_ratio: parseFloat(volumeRatio.toFixed(2)),
      wsp_pattern: pattern,
      wsp_score: score,
      pct_change_1d: parseFloat(pctChange1d.toFixed(2)),
      pct_from_52w_high: parseFloat(pctFrom52wHigh.toFixed(2)),
      mansfield_rs: mansfieldRs,
    },
    { onConflict: 'symbol,calc_date' }
  )
}

const avg = (arr: number[]) =>
  arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length

function getLastTradingDay(): string {
  const now = new Date()
  const et = new Date(now.getTime() - 5 * 60 * 60 * 1000)
  const day = et.getDay()
  // If weekend, go back to Friday
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
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}
