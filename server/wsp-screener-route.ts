import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { evaluateStock } from '../src/lib/wsp-engine';
import { computeIndicators, normalizeBarsChronologically } from '../src/lib/wsp-indicators';
import { demoMarket, demoStocks } from '../src/lib/demo-data';
import { TRACKED_SYMBOLS } from '../src/lib/tracked-symbols';
import { WSP_CONFIG } from '../src/lib/wsp-config';
import type { Bar, MarketOverview, ProviderReadiness, ScreenerApiResponse, ScreenerUiState, SectorStatus } from '../src/lib/wsp-types';
import { createMarketDataProvider } from './market-data-provider';
import { buildScreenerDebugSummary } from '../src/lib/wsp-validation';
import { sanitizeClientErrorMessage } from '../src/lib/safe-messages';
import { buildDiscoverySnapshot } from '../src/lib/discovery';
import { resolveScreenerTrustState } from '../src/lib/screener-trust';
import { NASDAQ_BENCHMARK, SP500_BENCHMARK } from '../src/lib/benchmarks';

const DEFAULT_POLLING_INTERVAL_MS = WSP_CONFIG.refreshInterval;
const ROUTE_VERSION = 'wsp-screener-route@2026-03-26.1';

let cachedLiveSnapshot: ScreenerApiResponse | null = null;
let inFlightRefresh: Promise<ScreenerApiResponse> | null = null;
let lastSuccessfulLiveFetch: string | null = null;
type PipelineStage =
  | 'init'
  | 'env_check'
  | 'benchmark_fetch'
  | 'market_fetch'
  | 'sector_fetch'
  | 'stock_fetch'
  | 'snapshot_build'
  | 'fallback_build'
  | 'completed';

type FallbackCause = 'necessary' | 'misconfiguration' | 'unknown';
interface BenchmarkQuality {
  renderable: boolean;
  pricePresent: boolean;
  dailyMovePresent: boolean;
  missingSymbols: string[];
  reason: string;
}

interface SnapshotQuality {
  pass: boolean;
  benchmarkCardsRenderable: boolean;
  sectorDataPresent: boolean;
  discoveryDataPresent: boolean;
  reason: string;
}

function classifyFallbackCause(finalModeReason: string, envVarPresent: boolean, routeReachable: boolean): FallbackCause {
  if (!routeReachable || !envVarPresent) return 'misconfiguration';
  if (finalModeReason.toLowerCase().includes('failed') || finalModeReason.toLowerCase().includes('unavailable')) return 'necessary';
  return 'unknown';
}

function assessBenchmarkQuality(market: MarketOverview): BenchmarkQuality {
  const missingSymbols: string[] = [];
  const pricePresent = market.sp500Price !== null && market.nasdaqPrice !== null;
  const dailyMovePresent = Number.isFinite(market.sp500Change) && Number.isFinite(market.nasdaqChange);
  if (market.sp500Price === null || !Number.isFinite(market.sp500Change)) missingSymbols.push(SP500_BENCHMARK.symbol);
  if (market.nasdaqPrice === null || !Number.isFinite(market.nasdaqChange)) missingSymbols.push(NASDAQ_BENCHMARK.symbol);
  const renderable = missingSymbols.length === 0;
  return {
    renderable,
    pricePresent,
    dailyMovePresent,
    missingSymbols,
    reason: renderable
      ? 'SPY and QQQ benchmarks are present and renderable.'
      : `Missing benchmark values for ${missingSymbols.join(', ')}.`,
  };
}

function assessSnapshotQuality({
  benchmarkQuality,
  sectorStatuses,
  discovery,
}: {
  benchmarkQuality: BenchmarkQuality;
  sectorStatuses: SectorStatus[];
  discovery: ScreenerApiResponse['discovery'];
}): SnapshotQuality {
  const sectorDataPresent = sectorStatuses.some((status) => Number.isFinite(status.changePercent));
  const discoveryCount = discovery.HOT.length + discovery.BREAKOUT.length + discovery.BULLISH.length + discovery.BEARISH.length;
  const discoveryDataPresent = discoveryCount > 0;
  const benchmarkCardsRenderable = benchmarkQuality.renderable;
  const pass = benchmarkCardsRenderable && sectorDataPresent && discoveryDataPresent;
  const reasons: string[] = [];
  if (!benchmarkCardsRenderable) reasons.push(benchmarkQuality.reason);
  if (!sectorDataPresent) reasons.push('Sector ranking context is missing.');
  if (!discoveryDataPresent) reasons.push('Discovery buckets are empty.');

  return {
    pass,
    benchmarkCardsRenderable,
    sectorDataPresent,
    discoveryDataPresent,
    reason: pass ? 'Stale snapshot passed benchmark + discovery + sector quality gates.' : reasons.join(' '),
  };
}

