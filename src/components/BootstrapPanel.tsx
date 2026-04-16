import { useCallback } from 'react';
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

type StepStatus = 'pending' | 'running' | 'done' | 'warning' | 'error' | 'skipped';
type JobStatus = 'queued' | 'running' | 'paused' | 'stopped' | 'completed' | 'failed';

interface JobStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
  started_at?: string;
  finished_at?: string;
}

interface BootstrapJob {
  id: number;
  status: JobStatus;
  current_step: string | null;
  current_step_idx: number;
  total_steps: number;
  steps: JobStep[];
  error_message: string | null;
  control_signal: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

const FALLBACK_STEPS: JobStep[] = [
  { id: 'seed', label: '1. Seed Symbols', status: 'pending' },
  { id: 'backfill', label: '2. Historical Backfill', status: 'pending' },
  { id: 'enrich', label: '3. Metadata Enrichment', status: 'pending' },
  { id: 'indicators', label: '4. Indicator Refresh', status: 'pending' },
  { id: 'scan', label: '5. Market Scan', status: 'pending' },
  { id: 'publish', label: '6. Publish Snapshot', status: 'pending' },
  { id: 'health', label: '7. Health Check', status: 'pending' },
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

const FN_BASE = (() => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  return url ? `${String(url).replace(/\/$/, '')}/functions/v1` : '';
})();

export default function BootstrapPanel({ syncSecret }: Props) {
  const queryClient = useQueryClient();

  // Resolve auth token (sync secret OR session token)
  const getAuthToken = useCallback(async () => {
    const t = syncSecret.trim();
    if (t) return t;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token?.trim() ?? '';
  }, [syncSecret]);

  // Poll latest job from DB (works even if user reloads / re-opens page)
  const { data: job, refetch: refetchJob } = useQuery<BootstrapJob | null>({
    queryKey: ['bootstrap-job-latest'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('bootstrap_jobs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data as BootstrapJob | null;
    },
    refetchInterval: (q) => {
      const j = q.state.data as BootstrapJob | null;
      return j && (j.status === 'running' || j.status === 'queued' || j.status === 'paused') ? 4000 : 15000;
    },
  });

  const status = job?.status ?? 'idle';
  const steps = job?.steps?.length ? job.steps : FALLBACK_STEPS;

  const { data: coverage, refetch: refetchCoverage } = useQuery<Record<string, number>>({
    queryKey: ['bootstrap-coverage'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_universe_coverage_detailed');
      if (error) throw error;
      return data as Record<string, number>;
    },
    refetchInterval: status === 'running' ? 8_000 : 30_000,
  });

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
      };
    },
    refetchInterval: status === 'running' ? 10_000 : 30_000,
  });

  const callOrchestrator = async (method: string, body?: any) => {
    const token = await getAuthToken();
    if (!token) throw new Error('Ange SYNC_SECRET_KEY eller logga in');
    const res = await fetch(`${FN_BASE}/bootstrap-orchestrator`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok && res.status !== 409) throw new Error(data?.error ?? `HTTP ${res.status}`);
    return { status: res.status, data };
  };

  const sendControl = async (signal: 'pause' | 'resume' | 'stop') => {
    if (!job?.id) return;
    const token = await getAuthToken();
    await fetch(`${FN_BASE}/bootstrap-orchestrator/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: job.id, signal }),
    });
    refetchJob();
  };

  const handleStart = async (mode: 'full' | 'daily') => {
    try {
      const res = await callOrchestrator('POST', { mode, requested_by: 'admin-panel' });
      if (res.status === 409) {
        toast.info('Ett jobb körs redan. Visar status.');
      } else {
        toast.success(`Bootstrap startad (${mode}). Du kan stänga sidan — det fortsätter på servern.`);
      }
      refetchJob();
    } catch (err) {
      toast.error(`Kunde inte starta: ${(err as Error).message}`);
    }
  };

  const handlePause = () => sendControl('pause').then(() => toast.info('Paus signalerad'));
  const handleResume = () => sendControl('resume').then(() => toast.success('Återupptagen'));
  const handleStop = () => sendControl('stop').then(() => toast.warning('Stopp signalerat'));

  const handleRefresh = async () => {
    await Promise.all([refetchJob(), refetchCoverage(), refetchStats()]);
    queryClient.invalidateQueries();
    toast.success('Status uppdaterad');
  };

  const equityUniverse = bootstrapStats?.totalEquity ?? 0;
  const doneCount = steps.filter(s => s.status === 'done').length;
  const isActive = status === 'running' || status === 'paused' || status === 'queued';

  return (
    <Card className="border-accent/40">
      <CardHeader>
        <CardTitle className="text-sm font-mono flex items-center gap-2">
          <Database className="h-4 w-4 text-accent" /> Full US Equity Bootstrap
          <Badge variant="outline" className="ml-auto text-[9px] font-mono">
            {String(status).toUpperCase()}{job?.id ? ` · #${job.id}` : ''}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded border border-accent/30 bg-accent/5 p-2 text-[10px] font-mono text-muted-foreground">
          Server-driven: jobben körs i bakgrunden på servern och fortsätter även om du stänger sidan.
          Daglig pipeline schemalagd 23:30 UTC mån-fre. Auto-backfill loop var 5:e minut tills universumet är komplett.
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => handleStart('full')} disabled={isActive} size="sm" className="font-mono text-xs">
            <Play className="h-3 w-3 mr-1" /> Start Full Bootstrap
          </Button>
          <Button onClick={() => handleStart('daily')} disabled={isActive} variant="secondary" size="sm" className="font-mono text-xs">
            <Play className="h-3 w-3 mr-1" /> Start Daily Pipeline
          </Button>
          <Button onClick={handlePause} disabled={status !== 'running'} variant="outline" size="sm" className="font-mono text-xs">
            <Pause className="h-3 w-3 mr-1" /> Pause
          </Button>
          <Button onClick={handleResume} disabled={status !== 'paused'} variant="outline" size="sm" className="font-mono text-xs">
            <RotateCcw className="h-3 w-3 mr-1" /> Resume
          </Button>
          <Button onClick={handleStop} disabled={status !== 'running' && status !== 'paused'} variant="destructive" size="sm" className="font-mono text-xs">
            <Square className="h-3 w-3 mr-1" /> Stop
          </Button>
          <Button onClick={handleRefresh} variant="ghost" size="sm" className="font-mono text-xs">
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
        </div>

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
          <StatBlock label="Current Step" value={job?.current_step ?? '—'} />
        </div>

        {status !== 'idle' && steps.length > 0 && (
          <div>
            <div className="flex justify-between text-[9px] font-mono text-muted-foreground mb-1">
              <span>Pipeline Progress</span>
              <span>{doneCount} / {steps.length} steps</span>
            </div>
            <Progress value={(doneCount / steps.length) * 100} className="h-2" />
          </div>
        )}

        <div className="space-y-1.5">
          {steps.map((step) => (
            <div key={step.id} className="flex items-start gap-2 text-xs font-mono border-b border-border/30 py-1.5">
              <StepIcon status={step.status} />
              <div className="flex-1 min-w-0">
                <span className={
                  step.status === 'running' ? 'text-primary font-semibold' :
                  step.status === 'error' ? 'text-signal-danger' :
                  step.status === 'done' ? 'text-signal-success' :
                  'text-foreground'
                }>
                  {step.label}
                </span>
                {step.detail && (
                  <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{step.detail}</div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground flex-wrap">
          {job?.started_at && <span>Started: {new Date(job.started_at).toLocaleString()}</span>}
          {job?.finished_at && <span>Finished: {new Date(job.finished_at).toLocaleString()}</span>}
          {job?.error_message && <span className="text-signal-danger">Error: {job.error_message}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
