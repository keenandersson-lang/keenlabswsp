import { FinnhubProvider, type ProviderFetchResult } from './finnhub-provider';
import { AlpacaProvider, type LatestQuoteMap } from './alpaca-provider';

export type MarketDataProviderName = 'alpaca' | 'finnhub';

export interface MarketDataProvider {
  readonly providerName: MarketDataProviderName;
  fetchDailyHistory(symbol: string): Promise<ProviderFetchResult>;
  fetchDailyHistoryBatch?(symbols: string[]): Promise<Record<string, ProviderFetchResult>>;
  fetchLatestQuotes(symbols: string[]): Promise<LatestQuoteMap>;
}

interface ProviderSelection {
  provider: MarketDataProvider;
  envVarPresent: boolean;
  providerName: MarketDataProviderName;
}

function resolveProviderName(): MarketDataProviderName {
  const candidate = process.env.MARKET_DATA_PROVIDER?.trim().toLowerCase();
  if (candidate === 'finnhub') return 'finnhub';
  return 'alpaca';
}

export function createMarketDataProvider(): ProviderSelection {
  const providerName = resolveProviderName();

  if (providerName === 'finnhub') {
    const apiKey = process.env.FINNHUB_API_KEY?.trim();
    return {
      provider: new FinnhubProvider(apiKey ?? ''),
      envVarPresent: Boolean(apiKey),
      providerName,
    };
  }

  const apiKeyId = process.env.ALPACA_API_KEY_ID?.trim();
  const apiSecret = process.env.ALPACA_API_SECRET_KEY?.trim();
  return {
    provider: new AlpacaProvider({
      apiKeyId: apiKeyId ?? '',
      apiSecret: apiSecret ?? '',
      feed: 'iex',
    }),
    envVarPresent: Boolean(apiKeyId && apiSecret),
    providerName,
  };
}
