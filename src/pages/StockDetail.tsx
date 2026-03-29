import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWspScreener } from '@/hooks/use-wsp-screener';
import { useStockDetail } from '@/hooks/use-stock-detail';
import { StockChartModule } from '@/components/StockChartModule';
import { WSPChecklist } from '@/components/WSPChecklist';
import { PositionSizer } from '@/components/PositionSizer';
import type { ChartTimeframe } from '@/lib/chart-types';
import { barsForTimeframe, clampAsOfIndex } from '@/lib/charting';
import { evaluateStock } from '@/lib/wsp-engine';
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { PatternBadge } from '@/components/PatternBadge';
import { WSPScoreRing } from '@/components/WSPScoreRing';
import { sanitizeClientErrorMessage } from '@/lib/safe-messages';
import { isBenchmarkSymbol } from '@/lib/benchmarks';
import { Skeleton } from '@/components/ui/skeleton';
import type { Bar, WSPPattern } from '@/lib/wsp-types';
import { supabase } from '@/integrations/supabase/client';

type DetailTab = 'chart' | 'checklist' | 'sizer';

const patternBanners: Record<WSPPattern, { bg: string; border: string; text: string }> = {
  CLIMBING: { bg: 'bg-[#0d2e1a]', border: 'border-signal-buy', text: '📈 CLIMBING PATTERN — Breakout ovanför motstånd med hög volym' },
  TIRED: { bg: 'bg-[#2e1f00]', border: 'border-signal-caution', text: '⚠️ TIRED PATTERN — Konsoliderar vid topp. WSP säger: sälj-zon.' },
  DOWNHILL: { bg: 'bg-[#2e0000]', border: 'border-signal-sell', text: '🔴 DOWNHILL PATTERN — Under 150MA. Undvik köp per WSP.' },
  BASE: { bg: 'bg-[#0d0d2e]', border: 'border-muted-foreground', text: '🟦 BASE PATTERN — Sidleds konsolidering. Vänta på breakout.' },
};