export async function handleWspScreenerRequest(req: IncomingMessage, res: ServerResponse) {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const forceRefresh = requestUrl.searchParams.get('forceRefresh') === '1';
  const intervalCandidate = Number(requestUrl.searchParams.get('intervalMs'));
  const pollingIntervalMs = Number.isFinite(intervalCandidate) && intervalCandidate >= 30_000
    ? intervalCandidate
    : DEFAULT_POLLING_INTERVAL_MS;

  try {
    const payload = await getScreenerSnapshot({ forceRefresh, pollingIntervalMs });
    const enrichedPayload: ScreenerApiResponse = {
      ...payload,
      providerStatus: {
        ...payload.providerStatus,
        readiness: {
          ...payload.providerStatus.readiness,
          routeReachable: true,
        },
      },
    };
    sendJson(res, 200, createRouteResponse(enrichedPayload));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const errorPayload = createErrorResponse(sanitizeClientErrorMessage(message), pollingIntervalMs, true, 'snapshot_build');
    sendJson(res, 500, createRouteResponse(errorPayload));
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
        lastSuccessfulLiveFetch = snapshot.providerStatus.lastFetch;
      }
      return snapshot;
    })
    .finally(() => {
      inFlightRefresh = null;
    });

  return inFlightRefresh;
}

