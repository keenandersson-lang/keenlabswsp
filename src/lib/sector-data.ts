export interface IndustryGroup {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

export interface SectorData {
  name: string;
  chartSymbol: string;
  industries: IndustryGroup[];
}

// Generate a cache-busting StockCharts chart URL
function chartUrl(symbol: string, timeframe: string = 'eod'): string {
  const ts = Date.now();
  return `https://stockcharts.com/c-sc/sc?s=${symbol}&i=p60722513999&w=460&r=${ts}`;
}

export function getSectorChartUrl(symbol: string): string {
  return chartUrl(symbol);
}

export const sectorData: SectorData[] = [
  {
    name: 'Communication Services',
    chartSymbol: '$DJUSAV',
    industries: [
      { symbol: '$DJUSAV', name: 'Media Agencies', price: 307.16, change: 8.12, changePercent: 2.72 },
      { symbol: '$DJUSBC', name: 'Broadcasting & Entertainment', price: 1183.08, change: 1.82, changePercent: 0.15 },
      { symbol: '$DJUSFC', name: 'Fixed Line Telecom', price: 167.40, change: 0.60, changePercent: 0.36 },
      { symbol: '$DJUSNS', name: 'Internet', price: 7049.76, change: 186.32, changePercent: 2.71 },
      { symbol: '$DJUSPB', name: 'Publishing', price: 845.18, change: 19.03, changePercent: 2.30 },
      { symbol: '$DJUSWC', name: 'Mobile Telecom', price: 432.22, change: 3.68, changePercent: 0.86 },
    ],
  },
  {
    name: 'Technology',
    chartSymbol: '$DJUSAI',
    industries: [
      { symbol: '$DJUSAI', name: 'Electronic Equipment', price: 2306.14, change: 55.82, changePercent: 2.48 },
      { symbol: '$DJUSCR', name: 'Computer Hardware', price: 13675.33, change: 203.99, changePercent: 1.51 },
      { symbol: '$DJUSCT', name: 'Telecom Equipment', price: 3016.36, change: 17.83, changePercent: 0.59 },
      { symbol: '$DJUSDV', name: 'Computer Services', price: 248.62, change: 0.52, changePercent: 0.21 },
      { symbol: '$DJUSEC', name: 'Electrical Components', price: 1241.69, change: 0.92, changePercent: 0.07 },
      { symbol: '$DJUSSC', name: 'Semiconductors', price: 30158.69, change: 245.98, changePercent: 0.82 },
      { symbol: '$DJUSSW', name: 'Software', price: 6263.97, change: -53.42, changePercent: -0.85 },
      { symbol: '$DWCREE', name: 'Renewable Energy Equip.', price: 453.75, change: 16.09, changePercent: 3.68 },
    ],
  },
  {
    name: 'Consumer Discretionary',
    chartSymbol: '$DJUSAT',
    industries: [
      { symbol: '$DJUSAT', name: 'Auto Parts', price: 432.01, change: -4.17, changePercent: -0.96 },
      { symbol: '$DJUSAU', name: 'Automobiles', price: 1430.70, change: 1.07, changePercent: 0.07 },
      { symbol: '$DJUSCF', name: 'Clothing & Accessories', price: 352.61, change: 9.10, changePercent: 2.65 },
      { symbol: '$DJUSHB', name: 'Home Construction', price: 2694.80, change: 8.48, changePercent: 0.32 },
      { symbol: '$DJUSRB', name: 'Broadline Retailers', price: 4706.60, change: 64.25, changePercent: 1.38 },
      { symbol: '$DJUSRS', name: 'Specialty Retailers', price: 3658.70, change: 38.97, changePercent: 1.08 },
      { symbol: '$DJUSRU', name: 'Restaurants & Bars', price: 2997.70, change: 16.73, changePercent: 0.56 },
    ],
  },
  {
    name: 'Health Care',
    chartSymbol: '$DJUSAM',
    industries: [
      { symbol: '$DJUSAM', name: 'Medical Equipment', price: 2852.59, change: 10.78, changePercent: 0.38 },
      { symbol: '$DJUSBT', name: 'Biotechnology', price: 3149.50, change: -4.73, changePercent: -0.15 },
      { symbol: '$DJUSHP', name: 'Health Care Providers', price: 2466.75, change: -9.25, changePercent: -0.37 },
      { symbol: '$DJUSMS', name: 'Medical Supplies', price: 2080.91, change: 24.25, changePercent: 1.18 },
      { symbol: '$DJUSPR', name: 'Pharmaceuticals', price: 1136.17, change: -11.12, changePercent: -0.97 },
    ],
  },
  {
    name: 'Financial',
    chartSymbol: '$DJUSAG',
    industries: [
      { symbol: '$DJUSAG', name: 'Asset Managers', price: 362.23, change: -2.53, changePercent: -0.69 },
      { symbol: '$DJUSBK', name: 'Banks', price: 829.84, change: 7.54, changePercent: 0.92 },
      { symbol: '$DJUSIL', name: 'Life Insurance', price: 1293.53, change: 14.78, changePercent: 1.16 },
      { symbol: '$DJUSIP', name: 'Property & Casualty', price: 1976.19, change: 17.13, changePercent: 0.87 },
      { symbol: '$DJUSSB', name: 'Investment Services', price: 2902.96, change: 13.64, changePercent: 0.47 },
      { symbol: '$DJUSSF', name: 'Consumer Finance', price: 741.24, change: 6.71, changePercent: 0.91 },
    ],
  },
  {
    name: 'Industrial',
    chartSymbol: '$DJUSAF',
    industries: [
      { symbol: '$DJUSAF', name: 'Delivery Services', price: 1492.13, change: 23.42, changePercent: 1.59 },
      { symbol: '$DJUSAR', name: 'Airlines', price: 260.59, change: 4.13, changePercent: 1.61 },
      { symbol: '$DJUSAS', name: 'Aerospace', price: 3616.52, change: 29.06, changePercent: 0.81 },
      { symbol: '$DJUSDN', name: 'Defense', price: 913.47, change: -11.36, changePercent: -1.23 },
      { symbol: '$DJUSFE', name: 'Industrial Machinery', price: 1495.89, change: 5.24, changePercent: 0.35 },
      { symbol: '$DJUSRR', name: 'Railroad', price: 3973.34, change: 45.46, changePercent: 1.16 },
      { symbol: '$DJUSTK', name: 'Trucking', price: 2024.67, change: 62.75, changePercent: 3.20 },
    ],
  },
  {
    name: 'Energy',
    chartSymbol: '$DJUSOI',
    industries: [
      { symbol: '$DJUSOI', name: 'Oil Equipment & Services', price: 371.84, change: -1.48, changePercent: -0.40 },
      { symbol: '$DJUSOL', name: 'Integrated Oil & Gas', price: 937.89, change: -15.80, changePercent: -1.66 },
      { symbol: '$DJUSOS', name: 'Exploration & Production', price: 1204.72, change: 2.49, changePercent: 0.21 },
      { symbol: '$DJUSPL', name: 'Pipelines', price: 1234.13, change: 13.97, changePercent: 1.14 },
    ],
  },
  {
    name: 'Materials',
    chartSymbol: '$DJUSAL',
    industries: [
      { symbol: '$DJUSAL', name: 'Aluminum', price: 206.64, change: 2.73, changePercent: 1.34 },
      { symbol: '$DJUSCC', name: 'Commodity Chemicals', price: 774.64, change: 6.48, changePercent: 0.84 },
      { symbol: '$DJUSNF', name: 'Nonferrous Metals', price: 860.67, change: 23.68, changePercent: 2.83 },
      { symbol: '$DJUSPM', name: 'Gold Mining', price: 325.61, change: 0.56, changePercent: 0.17 },
      { symbol: '$DJUSST', name: 'Steel', price: 738.27, change: 0.50, changePercent: 0.07 },
    ],
  },
  {
    name: 'Consumer Staples',
    chartSymbol: '$DJUSCM',
    industries: [
      { symbol: '$DJUSCM', name: 'Personal Products', price: 421.60, change: 5.51, changePercent: 1.32 },
      { symbol: '$DJUSDB', name: 'Brewers', price: 509.00, change: 15.41, changePercent: 3.12 },
      { symbol: '$DJUSFD', name: 'Food Retailers', price: 1304.08, change: -1.91, changePercent: -0.15 },
      { symbol: '$DJUSFP', name: 'Food Products', price: 529.82, change: 1.42, changePercent: 0.27 },
      { symbol: '$DJUSSD', name: 'Soft Drinks', price: 1050.75, change: 11.08, changePercent: 1.07 },
      { symbol: '$DJUSTB', name: 'Tobacco', price: 1236.44, change: -2.67, changePercent: -0.22 },
    ],
  },
  {
    name: 'Real Estate',
    chartSymbol: '$DJUSDT',
    industries: [
      { symbol: '$DJUSDT', name: 'Diversified REITs', price: 62.23, change: 0.50, changePercent: 0.81 },
      { symbol: '$DJUSIO', name: 'Industrial & Office REITs', price: 116.17, change: 1.45, changePercent: 1.26 },
      { symbol: '$DJUSRL', name: 'Retail REITs', price: 111.52, change: 1.31, changePercent: 1.19 },
      { symbol: '$DJUSRN', name: 'Residential REITs', price: 215.23, change: -1.50, changePercent: -0.69 },
      { symbol: '$DJUSSR', name: 'Specialty REITs', price: 278.52, change: 2.48, changePercent: 0.90 },
    ],
  },
  {
    name: 'Utilities',
    chartSymbol: '$DJUSGU',
    industries: [
      { symbol: '$DJUSGU', name: 'Gas Distribution', price: 410.01, change: 3.23, changePercent: 0.79 },
      { symbol: '$DJUSMU', name: 'Multiutilities', price: 307.71, change: 0.50, changePercent: 0.16 },
      { symbol: '$DJUSVE', name: 'Conventional Electricity', price: 455.73, change: 2.50, changePercent: 0.55 },
      { symbol: '$DJUSWU', name: 'Water', price: 2704.03, change: -37.68, changePercent: -1.37 },
    ],
  },
];

export function getSectorAvgChange(sector: SectorData): number {
  const total = sector.industries.reduce((sum, i) => sum + i.changePercent, 0);
  return total / sector.industries.length;
}
