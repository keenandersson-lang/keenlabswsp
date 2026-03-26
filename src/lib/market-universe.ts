export type AssetClass = 'equity' | 'metals' | 'commodity';
export type WspSupportLevel = 'full' | 'limited';

export interface MarketUniverseStock {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  exchange: 'NASDAQ' | 'NYSE' | 'ARCA';
  assetClass: AssetClass;
  wspSupport: WspSupportLevel;
}

export const MAJOR_SECTORS = [
  'Technology',
  'Communication Services',
  'Consumer Discretionary',
  'Consumer Staples',
  'Financials',
  'Healthcare',
  'Industrials',
  'Energy',
  'Materials',
  'Real Estate',
  'Utilities',
] as const;

export const EQUITY_MARKET_UNIVERSE: MarketUniverseStock[] = [
  { symbol: 'AAPL', name: 'Apple Inc', sector: 'Technology', industry: 'Consumer Electronics', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'MSFT', name: 'Microsoft Corp', sector: 'Technology', industry: 'Software', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'NVDA', name: 'NVIDIA Corp', sector: 'Technology', industry: 'Semiconductors', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'AVGO', name: 'Broadcom Inc', sector: 'Technology', industry: 'Semiconductors', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', industry: 'Semiconductors', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'ORCL', name: 'Oracle Corp', sector: 'Technology', industry: 'Software', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'CRM', name: 'Salesforce Inc', sector: 'Technology', industry: 'Software', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },

  { symbol: 'GOOGL', name: 'Alphabet Inc', sector: 'Communication Services', industry: 'Internet Content & Information', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Communication Services', industry: 'Internet Content & Information', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'NFLX', name: 'Netflix Inc', sector: 'Communication Services', industry: 'Entertainment', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'DIS', name: 'Walt Disney Co', sector: 'Communication Services', industry: 'Entertainment', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'TMUS', name: 'T-Mobile US', sector: 'Communication Services', industry: 'Telecom Services', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'VZ', name: 'Verizon Communications', sector: 'Communication Services', industry: 'Telecom Services', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },

  { symbol: 'AMZN', name: 'Amazon.com Inc', sector: 'Consumer Discretionary', industry: 'Broadline Retail', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'TSLA', name: 'Tesla Inc', sector: 'Consumer Discretionary', industry: 'Automobiles', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'HD', name: 'Home Depot', sector: 'Consumer Discretionary', industry: 'Home Improvement Retail', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'MCD', name: 'McDonald\'s Corp', sector: 'Consumer Discretionary', industry: 'Restaurants', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'NKE', name: 'Nike Inc', sector: 'Consumer Discretionary', industry: 'Apparel Retail', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'BKNG', name: 'Booking Holdings', sector: 'Consumer Discretionary', industry: 'Travel Services', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },

  { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer Staples', industry: 'Discount Stores', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'WMT', name: 'Walmart Inc', sector: 'Consumer Staples', industry: 'Discount Stores', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'PG', name: 'Procter & Gamble', sector: 'Consumer Staples', industry: 'Household & Personal Products', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'KO', name: 'Coca-Cola Co', sector: 'Consumer Staples', industry: 'Beverages', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'PEP', name: 'PepsiCo Inc', sector: 'Consumer Staples', industry: 'Beverages', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'PM', name: 'Philip Morris International', sector: 'Consumer Staples', industry: 'Tobacco', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },

  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financials', industry: 'Banks', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'BAC', name: 'Bank of America', sector: 'Financials', industry: 'Banks', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'WFC', name: 'Wells Fargo', sector: 'Financials', industry: 'Banks', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'V', name: 'Visa Inc', sector: 'Financials', industry: 'Payment Services', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'MA', name: 'Mastercard Inc', sector: 'Financials', industry: 'Payment Services', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway B', sector: 'Financials', industry: 'Multi-line Insurance', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'limited' },

  { symbol: 'LLY', name: 'Eli Lilly', sector: 'Healthcare', industry: 'Pharmaceuticals', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare', industry: 'Health Care Providers', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', industry: 'Drug Manufacturers', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'ABBV', name: 'AbbVie Inc', sector: 'Healthcare', industry: 'Drug Manufacturers', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'MRK', name: 'Merck & Co', sector: 'Healthcare', industry: 'Drug Manufacturers', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'ISRG', name: 'Intuitive Surgical', sector: 'Healthcare', industry: 'Medical Devices', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },

  { symbol: 'CAT', name: 'Caterpillar Inc', sector: 'Industrials', industry: 'Machinery', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'BA', name: 'Boeing Co', sector: 'Industrials', industry: 'Aerospace & Defense', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'GE', name: 'GE Aerospace', sector: 'Industrials', industry: 'Aerospace & Defense', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'HON', name: 'Honeywell International', sector: 'Industrials', industry: 'Conglomerates', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'UPS', name: 'United Parcel Service', sector: 'Industrials', industry: 'Integrated Freight & Logistics', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'DE', name: 'Deere & Co', sector: 'Industrials', industry: 'Machinery', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },

  { symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy', industry: 'Integrated Oil & Gas', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'CVX', name: 'Chevron Corp', sector: 'Energy', industry: 'Integrated Oil & Gas', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'COP', name: 'ConocoPhillips', sector: 'Energy', industry: 'Oil & Gas E&P', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'SLB', name: 'Schlumberger NV', sector: 'Energy', industry: 'Oil & Gas Equipment & Services', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'EOG', name: 'EOG Resources', sector: 'Energy', industry: 'Oil & Gas E&P', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },

  { symbol: 'LIN', name: 'Linde plc', sector: 'Materials', industry: 'Specialty Chemicals', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'APD', name: 'Air Products & Chemicals', sector: 'Materials', industry: 'Specialty Chemicals', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'ECL', name: 'Ecolab Inc', sector: 'Materials', industry: 'Specialty Chemicals', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'NUE', name: 'Nucor Corp', sector: 'Materials', industry: 'Steel', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'DD', name: 'DuPont de Nemours', sector: 'Materials', industry: 'Chemicals', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },

  { symbol: 'PLD', name: 'Prologis Inc', sector: 'Real Estate', industry: 'REIT - Industrial', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'AMT', name: 'American Tower', sector: 'Real Estate', industry: 'REIT - Specialty', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'EQIX', name: 'Equinix Inc', sector: 'Real Estate', industry: 'REIT - Specialty', exchange: 'NASDAQ', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'O', name: 'Realty Income Corp', sector: 'Real Estate', industry: 'REIT - Retail', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },

  { symbol: 'NEE', name: 'NextEra Energy', sector: 'Utilities', industry: 'Utilities - Regulated Electric', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'SO', name: 'Southern Company', sector: 'Utilities', industry: 'Utilities - Regulated Electric', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'DUK', name: 'Duke Energy', sector: 'Utilities', industry: 'Utilities - Regulated Electric', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
  { symbol: 'SRE', name: 'Sempra', sector: 'Utilities', industry: 'Utilities - Diversified', exchange: 'NYSE', assetClass: 'equity', wspSupport: 'full' },
];

export const METALS_MARKET_UNIVERSE: MarketUniverseStock[] = [
  { symbol: 'GLD', name: 'SPDR Gold Trust', sector: 'Metals & Mining', industry: 'Gold', exchange: 'ARCA', assetClass: 'metals', wspSupport: 'limited' },
  { symbol: 'SLV', name: 'iShares Silver Trust', sector: 'Metals & Mining', industry: 'Silver', exchange: 'ARCA', assetClass: 'metals', wspSupport: 'limited' },
  { symbol: 'COPX', name: 'Global X Copper Miners', sector: 'Metals & Mining', industry: 'Copper Miners', exchange: 'ARCA', assetClass: 'metals', wspSupport: 'limited' },
  { symbol: 'GDX', name: 'VanEck Gold Miners ETF', sector: 'Metals & Mining', industry: 'Gold Miners', exchange: 'ARCA', assetClass: 'metals', wspSupport: 'limited' },
  { symbol: 'NEM', name: 'Newmont Corp', sector: 'Metals & Mining', industry: 'Gold Miners', exchange: 'NYSE', assetClass: 'metals', wspSupport: 'limited' },
  { symbol: 'FCX', name: 'Freeport-McMoRan', sector: 'Metals & Mining', industry: 'Copper', exchange: 'NYSE', assetClass: 'metals', wspSupport: 'limited' },
  { symbol: 'PPLT', name: 'abrdn Platinum ETF', sector: 'Metals & Mining', industry: 'Platinum', exchange: 'ARCA', assetClass: 'metals', wspSupport: 'limited' },
];

export const MARKET_UNIVERSE: MarketUniverseStock[] = [...EQUITY_MARKET_UNIVERSE, ...METALS_MARKET_UNIVERSE];

export const SECTOR_ETF_MAP: Record<string, string[]> = {
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
};

export interface IndustryGroup {
  industry: string;
  stocks: MarketUniverseStock[];
}

export interface SectorGroup {
  sector: string;
  industries: IndustryGroup[];
  stocks: MarketUniverseStock[];
}

export function buildSectorIndustryTree(universe: MarketUniverseStock[]): SectorGroup[] {
  const sectorMap = new Map<string, Map<string, MarketUniverseStock[]>>();
  for (const stock of universe) {
    const industryMap = sectorMap.get(stock.sector) ?? new Map<string, MarketUniverseStock[]>();
    const bucket = industryMap.get(stock.industry) ?? [];
    bucket.push(stock);
    industryMap.set(stock.industry, bucket);
    sectorMap.set(stock.sector, industryMap);
  }

  return [...sectorMap.entries()]
    .map(([sector, industries]) => ({
      sector,
      industries: [...industries.entries()]
        .map(([industry, stocks]) => ({ industry, stocks: [...stocks].sort((a, b) => a.symbol.localeCompare(b.symbol)) }))
        .sort((a, b) => b.stocks.length - a.stocks.length),
      stocks: [...industries.values()].flat(),
    }))
    .sort((a, b) => b.stocks.length - a.stocks.length);
}

export const MARKET_UNIVERSE_LOOKUP = Object.fromEntries(MARKET_UNIVERSE.map((item) => [item.symbol, item]));
