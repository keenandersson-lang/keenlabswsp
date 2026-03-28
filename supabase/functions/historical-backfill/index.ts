import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const POLYGON_KEY = Deno.env.get('POLYGON_API_KEY') ?? ''

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

// ── Failure categories ──
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

  // ── Mode: test_polygon — single diagnostic call ──
  if (body.mode === 'test_polygon') {
    return handleTestPolygon()
  }

  // ── Mode: date_backfill (Polygon grouped endpoint per date) ──
  if (body.mode === 'date_backfill') {
    return handleDateBackfill(body)
  }

  // ── Mode: per-symbol backfill (original) ──
  return handleSymbolBackfill(body)
})

// ═══════════════════════════════════════════════════
// TEST POLYGON — diagnostic single-date call
// ═══════════════════════════════════════════════════
async function handleTestPolygon() {
  const diagnostics: Record<string, unknown> = {
    polygon_key_set: !!POLYGON_KEY,
    polygon_key_length: POLYGON_KEY.length,
    polygon_key_prefix: POLYGON_KEY ? POLYGON_KEY.slice(0, 4) + '...' : '(empty)',
    supabase_url_set: !!Deno.env.get('SUPABASE_URL'),
    timestamp: new Date().toISOString(),
  }

  if (!POLYGON_KEY) {
    return jsonRes({ ok: false, error: 'POLYGON_API_KEY is not set or empty', diagnostics })
  }

  // Use a known recent trading day (Friday March 21, 2025)
  const testDate = getLastTradingDay()
  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${testDate}?adjusted=true&apiKey=${POLYGON_KEY}`

  try {
    const res = await fetch(url)
    const httpStatus = res.status
    const rawBody = await res.text()

    diagnostics.test_date = testDate
    diagnostics.http_status = httpStatus
    diagnostics.response_length = rawBody.length

    if (!res.ok) {
      diagnostics.error_body = rawBody.slice(0, 500)
      // Log to data_sync_log
      await supabase.from('data_sync_log').insert({
        sync_type: 'polygon_test',
        status: 'failed',
        data_source: 'polygon',
        error_message: `HTTP ${httpStatus}: ${rawBody.slice(0, 300)}`,
        metadata: diagnostics,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      return jsonRes({ ok: false, error: `Polygon returned HTTP ${httpStatus}`, diagnostics })
    }

    let parsed: any
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      diagnostics.parse_error = true
      return jsonRes({ ok: false, error: 'Failed to parse Polygon response as JSON', diagnostics })
    }

    const resultCount = Array.isArray(parsed.results) ? parsed.results.length : 0
    const sampleTickers = (parsed.results ?? []).slice(0, 5).map((r: any) => r.T)
    const tier1Matches = (parsed.results ?? []).filter((r: any) => TIER1_SYMBOLS.includes(r.T)).length

    diagnostics.polygon_status = parsed.status
    diagnostics.query_count = parsed.queryCount
    diagnostics.result_count = resultCount
    diagnostics.tier1_matches = tier1Matches
    diagnostics.sample_tickers = sampleTickers

    // Log success to data_sync_log
    await supabase.from('data_sync_log').insert({
      sync_type: 'polygon_test',
      status: 'success',
      data_source: 'polygon',
      symbols_processed: resultCount,
      metadata: diagnostics,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })

    return jsonRes({
      ok: true,
      testDate,
      httpStatus,
      resultCount,
      tier1Matches,
      sampleTickers,
      polygonStatus: parsed.status,
      diagnostics,
    })
  } catch (err) {
    diagnostics.fetch_error = String(err)
    return jsonRes({ ok: false, error: `Fetch failed: ${String(err)}`, diagnostics })
  }
}

// ═══════════════════════════════════════════════════
// DATE-BASED BACKFILL (Polygon grouped daily endpoint)
// ═══════════════════════════════════════════════════
async function handleDateBackfill(body: Record<string, any>) {
  const { action = 'run', daysPerBatch = 5, resumeFrom = null } = body

  // Pre-flight check
  if (!POLYGON_KEY) {
    return jsonRes({ ok: false, error: 'POLYGON_API_KEY is not set in edge function environment' })
  }

  if (action === 'status') {
    const { data: earliest } = await supabase
      .from('daily_prices')
      .select('date')
      .order('date', { ascending: true })
      .limit(1)

    const { data: latest } = await supabase
      .from('daily_prices')
      .select('date')
      .order('date', { ascending: false })
      .limit(1)

    const { data: lastLog } = await supabase
      .from('data_sync_log')
      .select('metadata')
      .eq('sync_type', 'backfill_by_date')
      .order('started_at', { ascending: false })
      .limit(1)

    const lastBackfilledDate = (lastLog?.[0]?.metadata as any)?.last_date ?? null

    return jsonRes({
      ok: true,
      earliestDate: earliest?.[0]?.date ?? null,
      latestDate: latest?.[0]?.date ?? null,
      lastBackfilledDate,
    })
  }

  const endDate = getYesterdayNYT()
  const twoYearsAgo = subtractYears(endDate, 2)
  const tradingDays = generateTradingDays(twoYearsAgo, endDate)

  let startIdx = 0
  if (resumeFrom) {
    const idx = tradingDays.indexOf(resumeFrom)
    if (idx >= 0) startIdx = idx + 1
  }

  const batch = tradingDays.slice(startIdx, startIdx + daysPerBatch)

  if (batch.length === 0) {
    return jsonRes({ ok: true, message: 'All trading days backfilled.', completedDays: tradingDays.length, totalDays: tradingDays.length })
  }

  const { data: logRow } = await supabase
    .from('data_sync_log')
    .insert({
      sync_type: 'backfill_by_date',
      status: 'running',
      data_source: 'polygon',
      metadata: { batch_dates: batch, resume_from: resumeFrom, total_days: tradingDays.length, start_idx: startIdx },
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  let completedDays = 0
  let totalRows = 0
  let lastDate = ''
  let lastError = ''
  const perDateLog: { date: string; status: string; rows: number; httpStatus?: number; error?: string }[] = []

  for (const date of batch) {
    try {
      const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLYGON_KEY}`
      console.log(`[DATE_BACKFILL] Fetching ${date}...`)

      const res = await fetch(url)
      const httpStatus = res.status
      const rawBody = await res.text()

      console.log(`[DATE_BACKFILL] ${date} → HTTP ${httpStatus}, body length=${rawBody.length}`)

      if (httpStatus === 429) {
        console.warn(`[DATE_BACKFILL] Rate limited on ${date}, waiting 15s and retrying...`)
        perDateLog.push({ date, status: 'rate_limited', rows: 0, httpStatus })
        await sleep(15000)
        const retry = await fetch(url)
        const retryStatus = retry.status
        const retryBody = await retry.text()
        console.log(`[DATE_BACKFILL] Retry ${date} → HTTP ${retryStatus}, body length=${retryBody.length}`)

        if (retryStatus !== 200) {
          lastError = `Rate limited on ${date}, retry failed: HTTP ${retryStatus}`
          perDateLog.push({ date, status: 'retry_failed', rows: 0, httpStatus: retryStatus, error: retryBody.slice(0, 200) })
          console.error(lastError)
          break
        }
        let retryData: any
        try { retryData = JSON.parse(retryBody) } catch { lastError = `JSON parse failed on retry for ${date}`; break }
        const rows = await upsertGroupedData(date, retryData)
        totalRows += rows
        completedDays++
        lastDate = date
        perDateLog.push({ date, status: 'ok_after_retry', rows, httpStatus: retryStatus })
      } else if (httpStatus !== 200) {
        lastError = `Polygon grouped HTTP ${httpStatus} for ${date}: ${rawBody.slice(0, 200)}`
        console.error(`[DATE_BACKFILL] ${lastError}`)
        perDateLog.push({ date, status: 'error', rows: 0, httpStatus, error: rawBody.slice(0, 200) })
        completedDays++
        lastDate = date
      } else {
        let data: any
        try { data = JSON.parse(rawBody) } catch {
          lastError = `JSON parse failed for ${date}`
          perDateLog.push({ date, status: 'parse_error', rows: 0, httpStatus })
          console.error(`[DATE_BACKFILL] ${lastError}`)
          completedDays++
          lastDate = date
          continue
        }

        const resultCount = Array.isArray(data.results) ? data.results.length : 0
        console.log(`[DATE_BACKFILL] ${date}: polygon status=${data.status}, resultsCount=${resultCount}`)

        if (resultCount === 0) {
          perDateLog.push({ date, status: 'empty', rows: 0, httpStatus, error: `status=${data.status}, queryCount=${data.queryCount}` })
          completedDays++
          lastDate = date
        } else {
          const rows = await upsertGroupedData(date, data)
          totalRows += rows
          completedDays++
          lastDate = date
          perDateLog.push({ date, status: 'ok', rows, httpStatus })
        }
      }

      // Update progress in data_sync_log after each date
      if (logRow?.id) {
        await supabase
          .from('data_sync_log')
          .update({
            symbols_processed: totalRows,
            metadata: {
              batch_dates: batch,
              completed_days: completedDays,
              total_rows: totalRows,
              last_date: lastDate,
              total_trading_days: tradingDays.length,
              start_idx: startIdx,
              per_date_log: perDateLog,
            },
          })
          .eq('id', logRow.id)
      }

      // Respect Polygon free tier rate limit (5 req/min)
      await sleep(13000)
    } catch (err) {
      lastError = `Error on ${date}: ${String(err)}`
      console.error(`[DATE_BACKFILL] ${lastError}`)
      perDateLog.push({ date, status: 'exception', rows: 0, error: String(err).slice(0, 200) })
      break
    }
  }

  // Final update
  if (logRow?.id) {
    await supabase
      .from('data_sync_log')
      .update({
        status: lastError ? 'partial' : 'success',
        symbols_processed: totalRows,
        completed_at: new Date().toISOString(),
        error_message: lastError || null,
        metadata: {
          batch_dates: batch,
          completed_days: completedDays,
          total_rows: totalRows,
          last_date: lastDate,
          total_trading_days: tradingDays.length,
          start_idx: startIdx,
          per_date_log: perDateLog,
        },
      })
      .eq('id', logRow.id)
  }

  return jsonRes({
    ok: true,
    completedDays: startIdx + completedDays,
    totalDays: tradingDays.length,
    totalRows,
    lastDate,
    hasMore: (startIdx + completedDays) < tradingDays.length,
    error: lastError || undefined,
    perDateLog,
  })
}

