import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWspScreener } from '@/hooks/use-wsp-screener';
import { StockTable } from '@/components/StockTable';
import { PatternSummary } from '@/components/PatternSummary';
import { CreditsBadge } from '@/components/CreditsBadge';
import { MarketHeader } from '@/components/MarketHeader';
import { fetchWspScreenerData } from '@/hooks/use-wsp-screener';
import { WSP_CONFIG } from '@/lib/wsp-config';
import { useQueryClient } from '@tanstack/react-query';
import { Scan } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const CLIMBING_PATTERNS = new Set(['climbing', 'base_or_climbing']);

export default function Screener() {
  const [pollingIntervalMs, setPollingIntervalMs] = useState(WSP_CONFIG.refreshInterval);
  const [showAll, setShowAll] = useState(false);
  const queryClient = useQueryClient();
  const { data, isFetching, isLoading } = useWspScreener(pollingIntervalMs);

  const payload = data;
  const stocks = payload?.stocks ?? [];
  const market = payload?.market;
  const providerStatus = payload?.providerStatus;
  const debugSummary = payload?.debugSummary;
  const discoveryMeta = payload?.discoveryMeta;

  const equityStocks = useMemo(() => stocks.filter(s => s.sector !== 'Metals & Mining'), [stocks]);

  const filteredStocks = useMemo(() => {
    if (showAll) return equityStocks;
    return equityStocks.filter(s => {
      const pattern = (s as any).scannerPattern ?? s.pattern;
      return pattern && CLIMBING_PATTERNS.has(pattern);
    });
  }, [equityStocks, showAll]);

  const counts = useMemo(() => ({
    buyCount: stocks.filter((s) => s.finalRecommendation === 'KÖP').length,
    sellCount: stocks.filter((s) => s.finalRecommendation === 'SÄLJ').length,
    watchCount: stocks.filter((s) => s.finalRecommendation === 'BEVAKA').length,
    avoidCount: stocks.filter((s) => s.finalRecommendation === 'UNDVIK').length,
  }), [stocks]);

  const handleManualRefresh = async () => {
    await queryClient.fetchQuery({
      queryKey: ['wsp-screener', pollingIntervalMs],
      queryFn: () => fetchWspScreenerData({ intervalMs: pollingIntervalMs, forceRefresh: true }),
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
              {!showAll && ' · climbing / base_or_climbing'}
              {providerStatus.uiState !== 'LIVE' && <span className="text-signal-caution"> · {providerStatus.uiState}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="show-all"
              checked={showAll}
              onCheckedChange={setShowAll}
              className="h-5 w-9 data-[state=checked]:bg-primary"
            />
            <Label htmlFor="show-all" className="text-[10px] font-mono text-muted-foreground cursor-pointer whitespace-nowrap">
              Visa alla
            </Label>
          </div>
          <CreditsBadge />
        </div>
      </div>

      <PatternSummary stocks={filteredStocks} />
      <StockTable stocks={filteredStocks} discoveryMeta={discoveryMeta} />
    </div>
  );
}
