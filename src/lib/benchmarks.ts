export interface BenchmarkMeta {
  symbol: string;
  label: string;
  name: string;
}

export const MARKET_BENCHMARKS: readonly [BenchmarkMeta, BenchmarkMeta] = [
  { symbol: 'SPY', label: 'S&P 500', name: 'SPDR S&P 500 ETF Trust' },
  { symbol: 'QQQ', label: 'Nasdaq 100', name: 'Invesco QQQ Trust' },
] as const;

export const SP500_BENCHMARK = MARKET_BENCHMARKS[0];
export const NASDAQ_BENCHMARK = MARKET_BENCHMARKS[1];

export const BENCHMARK_LOOKUP = Object.fromEntries(
  MARKET_BENCHMARKS.map((item) => [item.symbol, item]),
) as Record<string, BenchmarkMeta>;

export function isBenchmarkSymbol(symbol: string): boolean {
  return Object.prototype.hasOwnProperty.call(BENCHMARK_LOOKUP, symbol.toUpperCase());
}
