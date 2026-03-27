import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWspScreener, fetchWspScreenerData } from '@/hooks/use-wsp-screener';
import { WSP_CONFIG } from '@/lib/wsp-config';
import { useQueryClient } from '@tanstack/react-query';
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
    [...equityStocks]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10),
    [equityStocks]
  );

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
    <div className="space-y-5 px-4 py-4 max-w-7xl mx-auto pb-20 md:pb-4">
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
          <h2 className="text-xs font-bold text-foreground font-mono tracking-wider">DASHBOARD</h2>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">Marknadsöversikt · WSP Top Setups</p>
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
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-bold text-foreground font-mono tracking-wider">BÄSTA WSP-SETUPS IDAG</h3>
          </div>
          <Link
            to="/screener"
            className="text-[10px] font-mono text-primary hover:underline"
          >
            Visa alla →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-left text-[10px] text-muted-foreground font-mono">
                <th className="px-4 py-2">SYMBOL</th>
                <th className="px-3 py-2">PRIS</th>
                <th className="px-3 py-2">ÄNDR.</th>
                <th className="px-3 py-2">MÖNSTER</th>
                <th className="px-3 py-2 text-center">WSP SCORE</th>
                <th className="px-3 py-2">VOL</th>
                <th className="px-3 py-2">50MA</th>
                <th className="px-3 py-2">SEKTOR</th>
                <th className="px-3 py-2">SIGNAL</th>
              </tr>
            </thead>
            <tbody>
              {topSetups.map((stock) => (
                <TopSetupRow key={stock.symbol} stock={stock} />
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

function TopSetupRow({ stock }: { stock: EvaluatedStock }) {
  const positive = stock.changePercent >= 0;
  const volumeMultiple = stock.audit?.volumeMultiple;
  const slopeDir = stock.audit?.sma50SlopeDirection;

  return (
    <tr className="border-b border-border/30 hover:bg-muted/20 transition-colors">
      <td className="px-4 py-2.5">
        <Link to={`/stock/${stock.symbol}`} className="hover:text-primary transition-colors">
          <span className="font-mono text-xs font-bold text-foreground">{stock.symbol}</span>
          <span className="block text-[9px] text-muted-foreground truncate max-w-[90px]">{stock.name}</span>
        </Link>
      </td>
      <td className="px-3 py-2.5 font-mono text-xs font-medium text-foreground">
        ${stock.price.toFixed(2)}
      </td>
      <td className="px-3 py-2.5">
        <span className={`flex items-center gap-0.5 font-mono text-xs font-medium ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
          {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {positive ? '+' : ''}{stock.changePercent.toFixed(2)}%
        </span>
      </td>
      <td className="px-3 py-2.5">
        <PatternBadge pattern={stock.pattern} />
      </td>
      <td className="px-3 py-2.5 text-center">
        <div className="flex justify-center">
          <WSPScoreRing score={stock.score} maxScore={stock.maxScore} size={38} />
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className={`font-mono text-xs ${volumeMultiple != null && volumeMultiple >= 2 ? 'text-signal-buy font-semibold' : 'text-muted-foreground'}`}>
          {volumeMultiple != null ? `${volumeMultiple.toFixed(1)}x` : '—'}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <span className="font-mono text-xs">
          {slopeDir === 'rising' ? '↑' : slopeDir === 'falling' ? '↓' : '→'}
        </span>
      </td>
      <td className="px-3 py-2.5 text-[10px] text-muted-foreground truncate max-w-[80px]">
        {stock.sector}
      </td>
      <td className="px-3 py-2.5">
        <RecommendationBadge recommendation={stock.finalRecommendation} />
      </td>
    </tr>
  );
}

export default Index;
