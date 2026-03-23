/**
 * WSP Screener — Core Engine
 * 3-layer model: Pattern → Entry Gate → Recommendation
 * 
 * HARD RULES: No scoring system can override the entry gate.
 * A stock MUST pass ALL gate checks to receive KÖP.
 */

import type {
  WSPPattern, WSPRecommendation, EntryGate,
  EvaluatedStock, StockIndicators, Bar,
  MarketOverview, SectorStatus,
} from './wsp-types';
import { computeIndicators, classifyPattern } from './wsp-indicators';
import { WSP_CONFIG } from './wsp-config';

// Re-export types for backward compatibility
export type { WSPPattern, WSPRecommendation, EvaluatedStock, MarketOverview, SectorStatus };

// ─── Layer 2: Entry Gate (HARD RULES) ───
export function computeEntryGate(
  price: number,
  pattern: WSPPattern,
  indicators: StockIndicators,
  sectorAligned: boolean,
  marketFavorable: boolean,
): EntryGate {
  const priceAboveMA50 = indicators.sma50 !== null && price > indicators.sma50;
  const ma50Rising = indicators.sma50Slope > 0;
  const priceAboveMA150 = indicators.sma150 !== null && price > indicators.sma150;
  const breakoutValid = indicators.breakoutConfirmed;
  const breakoutFresh = indicators.barsSinceBreakout !== null &&
    indicators.barsSinceBreakout <= WSP_CONFIG.breakout.maxBarsSinceBreakout;
  const volumeSufficient = indicators.volumeMultiple >= WSP_CONFIG.volume.breakoutMultiple;
  const mansfieldValid = (indicators.mansfieldRS > WSP_CONFIG.mansfield.minValidRS && indicators.mansfieldRSTrend !== 'falling') ||
    indicators.mansfieldTransition;
  const patternAllowsEntry = pattern === 'CLIMBING';

  // HARD GATE: ALL must be true
  const isValidWspEntry =
    priceAboveMA50 &&
    ma50Rising &&
    priceAboveMA150 &&
    breakoutValid &&
    breakoutFresh &&
    volumeSufficient &&
    mansfieldValid &&
    sectorAligned &&
    marketFavorable &&
    patternAllowsEntry;

  return {
    isValidWspEntry,
    priceAboveMA50,
    ma50Rising,
    priceAboveMA150,
    breakoutValid,
    breakoutFresh,
    volumeSufficient,
    mansfieldValid,
    sectorAligned,
    marketFavorable,
    patternAllowsEntry,
  };
}

// ─── Layer 3: Recommendation Mapping ───
export function mapRecommendation(
  pattern: WSPPattern,
  gate: EntryGate,
): WSPRecommendation {
  // HARD RULE: KÖP only if CLIMBING + all gate checks pass
  if (pattern === 'CLIMBING' && gate.isValidWspEntry) {
    return 'KÖP';
  }

  // SÄLJ: Tired or weakening structure, or below 150 MA
  if (pattern === 'TIRED') return 'SÄLJ';
  if (!gate.priceAboveMA150) return 'SÄLJ';

  // UNDVIK: Downhill, or fundamentally broken setup
  if (pattern === 'DOWNHILL') return 'UNDVIK';
  if (!gate.priceAboveMA50 && !gate.ma50Rising) return 'UNDVIK';

  // BEVAKA: Promising structure but not all conditions met
  if (pattern === 'CLIMBING' || pattern === 'BASE') return 'BEVAKA';

  return 'UNDVIK';
}

// ─── Compute ranking score (secondary, never overrides gate) ───
export function computeScore(gate: EntryGate): { score: number; maxScore: number } {
  const w = WSP_CONFIG.scoreWeights;
  let score = 0;
  let maxScore = 0;

  const checks: [boolean, number][] = [
    [gate.breakoutValid, w.breakoutConfirmed],
    [gate.priceAboveMA50, w.aboveMA50],
    [gate.ma50Rising, w.ma50SlopingUp],
    [gate.priceAboveMA150, w.aboveMA150],
    [gate.volumeSufficient, w.volumeSurge],
    [gate.mansfieldValid, w.mansfieldValid],
    [gate.sectorAligned, w.sectorAligned],
    [gate.marketFavorable, w.marketFavorable],
    [gate.breakoutFresh ?? false, w.freshBreakout],
  ];

  for (const [passed, weight] of checks) {
    maxScore += weight;
    if (passed) score += weight;
  }

  return { score, maxScore };
}

// ─── Full Stock Evaluation Pipeline ───
export function evaluateStock(
  symbol: string,
  name: string,
  sector: string,
  industry: string,
  bars: Bar[],
  benchmarkBars: Bar[],
  sectorAligned: boolean,
  marketFavorable: boolean,
  dataSource: 'live' | 'fallback' = 'fallback',
): EvaluatedStock {
  const price = bars.length > 0 ? bars[bars.length - 1].close : 0;
  const prevClose = bars.length > 1 ? bars[bars.length - 2].close : price;
  const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
  const volume = bars.length > 0 ? bars[bars.length - 1].volume : 0;

  const indicators = computeIndicators(bars, benchmarkBars);
  const pattern = classifyPattern(bars, indicators.sma50, indicators.sma150, indicators.sma50Slope);
  const gate = computeEntryGate(price, pattern, indicators, sectorAligned, marketFavorable);
  const recommendation = mapRecommendation(pattern, gate);
  const { score, maxScore } = computeScore(gate);

  return {
    symbol,
    name,
    sector,
    industry,
    price: Math.round(price * 100) / 100,
    changePercent: Math.round(changePercent * 100) / 100,
    volume,
    pattern,
    indicators,
    gate,
    recommendation,
    score,
    maxScore,
    dataSource,
    lastUpdated: new Date().toISOString(),
  };
}
