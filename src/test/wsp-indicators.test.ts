import { describe, expect, it } from 'vitest';
import { runIndicatorFixtures } from '@/lib/wsp-indicator-fixtures';
import { computeIndicators, detectBreakout, volumeMultiple } from '@/lib/wsp-indicators';
import type { Bar } from '@/lib/wsp-types';

function createBar(close: number, index: number, volume = 100, extras?: Partial<Bar>): Bar {
  return {
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume,
    ...extras,
  };
}

describe('WSP indicator fixtures', () => {
  it('passes every deterministic indicator fixture', () => {
    const results = runIndicatorFixtures();
    expect(results.every((result) => result.passed)).toBe(true);
  });

  it('returns explicit warning flags for insufficient history instead of silent bad math', () => {
    const bars = [createBar(100, 0), createBar(101, 1), createBar(102, 2)];
    const benchmarkBars = [createBar(200, 0), createBar(201, 1), createBar(202, 2)];
    const indicators = computeIndicators(bars, benchmarkBars);

    expect(indicators.sma20).toBeNull();
    expect(indicators.sma50Slope).toBeNull();
    expect(indicators.volumeMultiple).toBeNull();
    expect(indicators.mansfieldRS).toBeNull();
    expect(indicators.indicatorWarnings).toEqual(expect.arrayContaining([
      'insufficient_sma_history',
      'insufficient_sma_slope_history',
      'insufficient_volume_history',
      'insufficient_benchmark_history',
    ]));
  });

  it('normalizes unsorted bars before computing moving averages', () => {
    const chronological = Array.from({ length: 20 }, (_, index) => createBar(index + 1, index));
    const reversed = [...chronological].reverse();
    const indicators = computeIndicators(reversed, reversed);

    expect(indicators.chronologyNormalized).toBe(true);
    expect(indicators.sma20).toBe(10.5);
  });

  it('uses the previous 5 bars excluding the current breakout bar for volume multiple', () => {
    const bars = [100, 100, 100, 100, 100, 300].map((volume, index) => createBar(100 + index, index, volume));
    const result = volumeMultiple(bars, 5);

    expect(result.averageVolume).toBe(100);
    expect(result.multiple).toBe(3);
  });

  it('fails breakout quality when close location value is weak', () => {
    const bars = [
      createBar(99, 0),
      createBar(99.2, 1),
      createBar(99.4, 2),
      createBar(99.6, 3),
      createBar(99.8, 4),
      createBar(100.7, 5, 300, { high: 101.4, low: 99.8, close: 100.7 }),
    ];
    const breakout = detectBreakout(bars, 100, 0.005, 2);

    expect(breakout.qualityPass).toBe(false);
    expect(breakout.qualityReasons).toContain('close_not_near_high');
  });
});
