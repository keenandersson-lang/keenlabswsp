/**
 * WSP Screener — Type Definitions
 * Strict 3-layer model: Pattern → Entry Gate → Recommendation
 */

// ─── Layer 1: Pattern Classification (chart structure only) ───
export type WSPPattern = 'BASE' | 'CLIMBING' | 'TIRED' | 'DOWNHILL';

// ─── Layer 3: Final Recommendation ───
export type WSPRecommendation = 'KÖP' | 'BEVAKA' | 'SÄLJ' | 'UNDVIK';

export type ScreenerUiState = 'LIVE' | 'STALE' | 'FALLBACK' | 'ERROR';

export type WSPBlockedReason =
  | 'below_50ma'
  | 'below_150ma'
  | 'slope_50_not_positive'
  | 'breakout_not_valid'
  | 'breakout_stale'
  | 'volume_below_threshold'
  | 'mansfield_not_valid'
  | 'sector_not_aligned'
  | 'market_not_aligned'
  | 'pattern_not_climbing';

// ─── Normalized bar data ───
export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Indicator results for a single stock ───
export interface StockIndicators {
  sma20: number | null;
  sma50: number | null;
  sma150: number | null;
  sma200: number | null;
  sma50Slope: number; // slope over last 10 bars, positive = up
  resistanceZone: number | null;
  resistanceTouches: number;
  breakoutConfirmed: boolean;
  barsSinceBreakout: number | null;
  volumeMultiple: number; // current volume / 5-bar avg
  mansfieldRS: number;
  mansfieldRSTrend: 'rising' | 'falling' | 'flat';
  mansfieldTransition: boolean; // recently went from negative to positive
}

// ─── Layer 2: Entry Eligibility (hard gate) ───
export interface EntryGate {
  /** Final boolean: ALL hard rules pass */
  isValidWspEntry: boolean;

  // Individual hard-rule checks
  priceAboveMA50: boolean;
  ma50Rising: boolean;
  priceAboveMA150: boolean;
  breakoutValid: boolean;
  breakoutFresh: boolean; // not too many bars ago
  volumeSufficient: boolean;
  mansfieldValid: boolean;
  sectorAligned: boolean;
  marketFavorable: boolean;
  patternAllowsEntry: boolean; // only CLIMBING allows KÖP
}

export interface StockAudit {
  pattern: WSPPattern;
  finalRecommendation: WSPRecommendation;
  isValidWspEntry: boolean;
  above50MA: boolean;
  above150MA: boolean;
  slope50Positive: boolean;
  breakoutValid: boolean;
  breakoutStale: boolean;
  resistanceLevel: number | null;
  breakoutLevel: number | null;
  currentVolume: number;
  averageVolumeReference: number;
  volumeMultiple: number;
  volumeValid: boolean;
  mansfieldValue: number;
  mansfieldValid: boolean;
  sectorAligned: boolean;
  marketAligned: boolean;
  score: number;
  blockedReasons: WSPBlockedReason[];
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
    | 'stale_breakout_case';
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

export interface RecommendationCounts {
  'KÖP': number;
  'BEVAKA': number;
  'SÄLJ': number;
  'UNDVIK': number;
}

export interface ScreenerDebugSummary {
  fixturePassCount: number;
  fixtureFailCount: number;
  logicViolationCount: number;
  logicViolations: LogicViolation[];
  fixtureResults: ValidationFixtureResult[];
  blockedCounts: Record<WSPBlockedReason, number>;
  validBuyCandidates: number;
  validEntryCount: number;
  totalStocks: number;
  recommendationCounts: RecommendationCounts;
}

// ─── Complete evaluated stock ───
export interface EvaluatedStock {
  // Identity
  symbol: string;
  name: string;
  sector: string;
  industry: string;

  // Market data
  price: number;
  changePercent: number;
  volume: number;

  // Layer 1
  pattern: WSPPattern;

  // Indicators
  indicators: StockIndicators;

  // Layer 2
  gate: EntryGate;
  isValidWspEntry: boolean;

  // Layer 3
  finalRecommendation: WSPRecommendation;

  // Explainability / audit
  audit: StockAudit;
  blockedReasons: WSPBlockedReason[];
  logicViolations: WSPBlockedReason[];

  // Ranking score (secondary, never overrides gate)
  score: number;
  maxScore: number;

  // Meta
  dataSource: 'live' | 'fallback';
  lastUpdated: string;
}

// ─── Market overview ───
export interface MarketOverview {
  sp500Change: number;
  nasdaqChange: number;
  marketTrend: 'bullish' | 'bearish' | 'neutral';
  lastUpdated: string;
  dataSource: 'live' | 'fallback';
  pollingIntervalMs?: number;
}

// ─── Sector status ───
export interface SectorStatus {
  sector: string;
  isBullish: boolean;
  changePercent: number;
  sma50AboveSma200: boolean;
}

// ─── Provider status (for debug panel) ───
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
}

export interface ScreenerApiResponse {
  market: MarketOverview;
  stocks: EvaluatedStock[];
  sectorStatuses: SectorStatus[];
  providerStatus: ProviderStatus;
  debugSummary: ScreenerDebugSummary;
}
