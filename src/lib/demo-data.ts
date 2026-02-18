import { StockData, evaluateStock, WSPPattern, MarketOverview } from './wsp-engine';

const patterns: WSPPattern[] = ['base', 'climbing', 'tired', 'downhill'];
const sectors = ['Technology', 'Healthcare', 'Financials', 'Energy', 'Consumer Disc.', 'Industrials', 'Communications'];

const rawStocks: Array<Parameters<typeof evaluateStock>[0]> = [
  { ticker: 'NVDA', name: 'NVIDIA Corp', sector: 'Technology', price: 142.50, change: 5.80, changePercent: 4.24, volume: 58200000, avgVolume5d: 24500000, ma50: 128.30, ma50Slope: 'up', ma150: 115.60, mansfieldRS: 2.8, mansfieldRSTrend: 'up', pattern: 'climbing', resistanceZone: 135.00, supportZone: 118.00, reactionLow: 125.40 },
  { ticker: 'AAPL', name: 'Apple Inc', sector: 'Technology', price: 232.80, change: 1.20, changePercent: 0.52, volume: 34100000, avgVolume5d: 32000000, ma50: 228.50, ma50Slope: 'up', ma150: 218.30, mansfieldRS: 1.1, mansfieldRSTrend: 'up', pattern: 'climbing', resistanceZone: 230.00, supportZone: 215.00, reactionLow: 222.10 },
  { ticker: 'MSFT', name: 'Microsoft Corp', sector: 'Technology', price: 428.60, change: -2.40, changePercent: -0.56, volume: 18500000, avgVolume5d: 22000000, ma50: 430.20, ma50Slope: 'flat', ma150: 415.80, mansfieldRS: 0.3, mansfieldRSTrend: 'flat', pattern: 'tired', resistanceZone: 435.00, supportZone: 410.00, reactionLow: 415.60 },
  { ticker: 'AMZN', name: 'Amazon.com Inc', sector: 'Consumer Disc.', price: 198.40, change: 3.60, changePercent: 1.85, volume: 42000000, avgVolume5d: 18000000, ma50: 185.20, ma50Slope: 'up', ma150: 172.50, mansfieldRS: 2.1, mansfieldRSTrend: 'up', pattern: 'climbing', resistanceZone: 192.00, supportZone: 170.00, reactionLow: 180.30 },
  { ticker: 'META', name: 'Meta Platforms', sector: 'Communications', price: 585.20, change: 8.40, changePercent: 1.46, volume: 28000000, avgVolume5d: 12000000, ma50: 560.40, ma50Slope: 'up', ma150: 510.30, mansfieldRS: 3.2, mansfieldRSTrend: 'up', pattern: 'climbing', resistanceZone: 575.00, supportZone: 530.00, reactionLow: 548.60 },
  { ticker: 'TSLA', name: 'Tesla Inc', sector: 'Consumer Disc.', price: 248.90, change: -8.30, changePercent: -3.23, volume: 95000000, avgVolume5d: 88000000, ma50: 262.40, ma50Slope: 'down', ma150: 240.80, mansfieldRS: -0.5, mansfieldRSTrend: 'down', pattern: 'downhill', resistanceZone: 270.00, supportZone: 225.00, reactionLow: 230.50 },
  { ticker: 'GOOGL', name: 'Alphabet Inc', sector: 'Communications', price: 178.50, change: 0.80, changePercent: 0.45, volume: 19500000, avgVolume5d: 21000000, ma50: 175.30, ma50Slope: 'up', ma150: 162.70, mansfieldRS: 1.4, mansfieldRSTrend: 'up', pattern: 'climbing', resistanceZone: 176.00, supportZone: 158.00, reactionLow: 168.20 },
  { ticker: 'JPM', name: 'JPMorgan Chase', sector: 'Financials', price: 225.30, change: -1.10, changePercent: -0.49, volume: 8500000, avgVolume5d: 9200000, ma50: 222.10, ma50Slope: 'up', ma150: 208.50, mansfieldRS: 0.9, mansfieldRSTrend: 'flat', pattern: 'tired', resistanceZone: 228.00, supportZone: 210.00, reactionLow: 215.70 },
  { ticker: 'XOM', name: 'Exxon Mobil', sector: 'Energy', price: 108.20, change: -2.50, changePercent: -2.26, volume: 14000000, avgVolume5d: 15000000, ma50: 112.80, ma50Slope: 'down', ma150: 110.40, mansfieldRS: -1.2, mansfieldRSTrend: 'down', pattern: 'downhill', resistanceZone: 115.00, supportZone: 102.00, reactionLow: 104.30 },
  { ticker: 'LLY', name: 'Eli Lilly', sector: 'Healthcare', price: 812.40, change: 12.60, changePercent: 1.58, volume: 5200000, avgVolume5d: 2400000, ma50: 785.20, ma50Slope: 'up', ma150: 720.50, mansfieldRS: 3.8, mansfieldRSTrend: 'up', pattern: 'climbing', resistanceZone: 800.00, supportZone: 740.00, reactionLow: 765.80 },
  { ticker: 'UNH', name: 'UnitedHealth', sector: 'Healthcare', price: 542.10, change: -0.40, changePercent: -0.07, volume: 3100000, avgVolume5d: 3400000, ma50: 540.50, ma50Slope: 'flat', ma150: 528.20, mansfieldRS: 0.2, mansfieldRSTrend: 'flat', pattern: 'base', resistanceZone: 548.00, supportZone: 520.00, reactionLow: 530.10 },
  { ticker: 'CAT', name: 'Caterpillar', sector: 'Industrials', price: 372.80, change: 5.20, changePercent: 1.41, volume: 4800000, avgVolume5d: 2200000, ma50: 358.60, ma50Slope: 'up', ma150: 340.20, mansfieldRS: 1.9, mansfieldRSTrend: 'up', pattern: 'climbing', resistanceZone: 368.00, supportZone: 335.00, reactionLow: 350.40 },
  { ticker: 'BA', name: 'Boeing Co', sector: 'Industrials', price: 178.30, change: -3.20, changePercent: -1.76, volume: 12000000, avgVolume5d: 11000000, ma50: 185.40, ma50Slope: 'down', ma150: 195.20, mansfieldRS: -2.1, mansfieldRSTrend: 'down', pattern: 'downhill', resistanceZone: 192.00, supportZone: 168.00, reactionLow: 170.50 },
  { ticker: 'AVGO', name: 'Broadcom Inc', sector: 'Technology', price: 185.60, change: 4.80, changePercent: 2.66, volume: 32000000, avgVolume5d: 14000000, ma50: 170.30, ma50Slope: 'up', ma150: 152.80, mansfieldRS: 3.5, mansfieldRSTrend: 'up', pattern: 'climbing', resistanceZone: 178.00, supportZone: 148.00, reactionLow: 162.40 },
  { ticker: 'V', name: 'Visa Inc', sector: 'Financials', price: 295.40, change: 1.60, changePercent: 0.54, volume: 5800000, avgVolume5d: 6200000, ma50: 290.80, ma50Slope: 'up', ma150: 278.50, mansfieldRS: 1.0, mansfieldRSTrend: 'up', pattern: 'base', resistanceZone: 298.00, supportZone: 275.00, reactionLow: 282.30 },
];

export const demoStocks: StockData[] = rawStocks.map(evaluateStock);

export const demoMarket: MarketOverview = {
  sp500Change: 0.82,
  nasdaqChange: 1.24,
  marketTrend: 'bullish',
  lastUpdated: new Date().toLocaleString('sv-SE'),
};

export function getStocksByPattern(pattern: WSPPattern): StockData[] {
  return demoStocks.filter(s => s.pattern === pattern);
}

export function getBuySignals(): StockData[] {
  return demoStocks.filter(s => s.isBuySignal).sort((a, b) => b.entryScore - a.entryScore);
}

export function getSellSignals(): StockData[] {
  return demoStocks.filter(s => s.isSellSignal);
}
