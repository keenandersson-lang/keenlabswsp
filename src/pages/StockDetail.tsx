import { useMemo, useState } from 'react';
import { Link, useSearchParams, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMarketCommand } from '@/hooks/use-market-command';
import { useStockDetail } from '@/hooks/use-stock-detail';
import { StockChartModule } from '@/components/StockChartModule';
import { WSPChecklist } from '@/components/WSPChecklist';
import { PositionSizer } from '@/components/PositionSizer';
import type { ChartTimeframe } from '@/lib/chart-types';
import { aggregateBarsWeekly, barsForTimeframe, clampAsOfIndex } from '@/lib/charting';
import { evaluateStock } from '@/lib/wsp-engine';
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { PatternBadge } from '@/components/PatternBadge';
import { WSPScoreRing } from '@/components/WSPScoreRing';
import { sanitizeClientErrorMessage } from '@/lib/safe-messages';
import { SECTOR_ETF_MAP } from '@/lib/market-universe';
import { sma } from '@/lib/wsp-indicators';
import { Skeleton } from '@/components/ui/skeleton';
import type { Bar, WSPPattern } from '@/lib/wsp-types';
import { supabase } from '@/integrations/supabase/client';

type DetailTab = 'chart' | 'checklist' | 'sizer';

const patternBanners: Record<WSPPattern, { bg: string; border: string; text: string }> = {
  climbing: { bg: 'bg-[#0d2e1a]', border: 'border-signal-buy', text: '📈 CLIMBING PATTERN — Breakout ovanför motstånd med hög volym' },
  base_or_climbing: { bg: 'bg-[#0d2e1a]', border: 'border-signal-buy', text: '📈 BASE/CLIMBING — Potentiell upptrend. Bevaka breakout.' },
  tired: { bg: 'bg-[#2e1f00]', border: 'border-signal-caution', text: '⚠️ TIRED PATTERN — Konsoliderar vid topp. WSP säger: sälj-zon.' },
  downhill: { bg: 'bg-[#2e0000]', border: 'border-signal-sell', text: '🔴 DOWNHILL PATTERN — Under 150MA. Undvik köp per WSP.' },
  base: { bg: 'bg-[#0d0d2e]', border: 'border-muted-foreground', text: '🟦 BASE PATTERN — Sidleds konsolidering. Vänta på breakout.' },
};

