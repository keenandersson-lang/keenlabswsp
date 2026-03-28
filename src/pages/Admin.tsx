import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Database, RefreshCw, Download, Sprout, CheckCircle2,
  XCircle, AlertTriangle, Clock, Server, Zap, Shield, Calendar,
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

type RunningType = 'daily' | 'backfill' | 'backfill_date' | 'seed' | 'enrich' | null;

const TIER1_SYMBOLS = [
  'SPY','QQQ','DIA','IWM',
  'XLK','XLV','XLF','XLE','XLY','XLI','XLC','XLP','XLB','XLRE','XLU',
  'AAPL','MSFT','NVDA','AVGO','AMD','ORCL','CRM',
  'GOOGL','META','NFLX','DIS','TMUS','VZ',
  'AMZN','TSLA','HD','MCD','NKE','BKNG',
  'COST','WMT','PG','KO','PEP','PM',
  'JPM','BAC','WFC','V','MA',
  'LLY','UNH','JNJ','ABBV','MRK','ISRG',
  'CAT','BA','GE','HON','UPS','DE',
  'XOM','CVX','COP','SLB','EOG',
  'LIN','APD','ECL','NUE','DD',
  'PLD','AMT','EQIX','O',
  'NEE','SO','DUK','SRE',
  'GLD','SLV','COPX','GDX','NEM','FCX','PPLT',
];

const BENCHMARKS = new Set(['SPY','QQQ','DIA','IWM','XLK','XLV','XLF','XLE','XLY','XLI','XLC','XLP','XLB','XLRE','XLU']);
const METALS_ETFS = new Set(['GLD','SLV','COPX','GDX','PPLT']);