export default function StockDetail() {
  const { symbol } = useParams<{ symbol: string }>();
  const [activeTab, setActiveTab] = useState<DetailTab>('chart');
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('3M');
  const [asOfEnabled, setAsOfEnabled] = useState(false);
  const [asOfIndex, setAsOfIndex] = useState(0);

  const screenerQuery = useWspScreener();
  const detailQuery = useStockDetail(symbol);
  const requestedSymbol = symbol?.toUpperCase() ?? '';
  const isBenchmark = isBenchmarkSymbol(requestedSymbol);
  const dailyPricesQuery = useQuery({
    queryKey: ['stock-detail-daily-prices', requestedSymbol],
    enabled: Boolean(requestedSymbol),
    staleTime: 60_000,
    queryFn: async (): Promise<Bar[]> => {
      const { data, error } = await supabase
        .from('daily_prices')
        .select('date, open, high, low, close, volume')
        .eq('symbol', requestedSymbol)
        .order('date', { ascending: false })
        .limit(200);

      if (error) throw error;
      if (!data || data.length === 0) return [];

      return [...data]
        .reverse()
        .map((row) => ({
          date: row.date,
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: Number(row.volume),
        }));
    },
  });

  const liveStock = screenerQuery.data?.stocks.find((item) => item.symbol === requestedSymbol);
  const detailData = detailQuery.data?.data;
  const resolvedDailyBars = useMemo(() => {
    if (dailyPricesQuery.data && dailyPricesQuery.data.length > 0) return dailyPricesQuery.data;
    return detailData?.barsDaily ?? [];
  }, [dailyPricesQuery.data, detailData?.barsDaily]);
  const isMetals = detailData?.assetClass === 'metals';

  const marketFavorable = screenerQuery.data?.market?.marketTrend === 'bullish';
  const sectorAligned = liveStock?.gate.sectorAligned ?? false;

  const timeframeBars = useMemo(() => {
    if (!detailData) return { bars: [], cadence: 'daily' as const };
    return barsForTimeframe(timeframe, resolvedDailyBars, detailData.barsWeekly);
  }, [detailData, timeframe, resolvedDailyBars]);

  const baseStock = useMemo(() => {
    if (!detailData) return null;
    if (resolvedDailyBars.length === 0 || detailData.benchmarkDaily.length === 0) return null;

    return evaluateStock(
      detailData.symbol,
      detailData.name,
      detailData.sector,
      detailData.industry,
      resolvedDailyBars,
      detailData.benchmarkDaily,
      sectorAligned,
      marketFavorable ?? true,
      'live',
      {
        metadata: {
          exchange: detailData.exchange,
          assetClass: detailData.assetClass,
          supportsFullWsp: detailData.supportsFullWsp,
          wspSupport: detailData.wspSupport,
        },
        overrideAnalysis: { lastUpdated: detailData.fetchedAt },
      },
    );
  }, [detailData, marketFavorable, resolvedDailyBars, sectorAligned]);

  const historicalStock = useMemo(() => {
    if (!detailData || timeframeBars.bars.length === 0) return baseStock;

    const idx = clampAsOfIndex(asOfIndex, timeframeBars.bars.length);
    const asOfBars = asOfEnabled ? timeframeBars.bars.slice(0, idx + 1) : timeframeBars.bars;
    const benchmarkSource = timeframeBars.cadence === 'weekly' ? detailData.benchmarkWeekly : detailData.benchmarkDaily;
    const benchmarkBars = benchmarkSource.filter((bar) => bar.date <= asOfBars[asOfBars.length - 1]?.date);

    if (asOfBars.length === 0 || benchmarkBars.length === 0) return baseStock;

    return evaluateStock(
      detailData.symbol,
      detailData.name,
      detailData.sector,
      detailData.industry,
      asOfBars,
      benchmarkBars,
      sectorAligned,
      marketFavorable ?? true,
      'live',
      {
        metadata: {
          exchange: detailData.exchange,
          assetClass: detailData.assetClass,
          supportsFullWsp: detailData.supportsFullWsp,
          wspSupport: detailData.wspSupport,
        },
        overrideAnalysis: { lastUpdated: detailData.fetchedAt },
      },
    );
  }, [asOfEnabled, asOfIndex, baseStock, detailData, marketFavorable, sectorAligned, timeframeBars]);

  const benchmarkStock = useMemo(() => {
    if (!detailData || !isBenchmark) return null;
    if (resolvedDailyBars.length === 0 || detailData.benchmarkDaily.length === 0) return null;
    return evaluateStock(
      detailData.symbol,
      detailData.name,
      detailData.sector,
      detailData.industry,
      resolvedDailyBars,
      detailData.benchmarkDaily,
      true,
      true,
      'live',
      { overrideAnalysis: { lastUpdated: detailData.fetchedAt } },
    );
  }, [detailData, isBenchmark, resolvedDailyBars]);

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Link to="/screener" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Tillbaka
        </Link>
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-32" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="ml-auto h-16 w-16 rounded-full" />
        </div>
        <div className="flex gap-4">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="h-[480px] w-full rounded-lg" />
      </div>
    );
  }

  if (!detailQuery.data?.ok || !detailData) {
    const symbolNotSearchable = detailQuery.data?.error?.code === 'SYMBOL_NOT_IN_SEARCHABLE_UNIVERSE';

    return (
      <div className="p-6">
        <Link to="/screener" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Tillbaka
        </Link>
        <div className={`mt-8 rounded-lg border p-4 text-sm ${symbolNotSearchable ? 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution' : 'border-signal-sell/20 bg-signal-sell/5 text-signal-sell'}`}>
          {symbolNotSearchable
            ? `Symbol ${requestedSymbol} finns inte i sökbara universumregistret.`
            : `Chart-data ej tillgänglig: ${sanitizeClientErrorMessage(detailQuery.data?.error?.message)}`}
        </div>
      </div>
    );
  }

  const stock = historicalStock ?? baseStock ?? benchmarkStock;
  if (!stock) {
    return (
      <div className="p-6">
        <Link to="/screener" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Tillbaka
        </Link>
        <div className="mt-8 text-sm text-muted-foreground">Kunde inte bygga analys från tillgänglig data.</div>
      </div>
    );
  }

  const contextState = screenerQuery.data?.providerStatus.uiState ?? 'LIVE';
  const banner = patternBanners[stock.pattern];
  const slopeIcon = stock.audit.sma50SlopeDirection === 'rising' ? <TrendingUp className="h-3 w-3" /> : stock.audit.sma50SlopeDirection === 'falling' ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />;
  const volMultiple = stock.audit.volumeMultiple;

  const notices = [
    !detailData.isApprovedLiveCohort ? 'Not currently in approved live cohort.' : null,
    !detailData.supportsFullWsp ? 'Insufficient WSP readiness: symbol has limited WSP coverage.' : null,
    detailData.metadataCompleteness !== 'complete'
      ? `Metadata ${detailData.metadataCompleteness === 'missing' ? 'missing' : 'incomplete'} for one or more fields.`
      : null,
    resolvedDailyBars.length < 200 || detailData.benchmarkDaily.length < 200
      ? 'Indicator coverage incomplete: less than 200 bars available for full MA context.'
      : null,
  ].filter((item): item is string => Boolean(item));

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'chart', label: 'Chart' },
    { id: 'checklist', label: 'WSP Checklist' },
    { id: 'sizer', label: 'Position Sizer' },
  ];

  return (
    <div className="space-y-4 p-4">
      <Link to="/screener" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3 w-3" /> Tillbaka till Screener
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-xs font-mono font-bold text-primary">
              {stock.symbol.slice(0, 2)}
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{stock.symbol}</h1>
              <p className="text-sm text-muted-foreground">{stock.name}</p>
            </div>
          </div>

          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-bold font-mono text-foreground">${stock.price.toFixed(2)}</span>
            <span className={`text-lg font-mono font-semibold ${stock.changePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
              {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-mono text-muted-foreground">
              Vol: {volMultiple != null ? `${volMultiple.toFixed(1)}x snitt` : 'N/A'}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-mono text-muted-foreground">
              MA50: {slopeIcon}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-mono text-muted-foreground">
              Sektor: {stock.sector}
            </span>
            {isMetals && (
              <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[10px] font-mono text-accent">METAL</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <PatternBadge pattern={stock.pattern} size="md" />
          <WSPScoreRing score={stock.score} maxScore={stock.maxScore} size={80} />
        </div>
      </div>

      {notices.length > 0 && (
        <div className="space-y-2 rounded-lg border border-signal-caution/30 bg-signal-caution/10 p-3">
          {notices.map((notice) => (
            <div key={notice} className="text-xs font-mono text-signal-caution">• {notice}</div>
          ))}
        </div>
      )}

      <div className="flex gap-1 border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'chart' && (
        <div className="space-y-3">
          <div className={`rounded-lg border-l-4 ${banner.border} ${banner.bg} px-4 py-2.5 text-sm text-foreground`}>
            {banner.text}
          </div>

          <StockChartModule
            stock={stock}
            dailyBars={resolvedDailyBars}
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
        </div>
      )}

      {activeTab === 'checklist' && (
        <WSPChecklist stock={stock} onOpenPositionSizer={() => setActiveTab('sizer')} />
      )}

      {activeTab === 'sizer' && (
        <PositionSizer stock={stock} />
      )}
    </div>
  );
}
