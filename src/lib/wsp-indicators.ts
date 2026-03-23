/**
 * WSP Screener — Pure Indicator Functions
 * All technical analysis computations as pure functions.
 */

import type { Bar, StockIndicators } from './wsp-types';
import { WSP_CONFIG } from './wsp-config';

// ─── Simple Moving Average ───
export function sma(bars: Bar[], period: number): number | null {
  if (bars.length < period) return null;
  const slice = bars.slice(-period);
  return slice.reduce((sum, b) => sum + b.close, 0) / period;
}

// ─── SMA Slope (over last N bars) ───
export function smaSlope(bars: Bar[], period: number, lookback: number = 10): number {
  if (bars.length < period + lookback) return 0;
  const currentSma = sma(bars, period);
  const pastBars = bars.slice(0, -lookback);
  const pastSma = sma(pastBars, period);
  if (currentSma === null || pastSma === null) return 0;
  return currentSma - pastSma;
}

// ─── Resistance Zone Detection ───
export function detectResistanceZone(
  bars: Bar[],
  tolerancePct: number = WSP_CONFIG.breakout.tolerancePercent,
  minTouches: number = WSP_CONFIG.breakout.minTouches,
): { level: number; touches: number } | null {
  if (bars.length < 20) return null;

  // Look at the last 100 bars (or all available)
  const lookbackBars = bars.slice(-Math.min(100, bars.length));
  const highs = lookbackBars.map(b => b.high);

  // Find clusters of similar highs
  const sorted = [...highs].sort((a, b) => b - a);
  const tolerance = (sorted[0] * tolerancePct) / 100;

  // Group highs into zones
  const zones: { level: number; touches: number }[] = [];

  for (const high of sorted) {
    const existingZone = zones.find(z => Math.abs(z.level - high) <= tolerance);
    if (existingZone) {
      existingZone.touches++;
      existingZone.level = (existingZone.level * (existingZone.touches - 1) + high) / existingZone.touches;
    } else {
      zones.push({ level: high, touches: 1 });
    }
  }

  // Return the zone with most touches that meets minimum
  const validZones = zones.filter(z => z.touches >= minTouches);
  if (validZones.length === 0) return null;

  // Prefer the highest zone with enough touches
  validZones.sort((a, b) => b.level - a.level);
  return validZones[0];
}

// ─── Breakout Detection ───
export function detectBreakout(
  bars: Bar[],
  resistanceLevel: number,
  thresholdPct: number = WSP_CONFIG.breakout.breakoutThresholdPercent,
): { confirmed: boolean; barsSince: number | null } {
  if (bars.length === 0) return { confirmed: false, barsSince: null };

  const threshold = resistanceLevel * (1 + thresholdPct / 100);
  const currentPrice = bars[bars.length - 1].close;

  if (currentPrice <= threshold) return { confirmed: false, barsSince: null };

  // Find when breakout first occurred
  let barsSince = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].close > threshold) {
      barsSince = bars.length - 1 - i;
    } else {
      break;
    }
  }

  return { confirmed: true, barsSince };
}

// ─── Volume Surge Detection ───
export function volumeMultiple(bars: Bar[], avgPeriod: number = WSP_CONFIG.volume.avgPeriod): number {
  if (bars.length < avgPeriod + 1) return 0;
  const currentVolume = bars[bars.length - 1].volume;
  const avgBars = bars.slice(-(avgPeriod + 1), -1);
  const avgVol = avgBars.reduce((sum, b) => sum + b.volume, 0) / avgPeriod;
  if (avgVol === 0) return 0;
  return currentVolume / avgVol;
}

// ─── Mansfield Relative Strength ───
export function mansfieldRS(
  stockBars: Bar[],
  benchmarkBars: Bar[],
  smaPeriod: number = WSP_CONFIG.mansfield.smaPeriod,
): { rs: number; trend: 'rising' | 'falling' | 'flat'; transition: boolean } {
  if (stockBars.length < smaPeriod + 10 || benchmarkBars.length < smaPeriod + 10) {
    return { rs: 0, trend: 'flat', transition: false };
  }

  // Calculate RS ratio series
  const minLen = Math.min(stockBars.length, benchmarkBars.length);
  const stockSlice = stockBars.slice(-minLen);
  const benchSlice = benchmarkBars.slice(-minLen);

  const rsSeries: number[] = [];
  for (let i = 0; i < minLen; i++) {
    if (benchSlice[i].close === 0) continue;
    rsSeries.push((stockSlice[i].close / benchSlice[i].close) * 100);
  }

  if (rsSeries.length < smaPeriod) return { rs: 0, trend: 'flat', transition: false };

  // SMA of RS series
  const rsSma = rsSeries.slice(-smaPeriod).reduce((s, v) => s + v, 0) / smaPeriod;

  // Mansfield RS = ((current RS / SMA of RS) - 1) * 100
  const currentRS = rsSeries[rsSeries.length - 1];
  const mrs = ((currentRS / rsSma) - 1) * 100;

  // Trend: compare current vs 10 bars ago
  const prevIdx = rsSeries.length - 11;
  const prevRS = prevIdx >= 0 ? rsSeries[prevIdx] : rsSeries[0];
  const prevMrs = ((prevRS / rsSma) - 1) * 100;

  let trend: 'rising' | 'falling' | 'flat' = 'flat';
  const diff = mrs - prevMrs;
  if (diff > 0.3) trend = 'rising';
  else if (diff < -0.3) trend = 'falling';

  // Transition: was negative, now positive
  const transition = prevMrs < 0 && mrs > 0;

  return { rs: Math.round(mrs * 10) / 10, trend, transition };
}

