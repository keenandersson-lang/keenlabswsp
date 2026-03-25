/**
 * WSP Screener — Type Definitions
 * Strict 3-layer model: Pattern → Entry Gate → Recommendation
 */

export type WSPPattern = 'BASE' | 'CLIMBING' | 'TIRED' | 'DOWNHILL';
export type WSPRecommendation = 'KÖP' | 'BEVAKA' | 'SÄLJ' | 'UNDVIK';
export type ScreenerUiState = 'LIVE' | 'STALE' | 'FALLBACK' | 'ERROR';
export type TrendBucket = 'HOT' | 'BREAKOUT' | 'BULLISH' | 'BEARISH';

export type WSPBlockedReason =
  | 'below_50ma'
  | 'below_150ma'
  | 'below_150ma_hard_stop'
  | 'slope_50_not_positive'
  | 'breakout_not_valid'
  | 'breakout_not_clean'
  | 'breakout_late_8plus'
  | 'volume_below_threshold'
  | 'mansfield_not_valid'
  | 'sector_not_aligned'
  | 'market_not_aligned'
  | 'pattern_not_climbing';

export type SmaSlopeDirection = 'rising' | 'falling' | 'flat';
export type MansfieldTrend = 'rising' | 'falling' | 'flat';

export type IndicatorWarning =
  | 'empty_price_history'
  | 'invalid_bar_values_filtered'
  | 'unsorted_bars_normalized'
  | 'insufficient_sma_history'
  | 'insufficient_sma_slope_history'
  | 'insufficient_resistance_history'
  | 'insufficient_breakout_history'
  | 'insufficient_volume_history'
  | 'near_zero_average_volume'
  | 'insufficient_benchmark_history'
  | 'benchmark_history_length_mismatch'
  | 'benchmark_dates_misaligned'
  | 'near_zero_benchmark_close';

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WspSpecAuditConfig {
  resistanceTouchesMin: number;
  resistanceTolerancePct: number;
  breakoutMinCloseAboveResistancePct: number;
  staleBreakoutBars: number;
  volumeLookbackBars: number;
  volumeMultipleMin: number;
  mansfieldLookbackBars: number;
  mansfieldTransitionLookbackBars: number;
  mansfieldTrendLookbackBars: number;
  smaSlopeLookbackBars: number;
  breakoutClvMin: number;
  falseBreakoutLookbackBars: number;
  falseBreakoutMaxCount: number;
}

export interface StockIndicators {
  sma20: number | null;
  sma50: number | null;
  sma150: number | null;
  sma200: number | null;
  sma50Slope: number | null;
  sma50SlopeDirection: SmaSlopeDirection;
  resistanceZone: number | null;
  resistanceUpperBound: number | null;
  resistanceTouches: number;
  resistanceTolerancePct: number;
  resistanceTouchIndices: number[];
  resistanceMostRecentTouchDate: string | null;
  breakoutLevel: number | null;
  currentClose: number | null;
  breakoutCloseDelta: number | null;
  closeAboveResistancePct: number | null;
  breakoutConfirmed: boolean;
  breakoutQualityPass: boolean;
  breakoutQualityReasons: string[];
  breakoutClv: number | null;
  recentFalseBreakoutsCount: number;
  barsSinceBreakout: number | null;
  breakoutStale: boolean;
  averageVolumeReference: number | null;
  volumeMultiple: number | null;
  mansfieldRS: number | null;
  mansfieldRSPrev: number | null;
  mansfieldRSTrend: MansfieldTrend;
  mansfieldTransition: boolean;
  mansfieldUptrend: boolean;
  mansfieldValid: boolean;
  indicatorWarnings: IndicatorWarning[];
  chronologyNormalized: boolean;
}

export interface EntryGate {
  isValidWspEntry: boolean;
  priceAboveMA50: boolean;
  ma50Rising: boolean;
  priceAboveMA150: boolean;
  breakoutValid: boolean;
  breakoutFresh: boolean;
  volumeSufficient: boolean;
  mansfieldValid: boolean;
  sectorAligned: boolean;
  marketFavorable: boolean;
  patternAllowsEntry: boolean;
}

