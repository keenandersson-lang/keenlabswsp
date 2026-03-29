import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

type BackfillRequest = {
  symbols?: string[]
  days?: number
}

type PriceRow = {
  symbol: string
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const BATCH_SIZE = 10
const BATCH_DELAY_MS = 1000
const DEFAULT_DAYS = 730

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = (await req.json().catch(() => ({}))) as BackfillRequest
    const days = clampDays(body.days)

    const symbols = body.symbols?.length
      ? sanitizeSymbols(body.symbols)
      : await getPrioritizedSymbols()

    if (!symbols.length) {
      return jsonResponse({ processed: 0, failed: [], total: 0 })
    }

    let processed = 0
    const failed: string[] = []

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE)

      await Promise.all(
        batch.map(async (symbol) => {
          try {
            const prices = await fetchYahooHistory(symbol, days)

            if (!prices.length) {
              failed.push(symbol)
              return
            }

            const { error } = await supabase
              .from('daily_prices')
              .upsert(prices, { onConflict: 'symbol,date' })

            if (error) {
              console.error(`Failed to upsert ${symbol}:`, error)
              failed.push(symbol)
              return
            }

            processed += 1
          } catch (error) {
            console.error(`Failed to process ${symbol}:`, error)
            failed.push(symbol)
          }
        })
      )

      if (i + BATCH_SIZE < symbols.length) {
        await delay(BATCH_DELAY_MS)
      }
    }

    return jsonResponse({ processed, failed, total: symbols.length })
  } catch (error) {
    console.error('yahoo-backfill error:', error)
    return jsonResponse({ error: String(error) }, 500)
  }
})

async function getPrioritizedSymbols(): Promise<string[]> {
  const prioritized: string[] = []

  const first = await fetchSymbolsByRange(50, 199)
  prioritized.push(...first)

  const second = await fetchSymbolsByRange(1, 49)
  prioritized.push(...second)

  const third = await fetchSymbolsByExact(0)
  prioritized.push(...third)

  return [...new Set(prioritized)]
}

async function fetchSymbolsByRange(min: number, max: number): Promise<string[]> {
  const { data, error } = await supabase
    .from('symbols')
    .select('symbol')
    .gte('history_bars', min)
    .lte('history_bars', max)
    .order('history_bars', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch symbols for range ${min}-${max}: ${error.message}`)
  }

  return (data ?? []).map((row) => String(row.symbol ?? '').toUpperCase()).filter(Boolean)
}

async function fetchSymbolsByExact(value: number): Promise<string[]> {
  const { data, error } = await supabase
    .from('symbols')
    .select('symbol')
    .eq('history_bars', value)

  if (error) {
    throw new Error(`Failed to fetch symbols for history_bars=${value}: ${error.message}`)
  }

  return (data ?? []).map((row) => String(row.symbol ?? '').toUpperCase()).filter(Boolean)
}

async function fetchYahooHistory(symbol: string, days: number): Promise<PriceRow[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2y`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Yahoo request failed (${response.status}) for ${symbol}`)
  }

  const payload = await response.json()
  const result = payload?.chart?.result?.[0]

  if (!result) {
    return []
  }

  const timestamps = result.timestamp as number[] | undefined
  const quote = result.indicators?.quote?.[0] as {
    open?: Array<number | null>
    high?: Array<number | null>
    low?: Array<number | null>
    close?: Array<number | null>
    volume?: Array<number | null>
  } | undefined

  if (!timestamps || !quote) {
    return []
  }

  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000
  const rows: PriceRow[] = []

  for (let idx = 0; idx < timestamps.length; idx += 1) {
    const tsSeconds = timestamps[idx]
    const tsMs = tsSeconds * 1000

    if (tsMs < cutoffMs) {
      continue
    }

    const open = quote.open?.[idx]
    const high = quote.high?.[idx]
    const low = quote.low?.[idx]
    const close = quote.close?.[idx]
    const volume = quote.volume?.[idx]

    if (
      open == null ||
      high == null ||
      low == null ||
      close == null ||
      volume == null
    ) {
      continue
    }

    rows.push({
      symbol,
      date: new Date(tsMs).toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume,
    })
  }

  return rows
}

function sanitizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))]
}

function clampDays(days: number | undefined): number {
  if (!Number.isFinite(days)) {
    return DEFAULT_DAYS
  }

  return Math.max(1, Math.floor(days!))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}