// ─── Pattern Classification (Layer 1) ───
export function classifyPattern(
  bars: Bar[],
  sma50Val: number | null,
  sma150Val: number | null,
  sma50SlopeVal: number,
): 'BASE' | 'CLIMBING' | 'TIRED' | 'DOWNHILL' {
  if (bars.length < 20) return 'BASE';

  const price = bars[bars.length - 1].close;
  const recentBars = bars.slice(-20);

  // Calculate trend metrics
  const highs = recentBars.map(b => b.high);
  const lows = recentBars.map(b => b.low);

  const firstHalf = recentBars.slice(0, 10);
  const secondHalf = recentBars.slice(10);

  const avgFirst = firstHalf.reduce((s, b) => s + b.close, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, b) => s + b.close, 0) / secondHalf.length;
  const trendDirection = avgSecond - avgFirst;

  const highRange = Math.max(...highs) - Math.min(...highs);
  const priceLevel = price > 0 ? highRange / price : 0;

  // Higher highs / higher lows check
  const mid = Math.floor(recentBars.length / 2);
  const firstHalfHighs = recentBars.slice(0, mid).map(b => b.high);
  const secondHalfHighs = recentBars.slice(mid).map(b => b.high);
  const firstHalfLows = recentBars.slice(0, mid).map(b => b.low);
  const secondHalfLows = recentBars.slice(mid).map(b => b.low);

  const higherHighs = Math.max(...secondHalfHighs) > Math.max(...firstHalfHighs);
  const higherLows = Math.min(...secondHalfLows) > Math.min(...firstHalfLows);

  // DOWNHILL: clear downward structure
  if (
    sma50Val !== null && price < sma50Val &&
    sma50SlopeVal < 0 &&
    trendDirection < 0 &&
    (!higherHighs && !higherLows)
  ) {
    return 'DOWNHILL';
  }

  // TIRED: top-side consolidation, momentum flattening
  if (
    sma50Val !== null && price > sma50Val &&
    Math.abs(sma50SlopeVal) < 0.5 &&
    priceLevel < 0.06 &&
    trendDirection < 0
  ) {
    return 'TIRED';
  }

  // CLIMBING: upward structure with higher highs/lows
  if (
    sma50Val !== null && price > sma50Val &&
    sma50SlopeVal > 0 &&
    (higherHighs || higherLows) &&
    trendDirection > 0
  ) {
    return 'CLIMBING';
  }

  // BASE: sideways consolidation
  return 'BASE';
}

// ─── Full Indicator Computation ───
export function computeIndicators(
  bars: Bar[],
  benchmarkBars: Bar[],
): StockIndicators {
  const sma20Val = sma(bars, WSP_CONFIG.movingAverages.sma20);
  const sma50Val = sma(bars, WSP_CONFIG.movingAverages.sma50);
  const sma150Val = sma(bars, WSP_CONFIG.movingAverages.sma150);
  const sma200Val = sma(bars, WSP_CONFIG.movingAverages.sma200);
  const slope50 = smaSlope(bars, WSP_CONFIG.movingAverages.sma50);

  const resistance = detectResistanceZone(bars);
  let breakout = { confirmed: false, barsSince: null as number | null };
  if (resistance) {
    breakout = detectBreakout(bars, resistance.level);
  }

  const volMultiple = volumeMultiple(bars);
  const mrs = mansfieldRS(bars, benchmarkBars);

  return {
    sma20: sma20Val,
    sma50: sma50Val,
    sma150: sma150Val,
    sma200: sma200Val,
    sma50Slope: slope50,
    resistanceZone: resistance?.level ?? null,
    resistanceTouches: resistance?.touches ?? 0,
    breakoutConfirmed: breakout.confirmed,
    barsSinceBreakout: breakout.barsSince,
    volumeMultiple: Math.round(volMultiple * 10) / 10,
    mansfieldRS: mrs.rs,
    mansfieldRSTrend: mrs.trend,
    mansfieldTransition: mrs.transition,
  };
}
