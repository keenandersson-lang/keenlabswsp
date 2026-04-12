import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useIndustryRanking, type IndustryRankingRow } from '@/hooks/use-industry-ranking';
import { useSectorRanking } from '@/hooks/use-sector-ranking';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Factory, TrendingUp, ChevronDown, ChevronRight } from 'lucide-react';

export default function Industries() {
  const [showAll, setShowAll] = useState(true);
  const [expandedIndustry, setExpandedIndustry] = useState<string | null>(null);
  const navigate = useNavigate();

  const { data: sectorRanking = [] } = useSectorRanking();
  const { data: industryRanking = [], isLoading } = useIndustryRanking(!showAll, showAll ? 120 : 70);

  // Fetch top equities for expanded industry
  const { data: industryEquities = [] } = useQuery({
    queryKey: ['industry-equities', expandedIndustry],
    enabled: expandedIndustry != null,
    queryFn: async () => {
      if (!expandedIndustry) return [];
      const { data, error } = await (supabase as any).rpc('get_equity_screener_rows', {
        p_page: 0,
        p_page_size: 10,
        p_industry: expandedIndustry,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        symbol: string;
        sector: string;
        industry: string;
        recommendation: string;
        wsp_score: number;
        payload: Record<string, unknown>;
      }>;
    },
    staleTime: 5 * 60_000,
  });

  const leadingSectors = sectorRanking.filter((s) => s.is_leading).map((s) => s.sector_name);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Factory className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4 max-w-5xl mx-auto pb-20 md:pb-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-bold text-foreground font-mono tracking-wider flex items-center gap-2">
            <Factory className="h-4 w-4 text-primary" />
            INDUSTRIÖVERSIKT
          </h1>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            Module 1 — Industriranking baserad på WSP-logik · Visar topp {Math.min(industryRanking.length, 70)} grupper
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className={`rounded border px-2.5 py-1 text-[10px] font-mono font-semibold transition-colors ${
              showAll
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {showAll ? 'Top 70+' : 'Ledande sektorer'}
          </button>
          <Link to="/" className="text-[10px] font-mono text-primary hover:underline">← Dashboard</Link>
        </div>
      </div>

      {/* Leading sectors context */}
      <div className="rounded border border-border bg-card px-3 py-2">
        <p className="text-[9px] font-mono text-muted-foreground mb-1">LEDANDE SEKTORER</p>
        <div className="flex flex-wrap gap-1.5">
          {leadingSectors.map((s) => (
            <span key={s} className="rounded border border-signal-buy/20 bg-signal-buy/5 px-2 py-0.5 text-[9px] font-mono text-signal-buy">
              {s}
            </span>
          ))}
          {leadingSectors.length === 0 && (
            <span className="text-[9px] font-mono text-muted-foreground">Inga ledande sektorer identifierade</span>
          )}
        </div>
      </div>

      {/* Industry ranking table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 text-left text-[10px] text-muted-foreground font-mono bg-muted/30">
              <th className="px-3 py-2">RANK</th>
              <th className="px-2 py-2">INDUSTRI</th>
              <th className="px-2 py-2">SEKTOR</th>
              <th className="px-2 py-2 text-center">AKTIER</th>
              <th className="px-2 py-2 text-center">SNITT SCORE</th>
              <th className="px-2 py-2 text-center">BREAKOUTS</th>
              <th className="px-2 py-2 text-center">GILTIGA LÄGEN</th>
              <th className="px-2 py-2 text-center">KÖP</th>
              <th className="px-2 py-2 text-center">BEVAKA</th>
              <th className="px-2 py-2">RANK SCORE</th>
            </tr>
          </thead>
          <tbody>
            {industryRanking.slice(0, 70).map((ind) => {
              const isExpanded = expandedIndustry === ind.display_industry;
              const isLeadingSector = leadingSectors.includes(ind.sector);
              return (
                <IndustryRow
                  key={`${ind.sector}-${ind.display_industry}`}
                  industry={ind}
                  isExpanded={isExpanded}
                  isLeadingSector={isLeadingSector}
                  equities={isExpanded ? industryEquities : []}
                  onToggle={() => setExpandedIndustry(isExpanded ? null : ind.display_industry)}
                  onNavigateScreener={() =>
                    navigate(`/screener?sector=${encodeURIComponent(ind.sector)}&industry=${encodeURIComponent(ind.display_industry)}`)
                  }
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IndustryRow({
  industry,
  isExpanded,
  isLeadingSector,
  equities,
  onToggle,
  onNavigateScreener,
}: {
  industry: IndustryRankingRow;
  isExpanded: boolean;
  isLeadingSector: boolean;
  equities: Array<{ symbol: string; recommendation: string; wsp_score: number; payload: Record<string, unknown> }>;
  onToggle: () => void;
  onNavigateScreener: () => void;
}) {
  return (
    <>
      <tr
        className={`border-b border-border/30 hover:bg-muted/20 cursor-pointer transition-colors ${isExpanded ? 'bg-primary/5' : ''}`}
        onClick={onToggle}
      >
        <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
          #{industry.rank_position}
        </td>
        <td className="px-2 py-2">
          <div className="flex items-center gap-1.5">
            {isExpanded ? <ChevronDown className="h-3 w-3 text-primary" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            <span className="font-mono text-xs font-bold text-foreground">{industry.display_industry}</span>
          </div>
        </td>
        <td className="px-2 py-2 text-[10px] font-mono text-muted-foreground">
          {industry.sector}
          {isLeadingSector && <span className="ml-1 text-signal-buy">★</span>}
        </td>
        <td className="px-2 py-2 text-center font-mono text-xs text-foreground">{industry.symbol_count}</td>
        <td className="px-2 py-2 text-center font-mono text-xs text-foreground">{industry.avg_wsp_score.toFixed(1)}/5</td>
        <td className="px-2 py-2 text-center">
          {industry.breakout_count > 0 ? (
            <span className="font-mono text-xs text-signal-buy font-bold">⚡ {industry.breakout_count}</span>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">0</span>
          )}
        </td>
        <td className="px-2 py-2 text-center font-mono text-xs text-foreground">{industry.valid_entry_count}</td>
        <td className="px-2 py-2 text-center font-mono text-xs text-signal-buy">{industry.buy_count}</td>
        <td className="px-2 py-2 text-center font-mono text-xs text-muted-foreground">{industry.watch_count}</td>
        <td className="px-2 py-2 font-mono text-xs text-foreground">{industry.rank_score.toFixed(0)}</td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={10} className="px-4 py-3 bg-muted/10">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-mono text-muted-foreground">
                Starkaste aktier i {industry.display_industry}
              </p>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onNavigateScreener(); }}
                className="text-[10px] font-mono text-primary hover:underline"
              >
                Öppna i screener →
              </button>
            </div>
            {equities.length === 0 ? (
              <p className="text-[10px] font-mono text-muted-foreground">Laddar...</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                {equities.map((eq) => {
                  const p = eq.payload ?? {};
                  const close = typeof (p as any).close === 'number' ? (p as any).close : null;
                  const pct = typeof (p as any).pct_change_1d === 'number' ? (p as any).pct_change_1d : 0;
                  return (
                    <Link
                      key={eq.symbol}
                      to={`/stock/${eq.symbol}`}
                      className="rounded border border-border bg-background px-2 py-1.5 hover:border-primary/30 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-bold text-foreground">{eq.symbol}</span>
                        <span className={`text-[8px] font-mono font-semibold rounded px-1 ${
                          eq.recommendation === 'KÖP' ? 'bg-signal-buy/15 text-signal-buy' :
                          eq.recommendation === 'BEVAKA' ? 'bg-accent/15 text-accent' :
                          'bg-signal-sell/15 text-signal-sell'
                        }`}>{eq.recommendation}</span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[9px] font-mono text-muted-foreground">
                          {close != null ? `$${close.toFixed(0)}` : '—'}
                        </span>
                        <span className={`text-[9px] font-mono ${pct >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                          {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="text-[8px] font-mono text-muted-foreground mt-0.5">Score {eq.wsp_score}/5</div>
                    </Link>
                  );
                })}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
