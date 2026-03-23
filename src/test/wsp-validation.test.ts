import { describe, expect, it } from 'vitest';
import { runValidationFixtures } from '@/lib/wsp-validation';
import { evaluateStock } from '@/lib/wsp-engine';
import { createLogicViolation } from '@/lib/wsp-assertions';
import { WSP_CONFIG } from '@/lib/wsp-config';
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
    resistanceUpperBound: 118,
    resistanceTouches: 4,
    resistanceTolerancePct: WSP_CONFIG.wsp.resistanceTolerancePct,
    resistanceTouchIndices: [10, 20, 30, 40],
    resistanceMostRecentTouchDate: '2025-03-15',
    breakoutLevel: 118.59,
    currentClose: 121,
    breakoutCloseDelta: 2.41,
    closeAboveResistancePct: 0.02,
    breakoutConfirmed: true,
    breakoutQualityPass: true,
    breakoutQualityReasons: [],
    breakoutClv: 0.8,
    recentFalseBreakoutsCount: 0,
    barsSinceBreakout: 1,
    breakoutStale: false,
    averageVolumeReference: 1_000_000,
    volumeMultiple: 2.4,
    mansfieldRS: 1.6,
    mansfieldRSPrev: 1.1,
    mansfieldRSTrend: 'rising',
    mansfieldTransition: false,
    mansfieldUptrend: true,
    mansfieldValid: true,
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
    const stock = evaluateStock('ERR', 'Impossible Buy', 'Validation', 'Fixture', [], [], true, true, 'fallback', {
      overrideAnalysis: {
        pattern: 'CLIMBING',
        indicators: createIndicators({ sma50: 130 }),
        price: 120,
        prevClose: 119,
        volume: 2_400_000,
        lastUpdated: '2026-03-23T00:00:00.000Z',
      },
    });

    const violation = createLogicViolation({ ...stock, finalRecommendation: 'KÖP' });

    expect(stock.audit.above50MA).toBe(false);
    expect(violation?.violatedRules).toContain('below_50ma');
  });

  it('forces SÄLJ when price is below the 150-day moving average', () => {
    const stock = evaluateStock('STOP', 'Hard Stop', 'Validation', 'Fixture', [], [], true, true, 'fallback', {
      overrideAnalysis: {
        pattern: 'CLIMBING',
        indicators: createIndicators({ sma150: 125, currentClose: 120 }),
        price: 120,
        prevClose: 119,
        volume: 2_400_000,
        lastUpdated: '2026-03-23T00:00:00.000Z',
      },
    });

    expect(stock.finalRecommendation).toBe('SÄLJ');
    expect(stock.blockedReasons).toContain('below_150ma_hard_stop');
  });
});
