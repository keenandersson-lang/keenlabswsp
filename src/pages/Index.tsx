import { useMemo, useState } from 'react';
import { MarketHeader } from '@/components/MarketHeader';
import { PatternSummary } from '@/components/PatternSummary';
import { StockTable } from '@/components/StockTable';
import { SectorAnalysis } from '@/components/SectorAnalysis';
import { DebugPanel } from '@/components/DebugPanel';
import { fetchWspScreenerData, useWspScreener } from '@/hooks/use-wsp-screener';
import { WSP_CONFIG } from '@/lib/wsp-config';
import { AlertCircle, Info, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

const Index = () => {
  const [pollingIntervalMs, setPollingIntervalMs] = useState(WSP_CONFIG.refreshInterval);
  const queryClient = useQueryClient();
  const { data, isFetching, isLoading, isError, error } = useWspScreener(pollingIntervalMs);

  const payload = data;
  const stocks = payload?.stocks ?? [];
  const market = payload?.market;
  const providerStatus = payload?.providerStatus;

  const counts = useMemo(() => ({
    buyCount: stocks.filter((s) => s.recommendation === 'KÖP').length,
    sellCount: stocks.filter((s) => s.recommendation === 'SÄLJ').length,
    watchCount: stocks.filter((s) => s.recommendation === 'BEVAKA').length,
    avoidCount: stocks.filter((s) => s.recommendation === 'UNDVIK').length,
  }), [stocks]);

  const handleManualRefresh = async () => {
    await queryClient.fetchQuery({
      queryKey: ['wsp-screener', pollingIntervalMs],
      queryFn: () => fetchWspScreenerData({ intervalMs: pollingIntervalMs, forceRefresh: true }),
    });
  };

  if (!market || !providerStatus) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-3 px-4 text-center">
          <RefreshCw className={`h-6 w-6 ${isLoading ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
          <h1 className="text-lg font-semibold">Loading WSP Screener</h1>
          <p className="text-sm text-muted-foreground">
            {isError ? (error as Error)?.message : 'Fetching live market data and evaluating the existing WSP engine.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
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

      <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        <PatternSummary stocks={stocks} />

        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
          <Info className="h-5 w-5 text-accent flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Wall Street Protocol — Strict Rules Engine</span> — Screener med 3-lagers logik: <span className="text-accent">Mönster</span> (chart-struktur) → <span className="text-accent">Entry Gate</span> (hårda regler) → <span className="text-accent">Rekommendation</span> (KÖP/BEVAKA/SÄLJ/UNDVIK). En aktie kan vara i CLIMBING utan att vara KÖP. <span className="font-bold text-signal-buy">KÖP</span> kräver att ALLA gate-regler passerar. Klicka på en rad för fullständig regelanalys. <span className="italic text-signal-caution">Live-data prioriteras via server-side Finnhub. Demo-data används endast som explicit fallback.</span>
          </div>
        </div>

        {(providerStatus.uiState === 'FALLBACK' || providerStatus.uiState === 'ERROR' || isError) && (
          <div className="flex items-start gap-3 rounded-lg border border-signal-caution/30 bg-signal-caution/10 p-4 text-xs text-signal-caution">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="font-semibold">Provider issue detected</p>
              <p>{providerStatus.errorMessage ?? (error as Error | undefined)?.message ?? 'Unknown provider issue.'}</p>
            </div>
          </div>
        )}

        <DebugPanel
          stocks={stocks}
          providerStatus={providerStatus}
        />

        <SectorAnalysis />

        <StockTable stocks={stocks} />
      </main>
    </div>
  );
};

export default Index;
