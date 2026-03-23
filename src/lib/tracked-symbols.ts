export interface TrackedSymbolMeta {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
}

export const TRACKED_SYMBOLS: TrackedSymbolMeta[] = [
  { symbol: 'NVDA', name: 'NVIDIA Corp', sector: 'Technology', industry: 'Semiconductors' },
  { symbol: 'AAPL', name: 'Apple Inc', sector: 'Technology', industry: 'Consumer Electronics' },
  { symbol: 'MSFT', name: 'Microsoft Corp', sector: 'Technology', industry: 'Software' },
  { symbol: 'AMZN', name: 'Amazon.com Inc', sector: 'Consumer Discretionary', industry: 'Broadline Retail' },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Communication Services', industry: 'Internet' },
  { symbol: 'TSLA', name: 'Tesla Inc', sector: 'Consumer Discretionary', industry: 'Automobiles' },
  { symbol: 'GOOGL', name: 'Alphabet Inc', sector: 'Communication Services', industry: 'Internet' },
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financials', industry: 'Banks' },
  { symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy', industry: 'Integrated Oil' },
  { symbol: 'LLY', name: 'Eli Lilly', sector: 'Healthcare', industry: 'Pharmaceuticals' },
  { symbol: 'UNH', name: 'UnitedHealth', sector: 'Healthcare', industry: 'Health Care Providers' },
  { symbol: 'CAT', name: 'Caterpillar', sector: 'Industrials', industry: 'Machinery' },
  { symbol: 'BA', name: 'Boeing Co', sector: 'Industrials', industry: 'Aerospace' },
  { symbol: 'AVGO', name: 'Broadcom Inc', sector: 'Technology', industry: 'Semiconductors' },
  { symbol: 'V', name: 'Visa Inc', sector: 'Financials', industry: 'Payment Services' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', industry: 'Semiconductors' },
  { symbol: 'NFLX', name: 'Netflix Inc', sector: 'Communication Services', industry: 'Entertainment' },
  { symbol: 'CRM', name: 'Salesforce Inc', sector: 'Technology', industry: 'Software' },
  { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer Discretionary', industry: 'Discount Stores' },
  { symbol: 'HD', name: 'Home Depot', sector: 'Consumer Discretionary', industry: 'Home Improvement Retail' },
];

export const TRACKED_SYMBOL_LOOKUP = Object.fromEntries(
  TRACKED_SYMBOLS.map((item) => [item.symbol, item]),
) as Record<string, TrackedSymbolMeta>;
