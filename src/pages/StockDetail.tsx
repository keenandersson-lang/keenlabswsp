import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useWspScreener } from '@/hooks/use-wsp-screener';
import { useStockDetail } from '@/hooks/use-stock-detail';
import { StockChartModule } from '@/components/StockChartModule';
import type { ChartTimeframe } from '@/lib/chart-types';
import { barsForTimeframe, clampAsOfIndex } from '@/lib/charting';
import { evaluateStock } from '@/lib/wsp-engine';
import { ArrowLeft, AlertTriangle, Shield, BarChart3 } from 'lucide-react';
import { RecommendationBadge } from '@/components/RecommendationBadge';
import { PatternBadge } from '@/components/PatternBadge';
import { formatBlockedReason } from '@/lib/wsp-assertions';
import { sanitizeClientErrorMessage } from '@/lib/safe-messages';
import { isBenchmarkSymbol } from '@/lib/benchmarks';
import { deriveStockTrustContext } from '@/lib/discovery';

export default function StockDetail() {
  const { symbol } = useParams<{ symbol: string }>();
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('6M');
  const [asOfEnabled, setAsOfEnabled] = useState(false);
  const [asOfIndex, setAsOfIndex] = useState(0);

  const screenerQuery = useWspScreener();
  const detailQuery = useStockDetail(symbol);
  const liveStock = screenerQuery.data?.stocks.find((item) => item.symbol === symbol?.toUpperCase());
  const requestedSymbol = symbol?.toUpperCase() ?? '';
  const isBenchmark = isBenchmarkSymbol(requestedSymbol);

  const detailData = detailQuery.data?.data;
  const discoveryMeta = screenerQuery.data?.discoveryMeta;
  const timeframeBars = useMemo(() => {
    if (!detailData) return { bars: [], cadence: 'daily' as const };
    return barsForTimeframe(timeframe, detailData.barsDaily, detailData.barsWeekly);
  }, [detailData, timeframe]);

  const historicalStock = useMemo(() => {
    if (!detailData || !liveStock || timeframeBars.bars.length === 0) return liveStock;
    const idx = clampAsOfIndex(asOfIndex, timeframeBars.bars.length);
    const asOfBars = asOfEnabled ? timeframeBars.bars.slice(0, idx + 1) : timeframeBars.bars;
    const benchmarkSource = timeframeBars.cadence === 'weekly' ? detailData.benchmarkWeekly : detailData.benchmarkDaily;
    const benchmarkBars = benchmarkSource.filter((bar) => bar.date <= asOfBars[asOfBars.length - 1]?.date);
    if (asOfBars.length === 0 || benchmarkBars.length === 0) return liveStock;
    return evaluateStock(
      liveStock.symbol, liveStock.name, liveStock.sector, liveStock.industry,
      asOfBars, benchmarkBars,
      liveStock.gate.sectorAligned, liveStock.gate.marketFavorable,
      liveStock.dataSource,
      { overrideAnalysis: { lastUpdated: detailData.fetchedAt } },
    );
  }, [detailData, liveStock, asOfEnabled, asOfIndex, timeframeBars]);

  const benchmarkStock = useMemo(() => {
    if (!detailData || !isBenchmark) return null;
    if (detailData.barsDaily.length === 0 || detailData.benchmarkDaily.length === 0) return null;
    return evaluateStock(
      detailData.symbol, detailData.name, detailData.sector, detailData.industry,
      detailData.barsDaily, detailData.benchmarkDaily,
      true, true, 'live',
      { overrideAnalysis: { lastUpdated: detailData.fetchedAt } },
    );
  }, [detailData, isBenchmark]);

  // Loading state
  if (screenerQuery.isLoading || detailQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back</Link>
        <div className="flex items-center gap-3 mt-8">
          <BarChart3 className="h-5 w-5 text-primary animate-pulse" />
          <span className="text-sm text-muted-foreground">Loading analysis for {requestedSymbol}...</span>
        </div>
      </div>
    );
  }

  // Not found
  if (!liveStock && !isBenchmark) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back</Link>
        <div className="mt-8 rounded-lg border border-signal-sell/20 bg-signal-sell/5 p-4 text-sm text-signal-sell">
          <strong>{requestedSymbol}</strong> is not in the current tracked universe.
        </div>
      </div>
    );
  }

  // Chart data error
  if (!detailQuery.data?.ok || !detailData) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back</Link>
        <div className="mt-8 rounded-lg border border-signal-sell/20 bg-signal-sell/5 p-4 text-sm text-signal-sell">
          Chart data unavailable: {sanitizeClientErrorMessage(detailQuery.data?.error?.message)}
        </div>
      </div>
    );
  }

  const stock = historicalStock ?? liveStock ?? benchmarkStock;
  if (!stock) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back</Link>
        <div className="mt-8 text-sm text-muted-foreground">Could not build analysis from available data.</div>
      </div>
    );
  }

  const trustContext = stock ? deriveStockTrustContext(stock, discoveryMeta?.dataState ?? screenerQuery.data?.providerStatus.uiState ?? 'LIVE') : null;
  const discoverySourceLabel = discoveryMeta?.dataState === 'FALLBACK'
    ? 'Tracked-universe fallback snapshot'
    : discoveryMeta?.dataState === 'STALE'
      ? 'Tracked-universe stale snapshot'
      : 'Tracked-universe live snapshot';
  const contextState = screenerQuery.data?.providerStatus.uiState ?? 'LIVE';

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5">
        {/* Header */}
        <div>
          <Link to="/" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft className="h-3.5 w-3.5" /> Back to Screener</Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{stock.symbol} <span className="text-lg text-muted-foreground font-normal">{stock.name}</span></h1>
              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <span>{stock.sector}</span>
                <span className="text-border">·</span>
                <span>{stock.industry}</span>
              </div>
            </div>
            <div className="text-right space-y-1">
              <div className="text-2xl font-bold font-mono text-foreground">
                ${stock.price.toFixed(2)}
                <span className={`ml-2 text-base ${stock.changePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                  {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center justify-end gap-2">
                <PatternBadge pattern={stock.pattern} />
                <RecommendationBadge recommendation={stock.finalRecommendation} />
              </div>
            </div>
          </div>
        </div>

        {/* Chart */}
        <StockChartModule
          stock={stock}
          dailyBars={detailData.barsDaily}
          weeklyBars={detailData.barsWeekly}
          dailyBenchmark={detailData.benchmarkDaily}
          weeklyBenchmark={detailData.benchmarkWeekly}
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
          asOfEnabled={asOfEnabled}
          onAsOfEnabledChange={setAsOfEnabled}
          asOfIndex={asOfIndex}
          onAsOfIndexChange={setAsOfIndex}
          dataState={contextState}
        />

        {/* Analysis panels */}
        <section className="grid gap-4 lg:grid-cols-2">
          {/* Opportunity summary */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold text-foreground">Opportunity Summary</h2>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {trustContext && (
                <>
                  <span className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Trend bucket: {trustContext.bucket}</span>
                  <span className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{discoverySourceLabel}</span>
                  {trustContext.degradedQualified && <span className="rounded border border-signal-caution/30 bg-signal-caution/10 px-2 py-0.5 text-[10px] text-signal-caution">Degraded classification</span>}
                  {trustContext.withinTrackedUniverse && <span className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Scope: tracked universe only</span>}
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-4">
              {stock.finalRecommendation === 'KÖP'
                ? 'Current snapshot passes strict WSP entry gate for this symbol (pattern, entry filter, and recommendation are aligned).'
                : stock.finalRecommendation === 'BEVAKA'
                ? 'Constructive setup, but one or more strict gates remain unresolved. Wait for gate-level confirmation before treating as qualified.'
                : 'Setup is blocked by one or more strict WSP filters in the current snapshot. Review blockers before taking action.'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <InfoCell label="Resistance" value={stock.audit.resistanceLevel?.toFixed(2) ?? '—'} />
              <InfoCell label="Breakout Level" value={stock.audit.breakoutLevel?.toFixed(2) ?? '—'} />
              <InfoCell label="Support (SMA50)" value={stock.audit.sma50?.toFixed(2) ?? '—'} />
              <InfoCell label="Mansfield RS" value={stock.audit.mansfieldValue?.toFixed(2) ?? '—'} />
              <InfoCell label="Volume Multiple" value={stock.audit.volumeMultiple?.toFixed(2) ?? '—'} />
              <InfoCell label="Score" value={`${stock.score} / ${stock.maxScore}`} />
            </div>
          </div>

          {/* WSP Audit context */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold text-foreground">WSP Audit Context</h2>
            </div>
            <div className="space-y-1.5 text-xs">
              <AuditRow label="Data context" value={contextState} ok={contextState === 'LIVE'} />
              <AuditRow label="Discovery scope" value="Tracked universe" />
              <AuditRow label="Pattern state" value={stock.pattern} />
              <AuditRow label="Trend (SMA50)" value={stock.audit.sma50SlopeDirection} />
              <AuditRow label="Above 50MA" value={stock.audit.above50MA ? 'Yes' : 'No'} ok={stock.audit.above50MA} />
              <AuditRow label="Above 150MA" value={stock.audit.above150MA ? 'Yes' : 'No'} ok={stock.audit.above150MA} />
              <AuditRow label="Breakout quality" value={stock.audit.breakoutQualityPass ? 'Pass' : 'Blocked'} ok={stock.audit.breakoutQualityPass} />
              <AuditRow label="Mansfield valid" value={stock.audit.mansfieldValid ? 'Yes' : 'No'} ok={stock.audit.mansfieldValid} />
              <AuditRow label="Sector aligned" value={stock.audit.sectorAligned ? 'Yes' : 'No'} ok={stock.audit.sectorAligned} />
              <AuditRow label="Market aligned" value={stock.audit.marketAligned ? 'Yes' : 'No'} ok={stock.audit.marketAligned} />
              <AuditRow label="Benchmark context" value={detailData.benchmarkDaily.length > 0 ? 'Renderable' : 'Limited'} ok={detailData.benchmarkDaily.length > 0} />
            </div>

            {(stock.blockedReasons.length > 0 || stock.logicViolations.length > 0) && (
              <div className="mt-4 rounded-lg border border-signal-caution/30 bg-signal-caution/5 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-signal-caution">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Blocked Reasons
                </div>
                <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                  {stock.blockedReasons.map((reason) => <li key={reason}>{formatBlockedReason(reason)}</li>)}
                  {stock.logicViolations.map((v) => <li key={`lv-${v}`} className="text-signal-sell">Logic violation: {formatBlockedReason(v)}</li>)}
                </ul>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-xs font-semibold text-foreground mt-0.5">{value}</div>
    </div>
  );
}

function AuditRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${ok === true ? 'text-signal-buy' : ok === false ? 'text-signal-sell' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}