async function upsertGroupedData(date: string, data: any): Promise<number> {
  if (!Array.isArray(data.results) || data.results.length === 0) return 0

  const inserts = data.results
    .filter((r: any) => {
      const sym = String(r.T ?? '')
      return sym.length > 0 && sym.length <= 5 && !/[^A-Z0-9]/.test(sym)
    })
    .map((r: any) => ({
      symbol: r.T,
      date,
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: Math.round(r.v),
      data_source: 'polygon',
      has_full_volume: true,
    }))

  if (inserts.length === 0) return 0

  let written = 0
  const batches = chunkArray(inserts, 500)
  for (const batch of batches) {
    const { error, count } = await supabase
      .from('daily_prices')
      .upsert(batch, { onConflict: 'symbol,date', ignoreDuplicates: false, count: 'exact' })
    if (error) {
      console.error(`[DATE_BACKFILL] Upsert error for ${date}: ${error.message}`)
    } else {
      written += count ?? 0
    }
  }

  console.log(`[DATE_BACKFILL] ${date}: ${inserts.length} symbols filtered, ${written} rows written`)
  return written
}

function generateTradingDays(start: string, end: string): string[] {
  const days: string[] = []
  const d = new Date(start)
  const endD = new Date(end)

  while (d <= endD) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) {
      days.push(d.toISOString().slice(0, 10))
    }
    d.setDate(d.getDate() + 1)
  }

  return days
}

