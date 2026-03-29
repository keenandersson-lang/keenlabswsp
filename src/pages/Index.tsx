import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWspScreener, fetchWspScreenerData } from '@/hooks/use-wsp-screener';
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
import { RefreshCw, ArrowUpRight, ArrowDownRight, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { EvaluatedStock } from '@/lib/wsp-types';
import { supabase } from '@/integrations/supabase/client';

const Index = () => {
  const [pollingIntervalMs, setPollingIntervalMs] = useState(WSP_CONFIG.refreshInterval);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data, isFetching, isLoading, isError } = useWspScreener(pollingIntervalMs);

  const payload = data;
  const stocks = payload?.stocks ?? [];
  const market = payload?.market;
  const providerStatus = payload?.providerStatus;
  const debugSummary = payload?.debugSummary;
  const discovery = payload?.discovery;
  const discoveryMeta = payload?.discoveryMeta;
  const sectorStatuses = payload?.sectorStatuses ?? [];

  const equityStocks = useMemo(() => stocks.filter(s => s.sector !== 'Metals & Mining'), [stocks]);

  const counts = useMemo(() => ({
    buyCount: stocks.filter((s) => s.finalRecommendation === 'KÖP').length,
    sellCount: stocks.filter((s) => s.finalRecommendation === 'SÄLJ').length,
    watchCount: stocks.filter((s) => s.finalRecommendation === 'BEVAKA').length,
    avoidCount: stocks.filter((s) => s.finalRecommendation === 'UNDVIK').length,
  }), [stocks]);

  const topSetups = useMemo(() =>
    {
      const climbingOnly = equityStocks.filter((stock) => stock.scannerPattern === 'climbing' || stock.pattern === 'CLIMBING');
      const primaryPool = climbingOnly.length > 0
        ? climbingOnly
        : equityStocks.filter((stock) => stock.scannerPattern === 'base_or_climbing');

      return [...primaryPool]
        .sort((a, b) => (b.audit?.volumeMultiple ?? Number.NEGATIVE_INFINITY) - (a.audit?.volumeMultiple ?? Number.NEGATIVE_INFINITY))
        .slice(0, 10);
    },
    [equityStocks]
  );

  const topSetupSymbolsWithMissingPrice = useMemo(
    () => topSetups.filter((stock) => stock.price == null || stock.price <= 0).map((stock) => stock.symbol),
    [topSetups]
  );

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

  if (!market || !providerStatus || !debugSummary || !discovery || !discoveryMeta) {
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
        totalStocks={stocks.length}
        uiState={providerStatus.uiState}
        isFetching={isFetching}
        pollingIntervalMs={pollingIntervalMs}
        onRefresh={handleManualRefresh}
        onPollingIntervalChange={setPollingIntervalMs}
      />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[10px] sm:text-xs font-bold text-foreground font-mono tracking-wider">DASHBOARD</h2>
          <p className="text-[9px] text-muted-foreground font-mono mt-0.5">Live approved cohort · {equityStocks.length} aktier · {new Set(equityStocks.map(s => s.sector)).size} sektorer</p>
        </div>
        <CreditsBadge />
      </div>

      <MarketRegime market={market} />

      {/* Zone 2 — Compact Sector Heatmap */}
      <MarketHeatmap
        stocks={equityStocks}
        sectorStatuses={sectorStatuses}
        uiState={providerStatus.uiState}
        activeSector={null}
        activeIndustry={null}
        onIndustrySelect={() => {}}
        onStockSelect={(symbol) => navigate(`/stock/${symbol}`)}
        onSectorSelect={(sector) => navigate(`/screener?sector=${sector}`)}
      />

      {/* Zone 3 — Top 10 WSP Setups */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            <h3 className="text-[10px] sm:text-xs font-bold text-foreground font-mono tracking-wider">BÄSTA WSP-SETUPS</h3>
            <span className="text-[8px] font-mono text-muted-foreground">({topSetups.length})</span>
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
            <Link key={stock.symbol} to={`/stock/${stock.symbol}`} className="rounded border border-border bg-background p-2 hover:border-primary/30 transition-colors">
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono text-[10px] font-bold text-foreground">{stock.symbol}</span>
                <RecommendationBadge recommendation={stock.finalRecommendation} />
              </div>
              <div className="text-[8px] text-muted-foreground truncate">{stock.name}</div>
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
            </Link>
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
                <th className="px-2 py-1.5">SEKTOR</th>
                <th className="px-2 py-1.5">SIGNAL</th>
              </tr>
            </thead>
            <tbody>
              {topSetups.map((stock) => (
                <TopSetupRow key={stock.symbol} stock={stock} fallbackCloseMap={topSetupFallbackCloseMap} />
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

function getDisplayPrice(stock: EvaluatedStock, fallbackCloseMap: Record<string, number>) {
  const candidate = typeof stock.price === 'number' && Number.isFinite(stock.price) && stock.price > 0
    ? stock.price
    : fallbackCloseMap[stock.symbol];

  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
}

function TopSetupRow({ stock, fallbackCloseMap }: { stock: EvaluatedStock; fallbackCloseMap: Record<string, number> }) {
  const positive = stock.changePercent >= 0;
  const volumeMultiple = stock.audit?.volumeMultiple;
  const displayPrice = getDisplayPrice(stock, fallbackCloseMap);

  return (
    <tr className="border-b border-border/30 hover:bg-muted/20 transition-colors">
      <td className="px-3 py-2">
        <Link to={`/stock/${stock.symbol}`} className="hover:text-primary transition-colors">
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
      <td className="px-2 py-2 text-[9px] text-muted-foreground truncate max-w-[70px]">{stock.sector}</td>
      <td className="px-2 py-2"><RecommendationBadge recommendation={stock.finalRecommendation} /></td>
    </tr>
  );
}

export default Index;
