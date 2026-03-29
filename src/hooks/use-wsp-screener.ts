import { useQuery } from '@tanstack/react-query';
import type { ScreenerApiResponse, Bar, EvaluatedStock, MarketOverview, SectorStatus, ScreenerUiState, DiscoveryBuckets, DiscoveryMeta, StockIndicators, WSPPattern, WSPRecommendation } from '@/lib/wsp-types';
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
      mansfield_rs: number | null;
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
      return 'CLIMBING';
    case 'base_or_climbing':
      return 'BASE';
    case 'downhill':
      return 'DOWNHILL';
    case 'base':
      return 'BASE';
    case 'tired':
      return 'TIRED';
    default:
      return 'BASE';
  }
}

function recommendationFromPattern(pattern: WSPPattern): WSPRecommendation {
  if (pattern === 'CLIMBING') return 'KÖP';
  if (pattern === 'TIRED') return 'SÄLJ';
  if (pattern === 'DOWNHILL') return 'UNDVIK';
  return 'BEVAKA';
}

function buildFallbackIndicators(fallback: NonNullable<EdgeFunctionResponse['data']>['indicatorFallback'][string]): StockIndicators {
  const ma50 = typeof fallback.ma50 === 'number' && Number.isFinite(fallback.ma50) ? fallback.ma50 : null;
  const ma150 = typeof fallback.ma150 === 'number' && Number.isFinite(fallback.ma150) ? fallback.ma150 : null;
  const mansfieldRs = typeof fallback.mansfield_rs === 'number' && Number.isFinite(fallback.mansfield_rs) ? fallback.mansfield_rs : null;
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
  trend_state: string | null;
  score: number | null;
  payload: unknown | null;
  scan_date: string | null;
}

interface ScannerPayload {
  ma50?: number | null;
  ma150?: number | null;
  ma50_slope?: number | null;
  above_ma50?: boolean | null;
  above_ma150?: boolean | null;
  volume_ratio?: number | null;
  mansfield_rs?: number | null;
  wsp_score?: number | null;
  pct_change_1d?: number | null;
}

interface DailyPriceRow {
  symbol: string | null;
  close: number | null;
  date: string | null;
}

interface SymbolProfileRow {
  symbol: string | null;
  canonical_sector: string | null;
  canonical_industry: string | null;
  sector: string | null;
  industry: string | null;
}

