// WSP Screener Edge Function — Finnhub free-tier compatible
// Uses /quote for live prices; /stock/candle for history (paid tier only)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const HISTORY_CALENDAR_DAYS = 550;
const ROUTE_VERSION = 'supabase-wsp-screener@2026-03-26.2';

interface SymbolMeta {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
}

interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FinnhubQuote {
  c: number;  // current
  d: number;  // change
  dp: number; // change percent
  h: number;  // high
  l: number;  // low
  o: number;  // open
  pc: number; // prev close
  t: number;  // timestamp
  error?: string;
}

interface FinnhubCandleResponse {
  c?: number[];
  h?: number[];
  l?: number[];
  o?: number[];
  s?: 'ok' | 'no_data';
  t?: number[];
  v?: number[];
  error?: string;
}

// ── In-memory cache ──
const barCache = new Map<string, { bars: Bar[]; fetchedAt: number }>();
const quoteCache = new Map<string, { quote: FinnhubQuote; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const QUOTE_CACHE_TTL_MS = 2 * 60 * 1000;

// ── Rate limiting ──
let lastRequestTime = 0;
const MIN_REQUEST_GAP_MS = 120;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const wait = MIN_REQUEST_GAP_MS - (now - lastRequestTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return fetch(url, { headers: { Accept: 'application/json' } });
}

// Fetch live quote (works on free tier)
async function fetchQuote(symbol: string, apiKey: string): Promise<{ quote: FinnhubQuote | null; error?: string }> {
  const cached = quoteCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < QUOTE_CACHE_TTL_MS) {
    return { quote: cached.quote };
  }

  try {
    const url = `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
    const resp = await rateLimitedFetch(url);

    if (resp.status === 401 || resp.status === 403) {
      return { quote: null, error: 'API_KEY_INVALID' };
    }
    if (!resp.ok) {
      return { quote: null, error: `HTTP ${resp.status}` };
    }

    const data = await resp.json() as FinnhubQuote;
    if (data.error) {
      return { quote: null, error: data.error };
    }
    // Finnhub returns zeroes for invalid symbols
    if (data.c === 0 && data.pc === 0 && data.t === 0) {
      return { quote: null, error: 'no_data' };
    }

    quoteCache.set(symbol, { quote: data, fetchedAt: Date.now() });
    return { quote: data };
  } catch (_err) {
    return { quote: null, error: 'Provider temporarily unavailable' };
  }
}

// Fetch historical bars (requires paid tier)
async function fetchBars(symbol: string, apiKey: string): Promise<{ bars: Bar[]; stale: boolean; error?: string }> {
  const cached = barCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { bars: cached.bars, stale: false };
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - HISTORY_CALENDAR_DAYS * 86400;
    const url = `${FINNHUB_BASE_URL}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}&token=${apiKey}`;
    const resp = await rateLimitedFetch(url);

    if (resp.status === 401 || resp.status === 403) {
      return { bars: [], stale: true, error: 'ACCESS_DENIED' };
    }
    if (!resp.ok) {
      return { bars: [], stale: true, error: `HTTP ${resp.status}` };
    }

    const data = await resp.json() as FinnhubCandleResponse;
    if (data.error) {
      // "You don't have access to this resource." = free tier limitation
      if (data.error.includes("don't have access")) {
        return { bars: [], stale: true, error: 'FREE_TIER_NO_CANDLES' };
      }
      return { bars: [], stale: true, error: data.error };
    }
    if (data.s !== 'ok' || !data.t?.length) {
      return { bars: [], stale: true, error: `no_data for ${symbol}` };
    }

    const bars: Bar[] = data.t.map((ts: number, i: number) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: data.o![i],
      high: data.h![i],
      low: data.l![i],
      close: data.c![i],
      volume: data.v![i],
    })).filter((b: Bar) => Number.isFinite(b.close) && Number.isFinite(b.volume));

    barCache.set(symbol, { bars, fetchedAt: Date.now() });

    const lastDate = bars[bars.length - 1]?.date;
    const stale = isDateStale(lastDate);
    return { bars, stale };
  } catch (_err) {
    return { bars: [], stale: true, error: 'Provider temporarily unavailable' };
  }
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

// Build a minimal 2-bar series from a quote so client can compute daily change
function quoteToBars(quote: FinnhubQuote): Bar[] {
  const today = new Date(quote.t * 1000).toISOString().slice(0, 10);
  const yesterday = new Date((quote.t - 86400) * 1000).toISOString().slice(0, 10);
  return [
    { date: yesterday, open: quote.pc, high: quote.pc, low: quote.pc, close: quote.pc, volume: 0 },
    { date: today, open: quote.o, high: quote.h, low: quote.l, close: quote.c, volume: 0 },
  ];
}

const TRACKED_SYMBOLS: SymbolMeta[] = [
  { symbol: 'NVDA', name: 'NVIDIA Corp', sector: 'Technology', industry: 'Semiconductors' },
  { symbol: 'AAPL', name: 'Apple Inc', sector: 'Technology', industry: 'Consumer Electronics' },
  { symbol: 'MSFT', name: 'Microsoft Corp', sector: 'Technology', industry: 'Software' },
  { symbol: 'AMZN', name: 'Amazon.com Inc', sector: 'Consumer Discretionary', industry: 'E-Commerce' },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Communication Services', industry: 'Social Media' },
  { symbol: 'TSLA', name: 'Tesla Inc', sector: 'Consumer Discretionary', industry: 'Auto Manufacturers' },
  { symbol: 'GOOGL', name: 'Alphabet Inc', sector: 'Communication Services', industry: 'Internet Services' },
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financials', industry: 'Banks' },
  { symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy', industry: 'Oil & Gas' },
  { symbol: 'LLY', name: 'Eli Lilly', sector: 'Healthcare', industry: 'Pharmaceuticals' },
  { symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare', industry: 'Health Insurance' },
  { symbol: 'CAT', name: 'Caterpillar Inc', sector: 'Industrials', industry: 'Construction Equipment' },
  { symbol: 'BA', name: 'Boeing Co', sector: 'Industrials', industry: 'Aerospace & Defense' },
  { symbol: 'AVGO', name: 'Broadcom Inc', sector: 'Technology', industry: 'Semiconductors' },
  { symbol: 'V', name: 'Visa Inc', sector: 'Financials', industry: 'Payment Processing' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', industry: 'Semiconductors' },
  { symbol: 'NFLX', name: 'Netflix Inc', sector: 'Communication Services', industry: 'Streaming' },
  { symbol: 'CRM', name: 'Salesforce Inc', sector: 'Technology', industry: 'Software' },
  { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer Discretionary', industry: 'Retail' },
  { symbol: 'HD', name: 'Home Depot Inc', sector: 'Consumer Discretionary', industry: 'Home Improvement' },
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
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('FINNHUB_API_KEY');
    if (!apiKey) {
      return jsonResponse(200, {
        ok: false, mode: 'FALLBACK', data: null,
        error: { code: 'NO_API_KEY', message: 'Market data provider not configured.' },
        providerStatus: {
          provider: 'none', isLive: false, apiKeyPresent: false,
          routeVersion: ROUTE_VERSION,
          finalModeReason: 'Missing FINNHUB_API_KEY.',
          fallbackCause: 'misconfiguration',
        },
      });
    }

    // Step 1: Validate API key with a quick SPY quote
    const spyQuoteResult = await fetchQuote('SPY', apiKey);
    if (spyQuoteResult.error === 'API_KEY_INVALID') {
      return jsonResponse(200, {
        ok: false, mode: 'FALLBACK', data: null,
        error: { code: 'API_KEY_INVALID', message: 'Market data provider authentication failed.' },
        providerStatus: {
          provider: 'finnhub', isLive: false, apiKeyPresent: true, apiKeyValid: false,
          routeVersion: ROUTE_VERSION,
          finalModeReason: 'Finnhub rejected the API key.',
          fallbackCause: 'misconfiguration',
        },
      });
    }

    // Step 2: Try to fetch candle history for SPY first (tests paid tier access)
    const spyCandleResult = await fetchBars('SPY', apiKey);
    const hasCandleAccess = spyCandleResult.error !== 'FREE_TIER_NO_CANDLES' && spyCandleResult.error !== 'ACCESS_DENIED' && spyCandleResult.bars.length > 0;

    // Step 3: Fetch quotes for all key symbols (always works on free tier)
    const allQuoteSymbols = [...new Set([
      ...MARKET_REGIME_SYMBOLS,
      ...Object.values(SECTOR_ETFS).flat(),
      ...TRACKED_SYMBOLS.map(s => s.symbol),
    ])];

    const quoteResults = new Map<string, FinnhubQuote | null>();
    // SPY already fetched
    quoteResults.set('SPY', spyQuoteResult.quote);

    const remainingQuoteSymbols = allQuoteSymbols.filter(s => s !== 'SPY');
    const BATCH_SIZE = 5;
    for (let i = 0; i < remainingQuoteSymbols.length; i += BATCH_SIZE) {
      const batch = remainingQuoteSymbols.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(sym => fetchQuote(sym, apiKey)));
      batch.forEach((sym, idx) => quoteResults.set(sym, batchResults[idx].quote));
    }

    // Step 4: If candle access available, fetch full history
    const candleResults = new Map<string, { bars: Bar[]; stale: boolean; error?: string }>();
    candleResults.set('SPY', spyCandleResult);

    if (hasCandleAccess) {
      const allCandleSymbols = [...new Set([
        ...MARKET_REGIME_SYMBOLS.filter(s => s !== 'SPY'),
        ...Object.values(SECTOR_ETFS).flat(),
        ...TRACKED_SYMBOLS.map(s => s.symbol),
      ])];

      for (let i = 0; i < allCandleSymbols.length; i += BATCH_SIZE) {
        const batch = allCandleSymbols.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(sym => fetchBars(sym, apiKey)));
        batch.forEach((sym, idx) => candleResults.set(sym, batchResults[idx]));
      }
    }

    // Build response
    const allEtfs = [...new Set(Object.values(SECTOR_ETFS).flat())];

    // Benchmark data
    const spyQuote = quoteResults.get('SPY');
    const qqqQuote = quoteResults.get('QQQ');
    const benchmarkQuotesAvailable = spyQuote !== null && qqqQuote !== null;

    if (!benchmarkQuotesAvailable) {
      return jsonResponse(200, {
        ok: false, mode: 'FALLBACK', data: null,
        error: { code: 'BENCHMARK_UNAVAILABLE', message: 'Market benchmarks currently unavailable.' },
        providerStatus: {
          provider: 'finnhub', isLive: false, apiKeyPresent: true, apiKeyValid: true,
          routeVersion: ROUTE_VERSION,
          benchmarkSuccessCount: 0, benchmarkFailureCount: 2,
          finalModeReason: 'Could not fetch benchmark quotes for SPY/QQQ.',
          fallbackCause: 'necessary',
        },
      });
    }

    // Build market bars from candles if available, or from quotes
    const marketBars: Record<string, Bar[]> = {};
    const sectorEtfBars: Record<string, Bar[]> = {};
    const stockBarData: Record<string, Bar[]> = {};
    const failedSymbols: string[] = [];
    let benchmarkBars: Bar[] = [];

    if (hasCandleAccess) {
      // Full candle data available (paid tier)
      const spyCandles = candleResults.get('SPY');
      benchmarkBars = spyCandles?.bars ?? [];

      for (const sym of MARKET_REGIME_SYMBOLS) {
        const r = candleResults.get(sym);
        if (r && r.bars.length > 0) marketBars[sym] = r.bars;
      }
      for (const sym of allEtfs) {
        const r = candleResults.get(sym);
        if (r && r.bars.length > 0) sectorEtfBars[sym] = r.bars;
      }
      for (const meta of TRACKED_SYMBOLS) {
        const r = candleResults.get(meta.symbol);
        if (!r || r.bars.length === 0) {
          failedSymbols.push(meta.symbol);
        } else {
          stockBarData[meta.symbol] = r.bars;
        }
      }
    } else {
      // Free tier: use quote-derived mini bars for price display
      for (const sym of MARKET_REGIME_SYMBOLS) {
        const q = quoteResults.get(sym);
        if (q) marketBars[sym] = quoteToBars(q);
      }
      benchmarkBars = spyQuote ? quoteToBars(spyQuote) : [];

      for (const sym of allEtfs) {
        const q = quoteResults.get(sym);
        if (q) sectorEtfBars[sym] = quoteToBars(q);
      }
      // Stock-level bars not available on free tier (no history for WSP engine)
      for (const meta of TRACKED_SYMBOLS) {
        failedSymbols.push(meta.symbol);
      }
    }

    const benchmarkSuccessCount = MARKET_REGIME_SYMBOLS.filter(s => quoteResults.get(s) !== null).length;
    const benchmarkFailureCount = MARKET_REGIME_SYMBOLS.length - benchmarkSuccessCount;
    const anyStale = !hasCandleAccess || [...candleResults.values()].some(r => r.stale);

    // Determine mode
    // LIVE = full candle access and data is fresh
    // STALE = candle access but data is stale, OR free tier with live quotes
    const mode = hasCandleAccess ? (anyStale ? 'STALE' : 'LIVE') : 'STALE';

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
      // Include live quotes for client-side price rendering
      quotes: Object.fromEntries(
        [...quoteResults.entries()].filter(([_, q]) => q !== null).map(([sym, q]) => [sym, {
          price: q!.c,
          change: q!.d,
          changePercent: q!.dp,
          high: q!.h,
          low: q!.l,
          open: q!.o,
          prevClose: q!.pc,
          timestamp: q!.t,
        }])
      ),
      error: failedSymbols.length > 0 ? {
        code: hasCandleAccess ? 'PARTIAL_FAILURE' : 'FREE_TIER_QUOTES_ONLY',
        message: hasCandleAccess
          ? 'Some symbols temporarily unavailable.'
          : 'Live quotes active. Historical analysis requires Finnhub premium for full WSP engine.',
        failedSymbols,
      } : null,
      providerStatus: {
        provider: 'finnhub',
        isLive: mode === 'LIVE',
        apiKeyPresent: true,
        apiKeyValid: true,
        hasCandleAccess,
        symbolsFetched: Object.keys(stockBarData).length,
        symbolsFailed: failedSymbols.length,
        totalSymbols: TRACKED_SYMBOLS.length,
        quotesAvailable: [...quoteResults.values()].filter(q => q !== null).length,
        fetchedAt: new Date().toISOString(),
        cachedSymbols: barCache.size,
        routeVersion: ROUTE_VERSION,
        benchmarkSuccessCount,
        benchmarkFailureCount,
        finalModeReason: hasCandleAccess
          ? (anyStale ? `Candle data available but stale. Benchmark: ${benchmarkSuccessCount}/${MARKET_REGIME_SYMBOLS.length}.` : `Full live candle data. Benchmark: ${benchmarkSuccessCount}/${MARKET_REGIME_SYMBOLS.length}.`)
          : `Free tier: ${[...quoteResults.values()].filter(q => q !== null).length} live quotes active. No candle history (requires paid Finnhub plan for full WSP analysis).`,
        fallbackCause: mode === 'LIVE' ? 'none' : 'necessary',
      },
    });
  } catch (_err) {
    return jsonResponse(500, {
      ok: false, mode: 'ERROR', data: null,
      error: { code: 'SERVER_ERROR', message: 'Market data temporarily unavailable.' },
      providerStatus: {
        provider: 'finnhub', isLive: false, apiKeyPresent: true,
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
