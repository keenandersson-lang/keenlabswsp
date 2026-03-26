// WSP Screener Edge Function — Alpaca-backed with provider-aware caching
// Supports equities + metals/commodities

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const ALPACA_DATA_URL = 'https://data.alpaca.markets/v2';
const HISTORY_CALENDAR_DAYS = 550;
const ROUTE_VERSION = 'supabase-wsp-screener@2026-03-26.4-metals';

interface SymbolMeta {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  assetClass?: string;
}

interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── Provider-aware cache ──
const barCache = new Map<string, { bars: Bar[]; fetchedAt: number; provider: string }>();
const quoteCache = new Map<string, { price: number; change: number; changePercent: number; high: number; low: number; open: number; prevClose: number; timestamp: number; fetchedAt: number; provider: string }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const QUOTE_CACHE_TTL_MS = 2 * 60 * 1000;
const ACTIVE_PROVIDER = 'alpaca';

function getCachedBars(symbol: string): Bar[] | null {
  const cached = barCache.get(symbol);
  if (!cached) return null;
  if (cached.provider !== ACTIVE_PROVIDER) { barCache.delete(symbol); return null; }
  if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) { barCache.delete(symbol); return null; }
  return cached.bars;
}

function getCachedQuote(symbol: string) {
  const cached = quoteCache.get(symbol);
  if (!cached) return null;
  if (cached.provider !== ACTIVE_PROVIDER) { quoteCache.delete(symbol); return null; }
  if (Date.now() - cached.fetchedAt > QUOTE_CACHE_TTL_MS) { quoteCache.delete(symbol); return null; }
  return cached;
}

async function alpacaFetch(path: string, keyId: string, secret: string): Promise<Response> {
  return fetch(`${ALPACA_DATA_URL}${path}`, {
    headers: {
      'Accept': 'application/json',
      'APCA-API-KEY-ID': keyId,
      'APCA-API-SECRET-KEY': secret,
    },
  });
}

interface AlpacaSnapshot {
  latestTrade?: { p: number; t: string };
  dailyBar?: { o: number; h: number; l: number; c: number; v: number; t: string };
  prevDailyBar?: { o: number; h: number; l: number; c: number; v: number; t: string };
}

async function fetchAlpacaSnapshots(
  symbols: string[], keyId: string, secret: string
): Promise<Record<string, { price: number; change: number; changePercent: number; high: number; low: number; open: number; prevClose: number; timestamp: number } | null>> {
  const result: Record<string, any> = {};
  if (symbols.length === 0) return result;

  const uncached: string[] = [];
  for (const sym of symbols) {
    const cached = getCachedQuote(sym);
    if (cached) {
      result[sym] = { price: cached.price, change: cached.change, changePercent: cached.changePercent, high: cached.high, low: cached.low, open: cached.open, prevClose: cached.prevClose, timestamp: cached.timestamp };
    } else {
      uncached.push(sym);
    }
  }

  if (uncached.length === 0) return result;

  try {
    const query = new URLSearchParams({ symbols: uncached.join(','), feed: 'iex' });
    const resp = await alpacaFetch(`/stocks/snapshots?${query}`, keyId, secret);

    if (resp.status === 401 || resp.status === 403) {
      return Object.fromEntries(symbols.map(s => [s, null]));
    }
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`Alpaca snapshots HTTP ${resp.status}: ${text.slice(0, 200)}`);
      return Object.fromEntries(uncached.map(s => [s, null]));
    }

    const data = await resp.json() as Record<string, AlpacaSnapshot>;

    for (const sym of uncached) {
      const snap = data[sym];
      if (!snap?.latestTrade?.p) {
        result[sym] = null;
        continue;
      }

      const price = snap.latestTrade.p;
      const prevClose = snap.prevDailyBar?.c ?? snap.dailyBar?.o ?? price;
      const change = price - prevClose;
      const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;

      const q = {
        price,
        change: Math.round(change * 100) / 100,
        changePercent: Math.round(changePercent * 100) / 100,
        high: snap.dailyBar?.h ?? price,
        low: snap.dailyBar?.l ?? price,
        open: snap.dailyBar?.o ?? price,
        prevClose,
        timestamp: Math.floor(new Date(snap.latestTrade.t).getTime() / 1000),
      };

      quoteCache.set(sym, { ...q, fetchedAt: Date.now(), provider: ACTIVE_PROVIDER });
      result[sym] = q;
    }
  } catch (err) {
    console.error('Alpaca snapshot error:', err);
    for (const sym of uncached) result[sym] = null;
  }

  return result;
}