// ═══════════════════════════════════════════════════
// PER-SYMBOL BACKFILL (original logic)
// ═══════════════════════════════════════════════════
async function handleSymbolBackfill(body: Record<string, any>) {
  if (!POLYGON_KEY) {
    return jsonRes({ ok: false, error: 'POLYGON_API_KEY is not set in edge function environment' })
  }

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
  const expectedDays = yearsBack * 252

  let symbolsToProcess: string[]

  if (specificSymbols?.length) {
    symbolsToProcess = specificSymbols
  } else if (tier1Only) {
    const { data: existingCoverage } = await supabase
      .from('daily_prices')
      .select('symbol')
      .in('symbol', TIER1_SYMBOLS)

    const barCounts: Record<string, number> = {}
    ;(existingCoverage ?? []).forEach((r: any) => {
      barCounts[r.symbol] = (barCounts[r.symbol] ?? 0) + 1
    })

    const BENCH_SET = new Set(['SPY','QQQ','DIA','IWM','XLK','XLV','XLF','XLE','XLY','XLI','XLC','XLP','XLB','XLRE','XLU'])
    const METALS_SET = new Set(['GLD','SLV','COPX','GDX','NEM','FCX','PPLT'])

    symbolsToProcess = TIER1_SYMBOLS
      .filter(s => (barCounts[s] ?? 0) < expectedDays * 0.8)
      .sort((a, b) => {
        const prioA = BENCH_SET.has(a) ? 0 : METALS_SET.has(a) ? 2 : 1
        const prioB = BENCH_SET.has(b) ? 0 : METALS_SET.has(b) ? 2 : 1
        return prioA - prioB || a.localeCompare(b)
      })
  } else {
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
      for (const r of page) {
        const sym = String(r.symbol ?? '').toUpperCase().trim()
        if (sym.length > 0 && sym.length <= 5 && !/[^A-Z0-9]/.test(sym)) {
          allSymbols.push(sym)
        }
      }
      if (page.length < 1000) break
      from += 1000
    }

    const { data: existingCoverage } = await supabase
      .from('daily_prices')
      .select('symbol')

    const barCounts: Record<string, number> = {}
    ;(existingCoverage ?? []).forEach((r: any) => {
      barCounts[r.symbol] = (barCounts[r.symbol] ?? 0) + 1
    })

    symbolsToProcess = allSymbols.filter(sym => (barCounts[sym] ?? 0) < expectedDays * 0.8)
  }

  symbolsToProcess = symbolsToProcess.slice(offset, offset + batchSize)

  if (symbolsToProcess.length === 0) {
    return jsonRes({ ok: true, message: 'No symbols need backfill.', offset, done: true, hasMore: false })
  }

  const { data: logRow } = await supabase
    .from('data_sync_log')
    .insert({
      sync_type: tier1Only ? 'backfill_tier1' : 'backfill',
      status: 'running',
      data_source: 'polygon',
      metadata: { symbols_total: symbolsToProcess.length, symbols_list: symbolsToProcess, years_back: yearsBack, offset },
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  let fetched = 0, failed = 0, skipped = 0
  let rowsFetched = 0, rowsWritten = 0
  const failureCounts: Record<string, number> = {}
  const failureDetails: { symbol: string; category: string; reason: string; retryable: boolean }[] = []

  const recordFailure = (symbol: string, category: FailureCategory, rawReason: string) => {
    const reason = safeReason(rawReason)
    failed++
    failureCounts[category] = (failureCounts[category] ?? 0) + 1
    failureDetails.push({ symbol, category, reason, retryable: categoryMeta[category].retryable })
  }

  for (const symbol of symbolsToProcess) {
    try {
      const { count } = await supabase
        .from('daily_prices')
        .select('*', { count: 'exact', head: true })
        .eq('symbol', symbol)
        .gte('date', startDate)

      if (count && count > expectedDays * 0.8) {
        fetched++
        skipped++
        continue
      }

      const bars = await fetchPolygonBarsWithRetry(symbol, startDate, endDate)
      if (bars.length === 0) {
        recordFailure(symbol, 'empty_response', `No bars for ${symbol}`)
        continue
      }

      rowsFetched += bars.length
      const batches = chunkArray(bars, 500)
      let symbolFailed = false

      for (const batch of batches) {
        const result = await upsertWithRetry(symbol, batch)
        rowsWritten += result.written
        if (!result.ok) {
          symbolFailed = true
          recordFailure(symbol, 'database_upsert_failure', `Upsert failed for ${symbol}`)
          break
        }
      }

      if (!symbolFailed) {
        fetched++
        console.log(`[BACKFILL_OK] symbol=${symbol} bars=${bars.length}`)
      }

      await sleep(sleepBetweenMs)
    } catch (err) {
      const { category, reason } = classifyError(err)
      recordFailure(symbol, category, reason)
      if (category === 'rate_limited') await sleep(15000)
    }
  }

  await supabase
    .from('data_sync_log')
    .update({
      status: failed === 0 ? 'success' : 'partial',
      symbols_processed: fetched,
      symbols_failed: failed,
      completed_at: new Date().toISOString(),
      error_message: failureDetails.slice(0, 10).map(f => `${f.symbol}: ${f.category}`).join('\n') || null,
      metadata: { symbols_total: symbolsToProcess.length, offset, failure_counts: failureCounts, rows_written: rowsWritten },
    })
    .eq('id', logRow?.id)

  return jsonRes({
    ok: true,
    fetched,
    failed,
    skipped,
    rowsFetched,
    rowsWritten,
    offset,
    nextOffset: offset + batchSize,
    hasMore: symbolsToProcess.length === batchSize,
    tier1Only,
    failureCounts,
    topFailureCategories: Object.entries(failureCounts)
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ category: cat, count, retryable: categoryMeta[cat as FailureCategory]?.retryable ?? false })),
    failedSymbols: failureDetails,
  })
}

