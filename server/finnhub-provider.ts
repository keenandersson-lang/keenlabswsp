import { WSP_CONFIG } from '../src/lib/wsp-config';
import type { Bar } from '../src/lib/wsp-types';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const HISTORY_CALENDAR_DAYS = 550;

interface FinnhubCandleResponse {
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  s: 'ok' | 'no_data';
  t: number[];
  v: number[];
}

export interface ProviderFetchResult {
  bars: Bar[];
  stale: boolean;
}

export class FinnhubProvider {
  constructor(private readonly apiKey: string) {}

  async fetchDailyHistory(symbol: string): Promise<ProviderFetchResult> {
    const now = new Date();
    const from = new Date(now);
    from.setUTCDate(now.getUTCDate() - HISTORY_CALENDAR_DAYS);

    const response = await this.request<FinnhubCandleResponse>(
      `/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${Math.floor(from.getTime() / 1000)}&to=${Math.floor(now.getTime() / 1000)}`,
    );

    if (response.s !== 'ok') {
      throw new Error(`Finnhub returned ${response.s} for ${symbol}`);
    }

    const bars = normalizeFinnhubCandles(response);
    if (bars.length < WSP_CONFIG.movingAverages.sma200 + 20) {
      throw new Error(`Insufficient history for ${symbol}: ${bars.length} bars`);
    }

    const lastBarDate = bars[bars.length - 1]?.date;
    const stale = isDateStale(lastBarDate);

    return { bars, stale };
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${FINNHUB_BASE_URL}${path}${path.includes('?') ? '&' : '?'}token=${this.apiKey}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Finnhub HTTP ${response.status} for ${url}`);
    }

    return response.json() as Promise<T>;
  }
}

export function normalizeFinnhubCandles(payload: FinnhubCandleResponse): Bar[] {
  return payload.t.map((timestamp, index) => ({
    date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    open: payload.o[index],
    high: payload.h[index],
    low: payload.l[index],
    close: payload.c[index],
    volume: payload.v[index],
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
