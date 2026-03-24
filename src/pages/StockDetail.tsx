import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useWspScreener } from '@/hooks/use-wsp-screener';
import { useStockDetail } from '@/hooks/use-stock-detail';
import { StockChartModule } from '@/components/StockChartModule';
import type { ChartTimeframe } from '@/lib/chart-types';
import { barsForTimeframe, clampAsOfIndex } from '@/lib/charting';
import { evaluateStock } from '@/lib/wsp-engine';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { RecommendationBadge } from '@/components/RecommendationBadge';
import { PatternBadge } from '@/components/PatternBadge';
import { formatBlockedReason } from '@/lib/wsp-assertions';
import { sanitizeClientErrorMessage } from '@/lib/safe-messages';
import { isBenchmarkSymbol } from '@/lib/benchmarks';

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
      liveStock.symbol,
      liveStock.name,
      liveStock.sector,
      liveStock.industry,
      asOfBars,
      benchmarkBars,
      liveStock.gate.sectorAligned,
      liveStock.gate.marketFavorable,
      liveStock.dataSource,
      { overrideAnalysis: { lastUpdated: detailData.fetchedAt } },
    );
  }, [detailData, liveStock, asOfEnabled, asOfIndex, timeframeBars]);

  const benchmarkStock = useMemo(() => {
    if (!detailData || !isBenchmark) return null;
    if (detailData.barsDaily.length === 0 || detailData.benchmarkDaily.length === 0) return null;
    return evaluateStock(
      detailData.symbol,
      detailData.name,
      detailData.sector,
      detailData.industry,
      detailData.barsDaily,
      detailData.benchmarkDaily,
      true,
      true,
      'live',
      { overrideAnalysis: { lastUpdated: detailData.fetchedAt } },
    );
  }, [detailData, isBenchmark]);

  if (screenerQuery.isLoading || detailQuery.isLoading) {
    return <div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">Loading stock detail analysis...</div>;
  }

  if (!liveStock && !isBenchmark) {
    return <div className="min-h-screen bg-background p-6 text-sm text-signal-sell">Could not locate this ticker in the current tracked universe.</div>;
  }

  if (!detailQuery.data?.ok || !detailData) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back to Screener</Link>
        <div className="rounded-lg border border-signal-sell/40 bg-signal-sell/10 p-4 text-sm text-signal-sell">
          Failed to load chart data endpoint: {sanitizeClientErrorMessage(detailQuery.data?.error?.message)}
        </div>
      </div>
    );
  }

  const stock = historicalStock ?? liveStock ?? benchmarkStock;
  if (!stock) {
    return <div className="min-h-screen bg-background p-6 text-sm text-signal-sell">Could not build symbol analysis from current chart data.</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back to Screener</Link>
            <h1 className="text-2xl font-bold tracking-tight">{stock.symbol} <span className="text-muted-foreground">{stock.name}</span></h1>
            <div className="mt-1 text-sm text-muted-foreground">{stock.sector} / {stock.industry}</div>
          </div>
          <div className="space-y-1 text-right">
            <div className="text-xl font-semibold">${stock.price.toFixed(2)} <span className={stock.changePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}>({stock.changePercent.toFixed(2)}%)</span></div>
            <div className="flex items-center justify-end gap-2">
              <PatternBadge pattern={stock.pattern} />
              <RecommendationBadge recommendation={stock.finalRecommendation} />
            </div>
          </div>
        </div>

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
        />

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Opportunity summary</h2>
            <p className="text-sm text-muted-foreground">
              {stock.finalRecommendation === 'KÖP'
                ? 'Setup meets strict WSP entry criteria with breakout, volume and trend alignment.'
                : 'Setup is currently blocked by one or more hard WSP filters. Review blockers below before considering an entry.'}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Info label="Resistance" value={stock.audit.resistanceLevel?.toFixed(2) ?? 'N/A'} />
              <Info label="Breakout" value={stock.audit.breakoutLevel?.toFixed(2) ?? 'N/A'} />
              <Info label="Support (SMA50)" value={stock.audit.sma50?.toFixed(2) ?? 'N/A'} />
              <Info label="Mansfield" value={stock.audit.mansfieldValue?.toFixed(2) ?? 'N/A'} />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">WSP audit context</h2>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>Pattern state: <span className="font-medium text-foreground">{stock.pattern}</span></div>
              <div>Trend state: <span className="font-medium text-foreground">SMA50 {stock.audit.sma50SlopeDirection}</span></div>
              <div>Breakout quality: <span className="font-medium text-foreground">{stock.audit.breakoutQualityPass ? 'pass' : 'blocked'}</span></div>
              <div>Volume multiple: <span className="font-medium text-foreground">{stock.audit.volumeMultiple?.toFixed(2) ?? 'N/A'}</span></div>
            </div>
            {(stock.blockedReasons.length > 0 || stock.logicViolations.length > 0) && (
              <div className="mt-3 rounded-md border border-signal-caution/40 bg-signal-caution/10 p-3 text-xs text-signal-caution">
                <div className="mb-1 flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> Blocked reasons / logic violations</div>
                <ul className="list-disc space-y-1 pl-4">
                  {stock.blockedReasons.map((reason) => <li key={reason}>{formatBlockedReason(reason)}</li>)}
                  {stock.logicViolations.map((reason) => <li key={`lv-${reason}`}>Logic violation: {formatBlockedReason(reason)}</li>)}
                </ul>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-background px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-xs font-semibold text-foreground">{value}</div>
    </div>
  );
}
