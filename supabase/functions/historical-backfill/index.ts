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

// ── Tier 1 curated universe ──
const TIER1_SYMBOLS = [
  'SPY','QQQ','DIA','IWM',
  'XLK','XLV','XLF','XLE','XLY','XLI','XLC','XLP','XLB','XLRE','XLU',
  'AAPL','MSFT','NVDA','AVGO','AMD','ORCL','CRM',
  'GOOGL','META','NFLX','DIS','TMUS','VZ',
  'AMZN','TSLA','HD','MCD','NKE','BKNG',
  'COST','WMT','PG','KO','PEP','PM',
  'JPM','BAC','WFC','V','MA',
  'LLY','UNH','JNJ','ABBV','MRK','ISRG',
  'CAT','BA','GE','HON','UPS','DE',
  'XOM','CVX','COP','SLB','EOG',
  'LIN','APD','ECL','NUE','DD',
  'PLD','AMT','EQIX','O',
  'NEE','SO','DUK','SRE',
  'GLD','SLV','COPX','GDX','NEM','FCX','PPLT',
]

// ── Failure categories (granular) ──
type FailureCategory =
  | 'rate_limited'
  | 'provider_5xx'
  | 'provider_timeout'
  | 'empty_response'
  | 'symbol_not_found'
  | 'invalid_symbol_format'
  | 'malformed_payload'
  | 'database_upsert_failure'
  | 'unknown_provider_error'

type FailureDetail = {
  symbol: string
  category: FailureCategory
  reason: string
  retryable: boolean
}

