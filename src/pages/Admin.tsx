import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, AlertTriangle, CheckCircle2, XCircle, Clock, Database, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

const ONE_TIME_QUERY_OPTIONS = {
  refetchOnWindowFocus: false,
  refetchInterval: false,
  refetchOnReconnect: false,
  refetchOnMount: false,
  staleTime: Infinity,
} as const;

type PipelineRunConsole = {
  id: number;
  run_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  trigger_source: string;
  requested_by: string | null;
  current_step: string | null;
  error_summary: string | null;
};

type SnapshotRow = {
  snapshot_id: number;
  run_id: number;
  status: string;
  is_canonical: boolean;
  completed_at: string | null;
  symbols_expected: number;
  symbols_completed: number;
  sectors_expected: number;
  sectors_completed: number;
  industries_expected: number;
  industries_completed: number;
};

type PublishHistory = {
  run_id: number;
  snapshot_id: number;
  published_at: string;
  is_current_canonical: boolean;
};

type CanonicalCoverage = {
  snapshot_id: number | null;
  coverage: Record<string, number>;
  ui_count_lineage: Record<string, unknown>;
};

type CanonicalPriceBarRange = {
  snapshot_id: number | null;
  active_symbol_count: number;
  symbols_with_prices: number;
  earliest_price_date: string | null;
  latest_price_date: string | null;
};

const TIER1_CORE = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'];

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  if (['published', 'canonical', 'completed', 'validated'].includes(normalized)) {
    return <Badge className="bg-signal-success/15 text-signal-success border-signal-success/30">{value}</Badge>;
  }
  if (['failed'].includes(normalized)) {
    return <Badge className="bg-signal-danger/15 text-signal-danger border-signal-danger/30">{value}</Badge>;
  }
  return <Badge variant="secondary">{value}</Badge>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-semibold mt-1">{value}</div>
    </div>
  );
}

