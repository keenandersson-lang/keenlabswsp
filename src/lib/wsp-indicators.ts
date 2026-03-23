/**
 * WSP Screener — Centralized indicator formulas.
 *
 * Every core indicator used by the WSP engine is defined here so the screener,
 * audit panel, and tests all reference the exact same calculations.
 */

import type {
  Bar,
  IndicatorWarning,
  MansfieldTrend,
  SmaSlopeDirection,
  StockIndicators,
} from './wsp-types';
import { WSP_CONFIG } from './wsp-config';

const EPSILON = 1e-9;
const RESISTANCE_LOOKBACK = 100;
const RESISTANCE_PIVOT_WINDOW = 2;
const MANSFIELD_TREND_LOOKBACK = 10;

interface ResistanceZoneResult {
  level: number | null;
  touches: number;
}

interface BreakoutResult {
  confirmed: boolean;
  barsSince: number | null;
  breakoutLevel: number | null;
  currentClose: number | null;
  closeDelta: number | null;
}

interface VolumeMultipleResult {
  multiple: number | null;
  averageVolume: number | null;
}

interface MansfieldRSResult {
  rs: number | null;
  trend: MansfieldTrend;
  transition: boolean;
}

interface SmaSlopeResult {
  value: number | null;
  direction: SmaSlopeDirection;
}

/**
 * Returns true when a bar contains finite OHLCV numbers and a valid date.
 */
function isFiniteBar(bar: Bar): boolean {
  return Number.isFinite(Date.parse(bar.date)) &&
    Number.isFinite(bar.open) &&
    Number.isFinite(bar.high) &&
    Number.isFinite(bar.low) &&
    Number.isFinite(bar.close) &&
    Number.isFinite(bar.volume);
}

/**
 * Normalizes provider/fallback bars into ascending chronological order.
 *
 * Input: any array of bars, potentially unsorted or containing invalid values.
 * Output: filtered bars sorted oldest → newest, plus normalization metadata.
 */
export function normalizeBarsChronologically(bars: Bar[]): {
  bars: Bar[];
  chronologyNormalized: boolean;
  warnings: IndicatorWarning[];
} {
  const warnings = new Set<IndicatorWarning>();

  if (bars.length === 0) {
    warnings.add('empty_price_history');
    return { bars: [], chronologyNormalized: false, warnings: [...warnings] };
  }

  const validBars = bars.filter((bar) => isFiniteBar(bar));
  if (validBars.length !== bars.length) {
    warnings.add('invalid_bar_values_filtered');
  }

  const sortedBars = [...validBars].sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
  const chronologyNormalized = sortedBars.some((bar, index) => validBars[index] !== bar);
  if (chronologyNormalized) {
    warnings.add('unsorted_bars_normalized');
  }

  if (sortedBars.length === 0) {
    warnings.add('empty_price_history');
  }

  return {
    bars: sortedBars,
    chronologyNormalized,
    warnings: [...warnings],
  };
}

/**
 * Calculates a simple moving average from the latest `period` closes.
 *
 * Input: ascending chronological bars and a positive period.
 * Output: arithmetic mean of the last `period` closes, or null if insufficient data.
 */
export function sma(bars: Bar[], period: number): number | null {
  if (period <= 0 || bars.length < period) {
    return null;
  }

  const closes = bars.slice(-period).map((bar) => bar.close);
  return closes.reduce((sum, close) => sum + close, 0) / period;
}

/**
 * Calculates the SMA slope as the difference between the current SMA and the SMA
 * from `lookback` bars ago.
 *
 * Input: ascending chronological bars, the SMA period, and the comparison lookback.
 * Output: numeric slope value plus a rising/flat/falling direction, or null if the
 * series is too short.
 */
export function smaSlope(
  bars: Bar[],
  period: number,
  lookback: number = 10,
): SmaSlopeResult {
  if (period <= 0 || lookback <= 0 || bars.length < period + lookback) {
    return { value: null, direction: 'flat' };
  }

  const currentSma = sma(bars, period);
  const previousSma = sma(bars.slice(0, -lookback), period);

  if (currentSma === null || previousSma === null) {
    return { value: null, direction: 'flat' };
  }

  const value = currentSma - previousSma;
  if (Math.abs(value) < EPSILON) {
    return { value: 0, direction: 'flat' };
  }

  return {
    value,
    direction: value > 0 ? 'rising' : 'falling',
  };
}

