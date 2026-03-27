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

type FailureCategory =
  | 'no_polygon_data_returned'
  | 'invalid_incompatible_symbol_format'
  | 'delisted_inactive_symbol'
  | 'transform_parsing_failure'
  | 'database_insert_upsert_failure'
  | 'other_provider_api_error'

type FailureDetail = {
  symbol: string
  category: FailureCategory
  reason: string
}

const categoryLabels: Record<FailureCategory, string> = {
  no_polygon_data_returned: 'no Polygon data returned',
  invalid_incompatible_symbol_format: 'invalid/incompatible symbol format',
  delisted_inactive_symbol: 'delisted/inactive symbol',
  transform_parsing_failure: 'transform/parsing failure',
  database_insert_upsert_failure: 'database insert/upsert failure',
  other_provider_api_error: 'other provider/API error',
}

const retryPolicyByCategory: Record<FailureCategory, { retries: number; action: 'skip' | 'retry_then_skip' }> = {
  no_polygon_data_returned: { retries: 0, action: 'skip' },
  invalid_incompatible_symbol_format: { retries: 0, action: 'skip' },
  delisted_inactive_symbol: { retries: 0, action: 'skip' },
  transform_parsing_failure: { retries: 1, action: 'retry_then_skip' },
  database_insert_upsert_failure: { retries: 2, action: 'retry_then_skip' },
  other_provider_api_error: { retries: 2, action: 'retry_then_skip' },
}

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
  const { yearsBack = 5, symbols: specificSymbols, batchSize = 20, offset = 0 } = body

  const endDate = getYesterdayNYT()
  const startDate = subtractYears(endDate, yearsBack)

  // Get symbols to backfill — filter by V1 contract eligibility
  let symbolsToProcess: string[]
  if (specificSymbols?.length) {
    symbolsToProcess = specificSymbols
  } else {
    // Fetch batch of active symbols with valid format (no dots/slashes/spaces)
    const { data, error: fetchErr } = await supabase
      .from('symbols')
      .select('symbol, exchange, sector, industry, asset_class, is_active')
      .eq('is_active', true)
      .order('symbol')
      .range(offset, offset + batchSize - 1)

    if (fetchErr) {
      return jsonRes({ error: `Symbol fetch error: ${fetchErr.message}` })
    }

    // Apply V1 contract: exclude invalid symbol formats, keep only backfill-eligible
    symbolsToProcess = (data ?? [])
      .filter((r: any) => {
        const sym = (r.symbol ?? '').toUpperCase()
        // Exclude invalid formats (dots, slashes, spaces, >5 chars)
        if (sym.length === 0 || sym.length > 5) return false
        if (/[^A-Z0-9]/.test(sym)) return false
        return true
      })
      .map((r: any) => r.symbol)
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
  const failureDetails: FailureDetail[] = []
  const failureCounts: Record<FailureCategory, number> = {
    no_polygon_data_returned: 0,
    invalid_incompatible_symbol_format: 0,
    delisted_inactive_symbol: 0,
    transform_parsing_failure: 0,
    database_insert_upsert_failure: 0,
    other_provider_api_error: 0,
  }
  const retriesByCategory: Record<FailureCategory, number> = {
    no_polygon_data_returned: 0,
    invalid_incompatible_symbol_format: 0,
    delisted_inactive_symbol: 0,
    transform_parsing_failure: 0,
    database_insert_upsert_failure: 0,
    other_provider_api_error: 0,
  }

  const recordFailure = (symbol: string, category: FailureCategory, rawReason: string) => {
    const reason = safeReason(rawReason)
    failed++
    failureCounts[category]++
    failureDetails.push({ symbol, category, reason })
    errors.push(`${symbol}: ${categoryLabels[category]}: ${reason}`)
    console.error(
      `[BACKFILL_FAILURE] symbol=${symbol} category=${category} policy=${retryPolicyByCategory[category].action}/${retryPolicyByCategory[category].retries} reason=${reason}`
    )
  }

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

      const bars = await fetchPolygonBarsWithRetry(symbol, startDate, endDate, retriesByCategory)

      // Save in batches of 500
      const batches = chunkArray(bars, 500)
      let symbolFailed = false
      for (const batch of batches) {
        let upsertAttempt = 0
        let upsertSucceeded = false
        const upsertMaxAttempts = retryPolicyByCategory.database_insert_upsert_failure.retries + 1
        while (upsertAttempt < upsertMaxAttempts && !upsertSucceeded) {
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

          if (!upsertErr) {
            upsertSucceeded = true
            break
          }

          upsertAttempt++
          if (upsertAttempt < upsertMaxAttempts) {
            retriesByCategory.database_insert_upsert_failure++
            console.warn(
              `[BACKFILL_RETRY] symbol=${symbol} category=database_insert_upsert_failure attempt=${upsertAttempt}/${upsertMaxAttempts - 1} reason=${safeReason(upsertErr.message)}`
            )
            await sleep(1000 * upsertAttempt)
            continue
          }

          symbolFailed = true
          recordFailure(symbol, 'database_insert_upsert_failure', upsertErr.message)
          break
        }

        if (symbolFailed) break
      }

      if (symbolFailed) {
        continue
      }

      fetched++

      // Rate limiting: 5 req/min on free tier
      await sleep(2000)
    } catch (err) {
      const { category, reason } = classifyBackfillError(err)
      recordFailure(symbol, category, reason)
    }
  }

  const topFailureCategories = Object.entries(failureCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, label: categoryLabels[category as FailureCategory], count }))

  // Update log
  await supabase
    .from('data_sync_log')
    .update({
      status: failed === 0 ? 'success' : 'partial',
      symbols_processed: fetched,
      symbols_failed: failed,
      completed_at: new Date().toISOString(),
      error_message: errors.slice(0, 10).join('\n') || null,
      metadata: {
        symbols_total: symbolsToProcess.length,
        years_back: yearsBack,
        offset,
        batch_size: batchSize,
        failure_counts: failureCounts,
        retries_by_category: retriesByCategory,
        top_failure_categories: topFailureCategories.slice(0, 3),
      },
    })
    .eq('id', logRow?.id)

  const nextOffset = offset + batchSize
  return jsonRes({
    ok: true,
    fetched,
    failed,
    successRate: symbolsToProcess.length ? Number(((fetched / symbolsToProcess.length) * 100).toFixed(2)) : 0,
    symbolsAttempted: symbolsToProcess.length,
    offset,
    nextOffset,
    hasMore: symbolsToProcess.length === batchSize,
    failureCounts,
    topFailureCategories,
    retryPolicyByCategory,
    retriesByCategory,
    failedSymbols: failureDetails,
    errors: errors.slice(0, 20),
  })
})