// ── Polygon fetch with smart retry ──
async function fetchPolygonBarsWithRetry(symbol: string, start: string, end: string) {
  let attempt = 0
  while (true) {
    try {
      return await fetchPolygonBars(symbol, start, end)
    } catch (err) {
      const { category } = classifyError(err)
      const meta = categoryMeta[category]
      if (!meta.retryable || attempt >= meta.maxRetries) throw err
      attempt++
      await sleep(meta.backoffMs * attempt)
    }
  }
}

async function fetchPolygonBars(symbol: string, start: string, end: string) {
  const bars: any[] = []
  let url: string | null =
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${start}/${end}?adjusted=true&sort=asc&limit=50000&apiKey=${POLYGON_KEY}`

  while (url) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)
    let res: Response
    try {
      res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
    } catch (err) {
      clearTimeout(timeoutId)
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw makeError('provider_timeout', `Timeout for ${symbol}`)
      }
      throw makeError('unknown_provider_error', `Network error for ${symbol}`)
    }

    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      if (res.status === 429) throw makeError('rate_limited', `429 for ${symbol}`)
      if (res.status === 404) throw makeError('symbol_not_found', `404 for ${symbol}`)
      if (res.status === 400) throw makeError('invalid_symbol_format', `400 for ${symbol}`)
      if (res.status >= 500) throw makeError('provider_5xx', `${res.status} for ${symbol}`)
      throw makeError('unknown_provider_error', `${res.status} for ${symbol}: ${safeReason(raw)}`)
    }

    let data: any
    try { data = await res.json() } catch {
      throw makeError('malformed_payload', `JSON parse error for ${symbol}`)
    }

    if (data?.status === 'NOT_FOUND') throw makeError('symbol_not_found', `NOT_FOUND for ${symbol}`)
    if (data?.status === 'ERROR') throw makeError('unknown_provider_error', `Error for ${symbol}`)

    if (data?.status === 'OK' && (!Array.isArray(data.results) || data.results.length === 0)) break

    if (data.results) {
      for (const r of data.results) {
        const date = new Date(r.t).toISOString().slice(0, 10)
        const open = Number(r.o), high = Number(r.h), low = Number(r.l), close = Number(r.c), volume = Number(r.v)
        if (!date || Number.isNaN(open) || Number.isNaN(close) || Number.isNaN(volume)) continue
        bars.push({ date, open, high, low, close, volume: Math.round(volume) })
      }
    }
    url = data.next_url ? `${data.next_url}&apiKey=${POLYGON_KEY}` : null
  }
  return bars
}

async function upsertWithRetry(symbol: string, batch: any[]): Promise<{ ok: boolean; written: number }> {
  const meta = categoryMeta.database_upsert_failure
  for (let attempt = 0; attempt <= meta.maxRetries; attempt++) {
    const { error, count } = await supabase
      .from('daily_prices')
      .upsert(
        batch.map((b: any) => ({
          symbol, date: b.date, open: b.open, high: b.high, low: b.low, close: b.close,
          volume: b.volume, data_source: 'polygon', has_full_volume: true,
        })),
        { onConflict: 'symbol,date', ignoreDuplicates: false, count: 'exact' }
      )
    if (!error) return { ok: true, written: count ?? 0 }
    if (attempt < meta.maxRetries) await sleep(meta.backoffMs * (attempt + 1))
    else console.error(`[UPSERT_FAIL] ${symbol}: ${safeReason(error.message)}`)
  }
  return { ok: false, written: 0 }
}

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
  return fallback
}

function safeReason(raw: string) { return raw.replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '').slice(0, 240) }

function getYesterdayNYT(): string {
  const now = new Date()
  const et = new Date(now.getTime() - 5 * 60 * 60 * 1000)
  et.setDate(et.getDate() - 1)
  return et.toISOString().slice(0, 10)
}

function getLastTradingDay(): string {
  const now = new Date()
  const et = new Date(now.getTime() - 5 * 60 * 60 * 1000)
  // Go back from today until we find a weekday
  for (let i = 1; i <= 5; i++) {
    const d = new Date(et)
    d.setDate(d.getDate() - i)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) return d.toISOString().slice(0, 10)
  }
  et.setDate(et.getDate() - 1)
  return et.toISOString().slice(0, 10)
}

function subtractYears(date: string, years: number): string {
  const d = new Date(date)
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}
function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size))
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }
function jsonRes(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
