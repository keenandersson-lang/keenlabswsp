import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWspScreenerData } from '@/hooks/use-wsp-screener';
import { useMarketCommand } from '@/hooks/use-market-command';
import { WSP_CONFIG } from '@/lib/wsp-config';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MarketHeader } from '@/components/MarketHeader';
import { MarketRegime } from '@/components/MarketRegime';
import { MarketHeatmap } from '@/components/MarketHeatmap';
import { PatternBadge } from '@/components/PatternBadge';
import { RecommendationBadge } from '@/components/RecommendationBadge';
import { WSPScoreRing } from '@/components/WSPScoreRing';
import { DebugPanel } from '@/components/DebugPanel';
import { CreditsBadge } from '@/components/CreditsBadge';
import { RefreshCw, ArrowUpRight, ArrowDownRight, TrendingUp, Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { WSPPattern, WSPRecommendation } from '@/lib/wsp-types';
import { supabase } from '@/integrations/supabase/client';

interface TopSetup {
  symbol: string;
  sector: string;
  industry: string;
  pattern: WSPPattern;
  recommendation: WSPRecommendation;
  score: number;
  maxScore: number;
  name: string;
  price: number | null;
  changePercent: number;
  volumeMultiple: number | null;
}

const Index = () => {
  const [pollingIntervalMs, setPollingIntervalMs] = useState(WSP_CONFIG.refreshInterval);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: commandSnapshot, isFetching, isLoading, isError } = useMarketCommand({ intervalMs: pollingIntervalMs });

  const stocks = commandSnapshot?.equities.items ?? [];
  const providerStatus = commandSnapshot?.runtime.providerStatus;
  const market = commandSnapshot?.market.overview;
  const trust = commandSnapshot?.trust;
  const debugSummary = commandSnapshot?.runtime.debugSummary;
  const discoveryMeta = commandSnapshot?.runtime.discoveryMeta;
  const sectorStatuses = commandSnapshot?.sectors.items
    .map((sectorItem) => sectorItem.status)
    .filter((status): status is NonNullable<typeof status> => status !== null) ?? [];

  const equityStocks = useMemo(() => stocks.filter((s) => s.sector !== 'Metals & Mining'), [stocks]);

  const counts = useMemo(() => {
    if (commandSnapshot) {
      return {
        buyCount: commandSnapshot.market.breadth.buy,
        sellCount: commandSnapshot.market.breadth.sell,
        watchCount: commandSnapshot.market.breadth.watch,
        avoidCount: commandSnapshot.market.breadth.avoid,
      };
    }

    return {
      buyCount: stocks.filter((s) => s.finalRecommendation === 'KÖP').length,
      sellCount: stocks.filter((s) => s.finalRecommendation === 'SÄLJ').length,
      watchCount: stocks.filter((s) => s.finalRecommendation === 'BEVAKA').length,
      avoidCount: stocks.filter((s) => s.finalRecommendation === 'UNDVIK').length,
    };
  }, [commandSnapshot, stocks]);

  const topSetups = useMemo<TopSetup[]>(() => (
    stocks
      .slice(0, 10)
      .map((stock) => ({
        symbol: stock.symbol,
        sector: stock.sector,
        industry: stock.industry,
        pattern: stock.pattern,
        recommendation: stock.finalRecommendation,
        score: stock.score ?? 0,
        maxScore: stock.maxScore ?? 4,
        name: stock.name || stock.symbol,
        price: Number.isFinite(stock.price) && stock.price > 0 ? stock.price : null,
        changePercent: Number.isFinite(stock.changePercent) ? stock.changePercent : 0,
        volumeMultiple: stock.audit.volumeMultiple ?? null,
      }))
  ), [stocks]);

  const topSetupsLoading = isLoading || (isFetching && topSetups.length === 0);
  const symbolContextLookup = useMemo(() => {
    const lookup = new Map<string, { sector: string; industry: string }>();
    for (const stock of stocks) {
      lookup.set(stock.symbol, { sector: stock.sector, industry: stock.industry });
    }
    return lookup;
  }, [stocks]);

  const topSetupSymbolsWithMissingPrice = useMemo(
    () => topSetups.filter((stock) => stock.price == null || stock.price <= 0).map((stock) => stock.symbol),
    [topSetups]
  );

  const sectorIndustrySummary = useMemo(() => {
    const sectors = commandSnapshot?.sectors.items ?? [];
    const industries = commandSnapshot?.industries.items ?? [];
    const topSector = sectors[0] ?? null;

    const topIndustries = industries.slice(0, 6);

    return {
      sectorCount: sectors.length,
      industryCount: industries.length,
      topSector,
      topIndustries,
    };
  }, [commandSnapshot?.industries.items, commandSnapshot?.sectors.items]);

  const { data: topSetupFallbackCloseMap = {} } = useQuery({
    queryKey: ['dashboard-top-setup-fallback-closes', topSetupSymbolsWithMissingPrice],
    enabled: topSetupSymbolsWithMissingPrice.length > 0,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('daily_prices')
        .select('symbol, close, date')
        .in('symbol', topSetupSymbolsWithMissingPrice)
        .order('date', { ascending: false });

      if (error) throw error;

      const latestCloseBySymbol: Record<string, number> = {};

      for (const row of rows ?? []) {
        if (latestCloseBySymbol[row.symbol] != null) continue;
        if (typeof row.close !== 'number' || !Number.isFinite(row.close) || row.close <= 0) continue;
        latestCloseBySymbol[row.symbol] = row.close;
      }

      return latestCloseBySymbol;
    },
  });

  const handleManualRefresh = async () => {
    await queryClient.fetchQuery({
      queryKey: ['wsp-screener', pollingIntervalMs],
      queryFn: () => fetchWspScreenerData({ intervalMs: pollingIntervalMs, forceRefresh: true }),
    });
  };

  const buildStockDetailPath = (symbol: string, sector?: string, industry?: string) => {
    const params = new URLSearchParams();
    if (sector) params.set('sector', sector);
    if (industry) params.set('industry', industry);
    const serialized = params.toString();
    return `/stock/${symbol}${serialized ? `?${serialized}` : ''}`;
  };

  if (!market || !providerStatus || !debugSummary || !discoveryMeta || !trust) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <RefreshCw className={`h-8 w-8 ${isLoading ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
        <div>
          <h1 className="text-base font-bold text-foreground font-mono tracking-tight">WSP SCREENER</h1>
          <p className="mt-1 text-xs text-muted-foreground font-mono">
            {isError ? 'Market data temporarily unavailable. Retrying...' : 'Connecting to market data provider...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-2 py-2 sm:px-4 sm:py-4 sm:space-y-4 max-w-7xl mx-auto pb-20 md:pb-4">
      {/* Zone 1 — Market Overview */}
      <MarketHeader
        market={market}
        buyCount={counts.buyCount}
        sellCount={counts.sellCount}
        watchCount={counts.watchCount}
        avoidCount={counts.avoidCount}
        totalStocks={commandSnapshot?.market.breadth.total ?? stocks.length}
        trust={trust}
        sectorStatuses={sectorStatuses}
        isFetching={isFetching}
        pollingIntervalMs={pollingIntervalMs}
        onRefresh={handleManualRefresh}
        onPollingIntervalChange={setPollingIntervalMs}
      />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[10px] sm:text-xs font-bold text-foreground font-mono tracking-wider">DASHBOARD</h2>
          <p className="text-[9px] text-muted-foreground font-mono mt-0.5">Live approved cohort · {providerStatus.symbolCount} aktier · {new Set(equityStocks.map(s => s.sector)).size} sektorer</p>
        </div>
        <CreditsBadge />
      </div>

      <MarketRegime market={market} />

      <div className="rounded-md border border-border bg-card px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-start gap-2">
            <Layers className="mt-0.5 h-3.5 w-3.5 text-primary" />
            <div>
              <h3 className="text-[10px] font-bold font-mono tracking-wider text-foreground">SECTOR → INDUSTRY → EQUITY</h3>
              <p className="mt-0.5 text-[10px] text-muted-foreground font-mono">
                {sectorIndustrySummary.sectorCount} sektorer → {sectorIndustrySummary.industryCount} industrier → {commandSnapshot.market.breadth.total} aktier
              </p>
            </div>
          </div>
          <Link to="/screener" className="text-[10px] font-mono text-primary hover:underline">
            Öppna hela flödet →
          </Link>
        </div>

        {sectorIndustrySummary.topSector && (
          <div className="mt-2 rounded border border-border/60 bg-background p-2">
            <p className="text-[10px] font-mono text-muted-foreground">
              Top sector nu: <span className="text-foreground">{sectorIndustrySummary.topSector.sector}</span> · {sectorIndustrySummary.topSector.industryCount} ind · {sectorIndustrySummary.topSector.equityCount} eq
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sectorIndustrySummary.topIndustries.map((industry) => (
                <Link
                  key={`${industry.sector}-${industry.industry}`}
                  to={`/screener?sector=${encodeURIComponent(industry.sector)}&industry=${encodeURIComponent(industry.industry)}`}
                  className="rounded border border-border px-2 py-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                  title={`${industry.sector} · R ${industry.rankScore.toFixed(1)} · BO ${industry.breakoutCount} · VE ${industry.validEntryCount} · KÖP ${industry.recommendationCounts.buy}`}
                >
                  <span className="block text-foreground truncate max-w-[180px]">{industry.industry}</span>
                  <span className="block text-[9px]">R {industry.rankScore.toFixed(1)} · BO {industry.breakoutCount} · VE {industry.validEntryCount} · KÖP {industry.recommendationCounts.buy}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Zone 2 — Compact Sector Heatmap */}
      <MarketHeatmap
        stocks={equityStocks}
        sectorStatuses={sectorStatuses}
        trust={trust}
        activeSector={null}
        activeIndustry={null}
        onIndustrySelect={() => {}}
        onStockSelect={(symbol) => {
          const context = symbolContextLookup.get(symbol);
          navigate(buildStockDetailPath(symbol, context?.sector, context?.industry));
        }}
        onSectorSelect={(sector) => navigate(`/screener?sector=${encodeURIComponent(sector)}`)}
      />

      {/* Zone 3 — Top 10 WSP Setups */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            <h3 className="text-[10px] sm:text-xs font-bold text-foreground font-mono tracking-wider">BÄSTA WSP-SETUPS</h3>
            <span className="text-[8px] font-mono text-muted-foreground">({topSetupsLoading ? '…' : topSetups.length})</span>
          </div>
          <Link
            to="/screener"
            className="text-[10px] font-mono text-primary hover:underline"
          >
            Visa alla →
          </Link>
        </div>
        {/* Mobile: card layout */}
        <div className="grid grid-cols-2 gap-1.5 p-2 sm:hidden">
          {topSetups.map((stock) => (
            <div key={stock.symbol} className="rounded border border-border bg-background p-2 hover:border-primary/30 transition-colors">
              <div className="flex items-center justify-between gap-1">
                <Link to={buildStockDetailPath(stock.symbol, stock.sector, stock.industry)} className="font-mono text-[10px] font-bold text-foreground hover:text-primary">{stock.symbol}</Link>
                <RecommendationBadge recommendation={stock.recommendation} />
              </div>
              <div className="text-[8px] text-muted-foreground truncate">{stock.name}</div>
              <Link
                to={`/screener?sector=${encodeURIComponent(stock.sector)}&industry=${encodeURIComponent(stock.industry)}`}
                className="mt-0.5 block text-[8px] text-primary hover:underline truncate"
              >
                {stock.sector} → {stock.industry}
              </Link>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-mono text-[9px] text-foreground">${getDisplayPrice(stock, topSetupFallbackCloseMap).toFixed(2)}</span>
                <span className={`font-mono text-[9px] font-medium ${stock.changePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                  {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(1)}%
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1">
                <PatternBadge pattern={stock.pattern} />
                <span className="text-[8px] font-mono text-muted-foreground">{stock.score}/{stock.maxScore}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Desktop: table layout */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-left text-[10px] text-muted-foreground font-mono">
                <th className="px-3 py-1.5">SYMBOL</th>
                <th className="px-2 py-1.5">PRIS</th>
                <th className="px-2 py-1.5">ÄNDR.</th>
                <th className="px-2 py-1.5">MÖNSTER</th>
                <th className="px-2 py-1.5 text-center">SCORE</th>
                <th className="px-2 py-1.5">VOL</th>
                <th className="px-2 py-1.5">SEKTOR → INDUSTRY</th>
                <th className="px-2 py-1.5">SIGNAL</th>
              </tr>
            </thead>
            <tbody>
              {topSetups.map((stock) => (
                <TopSetupRow key={stock.symbol} stock={stock} fallbackCloseMap={topSetupFallbackCloseMap} buildStockDetailPath={buildStockDetailPath} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Debug panel */}
      <DebugPanel providerStatus={providerStatus} debugSummary={debugSummary} market={market} discoveryMeta={discoveryMeta} />
    </div>
  );
};

function getDisplayPrice(stock: TopSetup, fallbackCloseMap: Record<string, number>) {
  const candidate = typeof stock.price === 'number' && Number.isFinite(stock.price) && stock.price > 0
    ? stock.price
    : fallbackCloseMap[stock.symbol];

  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
}

function TopSetupRow({
  stock,
  fallbackCloseMap,
  buildStockDetailPath,
}: {
  stock: TopSetup;
  fallbackCloseMap: Record<string, number>;
  buildStockDetailPath: (symbol: string, sector?: string, industry?: string) => string;
}) {
  const positive = stock.changePercent >= 0;
  const volumeMultiple = stock.volumeMultiple;
  const displayPrice = getDisplayPrice(stock, fallbackCloseMap);

  return (
    <tr className="border-b border-border/30 hover:bg-muted/20 transition-colors">
      <td className="px-3 py-2">
        <Link to={buildStockDetailPath(stock.symbol, stock.sector, stock.industry)} className="hover:text-primary transition-colors">
          <span className="font-mono text-xs font-bold text-foreground">{stock.symbol}</span>
          <span className="block text-[8px] text-muted-foreground truncate max-w-[80px]">{stock.name}</span>
        </Link>
      </td>
      <td className="px-2 py-2 font-mono text-xs text-foreground">${displayPrice.toFixed(2)}</td>
      <td className="px-2 py-2">
        <span className={`flex items-center gap-0.5 font-mono text-xs font-medium ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
          {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {positive ? '+' : ''}{stock.changePercent.toFixed(2)}%
        </span>
      </td>
      <td className="px-2 py-2"><PatternBadge pattern={stock.pattern} /></td>
      <td className="px-2 py-2 text-center">
        <div className="flex justify-center">
          <WSPScoreRing score={stock.score} maxScore={stock.maxScore} size={32} />
        </div>
      </td>
      <td className="px-2 py-2">
        <span className={`font-mono text-xs ${volumeMultiple != null && volumeMultiple >= 2 ? 'text-signal-buy font-semibold' : 'text-muted-foreground'}`}>
          {volumeMultiple != null ? `${volumeMultiple.toFixed(1)}x` : '—'}
        </span>
      </td>
      <td className="px-2 py-2 text-[9px] text-muted-foreground truncate max-w-[160px]">
        <Link to={`/screener?sector=${encodeURIComponent(stock.sector)}&industry=${encodeURIComponent(stock.industry)}`} className="hover:text-foreground">
          {stock.sector} → {stock.industry}
        </Link>
      </td>
      <td className="px-2 py-2"><RecommendationBadge recommendation={stock.recommendation} /></td>
    </tr>
  );
}

export default Index;
