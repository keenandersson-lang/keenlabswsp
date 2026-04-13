import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Globe, ShieldCheck, Expand, Database, BarChart3, Eye, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

interface DetailedCoverage {
  active_universe: number;
  equity_universe: number;
  canonically_mapped_sector: number;
  canonically_mapped_industry: number;
  price_history_ready: number;
  indicator_ready: number;
  wsp_evaluated: number;
  public_eligible: number;
  core_tier: number;
  expanded_tier: number;
  benchmark_tier: number;
  unmapped_industry_count: number;
}

export function UniverseCoverage() {
  const { data, isLoading } = useQuery<DetailedCoverage>({
    queryKey: ['universe-coverage-detailed'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_universe_coverage_detailed');
      if (error) throw error;
      return data as DetailedCoverage;
    },
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  if (isLoading || !data) {
    return (
      <div className="rounded-md border border-border bg-card px-3 py-2.5 animate-pulse">
        <div className="h-4 w-48 bg-muted rounded" />
        <div className="mt-2 h-24 bg-muted rounded" />
      </div>
    );
  }

  const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 0;

  const stages = [
    { label: 'Aktiv Universe', value: data.active_universe, icon: Globe, color: 'text-muted-foreground' },
    { label: 'Equity (ej ETF/benchmark)', value: data.equity_universe, icon: Database, color: 'text-muted-foreground' },
    { label: 'Kanonisk Sektor', value: data.canonically_mapped_sector, icon: ShieldCheck, color: 'text-primary', pctOf: data.equity_universe },
    { label: 'Kanonisk Industri', value: data.canonically_mapped_industry, icon: ShieldCheck, color: 'text-primary', pctOf: data.equity_universe },
    { label: 'Prishistorik', value: data.price_history_ready, icon: BarChart3, color: 'text-muted-foreground' },
    { label: 'Indikatorer', value: data.indicator_ready, icon: BarChart3, color: 'text-muted-foreground' },
    { label: 'WSP-utvärderad', value: data.wsp_evaluated, icon: BarChart3, color: 'text-muted-foreground' },
    { label: 'Publik Eligible', value: data.public_eligible, icon: Eye, color: 'text-signal-buy', pctOf: data.equity_universe },
  ];

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-[10px] font-bold font-mono tracking-wider text-foreground">UNIVERSE PIPELINE</h3>
        </div>
        <Link to="/screener" className="text-[10px] font-mono text-primary hover:underline">
          Screener →
        </Link>
      </div>

      {/* Pipeline funnel */}
      <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1.5">
        {stages.map((s) => (
          <div key={s.label} className="rounded border border-border bg-background p-2 text-center">
            <s.icon className={`h-3 w-3 mx-auto ${s.color}`} />
            <p className="mt-1 text-sm font-mono font-bold text-foreground leading-none">
              {s.value.toLocaleString()}
            </p>
            <p className="mt-0.5 text-[8px] font-mono text-muted-foreground leading-tight">
              {s.label}
            </p>
            {s.pctOf != null && s.pctOf > 0 && (
              <p className="text-[8px] font-mono text-primary">
                {pct(s.value, s.pctOf)}%
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Tier breakdown */}
      <div className="mt-2 flex items-center gap-4 text-[9px] font-mono text-muted-foreground">
        <span className="flex items-center gap-1">
          <ShieldCheck className="h-3 w-3 text-primary" />
          Core: <span className="text-foreground font-semibold">{data.core_tier.toLocaleString()}</span>
        </span>
        <span className="flex items-center gap-1">
          <Expand className="h-3 w-3" />
          Expanded: <span className="text-foreground font-semibold">{data.expanded_tier.toLocaleString()}</span>
        </span>
        <span>Benchmark: <span className="text-foreground font-semibold">{data.benchmark_tier}</span></span>
        {data.unmapped_industry_count > 0 && (
          <span className="flex items-center gap-1 text-signal-caution">
            <AlertTriangle className="h-3 w-3" />
            {data.unmapped_industry_count.toLocaleString()} ej klassificerade (dold från publik)
          </span>
        )}
      </div>
    </div>
  );
}
