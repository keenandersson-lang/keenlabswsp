import { describe, expect, it } from 'vitest';
import { runIndicatorFixtures } from '@/lib/wsp-indicator-fixtures';
import { computeIndicators } from '@/lib/wsp-indicators';
import type { Bar } from '@/lib/wsp-types';

function createBar(close: number, index: number, volume = 100): Bar {
  return {
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    open: close,
    high: close,
    low: close,
    close,
    volume,
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
});