async function buildSnapshot(pollingIntervalMs: number): Promise<ScreenerApiResponse> {
  let stage: PipelineStage = 'init';
  const providerSelection = createMarketDataProvider();
  if (!providerSelection.envVarPresent) {
    stage = 'env_check';
    return createFallbackResponse(
      'Provider authentication failed. Check server configuration.',
      pollingIntervalMs,
      stage,
      providerSelection.providerName === 'alpaca'
        ? 'Missing ALPACA_API_KEY_ID or ALPACA_API_SECRET_KEY env var.'
        : 'Missing FINNHUB_API_KEY env var.',
      false,
      0,
      2,
      0,
      TRACKED_SYMBOLS.length,
      providerSelection.providerName,
      false,
    );
  }

  const provider = providerSelection.provider;
  stage = 'benchmark_fetch';

  try {
    const benchmarkSymbols = [...new Set([SP500_BENCHMARK.symbol, NASDAQ_BENCHMARK.symbol, WSP_CONFIG.benchmark])];
    const benchmarkSettled = await Promise.allSettled(
      benchmarkSymbols.map(async (symbol) => ({ symbol, result: await provider.fetchDailyHistory(symbol) })),
    );
    const benchmarkSuccesses = benchmarkSettled
      .flatMap((entry) => entry.status === 'fulfilled' ? [entry.value] : []);
    const benchmarkFailures = benchmarkSettled.filter((entry) => entry.status === 'rejected').length;
    const benchmarkFailureSymbols = benchmarkSettled
      .flatMap((entry, idx) => entry.status === 'rejected' ? [benchmarkSymbols[idx]] : []);
    const benchmarkSeries = Object.fromEntries(
      benchmarkSuccesses.map(({ symbol, result }) => [symbol, result]),
    ) as Record<string, { bars: Bar[]; stale: boolean }>;

    stage = 'market_fetch';
    const marketSettled = await Promise.allSettled(
      WSP_CONFIG.marketRegimeSymbols.map(async (symbol) => ({ symbol, result: await provider.fetchDailyHistory(symbol) })),
    );
    const marketSeries = Object.fromEntries(
      marketSettled
        .flatMap((entry) => entry.status === 'fulfilled' ? [entry.value] : [])
        .map(({ symbol, result }) => [symbol, result]),
    ) as Record<string, { bars: Bar[]; stale: boolean }>;
    for (const [symbol, result] of Object.entries(benchmarkSeries)) {
      if (!marketSeries[symbol]) marketSeries[symbol] = result;
    }

    const missingMarketSymbols = WSP_CONFIG.marketRegimeSymbols.filter((symbol) => !marketSeries[symbol]);
    const benchmarkBars = marketSeries[WSP_CONFIG.benchmark]?.bars
      ?? marketSeries[SP500_BENCHMARK.symbol]?.bars
      ?? marketSeries[NASDAQ_BENCHMARK.symbol]?.bars
      ?? benchmarkSeries[WSP_CONFIG.benchmark]?.bars
      ?? benchmarkSeries[SP500_BENCHMARK.symbol]?.bars
      ?? benchmarkSeries[NASDAQ_BENCHMARK.symbol]?.bars
      ?? [];

    if (benchmarkBars.length === 0) {
      stage = 'fallback_build';
      return createFallbackResponse(
        'Market benchmarks unavailable from provider.',
        pollingIntervalMs,
        stage,
        `Benchmark fetch failed for ${benchmarkFailureSymbols.join(', ') || 'all symbols'}.`,
        true,
        benchmarkSuccesses.length,
        Math.max(2, benchmarkFailures),
        0,
        TRACKED_SYMBOLS.length,
        provider.providerName,
        providerSelection.envVarPresent,
      );
    }

    stage = 'sector_fetch';
    const sectorEtfSymbols = [...new Set(Object.values(WSP_CONFIG.sectorMap).flat())];
    const sectorResults = await Promise.allSettled(
      sectorEtfSymbols.map(async (symbol) => ({ symbol, result: await provider.fetchDailyHistory(symbol) })),
    );

    stage = 'stock_fetch';
    const stockResults = await Promise.allSettled(
      TRACKED_SYMBOLS.map(async (meta) => ({ meta, result: await provider.fetchDailyHistory(meta.symbol) })),
    );

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
    stage = 'snapshot_build';
    const quoteUniverse = [...new Set([
      SP500_BENCHMARK.symbol,
      NASDAQ_BENCHMARK.symbol,
      ...TRACKED_SYMBOLS.map((item) => item.symbol),
      ...sectorEtfSymbols,
    ])];
    const latestQuotes = await provider.fetchLatestQuotes(quoteUniverse);
    const marketOverview = buildMarketOverview(marketSeries, pollingIntervalMs, latestQuotes);
    const benchmarkQuality = assessBenchmarkQuality(marketOverview);
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

    if (evaluatedStocks.length === 0) {
      stage = 'fallback_build';
      return createFallbackResponse(
        `${provider.providerName} returned no successful stock histories.`,
        pollingIntervalMs,
        stage,
        'All tracked stock symbol fetches failed after benchmark success.',
        true,
        benchmarkSuccesses.length,
        benchmarkFailures,
        0,
        TRACKED_SYMBOLS.length,
        provider.providerName,
        true,
      );
    }

    const quoteStale = quoteUniverse.some((symbol) => latestQuotes[symbol]?.stale);
    const anyStale = Object.values(marketSeries).some((series) => series.stale) ||
      resolvedStockResults.some(({ result }) => result.stale) ||
      resolvedSectorResults.some(({ result }) => result.stale) ||
      failedSymbols.length > 0 ||
      missingMarketSymbols.length > 0 ||
      quoteStale;

    const uiState: ScreenerUiState = anyStale ? 'STALE' : 'LIVE';
    const { discovery, discoveryMeta } = buildDiscoverySnapshot(evaluatedStocks, uiState);
    const snapshotQuality = assessSnapshotQuality({
      benchmarkQuality,
      sectorStatuses,
      discovery,
    });

    if (uiState === 'STALE' && !snapshotQuality.pass) {
      stage = 'fallback_build';
      return createFallbackResponse(
        'Stale snapshot failed benchmark quality gate.',
        pollingIntervalMs,
        stage,
        `Rejected stale snapshot: ${snapshotQuality.reason}`,
        cachedLiveSnapshot !== null,
        benchmarkSuccesses.length,
        benchmarkFailures + benchmarkQuality.missingSymbols.length,
        evaluatedStocks.length,
        failedSymbols.length,
        provider.providerName,
        true,
      );
    }
    const lastFetch = new Date().toISOString();
    const readiness = createReadiness({
      envVarPresent: providerSelection.envVarPresent,
      routeReachable: true,
      symbolsFetchedSuccessfully: evaluatedStocks.length,
      symbolsFailed: failedSymbols.length,
    });

    if (uiState === 'LIVE') {
      lastSuccessfulLiveFetch = lastFetch;
      readiness.lastSuccessfulLiveFetch = lastFetch;
    }

    return {
      market: {
        ...marketOverview,
        dataSource: 'live',
      },
      stocks: evaluatedStocks,
      discovery,
      discoveryMeta,
      sectorStatuses,
      providerStatus: {
        provider: provider.providerName,
        isLive: uiState === 'LIVE',
        uiState,
        lastFetch,
        failedSymbols,
        successCount: evaluatedStocks.length,
        errorMessage: failedSymbols.length > 0
          ? 'Market data temporarily unavailable.'
          : (anyStale ? `One or more ${provider.providerName} datasets are stale or limited on the free feed.` : null),
        isFallback: false,
        fallbackActive: false,
        symbolCount: TRACKED_SYMBOLS.length,
        benchmarkSymbol: WSP_CONFIG.benchmark,
        benchmarkFetchStatus: anyStale ? 'stale' : 'success',
        refreshIntervalMs: pollingIntervalMs,
        readiness,
        debugPipeline: {
          stage: 'completed',
          finalModeReason: uiState === 'LIVE'
            ? 'All critical benchmark and stock datasets fetched successfully.'
            : `Using stale/partial live dataset because one or more ${provider.providerName} fetches failed, were stale, or had free-feed limitations.`,
          providerAuth: 'success',
          benchmarkSuccessCount: benchmarkSuccesses.length,
          benchmarkFailureCount: benchmarkFailures,
          stockSuccessCount: evaluatedStocks.length,
          stockFailureCount: failedSymbols.length,
          staleCacheAvailable: cachedLiveSnapshot !== null,
          fallbackBuild: 'failed',
          benchmarkRenderable: benchmarkQuality.renderable,
          benchmarkPricePresent: benchmarkQuality.pricePresent,
          benchmarkDailyMovePresent: benchmarkQuality.dailyMovePresent,
          benchmarkCardsRenderable: snapshotQuality.benchmarkCardsRenderable,
          sectorDataPresent: snapshotQuality.sectorDataPresent,
          discoveryDataPresent: snapshotQuality.discoveryDataPresent,
          staleSnapshotQuality: uiState === 'STALE' ? 'pass' : undefined,
          staleSnapshotQualityReason: uiState === 'STALE' ? snapshotQuality.reason : undefined,
        },
        runtimeDiagnostics: {
          envKeyPresent: providerSelection.envVarPresent,
          edgeFunctionReachable: true,
          fetchTarget: '/api/wsp-screener',
          authOutcome: 'not_required',
          benchmarkFetch: anyStale ? 'stale' : 'success',
          routeVersion: ROUTE_VERSION,
          buildMarker: process.env.VITE_APP_BUILD_MARKER ?? 'server-runtime',
          finalModeReason: uiState === 'LIVE'
            ? 'All critical benchmark and stock datasets fetched successfully.'
            : `Using stale/partial live dataset because one or more ${provider.providerName} fetches failed, were stale, or had free-feed limitations.`,
          fallbackCause: anyStale ? 'necessary' : 'unknown',
        },
      },
      trust: resolveScreenerTrustState({
        uiState,
        benchmarkFetchStatus: anyStale ? 'stale' : 'success',
        fallbackActive: false,
        dataProvenance: 'edge_function',
      }),
      debugSummary: buildScreenerDebugSummary(evaluatedStocks),
    };
  } catch (error) {
    const message = sanitizeClientErrorMessage(error instanceof Error ? error.message : `Failed to refresh ${provider.providerName} data`);

    if (cachedLiveSnapshot) {
      const cachedBenchmarkQuality = assessBenchmarkQuality(cachedLiveSnapshot.market);
      const cachedSnapshotQuality = assessSnapshotQuality({
        benchmarkQuality: cachedBenchmarkQuality,
        sectorStatuses: cachedLiveSnapshot.sectorStatuses,
        discovery: cachedLiveSnapshot.discovery,
      });
      if (!cachedSnapshotQuality.pass) {
        return createFallbackResponse(
          message,
          pollingIntervalMs,
          'fallback_build',
          `Cached stale snapshot rejected by quality gate. ${cachedSnapshotQuality.reason}`,
          true,
          0,
          2,
          cachedLiveSnapshot.providerStatus.successCount,
          cachedLiveSnapshot.providerStatus.failedSymbols.length,
          provider.providerName,
          providerSelection.envVarPresent,
        );
      }

      return {
        ...cachedLiveSnapshot,
        providerStatus: {
          ...cachedLiveSnapshot.providerStatus,
          isLive: false,
          uiState: 'STALE',
          errorMessage: message,
          benchmarkFetchStatus: cachedLiveSnapshot.providerStatus.benchmarkFetchStatus,
          refreshIntervalMs: pollingIntervalMs,
          readiness: createReadiness({
            envVarPresent: providerSelection.envVarPresent,
            routeReachable: true,
            symbolsFetchedSuccessfully: cachedLiveSnapshot.providerStatus.successCount,
            symbolsFailed: cachedLiveSnapshot.providerStatus.failedSymbols.length,
          }),
          debugPipeline: {
            stage,
            finalModeReason: 'Serving cached stale snapshot after live refresh failed.',
            providerAuth: providerSelection.envVarPresent ? 'success' : 'failed',
            benchmarkSuccessCount: cachedLiveSnapshot.providerStatus.benchmarkFetchStatus === 'failed' ? 0 : 1,
            benchmarkFailureCount: cachedLiveSnapshot.providerStatus.benchmarkFetchStatus === 'failed' ? 1 : 0,
            stockSuccessCount: cachedLiveSnapshot.providerStatus.successCount,
            stockFailureCount: cachedLiveSnapshot.providerStatus.failedSymbols.length,
            staleCacheAvailable: true,
            fallbackBuild: 'failed',
            benchmarkRenderable: cachedBenchmarkQuality.renderable,
            benchmarkPricePresent: cachedBenchmarkQuality.pricePresent,
            benchmarkDailyMovePresent: cachedBenchmarkQuality.dailyMovePresent,
            benchmarkCardsRenderable: cachedSnapshotQuality.benchmarkCardsRenderable,
            sectorDataPresent: cachedSnapshotQuality.sectorDataPresent,
            discoveryDataPresent: cachedSnapshotQuality.discoveryDataPresent,
            staleSnapshotQuality: cachedSnapshotQuality.pass ? 'pass' : 'fail',
            staleSnapshotQualityReason: cachedSnapshotQuality.reason,
          },
          runtimeDiagnostics: {
            envKeyPresent: providerSelection.envVarPresent,
            edgeFunctionReachable: true,
            fetchTarget: '/api/wsp-screener',
            authOutcome: 'not_required',
            benchmarkFetch: cachedLiveSnapshot.providerStatus.benchmarkFetchStatus,
            routeVersion: ROUTE_VERSION,
            buildMarker: process.env.VITE_APP_BUILD_MARKER ?? 'server-runtime',
            finalModeReason: 'Serving cached stale snapshot after live refresh failed.',
            fallbackCause: 'necessary',
          },
        },
      };
    }

    return createFallbackResponse(
      message,
      pollingIntervalMs,
      stage,
      `Live refresh failed at stage ${stage}.`,
      true,
      0,
      2,
      0,
      TRACKED_SYMBOLS.length,
      provider.providerName,
      providerSelection.envVarPresent,
    );
  }
}

