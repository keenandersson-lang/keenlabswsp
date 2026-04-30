import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Workflow, ArrowRight, CheckCircle2, Loader2, ChevronDown, ChevronRight } from 'lucide-react';

type ModuleName = 'api-data-collector' | 'universe-scan' | 'gics-classifier';

interface Checkpoint {
  step: string;
  status: string;
  rows_in: number | null;
  rows_out: number | null;
  at: string;
  meta?: Record<string, unknown>;
}

interface RunInfo {
  id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  input_count: number;
  output_count: number;
  failed_count: number;
  error_message: string | null;
  source: string | null;
}

interface ModuleSummary {
  last_success: RunInfo | null;
  last_error: RunInfo | null;
  currently_running: number;
  runs_24h: number;
  success_rate_24h: number | null;
}

type Dataflow = Record<ModuleName, ModuleSummary>;

const MODULES: { name: ModuleName; label: string; input: string; output: string }[] = [
  { name: 'api-data-collector', label: '1. API Data Collector', input: 'Polygon reference', output: 'symbols upsert' },
  { name: 'universe-scan', label: '2. Universe Scan', input: 'symbols (active)', output: 'wsp_eligible_universe' },
  { name: 'gics-classifier', label: '3. GICS Classifier', input: 'unclassified symbols', output: 'canonical_sector + industry' },
];

function fmtAge(ts: string | null | undefined): string {
  if (!ts) return '—';
  const ms = Date.now() - new Date(ts).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just nu';
  if (min < 60) return `${min}m sedan`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h sedan`;
  return `${Math.floor(hr / 24)}d sedan`;
}

function CheckpointList({ moduleName }: { moduleName: ModuleName }) {
  const { data: checkpoints } = useQuery<Checkpoint[]>({
    queryKey: ['module-checkpoints', moduleName],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('module_runs')
        .select('checkpoints')
        .eq('module_name', moduleName)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const cps = (data as unknown as { checkpoints?: Checkpoint[] } | null)?.checkpoints ?? [];
      return Array.isArray(cps) ? cps : [];
    },
    refetchInterval: 30_000,
  });
  if (!checkpoints || checkpoints.length === 0) {
    return <div className="text-[10px] font-mono text-muted-foreground italic mt-1.5">Inga checkpoints loggade ännu.</div>;
  }
  return (
    <div className="space-y-0.5 mt-1.5 border-t border-border pt-1.5">
      {checkpoints.map((cp, i) => {
        const ok = cp.status === 'ok';
        const err = cp.status === 'error' || cp.status === 'mismatch';
        const color = ok ? 'text-signal-success' : err ? 'text-signal-danger' : 'text-signal-caution';
        return (
          <div key={i} className="flex items-center gap-1.5 text-[10px] font-mono">
            <span className={`${color} w-14 shrink-0 uppercase`}>{cp.status}</span>
            <span className="flex-1 truncate text-foreground" title={cp.step}>{cp.step}</span>
            <span className="text-muted-foreground tabular-nums">
              {cp.rows_in ?? '—'}→{cp.rows_out ?? '—'}
            </span>
            <span className="text-muted-foreground text-[9px] w-14 text-right">
              {cp.at?.slice(11, 19) ?? ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function DataflowTrackerWidget() {
  const [expanded, setExpanded] = useState<Set<ModuleName>>(new Set());
  const toggle = (m: ModuleName) => {
    const next = new Set(expanded);
    if (next.has(m)) next.delete(m); else next.add(m);
    setExpanded(next);
  };

  const { data, isLoading } = useQuery<Dataflow | null>({
    queryKey: ['module-dataflow'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_module_dataflow');
      if (error) throw error;
      return data as Dataflow;
    },
    refetchInterval: 30_000,
  });

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Workflow className="w-4 h-4 text-primary" />
          Module Dataflow Tracker
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-1.5">
            {MODULES.map((mod, idx) => {
              const summary = data?.[mod.name];
              const running = (summary?.currently_running ?? 0) > 0;
              const lastSuccess = summary?.last_success;
              const lastError = summary?.last_error;
              const successRate = summary?.success_rate_24h;
              return (
                <div key={mod.name}>
                  <div className="rounded border border-border p-2 bg-card">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">{mod.label}</span>
                        {running ? (
                          <Badge className="bg-primary/15 text-primary border-primary/30 text-[9px] h-4 px-1.5"><Loader2 className="w-2.5 h-2.5 animate-spin mr-1" />RUNNING</Badge>
                        ) : lastSuccess ? (
                          <Badge className="bg-signal-success/15 text-signal-success border-signal-success/30 text-[9px] h-4 px-1.5"><CheckCircle2 className="w-2.5 h-2.5 mr-1" />OK</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[9px] h-4 px-1.5">IDLE</Badge>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {summary?.runs_24h ?? 0} runs / 24h{successRate !== null && successRate !== undefined ? ` · ${successRate}% ok` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground mb-1">
                      <span>{mod.input}</span>
                      <ArrowRight className="w-2.5 h-2.5" />
                      <span className="text-foreground">{mod.output}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                      <div className="bg-muted/50 rounded px-1.5 py-1">
                        <span className="text-muted-foreground">Last success: </span>
                        <span className="text-signal-success">{fmtAge(lastSuccess?.finished_at)}</span>
                        {lastSuccess && (
                          <span className="text-foreground"> ({lastSuccess.input_count}→{lastSuccess.output_count})</span>
                        )}
                      </div>
                      <div className="bg-muted/50 rounded px-1.5 py-1">
                        <span className="text-muted-foreground">Last error: </span>
                        {lastError ? (
                          <>
                            <span className="text-signal-danger">{fmtAge(lastError.started_at)}</span>
                            {lastError.error_message && (
                              <span className="text-muted-foreground" title={lastError.error_message}> · {lastError.error_message.slice(0, 40)}…</span>
                            )}
                          </>
                        ) : (
                          <span className="text-signal-success">none</span>
                        )}
                      </div>
                    </div>
                    {lastSuccess?.source && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        Source: <span className="font-mono text-foreground">{lastSuccess.source}</span>
                      </div>
                    )}
                    <button
                      onClick={() => toggle(mod.name)}
                      className="mt-1 flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                    >
                      {expanded.has(mod.name) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      Checkpoints (latest run)
                    </button>
                    {expanded.has(mod.name) && <CheckpointList moduleName={mod.name} />}
                  </div>
                  {idx < MODULES.length - 1 && (
                    <div className="flex justify-center py-0.5">
                      <ArrowRight className="w-3 h-3 text-muted-foreground rotate-90" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
