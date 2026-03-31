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
import { useSearchParams } from 'react-router-dom';

export default function Screener() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pollingIntervalMs, setPollingIntervalMs] = useState(WSP_CONFIG.refreshInterval);
  const [page, setPage] = useState(0);
  const [loadedStocks, setLoadedStocks] = useState<EvaluatedStock[]>([]);
  const selectedSectorParam = searchParams.get('sector');
  const selectedIndustryParam = searchParams.get('industry');
  const selectedSector = selectedSectorParam && selectedSectorParam.trim().length > 0 ? selectedSectorParam : null;
  const selectedIndustry = selectedIndustryParam && selectedIndustryParam.trim().length > 0 ? selectedIndustryParam : null;
  const PAGE_SIZE = 50;
  const queryClient = useQueryClient();
  const { data: commandSnapshot, isFetching, isLoading } = useMarketCommand({
    intervalMs: pollingIntervalMs,
    page,
    pageSize: PAGE_SIZE,
    sector: selectedSector,
    industry: selectedIndustry,
  });
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
  }, [pollingIntervalMs, selectedSector, selectedIndustry]);

  const equityStocks = useMemo(() => stocks.filter(s => s.sector !== 'Metals & Mining'), [stocks]);
  const activeSector = commandSnapshot?.sectors.activeSector ?? selectedSector;
  const activeIndustry = commandSnapshot?.industries.activeIndustry ?? selectedIndustry;

  const visibleSectors = commandSnapshot?.sectors.items ?? [];
  const visibleIndustries = commandSnapshot?.industries.items ?? [];
  const visibleIndustryTotal = useMemo(() => {
    return visibleSectors
      .filter((sector) => activeSector ? sector.sector === activeSector : true)
      .reduce((sum, sector) => sum + sector.industryCount, 0);
  }, [activeSector, visibleSectors]);

  const industryFocusItems = useMemo(() => {
    if (!activeSector) return [];
    return visibleIndustries
      .filter((industry) => industry.sector === activeSector)
      .slice(0, 8);
  }, [activeSector, visibleIndustries]);

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

  const updateSelection = (next: { sector?: string | null; industry?: string | null }) => {
    const params = new URLSearchParams(searchParams);
    const nextSector = Object.prototype.hasOwnProperty.call(next, 'sector')
      ? next.sector ?? null
      : activeSector ?? null;
    const nextIndustry = Object.prototype.hasOwnProperty.call(next, 'industry')
      ? next.industry ?? null
      : activeIndustry ?? null;

    if (nextSector) params.set('sector', nextSector);
    else params.delete('sector');

    if (nextIndustry) params.set('industry', nextIndustry);
    else params.delete('industry');

    setSearchParams(params, { replace: true });
  };

  const clearSelection = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('sector');
    params.delete('industry');
    setSearchParams(params, { replace: true });
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

      <div className="rounded-md border border-border bg-card px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[10px] font-bold font-mono tracking-wider text-foreground">SECTOR → INDUSTRY → EQUITY</h3>
            <p className="mt-0.5 text-[10px] text-muted-foreground font-mono">
              {activeSector ?? 'Alla sektorer'} → {activeIndustry ?? 'Alla industrier'} → {filteredStocks.length} aktier
            </p>
          </div>
          {(activeSector || activeIndustry) && (
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
              onClick={clearSelection}
            >
              Rensa val
            </button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            className={`rounded border px-2 py-1 text-[10px] font-mono ${activeSector == null ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
            onClick={() => updateSelection({ sector: null, industry: null })}
          >
            Alla sektorer ({visibleSectors.length})
          </button>
          {visibleSectors.map((sector) => (
            <button
              key={sector.sector}
              type="button"
              className={`rounded border px-2 py-1 text-[10px] font-mono ${activeSector === sector.sector ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
              onClick={() => updateSelection({ sector: sector.sector, industry: null })}
              title={`Top industries: ${sector.topIndustries.join(', ') || 'n/a'}`}
            >
              {sector.sector} · {sector.industryCount} ind · {sector.equityCount} eq
            </button>
          ))}
        </div>

        {activeSector && (
          <div className="mt-2 rounded border border-border/60 bg-background p-2">
            <p className="text-[10px] font-mono text-muted-foreground mb-1">Industries ranked by rankScore · showing {industryFocusItems.length} of {visibleIndustryTotal}</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={`rounded border px-2 py-1 text-[10px] font-mono ${activeIndustry == null ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
                onClick={() => updateSelection({ industry: null })}
              >
                Alla industrier
              </button>
              {industryFocusItems.map((industry) => (
                <button
                  key={`${industry.sector}-${industry.industry}`}
                  type="button"
                  className={`rounded border px-2 py-1 text-left text-[10px] font-mono ${activeIndustry === industry.industry ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
                  onClick={() => updateSelection({ industry: industry.industry })}
                >
                  <span className="block truncate">{industry.industry}</span>
                  <span className="block text-[9px]">
                    R {industry.rankScore.toFixed(1)} · BO {industry.breakoutCount} · VE {industry.validEntryCount} · KÖP {industry.recommendationCounts.buy}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
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
