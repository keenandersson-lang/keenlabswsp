import { useQuery } from '@tanstack/react-query';
import type { ScreenerApiResponse, Bar, EvaluatedStock, MarketOverview, SectorStatus, ScreenerUiState } from '@/lib/wsp-types';
import { WSP_CONFIG } from '@/lib/wsp-config';
import { evaluateStock } from '@/lib/wsp-engine';
import { computeIndicators, normalizeBarsChronologically } from '@/lib/wsp-indicators';
import { buildScreenerDebugSummary } from '@/lib/wsp-validation';
import { demoMarket, demoStocks } from '@/lib/demo-data';
import { TRACKED_SYMBOLS } from '@/lib/tracked-symbols';

interface EdgeFunctionResponse {
  ok: boolean;
  mode: 'LIVE' | 'STALE' | 'FALLBACK' | 'ERROR';
  data: {
    trackedSymbols: Array<{ symbol: string; name: string; sector: string; industry: string }>;
    stockBars: Record<string, Bar[]>;
    benchmarkBars: Bar[];
    benchmarkSymbol: string;
    marketBars: Record<string, Bar[]>;
    sectorEtfBars: Record<string, Bar[]>;
    sectorMap: Record<string, string[]>;
    marketRegimeSymbols: string[];
  } | null;
  error: { code: string; message: string; failedSymbols?: string[] } | null;
  providerStatus: {
    provider: string;
    isLive: boolean;
    apiKeyPresent: boolean;
    symbolsFetched?: number;
    symbolsFailed?: number;
    totalSymbols?: number;
    fetchedAt?: string;
    cachedSymbols?: number;
  };
}

function buildEdgeFunctionUrl(): string {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  if (projectId) {
    return `https://${projectId}.supabase.co/functions/v1/wsp-screener`;
  }
  // Dev fallback
  return '/api/wsp-screener';
}

function isDevMode(): boolean {
  return import.meta.env.DEV === true;
}

/**
 * Safe fetch that NEVER throws on non-JSON responses.
 * Always returns a structured result.
 */
