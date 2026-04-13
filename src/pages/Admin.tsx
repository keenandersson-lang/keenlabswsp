import { useMemo, useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, AlertTriangle, CheckCircle2, XCircle, Clock, Database, Shield, Zap, Loader2, Globe, BarChart3, Eye, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

function StatusBadge({ value }: { value: string }) {
  const n = value.toLowerCase();
  if (['published', 'canonical', 'completed', 'validated'].includes(n))
    return <Badge className="bg-signal-success/15 text-signal-success border-signal-success/30">{value}</Badge>;
  if (['failed'].includes(n))
    return <Badge className="bg-signal-danger/15 text-signal-danger border-signal-danger/30">{value}</Badge>;
  return <Badge variant="secondary">{value}</Badge>;
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm font-semibold mt-1 ${color ?? ''}`}>{value}</div>
    </div>
  );
}

function PctBar({ label, value, total, color = 'bg-primary' }: { label: string; value: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground">
        <span>{label}</span>
        <span className="text-foreground">{value.toLocaleString()} ({pct}%)</span>
      </div>
      <div className="mt-0.5 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Admin() {
  const queryClient = useQueryClient();
  const [syncSecret, setSyncSecret] = useState('');
  const [enrichState, setEnrichState] = useState<{
    running: boolean; offset: number; totalEnriched: number; totalFailed: number; totalPromoted: number; remaining: number | null; logs: string[]; done: boolean;
  }>({ running: false, offset: 0, totalEnriched: 0, totalFailed: 0, totalPromoted: 0, remaining: null, logs: [], done: false });
  const enrichAbortRef = useRef(false);
  const [dailySyncLog, setDailySyncLog] = useState<string | null>(null);
  const [scanLog, setScanLog] = useState<string | null>(null);
  const [backfillState, setBackfillState] = useState<{
    running: boolean; batchSize: number; logs: string[]; done: boolean;
  }>({ running: false, batchSize: 10, logs: [], done: false });

  // --- Data queries ---
  const { data: coverage } = useQuery<Record<string, number>>({
    queryKey: ['admin-coverage-detailed'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_universe_coverage_detailed');
      if (error) throw error;
      return data as Record<string, number>;
    },
    refetchInterval: 15_000,
  });

  const { data: unmappedIndustries = [] } = useQuery({
    queryKey: ['admin-unmapped-industries'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('symbols')
        .select('canonical_industry, canonical_sector')
        .eq('is_active', true)
        .or('canonical_industry.is.null,canonical_industry.eq.Other,canonical_industry.eq.Unknown,canonical_industry.eq.Unclassified,canonical_industry.eq.')
        .limit(1);
      // Just get count via coverage
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const { data: topUnmappedLabels = [] } = useQuery({
    queryKey: ['admin-top-unmapped-labels'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('symbols')
        .select('industry, canonical_industry, canonical_sector')
        .eq('is_active', true)
        .not('industry', 'is', null);
      if (error) throw error;
      // Group by raw industry label where canonical is missing/bad
      const counts: Record<string, { count: number; sector: string }> = {};
      for (const row of data ?? []) {
        const ci = row.canonical_industry;
        if (ci && !['Other', 'Unknown', 'Unclassified', ''].includes(ci)) continue;
        const label = row.industry || '(empty)';
        if (!counts[label]) counts[label] = { count: 0, sector: row.canonical_sector ?? '?' };
        counts[label].count++;
      }
      return Object.entries(counts)
        .map(([label, v]) => ({ label, count: v.count, sector: v.sector }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30);
    },
    staleTime: 60_000,
  });

  const { data: pipelineRuns = [] } = useQuery({
    queryKey: ['admin-pipeline-runs'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_equity_pipeline_console_runs', { p_limit: 10 });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 10_000,
  });

  const { data: latestScanRun } = useQuery({
    queryKey: ['admin-latest-scan-run'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('market_scan_runs')
        .select('id, scan_date, status, symbols_scanned, symbols_targeted, symbols_failed, started_at, completed_at, blocker_summary, stage_counts')
        .order('id', { ascending: false })
        .limit(1)
        .single();
      if (error) return null;
      return data;
    },
    refetchInterval: 10_000,
  });

  const { data: healthChecks = [] } = useQuery({
    queryKey: ['admin-health-checks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_health_checks')
        .select('*')
        .order('checked_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries();
    toast.success('Admin console refreshed');
  };

  const getBaseUrl = (fn: string) => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    return url ? `${String(url).replace(/\/$/, '')}/functions/v1/${fn}` : '';
  };

  const runBulkEnrich = useCallback(async () => {
    if (!syncSecret.trim()) { toast.error('Ange SYNC_SECRET_KEY först'); return; }
    enrichAbortRef.current = false;
    setEnrichState({ running: true, offset: 0, totalEnriched: 0, totalFailed: 0, totalPromoted: 0, remaining: null, logs: [], done: false });

    const baseUrl = getBaseUrl('bulk-enrich-sectors');
    if (!baseUrl) { toast.error('URL saknas'); setEnrichState(prev => ({ ...prev, running: false })); return; }

    let offset = 0, totalEnriched = 0, totalFailed = 0, totalPromoted = 0;
    const logs: string[] = [];
    const MAX = 15;

    for (let i = 0; i < 300; i++) {
      if (enrichAbortRef.current) { logs.push(`⏹ Stoppat`); break; }
      try {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${syncSecret.trim()}` },
          body: JSON.stringify({ offset, maxSymbols: MAX }),
        });
        if (!res.ok) { logs.push(`❌ HTTP ${res.status}`); break; }
        const data = await res.json();
        if (!data.ok && data.error) { logs.push(`❌ ${data.error}`); break; }
        totalEnriched += data.enriched ?? 0;
        totalFailed += data.failed ?? 0;
        totalPromoted += data.promoted ?? 0;
        logs.push(`✅ Batch ${i + 1}: +${data.enriched ?? 0} berikade, ${data.promoted ?? 0} promoted (${data.totalRemaining ?? '?'} kvar)`);
        setEnrichState({ running: true, offset: data.nextOffset ?? offset, totalEnriched, totalFailed, totalPromoted, remaining: data.totalRemaining ?? null, logs: [...logs], done: false });
        if (data.rateLimitAbort) { logs.push(`⚠️ Rate limit`); break; }
        if (data.done || !data.hasMore) { logs.push(`🏁 Klart! ${totalEnriched} berikade`); break; }
        offset = data.nextOffset ?? (offset + MAX);
      } catch (err) { logs.push(`❌ ${String(err).slice(0, 200)}`); break; }
    }
    setEnrichState(prev => ({ ...prev, running: false, done: true, logs: [...logs] }));
  }, [syncSecret]);

  const runPipelineAction = useCallback(async (path: string, label: string, setLog: (v: string) => void) => {
    if (!syncSecret.trim()) { toast.error('Ange SYNC_SECRET_KEY'); return; }
    const url = getBaseUrl(path);
    if (!url) { toast.error('URL saknas'); return; }
    toast.info(`Kör ${label}...`);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${syncSecret.trim()}` },
        body: JSON.stringify({ requested_by: 'admin' }),
      });
      const text = await res.text();
      setLog(text);
      if (res.ok) toast.success(`${label} startad`);
      else toast.error(`${label} misslyckades (HTTP ${res.status})`);
    } catch (err) {
      setLog(`Fel: ${String(err)}`);
      toast.error(`${label} misslyckades`);
    }
  }, [syncSecret]);

  const equityUniverse = coverage?.equity_universe ?? 0;

  return (
    <main className="container mx-auto p-4 space-y-4 max-w-7xl">
      <section className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold font-mono">WSP Operations Console</h1>
          <p className="text-sm text-muted-foreground font-mono">
            Admin-only: taxonomy, pipeline, coverage, and ops
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="password"
            placeholder="SYNC_SECRET_KEY"
            value={syncSecret}
            onChange={(e) => setSyncSecret(e.target.value)}
            className="max-w-[200px] font-mono text-xs"
          />
          <Button onClick={refresh} variant="outline" size="sm" className="font-mono text-xs">
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
        </div>
      </section>

      {/* A. UNIVERSE PIPELINE COVERAGE */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Globe className="h-4 w-4" /> A. Universe Pipeline Coverage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
            <Stat label="Aktiv Universe" value={String(coverage?.active_universe ?? '—')} />
            <Stat label="Equity (ej ETF)" value={String(equityUniverse)} />
            <Stat label="Core Tier" value={String(coverage?.core_tier ?? '—')} color="text-primary" />
            <Stat label="Expanded Tier" value={String(coverage?.expanded_tier ?? '—')} />
          </div>
          <div className="space-y-1.5">
            <PctBar label="Kanonisk Sektor" value={coverage?.canonically_mapped_sector ?? 0} total={equityUniverse} color="bg-primary" />
            <PctBar label="Kanonisk Industri" value={coverage?.canonically_mapped_industry ?? 0} total={equityUniverse} color="bg-primary" />
            <PctBar label="Prishistorik" value={coverage?.price_history_ready ?? 0} total={equityUniverse} color="bg-muted-foreground/50" />
            <PctBar label="Indikatorer" value={coverage?.indicator_ready ?? 0} total={equityUniverse} color="bg-muted-foreground/50" />
            <PctBar label="WSP-utvärderad" value={coverage?.wsp_evaluated ?? 0} total={equityUniverse} color="bg-muted-foreground/50" />
            <PctBar label="Publik Eligible (kanonisk)" value={coverage?.public_eligible ?? 0} total={equityUniverse} color="bg-signal-buy" />
          </div>
          {(coverage?.unmapped_industry_count ?? 0) > 0 && (
            <div className="flex items-center gap-2 text-xs font-mono text-signal-caution">
              <AlertTriangle className="h-3.5 w-3.5" />
              {coverage!.unmapped_industry_count.toLocaleString()} symboler saknar kanonisk industri — dold från publik screener/dashboard
            </div>
          )}
        </CardContent>
      </Card>

      {/* B. TAXONOMY AUDIT */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Layers className="h-4 w-4" /> B. Taxonomy Audit — Unmapped Industry Labels
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topUnmappedLabels.length === 0 ? (
            <p className="text-xs font-mono text-signal-success flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" /> Alla symboler har kanonisk industri.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-2 py-1">Raw Industry Label</th>
                    <th className="px-2 py-1">Sektor</th>
                    <th className="px-2 py-1 text-right">Antal</th>
                    <th className="px-2 py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {topUnmappedLabels.map((row) => (
                    <tr key={row.label} className="border-b border-border/30">
                      <td className="px-2 py-1 text-foreground">{row.label}</td>
                      <td className="px-2 py-1 text-muted-foreground">{row.sector}</td>
                      <td className="px-2 py-1 text-right text-foreground">{row.count}</td>
                      <td className="px-2 py-1">
                        <Badge variant="secondary" className="text-[9px]">UNMAPPED</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* C. LATEST SCAN RUN */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> C. Latest Market Scan
          </CardTitle>
        </CardHeader>
        <CardContent>
          {latestScanRun ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs font-mono">
              <Stat label="Run ID" value={`#${latestScanRun.id}`} />
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</div>
                <div className="mt-1"><StatusBadge value={latestScanRun.status} /></div>
              </div>
              <Stat label="Scan Date" value={latestScanRun.scan_date} />
              <Stat label="Scanned" value={`${latestScanRun.symbols_scanned}/${latestScanRun.symbols_targeted}`} />
              <Stat label="Failed" value={String(latestScanRun.symbols_failed)} color={latestScanRun.symbols_failed > 0 ? 'text-signal-danger' : ''} />
            </div>
          ) : (
            <p className="text-xs font-mono text-muted-foreground">Ingen scan-körning hittad.</p>
          )}
        </CardContent>
      </Card>

      {/* D. PIPELINE HEALTH CHECKS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Shield className="h-4 w-4" /> D. Pipeline Health Checks
          </CardTitle>
        </CardHeader>
        <CardContent>
          {healthChecks.length === 0 ? (
            <p className="text-xs font-mono text-muted-foreground">Inga hälsokontroller ännu.</p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1">
              {healthChecks.slice(0, 10).map((hc: any) => (
                <div key={hc.id} className="flex items-center gap-2 text-xs font-mono border-b border-border/30 py-1">
                  {hc.status === 'pass' ? <CheckCircle2 className="h-3 w-3 text-signal-success" /> :
                   hc.status === 'warn' ? <AlertTriangle className="h-3 w-3 text-signal-caution" /> :
                   <XCircle className="h-3 w-3 text-signal-danger" />}
                  <span className="text-muted-foreground w-40 truncate">{hc.check_name}</span>
                  <span className="text-foreground flex-1 truncate">{hc.message}</span>
                  <span className="text-muted-foreground text-[9px]">{new Date(hc.checked_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* E. PIPELINE RUNS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono">E. Pipeline Runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pipelineRuns.slice(0, 5).map((run: any) => (
            <div key={run.id} className="border rounded p-2 text-xs font-mono grid grid-cols-2 md:grid-cols-5 gap-2">
              <Stat label="Type" value={run.run_type} />
              <Stat label="Step" value={run.current_step ?? '—'} />
              <Stat label="Started" value={new Date(run.started_at).toLocaleString()} />
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</div>
                <div className="mt-1"><StatusBadge value={run.status} /></div>
              </div>
              <Stat label="Error" value={run.error_summary ?? '—'} />
            </div>
          ))}
          {pipelineRuns.length === 0 && (
            <p className="text-xs text-muted-foreground font-mono flex items-center gap-1"><Clock className="h-3 w-3" /> Inga pipeline-körningar ännu.</p>
          )}
        </CardContent>
      </Card>

      {/* F. OPS ACTIONS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2"><Zap className="h-4 w-4" /> F. Operations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Daily Sync */}
          <div className="space-y-2">
            <h4 className="text-xs font-mono font-bold">Daily Price Sync (Polygon)</h4>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => runPipelineAction('admin-pipeline/daily-sync', 'Daily Sync', setDailySyncLog)} disabled={!syncSecret.trim()} size="sm" className="font-mono text-xs">
                <Zap className="h-3 w-3 mr-1" /> Kör Daily Sync
              </Button>
              <Button onClick={() => runPipelineAction('scan-market', 'Market Scan', setScanLog)} disabled={!syncSecret.trim()} size="sm" variant="outline" className="font-mono text-xs">
                <RefreshCw className="h-3 w-3 mr-1" /> Kör Market Scan
              </Button>
              <Button onClick={() => runPipelineAction('admin-pipeline/backfill', 'Yahoo Backfill', (v) => setBackfillState(prev => ({ ...prev, logs: [v], done: true })))} disabled={!syncSecret.trim()} size="sm" variant="outline" className="font-mono text-xs">
                <Database className="h-3 w-3 mr-1" /> Kör Yahoo Backfill
              </Button>
            </div>
            {dailySyncLog && <pre className="max-h-32 overflow-y-auto rounded border bg-background p-2 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap">{dailySyncLog}</pre>}
            {scanLog && <pre className="max-h-32 overflow-y-auto rounded border bg-background p-2 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap">{scanLog}</pre>}
            {backfillState.logs.length > 0 && <pre className="max-h-32 overflow-y-auto rounded border bg-background p-2 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap">{backfillState.logs.join('\n')}</pre>}
          </div>

          {/* Bulk Enrich */}
          <div className="space-y-2">
            <h4 className="text-xs font-mono font-bold">Bulk Metadata Enrichment (Polygon)</h4>
            <div className="flex items-center gap-2">
              <Button onClick={runBulkEnrich} disabled={enrichState.running || !syncSecret.trim()} size="sm" className="font-mono text-xs">
                {enrichState.running ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Kör...</> : <><Zap className="h-3 w-3 mr-1" /> Starta Bulk Enrich</>}
              </Button>
              {enrichState.running && (
                <Button onClick={() => { enrichAbortRef.current = true; }} variant="destructive" size="sm" className="font-mono text-xs">Stoppa</Button>
              )}
            </div>
            {(enrichState.totalEnriched > 0 || enrichState.running) && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
                <Stat label="Berikade" value={String(enrichState.totalEnriched)} />
                <Stat label="Promoted" value={String(enrichState.totalPromoted)} />
                <Stat label="Fel" value={String(enrichState.totalFailed)} />
                <Stat label="Kvar" value={enrichState.remaining !== null ? String(enrichState.remaining) : '—'} />
              </div>
            )}
            {enrichState.logs.length > 0 && (
              <pre className="max-h-32 overflow-y-auto rounded border bg-background p-2 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap">{enrichState.logs.join('\n')}</pre>
            )}
          </div>
        </CardContent>
      </Card>

      {/* G. AUTOMATION STATUS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2"><Clock className="h-4 w-4" /> G. Automation / Scheduled Jobs</CardTitle>
        </CardHeader>
        <CardContent className="text-xs font-mono space-y-1.5">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-signal-success" /> daily-sync — daglig prissync kl 21:30 UTC (Polygon grouped daily)</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-signal-success" /> yahoo-backfill — daglig historik (50 symboler/batch)</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-signal-success" /> enrich-symbols — löpande metadata-enrichment (pausad 21:25–21:49 UTC)</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-signal-success" /> scan-market — broad market scan efter daily-sync</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-signal-success" /> pipeline-health — hälsokontroll var 2:a timme</div>
          <p className="mt-2 text-muted-foreground">
            Pipeline: sync → enrich → indicators → scan → validate → publicera (automatisk om valid).
            Publik snapshot uppdateras aldrig utan validerad scan.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
