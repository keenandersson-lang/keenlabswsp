/**
 * Alpaca Data Source — supports IEX (free) and SIP (paid, full volume)
 */
import type { DataSource, OHLCV } from './types';

const ALPACA_BASE_URL = 'https://data.alpaca.markets/v2';

interface AlpacaBar {
  t: string; o: number; h: number; l: number; c: number; v: number;
}

export class AlpacaDataSource implements DataSource {
  name = 'alpaca';
  maxLookbackYears = 7;

  get supportsFullVolume(): boolean {
    return this.feed === 'sip';
  }

  private get feed(): 'iex' | 'sip' {
    return process.env.ALPACA_USE_SIP === 'true' ? 'sip' : 'iex';
  }

  private get headers() {
    return {
      'Accept': 'application/json',
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY_ID ?? '',
      'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET_KEY ?? '',
    };
  }

  async fetchBars(symbol: string, startDate: string, endDate: string): Promise<OHLCV[]> {
    const multi = await this.fetchMultiBars([symbol], startDate, endDate);
    return multi[symbol] || [];
  }

  async fetchMultiBars(symbols: string[], startDate: string, endDate: string): Promise<Record<string, OHLCV[]>> {
    const results: Record<string, OHLCV[]> = {};
    let nextPageToken: string | null = null;

    do {
      const url = new URL(`${ALPACA_BASE_URL}/stocks/bars`);
      url.searchParams.set('symbols', symbols.join(','));
      url.searchParams.set('start', `${startDate}T00:00:00Z`);
      url.searchParams.set('end', `${endDate}T23:59:59Z`);
      url.searchParams.set('timeframe', '1Day');
      url.searchParams.set('adjustment', 'split');
      url.searchParams.set('feed', this.feed);
      url.searchParams.set('limit', '10000');
      url.searchParams.set('sort', 'asc');
      if (nextPageToken) url.searchParams.set('page_token', nextPageToken);

      const res = await fetch(url.toString(), { headers: this.headers });
      if (!res.ok) throw new Error(`Alpaca API error: ${res.status}`);
      const data = await res.json();

      for (const [sym, bars] of Object.entries(data.bars || {})) {
        if (!results[sym]) results[sym] = [];
        results[sym].push(...(bars as AlpacaBar[]).map(b => ({
          date: new Date(b.t).toISOString().slice(0, 10),
          open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
        })).filter(b => Number.isFinite(b.close) && Number.isFinite(b.volume)));
      }

      nextPageToken = data.next_page_token || null;
    } while (nextPageToken);

    return results;
  }
}