async function safeFetch(url: string, options?: RequestInit): Promise<EdgeFunctionResponse> {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    return {
      ok: false,
      mode: 'ERROR',
      data: null,
      error: { code: 'NETWORK_ERROR', message: err instanceof Error ? err.message : 'Network request failed' },
      providerStatus: { provider: 'unknown', isLive: false, apiKeyPresent: false },
    };
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    // Server returned HTML or other non-JSON (e.g. SPA fallback)
    const text = await response.text().catch(() => '');
    return {
      ok: false,
      mode: 'ERROR',
      data: null,
      error: {
        code: 'NON_JSON_RESPONSE',
        message: `Server returned ${contentType || 'unknown content-type'} (status ${response.status}). Expected JSON.`,
        details: text.slice(0, 200),
      } as any,
      providerStatus: { provider: 'unknown', isLive: false, apiKeyPresent: false },
    };
  }

  try {
    const text = await response.text();
    const parsed = JSON.parse(text);
    return parsed as EdgeFunctionResponse;
  } catch {
    return {
      ok: false,
      mode: 'ERROR',
      data: null,
      error: { code: 'JSON_PARSE_ERROR', message: 'Response claimed JSON but could not be parsed.' },
      providerStatus: { provider: 'unknown', isLive: false, apiKeyPresent: false },
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

function processEdgeResponse(edgeResp: EdgeFunctionResponse): ScreenerApiResponse {
  const now = new Date().toISOString();

  // ERROR / FALLBACK: use demo data
  if (!edgeResp.ok || !edgeResp.data) {
    const uiState: ScreenerUiState = edgeResp.mode === 'FALLBACK' ? 'FALLBACK' : 'ERROR';
    return {
      market: { ...demoMarket, lastUpdated: now, pollingIntervalMs: WSP_CONFIG.refreshInterval },
      stocks: demoStocks.map(s => ({ ...s, lastUpdated: now, dataSource: 'fallback' as const })),
      sectorStatuses: Object.keys(WSP_CONFIG.sectorMap).map(sector => ({
        sector, isBullish: false, changePercent: 0, sma50AboveSma200: false,
      })),
      providerStatus: {
        provider: 'demo',
        isLive: false,
        uiState,
        lastFetch: now,
        failedSymbols: TRACKED_SYMBOLS.map(s => s.symbol),
        successCount: 0,
        errorMessage: edgeResp.error?.message ?? 'No live data available',
        isFallback: true,
        fallbackActive: true,
        symbolCount: TRACKED_SYMBOLS.length,
        benchmarkSymbol: WSP_CONFIG.benchmark,
        benchmarkFetchStatus: 'failed',
        refreshIntervalMs: WSP_CONFIG.refreshInterval,
        readiness: {
          envVarPresent: edgeResp.providerStatus?.apiKeyPresent ?? false,
          routeReachable: true,
          benchmarkSymbolConfigured: true,
          trackedSymbolsCount: TRACKED_SYMBOLS.length,
          symbolsFetchedSuccessfully: 0,
          symbolsFailed: TRACKED_SYMBOLS.length,
          lastSuccessfulLiveFetch: null,
        },
      },
      debugSummary: buildScreenerDebugSummary(demoStocks),
    };
  }

  // LIVE / STALE: compute indicators client-side from raw bars
  const { data } = edgeResp;
  const benchmarkBars = data.benchmarkBars;

  // Build market overview
  const spyBars = data.marketBars['SPY'] ?? [];
  const qqqBars = data.marketBars['QQQ'] ?? [];
  const sp500Change = computeDailyChange(spyBars);
  const nasdaqChange = computeDailyChange(qqqBars);
  const spyBullish = isSeriesBullish(spyBars);
  const qqqBullish = isSeriesBullish(qqqBars);
  const marketTrend = spyBullish && qqqBullish ? 'bullish' as const
    : (!spyBullish && !qqqBullish ? 'bearish' as const : 'neutral' as const);
  const marketFavorable = marketTrend === 'bullish';

  const market: MarketOverview = {
    sp500Change, nasdaqChange, marketTrend,
    lastUpdated: now, dataSource: 'live', pollingIntervalMs: WSP_CONFIG.refreshInterval,
  };

  // Build sector statuses
  const sectorStatuses: SectorStatus[] = Object.entries(data.sectorMap).map(([sector, etfs]) => {
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

  const sectorStatusMap = Object.fromEntries(sectorStatuses.map(s => [s.sector, s]));

  // Evaluate each stock
  const failedSymbols = edgeResp.error?.failedSymbols ?? [];
  const evaluatedStocks: EvaluatedStock[] = data.trackedSymbols
    .filter(meta => data.stockBars[meta.symbol]?.length > 0)
    .map(meta => {
      const sectorAligned = sectorStatusMap[meta.sector]?.isBullish ?? false;
      return evaluateStock(
        meta.symbol, meta.name, meta.sector, meta.industry,
        data.stockBars[meta.symbol], benchmarkBars,
        sectorAligned, marketFavorable, 'live',
      );
    });

  if (evaluatedStocks.length === 0) {
    // All symbols failed — return fallback
    return processEdgeResponse({ ...edgeResp, ok: false, mode: 'ERROR', data: null });
  }

  const anyStale = edgeResp.mode === 'STALE' || failedSymbols.length > 0;
  const uiState: ScreenerUiState = anyStale ? 'STALE' : 'LIVE';

  return {
    market: { ...market, dataSource: 'live' },
    stocks: evaluatedStocks,
    sectorStatuses,
    providerStatus: {
      provider: 'finnhub',
      isLive: uiState === 'LIVE',
      uiState,
      lastFetch: edgeResp.providerStatus.fetchedAt ?? now,
      failedSymbols,
      successCount: evaluatedStocks.length,
      errorMessage: edgeResp.error?.message ?? (anyStale ? 'Some data may be stale.' : null),
      isFallback: false,
      fallbackActive: false,
      symbolCount: TRACKED_SYMBOLS.length,
      benchmarkSymbol: WSP_CONFIG.benchmark,
      benchmarkFetchStatus: benchmarkBars.length > 0 ? (anyStale ? 'stale' : 'success') : 'failed',
      refreshIntervalMs: WSP_CONFIG.refreshInterval,
      readiness: {
        envVarPresent: edgeResp.providerStatus.apiKeyPresent,
        routeReachable: true,
        benchmarkSymbolConfigured: true,
        trackedSymbolsCount: TRACKED_SYMBOLS.length,
        symbolsFetchedSuccessfully: evaluatedStocks.length,
        symbolsFailed: failedSymbols.length,
        lastSuccessfulLiveFetch: uiState === 'LIVE' ? now : null,
      },
    },
    debugSummary: buildScreenerDebugSummary(evaluatedStocks),
  };
}

export async function fetchWspScreenerData(options?: { intervalMs?: number; forceRefresh?: boolean }): Promise<ScreenerApiResponse> {
  let edgeResp: EdgeFunctionResponse;

  if (isDevMode()) {
    // In dev mode, try the Vite plugin first, then fall back to edge function
    const params = new URLSearchParams();
    if (options?.intervalMs) params.set('intervalMs', String(options.intervalMs));
    if (options?.forceRefresh) params.set('forceRefresh', '1');
    const devUrl = `/api/wsp-screener${params.size > 0 ? `?${params.toString()}` : ''}`;
    
    const devResp = await safeFetch(devUrl);
    
    // If dev server returned a full ScreenerApiResponse (has providerStatus.uiState), use it directly
    if (devResp.ok || (devResp as any)?.providerStatus?.uiState) {
      // The dev server returns ScreenerApiResponse directly, not EdgeFunctionResponse
      const raw = devResp as any;
      if (raw.market && raw.stocks && raw.providerStatus) {
        return raw as ScreenerApiResponse;
      }
    }

    // Dev server not available or returned non-JSON — try edge function
    edgeResp = devResp;
    if (edgeResp.error?.code === 'NON_JSON_RESPONSE' || edgeResp.error?.code === 'NETWORK_ERROR') {
      // Try edge function as fallback
      const efUrl = buildEdgeFunctionUrl();
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      edgeResp = await safeFetch(efUrl, {
        headers: {
          'Content-Type': 'application/json',
          ...(anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {}),
        },
      });
    }
  } else {
    // Production: always use edge function
    const efUrl = buildEdgeFunctionUrl();
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    edgeResp = await safeFetch(efUrl, {
      headers: {
        'Content-Type': 'application/json',
        ...(anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {}),
      },
    });
  }

  return processEdgeResponse(edgeResp);
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
