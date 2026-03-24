import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const HISTORY_CALENDAR_DAYS = 550;

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

interface FinnhubCandleResponse {
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  s: 'ok' | 'no_data';
  t: number[];
  v: number[];
}

// ── In-memory cache ──
const barCache = new Map<string, { bars: Bar[]; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Rate limiting ──
let lastRequestTime = 0;
const MIN_REQUEST_GAP_MS = 120; // ~8 req/s for free tier (30 req/s paid)

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const wait = MIN_REQUEST_GAP_MS - (now - lastRequestTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return fetch(url, { headers: { Accept: 'application/json' } });
}

async function fetchBars(symbol: string, apiKey: string): Promise<{ bars: Bar[]; stale: boolean; error?: string }> {
  // Check cache
  const cached = barCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { bars: cached.bars, stale: false };
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - HISTORY_CALENDAR_DAYS * 86400;
    const url = `${FINNHUB_BASE_URL}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}&token=${apiKey}`;
    const resp = await rateLimitedFetch(url);

    if (!resp.ok) {
      return { bars: [], stale: true, error: `HTTP ${resp.status}` };
    }

    const data = await resp.json() as FinnhubCandleResponse;
    if (data.s !== 'ok' || !data.t?.length) {
      return { bars: [], stale: true, error: `Finnhub returned ${data.s} for ${symbol}` };
    }

    const bars: Bar[] = data.t.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: data.o[i],
      high: data.h[i],
      low: data.l[i],
      close: data.c[i],
      volume: data.v[i],
    })).filter(b => Number.isFinite(b.close) && Number.isFinite(b.volume));

    barCache.set(symbol, { bars, fetchedAt: Date.now() });

    const lastDate = bars[bars.length - 1]?.date;
    const stale = isDateStale(lastDate);
    return { bars, stale };
  } catch (err) {
      return { bars: [], stale: true, error: 'Market data temporarily unavailable.' };
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

// ── Tracked symbols ──
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('FINNHUB_API_KEY');
    if (!apiKey) {
      return jsonResponse(200, {
        ok: false,
        mode: 'FALLBACK',
        data: null,
        error: { code: 'NO_API_KEY', message: 'Provider authentication failed. Check server configuration.' },
        providerStatus: { provider: 'none', isLive: false, apiKeyPresent: false },
      });
    }

    // Collect all unique symbols to fetch
    const allEtfs = [...new Set(Object.values(SECTOR_ETFS).flat())];
    const allSymbols = [...new Set([
      BENCHMARK,
      ...MARKET_REGIME_SYMBOLS,
      ...allEtfs,
      ...TRACKED_SYMBOLS.map(s => s.symbol),
    ])];

    // Batch fetch with rate limiting
    const results = new Map<string, { bars: Bar[]; stale: boolean; error?: string }>();
    
    // Fetch in small batches to respect rate limits
    const BATCH_SIZE = 5;
    for (let i = 0; i < allSymbols.length; i += BATCH_SIZE) {
      const batch = allSymbols.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(sym => fetchBars(sym, apiKey)));
      batch.forEach((sym, idx) => results.set(sym, batchResults[idx]));
    }

    const benchmarkResult = results.get(BENCHMARK)!;
    const failedSymbols: string[] = [];
    const stockBarData: Record<string, Bar[]> = {};
    
    for (const meta of TRACKED_SYMBOLS) {
      const r = results.get(meta.symbol);
      if (!r || r.bars.length === 0) {
        failedSymbols.push(meta.symbol);
      } else {
        stockBarData[meta.symbol] = r.bars;
      }
    }

    const sectorEtfBars: Record<string, Bar[]> = {};
    for (const sym of allEtfs) {
      const r = results.get(sym);
      if (r && r.bars.length > 0) sectorEtfBars[sym] = r.bars;
    }

    const marketBars: Record<string, Bar[]> = {};
    for (const sym of MARKET_REGIME_SYMBOLS) {
      const r = results.get(sym);
      if (r && r.bars.length > 0) marketBars[sym] = r.bars;
    }

    const anyStale = [...results.values()].some(r => r.stale);
    const anyError = [...results.values()].some(r => r.error);

    return jsonResponse(200, {
      ok: true,
      mode: anyStale ? 'STALE' : 'LIVE',
      data: {
        trackedSymbols: TRACKED_SYMBOLS,
        stockBars: stockBarData,
        benchmarkBars: benchmarkResult?.bars ?? [],
        benchmarkSymbol: BENCHMARK,
        marketBars,
        sectorEtfBars,
        sectorMap: SECTOR_ETFS,
        marketRegimeSymbols: MARKET_REGIME_SYMBOLS,
      },
      error: anyError ? {
        code: 'PARTIAL_FAILURE',
        message: failedSymbols.length > 0 ? 'Market data temporarily unavailable.' : 'Live provider unavailable. Demo mode active.',
        failedSymbols,
      } : null,
      providerStatus: {
        provider: 'finnhub',
        isLive: !anyStale,
        apiKeyPresent: true,
        symbolsFetched: Object.keys(stockBarData).length,
        symbolsFailed: failedSymbols.length,
        totalSymbols: TRACKED_SYMBOLS.length,
        fetchedAt: new Date().toISOString(),
        cachedSymbols: barCache.size,
      },
    });
  } catch (err) {
    return jsonResponse(500, {
      ok: false,
      mode: 'ERROR',
      data: null,
      error: {
        code: 'SERVER_ERROR',
        message: 'Market data temporarily unavailable.',
      },
      providerStatus: { provider: 'finnhub', isLive: false, apiKeyPresent: true },
    });
  }
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
