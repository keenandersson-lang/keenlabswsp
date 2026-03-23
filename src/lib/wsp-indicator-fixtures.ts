import { computeBreakoutLevel, detectBreakout, detectResistanceZone, isBreakoutStale, mansfieldRS, normalizeBarsChronologically, sma, smaSlope, volumeMultiple } from './wsp-indicators';
import type { Bar, IndicatorFixtureResult } from './wsp-types';

function createBar(close: number, index: number, extras?: Partial<Bar>): Bar {
  return {
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
    ...extras,
  };
}

function createBarsFromCloses(closes: number[], volumes?: number[], extras?: Array<Partial<Bar>>): Bar[] {
  return closes.map((close, index) => createBar(close, index, {
    volume: volumes?.[index] ?? 100,
    ...(extras?.[index] ?? {}),
  }));
}

function compareNumber(actual: number | null, expected: number | null, precision = 6) {
  if (actual === null || expected === null) return actual === expected;
  return Math.abs(actual - expected) <= 10 ** (-precision);
}

function result(id: string, description: string, passed: boolean, actual: string, expected: string, mismatches: string[] = []): IndicatorFixtureResult {
  return { id, description, passed, actual, expected, mismatches };
}

export function runIndicatorFixtures(): IndicatorFixtureResult[] {
  const smaBars = createBarsFromCloses(Array.from({ length: 50 }, (_, index) => index + 1));
  const slopeBars = createBarsFromCloses(Array.from({ length: 12 }, (_, index) => index + 1));
  const volumeBars = createBarsFromCloses([10, 10, 10, 10, 10, 10], [100, 100, 100, 100, 100, 300]);

  const resistanceBars = createBarsFromCloses(
    [95, 96, 97, 101, 97, 96, 97, 96, 97, 101.05, 97, 96, 97, 96, 97, 101.1, 97, 98, 99, 100, 102],
    Array.from({ length: 21 }, () => 120),
    Array.from({ length: 21 }, (_, index) => ({
      high: [96, 97, 98, 101, 98, 97, 98, 97, 98, 101.05, 98, 97, 98, 97, 98, 101.1, 98, 99, 100, 101, 102.4][index],
      low: [94, 95, 96, 100, 96, 95, 96, 95, 96, 100, 96, 95, 96, 95, 96, 100, 96, 97, 98, 99, 100.8][index],
    })),
  );
  const twoTouchBars = createBarsFromCloses(
    [95, 96, 97, 101, 97, 96, 97, 96, 97, 99, 97, 96, 97, 96, 97, 101.1, 97, 98, 99, 100, 100.2],
    Array.from({ length: 21 }, () => 120),
    Array.from({ length: 21 }, (_, index) => ({
      high: [96, 97, 98, 101, 98, 97, 98, 97, 98, 99, 98, 97, 98, 97, 98, 101.1, 98, 99, 100, 100.1, 100.3][index],
      low: [94, 95, 96, 100, 96, 95, 96, 95, 96, 98, 96, 95, 96, 95, 96, 100, 96, 97, 98, 99, 99.8][index],
    })),
  );

  const breakoutPassBars = createBarsFromCloses([98, 98.5, 99, 99.5, 99.8, 100.6], [100, 100, 100, 100, 100, 250], [{}, {}, {}, {}, {}, { high: 100.8, low: 99.4, close: 100.6 }]);
  const breakoutFailBars = createBarsFromCloses([98, 98.5, 99, 99.5, 99.8, 100.4], [100, 100, 100, 100, 100, 250], [{}, {}, {}, {}, {}, { high: 100.8, low: 99.4, close: 100.4 }]);
  const cleanBreakoutBars = createBarsFromCloses(
    [98, 98.5, 99, 99.2, 99.4, 100.7],
    [100, 100, 100, 100, 100, 260],
    [{}, {}, {}, {}, {}, { high: 100.9, low: 99.9, close: 100.7 }],
  );
  const choppyBreakoutBars = createBarsFromCloses(
    [100.7, 99.5, 100.8, 99.6, 100.9, 99.7, 100.95, 99.8, 101, 99.85, 101.2],
    [240, 120, 240, 120, 240, 120, 240, 120, 240, 120, 260],
    [
      { high: 101, low: 100, close: 100.7 },
      { high: 100.2, low: 99.2, close: 99.5 },
      { high: 101.1, low: 100.1, close: 100.8 },
      { high: 100.3, low: 99.3, close: 99.6 },
      { high: 101.2, low: 100.2, close: 100.9 },
      { high: 100.4, low: 99.4, close: 99.7 },
      { high: 101.2, low: 100.2, close: 100.95 },
      { high: 100.5, low: 99.5, close: 99.8 },
      { high: 101.3, low: 100.3, close: 101 },
      { high: 100.6, low: 99.6, close: 99.85 },
      { high: 101.5, low: 100.2, close: 101.2 },
    ],
  );

  const flatBenchmark = createBarsFromCloses(Array.from({ length: 210 }, () => 100));
  const strongStock = createBarsFromCloses(Array.from({ length: 210 }, (_, index) => 100 + index * 0.5));
  const weakStock = createBarsFromCloses(Array.from({ length: 210 }, (_, index) => 200 - index * 0.4));
  const transitionStock = createBarsFromCloses([
    ...Array.from({ length: 206 }, () => 100),
    100, 100, 100, 110,
  ]);
  const normalized = normalizeBarsChronologically([...breakoutPassBars].reverse());

  const sma20 = sma(smaBars, 20);
  const sma50 = sma(smaBars, 50);
  const slope = smaSlope(slopeBars, 5, 5);
  const resistance = detectResistanceZone(resistanceBars, 0.01, 3);
  const twoTouches = detectResistanceZone(twoTouchBars, 0.01, 3);
  const breakoutPass = detectBreakout(breakoutPassBars, 100, 0.005, 2);
  const breakoutFail = detectBreakout(breakoutFailBars, 100, 0.005, 2);
  const volume = volumeMultiple(volumeBars, 5);
  const mansfieldPositive = mansfieldRS(strongStock, flatBenchmark, 200, 3, 5);
  const mansfieldNegative = mansfieldRS(weakStock, flatBenchmark, 200, 3, 5);
  const mansfieldTransition = mansfieldRS(transitionStock, flatBenchmark, 200, 3, 5);
  const cleanBreakout = detectBreakout(cleanBreakoutBars, 100, 0.005, 2);
  const choppyBreakout = detectBreakout(choppyBreakoutBars, 100, 0.005, 2);

  return [
    result('sma_exact_values', 'SMA20 and SMA50 use arithmetic means on chronological closes.', compareNumber(sma20, 40.5) && compareNumber(sma50, 25.5), `sma20=${sma20}, sma50=${sma50}`, 'sma20=40.5, sma50=25.5'),
    result('sma_slope_lookback', 'SMA slope compares the current SMA against the SMA from 5 bars ago.', compareNumber(slope.value, 5) && slope.direction === 'rising', `value=${slope.value}, direction=${slope.direction}`, 'value=5, direction=rising'),
    result('resistance_three_touches_valid', 'Exactly three clustered highs create a valid resistance zone.', resistance.touches >= 3 && resistance.upperBound !== null, `touches=${resistance.touches}, upper=${resistance.upperBound}`, 'touches>=3, upper!=null'),
    result('resistance_two_touches_invalid', 'Two touches are not enough to create a valid WSP resistance zone.', twoTouches.touches === 0 && twoTouches.upperBound === null, `touches=${twoTouches.touches}, upper=${twoTouches.upperBound}`, 'touches=0, upper=null'),
    result('breakout_requires_threshold', 'Breakout requires a close above the resistance threshold, not merely touching the zone.', breakoutPass.confirmed === true && breakoutFail.confirmed === false && compareNumber(breakoutPass.breakoutLevel, computeBreakoutLevel(100, 0.005)), `pass=${breakoutPass.confirmed}, fail=${breakoutFail.confirmed}, level=${breakoutPass.breakoutLevel}`, 'pass=true, fail=false, level=100.5'),
    result('volume_multiple_prev5_only', 'Volume multiple uses the previous 5 bars and excludes the current bar.', compareNumber(volume.multiple, 3) && compareNumber(volume.averageVolume, 100), `multiple=${volume.multiple}, average=${volume.averageVolume}`, 'multiple=3, average=100'),
    result('stale_breakout_boundary', 'Breakout age is fresh at 7 bars and stale at 8 bars.', isBreakoutStale(7) === false && isBreakoutStale(8) === true, `stale7=${isBreakoutStale(7)}, stale8=${isBreakoutStale(8)}`, 'stale7=false, stale8=true'),
    result('mansfield_positive_negative_and_transition', 'Mansfield is positive above its own SMA, negative below it, and can detect a recent negative-to-positive transition.', Boolean(mansfieldPositive.rs && mansfieldPositive.rs > 0 && mansfieldNegative.rs && mansfieldNegative.rs < 0 && mansfieldTransition.transition && mansfieldTransition.valid), `positive=${mansfieldPositive.rs}, negative=${mansfieldNegative.rs}, transition=${mansfieldTransition.transition}`, 'positive>0, negative<0, transition=true'),
    result('clean_breakout_quality', 'Breakout quality requires CLV support and limited recent false breakouts.', cleanBreakout.qualityPass === true && choppyBreakout.qualityPass === false && choppyBreakout.qualityReasons.includes('recent_false_breakouts'), `clean=${cleanBreakout.qualityPass}, choppy=${choppyBreakout.qualityPass}, reasons=${choppyBreakout.qualityReasons.join('|')}`, 'clean=true, choppy=false, reasons include recent_false_breakouts'),
    result('chronology_normalization', 'Reversed bars are normalized to oldest → newest before calculations.', normalized.chronologyNormalized === true && normalized.bars[0].date < normalized.bars[normalized.bars.length - 1].date, `normalized=${normalized.chronologyNormalized}`, 'normalized=true'),
  ];
}
