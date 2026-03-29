import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const BATCH_SIZE = 10
const BATCH_DELAY_MS = 500
const MAX_SYMBOLS = 100
const MIN_BARS_THRESHOLD = 200

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>
          high?: Array<number | null>
          low?: Array<number | null>
          close?: Array<number | null>
          volume?: Array<number | null>
        }>
      }
    }>
    error?: unknown
  }
}

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

  const startedAt = Date.now()

  try {
    const symbols = await getSymbolsToBackfill()

    let processed = 0
    let failed = 0

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE)

      const results = await Promise.allSettled(
        batch.map((symbol) => backfillSymbol(symbol))
      )

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value === true) {
          processed += 1
        } else {
          failed += 1
        }
      }

      if (i + BATCH_SIZE < symbols.length) {
        await delay(BATCH_DELAY_MS)
      }
    }

    await supabase.from('data_sync_log').insert({
      sync_type: 'historical_backfill',
      status: failed > 0 ? 'partial_success' : 'success',
      data_source: 'yahoo_finance',
      symbols_processed: processed,
      symbols_failed: failed,
      metadata: {
        total: symbols.length,
        batch_size: BATCH_SIZE,
        batch_delay_ms: BATCH_DELAY_MS,
        duration_ms: Date.now() - startedAt,
      },
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date().toISOString(),
    })

    return jsonRes({ processed, failed, total: symbols.length })
  } catch (error) {
    await supabase.from('data_sync_log').insert({
      sync_type: 'historical_backfill',
      status: 'failed',
      data_source: 'yahoo_finance',
      error_message: String(error),
      metadata: {
        duration_ms: Date.now() - startedAt,
      },
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date().toISOString(),
    })

    return new Response(
      JSON.stringify({ error: 'Historical backfill failed', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function getSymbolsToBackfill(): Promise<string[]> {
  const { data: activeSymbols, error: symbolsError } = await supabase
    .from('symbols')
    .select('symbol')
    .eq('is_active', true)
    .eq('is_etf', false)

  if (symbolsError) {
    throw new Error(`Failed to fetch symbols: ${symbolsError.message}`)
  }

  const { data: barCounts, error: countsError } = await supabase
    .from('daily_prices')
    .select('symbol')

  if (countsError) {
    throw new Error(`Failed to fetch daily_prices counts: ${countsError.message}`)
  }

  const counts = new Map<string, number>()
  for (const row of barCounts ?? []) {
    const symbol = row.symbol as string
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1)
  }

  return (activeSymbols ?? [])
    .map((s) => s.symbol)
    .filter((symbol): symbol is string => typeof symbol === 'string' && symbol.length > 0)
    .map((symbol) => ({ symbol, bars: counts.get(symbol) ?? 0 }))
    .filter((row) => row.bars < MIN_BARS_THRESHOLD)
    .sort((a, b) => b.bars - a.bars)
    .slice(0, MAX_SYMBOLS)
    .map((row) => row.symbol)
}

async function backfillSymbol(symbol: string): Promise<boolean> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2y`

  const response = await fetch(url)
  if (!response.ok) {
    console.error(`[BACKFILL] ${symbol} failed with HTTP ${response.status}`)
    return false
  }

  const payload = (await response.json()) as YahooChartResponse
  const result = payload.chart?.result?.[0]

  if (!result?.timestamp?.length) {
    console.warn(`[BACKFILL] ${symbol} returned empty chart data`)
    return false
  }

  const quote = result.indicators?.quote?.[0]
  const rows = result.timestamp
    .map((ts, idx) => ({
      symbol,
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: quote?.open?.[idx] ?? null,
      high: quote?.high?.[idx] ?? null,
      low: quote?.low?.[idx] ?? null,
      close: quote?.close?.[idx] ?? null,
      volume: quote?.volume?.[idx] ?? null,
    }))
    .filter((row) => row.close !== null)

  if (rows.length === 0) {
    console.warn(`[BACKFILL] ${symbol} had no usable daily bars`)
    return false
  }

  const { error } = await supabase
    .from('daily_prices')
    .upsert(rows, { onConflict: 'symbol,date' })

  if (error) {
    console.error(`[BACKFILL] ${symbol} upsert failed: ${error.message}`)
    return false
  }

  return true
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jsonRes(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
