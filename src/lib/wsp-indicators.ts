/**
 * WSP Screener — Centralized indicator formulas.
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

interface ResistanceZoneResult {
  level: number | null;
  upperBound: number | null;
  touches: number;
  tolerancePct: number;
  touchIndices: number[];
  mostRecentTouchDate: string | null;
}

interface BreakoutResult {
  confirmed: boolean;
  breakoutIndex: number | null;
  barsSince: number | null;
  breakoutLevel: number | null;
  currentClose: number | null;
  closeDelta: number | null;
  closeAboveResistancePct: number | null;
  qualityPass: boolean;
  qualityReasons: string[];
  clv: number | null;
  recentFalseBreakoutsCount: number;
}

interface VolumeMultipleResult {
  multiple: number | null;
  averageVolume: number | null;
}

interface MansfieldRSResult {
  rs: number | null;
  prev: number | null;
  trend: MansfieldTrend;
  transition: boolean;
  uptrend: boolean;
  valid: boolean;
}

interface SmaSlopeResult {
  value: number | null;
  direction: SmaSlopeDirection;
}

function isFiniteBar(bar: Bar): boolean {
  return Number.isFinite(Date.parse(bar.date))
    && Number.isFinite(bar.open)
    && Number.isFinite(bar.high)
    && Number.isFinite(bar.low)
    && Number.isFinite(bar.close)
    && Number.isFinite(bar.volume);
}

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

  return { bars: sortedBars, chronologyNormalized, warnings: [...warnings] };
}

export function sma(bars: Array<Bar | number>, period: number, endIndex?: number): number | null {
  if (period <= 0) return null;
  const series = typeof bars[0] === 'number' ? bars as number[] : (bars as Bar[]).map((bar) => bar.close);
  if (series.length < period) return null;

  const lastIndex = endIndex ?? (series.length - 1);
  const startIndex = lastIndex - period + 1;
  if (startIndex < 0 || lastIndex >= series.length) return null;

  const window = series.slice(startIndex, lastIndex + 1);
  return window.reduce((sum, value) => sum + value, 0) / period;
}

export function smaSlope(
  bars: Bar[],
  period: number,
  lookback: number = WSP_CONFIG.wsp.smaSlopeLookbackBars,
): SmaSlopeResult {
  if (period <= 0 || lookback <= 0 || bars.length < period + lookback) {
    return { value: null, direction: 'flat' };
  }

  const currentSma = sma(bars, period);
  const previousSma = sma(bars, period, bars.length - 1 - lookback);
  if (currentSma === null || previousSma === null) {
    return { value: null, direction: 'flat' };
  }

  const value = currentSma - previousSma;
  if (Math.abs(value) < EPSILON) return { value: 0, direction: 'flat' };
  return { value, direction: value > 0 ? 'rising' : 'falling' };
}

export function detectResistanceZone(
  bars: Bar[],
  tolerancePct: number = WSP_CONFIG.wsp.resistanceTolerancePct,
  minTouches: number = WSP_CONFIG.wsp.resistanceTouchesMin,
): ResistanceZoneResult {
  if (bars.length < 20) {
    return { level: null, upperBound: null, touches: 0, tolerancePct, touchIndices: [], mostRecentTouchDate: null };
  }

  const lookbackStart = Math.max(0, bars.length - WSP_CONFIG.wsp.resistanceLookbackBars);
  const lookbackBars = bars.slice(lookbackStart);
  const pivotWindow = WSP_CONFIG.wsp.resistancePivotWindow;
  const pivotHighs: Array<{ high: number; absoluteIndex: number; date: string }> = [];

  for (let index = pivotWindow; index < lookbackBars.length - pivotWindow; index += 1) {
    const candidate = lookbackBars[index];
    let isPivot = true;

    for (let offset = 1; offset <= pivotWindow; offset += 1) {
      if (candidate.high < lookbackBars[index - offset].high || candidate.high < lookbackBars[index + offset].high) {
        isPivot = false;
        break;
      }
    }

    if (isPivot) {
      pivotHighs.push({
        high: candidate.high,
        absoluteIndex: lookbackStart + index,
        date: candidate.date,
      });
    }
  }

  type Zone = { values: typeof pivotHighs; level: number; upperBound: number };
  const zones: Zone[] = [];

  for (const pivot of pivotHighs.sort((left, right) => right.high - left.high)) {
    const tolerance = pivot.high * tolerancePct;
    const existingZone = zones.find((zone) => Math.abs(zone.level - pivot.high) <= tolerance);
    if (existingZone) {
      existingZone.values.push(pivot);
      existingZone.level = existingZone.values.reduce((sum, value) => sum + value.high, 0) / existingZone.values.length;
      existingZone.upperBound = Math.max(...existingZone.values.map((value) => value.high));
    } else {
      zones.push({ values: [pivot], level: pivot.high, upperBound: pivot.high });
    }
  }

  const validZones = zones
    .filter((zone) => zone.values.length >= minTouches)
    .sort((left, right) => {
      if (right.upperBound !== left.upperBound) return right.upperBound - left.upperBound;
      return right.values.length - left.values.length;
    });

  if (validZones.length === 0) {
    return { level: null, upperBound: null, touches: 0, tolerancePct, touchIndices: [], mostRecentTouchDate: null };
  }

  const bestZone = validZones[0];
  const touchIndices = bestZone.values
    .map((value) => value.absoluteIndex)
    .sort((left, right) => left - right);
  const mostRecentTouchDate = bestZone.values
    .slice()
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))[0]?.date ?? null;

  return {
    level: bestZone.level,
    upperBound: bestZone.upperBound,
    touches: bestZone.values.length,
    tolerancePct,
    touchIndices,
    mostRecentTouchDate,
  };
}

export function computeBreakoutLevel(
  resistanceUpperBound: number | null,
  thresholdPct: number = WSP_CONFIG.wsp.breakoutMinCloseAboveResistancePct,
): number | null {
  if (resistanceUpperBound === null || !Number.isFinite(resistanceUpperBound)) return null;
  return resistanceUpperBound * (1 + thresholdPct);
}

function calculateClv(bar: Bar): number | null {
  const range = bar.high - bar.low;
  if (range <= EPSILON) return null;
  return (bar.close - bar.low) / range;
}

function countRecentFalseBreakouts(
  bars: Bar[],
  resistanceUpperBound: number,
  breakoutThresholdPct: number,
): number {
  const startIndex = Math.max(0, bars.length - WSP_CONFIG.wsp.falseBreakoutLookbackBars);
  const breakoutLevel = computeBreakoutLevel(resistanceUpperBound, breakoutThresholdPct);
  if (breakoutLevel === null) return 0;

  let falseBreakouts = 0;
  for (let index = startIndex; index < bars.length; index += 1) {
    if (bars[index].close <= breakoutLevel) continue;

    const confirmEnd = Math.min(bars.length - 1, index + WSP_CONFIG.wsp.falseBreakoutConfirmBars);
    let failed = false;
    for (let nextIndex = index + 1; nextIndex <= confirmEnd; nextIndex += 1) {
      if (bars[nextIndex].close <= resistanceUpperBound) {
        failed = true;
        break;
      }
    }

    if (failed) falseBreakouts += 1;
  }

  return falseBreakouts;
}

export function volumeMultiple(
  bars: Bar[],
  avgPeriod: number = WSP_CONFIG.wsp.volumeLookbackBars,
  endIndex?: number,
): VolumeMultipleResult {
  if (avgPeriod <= 0) return { multiple: null, averageVolume: null };
  const currentIndex = endIndex ?? (bars.length - 1);
  if (currentIndex < avgPeriod || currentIndex >= bars.length) {
    return { multiple: null, averageVolume: null };
  }

  const currentVolume = bars[currentIndex].volume;
  const referenceBars = bars.slice(currentIndex - avgPeriod, currentIndex);
  const averageVolume = referenceBars.reduce((sum, bar) => sum + bar.volume, 0) / avgPeriod;
  if (Math.abs(averageVolume) < EPSILON) {
    return { multiple: null, averageVolume };
  }

  return { multiple: currentVolume / averageVolume, averageVolume };
}

export function detectBreakout(
  bars: Bar[],
  resistanceUpperBound: number | null,
  thresholdPct: number = WSP_CONFIG.wsp.breakoutMinCloseAboveResistancePct,
  volumeThreshold: number = WSP_CONFIG.wsp.volumeMultipleMin,
): BreakoutResult {
  if (bars.length === 0 || resistanceUpperBound === null) {
    return {
      confirmed: false,
      breakoutIndex: null,
      barsSince: null,
      breakoutLevel: computeBreakoutLevel(resistanceUpperBound, thresholdPct),
      currentClose: null,
      closeDelta: null,
      closeAboveResistancePct: null,
      qualityPass: false,
      qualityReasons: ['missing_resistance_zone'],
      clv: null,
      recentFalseBreakoutsCount: 0,
    };
  }

  const breakoutLevel = computeBreakoutLevel(resistanceUpperBound, thresholdPct);
  const currentBar = bars[bars.length - 1];
  const currentClose = currentBar?.close ?? null;
  if (breakoutLevel === null || currentClose === null) {
    return {
      confirmed: false,
      breakoutIndex: null,
      barsSince: null,
      breakoutLevel,
      currentClose,
      closeDelta: null,
      closeAboveResistancePct: null,
      qualityPass: false,
      qualityReasons: ['missing_breakout_level'],
      clv: null,
      recentFalseBreakoutsCount: 0,
    };
  }

  const closeDelta = currentClose - breakoutLevel;
  const closeAboveResistancePct = resistanceUpperBound > EPSILON
    ? (currentClose / resistanceUpperBound) - 1
    : null;
  const clv = calculateClv(currentBar);
  const recentFalseBreakoutsCount = countRecentFalseBreakouts(
    bars.slice(0, -1),
    resistanceUpperBound,
    thresholdPct,
  );

  const qualityReasons: string[] = [];
  if (closeAboveResistancePct === null || closeAboveResistancePct < thresholdPct) {
    qualityReasons.push('close_not_far_enough');
  }
  if (clv === null || clv < WSP_CONFIG.wsp.breakoutClvMin) {
    qualityReasons.push('close_not_near_high');
  }
  if (recentFalseBreakoutsCount > WSP_CONFIG.wsp.falseBreakoutMaxCount) {
    qualityReasons.push('recent_false_breakouts');
  }

  const qualityPass = qualityReasons.length === 0;

  if (currentClose <= breakoutLevel) {
    return {
      confirmed: false,
      breakoutIndex: null,
      barsSince: null,
      breakoutLevel,
      currentClose,
      closeDelta,
      closeAboveResistancePct,
      qualityPass,
      qualityReasons,
      clv,
      recentFalseBreakoutsCount,
    };
  }

  const breakoutEventIndices: number[] = [];
  let eventCloseAboveResistancePct: number | null = null;
  let eventClv: number | null = null;
  let eventQualityReasons: string[] = [];
  let eventRecentFalseBreakoutsCount = 0;

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const barBreakoutLevel = computeBreakoutLevel(resistanceUpperBound, thresholdPct);
    if (barBreakoutLevel === null || bar.close <= barBreakoutLevel || index < WSP_CONFIG.wsp.volumeLookbackBars) continue;

    const barVolume = volumeMultiple(bars, WSP_CONFIG.wsp.volumeLookbackBars, index);
    const barClv = calculateClv(bar);
    const priorFalseBreakouts = countRecentFalseBreakouts(bars.slice(0, index), resistanceUpperBound, thresholdPct);
    const barCloseAboveResistancePct = (bar.close / resistanceUpperBound) - 1;
    const barQualityReasons: string[] = [];
    if (barCloseAboveResistancePct < thresholdPct) barQualityReasons.push('close_not_far_enough');
    if (barClv === null || barClv < WSP_CONFIG.wsp.breakoutClvMin) barQualityReasons.push('close_not_near_high');
    if (priorFalseBreakouts > WSP_CONFIG.wsp.falseBreakoutMaxCount) barQualityReasons.push('recent_false_breakouts');

    const passesQuality = barQualityReasons.length === 0;
    if (passesQuality && barVolume.multiple !== null && barVolume.multiple >= volumeThreshold) {
      breakoutEventIndices.push(index);
      eventCloseAboveResistancePct = barCloseAboveResistancePct;
      eventClv = barClv;
      eventQualityReasons = barQualityReasons;
      eventRecentFalseBreakoutsCount = priorFalseBreakouts;
    }
  }

  const latestBreakoutIndex = breakoutEventIndices[breakoutEventIndices.length - 1] ?? null;
  const confirmed = latestBreakoutIndex !== null && currentClose > breakoutLevel;

  return {
    confirmed,
    breakoutIndex: latestBreakoutIndex,
    barsSince: latestBreakoutIndex === null ? null : (bars.length - 1) - latestBreakoutIndex,
    breakoutLevel,
    currentClose,
    closeDelta,
    closeAboveResistancePct: latestBreakoutIndex === null ? closeAboveResistancePct : eventCloseAboveResistancePct,
    qualityPass: latestBreakoutIndex === null ? qualityPass : eventQualityReasons.length === 0,
    qualityReasons: latestBreakoutIndex === null ? qualityReasons : eventQualityReasons,
    clv: latestBreakoutIndex === null ? clv : eventClv,
    recentFalseBreakoutsCount: latestBreakoutIndex === null ? recentFalseBreakoutsCount : eventRecentFalseBreakoutsCount,
  };
}

export function isBreakoutFresh(
  barsSinceBreakout: number | null,
  staleBreakoutBars: number = WSP_CONFIG.wsp.staleBreakoutBars,
): boolean {
  return barsSinceBreakout !== null && barsSinceBreakout < staleBreakoutBars;
}

export function isBreakoutStale(
  barsSinceBreakout: number | null,
  staleBreakoutBars: number = WSP_CONFIG.wsp.staleBreakoutBars,
): boolean {
  return barsSinceBreakout !== null && barsSinceBreakout >= staleBreakoutBars;
}

function calculateMansfieldPoint(
  stockCloseSeries: number[],
  benchmarkCloseSeries: number[],
  endIndex: number,
  maPeriod: number,
): number | null {
  if (endIndex < maPeriod - 1) return null;
  const stockClose = stockCloseSeries[endIndex];
  const benchmarkClose = benchmarkCloseSeries[endIndex];
  if (Math.abs(stockClose) < EPSILON || Math.abs(benchmarkClose) < EPSILON) return null;

  const stockMa = sma(stockCloseSeries, maPeriod, endIndex);
  const benchmarkMa = sma(benchmarkCloseSeries, maPeriod, endIndex);
  if (stockMa === null || benchmarkMa === null || Math.abs(stockMa) < EPSILON || Math.abs(benchmarkMa) < EPSILON) {
    return null;
  }

  const stockRelative = stockClose / stockMa;
  const benchmarkRelative = benchmarkClose / benchmarkMa;
  if (Math.abs(benchmarkRelative) < EPSILON) return null;

  return ((stockRelative / benchmarkRelative) - 1) * 100;
}

export function mansfieldRS(
  stockBars: Bar[],
  benchmarkBars: Bar[],
  smaPeriod: number = WSP_CONFIG.wsp.mansfieldLookbackBars,
  transitionLookback: number = WSP_CONFIG.wsp.mansfieldTransitionLookbackBars,
  trendLookback: number = WSP_CONFIG.wsp.mansfieldTrendLookbackBars,
): MansfieldRSResult {
  if (smaPeriod <= 0 || stockBars.length < smaPeriod || benchmarkBars.length < smaPeriod) {
    return { rs: null, prev: null, trend: 'flat', transition: false, uptrend: false, valid: false };
  }

  const benchmarkByDate = new Map(benchmarkBars.map((bar) => [bar.date, bar.close]));
  const stockCloses: number[] = [];
  const benchmarkCloses: number[] = [];

  for (const stockBar of stockBars) {
    const benchmarkClose = benchmarkByDate.get(stockBar.date);
    if (benchmarkClose === undefined || Math.abs(benchmarkClose) < EPSILON) continue;
    stockCloses.push(stockBar.close);
    benchmarkCloses.push(benchmarkClose);
  }

  if (stockCloses.length < smaPeriod) {
    return { rs: null, prev: null, trend: 'flat', transition: false, uptrend: false, valid: false };
  }

  const nowIndex = stockCloses.length - 1;
  const rs = calculateMansfieldPoint(stockCloses, benchmarkCloses, nowIndex, smaPeriod);
  const prevIndex = nowIndex - trendLookback;
  const prev = prevIndex >= 0 ? calculateMansfieldPoint(stockCloses, benchmarkCloses, prevIndex, smaPeriod) : null;
  if (rs === null) {
    return { rs: null, prev, trend: 'flat', transition: false, uptrend: false, valid: false };
  }

  let trend: MansfieldTrend = 'flat';
  if (prev !== null) {
    if (rs > prev + EPSILON) trend = 'rising';
    else if (rs < prev - EPSILON) trend = 'falling';
  }

  const uptrend = rs > 0 && prev !== null && rs > prev;
  const transition = rs > 0 && Array.from({ length: transitionLookback }, (_, offset) => {
    const index = nowIndex - 1 - offset;
    return index >= 0 ? calculateMansfieldPoint(stockCloses, benchmarkCloses, index, smaPeriod) : null;
  }).some((value) => value !== null && value <= 0);

  return {
    rs,
    prev,
    trend,
    transition,
    uptrend,
    valid: uptrend || transition,
  };
}

export function computeMansfieldSeries(
  stockBars: Bar[],
  benchmarkBars: Bar[],
  smaPeriod: number = 252,
): Array<{ date: string; value: number | null }> {
  const benchmarkByDate = new Map(benchmarkBars.map((bar) => [bar.date, bar.close]));
  const aligned: Array<{ date: string; stockClose: number; benchmarkClose: number }> = [];

  for (const stockBar of stockBars) {
    const benchmarkClose = benchmarkByDate.get(stockBar.date);
    if (benchmarkClose === undefined || Math.abs(benchmarkClose) < EPSILON) continue;
    aligned.push({ date: stockBar.date, stockClose: stockBar.close, benchmarkClose });
  }

  const stockCloseSeries = aligned.map((item) => item.stockClose);
  const benchmarkCloseSeries = aligned.map((item) => item.benchmarkClose);

  return aligned.map((point, index) => ({
    date: point.date,
    value: calculateMansfieldPoint(stockCloseSeries, benchmarkCloseSeries, index, smaPeriod),
  }));
}

export function computeRsiSeries(
  bars: Bar[],
  period: number = 14,
): Array<{ date: string; value: number | null }> {
  if (period <= 0) return bars.map((bar) => ({ date: bar.date, value: null }));
  if (bars.length < period + 1) return bars.map((bar) => ({ date: bar.date, value: null }));

  const deltas = bars.map((bar, index) => {
    if (index === 0) return 0;
    return bar.close - bars[index - 1].close;
  });

  let avgGain = 0;
  let avgLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = deltas[index];
    if (delta >= 0) avgGain += delta;
    else avgLoss += Math.abs(delta);
  }
  avgGain /= period;
  avgLoss /= period;

  const result = bars.map((bar) => ({ date: bar.date, value: null as number | null }));
  result[period] = { date: bars[period].date, value: avgLoss < EPSILON ? 100 : 100 - (100 / (1 + (avgGain / avgLoss))) };

  for (let index = period + 1; index < bars.length; index += 1) {
    const delta = deltas[index];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;

    const rs = avgLoss < EPSILON ? Number.POSITIVE_INFINITY : (avgGain / avgLoss);
    const value = avgLoss < EPSILON ? 100 : 100 - (100 / (1 + rs));
    result[index] = { date: bars[index].date, value };
  }

  return result;
}

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
  const firstHalf = recentBars.slice(0, 10);
  const secondHalf = recentBars.slice(10);
  const avgFirst = firstHalf.reduce((sum, bar) => sum + bar.close, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((sum, bar) => sum + bar.close, 0) / secondHalf.length;
  const trendDirection = avgSecond - avgFirst;
  const highRange = Math.max(...highs) - Math.min(...highs);
  const priceLevel = price > 0 ? highRange / price : 0;
  const midpoint = Math.floor(recentBars.length / 2);
  const higherHighs = Math.max(...recentBars.slice(midpoint).map((bar) => bar.high)) > Math.max(...recentBars.slice(0, midpoint).map((bar) => bar.high));
  const higherLows = Math.min(...recentBars.slice(midpoint).map((bar) => bar.low)) > Math.min(...recentBars.slice(0, midpoint).map((bar) => bar.low));
  const slopeValue = sma50SlopeVal ?? 0;

  if (sma50Val !== null && sma150Val !== null && price < sma50Val && price < sma150Val && slopeValue < 0 && trendDirection < 0 && (!higherHighs && !higherLows)) {
    return 'DOWNHILL';
  }
  if (sma50Val !== null && price > sma50Val && Math.abs(slopeValue) < 0.5 && priceLevel < 0.06 && trendDirection < 0) {
    return 'TIRED';
  }
  if (sma50Val !== null && price > sma50Val && slopeValue > 0 && (higherHighs || higherLows) && trendDirection > 0) {
    return 'CLIMBING';
  }
  return 'BASE';
}

export function computeIndicators(bars: Bar[], benchmarkBars: Bar[]): StockIndicators {
  const normalizedBarsResult = normalizeBarsChronologically(bars);
  const normalizedBenchmarkResult = normalizeBarsChronologically(benchmarkBars);
  const normalizedBars = normalizedBarsResult.bars;
  const normalizedBenchmarkBars = normalizedBenchmarkResult.bars;
  const warnings = new Set<IndicatorWarning>([
    ...normalizedBarsResult.warnings,
    ...normalizedBenchmarkResult.warnings.filter((warning) => warning !== 'empty_price_history'),
  ]);

  if (normalizedBars.length < WSP_CONFIG.movingAverages.sma20) warnings.add('insufficient_sma_history');
  if (normalizedBars.length < WSP_CONFIG.movingAverages.sma50 + WSP_CONFIG.wsp.smaSlopeLookbackBars) warnings.add('insufficient_sma_slope_history');
  if (normalizedBars.length < 20) {
    warnings.add('insufficient_resistance_history');
    warnings.add('insufficient_breakout_history');
  }
  if (normalizedBars.length < WSP_CONFIG.wsp.volumeLookbackBars + 1) warnings.add('insufficient_volume_history');
  if (normalizedBenchmarkBars.length < WSP_CONFIG.wsp.mansfieldLookbackBars || normalizedBars.length < WSP_CONFIG.wsp.mansfieldLookbackBars) {
    warnings.add('insufficient_benchmark_history');
  }
  if (normalizedBars.length > 0 && normalizedBenchmarkBars.length > 0 && normalizedBars.length !== normalizedBenchmarkBars.length) {
    warnings.add('benchmark_history_length_mismatch');
  }

  const sharedDates = new Set(normalizedBenchmarkBars.map((bar) => bar.date));
  if (normalizedBars.some((bar) => !sharedDates.has(bar.date))) warnings.add('benchmark_dates_misaligned');
  if (normalizedBenchmarkBars.some((bar) => Math.abs(bar.close) < EPSILON)) warnings.add('near_zero_benchmark_close');

  const sma20Val = sma(normalizedBars, WSP_CONFIG.movingAverages.sma20);
  const sma50Val = sma(normalizedBars, WSP_CONFIG.movingAverages.sma50);
  const sma150Val = sma(normalizedBars, WSP_CONFIG.movingAverages.sma150);
  const sma200Val = sma(normalizedBars, WSP_CONFIG.movingAverages.sma200);
  const slope50 = smaSlope(normalizedBars, WSP_CONFIG.movingAverages.sma50);
  const resistance = detectResistanceZone(normalizedBars);
  const breakout = detectBreakout(normalizedBars, resistance.upperBound);
  const volume = volumeMultiple(normalizedBars, WSP_CONFIG.wsp.volumeLookbackBars, breakout.breakoutIndex ?? undefined);
  const mansfield = mansfieldRS(normalizedBars, normalizedBenchmarkBars);

  if (volume.averageVolume !== null && Math.abs(volume.averageVolume) < EPSILON) warnings.add('near_zero_average_volume');

  return {
    sma20: sma20Val,
    sma50: sma50Val,
    sma150: sma150Val,
    sma200: sma200Val,
    sma50Slope: slope50.value,
    sma50SlopeDirection: slope50.direction,
    resistanceZone: resistance.level,
    resistanceUpperBound: resistance.upperBound,
    resistanceTouches: resistance.touches,
    resistanceTolerancePct: resistance.tolerancePct,
    resistanceTouchIndices: resistance.touchIndices,
    resistanceMostRecentTouchDate: resistance.mostRecentTouchDate,
    breakoutLevel: breakout.breakoutLevel,
    currentClose: breakout.currentClose,
    breakoutCloseDelta: breakout.closeDelta,
    closeAboveResistancePct: breakout.closeAboveResistancePct,
    breakoutConfirmed: breakout.confirmed,
    breakoutQualityPass: breakout.qualityPass,
    breakoutQualityReasons: breakout.qualityReasons,
    breakoutClv: breakout.clv,
    recentFalseBreakoutsCount: breakout.recentFalseBreakoutsCount,
    barsSinceBreakout: breakout.barsSince,
    breakoutStale: isBreakoutStale(breakout.barsSince),
    averageVolumeReference: volume.averageVolume,
    volumeMultiple: volume.multiple,
    mansfieldRS: mansfield.rs,
    mansfieldRSPrev: mansfield.prev,
    mansfieldRSTrend: mansfield.trend,
    mansfieldTransition: mansfield.transition,
    mansfieldUptrend: mansfield.uptrend,
    mansfieldValid: mansfield.valid,
    indicatorWarnings: [...warnings],
    chronologyNormalized: normalizedBarsResult.chronologyNormalized || normalizedBenchmarkResult.chronologyNormalized,
  };
}
