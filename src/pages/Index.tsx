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
import { AlertCircle, AlertTriangle, Info, RefreshCw, Wifi, WifiOff, Layers, BarChart3, Scan, ChevronRight, Gem } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { sanitizeProviderNotice } from '@/lib/safe-messages';
import { MarketHeatmap } from '@/components/MarketHeatmap';
import { TrendsDashboard } from '@/components/TrendsDashboard';
import type { EvaluatedStock } from '@/lib/wsp-types';

type ViewTab = 'topdown' | 'scanner' | 'sectors' | 'metals';

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

  const equityStocks = useMemo(() => stocks.filter(s => s.sector !== 'Metals & Mining'), [stocks]);
  const metalsStocks = useMemo(() => stocks.filter(s => s.sector === 'Metals & Mining'), [stocks]);

  const scannerStocks = useMemo(() => stocks.filter((stock) => {
    if (activeSector && stock.sector !== activeSector) return false;
    if (activeIndustry && stock.industry !== activeIndustry) return false;
    return true;
  }), [stocks, activeSector, activeIndustry]);

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
            <h1 className="text-base font-bold text-foreground font-mono tracking-tight">WSP SCREENER</h1>
            <p className="mt-1 text-xs text-muted-foreground font-mono">
              {isError ? 'Market data temporarily unavailable. Retrying...' : 'Connecting to market data provider...'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const NoticeIcon = providerNotice?.icon ?? Info;

  const tabs: { id: ViewTab; label: string; icon: typeof Layers }[] = [
    { id: 'topdown', label: 'DISCOVERY', icon: Layers },
    { id: 'sectors', label: 'SECTORS', icon: BarChart3 },
    { id: 'scanner', label: 'SCANNER', icon: Scan },
    { id: 'metals', label: 'METALS', icon: Gem },
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

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-4">
        {/* Tab bar + credits */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0.5 rounded border border-border bg-card p-0.5">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-[10px] font-mono font-medium tracking-wider transition-all ${activeTab === tab.id ? 'bg-primary/10 text-primary border border-primary/30' : 'text-muted-foreground hover:text-foreground border border-transparent'}`}
                >
                  <Icon className="h-3 w-3" />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <CreditsBadge />
        </div>

        {/* Provider status notice */}
        {providerNotice && providerStatus.uiState !== 'LIVE' && (
          <div className={`flex items-center gap-2 rounded border px-3 py-1.5 text-[10px] font-mono ${providerNotice.className}`}>
            <NoticeIcon className="h-3 w-3 flex-shrink-0" />
            <span><span className="font-semibold">{providerNotice.title}.</span> {providerNotice.body}</span>
          </div>
        )}

        {/* ═══ TOP-DOWN DISCOVERY ═══ */}
        {activeTab === 'topdown' && (
          <div className="space-y-5">
            <MarketRegime market={market} />

            <MarketHeatmap
              stocks={equityStocks}
              sectorStatuses={sectorStatuses}
              uiState={providerStatus.uiState}
              activeSector={activeSector}
              activeIndustry={activeIndustry}
              onIndustrySelect={setActiveIndustry}
              onStockSelect={(symbol) => navigate(`/stock/${symbol}`)}
              degradedMessage={
                providerStatus.uiState === 'FALLBACK'
                  ? 'Fallback snapshot: sector values are tracked-universe strength only.'
                  : providerStatus.uiState === 'STALE'
                  ? 'Stale snapshot: sector tone may lag current tape.'
                  : undefined
              }
              onSectorSelect={(sector) => {
                setActiveSector(sector);
                setActiveIndustry(null);
              }}
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectorRanking
                stocks={equityStocks}
                sectorStatuses={sectorStatuses}
                uiState={providerStatus.uiState}
                activeSector={activeSector}
                onSectorSelect={(sector) => { setActiveSector(sector); setActiveIndustry(null); }}
              />
              <IndustryRanking
                stocks={equityStocks}
                activeSector={activeSector}
                activeIndustry={activeIndustry}
                uiState={providerStatus.uiState}
                onIndustrySelect={setActiveIndustry}
              />
            </div>

            {/* Funnel breadcrumb */}
            {activeIndustry && (
              <div className="flex items-center gap-2 rounded border border-primary/20 bg-primary/5 px-3 py-2 text-[10px] font-mono">
                <ChevronRight className="h-3 w-3 text-primary" />
                <span className="text-muted-foreground">
                  <span className="text-foreground font-medium">MARKET</span> → <span className="text-foreground font-medium">{activeSector}</span> → <span className="text-foreground font-medium">{activeIndustry}</span>
                </span>
                <button className="ml-auto text-primary font-medium hover:underline" onClick={() => setActiveTab('scanner')}>
                  Open Scanner →
                </button>
              </div>
            )}

            <TrendsDashboard discovery={discovery} discoveryMeta={discoveryMeta} />
            <PatternSummary stocks={equityStocks} />
          </div>
        )}

        {/* ═══ SECTORS ═══ */}
        {activeTab === 'sectors' && <SectorAnalysis />}

        {/* ═══ STOCK SCANNER ═══ */}
        {activeTab === 'scanner' && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded border border-primary/20 bg-primary/5 p-3">
              <Scan className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" />
              <div>
                <h3 className="text-xs font-bold text-foreground font-mono tracking-wider">STOCK SCANNER</h3>
                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                  WSP 3-layer engine · {equityStocks.length} equities · {metalsStocks.length} metals
                  {activeSector && <> · Scope: {activeSector}{activeIndustry ? ` / ${activeIndustry}` : ''}</>}
                  {providerStatus.uiState !== 'LIVE' && <span className="text-signal-caution"> · {providerStatus.uiState}</span>}
                </p>
              </div>
            </div>
            <PatternSummary stocks={scannerStocks} />
            <StockTable stocks={scannerStocks} discoveryMeta={discoveryMeta} />
          </div>
        )}

        {/* ═══ METALS ═══ */}
        {activeTab === 'metals' && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded border border-accent/20 bg-accent/5 p-3">
              <Gem className="mt-0.5 h-4 w-4 text-accent flex-shrink-0" />
              <div>
                <h3 className="text-xs font-bold text-foreground font-mono tracking-wider">METALS & MINING</h3>
                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                  {metalsStocks.length} instruments · Gold, Silver, Copper, Platinum proxies & miners
                </p>
                <p className="text-[9px] text-signal-caution font-mono mt-0.5">
                  ⚠ Metals use daily-close WSP analysis but sector/industry context is limited vs equities.
                </p>
              </div>
            </div>

            {metalsStocks.length === 0 ? (
              <div className="rounded border border-border bg-card p-6 text-center text-xs text-muted-foreground font-mono">
                No metals data available in current snapshot.
              </div>
            ) : (
              <>
                <MetalsGrid stocks={metalsStocks} />
                <StockTable stocks={metalsStocks} discoveryMeta={discoveryMeta} />
              </>
            )}
          </div>
        )}

        {/* ═══ DEBUG ═══ */}
        <DebugPanel providerStatus={providerStatus} debugSummary={debugSummary} market={market} discoveryMeta={discoveryMeta} />
      </main>
    </div>
  );
};

