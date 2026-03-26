import { useQuery } from '@tanstack/react-query';
import type { ScreenerApiResponse, Bar, EvaluatedStock, MarketOverview, SectorStatus, ScreenerUiState, DiscoveryBuckets, DiscoveryMeta } from '@/lib/wsp-types';
import { WSP_CONFIG } from '@/lib/wsp-config';
import { evaluateStock } from '@/lib/wsp-engine';
import { computeIndicators, normalizeBarsChronologically } from '@/lib/wsp-indicators';
import { buildScreenerDebugSummary } from '@/lib/wsp-validation';
import { demoMarket, demoStocks } from '@/lib/demo-data';
import { TRACKED_SYMBOLS } from '@/lib/tracked-symbols';
import { sanitizeClientErrorMessage } from '@/lib/safe-messages';
import { buildDiscoverySnapshot } from '@/lib/discovery';
import { NASDAQ_BENCHMARK, SP500_BENCHMARK } from '@/lib/benchmarks';

interface QuoteData {
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
  timestamp: number;
}

interface EdgeFunctionResponse {
  ok: boolean;
  mode: 'LIVE' | 'STALE' | 'FALLBACK' | 'ERROR';
  data: {
    trackedSymbols: Array<{ symbol: string; name: string; sector: string; industry: string; exchange?: string; assetClass?: string; supportsFullWsp?: boolean; wspSupport?: string }>;
    stockBars: Record<string, Bar[]>;
    benchmarkBars: Bar[];
    benchmarkSymbol: string;
    marketBars: Record<string, Bar[]>;
    sectorEtfBars: Record<string, Bar[]>;
    sectorMap: Record<string, string[]>;
    marketRegimeSymbols: string[];
  } | null;
  quotes?: Record<string, QuoteData>;
  error: { code: string; message: string; failedSymbols?: string[] } | null;
  providerStatus: {
    provider: string;
    isLive: boolean;
    apiKeyPresent: boolean;
    apiKeyValid?: boolean;
    hasCandleAccess?: boolean;
    symbolsFetched?: number;
    symbolsFailed?: number;
    totalSymbols?: number;
    quotesAvailable?: number;
    fetchedAt?: string;
    cachedSymbols?: number;
    routeVersion?: string;
    buildMarker?: string;
    finalModeReason?: string;
    fallbackCause?: 'necessary' | 'misconfiguration' | 'unknown' | 'none';
    benchmarkSuccessCount?: number;
    benchmarkFailureCount?: number;
    cacheInvalidated?: boolean;
    activeProvider?: string;
  };
  market?: MarketOverview;
  stocks?: EvaluatedStock[];
  sectorStatuses?: SectorStatus[];
  discovery?: DiscoveryBuckets;
  discoveryMeta?: DiscoveryMeta;
}

interface FetchDiagnostics {
  target: string;
  reachable: boolean;
  statusCode: number | null;
  authOutcome: 'success' | 'missing_client_auth' | 'failed' | 'not_required' | 'unknown';
}

interface SafeFetchResult {
  payload: EdgeFunctionResponse;
  diagnostics: FetchDiagnostics;
}

function buildEdgeFunctionUrl(): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (supabaseUrl) {
    return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/wsp-screener`;
  }

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  if (projectId) {
    return `https://${projectId}.supabase.co/functions/v1/wsp-screener`;
  }

  return '';
}

function isDevMode(): boolean {
  return import.meta.env.DEV === true;
}

function buildSupabaseInvokeHeaders(): Record<string, string> {
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return {
    'Content-Type': 'application/json',
    ...(anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {}),
  };
}

/**
 * Safe fetch that NEVER throws on non-JSON responses.
 * Always returns a structured result.
 */
