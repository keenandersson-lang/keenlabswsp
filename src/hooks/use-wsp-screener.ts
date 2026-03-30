import { useQuery } from '@tanstack/react-query';
import type { ScreenerApiResponse, Bar, EvaluatedStock, MarketOverview, SectorStatus, ScreenerUiState, DiscoveryBuckets, DiscoveryMeta, StockIndicators, WSPPattern, SmaSlopeDirection, MansfieldTrend } from '@/lib/wsp-types';
import { WSP_CONFIG } from '@/lib/wsp-config';
import { evaluateStock } from '@/lib/wsp-engine';
import { computeIndicators, normalizeBarsChronologically } from '@/lib/wsp-indicators';
import { buildScreenerDebugSummary } from '@/lib/wsp-validation';
import { demoMarket, demoStocks } from '@/lib/demo-data';
import { TRACKED_SYMBOLS } from '@/lib/tracked-symbols';
import { sanitizeClientErrorMessage } from '@/lib/safe-messages';
import { buildDiscoverySnapshot } from '@/lib/discovery';
import { NASDAQ_BENCHMARK, SP500_BENCHMARK } from '@/lib/benchmarks';
import { supabase } from '@/integrations/supabase/client';

export type WspPatternCounts = Record<WSPPattern, number>;

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
    trackedSymbols: Array<{
      symbol: string;
      name: string;
      sector: string;
      industry: string;
      pattern?: string | null;
      recommendation?: string | null;
      trendState?: string | null;
      scannerScore?: number | null;
      exchange?: string;
      assetClass?: string;
      supportsFullWsp?: boolean;
      wspSupport?: string;
    }>;
    liveScannerCohort?: string[];
    stockBars: Record<string, Bar[]>;
    indicatorFallback?: Record<string, {
      close: number;
      ma50: number | null;
      ma150: number | null;
      above_ma50: boolean;
      above_ma150: boolean;
      volume_ratio: number | null;
      mansfield_rs: number | string | null;
      wsp_pattern: string | null;
      wsp_score: number | null;
      pct_change_1d: number | null;
      recommendation?: string | null;
      wsp_recommendation?: string | null;
    }>;
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

function toWspPattern(value: string | null | undefined): WSPPattern {
  switch ((value ?? '').toLowerCase()) {
    case 'climbing':
      return 'climbing';
    case 'base_or_climbing':
      return 'base_or_climbing';
    case 'downhill':
      return 'downhill';
    case 'base':
      return 'base';
    case 'tired':
      return 'tired';
    default:
      return 'base';
  }
}

