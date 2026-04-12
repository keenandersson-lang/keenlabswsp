import { createClient } from 'npm:@supabase/supabase-js@2'
import { computeSectorIndustryClassification } from '../_shared/classification.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const BENCHMARK_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'IWM'] as const
const POLYGON_API_KEY = Deno.env.get('POLYGON_API_KEY') ?? ''
const STATEMENT_TIMEOUT_MS = '600000'
const ENRICH_BATCH_SIZE = 200
const ENRICH_DELAY_MS = 300

const EXCHANGE_MAP: Record<string, string> = {
  XNYS: 'NYSE', XNAS: 'NASDAQ', XASE: 'AMEX', ARCX: 'ARCA',
  BATS: 'BATS', XNGS: 'NASDAQ', XNCM: 'NASDAQ', XNMS: 'NASDAQ',
  NYSE: 'NYSE', NASDAQ: 'NASDAQ', AMEX: 'AMEX', ARCA: 'ARCA',
}

const TYPE_MAP: Record<string, string> = {
  CS: 'CS', ADRC: 'ADR', ADRR: 'ADR', ADRW: 'ADR',
  ETF: 'ETF', ETN: 'ETF', ETV: 'ETF',
  WARRANT: 'WARRANT', RIGHT: 'RIGHT', UNIT: 'UNIT',
  PFD: 'PFD', FUND: 'FUND', SP: 'SP', BOND: 'BOND',
  OS: 'OS', GDR: 'GDR', NOTE: 'NOTE',
}

const BENCHMARKS_SET = new Set(['SPY','QQQ','DIA','IWM','XLK','XLV','XLF','XLE','XLY','XLI','XLC','XLP','XLB','XLRE','XLU'])
const METALS_SET = new Set(['GLD','SLV','COPX','GDX','PPLT'])

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function classifyPromotion(row: Record<string, unknown>) {
  const symbol = String(row.symbol ?? '').toUpperCase()
  const exchange = String(row.exchange ?? row.primary_exchange ?? '').toUpperCase()
  const isEtf = Boolean(row.is_etf)
  const isAdr = Boolean(row.is_adr)
  const isCommonStock = Boolean(row.is_common_stock)
  const isClassificationEligible = ['canonicalized', 'manually_reviewed'].includes(String(row.classification_status ?? ''))
  const hasClassificationQuality = isClassificationEligible && ['high', 'medium'].includes(String(row.classification_confidence_level ?? ''))

  if (!row.is_active) return { support_level: 'excluded', eligible_for_backfill: false, eligible_for_full_wsp: false }
  if (BENCHMARKS_SET.has(symbol)) return { support_level: 'sector_benchmark_proxy', eligible_for_backfill: true, eligible_for_full_wsp: false }
  if (METALS_SET.has(symbol)) return { support_level: 'metals_limited', eligible_for_backfill: true, eligible_for_full_wsp: false }
  if (isEtf || isAdr) return { support_level: 'data_only', eligible_for_backfill: false, eligible_for_full_wsp: false }

  if (row.support_level === 'full_wsp_equity' && isCommonStock && ['NYSE', 'NASDAQ'].includes(exchange)) {
    return { support_level: 'full_wsp_equity', eligible_for_backfill: true, eligible_for_full_wsp: true }
  }
  if (isCommonStock && hasClassificationQuality && ['NYSE', 'NASDAQ'].includes(exchange)) {
    return { support_level: 'full_wsp_equity', eligible_for_backfill: true, eligible_for_full_wsp: true }
  }
  if (isCommonStock && ['NYSE', 'NASDAQ', 'AMEX', 'ARCA'].includes(exchange)) {
    return { support_level: 'limited_equity', eligible_for_backfill: true, eligible_for_full_wsp: false }
  }
  return { support_level: 'excluded', eligible_for_backfill: false, eligible_for_full_wsp: false }
}