/**
 * Identifies a resistance zone by clustering pivot highs that fall within a
 * configurable tolerance band.
 *
 * Input: ascending chronological bars.
 * Output: the highest valid resistance cluster and its touch count, or null if the
 * history does not show enough repeated highs.
 *
 * Assumptions:
 * - only pivot highs (local highs) count as resistance touches
 * - touches must be within `tolerancePercent`
 * - a valid zone needs at least `minTouches`
 */
export function detectResistanceZone(
  bars: Bar[],
  tolerancePct: number = WSP_CONFIG.breakout.tolerancePercent,
  minTouches: number = WSP_CONFIG.breakout.minTouches,
): ResistanceZoneResult {
  if (bars.length < 20) {
    return { level: null, touches: 0 };
  }

  const lookbackBars = bars.slice(-Math.min(RESISTANCE_LOOKBACK, bars.length));
  const pivotHighs: number[] = [];

  for (let index = RESISTANCE_PIVOT_WINDOW; index < lookbackBars.length - RESISTANCE_PIVOT_WINDOW; index += 1) {
    const candidate = lookbackBars[index];
    let isPivot = true;

    for (let offset = 1; offset <= RESISTANCE_PIVOT_WINDOW; offset += 1) {
      const previous = lookbackBars[index - offset];
      const next = lookbackBars[index + offset];

      if (candidate.high < previous.high || candidate.high < next.high) {
        isPivot = false;
        break;
      }
    }

    if (isPivot) {
      pivotHighs.push(candidate.high);
    }
  }

  if (pivotHighs.length < minTouches) {
    return { level: null, touches: 0 };
  }

  const sortedHighs = [...pivotHighs].sort((left, right) => right - left);
  const zones: Array<{ level: number; touches: number }> = [];

  for (const high of sortedHighs) {
    const tolerance = high * (tolerancePct / 100);
    const existingZone = zones.find((zone) => Math.abs(zone.level - high) <= tolerance);

    if (existingZone) {
      existingZone.level = ((existingZone.level * existingZone.touches) + high) / (existingZone.touches + 1);
      existingZone.touches += 1;
      continue;
    }

    zones.push({ level: high, touches: 1 });
  }

  const validZones = zones
    .filter((zone) => zone.touches >= minTouches)
    .sort((left, right) => {
      if (right.touches !== left.touches) {
        return right.touches - left.touches;
      }
      return right.level - left.level;
    });

  if (validZones.length === 0) {
    return { level: null, touches: 0 };
  }

  return validZones[0];
}

/**
 * Converts a resistance level into the exact breakout confirmation threshold.
 *
 * Formula: resistance × (1 + breakoutThresholdPercent/100)
 */
export function computeBreakoutLevel(
  resistanceLevel: number | null,
  thresholdPct: number = WSP_CONFIG.breakout.breakoutThresholdPercent,
): number | null {
  if (resistanceLevel === null || !Number.isFinite(resistanceLevel)) {
    return null;
  }

  return resistanceLevel * (1 + thresholdPct / 100);
}

/**
 * Determines whether the most recent close is a valid breakout above resistance.
 *
 * Input: ascending chronological bars and a confirmed resistance level.
 * Output: whether the latest close is above the breakout threshold and the number
 * of bars since the start of the current above-threshold run.
 */
