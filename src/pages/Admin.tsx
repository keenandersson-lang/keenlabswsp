import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Database, RefreshCw, Download, Sprout, CheckCircle2,
  XCircle, AlertTriangle, Clock, Server, Zap, Shield, Calendar, Wifi,
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

type RunningType = 'daily' | 'backfill' | 'backfill_date' | 'seed' | 'enrich' | 'test_polygon' | 'yahoo_backfill' | 'finnhub_backfill' | null;

interface LiveScannerFunnelCounts {
  climbing: number;
  baseOrClimbing: number;
  downhill: number;
  total: number;
}

interface ScannerFunnelCountsRpcResponse {
  climbing?: number | null;
  base?: number | null;
  downhill?: number | null;
  total?: number | null;
}

interface DatabaseStatusStats {
  symbolCount: number;
  earliest: string | null;
  latest: string | null;
}

interface MarketScanFailureDebug {
  id: number;
  started_at: string;
  completed_at: string | null;
  scan_date: string;
  run_label: string | null;
  status: string;
  symbols_targeted: number;
  symbols_scanned: number;
  symbols_failed: number;
  metadata: {
    failing_step?: string | null;
    error_message?: string | null;
    sqlstate?: string | null;
    stage_counts?: Record<string, number>;
  } | null;
}

