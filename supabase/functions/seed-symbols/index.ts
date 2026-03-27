import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

// Top S&P 500 sector mapping
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
  // Metals ETFs
  GLD: 'Metals & Mining', SLV: 'Metals & Mining', COPX: 'Metals & Mining',
  GDX: 'Metals & Mining', PPLT: 'Metals & Mining',
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
    // Fetch active assets from Alpaca
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

    // Filter to tradeable symbols with short tickers
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
        name: a.name,
        exchange: a.exchange,
        asset_class: 'us_equity',
      }))

    // Build inserts
    const inserts = [
      ...INDEX_SYMBOLS.map((s) => ({
        symbol: s,
        name: s,
        sector: 'Index',
        exchange: 'ARCA',
        asset_class: 'us_equity',
        is_active: true,
      })),
      ...SECTOR_ETFS.map((e) => ({
        symbol: e.symbol,
        name: e.name,
        sector: e.sector,
        exchange: 'ARCA',
        asset_class: 'us_equity',
        is_active: true,
      })),
      ...tradeableSymbols.map((a: any) => ({
        symbol: a.symbol,
        name: a.name,
        sector: SECTOR_MAP[a.symbol] || 'Unknown',
        exchange: a.exchange,
        asset_class: a.asset_class,
        is_active: true,
      })),
    ]

    // Deduplicate by symbol
    const uniqueMap = new Map<string, any>()
    for (const item of inserts) {
      uniqueMap.set(item.symbol, item)
    }
    const uniqueInserts = Array.from(uniqueMap.values())

    // Upsert in batches
    const batches = chunkArray(uniqueInserts, 500)
    for (const batch of batches) {
      await supabase.from('symbols').upsert(batch, { onConflict: 'symbol' })
    }

    return jsonRes({
      ok: true,
      totalSeeded: uniqueInserts.length,
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
