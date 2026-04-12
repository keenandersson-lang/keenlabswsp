import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { WSPPattern, WSPRecommendation } from '@/lib/wsp-types';

export interface TopSetupRow {
  symbol: string;
  sector: string;
  industry: string;
  pattern: string;
  recommendation: string;
  score: number;
  vol_ratio: number | null;
  payload?: Record<string, unknown>;
}

export interface TopSetupDisplay {
  symbol: string;
  sector: string;
  industry: string;
  pattern: WSPPattern;
  recommendation: WSPRecommendation;
  score: number;
  maxScore: number;
  price: number | null;
  changePercent: number;
  volumeMultiple: number | null;
}

function toPattern(v: string | null): WSPPattern {
  switch ((v ?? '').toLowerCase()) {
    case 'climbing': return 'climbing';
    case 'tired': return 'tired';
    case 'downhill': return 'downhill';
    default: return 'base';
  }
}

function toRecommendation(v: string | null): WSPRecommendation {
  if (v === 'KÖP' || v === 'BEVAKA' || v === 'SÄLJ' || v === 'UNDVIK') return v;
  return 'BEVAKA';
}

export function useTopSetups() {
  return useQuery<TopSetupDisplay[]>({
    queryKey: ['top-wsp-setups'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_top_wsp_setups');
      if (error) throw error;
      const rows = (data ?? []) as TopSetupRow[];
      return rows.map((r) => {
        const payload = r.payload ?? {};
        return {
          symbol: r.symbol,
          sector: r.sector ?? 'Unknown',
          industry: r.industry ?? 'Unknown',
          pattern: toPattern(r.pattern),
          recommendation: toRecommendation(r.recommendation),
          score: r.score ?? 0,
          maxScore: 5,
          price: typeof (payload as any).close === 'number' ? (payload as any).close : null,
          changePercent: typeof (payload as any).pct_change_1d === 'number' ? (payload as any).pct_change_1d : 0,
          volumeMultiple: r.vol_ratio ?? null,
        };
      });
    },
    staleTime: 5 * 60_000,
  });
}
