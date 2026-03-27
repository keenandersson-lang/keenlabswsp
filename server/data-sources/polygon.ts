/**
 * Polygon.io Data Source — free tier: 5 calls/min, 2 years history
 * Covers ALL US exchanges = correct volume data
 */
import type { DataSource, OHLCV } from './types';

export class PolygonDataSource implements DataSource {
  name = 'polygon';
  maxLookbackYears = 2; // free tier
  supportsFullVolume = true;

  private get apiKey(): string {
    return process.env.POLYGON_API_KEY ?? '';
  }

  async fetchBars(symbol: string, startDate: string, endDate: string): Promise<OHLCV[]> {
    const results: OHLCV[] = [];
    let nextUrl: string | null =
      `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${startDate}/${endDate}?adjusted=true&sort=asc&limit=50000&apiKey=${this.apiKey}`;

    while (nextUrl) {
      const res = await fetch(nextUrl);
      if (!res.ok) {
        if (res.status === 429) {
          // Rate limited — wait and retry
          await delay(12000);
          continue;
        }
        throw new Error(`Polygon error: ${res.status}`);
      }
      const data = await res.json();

      if (data.results) {
        results.push(...data.results.map((r: any) => ({
          date: new Date(r.t).toISOString().slice(0, 10),
          open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
        })));
      }

      nextUrl = data.next_url
        ? `${data.next_url}&apiKey=${this.apiKey}`
        : null;
    }
    return results;
  }

  async fetchMultiBars(symbols: string[], startDate: string, endDate: string): Promise<Record<string, OHLCV[]>> {
    const results: Record<string, OHLCV[]> = {};
    for (const symbol of symbols) {
      try {
        results[symbol] = await this.fetchBars(symbol, startDate, endDate);
      } catch (err) {
        console.error(`Polygon fetch error for ${symbol}:`, err);
        results[symbol] = [];
      }
      // Rate limit: 5 calls/min on free tier
      await delay(12500);
    }
    return results;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