async function fetchPolygonBarsWithRetry(
  symbol: string,
  start: string,
  end: string,
  retriesByCategory: Record<FailureCategory, number>,
) {
  let attempt = 0
  let currentMaxRetries = retryPolicyByCategory.other_provider_api_error.retries

  while (attempt <= currentMaxRetries) {
    try {
      return await fetchPolygonBars(symbol, start, end)
    } catch (err) {
      const { category, reason } = classifyBackfillError(err)
      currentMaxRetries = retryPolicyByCategory[category].retries
      if (attempt < currentMaxRetries) {
        attempt++
        retriesByCategory[category]++
        console.warn(
          `[BACKFILL_RETRY] symbol=${symbol} category=${category} attempt=${attempt}/${currentMaxRetries} reason=${safeReason(reason)}`
        )
        await sleep(1000 * attempt)
        continue
      }

      throw new Error(JSON.stringify({ category, reason }))
    }
  }

  throw new Error(JSON.stringify({ category: 'other_provider_api_error', reason: 'retry loop exhausted unexpectedly' }))
}

async function fetchPolygonBars(symbol: string, start: string, end: string) {
  const bars: any[] = []
  let url: string | null =
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${start}/${end}?adjusted=true&sort=asc&limit=50000&apiKey=${POLYGON_KEY}`

  while (url) {
    const res = await fetch(url)
    if (!res.ok) {
      if (res.status === 429) {
        throw new Error(JSON.stringify({ category: 'other_provider_api_error', reason: 'polygon rate-limited (429)' }))
      }
      const rawText = await res.text().catch(() => '')
      if (res.status === 400) {
        throw new Error(JSON.stringify({
          category: 'invalid_incompatible_symbol_format',
          reason: `polygon 400 for ticker ${symbol}: ${safeReason(rawText)}`,
        }))
      }
      if (res.status === 404) {
        throw new Error(JSON.stringify({
          category: 'delisted_inactive_symbol',
          reason: `polygon 404 for ticker ${symbol}: ${safeReason(rawText)}`,
        }))
      }
      throw new Error(JSON.stringify({
        category: 'other_provider_api_error',
        reason: `polygon ${res.status}: ${safeReason(rawText)}`,
      }))
    }
    const data = await res.json().catch((err) => {
      throw new Error(JSON.stringify({
        category: 'transform_parsing_failure',
        reason: `polygon json parse error: ${safeReason(String(err))}`,
      }))
    })

    if (data?.status === 'ERROR') {
      throw new Error(JSON.stringify({
        category: 'other_provider_api_error',
        reason: `polygon status error: ${safeReason(data?.error ?? data?.message ?? 'unknown error')}`,
      }))
    }

    if (data?.status === 'NOT_FOUND') {
      throw new Error(JSON.stringify({
        category: 'delisted_inactive_symbol',
        reason: `polygon status not found for ${symbol}`,
      }))
    }

    if (data?.status === 'OK' && (!Array.isArray(data.results) || data.results.length === 0)) {
      throw new Error(JSON.stringify({
        category: 'no_polygon_data_returned',
        reason: `polygon returned no aggregate results for ${symbol}`,
      }))
    }

    if (data.results) {
      for (const r of data.results) {
        const date = new Date(r.t).toISOString().slice(0, 10)
        const open = Number(r.o)
        const high = Number(r.h)
        const low = Number(r.l)
        const close = Number(r.c)
        const volume = Number(r.v)

        if (!date || Number.isNaN(open) || Number.isNaN(high) || Number.isNaN(low) || Number.isNaN(close) || Number.isNaN(volume)) {
          throw new Error(JSON.stringify({
            category: 'transform_parsing_failure',
            reason: `invalid bar shape for ${symbol}`,
          }))
        }

        bars.push({ date, open, high, low, close, volume: Math.round(volume) })
      }
    }
    url = data.next_url ? `${data.next_url}&apiKey=${POLYGON_KEY}` : null
  }
  return bars
}

function classifyBackfillError(err: unknown): { category: FailureCategory; reason: string } {
  const fallback = {
    category: 'other_provider_api_error' as FailureCategory,
    reason: safeReason(String(err)),
  }

  if (!err) return fallback

  const message = typeof err === 'string'
    ? err
    : err instanceof Error
      ? err.message
      : JSON.stringify(err)

  try {
    const parsed = JSON.parse(message)
    if (parsed?.category && parsed?.reason && categoryLabels[parsed.category as FailureCategory]) {
      return {
        category: parsed.category as FailureCategory,
        reason: safeReason(String(parsed.reason)),
      }
    }
  } catch {
    // no-op, we'll classify by message text below
  }

  const lower = message.toLowerCase()
  if (lower.includes('no aggregate results') || lower.includes('no data')) {
    return { category: 'no_polygon_data_returned', reason: safeReason(message) }
  }
  if (lower.includes('invalid') || lower.includes('malformed') || lower.includes('ticker')) {
    return { category: 'invalid_incompatible_symbol_format', reason: safeReason(message) }
  }
  if (lower.includes('not found') || lower.includes('delisted') || lower.includes('inactive')) {
    return { category: 'delisted_inactive_symbol', reason: safeReason(message) }
  }
  if (lower.includes('parse') || lower.includes('json') || lower.includes('transform')) {
    return { category: 'transform_parsing_failure', reason: safeReason(message) }
  }
  if (lower.includes('upsert') || lower.includes('insert') || lower.includes('duplicate key') || lower.includes('constraint')) {
    return { category: 'database_insert_upsert_failure', reason: safeReason(message) }
  }
  return fallback
}

function safeReason(raw: string) {
  return raw.replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '').slice(0, 240)
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