async function safeFetch(url: string, options?: RequestInit): Promise<SafeFetchResult> {
  const hasClientAuthHeader = !!(options?.headers && (
    (options.headers as Record<string, string>)?.Authorization ||
    (options.headers as Record<string, string>)?.authorization ||
    (options.headers as Record<string, string>)?.apikey
  ));

  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    return {
      payload: {
        ok: false,
        mode: 'ERROR',
        data: null,
        error: { code: 'NETWORK_ERROR', message: err instanceof Error ? err.message : 'Network request failed' },
        providerStatus: { provider: 'unknown', isLive: false, apiKeyPresent: false },
      },
      diagnostics: {
        target: url,
        reachable: false,
        statusCode: null,
        authOutcome: 'unknown',
      },
    };
  }

  const authOutcome: FetchDiagnostics['authOutcome'] = response.status === 401 || response.status === 403
    ? (hasClientAuthHeader ? 'failed' : 'missing_client_auth')
    : (hasClientAuthHeader ? 'success' : 'not_required');

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    // Server returned HTML or other non-JSON (e.g. SPA fallback)
    const text = await response.text().catch(() => '');
    return {
      payload: {
        ok: false,
        mode: 'ERROR',
        data: null,
        error: {
          code: 'NON_JSON_RESPONSE',
          message: `Server returned ${contentType || 'unknown content-type'} (status ${response.status}). Expected JSON.`,
          details: text.slice(0, 200),
        } as any,
        providerStatus: { provider: 'unknown', isLive: false, apiKeyPresent: false },
      },
      diagnostics: {
        target: url,
        reachable: true,
        statusCode: response.status,
        authOutcome,
      },
    };
  }

  try {
    const text = await response.text();
    const parsed = JSON.parse(text);
    return {
      payload: parsed as EdgeFunctionResponse,
      diagnostics: {
        target: url,
        reachable: true,
        statusCode: response.status,
        authOutcome,
      },
    };
  } catch {
    return {
      payload: {
        ok: false,
        mode: 'ERROR',
        data: null,
        error: { code: 'JSON_PARSE_ERROR', message: 'Response claimed JSON but could not be parsed.' },
        providerStatus: { provider: 'unknown', isLive: false, apiKeyPresent: false },
      },
      diagnostics: {
        target: url,
        reachable: response.ok,
        statusCode: response.status,
        authOutcome,
      },
    };
  }
}

function computeDailyChange(bars: Bar[]): number {
  const sorted = normalizeBarsChronologically(bars).bars;
  if (sorted.length < 2) return 0;
  const latest = sorted[sorted.length - 1].close;
  const previous = sorted[sorted.length - 2].close;
  if (previous === 0) return 0;
  return Number((((latest - previous) / previous) * 100).toFixed(2));
}

function isSeriesBullish(bars: Bar[]): boolean {
  const sorted = normalizeBarsChronologically(bars).bars;
  const ind = computeIndicators(sorted, sorted);
  const latestClose = sorted[sorted.length - 1]?.close ?? 0;
  return ind.sma50 !== null && ind.sma200 !== null && latestClose > ind.sma50 && ind.sma50 > ind.sma200;
}