interface AlpacaBarRaw { t: string; o: number; h: number; l: number; c: number; v: number }

async function fetchAlpacaBars(
  symbols: string[], keyId: string, secret: string
): Promise<Record<string, { bars: Bar[]; stale: boolean; error?: string }>> {
  const results: Record<string, { bars: Bar[]; stale: boolean; error?: string }> = {};

  const uncached: string[] = [];
  for (const sym of symbols) {
    const cached = getCachedBars(sym);
    if (cached) {
      results[sym] = { bars: cached, stale: isDateStale(cached[cached.length - 1]?.date) };
    } else {
      uncached.push(sym);
    }
  }

  if (uncached.length === 0) return results;

  const BATCH = 10;
  for (let i = 0; i < uncached.length; i += BATCH) {
    const batch = uncached.slice(i, i + BATCH);
    try {
      const now = new Date();
      const from = new Date(now);
      from.setUTCDate(now.getUTCDate() - HISTORY_CALENDAR_DAYS);

      const query = new URLSearchParams({
        symbols: batch.join(','),
        timeframe: '1Day',
        start: from.toISOString(),
        end: now.toISOString(),
        adjustment: 'raw',
        sort: 'asc',
        feed: 'iex',
        limit: '10000',
      });

      const resp = await alpacaFetch(`/stocks/bars?${query}`, keyId, secret);

      if (!resp.ok) {
        const text = await resp.text();
        console.error(`Alpaca bars HTTP ${resp.status}: ${text.slice(0, 200)}`);
        for (const sym of batch) results[sym] = { bars: [], stale: true, error: `HTTP ${resp.status}` };
        continue;
      }

      const data = await resp.json() as { bars?: Record<string, AlpacaBarRaw[]> };

      for (const sym of batch) {
        const rawBars = data.bars?.[sym];
        if (!rawBars || rawBars.length === 0) {
          results[sym] = { bars: [], stale: true, error: 'no_data' };
          continue;
        }

        const bars: Bar[] = rawBars.map(b => ({
          date: new Date(b.t).toISOString().slice(0, 10),
          open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
        })).filter(b => Number.isFinite(b.close) && Number.isFinite(b.volume));

        barCache.set(sym, { bars, fetchedAt: Date.now(), provider: ACTIVE_PROVIDER });
        const stale = isDateStale(bars[bars.length - 1]?.date);
        results[sym] = { bars, stale };
      }
    } catch (err) {
      console.error('Alpaca bars batch error:', err);
      for (const sym of batch) results[sym] = { bars: [], stale: true, error: 'fetch_error' };
    }
  }

  return results;
}

function isDateStale(dateStr?: string): boolean {
  if (!dateStr) return true;
  const barDate = new Date(`${dateStr}T00:00:00Z`);
  const now = new Date();
  const diffDays = (now.getTime() - barDate.getTime()) / 86400000;
  const weekday = now.getUTCDay();
  const allowed = weekday === 0 || weekday === 1 ? 3.5 : 1.5;
  return diffDays > allowed;
}

