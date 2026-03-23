import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { evaluateStock } from '../src/lib/wsp-engine';
import { computeIndicators } from '../src/lib/wsp-indicators';
import { demoMarket, demoStocks } from '../src/lib/demo-data';
import { TRACKED_SYMBOLS } from '../src/lib/tracked-symbols';
import { WSP_CONFIG } from '../src/lib/wsp-config';
import type { Bar, MarketOverview, ScreenerApiResponse, ScreenerUiState, SectorStatus } from '../src/lib/wsp-types';
import { FinnhubProvider } from './finnhub-provider';

const DEFAULT_POLLING_INTERVAL_MS = WSP_CONFIG.refreshInterval;

let cachedLiveSnapshot: ScreenerApiResponse | null = null;
let inFlightRefresh: Promise<ScreenerApiResponse> | null = null;

export async function handleWspScreenerRequest(req: IncomingMessage, res: ServerResponse) {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const forceRefresh = requestUrl.searchParams.get('forceRefresh') === '1';
  const intervalCandidate = Number(requestUrl.searchParams.get('intervalMs'));
  const pollingIntervalMs = Number.isFinite(intervalCandidate) && intervalCandidate >= 30_000
    ? intervalCandidate
    : DEFAULT_POLLING_INTERVAL_MS;

  try {
    const payload = await getScreenerSnapshot({ forceRefresh, pollingIntervalMs });
    sendJson(res, 200, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    sendJson(res, 500, createErrorResponse(message, pollingIntervalMs));
  }
}

async function getScreenerSnapshot({ forceRefresh, pollingIntervalMs }: { forceRefresh: boolean; pollingIntervalMs: number }): Promise<ScreenerApiResponse> {
  const isCacheFresh = cachedLiveSnapshot !== null &&
    cachedLiveSnapshot.providerStatus.lastFetch !== null &&
    Date.now() - new Date(cachedLiveSnapshot.providerStatus.lastFetch).getTime() < pollingIntervalMs;

  if (!forceRefresh && isCacheFresh) {
    return cachedLiveSnapshot!;
  }

  if (inFlightRefresh && !forceRefresh) {
    return inFlightRefresh;
  }

  inFlightRefresh = buildSnapshot(pollingIntervalMs)
    .then((snapshot) => {
      if (snapshot.providerStatus.uiState === 'LIVE') {
        cachedLiveSnapshot = snapshot;
      }
      return snapshot;
    })
    .finally(() => {
      inFlightRefresh = null;
    });

  return inFlightRefresh;
}

async function buildSnapshot(pollingIntervalMs: number): Promise<ScreenerApiResponse> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return createFallbackResponse('FINNHUB_API_KEY is not set.', pollingIntervalMs);
  }

  const provider = new FinnhubProvider(apiKey);

  try {
    const benchmarkSymbol = WSP_CONFIG.benchmark;
    const benchmarkPromise = provider.fetchDailyHistory(benchmarkSymbol);
    const marketPromises = WSP_CONFIG.marketRegimeSymbols.map((symbol) => provider.fetchDailyHistory(symbol));
    const sectorEtfSymbols = [...new Set(Object.values(WSP_CONFIG.sectorMap).flat())];
    const sectorPromises = sectorEtfSymbols.map(async (symbol) => ({ symbol, result: await provider.fetchDailyHistory(symbol) }));
    const stockPromises = TRACKED_SYMBOLS.map(async (meta) => ({ meta, result: await provider.fetchDailyHistory(meta.symbol) }));

    const [benchmarkResult, marketResults, sectorResults, stockResults] = await Promise.all([
      benchmarkPromise,
      Promise.all(marketPromises),
      Promise.allSettled(sectorPromises),
      Promise.allSettled(stockPromises),
    ]);

    const benchmarkBars = benchmarkResult.bars;
    const marketSeries = Object.fromEntries(
      WSP_CONFIG.marketRegimeSymbols.map((symbol, index) => [symbol, marketResults[index]]),
    ) as Record<string, { bars: Bar[]; stale: boolean }>;

    const failedSymbols = stockResults
      .flatMap((result, index) => result.status === 'rejected' ? [TRACKED_SYMBOLS[index].symbol] : []);

    const resolvedStockResults = stockResults
      .flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);

    const resolvedSectorResults = sectorResults
      .flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);

    const sectorBars = Object.fromEntries(
      resolvedSectorResults.map(({ symbol, result }) => [symbol, result.bars]),
    ) as Record<string, Bar[]>;

    const sectorStatuses = buildSectorStatuses(sectorBars);
    const sectorStatusMap = Object.fromEntries(sectorStatuses.map((item) => [item.sector, item])) as Record<string, SectorStatus>;
    const marketOverview = buildMarketOverview(marketSeries, pollingIntervalMs);
    const marketFavorable = marketOverview.marketTrend === 'bullish';

    const evaluatedStocks = resolvedStockResults.map(({ meta, result }) => {
      const sectorAligned = sectorStatusMap[meta.sector]?.isBullish ?? false;
      return evaluateStock(
        meta.symbol,
        meta.name,
        meta.sector,
        meta.industry,
        result.bars,
        benchmarkBars,
        sectorAligned,
        marketFavorable,
        'live',
      );
    });

    if (evaluatedStocks.length === 0) {
      return createFallbackResponse('Finnhub returned no successful stock histories.', pollingIntervalMs);
    }

    const anyStale = benchmarkResult.stale ||
      Object.values(marketSeries).some((series) => series.stale) ||
      resolvedStockResults.some(({ result }) => result.stale) ||
      resolvedSectorResults.some(({ result }) => result.stale) ||
      failedSymbols.length > 0;

    const uiState: ScreenerUiState = anyStale ? 'STALE' : 'LIVE';

    return {
      market: {
        ...marketOverview,
        dataSource: 'live',
      },
      stocks: evaluatedStocks,
      sectorStatuses,
      providerStatus: {
        provider: 'finnhub',
        isLive: uiState === 'LIVE',
        uiState,
        lastFetch: new Date().toISOString(),
        failedSymbols,
        successCount: evaluatedStocks.length,
        errorMessage: failedSymbols.length > 0
          ? `Failed to fetch: ${failedSymbols.join(', ')}`
          : (anyStale ? 'One or more Finnhub series are stale.' : null),
        isFallback: false,
        fallbackActive: false,
        symbolCount: TRACKED_SYMBOLS.length,
        benchmarkSymbol,
        benchmarkFetchStatus: benchmarkResult.stale ? 'stale' : 'success',
        refreshIntervalMs: pollingIntervalMs,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to refresh Finnhub data';

    if (cachedLiveSnapshot) {
      return {
        ...cachedLiveSnapshot,
        providerStatus: {
          ...cachedLiveSnapshot.providerStatus,
          isLive: false,
          uiState: 'STALE',
          errorMessage: message,
          benchmarkFetchStatus: cachedLiveSnapshot.providerStatus.benchmarkFetchStatus,
          refreshIntervalMs: pollingIntervalMs,
        },
      };
    }

    return createFallbackResponse(message, pollingIntervalMs);
  }
}

