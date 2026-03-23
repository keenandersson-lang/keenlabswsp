/**
 * WSP Screener — Demo/Fallback Data
 * Generates realistic demo data using the strict 3-layer engine.
 * Clearly labeled as fallback — not live data.
 */

import type { EvaluatedStock, MarketOverview, Bar, WSPRecommendation } from './wsp-types';
import { evaluateStock } from './wsp-engine';
import { WSP_CONFIG } from './wsp-config';

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

  // Work backwards from current price
  for (let i = days; i >= 0; i--) {
    const noise = (Math.random() - 0.5) * price * 0.02;
    let drift = 0;

    if (trend === 'up') drift = price * 0.003;
    else if (trend === 'down') drift = -price * 0.004;
    else if (trend === 'topping') drift = i > days / 2 ? price * 0.003 : -price * 0.001;

    if (i > 0) {
      price = price - drift + noise; // reverse since we're going backwards
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

  // Fix the last bar to match currentPrice exactly
  if (bars.length > 0) {
    bars[bars.length - 1].close = currentPrice;
  }

  return bars;
}

// ─── Demo stock definitions ───
interface DemoStockDef {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  price: number;
  trend: 'up' | 'down' | 'flat' | 'topping';
  volume: number;
  avgVolume: number;
  sectorBullish: boolean;
}

const demoStockDefs: DemoStockDef[] = [
  { symbol: 'NVDA', name: 'NVIDIA Corp', sector: 'Technology', industry: 'Semiconductors', price: 142.50, trend: 'up', volume: 58_200_000, avgVolume: 24_500_000, sectorBullish: true },
  { symbol: 'AAPL', name: 'Apple Inc', sector: 'Technology', industry: 'Consumer Electronics', price: 232.80, trend: 'up', volume: 34_100_000, avgVolume: 32_000_000, sectorBullish: true },
  { symbol: 'MSFT', name: 'Microsoft Corp', sector: 'Technology', industry: 'Software', price: 428.60, trend: 'topping', volume: 18_500_000, avgVolume: 22_000_000, sectorBullish: true },
  { symbol: 'AMZN', name: 'Amazon.com Inc', sector: 'Consumer Discretionary', industry: 'Broadline Retail', price: 198.40, trend: 'up', volume: 42_000_000, avgVolume: 18_000_000, sectorBullish: true },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Communication Services', industry: 'Internet', price: 585.20, trend: 'up', volume: 28_000_000, avgVolume: 12_000_000, sectorBullish: true },
  { symbol: 'TSLA', name: 'Tesla Inc', sector: 'Consumer Discretionary', industry: 'Automobiles', price: 248.90, trend: 'down', volume: 95_000_000, avgVolume: 88_000_000, sectorBullish: true },
  { symbol: 'GOOGL', name: 'Alphabet Inc', sector: 'Communication Services', industry: 'Internet', price: 178.50, trend: 'up', volume: 19_500_000, avgVolume: 21_000_000, sectorBullish: true },
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financials', industry: 'Banks', price: 225.30, trend: 'topping', volume: 8_500_000, avgVolume: 9_200_000, sectorBullish: true },
  { symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy', industry: 'Integrated Oil', price: 108.20, trend: 'down', volume: 14_000_000, avgVolume: 15_000_000, sectorBullish: false },
  { symbol: 'LLY', name: 'Eli Lilly', sector: 'Healthcare', industry: 'Pharmaceuticals', price: 812.40, trend: 'up', volume: 5_200_000, avgVolume: 2_400_000, sectorBullish: true },
  { symbol: 'UNH', name: 'UnitedHealth', sector: 'Healthcare', industry: 'Health Care Providers', price: 542.10, trend: 'flat', volume: 3_100_000, avgVolume: 3_400_000, sectorBullish: true },
  { symbol: 'CAT', name: 'Caterpillar', sector: 'Industrials', industry: 'Machinery', price: 372.80, trend: 'up', volume: 4_800_000, avgVolume: 2_200_000, sectorBullish: true },
  { symbol: 'BA', name: 'Boeing Co', sector: 'Industrials', industry: 'Aerospace', price: 178.30, trend: 'down', volume: 12_000_000, avgVolume: 11_000_000, sectorBullish: true },
  { symbol: 'AVGO', name: 'Broadcom Inc', sector: 'Technology', industry: 'Semiconductors', price: 185.60, trend: 'up', volume: 32_000_000, avgVolume: 14_000_000, sectorBullish: true },
  { symbol: 'V', name: 'Visa Inc', sector: 'Financials', industry: 'Payment Services', price: 295.40, trend: 'flat', volume: 5_800_000, avgVolume: 6_200_000, sectorBullish: true },
];

// Generate benchmark bars (SPY-like)
const benchmarkBars = generateBars(520, 'up', 200, 50_000_000, 45_000_000);

// ─── Evaluate all demo stocks ───
export const demoStocks: EvaluatedStock[] = demoStockDefs.map(def => {
  const bars = generateBars(def.price, def.trend, 200, def.volume, def.avgVolume);
  return evaluateStock(
    def.symbol,
    def.name,
    def.sector,
    def.industry,
    bars,
    benchmarkBars,
    def.sectorBullish,
    true, // market favorable for demo
    'fallback',
  );
});

export const demoMarket: MarketOverview = {
  sp500Change: 0.82,
  nasdaqChange: 1.24,
  marketTrend: 'bullish',
  lastUpdated: new Date().toLocaleString('sv-SE'),
  dataSource: 'fallback',
};

// ─── Filter helpers ───
export function getByRecommendation(rec: WSPRecommendation): EvaluatedStock[] {
  return demoStocks.filter(s => s.recommendation === rec);
}

export function getBuySignals(): EvaluatedStock[] {
  return demoStocks.filter(s => s.recommendation === 'KÖP').sort((a, b) => b.score - a.score);
}

export function getSellSignals(): EvaluatedStock[] {
  return demoStocks.filter(s => s.recommendation === 'SÄLJ' || s.recommendation === 'UNDVIK');
}