function createReadiness({
  envVarPresent,
  routeReachable,
  symbolsFetchedSuccessfully,
  symbolsFailed,
}: {
  envVarPresent: boolean;
  routeReachable: boolean;
  symbolsFetchedSuccessfully: number;
  symbolsFailed: number;
}): ProviderReadiness {
  return {
    envVarPresent,
    routeReachable,
    benchmarkSymbolConfigured: WSP_CONFIG.benchmark.trim().length > 0,
    trackedSymbolsCount: TRACKED_SYMBOLS.length,
    symbolsFetchedSuccessfully,
    symbolsFailed,
    lastSuccessfulLiveFetch,
  };
}

function buildMarketOverview(
  marketSeries: Record<string, { bars: Bar[]; stale: boolean }>,
  pollingIntervalMs: number,
  latestQuotes: Record<string, { price: number | null; stale: boolean }>,
): MarketOverview {
  const spyBars = marketSeries[SP500_BENCHMARK.symbol]?.bars ?? [];
  const qqqBars = marketSeries[NASDAQ_BENCHMARK.symbol]?.bars ?? [];
  const spyLatestPrice = latestQuotes[SP500_BENCHMARK.symbol]?.price ?? spyBars[spyBars.length - 1]?.close ?? null;
  const qqqLatestPrice = latestQuotes[NASDAQ_BENCHMARK.symbol]?.price ?? qqqBars[qqqBars.length - 1]?.close ?? null;
  const sp500Change = computeDailyChange(spyBars);
  const nasdaqChange = computeDailyChange(qqqBars);
  const spyBullish = isSeriesBullish(spyBars);
  const qqqBullish = isSeriesBullish(qqqBars);
  const marketTrend = spyBullish && qqqBullish ? 'bullish' : (!spyBullish && !qqqBullish ? 'bearish' : 'neutral');
  const anyStale = marketSeries[SP500_BENCHMARK.symbol]?.stale ||
    marketSeries[NASDAQ_BENCHMARK.symbol]?.stale ||
    latestQuotes[SP500_BENCHMARK.symbol]?.stale ||
    latestQuotes[NASDAQ_BENCHMARK.symbol]?.stale;
  const benchmarkState = anyStale ? 'stale' : 'live';

  return {
    sp500Change,
    nasdaqChange,
    sp500Price: spyLatestPrice,
    nasdaqPrice: qqqLatestPrice,
    sp500Symbol: SP500_BENCHMARK.symbol,
    nasdaqSymbol: NASDAQ_BENCHMARK.symbol,
    benchmarkState,
    benchmarkLastUpdated: new Date().toISOString(),
    marketTrend,
    lastUpdated: new Date().toISOString(),
    dataSource: 'live',
    pollingIntervalMs,
  };
}

