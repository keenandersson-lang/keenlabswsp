import { describe, expect, it } from 'vitest';
import { buildMarketCommandSnapshot } from '@/features/market-command/snapshot';
import type { EvaluatedStock, ScreenerApiResponse } from '@/lib/wsp-types';

function mockStock(overrides: Partial<EvaluatedStock>): EvaluatedStock {
  return {
    symbol: 'AAA',
    name: 'Mock Corp',
    sector: 'Technology',
    industry: 'Software',
    price: 100,
    changePercent: 1.2,
    volume: 1_000_000,
    pattern: 'climbing',
    indicators: {} as any,
    gate: {
      breakoutValid: true,
      breakoutFresh: true,
    } as any,
    isValidWspEntry: true,
    finalRecommendation: 'KÖP',
    audit: {} as any,
    blockedReasons: [],
    logicViolations: [],
    score: 80,
    maxScore: 100,
    dataSource: 'live',
    lastUpdated: '2026-03-31T00:00:00.000Z',
    ...overrides,
  };
}

function mockScreener(stocks: EvaluatedStock[]): ScreenerApiResponse {
  return {
    market: {
      sp500Change: 0.1,
      nasdaqChange: 0.2,
      sp500Price: 5000,
      nasdaqPrice: 17000,
      sp500Symbol: 'SPY',
      nasdaqSymbol: 'QQQ',
      benchmarkState: 'live',
      benchmarkLastUpdated: '2026-03-31T00:00:00.000Z',
      marketTrend: 'bullish',
      lastUpdated: '2026-03-31T00:00:00.000Z',
      dataSource: 'live',
    },
    stocks,
    discovery: { HOT: [], BREAKOUT: [], BULLISH: [], BEARISH: [] },
    discoveryMeta: {} as any,
    sectorStatuses: [
      { sector: 'Technology', isBullish: true, changePercent: 0.8, sma50AboveSma200: true },
      { sector: 'Financials', isBullish: false, changePercent: -0.3, sma50AboveSma200: false },
    ],
    providerStatus: { lastFetch: '2026-03-31T00:00:00.000Z' } as any,
    trust: { dataProvenance: 'provider_route' } as any,
    debugSummary: {} as any,
  };
}

describe('market-command industry layer', () => {
  it('builds ranked industry snapshots with setup visibility fields', () => {
    const screener = mockScreener([
      mockStock({ symbol: 'AAPL', industry: 'Software', sector: 'Technology', score: 88, changePercent: 2.5, finalRecommendation: 'KÖP' }),
      mockStock({ symbol: 'MSFT', industry: 'Software', sector: 'Technology', score: 84, changePercent: 1.4, finalRecommendation: 'BEVAKA' }),
      mockStock({ symbol: 'JPM', industry: 'Banks', sector: 'Financials', score: 70, changePercent: -0.4, finalRecommendation: 'SÄLJ', isValidWspEntry: false, gate: { breakoutValid: false, breakoutFresh: false } as any }),
    ]);

    const snapshot = buildMarketCommandSnapshot(screener, {});
    const software = snapshot.industries.items.find((item) => item.industry === 'Software');

    expect(software).toBeTruthy();
    expect(software?.equityCount).toBe(2);
    expect(software?.breakoutCount).toBe(2);
    expect(software?.recommendationCounts).toEqual({ buy: 1, watch: 1, sell: 0, avoid: 0 });
    expect(software?.topEquities).toEqual(['AAPL', 'MSFT']);
    expect(software?.rankScore).toBeGreaterThan(0);
  });

  it('infers sector from selected industry for clean sector -> industry -> equity drilldown', () => {
    const screener = mockScreener([
      mockStock({ symbol: 'AAPL', industry: 'Software', sector: 'Technology' }),
      mockStock({ symbol: 'MSFT', industry: 'Software', sector: 'Technology' }),
      mockStock({ symbol: 'JPM', industry: 'Banks', sector: 'Financials' }),
    ]);

    const snapshot = buildMarketCommandSnapshot(screener, { industry: 'Software' });

    expect(snapshot.sectors.activeSector).toBe('Technology');
    expect(snapshot.industries.activeIndustry).toBe('Software');
    expect(snapshot.equities.items.map((stock) => stock.symbol)).toEqual(['AAPL', 'MSFT']);
  });
});
