import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ScreenerRow {
  symbol: string;
  sector: string;
  industry: string;
  pattern_state: string;
  recommendation: string;
  wsp_score: number;
  price: number | null;
  changePercent: number;
  volumeRatio: number | null;
  mansfieldRs: number | null;
}

interface RawRow {
  symbol: string;
  sector: string | null;
  industry: string | null;
  pattern_state: string | null;
  recommendation: string | null;
  wsp_score: number | null;
  payload: Record<string, unknown> | null;
}

function parseRow(r: RawRow): ScreenerRow {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  return {
    symbol: r.symbol,
    sector: r.sector ?? 'Unknown',
    industry: r.industry ?? 'Unknown',
    pattern_state: r.pattern_state ?? 'base',
    recommendation: r.recommendation ?? 'BEVAKA',
    wsp_score: r.wsp_score ?? 0,
    price: typeof p.close === 'number' ? p.close : null,
    changePercent: typeof p.pct_change_1d === 'number' ? p.pct_change_1d : 0,
    volumeRatio: typeof p.volume_ratio === 'number' ? p.volume_ratio : null,
    mansfieldRs: typeof p.mansfield_rs === 'number' ? p.mansfield_rs : null,
  };
}

interface ScreenerParams {
  page?: number;
  pageSize?: number;
  universeTier?: string | null;
  sector?: string | null;
  industry?: string | null;
  pattern?: string | null;
}

export function useEquityScreener({
  page = 0,
  pageSize = 50,
  universeTier = null,
  sector = null,
  industry = null,
  pattern = null,
}: ScreenerParams) {
  return useQuery<ScreenerRow[]>({
    queryKey: ['equity-screener', page, pageSize, universeTier, sector, industry, pattern],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_equity_screener_rows', {
        p_page: page,
        p_page_size: pageSize,
        p_universe_tier: universeTier,
        p_sector: sector,
        p_industry: industry,
        p_pattern: pattern,
      });
      if (error) throw error;
      return ((data ?? []) as RawRow[]).map(parseRow);
    },
    staleTime: 60_000,
  });
}

export function useScreenerCount(params: Omit<ScreenerParams, 'page' | 'pageSize'>) {
  return useQuery<number>({
    queryKey: ['equity-screener-count', params.universeTier, params.sector, params.industry, params.pattern],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_equity_screener_count', {
        p_universe_tier: params.universeTier ?? null,
        p_sector: params.sector ?? null,
        p_industry: params.industry ?? null,
        p_pattern: params.pattern ?? null,
      });
      if (error) throw error;
      return typeof data === 'number' ? data : 0;
    },
    staleTime: 60_000,
  });
}
