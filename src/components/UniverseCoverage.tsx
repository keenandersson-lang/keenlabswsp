import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ShieldCheck, Expand, Globe } from 'lucide-react';
import { Link } from 'react-router-dom';

interface TierStats {
  total: number;
  with_indicators?: number;
  enriched_last_7d?: number;
}

interface CoverageData {
  core: TierStats;
  expanded: TierStats;
  benchmark: TierStats;
}

export function UniverseCoverage() {
  const { data, isLoading } = useQuery<CoverageData>({
    queryKey: ['universe-coverage-stats'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_universe_coverage_stats');
      if (error) throw error;
      return data as CoverageData;
    },
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  if (isLoading || !data) {
    return (
      <div className="rounded-md border border-border bg-card px-3 py-2.5 animate-pulse">
        <div className="h-4 w-48 bg-muted rounded" />
        <div className="mt-2 h-16 bg-muted rounded" />
      </div>
    );
  }

  const coreIndicatorPct = data.core.total > 0
    ? Math.round(((data.core.with_indicators ?? 0) / data.core.total) * 100)
    : 0;
  const expandedIndicatorPct = data.expanded.total > 0
    ? Math.round(((data.expanded.with_indicators ?? 0) / data.expanded.total) * 100)
    : 0;

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-[10px] font-bold font-mono tracking-wider text-foreground">UNIVERSE COVERAGE</h3>
        </div>
        <Link to="/screener" className="text-[10px] font-mono text-primary hover:underline">
          Öppna screener →
        </Link>
      </div>

      <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* Core */}
        <div className="rounded border border-primary/20 bg-primary/5 p-2.5">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-mono font-bold text-foreground">Core Universe</span>
          </div>
          <p className="mt-1.5 text-lg font-mono font-bold text-foreground leading-none">
            {data.core.total.toLocaleString()}
          </p>
          <p className="mt-0.5 text-[9px] font-mono text-muted-foreground">
            11 GICS-sektorer · Dagliga uppdateringar
          </p>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground">
              <span>Indikator-täckning</span>
              <span className="text-foreground">{coreIndicatorPct}%</span>
            </div>
            <div className="mt-0.5 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${coreIndicatorPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Expanded */}
        <div className="rounded border border-border bg-background p-2.5">
          <div className="flex items-center gap-1.5">
            <Expand className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-mono font-bold text-foreground">Expanded Universe</span>
          </div>
          <p className="mt-1.5 text-lg font-mono font-bold text-foreground leading-none">
            {data.expanded.total.toLocaleString()}
          </p>
          <p className="mt-0.5 text-[9px] font-mono text-muted-foreground">
            Bredare US equity-scan · Växande täckning
          </p>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground">
              <span>Indikator-täckning</span>
              <span className="text-foreground">{expandedIndicatorPct}%</span>
            </div>
            <div className="mt-0.5 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-muted-foreground/40 transition-all"
                style={{ width: `${expandedIndicatorPct}%` }}
              />
            </div>
          </div>
          {(data.expanded.enriched_last_7d ?? 0) > 0 && (
            <p className="mt-1.5 text-[9px] font-mono text-signal-buy">
              +{data.expanded.enriched_last_7d?.toLocaleString()} berikade senaste 7d
            </p>
          )}
        </div>

        {/* Benchmark */}
        <div className="rounded border border-border bg-background p-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono font-bold text-foreground">Benchmarks</span>
          </div>
          <p className="mt-1.5 text-lg font-mono font-bold text-foreground leading-none">
            {data.benchmark.total}
          </p>
          <p className="mt-0.5 text-[9px] font-mono text-muted-foreground">
            SPY · QQQ · Sektor-ETF:er
          </p>
          <div className="mt-2 text-[9px] font-mono text-muted-foreground">
            <span className="text-foreground">{(data.core.total + data.expanded.total + data.benchmark.total).toLocaleString()}</span> totalt aktiva symboler
          </div>
        </div>
      </div>
    </div>
  );
}
