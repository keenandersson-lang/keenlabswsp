/**
 * WSP Screener — Core Engine
 * 3-layer model: Pattern → Entry Gate → Recommendation
 */

import type {
  WSPPattern, WSPRecommendation, EntryGate,
  EvaluatedStock, StockIndicators, Bar,
  MarketOverview, SectorStatus,
} from './wsp-types';
import { classifyPattern, computeIndicators, isBreakoutFresh, normalizeBarsChronologically } from './wsp-indicators';
import { WSP_CONFIG } from './wsp-config';
import { BLOCKED_REASON_ORDERED, createStockAudit, getLogicViolationRuleIds } from './wsp-assertions';

export type { WSPPattern, WSPRecommendation, EvaluatedStock, MarketOverview, SectorStatus };

interface EvaluateStockOptions {
  overrideAnalysis?: {
    pattern?: WSPPattern;
    indicators?: StockIndicators;
    price?: number;
    prevClose?: number;
    volume?: number;
    lastUpdated?: string;
  };
  metadata?: {
    exchange?: string;
    assetClass?: 'equity' | 'metals' | 'commodity';
    supportsFullWsp?: boolean;
    wspSupport?: 'full' | 'limited';
  };
}

export function computeEntryGate(
  price: number,
  pattern: WSPPattern,
  indicators: StockIndicators,
  sectorAligned: boolean,
  marketFavorable: boolean,
): EntryGate {
  const priceAboveMA50 = indicators.sma50 !== null && price > indicators.sma50;
  const ma50Rising = indicators.sma50Slope !== null && indicators.sma50Slope > 0;
  const priceAboveMA150 = indicators.sma150 !== null && price > indicators.sma150;
  const breakoutValid = indicators.breakoutConfirmed && indicators.breakoutQualityPass;
  const breakoutFresh = isBreakoutFresh(indicators.barsSinceBreakout, WSP_CONFIG.wsp.staleBreakoutBars);
  const volumeSufficient = indicators.volumeMultiple !== null && indicators.volumeMultiple >= WSP_CONFIG.wsp.volumeMultipleMin;
  const mansfieldValid = indicators.mansfieldValid;
  const patternAllowsEntry = pattern === 'CLIMBING';

  const isValidWspEntry =
    patternAllowsEntry &&
    priceAboveMA50 &&
    ma50Rising &&
    priceAboveMA150 &&
    breakoutValid &&
    breakoutFresh &&
    volumeSufficient &&
    mansfieldValid &&
    sectorAligned &&
    marketFavorable;

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

export function mapRecommendation(
  pattern: WSPPattern,
  gate: EntryGate,
): WSPRecommendation {
  if (!gate.priceAboveMA150) return 'SÄLJ';
  if (pattern === 'CLIMBING' && gate.isValidWspEntry) return 'KÖP';
  if (pattern === 'TIRED') return 'SÄLJ';
  if (pattern === 'DOWNHILL') return 'UNDVIK';
  if (!gate.priceAboveMA50 && !gate.ma50Rising) return 'UNDVIK';
  if (pattern === 'CLIMBING' || pattern === 'BASE') return 'BEVAKA';
  return 'UNDVIK';
}

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
    [gate.breakoutFresh, w.freshBreakout],
  ];

  for (const [passed, weight] of checks) {
    maxScore += weight;
    if (passed) score += weight;
  }

  return { score, maxScore };
}

function buildEvaluatedStock({
  symbol,
  name,
  sector,
  industry,
  price,
  changePercent,
  volume,
  pattern,
  indicators,
  sectorAligned,
  marketFavorable,
  dataSource,
  lastUpdated,
  exchange,
  assetClass,
  supportsFullWsp,
  wspSupport,
}: {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  price: number;
  changePercent: number;
  volume: number;
  pattern: WSPPattern;
  indicators: StockIndicators;
  sectorAligned: boolean;
  marketFavorable: boolean;
  dataSource: 'live' | 'fallback';
  lastUpdated: string;
  exchange?: string;
  assetClass?: 'equity' | 'metals' | 'commodity';
  supportsFullWsp?: boolean;
  wspSupport?: 'full' | 'limited';
}): EvaluatedStock {
  const gate = computeEntryGate(price, pattern, indicators, sectorAligned, marketFavorable);
  const finalRecommendation = mapRecommendation(pattern, gate);
  const { score, maxScore } = computeScore(gate);
  const audit = createStockAudit({ pattern, finalRecommendation, gate, indicators, price, volume, score });

  const stock: EvaluatedStock = {
    symbol,
    name,
    sector,
    industry,
    exchange,
    assetClass,
    supportsFullWsp,
    wspSupport,
    price: Math.round(price * 100) / 100,
    changePercent: Math.round(changePercent * 100) / 100,
    volume,
    pattern,
    indicators,
    gate,
    isValidWspEntry: gate.isValidWspEntry,
    finalRecommendation,
    audit,
    blockedReasons: BLOCKED_REASON_ORDERED.filter((reason) => [...audit.blockedReasons, ...audit.exitReasons].includes(reason)),
    logicViolations: [],
    score,
    maxScore,
    dataSource,
    lastUpdated,
  };

  return {
    ...stock,
    logicViolations: getLogicViolationRuleIds(stock),
  };
}

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
  options?: EvaluateStockOptions,
): EvaluatedStock {
  const override = options?.overrideAnalysis;
  const normalizedBars = normalizeBarsChronologically(bars).bars;
  const normalizedBenchmarkBars = normalizeBarsChronologically(benchmarkBars).bars;
  const price = override?.price ?? (normalizedBars.length > 0 ? normalizedBars[normalizedBars.length - 1].close : 0);
  const prevClose = override?.prevClose ?? (normalizedBars.length > 1 ? normalizedBars[normalizedBars.length - 2].close : price);
  const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
  const volume = override?.volume ?? (normalizedBars.length > 0 ? normalizedBars[normalizedBars.length - 1].volume : 0);

  const indicators = override?.indicators ?? computeIndicators(normalizedBars, normalizedBenchmarkBars);
  const pattern = override?.pattern ?? classifyPattern(normalizedBars, indicators.sma50, indicators.sma150, indicators.sma50Slope);

  return buildEvaluatedStock({
    symbol,
    name,
    sector,
    industry,
    price,
    changePercent,
    volume,
    pattern,
    indicators,
    sectorAligned,
    marketFavorable,
    dataSource,
    lastUpdated: override?.lastUpdated ?? new Date().toISOString(),
    exchange: options?.metadata?.exchange,
    assetClass: options?.metadata?.assetClass,
    supportsFullWsp: options?.metadata?.supportsFullWsp,
    wspSupport: options?.metadata?.wspSupport,
  });
}
