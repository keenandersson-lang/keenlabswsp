import { WSP_CONFIG } from './wsp-config';
import {
  computeBreakoutLevel,
  detectBreakout,
  detectResistanceZone,
  isBreakoutStale,
  mansfieldRS,
  normalizeBarsChronologically,
  sma,
  smaSlope,
  volumeMultiple,
} from './wsp-indicators';
import type { Bar, IndicatorFixtureResult } from './wsp-types';

function createBar(close: number, index: number, extras?: Partial<Bar>): Bar {
  return {
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    open: close,
    high: close,
    low: close,
    close,
    volume: 100,
    ...extras,
  };
}

function createBarsFromCloses(closes: number[], volumes?: number[]): Bar[] {
  return closes.map((close, index) => createBar(close, index, {
    high: close,
    low: close,
    volume: volumes?.[index] ?? 100,
  }));
}

function createResistanceFixtureBars(): Bar[] {
  const closes = [90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 95, 96, 97, 98, 99, 94, 95, 96, 97, 98, 94, 95, 96, 97, 98, 99, 100, 99, 98, 97];
  const highs = [91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 96, 97, 98, 99, 100.2, 95, 96, 97, 98, 99.8, 95, 96, 97, 98, 99, 100.1, 99, 98, 97, 96];
  return closes.map((close, index) => createBar(close, index, {
    high: highs[index],
    low: close - 1,
    volume: 1000 + index,
  }));
}

function createNoisyResistanceBars(): Bar[] {
  const closes = [90, 93, 91, 95, 92, 97, 94, 99, 95, 101, 96, 103, 97, 102, 98, 104, 99, 105, 100, 106, 99, 104, 98, 103, 97, 102, 96, 101, 95, 100];
  return closes.map((close, index) => createBar(close, index, {
    high: close + ((index % 5) * 0.7),
    low: close - 1.2,
    volume: 1200 + index,
  }));
}

function compareNumber(actual: number | null, expected: number | null, precision = 6) {
  if (actual === null || expected === null) {
    return actual === expected;
  }

  return Math.abs(actual - expected) <= 10 ** (-precision);
}

function result(id: string, description: string, passed: boolean, actual: string, expected: string, mismatches: string[] = []): IndicatorFixtureResult {
  return { id, description, passed, actual, expected, mismatches };
}

