import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Play, Pause, Square, RotateCcw, RefreshCw, Loader2,
  CheckCircle2, AlertTriangle, XCircle, Clock, Database
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

type BootstrapStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'completed' | 'error';
type StepStatus = 'pending' | 'running' | 'done' | 'warning' | 'error' | 'skipped';

interface BootstrapStep {
  id: string;
  label: string;
  description: string;
  status: StepStatus;
  detail?: string;
  progress?: { current: number; total: number };
}

const INITIAL_STEPS: Omit<BootstrapStep, 'status'>[] = [
  { id: 'seed', label: '1. Seed Symbols', description: 'Ensure full US equity universe is seeded' },
  { id: 'backfill', label: '2. Historical Backfill', description: 'Fetch price history in background batches' },
  { id: 'enrich', label: '3. Metadata Enrichment', description: 'Classify sectors/industries via Polygon SIC' },
  { id: 'indicators', label: '4. Indicator Refresh', description: 'Materialize WSP indicators from prices' },
  { id: 'scan', label: '5. Market Scan', description: 'Run broad market scan on eligible universe' },
  { id: 'publish', label: '6. Publish Snapshot', description: 'Publish canonical snapshot for public UI' },
  { id: 'health', label: '7. Health Check', description: 'Validate pipeline integrity' },
];

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'done': return <CheckCircle2 className="h-4 w-4 text-signal-success flex-shrink-0" />;
    case 'warning': return <AlertTriangle className="h-4 w-4 text-signal-caution flex-shrink-0" />;
    case 'running': return <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />;
    case 'error': return <XCircle className="h-4 w-4 text-signal-danger flex-shrink-0" />;
    case 'skipped': return <RotateCcw className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
    default: return <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
  }
}