const categoryMeta: Record<FailureCategory, { label: string; retryable: boolean; maxRetries: number; backoffMs: number }> = {
  rate_limited:           { label: 'Rate limited (429)',       retryable: true,  maxRetries: 3, backoffMs: 13000 },
  provider_5xx:           { label: 'Provider 5xx error',       retryable: true,  maxRetries: 2, backoffMs: 5000 },
  provider_timeout:       { label: 'Provider timeout',         retryable: true,  maxRetries: 2, backoffMs: 5000 },
  empty_response:         { label: 'No data returned',         retryable: false, maxRetries: 0, backoffMs: 0 },
  symbol_not_found:       { label: 'Symbol not found (404)',   retryable: false, maxRetries: 0, backoffMs: 0 },
  invalid_symbol_format:  { label: 'Invalid symbol format',    retryable: false, maxRetries: 0, backoffMs: 0 },
  malformed_payload:      { label: 'Malformed/parse error',    retryable: false, maxRetries: 0, backoffMs: 0 },
  database_upsert_failure:{ label: 'Database upsert failure',  retryable: true,  maxRetries: 2, backoffMs: 1000 },
  unknown_provider_error: { label: 'Unknown provider error',   retryable: true,  maxRetries: 1, backoffMs: 3000 },
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

  const body = await req.json().catch(() => ({})) as Record<string, any>
  const {
    yearsBack = 5,
    symbols: specificSymbols,
    batchSize = 20,
    offset = 0,
    tier1Only = false,
    sleepBetweenMs = 13000,
  } = body

  const endDate = getYesterdayNYT()
  const startDate = subtractYears(endDate, yearsBack)

  // ── Determine symbols to process ──
  let symbolsToProcess: string[]
  if (specificSymbols?.length) {
    symbolsToProcess = specificSymbols
  } else if (tier1Only) {
    // Only process Tier 1 symbols that still need data
    const { data: existingCoverage } = await supabase
      .from('daily_prices')
      .select('symbol')
      .in('symbol', TIER1_SYMBOLS)

    const coveredSymbols = new Set<string>()
    const barCounts: Record<string, number> = {}
    ;(existingCoverage ?? []).forEach((r: any) => {
      coveredSymbols.add(r.symbol)
      barCounts[r.symbol] = (barCounts[r.symbol] ?? 0) + 1
    })

    const expectedDays = yearsBack * 252
    // Filter to symbols that need backfill (missing or incomplete)
    symbolsToProcess = TIER1_SYMBOLS.filter(s => {
      const bars = barCounts[s] ?? 0
      return bars < expectedDays * 0.8
    })

    // Priority order: benchmarks first, then full_wsp_equity, then metals
    const BENCHMARKS = new Set(['SPY','QQQ','DIA','IWM','XLK','XLV','XLF','XLE','XLY','XLI','XLC','XLP','XLB','XLRE','XLU'])
    const METALS = new Set(['GLD','SLV','COPX','GDX','NEM','FCX','PPLT'])
    symbolsToProcess.sort((a, b) => {
      const prioA = BENCHMARKS.has(a) ? 0 : METALS.has(a) ? 2 : 1
      const prioB = BENCHMARKS.has(b) ? 0 : METALS.has(b) ? 2 : 1
      return prioA - prioB || a.localeCompare(b)
    })

    // Apply batch pagination
    symbolsToProcess = symbolsToProcess.slice(offset, offset + batchSize)
  } else {
    // Full universe (legacy mode)
    const { data, error: fetchErr } = await supabase
      .from('symbols')
      .select('symbol')
      .eq('is_active', true)
      .order('symbol')
      .range(offset, offset + batchSize - 1)

    if (fetchErr) {
      return jsonRes({ error: `Symbol fetch error: ${fetchErr.message}` })
    }

    symbolsToProcess = (data ?? [])
      .filter((r: any) => {
        const sym = (r.symbol ?? '').toUpperCase()
        if (sym.length === 0 || sym.length > 5) return false
        if (/[^A-Z0-9]/.test(sym)) return false
        return true
      })
      .map((r: any) => r.symbol)
  }

  if (symbolsToProcess.length === 0) {
    return jsonRes({ ok: true, message: 'No symbols need backfill at this offset.', offset, done: true, tier1Only })
  }

  // Log start
  const { data: logRow, error: logErr } = await supabase
    .from('data_sync_log')
    .insert({
      sync_type: tier1Only ? 'backfill_tier1' : 'backfill',
      status: 'running',
      data_source: 'polygon',
      metadata: {
        symbols_total: symbolsToProcess.length,
        symbols_list: symbolsToProcess,
        years_back: yearsBack,
        offset,
        batch_size: batchSize,
        tier1_only: tier1Only,
        sleep_between_ms: sleepBetweenMs,
      },
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (logErr) console.error('Log insert error:', logErr.message)

  let fetched = 0
  let failed = 0
  let skipped = 0
  const failureDetails: FailureDetail[] = []
  const failureCounts: Record<FailureCategory, number> = Object.fromEntries(
    Object.keys(categoryMeta).map(k => [k, 0])
  ) as Record<FailureCategory, number>

  const recordFailure = (symbol: string, category: FailureCategory, rawReason: string) => {
    const reason = safeReason(rawReason)
    const meta = categoryMeta[category]
    failed++
    failureCounts[category]++
    failureDetails.push({ symbol, category, reason, retryable: meta.retryable })
    console.error(`[BACKFILL_FAILURE] symbol=${symbol} category=${category} retryable=${meta.retryable} reason=${reason}`)
  }

  for (const symbol of symbolsToProcess) {
    try {
      // Check existing coverage
      const { count } = await supabase
        .from('daily_prices')
        .select('*', { count: 'exact', head: true })
        .eq('symbol', symbol)
        .gte('date', startDate)

      const expectedDays = yearsBack * 252
      if (count && count > expectedDays * 0.8) {
        fetched++
        skipped++
        console.log(`[BACKFILL_SKIP] symbol=${symbol} already has ${count} bars`)
        continue
      }

      const bars = await fetchPolygonBarsWithRetry(symbol, startDate, endDate)

      if (bars.length === 0) {
        recordFailure(symbol, 'empty_response', `No bars returned for ${symbol}`)
        continue
      }

      // Save in batches of 500
      const batches = chunkArray(bars, 500)
      let symbolFailed = false
      for (const batch of batches) {
        const upsertOk = await upsertWithRetry(symbol, batch)
        if (!upsertOk) {
          symbolFailed = true
          recordFailure(symbol, 'database_upsert_failure', `Upsert failed after retries for ${symbol}`)
          break
        }
      }

      if (!symbolFailed) {
        fetched++
        console.log(`[BACKFILL_OK] symbol=${symbol} bars=${bars.length}`)
      }

      // Rate limiting sleep between symbols
      await sleep(sleepBetweenMs)
    } catch (err) {
      const { category, reason } = classifyError(err)
      recordFailure(symbol, category, reason)
      // Extra sleep after rate limit errors
      if (category === 'rate_limited') {
        await sleep(15000)
      }
    }
  }

  const retryableFailures = failureDetails.filter(f => f.retryable).length
  const permanentFailures = failureDetails.filter(f => !f.retryable).length

  const topFailureCategories = Object.entries(failureCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({
      category,
      label: categoryMeta[category as FailureCategory].label,
      count,
      retryable: categoryMeta[category as FailureCategory].retryable,
    }))

  // Update log
  await supabase
    .from('data_sync_log')
    .update({
      status: failed === 0 ? 'success' : 'partial',
      symbols_processed: fetched,
      symbols_failed: failed,
      completed_at: new Date().toISOString(),
      error_message: failureDetails.slice(0, 10).map(f => `${f.symbol}: ${f.category}: ${f.reason}`).join('\n') || null,
      metadata: {
        symbols_total: symbolsToProcess.length,
        symbols_list: symbolsToProcess,
        years_back: yearsBack,
        offset,
        batch_size: batchSize,
        tier1_only: tier1Only,
        failure_counts: failureCounts,
        top_failure_categories: topFailureCategories.slice(0, 5),
        retryable_failures: retryableFailures,
        permanent_failures: permanentFailures,
        skipped,
      },
    })
    .eq('id', logRow?.id)

  const nextOffset = offset + batchSize
  const totalNeeded = tier1Only ? TIER1_SYMBOLS.length : undefined
  return jsonRes({
    ok: true,
    fetched,
    failed,
    skipped,
    successRate: symbolsToProcess.length ? Number(((fetched / symbolsToProcess.length) * 100).toFixed(2)) : 0,
    symbolsAttempted: symbolsToProcess.length,
    symbolsList: symbolsToProcess,
    offset,
    nextOffset,
    hasMore: symbolsToProcess.length === batchSize,
    tier1Only,
    tier1Total: totalNeeded,
    failureCounts,
    topFailureCategories,
    retryableFailures,
    permanentFailures,
    failedSymbols: failureDetails,
  })
})

// ── Polygon fetch with smart retry ──
async function fetchPolygonBarsWithRetry(symbol: string, start: string, end: string) {
  let attempt = 0
  let lastCategory: FailureCategory = 'unknown_provider_error'

  while (true) {
    try {
      return await fetchPolygonBars(symbol, start, end)
    } catch (err) {
      const { category, reason } = classifyError(err)
      lastCategory = category
      const meta = categoryMeta[category]

      if (!meta.retryable || attempt >= meta.maxRetries) {
        throw err
      }

      attempt++
      const backoff = meta.backoffMs * attempt
      console.warn(`[BACKFILL_RETRY] symbol=${symbol} category=${category} attempt=${attempt}/${meta.maxRetries} backoff=${backoff}ms reason=${safeReason(reason)}`)
      await sleep(backoff)
    }
  }
}

async function fetchPolygonBars(symbol: string, start: string, end: string) {
  const bars: any[] = []
  let url: string | null =
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${start}/${end}?adjusted=true&sort=asc&limit=50000&apiKey=${POLYGON_KEY}`

  while (url) {
    let res: Response
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)
      res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw makeError('provider_timeout', `Request timed out for ${symbol}`)
      }
      throw makeError('unknown_provider_error', `Network error for ${symbol}: ${String(err)}`)
    }

    if (!res.ok) {
      const rawText = await res.text().catch(() => '')
      if (res.status === 429) {
        throw makeError('rate_limited', `Polygon rate-limited (429) for ${symbol}`)
      }
      if (res.status === 400) {
        throw makeError('invalid_symbol_format', `Polygon 400 for ${symbol}: ${safeReason(rawText)}`)
      }
      if (res.status === 404) {
        throw makeError('symbol_not_found', `Polygon 404 for ${symbol}`)
      }
      if (res.status >= 500) {
        throw makeError('provider_5xx', `Polygon ${res.status} for ${symbol}: ${safeReason(rawText)}`)
      }
      throw makeError('unknown_provider_error', `Polygon ${res.status} for ${symbol}: ${safeReason(rawText)}`)
    }

    let data: any
    try {
      data = await res.json()
    } catch (err) {
      throw makeError('malformed_payload', `JSON parse error for ${symbol}: ${String(err)}`)
    }

    if (data?.status === 'ERROR') {
      throw makeError('unknown_provider_error', `Polygon error: ${safeReason(data?.error ?? data?.message ?? 'unknown')}`)
    }

    if (data?.status === 'NOT_FOUND') {
      throw makeError('symbol_not_found', `Polygon NOT_FOUND for ${symbol}`)
    }

    if (data?.status === 'OK' && (!Array.isArray(data.results) || data.results.length === 0)) {
      // No data — not an error for pagination, just empty
      break
    }

    if (data.results) {
      for (const r of data.results) {
        const date = new Date(r.t).toISOString().slice(0, 10)
        const open = Number(r.o)
        const high = Number(r.h)
        const low = Number(r.l)
        const close = Number(r.c)
        const volume = Number(r.v)

        if (!date || Number.isNaN(open) || Number.isNaN(close) || Number.isNaN(volume)) {
          continue // skip bad bars instead of failing entire symbol
        }

        bars.push({ date, open, high, low, close, volume: Math.round(volume) })
      }
    }
    url = data.next_url ? `${data.next_url}&apiKey=${POLYGON_KEY}` : null
  }
  return bars
}

// ── Upsert with retry ──
async function upsertWithRetry(symbol: string, batch: any[]): Promise<boolean> {
  const meta = categoryMeta.database_upsert_failure
  for (let attempt = 0; attempt <= meta.maxRetries; attempt++) {
    const { error } = await supabase
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

    if (!error) return true

    if (attempt < meta.maxRetries) {
      console.warn(`[BACKFILL_UPSERT_RETRY] symbol=${symbol} attempt=${attempt + 1}/${meta.maxRetries} error=${safeReason(error.message)}`)
      await sleep(meta.backoffMs * (attempt + 1))
    } else {
      console.error(`[BACKFILL_UPSERT_FAIL] symbol=${symbol} error=${safeReason(error.message)}`)
    }
  }
  return false
}

// ── Error classification ──
function makeError(category: FailureCategory, reason: string): Error {
  return new Error(JSON.stringify({ category, reason }))
}

function classifyError(err: unknown): { category: FailureCategory; reason: string } {
  const fallback = { category: 'unknown_provider_error' as FailureCategory, reason: safeReason(String(err)) }
  if (!err) return fallback

  const message = typeof err === 'string' ? err : err instanceof Error ? err.message : JSON.stringify(err)

  try {
    const parsed = JSON.parse(message)
    if (parsed?.category && categoryMeta[parsed.category as FailureCategory]) {
      return { category: parsed.category as FailureCategory, reason: safeReason(String(parsed.reason)) }
    }
  } catch {}

  const lower = message.toLowerCase()
  if (lower.includes('429') || lower.includes('rate')) return { category: 'rate_limited', reason: safeReason(message) }
  if (lower.includes('timeout') || lower.includes('abort')) return { category: 'provider_timeout', reason: safeReason(message) }
  if (lower.includes('500') || lower.includes('502') || lower.includes('503')) return { category: 'provider_5xx', reason: safeReason(message) }
  if (lower.includes('404') || lower.includes('not found')) return { category: 'symbol_not_found', reason: safeReason(message) }
  if (lower.includes('400') || lower.includes('invalid')) return { category: 'invalid_symbol_format', reason: safeReason(message) }
  if (lower.includes('parse') || lower.includes('json')) return { category: 'malformed_payload', reason: safeReason(message) }
  if (lower.includes('upsert') || lower.includes('insert') || lower.includes('constraint')) return { category: 'database_upsert_failure', reason: safeReason(message) }
  return fallback
}

function safeReason(raw: string) {
  return raw.replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '').slice(0, 240)
}

function getYesterdayNYT(): string {
  const now = new Date()
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
