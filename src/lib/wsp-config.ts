/**
 * WSP Screener — Central Configuration
 * All tunable parameters for the Wall Street Protocol screener.
 */

export const WSP_CONFIG = {
  // Tracked symbols
  symbols: [
    'NVDA', 'AAPL', 'MSFT', 'AMZN', 'META', 'TSLA', 'GOOGL',
    'JPM', 'XOM', 'LLY', 'UNH', 'CAT', 'BA', 'AVGO', 'V',
    'AMD', 'NFLX', 'CRM', 'COST', 'HD',
  ],

  // Benchmark for Mansfield RS calculation
  benchmark: 'SPY',

  // Market regime symbols
  marketRegimeSymbols: ['SPY', 'QQQ'],

  // Sector → symbols mapping for sector trend detection
  sectorMap: {
    'Technology': ['XLK'],
    'Healthcare': ['XLV'],
    'Financials': ['XLF'],
    'Energy': ['XLE'],
    'Consumer Discretionary': ['XLY'],
    'Industrials': ['XLI'],
    'Communication Services': ['XLC'],
    'Consumer Staples': ['XLP'],
    'Materials': ['XLB'],
    'Real Estate': ['XLRE'],
    'Utilities': ['XLU'],
  } as Record<string, string[]>,

  // Symbol → sector mapping
  symbolSectorMap: {
    'NVDA': 'Technology', 'AAPL': 'Technology', 'MSFT': 'Technology', 'AVGO': 'Technology', 'AMD': 'Technology', 'CRM': 'Technology',
    'AMZN': 'Consumer Discretionary', 'TSLA': 'Consumer Discretionary', 'HD': 'Consumer Discretionary', 'COST': 'Consumer Discretionary',
    'META': 'Communication Services', 'GOOGL': 'Communication Services', 'NFLX': 'Communication Services',
    'JPM': 'Financials', 'V': 'Financials',
    'XOM': 'Energy',
    'LLY': 'Healthcare', 'UNH': 'Healthcare',
    'CAT': 'Industrials', 'BA': 'Industrials',
  } as Record<string, string>,

  // Refresh interval in milliseconds
  refreshInterval: 5 * 60 * 1000, // 5 minutes

  // Breakout detection
  breakout: {
    /** Minimum number of touches to define resistance zone */
    minTouches: 3,
    /** Tolerance % for grouping highs into a resistance zone */
    tolerancePercent: 1.5,
    /** Price must exceed resistance by this % to confirm breakout */
    breakoutThresholdPercent: 0.5,
    /** Maximum bars since breakout to still consider it fresh */
    maxBarsSinceBreakout: 10,
  },

  // Volume thresholds
  volume: {
    /** Breakout volume must be >= this multiple of 5-day avg */
    breakoutMultiple: 2.0,
    /** Number of bars for average volume calculation */
    avgPeriod: 5,
  },

  // Moving average periods
  movingAverages: {
    sma20: 20,
    sma50: 50,
    sma150: 150,
    sma200: 200,
  },

  // Mansfield RS
  mansfield: {
    /** Period for RS SMA smoothing */
    smaPeriod: 52,
    /** RS must be > 0 or transitioning from negative to positive */
    minValidRS: 0,
  },

  // Score weights (for ranking, NOT for gate decisions)
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
