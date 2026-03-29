// WSP Screener Edge Function — Cache-first with live quote overlay
// Reads bars from daily_prices and scopes stocks from market_scan_results_latest (live cohort source of truth)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALPACA_DATA_URL = "https://data.alpaca.markets/v2";
const ROUTE_VERSION = "supabase-wsp-screener@2026-03-29.1-daily-prices-batched";
const MAX_SCANNER_SYMBOLS = 5000;
const BARS_PER_SYMBOL = 200;

interface SymbolMeta {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  pattern?: string;
  recommendation?: string;
  trendState?: string;
  scannerScore?: number | null;
  assetClass?: string;
  exchange?: string;
  supportsFullWsp?: boolean;
  wspSupport?: string;
  symbolClass?: string;
}

interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface WspIndicatorSnapshot {
  symbol: string;
  calc_date: string;
  close: number | null;
  ma50: number | null;
  ma150: number | null;
  ma50_slope: number | null;
  above_ma50: boolean | null;
  above_ma150: boolean | null;
  volume: number | null;
  volume_ratio: number | null;
  mansfield_rs: number | null;
  wsp_pattern: string | null;
  wsp_score: number | null;
  pct_change_1d: number | null;
}

// ── In-memory quote cache ──
const quoteCache = new Map<
  string,
  {
    price: number;
    change: number;
    changePercent: number;
    high: number;
    low: number;
    open: number;
    prevClose: number;
    timestamp: number;
    fetchedAt: number;
  }
>();
const QUOTE_CACHE_TTL_MS = 2 * 60 * 1000;
function getCachedQuote(symbol: string) {
  const cached = quoteCache.get(symbol);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > QUOTE_CACHE_TTL_MS) {
    quoteCache.delete(symbol);
    return null;
  }
  return cached;
}

async function fetchLiveScannerCohort(supabase: any): Promise<SymbolMeta[]> {
  const from = 0;
  const to = MAX_SCANNER_SYMBOLS - 1;
  const { data, error } = await supabase
    .from("market_scan_results_latest")
    .select("symbol, pattern, recommendation, score, sector, canonical_sector, name, payload")
    .in("pattern", ["climbing", "base_or_climbing"])
    .range(from, to);

  if (error) {
    console.warn("wsp-screener live cohort query failed", error.message);
    return [];
  }

  const allRows = (data ?? []) as any[];
  allRows.sort((a, b) => {
    const volA = Number(a.payload?.volume_ratio ?? 0);
    const volB = Number(b.payload?.volume_ratio ?? 0);
    return volB - volA;
  });

  const latestRows = allRows;
  if (latestRows.length === 0) {
    console.warn("wsp-screener no rows from market_scan_results_latest for climbing/base_or_climbing cohort");
    return [];
  }

  const uniqueRows = latestRows.filter((row, index, arr) => arr.findIndex((item) => item.symbol === row.symbol) === index);
  return uniqueRows.map((row: any) => {
    const resolvedSector = row?.canonical_sector
      ?? (row?.sector && row.sector !== "Unknown" ? row.sector : null)
      ?? "Unknown";
    return {
      symbol: row.symbol,
      name: row?.name ?? row.symbol,
      sector: resolvedSector,
      industry: "Unknown",
      pattern: row?.pattern ?? null,
      recommendation: row?.recommendation ?? null,
      scannerScore: Number.isFinite(Number(row?.score))
        ? Number(row?.score)
        : Number.isFinite(Number(row?.payload?.wsp_score))
          ? Number(row?.payload?.wsp_score)
          : null,
      assetClass: "equity",
      exchange: "UNKNOWN",
      supportsFullWsp: true,
      wspSupport: "full",
      symbolClass: "full_wsp_equity",
    };
  });
}

const BENCHMARK = "SPY";
const MARKET_REGIME_SYMBOLS = ["SPY", "QQQ"];
const SECTOR_ETFS: Record<string, string[]> = {
  Technology: ["XLK"],
  Healthcare: ["XLV"],
  Financials: ["XLF"],
  Energy: ["XLE"],
  "Consumer Discretionary": ["XLY"],
  Industrials: ["XLI"],
  "Communication Services": ["XLC"],
  "Consumer Staples": ["XLP"],
  Materials: ["XLB"],
  "Real Estate": ["XLRE"],
  Utilities: ["XLU"],
  "Metals & Mining": ["GDX"],
};

// ── Alpaca quote fetching (live overlay only) ──
interface AlpacaSnapshot {
  latestTrade?: { p: number; t: string };
  dailyBar?: { o: number; h: number; l: number; c: number; v: number; t: string };
  prevDailyBar?: { o: number; h: number; l: number; c: number; v: number; t: string };
}

async function fetchAlpacaSnapshots(
  symbols: string[],
  keyId: string,
  secret: string,
): Promise<
  Record<
    string,
    {
      price: number;
      change: number;
      changePercent: number;
      high: number;
      low: number;
      open: number;
      prevClose: number;
      timestamp: number;
    } | null
  >