function buildSectorStatuses(sectorBars: Record<string, Bar[]>): SectorStatus[] {
  return Object.entries(WSP_CONFIG.sectorMap).map(([sector, etfs]) => {
    const bars = sectorBars[etfs[0]] ?? [];
    const normalizedBars = normalizeBarsChronologically(bars).bars;
    const indicators = computeIndicators(normalizedBars, normalizedBars);
    const changePercent = computeDailyChange(normalizedBars);
    const isBullish = indicators.sma50 !== null && indicators.sma200 !== null &&
      indicators.sma50 > indicators.sma200 &&
      (normalizedBars[normalizedBars.length - 1]?.close ?? 0) > indicators.sma50;

    return {
      sector,
      isBullish,
      changePercent,
      sma50AboveSma200: indicators.sma50 !== null && indicators.sma200 !== null ? indicators.sma50 > indicators.sma200 : false,
    };
  });
}

function computeDailyChange(bars: Bar[]): number {
  const normalizedBars = normalizeBarsChronologically(bars).bars;
  if (normalizedBars.length < 2) return 0;
  const latest = normalizedBars[normalizedBars.length - 1].close;
  const previous = normalizedBars[normalizedBars.length - 2].close;
  if (previous === 0) return 0;
  return Number((((latest - previous) / previous) * 100).toFixed(2));
}

