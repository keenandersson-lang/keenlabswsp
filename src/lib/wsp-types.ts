/**
 * WSP Screener — Type Definitions
 * Strict 3-layer model: Pattern → Entry Gate → Recommendation
 */

// ─── Layer 1: Pattern Classification (chart structure only) ───
export type WSPPattern = 'BASE' | 'CLIMBING' | 'TIRED' | 'DOWNHILL';

// ─── Layer 3: Final Recommendation ───
export type WSPRecommendation = 'KÖP' | 'BEVAKA' | 'SÄLJ' | 'UNDVIK';

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

  // Layer 3
  recommendation: WSPRecommendation;

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
  isLive: boolean;
  lastFetch: string | null;
  failedSymbols: string[];
  successCount: number;
  errorMessage: string | null;
  isFallback: boolean;
}
