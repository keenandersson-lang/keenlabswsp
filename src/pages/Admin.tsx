import { useMemo, useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, AlertTriangle, CheckCircle2, XCircle, Clock, Database, Shield, Zap, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
  const [syncSecret, setSyncSecret] = useState('');
  const [enrichState, setEnrichState] = useState<{
    running: boolean;
    offset: number;
    totalEnriched: number;
    totalFailed: number;
    totalPromoted: number;
    remaining: number | null;
    logs: string[];
    done: boolean;
  }>({ running: false, offset: 0, totalEnriched: 0, totalFailed: 0, totalPromoted: 0, remaining: null, logs: [], done: false });
  const enrichAbortRef = useRef(false);
  const [dailySyncLog, setDailySyncLog] = useState<string | null>(null);
  const [scanLog, setScanLog] = useState<string | null>(null);

  // Yahoo Backfill state
  const [backfillState, setBackfillState] = useState<{
    running: boolean;
    batchSize: number;
    offset: number;
    totalProcessed: number;
    totalBars: number;
    totalFailed: number;
    logs: string[];
    done: boolean;
  }>({ running: false, batchSize: 10, offset: 0, totalProcessed: 0, totalBars: 0, totalFailed: 0, logs: [], done: false });
  const backfillAbortRef = useRef(false);

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

  const runBulkEnrich = useCallback(async () => {
    if (!syncSecret.trim()) {
      toast.error('Ange SYNC_SECRET_KEY först');
      return;
    }
    enrichAbortRef.current = false;
    setEnrichState({ running: true, offset: 0, totalEnriched: 0, totalFailed: 0, totalPromoted: 0, remaining: null, logs: [], done: false });

    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const baseUrl = import.meta.env.VITE_SUPABASE_URL
      ? `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, '')}/functions/v1/bulk-enrich-sectors`
      : projectId
        ? `https://${projectId}.supabase.co/functions/v1/bulk-enrich-sectors`
        : '';

    if (!baseUrl) {
      toast.error('Kunde inte bestämma edge function URL');
      setEnrichState(prev => ({ ...prev, running: false }));
      return;
    }

    let offset = 0;
    let totalEnriched = 0;
    let totalFailed = 0;
    let totalPromoted = 0;
    const logs: string[] = [];
    const MAX_SYMBOLS_PER_CALL = 15;
    const MAX_ITERATIONS = 300; // safety

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (enrichAbortRef.current) {
        logs.push(`⏹ Stoppat av användaren vid offset ${offset}`);
        setEnrichState(prev => ({ ...prev, running: false, logs: [...logs] }));
        return;
      }

      try {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${syncSecret.trim()}`,
          },
          body: JSON.stringify({ offset, maxSymbols: MAX_SYMBOLS_PER_CALL }),
        });

        if (!res.ok) {
          const text = await res.text();
          logs.push(`❌ HTTP ${res.status} vid offset ${offset}: ${text.slice(0, 200)}`);
          setEnrichState(prev => ({ ...prev, running: false, logs: [...logs] }));
          toast.error(`Bulk-enrich misslyckades: HTTP ${res.status}`);
          return;
        }

        const data = await res.json();

        if (!data.ok && data.error) {
          logs.push(`❌ ${data.error}`);
          setEnrichState(prev => ({ ...prev, running: false, logs: [...logs] }));
          return;
        }

        totalEnriched += data.enriched ?? 0;
        totalFailed += data.failed ?? 0;
        totalPromoted += data.promoted ?? 0;
        const remaining = data.totalRemaining ?? null;

        const msg = `✅ Batch ${i + 1}: +${data.enriched ?? 0} berikade, ${data.failed ?? 0} fel, ${data.promoted ?? 0} promoted → offset ${data.nextOffset ?? offset} (${remaining ?? '?'} kvar)`;
        logs.push(msg);

        setEnrichState({
          running: true,
          offset: data.nextOffset ?? offset,
          totalEnriched,
          totalFailed,
          totalPromoted,
          remaining,
          logs: [...logs],
          done: false,
        });

        if (data.done || !data.hasMore || (remaining !== null && remaining <= 0)) {
          logs.push(`🏁 Klart! Totalt: ${totalEnriched} berikade, ${totalFailed} fel, ${totalPromoted} promoted`);
          setEnrichState(prev => ({ ...prev, running: false, done: true, logs: [...logs] }));
          toast.success(`Bulk-enrich klar: ${totalEnriched} symboler berikade`);
          return;
        }

        offset = data.nextOffset ?? (offset + (data.processed ?? MAX_SYMBOLS_PER_CALL));
      } catch (err) {
        logs.push(`❌ Nätverksfel vid offset ${offset}: ${String(err).slice(0, 200)}`);
        setEnrichState(prev => ({ ...prev, running: false, logs: [...logs] }));
        toast.error('Nätverksfel vid bulk-enrich');
        return;
      }
    }

    logs.push('⚠️ Max iterationer nådda (300). Kör igen för att fortsätta.');
    setEnrichState(prev => ({ ...prev, running: false, logs: [...logs] }));
  }, [syncSecret]);

  const stopBulkEnrich = useCallback(() => {
    enrichAbortRef.current = true;
    toast.info('Stoppar bulk-enrich efter nuvarande batch...');
  }, []);

  const runYahooBackfill = useCallback(async () => {
    if (!syncSecret.trim()) { toast.error('Ange SYNC_SECRET_KEY först'); return; }
    backfillAbortRef.current = false;
    setBackfillState(prev => ({ ...prev, running: true, offset: 0, totalProcessed: 0, totalBars: 0, totalFailed: 0, logs: [], done: false }));

    const baseUrl = import.meta.env.VITE_SUPABASE_URL
      ? `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, '')}/functions/v1/historical-backfill`
      : '';
    if (!baseUrl) { toast.error('SUPABASE_URL saknas'); setBackfillState(prev => ({ ...prev, running: false })); return; }

    let offset = 0;
    let totalProcessed = 0;
    let totalBars = 0;
    let totalFailed = 0;
    const logs: string[] = [];

    for (let i = 0; i < 500; i++) {
      if (backfillAbortRef.current) {
        logs.push(`⏹ Stoppat vid offset ${offset}`);
        setBackfillState(prev => ({ ...prev, running: false, logs: [...logs] }));
        return;
      }

      try {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${syncSecret.trim()}` },
          body: JSON.stringify({ limit: backfillState.batchSize, offset }),
        });

        if (!res.ok) {
          const text = await res.text();
          logs.push(`❌ HTTP ${res.status}: ${text.slice(0, 200)}`);
          setBackfillState(prev => ({ ...prev, running: false, logs: [...logs] }));
          return;
        }

        const data = await res.json();
        totalProcessed += data.processed ?? 0;
        totalBars += data.totalBars ?? 0;
        totalFailed += data.failed ?? 0;

        const batchResults = (data.results ?? []).map((r: any) => r.ok ? `✅ ${r.symbol}: ${r.bars} bars` : `❌ ${r.symbol}: ${r.error}`).join(', ');
        logs.push(`Batch ${i + 1}: ${data.processed ?? 0} symboler, ${data.totalBars ?? 0} bars — ${batchResults}`);

        setBackfillState(prev => ({
          ...prev, offset: data.nextOffset ?? offset, totalProcessed, totalBars, totalFailed, logs: [...logs],
        }));

        if (data.done || !data.hasMore) {
          logs.push(`🏁 Klart! ${totalProcessed} symboler, ${totalBars} bars, ${totalFailed} fel`);
          setBackfillState(prev => ({ ...prev, running: false, done: true, logs: [...logs] }));
          toast.success(`Backfill klar: ${totalProcessed} symboler`);
          return;
        }

        offset = data.nextOffset ?? (offset + (data.processed ?? backfillState.batchSize));
      } catch (err) {
        logs.push(`❌ Nätverksfel: ${String(err).slice(0, 200)}`);
        setBackfillState(prev => ({ ...prev, running: false, logs: [...logs] }));
        return;
      }
    }
  }, [syncSecret, backfillState.batchSize]);

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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2"><Zap className="h-4 w-4" /> Bulk Enrich Sectors (Polygon)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              type="password"
              placeholder="SYNC_SECRET_KEY"
              value={syncSecret}
              onChange={(e) => setSyncSecret(e.target.value)}
              className="max-w-xs font-mono text-xs"
            />
            <Button
              onClick={runBulkEnrich}
              disabled={enrichState.running || !syncSecret.trim()}
              size="sm"
              className="font-mono text-xs"
            >
              {enrichState.running ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Kör...</> : <><Zap className="h-3 w-3 mr-1" /> Starta Bulk Enrich</>}
            </Button>
            {enrichState.running && (
              <Button onClick={stopBulkEnrich} variant="destructive" size="sm" className="font-mono text-xs">
                Stoppa
              </Button>
            )}
          </div>

          {(enrichState.totalEnriched > 0 || enrichState.running) && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs font-mono">
              <Stat label="Berikade" value={String(enrichState.totalEnriched)} />
              <Stat label="Fel" value={String(enrichState.totalFailed)} />
              <Stat label="Promoted" value={String(enrichState.totalPromoted)} />
              <Stat label="Kvar" value={enrichState.remaining !== null ? String(enrichState.remaining) : '—'} />
              <Stat label="Offset" value={String(enrichState.offset)} />
            </div>
          )}

          {enrichState.done && (
            <p className="text-signal-success flex items-center gap-1 text-xs font-mono">
              <CheckCircle2 className="h-4 w-4" /> Bulk-enrich slutförd!
            </p>
          )}

          {enrichState.logs.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded border border-border bg-background p-2 text-[10px] font-mono space-y-0.5">
              {enrichState.logs.map((log, i) => (
                <div key={i} className="text-muted-foreground">{log}</div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2"><Database className="h-4 w-4" /> Yahoo Historical Backfill</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground font-mono">Backfillar 2 år prisdata via Yahoo Finance för symboler med &lt; 200 bars.</p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={50}
              value={backfillState.batchSize}
              onChange={(e) => setBackfillState(prev => ({ ...prev, batchSize: Math.max(1, Math.min(50, Number(e.target.value) || 10)) }))}
              className="w-20 font-mono text-xs"
              placeholder="Batch"
            />
            <Button
              onClick={runYahooBackfill}
              disabled={backfillState.running || !syncSecret.trim()}
              size="sm"
              className="font-mono text-xs"
            >
              {backfillState.running ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Kör...</> : <><Database className="h-3 w-3 mr-1" /> Starta Backfill</>}
            </Button>
            {backfillState.running && (
              <Button onClick={() => { backfillAbortRef.current = true; toast.info('Stoppar backfill...'); }} variant="destructive" size="sm" className="font-mono text-xs">
                Stoppa
              </Button>
            )}
          </div>

          {(backfillState.totalProcessed > 0 || backfillState.running) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
              <Stat label="Symboler" value={String(backfillState.totalProcessed)} />
              <Stat label="Bars" value={String(backfillState.totalBars)} />
              <Stat label="Fel" value={String(backfillState.totalFailed)} />
              <Stat label="Offset" value={String(backfillState.offset)} />
            </div>
          )}

          {backfillState.done && (
            <p className="text-signal-success flex items-center gap-1 text-xs font-mono">
              <CheckCircle2 className="h-4 w-4" /> Backfill slutförd!
            </p>
          )}

          {backfillState.logs.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded border border-border bg-background p-2 text-[10px] font-mono space-y-0.5">
              {backfillState.logs.map((log, i) => (
                <div key={i} className="text-muted-foreground">{log}</div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={async () => {
                if (!syncSecret.trim()) { toast.error('Ange SYNC_SECRET_KEY först'); return; }
                const baseUrl = import.meta.env.VITE_SUPABASE_URL
                  ? `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, '')}/functions/v1/daily-sync`
                  : '';
                if (!baseUrl) { toast.error('SUPABASE_URL saknas'); return; }
                toast.info('Kör daily-sync...');
                try {
                  const res = await fetch(baseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${syncSecret.trim()}` },
                    body: JSON.stringify({}),
                  });
                  const data = await res.json();
                  setDailySyncLog(JSON.stringify(data, null, 2));
                  toast.success('Daily sync klar');
                } catch (err) {
                  setDailySyncLog(`Fel: ${String(err)}`);
                  toast.error('Daily sync misslyckades');
                }
              }}
              disabled={!syncSecret.trim()}
              size="sm"
              className="font-mono text-xs"
            >
              <Zap className="h-3 w-3 mr-1" /> Kör Daily Sync
            </Button>
            <Button
              onClick={async () => {
                if (!syncSecret.trim()) { toast.error('Ange SYNC_SECRET_KEY först'); return; }
                const baseUrl = import.meta.env.VITE_SUPABASE_URL
                  ? `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, '')}/functions/v1/scan-market`
                  : '';
                if (!baseUrl) { toast.error('SUPABASE_URL saknas'); return; }
                toast.info('Kör market scan...');
                try {
                  const res = await fetch(baseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${syncSecret.trim()}` },
                    body: JSON.stringify({ runLabel: 'manual_admin' }),
                  });
                  const data = await res.json();
                  setScanLog(JSON.stringify(data, null, 2));
                  toast.success('Market scan klar');
                } catch (err) {
                  setScanLog(`Fel: ${String(err)}`);
                  toast.error('Market scan misslyckades');
                }
              }}
              disabled={!syncSecret.trim()}
              size="sm"
              variant="outline"
              className="font-mono text-xs"
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Kör Market Scan
            </Button>
          </div>
          {dailySyncLog && (
            <div className="max-h-48 overflow-y-auto rounded border border-border bg-background p-2 text-[10px] font-mono whitespace-pre-wrap text-muted-foreground">
              {dailySyncLog}
            </div>
          )}
          {scanLog && (
            <div className="max-h-48 overflow-y-auto rounded border border-border bg-background p-2 text-[10px] font-mono whitespace-pre-wrap text-muted-foreground">
              {scanLog}
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