export function detectBreakout(
  bars: Bar[],
  resistanceLevel: number | null,
  thresholdPct: number = WSP_CONFIG.breakout.breakoutThresholdPercent,
): BreakoutResult {
  if (bars.length === 0 || resistanceLevel === null) {
    return {
      confirmed: false,
      barsSince: null,
      breakoutLevel: computeBreakoutLevel(resistanceLevel, thresholdPct),
      currentClose: null,
      closeDelta: null,
    };
  }

  const breakoutLevel = computeBreakoutLevel(resistanceLevel, thresholdPct);
  const currentClose = bars[bars.length - 1]?.close ?? null;

  if (breakoutLevel === null || currentClose === null) {
    return {
      confirmed: false,
      barsSince: null,
      breakoutLevel,
      currentClose,
      closeDelta: null,
    };
  }

  const closeDelta = currentClose - breakoutLevel;
  if (currentClose <= breakoutLevel) {
    return {
      confirmed: false,
      barsSince: null,
      breakoutLevel,
      currentClose,
      closeDelta,
    };
  }

  let startIndex = bars.length - 1;
  while (startIndex > 0 && bars[startIndex - 1].close > breakoutLevel) {
    startIndex -= 1;
  }

  return {
    confirmed: true,
    barsSince: (bars.length - 1) - startIndex,
    breakoutLevel,
    currentClose,
    closeDelta,
  };
}

/**
 * Breakout freshness rule used by the hard WSP gate.
 *
 * Output: true only when a confirmed breakout is still within the allowed number of bars.
 */
export function isBreakoutFresh(
  barsSinceBreakout: number | null,
  maxBarsSinceBreakout: number = WSP_CONFIG.breakout.maxBarsSinceBreakout,
): boolean {
  return barsSinceBreakout !== null && barsSinceBreakout <= maxBarsSinceBreakout;
}

/**
 * Stale-breakout rule used by validation/audit.
 *
 * Output: true when a breakout exists but is older than the allowed bar threshold.
 */
export function isBreakoutStale(
  barsSinceBreakout: number | null,
  maxBarsSinceBreakout: number = WSP_CONFIG.breakout.maxBarsSinceBreakout,
): boolean {
  return barsSinceBreakout !== null && barsSinceBreakout > maxBarsSinceBreakout;
}

/**
 * Calculates current-volume versus trailing average volume.
 *
 * Input: ascending chronological bars and an averaging period.
 * Output: exact currentVolume / average(previous N volumes), excluding the current bar.
 */
export function volumeMultiple(
  bars: Bar[],
  avgPeriod: number = WSP_CONFIG.volume.avgPeriod,
): VolumeMultipleResult {
  if (avgPeriod <= 0 || bars.length < avgPeriod + 1) {
    return { multiple: null, averageVolume: null };
  }

  const currentVolume = bars[bars.length - 1].volume;
  const referenceBars = bars.slice(-(avgPeriod + 1), -1);
  const averageVolume = referenceBars.reduce((sum, bar) => sum + bar.volume, 0) / avgPeriod;

  if (Math.abs(averageVolume) < EPSILON) {
    return { multiple: null, averageVolume };
  }

  return {
    multiple: currentVolume / averageVolume,
    averageVolume,
  };
}

function calculateMansfieldValue(rsSeries: number[], endIndex: number, smaPeriod: number): number | null {
  const startIndex = endIndex - smaPeriod + 1;
  if (startIndex < 0) {
    return null;
  }

  const window = rsSeries.slice(startIndex, endIndex + 1);
  const average = window.reduce((sum, value) => sum + value, 0) / smaPeriod;
  if (Math.abs(average) < EPSILON) {
    return null;
  }

  return ((rsSeries[endIndex] / average) - 1) * 100;
}

/**
 * Calculates Mansfield Relative Strength against a benchmark aligned by date.
 *
 * Formula:
 * 1) RS ratio = stock close / benchmark close × 100
 * 2) Mansfield RS = ((current RS / SMA(RS, N)) - 1) × 100
 *
 * Input: ascending chronological stock and benchmark bars.
 * Output: current Mansfield value, direction, and negative→positive transition state.
 */
