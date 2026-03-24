import { useMemo, useState } from 'react';
import { MarketHeader } from '@/components/MarketHeader';
import { MarketRegime } from '@/components/MarketRegime';
import { SectorRanking } from '@/components/SectorRanking';
import { IndustryRanking } from '@/components/IndustryRanking';
import { PatternSummary } from '@/components/PatternSummary';
import { StockTable } from '@/components/StockTable';
import { SectorAnalysis } from '@/components/SectorAnalysis';
import { DebugPanel } from '@/components/DebugPanel';
import { CreditsBadge } from '@/components/CreditsBadge';
import { fetchWspScreenerData, useWspScreener } from '@/hooks/use-wsp-screener';
import { WSP_CONFIG } from '@/lib/wsp-config';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp, Info, RefreshCw, Wifi, WifiOff, Layers, BarChart3, Scan } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

type ViewTab = 'topdown' | 'scanner' | 'sectors';

const Index = () => {
  const [pollingIntervalMs, setPollingIntervalMs] = useState(WSP_CONFIG.refreshInterval);
  const [activeTab, setActiveTab] = useState<ViewTab>('topdown');
  const [activeSector, setActiveSector] = useState<string | null>(null);
  const [showStockScan, setShowStockScan] = useState(false);
  const queryClient = useQueryClient();
  const { data, isFetching, isLoading, isError, error } = useWspScreener(pollingIntervalMs);

  const payload = data;
  const stocks = payload?.stocks ?? [];
  const market = payload?.market;
  const providerStatus = payload?.providerStatus;
  const debugSummary = payload?.debugSummary;
  const sectorStatuses = payload?.sectorStatuses;

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
        return { title: 'Live data active', body: providerStatus.errorMessage ?? 'Finnhub data loaded successfully.', icon: Wifi, className: 'border-signal-buy/30 bg-signal-buy/10 text-signal-buy' };
      case 'STALE':
        return { title: 'Showing stale snapshot', body: providerStatus.errorMessage ?? 'Last usable live data shown.', icon: WifiOff, className: 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution' };
      case 'FALLBACK':
        return { title: 'Demo mode active', body: providerStatus.errorMessage ?? 'Demo data active. Add live credentials for verification.', icon: AlertTriangle, className: 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution' };
      case 'ERROR':
      default:
        return { title: 'No usable data', body: providerStatus.errorMessage ?? (error as Error | undefined)?.message ?? 'Could not load data.', icon: AlertCircle, className: 'border-signal-sell/30 bg-signal-sell/10 text-signal-sell' };
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
            {isError ? (error as Error)?.message : 'Fetching market data and evaluating WSP engine.'}
          </p>
        </div>
      </div>
    );
  }

  const NoticeIcon = providerNotice?.icon ?? Info;

  const tabs: { id: ViewTab; label: string; icon: typeof Layers }[] = [
    { id: 'topdown', label: 'Top-Down', icon: Layers },
    { id: 'sectors', label: 'Sektorer', icon: BarChart3 },
    { id: 'scanner', label: 'Stock Scanner', icon: Scan },
  ];

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

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5">
        {/* Credits + Auth */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-primary/10 text-primary border border-primary/30'
                      : 'text-muted-foreground hover:text-foreground border border-transparent'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <div className="relative">
            <CreditsBadge />
          </div>
        </div>

        {/* Provider notice */}
        {providerNotice && (
          <div className={`flex items-start gap-3 rounded-lg border p-3 text-xs ${providerNotice.className}`}>
            <NoticeIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="font-semibold">{providerNotice.title}</p>
              <p>{providerNotice.body}</p>
            </div>
          </div>
        )}

        {/* TOP-DOWN VIEW */}
        {activeTab === 'topdown' && (
          <div className="space-y-5">
            {/* Layer 1: Market Regime */}
            <MarketRegime market={market} />

            {/* Layer 2 + 3: Sector & Industry side by side */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <SectorRanking
                sectorStatuses={sectorStatuses}
                activeSector={activeSector}
                onSectorSelect={setActiveSector}
              />
              <IndustryRanking
                activeSector={activeSector}
                onScanIndustry={(industry) => {
                  setShowStockScan(true);
                  setActiveTab('scanner');
                }}
              />
            </div>

            {/* WSP info */}
            <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
              <div className="text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Wall Street Protocol</span> — Top-down analys: <span className="text-accent">Marknad</span> → <span className="text-accent">Sektor</span> → <span className="text-accent">Industri</span> → <span className="text-primary">Premium Stock Scan</span>. Fria sektorer och industri-ranking. Stock-level deep scan kräver credits.
              </div>
            </div>

            {/* Pattern Summary (free) */}
            <PatternSummary stocks={stocks} />
          </div>
        )}

        {/* SECTOR DEEP DIVE VIEW */}
        {activeTab === 'sectors' && (
          <SectorAnalysis />
        )}

        {/* STOCK SCANNER VIEW (premium) */}
        {activeTab === 'scanner' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <Scan className="mt-0.5 h-5 w-5 text-primary flex-shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-foreground">Stock Scanner — Premium</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Fullständig WSP-analys med 3-lagers logik: Mönster → Entry Gate → Rekommendation. Varje scan kostar 1 credit.
                  Nuvarande dataset: {stocks.length} aktier ({providerStatus.uiState} data).
                </p>
              </div>
            </div>

            <PatternSummary stocks={stocks} />
            <StockTable stocks={stocks} />
          </div>
        )}

        {/* Debug Panel — always available */}
        <DebugPanel providerStatus={providerStatus} debugSummary={debugSummary} />
      </main>
    </div>
  );
};

export default Index;