function isSeriesBullish(bars: Bar[]): boolean {
  const normalizedBars = normalizeBarsChronologically(bars).bars;
  const indicators = computeIndicators(normalizedBars, normalizedBars);
  const latestClose = normalizedBars[normalizedBars.length - 1]?.close ?? 0;
  return indicators.sma50 !== null && indicators.sma200 !== null && latestClose > indicators.sma50 && indicators.sma50 > indicators.sma200;
}

function createFallbackResponse(
  reason: string,
  pollingIntervalMs: number,
  stage: PipelineStage = 'fallback_build',
  finalModeReason = 'Live provider unavailable. Falling back to demo dataset.',
  staleCacheAvailable = false,
  benchmarkSuccessCount = 0,
  benchmarkFailureCount = 2,
  stockSuccessCount = 0,
  stockFailureCount = TRACKED_SYMBOLS.length,
  providerName: 'alpaca' | 'finnhub' | 'demo' = 'demo',
  envVarPresent = Boolean(process.env.FINNHUB_API_KEY),
): ScreenerApiResponse {
  const safeReason = sanitizeClientErrorMessage(reason, 'Live provider unavailable. Demo mode active.');
  const lastFetch = new Date().toISOString();
  const providerLabel = providerName === 'demo' ? 'provider' : providerName;
  const modeReason = finalModeReason.includes('provider') ? finalModeReason : `${providerLabel}: ${finalModeReason}`;
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
    market: {
      ...demoMarket,
      lastUpdated: lastFetch,
      benchmarkState: 'fallback',
      benchmarkLastUpdated: lastFetch,
      pollingIntervalMs,
    },
    stocks: demoStocks.map((stock) => ({
      ...stock,
      lastUpdated: lastFetch,
      dataSource: 'fallback',
    })),
    ...buildDiscoverySnapshot(demoStocks, 'FALLBACK'),
    sectorStatuses: fallbackSectorStatuses,
    providerStatus: {
      provider: 'demo',
      isLive: false,
      uiState: 'FALLBACK',
      lastFetch,
      failedSymbols: TRACKED_SYMBOLS.map((item) => item.symbol),
      successCount: 0,
      errorMessage: safeReason,
      isFallback: true,
      fallbackActive: true,
      symbolCount: TRACKED_SYMBOLS.length,
      benchmarkSymbol: WSP_CONFIG.benchmark,
      benchmarkFetchStatus: 'failed',
      refreshIntervalMs: pollingIntervalMs,
      readiness: createReadiness({
        envVarPresent,
        routeReachable: true,
        symbolsFetchedSuccessfully: stockSuccessCount,
        symbolsFailed: stockFailureCount,
      }),
      debugPipeline: {
        stage,
        finalModeReason: modeReason,
        providerAuth: envVarPresent ? 'success' : 'failed',
        benchmarkSuccessCount,
        benchmarkFailureCount,
        stockSuccessCount,
        stockFailureCount,
        staleCacheAvailable,
        fallbackBuild: 'success',
        benchmarkRenderable: demoMarket.sp500Price !== null && demoMarket.nasdaqPrice !== null,
        benchmarkPricePresent: demoMarket.sp500Price !== null && demoMarket.nasdaqPrice !== null,
        benchmarkDailyMovePresent: Number.isFinite(demoMarket.sp500Change) && Number.isFinite(demoMarket.nasdaqChange),
        benchmarkCardsRenderable: demoMarket.sp500Price !== null && demoMarket.nasdaqPrice !== null,
        sectorDataPresent: fallbackSectorStatuses.length > 0,
        discoveryDataPresent: true,
      },
      runtimeDiagnostics: {
        envKeyPresent: envVarPresent,
        edgeFunctionReachable: true,
        fetchTarget: '/api/wsp-screener',
        authOutcome: 'not_required',
        benchmarkFetch: benchmarkSuccessCount > 0 ? 'stale' : 'failed',
        routeVersion: ROUTE_VERSION,
        buildMarker: process.env.VITE_APP_BUILD_MARKER ?? 'server-runtime',
        finalModeReason: modeReason,
        fallbackCause: classifyFallbackCause(modeReason, envVarPresent, true),
      },
    },
    trust: resolveScreenerTrustState({
      uiState: 'FALLBACK',
      benchmarkFetchStatus: 'failed',
      fallbackActive: true,
      dataProvenance: 'demo_fallback',
    }),
    debugSummary: buildScreenerDebugSummary(demoStocks),
  };
}

