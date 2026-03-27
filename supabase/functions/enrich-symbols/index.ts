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

// ── Polygon exchange → normalized exchange mapping ──
const EXCHANGE_MAP: Record<string, string> = {
  XNYS: 'NYSE', XNAS: 'NASDAQ', XASE: 'AMEX', ARCX: 'ARCA',
  BATS: 'BATS', XNGS: 'NASDAQ', XNCM: 'NASDAQ', XNMS: 'NASDAQ',
  NYSE: 'NYSE', NASDAQ: 'NASDAQ', AMEX: 'AMEX', ARCA: 'ARCA',
}

// ── Polygon type → instrument_type mapping ──
const TYPE_MAP: Record<string, string> = {
  CS: 'CS', ADRC: 'ADR', ADRR: 'ADR', ADRW: 'ADR',
  ETF: 'ETF', ETN: 'ETF', ETV: 'ETF',
  WARRANT: 'WARRANT', RIGHT: 'RIGHT', UNIT: 'UNIT',
  PFD: 'PFD', FUND: 'FUND', SP: 'SP', BOND: 'BOND',
  OS: 'OS', GDR: 'GDR', NOTE: 'NOTE',
}

// ── SIC code → sector mapping (first 2 digits) ──
const SIC_SECTOR_MAP: Record<string, string> = {
  '01': 'Materials', '02': 'Materials', '07': 'Materials', '08': 'Materials', '09': 'Materials',
  '10': 'Energy', '12': 'Energy', '13': 'Energy', '14': 'Materials',
  '15': 'Industrials', '16': 'Industrials', '17': 'Industrials',
  '20': 'Consumer Staples', '21': 'Consumer Staples', '22': 'Consumer Discretionary',
  '23': 'Consumer Discretionary', '24': 'Materials', '25': 'Consumer Discretionary',
  '26': 'Materials', '27': 'Communication Services', '28': 'Healthcare',
  '29': 'Energy', '30': 'Materials', '31': 'Consumer Discretionary',
  '32': 'Materials', '33': 'Materials', '34': 'Industrials',
  '35': 'Technology', '36': 'Technology', '37': 'Industrials',
  '38': 'Healthcare', '39': 'Consumer Discretionary',
  '40': 'Industrials', '41': 'Industrials', '42': 'Industrials',
  '43': 'Communication Services', '44': 'Industrials', '45': 'Industrials',
  '46': 'Industrials', '47': 'Industrials', '48': 'Communication Services',
  '49': 'Utilities',
  '50': 'Consumer Discretionary', '51': 'Consumer Staples',
  '52': 'Consumer Discretionary', '53': 'Consumer Discretionary',
  '54': 'Consumer Staples', '55': 'Consumer Discretionary',
  '56': 'Consumer Discretionary', '57': 'Consumer Discretionary',
  '58': 'Consumer Discretionary', '59': 'Consumer Discretionary',
  '60': 'Financials', '61': 'Financials', '62': 'Financials',
  '63': 'Financials', '64': 'Financials', '65': 'Real Estate',
  '67': 'Financials',
  '70': 'Consumer Discretionary', '72': 'Consumer Discretionary',
  '73': 'Technology', '75': 'Consumer Discretionary',
  '76': 'Industrials', '78': 'Communication Services',
  '79': 'Communication Services', '80': 'Healthcare',
  '81': 'Technology', '82': 'Consumer Discretionary',
  '83': 'Consumer Discretionary', '84': 'Consumer Discretionary',
  '86': 'Consumer Discretionary', '87': 'Technology',
  '89': 'Technology',
  '91': 'Industrials', '92': 'Industrials', '93': 'Industrials',
  '94': 'Industrials', '95': 'Industrials', '96': 'Industrials',
  '97': 'Industrials', '99': 'Industrials',
}

function sectorFromSic(sic: string | null | undefined): string | null {
  if (!sic) return null
  const prefix = sic.slice(0, 2)
  return SIC_SECTOR_MAP[prefix] ?? null
}

