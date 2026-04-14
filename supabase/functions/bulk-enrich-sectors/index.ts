import { createClient } from 'npm:@supabase/supabase-js@2'
import { computeSectorIndustryClassification } from '../_shared/classification.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const POLYGON_KEY = Deno.env.get('POLYGON_API_KEY')!
const TEMP_DEBUG_SYNC_KEY = 'wsp_sync_test_2026_april_13'

const MAX_EXECUTION_MS = 55_000
const BETWEEN_SYMBOL_MS = 250
const INITIAL_BACKOFF_MS = 13_500
const MAX_CONSECUTIVE_429 = 3
const DB_BATCH_SIZE = 50

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

const BENCHMARKS = new Set(['SPY','QQQ','DIA','IWM','XLK','XLV','XLF','XLE','XLY','XLI','XLC','XLP','XLB','XLRE','XLU'])
const METALS = new Set(['GLD','SLV','COPX','GDX','PPLT'])

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function classifyPromotion(row: Record<string, any>) {
  const symbol = String(row.symbol ?? '').toUpperCase()
  const exchange = String(row.exchange ?? row.primary_exchange ?? '').toUpperCase()
  const isEtf = Boolean(row.is_etf)
  const isAdr = Boolean(row.is_adr)
  const isCommonStock = Boolean(row.is_common_stock)
  const isClassificationEligible = ['canonicalized', 'manually_reviewed'].includes(String(row.classification_status ?? ''))
  const hasClassificationQuality = isClassificationEligible && ['high', 'medium'].includes(String(row.classification_confidence_level ?? ''))

  if (!row.is_active) return { support_level: 'excluded', eligible_for_backfill: false, eligible_for_full_wsp: false }
  if (BENCHMARKS.has(symbol)) return { support_level: 'sector_benchmark_proxy', eligible_for_backfill: true, eligible_for_full_wsp: false }
  if (METALS.has(symbol)) return { support_level: 'metals_limited', eligible_for_backfill: true, eligible_for_full_wsp: false }
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

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now()

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const providedToken = authHeader.replace('Bearer ', '')
    const syncKey = Deno.env.get('SYNC_SECRET_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    let isAuthorized = providedToken === syncKey || providedToken === serviceKey || providedToken === TEMP_DEBUG_SYNC_KEY

    if (!isAuthorized && authHeader.startsWith('Bearer ')) {
      const authClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      , { global: { headers: { Authorization: authHeader } } })
      const { data } = await authClient.auth.getUser()
      if (data?.user) isAuthorized = true
    }

    if (!isAuthorized) {
      return jsonRes({ error: 'Unauthorized' }, 401)
    }

    const body = await req.json().catch(() => ({})) as Record<string, any>
    const offset = Number(body.offset ?? 0)
    const maxSymbols = Number(body.maxSymbols ?? 15)

    // Fetch symbols missing canonical_sector
    const { data: symbols, error: fetchErr } = await supabase
      .from('symbols')
      .select('symbol, name, exchange, primary_exchange, sector, industry, sic_code, sic_description, classification_status, classification_confidence_level, asset_class, instrument_type, is_active, is_common_stock, is_etf, is_adr, support_level, enriched_at, canonical_sector, canonical_industry')
      .eq('is_active', true)
      .or('canonical_sector.is.null,canonical_sector.eq.Unknown,canonical_sector.eq.,canonical_sector.eq.Stocks')
      .order('symbol')
      .range(offset, offset + DB_BATCH_SIZE - 1)

    if (fetchErr) return jsonRes({ ok: false, error: fetchErr.message }, 500)

    if (!symbols || symbols.length === 0) {
      return jsonRes({
        ok: true, done: true,
        message: 'No more symbols with missing sectors.',
        offset, enriched: 0, remaining: 0,
      })
    }

    // Count total remaining for progress
    const { count: totalRemaining } = await supabase
      .from('symbols')
      .select('symbol', { count: 'exact', head: true })
      .eq('is_active', true)
      .or('canonical_sector.is.null,canonical_sector.eq.Unknown,canonical_sector.eq.,canonical_sector.eq.Stocks')

    // Log sync start
    const { data: logRow } = await supabase
      .from('data_sync_log')
      .insert({
        sync_type: 'bulk_enrich_sectors',
        status: 'running',
        data_source: 'polygon_ticker_details',
        metadata: { offset, db_batch: DB_BATCH_SIZE, max_symbols: maxSymbols, candidates: symbols.length, total_remaining: totalRemaining },
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    let enriched = 0
    let skipped = 0
    let failed = 0
    let promoted = 0
    let rateLimited = 0
    let consecutive429 = 0
    let timedOut = false
    let rateLimitAbort = false
    const errors: string[] = []
    const promotions: string[] = []
    const enrichedSymbols: string[] = []

    for (const sym of symbols) {
      if (Date.now() - startedAt >= MAX_EXECUTION_MS) { timedOut = true; break }
      if (enriched + failed >= maxSymbols) { timedOut = true; break }

      // If we hit too many consecutive 429s, stop early with a clear message
      if (consecutive429 >= MAX_CONSECUTIVE_429) {
        rateLimitAbort = true
        errors.push(`Stopped: ${MAX_CONSECUTIVE_429} consecutive rate-limit errors — Polygon API quota likely exhausted for this window`)
        break
      }

      try {
        const url = `https://api.polygon.io/v3/reference/tickers/${sym.symbol}?apiKey=${POLYGON_KEY}`
        let res = await fetch(url)

        if (res.status === 429) {
          rateLimited++
          consecutive429++
          const backoffMs = INITIAL_BACKOFF_MS * consecutive429 // escalating backoff
          console.log(`[bulk-enrich] 429 for ${sym.symbol}, backoff ${backoffMs}ms (consecutive: ${consecutive429})`)
          await sleep(backoffMs)
          if (Date.now() - startedAt >= MAX_EXECUTION_MS) { timedOut = true; break }
          res = await fetch(url)
          if (res.status === 429) {
            rateLimited++
            consecutive429++
            failed++
            errors.push(`${sym.symbol}: rate-limited after backoff`)
            continue
          }
        }

        // Successful non-429 response resets the consecutive counter
        consecutive429 = 0

        if (res.status === 404) { skipped++; continue }
        if (!res.ok) { failed++; errors.push(`${sym.symbol}: HTTP ${res.status}`); continue }

        const data = await res.json().catch(() => null)
        if (!data?.results) { failed++; errors.push(`${sym.symbol}: no results`); continue }

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

        const update: Record<string, any> = {
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

        if (normalizedExchange && (!sym.exchange || sym.exchange === 'Unknown')) update.exchange = normalizedExchange
        if (normalizedExchange) update.primary_exchange = normalizedExchange
        if (instrumentType) update.instrument_type = instrumentType
        if (sicCode) update.sic_code = sicCode
        if (sicDesc) update.sic_description = sicDesc
        if (companyName && !sym.name) update.name = companyName

        const promotion = classifyPromotion({ ...sym, ...update })
        update.support_level = promotion.support_level
        update.eligible_for_backfill = promotion.eligible_for_backfill
        update.eligible_for_full_wsp = promotion.eligible_for_full_wsp

        const { error: updateErr } = await supabase.from('symbols').update(update).eq('symbol', sym.symbol)
        if (updateErr) { failed++; errors.push(`${sym.symbol}: ${updateErr.message}`); continue }

        enriched++
        enrichedSymbols.push(sym.symbol)
        if (promotion.support_level === 'full_wsp_equity' && sym.support_level !== 'full_wsp_equity') {
          promoted++
          promotions.push(sym.symbol)
        }

        await sleep(BETWEEN_SYMBOL_MS)
      } catch (err) {
        failed++
        errors.push(`${sym.symbol}: ${String(err).slice(0, 100)}`)
      }
    }

    const processed = enriched + failed + skipped
    const nextOffset = offset + processed
    const hasMore = (timedOut || symbols.length === DB_BATCH_SIZE) && !rateLimitAbort

    // Determine final status
    let finalStatus: string
    if (rateLimitAbort) {
      finalStatus = 'rate_limited'
    } else if (failed === 0 && !timedOut) {
      finalStatus = 'success'
    } else if (enriched > 0) {
      finalStatus = 'partial'
    } else if (failed > 0) {
      finalStatus = 'error'
    } else {
      finalStatus = 'success'
    }

    if (logRow?.id) {
      await supabase.from('data_sync_log').update({
        status: finalStatus,
        symbols_processed: processed,
        symbols_failed: failed,
        completed_at: new Date().toISOString(),
        error_message: errors.slice(0, 10).join('\n') || null,
        metadata: {
          offset, next_offset: nextOffset, enriched, skipped, failed,
          promoted, rate_limited: rateLimited, timed_out: timedOut,
          rate_limit_abort: rateLimitAbort,
          consecutive_429_at_exit: consecutive429,
          total_remaining: (totalRemaining ?? 0) - enriched,
          promotions: promotions.slice(0, 20),
          elapsed_ms: Date.now() - startedAt,
        },
      }).eq('id', logRow.id)
    }

    return jsonRes({
      ok: true, enriched, skipped, failed, promoted, processed,
      rateLimited, rateLimitAbort, timedOut, offset, nextOffset, hasMore,
      totalRemaining: (totalRemaining ?? 0) - enriched,
      enrichedSymbols: enrichedSymbols.slice(0, 30),
      promotions: promotions.slice(0, 20),
      errors: errors.slice(0, 10),
      elapsedMs: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('bulk-enrich-sectors error:', err)
    return jsonRes({ ok: false, error: String(err).slice(0, 300) }, 500)
  }
})

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}