> {
  const result: Record<string, any> = {};
  if (symbols.length === 0) return result;

  const uncached: string[] = [];
  for (const sym of symbols) {
    const cached = getCachedQuote(sym);
    if (cached) {
      result[sym] = {
        price: cached.price,
        change: cached.change,
        changePercent: cached.changePercent,
        high: cached.high,
        low: cached.low,
        open: cached.open,
        prevClose: cached.prevClose,
        timestamp: cached.timestamp,
      };
    } else {
      uncached.push(sym);
    }
  }
  if (uncached.length === 0) return result;

  try {
    const query = new URLSearchParams({ symbols: uncached.join(","), feed: "iex" });
    const resp = await fetch(`${ALPACA_DATA_URL}/stocks/snapshots?${query}`, {
      headers: { Accept: "application/json", "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secret },
    });
    if (!resp.ok) {
      for (const sym of uncached) result[sym] = null;
      return result;
    }
    const data = (await resp.json()) as Record<string, AlpacaSnapshot>;
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
      quoteCache.set(sym, { ...q, fetchedAt: Date.now() });
      result[sym] = q;
    }
  } catch (err) {
    console.error("Alpaca snapshot error:", err);
    for (const sym of uncached) result[sym] = null;
  }
  return result;
}

// ── Read bars from daily_prices cache ──
async function fetchBarsFromCache(supabase: any, symbols: string[]): Promise<Record<string, Bar[]>> {
  const result: Record<string, Bar[]> = {};

  const fetchOne = async (sym: string) => {
    const { data, error } = await supabase
      .from("daily_prices")
      .select("date, open, high, low, close, volume")
      .eq("symbol", sym)
      .order("date", { ascending: false })
      .limit(BARS_PER_SYMBOL);
    if (error || !data || data.length === 0) return;
    result[sym] = data
      .map((r: any) => ({
        date: r.date,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      }))
      .reverse();
  };

  const concurrency = 20;
  for (let i = 0; i < symbols.length; i += concurrency) {
    const chunk = symbols.slice(i, i + concurrency);
    await Promise.all(chunk.map((sym) => fetchOne(sym)));
  }

  return result;
}