export function mansfieldRS(
  stockBars: Bar[],
  benchmarkBars: Bar[],
  smaPeriod: number = WSP_CONFIG.mansfield.smaPeriod,
  trendLookback: number = MANSFIELD_TREND_LOOKBACK,
): MansfieldRSResult {
  if (smaPeriod <= 0 || stockBars.length < smaPeriod || benchmarkBars.length < smaPeriod) {
    return { rs: null, trend: 'flat', transition: false };
  }

  const benchmarkByDate = new Map(benchmarkBars.map((bar) => [bar.date, bar]));
  const rsSeries: number[] = [];

  for (const stockBar of stockBars) {
    const benchmarkBar = benchmarkByDate.get(stockBar.date);
    if (!benchmarkBar || Math.abs(benchmarkBar.close) < EPSILON) {
      continue;
    }

    rsSeries.push((stockBar.close / benchmarkBar.close) * 100);
  }

  if (rsSeries.length < smaPeriod) {
    return { rs: null, trend: 'flat', transition: false };
  }

  const currentIndex = rsSeries.length - 1;
  const currentMrs = calculateMansfieldValue(rsSeries, currentIndex, smaPeriod);
  if (currentMrs === null) {
    return { rs: null, trend: 'flat', transition: false };
  }

  const previousIndex = currentIndex - trendLookback;
  const previousMrs = previousIndex >= 0
    ? calculateMansfieldValue(rsSeries, previousIndex, smaPeriod)
    : null;

  let trend: MansfieldTrend = 'flat';
  if (previousMrs !== null) {
    const difference = currentMrs - previousMrs;
    if (difference > 0.3) {
      trend = 'rising';
    } else if (difference < -0.3) {
      trend = 'falling';
    }
  }

  return {
    rs: currentMrs,
    trend,
    transition: previousMrs !== null && previousMrs < 0 && currentMrs > 0,
  };
}

/**
 * Pattern classification only inspects chart structure; it does not decide the
 * final WSP recommendation.
 */
