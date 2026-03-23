import { describe, expect, it } from 'vitest';
import { runValidationFixtures } from '@/lib/wsp-validation';
import { evaluateStock } from '@/lib/wsp-engine';
import { createLogicViolation } from '@/lib/wsp-assertions';
import type { StockIndicators } from '@/lib/wsp-types';

function createIndicators(overrides: Partial<StockIndicators> = {}): StockIndicators {
  return {
    sma20: 112,
    sma50: 110,
    sma150: 100,
    sma200: 95,
    sma50Slope: 2,
    sma50SlopeDirection: 'rising',
    resistanceZone: 118,
    resistanceTouches: 4,
    breakoutLevel: 118.59,
    currentClose: 121,
    breakoutCloseDelta: 2.41,
    breakoutConfirmed: true,
    barsSinceBreakout: 1,
    averageVolumeReference: 1_000_000,
    volumeMultiple: 2.4,
    mansfieldRS: 1.6,
    mansfieldRSTrend: 'rising',
    mansfieldTransition: false,
    indicatorWarnings: [],
    chronologyNormalized: false,
    ...overrides,
  };
}

describe('WSP validation fixtures', () => {
  it('passes every deterministic validation scenario', () => {
    const results = runValidationFixtures();

    expect(results.every((result) => result.passed)).toBe(true);
  });

  it('flags impossible KÖP states instead of silently allowing them', () => {
    const stock = evaluateStock(
      'ERR',
      'Impossible Buy',
      'Validation',
      'Fixture',
      [],
      [],
      true,
      true,
      'fallback',
      {
        overrideAnalysis: {
          pattern: 'CLIMBING',
          indicators: createIndicators({ sma50: 130 }),
          price: 120,
          prevClose: 119,
          volume: 2_400_000,
          lastUpdated: '2026-03-23T00:00:00.000Z',
        },
      },
    );

    const violation = createLogicViolation({
      ...stock,
      finalRecommendation: 'KÖP',
    });

    expect(stock.audit.above50MA).toBe(false);
    expect(violation?.violatedRules).toContain('below_50ma');
  });
});
