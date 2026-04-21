import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Activity, AlertTriangle, CheckCircle2, RotateCcw, Heart } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';

interface BootstrapJob {
  id: number;
  status: string;
  current_step: string | null;
  current_step_idx: number;
  total_steps: number;
  started_at: string;
  heartbeat_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  requested_by: string | null;
}

function ageSeconds(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
}

function fmtAge(secs: number | null): string {
  if (secs === null) return '—';
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export default function BootstrapStatusWidget() {
  const queryClient = useQueryClient();
  const [restarting, setRestarting] = useState(false);

  const { data: job } = useQuery<BootstrapJob | null>({
    queryKey: ['bootstrap-status-widget'],
    queryFn: async () => {
      const { data } = await supabase
        .from('bootstrap_jobs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as BootstrapJob | null;
    },
    refetchInterval: 5_000,
  });

  const heartbeatAge = ageSeconds(job?.heartbeat_at ?? null);
  const isRunning = job?.status === 'running' || job?.status === 'paused';
  const isStalled = isRunning && heartbeatAge !== null && heartbeatAge > 15 * 60;
  const isHealthy = isRunning && heartbeatAge !== null && heartbeatAge < 90;

  const handleRestart = async () => {
    if (!confirm('Starta om pipeline? Pågående jobb stoppas.')) return;
    setRestarting(true);
    try {
      // Stop current if running
      if (job && isRunning) {
        await supabase.functions.invoke('bootstrap-orchestrator/control', {
          body: { id: job.id, signal: 'stop' },
        });
        await new Promise((r) => setTimeout(r, 1500));
      }
      // Start a new full run
      const { error } = await supabase.functions.invoke('bootstrap-orchestrator', {
        body: { mode: 'full', requested_by: 'admin-restart' },
      });
      if (error) throw error;
      toast.success('Pipeline omstartad');
      queryClient.invalidateQueries({ queryKey: ['bootstrap-status-widget'] });
    } catch (e: any) {
      toast.error(`Restart misslyckades: ${e?.message ?? e}`);
    } finally {
      setRestarting(false);
    }
  };

  const statusBadge = () => {
    if (!job) return <Badge variant="secondary" className="text-[9px]">inga jobb</Badge>;
    if (isStalled) return <Badge className="bg-signal-danger/15 text-signal-danger border-signal-danger/30 text-[9px]"><AlertTriangle className="h-3 w-3 mr-1" /> STALLED</Badge>;
    if (isHealthy) return <Badge className="bg-signal-success/15 text-signal-success border-signal-success/30 text-[9px]"><CheckCircle2 className="h-3 w-3 mr-1" /> RUNNING</Badge>;
    if (isRunning) return <Badge className="bg-signal-caution/15 text-signal-caution border-signal-caution/30 text-[9px]"><Heart className="h-3 w-3 mr-1" /> {job.status}</Badge>;
    if (job.status === 'completed') return <Badge className="bg-signal-success/15 text-signal-success border-signal-success/30 text-[9px]">completed</Badge>;
    if (job.status === 'failed') return <Badge className="bg-signal-danger/15 text-signal-danger border-signal-danger/30 text-[9px]">failed</Badge>;
    return <Badge variant="secondary" className="text-[9px]">{job.status}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono flex items-center gap-2">
          <Activity className="h-4 w-4" /> I. Bootstrap Status
          {statusBadge()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs font-mono">
        {!job && <p className="text-muted-foreground">Inga bootstrap-jobb registrerade.</p>}

        {job && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded border border-border p-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Job ID</div>
                <div className="font-mono text-sm font-semibold mt-1">#{job.id}</div>
              </div>
              <div className="rounded border border-border p-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Steg</div>
                <div className="font-mono text-sm font-semibold mt-1">{job.current_step_idx + 1}/{job.total_steps}</div>
              </div>
              <div className="rounded border border-border p-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Heartbeat-ålder</div>
                <div className={`font-mono text-sm font-semibold mt-1 ${isStalled ? 'text-signal-danger' : isHealthy ? 'text-signal-success' : 'text-signal-caution'}`}>
                  {fmtAge(heartbeatAge)}
                </div>
              </div>
              <div className="rounded border border-border p-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Begärd av</div>
                <div className="font-mono text-xs font-semibold mt-1 truncate">{job.requested_by ?? '—'}</div>
              </div>
            </div>

            <div className="rounded border border-border p-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Aktivt steg</div>
              <div className="font-mono text-xs mt-1">{job.current_step ?? '—'}</div>
            </div>

            {job.error_message && (
              <div className="rounded border border-signal-danger/30 bg-signal-danger/5 p-2">
                <div className="text-[11px] uppercase tracking-wide text-signal-danger">Fel</div>
                <div className="font-mono text-[10px] mt-1 text-signal-danger whitespace-pre-wrap">{job.error_message}</div>
              </div>
            )}

            {isStalled && (
              <div className="rounded border border-signal-danger/40 bg-signal-danger/10 p-2 text-signal-danger">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" /> Heartbeat &gt; 15 min — jobbet är troligen dött
                </div>
                <div className="text-[10px] mt-1">Watchdog markerar det som failed snart. Du kan starta om manuellt nedan.</div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleRestart}
                disabled={restarting}
                size="sm"
                variant={isStalled ? 'destructive' : 'outline'}
                className="font-mono text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> {restarting ? 'Startar…' : 'Restart Pipeline'}
              </Button>
            </div>

            <p className="text-[9px] text-muted-foreground">
              Heartbeat uppdateras var 30:e sekund av bootstrap-orchestrator. Watchdog (pg_cron, var 5:e min) failar jobb utan heartbeat &gt;15 min.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
