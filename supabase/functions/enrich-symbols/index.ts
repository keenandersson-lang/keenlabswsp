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

const SECTOR_NORMALIZATION: Record<string, string> = {
  'consumer defensive': 'Consumer Staples',
  'consumer cyclical': 'Consumer Discretionary',
  'communication services': 'Communication Services',
  'real estate': 'Real Estate',
  'basic materials': 'Materials',
  'health care': 'Healthcare',
  'industrials': 'Industrials',
  'utilities': 'Utilities',
  'financial services': 'Financials',
  'technology': 'Technology',
  'energy': 'Energy',
  'unknown': 'Unknown',
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

const SIC_SECTOR_MAP: Record<string, string> = {
  '01': 'Materials','02': 'Materials','07': 'Materials','08': 'Materials','09': 'Materials',
  '10': 'Energy','12': 'Energy','13': 'Energy','14': 'Materials','15': 'Industrials','16': 'Industrials','17': 'Industrials',
  '20': 'Consumer Staples','21': 'Consumer Staples','22': 'Consumer Discretionary','23': 'Consumer Discretionary','24': 'Materials',
  '25': 'Consumer Discretionary','26': 'Materials','27': 'Communication Services','28': 'Healthcare','29': 'Energy','30': 'Materials',
  '31': 'Consumer Discretionary','32': 'Materials','33': 'Materials','34': 'Industrials','35': 'Technology','36': 'Technology',
  '37': 'Industrials','38': 'Healthcare','39': 'Consumer Discretionary','40': 'Industrials','41': 'Industrials','42': 'Industrials',
  '43': 'Communication Services','44': 'Industrials','45': 'Industrials','46': 'Industrials','47': 'Industrials','48': 'Communication Services',
  '49': 'Utilities','50': 'Consumer Discretionary','51': 'Consumer Staples','52': 'Consumer Discretionary','53': 'Consumer Discretionary',
  '54': 'Consumer Staples','55': 'Consumer Discretionary','56': 'Consumer Discretionary','57': 'Consumer Discretionary','58': 'Consumer Discretionary',
  '59': 'Consumer Discretionary','60': 'Financials','61': 'Financials','62': 'Financials','63': 'Financials','64': 'Financials','65': 'Real Estate',
  '67': 'Financials','70': 'Consumer Discretionary','72': 'Consumer Discretionary','73': 'Technology','75': 'Consumer Discretionary',
  '76': 'Industrials','78': 'Communication Services','79': 'Communication Services','80': 'Healthcare','81': 'Technology','82': 'Consumer Discretionary',
  '83': 'Consumer Discretionary','84': 'Consumer Discretionary','86': 'Consumer Discretionary','87': 'Technology','89': 'Technology',
  '91': 'Industrials','92': 'Industrials','93': 'Industrials','94': 'Industrials','95': 'Industrials','96': 'Industrials','97': 'Industrials','99': 'Industrials',
}

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeSector(raw: string | null | undefined): string | null {
  const normalized = normalizeText(raw)
  if (!normalized) return null
  const key = normalized.toLowerCase()
  return SECTOR_NORMALIZATION[key] ?? titleCase(normalized)
}

function titleCase(input: string): string {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 100)
}

function sectorFromSic(sic: string | null | undefined): string | null {
  if (!sic) return null
  const prefix = sic.slice(0, 2)
  return SIC_SECTOR_MAP[prefix] ?? null
}

function industryFromSicDesc(sicDesc: string | null | undefined): string | null {
  const normalized = normalizeText(sicDesc)
  if (!normalized || normalized.length < 3) return null
  return titleCase(normalized)
}

