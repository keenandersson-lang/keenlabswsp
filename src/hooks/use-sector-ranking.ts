import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { normalizeSectorName } from '@/lib/market-normalization';

export interface SectorRankingRow {
  sector_name: string;
  rank_position: number;
  is_leading: boolean;
  wsp_regime: string;
  pct_above_ma50: number;
  avg_wsp_score: number;
  avg_pct_today: number;
  symbol_count: number;
  wsp_setups: number;
  top_pattern: string;
}

export function useSectorRanking() {
  return useQuery<SectorRankingRow[]>({
    queryKey: ['sector-ranking'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_sector_ranking');
      if (error) throw error;
      return ((data ?? []) as SectorRankingRow[]).map((row) => ({
        ...row,
        sector_name: normalizeSectorName(row.sector_name),
      }));
    },
    staleTime: 5 * 60_000,
  });
}