export interface StockAudit {
  pattern: WSPPattern;
  finalRecommendation: WSPRecommendation;
  isValidWspEntry: boolean;
  above50MA: boolean;
  above150MA: boolean;
  slope50Positive: boolean;
  sma20: number | null;
  sma50: number | null;
  sma150: number | null;
  sma200: number | null;
  sma50SlopeValue: number | null;
  sma50SlopeDirection: SmaSlopeDirection;
  breakoutValid: boolean;
  breakoutStale: boolean;
  breakoutQualityPass: boolean;
  breakoutQualityReasons: string[];
  resistanceLevel: number | null;
  resistanceUpperBound: number | null;
  resistanceTouches: number;
  resistanceTolerancePct: number;
  resistanceMostRecentTouchDate: string | null;
  breakoutLevel: number | null;
  currentClose: number | null;
  breakoutCloseDelta: number | null;
  closeAboveResistancePct: number | null;
  breakoutClv: number | null;
  recentFalseBreakoutsCount: number;
  breakoutAgeBars: number | null;
  currentVolume: number;
  averageVolumeReference: number | null;
  volumeMultiple: number | null;
  volumeValid: boolean;
  mansfieldLookbackBars: number;
  mansfieldValue: number | null;
  mansfieldValuePrev: number | null;
  mansfieldTrend: MansfieldTrend;
  mansfieldUptrend: boolean;
  mansfieldRecentTransition: boolean;
  mansfieldValid: boolean;
  staleBreakoutBars: number;
  sectorAligned: boolean;
  marketAligned: boolean;
  chronologyNormalized: boolean;
  indicatorWarnings: IndicatorWarning[];
  score: number;
  blockedReasons: WSPBlockedReason[];
  exitReasons: WSPBlockedReason[];
  wspSpec: WspSpecAuditConfig;
}

export interface LogicViolation {
  symbol: string;
  finalRecommendation: WSPRecommendation;
  pattern: WSPPattern;
  violatedRules: WSPBlockedReason[];
}

export interface ValidationFixtureDefinition {
  id:
    | 'valid_buy_candidate'
    | 'climbing_but_below_50ma'
    | 'base_without_breakout'
    | 'tired_above_mas'
    | 'downhill_case'
    | 'breakout_with_weak_volume'
    | 'weak_sector_alignment'
    | 'stale_breakout_case'
    | 'below_150ma_forces_sell';
  description: string;
  expectedPattern: WSPPattern;
  expectedIsValidWspEntry: boolean;
  expectedRecommendation: WSPRecommendation;
  expectedBlockedReasons: WSPBlockedReason[];
}

export interface ValidationFixtureResult extends ValidationFixtureDefinition {
  actualPattern: WSPPattern;
  actualIsValidWspEntry: boolean;
  actualRecommendation: WSPRecommendation;
  actualBlockedReasons: WSPBlockedReason[];
  passed: boolean;
  mismatches: string[];
}

export interface IndicatorFixtureResult {
  id: string;
  description: string;
  passed: boolean;
  actual: string;
  expected: string;
  mismatches: string[];
}

export interface RecommendationCounts {
  'KÖP': number;
  'BEVAKA': number;
  'SÄLJ': number;
  'UNDVIK': number;
}

export interface ProviderReadiness {
  envVarPresent: boolean;
  routeReachable: boolean;
  benchmarkSymbolConfigured: boolean;
  trackedSymbolsCount: number;
  symbolsFetchedSuccessfully: number;
  symbolsFailed: number;
  lastSuccessfulLiveFetch: string | null;
}

export interface ScreenerDebugSummary {
  fixturePassCount: number;
  fixtureFailCount: number;
  indicatorTestPassCount: number;
  indicatorTestFailCount: number;
  logicViolationCount: number;
  logicViolations: LogicViolation[];
  fixtureResults: ValidationFixtureResult[];
  indicatorFixtureResults: IndicatorFixtureResult[];
  blockedCounts: Record<WSPBlockedReason, number>;
  validBuyCandidates: number;
  validEntryCount: number;
  totalStocks: number;
  recommendationCounts: RecommendationCounts;
  formulaInconsistencyWarnings: string[];
  insufficientHistoryCases: number;
  missingAuditFieldStocks: number;
  invalidIndicatorValueStocks: number;
}

