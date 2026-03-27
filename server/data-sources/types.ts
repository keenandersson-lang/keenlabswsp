/**
 * Data Source Types — abstraction for multi-source market data
 */

export interface OHLCV {
  date: string;      // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DataSource {
  name: string;
  maxLookbackYears: number;
  supportsFullVolume: boolean;
  fetchBars(symbol: string, startDate: string, endDate: string): Promise<OHLCV[]>;
  fetchMultiBars(symbols: string[], startDate: string, endDate: string): Promise<Record<string, OHLCV[]>>;
}

export interface DataSourceStatus {
  activeName: string;
  supportsFullVolume: boolean;
  feedType: string;
  warning: string | null;
}