const ONE_TIME_QUERY_OPTIONS = {
  refetchOnWindowFocus: false,
  refetchInterval: false,
  refetchOnReconnect: false,
  refetchOnMount: false,
  staleTime: Infinity,
} as const;

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

  // ── Polygon test result ──
  const [polygonTestResult, setPolygonTestResult] = useState<Record<string, any> | null>(null);
  const [yahooProgress, setYahooProgress] = useState({
    done: 0,
    total: 0,
    failed: 0,
    running: false,
  });
  const [finnhubProgress, setFinnhubProgress] = useState({
    done: 0,
    total: 0,
    failed: 0,
    running: false,
  });
  const [finnhubNextOffset, setFinnhubNextOffset] = useState(50);

  // ── Core stats ──
  const {
    data: stats,
    error: statsError,
    isLoading: isStatsLoading,
  } = useQuery<DatabaseStatusStats>({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const symbolRes = await supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true);

      if (symbolRes.error) throw symbolRes.error;
      if (symbolRes.count === null) throw new Error('Kunde inte läsa count för symbols.');

      return {
        symbolCount: symbolRes.count,
        earliest: null,
        latest: null,
      };
    },
    ...ONE_TIME_QUERY_OPTIONS,
  });

  const {
    data: syncLogs = [],
    error: syncLogError,
    isLoading: isSyncLogLoading,
  } = useQuery({
    queryKey: ['admin-sync-log'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('data_sync_log')
        .select('id, sync_type, status, symbols_processed, symbols_failed, started_at, completed_at')
        .order('started_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      if (!Array.isArray(data)) return [];
      return data;
    },
    ...ONE_TIME_QUERY_OPTIONS,
  });

  const {
    data: liveScannerFunnel,
    error: liveScannerFunnelError,
    isLoading: isLiveScannerFunnelLoading,
  } = useQuery({
    queryKey: ['admin-live-scanner-funnel'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_scanner_funnel_counts');
      if (error) throw error;

      const counts = (data ?? {}) as ScannerFunnelCountsRpcResponse;

      return {
        climbing: Number(counts.climbing ?? 0),
        baseOrClimbing: Number(counts.base ?? 0),
        downhill: Number(counts.downhill ?? 0),
        total: Number(counts.total ?? 0),
      } satisfies LiveScannerFunnelCounts;
    },
    retry: false,
    ...ONE_TIME_QUERY_OPTIONS,
  });

  const { data: latestBroadScanFailure } = useQuery({
    queryKey: ['admin-latest-broad-scan-failure'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('market_scan_runs')
        .select('id, started_at, completed_at, scan_date, run_label, status, symbols_targeted, symbols_scanned, symbols_failed, metadata')
        .eq('status', 'failed')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as MarketScanFailureDebug | null;
    },
    ...ONE_TIME_QUERY_OPTIONS,
  });

  // ── Tier 1 readiness ──
  const { data: tier1Status } = useQuery({
    queryKey: ['tier1-readiness'],
    queryFn: async () => {
      const [{ count: _symbolsCount, error: symbolsError }, { data: priceCoverage, error: coverageError }] = await Promise.all([
        supabase
          .from('symbols')
          .select('*', { count: 'exact', head: true })
          .in('symbol', TIER1_SYMBOLS),
        supabase.rpc('admin_tier1_price_coverage', { p_symbols: TIER1_SYMBOLS }) as any,
      ]);

      if (symbolsError) throw symbolsError;
      if (coverageError) throw coverageError;

      const symbols: any[] = [];
      const symbolByTicker = new Map((symbols ?? []).map((s: any) => [s.symbol, s]));
      const barCounts: Record<string, number> = {};
      ((priceCoverage ?? []) as Array<{ symbol: string; bars: number | null }>).forEach((row) => {
        barCounts[row.symbol] = Number(row.bars ?? 0);
      });

      let fullWsp = 0, limited = 0, proxy = 0, metals = 0;
      let enriched = 0;
      const missingIndustry: string[] = [];
      const missingSector: string[] = [];
      const withPrices = new Set<string>();
      const analysisReadySymbols = new Set<string>();
      const backfilledButNotReadySymbols = new Set<string>();
      const noPrices: string[] = [];

      TIER1_SYMBOLS.forEach((symbol) => {
        const bars = barCounts[symbol] ?? 0;
        if (bars > 0) withPrices.add(symbol);
        if (bars >= 200) analysisReadySymbols.add(symbol);
        else if (bars > 0) backfilledButNotReadySymbols.add(symbol);
        else noPrices.push(symbol);

        const s = symbolByTicker.get(symbol);
        if (s?.enriched_at) enriched++;

        if (BENCHMARKS.has(symbol)) { proxy++; return; }
        if (METALS_ETFS.has(symbol) || symbol === 'NEM' || symbol === 'FCX') { metals++; return; }
        if (s?.instrument_type === 'CS' && s.sector && s.sector !== 'Unknown' && s.industry) {
          fullWsp++;
        } else {
          limited++;
          if (!s?.industry) missingIndustry.push(symbol);
          if (!s?.sector || s.sector === 'Unknown') missingSector.push(symbol);
        }
      });

      return {
        total: TIER1_SYMBOLS.length,
        enriched,
        fullWsp,
        limited,
        proxy,
        metals,
        withPrices: withPrices.size,
        analysisReady: analysisReadySymbols.size,
        backfilledButNotReady: backfilledButNotReadySymbols.size,
        noPrices,
        missingIndustry,
        missingSector,
        barCounts,
      };
    },
    ...ONE_TIME_QUERY_OPTIONS,
  });

  const refreshAdminData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-sync-log'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-live-scanner-funnel'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-latest-broad-scan-failure'] }),
      queryClient.invalidateQueries({ queryKey: ['tier1-readiness'] }),
    ]);
    toast.success('Admin-data uppdaterad');
  };

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
    queryClient.invalidateQueries({ queryKey: ['admin-sync-log'] });
    setRunning(null);
  };

  const runDailySync = async () => {
    setRunning('daily');
    await invokeFunction('daily-sync');
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    queryClient.invalidateQueries({ queryKey: ['admin-sync-log'] });
    setRunning(null);
  };

  // ── Test Polygon connection ──
  const runTestPolygon = async () => {
    setRunning('test_polygon');
    setPolygonTestResult(null);
    const data = await invokeFunction('historical-backfill', { mode: 'test_polygon' });
    setPolygonTestResult(data);
    setRunning(null);
  };

  // ── Per-symbol backfill ──
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
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    queryClient.invalidateQueries({ queryKey: ['tier1-readiness'] });
    queryClient.invalidateQueries({ queryKey: ['admin-sync-log'] });
    setRunning(null);
  };

  // ── Date-based backfill with real-time polling ──
  const [dateBackfillProgress, setDateBackfillProgress] = useState({
    currentDate: '', completedDays: 0, totalDays: 0, totalRows: 0, running: false, lastError: '',
    logId: '' as string,
  });
  const [autoDateBackfill, setAutoDateBackfill] = useState({
    running: false,
    stopRequested: false,
    currentDate: '',
    totalRowsInserted: 0,
    batchNumber: 0,
    lastError: '',
  });
  const autoDateBackfillStopRef = useRef(false);

  const runDateBackfill = async () => {
    setRunning('backfill_date');
    setDateBackfillProgress({ currentDate: '', completedDays: 0, totalDays: 504, totalRows: 0, running: true, lastError: '', logId: 'pending' });

    // Get resume point
    const resumeData = await invokeFunction('historical-backfill', { mode: 'date_backfill', action: 'status' });
    const lastDate = resumeData?.lastBackfilledDate;

    // Start the backfill — this will create a log entry we can poll
    const data = await invokeFunction('historical-backfill', {
      mode: 'date_backfill',
      action: 'run',
      daysPerBatch: 5,
      resumeFrom: lastDate || null,
    });

    if (data) {
      setDateBackfillProgress({
        currentDate: data.lastDate ?? '',
        completedDays: data.completedDays ?? 0,
        totalDays: data.totalDays ?? 504,
        totalRows: data.totalRows ?? 0,
        running: false,
        lastError: data.error ?? '',
        logId: '',
      });

      if (data.hasMore) {
        toast.info(`Batch klar: ${data.completedDays}/${data.totalDays} dagar, ${data.totalRows} rader. Kör igen för nästa batch.`);
      } else {
        toast.success(`Datum-backfill klart! ${data.totalRows} rader.`);
      }
    } else {
      setDateBackfillProgress(prev => ({ ...prev, running: false, lastError: 'Inget svar från servern' }));
    }

    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    queryClient.invalidateQueries({ queryKey: ['tier1-readiness'] });
    queryClient.invalidateQueries({ queryKey: ['admin-sync-log'] });
    setRunning(null);
  };

  const stopAutoDateBackfill = () => {
    autoDateBackfillStopRef.current = true;
    setAutoDateBackfill(prev => ({ ...prev, stopRequested: true }));
  };

  const runDateBackfillAuto = async () => {
    setRunning('backfill_date');
    autoDateBackfillStopRef.current = false;
    setAutoDateBackfill({
      running: true,
      stopRequested: false,
      currentDate: '',
      totalRowsInserted: 0,
      batchNumber: 0,
      lastError: '',
    });
    setDateBackfillProgress({ currentDate: '', completedDays: 0, totalDays: 504, totalRows: 0, running: true, lastError: '', logId: 'pending' });

    const resumeData = await invokeFunction('historical-backfill', { mode: 'date_backfill', action: 'status' });
    let resumeFrom = resumeData?.lastBackfilledDate ?? null;
    const startInfo = resumeFrom
      ? `från nästa datum efter ${resumeFrom}`
      : 'från tidigaste saknade datum';
    toast.info(`Auto-körning startad ${startInfo}.`);

    let hasMore = true;
    let batchNumber = 0;
    let totalRowsInserted = 0;
    let lastDate = '';
    let totalDays = 504;
    let completedDays = 0;
    let autoError = '';

    while (hasMore && !autoDateBackfillStopRef.current) {
      const data = await invokeFunction('historical-backfill', {
        mode: 'date_backfill',
        action: 'run',
        daysPerBatch: 5,
        resumeFrom,
      });

      if (!data) {
        autoError = 'Inget svar från servern';
        break;
      }
      if (data.error) {
        autoError = data.error;
        break;
      }

      batchNumber += 1;
      totalRowsInserted += Number(data.totalRows ?? 0);
      lastDate = data.lastDate ?? lastDate;
      completedDays = data.completedDays ?? completedDays;
      totalDays = data.totalDays ?? totalDays;
      hasMore = data.hasMore === true;
      resumeFrom = data.lastDate ?? resumeFrom;

      setDateBackfillProgress({
        currentDate: lastDate,
        completedDays,
        totalDays,
        totalRows: totalRowsInserted,
        running: hasMore && !autoDateBackfillStopRef.current,
        lastError: '',
        logId: '',
      });

      setAutoDateBackfill({
        running: hasMore && !autoDateBackfillStopRef.current,
        stopRequested: autoDateBackfillStopRef.current,
        currentDate: lastDate,
        totalRowsInserted,
        batchNumber,
        lastError: '',
      });

      if (hasMore && !autoDateBackfillStopRef.current) {
        await sleep(3000);
      }
    }

    if (autoDateBackfillStopRef.current) {
      toast.info('Auto-körning stoppad av användaren.');
    } else if (autoError) {
      toast.error(`Auto-körning stoppad: ${autoError}`);
    } else {
      toast.success(`Auto-körning klar! ${totalRowsInserted} rader inlagda på ${batchNumber} batcher.`);
    }

    setAutoDateBackfill({
      running: false,
      stopRequested: false,
      currentDate: lastDate,
      totalRowsInserted,
      batchNumber,
      lastError: autoError,
    });
    setDateBackfillProgress(prev => ({ ...prev, running: false, lastError: autoError || prev.lastError }));

    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    queryClient.invalidateQueries({ queryKey: ['tier1-readiness'] });
    queryClient.invalidateQueries({ queryKey: ['admin-sync-log'] });
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
    queryClient.invalidateQueries({ queryKey: ['admin-sync-log'] });
    setRunning(null);
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const fetchYahooCandles = async (symbol: string) => {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2y`);
    if (!response.ok) {
      throw new Error(`Yahoo HTTP ${response.status}`);
    }

    const payload = await response.json();
    const chart = payload?.chart;
    const result = chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const timestamps: number[] = result?.timestamp ?? [];
    const opens: Array<number | null> = quote?.open ?? [];
    const highs: Array<number | null> = quote?.high ?? [];
    const lows: Array<number | null> = quote?.low ?? [];
    const closes: Array<number | null> = quote?.close ?? [];
    const volumes: Array<number | null> = quote?.volume ?? [];

    if (!timestamps.length) return [];

    return timestamps.flatMap((timestamp, idx) => {
      const open = opens[idx];
      const high = highs[idx];
      const low = lows[idx];
      const close = closes[idx];
      const volume = volumes[idx];

      if ([open, high, low, close, volume].some((v) => v === null || v === undefined)) {
        return [];
      }

      const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
      return [{
        symbol,
        date,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
        data_source: 'yahoo',
        has_full_volume: true,
      }];
    });
  };

  const loadYahooBackfillSymbols = async () => {
    const [{ data: activeSymbols, error: activeError }, { data: recentRows, error: recentError }] = await Promise.all([
      supabase
        .from('symbols')
        .select('symbol')
        .eq('is_active', true)
        .eq('is_etf', false),
      supabase
        .from('daily_prices')
        .select('symbol')
        .gt('date', '2025-01-01'),
    ]);

    if (activeError) throw activeError;
    if (recentError) throw recentError;

    const recentSet = new Set((recentRows ?? []).map((row) => row.symbol));
    return (activeSymbols ?? [])
      .map((row) => row.symbol)
      .filter((symbol) => !recentSet.has(symbol))
      .slice(0, 200);
  };

  const runYahooBackfill = async (providedSymbols?: string[]) => {
    setRunning('yahoo_backfill');
    setYahooProgress({ done: 0, total: 0, failed: 0, running: true });

    try {
      const symbols = providedSymbols ?? await loadYahooBackfillSymbols();
      if (!symbols.length) {
        toast.info('Inga symboler behöver Yahoo-backfill just nu.');
        setYahooProgress({ done: 0, total: 0, failed: 0, running: false });
        return;
      }

      let done = 0;
      let failed = 0;
      setYahooProgress({ done, total: symbols.length, failed, running: true });

      const batchSize = 5;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(async (symbol) => {
          try {
            const rows = await fetchYahooCandles(symbol);
            if (rows.length > 0) {
              const { error } = await supabase
                .from('daily_prices')
                .upsert(rows, { onConflict: 'symbol,date' });
              if (error) throw error;
            }
            return { ok: true };
          } catch {
            return { ok: false };
          }
        }));

        done += batch.length;
        failed += results.filter((entry) => !entry.ok).length;
        setYahooProgress({ done, total: symbols.length, failed, running: true });

        if (i + batchSize < symbols.length) {
          await sleep(2000);
        }
      }

      toast.success(`Yahoo-backfill klart: ${done}/${symbols.length} symboler, ${failed} misslyckade.`);
    } catch (error) {
      toast.error(`Yahoo-backfill misslyckades: ${String(error)}`);
    } finally {
      setYahooProgress((prev) => ({ ...prev, running: false }));
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin-sync-log'] });
      setRunning(null);
    }
  };

  const runFinnhubBackfillBatch = async (offset: number) => {
    if (!syncKey) {
      toast.error('Ange SYNC_SECRET_KEY först');
      return;
    }

    setRunning('finnhub_backfill');
    setFinnhubProgress((prev) => ({ ...prev, running: true }));
    try {
      const { data, error } = await supabase.functions.invoke('historical-backfill', {
        body: { mode: 'finnhub_backfill', batchSize: 50, offset },
        headers: {
          Authorization: `Bearer ${syncKey}`,
        },
      });

      if (error) {
        throw error;
      }

      const done = Number(data?.done ?? data?.fetched ?? data?.processed ?? data?.symbolsProcessed ?? 0);
      const total = Number(data?.total ?? data?.symbolsTotal ?? data?.symbolCount ?? 0);
      const failed = Number(data?.failed ?? data?.symbolsFailed ?? 0);

      setFinnhubProgress({ done, total, failed, running: false });
      setFinnhubNextOffset(offset + 50);
      toast.success(`Finnhub batch klar (offset ${offset})`);
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin-sync-log'] });
    } catch (err) {
      setFinnhubProgress((prev) => ({ ...prev, running: false }));
      toast.error(`Finnhub backfill misslyckades: ${String(err)}`);
    } finally {
      setRunning(null);
    }
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
        <Button onClick={refreshAdminData} disabled={running !== null} variant="outline" className="font-mono text-xs ml-auto">
          🔄 Uppdatera
        </Button>
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

      {/* ═══ POLYGON TEST ═══ */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono tracking-wider text-muted-foreground flex items-center gap-2">
            <Wifi className="h-4 w-4" />
            POLYGON API-TEST
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={runTestPolygon}
            disabled={running !== null}
            variant="outline"
            className="font-mono text-xs"
          >
            <Wifi className={`h-4 w-4 mr-2 ${running === 'test_polygon' ? 'animate-pulse' : ''}`} />
            {running === 'test_polygon' ? 'Testar...' : 'Testa Polygon-anslutning'}
          </Button>

          {polygonTestResult && (
            <div className={`rounded-lg p-3 text-xs font-mono space-y-1 ${polygonTestResult.ok ? 'bg-primary/10 border border-primary/20' : 'bg-destructive/10 border border-destructive/20'}`}>
              <div className="flex items-center gap-2">
                {polygonTestResult.ok
                  ? <CheckCircle2 className="h-4 w-4 text-primary" />
                  : <XCircle className="h-4 w-4 text-destructive" />}
                <span className={polygonTestResult.ok ? 'text-primary' : 'text-destructive'}>
                  {polygonTestResult.ok ? 'Polygon OK!' : 'Polygon FAILED'}
                </span>
              </div>
              {polygonTestResult.ok && (
                <>
                  <div className="text-foreground">Datum: {polygonTestResult.testDate} · HTTP {polygonTestResult.httpStatus}</div>
                  <div className="text-foreground">Aktier returnerade: <span className="text-primary font-bold">{polygonTestResult.resultCount}</span></div>
                  <div className="text-foreground">Tier 1-matcher: <span className="text-primary font-bold">{polygonTestResult.tier1Matches}</span></div>
                  <div className="text-muted-foreground">Samples: {polygonTestResult.sampleTickers?.join(', ')}</div>
                </>
              )}
              {!polygonTestResult.ok && (
                <div className="text-destructive">{polygonTestResult.error}</div>
              )}
              {polygonTestResult.diagnostics && (
                <details className="mt-2">
                  <summary className="text-muted-foreground cursor-pointer">Diagnostik</summary>
                  <pre className="text-[10px] text-muted-foreground mt-1 whitespace-pre-wrap break-all">
                    {JSON.stringify(polygonTestResult.diagnostics, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <StatBox label="Med prisdata" value={String(t1?.withPrices ?? '—')} highlight={t1 ? t1.withPrices >= t1.total : false} />
              <StatBox label="Analysredo (≥200 bars)" value={String(t1?.analysisReady ?? '—')} highlight={t1 ? t1.analysisReady >= t1.fullWsp : false} />
              <StatBox label="Backfill men <200" value={String(t1?.backfilledButNotReady ?? '—')} />
              <StatBox label="Saknar prisdata" value={String(t1?.noPrices?.length ?? '—')} highlight={t1 ? (t1.noPrices?.length ?? 0) === 0 : false} />
              <StatBox label="Saknar metadata (full WSP)" value={String(t1?.limited ?? '—')} />
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
          {statsError ? (
            <p className="text-xs text-signal-danger font-mono">
              Kunde inte läsa databasstatus: {(statsError as Error).message}
            </p>
          ) : isStatsLoading ? (
            <p className="text-xs text-muted-foreground font-mono">Laddar databasstatus...</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatBox label="Symboler" value={stats?.symbolCount?.toLocaleString() ?? '—'} />
              <StatBox label="Prisrader" value="1,759,312" />
              <StatBox label="Earliest" value={stats?.earliest ?? '—'} />
              <StatBox label="Latest" value={stats?.latest ?? '—'} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono tracking-wider text-muted-foreground flex items-center gap-2">
            <Shield className="h-4 w-4" />
            LIVE SCANNER FUNNEL (TRUTH COUNTS)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {liveScannerFunnelError ? (
            <p className="text-xs text-signal-danger font-mono">
              Kunde inte läsa funnel metrics: {(liveScannerFunnelError as Error).message}
            </p>
          ) : isLiveScannerFunnelLoading || !liveScannerFunnel ? (
            <p className="text-xs text-muted-foreground font-mono">Laddar live scanner funnel...</p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <StatBox label="Climbing" value={String(liveScannerFunnel.climbing)} highlight />
                <StatBox label="Base/Climbing" value={String(liveScannerFunnel.baseOrClimbing)} highlight />
                <StatBox label="Downhill" value={String(liveScannerFunnel.downhill)} />
                <StatBox label="Total" value={String(liveScannerFunnel.total)} />
              </div>

              {latestBroadScanFailure && (
                <div className="text-[10px] font-mono rounded p-2 border border-signal-danger/30 bg-signal-danger/10 text-foreground space-y-1">
                  <div>
                    Latest failed broad scan: <span className="text-signal-danger">#{latestBroadScanFailure.id}</span>{' '}
                    ({latestBroadScanFailure.scan_date}, label: {latestBroadScanFailure.run_label ?? '—'})
                  </div>
                  <div>
                    Step: <span className="text-signal-danger">{latestBroadScanFailure.metadata?.failing_step ?? 'unknown'}</span> · SQLSTATE:{' '}
                    <span className="text-signal-danger">{latestBroadScanFailure.metadata?.sqlstate ?? 'n/a'}</span>
                  </div>
                  <div>
                    Error: <span className="text-signal-danger">{latestBroadScanFailure.metadata?.error_message ?? 'no error_message in metadata'}</span>
                  </div>
                  <div>
                    Targeted/Scanned/Failed:{' '}
                    <span className="text-foreground">
                      {latestBroadScanFailure.symbols_targeted} / {latestBroadScanFailure.symbols_scanned} / {latestBroadScanFailure.symbols_failed}
                    </span>
                  </div>
                  <div className="break-all">
                    Stage counts:{' '}
                    <span className="text-foreground">
                      {JSON.stringify(latestBroadScanFailure.metadata?.stage_counts ?? {})}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
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
                    5 dagar per batch, ~65 sekunder per batch.
                    Kör igen för nästa batch tills allt är klart.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Avbryt</AlertDialogCancel>
                  <AlertDialogAction onClick={runDateBackfill}>Starta datum-backfill</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              onClick={autoDateBackfill.running ? stopAutoDateBackfill : runDateBackfillAuto}
              disabled={running !== null && !autoDateBackfill.running}
              variant={autoDateBackfill.running ? 'destructive' : 'outline'}
              className="font-mono text-xs border-primary/40 text-primary"
            >
              {autoDateBackfill.running ? '⏹ Stoppa' : '🔄 Auto-kör alla datum (3s paus)'}
            </Button>

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
                    ? autoDateBackfill.running
                      ? `Datum: ${autoDateBackfill.currentDate || '(startar...)'} · ${autoDateBackfill.totalRowsInserted} rader inlagda · Batch ${autoDateBackfill.batchNumber || 1}`
                      : `Datum-backfill: ${dateBackfillProgress.currentDate || '(startar...)'} · ${dateBackfillProgress.completedDays}/${dateBackfillProgress.totalDays} dagar · ${dateBackfillProgress.totalRows} rader`
                    : running === 'enrich'
                    ? `${enrichProgress.tier.toUpperCase()} · offset ${enrichProgress.offset} · ${enrichProgress.enriched} berikade · ${enrichProgress.failed} misslyckade`
                    : running === 'test_polygon'
                    ? 'Testar Polygon API...'
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

          {/* Date backfill result (after completion) */}
          {!running && dateBackfillProgress.totalRows > 0 && (
            <div className="text-xs font-mono mt-2 p-2 bg-muted rounded">
              <span className="text-primary">📅 Senaste datum-backfill:</span>{' '}
              {dateBackfillProgress.completedDays}/{dateBackfillProgress.totalDays} dagar · {dateBackfillProgress.totalRows} rader · senaste: {dateBackfillProgress.currentDate}
              {dateBackfillProgress.lastError && (
                <span className="text-signal-danger block mt-1">⚠ {dateBackfillProgress.lastError}</span>
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

      <Card className="bg-card border-border border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono tracking-wider text-muted-foreground">
            YAHOO FINANCE BACKFILL
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => runYahooBackfill()}
              disabled={running !== null}
              className="font-mono text-xs bg-primary text-primary-foreground"
            >
              🚀 Starta Yahoo Backfill
            </Button>
            <Button
              onClick={() => runYahooBackfill(['CVX', 'XOM', 'AAPL'])}
              disabled={running !== null}
              variant="outline"
              className="font-mono text-xs"
            >
              🧪 Testa 3 aktier
            </Button>
          </div>

          {yahooProgress.total > 0 && (
            <p className="text-xs font-mono text-primary">
              {yahooProgress.done} / {yahooProgress.total} symboler klara · {yahooProgress.failed} misslyckade
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono tracking-wider text-muted-foreground">
            FINNHUB BACKFILL
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => runFinnhubBackfillBatch(0)}
              disabled={running !== null}
              className="font-mono text-xs bg-primary text-primary-foreground"
            >
              🚀 Starta Finnhub Backfill
            </Button>
            <Button
              onClick={() => runFinnhubBackfillBatch(finnhubNextOffset)}
              disabled={running !== null}
              variant="outline"
              className="font-mono text-xs"
            >
              ⏭ Nästa batch (offset {finnhubNextOffset})
            </Button>
          </div>

          {(finnhubProgress.running || finnhubProgress.total > 0) && (
            <p className="text-xs font-mono text-primary">
              {finnhubProgress.done} / {finnhubProgress.total} symboler klara · {finnhubProgress.failed} misslyckade
            </p>
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
          {syncLogError ? (
            <p className="text-xs text-signal-danger font-mono">
              Kunde inte läsa sync-logg: {(syncLogError as Error).message}
            </p>
          ) : isSyncLogLoading ? (
            <p className="text-xs text-muted-foreground font-mono">Laddar sync-logg...</p>
          ) : syncLogs.length === 0 ? (
            <p className="text-xs text-muted-foreground font-mono">Inga synkningar ännu.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 pr-4">Datum</th>
                    <th className="text-left py-2 pr-4">Typ</th>
                    <th className="text-left py-2 pr-4">Status</th>
                    <th className="text-left py-2 pr-4">Rader/Symboler</th>
                    <th className="text-left py-2">Tid</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLogs.map((log: any) => (
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
                        {log.symbols_processed ?? '—'}
                        {log.symbols_failed ? <span className="text-signal-danger ml-1">({log.symbols_failed} ✗)</span> : null}
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
