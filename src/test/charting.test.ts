import { describe, expect, it } from 'vitest';
import { barsForTimeframe } from '@/lib/charting';
import type { Bar } from '@/lib/wsp-types';

function makeBar(date: string, close: number): Bar {
  return {
    date,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  };
}

describe('barsForTimeframe', () => {
  it('normalizes unsorted daily bars chronologically for stable chart rendering', () => {
    const unsorted = [
      makeBar('2026-01-03', 103),
      makeBar('2026-01-01', 101),
      makeBar('2026-01-02', 102),
    ];

    const result = barsForTimeframe('1M', unsorted, []);
    expect(result.bars.map((bar) => bar.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(result.bars.map((bar) => bar.close)).toEqual([101, 102, 103]);
  });
});