export default function Admin() {
  const queryClient = useQueryClient();

  const { data: pipelineRuns = [] } = useQuery<PipelineRunConsole[]>({
    queryKey: ['admin-canonical-pipeline-runs'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_equity_pipeline_console_runs', { p_limit: 20 });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 10_000,
  });

  const { data: snapshots = [] } = useQuery<SnapshotRow[]>({
    queryKey: ['admin-canonical-snapshots'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_equity_snapshots', { p_limit: 20 });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 10_000,
  });

  const latestSnapshotId = snapshots[0]?.snapshot_id ?? null;

  const { data: validation } = useQuery({
    queryKey: ['admin-canonical-validation', latestSnapshotId],
    enabled: latestSnapshotId !== null,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('validate_equity_snapshot', { p_snapshot_id: latestSnapshotId });
      if (error) throw error;
      return data as Record<string, any>;
    },
    refetchInterval: 15_000,
  });

  const { data: publishHistory = [] } = useQuery<PublishHistory[]>({
    queryKey: ['admin-canonical-publish-history'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_equity_publish_history', { p_limit: 2 });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 10_000,
  });

  const { data: coverage } = useQuery<CanonicalCoverage>({
    queryKey: ['admin-canonical-coverage'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_equity_snapshot_coverage_report');
      if (error) throw error;
      return (data ?? { snapshot_id: null, coverage: {}, ui_count_lineage: {} }) as CanonicalCoverage;
    },
    refetchInterval: 15_000,
  });

  const { data: dbRange } = useQuery<CanonicalPriceBarRange>({
    queryKey: ['admin-canonical-price-range'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_equity_canonical_price_bar_range');
      if (error) throw error;
      return data as CanonicalPriceBarRange;
    },
    refetchInterval: 15_000,
  });

  const { data: tier1Missing = [] } = useQuery({
    queryKey: ['admin-tier1-metadata-gaps'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('symbols')
        .select('symbol, sector, industry, canonical_sector, canonical_industry, support_level, classification_status')
        .in('symbol', TIER1_CORE)
        .or('canonical_sector.is.null,canonical_industry.is.null,canonical_sector.eq.Unknown,canonical_industry.eq.Unknown');
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    ...ONE_TIME_QUERY_OPTIONS,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-canonical-pipeline-runs'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-canonical-snapshots'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-canonical-validation'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-canonical-publish-history'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-canonical-coverage'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-canonical-price-range'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-tier1-metadata-gaps'] }),
    ]);
    toast.success('Canonical pipeline console refreshed');
  };

  const latestCanonical = useMemo(() => snapshots.find((s) => s.is_canonical) ?? null, [snapshots]);

  return (
    <main className="container mx-auto p-4 space-y-4">
      <section className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Canonical Pipeline Operations Console</h1>
          <p className="text-sm text-muted-foreground">
            Legacy provider/backfill controls are retired from this surface. This page is read-only canonical operations state.
          </p>
        </div>
        <Button onClick={refresh} variant="outline" size="sm" className="font-mono text-xs">
          <RefreshCw className="h-3 w-3 mr-1" /> Refresh
        </Button>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono">A. Pipeline Runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pipelineRuns.map((run) => (
            <div key={run.id} className="border rounded p-2 text-xs font-mono grid grid-cols-1 md:grid-cols-7 gap-2">
              <Stat label="Run" value={`#${run.id}`} />
              <Stat label="Run Type" value={run.run_type} />
              <Stat label="Current Step" value={run.current_step ?? '—'} />
              <Stat label="Started" value={new Date(run.started_at).toLocaleString()} />
              <Stat label="Finished" value={run.finished_at ? new Date(run.finished_at).toLocaleString() : '—'} />
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Status</div>
                <StatusBadge value={run.status} />
              </div>
              <Stat label="Error" value={run.error_summary ?? '—'} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono">B. Snapshots</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {snapshots.slice(0, 5).map((s) => (
            <div key={s.snapshot_id} className="border rounded p-2 text-xs font-mono grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="Snapshot" value={`#${s.snapshot_id}`} />
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Status</div>
                <StatusBadge value={s.status} />
                {s.is_canonical && <Badge className="ml-2" variant="outline">canonical</Badge>}
              </div>
              <Stat label="Completed" value={s.completed_at ? new Date(s.completed_at).toLocaleString() : '—'} />
              <Stat label="Symbols" value={`${s.symbols_completed}/${s.symbols_expected}`} />
              <Stat label="Sectors" value={`${s.sectors_completed}/${s.sectors_expected}`} />
              <Stat label="Industries" value={`${s.industries_completed}/${s.industries_expected}`} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono">C. Validation</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
          <Stat label="Parity" value={validation?.passed ? 'passed' : 'failed'} />
          <Stat label="Drift Count" value={String(validation?.drift_count ?? 0)} />
          <Stat label="Critical Errors" value={String((validation?.critical_errors ?? []).length)} />
          <Stat label="Warning Errors" value={String((validation?.warning_errors ?? []).length)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono">D. Publish</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs font-mono">
          <Stat label="Current Canonical Snapshot" value={latestCanonical ? `#${latestCanonical.snapshot_id}` : '—'} />
          <Stat label="Previous Published Snapshot" value={publishHistory[1] ? `#${publishHistory[1].snapshot_id}` : '—'} />
          <Stat label="Publish Timestamp" value={publishHistory[0]?.published_at ? new Date(publishHistory[0].published_at).toLocaleString() : '—'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono">E. Coverage</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
          <Stat label="Active Universe" value={String(coverage?.coverage?.active_scannable_equities_in_universe ?? '—')} />
          <Stat label="Mapped/Enriched Universe" value={String(coverage?.coverage?.equities_materialized_into_screener_rows_materialized ?? '—')} />
          <Stat label="Price Bars" value={String(coverage?.coverage?.equities_with_daily_bars ?? '—')} />
          <Stat label="Indicators" value={String(coverage?.coverage?.equities_with_indicators ?? '—')} />
          <Stat label="Pattern State" value={String(coverage?.coverage?.equities_with_pattern_states ?? '—')} />
          <Stat label="WSP Evaluation" value={String(coverage?.coverage?.equities_with_wsp_evaluations ?? '—')} />
          <Stat label="Screener Exposure" value={String(coverage?.coverage?.equities_exposed_to_screener_table ?? '—')} />
          <Stat label="Dashboard Exposure" value={String(coverage?.coverage?.equities_exposed_to_dashboard ?? '—')} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2"><Database className="h-4 w-4" /> Canonical Price-Bar Lineage</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs font-mono">
          <Stat label="Snapshot" value={dbRange?.snapshot_id ? `#${dbRange.snapshot_id}` : '—'} />
          <Stat label="Active Symbols" value={String(dbRange?.active_symbol_count ?? '—')} />
          <Stat label="Symbols w/ Bars" value={String(dbRange?.symbols_with_prices ?? '—')} />
          <Stat label="Earliest" value={dbRange?.earliest_price_date ?? '—'} />
          <Stat label="Latest" value={dbRange?.latest_price_date ?? '—'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2"><Shield className="h-4 w-4" /> Tier-1 Metadata Guardrail</CardTitle>
        </CardHeader>
        <CardContent className="text-xs font-mono">
          {tier1Missing.length === 0 ? (
            <p className="text-signal-success flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Core Tier-1 equities have canonical sector/industry metadata.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-signal-danger flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> Missing canonical metadata detected for core names:</p>
              {tier1Missing.map((row: any) => (
                <div key={row.symbol} className="border rounded p-2">
                  {row.symbol} · sector={row.canonical_sector ?? row.sector ?? 'null'} · industry={row.canonical_industry ?? row.industry ?? 'null'}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!pipelineRuns.length && (
        <div className="text-xs text-muted-foreground font-mono flex items-center gap-1"><Clock className="h-3 w-3" /> No pipeline runs yet.</div>
      )}

      {validation && !validation.passed && (
        <div className="text-xs text-signal-danger font-mono flex items-center gap-1"><XCircle className="h-3 w-3" /> Validation failed for latest snapshot. Publishing should remain blocked.</div>
      )}
    </main>
  );
}