function industryFromSicDesc(sicDesc: string | null | undefined): string | null {
  if (!sicDesc || sicDesc.length < 3) return null
  // Title-case the SIC description for consistency
  return sicDesc
    .toLowerCase()
    .split(/[\s-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 100)
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

  // ── V1 Enrichment Tiers ──
  const TIER1_CURATED = [
    // Benchmarks + Sector ETFs
    'SPY','QQQ','DIA','IWM',
    'XLK','XLV','XLF','XLE','XLY','XLI','XLC','XLP','XLB','XLRE','XLU',
    // Curated equities
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
    // Metals
    'GLD','SLV','COPX','GDX','NEM','FCX','PPLT',
  ]

  // Tier 2: additional high-quality S&P 500 names seeded by Alpaca
  // These are symbols NOT in Tier 1 that have a known sector from seed-symbols SECTOR_MAP
  const TIER2_KNOWN_SECTOR = [
    'CSCO','ADBE','INTC','QCOM','TXN','AMAT','MU','LRCX','KLAC','SNPS','CDNS','MRVL','NOW',
    'CMCSA','T',
    'SBUX','LOW','TJX',
    'MO','CL',
    'GS','MS','BLK','AXP','C','SCHW',
    'PFE','TMO','ABT','DHR','BMY','AMGN','GILD','MDT','SYK',
    'MPC','PSX','VLO',
    'RTX','UNP','LMT','MMM','FDX',
    'D','AEP','EXC',
    'SHW',
    'CCI','SPG',
  ]

  // Build symbol filter based on tier
  let symbolFilter: string[] | null = null
  if (tier === 'tier1') {
    symbolFilter = TIER1_CURATED
  } else if (tier === 'tier2') {
    symbolFilter = TIER2_KNOWN_SECTOR
  } else if (tier === 'tier1+2') {
    symbolFilter = [...TIER1_CURATED, ...TIER2_KNOWN_SECTOR]
  }
  // tier === 'all' → no filter, uses offset pagination

  let symbols: any[] | null = null
  let fetchErr: any = null

  if (symbolFilter) {
    // For tiered enrichment, fetch exact symbols (ignore offset pagination)
    const batch = symbolFilter.slice(offset, offset + batchSize)
    if (batch.length === 0) {
      return jsonRes({ ok: true, done: true, message: `No more symbols in ${tier}.`, offset, enriched: 0, tierTotal: symbolFilter.length })
    }
    const result = await supabase
      .from('symbols')
      .select('symbol, name, exchange, sector, industry, is_active, instrument_type, is_etf, is_adr, enriched_at')
      .in('symbol', batch)
    symbols = result.data
    fetchErr = result.error
    // Filter out already-enriched unless forceRefresh
    if (!forceRefresh && symbols) {
      symbols = symbols.filter((s: any) => !s.enriched_at)
    }
  } else {
    // Original offset-based pagination for 'all'
    let query = supabase
      .from('symbols')
      .select('symbol, name, exchange, sector, industry, is_active, instrument_type, is_etf, is_adr, enriched_at')
      .eq('is_active', true)
      .order('symbol')
      .range(offset, offset + batchSize - 1)
    if (!forceRefresh) {
      query = query.is('enriched_at', null)
    }
    const result = await query
    symbols = result.data
    fetchErr = result.error
  }

  if (fetchErr) {
    return jsonRes({ error: `Fetch error: ${fetchErr.message}` })
  }

  if (!symbols || symbols.length === 0) {
    return jsonRes({ ok: true, done: true, message: `No more symbols to enrich (${tier}).`, offset, enriched: 0, tierTotal: symbolFilter?.length ?? null })
  }

  // Log start
  const { data: logRow } = await supabase
    .from('data_sync_log')
    .insert({
      sync_type: 'enrich',
      status: 'running',
      data_source: 'polygon_ticker_details',
      metadata: { batch_size: batchSize, offset, symbols_count: symbols.length },
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
      // Call Polygon Ticker Details v3
      const url = `https://api.polygon.io/v3/reference/tickers/${sym.symbol}?apiKey=${POLYGON_KEY}`
      const res = await fetch(url)

      if (res.status === 429) {
        // Rate limited, wait and retry once
        await sleep(12000)
        const retryRes = await fetch(url)
        if (!retryRes.ok) {
          failed++
          errors.push(`${sym.symbol}: rate-limited, retry failed ${retryRes.status}`)
          continue
        }
        const retryData = await retryRes.json()
        await processTickerDetails(sym, retryData)
        enriched++
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

      // Rate limit: 5 req/min free tier → 12s between calls
      await sleep(12500)
    } catch (err) {
      failed++
      errors.push(`${sym.symbol}: ${String(err).slice(0, 100)}`)
    }
  }

  // Update log
  await supabase
    .from('data_sync_log')
    .update({
      status: failed === 0 ? 'success' : 'partial',
      symbols_processed: enriched,
      symbols_failed: failed,
      completed_at: new Date().toISOString(),
      error_message: errors.slice(0, 10).join('\n') || null,
      metadata: {
        batch_size: batchSize, offset,
        symbols_count: symbols.length,
        enriched, skipped, failed, promoted,
        promotions: promotions.slice(0, 50),
      },
    })
    .eq('id', logRow?.id)

  const nextOffset = offset + batchSize
  return jsonRes({
    ok: true,
    enriched,
    skipped,
    failed,
    promoted,
    promotions: promotions.slice(0, 20),
    offset,
    nextOffset,
    hasMore: symbols.length === batchSize,
    errors: errors.slice(0, 10),
  })
})

async function processTickerDetails(
  existing: any,
  polygonResponse: any,
): Promise<boolean> {
  const details = polygonResponse?.results
  if (!details) return false

  const rawType = details.type ?? null
  const instrumentType = rawType ? (TYPE_MAP[rawType] ?? rawType) : null
  const isEtf = instrumentType === 'ETF'
  const isAdr = instrumentType === 'ADR'

  // Normalize exchange
  const rawExchange = details.primary_exchange ?? details.exchange ?? null
  const normalizedExchange = rawExchange ? (EXCHANGE_MAP[rawExchange] ?? rawExchange) : null

  // Derive sector from SIC
  const sicCode = details.sic_code ?? null
  const sicDesc = details.sic_description ?? null
  const derivedSector = sectorFromSic(sicCode)
  const derivedIndustry = industryFromSicDesc(sicDesc)

  // Build update — only overwrite if we have better data
  const update: Record<string, any> = {
    enriched_at: new Date().toISOString(),
  }

  // Name — only if existing is null/same-as-symbol
  if (details.name && (!existing.name || existing.name === existing.symbol)) {
    update.name = details.name.slice(0, 200)
  }

  // Exchange — prefer polygon's primary_exchange
  if (normalizedExchange) {
    update.primary_exchange = normalizedExchange
    // Only overwrite exchange if existing was null/Unknown
    if (!existing.exchange || existing.exchange === 'Unknown') {
      update.exchange = normalizedExchange
    }
  }

  // Instrument type — always set from polygon (authoritative)
  if (instrumentType) {
    update.instrument_type = instrumentType
    update.is_etf = isEtf
    update.is_adr = isAdr
  }

  // SIC
  if (sicCode) update.sic_code = sicCode
  if (sicDesc) update.sic_description = sicDesc

  // Sector — only if existing is null/Unknown and we have a derived value
  const existingSector = existing.sector
  if (derivedSector && (!existingSector || existingSector === 'Unknown')) {
    update.sector = derivedSector
  }

  // Industry — only if existing is null/empty and we have a derived value
  const existingIndustry = existing.industry
  if (derivedIndustry && (!existingIndustry || existingIndustry === '')) {
    update.industry = derivedIndustry
  }

  const { error } = await supabase
    .from('symbols')
    .update(update)
    .eq('symbol', existing.symbol)

  if (error) {
    console.error(`Update error for ${existing.symbol}:`, error.message)
    return false
  }

  // Check if this symbol was promoted to full WSP eligibility
  const finalSector = update.sector ?? existingSector
  const finalIndustry = update.industry ?? existingIndustry
  const finalExchange = (update.exchange ?? existing.exchange ?? '').toUpperCase()
  const finalType = update.instrument_type ?? existing.instrument_type

  const isFullWsp =
    existing.is_active &&
    (finalType === 'CS' || finalType === null) &&
    !isEtf && !isAdr &&
    ['NYSE', 'NASDAQ', 'XNYS', 'XNAS'].includes(finalExchange) &&
    finalSector && finalSector !== 'Unknown' &&
    finalIndustry && finalIndustry !== '' &&
    /^[A-Z0-9]{1,5}$/.test(existing.symbol.toUpperCase())

  return isFullWsp
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

function jsonRes(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
