/**
 * WSP Screener — Demo/Fallback Data
 * Generates realistic demo data using the strict 3-layer engine.
 * Clearly labeled as fallback — not live data.
 */

import type { EvaluatedStock, MarketOverview, Bar, WSPRecommendation } from './wsp-types';
import { evaluateStock } from './wsp-engine';
import { TRACKED_SYMBOLS } from './tracked-symbols';

// ─── Generate synthetic bars for demo purposes ───
function generateBars(
  currentPrice: number,
  trend: 'up' | 'down' | 'flat' | 'topping',
  days: number = 200,
  currentVolume: number = 10_000_000,
  avgVolume: number = 10_000_000,
): Bar[] {
  const bars: Bar[] = [];
  let price = currentPrice;

  for (let i = days; i >= 0; i--) {
    const noise = (Math.random() - 0.5) * price * 0.02;
    let drift = 0;

    if (trend === 'up') drift = price * 0.003;
    else if (trend === 'down') drift = -price * 0.004;
    else if (trend === 'topping') drift = i > days / 2 ? price * 0.003 : -price * 0.001;

    if (i > 0) {
      price = price - drift + noise;
    }

    const vol = i === 0 ? currentVolume : avgVolume * (0.7 + Math.random() * 0.6);
    const open = price + (Math.random() - 0.5) * price * 0.01;
    const high = Math.max(price, open) + Math.random() * price * 0.01;
    const low = Math.min(price, open) - Math.random() * price * 0.01;

    bars.push({
      date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(price * 100) / 100,
      volume: Math.round(vol),
    });
  }

  if (bars.length > 0) {
    bars[bars.length - 1].close = currentPrice;
  }

  return bars;
}

const demoShapeBySymbol: Record<string, {
  price: number;
  trend: 'up' | 'down' | 'flat' | 'topping';
  volume: number;
  avgVolume: number;
  sectorBullish: boolean;
}> = {
  NVDA: { price: 142.5, trend: 'up', volume: 58_200_000, avgVolume: 24_500_000, sectorBullish: true },
  AAPL: { price: 232.8, trend: 'up', volume: 34_100_000, avgVolume: 32_000_000, sectorBullish: true },
  MSFT: { price: 428.6, trend: 'topping', volume: 18_500_000, avgVolume: 22_000_000, sectorBullish: true },
  AMZN: { price: 198.4, trend: 'up', volume: 42_000_000, avgVolume: 18_000_000, sectorBullish: true },
  META: { price: 585.2, trend: 'up', volume: 28_000_000, avgVolume: 12_000_000, sectorBullish: true },
  TSLA: { price: 248.9, trend: 'down', volume: 95_000_000, avgVolume: 88_000_000, sectorBullish: true },
  GOOGL: { price: 178.5, trend: 'up', volume: 19_500_000, avgVolume: 21_000_000, sectorBullish: true },
  JPM: { price: 225.3, trend: 'topping', volume: 8_500_000, avgVolume: 9_200_000, sectorBullish: true },
  XOM: { price: 108.2, trend: 'down', volume: 14_000_000, avgVolume: 15_000_000, sectorBullish: false },
  LLY: { price: 812.4, trend: 'up', volume: 5_200_000, avgVolume: 2_400_000, sectorBullish: true },
  UNH: { price: 542.1, trend: 'flat', volume: 3_100_000, avgVolume: 3_400_000, sectorBullish: true },
  CAT: { price: 372.8, trend: 'up', volume: 4_800_000, avgVolume: 2_200_000, sectorBullish: true },
  BA: { price: 178.3, trend: 'down', volume: 12_000_000, avgVolume: 11_000_000, sectorBullish: true },
  AVGO: { price: 185.6, trend: 'up', volume: 32_000_000, avgVolume: 14_000_000, sectorBullish: true },
  V: { price: 295.4, trend: 'flat', volume: 5_800_000, avgVolume: 6_200_000, sectorBullish: true },
  AMD: { price: 194.3, trend: 'up', volume: 62_400_000, avgVolume: 31_000_000, sectorBullish: true },
  NFLX: { price: 932.4, trend: 'up', volume: 6_200_000, avgVolume: 4_800_000, sectorBullish: true },
  CRM: { price: 324.5, trend: 'flat', volume: 7_100_000, avgVolume: 6_300_000, sectorBullish: true },
  COST: { price: 894.2, trend: 'up', volume: 2_400_000, avgVolume: 1_900_000, sectorBullish: true },
  HD: { price: 401.6, trend: 'topping', volume: 4_200_000, avgVolume: 3_900_000, sectorBullish: true },
};

const benchmarkBars = generateBars(520, 'up', 200, 50_000_000, 45_000_000);

export const demoStocks: EvaluatedStock[] = TRACKED_SYMBOLS.map((meta) => {
  const shape = demoShapeBySymbol[meta.symbol];
  const bars = generateBars(shape.price, shape.trend, 200, shape.volume, shape.avgVolume);
  return evaluateStock(
    meta.symbol,
    meta.name,
    meta.sector,
    meta.industry,
    bars,
    benchmarkBars,
    shape.sectorBullish,
    true,
    'fallback',
  );
});

export const demoMarket: MarketOverview = {
  sp500Change: 0.82,
  nasdaqChange: 1.24,
  sp500Price: 520.12,
  nasdaqPrice: 446.35,
  sp500Symbol: 'SPY',
  nasdaqSymbol: 'QQQ',
  benchmarkState: 'fallback',
  benchmarkLastUpdated: new Date().toISOString(),
  marketTrend: 'bullish',
  lastUpdated: new Date().toLocaleString('sv-SE'),
  dataSource: 'fallback',
};

export function getByRecommendation(rec: WSPRecommendation): EvaluatedStock[] {
  return demoStocks.filter((s) => s.finalRecommendation === rec);
}

export function getBuySignals(): EvaluatedStock[] {
  return demoStocks.filter((s) => s.finalRecommendation === 'KÖP').sort((a, b) => b.score - a.score);
}

export function getSellSignals(): EvaluatedStock[] {
  return demoStocks.filter((s) => s.finalRecommendation === 'SÄLJ' || s.finalRecommendation === 'UNDVIK');
}