function StatBlock({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-semibold mt-0.5">{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

interface Props {
  syncSecret: string;
}

export default function BootstrapPanel({ syncSecret }: Props) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<BootstrapStatus>('idle');
  const [steps, setSteps] = useState<BootstrapStep[]>(INITIAL_STEPS.map(s => ({ ...s, status: 'pending' })));
  const [currentStepIdx, setCurrentStepIdx] = useState(-1);
  const [lastRunTime, setLastRunTime] = useState<string | null>(null);
  const [errorSummary, setErrorSummary] = useState<string | null>(null);
  const pauseRef = useRef(false);
  const stopRef = useRef(false);

  // Coverage stats for status display
  const { data: coverage, refetch: refetchCoverage } = useQuery<Record<string, number>>({
    queryKey: ['bootstrap-coverage'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_universe_coverage_detailed');
      if (error) throw error;
      return data as Record<string, number>;
    },
    refetchInterval: status === 'running' ? 8_000 : 30_000,
  });

  // Symbol counts for bootstrap-specific metrics
  const { data: bootstrapStats, refetch: refetchStats } = useQuery({
    queryKey: ['bootstrap-stats'],
    queryFn: async () => {
      const [
        { count: totalActive },
        { count: totalEquity },
        { count: withSector },
        { count: withIndustry },
      ] = await Promise.all([
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('is_etf', false),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true).not('canonical_sector', 'is', null).neq('canonical_sector', 'Unknown'),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true).not('canonical_industry', 'is', null).neq('canonical_industry', 'Unknown').neq('canonical_industry', 'Other'),
      ]);
      return {
        totalActive: totalActive ?? 0,
        totalEquity: totalEquity ?? 0,
        withSector: withSector ?? 0,
        withIndustry: withIndustry ?? 0,
        withPriceHistory: coverage?.raw_scanned_population ?? 0,
        withIndicators: coverage?.wsp_evaluated_population ?? 0,
        scanned: coverage?.canonical_mapped_population ?? 0,
        publicEligible: coverage?.public_eligible_population ?? 0,
      };
    },
    refetchInterval: status === 'running' ? 10_000 : 30_000,
  });

  const getBaseUrl = (fn: string) => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    return url ? `${String(url).replace(/\/$/, '')}/functions/v1/${fn}` : '';
  };

  const callFn = async (path: string, body: Record<string, unknown> = {}) => {
    const url = getBaseUrl(path);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${syncSecret.trim()}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { ok: res.ok, status: res.status, data: json };
  };

  const updateStep = (idx: number, patch: Partial<BootstrapStep>) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  const shouldStop = () => stopRef.current;
  const shouldPause = () => pauseRef.current;

  const waitWhilePaused = async () => {
    while (pauseRef.current && !stopRef.current) {
      await new Promise(r => setTimeout(r, 1000));
    }
  };

  // ---- STEP RUNNERS ----

  const runSeed = async (idx: number) => {
    updateStep(idx, { status: 'running', detail: 'Seeding symbol universe...' });
    const res = await callFn('seed-symbols', {});
    if (!res.ok) throw new Error(res.data?.error ?? `HTTP ${res.status}`);
    const seeded = res.data?.symbols_created ?? res.data?.seeded ?? 0;
    updateStep(idx, { status: 'done', detail: `Seeded. ${seeded} new symbols added.` });
  };

  const runBackfill = async (idx: number) => {
    updateStep(idx, { status: 'running', detail: 'Starting backfill batches...' });
    let totalBars = 0;
    let batchCount = 0;
    const MAX_BATCHES = 50; // safety limit per bootstrap run

    for (let i = 0; i < MAX_BATCHES; i++) {
      if (shouldStop()) { updateStep(idx, { status: 'warning', detail: `Stopped after ${batchCount} batches` }); return; }
      await waitWhilePaused();

      const res = await callFn('admin-pipeline/backfill', { limit: 50 });
      if (!res.ok) {
        if (i === 0) throw new Error(res.data?.error ?? `HTTP ${res.status}`);
        updateStep(idx, { status: 'warning', detail: `Partial: ${batchCount} batches, ${totalBars} bars. Error: ${res.data?.error}` });
        return;
      }

      batchCount++;
      totalBars += res.data?.data?.batch_size ?? 0;
      updateStep(idx, { status: 'running', detail: `Batch ${batchCount} dispatched (${totalBars} total capacity)`, progress: { current: batchCount, total: MAX_BATCHES } });

      // Backfill runs in background — just dispatch a few batches and move on
      // The RPC handles dedup so we can safely dispatch and let it complete
      if (res.data?.skipped) {
        updateStep(idx, { status: 'done', detail: `Backfill already running. ${batchCount} batches dispatched.` });
        return;
      }

      // Wait between dispatches to let background complete
      await new Promise(r => setTimeout(r, 5000));
    }

    updateStep(idx, { status: 'done', detail: `${batchCount} backfill batches dispatched` });
  };

  const runEnrich = async (idx: number) => {
    updateStep(idx, { status: 'running', detail: 'Starting enrichment batches...' });
    let totalEnriched = 0;
    let offset = 0;
    const BATCH_SIZE = 15;
    const MAX_BATCHES = 100;

    for (let i = 0; i < MAX_BATCHES; i++) {
      if (shouldStop()) { updateStep(idx, { status: 'warning', detail: `Stopped after ${totalEnriched} enriched` }); return; }
      await waitWhilePaused();

      const res = await callFn('bulk-enrich-sectors', { offset, maxSymbols: BATCH_SIZE });
      if (!res.ok) {
        if (totalEnriched === 0) throw new Error(res.data?.error ?? `HTTP ${res.status}`);
        updateStep(idx, { status: 'warning', detail: `Partial: ${totalEnriched} enriched. Rate limited.` });
        return;
      }

      const d = res.data;
      totalEnriched += d.enriched ?? 0;
      updateStep(idx, {
        status: 'running',
        detail: `Enriched: ${totalEnriched} | Remaining: ${d.totalRemaining ?? '?'}`,
        progress: d.totalRemaining != null ? { current: totalEnriched, total: totalEnriched + d.totalRemaining } : undefined,
      });

      if (d.rateLimitAbort) {
        updateStep(idx, { status: 'warning', detail: `Rate limited after ${totalEnriched} enriched. Resume later.` });
        return;
      }
      if (d.done || !d.hasMore) break;
      offset = d.nextOffset ?? (offset + BATCH_SIZE);
    }

    updateStep(idx, { status: 'done', detail: `${totalEnriched} symbols enriched` });
  };

  const runIndicators = async (idx: number) => {
    updateStep(idx, { status: 'running', detail: 'Materializing indicators...' });
    const res = await callFn('admin-pipeline/indicators', { requested_by: 'bootstrap' });
    if (!res.ok) throw new Error(res.data?.error ?? `HTTP ${res.status}`);
    updateStep(idx, { status: 'done', detail: 'Indicator refresh dispatched' });
    // Wait a bit for background processing
    await new Promise(r => setTimeout(r, 5000));
  };

  const runScan = async (idx: number) => {
    updateStep(idx, { status: 'running', detail: 'Running broad market scan...' });
    const res = await callFn('admin-pipeline/scan', { requested_by: 'bootstrap' });
    if (!res.ok) throw new Error(res.data?.error ?? `HTTP ${res.status}`);
    updateStep(idx, { status: 'done', detail: `Scan run ID: ${res.data?.scan_run_id ?? '?'}` });
  };

  const runPublish = async (idx: number) => {
    updateStep(idx, { status: 'running', detail: 'Publishing snapshot...' });
    const res = await callFn('admin-pipeline/publish', {});
    if (!res.ok) throw new Error(res.data?.error ?? `HTTP ${res.status}`);
    updateStep(idx, { status: 'done', detail: `Snapshot #${res.data?.snapshot_id ?? '?'} published (${res.data?.symbols ?? '?'} symbols)` });
  };

  const runHealth = async (idx: number) => {
    updateStep(idx, { status: 'running', detail: 'Running health checks...' });
    const res = await callFn('admin-pipeline/health-check', {});
    if (!res.ok) throw new Error(res.data?.error ?? `HTTP ${res.status}`);
    const checks = res.data?.checks ?? [];
    const fails = checks.filter((c: any) => c.status === 'critical' || c.status === 'error').length;
    const warns = checks.filter((c: any) => c.status === 'warning').length;
    updateStep(idx, {
      status: fails > 0 ? 'warning' : 'done',
      detail: `${checks.length} checks: ${fails} critical, ${warns} warnings`,
    });
  };

  const STEP_RUNNERS = [runSeed, runBackfill, runEnrich, runIndicators, runScan, runPublish, runHealth];

  // Determine resume start index based on current step states
  const getResumeIndex = () => {
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].status === 'pending' || steps[i].status === 'error' || steps[i].status === 'warning') return i;
    }
    return 0;
  };

  const runBootstrap = useCallback(async (startIdx = 0) => {
    if (!syncSecret.trim()) { toast.error('Ange SYNC_SECRET_KEY'); return; }
    pauseRef.current = false;
    stopRef.current = false;
    setStatus('running');
    setErrorSummary(null);
    setLastRunTime(new Date().toLocaleString());

    // Reset steps from startIdx onwards
    setSteps(prev => prev.map((s, i) => i >= startIdx ? { ...s, status: 'pending', detail: undefined, progress: undefined } : s));

    for (let i = startIdx; i < STEP_RUNNERS.length; i++) {
      if (stopRef.current) { setStatus('stopped'); return; }
      await waitWhilePaused();
      setCurrentStepIdx(i);

      try {
        await STEP_RUNNERS[i](i);
      } catch (err) {
        const msg = String(err).slice(0, 300);
        updateStep(i, { status: 'error', detail: msg });
        setErrorSummary(`Step ${i + 1} failed: ${msg}`);
        setStatus('error');
        toast.error(`Bootstrap failed at: ${INITIAL_STEPS[i].label}`);
        return;
      }

      // Refresh stats after each step
      refetchCoverage();
      refetchStats();
    }

    setStatus('completed');
    setCurrentStepIdx(-1);
    await queryClient.invalidateQueries();
    toast.success('Bootstrap completed!');
  }, [syncSecret, queryClient, refetchCoverage, refetchStats]);

  const handleStart = () => runBootstrap(0);
  const handleResume = () => runBootstrap(getResumeIndex());
  const handlePause = () => { pauseRef.current = true; setStatus('paused'); };
  const handleStop = () => { stopRef.current = true; pauseRef.current = false; setStatus('stopped'); };

  const equityUniverse = bootstrapStats?.totalEquity ?? 0;

  return (
    <Card className="border-accent/40">
      <CardHeader>
        <CardTitle className="text-sm font-mono flex items-center gap-2">
          <Database className="h-4 w-4 text-accent" /> Full US Equity Bootstrap
          <Badge variant="outline" className="ml-auto text-[9px] font-mono">
            {status.toUpperCase()}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={handleStart}
            disabled={status === 'running' || status === 'paused' || !syncSecret.trim()}
            size="sm"
            className="font-mono text-xs"
          >
            <Play className="h-3 w-3 mr-1" /> Start Bootstrap
          </Button>
          <Button
            onClick={handlePause}
            disabled={status !== 'running'}
            variant="outline"
            size="sm"
            className="font-mono text-xs"
          >
            <Pause className="h-3 w-3 mr-1" /> Pause
          </Button>
          <Button
            onClick={handleResume}
            disabled={status !== 'paused' && status !== 'stopped' && status !== 'error'}
            variant="outline"
            size="sm"
            className="font-mono text-xs"
          >
            <RotateCcw className="h-3 w-3 mr-1" /> Resume
          </Button>
          <Button
            onClick={handleStop}
            disabled={status !== 'running' && status !== 'paused'}
            variant="destructive"
            size="sm"
            className="font-mono text-xs"
          >
            <Square className="h-3 w-3 mr-1" /> Stop
          </Button>
          <Button
            onClick={() => { refetchCoverage(); refetchStats(); toast.success('Status refreshed'); }}
            variant="ghost"
            size="sm"
            className="font-mono text-xs"
          >
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh Status
          </Button>
        </div>

        {/* Status stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 text-xs">
          <StatBlock label="Active Universe" value={bootstrapStats?.totalActive ?? '—'} />
          <StatBlock label="Equities (excl ETF)" value={equityUniverse} />
          <StatBlock label="With Price History" value={coverage?.raw_scanned_population ?? '—'} sub={equityUniverse > 0 ? `${Math.round(((coverage?.raw_scanned_population ?? 0) / equityUniverse) * 100)}%` : ''} />
          <StatBlock label="Missing History" value={equityUniverse - (coverage?.raw_scanned_population ?? 0)} />
          <StatBlock label="With Indicators" value={coverage?.wsp_evaluated_population ?? '—'} sub={equityUniverse > 0 ? `${Math.round(((coverage?.wsp_evaluated_population ?? 0) / equityUniverse) * 100)}%` : ''} />
          <StatBlock label="Canonical Sector" value={bootstrapStats?.withSector ?? '—'} />
          <StatBlock label="Canonical Industry" value={bootstrapStats?.withIndustry ?? '—'} />
          <StatBlock label="Scanned" value={coverage?.canonical_mapped_population ?? '—'} />
          <StatBlock label="Public Eligible" value={coverage?.public_eligible_population ?? '—'} />
          <StatBlock label="Current Step" value={currentStepIdx >= 0 ? INITIAL_STEPS[currentStepIdx].label : '—'} />
        </div>

        {/* Overall progress bar */}
        {status !== 'idle' && (
          <div>
            <div className="flex justify-between text-[9px] font-mono text-muted-foreground mb-1">
              <span>Pipeline Progress</span>
              <span>{steps.filter(s => s.status === 'done').length} / {steps.length} steps</span>
            </div>
            <Progress value={(steps.filter(s => s.status === 'done').length / steps.length) * 100} className="h-2" />
          </div>
        )}

        {/* Step list */}
        <div className="space-y-1.5">
          {steps.map((step) => (
            <div key={step.id} className="flex items-start gap-2 text-xs font-mono border-b border-border/30 py-1.5">
              <StepIcon status={step.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={
                    step.status === 'running' ? 'text-primary font-semibold' :
                    step.status === 'error' ? 'text-signal-danger' :
                    step.status === 'done' ? 'text-signal-success' :
                    'text-foreground'
                  }>
                    {step.label}
                  </span>
                  <span className="text-[9px] text-muted-foreground">{step.description}</span>
                </div>
                {step.detail && (
                  <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{step.detail}</div>
                )}
                {step.progress && step.status === 'running' && (
                  <Progress value={(step.progress.current / step.progress.total) * 100} className="h-1 mt-1" />
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Meta info */}
        <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground">
          {lastRunTime && <span>Last run: {lastRunTime}</span>}
          {errorSummary && <span className="text-signal-danger">{errorSummary}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