function createErrorResponse(reason: string, pollingIntervalMs: number, routeReachable: boolean, stage: PipelineStage = 'snapshot_build'): ScreenerApiResponse {
  const providerSelection = createMarketDataProvider();
  const safeReason = sanitizeClientErrorMessage(reason);
  return {
    market: {
      ...demoMarket,
      lastUpdated: new Date().toISOString(),
      benchmarkState: 'fallback',
      benchmarkLastUpdated: new Date().toISOString(),
      pollingIntervalMs,
    },
    stocks: [],
    ...buildDiscoverySnapshot([], 'ERROR'),
    sectorStatuses: [],
    providerStatus: {
      provider: providerSelection.providerName,
      isLive: false,
      uiState: 'ERROR',
      lastFetch: null,
      failedSymbols: TRACKED_SYMBOLS.map((item) => item.symbol),
      successCount: 0,
      errorMessage: safeReason,
      isFallback: false,
      fallbackActive: false,
      symbolCount: TRACKED_SYMBOLS.length,
      benchmarkSymbol: WSP_CONFIG.benchmark,
      benchmarkFetchStatus: 'failed',
      refreshIntervalMs: pollingIntervalMs,
      readiness: createReadiness({
        envVarPresent: providerSelection.envVarPresent,
        routeReachable,
        symbolsFetchedSuccessfully: 0,
        symbolsFailed: TRACKED_SYMBOLS.length,
      }),
      debugPipeline: {
        stage,
        finalModeReason: 'No renderable live, stale, or fallback snapshot exists.',
        providerAuth: providerSelection.envVarPresent ? 'success' : 'failed',
        benchmarkSuccessCount: 0,
        benchmarkFailureCount: 2,
        stockSuccessCount: 0,
        stockFailureCount: TRACKED_SYMBOLS.length,
        staleCacheAvailable: cachedLiveSnapshot !== null,
        fallbackBuild: 'failed',
      },
      runtimeDiagnostics: {
        envKeyPresent: providerSelection.envVarPresent,
        edgeFunctionReachable: routeReachable,
        fetchTarget: '/api/wsp-screener',
        authOutcome: 'not_required',
        benchmarkFetch: 'failed',
        routeVersion: ROUTE_VERSION,
        buildMarker: process.env.VITE_APP_BUILD_MARKER ?? 'server-runtime',
        finalModeReason: 'No renderable live, stale, or fallback snapshot exists.',
        fallbackCause: classifyFallbackCause('No renderable live, stale, or fallback snapshot exists.', providerSelection.envVarPresent, routeReachable),
      },
    },
    trust: resolveScreenerTrustState({
      uiState: 'ERROR',
      benchmarkFetchStatus: 'failed',
      fallbackActive: false,
      dataProvenance: 'edge_function',
    }),
    debugSummary: buildScreenerDebugSummary([]),
  };
}

