/**
 * WSP Screener — Central Configuration
 * All tunable parameters for the Wall Street Protocol screener.
 */

export const WSP_CONFIG = {
  symbols: [
    'NVDA', 'AAPL', 'MSFT', 'AMZN', 'META', 'TSLA', 'GOOGL',
    'JPM', 'XOM', 'LLY', 'UNH', 'CAT', 'BA', 'AVGO', 'V',
    'AMD', 'NFLX', 'CRM', 'COST', 'HD',
    // Metals & Mining
    'GLD', 'SLV', 'COPX', 'GDX', 'NEM', 'FCX', 'PPLT',
  ],

  benchmark: 'SPY',
  marketRegimeSymbols: ['SPY', 'QQQ'],

  sectorMap: {
    Technology: ['XLK'],
    Healthcare: ['XLV'],
    Financials: ['XLF'],
    Energy: ['XLE'],
    'Consumer Discretionary': ['XLY'],
    Industrials: ['XLI'],
    'Communication Services': ['XLC'],
    'Consumer Staples': ['XLP'],
    Materials: ['XLB'],
    'Real Estate': ['XLRE'],
    Utilities: ['XLU'],
    'Metals & Mining': ['GDX'],
  } as Record<string, string[]>,

  symbolSectorMap: {
    NVDA: 'Technology', AAPL: 'Technology', MSFT: 'Technology', AVGO: 'Technology', AMD: 'Technology', CRM: 'Technology',
    AMZN: 'Consumer Discretionary', TSLA: 'Consumer Discretionary', HD: 'Consumer Discretionary', COST: 'Consumer Discretionary',
    META: 'Communication Services', GOOGL: 'Communication Services', NFLX: 'Communication Services',
    JPM: 'Financials', V: 'Financials',
    XOM: 'Energy',
    LLY: 'Healthcare', UNH: 'Healthcare',
    CAT: 'Industrials', BA: 'Industrials',
    GLD: 'Metals & Mining', SLV: 'Metals & Mining', COPX: 'Metals & Mining', GDX: 'Metals & Mining',
    NEM: 'Metals & Mining', FCX: 'Metals & Mining', PPLT: 'Metals & Mining',
  } as Record<string, string>,

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