const TRACKED_SYMBOLS: SymbolMeta[] = [
  // Equities
  { symbol: 'NVDA', name: 'NVIDIA Corp', sector: 'Technology', industry: 'Semiconductors', assetClass: 'equity' },
  { symbol: 'AAPL', name: 'Apple Inc', sector: 'Technology', industry: 'Consumer Electronics', assetClass: 'equity' },
  { symbol: 'MSFT', name: 'Microsoft Corp', sector: 'Technology', industry: 'Software', assetClass: 'equity' },
  { symbol: 'AMZN', name: 'Amazon.com Inc', sector: 'Consumer Discretionary', industry: 'E-Commerce', assetClass: 'equity' },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Communication Services', industry: 'Social Media', assetClass: 'equity' },
  { symbol: 'TSLA', name: 'Tesla Inc', sector: 'Consumer Discretionary', industry: 'Auto Manufacturers', assetClass: 'equity' },
  { symbol: 'GOOGL', name: 'Alphabet Inc', sector: 'Communication Services', industry: 'Internet Services', assetClass: 'equity' },
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financials', industry: 'Banks', assetClass: 'equity' },
  { symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy', industry: 'Oil & Gas', assetClass: 'equity' },
  { symbol: 'LLY', name: 'Eli Lilly', sector: 'Healthcare', industry: 'Pharmaceuticals', assetClass: 'equity' },
  { symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare', industry: 'Health Insurance', assetClass: 'equity' },
  { symbol: 'CAT', name: 'Caterpillar Inc', sector: 'Industrials', industry: 'Construction Equipment', assetClass: 'equity' },
  { symbol: 'BA', name: 'Boeing Co', sector: 'Industrials', industry: 'Aerospace & Defense', assetClass: 'equity' },
  { symbol: 'AVGO', name: 'Broadcom Inc', sector: 'Technology', industry: 'Semiconductors', assetClass: 'equity' },
  { symbol: 'V', name: 'Visa Inc', sector: 'Financials', industry: 'Payment Processing', assetClass: 'equity' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', industry: 'Semiconductors', assetClass: 'equity' },
  { symbol: 'NFLX', name: 'Netflix Inc', sector: 'Communication Services', industry: 'Streaming', assetClass: 'equity' },
  { symbol: 'CRM', name: 'Salesforce Inc', sector: 'Technology', industry: 'Software', assetClass: 'equity' },
  { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer Discretionary', industry: 'Retail', assetClass: 'equity' },
  { symbol: 'HD', name: 'Home Depot Inc', sector: 'Consumer Discretionary', industry: 'Home Improvement', assetClass: 'equity' },
  // Metals & Mining
  { symbol: 'GLD', name: 'SPDR Gold Trust', sector: 'Metals & Mining', industry: 'Gold', assetClass: 'metals' },
  { symbol: 'SLV', name: 'iShares Silver Trust', sector: 'Metals & Mining', industry: 'Silver', assetClass: 'metals' },
  { symbol: 'COPX', name: 'Global X Copper Miners', sector: 'Metals & Mining', industry: 'Copper', assetClass: 'metals' },
  { symbol: 'GDX', name: 'VanEck Gold Miners ETF', sector: 'Metals & Mining', industry: 'Gold Miners', assetClass: 'metals' },
  { symbol: 'NEM', name: 'Newmont Corp', sector: 'Metals & Mining', industry: 'Gold Miners', assetClass: 'metals' },
  { symbol: 'FCX', name: 'Freeport-McMoRan', sector: 'Metals & Mining', industry: 'Copper', assetClass: 'metals' },
  { symbol: 'PPLT', name: 'abrdn Platinum ETF', sector: 'Metals & Mining', industry: 'Platinum', assetClass: 'metals' },
];

const BENCHMARK = 'SPY';
const MARKET_REGIME_SYMBOLS = ['SPY', 'QQQ'];
const SECTOR_ETFS: Record<string, string[]> = {
  Technology: ['XLK'],
  Healthcare: ['XLV'],
  Financials: ['XLF'],
  Energy: ['XLE'],
  'Consumer Discretionary': ['XLY'],
  Industrials: ['XLI'],
  'Communication Services': ['XLC'],
  'Consumer Staples': ['XLP'],
  Materials: ['XLB'],
  'Real Estate': ['XLRE'],
  Utilities: ['XLU'],
  'Metals & Mining': ['GDX'],
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const keyId = Deno.env.get('ALPACA_API_KEY_ID')?.trim();
    const secret = Deno.env.get('ALPACA_API_SECRET_KEY')?.trim();

    if (!keyId || !secret) {
      return jsonResponse(200, {
        ok: false, mode: 'FALLBACK', data: null,
        error: { code: 'NO_API_KEY', message: 'Market data provider not configured.' },
        providerStatus: {
          provider: 'alpaca', isLive: false, apiKeyPresent: false,
          routeVersion: ROUTE_VERSION,
          finalModeReason: 'Missing ALPACA_API_KEY_ID or ALPACA_API_SECRET_KEY.',
          fallbackCause: 'misconfiguration',
        },
      });
    }

    const allEtfs = [...new Set(Object.values(SECTOR_ETFS).flat())];
    const allQuoteSymbols = [...new Set([
      ...MARKET_REGIME_SYMBOLS,
      ...allEtfs,
      ...TRACKED_SYMBOLS.map(s => s.symbol),
    ])];

    const snapshots = await fetchAlpacaSnapshots(allQuoteSymbols, keyId, secret);

    const spySnap = snapshots['SPY'];
    const qqqSnap = snapshots['QQQ'];

    if (spySnap === null && qqqSnap === null) {
      return jsonResponse(200, {
        ok: false, mode: 'FALLBACK', data: null,
        error: { code: 'API_KEY_INVALID', message: 'Market data provider authentication failed.' },
        providerStatus: {
          provider: 'alpaca', isLive: false, apiKeyPresent: true, apiKeyValid: false,
          routeVersion: ROUTE_VERSION,
          finalModeReason: 'Alpaca rejected credentials or returned no benchmark data.',
          fallbackCause: 'misconfiguration',
        },
      });
    }

    const benchmarkSuccessCount = MARKET_REGIME_SYMBOLS.filter(s => snapshots[s] !== null).length;

    const allBarSymbols = [...new Set([
      ...MARKET_REGIME_SYMBOLS,
      ...allEtfs,
      ...TRACKED_SYMBOLS.map(s => s.symbol),
    ])];

    const barResults = await fetchAlpacaBars(allBarSymbols, keyId, secret);

    const marketBars: Record<string, Bar[]> = {};
    const sectorEtfBars: Record<string, Bar[]> = {};
    const stockBarData: Record<string, Bar[]> = {};
    const failedSymbols: string[] = [];
    let benchmarkBars: Bar[] = [];

    const spyBars = barResults['SPY'];
    benchmarkBars = spyBars?.bars ?? [];

    for (const sym of MARKET_REGIME_SYMBOLS) {
      const r = barResults[sym];
      if (r && r.bars.length > 0) marketBars[sym] = r.bars;
    }
    for (const sym of allEtfs) {
      const r = barResults[sym];
      if (r && r.bars.length > 0) sectorEtfBars[sym] = r.bars;
    }
    for (const meta of TRACKED_SYMBOLS) {
      const r = barResults[meta.symbol];
      if (!r || r.bars.length === 0) {
        failedSymbols.push(meta.symbol);
      } else {
        stockBarData[meta.symbol] = r.bars;
      }
    }

    const hasCandleAccess = benchmarkBars.length > 50;
    const anyStale = [...Object.values(barResults)].some(r => r.stale);
    const mode = hasCandleAccess ? (anyStale ? 'STALE' : 'LIVE') : 'STALE';

    const quotesMap: Record<string, any> = {};
    for (const [sym, snap] of Object.entries(snapshots)) {
      if (snap) quotesMap[sym] = snap;
    }

    return jsonResponse(200, {
      ok: true,
      mode,
      data: {
        trackedSymbols: TRACKED_SYMBOLS,
        stockBars: stockBarData,
        benchmarkBars,
        benchmarkSymbol: BENCHMARK,
        marketBars,
        sectorEtfBars,
        sectorMap: SECTOR_ETFS,
        marketRegimeSymbols: MARKET_REGIME_SYMBOLS,
      },
      quotes: quotesMap,
      error: failedSymbols.length > 0 ? {
        code: 'PARTIAL_FAILURE',
        message: `${failedSymbols.length} symbols had no bar data.`,
        failedSymbols,
      } : null,
      providerStatus: {
        provider: 'alpaca',
        isLive: mode === 'LIVE',
        apiKeyPresent: true,
        apiKeyValid: true,
        hasCandleAccess,
        symbolsFetched: Object.keys(stockBarData).length,
        symbolsFailed: failedSymbols.length,
        totalSymbols: TRACKED_SYMBOLS.length,
        quotesAvailable: Object.keys(quotesMap).length,
        fetchedAt: new Date().toISOString(),
        cachedSymbols: barCache.size,
        routeVersion: ROUTE_VERSION,
        benchmarkSuccessCount,
        benchmarkFailureCount: MARKET_REGIME_SYMBOLS.length - benchmarkSuccessCount,
        finalModeReason: hasCandleAccess
          ? (anyStale ? `Alpaca bars available but some stale. ${TRACKED_SYMBOLS.length} symbols (incl. metals). Benchmarks: ${benchmarkSuccessCount}/2.` : `Full live Alpaca data. ${TRACKED_SYMBOLS.length} symbols (incl. metals). Benchmarks: ${benchmarkSuccessCount}/2.`)
          : `Alpaca quotes live but insufficient bar history. ${Object.keys(quotesMap).length} quotes available.`,
        fallbackCause: mode === 'LIVE' ? 'none' : 'necessary',
        cacheInvalidated: true,
        activeProvider: ACTIVE_PROVIDER,
      },
    });
  } catch (err) {
    console.error('WSP screener unhandled error:', err);
    return jsonResponse(500, {
      ok: false, mode: 'ERROR', data: null,
      error: { code: 'SERVER_ERROR', message: 'Market data temporarily unavailable.' },
      providerStatus: {
        provider: 'alpaca', isLive: false, apiKeyPresent: true,
        routeVersion: ROUTE_VERSION,
        finalModeReason: 'Unhandled edge runtime error.',
        fallbackCause: 'necessary',
      },
    });
  }
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