function createRouteResponse(payload: ScreenerApiResponse) {
  const hasUsableSnapshot = Boolean(payload.market && payload.discovery && payload.providerStatus.uiState !== 'ERROR');
  const mode = payload.providerStatus.uiState;
  return {
    ok: hasUsableSnapshot,
    mode,
    data: hasUsableSnapshot ? {
      trackedSymbols: TRACKED_SYMBOLS,
      stockBars: {},
      benchmarkBars: [],
      benchmarkSymbol: payload.providerStatus.benchmarkSymbol,
      marketBars: {},
      sectorEtfBars: {},
      sectorMap: WSP_CONFIG.sectorMap,
      marketRegimeSymbols: WSP_CONFIG.marketRegimeSymbols,
    } : null,
    error: payload.providerStatus.errorMessage ? {
      code: mode === 'ERROR' ? 'NO_USABLE_SNAPSHOT' : 'PARTIAL_DATA',
      message: payload.providerStatus.errorMessage,
      failedSymbols: payload.providerStatus.failedSymbols,
    } : null,
    ...payload,
    providerStatus: {
      provider: payload.providerStatus.provider,
      isLive: payload.providerStatus.isLive,
      apiKeyPresent: payload.providerStatus.readiness.envVarPresent,
      symbolsFetched: payload.providerStatus.successCount,
      symbolsFailed: payload.providerStatus.failedSymbols.length,
      totalSymbols: payload.providerStatus.symbolCount,
      fetchedAt: payload.providerStatus.lastFetch ?? undefined,
      cachedSymbols: cachedLiveSnapshot?.providerStatus.successCount ?? 0,
      routeVersion: payload.providerStatus.runtimeDiagnostics?.routeVersion ?? ROUTE_VERSION,
      finalModeReason: payload.providerStatus.runtimeDiagnostics?.finalModeReason ?? payload.providerStatus.debugPipeline?.finalModeReason,
      fallbackCause: payload.providerStatus.runtimeDiagnostics?.fallbackCause ?? 'unknown',
    },
    debugSummary: payload.providerStatus.debugPipeline,
  };
}

function sendJson(res: ServerResponse, statusCode: number, payload: ReturnType<typeof createRouteResponse>) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}
