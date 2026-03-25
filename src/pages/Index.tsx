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
import { AlertCircle, AlertTriangle, Info, RefreshCw, Wifi, WifiOff, Layers, BarChart3, Scan, ChevronRight } from 'lucide-react';
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
        return { title: 'Live market data', body: safeBody, icon: Wifi, className: 'border-signal-buy/20 bg-signal-buy/5 text-signal-buy' };
      case 'STALE':
        return { title: 'Using recent snapshot', body: safeBody, icon: WifiOff, className: 'border-signal-caution/20 bg-signal-caution/5 text-signal-caution' };
      case 'FALLBACK':
        return { title: 'Demo mode', body: safeBody, icon: AlertTriangle, className: 'border-signal-caution/20 bg-signal-caution/5 text-signal-caution' };
      case 'ERROR':
      default:
        return { title: 'Data unavailable', body: safeBody, icon: AlertCircle, className: 'border-signal-sell/20 bg-signal-sell/5 text-signal-sell' };
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
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 px-4 text-center">
          <div className="relative">
            <RefreshCw className={`h-8 w-8 ${isLoading ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">WSP Screener</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isError ? 'Market data temporarily unavailable. Retrying...' : 'Connecting to market data provider...'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const NoticeIcon = providerNotice?.icon ?? Info;

  const tabs: { id: ViewTab; label: string; icon: typeof Layers }[] = [
    { id: 'topdown', label: 'Discovery', icon: Layers },
    { id: 'sectors', label: 'Sectors', icon: BarChart3 },
    { id: 'scanner', label: 'Scanner', icon: Scan },
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
        {/* Tab bar + credits */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${activeTab === tab.id ? 'bg-primary/10 text-primary border border-primary/30 shadow-sm' : 'text-muted-foreground hover:text-foreground border border-transparent'}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <CreditsBadge />
        </div>

        {/* Provider status notice — compact */}
        {providerNotice && providerStatus.uiState !== 'LIVE' && (
          <div className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[11px] ${providerNotice.className}`}>
            <NoticeIcon className="h-3.5 w-3.5 flex-shrink-0" />
            <span><span className="font-semibold">{providerNotice.title}.</span> {providerNotice.body}</span>
          </div>
        )}

        {/* ═══ TOP-DOWN DISCOVERY ═══ */}
        {activeTab === 'topdown' && (
          <div className="space-y-6">
            <MarketRegime market={market} />

            <MarketHeatmap
              stocks={stocks}
              sectorStatuses={sectorStatuses}
              uiState={providerStatus.uiState}
              activeSector={activeSector}
              degradedMessage={
                providerStatus.uiState === 'FALLBACK'
                  ? 'Fallback snapshot: sector values are tracked-universe strength only (not market-wide returns).'
                  : providerStatus.uiState === 'STALE'
                  ? 'Stale snapshot: sector tone is constrained and may lag current tape.'
                  : undefined
              }
              onSectorSelect={(sector) => {
                setActiveSector(sector);
                setActiveIndustry(null);
              }}
            />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <SectorRanking
                stocks={stocks}
                sectorStatuses={sectorStatuses}
                uiState={providerStatus.uiState}
                activeSector={activeSector}
                onSectorSelect={(sector) => { setActiveSector(sector); setActiveIndustry(null); }}
              />
              <IndustryRanking
                stocks={stocks}
                activeSector={activeSector}
                activeIndustry={activeIndustry}
                uiState={providerStatus.uiState}
                onIndustrySelect={setActiveIndustry}
              />
            </div>

            {/* Funnel breadcrumb */}
            {activeIndustry && (
              <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs">
                <ChevronRight className="h-3.5 w-3.5 text-primary" />
                <span className="text-muted-foreground">
                  <span className="text-foreground font-medium">Market</span> → <span className="text-foreground font-medium">{activeSector}</span> → <span className="text-foreground font-medium">{activeIndustry}</span>
                </span>
                <button className="ml-auto text-primary font-medium hover:underline" onClick={() => setActiveTab('scanner')}>
                  Open Scanner →
                </button>
              </div>
            )}

            <TrendsDashboard discovery={discovery} discoveryMeta={discoveryMeta} />
            <PatternSummary stocks={stocks} />
          </div>
        )}

        {/* ═══ SECTORS ═══ */}
        {activeTab === 'sectors' && <SectorAnalysis />}

        {/* ═══ STOCK SCANNER ═══ */}
        {activeTab === 'scanner' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <Scan className="mt-0.5 h-5 w-5 text-primary flex-shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-foreground">Full Stock Scanner</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Strict WSP 3-layer engine evaluation across {stocks.length} tracked stocks.
                  <span> Discovery mode: {discoveryMeta.trendClassificationMode}.</span>
                  {providerStatus.uiState !== 'LIVE' && <span className="text-signal-caution"> Data state: {providerStatus.uiState}.</span>}
                </p>
              </div>
            </div>
            <PatternSummary stocks={stocks} />
            <StockTable stocks={stocks} discoveryMeta={discoveryMeta} />
          </div>
        )}

        {/* ═══ DEBUG ═══ */}
        <DebugPanel providerStatus={providerStatus} debugSummary={debugSummary} market={market} discoveryMeta={discoveryMeta} />
      </main>
    </div>
  );
};

export default Index;