function classifyPromotion(row: Record<string, any>) {
  const symbol = String(row.symbol ?? '').toUpperCase()
  const exchange = String(row.exchange ?? row.primary_exchange ?? '').toUpperCase()
  const isEtf = Boolean(row.is_etf)
  const isAdr = Boolean(row.is_adr)
  const isCommonStock = Boolean(row.is_common_stock)

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

  const hasFullMeta = Boolean(row.sector && row.sector !== 'Unknown' && row.industry)
  const fullEquity = isCommonStock && hasFullMeta && ['NYSE', 'NASDAQ'].includes(exchange)
  if (fullEquity) {
    return { support_level: 'full_wsp_equity', eligible_for_backfill: true, eligible_for_full_wsp: true, exclusion_reason: null }
  }

  if (isCommonStock && ['NYSE', 'NASDAQ', 'AMEX', 'ARCA'].includes(exchange)) {
    return { support_level: 'limited_equity', eligible_for_backfill: true, eligible_for_full_wsp: false, exclusion_reason: hasFullMeta ? 'insufficient_primary_exchange' : 'missing_sector_or_industry' }
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
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json().catch(() => ({})) as Record<string, any>
  const { batchSize = 20, offset = 0, forceRefresh = false, tier = 'all' } = body

  let symbolFilter: string[] | null = null
  if (tier === 'tier1') symbolFilter = TIER1_CURATED
  else if (tier === 'tier2') symbolFilter = TIER2_KNOWN_SECTOR
  else if (tier === 'tier1+2') symbolFilter = [...TIER1_CURATED, ...TIER2_KNOWN_SECTOR]

  let symbols: any[] | null = null
  let fetchErr: any = null

  if (symbolFilter) {
    const batch = symbolFilter.slice(offset, offset + batchSize)
    if (batch.length === 0) {
      return jsonRes({ ok: true, done: true, message: `No more symbols in ${tier}.`, offset, enriched: 0, tierTotal: symbolFilter.length })
    }
    const result = await supabase
      .from('symbols')
      .select('symbol, name, company_name, exchange, primary_exchange, sector, industry, asset_class, instrument_type, is_active, is_common_stock, is_etf, is_adr, enriched_at')
      .in('symbol', batch)
    symbols = result.data
    fetchErr = result.error
    if (!forceRefresh && symbols) {
      symbols = symbols.filter((s: any) => !s.enriched_at)
    }
  } else {
    let query = supabase
      .from('symbols')
      .select('symbol, name, company_name, exchange, primary_exchange, sector, industry, asset_class, instrument_type, is_active, is_common_stock, is_etf, is_adr, enriched_at')
      .eq('is_active', true)
      .order('symbol')
      .range(offset, offset + batchSize - 1)
    if (!forceRefresh) query = query.is('enriched_at', null)
    const result = await query
    symbols = result.data
    fetchErr = result.error
  }

  if (fetchErr) return jsonRes({ error: `Fetch error: ${fetchErr.message}` })
  if (!symbols || symbols.length === 0) {
    return jsonRes({ ok: true, done: true, message: `No more symbols to enrich (${tier}).`, offset, enriched: 0, tierTotal: symbolFilter?.length ?? null })
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
  const errors: string[] = []
  const promotions: string[] = []

  for (const sym of symbols) {
    try {
      const url = `https://api.polygon.io/v3/reference/tickers/${sym.symbol}?apiKey=${POLYGON_KEY}`
      const res = await fetch(url)
      if (res.status === 429) {
        await sleep(12000)
        const retryRes = await fetch(url)
        if (!retryRes.ok) {
          failed++
          errors.push(`${sym.symbol}: rate-limited, retry failed ${retryRes.status}`)
          continue
        }
        const retryData = await retryRes.json()
        const wasPromoted = await processTickerDetails(sym, retryData)
        enriched++
        if (wasPromoted) {
          promoted++
          promotions.push(sym.symbol)
        }
        continue
      }
      if (!res.ok) {
        if (res.status === 404) {
          skipped++
          continue
        }
        failed++
        errors.push(`${sym.symbol}: polygon ${res.status}`)
        continue
      }

      const data = await res.json()
      const wasPromoted = await processTickerDetails(sym, data)
      enriched++
      if (wasPromoted) {
        promoted++
        promotions.push(sym.symbol)
      }
      await sleep(12500)
    } catch (err) {
      failed++
      errors.push(`${sym.symbol}: ${String(err).slice(0, 100)}`)
    }
  }

  await supabase
    .from('data_sync_log')
    .update({
      status: failed === 0 ? 'success' : 'partial',
      symbols_processed: enriched,
      symbols_failed: failed,
      completed_at: new Date().toISOString(),
      error_message: errors.slice(0, 10).join('\n') || null,
      metadata: {
        tier, batch_size: batchSize, offset,
        tier_total: symbolFilter?.length ?? null,
        symbols_count: symbols.length,
        enriched, skipped, failed, promoted,
        promotions: promotions.slice(0, 50),
      },
    })
    .eq('id', logRow?.id)

  const nextOffset = offset + batchSize
  const hasMore = symbolFilter ? nextOffset < symbolFilter.length : symbols.length === batchSize

  return jsonRes({
    ok: true,
    tier,
    tierTotal: symbolFilter?.length ?? null,
    enriched,
    skipped,
    failed,
    promoted,
    promotions: promotions.slice(0, 20),
    offset,
    nextOffset,
    hasMore,
    errors: errors.slice(0, 10),
  })
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
  const derivedSector = normalizeSector(details.market ?? details.sector) ?? sectorFromSic(sicCode)
  const derivedIndustry = normalizeText(details.industry) ?? industryFromSicDesc(sicDesc)
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
    sector: existing.sector && existing.sector !== 'Unknown' ? existing.sector : (derivedSector ?? existing.sector ?? 'Unknown'),
    industry: existing.industry || derivedIndustry || null,
  }

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
  }

  if (normalizedExchange && (!existing.exchange || existing.exchange === 'Unknown')) {
    update.exchange = normalizedExchange
  }
  if (instrumentType) {
    update.instrument_type = instrumentType
  }
  if (sicCode) update.sic_code = sicCode
  if (sicDesc) update.sic_description = sicDesc
  if (merged.sector && (!existing.sector || existing.sector === 'Unknown')) {
    update.sector = merged.sector
  }
  if (merged.industry && !existing.industry) {
    update.industry = merged.industry
  }

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

function jsonRes(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