function MetalsGrid({ stocks }: { stocks: EvaluatedStock[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {stocks.map(stock => {
        const positive = stock.changePercent >= 0;
        return (
          <a
            key={stock.symbol}
            href={`/stock/${stock.symbol}`}
            className="group rounded border border-border bg-card p-3 transition-all hover:border-primary/30"
          >
            <div className="flex items-start justify-between gap-1 mb-2">
              <div>
                <div className="font-mono text-xs font-bold text-foreground">{stock.symbol}</div>
                <div className="text-[9px] text-muted-foreground truncate max-w-[100px]">{stock.name}</div>
              </div>
              <span className={`rounded px-1.5 py-0.5 text-[8px] font-mono font-semibold ${stock.finalRecommendation === 'KÖP' ? 'bg-signal-buy/15 text-signal-buy' : stock.finalRecommendation === 'SÄLJ' ? 'bg-signal-sell/15 text-signal-sell' : 'bg-muted text-muted-foreground'}`}>
                {stock.finalRecommendation}
              </span>
            </div>
            <div className="flex items-end justify-between">
              <span className="font-mono text-sm font-semibold text-foreground">${stock.price.toFixed(2)}</span>
              <span className={`font-mono text-[10px] font-semibold ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
                {positive ? '+' : ''}{stock.changePercent.toFixed(2)}%
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <span className="text-[8px] font-mono text-muted-foreground">{stock.pattern}</span>
              <span className="text-[8px] font-mono text-muted-foreground">· {stock.industry}</span>
            </div>
          </a>
        );
      })}
    </div>
  );
}

export default Index;