export default function StockDetail() {
  const { symbol } = useParams<{ symbol: string }>();
  const [searchParams] = useSearchParams();
  const requestedSymbol = symbol?.toUpperCase() ?? '';
  const selectedSectorParam = searchParams.get('sector');
  const selectedIndustryParam = searchParams.get('industry');
  const selectedSector = selectedSectorParam && selectedSectorParam.trim().length > 0 ? selectedSectorParam : null;
  const selectedIndustry = selectedIndustryParam && selectedIndustryParam.trim().length > 0 ? selectedIndustryParam : null;
  const screenerBackSearch = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedSector) params.set('sector', selectedSector);
    if (selectedIndustry) params.set('industry', selectedIndustry);
    const serialized = params.toString();
    return serialized ? `?${serialized}` : '';
  }, [selectedIndustry, selectedSector]);
  const screenerBackPath = `/screener${screenerBackSearch}`;
  const [activeTab, setActiveTab] = useState<DetailTab>('chart');
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('3M');
  const [asOfEnabled, setAsOfEnabled] = useState(false);
  const [asOfIndex, setAsOfIndex] = useState(0);

  const marketCommandQuery = useMarketCommand({ symbol: requestedSymbol || undefined });
  const detailQuery = useStockDetail(symbol);

  const hasCanonicalTruth = Boolean(marketCommandQuery.data?.equities.items[0]);

  const indicatorQuery = useQuery({
    queryKey: ['stock-detail-indicator', requestedSymbol],
    enabled: Boolean(requestedSymbol) && !hasCanonicalTruth,
    staleTime: 60_000,
    queryFn: async (): Promise<{ volume_ratio: number | null; mansfield_rs: number | null; pct_change_1d: number | null } | null> => {
      const { data, error } = await supabase
        .from('wsp_indicators')
        .select('volume_ratio, mansfield_rs, pct_change_1d')
        .eq('symbol', requestedSymbol)
        .order('calc_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  const canonicalStock = marketCommandQuery.data?.equities.items[0] ?? null;
  const detailData = detailQuery.data?.data;
  const resolvedCompanyName = canonicalStock?.name ?? detailData?.name ?? requestedSymbol;
  const resolvedSector = canonicalStock?.sector ?? detailData?.sector ?? 'Unknown';
  const resolvedDailyBars = detailData?.barsDaily ?? [];
  const isMetals = detailData?.assetClass === 'metals';
  const resolvedBenchmarkDailyBars = detailData?.benchmarkDaily ?? [];
  const resolvedBenchmarkWeeklyBars = detailData?.benchmarkWeekly ?? aggregateBarsWeekly(resolvedBenchmarkDailyBars);
  const sectorEtfSymbol = useMemo(() => {
    return SECTOR_ETF_MAP[resolvedSector]?.[0] ?? null;
  }, [resolvedSector]);
  const sectorEtfDailyPricesQuery = useQuery({
    queryKey: ['stock-detail-daily-prices', sectorEtfSymbol],
    enabled: Boolean(sectorEtfSymbol) && !hasCanonicalTruth,
    staleTime: 60_000,
    queryFn: async (): Promise<Bar[]> => {
      const { data, error } = await supabase
        .from('daily_prices')
        .select('date, open, high, low, close, volume')
        .eq('symbol', sectorEtfSymbol ?? '')
        .order('date', { ascending: false })
        .limit(756);

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

  const marketFavorable = marketCommandQuery.data?.market.overview.marketTrend === 'bullish';
  const sectorAligned = canonicalStock?.gate.sectorAligned ?? false;

  const timeframeBars = useMemo(() => {
    if (!detailData) return { bars: [], cadence: 'daily' as const };
    return barsForTimeframe(timeframe, resolvedDailyBars, detailData.barsWeekly);
  }, [detailData, timeframe, resolvedDailyBars]);

  const baseChartStock = useMemo(() => {
    if (!detailData) return null;
    if (resolvedDailyBars.length === 0 || resolvedBenchmarkDailyBars.length === 0) return null;

    return evaluateStock(
      detailData.symbol,
      resolvedCompanyName,
      resolvedSector,
      detailData.industry,
      resolvedDailyBars,
      resolvedBenchmarkDailyBars,
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
  }, [detailData, marketFavorable, resolvedBenchmarkDailyBars, resolvedCompanyName, resolvedDailyBars, resolvedSector, sectorAligned]);

  const asOfChartStock = useMemo(() => {
    if (!detailData || timeframeBars.bars.length === 0) return baseChartStock;

    const idx = clampAsOfIndex(asOfIndex, timeframeBars.bars.length);
    const asOfBars = asOfEnabled ? timeframeBars.bars.slice(0, idx + 1) : timeframeBars.bars;
    const benchmarkSource = timeframeBars.cadence === 'weekly' ? resolvedBenchmarkWeeklyBars : resolvedBenchmarkDailyBars;
    const benchmarkBars = benchmarkSource.filter((bar) => bar.date <= asOfBars[asOfBars.length - 1]?.date);

    if (asOfBars.length === 0 || benchmarkBars.length === 0) return baseChartStock;

    return evaluateStock(
      detailData.symbol,
      resolvedCompanyName,
      resolvedSector,
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
  }, [asOfEnabled, asOfIndex, baseChartStock, detailData, marketFavorable, resolvedBenchmarkDailyBars, resolvedBenchmarkWeeklyBars, resolvedCompanyName, resolvedSector, sectorAligned, timeframeBars]);

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Link to={screenerBackPath} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
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
    const symbolNotSearchable = detailQuery.data?.error?.code === 'SYMBOL_NOT_ACTIVE';

    return (
      <div className="p-6">
        <Link to={screenerBackPath} className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Tillbaka
        </Link>
        <div className={`mt-8 rounded-lg border p-4 text-sm ${symbolNotSearchable ? 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution' : 'border-signal-sell/20 bg-signal-sell/5 text-signal-sell'}`}>
          {symbolNotSearchable
            ? `Symbol ${requestedSymbol} är inte aktiv i symbolregistret.`
            : `Chart-data ej tillgänglig: ${sanitizeClientErrorMessage(detailQuery.data?.error?.message)}`}
        </div>
      </div>
    );
  }

  const semanticStock = canonicalStock ?? asOfChartStock ?? baseChartStock;
  const chartStock = asOfChartStock ?? baseChartStock ?? canonicalStock;
  const stock = semanticStock;
  if (!stock) {
    return (
      <div className="p-6">
        <Link to={screenerBackPath} className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Tillbaka
        </Link>
        <div className="mt-8 text-sm text-muted-foreground">Kunde inte bygga analys från tillgänglig data.</div>
      </div>
    );
  }
  const stockWithMeta = {
    ...stock,
    name: stock.name === stock.symbol ? resolvedCompanyName : (stock.name ?? resolvedCompanyName),
    sector: stock.sector === 'Unknown' ? resolvedSector : (stock.sector ?? resolvedSector),
  };
  const chartStockWithMeta = chartStock
    ? {
      ...chartStock,
      name: chartStock.name === chartStock.symbol ? resolvedCompanyName : (chartStock.name ?? resolvedCompanyName),
      sector: chartStock.sector === 'Unknown' ? resolvedSector : (chartStock.sector ?? resolvedSector),
    }
    : null;

  const contextState = marketCommandQuery.data?.trust.uiState ?? 'LIVE';
  const displayPattern = stock.pattern;
  const displayScore = stock.score;
  const displayMaxScore = 4;
  const ma50SlopeDirection = stock.audit.sma50SlopeDirection;
  const slopeIcon = ma50SlopeDirection === 'rising' ? <TrendingUp className="h-3 w-3" /> : ma50SlopeDirection === 'falling' ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />;
  const banner = patternBanners[displayPattern];
  const volMultiple = stockWithMeta.audit.volumeMultiple;
  const indicatorVolumeRatio = hasCanonicalTruth
    ? (canonicalStock?.audit.volumeMultiple ?? stockWithMeta.audit.volumeMultiple ?? null)
    : (indicatorQuery.data?.volume_ratio ?? stockWithMeta.audit.volumeMultiple ?? null);
  const indicatorMansfieldRs = hasCanonicalTruth
    ? (canonicalStock?.audit.mansfieldValue ?? stockWithMeta.audit.mansfieldValue ?? null)
    : (indicatorQuery.data?.mansfield_rs ?? stockWithMeta.audit.mansfieldValue ?? null);
  const indicatorDailyChange = hasCanonicalTruth ? canonicalStock?.changePercent : indicatorQuery.data?.pct_change_1d;
  const headerChangePercent = typeof indicatorDailyChange === 'number' && Number.isFinite(indicatorDailyChange)
    ? indicatorDailyChange
    : stockWithMeta.changePercent;
  const sectorEtfBars = sectorEtfDailyPricesQuery.data ?? [];
  const sectorEtfClose = sectorEtfBars.length > 0 ? sectorEtfBars[sectorEtfBars.length - 1].close : null;
  const sectorEtfMa50 = sectorEtfBars.length > 0 ? sma(sectorEtfBars, 50) : null;
  const sectorEtfAbove50MA = hasCanonicalTruth
    ? canonicalStock?.gate.sectorAligned ?? stockWithMeta.gate.sectorAligned
    : (sectorEtfClose != null && sectorEtfMa50 != null ? sectorEtfClose > sectorEtfMa50 : null);
  const priorLow = resolvedDailyBars.length >= 2 ? resolvedDailyBars[resolvedDailyBars.length - 2].low : null;
  const stopLossFourPct = stockWithMeta.price * 0.96;
  const stopLossSixPct = stockWithMeta.price * 0.94;
  const stopLossRecommended = priorLow != null ? Math.min(stopLossFourPct, priorLow) : stopLossFourPct;
  const checklistStock = stockWithMeta;

  const notices = [
    !detailData.isApprovedLiveCohort ? 'Not currently in approved live cohort.' : null,
    !detailData.supportsFullWsp ? 'Insufficient WSP readiness: symbol has limited WSP coverage.' : null,
    detailData.metadataCompleteness !== 'complete'
      ? `Metadata ${detailData.metadataCompleteness === 'missing' ? 'missing' : 'incomplete'} for one or more fields.`
      : null,
    resolvedDailyBars.length < 200 || resolvedBenchmarkDailyBars.length < 200
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
      <Link to={screenerBackPath} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3 w-3" /> Tillbaka till Screener
      </Link>

      {(selectedSector || selectedIndustry) && (
        <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
          <p className="text-[10px] font-mono text-muted-foreground">
            Screener context: {selectedSector ?? 'Alla sektorer'} → {selectedIndustry ?? 'Alla industrier'}
            <Link to={screenerBackPath} className="ml-2 text-primary hover:underline">Öppna samma urval</Link>
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-xs font-mono font-bold text-primary">
              {stockWithMeta.symbol.slice(0, 2)}
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{stockWithMeta.symbol}</h1>
              <p className="text-sm text-muted-foreground">{stockWithMeta.name}</p>
            </div>
          </div>

          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-bold font-mono text-foreground">${stockWithMeta.price.toFixed(2)}</span>
            <span className={`text-lg font-mono font-semibold ${headerChangePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
              {headerChangePercent >= 0 ? '+' : ''}{headerChangePercent.toFixed(2)}%
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
              Sektor: {stockWithMeta.sector}
            </span>
            {isMetals && (
              <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[10px] font-mono text-accent">METAL</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <PatternBadge pattern={displayPattern} size="md" />
          <WSPScoreRing score={displayScore} maxScore={displayMaxScore} size={80} />
          {hasCanonicalTruth && (
            <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-primary">
              Source: Canonical Screener
            </span>
          )}
        </div>
      </div>

      {!hasCanonicalTruth && notices.length > 0 && (
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
          {!hasCanonicalTruth && (
            <div className="rounded-lg border border-border bg-card px-4 py-2.5 text-xs font-mono text-muted-foreground">
              Denna aktie ingår inte i WSP-scannern
            </div>
          )}
          <div className={`rounded-lg border-l-4 ${banner.border} ${banner.bg} px-4 py-2.5 text-sm text-foreground`}>
            {banner.text}
          </div>

          <StockChartModule
            stock={chartStockWithMeta ?? stockWithMeta}
            dailyBars={resolvedDailyBars}
            weeklyBars={detailData.barsWeekly}
            dailyBenchmark={resolvedBenchmarkDailyBars}
            weeklyBenchmark={resolvedBenchmarkWeeklyBars}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            asOfEnabled={asOfEnabled}
            onAsOfEnabledChange={setAsOfEnabled}
            asOfIndex={asOfIndex}
            onAsOfIndexChange={setAsOfIndex}
            dataState={contextState}
            hideBlockers={hasCanonicalTruth}
          />
        </div>
      )}

      {activeTab === 'checklist' && (
        <WSPChecklist
          stock={checklistStock}
          context={{
            volumeRatio: indicatorVolumeRatio,
            mansfieldRs: indicatorMansfieldRs,
            sectorEtfSymbol,
            sectorEtfClose,
            sectorEtfMa50,
            sectorEtfAbove50MA,
            stopLossRecommended,
            stopLossFourPct,
            stopLossSixPct,
            stopLossPriorLow: priorLow,
          }}
          onOpenPositionSizer={() => setActiveTab('sizer')}
        />
      )}

      {activeTab === 'sizer' && (
        <PositionSizer stock={stockWithMeta} />
      )}
    </div>
  );
}
