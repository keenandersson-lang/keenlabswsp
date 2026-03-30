import { WSP_CONFIG } from './wsp-config';
import type {
  EntryGate,
  EvaluatedStock,
  LogicViolation,
  StockAudit,
  StockIndicators,
  WSPBlockedReason,
  WSPPattern,
  WSPRecommendation,
} from './wsp-types';

const BLOCKED_REASON_ORDER: WSPBlockedReason[] = [
  'below_50ma',
  'below_150ma',
  'below_150ma_hard_stop',
  'slope_50_not_positive',
  'breakout_not_valid',
  'breakout_not_clean',
  'breakout_late_8plus',
  'volume_below_threshold',
  'mansfield_not_valid',
  'sector_not_aligned',
  'market_not_aligned',
  'pattern_not_climbing',
];

export function createBlockedReasons(pattern: WSPPattern, gate: EntryGate, indicators: StockIndicators): WSPBlockedReason[] {
  const blocked = new Set<WSPBlockedReason>();

  if (!gate.priceAboveMA50) blocked.add('below_50ma');
  if (!gate.priceAboveMA150) blocked.add('below_150ma');
  if (!gate.ma50Rising) blocked.add('slope_50_not_positive');
  if (!indicators.breakoutConfirmed) blocked.add('breakout_not_valid');
  if (!indicators.breakoutQualityPass) blocked.add('breakout_not_clean');
  if (indicators.breakoutStale) blocked.add('breakout_late_8plus');
  if (!gate.volumeSufficient) blocked.add('volume_below_threshold');
  if (!gate.mansfieldValid) blocked.add('mansfield_not_valid');
  if (!gate.sectorAligned) blocked.add('sector_not_aligned');
  if (!gate.marketFavorable) blocked.add('market_not_aligned');
  if (pattern !== 'climbing') blocked.add('pattern_not_climbing');

  return BLOCKED_REASON_ORDER.filter((reason) => blocked.has(reason));
}

export function createStockAudit({
  pattern,
  finalRecommendation,
  gate,
  indicators,
  price,
  volume,
  score,
}: {
  pattern: WSPPattern;
  finalRecommendation: WSPRecommendation;
  gate: EntryGate;
  indicators: StockIndicators;
  price: number;
  volume: number;
  score: number;
}): StockAudit {
  const blockedReasons = createBlockedReasons(pattern, gate, indicators);
  const exitReasons: WSPBlockedReason[] = !gate.priceAboveMA150 ? ['below_150ma_hard_stop'] : [];

  return {
    pattern,
    finalRecommendation,
    isValidWspEntry: gate.isValidWspEntry,
    above50MA: gate.priceAboveMA50,
    above150MA: gate.priceAboveMA150,
    slope50Positive: gate.ma50Rising,
    sma20: indicators.sma20,
    sma50: indicators.sma50,
    sma150: indicators.sma150,
    sma200: indicators.sma200,
    sma50SlopeValue: indicators.sma50Slope,
    sma50SlopeDirection: indicators.sma50SlopeDirection,
    breakoutValid: gate.breakoutValid,
    breakoutStale: indicators.breakoutStale,
    breakoutQualityPass: indicators.breakoutQualityPass,
    breakoutQualityReasons: indicators.breakoutQualityReasons,
    resistanceLevel: indicators.resistanceZone,
    resistanceUpperBound: indicators.resistanceUpperBound,
    resistanceTouches: indicators.resistanceTouches,
    resistanceTolerancePct: indicators.resistanceTolerancePct,
    resistanceMostRecentTouchDate: indicators.resistanceMostRecentTouchDate,
    breakoutLevel: indicators.breakoutLevel,
    currentClose: indicators.currentClose ?? price,
    breakoutCloseDelta: indicators.breakoutCloseDelta,
    closeAboveResistancePct: indicators.closeAboveResistancePct,
    breakoutClv: indicators.breakoutClv,
    recentFalseBreakoutsCount: indicators.recentFalseBreakoutsCount,
    breakoutAgeBars: indicators.barsSinceBreakout,
    currentVolume: volume,
    averageVolumeReference: indicators.averageVolumeReference,
    volumeMultiple: indicators.volumeMultiple,
    volumeValid: gate.volumeSufficient,
    mansfieldLookbackBars: WSP_CONFIG.wsp.mansfieldLookbackBars,
    mansfieldValue: indicators.mansfieldRS,
    mansfieldValuePrev: indicators.mansfieldRSPrev,
    mansfieldTrend: indicators.mansfieldRSTrend,
    mansfieldUptrend: indicators.mansfieldUptrend,
    mansfieldRecentTransition: indicators.mansfieldTransition,
    mansfieldValid: gate.mansfieldValid,
    staleBreakoutBars: WSP_CONFIG.wsp.staleBreakoutBars,
    sectorAligned: gate.sectorAligned,
    marketAligned: gate.marketFavorable,
    chronologyNormalized: indicators.chronologyNormalized,
    indicatorWarnings: indicators.indicatorWarnings,
    score,
    blockedReasons,
    exitReasons,
    wspSpec: { ...WSP_CONFIG.wsp },
  };
}