function processEdgeResponse(edgeResp: EdgeFunctionResponse, fetchDiagnostics: FetchDiagnostics): ScreenerApiResponse {
  const now = new Date().toISOString();
  const safeError = sanitizeClientErrorMessage(edgeResp.error?.message);

  // ERROR / FALLBACK: use demo data
  if (!edgeResp.ok || !edgeResp.data) {
    const uiState: ScreenerUiState = edgeResp.mode === 'FALLBACK' ? 'FALLBACK' : 'ERROR';
    const fallbackSectorStatuses = Object.keys(WSP_CONFIG.sectorMap).map((sector) => {
      const sectorStocks = demoStocks.filter((stock) => stock.sector === sector);
      const bullishCount = sectorStocks.filter((stock) => stock.gate.sectorAligned).length;
      const avgChange = sectorStocks.length === 0
        ? 0
        : Number((sectorStocks.reduce((acc, stock) => acc + stock.changePercent, 0) / sectorStocks.length).toFixed(2));
      return {
        sector,
        isBullish: bullishCount >= Math.ceil(Math.max(1, sectorStocks.length / 2)),
        changePercent: avgChange,
        sma50AboveSma200: bullishCount > 0,
      };
    });

    return {
      market: { ...demoMarket, lastUpdated: now, benchmarkLastUpdated: now, pollingIntervalMs: WSP_CONFIG.refreshInterval },
      stocks: demoStocks.map(s => ({ ...s, lastUpdated: now, dataSource: 'fallback' as const })),
      ...buildDiscoverySnapshot(demoStocks, uiState),
      sectorStatuses: fallbackSectorStatuses,
      providerStatus: {
        provider: 'demo',
        isLive: false,
        uiState,
        lastFetch: now,
        failedSymbols: TRACKED_SYMBOLS.map(s => s.symbol),
        successCount: 0,
        errorMessage: safeError,
        isFallback: true,
        fallbackActive: true,
        symbolCount: TRACKED_SYMBOLS.length,
        benchmarkSymbol: WSP_CONFIG.benchmark,
        benchmarkFetchStatus: 'failed',
        refreshIntervalMs: WSP_CONFIG.refreshInterval,
        readiness: {
          envVarPresent: edgeResp.providerStatus?.apiKeyPresent ?? false,
          routeReachable: fetchDiagnostics.reachable,
          benchmarkSymbolConfigured: true,
          trackedSymbolsCount: TRACKED_SYMBOLS.length,
          symbolsFetchedSuccessfully: 0,
          symbolsFailed: TRACKED_SYMBOLS.length,
          lastSuccessfulLiveFetch: null,
        },
        runtimeDiagnostics: {
          envKeyPresent: edgeResp.providerStatus?.apiKeyPresent ?? false,
          edgeFunctionReachable: fetchDiagnostics.reachable,
          fetchTarget: fetchDiagnostics.target,
          authOutcome: fetchDiagnostics.authOutcome,
          benchmarkFetch: 'failed',
          routeVersion: edgeResp.providerStatus?.routeVersion ?? 'unknown',
          buildMarker: import.meta.env.VITE_APP_BUILD_MARKER ?? `local-${import.meta.env.MODE}`,
          finalModeReason: edgeResp.providerStatus?.finalModeReason ?? safeError ?? 'Live provider request failed before usable payload.',
          fallbackCause: edgeResp.providerStatus?.fallbackCause ?? 'unknown',
        },
      },
      debugSummary: buildScreenerDebugSummary(demoStocks),
    };
  }

  // LIVE / STALE: compute indicators client-side from raw bars
  const { data } = edgeResp;
  const benchmarkBars = data.benchmarkBars;
  const quotes = edgeResp.quotes ?? {};

  const marketFromPayload = edgeResp.market;
  const hasRenderablePayloadBenchmarks = marketFromPayload &&
    marketFromPayload.sp500Price !== null &&
    marketFromPayload.nasdaqPrice !== null;

  // Build market overview — use quotes for prices when available (free tier compatible)
  const spyBars = data.marketBars['SPY'] ?? [];
  const qqqBars = data.marketBars['QQQ'] ?? [];
  const spyQuote = quotes['SPY'];
  const qqqQuote = quotes['QQQ'];
  const spyPrice = spyQuote?.price ?? spyBars[spyBars.length - 1]?.close ?? null;
  const qqqPrice = qqqQuote?.price ?? qqqBars[qqqBars.length - 1]?.close ?? null;
  const sp500Change = spyQuote?.changePercent ?? computeDailyChange(spyBars);
  const nasdaqChange = qqqQuote?.changePercent ?? computeDailyChange(qqqBars);
  const hasCandleAccess = edgeResp.providerStatus.hasCandleAccess ?? (spyBars.length > 10);
  const spyBullish = hasCandleAccess ? isSeriesBullish(spyBars) : (spyQuote ? spyQuote.price > spyQuote.prevClose : false);
  const qqqBullish = hasCandleAccess ? isSeriesBullish(qqqBars) : (qqqQuote ? qqqQuote.price > qqqQuote.prevClose : false);
  const marketTrend = spyBullish && qqqBullish ? 'bullish' as const
    : (!spyBullish && !qqqBullish ? 'bearish' as const : 'neutral' as const);
  const marketFavorable = (hasRenderablePayloadBenchmarks ? marketFromPayload.marketTrend : marketTrend) === 'bullish';

  const market: MarketOverview = hasRenderablePayloadBenchmarks
    ? {
      ...marketFromPayload,
      benchmarkState: edgeResp.mode === 'STALE' ? 'stale' : marketFromPayload.benchmarkState,
      benchmarkLastUpdated: edgeResp.providerStatus.fetchedAt ?? marketFromPayload.benchmarkLastUpdated ?? now,
      lastUpdated: edgeResp.providerStatus.fetchedAt ?? marketFromPayload.lastUpdated ?? now,
      pollingIntervalMs: marketFromPayload.pollingIntervalMs ?? WSP_CONFIG.refreshInterval,
    }
    : {
      sp500Change, nasdaqChange, marketTrend,
      sp500Price: spyPrice,
      nasdaqPrice: qqqPrice,
      sp500Symbol: SP500_BENCHMARK.symbol,
      nasdaqSymbol: NASDAQ_BENCHMARK.symbol,
      benchmarkState: edgeResp.mode === 'STALE' ? 'stale' : 'live',
      benchmarkLastUpdated: edgeResp.providerStatus.fetchedAt ?? now,
      lastUpdated: now, dataSource: 'live', pollingIntervalMs: WSP_CONFIG.refreshInterval,
    };

  // Build sector statuses
  const derivedSectorStatuses: SectorStatus[] = Object.entries(data.sectorMap).map(([sector, etfs]) => {
    const etfBars = data.sectorEtfBars[etfs[0]] ?? [];
    const sorted = normalizeBarsChronologically(etfBars).bars;
    const ind = computeIndicators(sorted, sorted);
    const changePercent = computeDailyChange(sorted);
    const isBullish = ind.sma50 !== null && ind.sma200 !== null &&
      ind.sma50 > ind.sma200 &&
      (sorted[sorted.length - 1]?.close ?? 0) > ind.sma50;
    return {
      sector, isBullish, changePercent,
      sma50AboveSma200: ind.sma50 !== null && ind.sma200 !== null ? ind.sma50 > ind.sma200 : false,
    };
  });
  const sectorStatuses = edgeResp.sectorStatuses?.length ? edgeResp.sectorStatuses : derivedSectorStatuses;

  const sectorStatusMap = Object.fromEntries(sectorStatuses.map(s => [s.sector, s]));

  // Evaluate each stock
  const failedSymbols = edgeResp.error?.failedSymbols ?? [];
  const evaluatedStocks: EvaluatedStock[] = edgeResp.stocks?.length
    ? edgeResp.stocks
    : data.trackedSymbols
      .filter(meta => data.stockBars[meta.symbol]?.length > 0)
      .map(meta => {
        const sectorAligned = sectorStatusMap[meta.sector]?.isBullish ?? false;
        return evaluateStock(
          meta.symbol, meta.name, meta.sector, meta.industry,
          data.stockBars[meta.symbol], benchmarkBars,
          sectorAligned, marketFavorable, 'live',
          {
            metadata: {
              exchange: meta.exchange,
              assetClass: meta.assetClass,
              supportsFullWsp: meta.supportsFullWsp,
              wspSupport: meta.wspSupport,
            },
          },
        );
      });

  const benchmarkSuccessCount = Number(edgeResp.providerStatus.benchmarkSuccessCount ?? 0);
  const benchmarkFailureCount = Number(edgeResp.providerStatus.benchmarkFailureCount ?? 0);
  const anyStale = edgeResp.mode === 'STALE' || failedSymbols.length > 0 || benchmarkFailureCount > 0;
  const uiState: ScreenerUiState = anyStale ? 'STALE' : 'LIVE';
  const discoverySnapshot = edgeResp.discovery && edgeResp.discoveryMeta
    ? { discovery: edgeResp.discovery, discoveryMeta: edgeResp.discoveryMeta }
    : buildDiscoverySnapshot(evaluatedStocks, uiState);

  return {
    market: { ...market, dataSource: 'live' },
    stocks: evaluatedStocks,
    ...discoverySnapshot,
    sectorStatuses,
    providerStatus: {
      provider: 'finnhub',
      isLive: uiState === 'LIVE',
      uiState,
      lastFetch: edgeResp.providerStatus.fetchedAt ?? now,
      failedSymbols,
      successCount: evaluatedStocks.length,
      errorMessage: edgeResp.error?.message ? safeError : (anyStale ? 'Live provider unavailable. Showing latest safe snapshot.' : null),
      isFallback: false,
      fallbackActive: false,
      symbolCount: TRACKED_SYMBOLS.length,
      benchmarkSymbol: WSP_CONFIG.benchmark,
      benchmarkFetchStatus: benchmarkBars.length > 0 ? (anyStale ? 'stale' : 'success') : 'failed',
      refreshIntervalMs: WSP_CONFIG.refreshInterval,
      readiness: {
        envVarPresent: edgeResp.providerStatus.apiKeyPresent,
        routeReachable: fetchDiagnostics.reachable,
        benchmarkSymbolConfigured: true,
        trackedSymbolsCount: TRACKED_SYMBOLS.length,
        symbolsFetchedSuccessfully: evaluatedStocks.length,
        symbolsFailed: failedSymbols.length,
        lastSuccessfulLiveFetch: uiState === 'LIVE' ? now : null,
      },
      runtimeDiagnostics: {
        envKeyPresent: edgeResp.providerStatus.apiKeyPresent,
        edgeFunctionReachable: fetchDiagnostics.reachable,
        fetchTarget: fetchDiagnostics.target,
        authOutcome: fetchDiagnostics.authOutcome,
        benchmarkFetch: benchmarkBars.length > 0 ? (anyStale ? 'stale' : 'success') : 'failed',
        routeVersion: edgeResp.providerStatus?.routeVersion ?? 'unknown',
        buildMarker: edgeResp.providerStatus?.buildMarker ?? import.meta.env.VITE_APP_BUILD_MARKER ?? `local-${import.meta.env.MODE}`,
        finalModeReason: edgeResp.providerStatus?.finalModeReason
          ?? (uiState === 'LIVE'
            ? `Live provider data fully available. Benchmark success/fail: ${benchmarkSuccessCount}/${benchmarkFailureCount}.`
            : `Live provider returned partial/stale data. Benchmark success/fail: ${benchmarkSuccessCount}/${benchmarkFailureCount}.`),
        fallbackCause: edgeResp.providerStatus?.fallbackCause ?? 'unknown',
      },
    },
    debugSummary: buildScreenerDebugSummary(evaluatedStocks),
  };
}

