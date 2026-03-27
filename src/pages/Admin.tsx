import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Database, RefreshCw, Download, Sprout, CheckCircle2,
  XCircle, AlertTriangle, Clock, Server, Zap, Shield, RotateCcw, GitBranchPlus, Radar,
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
import { SCANNER_ELIGIBLE_SYMBOLS, TRACKED_SYMBOLS } from '@/lib/tracked-symbols';

type RunningType = 'daily' | 'backfill' | 'seed' | 'enrich' | 'scan' | null;

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

export default function Admin() {
  const [running, setRunning] = useState<RunningType>(null);
  const [syncKey, setSyncKey] = useState('');
  const [registryReason, setRegistryReason] = useState('operator_update');
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, { sector: string; industry: string; notes: string }>>({});
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const [priceRes, symbolRes, logRes, earliestRes, latestRes, enrichedRes, eligibleBackfillRes, eligibleFullWspRes, excludedRes, canonicalizedRes, ambiguousRes, unresolvedRes, proxyMappedRes, manuallyReviewedRes, blockedByClassRes] = await Promise.all([
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
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true).not('enriched_at', 'is', null),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('eligible_for_backfill', true),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('eligible_for_full_wsp', true),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('support_level', 'excluded'),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('classification_status', 'canonicalized'),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('classification_status', 'ambiguous'),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('classification_status', 'unresolved'),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('classification_status', 'proxy_mapped'),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('classification_status', 'manually_reviewed'),
        supabase.from('symbols').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('eligible_for_full_wsp', false).in('classification_status', ['ambiguous', 'unresolved', 'proxy_mapped']),
      ]);
      return {
        priceCount: priceRes.count ?? 0,
        symbolCount: symbolRes.count ?? 0,
        syncLog: logRes.data ?? [],
        earliest: earliestRes.data?.[0]?.date ?? null,
        latest: latestRes.data?.[0]?.date ?? null,
        enrichedCount: enrichedRes.count ?? 0,
        eligibleBackfillCount: eligibleBackfillRes.count ?? 0,
        eligibleFullWspCount: eligibleFullWspRes.count ?? 0,
        excludedCount: excludedRes.count ?? 0,
        canonicalizedCount: canonicalizedRes.count ?? 0,
        ambiguousCount: ambiguousRes.count ?? 0,
        unresolvedCount: unresolvedRes.count ?? 0,
        proxyMappedCount: proxyMappedRes.count ?? 0,
        manuallyReviewedCount: manuallyReviewedRes.count ?? 0,
        blockedByClassificationCount: blockedByClassRes.count ?? 0,
      };
    },
    refetchInterval: 15000,
  });

  const { data: reviewQueue } = useQuery({
    queryKey: ['classification-review-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('symbol_classification_review_queue')
        .select('*')
        .order('classification_confidence', { ascending: true })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30000,
  });

  const { data: industryRegistryData } = useQuery({
    queryKey: ['industry-registry-admin'],
    queryFn: async () => {
      const [
        activeVersionRes,
        versionsRes,
        statusCountsRes,
        proxyCountsRes,
        pendingRes,
        auditRes,
        operatorSummaryRes,
        blockedAlignmentRes,
      ] = await Promise.all([
        supabase.from('industry_registry_active_version').select('*').limit(1),
        supabase.from('industry_registry_versions').select('*').order('version', { ascending: false }).limit(10),
        supabase.from('industry_registry_status_counts').select('*'),
        supabase.from('industry_registry_proxy_type_counts').select('*'),
        supabase.from('industry_registry_pending_queue').select('*').order('updated_at', { ascending: false }).limit(50),
        supabase.from('industry_registry_recent_audit').select('*').limit(50),
        supabase.from('industry_registry_active_operator_summary').select('*').limit(1),
        supabase
          .from('symbol_industry_alignment_active')
          .select('symbol, canonical_sector, canonical_industry, alignment_status, alignment_reason, support_level, classification_status, classification_confidence_level')
          .eq('alignment_status', 'blocked_low_quality_classification')
          .order('symbol', { ascending: true })
          .limit(40),
      ]);

      const activeVersion = activeVersionRes.data?.[0]?.version ?? null;
      const statusCounts = (statusCountsRes.data ?? []).filter((row) => row.registry_version === activeVersion);
      const proxyTypeCounts = (proxyCountsRes.data ?? []).filter((row) => row.registry_version === activeVersion);
      return {
        activeVersion,
        versions: versionsRes.data ?? [],
        statusCounts,
        proxyTypeCounts,
        pending: pendingRes.data ?? [],
        audit: auditRes.data ?? [],
        operatorSummary: operatorSummaryRes.data?.[0] ?? null,
        blockedAlignment: blockedAlignmentRes.data ?? [],
      };
    },
    refetchInterval: 30000,
  });

  const { data: activeVersionMembership } = useQuery({
    queryKey: ['industry-registry-memberships', industryRegistryData?.activeVersion],
    enabled: Boolean(industryRegistryData?.activeVersion),
    queryFn: async () => {
      if (!industryRegistryData?.activeVersion) return [];
      const { data, error } = await supabase
        .from('industry_basket_memberships')
        .select('canonical_industry, symbol, membership_status, confidence_level, inclusion_reason, exclusion_reason, weight_method, weight_value')
        .eq('registry_version', industryRegistryData.activeVersion)
        .order('canonical_industry', { ascending: true })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: broadScannerOps } = useQuery({
    queryKey: ['broad-scanner-ops'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('scanner_operator_snapshot');
      if (error) throw error;
      return data as { summary: any; sample_candidates: any[] } | null;
    },
    refetchInterval: 30000,
  });

  // Tier 1 readiness query
  const { data: tier1Status } = useQuery({
    queryKey: ['tier1-readiness'],
    queryFn: async () => {
      const { data: latestUniverseRunRow } = await supabase
        .from('scanner_universe_runs')
        .select('id')
        .order('run_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const latestUniverseRunId = latestUniverseRunRow?.id ?? null;

      const [symbolsRes, tier1ResultsRes, snapshotRes] = await Promise.all([
        supabase
          .from('symbols')
          .select('symbol, sector, industry, instrument_type, is_etf, exchange, enriched_at, is_active')
          .in('symbol', TIER1_SYMBOLS),
        supabase
          .from('market_scan_results_latest')
          .select('symbol, promotion_status')
          .in('symbol', TIER1_SYMBOLS),
        latestUniverseRunId
          ? supabase
            .from('scanner_universe_snapshot')
            .select('symbol, history_bars, latest_price_date, latest_indicator_date, indicator_ready, support_level')
            .eq('run_id', latestUniverseRunId)
            .in('symbol', TIER1_SYMBOLS)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      const symbols = symbolsRes.data ?? [];
      const tier1Results = tier1ResultsRes.data ?? [];
      const snapshotRows = snapshotRes.data ?? [];

      const barCounts: Record<string, number> = {};
      const symbolsWithPrices = new Set<string>();
      snapshotRows.forEach((row: any) => {
        const historyBars = Number(row.history_bars ?? 0);
        barCounts[row.symbol] = historyBars;
        if (historyBars > 0 || row.latest_price_date) symbolsWithPrices.add(row.symbol);
      });

      // Classification
      let fullWsp = 0, limited = 0, proxy = 0, metals = 0, excluded = 0;
      let enriched = 0, missingIndustry: string[] = [], missingSector: string[] = [];

      const BENCHMARKS = ['SPY','QQQ','DIA','IWM','XLK','XLV','XLF','XLE','XLY','XLI','XLC','XLP','XLB','XLRE','XLU'];
      const METALS_ETFS = ['GLD','SLV','COPX','GDX','PPLT'];

      (symbols ?? []).forEach((s: any) => {
        if (s.enriched_at) enriched++;
        if (BENCHMARKS.includes(s.symbol)) { proxy++; return; }
        if (METALS_ETFS.includes(s.symbol) || s.symbol === 'NEM' || s.symbol === 'FCX') { metals++; return; }
        if (s.instrument_type === 'CS' && s.sector && s.sector !== 'Unknown' && s.industry) {
          fullWsp++;
        } else {
          limited++;
          if (!s.industry) missingIndustry.push(s.symbol);
          if (!s.sector || s.sector === 'Unknown') missingSector.push(s.symbol);
        }
      });

      // Analysis readiness (need 200+ bars)
      let analysisReady = 0;
      let backfilledButNotReady = 0;
      const fullWspSymbols = (symbols ?? []).filter((s: any) =>
        !BENCHMARKS.includes(s.symbol) && !METALS_ETFS.includes(s.symbol) && s.symbol !== 'NEM' && s.symbol !== 'FCX' &&
        s.instrument_type === 'CS' && s.sector && s.sector !== 'Unknown' && s.industry
      );
      fullWspSymbols.forEach((s: any) => {
        const bars = barCounts[s.symbol] ?? 0;
        if (bars >= 200) analysisReady++;
        else if (bars > 0) backfilledButNotReady++;
      });

      const tier1PromotionCount = tier1Results.filter((row: any) => row.promotion_status === 'tier1_default').length;
      const latestScanCoverage = tier1Results.length;
      const indicatorReadyCount = snapshotRows.filter((row: any) => row.indicator_ready === true).length;

      return {
        total: symbols?.length ?? 0,
        enriched,
        fullWsp,
        limited,
        proxy,
        metals,
        excluded,
        withPrices: symbolsWithPrices.size,
        analysisReady,
        backfilledButNotReady,
        indicatorReadyCount,
        tier1PromotionCount,
        latestScanCoverage,
        noPrices: TIER1_SYMBOLS.filter(s => !symbolsWithPrices.has(s)),
        missingIndustry,
        missingSector,
        fullWspSymbols: fullWspSymbols.map((s: any) => s.symbol),
        barCounts,
      };
    },
    refetchInterval: 30000,
  });

  const invokeFunction = async (fnName: string, body: Record<string, unknown> = {}) => {
    if (!syncKey) {
      toast.error('Ange SYNC_SECRET_KEY först');
      return { ok: false, error: 'SYNC_SECRET_KEY saknas', code: 'MISSING_SYNC_KEY' };
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
        try {
          data = JSON.parse(responseText);
        } catch {
          data = {
            ok: false,
            error: `Invalid JSON response (${res.status})`,
            code: 'INVALID_JSON_RESPONSE',
            raw: responseText.slice(0, 300),
          };
        }
      }

      const errorMessage = data?.error || `${res.status} ${res.statusText}`;
      if (!res.ok || data.error) {
        toast.error(`${fnName} misslyckades: ${errorMessage}`);
        return { ok: false, ...data, status: res.status };
      }

      toast.success(`${fnName} klart!`, { description: JSON.stringify(data).slice(0, 100) });
      return { ok: true, ...data, status: res.status };
    } catch (err) {
      const message = `Nätverksfel: ${String(err)}`;
      toast.error(message);
      return { ok: false, error: message, code: 'NETWORK_ERROR' };
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

  const runBroadScan = async () => {
    setRunning('scan');
    await invokeFunction('scan-market', { runLabel: 'manual_admin' });
    queryClient.invalidateQueries({ queryKey: ['broad-scanner-ops'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    setRunning(null);
  };

  const [enrichProgress, setEnrichProgress] = useState({
    offset: 0, enriched: 0, promoted: 0, failed: 0, running: false,
    selected: 0, requested: 0, missingSymbols: [] as string[],
    promotions: [] as string[], tier: '' as string, tierTotal: 0,
  });

  const runEnrich = async (tier: string) => {
    setRunning('enrich');
    const batchSize = 20;
    let offset = 0;
    let totalEnriched = 0;
    let totalPromoted = 0;
    let totalFailed = 0;
    let totalSelected = 0;
    let totalRequested = 0;
    let allMissingSymbols: string[] = [];
    let allPromotions: string[] = [];
    let hasMore = true;
    let tierTotal = 0;

    toast.info(`Enrichment startat: ${tier}`);
    setEnrichProgress({
      offset: 0, enriched: 0, promoted: 0, failed: 0, running: true,
      selected: 0, requested: 0, missingSymbols: [],
      promotions: [], tier, tierTotal: 0,
    });

    while (hasMore) {
      try {
        const data = await invokeFunction('enrich-symbols', { batchSize, offset, tier });
        if (!data || data.error) {
          toast.error(`Enrichment stoppat: ${data?.error || 'No response'}`);
          break;
        }
        totalEnriched += data.enriched ?? 0;
        totalPromoted += data.promoted ?? 0;
        totalFailed += data.failed ?? 0;
        totalSelected += data.selected ?? 0;
        totalRequested += data.requested ?? 0;
        if (data.missingSymbols) allMissingSymbols = [...allMissingSymbols, ...data.missingSymbols];
        if (data.tierTotal) tierTotal = data.tierTotal;
        if (data.promotions) allPromotions = [...allPromotions, ...data.promotions];
        hasMore = data.hasMore === true;
        offset = data.nextOffset ?? offset + batchSize;
        setEnrichProgress({
          offset, enriched: totalEnriched, promoted: totalPromoted,
          failed: totalFailed, running: hasMore, promotions: allPromotions.slice(0, 50),
          selected: totalSelected, requested: totalRequested, missingSymbols: allMissingSymbols.slice(0, 50),
          tier, tierTotal,
        });
      } catch (err) {
        toast.error(`Enrichment nätverksfel vid offset ${offset}`);
        break;
      }
    }

    if (!hasMore) {
      if (totalSelected === 0) {
        toast.warning(`Enrichment klart: 0 matchande symboler i DB (begärda ${totalRequested}).`);
      } else {
        toast.success(`Enrichment klart! ${totalEnriched} berikade, ${totalPromoted} promoted. (${totalSelected}/${totalRequested} matchade)`);
      }
    }
    setEnrichProgress(prev => ({ ...prev, running: false }));
    queryClient.invalidateQueries({ queryKey: ['admin-stats', 'tier1-readiness'] });
    setRunning(null);
  };

  const [backfillProgress, setBackfillProgress] = useState({
    offset: 0, total: 0, fetched: 0, failed: 0, running: false,
    rowsWritten: 0, lastError: '', failureCounts: {} as Record<string, number>,
    stopped: false, stopReason: '',
  });
  const [resumeOffset, setResumeOffset] = useState(0);

  const runBackfill = async (startOffset = 0, tier1Only = false, backfillScope = tier1Only ? 'tier1' : 'eligible_common_stock') => {
    setRunning('backfill');
    const batchSize = tier1Only ? 10 : 20;
    let offset = startOffset;
    let totalFetched = 0;
    let totalFailed = 0;
    let hasMore = true;
    let totalRowsWritten = 0;
    let allFailureCounts: Record<string, number> = {};

    const label = tier1Only ? 'Tier 1 backfill' : `Backfill (${backfillScope})`;
    toast.info(`${label} startat från offset ${startOffset}`);
    setBackfillProgress({ offset: startOffset, total: tier1Only ? TIER1_SYMBOLS.length : (stats?.symbolCount ?? 0), fetched: 0, failed: 0, running: true, rowsWritten: 0, lastError: '', failureCounts: {}, stopped: false, stopReason: '' });

    while (hasMore) {
      try {
        const data = await invokeFunction('historical-backfill', {
          yearsBack: 5, batchSize, offset, tier1Only, backfillScope, sleepBetweenMs: 13000,
        });
        if (!data) {
          setBackfillProgress(prev => ({ ...prev, running: false, stopped: true, stopReason: 'No response' }));
          break;
        }
        if (data.error) {
          setBackfillProgress(prev => ({ ...prev, running: false, stopped: true, stopReason: data.error }));
          toast.error(`${label} stoppat vid offset ${offset}: ${data.error}`);
          break;
        }
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
          offset, total: tier1Only ? TIER1_SYMBOLS.length : (stats?.symbolCount ?? 0),
          fetched: totalFetched, failed: totalFailed, running: hasMore,
          rowsWritten: totalRowsWritten, lastError: '',
          failureCounts: allFailureCounts, stopped: false, stopReason: '',
        });
      } catch (err) {
        setBackfillProgress(prev => ({ ...prev, running: false, stopped: true, stopReason: String(err) }));
        toast.error(`${label} nätverksfel vid offset ${offset}`);
        break;
      }
    }

    if (!hasMore) {
      toast.success(`${label} klart! ${totalFetched} symboler, ${totalRowsWritten} rader, ${totalFailed} misslyckade.`);
    }
    setBackfillProgress(prev => ({ ...prev, running: false }));
    queryClient.invalidateQueries({ queryKey: ['admin-stats', 'tier1-readiness'] });
    setRunning(null);
  };

  const applyManualOverride = async (symbol: string) => {
    const draft = overrideDrafts[symbol];
    if (!draft?.sector || !draft?.industry) {
      toast.error('Ange både canonical sector och canonical industry');
      return;
    }
    const { error } = await supabase
      .from('symbols')
      .update({
        manual_override_sector: draft.sector.trim(),
        manual_override_industry: draft.industry.trim(),
        manual_review_notes: draft.notes?.trim() || null,
        manually_reviewed: true,
        manual_reviewed_at: new Date().toISOString(),
        canonical_sector: draft.sector.trim(),
        canonical_industry: draft.industry.trim(),
        sector: draft.sector.trim(),
        industry: draft.industry.trim(),
        classification_status: 'manually_reviewed',
        classification_source: 'manual_override',
        classification_confidence: 1,
        classification_confidence_level: 'high',
        classification_reason: null,
        review_needed: false,
      })
      .eq('symbol', symbol);
    if (error) {
      toast.error(`Kunde inte spara override: ${error.message}`);
      return;
    }
    toast.success(`Manual override sparad för ${symbol}`);
    queryClient.invalidateQueries({ queryKey: ['classification-review-queue'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
  };

  const refreshRegistryVersion = async () => {
    if (!industryRegistryData?.activeVersion) {
      toast.error('Ingen aktiv registry-version hittades');
      return;
    }
    const { error } = await supabase.rpc('refresh_industry_registry_from_symbols', {
      p_registry_version: industryRegistryData.activeVersion,
      p_changed_by: 'admin_operator',
      p_reason: registryReason,
    });
    if (error) {
      toast.error(`Registry refresh misslyckades: ${error.message}`);
      return;
    }
    toast.success(`Registry v${industryRegistryData.activeVersion} uppdaterad.`);
    queryClient.invalidateQueries({ queryKey: ['industry-registry-admin'] });
    queryClient.invalidateQueries({ queryKey: ['industry-registry-memberships'] });
  };

  const createDraftVersion = async () => {
    const { data, error } = await supabase.rpc('create_industry_registry_version', {
      p_created_by: 'admin_operator',
      p_notes: registryReason,
      p_copy_from_version: industryRegistryData?.activeVersion ?? null,
    });
    if (error) {
      toast.error(`Kunde inte skapa draft-version: ${error.message}`);
      return;
    }
    toast.success(`Ny draft-version skapad: v${data}`);
    queryClient.invalidateQueries({ queryKey: ['industry-registry-admin'] });
  };

  const setActiveVersion = async (targetVersion: number, rollback = false) => {
    const fn = rollback ? 'rollback_industry_registry_version' : 'set_active_industry_registry_version';
    const { error } = await supabase.rpc(fn, {
      p_target_version: targetVersion,
      p_changed_by: 'admin_operator',
      p_reason: rollback ? `rollback:${registryReason}` : registryReason,
    });
    if (error) {
      toast.error(`${rollback ? 'Rollback' : 'Aktivering'} misslyckades: ${error.message}`);
      return;
    }
    toast.success(`${rollback ? 'Rollback' : 'Aktivering'} till v${targetVersion} utförd.`);
    queryClient.invalidateQueries({ queryKey: ['industry-registry-admin'] });
    queryClient.invalidateQueries({ queryKey: ['industry-registry-memberships'] });
  };

  const statusIcon = (status: string) => {
    if (status === 'success') return <CheckCircle2 className="h-4 w-4 text-primary" />;
    if (status === 'partial') return <AlertTriangle className="h-4 w-4 text-signal-caution" />;
    if (status === 'running') return <RefreshCw className="h-4 w-4 text-primary animate-spin" />;
    return <XCircle className="h-4 w-4 text-signal-danger" />;
  };

  const t1 = tier1Status;
  const tier1Complete = t1 && t1.fullWsp > 0 && t1.limited === 0 && t1.withPrices >= (t1.fullWsp + t1.proxy + t1.metals);

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

      {/* ═══ TIER 1 V1 READINESS ═══ */}
      <Card className="bg-card border-border border-2 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono tracking-wider text-primary flex items-center gap-2">
            <Shield className="h-4 w-4" />
            TIER 1 V1 READINESS
            {tier1Complete && <Badge className="bg-primary text-primary-foreground text-[10px] ml-2">REDO</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Classification */}
          <div>
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Klassificering</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <StatBox label="Total Tier 1" value={String(t1?.total ?? '—')} />
              <StatBox label="full_wsp_equity" value={String(t1?.fullWsp ?? '—')} highlight />
              <StatBox label="Benchmarks/Proxy" value={String(t1?.proxy ?? '—')} />
              <StatBox label="Metals (limited)" value={String(t1?.metals ?? '—')} />
              <StatBox label="Enriched" value={String(t1?.enriched ?? '—')} />
            </div>
          </div>

          {/* Data Readiness */}
          <div>
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Datareadiness</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatBox label="Med prisdata" value={String(t1?.withPrices ?? '—')} highlight={t1 ? t1.withPrices >= t1.total : false} />
              <StatBox label="Analysredo (≥200 bars)" value={String(t1?.analysisReady ?? '—')} highlight={t1 ? t1.analysisReady >= t1.fullWsp : false} />
              <StatBox label="Backfill men <200" value={String(t1?.backfilledButNotReady ?? '—')} />
              <StatBox label="Indicators ready" value={String(t1?.indicatorReadyCount ?? '—')} />
              <StatBox label="Tier1 in latest scan" value={String(t1?.tier1PromotionCount ?? '—')} />
              <StatBox label="Tier1 scan coverage" value={String(t1?.latestScanCoverage ?? '—')} />
              <StatBox label="Saknar prisdata" value={String(t1?.noPrices?.length ?? '—')} highlight={t1 ? (t1.noPrices?.length ?? 0) === 0 : false} />
            </div>
          </div>

          {/* Missing data warnings */}
          {t1 && t1.noPrices && t1.noPrices.length > 0 && t1.noPrices.length <= 20 && (
            <div className="text-[10px] font-mono text-muted-foreground bg-muted rounded p-2">
              <span className="text-signal-caution">⚠ Saknar prisdata:</span>{' '}
              {t1.noPrices.join(', ')}
            </div>
          )}

          {t1 && t1.limited > 0 && (
            <div className="text-[10px] font-mono text-muted-foreground bg-muted rounded p-2">
              <span className="text-signal-caution">⚠ Ej full WSP (metadata saknas):</span>{' '}
              {t1.missingIndustry?.join(', ') || t1.missingSector?.join(', ')}
            </div>
          )}

          <div className="text-[10px] font-mono text-muted-foreground bg-muted rounded p-2">
            <span className="text-primary">Reference tier1 constants (client):</span> {SCANNER_ELIGIBLE_SYMBOLS.length} scanner-eligible · {TRACKED_SYMBOLS.length} tracked.
            <span className="text-muted-foreground"> Live readiness metrics above are now read from scanner_universe_snapshot + market_scan_results_latest.</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono tracking-wider text-primary flex items-center gap-2">
            <Radar className="h-4 w-4" />
            PHASE 7 BROAD SCANNER OPS
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <StatBox label="Universe total" value={String(broadScannerOps?.summary?.universe_total_symbols ?? '—')} />
            <StatBox label="Scanner eligible" value={String(broadScannerOps?.summary?.scanner_eligible_symbols ?? '—')} highlight />
            <StatBox label="Scan results" value={String(broadScannerOps?.summary?.generated_scan_results ?? '—')} />
            <StatBox label="Approved live" value={String(broadScannerOps?.summary?.approved_for_live_scanner ?? '—')} />
            <StatBox label="Live cohort (tier1+approved)" value={String((Number(broadScannerOps?.summary?.tier1_default ?? 0) + Number(broadScannerOps?.summary?.approved_for_live_scanner ?? 0)) || '—')} highlight />
          </div>
          <div className="rounded border border-border p-2">
            <p className="text-[10px] font-mono text-muted-foreground mb-1">Top exclusion reasons</p>
            <div className="flex flex-wrap gap-2">
              {(broadScannerOps?.summary?.top_exclusion_reasons ?? []).slice(0, 8).map((row: any) => (
                <Badge key={row.reason} variant="outline" className="text-[10px] font-mono">
                  {row.reason}:{row.count}
                </Badge>
              ))}
              {!(broadScannerOps?.summary?.top_exclusion_reasons ?? []).length && (
                <span className="text-[10px] font-mono text-muted-foreground">No exclusion stats yet. Run scan-market.</span>
              )}
            </div>
          </div>
          <div className="rounded border border-border p-2">
            <p className="text-[10px] font-mono text-muted-foreground mb-2">Sample candidates</p>
            <div className="max-h-48 overflow-auto space-y-1">
              {(broadScannerOps?.sample_candidates ?? []).slice(0, 15).map((row: any) => (
                <div key={row.symbol} className="text-[10px] font-mono bg-muted rounded px-2 py-1 flex items-center justify-between gap-2">
                  <span className="text-foreground">{row.symbol} · {row.pattern} · {row.recommendation}</span>
                  <span className="text-muted-foreground">score:{row.score} · {row.promotion_status}</span>
                </div>
              ))}
              {!(broadScannerOps?.sample_candidates ?? []).length && (
                <p className="text-[10px] font-mono text-muted-foreground">No samples available yet.</p>
              )}
            </div>
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
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            <StatBox label="Symboler" value={stats?.symbolCount?.toLocaleString() ?? '—'} />
            <StatBox label="Prisrader" value={stats?.priceCount?.toLocaleString() ?? '—'} />
            <StatBox label="Earliest" value={stats?.earliest ?? '—'} />
            <StatBox label="Latest" value={stats?.latest ?? '—'} />
            <StatBox label="Enriched" value={stats?.enrichedCount?.toLocaleString() ?? '—'} />
            <StatBox label="Eligible Backfill" value={stats?.eligibleBackfillCount?.toLocaleString() ?? '—'} />
            <StatBox label="Eligible Full WSP" value={stats?.eligibleFullWspCount?.toLocaleString() ?? '—'} />
            <StatBox label="Excluded" value={stats?.excludedCount?.toLocaleString() ?? '—'} />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono tracking-wider text-primary">
            SECTOR/INDUSTRY QUALITY LAYER
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatBox label="Canonicalized" value={stats?.canonicalizedCount?.toLocaleString() ?? '—'} />
            <StatBox label="Ambiguous" value={stats?.ambiguousCount?.toLocaleString() ?? '—'} />
            <StatBox label="Unresolved" value={stats?.unresolvedCount?.toLocaleString() ?? '—'} />
            <StatBox label="Proxy mapped" value={stats?.proxyMappedCount?.toLocaleString() ?? '—'} />
            <StatBox label="Manually reviewed" value={stats?.manuallyReviewedCount?.toLocaleString() ?? '—'} />
            <StatBox label="Blocked full WSP" value={stats?.blockedByClassificationCount?.toLocaleString() ?? '—'} highlight />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono tracking-wider text-primary">
            PHASE 5 INDUSTRY PROXY / BASKET REGISTRY
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatBox label="Active version" value={industryRegistryData?.activeVersion ? `v${industryRegistryData.activeVersion}` : '—'} highlight />
            <StatBox label="Draft" value={String(industryRegistryData?.statusCounts?.find((r: any) => r.registry_status === 'draft')?.industry_count ?? 0)} />
            <StatBox label="Active industries" value={String(industryRegistryData?.statusCounts?.find((r: any) => r.registry_status === 'active')?.industry_count ?? 0)} />
            <StatBox label="Unresolved" value={String(industryRegistryData?.proxyTypeCounts?.find((r: any) => r.proxy_type === 'unresolved')?.industry_count ?? 0)} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatBox label="Direct proxy" value={String(industryRegistryData?.proxyTypeCounts?.find((r: any) => r.proxy_type === 'direct_proxy_symbol')?.industry_count ?? 0)} />
            <StatBox label="Internal EW" value={String(industryRegistryData?.proxyTypeCounts?.find((r: any) => r.proxy_type === 'internal_equal_weight_basket')?.industry_count ?? 0)} />
            <StatBox label="Internal weighted" value={String(industryRegistryData?.proxyTypeCounts?.find((r: any) => r.proxy_type === 'internal_weighted_basket')?.industry_count ?? 0)} />
            <StatBox label="Pending queue" value={String(industryRegistryData?.pending?.length ?? 0)} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatBox label="Membership industries" value={String(industryRegistryData?.operatorSummary?.industries_with_memberships ?? 0)} />
            <StatBox label="Included members" value={String(industryRegistryData?.operatorSummary?.included_memberships ?? 0)} />
            <StatBox label="Watchlist members" value={String(industryRegistryData?.operatorSummary?.watchlist_memberships ?? 0)} />
            <StatBox label="Excluded members" value={String(industryRegistryData?.operatorSummary?.excluded_memberships ?? 0)} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatBox label="Aligned direct" value={String(industryRegistryData?.operatorSummary?.aligned_direct_proxy_symbols ?? 0)} />
            <StatBox label="Aligned basket" value={String(industryRegistryData?.operatorSummary?.aligned_internal_basket_symbols ?? 0)} />
            <StatBox label="Unresolved align" value={String(industryRegistryData?.operatorSummary?.unresolved_alignment_symbols ?? 0)} />
            <StatBox
              label="Blocked low quality"
              value={String(industryRegistryData?.operatorSummary?.blocked_low_quality_symbols ?? 0)}
              highlight
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono text-muted-foreground">Reason / change ticket</label>
            <input
              value={registryReason}
              onChange={(e) => setRegistryReason(e.target.value)}
              className="w-full bg-muted border border-border rounded px-2 py-1 text-xs font-mono"
              placeholder="e.g. phase5_manual_adjustment"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="font-mono text-xs" onClick={refreshRegistryVersion}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh active version
            </Button>
            <Button variant="outline" className="font-mono text-xs" onClick={createDraftVersion}>
              <GitBranchPlus className="h-3.5 w-3.5 mr-1.5" />
              Create draft version
            </Button>
            {(industryRegistryData?.versions ?? []).slice(0, 3).map((v: any) => (
              <Button key={v.version} variant="outline" className="font-mono text-xs" onClick={() => setActiveVersion(v.version, false)}>
                Activate v{v.version}
              </Button>
            ))}
            {industryRegistryData?.versions?.[1] && (
              <Button variant="outline" className="font-mono text-xs" onClick={() => setActiveVersion(industryRegistryData.versions[1].version, true)}>
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Rollback to v{industryRegistryData.versions[1].version}
              </Button>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded border border-border p-2">
              <p className="text-[10px] font-mono text-muted-foreground mb-2">Pending / unresolved industries</p>
              <div className="max-h-56 overflow-auto space-y-1">
                {(industryRegistryData?.pending ?? []).slice(0, 20).map((row: any) => (
                  <div key={`${row.registry_version}-${row.canonical_industry}`} className="text-[10px] font-mono bg-muted rounded px-2 py-1">
                    <div className="text-foreground">{row.canonical_sector} / {row.canonical_industry}</div>
                    <div className="text-muted-foreground">{row.proxy_type} · {row.registry_status} · conf:{row.confidence_level} · in:{row.included_count}</div>
                  </div>
                ))}
                {(industryRegistryData?.pending ?? []).length === 0 && (
                  <p className="text-[10px] font-mono text-muted-foreground">No pending industries.</p>
                )}
              </div>
            </div>
            <div className="rounded border border-border p-2">
              <p className="text-[10px] font-mono text-muted-foreground mb-2">Recent audit changes</p>
              <div className="max-h-56 overflow-auto space-y-1">
                {(industryRegistryData?.audit ?? []).slice(0, 20).map((row: any) => (
                  <div key={row.id} className="text-[10px] font-mono bg-muted rounded px-2 py-1">
                    <div className="text-foreground">{row.entity_type}:{row.action} · v{row.registry_version ?? '—'}</div>
                    <div className="text-muted-foreground">{row.affected_industry ?? 'global'} · by {row.changed_by}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded border border-border p-2">
            <p className="text-[10px] font-mono text-muted-foreground mb-2">Basket membership (active version sample)</p>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1 pr-2">Industry</th>
                    <th className="text-left py-1 pr-2">Symbol</th>
                    <th className="text-left py-1 pr-2">Status</th>
                    <th className="text-left py-1 pr-2">Weight</th>
                    <th className="text-left py-1">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeVersionMembership ?? []).slice(0, 80).map((row: any) => (
                    <tr key={`${row.canonical_industry}-${row.symbol}`} className="border-b border-border/30">
                      <td className="py-1 pr-2">{row.canonical_industry}</td>
                      <td className="py-1 pr-2 text-foreground">{row.symbol}</td>
                      <td className="py-1 pr-2">{row.membership_status}</td>
                      <td className="py-1 pr-2">{row.weight_method ? `${row.weight_method}${row.weight_value ? `:${row.weight_value}` : ''}` : '—'}</td>
                      <td className="py-1">{row.inclusion_reason || row.exclusion_reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded border border-border p-2">
            <p className="text-[10px] font-mono text-muted-foreground mb-2">Industry alignment blocked by quality (active registry)</p>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1 pr-2">Symbol</th>
                    <th className="text-left py-1 pr-2">Sector / Industry</th>
                    <th className="text-left py-1 pr-2">Class gate</th>
                    <th className="text-left py-1 pr-2">Support</th>
                    <th className="text-left py-1">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {(industryRegistryData?.blockedAlignment ?? []).slice(0, 60).map((row: any) => (
                    <tr key={`${row.symbol}-${row.canonical_industry}`} className="border-b border-border/30">
                      <td className="py-1 pr-2 text-foreground">{row.symbol}</td>
                      <td className="py-1 pr-2">{row.canonical_sector} / {row.canonical_industry}</td>
                      <td className="py-1 pr-2">{row.classification_status} · {row.classification_confidence_level}</td>
                      <td className="py-1 pr-2">{row.support_level}</td>
                      <td className="py-1">{row.alignment_reason}</td>
                    </tr>
                  ))}
                  {(industryRegistryData?.blockedAlignment ?? []).length === 0 && (
                    <tr>
                      <td className="py-2 text-muted-foreground" colSpan={5}>No blocked symbols in active alignment view.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono tracking-wider text-muted-foreground">
            OPERATOR REVIEW QUEUE (Classification)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reviewQueue && reviewQueue.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 pr-3">Symbol</th>
                    <th className="text-left py-2 pr-3">Raw</th>
                    <th className="text-left py-2 pr-3">Canonical</th>
                    <th className="text-left py-2 pr-3">Conf.</th>
                    <th className="text-left py-2 pr-3">Reason</th>
                    <th className="text-left py-2">Manual override</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewQueue.slice(0, 30).map((row: any) => (
                    <tr key={row.symbol} className="border-b border-border/50 align-top">
                      <td className="py-2 pr-3 text-foreground">
                        <div>{row.symbol}</div>
                        <div className="text-[10px] text-muted-foreground">{row.company_name}</div>
                        <div className="text-[10px] text-muted-foreground">{row.exchange} · {row.instrument_type}</div>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{row.raw_sector || '—'} / {row.raw_industry || '—'}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{row.canonical_sector || '—'} / {row.canonical_industry || '—'}</td>
                      <td className="py-2 pr-3 text-foreground">
                        {row.classification_confidence_level || 'low'} ({row.classification_confidence ?? 0})
                      </td>
                      <td className="py-2 pr-3 text-signal-caution">{row.flagged_reason}</td>
                      <td className="py-2 space-y-1 min-w-[260px]">
                        <input
                          placeholder="Canonical sector"
                          className="w-full bg-muted border border-border rounded px-2 py-1"
                          value={overrideDrafts[row.symbol]?.sector ?? ''}
                          onChange={(e) => setOverrideDrafts(prev => ({ ...prev, [row.symbol]: { ...prev[row.symbol], sector: e.target.value, industry: prev[row.symbol]?.industry ?? '', notes: prev[row.symbol]?.notes ?? '' } }))}
                        />
                        <input
                          placeholder="Canonical industry"
                          className="w-full bg-muted border border-border rounded px-2 py-1"
                          value={overrideDrafts[row.symbol]?.industry ?? ''}
                          onChange={(e) => setOverrideDrafts(prev => ({ ...prev, [row.symbol]: { ...prev[row.symbol], sector: prev[row.symbol]?.sector ?? '', industry: e.target.value, notes: prev[row.symbol]?.notes ?? '' } }))}
                        />
                        <input
                          placeholder="Review notes (optional)"
                          className="w-full bg-muted border border-border rounded px-2 py-1"
                          value={overrideDrafts[row.symbol]?.notes ?? ''}
                          onChange={(e) => setOverrideDrafts(prev => ({ ...prev, [row.symbol]: { ...prev[row.symbol], sector: prev[row.symbol]?.sector ?? '', industry: prev[row.symbol]?.industry ?? '', notes: e.target.value } }))}
                        />
                        <Button size="sm" variant="outline" className="font-mono text-[10px]" onClick={() => applyManualOverride(row.symbol)}>
                          Save override
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground font-mono">Inga symbols i review queue.</p>
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

            <Button onClick={runBroadScan} disabled={running !== null} variant="outline" className="font-mono text-xs">
              <Radar className={`h-4 w-4 mr-2 ${running === 'scan' ? 'animate-pulse' : ''}`} />
              {running === 'scan' ? 'Skannar marknad...' : 'Kör broad market scan'}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={running !== null} className="font-mono text-xs bg-primary text-primary-foreground">
                  <Download className="h-4 w-4 mr-2" />
                  {running === 'backfill' ? 'Backfill pågår...' : '⚡ Backfill Tier 1'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Backfill Tier 1 symboler?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Laddar 5 år historisk data för {TIER1_SYMBOLS.length} Tier 1 symboler via Polygon.io.
                    Benchmarks processas först, sedan equities, sedan metals.
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
                <Button disabled={running !== null} variant="outline" className="font-mono text-xs">
                  <Download className="h-4 w-4 mr-2" />
Broad backfill
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Starta full historisk backfill?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Laddar 5 år historisk data för eligible_for_backfill-universet (ej alla lagrade symboler).
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Avbryt</AlertDialogCancel>
                  <AlertDialogAction onClick={() => runBackfill(0, false, 'eligible_common_stock')}>Starta broad backfill</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Enrichment Tier Buttons */}
            <div className="flex flex-wrap gap-2 border-l border-border pl-3">
              <Button onClick={() => runEnrich('tier1')} disabled={running !== null} variant="outline" className="font-mono text-xs">
                <Zap className="h-4 w-4 mr-2" />
                {running === 'enrich' && enrichProgress.tier === 'tier1' ? 'Tier 1...' : 'Berika Tier 1'}
              </Button>
              <Button onClick={() => runEnrich('tier2')} disabled={running !== null} variant="outline" className="font-mono text-xs">
                <Zap className="h-4 w-4 mr-2" />
                {running === 'enrich' && enrichProgress.tier === 'tier2' ? 'Tier 2...' : 'Berika Tier 2'}
              </Button>
            </div>
          </div>

          {/* Resume */}
          {!running && resumeOffset > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs font-mono text-muted-foreground">Resume offset:</span>
              <input
                type="number"
                value={resumeOffset}
                onChange={(e) => setResumeOffset(Number(e.target.value))}
                className="w-24 bg-muted border border-border rounded px-2 py-1 text-xs font-mono text-foreground"
              />
              <Button onClick={() => runBackfill(resumeOffset, false, 'eligible_common_stock')} variant="outline" size="sm" className="font-mono text-xs">
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
                    ? `Offset ${backfillProgress.offset} / ~${backfillProgress.total} · ${backfillProgress.fetched} hämtade · ${backfillProgress.rowsWritten} rader · ${backfillProgress.failed} misslyckade`
                    : running === 'enrich'
                    ? `${enrichProgress.tier.toUpperCase()} · ${enrichProgress.offset}/${enrichProgress.tierTotal || '?'} · ${enrichProgress.selected}/${enrichProgress.requested} matchade · ${enrichProgress.enriched} berikade · ${enrichProgress.promoted} promoted`
                    : 'Bearbetar...'}
                </span>
              </div>
              {running === 'backfill' && Object.keys(backfillProgress.failureCounts).some(k => (backfillProgress.failureCounts[k] ?? 0) > 0) && (
                <div className="text-[10px] font-mono text-muted-foreground ml-5 space-y-0.5">
                  {Object.entries(backfillProgress.failureCounts).filter(([,v]) => v > 0).sort((a,b) => (b[1] as number) - (a[1] as number)).map(([k,v]) => {
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
