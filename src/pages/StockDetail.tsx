import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useWspScreener } from '@/hooks/use-wsp-screener';
import { useStockDetail } from '@/hooks/use-stock-detail';
import { StockChartModule } from '@/components/StockChartModule';
import type { ChartTimeframe } from '@/lib/chart-types';
import { barsForTimeframe, clampAsOfIndex } from '@/lib/charting';
import { evaluateStock } from '@/lib/wsp-engine';
import { ArrowLeft, AlertTriangle, Shield, BarChart3, TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle } from 'lucide-react';
import { RecommendationBadge } from '@/components/RecommendationBadge';
import { PatternBadge } from '@/components/PatternBadge';
import { formatBlockedReason } from '@/lib/wsp-assertions';
import { sanitizeClientErrorMessage } from '@/lib/safe-messages';
import { isBenchmarkSymbol } from '@/lib/benchmarks';
import { deriveStockTrustContext } from '@/lib/discovery';
import { TRACKED_SYMBOL_LOOKUP } from '@/lib/tracked-symbols';

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
  const symbolMeta = TRACKED_SYMBOL_LOOKUP[requestedSymbol];
  const isMetals = symbolMeta?.assetClass === 'metals';

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

  if (screenerQuery.isLoading || detailQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3" /> BACK</Link>
        <div className="flex items-center gap-3 mt-8">
          <BarChart3 className="h-4 w-4 text-primary animate-pulse" />
          <span className="text-xs text-muted-foreground font-mono">Loading {requestedSymbol}...</span>
        </div>
      </div>
    );
  }

  if (!liveStock && !isBenchmark) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3" /> BACK</Link>
        <div className="mt-8 rounded border border-signal-sell/20 bg-signal-sell/5 p-4 text-xs text-signal-sell font-mono">
          {requestedSymbol} is not in the tracked universe.
        </div>
      </div>
    );
  }

  if (!detailQuery.data?.ok || !detailData) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3" /> BACK</Link>
        <div className="mt-8 rounded border border-signal-sell/20 bg-signal-sell/5 p-4 text-xs text-signal-sell font-mono">
          Chart data unavailable: {sanitizeClientErrorMessage(detailQuery.data?.error?.message)}
        </div>
      </div>
    );
  }

  const stock = historicalStock ?? liveStock ?? benchmarkStock;
  if (!stock) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3" /> BACK</Link>
        <div className="mt-8 text-xs text-muted-foreground font-mono">Could not build analysis from available data.</div>
      </div>
    );
  }

  const trustContext = stock ? deriveStockTrustContext(stock, discoveryMeta?.dataState ?? screenerQuery.data?.providerStatus.uiState ?? 'LIVE') : null;
  const contextState = screenerQuery.data?.providerStatus.uiState ?? 'LIVE';

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl space-y-3 px-4 py-4">
        {/* Header */}
        <div>
          <Link to="/" className="mb-2 inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft className="h-3 w-3" /> BACK TO SCREENER</Link>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground font-mono">{stock.symbol}</h1>
                <span className="text-sm text-muted-foreground">{stock.name}</span>
                {isMetals && <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[8px] font-mono text-accent">METAL</span>}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                <span>{stock.sector}</span>
                <span className="text-border">·</span>
                <span>{stock.industry}</span>
              </div>
            </div>
            <div className="text-right space-y-1">
              <div className="text-xl font-bold font-mono text-foreground">
                ${stock.price.toFixed(2)}
                <span className={`ml-2 text-sm ${stock.changePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
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

        {/* Metals disclaimer */}
        {isMetals && (
          <div className="rounded border border-signal-caution/20 bg-signal-caution/5 px-3 py-2 text-[10px] font-mono text-signal-caution">
            ⚠ Metals analysis uses daily-close WSP indicators. Sector/industry alignment context is limited for non-equity instruments.
          </div>
        )}

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
        <section className="grid gap-3 lg:grid-cols-2">
          {/* Decision summary */}
          <div className="rounded border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-3.5 w-3.5 text-primary" />
              <h2 className="text-[11px] font-bold text-foreground font-mono tracking-wider">DECISION SUMMARY</h2>
            </div>

            {/* Quick verdict */}
            <div className={`rounded border p-3 mb-3 ${stock.finalRecommendation === 'KÖP' ? 'border-signal-buy/30 bg-signal-buy/5' : stock.finalRecommendation === 'BEVAKA' ? 'border-accent/30 bg-accent/5' : 'border-signal-sell/20 bg-signal-sell/5'}`}>
              <div className="flex items-center gap-2 mb-1">
                {stock.finalRecommendation === 'KÖP' ? <CheckCircle2 className="h-3.5 w-3.5 text-signal-buy" /> : stock.finalRecommendation === 'BEVAKA' ? <Minus className="h-3.5 w-3.5 text-accent" /> : <XCircle className="h-3.5 w-3.5 text-signal-sell" />}
                <span className="text-xs font-mono font-bold">{stock.finalRecommendation === 'KÖP' ? 'VALID WSP ENTRY' : stock.finalRecommendation === 'BEVAKA' ? 'WATCH — NOT YET QUALIFIED' : stock.finalRecommendation === 'SÄLJ' ? 'SELL SIGNAL' : 'AVOID'}</span>
              </div>
              <p className="text-[10px] text-muted-foreground font-mono">
                {stock.finalRecommendation === 'KÖP'
                  ? 'All strict WSP gates pass. Pattern, entry filter, and recommendation are aligned.'
                  : stock.finalRecommendation === 'BEVAKA'
                  ? `${stock.blockedReasons.length} gate(s) unresolved. Wait for confirmation before entry.`
                  : `${stock.blockedReasons.length} blocker(s) active. Review before action.`}
              </p>
            </div>

            {/* What needs to change */}
            {stock.blockedReasons.length > 0 && stock.finalRecommendation !== 'KÖP' && (
              <div className="mb-3">
                <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">TO BECOME VALID ENTRY:</div>
                <ul className="space-y-0.5">
                  {stock.blockedReasons.map((reason) => (
                    <li key={reason} className="flex items-start gap-1.5 text-[10px] font-mono text-signal-caution">
                      <XCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                      {formatBlockedReason(reason)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 gap-1.5">
              <InfoCell label="Resistance" value={stock.audit.resistanceLevel?.toFixed(2) ?? '—'} />
              <InfoCell label="Breakout" value={stock.audit.breakoutLevel?.toFixed(2) ?? '—'} />
              <InfoCell label="SMA50" value={stock.audit.sma50?.toFixed(2) ?? '—'} />
              <InfoCell label="SMA150" value={stock.audit.sma150?.toFixed(2) ?? '—'} />
              <InfoCell label="SMA200" value={stock.audit.sma200?.toFixed(2) ?? '—'} />
              <InfoCell label="Mansfield" value={stock.audit.mansfieldValue?.toFixed(2) ?? '—'} />
              <InfoCell label="Vol Multiple" value={stock.audit.volumeMultiple?.toFixed(2) ?? '—'} />
              <InfoCell label="Score" value={`${stock.score}/${stock.maxScore}`} />
            </div>
          </div>

          {/* WSP Audit */}
          <div className="rounded border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-3.5 w-3.5 text-primary" />
              <h2 className="text-[11px] font-bold text-foreground font-mono tracking-wider">WSP AUDIT</h2>
            </div>
            <div className="space-y-0.5 text-[10px] font-mono">
              <AuditRow label="Data context" value={contextState} ok={contextState === 'LIVE'} />
              <AuditRow label="Pattern" value={stock.pattern} />
              <AuditRow label="SMA50 slope" value={stock.audit.sma50SlopeDirection} ok={stock.audit.slope50Positive} />
              <AuditRow label="Above 50MA" value={stock.audit.above50MA ? 'YES' : 'NO'} ok={stock.audit.above50MA} />
              <AuditRow label="Above 150MA" value={stock.audit.above150MA ? 'YES' : 'NO'} ok={stock.audit.above150MA} />
              <AuditRow label="Breakout valid" value={stock.audit.breakoutValid ? 'YES' : 'NO'} ok={stock.audit.breakoutValid} />
              <AuditRow label="Breakout quality" value={stock.audit.breakoutQualityPass ? 'PASS' : 'FAIL'} ok={stock.audit.breakoutQualityPass} />
              <AuditRow label="Volume sufficient" value={stock.audit.volumeValid ? 'YES' : 'NO'} ok={stock.audit.volumeValid} />
              <AuditRow label="Mansfield valid" value={stock.audit.mansfieldValid ? 'YES' : 'NO'} ok={stock.audit.mansfieldValid} />
              <AuditRow label="Sector aligned" value={stock.audit.sectorAligned ? 'YES' : 'NO'} ok={stock.audit.sectorAligned} />
              <AuditRow label="Market aligned" value={stock.audit.marketAligned ? 'YES' : 'NO'} ok={stock.audit.marketAligned} />
              <AuditRow label="Breakout age" value={stock.audit.breakoutAgeBars !== null ? `${stock.audit.breakoutAgeBars} bars` : '—'} ok={stock.audit.breakoutAgeBars !== null && !stock.audit.breakoutStale} />
              <AuditRow label="Gate overall" value={stock.gate.isValidWspEntry ? 'PASS' : 'FAIL'} ok={stock.gate.isValidWspEntry} />
            </div>

            {stock.logicViolations.length > 0 && (
              <div className="mt-3 rounded border border-signal-sell/30 bg-signal-sell/5 p-2">
                <div className="text-[9px] font-mono font-bold text-signal-sell mb-1">LOGIC VIOLATIONS</div>
                <ul className="space-y-0.5">
                  {stock.logicViolations.map((v) => <li key={v} className="text-[9px] font-mono text-signal-sell">{formatBlockedReason(v)}</li>)}
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
    <div className="rounded border border-border bg-background px-2.5 py-1.5">
      <div className="text-[8px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
      <div className="font-mono text-[11px] font-semibold text-foreground mt-0.5">{value}</div>
    </div>
  );
}

function AuditRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5 border-b border-border/30 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${ok === true ? 'text-signal-buy' : ok === false ? 'text-signal-sell' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}
