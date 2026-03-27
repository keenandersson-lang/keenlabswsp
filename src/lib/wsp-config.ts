/**
 * WSP Screener — Central Configuration
 * All tunable parameters for the Wall Street Protocol screener.
 */

import { SECTOR_ETF_MAP } from './market-universe';
import { TRACKED_SYMBOLS, SCANNER_ELIGIBLE_SYMBOLS } from './tracked-symbols';

export const WSP_CONFIG = {
  /** All tracked symbols (for charting, detail views) */
  allSymbols: TRACKED_SYMBOLS.map((item) => item.symbol),
  /** Only scanner-eligible symbols (full WSP equities) */
  symbols: SCANNER_ELIGIBLE_SYMBOLS.map((item) => item.symbol),

  benchmark: 'SPY',
  marketRegimeSymbols: ['SPY', 'QQQ'],

  sectorMap: SECTOR_ETF_MAP,

  symbolSectorMap: Object.fromEntries(TRACKED_SYMBOLS.map((item) => [item.symbol, item.sector])) as Record<string, string>,

  refreshInterval: 5 * 60 * 1000,

  movingAverages: {
    sma20: 20,
    sma50: 50,
    sma150: 150,
    sma200: 200,
  },

  wsp: {
    resistanceTouchesMin: 3,
    resistanceTolerancePct: 0.01,
    breakoutMinCloseAboveResistancePct: 0.005,
    staleBreakoutBars: 8,
    volumeLookbackBars: 5,
    volumeMultipleMin: 2.0,
    mansfieldLookbackBars: 200,
    mansfieldTransitionLookbackBars: 3,
    mansfieldTrendLookbackBars: 5,
    smaSlopeLookbackBars: 5,
    breakoutClvMin: 0.6,
    falseBreakoutLookbackBars: 10,
    falseBreakoutMaxCount: 1,
    falseBreakoutConfirmBars: 2,
    resistanceLookbackBars: 100,
    resistancePivotWindow: 2,
  },

  scoreWeights: {
    breakoutConfirmed: 1,
    aboveMA50: 1,
    ma50SlopingUp: 1,
    aboveMA150: 1,
    volumeSurge: 1,
    mansfieldValid: 1,
    sectorAligned: 1,
    marketFavorable: 1,
    freshBreakout: 1,
  },
} as const;

export type WSPConfig = typeof WSP_CONFIG;
