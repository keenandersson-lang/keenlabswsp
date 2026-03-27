/**
 * Combined data source — selects best available source automatically
 */
import type { DataSource, DataSourceStatus } from './types';
import { AlpacaDataSource } from './alpaca';
import { PolygonDataSource } from './polygon';

export function getBestDataSource(): DataSource {
  // Priority 1: Alpaca SIP (full volume, fast, multi-symbol)
  if (process.env.ALPACA_USE_SIP === 'true') {
    return new AlpacaDataSource();
  }
  // Priority 2: Polygon.io (full volume, rate-limited)
  if (process.env.POLYGON_API_KEY) {
    return new PolygonDataSource();
  }
  // Fallback: Alpaca IEX (limited volume ~2.5% market)
  console.warn('⚠️ Using Alpaca IEX feed — volume covers ~2.5% of market. WSP volume ratios may be inaccurate. Set POLYGON_API_KEY or ALPACA_USE_SIP=true for correct data.');
  return new AlpacaDataSource();
}

export function getDataSourceStatus(): DataSourceStatus {
  if (process.env.ALPACA_USE_SIP === 'true') {
    return {
      activeName: 'Alpaca SIP',
      supportsFullVolume: true,
      feedType: 'sip',
      warning: null,
    };
  }
  if (process.env.POLYGON_API_KEY) {
    return {
      activeName: 'Polygon.io',
      supportsFullVolume: true,
      feedType: 'polygon',
      warning: null,
    };
  }
  return {
    activeName: 'Alpaca IEX',
    supportsFullVolume: false,
    feedType: 'iex',
    warning: 'Volymsdata baseras på IEX-börsen (~2.5% av marknaden). WSP volymkriterier kan vara missvisande.',
  };
}