async function fetchLatestWspIndicators(
  supabase: any,
  symbols: string[],
): Promise<Record<string, WspIndicatorSnapshot>> {
  const indicatorMap: Record<string, WspIndicatorSnapshot> = {};
  if (!symbols.length) return indicatorMap;

  const chunkSize = 500;
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("wsp_indicators")
      .select(
        "symbol, calc_date, close, ma50, ma150, ma50_slope, above_ma50, above_ma150, volume, volume_ratio, mansfield_rs, wsp_pattern, wsp_score, pct_change_1d",
      )
      .in("symbol", chunk)
      .order("symbol", { ascending: true })
      .order("calc_date", { ascending: false });

    if (error || !data?.length) continue;

    for (const row of data) {
      if (indicatorMap[row.symbol]) continue;
      indicatorMap[row.symbol] = {
        symbol: row.symbol,
        calc_date: row.calc_date,
        close: row.close === null ? null : Number(row.close),
        ma50: row.ma50 === null ? null : Number(row.ma50),
        ma150: row.ma150 === null ? null : Number(row.ma150),
        ma50_slope: row.ma50_slope === null ? null : Number(row.ma50_slope),
        above_ma50: row.above_ma50,
        above_ma150: row.above_ma150,
        volume: row.volume === null ? null : Number(row.volume),
        volume_ratio: row.volume_ratio === null ? null : Number(row.volume_ratio),
        mansfield_rs: row.mansfield_rs === null ? null : Number(row.mansfield_rs),
        wsp_pattern: row.wsp_pattern,
        wsp_score: row.wsp_score === null ? null : Number(row.wsp_score),
        pct_change_1d: row.pct_change_1d === null ? null : Number(row.pct_change_1d),
      };
    }
  }

  return indicatorMap;
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const keyId = Deno.env.get("ALPACA_API_KEY_ID")?.trim();
    const secret = Deno.env.get("ALPACA_API_SECRET_KEY")?.trim();

    const trackedSymbols = await fetchLiveScannerCohort(supabase);

    const topSymbolsForBars = trackedSymbols.map((s) => s.symbol);
    const symbolsForIndicatorFallback: string[] = [];

    // Collect symbols we need bars for (benchmarks + sector ETFs + top-ranked scanner symbols)
    const allEtfs = [...new Set(Object.values(SECTOR_ETFS).flat())];
    const allBarSymbols = [...new Set([...MARKET_REGIME_SYMBOLS, ...allEtfs, ...topSymbolsForBars])];

    // 1. Read bars from daily_prices (primary source)
    const cachedBars = await fetchBarsFromCache(supabase, allBarSymbols);
    const cachedSymbolCount = Object.keys(cachedBars).length;
    const fallbackIndicatorMap = await fetchLatestWspIndicators(supabase, symbolsForIndicatorFallback);

    // 2. Fetch live quotes from Alpaca (overlay for freshness)
    let quotesMap: Record<string, any> = {};
    if (keyId && secret) {
      const allQuoteSymbols = [...new Set([...MARKET_REGIME_SYMBOLS, ...allEtfs, ...topSymbolsForBars])];
      const snapshots = await fetchAlpacaSnapshots(allQuoteSymbols, keyId, secret);
      for (const [sym, snap] of Object.entries(snapshots)) {
        if (snap) quotesMap[sym] = snap;
      }
    }

    // 3. Build response from cached bars
    const stockBarData: Record<string, Bar[]> = {};
    const failedSymbols: string[] = [];
    const marketBars: Record<string, Bar[]> = {};
    const sectorEtfBars: Record<string, Bar[]> = {};

    const benchmarkBars = cachedBars["SPY"] ?? [];

    for (const sym of MARKET_REGIME_SYMBOLS) {
      if (cachedBars[sym]?.length > 0) marketBars[sym] = cachedBars[sym];
    }
    for (const sym of allEtfs) {
      if (cachedBars[sym]?.length > 0) sectorEtfBars[sym] = cachedBars[sym];
    }
    for (const meta of trackedSymbols) {
      const bars = cachedBars[meta.symbol];
      if (!bars || bars.length === 0) {
        failedSymbols.push(meta.symbol);
      } else {
        stockBarData[meta.symbol] = bars;
      }
    }

    const hasCandleAccess = benchmarkBars.length > 50;
    const lastBarDate = benchmarkBars[benchmarkBars.length - 1]?.date;
    const anyStale = isDateStale(lastBarDate);
    const mode = hasCandleAccess ? (anyStale ? "STALE" : "LIVE") : cachedSymbolCount > 0 ? "STALE" : "FALLBACK";

    if (!hasCandleAccess && cachedSymbolCount === 0) {
      return jsonResponse(200, {
        ok: false,
        mode: "FALLBACK",
        data: null,
        error: {
          code: "NO_CACHED_DATA",
          message: "No live scanner cohort data in cache. Run broad scan/backfill first.",
        },
        providerStatus: {
          provider: "cache",
          isLive: false,
          apiKeyPresent: Boolean(keyId),
          routeVersion: ROUTE_VERSION,
          finalModeReason: "daily_prices cache is empty for live scanner cohort. Run broad scan/backfill first.",
          fallbackCause: "necessary",
        },
      });
    }

    return jsonResponse(200, {
      ok: true,
      mode,
      data: {
        trackedSymbols,
        liveScannerCohort: trackedSymbols.map((symbol) => symbol.symbol),
        stockBars: stockBarData,
        indicatorFallback: fallbackIndicatorMap,
        benchmarkBars,
        benchmarkSymbol: BENCHMARK,
        marketBars,
        sectorEtfBars,
        sectorMap: SECTOR_ETFS,
        marketRegimeSymbols: MARKET_REGIME_SYMBOLS,
      },
      quotes: quotesMap,
      error:
        failedSymbols.length > 0
          ? {
              code: "PARTIAL_FAILURE",
              message: `${failedSymbols.length} symbols missing from cache.`,
              failedSymbols,
            }
          : null,
      providerStatus: {
        provider: "cache+alpaca",
        isLive: mode === "LIVE",
        apiKeyPresent: Boolean(keyId),
        apiKeyValid: Object.keys(quotesMap).length > 0,
        hasCandleAccess,
        symbolsFetched: Object.keys(stockBarData).length,
        symbolsFailed: failedSymbols.length,
        totalSymbols: trackedSymbols.length,
        barFetchLimit: trackedSymbols.length,
        barsPerSymbol: BARS_PER_SYMBOL,
        fallbackIndicatorCount: Object.keys(fallbackIndicatorMap).length,
        quotesAvailable: Object.keys(quotesMap).length,
        fetchedAt: new Date().toISOString(),
        cachedSymbols: cachedSymbolCount,
        routeVersion: ROUTE_VERSION,
        benchmarkSuccessCount: MARKET_REGIME_SYMBOLS.filter((s) => (cachedBars[s]?.length ?? 0) > 0).length,
        benchmarkFailureCount: MARKET_REGIME_SYMBOLS.filter((s) => !(cachedBars[s]?.length > 0)).length,
        finalModeReason: `Cache-first scanner cohort: ${Object.keys(stockBarData).length}/${trackedSymbols.length} symbols with ${BARS_PER_SYMBOL} bars from daily_prices, ${Object.keys(fallbackIndicatorMap).length} indicator fallbacks, ${Object.keys(quotesMap).length} live quotes.`,
        fallbackCause: mode === "LIVE" ? "none" : "necessary",
        cacheInvalidated: false,
        activeProvider: "cache+alpaca",
      },
    });
  } catch (err) {
    console.error("WSP screener unhandled error:", err);
    return jsonResponse(500, {
      ok: false,
      mode: "ERROR",
      data: null,
      error: { code: "SERVER_ERROR", message: "Market data temporarily unavailable." },
      providerStatus: {
        provider: "cache+alpaca",
        isLive: false,
        apiKeyPresent: true,
        routeVersion: ROUTE_VERSION,
        finalModeReason: "Unhandled edge runtime error.",
        fallbackCause: "necessary",
      },
    });
  }
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
