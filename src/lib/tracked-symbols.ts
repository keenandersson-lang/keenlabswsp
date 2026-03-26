export type AssetClass = 'equity' | 'metals' | 'commodity';

export interface TrackedSymbolMeta {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  assetClass?: AssetClass;
}

export const TRACKED_SYMBOLS: TrackedSymbolMeta[] = [
  // ── Equities ──
  { symbol: 'NVDA', name: 'NVIDIA Corp', sector: 'Technology', industry: 'Semiconductors', assetClass: 'equity' },
  { symbol: 'AAPL', name: 'Apple Inc', sector: 'Technology', industry: 'Consumer Electronics', assetClass: 'equity' },
  { symbol: 'MSFT', name: 'Microsoft Corp', sector: 'Technology', industry: 'Software', assetClass: 'equity' },
  { symbol: 'AMZN', name: 'Amazon.com Inc', sector: 'Consumer Discretionary', industry: 'Broadline Retail', assetClass: 'equity' },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Communication Services', industry: 'Internet', assetClass: 'equity' },
  { symbol: 'TSLA', name: 'Tesla Inc', sector: 'Consumer Discretionary', industry: 'Automobiles', assetClass: 'equity' },
  { symbol: 'GOOGL', name: 'Alphabet Inc', sector: 'Communication Services', industry: 'Internet', assetClass: 'equity' },
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financials', industry: 'Banks', assetClass: 'equity' },
  { symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy', industry: 'Integrated Oil', assetClass: 'equity' },
  { symbol: 'LLY', name: 'Eli Lilly', sector: 'Healthcare', industry: 'Pharmaceuticals', assetClass: 'equity' },
  { symbol: 'UNH', name: 'UnitedHealth', sector: 'Healthcare', industry: 'Health Care Providers', assetClass: 'equity' },
  { symbol: 'CAT', name: 'Caterpillar', sector: 'Industrials', industry: 'Machinery', assetClass: 'equity' },
  { symbol: 'BA', name: 'Boeing Co', sector: 'Industrials', industry: 'Aerospace', assetClass: 'equity' },
  { symbol: 'AVGO', name: 'Broadcom Inc', sector: 'Technology', industry: 'Semiconductors', assetClass: 'equity' },
  { symbol: 'V', name: 'Visa Inc', sector: 'Financials', industry: 'Payment Services', assetClass: 'equity' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', industry: 'Semiconductors', assetClass: 'equity' },
  { symbol: 'NFLX', name: 'Netflix Inc', sector: 'Communication Services', industry: 'Entertainment', assetClass: 'equity' },
  { symbol: 'CRM', name: 'Salesforce Inc', sector: 'Technology', industry: 'Software', assetClass: 'equity' },
  { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer Discretionary', industry: 'Discount Stores', assetClass: 'equity' },
  { symbol: 'HD', name: 'Home Depot', sector: 'Consumer Discretionary', industry: 'Home Improvement Retail', assetClass: 'equity' },

  // ── Metals & Mining ──
  { symbol: 'GLD', name: 'SPDR Gold Trust', sector: 'Metals & Mining', industry: 'Gold', assetClass: 'metals' },
  { symbol: 'SLV', name: 'iShares Silver Trust', sector: 'Metals & Mining', industry: 'Silver', assetClass: 'metals' },
  { symbol: 'COPX', name: 'Global X Copper Miners', sector: 'Metals & Mining', industry: 'Copper', assetClass: 'metals' },
  { symbol: 'GDX', name: 'VanEck Gold Miners ETF', sector: 'Metals & Mining', industry: 'Gold Miners', assetClass: 'metals' },
  { symbol: 'NEM', name: 'Newmont Corp', sector: 'Metals & Mining', industry: 'Gold Miners', assetClass: 'metals' },
  { symbol: 'FCX', name: 'Freeport-McMoRan', sector: 'Metals & Mining', industry: 'Copper', assetClass: 'metals' },
  { symbol: 'PPLT', name: 'abrdn Platinum ETF', sector: 'Metals & Mining', industry: 'Platinum', assetClass: 'metals' },
];

export const TRACKED_SYMBOL_LOOKUP = Object.fromEntries(
  TRACKED_SYMBOLS.map((item) => [item.symbol, item]),
) as Record<string, TrackedSymbolMeta>;

export const EQUITY_SYMBOLS = TRACKED_SYMBOLS.filter(s => (s.assetClass ?? 'equity') === 'equity');
export const METALS_SYMBOLS = TRACKED_SYMBOLS.filter(s => s.assetClass === 'metals');
