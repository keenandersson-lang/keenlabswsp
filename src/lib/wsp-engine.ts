export type WSPPattern = 'base' | 'climbing' | 'tired' | 'downhill';

export interface StockData {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume5d: number;
  ma50: number;
  ma50Slope: 'up' | 'flat' | 'down';
  ma150: number;
  mansfieldRS: number;
  mansfieldRSTrend: 'up' | 'flat' | 'down';
  pattern: WSPPattern;
  resistanceZone: number | null;
  supportZone: number | null;
  reactionLow: number | null;
  
  // Computed entry criteria
  breakoutConfirmed: boolean;
  aboveMA50: boolean;
  ma50SlopingUp: boolean;
  aboveMA150: boolean;
  volumeBreakout: boolean; // volume >= 2x avg
  mansfieldBullish: boolean;
  sectorBullish: boolean;
  
  // Signal
  isBuySignal: boolean;
  isSellSignal: boolean;
  entryScore: number; // 0-6 how many criteria met
}

export interface MarketOverview {
  sp500Change: number;
  nasdaqChange: number;
  marketTrend: 'bullish' | 'bearish' | 'neutral';
  lastUpdated: string;
}

export function evaluateStock(raw: Omit<StockData, 'breakoutConfirmed' | 'aboveMA50' | 'ma50SlopingUp' | 'aboveMA150' | 'volumeBreakout' | 'mansfieldBullish' | 'sectorBullish' | 'isBuySignal' | 'isSellSignal' | 'entryScore'>): StockData {
  const aboveMA50 = raw.price > raw.ma50;
  const ma50SlopingUp = raw.ma50Slope === 'up';
  const aboveMA150 = raw.price > raw.ma150;
  const volumeBreakout = raw.volume >= 2 * raw.avgVolume5d;
  const mansfieldBullish = raw.mansfieldRSTrend === 'up' || (raw.mansfieldRS > 0 && raw.mansfieldRSTrend !== 'down');
  const sectorBullish = true; // simplified for demo
  const breakoutConfirmed = raw.resistanceZone !== null && raw.price > raw.resistanceZone;

  const criteria = [breakoutConfirmed, aboveMA50, ma50SlopingUp, aboveMA150, volumeBreakout, mansfieldBullish];
  const entryScore = criteria.filter(Boolean).length;

  const isBuySignal = raw.pattern === 'climbing' && entryScore >= 5;
  const isSellSignal = raw.pattern === 'tired' || raw.pattern === 'downhill';

  return {
    ...raw,
    breakoutConfirmed,
    aboveMA50,
    ma50SlopingUp,
    aboveMA150,
    volumeBreakout,
    mansfieldBullish,
    sectorBullish,
    isBuySignal,
    isSellSignal,
    entryScore,
  };
}
