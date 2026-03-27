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

const SECTOR_ETFS = [
  { symbol: 'XLK', sector: 'Technology', name: 'Technology Select Sector SPDR' },
  { symbol: 'XLF', sector: 'Financials', name: 'Financial Select Sector SPDR' },
  { symbol: 'XLE', sector: 'Energy', name: 'Energy Select Sector SPDR' },
  { symbol: 'XLV', sector: 'Healthcare', name: 'Health Care Select Sector SPDR' },
  { symbol: 'XLI', sector: 'Industrials', name: 'Industrial Select Sector SPDR' },
  { symbol: 'XLY', sector: 'Consumer Discretionary', name: 'Consumer Discret Sector SPDR' },
  { symbol: 'XLP', sector: 'Consumer Staples', name: 'Consumer Staples Sector SPDR' },
  { symbol: 'XLU', sector: 'Utilities', name: 'Utilities Select Sector SPDR' },
  { symbol: 'XLB', sector: 'Materials', name: 'Materials Select Sector SPDR' },
  { symbol: 'XLRE', sector: 'Real Estate', name: 'Real Estate Select Sector SPDR' },
  { symbol: 'XLC', sector: 'Communication Services', name: 'Communication Services SPDR' },
]

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'IWM']
const METALS_ETFS = new Set(['GLD', 'SLV', 'COPX', 'GDX', 'PPLT'])

