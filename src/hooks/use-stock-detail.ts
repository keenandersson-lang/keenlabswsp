import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { StockDetailApiResponse, StockDetailPayload } from '@/lib/chart-types';
import type { Bar } from '@/lib/wsp-types';
import { aggregateBarsWeekly } from '@/lib/charting';

async function fetchStockDetailFromDb(symbol: string): Promise<StockDetailApiResponse> {
  // 1. Get symbol metadata
  const { data: symRow, error: symErr } = await supabase
    .from('symbols')
    .select('symbol, name, canonical_sector, canonical_industry, exchange, asset_class, support_level, eligible_for_full_wsp')
    .eq('symbol', symbol)
    .eq('is_active', true)
    .maybeSingle();

  if (symErr) {
    return { ok: false, data: null, error: { code: 'DB_ERROR', message: symErr.message } };
  }
  if (!symRow) {
    return { ok: false, data: null, error: { code: 'SYMBOL_NOT_ACTIVE', message: `Symbol ${symbol} is not active.` } };
  }

  // 2. Get chart data (2 years) and benchmark data in parallel
  const [chartRes, benchmarkRes] = await Promise.all([
    supabase.rpc('get_chart_data', { p_symbol: symbol, p_days: 756 }),
    supabase.rpc('get_chart_data', { p_symbol: 'SPY', p_days: 756 }),
  ]);

  if (chartRes.error) {
    return { ok: false, data: null, error: { code: 'CHART_ERROR', message: chartRes.error.message } };
  }

  const rawBars: any[] = chartRes.data ?? [];
  const rawBenchmark: any[] = benchmarkRes.data ?? [];

  if (rawBars.length === 0) {
    return { ok: false, data: null, error: { code: 'NO_PRICE_DATA', message: `No price data for ${symbol}. Run backfill first.` } };
  }

  const toBars = (rows: any[]): Bar[] =>
    rows.map((r) => ({
      date: r.date,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));

  const barsDaily = toBars(rawBars);
  const benchmarkDaily = toBars(rawBenchmark);
  const barsWeekly = aggregateBarsWeekly(barsDaily);
  const benchmarkWeekly = aggregateBarsWeekly(benchmarkDaily);

  const isFullWsp = symRow.eligible_for_full_wsp === true;
  const wspSupport = isFullWsp ? 'full' : 'limited';

  const payload: StockDetailPayload = {
    symbol: symRow.symbol,
    name: symRow.name ?? symbol,
    sector: symRow.canonical_sector ?? 'Unknown',
    industry: symRow.canonical_industry ?? 'Unknown',
    exchange: symRow.exchange ?? undefined,
    assetClass: (symRow.asset_class === 'metals' || symRow.asset_class === 'commodity') ? symRow.asset_class as any : 'equity',
    supportsFullWsp: isFullWsp,
    wspSupport,
    supportLevel: symRow.support_level,
    isApprovedLiveCohort: isFullWsp,
    metadataCompleteness: (symRow.canonical_sector && symRow.canonical_industry && symRow.canonical_sector !== 'Unknown' && symRow.canonical_industry !== 'Unknown') ? 'complete' : 'partial',
    barsDaily,
    barsWeekly,
    benchmarkDaily,
    benchmarkWeekly,
    fetchedAt: new Date().toISOString(),
  };

  return { ok: true, data: payload, error: null };
}

export function useStockDetail(symbol: string | undefined) {
  return useQuery({
    queryKey: ['stock-detail', symbol],
    queryFn: () => fetchStockDetailFromDb(symbol ?? ''),
    enabled: Boolean(symbol),
    staleTime: 60_000,
    retry: 1,
  });
}
