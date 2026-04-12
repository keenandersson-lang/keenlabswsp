import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface IndustryRankingRow {
  display_industry: string;
  sector: string;
  symbol_count: number;
  avg_wsp_score: number;
  breakout_count: number;
  valid_entry_count: number;
  buy_count: number;
  watch_count: number;
  rank_score: number;
  rank_position: number;
}

export function useIndustryRanking(leadingOnly = true, limit = 15) {
  return useQuery<IndustryRankingRow[]>({
    queryKey: ['industry-ranking', leadingOnly, limit],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_industry_ranking', {
        p_leading_only: leadingOnly,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as IndustryRankingRow[];
    },
    staleTime: 5 * 60_000,
  });
}
