// Multi-source enrichment fallback chain: Polygon → Finnhub → Yahoo → Alpaca
// Returns normalized ticker details from whichever source succeeds first.

export interface NormalizedTickerDetails {
  source: 'polygon' | 'finnhub' | 'yahoo' | 'alpaca'
  name: string | null
  exchange: string | null            // raw exchange/MIC code
  type: string | null                // raw type code (CS, ETF, ADRC, etc.)
  sector: string | null              // raw sector label
  industry: string | null            // raw industry label
  sicCode: string | null
  sicDescription: string | null
  isEtf: boolean
  isAdr: boolean
  isCommonStock: boolean
  marketCap: number | null
  description: string | null
}

const POLYGON_KEY = Deno.env.get('POLYGON_API_KEY') ?? ''
const FINNHUB_KEY = Deno.env.get('FINNHUB_API_KEY') ?? ''
const ALPACA_KEY = Deno.env.get('ALPACA_API_KEY_ID') ?? ''
const ALPACA_SECRET = Deno.env.get('ALPACA_API_SECRET_KEY') ?? ''

function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s.length ? s : null
}

// ---------- Polygon ----------
async function fromPolygon(symbol: string, signal?: AbortSignal): Promise<NormalizedTickerDetails | null> {
  if (!POLYGON_KEY) return null
  try {
    const r = await fetch(`https://api.polygon.io/v3/reference/tickers/${symbol}?apiKey=${POLYGON_KEY}`, { signal })
    if (r.status === 429) throw new Error('polygon_429')
    if (!r.ok) return null
    const j = await r.json().catch(() => null)
    const d = j?.results
    if (!d) return null
    const type = txt(d.type)
    return {
      source: 'polygon',
      name: txt(d.name),
      exchange: txt(d.primary_exchange ?? d.exchange),
      type,
      sector: txt(d.market ?? d.sector),
      industry: txt(d.industry),
      sicCode: txt(d.sic_code),
      sicDescription: txt(d.sic_description),
      isEtf: type === 'ETF' || type === 'ETN' || type === 'ETV',
      isAdr: type === 'ADRC' || type === 'ADRR' || type === 'ADRW',
      isCommonStock: type === 'CS',
    }
  } catch (e) {
    if (String(e).includes('polygon_429')) throw e
    return null
  }
}

// ---------- Finnhub ----------
async function fromFinnhub(symbol: string, signal?: AbortSignal): Promise<NormalizedTickerDetails | null> {
  if (!FINNHUB_KEY) return null
  try {
    const r = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${FINNHUB_KEY}`, { signal })
    if (r.status === 429) throw new Error('finnhub_429')
    if (!r.ok) return null
    const d = await r.json().catch(() => null)
    if (!d || !d.name) return null
    const industry = txt(d.finnhubIndustry)
    return {
      source: 'finnhub',
      name: txt(d.name),
      exchange: txt(d.exchange),
      type: 'CS',  // Finnhub stock/profile2 only returns common stocks
      sector: industry, // Finnhub merges sector/industry
      industry,
      sicCode: null,
      sicDescription: industry,
      isEtf: false,
      isAdr: false,
      isCommonStock: true,
    }
  } catch (e) {
    if (String(e).includes('finnhub_429')) throw e
    return null
  }
}

// ---------- Yahoo Finance ----------
async function fromYahoo(symbol: string, signal?: AbortSignal): Promise<NormalizedTickerDetails | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=assetProfile,quoteType`
    const r = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WSP-Bot/1.0)' },
    })
    if (!r.ok) return null
    const j = await r.json().catch(() => null)
    const result = j?.quoteSummary?.result?.[0]
    if (!result) return null
    const profile = result.assetProfile ?? {}
    const quoteType = result.quoteType ?? {}
    const qt = txt(quoteType.quoteType)?.toUpperCase()
    const isEtf = qt === 'ETF'
    const isAdr = false
    const isCommonStock = qt === 'EQUITY'
    return {
      source: 'yahoo',
      name: txt(quoteType.longName ?? quoteType.shortName),
      exchange: txt(quoteType.exchange),
      type: isEtf ? 'ETF' : isCommonStock ? 'CS' : qt,
      sector: txt(profile.sector),
      industry: txt(profile.industry),
      sicCode: null,
      sicDescription: txt(profile.industry),
      isEtf,
      isAdr,
      isCommonStock,
    }
  } catch {
    return null
  }
}

// ---------- Alpaca ----------
async function fromAlpaca(symbol: string, signal?: AbortSignal): Promise<NormalizedTickerDetails | null> {
  if (!ALPACA_KEY || !ALPACA_SECRET) return null
  try {
    const r = await fetch(`https://api.alpaca.markets/v2/assets/${symbol}`, {
      signal,
      headers: { 'APCA-API-KEY-ID': ALPACA_KEY, 'APCA-API-SECRET-KEY': ALPACA_SECRET },
    })
    if (!r.ok) return null
    const d = await r.json().catch(() => null)
    if (!d || !d.symbol) return null
    // Alpaca only confirms tradability/exchange, not sector/industry
    return {
      source: 'alpaca',
      name: txt(d.name),
      exchange: txt(d.exchange),
      type: d.class === 'us_equity' ? 'CS' : null,
      sector: null,
      industry: null,
      sicCode: null,
      sicDescription: null,
      isEtf: false,
      isAdr: false,
      isCommonStock: d.class === 'us_equity' && d.tradable === true,
    }
  } catch {
    return null
  }
}