function buildFallbackIndicators(fallback: NonNullable<EdgeFunctionResponse['data']>['indicatorFallback'][string]): StockIndicators {
  const ma50 = typeof fallback.ma50 === 'number' && Number.isFinite(fallback.ma50) ? fallback.ma50 : null;
  const ma150 = typeof fallback.ma150 === 'number' && Number.isFinite(fallback.ma150) ? fallback.ma150 : null;
  const mansfieldRs = parseOptionalNumericValue(fallback.mansfield_rs);
  const volumeRatio = typeof fallback.volume_ratio === 'number' && Number.isFinite(fallback.volume_ratio) ? fallback.volume_ratio : null;

  return {
    sma20: null,
    sma50: ma50,
    sma150: ma150,
    sma200: null,
    sma50Slope: null,
    sma50SlopeDirection: 'flat',
    resistanceZone: null,
    resistanceUpperBound: null,
    resistanceTouches: 0,
    resistanceTolerancePct: WSP_CONFIG.wsp.resistanceTolerancePct,
    resistanceTouchIndices: [],
    resistanceMostRecentTouchDate: null,
    breakoutLevel: null,
    currentClose: fallback.close,
    breakoutCloseDelta: null,
    closeAboveResistancePct: null,
    breakoutConfirmed: false,
    breakoutQualityPass: false,
    breakoutQualityReasons: [],
    breakoutClv: null,
    recentFalseBreakoutsCount: 0,
    barsSinceBreakout: null,
    breakoutStale: false,
    averageVolumeReference: null,
    volumeMultiple: volumeRatio,
    mansfieldRS: mansfieldRs,
    mansfieldRSPrev: mansfieldRs,
    mansfieldRSTrend: 'flat',
    mansfieldTransition: false,
    mansfieldUptrend: mansfieldRs !== null && mansfieldRs > 0,
    mansfieldValid: mansfieldRs !== null && mansfieldRs > 0,
    indicatorWarnings: [],
    chronologyNormalized: false,
  };
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

interface DirectScannerRow {
  symbol: string | null;
  sector: string | null;
  industry: string | null;
  pattern: string | null;
  recommendation: string | null;
  score: number | null;
  payload: unknown | null;
}

interface ScannerPayload {
  close?: number | null;
  ma50?: number | null;
  ma150?: number | null;
  ma50_slope?: string | null;
  above_ma50?: boolean | null;
  above_ma150?: boolean | null;
  volume_ratio?: number | null;
  mansfield_rs?: number | string | null;
  pattern?: string | null;
  wsp_pattern?: string | null;
  wsp_score?: number | null;
  pct_change_1d?: number | null;
}

interface WspIndicatorRow {
  symbol: string | null;
  above_ma50: boolean | null;
  ma50_slope: string | null;
  created_at: string | null;
}

const MA50_SLOPE_COLUMN = 'ma50_slope' as const;

function parseOptionalNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const parsed = parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

interface IndicatorSnapshotRow {
  symbol: string | null;
  close: number | null;
  pct_change_1d: number | null;
  created_at: string | null;
}

async function fetchQualifiedScanCount(): Promise<number | null> {
  const { count, error } = await (supabase as any)
    .from('market_scan_results_latest')
    .select('symbol', { count: 'exact', head: true })
;

  if (error) {
    return null;
  }

  return typeof count === 'number' ? count : null;
}

const SCANNER_PATTERN_PRIORITY: Record<string, number> = {
  climbing: 4,
  base_or_climbing: 3,
  base: 2,
  tired: 2,
  downhill: 1,
};

const MARKET_HEATMAP_SECTOR_ETFS: Record<string, string> = {
  Technology: 'XLK',
  Healthcare: 'XLV',
  Financials: 'XLF',
  Energy: 'XLE',
  'Consumer Discretionary': 'XLY',
  Industrials: 'XLI',
  'Communication Services': 'XLC',
  'Consumer Staples': 'XLP',
  Materials: 'XLB',
  'Real Estate': 'XLRE',
  Utilities: 'XLU',
};

const SECTOR_ETF_MAP: Record<string, string> = {
  Technology: 'XLK',
  Healthcare: 'XLV',
  Financials: 'XLF',
  Energy: 'XLE',
  'Consumer Discretionary': 'XLY',
  'Consumer Staples': 'XLP',
  Industrials: 'XLI',
  Materials: 'XLB',
  'Real Estate': 'XLRE',
  Utilities: 'XLU',
  'Communication Services': 'XLC',
  'Metals & Mining': 'XME',
};

function getScannerPatternPriority(stock: EvaluatedStock): number {
  const scannerPattern = (stock.scannerPattern ?? '').toLowerCase();
  if (scannerPattern in SCANNER_PATTERN_PRIORITY) {
    return SCANNER_PATTERN_PRIORITY[scannerPattern];
  }

  const wspPattern = stock.pattern;
  if (wspPattern === 'climbing') return SCANNER_PATTERN_PRIORITY.climbing;
  if (wspPattern === 'downhill') return SCANNER_PATTERN_PRIORITY.downhill;
  return SCANNER_PATTERN_PRIORITY.base;
}

function sortStocksForDefaultView(stocks: EvaluatedStock[]): EvaluatedStock[] {
  return [...stocks].sort((left, right) => {
    const scoreDiff = (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY);
    if (scoreDiff !== 0) return scoreDiff;

    const leftVolume = left.audit?.volumeMultiple ?? Number.NEGATIVE_INFINITY;
    const rightVolume = right.audit?.volumeMultiple ?? Number.NEGATIVE_INFINITY;
    const volumeDiff = rightVolume - leftVolume;
    if (volumeDiff !== 0) return volumeDiff;

    const patternDiff = getScannerPatternPriority(right) - getScannerPatternPriority(left);
    if (patternDiff !== 0) return patternDiff;

    return left.symbol.localeCompare(right.symbol);
  });
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

function buildDirectScannerStock(
  row: DirectScannerRow,
  nowIso: string,
  payload: ScannerPayload | null,
  latestIndicator: IndicatorSnapshotRow | null,
  sectorTrends: Record<string, boolean>,
): EvaluatedStock | null {
  if (!row.symbol) return null;
  const p = payload ?? {};
  const ma50 = typeof p.ma50 === 'number' && Number.isFinite(p.ma50) ? p.ma50 : null;
  const ma150 = typeof p.ma150 === 'number' && Number.isFinite(p.ma150) ? p.ma150 : null;
  const mansfieldRs = parseOptionalNumericValue(p.mansfield_rs);
  const volumeMultiple = typeof p.volume_ratio === 'number' && Number.isFinite(p.volume_ratio)
    ? p.volume_ratio
    : null;
  const ma50SlopeTrend = typeof p[MA50_SLOPE_COLUMN] === 'string'
    ? p[MA50_SLOPE_COLUMN].trim().toLowerCase()
    : null;
  const rowPattern = typeof row.pattern === 'string' ? row.pattern.toLowerCase() : null;
  const payloadPattern = typeof p.pattern === 'string'
    ? p.pattern.toLowerCase()
    : (typeof p.wsp_pattern === 'string' ? p.wsp_pattern.toLowerCase() : null);
  const hasWspIndicators = payload !== null;
  const aboveMa50 = p.above_ma50 === true;
  const aboveMa150 = p.above_ma150 === true;
  const slope50Positive = ma50SlopeTrend === 'rising';
  const effectivePattern = rowPattern ?? payloadPattern;
  const hasBreakout = effectivePattern === 'climbing' || effectivePattern === 'base_or_climbing';
  const mansfieldValid = mansfieldRs !== null && mansfieldRs > 0;
  const volumeValid = Number(p.volume_ratio) >= 2;
  const wspCriteriaPassCount = [aboveMa50, slope50Positive, aboveMa150, volumeValid, mansfieldValid].filter(Boolean).length;
  const allWspCriteriaPass = aboveMa50 && aboveMa150 && slope50Positive && volumeValid && mansfieldValid && effectivePattern === 'climbing';
  const scannerScore = typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : wspCriteriaPassCount;
  const scannerPattern = row.pattern ?? effectivePattern ?? 'base';
  const scannerRecommendation = row.recommendation ?? (allWspCriteriaPass
    ? 'KÖP'
    : (scannerPattern === 'downhill' ? 'UNDVIK' : scannerPattern === 'tired' ? 'SÄLJ' : 'BEVAKA'));
  const normalizedPattern = toWspPattern(scannerPattern);
  const sectorValue = row.sector ?? 'Unknown';
  const normalizedSector = row.sector ?? '';
  const normalizedIndustry = row.industry ?? 'Unknown';
  const rawPrice = Number(latestIndicator?.close ?? p.close ?? p.ma50 ?? 0);
  const currentPrice = Number.isFinite(Number(rawPrice)) ? Number(rawPrice) : 0;
  const indicatorChange = latestIndicator?.pct_change_1d;
  const changePercent = typeof indicatorChange === 'number' && Number.isFinite(indicatorChange)
    ? Number(indicatorChange.toFixed(2))
    : 0;
  const updatedAt = latestIndicator?.created_at ?? nowIso;
  const companyName = row.symbol;

  return {
    symbol: row.symbol,
    name: companyName || row.symbol,
    companyName,
    sector: sectorValue,
    industry: normalizedIndustry,
    price: currentPrice,
    changePercent,
    volume: 0,
    pattern: normalizedPattern,
    indicators: {
      sma20: null,
      sma50: ma50,
      sma150: ma150,
      sma200: null,
      sma50Slope: null,
      sma50SlopeDirection: ma50SlopeTrend === 'rising' ? 'rising' : ma50SlopeTrend === 'falling' ? 'falling' : 'flat' as SmaSlopeDirection,
      resistanceZone: null,
      resistanceUpperBound: null,
      resistanceTouches: 0,
      resistanceTolerancePct: WSP_CONFIG.wsp.resistanceTolerancePct,
      resistanceTouchIndices: [],
      resistanceMostRecentTouchDate: null,
      breakoutLevel: null,
      currentClose: currentPrice,
      breakoutCloseDelta: null,
      closeAboveResistancePct: null,
      breakoutConfirmed: false,
      breakoutQualityPass: false,
      breakoutQualityReasons: [],
      breakoutClv: null,
      recentFalseBreakoutsCount: 0,
      barsSinceBreakout: null,
      breakoutStale: false,
      averageVolumeReference: null,
      volumeMultiple,
      mansfieldRS: mansfieldRs,
      mansfieldRSPrev: mansfieldRs,
      mansfieldRSTrend: mansfieldRs === null ? 'flat' : (mansfieldRs > 0 ? 'rising' : mansfieldRs < 0 ? 'falling' : 'flat') as MansfieldTrend,
      mansfieldTransition: false,
      mansfieldUptrend: mansfieldValid,
      mansfieldValid,
      indicatorWarnings: [],
      chronologyNormalized: false,
    },
    gate: {
      isValidWspEntry: allWspCriteriaPass,
      priceAboveMA50: aboveMa50,
      ma50Rising: slope50Positive,
      priceAboveMA150: aboveMa150,
      breakoutValid: hasBreakout,
      breakoutFresh: false,
      volumeSufficient: volumeValid,
      mansfieldValid,
      sectorAligned: false,
      marketFavorable: false,
      patternAllowsEntry: normalizedPattern === 'climbing',
    },
    isValidWspEntry: allWspCriteriaPass,
    finalRecommendation: scannerRecommendation,
    audit: {
      pattern: normalizedPattern,
      finalRecommendation: scannerRecommendation,
      isValidWspEntry: allWspCriteriaPass,
      above50MA: aboveMa50,
      above150MA: aboveMa150,
      slope50Positive,
      sma20: null,
      sma50: ma50,
      sma150: ma150,
      sma200: null,
      sma50SlopeValue: null,
      sma50SlopeDirection: ma50SlopeTrend === 'rising' ? 'rising' : ma50SlopeTrend === 'falling' ? 'falling' : 'flat' as SmaSlopeDirection,
      breakoutValid: hasBreakout,
      breakoutStale: false,
      breakoutQualityPass: false,
      breakoutQualityReasons: [],
      resistanceLevel: null,
      resistanceUpperBound: null,
      resistanceTouches: 0,
      resistanceTolerancePct: WSP_CONFIG.wsp.resistanceTolerancePct,
      resistanceMostRecentTouchDate: null,
      breakoutLevel: null,
      currentClose: currentPrice,
      breakoutCloseDelta: null,
      closeAboveResistancePct: null,
      breakoutClv: null,
      recentFalseBreakoutsCount: 0,
      breakoutAgeBars: null,
      currentVolume: 0,
      averageVolumeReference: null,
      volumeMultiple,
      volumeValid,
      mansfieldLookbackBars: WSP_CONFIG.wsp.mansfieldLookbackBars,
      mansfieldValue: mansfieldRs,
      mansfieldValuePrev: mansfieldRs,
      mansfieldTrend: mansfieldRs === null ? 'flat' : (mansfieldRs > 0 ? 'rising' : mansfieldRs < 0 ? 'falling' : 'flat') as MansfieldTrend,
      mansfieldUptrend: mansfieldValid,
      mansfieldRecentTransition: false,
      mansfieldValid,
      staleBreakoutBars: WSP_CONFIG.wsp.staleBreakoutBars,
      sectorAligned: false,
      marketAligned: false,
      chronologyNormalized: false,
      indicatorWarnings: [],
      score: scannerScore,
      blockedReasons: [],
      exitReasons: [],
      wspSpec: { ...WSP_CONFIG.wsp },
    },
    blockedReasons: [],
    logicViolations: [],
    score: scannerScore,
    maxScore: 4,
    dataSource: 'live',
    lastUpdated: updatedAt,
    scannerPattern,
    scannerRecommendation,
    scannerScore,
    trendState: null,
    sectorBullish: sectorTrends[normalizedSector] ?? false,
    ...(hasWspIndicators ? { lastUpdated: updatedAt } : {}),
  };
}

async function fetchSectorTrends(): Promise<Record<string, boolean>> {
  const etfSymbols = [...new Set(Object.values(SECTOR_ETF_MAP))];
  const { data, error } = await (supabase as any)
    .from('wsp_indicators')
    .select(`distinct on (symbol) symbol, above_ma50, ${MA50_SLOPE_COLUMN}, created_at`)
    .in('symbol', etfSymbols)
    .order('symbol', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const latestTrendByEtf = new Map<string, boolean>();
  for (const row of (data ?? []) as WspIndicatorRow[]) {
    const symbol = row.symbol ?? '';
    if (!symbol) continue;
    const aboveMa50 = Boolean(row.above_ma50);
    const ma50Slope = typeof row[MA50_SLOPE_COLUMN] === 'string' ? row[MA50_SLOPE_COLUMN].trim().toLowerCase() : null;
    latestTrendByEtf.set(symbol, aboveMa50 && ma50Slope === 'rising');
  }

  return Object.fromEntries(
    Object.entries(SECTOR_ETF_MAP).map(([sector, etf]) => [sector, latestTrendByEtf.get(etf) ?? false]),
  );
}

async function buildSectorStatusesFromIndicators(): Promise<SectorStatus[]> {
  const sectorTrends = await fetchSectorTrends();
  return Object.keys(MARKET_HEATMAP_SECTOR_ETFS).map((sector) => {
    const isBullish = sectorTrends[sector] ?? false;
    return {
      sector,
      isBullish,
      changePercent: 0,
      sma50AboveSma200: isBullish,
    };
  });
}

async function fetchDirectFromSupabase(page: number = 0, pageSize: number = 50): Promise<EvaluatedStock[]> {
  console.log('[WSP] fetchDirectFromSupabase called, page:', page, 'pageSize:', pageSize);
  const sectorTrends = await fetchSectorTrends();
  const normalizedPage = Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0;
  const normalizedPageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 50;
  const effectivePageSize = Math.min(normalizedPageSize, 50);
  const offset = normalizedPage * effectivePageSize;

  const { data, error } = await (supabase as any)
    .from('market_scan_results_latest')
    .select('symbol, sector, industry, pattern, recommendation, score, payload')
    .order('score', { ascending: false })
    .range(offset, offset + effectivePageSize - 1)
    .limit(effectivePageSize);

  if (error) {
    throw new Error(error.message);
  }

  const allRows = (data ?? []) as DirectScannerRow[];
  console.log(`[WSP] Supabase direct fetch page ${normalizedPage + 1}: ${allRows.length} rows`);
  console.log(`[WSP] Supabase direct fetch final stock rows: ${allRows.length}`);

  const validRows = allRows.filter((row): row is DirectScannerRow & { symbol: string } => typeof row.symbol === 'string' && row.symbol.length > 0);
  const symbols = [...new Set(validRows.map((row) => row.symbol))];
  const latestIndicatorsBySymbol = new Map<string, IndicatorSnapshotRow>();
  if (symbols.length > 0) {
    const { data: indicatorRows, error: indicatorError } = await (supabase as any)
      .from('wsp_indicators')
      .select('symbol, close, pct_change_1d, created_at')
      .in('symbol', symbols)
      .order('symbol', { ascending: true })
      .order('created_at', { ascending: false });

    if (indicatorError) {
      throw new Error(indicatorError.message);
    }

    for (const indicatorRow of (indicatorRows ?? []) as IndicatorSnapshotRow[]) {
      if (!indicatorRow.symbol || latestIndicatorsBySymbol.has(indicatorRow.symbol)) continue;
      latestIndicatorsBySymbol.set(indicatorRow.symbol, indicatorRow);
    }
  }

  const nowIso = new Date().toISOString();
  return allRows
    .map((row) => {
      const rowPayload = row.payload && typeof row.payload === 'object'
        ? row.payload as ScannerPayload
        : null;
      return buildDirectScannerStock(
        row,
        nowIso,
        rowPayload,
        row.symbol ? latestIndicatorsBySymbol.get(row.symbol) ?? null : null,
        sectorTrends,
      );
    })
    .filter((stock): stock is EvaluatedStock => stock !== null);
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
  const trackedSymbolsCount = data.trackedSymbols?.length ?? TRACKED_SYMBOLS.length;
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
  const derivedSectorStatuses: SectorStatus[] = Object.entries(MARKET_HEATMAP_SECTOR_ETFS).map(([sector, etf]) => {
    const etfBars = data.sectorEtfBars[etf] ?? [];
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
  const sectorStatuses = derivedSectorStatuses;

  const sectorStatusMap = Object.fromEntries(sectorStatuses.map(s => [s.sector, s]));

  // Evaluate each stock
  const failedSymbols = edgeResp.error?.failedSymbols ?? [];
  const evaluatedStocks: EvaluatedStock[] = edgeResp.stocks?.length
    ? edgeResp.stocks
    : data.trackedSymbols
      .map(meta => {
        const bars = data.stockBars[meta.symbol] ?? [];
        const fallback = data.indicatorFallback?.[meta.symbol];
        const hasBars = bars.length > 0;
        if (!hasBars && !fallback) return null;

        const sectorAligned = sectorStatusMap[meta.sector]?.isBullish ?? false;
        if (hasBars) {
          const evaluated = evaluateStock(
            meta.symbol, meta.name, meta.sector, meta.industry,
            bars, benchmarkBars,
            sectorAligned, marketFavorable, 'live',
            {
              metadata: {
                exchange: meta.exchange ?? '',
                assetClass: (meta.assetClass as 'equity' | 'commodity' | 'metals') ?? 'equity',
                supportsFullWsp: meta.supportsFullWsp ?? true,
                wspSupport: (meta.wspSupport as 'full' | 'limited') ?? 'full',
              },
            },
          );
          const scannerScore = typeof meta.scannerScore === 'number' && Number.isFinite(meta.scannerScore)
            ? Math.max(0, Math.min(4, meta.scannerScore))
            : null;
          return {
            ...evaluated,
            score: scannerScore ?? evaluated.score,
            maxScore: 4,
            scannerPattern: meta.pattern ?? null,
            scannerRecommendation: meta.recommendation ?? 'BEVAKA',
            scannerScore,
            trendState: meta.trendState ?? null,
          };
        }

        const fallbackPattern = toWspPattern(fallback.wsp_pattern);
        const fallbackScore = typeof fallback.wsp_score === 'number' && Number.isFinite(fallback.wsp_score)
          ? Math.max(0, Math.min(4, fallback.wsp_score))
          : null;
        const fallbackPct = typeof fallback.pct_change_1d === 'number' && Number.isFinite(fallback.pct_change_1d)
          ? fallback.pct_change_1d
          : 0;
        const fallbackPrevClose = fallback.close / (1 + (fallbackPct / 100));
        const evaluated = evaluateStock(
          meta.symbol, meta.name, meta.sector, meta.industry,
          [], benchmarkBars,
          sectorAligned, marketFavorable, 'fallback',
          {
            overrideAnalysis: {
              pattern: fallbackPattern,
              indicators: buildFallbackIndicators(fallback),
              price: fallback.close,
              prevClose: Number.isFinite(fallbackPrevClose) ? fallbackPrevClose : fallback.close,
              volume: 0,
              lastUpdated: now,
            },
            metadata: {
              exchange: meta.exchange ?? '',
              assetClass: (meta.assetClass as 'equity' | 'commodity' | 'metals') ?? 'equity',
              supportsFullWsp: meta.supportsFullWsp ?? true,
              wspSupport: (meta.wspSupport as 'full' | 'limited') ?? 'full',
            },
          },
        );
        return {
          ...evaluated,
          score: fallbackScore ?? evaluated.score,
          maxScore: 4,
          scannerPattern: fallback.wsp_pattern ?? null,
          scannerRecommendation: fallback.wsp_recommendation ?? fallback.recommendation ?? 'BEVAKA',
          scannerScore: fallbackScore,
          trendState: meta.trendState ?? null,
        };
      })
      .filter((stock): stock is NonNullable<typeof stock> => stock !== null) as EvaluatedStock[];

  const benchmarkSuccessCount = Number(edgeResp.providerStatus.benchmarkSuccessCount ?? 0);
  const benchmarkFailureCount = Number(edgeResp.providerStatus.benchmarkFailureCount ?? 0);
  const anyStale = edgeResp.mode === 'STALE' || failedSymbols.length > 0 || benchmarkFailureCount > 0;
  const uiState: ScreenerUiState = anyStale ? 'STALE' : 'LIVE';
  const discoverySnapshot = edgeResp.discovery && edgeResp.discoveryMeta
    ? { discovery: edgeResp.discovery, discoveryMeta: edgeResp.discoveryMeta }
    : buildDiscoverySnapshot(evaluatedStocks, uiState);

  return {
    market: { ...market, dataSource: 'live' },
    stocks: sortStocksForDefaultView(evaluatedStocks),
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
      symbolCount: trackedSymbolsCount,
      benchmarkSymbol: WSP_CONFIG.benchmark,
      benchmarkFetchStatus: benchmarkBars.length > 0 ? (anyStale ? 'stale' : 'success') : 'failed',
      refreshIntervalMs: WSP_CONFIG.refreshInterval,
        readiness: {
        envVarPresent: edgeResp.providerStatus.apiKeyPresent,
        routeReachable: fetchDiagnostics.reachable,
        benchmarkSymbolConfigured: true,
        trackedSymbolsCount,
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

export async function fetchWspScreenerData(options?: { intervalMs?: number; forceRefresh?: boolean; page?: number; pageSize?: number }): Promise<ScreenerApiResponse> {
  const qualifiedScanCount = await fetchQualifiedScanCount();
  const applyQualifiedScanCount = (payload: ScreenerApiResponse): ScreenerApiResponse => {
    if (qualifiedScanCount === null) return payload;
    return {
      ...payload,
      providerStatus: {
        ...payload.providerStatus,
        symbolCount: qualifiedScanCount,
      },
    };
  };

  const now = new Date().toISOString();
  try {
    const directStocks = await fetchDirectFromSupabase(options?.page ?? 0, options?.pageSize ?? 50);
    const directSectorStatuses = await buildSectorStatusesFromIndicators();
    return {
      market: {
        ...demoMarket,
        dataSource: 'live',
        benchmarkState: 'stale',
        benchmarkLastUpdated: now,
        lastUpdated: now,
        pollingIntervalMs: options?.intervalMs ?? WSP_CONFIG.refreshInterval,
      },
      stocks: directStocks,
      ...buildDiscoverySnapshot(directStocks, 'LIVE'),
      sectorStatuses: directSectorStatuses,
      providerStatus: {
        provider: 'finnhub',
        isLive: true,
        uiState: 'LIVE',
        lastFetch: now,
        failedSymbols: [],
        successCount: directStocks.length,
        errorMessage: null,
        isFallback: false,
        fallbackActive: false,
        symbolCount: qualifiedScanCount ?? directStocks.length,
        benchmarkSymbol: WSP_CONFIG.benchmark,
        benchmarkFetchStatus: 'stale',
        refreshIntervalMs: options?.intervalMs ?? WSP_CONFIG.refreshInterval,
        readiness: {
          envVarPresent: true,
          routeReachable: true,
          benchmarkSymbolConfigured: true,
          trackedSymbolsCount: qualifiedScanCount ?? directStocks.length,
          symbolsFetchedSuccessfully: directStocks.length,
          symbolsFailed: 0,
          lastSuccessfulLiveFetch: now,
        },
        runtimeDiagnostics: {
          envKeyPresent: true,
          edgeFunctionReachable: false,
          fetchTarget: 'supabase:market_scan_results_latest',
          authOutcome: 'success',
          benchmarkFetch: 'stale',
          routeVersion: 'direct_supabase_query',
          buildMarker: import.meta.env.VITE_APP_BUILD_MARKER ?? `local-${import.meta.env.MODE}`,
          finalModeReason: `Direct Supabase scanner snapshot used (${directStocks.length} rows).`,
          fallbackCause: 'none',
        },
      },
      debugSummary: buildScreenerDebugSummary(directStocks),
    };
  } catch {
    // If direct query fails, return a safe fallback payload without edge-function invocation.
    const fallbackStocks = demoStocks.map((stock) => ({ ...stock, lastUpdated: now, dataSource: 'fallback' as const }));
    return applyQualifiedScanCount({
      market: {
        ...demoMarket,
        dataSource: 'fallback',
        benchmarkState: 'stale',
        benchmarkLastUpdated: now,
        lastUpdated: now,
      },
      stocks: fallbackStocks,
      ...buildDiscoverySnapshot(fallbackStocks, 'FALLBACK'),
      sectorStatuses: [],
      providerStatus: {
        provider: 'demo' as const,
        isLive: false,
        uiState: 'FALLBACK',
        lastFetch: now,
        failedSymbols: [],
        successCount: 0,
        errorMessage: 'Direct Supabase query failed.',
        isFallback: true,
        fallbackActive: true,
        symbolCount: qualifiedScanCount ?? 0,
        benchmarkSymbol: WSP_CONFIG.benchmark,
        benchmarkFetchStatus: 'failed',
        refreshIntervalMs: options?.intervalMs ?? WSP_CONFIG.refreshInterval,
        readiness: {
          envVarPresent: true,
          routeReachable: false,
          benchmarkSymbolConfigured: true,
          trackedSymbolsCount: qualifiedScanCount ?? 0,
          symbolsFetchedSuccessfully: 0,
          symbolsFailed: qualifiedScanCount ?? 0,
          lastSuccessfulLiveFetch: null,
        },
        runtimeDiagnostics: {
          envKeyPresent: true,
          edgeFunctionReachable: false,
          fetchTarget: 'supabase:market_scan_results_latest',
          authOutcome: 'failed',
          benchmarkFetch: 'failed',
          routeVersion: 'direct_supabase_query',
          buildMarker: import.meta.env.VITE_APP_BUILD_MARKER ?? `local-${import.meta.env.MODE}`,
          finalModeReason: 'Direct Supabase scanner query failed; using local fallback dataset.',
          fallbackCause: 'necessary',
        },
      },
      debugSummary: buildScreenerDebugSummary(fallbackStocks),
    });
  }
}

export function useWspScreener(intervalMs: number = WSP_CONFIG.refreshInterval, page: number = 0, pageSize: number = 50) {
  return useQuery({
    queryKey: ['wsp-screener', intervalMs, page, pageSize],
    queryFn: () => fetchWspScreenerData({ intervalMs, page, pageSize }),
    refetchInterval: intervalMs,
    staleTime: Math.max(15_000, intervalMs / 2),
    retry: 1,
  });
}

export async function fetchWspPatternCounts(): Promise<WspPatternCounts> {
  const counts: WspPatternCounts = {
    climbing: 0,
    base_or_climbing: 0,
    base: 0,
    tired: 0,
    downhill: 0,
  };

  const { data, error } = await supabase.rpc('get_scanner_funnel_counts');
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) return counts;

  const payload = data as {
    climbing?: number | null;
    base?: number | null;
    downhill?: number | null;
  };

  counts.climbing = Number(payload.climbing ?? 0);
  counts.base_or_climbing = Number(payload.base ?? 0);
  counts.downhill = Number(payload.downhill ?? 0);

  return counts;
}
