import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { normalizeSectorName } from '@/lib/market-normalization';

export type BreakoutStatus = 'NONE' | 'APPROACHING' | 'FRESH_BREAKOUT' | 'AGING_BREAKOUT' | 'STALE_BREAKOUT' | 'FAILED_BREAKOUT';

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
  blockers: string[];
  breakout_status: BreakoutStatus;
}

export type ScreenerSignalFilter = 'breakout' | 'bullish' | 'bearish';

interface RawRow {
  symbol: string;
  sector: string | null;
  industry: string | null;
  pattern_state: string | null;
  recommendation: string | null;
  wsp_score: number | null;
  total_count?: number | null;
  payload: Record<string, unknown> | null;
  blockers: string[] | null;
  breakout_status: string | null;
}

function parseRow(r: RawRow): ScreenerRow {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  return {
    symbol: r.symbol,
    sector: normalizeSectorName(r.sector),
    industry: r.industry ?? '',
    pattern_state: r.pattern_state ?? 'base',
    recommendation: r.recommendation ?? 'BEVAKA',
    wsp_score: Math.max(0, Math.min(5, r.wsp_score ?? 0)),
    price: typeof p.close === 'number' ? p.close : null,
    changePercent: typeof p.pct_change_1d === 'number' ? p.pct_change_1d : 0,
    volumeRatio: typeof p.volume_ratio === 'number' ? p.volume_ratio : null,
    mansfieldRs: typeof p.mansfield_rs === 'number' ? p.mansfield_rs : null,
    blockers: Array.isArray(r.blockers) ? r.blockers : [],
    breakout_status: (r.breakout_status as BreakoutStatus) ?? 'NONE',
  };
}

interface ScreenerParams {
  page?: number;
  pageSize?: number;
  universeTier?: string | null;
  sector?: string | null;
  industry?: string | null;
  pattern?: string | null;
  signalFilter?: ScreenerSignalFilter | null;
}

export function useEquityScreener({
  page = 0,
  pageSize = 50,
  universeTier = null,
  sector = null,
  industry = null,
  pattern = null,
  signalFilter = null,
}: ScreenerParams) {
  return useQuery<{ rows: ScreenerRow[]; totalCount: number }>({
    queryKey: ['equity-screener', page, pageSize, universeTier, sector, industry, pattern, signalFilter],
    queryFn: async () => {
      const patternArg = pattern === 'Alla stadier' ? null : pattern;
      const rpcArgs: Record<string, unknown> = {
        p_page: page + 1, // RPC uses 1-based pages
        p_page_size: pageSize,
        p_universe_tier: universeTier,
        p_sector: sector,
        p_industry: industry,
        p_pattern: patternArg,
      };

      const [rowsResult, countResult] = await Promise.all([
        (supabase as any).rpc('get_equity_screener_rows', rpcArgs),
        (supabase as any).rpc('get_equity_screener_count', {
          p_universe_tier: universeTier,
          p_sector: sector,
          p_industry: industry,
          p_pattern: patternArg,
        }),
      ]);

      if (rowsResult.error) throw rowsResult.error;
      const rawRows = (rowsResult.data ?? []) as RawRow[];
      let parsed = rawRows.map(parseRow);

      // Client-side signal filtering (not supported by RPC)
      if (signalFilter === 'breakout') {
        parsed = parsed.filter((r) => r.recommendation === 'KÖP');
      } else if (signalFilter === 'bullish') {
        parsed = parsed.filter((r) => r.recommendation === 'BEVAKA' && r.pattern_state === 'climbing');
      } else if (signalFilter === 'bearish') {
        parsed = parsed.filter((r) => r.recommendation === 'SÄLJ' || r.recommendation === 'UNDVIK');
      }

      const totalCount = countResult.error ? rawRows.length : Number(countResult.data ?? rawRows.length);

      return {
        rows: parsed,
        totalCount,
      };
    },
    staleTime: 60_000,
  });
}
