import { describe, expect, it } from 'vitest';
import { buildDiscoverySnapshot, buildSectorHeatmap, classifyTrendBucket } from '@/lib/discovery';
import type { EvaluatedStock } from '@/lib/wsp-types';

function mockStock(overrides: Partial<EvaluatedStock>): EvaluatedStock {
  return {
    symbol: 'AAA',
    name: 'Mock Corp',
    sector: 'Technology',
    industry: 'Software',
    price: 100,
    changePercent: 1,
    volume: 1_000_000,
    pattern: 'CLIMBING',
    indicators: {} as any,
    gate: {} as any,
    isValidWspEntry: true,
    finalRecommendation: 'KÖP',
    audit: {
      breakoutValid: true,
      breakoutQualityPass: true,
      volumeValid: true,
      breakoutStale: false,
      mansfieldValid: true,
      slope50Positive: true,
      above50MA: true,
      above150MA: true,
      volumeMultiple: 1.8,
      mansfieldValue: 1.2,
    } as any,
    blockedReasons: [],
    logicViolations: [],
    score: 78,
    maxScore: 100,
    dataSource: 'live',
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

describe('discovery truth reset', () => {
  it('uses proxy sector return when sector status is available in live mode', () => {
    const sectors = buildSectorHeatmap(
      [mockStock({ sector: 'Technology' })],
      [{ sector: 'Technology', isBullish: true, changePercent: 1.25, sma50AboveSma200: true }],
      'LIVE',
    );

    expect(sectors[0].valueMode).toBe('proxy_return');
    expect(sectors[0].displayValue).toBe(1.25);
  });

  it('renders ETF-defined sectors even when no stocks are assigned', () => {
    const sectors = buildSectorHeatmap(
      [mockStock({ sector: 'Unknown' })],
      [
        { sector: 'Technology', isBullish: true, changePercent: 1.1, sma50AboveSma200: true },
        { sector: 'Healthcare', isBullish: false, changePercent: -0.5, sma50AboveSma200: false },
      ],
      'LIVE',
    );

    expect(sectors.map((sector) => sector.sector)).toEqual(expect.arrayContaining(['Technology', 'Healthcare']));
    expect(sectors).toHaveLength(2);
  });

  it('downgrades sector values to tracked strength in fallback mode', () => {
    const sectors = buildSectorHeatmap(
      [mockStock({ sector: 'Technology' })],
      [{ sector: 'Technology', isBullish: true, changePercent: 4.5, sma50AboveSma200: true }],
      'FALLBACK',
    );

    expect(sectors[0].valueMode).toBe('tracked_strength');
    expect(sectors[0].valueLabel).toContain('Tracked strength');
  });

  it('classifies breakout only when strict breakout conditions pass', () => {
    const valid = classifyTrendBucket(mockStock({}));
    const invalid = classifyTrendBucket(mockStock({ audit: { breakoutValid: true, breakoutQualityPass: false } as any }));

    expect(valid.bucket).toBe('BREAKOUT');
    expect(invalid.bucket).not.toBe('BREAKOUT');
  });

  it('marks discovery snapshot as degraded outside live mode', () => {
    const { discoveryMeta } = buildDiscoverySnapshot([mockStock({ dataSource: 'fallback' })], 'STALE');
    expect(discoveryMeta.trendClassificationMode).toBe('degraded_snapshot');
    expect(discoveryMeta.degraded.snapshotLimited).toBe(true);
  });
});
