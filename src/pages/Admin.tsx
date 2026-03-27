import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Database, RefreshCw, Download, Sprout, CheckCircle2,
  XCircle, AlertTriangle, Clock, Server, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

type RunningType = 'daily' | 'backfill' | 'seed' | 'enrich' | null;

export default function Admin() {
  const [running, setRunning] = useState<RunningType>(null);
  const [syncKey, setSyncKey] = useState('');
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const [priceRes, symbolRes, logRes, earliestRes, latestRes] = await Promise.all([
        supabase.from('daily_prices').select('*', { count: 'exact', head: true }),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase
          .from('data_sync_log')
          .select('*')
          .order('started_at', { ascending: false })
          .limit(20),
        supabase
          .from('daily_prices')
          .select('date')
          .order('date', { ascending: true })
          .limit(1),
        supabase
          .from('daily_prices')
          .select('date')
          .order('date', { ascending: false })
          .limit(1),
      ]);
      return {
        priceCount: priceRes.count ?? 0,
        symbolCount: symbolRes.count ?? 0,
        syncLog: logRes.data ?? [],
        earliest: earliestRes.data?.[0]?.date ?? null,
        latest: latestRes.data?.[0]?.date ?? null,
      };
    },
    refetchInterval: 15000,
  });

  const invokeFunction = async (fnName: string, body: Record<string, unknown> = {}) => {
    if (!syncKey) {
      toast.error('Ange SYNC_SECRET_KEY först');
      return;
    }
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const url = `https://${projectId}.supabase.co/functions/v1/${fnName}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${syncKey}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error(`${fnName} misslyckades: ${data.error || res.statusText}`);
      } else {
        toast.success(`${fnName} klart!`, { description: JSON.stringify(data).slice(0, 100) });
      }
      return data;
    } catch (err) {
      toast.error(`Nätverksfel: ${String(err)}`);
    }
  };

  const runSeed = async () => {
    setRunning('seed');
    await invokeFunction('seed-symbols');
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    setRunning(null);
  };

  const runDailySync = async () => {
    setRunning('daily');
    await invokeFunction('daily-sync');
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    setRunning(null);
  };

  const [enrichProgress, setEnrichProgress] = useState({
    offset: 0, enriched: 0, promoted: 0, failed: 0, running: false,
    promotions: [] as string[],
  });

  const runEnrich = async () => {
    setRunning('enrich');
    const batchSize = 20;
    let offset = 0;
    let totalEnriched = 0;
    let totalPromoted = 0;
    let totalFailed = 0;
    let allPromotions: string[] = [];
    let hasMore = true;

    toast.info('Metadata enrichment startat');
    setEnrichProgress({ offset: 0, enriched: 0, promoted: 0, failed: 0, running: true, promotions: [] });

    while (hasMore) {
      try {
        const data = await invokeFunction('enrich-symbols', { batchSize, offset });
        if (!data || data.error) {
          toast.error(`Enrichment stoppat: ${data?.error || 'No response'}`);
          break;
        }
        totalEnriched += data.enriched ?? 0;
        totalPromoted += data.promoted ?? 0;
        totalFailed += data.failed ?? 0;
        if (data.promotions) allPromotions = [...allPromotions, ...data.promotions];
        hasMore = data.hasMore === true;
        offset = data.nextOffset ?? offset + batchSize;
        setEnrichProgress({
          offset, enriched: totalEnriched, promoted: totalPromoted,
          failed: totalFailed, running: hasMore, promotions: allPromotions.slice(0, 50),
        });
        if (offset % 100 === 0) queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      } catch (err) {
        toast.error(`Enrichment nätverksfel vid offset ${offset}`);
        break;
      }
    }

    if (!hasMore) {
      toast.success(`Enrichment klart! ${totalEnriched} berikade, ${totalPromoted} promoted till full WSP.`);
    }
    setEnrichProgress(prev => ({ ...prev, running: false }));
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    setRunning(null);
  };

  const [backfillProgress, setBackfillProgress] = useState({
    offset: 0, total: 0, fetched: 0, failed: 0, running: false,
    rowsWritten: 0, lastError: '', failureCounts: {} as Record<string, number>,
    stopped: false, stopReason: '',
  });
  const [resumeOffset, setResumeOffset] = useState(0);
  const [backfillStopped, setBackfillStopped] = useState(false);

  const runBackfill = async (startOffset = 0) => {
    setRunning('backfill');
    setBackfillStopped(false);
    const batchSize = 20;
    let offset = startOffset;
    let totalFetched = 0;
    let totalFailed = 0;
    let hasMore = true;
    let totalRowsWritten = 0;
    let allFailureCounts: Record<string, number> = {};

    toast.info(`Backfill startat från offset ${startOffset}`);
    setBackfillProgress({ offset: startOffset, total: stats?.symbolCount ?? 0, fetched: 0, failed: 0, running: true, rowsWritten: 0, lastError: '', failureCounts: {}, stopped: false, stopReason: '' });

    while (hasMore) {
      try {
        const data = await invokeFunction('historical-backfill', { yearsBack: 5, batchSize, offset });
        if (!data) {
          setBackfillProgress(prev => ({ ...prev, running: false, stopped: true, stopReason: 'No response from edge function' }));
          break;
        }
        if (data.error) {
          setBackfillProgress(prev => ({ ...prev, running: false, stopped: true, stopReason: data.error }));
          toast.error(`Backfill stoppat vid offset ${offset}: ${data.error}`);
          break;
        }
        totalFetched += data.fetched ?? 0;
        totalFailed += data.failed ?? 0;
        totalRowsWritten += data.rowsWritten ?? data.fetched ?? 0;
        // Merge failure counts
        if (data.failureCounts) {
          for (const [k, v] of Object.entries(data.failureCounts)) {
            allFailureCounts[k] = (allFailureCounts[k] ?? 0) + (v as number);
          }
        }
        hasMore = data.hasMore === true;
        offset = data.nextOffset ?? offset + batchSize;
        setResumeOffset(offset);
        setBackfillProgress({
          offset, total: stats?.symbolCount ?? 0,
          fetched: totalFetched, failed: totalFailed, running: hasMore,
          rowsWritten: totalRowsWritten, lastError: '',
          failureCounts: allFailureCounts, stopped: false, stopReason: '',
        });

        if (offset % 100 === 0) {
          queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
        }
      } catch (err) {
        const errMsg = String(err);
        setBackfillProgress(prev => ({ ...prev, running: false, stopped: true, stopReason: `Network: ${errMsg}` }));
        toast.error(`Backfill nätverksfel vid offset ${offset}`);
        break;
      }
    }

    if (hasMore === false) {
      toast.success(`Backfill klart! ${totalFetched} symboler, ${totalRowsWritten} rader skrivna, ${totalFailed} misslyckade.`);
    }
    setBackfillProgress(prev => ({ ...prev, running: false }));
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    setRunning(null);
  };

  const statusIcon = (status: string) => {
    if (status === 'success') return <CheckCircle2 className="h-4 w-4 text-primary" />;
    if (status === 'partial') return <AlertTriangle className="h-4 w-4 text-signal-caution" />;
    if (status === 'running') return <RefreshCw className="h-4 w-4 text-primary animate-spin" />;
    return <XCircle className="h-4 w-4 text-signal-danger" />;
  };

  return (
    <div className="space-y-6 px-4 py-6 max-w-5xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-3">
        <Server className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground font-mono tracking-wider">WSP DATA ADMIN</h1>
      </div>

      {/* Sync Key Input */}
      <Card className="bg-card border-border">
        <CardContent className="pt-4">
          <label className="text-xs font-mono text-muted-foreground block mb-1">SYNC SECRET KEY</label>
          <input
            type="password"
            value={syncKey}
            onChange={(e) => setSyncKey(e.target.value)}
            placeholder="Klistra in din SYNC_SECRET_KEY..."
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </CardContent>
      </Card>

      {/* Data Source */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono tracking-wider text-muted-foreground flex items-center gap-2">
            <Database className="h-4 w-4" />
            DATAKÄLLA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-primary text-primary font-mono text-xs">
              Polygon.io ✅
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">Full volym · Alla US-börser</span>
          </div>
        </CardContent>
      </Card>

      {/* Database Status */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono tracking-wider text-muted-foreground flex items-center gap-2">
            <Database className="h-4 w-4" />
            DATABASSTATUS
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatBox label="Symboler" value={stats?.symbolCount?.toLocaleString() ?? '—'} />
            <StatBox label="Prisrader" value={stats?.priceCount?.toLocaleString() ?? '—'} />
            <StatBox label="Earliest" value={stats?.earliest ?? '—'} />
            <StatBox label="Latest" value={stats?.latest ?? '—'} />
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono tracking-wider text-muted-foreground">
            ⚡ KONTROLLER
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={runSeed}
              disabled={running !== null}
              variant="outline"
              className="font-mono text-xs"
            >
              <Sprout className="h-4 w-4 mr-2" />
              {running === 'seed' ? 'Seedar...' : 'Seed symbol-lista'}
            </Button>

            <Button
              onClick={runDailySync}
              disabled={running !== null}
              variant="outline"
              className="font-mono text-xs"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${running === 'daily' ? 'animate-spin' : ''}`} />
              {running === 'daily' ? 'Synkar...' : 'Kör daglig sync'}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  disabled={running !== null}
                  variant="outline"
                  className="font-mono text-xs"
                >
                  <Download className="h-4 w-4 mr-2" />
                  {running === 'backfill' ? 'Backfill pågår...' : 'Starta backfill'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Starta historisk backfill?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Detta laddar 5 år historisk data för alla symboler via Polygon.io.
                    Det tar 30–60 minuter beroende på antal symboler.
                    Processen körs i bakgrunden.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Avbryt</AlertDialogCancel>
                  <AlertDialogAction onClick={() => runBackfill(0)}>Starta backfill</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  disabled={running !== null}
                  variant="outline"
                  className="font-mono text-xs"
                >
                  <Zap className="h-4 w-4 mr-2" />
                  {running === 'enrich' ? 'Enrichment pågår...' : 'Berika metadata'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Berika symbol-metadata?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Hämtar sektor, bransch och instrumenttyp från Polygon ticker details
                    för alla ej berikade symboler. Rate-limited till 5 req/min.
                    Tar ~30 min per 100 symboler.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Avbryt</AlertDialogCancel>
                  <AlertDialogAction onClick={runEnrich}>Starta enrichment</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {/* Resume from offset */}
          {!running && resumeOffset > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs font-mono text-muted-foreground">Resume från offset:</span>
              <input
                type="number"
                value={resumeOffset}
                onChange={(e) => setResumeOffset(Number(e.target.value))}
                className="w-24 bg-muted border border-border rounded px-2 py-1 text-xs font-mono text-foreground"
              />
              <Button onClick={() => runBackfill(resumeOffset)} variant="outline" size="sm" className="font-mono text-xs">
                Fortsätt backfill
              </Button>
            </div>
          )}

          {running && (
            <div className="space-y-1 mt-2">
              <div className="flex items-center gap-2 text-xs text-primary font-mono">
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span>
                  {running === 'backfill'
                    ? `Offset ${backfillProgress.offset} / ~${backfillProgress.total} · ${backfillProgress.fetched} hämtade · ${backfillProgress.rowsWritten} rader skrivna · ${backfillProgress.failed} misslyckade`
                    : running === 'enrich'
                    ? `Offset ${enrichProgress.offset} · ${enrichProgress.enriched} berikade · ${enrichProgress.promoted} promoted · ${enrichProgress.failed} misslyckade`
                    : 'Bearbetar...'}
                </span>
              </div>
              {running === 'backfill' && Object.keys(backfillProgress.failureCounts).some(k => (backfillProgress.failureCounts[k] ?? 0) > 0) && (
                <div className="text-[10px] font-mono text-muted-foreground ml-5">
                  {Object.entries(backfillProgress.failureCounts).filter(([,v]) => v > 0).map(([k,v]) => `${k}: ${v}`).join(' · ')}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync Log */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono tracking-wider text-muted-foreground flex items-center gap-2">
            <Clock className="h-4 w-4" />
            SYNC-LOGG (senaste 20)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats?.syncLog?.length === 0 ? (
            <p className="text-xs text-muted-foreground font-mono">Inga synkningar ännu.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 pr-4">Datum</th>
                    <th className="text-left py-2 pr-4">Typ</th>
                    <th className="text-left py-2 pr-4">Status</th>
                    <th className="text-left py-2 pr-4">Symboler</th>
                    <th className="text-left py-2">Tid</th>
                  </tr>
                </thead>
                <tbody>
                  {stats?.syncLog?.map((log: any) => (
                    <tr key={log.id} className="border-b border-border/50">
                      <td className="py-2 pr-4 text-foreground">
                        {log.started_at ? new Date(log.started_at).toLocaleDateString('sv-SE') : '—'}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {log.sync_type}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-1">
                          {statusIcon(log.status)}
                          <span className="text-foreground">{log.status}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-foreground">
                        {log.symbols_processed ?? 0}/{(log.metadata as any)?.symbols_total ?? '?'}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {log.started_at
                          ? new Date(log.started_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
                          : '—'}
                        {log.completed_at && (
                          <> – {new Date(log.completed_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}</>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted rounded-lg p-3">
      <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold text-foreground font-mono mt-1">{value}</p>
    </div>
  );
}
