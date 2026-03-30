import { useEffect, useMemo, useState } from 'react';
import { useWspScreener } from '@/hooks/use-wsp-screener';
import { StockTable } from '@/components/StockTable';
import { PatternSummary } from '@/components/PatternSummary';
import { CreditsBadge } from '@/components/CreditsBadge';
import { MarketHeader } from '@/components/MarketHeader';
import { fetchWspScreenerData } from '@/hooks/use-wsp-screener';
import { WSP_CONFIG } from '@/lib/wsp-config';
import type { EvaluatedStock } from '@/lib/wsp-types';
import { useQueryClient } from '@tanstack/react-query';
import { Scan } from 'lucide-react';

export default function Screener() {
  const [pollingIntervalMs, setPollingIntervalMs] = useState(WSP_CONFIG.refreshInterval);
  const [page, setPage] = useState(0);
  const [loadedStocks, setLoadedStocks] = useState<EvaluatedStock[]>([]);
  const PAGE_SIZE = 50;
  const queryClient = useQueryClient();
  const { data, isFetching, isLoading } = useWspScreener(pollingIntervalMs, page, PAGE_SIZE);

  const payload = data;
  const stocks = loadedStocks;
  const market = payload?.market;
  const providerStatus = payload?.providerStatus;
  const discoveryMeta = payload?.discoveryMeta;

  useEffect(() => {
    if (!payload?.stocks) return;

    setLoadedStocks((previous) => {
      const baseStocks = page === 0 ? [] : previous;
      const existingSymbols = new Set(baseStocks.map((stock) => stock.symbol));
      const nextUnique = payload.stocks.filter((stock) => !existingSymbols.has(stock.symbol));
      return [...baseStocks, ...nextUnique];
    });
  }, [payload?.stocks, page]);

  useEffect(() => {
    setPage(0);
    setLoadedStocks([]);
  }, [pollingIntervalMs]);

  const equityStocks = useMemo(() => stocks.filter(s => s.sector !== 'Metals & Mining'), [stocks]);

  const filteredStocks = useMemo(() => equityStocks, [equityStocks]);
  const canLoadMore = (providerStatus?.symbolCount ?? 0) > stocks.length;

  const counts = useMemo(() => ({
    buyCount: stocks.filter((s) => s.finalRecommendation === 'KÖP').length,
    sellCount: stocks.filter((s) => s.finalRecommendation === 'SÄLJ').length,
    watchCount: stocks.filter((s) => s.finalRecommendation === 'BEVAKA').length,
    avoidCount: stocks.filter((s) => s.finalRecommendation === 'UNDVIK').length,
  }), [stocks]);

  const handleManualRefresh = async () => {
    await queryClient.fetchQuery({
      queryKey: ['wsp-screener', pollingIntervalMs, page, PAGE_SIZE],
      queryFn: () => fetchWspScreenerData({ intervalMs: pollingIntervalMs, forceRefresh: true, page, pageSize: PAGE_SIZE }),
    });
  };

  if (!market || !providerStatus) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Scan className={`h-6 w-6 mx-auto mb-2 ${isLoading ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
          <p className="text-xs text-muted-foreground font-mono">Laddar screener...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4 max-w-7xl mx-auto pb-20 md:pb-4">
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
        <div className="flex items-start gap-3">
          <Scan className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" />
          <div>
            <h2 className="text-xs font-bold text-foreground font-mono tracking-wider">STOCK SCANNER</h2>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
              Visar {filteredStocks.length} av {equityStocks.length} aktier
              {providerStatus.uiState !== 'LIVE' && <span className="text-signal-caution"> · {providerStatus.uiState}</span>}
            </p>
          </div>
        </div>
        <CreditsBadge />
      </div>

      <PatternSummary stocks={filteredStocks} />
      <div className="relative">
        <StockTable stocks={filteredStocks} discoveryMeta={discoveryMeta} />

        {canLoadMore && (
          <div className="sticky bottom-3 z-20 flex justify-center pt-3">
            <button
              type="button"
              onClick={() => setPage((previous) => previous + 1)}
              className="rounded-md border border-border bg-card/95 px-4 py-2 text-xs font-semibold text-foreground shadow-sm backdrop-blur hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isFetching}
            >
              {isFetching ? 'Laddar...' : 'Ladda fler'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