export interface EvaluatedStock {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  price: number;
  changePercent: number;
  volume: number;
  pattern: WSPPattern;
  indicators: StockIndicators;
  gate: EntryGate;
  isValidWspEntry: boolean;
  finalRecommendation: WSPRecommendation;
  audit: StockAudit;
  blockedReasons: WSPBlockedReason[];
  logicViolations: WSPBlockedReason[];
  score: number;
  maxScore: number;
  dataSource: 'live' | 'fallback';
  lastUpdated: string;
}

export interface MarketOverview {
  sp500Change: number;
  nasdaqChange: number;
  sp500Price: number | null;
  nasdaqPrice: number | null;
  sp500Symbol: string;
  nasdaqSymbol: string;
  benchmarkState: 'live' | 'stale' | 'fallback';
  benchmarkLastUpdated: string;
  marketTrend: 'bullish' | 'bearish' | 'neutral';
  lastUpdated: string;
  dataSource: 'live' | 'fallback';
  pollingIntervalMs?: number;
}

export interface DiscoveryMeta {
  source: 'backend_wsp_engine';
  dataState: ScreenerUiState;
  categoryCounts: Record<TrendBucket, number>;
  generatedAt: string;
}

export interface DiscoveryBuckets {
  HOT: EvaluatedStock[];
  BREAKOUT: EvaluatedStock[];
  BULLISH: EvaluatedStock[];
  BEARISH: EvaluatedStock[];
}

export interface SectorStatus {
  sector: string;
  isBullish: boolean;
  changePercent: number;
  sma50AboveSma200: boolean;
}

export interface ProviderStatus {
  provider: 'finnhub' | 'demo';
  isLive: boolean;
  uiState: ScreenerUiState;
  lastFetch: string | null;
  failedSymbols: string[];
  successCount: number;
  errorMessage: string | null;
  isFallback: boolean;
  fallbackActive: boolean;
  symbolCount: number;
  benchmarkSymbol: string;
  benchmarkFetchStatus: 'success' | 'stale' | 'failed';
  refreshIntervalMs: number;
  readiness: ProviderReadiness;
  debugPipeline?: {
    stage:
      | 'init'
      | 'env_check'
      | 'benchmark_fetch'
      | 'market_fetch'
      | 'sector_fetch'
      | 'stock_fetch'
      | 'snapshot_build'
      | 'fallback_build'
      | 'completed';
    finalModeReason: string;
    providerAuth: 'success' | 'failed';
    benchmarkSuccessCount: number;
    benchmarkFailureCount: number;
    stockSuccessCount: number;
    stockFailureCount: number;
    staleCacheAvailable: boolean;
    fallbackBuild: 'success' | 'failed';
    benchmarkRenderable?: boolean;
    benchmarkPricePresent?: boolean;
    benchmarkDailyMovePresent?: boolean;
    benchmarkCardsRenderable?: boolean;
    sectorDataPresent?: boolean;
    discoveryDataPresent?: boolean;
    staleSnapshotQuality?: 'pass' | 'fail';
    staleSnapshotQualityReason?: string;
  };
  runtimeDiagnostics?: {
    envKeyPresent: boolean;
    edgeFunctionReachable: boolean;
    fetchTarget: string;
    authOutcome: 'success' | 'missing_client_auth' | 'failed' | 'not_required' | 'unknown';
    benchmarkFetch: 'success' | 'failed' | 'stale';
    routeVersion: string;
    buildMarker: string;
    finalModeReason: string;
    fallbackCause: 'necessary' | 'misconfiguration' | 'unknown';
  };
}

export interface ScreenerApiResponse {
  market: MarketOverview;
  stocks: EvaluatedStock[];
  discovery: DiscoveryBuckets;
  discoveryMeta: DiscoveryMeta;
  sectorStatuses: SectorStatus[];
  providerStatus: ProviderStatus;
  debugSummary: ScreenerDebugSummary;
}
