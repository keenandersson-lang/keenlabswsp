import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { AlertCircle, AlertTriangle, Info, RefreshCw, Wifi, WifiOff, Layers, BarChart3, Scan } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { sanitizeProviderNotice } from '@/lib/safe-messages';
import { MarketHeatmap } from '@/components/MarketHeatmap';
import { TrendsDashboard } from '@/components/TrendsDashboard';

type ViewTab = 'topdown' | 'scanner' | 'sectors';

const Index = () => {
  const [pollingIntervalMs, setPollingIntervalMs] = useState(WSP_CONFIG.refreshInterval);
  const [activeTab, setActiveTab] = useState<ViewTab>('topdown');
  const [activeSector, setActiveSector] = useState<string | null>(null);
  const [activeIndustry, setActiveIndustry] = useState<string | null>(null);
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

  const counts = useMemo(() => ({
    buyCount: stocks.filter((s) => s.finalRecommendation === 'KÖP').length,
    sellCount: stocks.filter((s) => s.finalRecommendation === 'SÄLJ').length,
    watchCount: stocks.filter((s) => s.finalRecommendation === 'BEVAKA').length,
    avoidCount: stocks.filter((s) => s.finalRecommendation === 'UNDVIK').length,
  }), [stocks]);

  const providerNotice = useMemo(() => {
    if (!providerStatus) return null;
    const safeBody = sanitizeProviderNotice(providerStatus.uiState, providerStatus.errorMessage);
    switch (providerStatus.uiState) {
      case 'LIVE':
        return { title: 'Live data active', body: safeBody, icon: Wifi, className: 'border-signal-buy/30 bg-signal-buy/10 text-signal-buy' };
      case 'STALE':
        return { title: 'Showing stale snapshot', body: safeBody, icon: WifiOff, className: 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution' };
      case 'FALLBACK':
        return { title: 'Demo mode active', body: safeBody, icon: AlertTriangle, className: 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution' };
      case 'ERROR':
      default:
        return { title: 'No usable data', body: safeBody, icon: AlertCircle, className: 'border-signal-sell/30 bg-signal-sell/10 text-signal-sell' };
    }
  }, [providerStatus]);

  const handleManualRefresh = async () => {
    await queryClient.fetchQuery({
      queryKey: ['wsp-screener', pollingIntervalMs],
      queryFn: () => fetchWspScreenerData({ intervalMs: pollingIntervalMs, forceRefresh: true }),
    });
  };

  if (!market || !providerStatus || !debugSummary || !discovery || !discoveryMeta) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-3 px-4 text-center">
          <RefreshCw className={`h-6 w-6 ${isLoading ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
          <h1 className="text-lg font-semibold">Loading WSP Screener</h1>
          <p className="text-sm text-muted-foreground">{isError ? 'Market data temporarily unavailable.' : 'Fetching market data and evaluating WSP engine.'}</p>
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${activeTab === tab.id ? 'bg-primary/10 text-primary border border-primary/30' : 'text-muted-foreground hover:text-foreground border border-transparent'}`}>
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <CreditsBadge />
        </div>

        {providerNotice && (
          <div className={`flex items-start gap-3 rounded-lg border p-3 text-xs ${providerNotice.className}`}>
            <NoticeIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="font-semibold">{providerNotice.title}</p>
              <p>{providerNotice.body}</p>
            </div>
          </div>
        )}

        {activeTab === 'topdown' && (
          <div className="space-y-5">
            <MarketRegime market={market} />
            <MarketHeatmap
              stocks={stocks}
              sectorStatuses={sectorStatuses}
              activeSector={activeSector}
              degradedMessage={providerStatus.uiState === 'STALE' || providerStatus.uiState === 'FALLBACK'
                ? 'Heatmap data is degraded in this snapshot. Core benchmark context is preserved, but sector aggregation is limited.'
                : undefined}
              onSectorSelect={(sector) => {
                setActiveSector(sector);
                setActiveIndustry(null);
              }}
            />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <SectorRanking stocks={stocks} sectorStatuses={sectorStatuses} activeSector={activeSector} onSectorSelect={(sector) => { setActiveSector(sector); setActiveIndustry(null); }} />
              <IndustryRanking
                stocks={stocks}
                activeSector={activeSector}
                activeIndustry={activeIndustry}
                onIndustrySelect={setActiveIndustry}
              />
            </div>

            {activeIndustry && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
                Funnel: <span className="text-foreground">Market</span> → <span className="text-foreground">{activeSector}</span> → <span className="text-foreground">{activeIndustry}</span> →
                <button className="ml-1 text-primary underline" onClick={() => setActiveTab('scanner')}>Stock scan</button>
              </div>
            )}

            <TrendsDashboard discovery={discovery} />
            <PatternSummary stocks={stocks} />
          </div>
        )}

        {activeTab === 'sectors' && <SectorAnalysis />}

        {activeTab === 'scanner' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <Scan className="mt-0.5 h-5 w-5 text-primary flex-shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-foreground">Stock Scanner — Premium</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Full WSP engine scan with strict gates. Current dataset: {stocks.length} stocks ({providerStatus.uiState} data).</p>
                {activeIndustry && <button className="mt-1 text-xs text-primary underline" onClick={() => navigate(`/stock/${stocks.find((s) => s.industry === activeIndustry)?.symbol ?? stocks[0]?.symbol}`)}>Open a stock from selected industry</button>}
              </div>
            </div>
            <PatternSummary stocks={stocks} />
            <StockTable stocks={stocks} />
          </div>
        )}

        <DebugPanel providerStatus={providerStatus} debugSummary={debugSummary} market={market} discoveryMeta={discoveryMeta} />
      </main>
    </div>
  );
};

export default Index;