type EdgeRuntimeLike = {
  waitUntil?: (promise: Promise<unknown>) => void
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {
    db: { schema: 'public' },
    global: {
      headers: { 'x-statement-timeout': STATEMENT_TIMEOUT_MS },
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

async function materializeSymbols(symbols: string[], asOfDate: string) {
  const uniqueSymbols = Array.from(new Set(symbols.filter(Boolean)))
  if (uniqueSymbols.length === 0) {
    return { ok: true, skipped: true, reason: 'no_symbols_to_materialize' }
  }
  const { data, error } = await supabase.rpc('materialize_wsp_indicators_from_prices', {
    p_symbols: uniqueSymbols,
    p_as_of_date: asOfDate,
  })
  if (error) return { ok: false, error: error.message, symbols: uniqueSymbols }
  return data ?? { ok: true, symbols: uniqueSymbols }
}

async function updateLog(logId: string, payload: Record<string, unknown>) {
  await supabase.from('data_sync_log').update(payload).eq('id', logId)
}

/**
 * Fetch ALL US stock bars for a single date using Polygon grouped daily endpoint.
 * Returns a Map<symbol, bar> for fast lookup.
 */
async function fetchGroupedDaily(date: string): Promise<{
  bars: Map<string, { o: number; h: number; l: number; c: number; v: number }>
  error?: string
}> {
  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLYGON_API_KEY}`
  let response = await fetch(url)
  if (response.status === 429) {
    console.log('[daily-sync] Rate limited on grouped daily, waiting 15s...')
    await sleep(15_000)
    response = await fetch(url)
  }
  if (!response.ok) {
    return { bars: new Map(), error: `http_${response.status}` }
  }
  const payload = await response.json().catch(() => null)
  const results = payload?.results ?? []
  const barMap = new Map<string, { o: number; h: number; l: number; c: number; v: number }>()
  for (const r of results) {
    if (r.T && typeof r.o === 'number') {
      barMap.set(r.T, { o: r.o, h: r.h, l: r.l, c: r.c, v: r.v })
    }
  }
  return { bars: barMap }
}

/**
 * Fetch a single symbol bar (fallback for symbols missing from grouped response).
 */
async function fetchSingleBar(symbol: string, date: string): Promise<{
  bar: { o: number; h: number; l: number; c: number; v: number } | null
  error?: string
}> {
  const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${date}/${date}?adjusted=true&apiKey=${POLYGON_API_KEY}`
  let response = await fetch(url)
  if (response.status === 429) {
    await sleep(13_000)
    response = await fetch(url)
  }
  if (!response.ok) return { bar: null, error: `http_${response.status}` }
  const payload = await response.json().catch(() => null)
  const r = payload?.results?.[0] ?? null
  if (!r) return { bar: null, error: 'no_results' }
  return { bar: { o: r.o, h: r.h, l: r.l, c: r.c, v: r.v } }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  const validTokens = [
    `Bearer ${Deno.env.get('SYNC_SECRET_KEY')}`,
    `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
  ]
  if (!validTokens.includes(authHeader ?? '')) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' })
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const requestedBy = typeof body.requested_by === 'string' && body.requested_by.trim()
    ? body.requested_by.trim() : 'admin'
  const asOfDate = typeof body.asOfDate === 'string' && body.asOfDate.trim()
    ? body.asOfDate.trim() : getPreviousTradingDay()

  let logId = typeof body.logId === 'string' && body.logId.trim() ? body.logId.trim() : null

  if (!logId) {
    const { data: insertedRow, error: insertError } = await supabase
      .from('data_sync_log')
      .insert({
        sync_type: 'daily_sync',
        status: 'running',
        data_source: 'daily-sync-grouped',
        started_at: new Date().toISOString(),
        metadata: {
          source: 'daily-sync-grouped',
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
    try {
      if (!POLYGON_API_KEY) throw new Error('POLYGON_API_KEY is not configured')

      // 1. Get eligible symbols from DB
      const { data: symbolRows, error: symbolError } = await supabase
        .from('symbols')
        .select('symbol')
        .eq('is_active', true)
        .eq('eligible_for_backfill', true)
        .limit(2000)

      if (symbolError) throw new Error(`Symbol fetch error: ${symbolError.message}`)

      const eligibleSet = new Set((symbolRows ?? []).map((r: { symbol: string }) => r.symbol))
      console.log(`[daily-sync] ${eligibleSet.size} eligible symbols for ${asOfDate}`)

      await updateLog(logId!, {
        status: 'running',
        metadata: {
          source: 'daily-sync-grouped',
          requested_by: requestedBy,
          as_of_date: asOfDate,
          total_eligible: eligibleSet.size,
          step: 'fetching_grouped_daily',
        },
      })

      // 2. Fetch grouped daily — ONE API call for all US stocks
      const { bars: groupedBars, error: groupedError } = await fetchGroupedDaily(asOfDate)
      if (groupedError) {
        console.error(`[daily-sync] Grouped daily fetch failed: ${groupedError}`)
      }
      console.log(`[daily-sync] Grouped daily returned ${groupedBars.size} total tickers`)

      // 3. Filter to eligible symbols and build upsert rows
      const upsertRows: Array<{
        symbol: string; date: string; open: number; high: number;
        low: number; close: number; volume: number; data_source: string
      }> = []
      const matchedSymbols = new Set<string>()
      const missingFromGrouped: string[] = []

      for (const symbol of eligibleSet) {
        const bar = groupedBars.get(symbol)
        if (bar) {
          upsertRows.push({
            symbol,
            date: asOfDate,
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: Math.round(bar.v),
            data_source: 'polygon_grouped',
          })
          matchedSymbols.add(symbol)
        } else {
          missingFromGrouped.push(symbol)
        }
      }

      console.log(`[daily-sync] Matched ${matchedSymbols.size} eligible symbols from grouped. Missing: ${missingFromGrouped.length}`)

      // 4. Fallback: fetch missing benchmark symbols individually (critical for regime)
      const benchmarksMissing = BENCHMARK_SYMBOLS.filter(s => missingFromGrouped.includes(s))
      for (const symbol of benchmarksMissing) {
        const { bar, error } = await fetchSingleBar(symbol, asOfDate)
        if (bar) {
          upsertRows.push({
            symbol,
            date: asOfDate,
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: Math.round(bar.v),
            data_source: 'polygon_single',
          })
          matchedSymbols.add(symbol)
          missingFromGrouped.splice(missingFromGrouped.indexOf(symbol), 1)
        } else {
          console.warn(`[daily-sync] Benchmark ${symbol} fallback failed: ${error}`)
        }
        await sleep(250)
      }

      // 5. Bulk upsert in batches of 500
      let rowsWritten = 0
      let upsertErrors = 0
      const BATCH_SIZE = 500
      for (let i = 0; i < upsertRows.length; i += BATCH_SIZE) {
        const batch = upsertRows.slice(i, i + BATCH_SIZE)
        const { error: upsertError } = await supabase
          .from('daily_prices')
          .upsert(batch, { onConflict: 'symbol,date' })

        if (upsertError) {
          console.error(`[daily-sync] Upsert batch ${i}-${i + batch.length} error: ${upsertError.message}`)
          upsertErrors++
        } else {
          rowsWritten += batch.length
        }
      }

      console.log(`[daily-sync] Upserted ${rowsWritten} rows, ${upsertErrors} batch errors`)

      await updateLog(logId!, {
        status: 'running',
        metadata: {
          source: 'daily-sync-grouped',
          requested_by: requestedBy,
          as_of_date: asOfDate,
          total_eligible: eligibleSet.size,
          step: 'materializing_indicators',
          rows_written: rowsWritten,
          matched_from_grouped: matchedSymbols.size,
          missing_from_grouped: missingFromGrouped.length,
        },
      })

      // 6. Materialize indicators — benchmarks first, then all
      const benchmarkSymbols = BENCHMARK_SYMBOLS.filter(s => matchedSymbols.has(s))
      let benchmarkMat: Record<string, unknown> = { ok: true, skipped: true }
      if (benchmarkSymbols.length > 0) {
        benchmarkMat = await materializeSymbols([...benchmarkSymbols], asOfDate) as Record<string, unknown>
        console.log(`[daily-sync] Benchmark materialization: ${JSON.stringify(benchmarkMat).slice(0, 200)}`)
      }

      // Materialize all written symbols in chunks to avoid statement timeout
      const allWrittenSymbols = Array.from(matchedSymbols)
      const MAT_CHUNK = 200
      let totalMaterialized = 0
      let matErrors = 0
      for (let i = 0; i < allWrittenSymbols.length; i += MAT_CHUNK) {
        const chunk = allWrittenSymbols.slice(i, i + MAT_CHUNK)
        const result = await materializeSymbols(chunk, asOfDate) as Record<string, unknown>
        if (result?.ok === false) {
          matErrors++
          console.error(`[daily-sync] Materialization chunk ${i} error: ${JSON.stringify(result).slice(0, 200)}`)
        } else {
          totalMaterialized += chunk.length
        }
      }

      console.log(`[daily-sync] Materialized indicators for ${totalMaterialized} symbols, ${matErrors} chunk errors`)

      // 7. Auto-enrich unenriched symbols (industry classification)
      let enriched = 0
      let enrichFailed = 0
      const enrichedSymbols: string[] = []
      try {
        const { data: unenriched } = await supabase
          .from('symbols')
          .select('symbol, name, exchange, primary_exchange, sector, industry, sic_code, sic_description, classification_status, classification_confidence_level, asset_class, instrument_type, is_active, is_common_stock, is_etf, is_adr, support_level, canonical_sector, canonical_industry')
          .eq('is_active', true)
          .is('enriched_at', null)
          .order('symbol')
          .limit(ENRICH_BATCH_SIZE)

        if (unenriched && unenriched.length > 0) {
          // Pre-flight: test Polygon quota with a lightweight call before committing
          const probeUrl = `https://api.polygon.io/v3/reference/tickers/AAPL?apiKey=${POLYGON_API_KEY}`
          const probeRes = await fetch(probeUrl).catch(() => null)
          if (!probeRes || probeRes.status === 429) {
            console.log(`[daily-sync] Enrichment pre-flight 429 — Polygon quota exhausted, skipping batch`)
          } else {
            // Wait 1s after probe to respect rate budget
            await sleep(1000)
            console.log(`[daily-sync] Auto-enriching ${unenriched.length} unenriched symbols`)
            for (const sym of unenriched) {
              try {
                const url = `https://api.polygon.io/v3/reference/tickers/${sym.symbol}?apiKey=${POLYGON_API_KEY}`
                const res = await fetch(url)
                if (res.status === 429) {
                  console.log(`[daily-sync] Enrichment rate-limited at ${sym.symbol}, stopping batch`)
                  break
              }
              if (res.status === 404) { continue }
              if (!res.ok) { enrichFailed++; continue }

              const data = await res.json().catch(() => null)
              if (!data?.results) { enrichFailed++; continue }

              const details = data.results
              const rawType = normalizeText(details.type)
              const instrumentType = rawType ? (TYPE_MAP[rawType] ?? rawType) : null
              const isEtf = instrumentType === 'ETF'
              const isAdr = instrumentType === 'ADR'
              const isCommonStock = instrumentType === 'CS'
              const rawExchange = normalizeText(details.primary_exchange ?? details.exchange)
              const normalizedExchange = rawExchange ? (EXCHANGE_MAP[rawExchange] ?? rawExchange) : null
              const sicCode = normalizeText(details.sic_code)
              const sicDesc = normalizeText(details.sic_description)
              const companyName = normalizeText(details.name)

              const classification = computeSectorIndustryClassification({
                symbol: sym.symbol,
                rawSector: normalizeText(details.market ?? details.sector) || sym.sector,
                rawIndustry: normalizeText(details.industry) || normalizeText(sicDesc) || sym.industry,
                sector: sym.sector,
                industry: sym.industry,
                sicCode,
                sicDescription: sicDesc,
                exchange: normalizedExchange || sym.exchange,
                primaryExchange: normalizedExchange || sym.primary_exchange,
                instrumentType: instrumentType || sym.instrument_type,
                isEtf: isEtf || sym.is_etf,
                isAdr: isAdr || sym.is_adr,
                isCommonStock: isCommonStock || sym.is_common_stock,
              })

              const update: Record<string, unknown> = {
                enriched_at: new Date().toISOString(),
                canonical_sector: classification.canonicalSector ?? 'Unknown',
                canonical_industry: classification.canonicalIndustry ?? 'Unknown',
                classification_confidence_level: classification.confidenceLevel,
                classification_status: classification.classificationStatus,
                sector: classification.canonicalSector ?? sym.sector ?? 'Unknown',
                industry: classification.canonicalIndustry ?? sym.industry,
                is_common_stock: isCommonStock || sym.is_common_stock || false,
                is_etf: isEtf || sym.is_etf || false,
                is_adr: isAdr || sym.is_adr || false,
              }

              if (normalizedExchange) update.primary_exchange = normalizedExchange
              if (instrumentType) update.instrument_type = instrumentType
              if (sicCode) update.sic_code = sicCode
              if (sicDesc) update.sic_description = sicDesc
              if (companyName && !sym.name) update.name = companyName

              const promotion = classifyPromotion({ ...sym, ...update })
              update.support_level = promotion.support_level
              update.eligible_for_backfill = promotion.eligible_for_backfill
              update.eligible_for_full_wsp = promotion.eligible_for_full_wsp

              await supabase.from('symbols').update(update).eq('symbol', sym.symbol)
              enriched++
              enrichedSymbols.push(sym.symbol)
              await sleep(ENRICH_DELAY_MS)
            } catch {
              enrichFailed++
            }
          }
          console.log(`[daily-sync] Auto-enriched ${enriched} symbols, ${enrichFailed} failed`)
          } // end pre-flight else
        }
      } catch (enrichErr) {
        console.error(`[daily-sync] Auto-enrich step error: ${String(enrichErr).slice(0, 200)}`)
      }

      const finalStatus = upsertErrors === 0 && matErrors === 0 ? 'success'
        : rowsWritten > 0 ? 'partial' : 'error'

      await updateLog(logId!, {
        status: finalStatus,
        completed_at: new Date().toISOString(),
        symbols_processed: rowsWritten,
        symbols_failed: missingFromGrouped.length,
        error_message: upsertErrors > 0 || matErrors > 0
          ? `upsert_errors:${upsertErrors}, mat_errors:${matErrors}`
          : null,
        metadata: {
          source: 'daily-sync-grouped',
          requested_by: requestedBy,
          as_of_date: asOfDate,
          total_eligible: eligibleSet.size,
          grouped_api_tickers: groupedBars.size,
          matched_from_grouped: matchedSymbols.size,
          missing_from_grouped: missingFromGrouped.length,
          missing_symbols_sample: missingFromGrouped.slice(0, 30),
          rows_written: rowsWritten,
          upsert_errors: upsertErrors,
          total_materialized: totalMaterialized,
          mat_errors: matErrors,
          benchmark_materialization: benchmarkMat,
          auto_enriched: enriched,
          auto_enrich_failed: enrichFailed,
          auto_enriched_symbols: enrichedSymbols.slice(0, 20),
          elapsed_ms: Date.now() - startedAt,
        },
      })
    } catch (error) {
      await updateLog(logId!, {
        status: 'error',
        completed_at: new Date().toISOString(),
        error_message: String(error).slice(0, 500),
        metadata: {
          source: 'daily-sync-grouped',
          requested_by: requestedBy,
          as_of_date: asOfDate,
          step: 'background_execution',
        },
      })
    }
  })()

  const edgeRuntime = (globalThis as typeof globalThis & { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(backgroundSync)
  } else {
    await backgroundSync
  }

  return jsonResponse(202, {
    ok: true,
    queued: true,
    logId,
    asOfDate,
    message: 'Daily sync (grouped mode) accepted and running in background.',
  })
})