export function classifyPattern(
  bars: Bar[],
  sma50Val: number | null,
  sma150Val: number | null,
  sma50SlopeVal: number | null,
): 'BASE' | 'CLIMBING' | 'TIRED' | 'DOWNHILL' {
  if (bars.length < 20) return 'BASE';

  const price = bars[bars.length - 1].close;
  const recentBars = bars.slice(-20);

  const highs = recentBars.map((bar) => bar.high);
  const lows = recentBars.map((bar) => bar.low);

  const firstHalf = recentBars.slice(0, 10);
  const secondHalf = recentBars.slice(10);

  const avgFirst = firstHalf.reduce((sum, bar) => sum + bar.close, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((sum, bar) => sum + bar.close, 0) / secondHalf.length;
  const trendDirection = avgSecond - avgFirst;

  const highRange = Math.max(...highs) - Math.min(...highs);
  const priceLevel = price > 0 ? highRange / price : 0;

  const midpoint = Math.floor(recentBars.length / 2);
  const firstHalfHighs = recentBars.slice(0, midpoint).map((bar) => bar.high);
  const secondHalfHighs = recentBars.slice(midpoint).map((bar) => bar.high);
  const firstHalfLows = recentBars.slice(0, midpoint).map((bar) => bar.low);
  const secondHalfLows = recentBars.slice(midpoint).map((bar) => bar.low);

  const higherHighs = Math.max(...secondHalfHighs) > Math.max(...firstHalfHighs);
  const higherLows = Math.min(...secondHalfLows) > Math.min(...firstHalfLows);
  const slopeValue = sma50SlopeVal ?? 0;

  if (
    sma50Val !== null && price < sma50Val &&
    slopeValue < 0 &&
    trendDirection < 0 &&
    (!higherHighs && !higherLows)
  ) {
    return 'DOWNHILL';
  }

  if (
    sma50Val !== null && price > sma50Val &&
    Math.abs(slopeValue) < 0.5 &&
    priceLevel < 0.06 &&
    trendDirection < 0
  ) {
    return 'TIRED';
  }

  if (
    sma50Val !== null && price > sma50Val &&
    slopeValue > 0 &&
    (higherHighs || higherLows) &&
    trendDirection > 0
  ) {
    return 'CLIMBING';
  }

  return 'BASE';
}

/**
 * Computes the full indicator set used by the WSP engine.
 *
 * Input: raw provider/fallback bars for a stock plus raw benchmark bars.
 * Output: deterministic indicator values, raw audit fields, and warning flags.
 *
 * Assumptions:
 * - bars are normalized oldest → newest here exactly once
 * - null values mean "not enough trustworthy data" rather than silently using 0
 */
export function computeIndicators(
  bars: Bar[],
  benchmarkBars: Bar[],
): StockIndicators {
  const normalizedBarsResult = normalizeBarsChronologically(bars);
  const normalizedBenchmarkResult = normalizeBarsChronologically(benchmarkBars);
  const normalizedBars = normalizedBarsResult.bars;
  const normalizedBenchmarkBars = normalizedBenchmarkResult.bars;
  const warnings = new Set<IndicatorWarning>([
    ...normalizedBarsResult.warnings,
    ...normalizedBenchmarkResult.warnings.filter((warning) => warning !== 'empty_price_history'),
  ]);

  if (normalizedBars.length < WSP_CONFIG.movingAverages.sma20) {
    warnings.add('insufficient_sma_history');
  }
  if (normalizedBars.length < WSP_CONFIG.movingAverages.sma50 + 10) {
    warnings.add('insufficient_sma_slope_history');
  }
  if (normalizedBars.length < 20) {
    warnings.add('insufficient_resistance_history');
    warnings.add('insufficient_breakout_history');
  }
  if (normalizedBars.length < WSP_CONFIG.volume.avgPeriod + 1) {
    warnings.add('insufficient_volume_history');
  }
  if (normalizedBenchmarkBars.length < WSP_CONFIG.mansfield.smaPeriod || normalizedBars.length < WSP_CONFIG.mansfield.smaPeriod) {
    warnings.add('insufficient_benchmark_history');
  }
  if (normalizedBars.length > 0 && normalizedBenchmarkBars.length > 0 && normalizedBars.length !== normalizedBenchmarkBars.length) {
    warnings.add('benchmark_history_length_mismatch');
  }

  const sharedDates = new Set(normalizedBenchmarkBars.map((bar) => bar.date));
  if (normalizedBars.some((bar) => !sharedDates.has(bar.date))) {
    warnings.add('benchmark_dates_misaligned');
  }
  if (normalizedBenchmarkBars.some((bar) => Math.abs(bar.close) < EPSILON)) {
    warnings.add('near_zero_benchmark_close');
  }

  const sma20Val = sma(normalizedBars, WSP_CONFIG.movingAverages.sma20);
  const sma50Val = sma(normalizedBars, WSP_CONFIG.movingAverages.sma50);
  const sma150Val = sma(normalizedBars, WSP_CONFIG.movingAverages.sma150);
  const sma200Val = sma(normalizedBars, WSP_CONFIG.movingAverages.sma200);
  const slope50 = smaSlope(normalizedBars, WSP_CONFIG.movingAverages.sma50);

  const resistance = detectResistanceZone(normalizedBars);
  const breakout = detectBreakout(normalizedBars, resistance.level);
  const volume = volumeMultiple(normalizedBars);
  const mansfield = mansfieldRS(normalizedBars, normalizedBenchmarkBars);

  if (volume.averageVolume !== null && Math.abs(volume.averageVolume) < EPSILON) {
    warnings.add('near_zero_average_volume');
  }

  return {
    sma20: sma20Val,
    sma50: sma50Val,
    sma150: sma150Val,
    sma200: sma200Val,
    sma50Slope: slope50.value,
    sma50SlopeDirection: slope50.direction,
    resistanceZone: resistance.level,
    resistanceTouches: resistance.touches,
    breakoutLevel: breakout.breakoutLevel,
    currentClose: breakout.currentClose,
    breakoutCloseDelta: breakout.closeDelta,
    breakoutConfirmed: breakout.confirmed,
    barsSinceBreakout: breakout.barsSince,
    averageVolumeReference: volume.averageVolume,
    volumeMultiple: volume.multiple,
    mansfieldRS: mansfield.rs,
    mansfieldRSTrend: mansfield.trend,
    mansfieldTransition: mansfield.transition,
    indicatorWarnings: [...warnings],
    chronologyNormalized: normalizedBarsResult.chronologyNormalized || normalizedBenchmarkResult.chronologyNormalized,
  };
}