const SCANNER_PATTERN_PRIORITY: Record<string, number> = {
  climbing: 4,
  base_or_climbing: 3,
  base: 2,
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

function getScannerPatternPriority(stock: EvaluatedStock): number {
  const scannerPattern = (stock.scannerPattern ?? '').toLowerCase();
  if (scannerPattern in SCANNER_PATTERN_PRIORITY) {
    return SCANNER_PATTERN_PRIORITY[scannerPattern];
  }

  const wspPattern = stock.pattern;
  if (wspPattern === 'CLIMBING') return SCANNER_PATTERN_PRIORITY.climbing;
  if (wspPattern === 'DOWNHILL') return SCANNER_PATTERN_PRIORITY.downhill;
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
  latestPrice: DailyPriceRow | null,
  profile: SymbolProfileRow | null,
): EvaluatedStock | null {
  if (!row.symbol) return null;
  const payloadScore = typeof payload?.wsp_score === 'number' && Number.isFinite(payload.wsp_score) ? payload.wsp_score : null;
  const scannerScore = payloadScore ?? (typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : null);
  const ma50 = typeof payload?.ma50 === 'number' && Number.isFinite(payload.ma50) ? payload.ma50 : null;
  const ma150 = typeof payload?.ma150 === 'number' && Number.isFinite(payload.ma150) ? payload.ma150 : null;
  const mansfieldRs = typeof payload?.mansfield_rs === 'number' && Number.isFinite(payload.mansfield_rs)
    ? payload.mansfield_rs
    : null;
  const volumeMultiple = typeof payload?.volume_ratio === 'number' && Number.isFinite(payload.volume_ratio)
    ? payload.volume_ratio
    : null;
  const ma50Slope = typeof payload?.ma50_slope === 'number' && Number.isFinite(payload.ma50_slope)
    ? payload.ma50_slope
    : null;
  const hasWspIndicators = payload !== null;
  const aboveMa50 = payload?.above_ma50 === true;
  const aboveMa150 = payload?.above_ma150 === true;
  const slope50Positive = ma50Slope !== null && ma50Slope > 0;
  const mansfieldValid = mansfieldRs !== null && mansfieldRs > 0;
  const volumeValid = volumeMultiple !== null && volumeMultiple >= WSP_CONFIG.wsp.volumeMultipleMin;
  const normalizedSector = profile?.canonical_sector
    ?? (row.sector && row.sector !== 'Unknown' ? row.sector : null)
    ?? profile?.sector
    ?? 'Unknown';
  const normalizedIndustry = profile?.canonical_industry
    ?? (row.industry && row.industry !== 'Unknown' ? row.industry : null)
    ?? profile?.industry
    ?? 'Unknown';
  const currentPrice = typeof latestPrice?.close === 'number' && Number.isFinite(latestPrice.close)
    ? latestPrice.close
    : 0;
  const changePercent = typeof payload?.pct_change_1d === 'number' && Number.isFinite(payload.pct_change_1d)
    ? Number(payload.pct_change_1d.toFixed(2))
    : 0;
  const updatedAt = latestPrice?.date ?? row.scan_date ?? nowIso;

  return {
    symbol: row.symbol,
    name: row.symbol,
    sector: normalizedSector,
    industry: normalizedIndustry,
    price: currentPrice,
    changePercent,
    volume: 0,
    pattern: 'BASE',
    indicators: {
      sma20: null,
      sma50: ma50,
      sma150: ma150,
      sma200: null,
      sma50Slope: ma50Slope,
      sma50SlopeDirection: ma50Slope === null ? 'flat' : (ma50Slope > 0 ? 'up' : ma50Slope < 0 ? 'down' : 'flat'),
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
      mansfieldRSTrend: mansfieldRs === null ? 'flat' : (mansfieldRs > 0 ? 'up' : mansfieldRs < 0 ? 'down' : 'flat'),
      mansfieldTransition: false,
      mansfieldUptrend: mansfieldValid,
      mansfieldValid,
      indicatorWarnings: [],
      chronologyNormalized: false,
    },
    gate: {
      isValidWspEntry: false,
      priceAboveMA50: aboveMa50,
      ma50Rising: slope50Positive,
      priceAboveMA150: aboveMa150,
      breakoutValid: false,
      breakoutFresh: false,
      volumeSufficient: volumeValid,
      mansfieldValid,
      sectorAligned: false,
      marketFavorable: false,
      patternAllowsEntry: false,
    },
    isValidWspEntry: false,
    finalRecommendation: 'BEVAKA',
    audit: {
      pattern: 'BASE',
      finalRecommendation: 'BEVAKA',
      isValidWspEntry: false,
      above50MA: aboveMa50,
      above150MA: aboveMa150,
      slope50Positive,
      sma20: null,
      sma50: ma50,
      sma150: ma150,
      sma200: null,
      sma50SlopeValue: ma50Slope,
      sma50SlopeDirection: ma50Slope === null ? 'flat' : (ma50Slope > 0 ? 'up' : ma50Slope < 0 ? 'down' : 'flat'),
      breakoutValid: false,
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
      mansfieldTrend: mansfieldRs === null ? 'flat' : (mansfieldRs > 0 ? 'up' : mansfieldRs < 0 ? 'down' : 'flat'),
      mansfieldUptrend: mansfieldValid,
      mansfieldRecentTransition: false,
      mansfieldValid,
      staleBreakoutBars: WSP_CONFIG.wsp.staleBreakoutBars,
      sectorAligned: false,
      marketAligned: false,
      chronologyNormalized: false,
      indicatorWarnings: [],
      score: scannerScore ?? 0,
      blockedReasons: [],
      exitReasons: [],
      wspSpec: { ...WSP_CONFIG.wsp },
    },
    blockedReasons: [],
    logicViolations: [],
    score: scannerScore ?? 0,
    maxScore: 4,
    dataSource: 'live',
    lastUpdated: updatedAt,
    scannerPattern: row.pattern,
    scannerRecommendation: row.recommendation,
    scannerScore,
    trendState: row.trend_state,
    ...(hasWspIndicators ? { lastUpdated: updatedAt } : {}),
  };
}

function buildSectorStatusesFromDailyPriceRows(priceRows: DailyPriceRow[]): SectorStatus[] {
  const grouped = new Map<string, DailyPriceRow[]>();
  for (const sector of Object.keys(MARKET_HEATMAP_SECTOR_ETFS)) {
    grouped.set(sector, []);
  }

  for (const row of priceRows) {
    if (!row.symbol || !row.date) continue;
    for (const [sector, etf] of Object.entries(MARKET_HEATMAP_SECTOR_ETFS)) {
      if (row.symbol === etf) {
        const bucket = grouped.get(sector) ?? [];
        bucket.push(row);
        grouped.set(sector, bucket);
      }
    }
  }

  return [...grouped.entries()].map(([sector, prices]) => {
    const sorted = [...prices]
      .filter((row) => typeof row.close === 'number' && Number.isFinite(row.close))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const previous = sorted[sorted.length - 2]?.close ?? null;
    const latest = sorted[sorted.length - 1]?.close ?? null;
    const changePercent = previous && latest
      ? Number((((latest - previous) / previous) * 100).toFixed(2))
      : 0;
    return {
      sector,
      isBullish: changePercent > 0,
      changePercent,
      sma50AboveSma200: changePercent >= 0,
    };
  });
}

async function buildSectorStatusesFromDailyPrices(): Promise<SectorStatus[]> {
  const etfSymbols = Object.values(MARKET_HEATMAP_SECTOR_ETFS);
  const { data, error } = await (supabase as any)
    .from('daily_prices')
    .select('symbol, close, date')
    .in('symbol', etfSymbols)
    .order('symbol', { ascending: true })
    .order('date', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return buildSectorStatusesFromDailyPriceRows((data ?? []) as DailyPriceRow[]);
}

async function fetchDirectFromSupabase(): Promise<EvaluatedStock[]> {
  const { data, error } = await (supabase as any)
    .from('market_scan_results_latest')
    .select('symbol, sector, industry, pattern, recommendation, trend_state, score, payload, scan_date')
    .order('score', { ascending: false, nullsFirst: false })
    .order('symbol', { ascending: true })
    .limit(2000);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as DirectScannerRow[];
  const symbols = [...new Set(rows.map((row) => row.symbol).filter((symbol): symbol is string => typeof symbol === 'string' && symbol.length > 0))];
  const payloadBySymbol = new Map<string, ScannerPayload>();
  const latestPriceBySymbol = new Map<string, DailyPriceRow>();
  const profilesBySymbol = new Map<string, SymbolProfileRow>();

  if (symbols.length > 0) {
    for (const row of rows) {
      if (!row.symbol || payloadBySymbol.has(row.symbol)) continue;
      const payload = row.payload && typeof row.payload === 'object'
        ? row.payload as ScannerPayload
        : null;
      if (!payload) continue;
      payloadBySymbol.set(row.symbol, payload);
    }

    const { data: priceRows, error: priceError } = await (supabase as any)
      .from('daily_prices')
      .select('symbol, close, date')
      .in('symbol', symbols)
      .order('symbol', { ascending: true })
      .order('date', { ascending: false });

    if (priceError) {
      throw new Error(priceError.message);
    }

    for (const priceRow of (priceRows ?? []) as DailyPriceRow[]) {
      if (!priceRow.symbol || latestPriceBySymbol.has(priceRow.symbol)) continue;
      latestPriceBySymbol.set(priceRow.symbol, priceRow);
    }

    const { data: profileRows, error: profileError } = await (supabase as any)
      .from('symbols')
      .select('symbol, canonical_sector, canonical_industry, sector, industry')
      .in('symbol', symbols);

    if (profileError) {
      throw new Error(profileError.message);
    }

    for (const profileRow of (profileRows ?? []) as SymbolProfileRow[]) {
      if (!profileRow.symbol) continue;
      profilesBySymbol.set(profileRow.symbol, profileRow);
    }
  }

  const nowIso = new Date().toISOString();
  return rows
    .sort((left, right) => {
      const leftPayload = left.payload && typeof left.payload === 'object' ? left.payload as ScannerPayload : null;
      const rightPayload = right.payload && typeof right.payload === 'object' ? right.payload as ScannerPayload : null;
      const leftVolume = typeof leftPayload?.volume_ratio === 'number' && Number.isFinite(leftPayload.volume_ratio)
        ? leftPayload.volume_ratio
        : Number.NEGATIVE_INFINITY;
      const rightVolume = typeof rightPayload?.volume_ratio === 'number' && Number.isFinite(rightPayload.volume_ratio)
        ? rightPayload.volume_ratio
        : Number.NEGATIVE_INFINITY;
      const volumeDiff = rightVolume - leftVolume;
      if (volumeDiff !== 0) return volumeDiff;
      return String(left.symbol ?? '').localeCompare(String(right.symbol ?? ''));
    })
    .map((row) => buildDirectScannerStock(
      row,
      nowIso,
      row.symbol ? payloadBySymbol.get(row.symbol) ?? null : null,
      row.symbol ? latestPriceBySymbol.get(row.symbol) ?? null : null,
      row.symbol ? profilesBySymbol.get(row.symbol) ?? null : null,
    ))
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
            scannerPattern: meta.pattern ?? null,
            scannerRecommendation: meta.recommendation ?? null,
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
          scannerPattern: fallback.wsp_pattern ?? null,
          scannerRecommendation: fallback.wsp_recommendation ?? fallback.recommendation ?? recommendationFromPattern(fallbackPattern),
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

export async function fetchWspScreenerData(options?: { intervalMs?: number; forceRefresh?: boolean }): Promise<ScreenerApiResponse> {
  try {
    const directStocks = await fetchDirectFromSupabase();
    if (directStocks.length > 100) {
      const now = new Date().toISOString();
      const directSectorStatuses = await buildSectorStatusesFromDailyPrices();
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
          symbolCount: directStocks.length,
          benchmarkSymbol: WSP_CONFIG.benchmark,
          benchmarkFetchStatus: 'stale',
          refreshIntervalMs: options?.intervalMs ?? WSP_CONFIG.refreshInterval,
          readiness: {
            envVarPresent: true,
            routeReachable: true,
            benchmarkSymbolConfigured: true,
            trackedSymbolsCount: directStocks.length,
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
            finalModeReason: `Direct Supabase scanner snapshot used (${directStocks.length} rows > 100 threshold).`,
            fallbackCause: 'none',
          },
        },
        debugSummary: buildScreenerDebugSummary(directStocks),
      };
    }
  } catch {
    // Intentionally ignored: if direct query fails, fall back to edge function path.
  }

  let edgeResp: EdgeFunctionResponse;
  const edgeFunctionUrl = buildEdgeFunctionUrl();
  let fetchDiagnostics: FetchDiagnostics = {
    target: isDevMode() ? '/api/wsp-screener' : (edgeFunctionUrl || 'missing_supabase_function_url'),
    reachable: false,
    statusCode: null,
    authOutcome: 'unknown',
  };

  if (isDevMode()) {
    // In dev mode, prefer edge function (same source-of-truth as production), then fall back to Vite plugin.
    const params = new URLSearchParams();
    if (options?.intervalMs) params.set('intervalMs', String(options.intervalMs));
    if (options?.forceRefresh) params.set('forceRefresh', '1');
    const devUrl = `/api/wsp-screener${params.size > 0 ? `?${params.toString()}` : ''}`;

    if (edgeFunctionUrl) {
      const edgeFirst = await safeFetch(edgeFunctionUrl, { headers: buildSupabaseInvokeHeaders() });
      edgeResp = edgeFirst.payload;
      fetchDiagnostics = edgeFirst.diagnostics;
      if (edgeResp.ok && edgeResp.data) {
        return processEdgeResponse(edgeResp, fetchDiagnostics);
      }
    }

    const devResp = await safeFetch(devUrl);
    fetchDiagnostics = devResp.diagnostics;

    // If dev server returned a full ScreenerApiResponse (not wrapped in edge payload), use it directly
    if (!(devResp.payload as any)?.ok && (devResp.payload as any)?.providerStatus?.uiState) {
      const raw = devResp.payload as any;
      if (raw.market && raw.stocks && raw.providerStatus) {
        return raw as ScreenerApiResponse;
      }
    }
    edgeResp = devResp.payload;
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