export async function fetchWspScreenerData(options?: { intervalMs?: number; forceRefresh?: boolean }): Promise<ScreenerApiResponse> {
  let edgeResp: EdgeFunctionResponse;
  const edgeFunctionUrl = buildEdgeFunctionUrl();
  let fetchDiagnostics: FetchDiagnostics = {
    target: isDevMode() ? '/api/wsp-screener' : (edgeFunctionUrl || 'missing_supabase_function_url'),
    reachable: false,
    statusCode: null,
    authOutcome: 'unknown',
  };

  if (isDevMode()) {
    // In dev mode, try the Vite plugin first, then fall back to edge function
    const params = new URLSearchParams();
    if (options?.intervalMs) params.set('intervalMs', String(options.intervalMs));
    if (options?.forceRefresh) params.set('forceRefresh', '1');
    const devUrl = `/api/wsp-screener${params.size > 0 ? `?${params.toString()}` : ''}`;
    
    const devResp = await safeFetch(devUrl);
    fetchDiagnostics = devResp.diagnostics;
    
    // If dev server returned a full ScreenerApiResponse (not wrapped in edge payload), use it directly
    if (!(devResp.payload as any)?.ok && (devResp.payload as any)?.providerStatus?.uiState) {
      const raw = devResp.payload as any;
      if (raw.market && raw.stocks && raw.providerStatus) {
        return raw as ScreenerApiResponse;
      }
    }

    // Dev server not available or returned non-JSON — try edge function
    edgeResp = devResp.payload;
    if ((edgeResp.error?.code === 'NON_JSON_RESPONSE' || edgeResp.error?.code === 'NETWORK_ERROR') && edgeFunctionUrl) {
      const efResp = await safeFetch(edgeFunctionUrl, { headers: buildSupabaseInvokeHeaders() });
      edgeResp = efResp.payload;
      fetchDiagnostics = efResp.diagnostics;
    }
  } else {
    // Production: always use edge function
    if (!edgeFunctionUrl) {
      edgeResp = {
        ok: false,
        mode: 'ERROR',
        data: null,
        error: { code: 'MISSING_EDGE_ENDPOINT', message: 'Supabase function endpoint is not configured in runtime environment.' },
        providerStatus: {
          provider: 'unknown',
          isLive: false,
          apiKeyPresent: false,
          finalModeReason: 'Missing VITE_SUPABASE_URL (or project id fallback), cannot invoke wsp-screener edge function.',
          fallbackCause: 'misconfiguration',
        },
      };
      fetchDiagnostics = {
        target: 'missing_supabase_function_url',
        reachable: false,
        statusCode: null,
        authOutcome: 'missing_client_auth',
      };
      return processEdgeResponse(edgeResp, fetchDiagnostics);
    }

    const efResp = await safeFetch(edgeFunctionUrl, { headers: buildSupabaseInvokeHeaders() });
    edgeResp = efResp.payload;
    fetchDiagnostics = efResp.diagnostics;
  }

  return processEdgeResponse(edgeResp, fetchDiagnostics);
}

export function useWspScreener(intervalMs: number = WSP_CONFIG.refreshInterval) {
  return useQuery({
    queryKey: ['wsp-screener', intervalMs],
    queryFn: () => fetchWspScreenerData({ intervalMs }),
    refetchInterval: intervalMs,
    staleTime: Math.max(15_000, intervalMs / 2),
    retry: 1,
  });
}
