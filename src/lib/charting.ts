import type { Bar } from './wsp-types';
import type { ChartTimeframe } from './chart-types';
import { normalizeBarsChronologically } from './wsp-indicators';

const DAY_RANGES: Record<ChartTimeframe, number> = {
  '1D': 1,
  '1W': 5,
  '1M': 21,
  '3M': 63,
  '6M': 126,
  '1Y': 252,
  '2Y': 504,
};

export function aggregateBarsWeekly(dailyBars: Bar[]): Bar[] {
  const sorted = normalizeBarsChronologically(dailyBars).bars;
  if (sorted.length === 0) return [];

  const weeks: Bar[] = [];
  let currentWeek: { key: string; bars: Bar[] } | null = null;

  for (const bar of sorted) {
    const d = new Date(`${bar.date}T00:00:00Z`);
    const weekStart = new Date(d);
    const weekday = (d.getUTCDay() + 6) % 7;
    weekStart.setUTCDate(d.getUTCDate() - weekday);
    const key = weekStart.toISOString().slice(0, 10);

    if (!currentWeek || currentWeek.key !== key) {
      if (currentWeek) weeks.push(combineWeekBars(currentWeek.bars));
      currentWeek = { key, bars: [bar] };
    } else {
      currentWeek.bars.push(bar);
    }
  }

  if (currentWeek) weeks.push(combineWeekBars(currentWeek.bars));
  return weeks;
}

function combineWeekBars(weekBars: Bar[]): Bar {
  const first = weekBars[0];
  const last = weekBars[weekBars.length - 1];
  return {
    date: last.date,
    open: first.open,
    high: Math.max(...weekBars.map((bar) => bar.high)),
    low: Math.min(...weekBars.map((bar) => bar.low)),
    close: last.close,
    volume: weekBars.reduce((sum, bar) => sum + bar.volume, 0),
  };
}

export function barsForTimeframe(
  timeframe: ChartTimeframe,
  dailyBars: Bar[],
  weeklyBars: Bar[],
): { bars: Bar[]; cadence: 'daily' | 'weekly' } {
  const range = DAY_RANGES[timeframe];
  const useWeekly = timeframe === '1Y' || timeframe === '2Y';
  const source = useWeekly ? weeklyBars : dailyBars;
  const barCount = useWeekly ? Math.ceil(range / 5) : range;

  return {
    bars: source.slice(-barCount),
    cadence: useWeekly ? 'weekly' : 'daily',
  };
}

export function clampAsOfIndex(index: number, barsLength: number): number {
  if (barsLength <= 0) return 0;
  if (!Number.isFinite(index)) return barsLength - 1;
  return Math.max(0, Math.min(barsLength - 1, Math.floor(index)));
}