const SECTOR_MAP: Record<string, string> = {
  AAPL: 'Technology', MSFT: 'Technology', NVDA: 'Technology', AVGO: 'Technology',
  ORCL: 'Technology', CSCO: 'Technology', AMD: 'Technology', CRM: 'Technology',
  ADBE: 'Technology', INTC: 'Technology', QCOM: 'Technology', TXN: 'Technology',
  AMAT: 'Technology', MU: 'Technology', LRCX: 'Technology', KLAC: 'Technology',
  SNPS: 'Technology', CDNS: 'Technology', MRVL: 'Technology', NOW: 'Technology',
  GOOGL: 'Communication Services', META: 'Communication Services', NFLX: 'Communication Services',
  DIS: 'Communication Services', CMCSA: 'Communication Services', TMUS: 'Communication Services',
  VZ: 'Communication Services', T: 'Communication Services',
  AMZN: 'Consumer Discretionary', TSLA: 'Consumer Discretionary', HD: 'Consumer Discretionary',
  MCD: 'Consumer Discretionary', NKE: 'Consumer Discretionary', SBUX: 'Consumer Discretionary',
  LOW: 'Consumer Discretionary', TJX: 'Consumer Discretionary', BKNG: 'Consumer Discretionary',
  COST: 'Consumer Staples', PG: 'Consumer Staples', KO: 'Consumer Staples', PEP: 'Consumer Staples',
  WMT: 'Consumer Staples', PM: 'Consumer Staples', MO: 'Consumer Staples', CL: 'Consumer Staples',
  JPM: 'Financials', V: 'Financials', MA: 'Financials', BAC: 'Financials',
  WFC: 'Financials', GS: 'Financials', MS: 'Financials', BLK: 'Financials',
  AXP: 'Financials', C: 'Financials', SCHW: 'Financials', BRK_B: 'Financials',
  LLY: 'Healthcare', UNH: 'Healthcare', JNJ: 'Healthcare', ABBV: 'Healthcare',
  MRK: 'Healthcare', PFE: 'Healthcare', TMO: 'Healthcare', ABT: 'Healthcare',
  DHR: 'Healthcare', BMY: 'Healthcare', AMGN: 'Healthcare', GILD: 'Healthcare',
  ISRG: 'Healthcare', MDT: 'Healthcare', SYK: 'Healthcare',
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', EOG: 'Energy',
  SLB: 'Energy', MPC: 'Energy', PSX: 'Energy', VLO: 'Energy',
  CAT: 'Industrials', BA: 'Industrials', RTX: 'Industrials', HON: 'Industrials',
  UNP: 'Industrials', UPS: 'Industrials', DE: 'Industrials', LMT: 'Industrials',
  GE: 'Industrials', MMM: 'Industrials', FDX: 'Industrials',
  NEE: 'Utilities', DUK: 'Utilities', SO: 'Utilities', D: 'Utilities',
  AEP: 'Utilities', SRE: 'Utilities', EXC: 'Utilities',
  LIN: 'Materials', APD: 'Materials', SHW: 'Materials', ECL: 'Materials',
  FCX: 'Materials', NEM: 'Materials', NUE: 'Materials',
  PLD: 'Real Estate', AMT: 'Real Estate', CCI: 'Real Estate',
  EQIX: 'Real Estate', SPG: 'Real Estate', O: 'Real Estate',
  GLD: 'Metals & Mining', SLV: 'Metals & Mining', COPX: 'Metals & Mining',
  GDX: 'Metals & Mining', PPLT: 'Metals & Mining',
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
  if (INDEX_SYMBOLS.includes(symbol) || SECTOR_ETFS.some(s => s.symbol === symbol)) {
    return { support_level: 'sector_benchmark_proxy', eligible_for_backfill: true, eligible_for_full_wsp: false, exclusion_reason: null }
  }
  if (METALS_ETFS.has(symbol)) {
    return { support_level: 'metals_limited', eligible_for_backfill: true, eligible_for_full_wsp: false, exclusion_reason: null }
  }
  if (isEtf || isAdr) {
    return { support_level: 'data_only', eligible_for_backfill: false, eligible_for_full_wsp: false, exclusion_reason: isEtf ? 'non_target_etf' : 'adr_not_promoted' }
  }

  if (row.support_level === 'full_wsp_equity' && isCommonStock && ['NYSE', 'NASDAQ'].includes(exchange)) {
    return { support_level: 'full_wsp_equity', eligible_for_backfill: true, eligible_for_full_wsp: true, exclusion_reason: null }
  }

  if (isCommonStock && hasClassificationQuality && ['NYSE', 'NASDAQ'].includes(exchange)) {
    return { support_level: 'full_wsp_equity', eligible_for_backfill: true, eligible_for_full_wsp: true, exclusion_reason: null }
  }
  if (isCommonStock && ['NYSE', 'NASDAQ', 'AMEX', 'ARCA'].includes(exchange)) {
    return {
      support_level: 'limited_equity',
      eligible_for_backfill: true,
      eligible_for_full_wsp: false,
      exclusion_reason: hasClassificationQuality ? 'insufficient_primary_exchange' : `classification_${String(row.classification_status ?? 'unresolved')}_${String(row.classification_confidence_level ?? 'low')}`,
    }
  }
  return { support_level: 'excluded', eligible_for_backfill: false, eligible_for_full_wsp: false, exclusion_reason: 'unsupported_instrument' }
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

  try {
    const alpacaKeyId = Deno.env.get('ALPACA_API_KEY_ID')
    const alpacaSecret = Deno.env.get('ALPACA_API_SECRET_KEY')

    let alpacaAssets: any[] = []
    if (alpacaKeyId && alpacaSecret) {
      const res = await fetch(
        'https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity',
        {
          headers: {
            'APCA-API-KEY-ID': alpacaKeyId,
            'APCA-API-SECRET-KEY': alpacaSecret,
          },
        }
      )
      if (res.ok) {
        alpacaAssets = await res.json()
      }
    }

    const tradeableSymbols = alpacaAssets
      .filter(
        (a: any) =>
          a.tradable &&
          a.status === 'active' &&
          !a.symbol.includes('/') &&
          !a.symbol.includes('.') &&
          a.symbol.length <= 5 &&
          (a.exchange === 'NYSE' || a.exchange === 'NASDAQ' || a.exchange === 'AMEX' || a.exchange === 'ARCA')
      )
      .map((a: any) => ({
        symbol: a.symbol,
        company_name: a.name,
        exchange: a.exchange,
        primary_exchange: a.exchange,
        asset_class: 'us_equity',
        instrument_type: 'CS',
        is_common_stock: true,
        is_active: true,
        source_provider: 'alpaca_assets',
      }))

    const inserts = [
      ...INDEX_SYMBOLS.map((s) => ({
        symbol: s,
        company_name: s,
        name: s,
        raw_sector: 'Index',
        exchange: 'ARCA',
        primary_exchange: 'ARCA',
        asset_class: 'us_equity',
        instrument_type: 'ETF',
        is_common_stock: false,
        is_etf: true,
        is_adr: false,
        is_active: true,
        source_provider: 'seed_index',
      })),
      ...SECTOR_ETFS.map((e) => ({
        symbol: e.symbol,
        company_name: e.name,
        name: e.name,
        raw_sector: e.sector,
        exchange: 'ARCA',
        primary_exchange: 'ARCA',
        asset_class: 'us_equity',
        instrument_type: 'ETF',
        is_common_stock: false,
        is_etf: true,
        is_adr: false,
        is_active: true,
        source_provider: 'seed_sector_etf',
      })),
      ...tradeableSymbols.map((a: any) => ({
        symbol: a.symbol,
        company_name: a.company_name,
        name: a.company_name,
        raw_sector: SECTOR_MAP[a.symbol] || null,
        exchange: a.exchange,
        primary_exchange: a.primary_exchange,
        asset_class: a.asset_class,
        instrument_type: a.instrument_type,
        is_common_stock: a.is_common_stock,
        is_etf: false,
        is_adr: false,
        is_active: true,
        source_provider: a.source_provider,
      })),
    ]

    const uniqueMap = new Map<string, any>()
    for (const item of inserts) {
      uniqueMap.set(item.symbol, item)
    }
    const uniqueInserts = Array.from(uniqueMap.values())

    const { data: existingRows } = await supabase
      .from('symbols')
      .select('symbol, name, company_name, sector, industry, raw_sector, raw_industry, canonical_sector, canonical_industry, classification_confidence_level, classification_status, manual_override_sector, manual_override_industry, manually_reviewed, exchange, primary_exchange, asset_class, instrument_type, is_active, is_common_stock, is_etf, is_adr, support_level, eligible_for_backfill, eligible_for_full_wsp, exclusion_reason, source_provider')
      .in('symbol', uniqueInserts.map((i: any) => i.symbol))

    const existingMap = new Map<string, any>((existingRows ?? []).map((r: any) => [r.symbol, r]))

    const mergedRows = uniqueInserts.map((candidate: any) => {
      const existing = existingMap.get(candidate.symbol)
      const merged = {
        ...existing,
        ...candidate,
        name: existing?.name || candidate.company_name,
        company_name: existing?.company_name || candidate.company_name || existing?.name || candidate.symbol,
        raw_sector: existing?.raw_sector || candidate.raw_sector || existing?.sector,
        raw_industry: existing?.raw_industry || candidate.raw_industry || existing?.industry,
        exchange: existing?.exchange || candidate.exchange || null,
        primary_exchange: existing?.primary_exchange || candidate.primary_exchange || null,
        source_provider: existing?.source_provider || candidate.source_provider || 'seed_v1',
      }

      const classification = computeSectorIndustryClassification({
        symbol: merged.symbol,
        rawSector: merged.raw_sector,
        rawIndustry: merged.raw_industry,
        sector: merged.sector,
        industry: merged.industry,
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

      const promotedInput = {
        ...merged,
        classification_status: classification.classificationStatus,
        classification_confidence_level: classification.confidenceLevel,
      }
      const promotion = classifyPromotion(promotedInput)

      return {
        ...merged,
        sector: classification.canonicalSector ?? merged.sector ?? 'Unknown',
        industry: classification.canonicalIndustry ?? merged.industry,
        canonical_sector: classification.canonicalSector,
        canonical_industry: classification.canonicalIndustry,
        classification_confidence: classification.confidenceScore,
        classification_confidence_level: classification.confidenceLevel,
        classification_source: classification.classificationSource,
        classification_status: classification.classificationStatus,
        classification_reason: classification.classificationReason,
        review_needed: classification.reviewNeeded,
        ...promotion,
      }
    })

    const batches = chunkArray(mergedRows, 500)
    for (const batch of batches) {
      await supabase.from('symbols').upsert(batch, { onConflict: 'symbol' })
    }

    return jsonRes({
      ok: true,
      totalSeeded: mergedRows.length,
      fromAlpaca: tradeableSymbols.length,
      withSector: Object.keys(SECTOR_MAP).length,
    })
  } catch (err) {
    return jsonRes({ ok: false, error: String(err) })
  }
})

function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, (i + 1) * size)
  )
}

function jsonRes(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
