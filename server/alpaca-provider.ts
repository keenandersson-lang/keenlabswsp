import { WSP_CONFIG } from '../src/lib/wsp-config';
import type { Bar } from '../src/lib/wsp-types';
import type { ProviderFetchResult } from './finnhub-provider';

const ALPACA_BASE_URL = 'https://data.alpaca.markets/v2';
const HISTORY_CALENDAR_DAYS = 550;

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface AlpacaBarsResponse {
  bars?: Record<string, AlpacaBar[]>;
}

interface AlpacaQuote {
  t?: string;
  ap?: number;
  bp?: number;
}

interface AlpacaLatestQuotesResponse {
  quotes?: Record<string, AlpacaQuote>;
}

export interface LatestQuote {
  symbol: string;
  price: number | null;
  asOf: string | null;
  stale: boolean;
}

export type LatestQuoteMap = Record<string, LatestQuote>;

interface AlpacaProviderConfig {
  apiKeyId: string;
  apiSecret: string;
  feed: 'iex';
}

export class AlpacaProvider {
  readonly providerName = 'alpaca' as const;

  constructor(private readonly config: AlpacaProviderConfig) {}

  async fetchDailyHistory(symbol: string): Promise<ProviderFetchResult> {
    const histories = await this.fetchDailyHistoryBatch([symbol]);
    const selected = histories[symbol];

    if (!selected) {
      throw new Error(`Alpaca returned no bars for ${symbol}`);
    }

    return selected;
  }

  async fetchLatestQuotes(symbols: string[]): Promise<LatestQuoteMap> {
    const dedupedSymbols = [...new Set(symbols.map((item) => item.trim().toUpperCase()).filter(Boolean))];
    if (dedupedSymbols.length === 0) return {};

    const query = new URLSearchParams({
      symbols: dedupedSymbols.join(','),
      feed: this.config.feed,
    });

    const payload = await this.request<AlpacaLatestQuotesResponse>(`/stocks/quotes/latest?${query.toString()}`);
    const mapped: LatestQuoteMap = Object.fromEntries(dedupedSymbols.map((symbol) => [symbol, {
      symbol,
      price: null as number | null,
      asOf: null as string | null,
      stale: true,
    }]));

    for (const [symbol, quote] of Object.entries(payload.quotes ?? {})) {
      const normalizedPrice = selectQuotePrice(quote);
      const asOf = quote.t ?? null;
      mapped[symbol] = {
        symbol,
        price: normalizedPrice,
        asOf,
        stale: isTimestampStale(asOf),
      };
    }

    return mapped;
  }

  async fetchDailyHistoryBatch(symbols: string[]): Promise<Record<string, ProviderFetchResult>> {
    const dedupedSymbols = [...new Set(symbols.map((item) => item.trim().toUpperCase()).filter(Boolean))];
    if (dedupedSymbols.length === 0) return {};

    const now = new Date();
    const from = new Date(now);
    from.setUTCDate(now.getUTCDate() - HISTORY_CALENDAR_DAYS);

    const query = new URLSearchParams({
      symbols: dedupedSymbols.join(','),
      timeframe: '1Day',
      start: from.toISOString(),
      end: now.toISOString(),
      adjustment: 'raw',
      sort: 'asc',
      feed: this.config.feed,
      limit: '10000',
    });

    const payload = await this.request<AlpacaBarsResponse>(`/stocks/bars?${query.toString()}`);
    const normalized = Object.fromEntries(
      Object.entries(payload.bars ?? {}).map(([symbol, bars]) => {
        const mappedBars = normalizeAlpacaBars(bars ?? []);
        if (mappedBars.length < WSP_CONFIG.movingAverages.sma200 + 20) {
          throw new Error(`Insufficient history for ${symbol}: ${mappedBars.length} bars`);
        }

        return [symbol, {
          bars: mappedBars,
          stale: isDateStale(mappedBars[mappedBars.length - 1]?.date),
        } satisfies ProviderFetchResult];
      }),
    ) as Record<string, ProviderFetchResult>;

    return normalized;
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${ALPACA_BASE_URL}${path}`, {
      headers: {
        'Accept': 'application/json',
        'APCA-API-KEY-ID': this.config.apiKeyId,
        'APCA-API-SECRET-KEY': this.config.apiSecret,
      },
    });

    if (!response.ok) {
      throw new Error(`Alpaca provider HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }
}

function selectQuotePrice(quote: AlpacaQuote): number | null {
  const ask = Number.isFinite(quote.ap) ? quote.ap! : null;
  const bid = Number.isFinite(quote.bp) ? quote.bp! : null;
  if (ask !== null && bid !== null) return Number(((ask + bid) / 2).toFixed(4));
  return ask ?? bid;
}

function normalizeAlpacaBars(payload: AlpacaBar[]): Bar[] {
  return payload.map((bar) => ({
    date: new Date(bar.t).toISOString().slice(0, 10),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  })).filter((bar) => Number.isFinite(bar.close) && Number.isFinite(bar.volume));
}

function isDateStale(dateString: string | undefined): boolean {
  if (!dateString) return true;

  const barDate = new Date(`${dateString}T00:00:00Z`);
  const now = new Date();
  const diffMs = now.getTime() - barDate.getTime();
  const diffDays = diffMs / (24 * 60 * 60 * 1000);
  const weekday = now.getUTCDay();
  const allowedLag = weekday === 0 || weekday === 1 ? 3.5 : 1.5;

  return diffDays > allowedLag;
}

function isTimestampStale(timestamp: string | null): boolean {
  if (!timestamp) return true;
  const asOf = new Date(timestamp).getTime();
  if (!Number.isFinite(asOf)) return true;
  return Date.now() - asOf > 10 * 60 * 1000;
}
