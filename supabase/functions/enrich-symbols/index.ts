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
const MAX_EXECUTION_MS = 110_000
const POLYGON_RETRY_SLEEP_MS = 1_200
const BETWEEN_SYMBOL_SLEEP_MS = 250

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

const TIER1_CURATED = [
  'SPY','QQQ','DIA','IWM','XLK','XLV','XLF','XLE','XLY','XLI','XLC','XLP','XLB','XLRE','XLU',
  'AAPL','MSFT','NVDA','AVGO','AMD','ORCL','CRM','GOOGL','META','NFLX','DIS','TMUS','VZ',
  'AMZN','TSLA','HD','MCD','NKE','BKNG','COST','WMT','PG','KO','PEP','PM','JPM','BAC','WFC','V','MA',
  'LLY','UNH','JNJ','ABBV','MRK','ISRG','CAT','BA','GE','HON','UPS','DE','XOM','CVX','COP','SLB','EOG',
  'LIN','APD','ECL','NUE','DD','PLD','AMT','EQIX','O','NEE','SO','DUK','SRE','GLD','SLV','COPX','GDX','NEM','FCX','PPLT',
]

const TIER2_KNOWN_SECTOR = [
  'CSCO','ADBE','INTC','QCOM','TXN','AMAT','MU','LRCX','KLAC','SNPS','CDNS','MRVL','NOW','CMCSA','T','SBUX','LOW','TJX',
  'MO','CL','GS','MS','BLK','AXP','C','SCHW','PFE','TMO','ABT','DHR','BMY','AMGN','GILD','MDT','SYK',
  'MPC','PSX','VLO','RTX','UNP','LMT','MMM','FDX','D','AEP','EXC','SHW','CCI','SPG',
]

const BENCHMARKS = new Set(['SPY','QQQ','DIA','IWM','XLK','XLV','XLF','XLE','XLY','XLI','XLC','XLP','XLB','XLRE','XLU'])
const METALS = new Set(['GLD','SLV','COPX','GDX','PPLT'])
const SUPPORTED_ENRICH_TIERS = new Set(['all', 'tier1', 'tier2', 'tier1+2'] as const)

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

  if (!row.is_active) {
    return { support_level: 'excluded', eligible_for_backfill: false, eligible_for_full_wsp: false, exclusion_reason: 'inactive_symbol' }
  }
  if (BENCHMARKS.has(symbol)) {
    return { support_level: 'sector_benchmark_proxy', eligible_for_backfill: true, eligible_for_full_wsp: false, exclusion_reason: null }
  }
  if (METALS.has(symbol)) {
    return { support_level: 'metals_limited', eligible_for_backfill: true, eligible_for_full_wsp: false, exclusion_reason: null }
  }
  if (isEtf || isAdr) {
    return { support_level: 'data_only', eligible_for_backfill: false, eligible_for_full_wsp: false, exclusion_reason: isEtf ? 'non_target_etf' : 'adr_not_promoted' }
  }

  const isTier1Grandfathered = row.support_level === 'full_wsp_equity'
  if (isTier1Grandfathered && isCommonStock && ['NYSE', 'NASDAQ'].includes(exchange)) {
    return { support_level: 'full_wsp_equity', eligible_for_backfill: true, eligible_for_full_wsp: true, exclusion_reason: null }
  }

  const fullEquity = isCommonStock && hasClassificationQuality && ['NYSE', 'NASDAQ'].includes(exchange)
  if (fullEquity) {
    return { support_level: 'full_wsp_equity', eligible_for_backfill: true, eligible_for_full_wsp: true, exclusion_reason: null }
  }

  if (isCommonStock && ['NYSE', 'NASDAQ', 'AMEX', 'ARCA'].includes(exchange)) {
    const reason = !hasClassificationQuality
      ? `classification_${String(row.classification_status ?? 'unresolved')}_${String(row.classification_confidence_level ?? 'low')}`
      : 'insufficient_primary_exchange'
    return { support_level: 'limited_equity', eligible_for_backfill: true, eligible_for_full_wsp: false, exclusion_reason: reason }
  }

  return { support_level: 'excluded', eligible_for_backfill: false, eligible_for_full_wsp: false, exclusion_reason: 'unsupported_instrument' }
}