export function getLogicViolationRuleIds(stock: Pick<EvaluatedStock, 'pattern' | 'finalRecommendation' | 'audit'>): WSPBlockedReason[] {
  if (stock.finalRecommendation !== 'KÖP') return [];

  const violations = new Set<WSPBlockedReason>();
  if (!stock.audit.above50MA) violations.add('below_50ma');
  if (!stock.audit.above150MA) violations.add('below_150ma');
  if (!stock.audit.slope50Positive) violations.add('slope_50_not_positive');
  if (!stock.audit.breakoutValid) violations.add('breakout_not_valid');
  if (!stock.audit.breakoutQualityPass) violations.add('breakout_not_clean');
  if (stock.audit.breakoutStale) violations.add('breakout_late_8plus');
  if (!stock.audit.volumeValid) violations.add('volume_below_threshold');
  if (!stock.audit.mansfieldValid) violations.add('mansfield_not_valid');
  if (!stock.audit.sectorAligned) violations.add('sector_not_aligned');
  if (!stock.audit.marketAligned) violations.add('market_not_aligned');
  if (stock.pattern !== 'climbing') violations.add('pattern_not_climbing');

  return BLOCKED_REASON_ORDER.filter((reason) => violations.has(reason));
}

export function createLogicViolation(stock: EvaluatedStock): LogicViolation | null {
  const violatedRules = getLogicViolationRuleIds(stock);
  if (violatedRules.length === 0) return null;

  return {
    symbol: stock.symbol,
    finalRecommendation: stock.finalRecommendation,
    pattern: stock.pattern,
    violatedRules,
  };
}

export const BLOCKED_REASON_LABELS: Record<WSPBlockedReason, string> = {
  below_50ma: 'Under 50 MA',
  below_150ma: 'Under 150 MA',
  below_150ma_hard_stop: 'Hard stop under 150 MA',
  slope_50_not_positive: '50 MA lutar inte uppåt',
  breakout_not_valid: 'Ingen giltig breakoutdag',
  breakout_not_clean: 'Breakout ej clean/decisive',
  breakout_late_8plus: 'Breakout är 8+ dagar gammal',
  volume_below_threshold: 'Volym under 2x-regeln',
  mansfield_not_valid: 'Mansfield ej bullish',
  sector_not_aligned: 'Sektor ej i upptrend',
  market_not_aligned: 'Marknad ej i upptrend',
  pattern_not_climbing: 'Mönster ej climbing',
};

export const BLOCKED_REASON_ORDERED = BLOCKED_REASON_ORDER;
export function formatBlockedReason(reason: WSPBlockedReason): string {
  return BLOCKED_REASON_LABELS[reason];
}