export function runIndicatorFixtures(): IndicatorFixtureResult[] {
  const smaBars = createBarsFromCloses(Array.from({ length: 50 }, (_, index) => index + 1));
  const risingSlopeBars = createBarsFromCloses(Array.from({ length: 20 }, (_, index) => index + 1));
  const flatSlopeBars = createBarsFromCloses(Array.from({ length: 20 }, () => 100));
  const decliningSlopeBars = createBarsFromCloses(Array.from({ length: 20 }, (_, index) => 20 - index));
  const volumeBars = createBarsFromCloses([10, 10, 10, 10, 10, 10], [100, 100, 100, 100, 100, 300]);
  const breakoutBars = createBarsFromCloses([96, 97, 98, 99, 100, 101.2]);
  const belowResistanceBars = createBarsFromCloses([96, 97, 98, 99, 100, 100.49]);
  const choppyBreakoutBars = createBarsFromCloses([96, 97, 101.2, 99.8, 101.4]);
  const stockBars = createBarsFromCloses([100, 100, 100, 110, 130, 150]);
  const benchmarkBars = createBarsFromCloses([100, 100, 100, 100, 100, 100]);
  const weakStockBars = createBarsFromCloses([100, 100, 100, 90, 85, 80]);
  const resistanceBars = createResistanceFixtureBars();
  const noisyBars = createNoisyResistanceBars();

  const sma20 = sma(smaBars, 20);
  const sma50 = sma(smaBars, 50);
  const risingSlope = smaSlope(risingSlopeBars, 5, 5);
  const flatSlope = smaSlope(flatSlopeBars, 5, 5);
  const decliningSlope = smaSlope(decliningSlopeBars, 5, 5);
  const volume = volumeMultiple(volumeBars, 5);
  const breakout = detectBreakout(breakoutBars, 100, 0.5);
  const noBreakout = detectBreakout(belowResistanceBars, 100, 0.5);
  const choppyBreakout = detectBreakout(choppyBreakoutBars, 100, 0.5);
  const strongMansfield = mansfieldRS(stockBars, benchmarkBars, 3, 2);
  const weakMansfield = mansfieldRS(weakStockBars, benchmarkBars, 3, 2);
  const resistance = detectResistanceZone(resistanceBars, 0.5, 3);
  const noisyResistance = detectResistanceZone(noisyBars, 0.5, 3);
  const normalized = normalizeBarsChronologically([...breakoutBars].reverse());

  return [
    result(
      'sma_exact_values',
      'SMA20 and SMA50 return exact arithmetic means for a known close series.',
      compareNumber(sma20, 40.5) && compareNumber(sma50, 25.5),
      `sma20=${sma20}, sma50=${sma50}`,
      'sma20=40.5, sma50=25.5',
      [
        ...(!compareNumber(sma20, 40.5) ? [`Expected SMA20=40.5, got ${sma20}`] : []),
        ...(!compareNumber(sma50, 25.5) ? [`Expected SMA50=25.5, got ${sma50}`] : []),
      ],
    ),
    result(
      'sma_slope_rising',
      'Rising moving averages produce a positive SMA slope.',
      compareNumber(risingSlope.value, 5) && risingSlope.direction === 'rising',
      `value=${risingSlope.value}, direction=${risingSlope.direction}`,
      'value=5, direction=rising',
      risingSlope.direction === 'rising' && compareNumber(risingSlope.value, 5) ? [] : [`Expected rising slope of 5, got ${risingSlope.value} (${risingSlope.direction})`],
    ),
    result(
      'sma_slope_flat',
      'Flat moving averages produce a zero SMA slope.',
      compareNumber(flatSlope.value, 0) && flatSlope.direction === 'flat',
      `value=${flatSlope.value}, direction=${flatSlope.direction}`,
      'value=0, direction=flat',
      flatSlope.direction === 'flat' && compareNumber(flatSlope.value, 0) ? [] : [`Expected flat slope of 0, got ${flatSlope.value} (${flatSlope.direction})`],
    ),
    result(
      'sma_slope_declining',
      'Declining moving averages produce a negative SMA slope.',
      compareNumber(decliningSlope.value, -5) && decliningSlope.direction === 'falling',
      `value=${decliningSlope.value}, direction=${decliningSlope.direction}`,
      'value=-5, direction=falling',
      decliningSlope.direction === 'falling' && compareNumber(decliningSlope.value, -5) ? [] : [`Expected falling slope of -5, got ${decliningSlope.value} (${decliningSlope.direction})`],
    ),
    result(
      'volume_multiple_exact',
      'Volume multiple uses current volume divided by the average of the prior N bars.',
      compareNumber(volume.multiple, 3) && compareNumber(volume.averageVolume, 100),
      `multiple=${volume.multiple}, average=${volume.averageVolume}`,
      'multiple=3, average=100',
      compareNumber(volume.multiple, 3) && compareNumber(volume.averageVolume, 100) ? [] : [`Expected multiple=3 and average=100, got ${volume.multiple} / ${volume.averageVolume}`],
    ),
    result(
      'breakout_stale_logic',
      'Breakout freshness is true inside the allowed bar window and stale once it exceeds the limit.',
      isBreakoutStale(3) === false && isBreakoutStale(WSP_CONFIG.breakout.maxBarsSinceBreakout + 1) === true,
      `stale(3)=${isBreakoutStale(3)}, stale(${WSP_CONFIG.breakout.maxBarsSinceBreakout + 1})=${isBreakoutStale(WSP_CONFIG.breakout.maxBarsSinceBreakout + 1)}`,
      `stale(3)=false, stale(${WSP_CONFIG.breakout.maxBarsSinceBreakout + 1})=true`,
      isBreakoutStale(3) === false && isBreakoutStale(WSP_CONFIG.breakout.maxBarsSinceBreakout + 1) === true ? [] : ['Breakout stale logic did not respect the configured max bars threshold.'],
    ),
    result(
      'mansfield_positive_direction',
      'A stock materially outperforming a flat benchmark yields positive, rising Mansfield RS.',
      strongMansfield.rs !== null && strongMansfield.rs > 0 && strongMansfield.trend === 'rising',
      `rs=${strongMansfield.rs}, trend=${strongMansfield.trend}`,
      'rs>0, trend=rising',
      strongMansfield.rs !== null && strongMansfield.rs > 0 && strongMansfield.trend === 'rising' ? [] : [`Expected positive/rising Mansfield RS, got ${strongMansfield.rs} (${strongMansfield.trend})`],
    ),
    result(
      'mansfield_negative_direction',
      'A stock underperforming a flat benchmark yields negative Mansfield RS.',
      weakMansfield.rs !== null && weakMansfield.rs < 0,
      `rs=${weakMansfield.rs}, trend=${weakMansfield.trend}`,
      'rs<0',
      weakMansfield.rs !== null && weakMansfield.rs < 0 ? [] : [`Expected negative Mansfield RS, got ${weakMansfield.rs}`],
    ),
    result(
      'resistance_detects_repeated_highs',
      'Repeated pivot highs inside a tight band create a valid resistance level.',
      resistance.level !== null && resistance.touches >= 3,
      `level=${resistance.level}, touches=${resistance.touches}`,
      'level≈100, touches>=3',
      resistance.level !== null && resistance.touches >= 3 ? [] : [`Expected a valid resistance cluster, got level=${resistance.level} touches=${resistance.touches}`],
    ),
    result(
      'resistance_ignores_noise',
      'Noisy, non-clustered highs do not falsely produce strong resistance.',
      noisyResistance.level === null && noisyResistance.touches === 0,
      `level=${noisyResistance.level}, touches=${noisyResistance.touches}`,
      'level=null, touches=0',
      noisyResistance.level === null && noisyResistance.touches === 0 ? [] : [`Expected no resistance cluster, got level=${noisyResistance.level} touches=${noisyResistance.touches}`],
    ),
    result(
      'breakout_detects_clear_move',
      'A close above the breakout threshold is flagged as a valid breakout.',
      breakout.confirmed === true && breakout.barsSince === 0 && compareNumber(breakout.breakoutLevel, computeBreakoutLevel(100, 0.5)),
      `confirmed=${breakout.confirmed}, barsSince=${breakout.barsSince}, breakoutLevel=${breakout.breakoutLevel}`,
      'confirmed=true, barsSince=0, breakoutLevel=100.5',
      breakout.confirmed === true && breakout.barsSince === 0 ? [] : ['Expected a fresh breakout above 100.5.'],
    ),
    result(
      'breakout_rejects_at_or_below_level',
      'A close at or below the breakout threshold is not a valid breakout.',
      noBreakout.confirmed === false && noBreakout.barsSince === null,
      `confirmed=${noBreakout.confirmed}, barsSince=${noBreakout.barsSince}`,
      'confirmed=false, barsSince=null',
      noBreakout.confirmed === false && noBreakout.barsSince === null ? [] : ['Expected no breakout when price is at or below the threshold.'],
    ),
    result(
      'breakout_handles_choppy_retests',
      'A renewed move above resistance after dipping back below starts a new breakout age at 0 bars.',
      choppyBreakout.confirmed === true && choppyBreakout.barsSince === 0,
      `confirmed=${choppyBreakout.confirmed}, barsSince=${choppyBreakout.barsSince}`,
      'confirmed=true, barsSince=0',
      choppyBreakout.confirmed === true && choppyBreakout.barsSince === 0 ? [] : ['Expected the latest above-threshold close to reset breakout age to 0.'],
    ),
    result(
      'chronology_normalization',
      'Indicator calculations normalize reversed bars into ascending chronological order before computing.',
      normalized.chronologyNormalized === true && normalized.bars[0].date < normalized.bars[normalized.bars.length - 1].date,
      `normalized=${normalized.chronologyNormalized}, first=${normalized.bars[0]?.date}, last=${normalized.bars[normalized.bars.length - 1]?.date}`,
      'normalized=true, bars sorted ascending',
      normalized.chronologyNormalized === true ? [] : ['Expected reversed input bars to be normalized into ascending order.'],
    ),
  ];
}
