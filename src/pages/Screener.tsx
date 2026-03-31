import { useEffect, useMemo, useState } from 'react';
import { fetchWspPatternCounts, fetchWspScreenerData, type WspPatternCounts } from '@/hooks/use-wsp-screener';
import { useMarketCommand } from '@/hooks/use-market-command';
import { StockTable } from '@/components/StockTable';
import { PatternSummary } from '@/components/PatternSummary';
import { CreditsBadge } from '@/components/CreditsBadge';
import { MarketHeader } from '@/components/MarketHeader';
import { WSP_CONFIG } from '@/lib/wsp-config';
import type { EvaluatedStock } from '@/lib/wsp-types';
import { useQueryClient } from '@tanstack/react-query';
import { Scan } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

export default function Screener() {
  const [pollingIntervalMs, setPollingIntervalMs] = useState(WSP_CONFIG.refreshInterval);
  const [page, setPage] = useState(0);
  const [loadedStocks, setLoadedStocks] = useState<EvaluatedStock[]>([]);
  const PAGE_SIZE = 50;
  const queryClient = useQueryClient();
  const { data: commandSnapshot, isFetching, isLoading } = useMarketCommand({ intervalMs: pollingIntervalMs, page, pageSize: PAGE_SIZE });
  const { data: patternCounts } = useQuery<WspPatternCounts>({
    queryKey: ['wsp-pattern-counts'],
    queryFn: fetchWspPatternCounts,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const stocks = loadedStocks;
  const market = commandSnapshot?.market.overview;
  const providerStatus = commandSnapshot?.runtime.providerStatus;
  const trust = commandSnapshot?.trust;
  const discoveryMeta = commandSnapshot?.runtime.discoveryMeta;
  const sectorStatuses = commandSnapshot?.sectors.items
    .map((sectorItem) => sectorItem.status)
    .filter((status): status is NonNullable<typeof status> => status !== null) ?? [];

  useEffect(() => {
    const pageStocks = commandSnapshot?.equities.items;
    if (!pageStocks) return;

    setLoadedStocks((previous) => {
      const baseStocks = page === 0 ? [] : previous;
      const existingSymbols = new Set(baseStocks.map((stock) => stock.symbol));
      const nextUnique = pageStocks.filter((stock) => !existingSymbols.has(stock.symbol));
      return [...baseStocks, ...nextUnique];
    });
  }, [commandSnapshot?.equities.items, page]);

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

  if (!market || !providerStatus || !trust) {
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
        trust={trust}
        sectorStatuses={sectorStatuses}
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
              {trust.displayState !== 'LIVE' && <span className="text-signal-caution"> · {trust.displayState}</span>}
            </p>
          </div>
        </div>
        <CreditsBadge />
      </div>

      <PatternSummary counts={patternCounts ?? { climbing: 0, base_or_climbing: 0, base: 0, tired: 0, downhill: 0 }} />
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