Deno.serve(async (req: Request) => {
  const requestStartedAt = Date.now()
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    const authHeader = req.headers.get('Authorization')
    if (authHeader !== `Bearer ${Deno.env.get('SYNC_SECRET_KEY')}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized', code: 'UNAUTHORIZED' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json().catch(() => ({})) as Record<string, any>
    const { batchSize = 20, offset = 0, forceRefresh = false } = body
    const tierInput = normalizeScopeInput(body)
    const tier = resolveTier(tierInput)

    if (!SUPPORTED_ENRICH_TIERS.has(tier)) {
      return jsonRes({
        ok: false,
        error: `Unsupported enrich scope: ${tierInput}. Supported: all, tier1, tier2, tier1+2`,
        code: 'UNSUPPORTED_SCOPE',
      })
    }

    let symbolFilter: string[] | null = null
    if (tier === 'tier1') symbolFilter = TIER1_CURATED
    else if (tier === 'tier2') symbolFilter = TIER2_KNOWN_SECTOR
    else if (tier === 'tier1+2') symbolFilter = [...TIER1_CURATED, ...TIER2_KNOWN_SECTOR]

    let symbols: any[] | null = null
    let fetchErr: any = null

    const shouldRecomputeDerived = forceRefresh || tier === 'tier1' || tier === 'tier1+2'

    if (symbolFilter) {
      const batch = symbolFilter.slice(offset, offset + batchSize)
      const nextOffset = offset + batchSize
      const hasMore = nextOffset < symbolFilter.length
      if (batch.length === 0) {
        return jsonRes({
          ok: true,
          done: true,
          message: `No more symbols in ${tier}.`,
          offset,
          nextOffset,
          hasMore: false,
          enriched: 0,
          selected: 0,
          requested: 0,
          missingSymbols: [],
          tierTotal: symbolFilter.length,
        })
      }

      const result = await supabase
        .from('symbols')
        .select('symbol, name, company_name, exchange, primary_exchange, sector, industry, raw_sector, raw_industry, manual_override_sector, manual_override_industry, manually_reviewed, classification_status, classification_confidence_level, asset_class, instrument_type, is_active, is_common_stock, is_etf, is_adr, support_level, enriched_at')
        .in('symbol', batch)
      symbols = result.data
      fetchErr = result.error

      if (!fetchErr) {
        const rows = symbols ?? []
        const bySymbol = new Map(rows.map((row: any) => [String(row.symbol).toUpperCase(), row]))
        const matchedSymbols = batch.filter((sym) => bySymbol.has(sym))
        const missingSymbols = batch.filter((sym) => !bySymbol.has(sym))

        const alreadyEnrichedSymbols: string[] = []
        const pendingCandidates: any[] = []
        for (const sym of matchedSymbols) {
          const row = bySymbol.get(sym)!
          if (!shouldRecomputeDerived && row.enriched_at) {
            alreadyEnrichedSymbols.push(sym)
            continue
          }
          pendingCandidates.push(row)
        }

        if (pendingCandidates.length === 0) {
          const skipSummary = {
            missingFromSymbolsTable: missingSymbols.length,
            alreadyEnriched: alreadyEnrichedSymbols.length,
            pendingCandidates: 0,
            matchedInSymbolsTable: matchedSymbols.length,
          }
          const skipReasonParts: string[] = []
          if (skipSummary.missingFromSymbolsTable > 0) skipReasonParts.push(`${skipSummary.missingFromSymbolsTable} missing from symbols table`)
          if (skipSummary.alreadyEnriched > 0) skipReasonParts.push(`${skipSummary.alreadyEnriched} already enriched`)
          if (skipReasonParts.length === 0) skipReasonParts.push('0 matched pending after scope resolution')

          return jsonRes({
            ok: true,
            tier,
            done: !hasMore,
            message: `No pending symbols to enrich in ${tier} batch: ${skipReasonParts.join(', ')}.`,
            offset,
            nextOffset,
            hasMore,
            enriched: 0,
            skipped: matchedSymbols.length,
            failed: 0,
            promoted: 0,
            selected: 0,
            requested: batch.length,
            matchedSymbols: matchedSymbols.length,
            pendingCandidates: 0,
            skipSummary,
            missingSymbols,
            alreadyEnrichedSymbols: alreadyEnrichedSymbols.slice(0, 50),
            tierTotal: symbolFilter.length,
            promotions: [],
            errors: [],
          })
        }

        symbols = pendingCandidates
      }
    } else {
      let query = supabase
        .from('symbols')
        .select('symbol, name, company_name, exchange, primary_exchange, sector, industry, raw_sector, raw_industry, manual_override_sector, manual_override_industry, manually_reviewed, classification_status, classification_confidence_level, asset_class, instrument_type, is_active, is_common_stock, is_etf, is_adr, support_level, enriched_at')
        .eq('is_active', true)
        .order('symbol')
        .range(offset, offset + batchSize - 1)
      if (!shouldRecomputeDerived) query = query.is('enriched_at', null)
      const result = await query
      symbols = result.data
      fetchErr = result.error
    }

    if (fetchErr) return jsonRes({ ok: false, error: `Fetch error: ${fetchErr.message}`, code: 'FETCH_ERROR' })
    if (!symbols || symbols.length === 0) {
      const emptyMessage = symbolFilter
        ? `No pending symbols to enrich (${tier}) after scope resolution.`
        : `No more symbols to enrich (${tier}).`
      return jsonRes({ ok: true, done: true, message: emptyMessage, offset, enriched: 0, tierTotal: symbolFilter?.length ?? null })
    }

    const { data: logRow } = await supabase
      .from('data_sync_log')
      .insert({
        sync_type: 'enrich',
        status: 'running',
        data_source: 'polygon_ticker_details',
        metadata: { batch_size: batchSize, offset, symbols_count: symbols.length, tier },
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    let enriched = 0
    let skipped = 0
    let failed = 0
    let promoted = 0
    let processed = 0
    let timedOut = false
    const errors: string[] = []
    const promotions: string[] = []

    for (const sym of symbols) {
      if (Date.now() - requestStartedAt >= MAX_EXECUTION_MS) {
        timedOut = true
        errors.push(`Execution window reached after ${processed} symbols; returning partial progress.`)
        break
      }

      try {
        const url = `https://api.polygon.io/v3/reference/tickers/${sym.symbol}?apiKey=${POLYGON_KEY}`
        const res = await fetch(url)
        if (res.status === 429) {
          await sleep(POLYGON_RETRY_SLEEP_MS)
          const retryRes = await fetch(url)
          if (!retryRes.ok) {
            failed++
            processed++
            errors.push(`${sym.symbol}: rate-limited, retry failed ${retryRes.status}`)
            continue
          }
          const retryData = await retryRes.json().catch(() => null)
          if (!retryData) {
            failed++
            processed++
            errors.push(`${sym.symbol}: retry response not valid JSON`)
            continue
          }
          const wasPromoted = await processTickerDetails(sym, retryData)
          enriched++
          processed++
          if (wasPromoted) {
            promoted++
            promotions.push(sym.symbol)
          }
          await sleep(BETWEEN_SYMBOL_SLEEP_MS)
          continue
        }
        if (!res.ok) {
          processed++
          if (res.status === 404) {
            skipped++
            continue
          }
          failed++
          errors.push(`${sym.symbol}: polygon ${res.status}`)
          continue
        }

        const data = await res.json().catch(() => null)
        if (!data) {
          failed++
          processed++
          errors.push(`${sym.symbol}: polygon invalid JSON body`)
          continue
        }

        const wasPromoted = await processTickerDetails(sym, data)
        enriched++
        processed++
        if (wasPromoted) {
          promoted++
          promotions.push(sym.symbol)
        }
        await sleep(BETWEEN_SYMBOL_SLEEP_MS)
      } catch (err) {
        failed++
        processed++
        errors.push(`${sym.symbol}: ${String(err).slice(0, 100)}`)
      }
    }

    const nextOffset = offset + processed
    const hasMoreBySelection = symbolFilter ? nextOffset < symbolFilter.length : symbols.length === batchSize
    const hasMore = timedOut ? true : hasMoreBySelection

    await supabase
      .from('data_sync_log')
      .update({
        status: failed === 0 && !timedOut ? 'success' : 'partial',
        symbols_processed: processed,
        symbols_failed: failed,
        completed_at: new Date().toISOString(),
        error_message: errors.slice(0, 10).join('\n') || null,
        metadata: {
          tier, batch_size: batchSize, offset,
          tier_total: symbolFilter?.length ?? null,
          symbols_count: symbols.length,
          processed, enriched, skipped, failed, promoted, timed_out: timedOut,
          promotions: promotions.slice(0, 50),
        },
      })
      .eq('id', logRow?.id)

    return jsonRes({
      ok: true,
      tier,
      tierTotal: symbolFilter?.length ?? null,
      enriched,
      skipped,
      failed,
      promoted,
      processed,
      timedOut,
      promotions: promotions.slice(0, 20),
      selected: symbols.length,
      requested: symbolFilter ? Math.min(batchSize, Math.max(0, symbolFilter.length - offset)) : symbols.length,
      offset,
      nextOffset,
      hasMore,
      errors: errors.slice(0, 10),
    })
  } catch (err) {
    console.error('Unhandled enrich-symbols failure:', err)
    return jsonRes({
      ok: false,
      error: 'Unhandled enrich-symbols failure',
      code: 'UNHANDLED_EXCEPTION',
      details: String(err).slice(0, 300),
    }, 500)
  }
})

