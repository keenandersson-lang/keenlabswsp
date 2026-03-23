import { useMemo, useState } from 'react';
import { MarketHeader } from '@/components/MarketHeader';
import { PatternSummary } from '@/components/PatternSummary';
import { StockTable } from '@/components/StockTable';
import { SectorAnalysis } from '@/components/SectorAnalysis';
import { DebugPanel } from '@/components/DebugPanel';
import { fetchWspScreenerData, useWspScreener } from '@/hooks/use-wsp-screener';
import { WSP_CONFIG } from '@/lib/wsp-config';
import { AlertCircle, AlertTriangle, Info, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

const Index = () => {
  const [pollingIntervalMs, setPollingIntervalMs] = useState(WSP_CONFIG.refreshInterval);
  const queryClient = useQueryClient();
  const { data, isFetching, isLoading, isError, error } = useWspScreener(pollingIntervalMs);

  const payload = data;
  const stocks = payload?.stocks ?? [];
  const market = payload?.market;
  const providerStatus = payload?.providerStatus;
  const debugSummary = payload?.debugSummary;

  const counts = useMemo(() => ({
    buyCount: stocks.filter((s) => s.finalRecommendation === 'KÖP').length,
    sellCount: stocks.filter((s) => s.finalRecommendation === 'SÄLJ').length,
    watchCount: stocks.filter((s) => s.finalRecommendation === 'BEVAKA').length,
    avoidCount: stocks.filter((s) => s.finalRecommendation === 'UNDVIK').length,
  }), [stocks]);

  const providerNotice = useMemo(() => {
    if (!providerStatus) return null;

    switch (providerStatus.uiState) {
      case 'LIVE':
        return {
          title: 'Live data active',
          body: providerStatus.errorMessage ?? 'Finnhub data loaded successfully and is current.',
          icon: Wifi,
          className: 'border-signal-buy/30 bg-signal-buy/10 text-signal-buy',
        };
      case 'STALE':
        return {
          title: 'Showing stale live snapshot',
          body: providerStatus.errorMessage ?? 'Last usable live data is being shown until the next successful refresh.',
          icon: WifiOff,
          className: 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution',
        };
      case 'FALLBACK':
        return {
          title: 'Fallback/demo mode active',
          body: providerStatus.errorMessage ?? 'Demo data is active. Add live provider credentials before final verification.',
          icon: AlertTriangle,
          className: 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution',
        };
      case 'ERROR':
      default:
        return {
          title: 'No usable provider data',
          body: providerStatus.errorMessage ?? (error as Error | undefined)?.message ?? 'The screener could not load any usable data.',
          icon: AlertCircle,
          className: 'border-signal-sell/30 bg-signal-sell/10 text-signal-sell',
        };
    }
  }, [error, providerStatus]);

  const handleManualRefresh = async () => {
    await queryClient.fetchQuery({
      queryKey: ['wsp-screener', pollingIntervalMs],
      queryFn: () => fetchWspScreenerData({ intervalMs: pollingIntervalMs, forceRefresh: true }),
    });
  };

  if (!market || !providerStatus || !debugSummary) {
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

  const NoticeIcon = providerNotice?.icon ?? Info;

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

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <PatternSummary stocks={stocks} />

        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
          <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" />
          <div className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Wall Street Protocol — Strict Rules Engine</span> — Screener med 3-lagers logik: <span className="text-accent">Mönster</span> (chart-struktur) → <span className="text-accent">Entry Gate</span> (hårda regler) → <span className="text-accent">Rekommendation</span> (KÖP/BEVAKA/SÄLJ/UNDVIK). En aktie kan vara i CLIMBING utan att vara KÖP. <span className="font-bold text-signal-buy">KÖP</span> kräver att ALLA gate-regler passerar. Klicka på en rad för fullständig regelanalys. <span className="italic text-signal-caution">Live-data prioriteras via server-side Finnhub. Demo-data används endast som explicit fallback.</span>
          </div>
        </div>

        {providerNotice && (
          <div className={`flex items-start gap-3 rounded-lg border p-4 text-xs ${providerNotice.className}`}>
            <NoticeIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="font-semibold">{providerNotice.title}</p>
              <p>{providerNotice.body}</p>
            </div>
          </div>
        )}

        <DebugPanel providerStatus={providerStatus} debugSummary={debugSummary} />

        <SectorAnalysis />

        <StockTable stocks={stocks} />
      </main>
    </div>
  );
};

export default Index;