export default function Admin() {
  const [running, setRunning] = useState<RunningType>(null);
  const [syncKey, setSyncKey] = useState('');
  const queryClient = useQueryClient();

  // ── Core stats from existing tables ──
  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const [priceRes, symbolRes, logRes, earliestRes, latestRes, enrichedRes] = await Promise.all([
        supabase.from('daily_prices').select('*', { count: 'exact', head: true }),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase
          .from('data_sync_log')
          .select('*')
          .order('started_at', { ascending: false })
          .limit(20),
        supabase.from('daily_prices').select('date').order('date', { ascending: true }).limit(1),
        supabase.from('daily_prices').select('date').order('date', { ascending: false }).limit(1),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true).not('enriched_at', 'is', null),
      ]);
      return {
        priceCount: priceRes.count ?? 0,
        symbolCount: symbolRes.count ?? 0,
        syncLog: logRes.data ?? [],
        earliest: earliestRes.data?.[0]?.date ?? null,
        latest: latestRes.data?.[0]?.date ?? null,
        enrichedCount: enrichedRes.count ?? 0,
      };
    },
    refetchInterval: 15000,
  });

  // ── Tier 1 readiness (uses only existing tables) ──
  const { data: tier1Status } = useQuery({
    queryKey: ['tier1-readiness'],
    queryFn: async () => {
      // Get symbol metadata for Tier 1
      const { data: symbols } = await supabase
        .from('symbols')
        .select('symbol, sector, industry, instrument_type, is_etf, exchange, enriched_at, is_active')
        .in('symbol', TIER1_SYMBOLS);

      // Get bar counts per Tier 1 symbol from daily_prices
      const { data: barData } = await supabase
        .from('daily_prices')
        .select('symbol, date')
        .in('symbol', TIER1_SYMBOLS);

      const barCounts: Record<string, number> = {};
      (barData ?? []).forEach((r) => {
        barCounts[r.symbol] = (barCounts[r.symbol] ?? 0) + 1;
      });

      let fullWsp = 0, limited = 0, proxy = 0, metals = 0;
      let enriched = 0;
      const missingIndustry: string[] = [];
      const missingSector: string[] = [];

      (symbols ?? []).forEach((s) => {
        if (s.enriched_at) enriched++;
        if (BENCHMARKS.has(s.symbol)) { proxy++; return; }
        if (METALS_ETFS.has(s.symbol) || s.symbol === 'NEM' || s.symbol === 'FCX') { metals++; return; }
        if (s.instrument_type === 'CS' && s.sector && s.sector !== 'Unknown' && s.industry) {
          fullWsp++;
        } else {
          limited++;
          if (!s.industry) missingIndustry.push(s.symbol);
          if (!s.sector || s.sector === 'Unknown') missingSector.push(s.symbol);
        }
      });

      let analysisReady = 0;
      let backfilledButNotReady = 0;
      const withPrices = new Set<string>();

      TIER1_SYMBOLS.forEach((sym) => {
        const bars = barCounts[sym] ?? 0;
        if (bars > 0) withPrices.add(sym);
        if (bars >= 200) analysisReady++;
        else if (bars > 0) backfilledButNotReady++;
      });

      return {
        total: symbols?.length ?? 0,
        enriched,
        fullWsp,
        limited,
        proxy,
        metals,
        withPrices: withPrices.size,
        analysisReady,
        backfilledButNotReady,
        noPrices: TIER1_SYMBOLS.filter(s => !withPrices.has(s)),
        missingIndustry,
        missingSector,
        barCounts,
      };
    },
    refetchInterval: 30000,
  });

  const invokeFunction = async (fnName: string, body: Record<string, unknown> = {}) => {
    if (!syncKey) {
      toast.error('Ange SYNC_SECRET_KEY först');
      return null;
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
      const responseText = await res.text();
      let data: Record<string, any> = {};
      if (responseText) {
        try { data = JSON.parse(responseText); } catch {
          data = { ok: false, error: `Invalid JSON (${res.status})`, raw: responseText.slice(0, 300) };
        }
      }
      if (!res.ok || data.error) {
        toast.error(`${fnName} misslyckades: ${data?.error || res.statusText}`);
        return data;
      }
      toast.success(`${fnName} klart!`, { description: JSON.stringify(data).slice(0, 100) });
      return data;
    } catch (err) {
      toast.error(`Nätverksfel: ${String(err)}`);
      return null;
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

  // ── Per-symbol backfill (existing) ──
  const [backfillProgress, setBackfillProgress] = useState({
    offset: 0, total: 0, fetched: 0, failed: 0, running: false,
    rowsWritten: 0, failureCounts: {} as Record<string, number>,
    stopped: false, stopReason: '',
  });
  const [resumeOffset, setResumeOffset] = useState(0);

  const runBackfill = async (startOffset = 0, tier1Only = true) => {
    setRunning('backfill');
    const batchSize = 10;
    let offset = startOffset;
    let totalFetched = 0, totalFailed = 0, totalRowsWritten = 0;
    let allFailureCounts: Record<string, number> = {};
    let hasMore = true;

    toast.info(`Tier 1 backfill startat från offset ${startOffset}`);
    setBackfillProgress({ offset: startOffset, total: TIER1_SYMBOLS.length, fetched: 0, failed: 0, running: true, rowsWritten: 0, failureCounts: {}, stopped: false, stopReason: '' });

    while (hasMore) {
      try {
        const data = await invokeFunction('historical-backfill', {
          yearsBack: 5, batchSize, offset, tier1Only, sleepBetweenMs: 13000,
        });
        if (!data) { setBackfillProgress(prev => ({ ...prev, running: false, stopped: true, stopReason: 'No response' })); break; }
        if (data.error) { setBackfillProgress(prev => ({ ...prev, running: false, stopped: true, stopReason: data.error })); break; }
        totalFetched += data.fetched ?? 0;
        totalFailed += data.failed ?? 0;
        totalRowsWritten += data.rowsWritten ?? data.fetched ?? 0;
        if (data.failureCounts) {
          for (const [k, v] of Object.entries(data.failureCounts)) {
            allFailureCounts[k] = (allFailureCounts[k] ?? 0) + (v as number);
          }
        }
        hasMore = data.hasMore === true;
        offset = data.nextOffset ?? offset + batchSize;
        setResumeOffset(offset);
        setBackfillProgress({
          offset, total: TIER1_SYMBOLS.length, fetched: totalFetched, failed: totalFailed,
          running: hasMore, rowsWritten: totalRowsWritten, failureCounts: allFailureCounts, stopped: false, stopReason: '',
        });
      } catch (err) {
        setBackfillProgress(prev => ({ ...prev, running: false, stopped: true, stopReason: String(err) }));
        break;
      }
    }
    if (!hasMore) toast.success(`Backfill klart! ${totalFetched} symboler, ${totalRowsWritten} rader.`);
    setBackfillProgress(prev => ({ ...prev, running: false }));
    queryClient.invalidateQueries({ queryKey: ['admin-stats', 'tier1-readiness'] });
    setRunning(null);
  };

  // ── Date-based backfill (Polygon grouped endpoint) ──
  const [dateBackfillProgress, setDateBackfillProgress] = useState({
    currentDate: '', completedDays: 0, totalDays: 0, totalRows: 0, running: false, lastError: '',
  });

  const runDateBackfill = async () => {
    setRunning('backfill_date');
    const totalDays = 504; // ~2 years of trading days
    let completedDays = 0;
    let totalRows = 0;

    setDateBackfillProgress({ currentDate: '', completedDays: 0, totalDays, totalRows: 0, running: true, lastError: '' });

    // Find the last backfilled date to resume from
    const resumeData = await invokeFunction('historical-backfill', { mode: 'date_backfill', action: 'status' });
    const lastDate = resumeData?.lastBackfilledDate;

    const data = await invokeFunction('historical-backfill', {
      mode: 'date_backfill',
      action: 'run',
      daysPerBatch: 5,
      resumeFrom: lastDate || null,
    });

    if (data) {
      completedDays = data.completedDays ?? 0;
      totalRows = data.totalRows ?? 0;
      setDateBackfillProgress({
        currentDate: data.lastDate ?? '',
        completedDays,
        totalDays,
        totalRows,
        running: false,
        lastError: data.error ?? '',
      });
    }

    queryClient.invalidateQueries({ queryKey: ['admin-stats', 'tier1-readiness'] });
    setRunning(null);
  };

  // ── Enrichment ──
  const [enrichProgress, setEnrichProgress] = useState({
    offset: 0, enriched: 0, failed: 0, running: false, tier: '',
  });

  const runEnrich = async (tier: string) => {
    setRunning('enrich');
    const batchSize = 20;
    let offset = 0;
    let totalEnriched = 0, totalFailed = 0;
    let hasMore = true;

    setEnrichProgress({ offset: 0, enriched: 0, failed: 0, running: true, tier });

    while (hasMore) {
      try {
        const data = await invokeFunction('enrich-symbols', { batchSize, offset, tier });
        if (!data || data.error) { toast.error(`Enrichment stoppat: ${data?.error || 'No response'}`); break; }
        totalEnriched += data.enriched ?? 0;
        totalFailed += data.failed ?? 0;
        hasMore = data.hasMore === true;
        offset = data.nextOffset ?? offset + batchSize;
        setEnrichProgress({ offset, enriched: totalEnriched, failed: totalFailed, running: hasMore, tier });
      } catch {
        toast.error(`Enrichment nätverksfel vid offset ${offset}`);
        break;
      }
    }

    if (!hasMore) toast.success(`Enrichment klart! ${totalEnriched} berikade.`);
    setEnrichProgress(prev => ({ ...prev, running: false }));
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    setRunning(null);
  };

  const statusIcon = (status: string) => {
    if (status === 'success') return <CheckCircle2 className="h-4 w-4 text-primary" />;
    if (status === 'partial') return <AlertTriangle className="h-4 w-4 text-signal-caution" />;
    if (status === 'running') return <RefreshCw className="h-4 w-4 text-primary animate-spin" />;
    return <XCircle className="h-4 w-4 text-signal-danger" />;
  };

  const t1 = tier1Status;

  return (
    <div className="space-y-6 px-4 py-6 max-w-5xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-3">
        <Server className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground font-mono tracking-wider">WSP DATA ADMIN</h1>
      </div>

      {/* Sync Key */}
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

      {/* ═══ TIER 1 READINESS ═══ */}
      <Card className="bg-card border-border border-2 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono tracking-wider text-primary flex items-center gap-2">
            <Shield className="h-4 w-4" />
            TIER 1 V1 READINESS
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Klassificering</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <StatBox label="Total Tier 1" value={String(t1?.total ?? '—')} />
              <StatBox label="full_wsp_equity" value={String(t1?.fullWsp ?? '—')} highlight />
              <StatBox label="Benchmarks/Proxy" value={String(t1?.proxy ?? '—')} />
              <StatBox label="Metals" value={String(t1?.metals ?? '—')} />
              <StatBox label="Enriched" value={String(t1?.enriched ?? '—')} />
            </div>
          </div>

          <div>
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Datareadiness</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatBox label="Med prisdata" value={String(t1?.withPrices ?? '—')} highlight={t1 ? t1.withPrices >= t1.total : false} />
              <StatBox label="Analysredo (≥200 bars)" value={String(t1?.analysisReady ?? '—')} highlight={t1 ? t1.analysisReady >= t1.fullWsp : false} />
              <StatBox label="Backfill men <200" value={String(t1?.backfilledButNotReady ?? '—')} />
              <StatBox label="Saknar prisdata" value={String(t1?.noPrices?.length ?? '—')} highlight={t1 ? (t1.noPrices?.length ?? 0) === 0 : false} />
            </div>
          </div>

          {t1 && t1.noPrices && t1.noPrices.length > 0 && t1.noPrices.length <= 30 && (
            <div className="text-[10px] font-mono text-muted-foreground bg-muted rounded p-2">
              <span className="text-signal-caution">⚠ Saknar prisdata:</span>{' '}
              {t1.noPrices.join(', ')}
            </div>
          )}

          {t1 && t1.limited > 0 && (
            <div className="text-[10px] font-mono text-muted-foreground bg-muted rounded p-2">
              <span className="text-signal-caution">⚠ Ej full WSP (metadata saknas):</span>{' '}
              {[...t1.missingIndustry, ...t1.missingSector].filter((v, i, a) => a.indexOf(v) === i).join(', ')}
            </div>
          )}
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
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <StatBox label="Symboler" value={stats?.symbolCount?.toLocaleString() ?? '—'} />
            <StatBox label="Prisrader" value={stats?.priceCount?.toLocaleString() ?? '—'} />
            <StatBox label="Earliest" value={stats?.earliest ?? '—'} />
            <StatBox label="Latest" value={stats?.latest ?? '—'} />
            <StatBox label="Enriched" value={stats?.enrichedCount?.toLocaleString() ?? '—'} />
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
            <Button onClick={runSeed} disabled={running !== null} variant="outline" className="font-mono text-xs">
              <Sprout className="h-4 w-4 mr-2" />
              {running === 'seed' ? 'Seedar...' : 'Seed symbol-lista'}
            </Button>

            <Button onClick={runDailySync} disabled={running !== null} variant="outline" className="font-mono text-xs">
              <RefreshCw className={`h-4 w-4 mr-2 ${running === 'daily' ? 'animate-spin' : ''}`} />
              {running === 'daily' ? 'Synkar...' : 'Kör daglig sync'}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={running !== null} className="font-mono text-xs bg-primary text-primary-foreground">
                  <Download className="h-4 w-4 mr-2" />
                  {running === 'backfill' ? 'Backfill pågår...' : '⚡ Backfill Tier 1 (per symbol)'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Backfill Tier 1 symboler?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Laddar 5 år historisk data för {TIER1_SYMBOLS.length} Tier 1 symboler via Polygon.io.
                    Anpassat tempo (13s/symbol) för att undvika rate limits.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Avbryt</AlertDialogCancel>
                  <AlertDialogAction onClick={() => runBackfill(0, true)}>Starta Tier 1 backfill</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={running !== null} variant="outline" className="font-mono text-xs border-primary/40 text-primary">
                  <Calendar className="h-4 w-4 mr-2" />
                  {running === 'backfill_date' ? 'Datum-backfill pågår...' : '📅 Backfill per datum (rekommenderat)'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Backfill per datum (Polygon grouped)?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Hämtar ALLA aktier för ett datum i ett enda anrop via Polygon grouped endpoint.
                    Kör detta för varje handelsdag bakåt i tiden (~504 dagar = 2 år).
                    Med gratis-tier (5 anrop/min) tar det ~100 minuter totalt men utan timeout-problem.
                    Kan stoppas och fortsätta.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Avbryt</AlertDialogCancel>
                  <AlertDialogAction onClick={runDateBackfill}>Starta datum-backfill</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <div className="flex flex-wrap gap-2 border-l border-border pl-3">
              <Button onClick={() => runEnrich('tier1')} disabled={running !== null} variant="outline" className="font-mono text-xs">
                <Zap className="h-4 w-4 mr-2" />
                {running === 'enrich' && enrichProgress.tier === 'tier1' ? 'Tier 1...' : 'Berika Tier 1'}
              </Button>
            </div>
          </div>

          {/* Resume offset for per-symbol backfill */}
          {!running && resumeOffset > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs font-mono text-muted-foreground">Resume offset:</span>
              <input
                type="number"
                value={resumeOffset}
                onChange={(e) => setResumeOffset(Number(e.target.value))}
                className="w-24 bg-muted border border-border rounded px-2 py-1 text-xs font-mono text-foreground"
              />
              <Button onClick={() => runBackfill(resumeOffset, true)} variant="outline" size="sm" className="font-mono text-xs">
                Fortsätt backfill
              </Button>
            </div>
          )}

          {/* Running state display */}
          {running && (
            <div className="space-y-1 mt-2">
              <div className="flex items-center gap-2 text-xs text-primary font-mono">
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span>
                  {running === 'backfill'
                    ? `Offset ${backfillProgress.offset} / ~${backfillProgress.total} · ${backfillProgress.fetched} hämtade · ${backfillProgress.rowsWritten} rader · ${backfillProgress.failed} misslyckade`
                    : running === 'backfill_date'
                    ? `Datum-backfill: ${dateBackfillProgress.currentDate} · ${dateBackfillProgress.completedDays}/${dateBackfillProgress.totalDays} dagar · ${dateBackfillProgress.totalRows} rader`
                    : running === 'enrich'
                    ? `${enrichProgress.tier.toUpperCase()} · offset ${enrichProgress.offset} · ${enrichProgress.enriched} berikade · ${enrichProgress.failed} misslyckade`
                    : 'Bearbetar...'}
                </span>
              </div>
              {running === 'backfill' && Object.keys(backfillProgress.failureCounts).some(k => (backfillProgress.failureCounts[k] ?? 0) > 0) && (
                <div className="text-[10px] font-mono text-muted-foreground ml-5 space-y-0.5">
                  {Object.entries(backfillProgress.failureCounts).filter(([,v]) => v > 0).sort((a,b) => b[1] - a[1]).map(([k,v]) => {
                    const retryable = ['rate_limited','provider_5xx','provider_timeout','database_upsert_failure','unknown_provider_error'].includes(k);
                    return (
                      <div key={k}>
                        <span className={retryable ? 'text-signal-caution' : 'text-signal-danger'}>{retryable ? '🔄' : '⛔'}</span>{' '}
                        {k}: {String(v)}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Stopped state */}
          {!running && backfillProgress.stopped && (
            <div className="text-xs font-mono text-signal-danger mt-2">
              ⛔ Backfill stoppat: {backfillProgress.stopReason}
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
                        <Badge variant="outline" className="text-[10px] font-mono">{log.sync_type}</Badge>
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

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${highlight ? 'bg-primary/10 border border-primary/20' : 'bg-muted'}`}>
      <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-bold font-mono mt-1 ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}