function buildMarketOverview(marketSeries: Record<string, { bars: Bar[]; stale: boolean }>, pollingIntervalMs: number): MarketOverview {
  const spyBars = marketSeries.SPY?.bars ?? [];
  const qqqBars = marketSeries.QQQ?.bars ?? [];
  const sp500Change = computeDailyChange(spyBars);
  const nasdaqChange = computeDailyChange(qqqBars);
  const spyBullish = isSeriesBullish(spyBars);
  const qqqBullish = isSeriesBullish(qqqBars);
  const marketTrend = spyBullish && qqqBullish ? 'bullish' : (!spyBullish && !qqqBullish ? 'bearish' : 'neutral');

  return {
    sp500Change,
    nasdaqChange,
    marketTrend,
    lastUpdated: new Date().toISOString(),
    dataSource: 'live',
    pollingIntervalMs,
  };
}

function buildSectorStatuses(sectorBars: Record<string, Bar[]>): SectorStatus[] {
  return Object.entries(WSP_CONFIG.sectorMap).map(([sector, etfs]) => {
    const bars = sectorBars[etfs[0]] ?? [];
    const indicators = computeIndicators(bars, bars);
    const changePercent = computeDailyChange(bars);
    const isBullish = indicators.sma50 !== null && indicators.sma200 !== null &&
      indicators.sma50 > indicators.sma200 &&
      (bars[bars.length - 1]?.close ?? 0) > indicators.sma50;

    return {
      sector,
      isBullish,
      changePercent,
      sma50AboveSma200: indicators.sma50 !== null && indicators.sma200 !== null ? indicators.sma50 > indicators.sma200 : false,
    };
  });
}

function computeDailyChange(bars: Bar[]): number {
  if (bars.length < 2) return 0;
  const latest = bars[bars.length - 1].close;
  const previous = bars[bars.length - 2].close;
  if (previous === 0) return 0;
  return Number((((latest - previous) / previous) * 100).toFixed(2));
}

function isSeriesBullish(bars: Bar[]): boolean {
  const indicators = computeIndicators(bars, bars);
  const latestClose = bars[bars.length - 1]?.close ?? 0;
  return indicators.sma50 !== null && indicators.sma200 !== null && latestClose > indicators.sma50 && indicators.sma50 > indicators.sma200;
}

function createFallbackResponse(reason: string, pollingIntervalMs: number): ScreenerApiResponse {
  const lastFetch = new Date().toISOString();
  return {
    market: {
      ...demoMarket,
      lastUpdated: lastFetch,
      pollingIntervalMs,
    },
    stocks: demoStocks.map((stock) => ({
      ...stock,
      lastUpdated: lastFetch,
      dataSource: 'fallback',
    })),
    sectorStatuses: Object.keys(WSP_CONFIG.sectorMap).map((sector) => ({
      sector,
      isBullish: false,
      changePercent: 0,
      sma50AboveSma200: false,
    })),
    providerStatus: {
      provider: 'demo',
      isLive: false,
      uiState: 'FALLBACK',
      lastFetch,
      failedSymbols: TRACKED_SYMBOLS.map((item) => item.symbol),
      successCount: 0,
      errorMessage: reason,
      isFallback: true,
      fallbackActive: true,
      symbolCount: TRACKED_SYMBOLS.length,
      benchmarkSymbol: WSP_CONFIG.benchmark,
      benchmarkFetchStatus: 'failed',
      refreshIntervalMs: pollingIntervalMs,
    },
  };
}

function createErrorResponse(reason: string, pollingIntervalMs: number): ScreenerApiResponse {
  return {
    market: {
      ...demoMarket,
      lastUpdated: new Date().toISOString(),
      pollingIntervalMs,
    },
    stocks: [],
    sectorStatuses: [],
    providerStatus: {
      provider: 'finnhub',
      isLive: false,
      uiState: 'ERROR',
      lastFetch: null,
      failedSymbols: TRACKED_SYMBOLS.map((item) => item.symbol),
      successCount: 0,
      errorMessage: reason,
      isFallback: false,
      fallbackActive: false,
      symbolCount: TRACKED_SYMBOLS.length,
      benchmarkSymbol: WSP_CONFIG.benchmark,
      benchmarkFetchStatus: 'failed',
      refreshIntervalMs: pollingIntervalMs,
    },
  };
}

function sendJson(res: ServerResponse, statusCode: number, payload: ScreenerApiResponse) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}
