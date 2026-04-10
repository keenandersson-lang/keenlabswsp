import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const BENCHMARK_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'IWM'] as const
const POLYGON_API_KEY = Deno.env.get('POLYGON_API_KEY') ?? ''
const MAX_EXECUTION_MS = 9 * 60 * 1000
const STATEMENT_TIMEOUT_MS = '600000'

type EdgeRuntimeLike = {
  waitUntil?: (promise: Promise<unknown>) => void
}

type BenchmarkStatus = {
  included: boolean
  fetched: boolean
  upserted: boolean
  error: string | null
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {
    db: {
      schema: 'public',
    },
    global: {
      headers: {
        'x-statement-timeout': STATEMENT_TIMEOUT_MS,
      },
    },
  }
)

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getPreviousTradingDay() {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - 1)

  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1)
  }

  return date.toISOString().slice(0, 10)
}

/** Return all trading days (Mon-Fri) between two dates, exclusive of both endpoints */
function getTradingDaysBetween(fromDate: string, toDate: string): string[] {
  const dates: string[] = []
  const start = new Date(fromDate + 'T00:00:00Z')
  const end = new Date(toDate + 'T00:00:00Z')
  const cursor = new Date(start)
  cursor.setUTCDate(cursor.getUTCDate() + 1) // start from day after fromDate

  while (cursor < end) {
    const dow = cursor.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      dates.push(cursor.toISOString().slice(0, 10))
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

/** Fetch and upsert a single bar for a symbol on a given date. Returns true if bar written. */
async function fetchAndUpsertBar(symbol: string, date: string): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${date}/${date}?adjusted=true&apiKey=${POLYGON_API_KEY}`
  let response = await fetch(url)
  if (response.status === 429) {
    await sleep(13_000)
    response = await fetch(url)
  }
  if (!response.ok) return { ok: false, error: `http_${response.status}` }

  const payload = await response.json().catch(() => null)
  const bar = payload?.results?.[0] ?? null
  if (!bar) return { ok: false, error: 'no_results' }

  const { error: upsertError } = await supabase
    .from('daily_prices')
    .upsert({
      symbol,
      date,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: Math.round(bar.v),
      data_source: 'polygon',
    }, { onConflict: 'symbol,date' })

  if (upsertError) return { ok: false, error: `upsert:${upsertError.message}` }
  return { ok: true }
}

/** Detect and fill benchmark date gaps. Returns summary. */
async function fillBenchmarkGaps(asOfDate: string): Promise<{
  gapDates: string[]
  filled: number
  errors: string[]
}> {
  // Find the latest date each benchmark has in daily_prices
  const { data: latestRows } = await supabase
    .from('daily_prices')
    .select('symbol, date')
    .in('symbol', [...BENCHMARK_SYMBOLS])
    .order('date', { ascending: false })
    .limit(4 * 30) // enough to cover each symbol's latest

  const latestBySymbol: Record<string, string> = {}
  for (const row of latestRows ?? []) {
    if (!latestBySymbol[row.symbol]) {
      latestBySymbol[row.symbol] = row.date
    }
  }

  // Find the oldest "latest date" across benchmarks — that's where the gap starts
  const latestDates = BENCHMARK_SYMBOLS.map(s => latestBySymbol[s]).filter(Boolean)
  if (latestDates.length === 0) return { gapDates: [], filled: 0, errors: ['no_benchmark_data_at_all'] }

  const oldestLatest = latestDates.sort()[0] // earliest of the latest dates
  const gapDates = getTradingDaysBetween(oldestLatest, asOfDate)

  if (gapDates.length === 0) return { gapDates: [], filled: 0, errors: [] }

  let filled = 0
  const errors: string[] = []

  for (const gapDate of gapDates) {
    for (const symbol of BENCHMARK_SYMBOLS) {
      // Skip if this symbol already has data for this date
      if (latestBySymbol[symbol] && latestBySymbol[symbol] >= gapDate) continue

      const result = await fetchAndUpsertBar(symbol, gapDate)
      if (result.ok) {
        filled++
      } else {
        errors.push(`${symbol}:${gapDate}:${result.error}`)
      }
      await sleep(250) // rate limit courtesy
    }
  }

  return { gapDates, filled, errors }
}

function normalizeRequestedSymbols(value: unknown) {
  if (!Array.isArray(value)) return null

  const normalized = value
    .map((symbol) => (typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''))
    .filter(Boolean)

  return normalized.length > 0 ? Array.from(new Set(normalized)) : null
}

async function materializeSymbols(symbols: string[], asOfDate: string) {
  const uniqueSymbols = Array.from(new Set(symbols.filter(Boolean)))
  if (uniqueSymbols.length === 0) {
    return { ok: true, skipped: true, reason: 'no_symbols_to_materialize' }
  }

  const { data, error } = await supabase.rpc('materialize_wsp_indicators_from_prices', {
    p_symbols: uniqueSymbols,
    p_as_of_date: asOfDate,
  })

  if (error) {
    return { ok: false, error: error.message, symbols: uniqueSymbols }
  }

  return data ?? { ok: true, symbols: uniqueSymbols }
}

async function updateLog(logId: string, payload: Record<string, unknown>) {
  await supabase
    .from('data_sync_log')
    .update(payload)
    .eq('id', logId)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${Deno.env.get('SYNC_SECRET_KEY')}`) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' })
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const requestedBy = typeof body.requested_by === 'string' && body.requested_by.trim()
    ? body.requested_by.trim()
    : 'admin'
  const asOfDate = typeof body.asOfDate === 'string' && body.asOfDate.trim()
    ? body.asOfDate.trim()
    : getPreviousTradingDay()

  let logId = typeof body.logId === 'string' && body.logId.trim() ? body.logId.trim() : null

  if (!logId) {
    const { data: insertedRow, error: insertError } = await supabase
      .from('data_sync_log')
      .insert({
        sync_type: 'daily_sync',
        status: 'running',
        data_source: 'daily-sync',
        started_at: new Date().toISOString(),
        metadata: {
          source: 'daily-sync',
          execution_mode: 'background_waitUntil',
          dispatch_status: 'accepted',
          requested_by: requestedBy,
          as_of_date: asOfDate,
        },
      })
      .select('id')
      .single()

    if (insertError || !insertedRow?.id) {
      return jsonResponse(500, { ok: false, error: insertError?.message ?? 'Failed to create sync log row' })
    }

    logId = insertedRow.id
  }

  const backgroundSync = (async () => {
    const startedAt = Date.now()
    const requestedSymbols = normalizeRequestedSymbols(body.symbols)
    const benchmarkSet = new Set(BENCHMARK_SYMBOLS)

    const benchmarkStatus = Object.fromEntries(
      BENCHMARK_SYMBOLS.map((symbol) => [
        symbol,
        { included: false, fetched: false, upserted: false, error: null } satisfies BenchmarkStatus,
      ])
    ) as Record<string, BenchmarkStatus>

    try {
      if (!POLYGON_API_KEY) {
        throw new Error('POLYGON_API_KEY is not configured')
      }

      let symbolQuery = supabase
        .from('symbols')
        .select('symbol')
        .eq('is_active', true)
        .eq('eligible_for_backfill', true)
        .limit(2000)

      if (requestedSymbols && requestedSymbols.length > 0) {
        symbolQuery = symbolQuery.in('symbol', requestedSymbols)
      }

      const { data: symbols, error: symbolError } = await symbolQuery
      if (symbolError) {
        throw new Error(`Symbol fetch error: ${symbolError.message}`)
      }

      const rawSymbols = Array.from(new Set((symbols ?? []).map((row: { symbol: string }) => row.symbol)))
      const prioritizedSymbols = [
        ...BENCHMARK_SYMBOLS.filter((symbol) => rawSymbols.includes(symbol)),
        ...rawSymbols.filter((symbol) => !benchmarkSet.has(symbol as (typeof BENCHMARK_SYMBOLS)[number])),
      ]

      BENCHMARK_SYMBOLS.forEach((symbol) => {
        benchmarkStatus[symbol].included = prioritizedSymbols.includes(symbol)
      })

      await updateLog(logId!, {
        status: 'running',
        data_source: 'daily-sync',
        metadata: {
          source: 'daily-sync',
          execution_mode: 'background_waitUntil',
          dispatch_status: 'accepted',
          requested_by: requestedBy,
          as_of_date: asOfDate,
          total_symbols: prioritizedSymbols.length,
          benchmark_priority: true,
          requested_symbols: requestedSymbols,
        },
      })

      if (prioritizedSymbols.length === 0) {
        await updateLog(logId!, {
          status: 'success',
          completed_at: new Date().toISOString(),
          symbols_processed: 0,
          symbols_failed: 0,
          metadata: {
            source: 'daily-sync',
            execution_mode: 'background_waitUntil',
            dispatch_status: 'accepted',
            requested_by: requestedBy,
            as_of_date: asOfDate,
            total_symbols: 0,
            message: 'No eligible symbols found',
            benchmark_status: benchmarkStatus,
          },
        })
        return
      }

      let symbolsFetched = 0
      let symbolsFailed = 0
      let rowsWritten = 0
      let timedOut = false
      const errors: string[] = []
      const writtenSymbols = new Set<string>()
      const benchmarkWrittenSymbols = new Set<string>()
      const includedBenchmarks = BENCHMARK_SYMBOLS.filter((symbol) => prioritizedSymbols.includes(symbol))
      let benchmarkMaterialization: Record<string, unknown> = { ok: true, skipped: includedBenchmarks.length === 0 }
      let benchmarkMaterialized = includedBenchmarks.length === 0

      for (let index = 0; index < prioritizedSymbols.length; index += 1) {
        if (Date.now() - startedAt >= MAX_EXECUTION_MS) {
          timedOut = true
          errors.push(`execution_window_reached_after_${index}_symbols`)
          break
        }

        const symbol = prioritizedSymbols[index]
        const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${asOfDate}/${asOfDate}?adjusted=true&apiKey=${POLYGON_API_KEY}`

        try {
          let response = await fetch(url)

          if (response.status === 429) {
            await sleep(13_000)
            response = await fetch(url)
          }

          if (!response.ok) {
            symbolsFailed += 1
            const errorCode = `http_${response.status}`
            errors.push(`${symbol}:${errorCode}`)
            if (benchmarkSet.has(symbol as (typeof BENCHMARK_SYMBOLS)[number])) {
              benchmarkStatus[symbol].error = errorCode
            }
          } else {
            const payload = await response.json().catch(() => null)
            const bar = payload?.results?.[0] ?? null

            if (!bar) {
              symbolsFailed += 1
              errors.push(`${symbol}:no_results`)
              if (benchmarkSet.has(symbol as (typeof BENCHMARK_SYMBOLS)[number])) {
                benchmarkStatus[symbol].error = 'no_results'
              }
            } else {
              if (benchmarkSet.has(symbol as (typeof BENCHMARK_SYMBOLS)[number])) {
                benchmarkStatus[symbol].fetched = true
              }

              const { error: upsertError } = await supabase
                .from('daily_prices')
                .upsert({
                  symbol,
                  date: asOfDate,
                  open: bar.o,
                  high: bar.h,
                  low: bar.l,
                  close: bar.c,
                  volume: Math.round(bar.v),
                  data_source: 'polygon',
                }, { onConflict: 'symbol,date' })

              if (upsertError) {
                symbolsFailed += 1
                errors.push(`${symbol}:upsert_error:${upsertError.message}`)
                if (benchmarkSet.has(symbol as (typeof BENCHMARK_SYMBOLS)[number])) {
                  benchmarkStatus[symbol].error = `upsert_error:${upsertError.message}`
                }
              } else {
                symbolsFetched += 1
                rowsWritten += 1
                writtenSymbols.add(symbol)

                if (benchmarkSet.has(symbol as (typeof BENCHMARK_SYMBOLS)[number])) {
                  benchmarkStatus[symbol].upserted = true
                  benchmarkWrittenSymbols.add(symbol)
                }
              }
            }
          }
        } catch (error) {
          symbolsFailed += 1
          const message = String(error).slice(0, 160)
          errors.push(`${symbol}:${message}`)
          if (benchmarkSet.has(symbol as (typeof BENCHMARK_SYMBOLS)[number])) {
            benchmarkStatus[symbol].error = message
          }
        }

        if (!benchmarkMaterialized && index + 1 >= includedBenchmarks.length) {
          benchmarkMaterialization = await materializeSymbols(Array.from(benchmarkWrittenSymbols), asOfDate) as Record<string, unknown>
          benchmarkMaterialized = true
        }
      }

      if (!benchmarkMaterialized) {
        benchmarkMaterialization = await materializeSymbols(Array.from(benchmarkWrittenSymbols), asOfDate) as Record<string, unknown>
      }

      const finalMaterialization = await materializeSymbols(Array.from(writtenSymbols), asOfDate) as Record<string, unknown>
      const materializationOk = finalMaterialization?.ok !== false && benchmarkMaterialization?.ok !== false

      const finalStatus = timedOut
        ? 'partial'
        : symbolsFailed === 0 && materializationOk
          ? 'success'
          : rowsWritten > 0 || symbolsFetched > 0
            ? 'partial'
            : 'error'

      await updateLog(logId!, {
        status: finalStatus,
        completed_at: new Date().toISOString(),
        symbols_processed: symbolsFetched,
        symbols_failed: symbolsFailed,
        error_message: errors.slice(0, 10).join('\n') || (materializationOk ? null : JSON.stringify({ benchmarkMaterialization, finalMaterialization }).slice(0, 500)),
        metadata: {
          source: 'daily-sync',
          execution_mode: 'background_waitUntil',
          dispatch_status: 'accepted',
          requested_by: requestedBy,
          as_of_date: asOfDate,
          total_symbols: prioritizedSymbols.length,
          symbols_fetched: symbolsFetched,
          rows_written: rowsWritten,
          timed_out: timedOut,
          benchmark_priority: true,
          benchmark_status: benchmarkStatus,
          benchmark_materialization: benchmarkMaterialization,
          final_materialization: finalMaterialization,
          written_symbols_sample: Array.from(writtenSymbols).slice(0, 50),
          elapsed_ms: Date.now() - startedAt,
        },
      })
    } catch (error) {
      await updateLog(logId!, {
        status: 'error',
        completed_at: new Date().toISOString(),
        error_message: String(error).slice(0, 500),
        metadata: {
          source: 'daily-sync',
          execution_mode: 'background_waitUntil',
          dispatch_status: 'accepted',
          requested_by: requestedBy,
          as_of_date: asOfDate,
          benchmark_status: benchmarkStatus,
          step: 'background_execution',
        },
      })
    }
  })()

  const edgeRuntime = (globalThis as typeof globalThis & { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(backgroundSync)
  } else {
    // Fallback: await inline (blocks response but ensures completion)
    await backgroundSync
  }

  return jsonResponse(202, {
    ok: true,
    queued: true,
    logId,
    asOfDate,
    message: 'Daily sync accepted and running in background.',
  })
})