async function processTickerDetails(existing: any, polygonResponse: any): Promise<boolean> {
  const details = polygonResponse?.results
  if (!details) return false

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

  const merged = {
    ...existing,
    company_name: existing.company_name || companyName || existing.name || existing.symbol,
    name: existing.name || companyName || existing.symbol,
    exchange: existing.exchange || normalizedExchange,
    primary_exchange: normalizedExchange || existing.primary_exchange || existing.exchange,
    asset_class: existing.asset_class || 'us_equity',
    instrument_type: instrumentType || existing.instrument_type,
    is_active: details.active ?? existing.is_active ?? true,
    is_common_stock: isCommonStock || existing.is_common_stock || false,
    is_etf: isEtf || existing.is_etf || false,
    is_adr: isAdr || existing.is_adr || false,
    raw_sector: normalizeText(details.market ?? details.sector) || existing.raw_sector || existing.sector,
    raw_industry: normalizeText(details.industry) || normalizeText(sicDesc) || existing.raw_industry || existing.industry,
    sector: existing.sector,
    industry: existing.industry,
    manual_override_sector: existing.manual_override_sector,
    manual_override_industry: existing.manual_override_industry,
    manually_reviewed: existing.manually_reviewed,
    support_level: existing.support_level,
  }

  const classification = computeSectorIndustryClassification({
    symbol: merged.symbol,
    rawSector: merged.raw_sector,
    rawIndustry: merged.raw_industry,
    sector: merged.sector,
    industry: merged.industry,
    sicCode,
    sicDescription: sicDesc,
    exchange: merged.exchange,
    primaryExchange: merged.primary_exchange,
    instrumentType: merged.instrument_type,
    isEtf: merged.is_etf,
    isAdr: merged.is_adr,
    isCommonStock: merged.is_common_stock,
    manualOverrideSector: merged.manual_override_sector,
    manualOverrideIndustry: merged.manual_override_industry,
    manuallyReviewed: merged.manually_reviewed,
  })

  const update: Record<string, any> = {
    enriched_at: new Date().toISOString(),
    source_provider: 'polygon_ticker_details',
    company_name: merged.company_name,
    name: merged.name,
    primary_exchange: merged.primary_exchange,
    asset_class: merged.asset_class,
    is_active: merged.is_active,
    is_common_stock: merged.is_common_stock,
    is_etf: merged.is_etf,
    is_adr: merged.is_adr,
    raw_sector: classification.rawSector,
    raw_industry: classification.rawIndustry,
    canonical_sector: classification.canonicalSector,
    canonical_industry: classification.canonicalIndustry,
    classification_confidence: classification.confidenceScore,
    classification_confidence_level: classification.confidenceLevel,
    classification_source: classification.classificationSource,
    classification_status: classification.classificationStatus,
    classification_reason: classification.classificationReason,
    review_needed: classification.reviewNeeded,
    sector: classification.canonicalSector ?? merged.sector ?? 'Unknown',
    industry: classification.canonicalIndustry ?? merged.industry,
  }

  if (normalizedExchange && (!existing.exchange || existing.exchange === 'Unknown')) {
    update.exchange = normalizedExchange
  }
  if (instrumentType) {
    update.instrument_type = instrumentType
  }
  if (sicCode) update.sic_code = sicCode
  if (sicDesc) update.sic_description = sicDesc

  const promotion = classifyPromotion({ ...merged, ...update })
  update.support_level = promotion.support_level
  update.eligible_for_backfill = promotion.eligible_for_backfill
  update.eligible_for_full_wsp = promotion.eligible_for_full_wsp
  update.exclusion_reason = promotion.exclusion_reason

  const { error } = await supabase.from('symbols').update(update).eq('symbol', existing.symbol)
  if (error) {
    console.error(`Update error for ${existing.symbol}:`, error.message)
    return false
  }

  return promotion.support_level === 'full_wsp_equity' && existing.support_level !== 'full_wsp_equity'
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

function normalizeScopeInput(body: Record<string, any>): string {
  if (typeof body.tier === 'string' && body.tier.trim()) return body.tier.trim()
  if (typeof body.scope === 'string' && body.scope.trim()) return body.scope.trim()
  return 'all'
}

function resolveTier(input: string): string {
  const normalized = input.toLowerCase()
  if (normalized === 'tier1_default') return 'tier1'
  if (normalized === 'tier_1') return 'tier1'
  if (normalized === 'tier_2') return 'tier2'
  if (normalized === 'tier1+2' || normalized === 'tier1_plus_tier2' || normalized === 'tier1+tier2') return 'tier1+2'
  if (normalized === 'live_default') return 'tier1'
  return normalized
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