export interface EnrichOutcome {
  details: NormalizedTickerDetails | null
  attempted: string[]
  succeededVia: string | null
  hardRateLimited: boolean   // true if Polygon AND Finnhub both 429'd → caller should pause batch
}

/**
 * Try sources in order. Stop at the first one that returns enough info to classify
 * (sector OR industry OR SIC). Polygon/Finnhub 429 propagates so caller can back off.
 */
export async function enrichSymbolMultiSource(symbol: string, opts?: {
  skipPolygon?: boolean
  signal?: AbortSignal
}): Promise<EnrichOutcome> {
  const attempted: string[] = []
  let polyRateLimited = false
  let finRateLimited = false

  if (!opts?.skipPolygon) {
    attempted.push('polygon')
    try {
      const d = await fromPolygon(symbol, opts?.signal)
      if (d && (d.sector || d.industry || d.sicCode || d.sicDescription)) {
        return { details: d, attempted, succeededVia: 'polygon', hardRateLimited: false }
      }
    } catch (e) {
      if (String(e).includes('polygon_429')) polyRateLimited = true
    }
  }

  attempted.push('finnhub')
  try {
    const d = await fromFinnhub(symbol, opts?.signal)
    if (d && (d.sector || d.industry)) {
      return { details: d, attempted, succeededVia: 'finnhub', hardRateLimited: false }
    }
  } catch (e) {
    if (String(e).includes('finnhub_429')) finRateLimited = true
  }

  attempted.push('yahoo')
  const yd = await fromYahoo(symbol, opts?.signal)
  if (yd && (yd.sector || yd.industry)) {
    return { details: yd, attempted, succeededVia: 'yahoo', hardRateLimited: false }
  }

  attempted.push('alpaca')
  const ad = await fromAlpaca(symbol, opts?.signal)
  if (ad) {
    // Alpaca confirms exchange/tradability even without sector — useful for promotion gating
    return { details: ad, attempted, succeededVia: 'alpaca', hardRateLimited: false }
  }

  return {
    details: null,
    attempted,
    succeededVia: null,
    hardRateLimited: polyRateLimited && finRateLimited,
  }
}

// ---------- Multi-source price bar fallback (for daily-sync) ----------
export interface DailyBar { o: number; h: number; l: number; c: number; v: number; source: string }

export async function fetchAlpacaBar(symbol: string, date: string): Promise<DailyBar | null> {
  if (!ALPACA_KEY || !ALPACA_SECRET) return null
  try {
    // Alpaca v2 bars: end is exclusive, so add 1 day
    const start = `${date}T00:00:00Z`
    const endDate = new Date(date + 'T00:00:00Z')
    endDate.setUTCDate(endDate.getUTCDate() + 1)
    const end = endDate.toISOString().slice(0, 19) + 'Z'
    const url = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=1Day&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&adjustment=raw&feed=iex`
    const r = await fetch(url, {
      headers: { 'APCA-API-KEY-ID': ALPACA_KEY, 'APCA-API-SECRET-KEY': ALPACA_SECRET },
    })
    if (!r.ok) return null
    const j = await r.json().catch(() => null)
    const b = j?.bars?.[0]
    if (!b) return null
    return { o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, source: 'alpaca_iex' }
  } catch {
    return null
  }
}

export async function fetchYahooBar(symbol: string, date: string): Promise<DailyBar | null> {
  try {
    const start = Math.floor(new Date(date + 'T00:00:00Z').getTime() / 1000)
    const end = start + 86400 * 2
    const url = `https://query1.finance.yahoo.com/v7/finance/download/${symbol}?period1=${start}&period2=${end}&interval=1d&events=history`
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WSP-Bot/1.0)' } })
    if (!r.ok) {
      // Fallback to chart API (sometimes download blocks)
      const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${start}&period2=${end}&interval=1d`
      const cr = await fetch(chartUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WSP-Bot/1.0)' } })
      if (!cr.ok) return null
      const cj = await cr.json().catch(() => null)
      const result = cj?.chart?.result?.[0]
      const ts = result?.timestamp ?? []
      const q = result?.indicators?.quote?.[0]
      if (!q || ts.length === 0) return null
      // Match the row whose date matches `date`
      for (let i = 0; i < ts.length; i++) {
        const d = new Date(ts[i] * 1000).toISOString().slice(0, 10)
        if (d === date && typeof q.close?.[i] === 'number') {
          return {
            o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i],
            v: q.volume[i] ?? 0, source: 'yahoo',
          }
        }
      }
      return null
    }
    const csv = await r.text()
    const lines = csv.trim().split('\n')
    if (lines.length < 2) return null
    for (const line of lines.slice(1)) {
      const parts = line.split(',')
      if (parts[0] === date) {
        return {
          o: Number(parts[1]), h: Number(parts[2]), l: Number(parts[3]),
          c: Number(parts[4]), v: Number(parts[6] ?? 0), source: 'yahoo',
        }
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Multi-source single-bar fallback for daily-sync: Alpaca → Yahoo
 * (Polygon already tried via grouped daily upstream.)
 */
export async function fetchBarMultiSource(symbol: string, date: string): Promise<DailyBar | null> {
  const a = await fetchAlpacaBar(symbol, date)
  if (a) return a
  const y = await fetchYahooBar(symbol, date)
  if (y) return y
  return null
}
