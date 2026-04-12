import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSectorRanking, type SectorRankingRow } from '@/hooks/use-sector-ranking';
import { useIndustryRanking, type IndustryRankingRow } from '@/hooks/use-industry-ranking';
import { useTopSetups, type TopSetupDisplay } from '@/hooks/use-top-setups';
import { useEquityScreener } from '@/hooks/use-equity-screener';
import { WSP_CONFIG } from '@/lib/wsp-config';
import { useQuery } from '@tanstack/react-query';
import { MarketHeader } from '@/components/MarketHeader';
import { MarketRegime } from '@/components/MarketRegime';
import { MarketHeatmap } from '@/components/MarketHeatmap';
import { PatternBadge } from '@/components/PatternBadge';
import { RecommendationBadge } from '@/components/RecommendationBadge';
import { WSPScoreRing } from '@/components/WSPScoreRing';
import { CreditsBadge } from '@/components/CreditsBadge';
import { UniverseCoverage } from '@/components/UniverseCoverage';
import { RefreshCw, ArrowUpRight, ArrowDownRight, TrendingUp, Layers, Crown, Factory } from 'lucide-react';
import { Link } from 'react-router-dom';
import { isCanonicalGicsSector } from '@/lib/wsp-data-contract';
import { supabase } from '@/integrations/supabase/client';
import type { MarketOverview, ScreenerTrustContract } from '@/lib/wsp-types';

const Index = () => {
  const [pollingIntervalMs, setPollingIntervalMs] = useState(WSP_CONFIG.refreshInterval);
  const navigate = useNavigate();

  const { data: benchmarkRows = [], isFetching, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard-benchmark-prices'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_benchmark_prices');
      if (error) throw error;
      return (data ?? []) as Array<{ symbol: string; close: number; pct_change_1d: number; calc_date: string }>;
    },
    refetchInterval: pollingIntervalMs,
    staleTime: Math.max(15_000, pollingIntervalMs / 2),
  });

  const { data: sectorRanking = [] } = useSectorRanking();
  const { data: industryRanking = [] } = useIndustryRanking(true, 15);
  const { data: topSetups = [], isLoading: topSetupsLoading } = useTopSetups();
  const { data: heatmapData } = useEquityScreener({ page: 0, pageSize: 300, universeTier: 'core' });

  const heatmapRows = (heatmapData?.rows ?? []).filter((row) => isCanonicalGicsSector(row.sector));
  const sectorStatuses = sectorRanking.map((sector) => ({
    sector: sector.sector_name,
    isBullish: sector.wsp_regime === 'Bullish',
    changePercent: sector.avg_pct_today,
    sma50AboveSma200: sector.pct_above_ma50 > 60,
  }));
  const spy = benchmarkRows.find((row) => row.symbol === 'SPY');
  const qqq = benchmarkRows.find((row) => row.symbol === 'QQQ');
  const market: MarketOverview = {
    sp500Change: Number(spy?.pct_change_1d ?? 0),
    nasdaqChange: Number(qqq?.pct_change_1d ?? 0),
    sp500Price: spy?.close ?? null,
    nasdaqPrice: qqq?.close ?? null,
    sp500Symbol: 'SPY',
    nasdaqSymbol: 'QQQ',
    benchmarkState: 'live',
    benchmarkLastUpdated: spy?.calc_date ?? new Date().toISOString(),
    marketTrend: (spy?.pct_change_1d ?? 0) >= 0 && (qqq?.pct_change_1d ?? 0) >= 0 ? 'bullish' : (spy?.pct_change_1d ?? 0) < 0 && (qqq?.pct_change_1d ?? 0) < 0 ? 'bearish' : 'neutral',
    lastUpdated: spy?.calc_date ?? new Date().toISOString(),
    dataSource: 'live',
    pollingIntervalMs,
    sp500CalcDate: spy?.calc_date ?? null,
    nasdaqCalcDate: qqq?.calc_date ?? null,
  };
  const trust: ScreenerTrustContract = {
    uiState: 'LIVE',
    displayState: 'LIVE',
    isLive: true,
    fallbackActive: false,
    benchmarkState: 'live',
    dataProvenance: 'direct_db',
  };

  const counts = useMemo(() => {
    return {
      buyCount: heatmapRows.filter((row) => row.recommendation === 'KÖP').length,
      sellCount: heatmapRows.filter((row) => row.recommendation === 'SÄLJ').length,
      watchCount: heatmapRows.filter((row) => ['BEVAKA', 'AVVAKTA'].includes(row.recommendation)).length,
      avoidCount: heatmapRows.filter((row) => row.recommendation === 'UNDVIK').length,
    };
  }, [heatmapRows]);

  const symbolContextLookup = useMemo(() => {
    const lookup = new Map<string, { sector: string; industry: string }>();
    for (const row of heatmapRows) {
      lookup.set(row.symbol, { sector: row.sector, industry: row.industry });
    }
    // Also include top setups symbols
    for (const setup of topSetups) {
      if (!lookup.has(setup.symbol)) {
        lookup.set(setup.symbol, { sector: setup.sector, industry: setup.industry });
      }
    }
    return lookup;
  }, [heatmapRows, topSetups]);

  // Fetch fallback close prices for top setups missing prices via RPC
  const topSetupSymbolsWithMissingPrice = useMemo(
    () => topSetups.filter((s) => s.price == null || s.price <= 0).map((s) => s.symbol),
    [topSetups]
  );

  const { data: topSetupFallbackCloseMap = {} } = useQuery({
    queryKey: ['dashboard-top-setup-fallback-closes', topSetupSymbolsWithMissingPrice],
    enabled: topSetupSymbolsWithMissingPrice.length > 0,
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any).rpc('get_latest_symbol_indicators', {
        p_symbols: topSetupSymbolsWithMissingPrice,
      });
      if (error) throw error;
      const latestCloseBySymbol: Record<string, number> = {};
      for (const row of rows ?? []) {
        const close = Number((row as any).close);
        if (!Number.isFinite(close) || close <= 0) continue;
        latestCloseBySymbol[(row as any).symbol] = close;
      }
      return latestCloseBySymbol;
    },
  });

  const handleManualRefresh = async () => { await refetch(); };

  const buildStockDetailPath = (symbol: string, sector?: string, industry?: string) => {
    const params = new URLSearchParams();
    if (sector) params.set('sector', sector);
    if (industry) params.set('industry', industry);
    const serialized = params.toString();
    return `/stock/${symbol}${serialized ? `?${serialized}` : ''}`;
  };

  // Leading sectors
  const leadingSectors = useMemo(() => sectorRanking.filter((s) => s.is_leading), [sectorRanking]);
  const laggingSectors = useMemo(() => sectorRanking.filter((s) => !s.is_leading), [sectorRanking]);

  if (!market) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <RefreshCw className={`h-8 w-8 ${isLoading ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
        <div>
          <h1 className="text-base font-bold text-foreground font-mono tracking-tight">WSP SCREENER</h1>
          <p className="mt-1 text-xs text-muted-foreground font-mono">
            {isError ? 'Market data temporarily unavailable. Retrying...' : 'Connecting to market data provider...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-2 py-2 sm:px-4 sm:py-4 sm:space-y-4 max-w-7xl mx-auto pb-20 md:pb-4">
      {/* MODULE 1 — Step 1: Market Overview + Regime */}
      <MarketHeader
        market={market}
        buyCount={counts.buyCount}
        sellCount={counts.sellCount}
        watchCount={counts.watchCount}
        avoidCount={counts.avoidCount}
        totalStocks={heatmapRows.length}
        trust={trust}
        sectorStatuses={sectorStatuses}
        isFetching={isFetching}
        pollingIntervalMs={pollingIntervalMs}
        onRefresh={handleManualRefresh}
        onPollingIntervalChange={setPollingIntervalMs}
      />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[10px] sm:text-xs font-bold text-foreground font-mono tracking-wider">MODULE 1 — TOP-DOWN ANALYSIS</h2>
          <p className="text-[9px] text-muted-foreground font-mono mt-0.5">Market → Sector → Industry → Equity</p>
        </div>
        <CreditsBadge />
      </div>

      <MarketRegime market={market} />

      {/* MODULE 1 — Step 2: Leading Sectors */}
      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2">
            <Crown className="h-3.5 w-3.5 text-primary" />
            <h3 className="text-[10px] sm:text-xs font-bold text-foreground font-mono tracking-wider">LEDANDE SEKTORER</h3>
            <span className="text-[8px] font-mono text-muted-foreground">
              ({leadingSectors.length} av {sectorRanking.length} sektorer)
            </span>
          </div>
          <Link to="/sectors" className="text-[10px] font-mono text-primary hover:underline">Alla sektorer →</Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 p-2">
          {leadingSectors.map((s) => (
            <SectorCard key={s.sector_name} sector={s} navigate={navigate} />
          ))}
        </div>
        {laggingSectors.length > 0 && (
          <div className="border-t border-border/40 px-3 py-2">
            <p className="text-[9px] font-mono text-muted-foreground">
              Eftersläpande: {laggingSectors.map((s) => `${s.sector_name} (${s.wsp_regime})`).join(' · ')}
            </p>
          </div>
        )}
      </section>

      {/* MODULE 1 — Step 3: Leading Industries */}
      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2">
            <Factory className="h-3.5 w-3.5 text-primary" />
            <h3 className="text-[10px] sm:text-xs font-bold text-foreground font-mono tracking-wider">LEDANDE INDUSTRIER</h3>
            <span className="text-[8px] font-mono text-muted-foreground">
              (Topp {industryRanking.length} inom ledande sektorer)
            </span>
          </div>
          <Link to="/industries" className="text-[10px] font-mono text-primary hover:underline">Alla industrier →</Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 p-2">
          {industryRanking.slice(0, 12).map((ind) => (
            <IndustryCard key={`${ind.sector}-${ind.display_industry}`} industry={ind} navigate={navigate} />
          ))}
        </div>
      </section>

      {/* MODULE 2+3 — Equity Analysis + Scoring: Heatmap */}
      <MarketHeatmap
        stocks={heatmapRows}
        sectorStatuses={sectorStatuses}
        trust={trust}
        activeSector={null}
        activeIndustry={null}
        onIndustrySelect={() => {}}
        onStockSelect={(symbol) => {
          const context = symbolContextLookup.get(symbol);
          navigate(buildStockDetailPath(symbol, context?.sector, context?.industry));
        }}
        onSectorSelect={(sector) => navigate(`/screener?sector=${encodeURIComponent(sector)}`)}
      />

      <UniverseCoverage />

      {/* MODULE 2+3 — Top 10 WSP Setups (from trust-ranked RPC) */}
      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            <h3 className="text-[10px] sm:text-xs font-bold text-foreground font-mono tracking-wider">BÄSTA WSP-SETUPS</h3>
            <span className="text-[8px] font-mono text-muted-foreground">({topSetupsLoading ? '…' : topSetups.length})</span>
            <span className="text-[8px] font-mono text-primary/60">via trust-rank</span>
          </div>
          <Link to="/screener" className="text-[10px] font-mono text-primary hover:underline">Visa alla →</Link>
        </div>
        {/* Mobile: card layout */}
        <div className="grid grid-cols-2 gap-1.5 p-2 sm:hidden">
          {topSetups.slice(0, 10).map((stock) => (
            <div key={stock.symbol} className="rounded border border-border bg-background p-2 hover:border-primary/30 transition-colors">
              <div className="flex items-center justify-between gap-1">
                <Link to={buildStockDetailPath(stock.symbol, stock.sector, stock.industry)} className="font-mono text-[10px] font-bold text-foreground hover:text-primary">{stock.symbol}</Link>
                <RecommendationBadge recommendation={stock.recommendation} />
              </div>
              <Link
                to={`/screener?sector=${encodeURIComponent(stock.sector)}&industry=${encodeURIComponent(stock.industry)}`}
                className="mt-0.5 block text-[8px] text-primary hover:underline truncate"
              >
                {stock.sector} → {stock.industry}
              </Link>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-mono text-[9px] text-foreground">${getDisplayPrice(stock, topSetupFallbackCloseMap).toFixed(2)}</span>
                <span className={`font-mono text-[9px] font-medium ${stock.changePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                  {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(1)}%
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1">
                <PatternBadge pattern={stock.pattern} />
                <span className="text-[8px] font-mono text-muted-foreground">{stock.score}/{stock.maxScore}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Desktop: table layout */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-left text-[10px] text-muted-foreground font-mono">
                <th className="px-3 py-1.5">#</th>
                <th className="px-2 py-1.5">SYMBOL</th>
                <th className="px-2 py-1.5">PRIS</th>
                <th className="px-2 py-1.5">ÄNDR.</th>
                <th className="px-2 py-1.5">MÖNSTER</th>
                <th className="px-2 py-1.5 text-center">SCORE</th>
                <th className="px-2 py-1.5">VOL</th>
                <th className="px-2 py-1.5">SEKTOR → INDUSTRY</th>
                <th className="px-2 py-1.5">SIGNAL</th>
              </tr>
            </thead>
            <tbody>
              {topSetups.slice(0, 10).map((stock, idx) => (
                <TopSetupRow key={stock.symbol} stock={stock} rank={idx + 1} fallbackCloseMap={topSetupFallbackCloseMap} buildStockDetailPath={buildStockDetailPath} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

function SectorCard({ sector, navigate }: { sector: SectorRankingRow; navigate: (path: string) => void }) {
  const regimeColor = sector.wsp_regime === 'Bullish' ? 'text-signal-buy' : sector.wsp_regime === 'Bearish' ? 'text-signal-sell' : 'text-signal-caution';
  const regimeBorder = sector.wsp_regime === 'Bullish' ? 'border-signal-buy/20' : sector.wsp_regime === 'Bearish' ? 'border-signal-sell/20' : 'border-signal-caution/20';

  return (
    <button
      onClick={() => navigate(`/screener?sector=${encodeURIComponent(sector.sector_name)}`)}
      className={`rounded border ${regimeBorder} bg-background p-2.5 text-left hover:border-primary/30 transition-colors w-full`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold text-foreground">{sector.sector_name}</span>
        <span className={`font-mono text-[9px] font-bold ${regimeColor}`}>#{sector.rank_position} {sector.wsp_regime.toUpperCase()}</span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[9px] font-mono text-muted-foreground">
        <span>{sector.pct_above_ma50.toFixed(0)}% &gt; MA50</span>
        <span>Snitt {sector.avg_wsp_score.toFixed(1)}/5</span>
        <span>{sector.wsp_setups} setups</span>
      </div>
      <div className="mt-0.5 text-[8px] font-mono text-muted-foreground">
        {sector.symbol_count} aktier · Dag {sector.avg_pct_today >= 0 ? '+' : ''}{sector.avg_pct_today.toFixed(1)}%
      </div>
    </button>
  );
}

function IndustryCard({ industry, navigate }: { industry: IndustryRankingRow; navigate: (path: string) => void }) {
  return (
    <button
      onClick={() => navigate(`/screener?sector=${encodeURIComponent(industry.sector)}&industry=${encodeURIComponent(industry.display_industry)}`)}
      className="rounded border border-border bg-background p-2.5 text-left hover:border-primary/30 transition-colors w-full"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold text-foreground truncate max-w-[160px]">{industry.display_industry}</span>
        <span className="font-mono text-[9px] text-primary">#{industry.rank_position}</span>
      </div>
      <div className="mt-0.5 text-[8px] font-mono text-muted-foreground">{industry.sector}</div>
      <div className="mt-1 flex items-center gap-2 text-[9px] font-mono text-muted-foreground">
        <span>Snitt {industry.avg_wsp_score.toFixed(1)}/5</span>
        <span>{industry.symbol_count} aktier</span>
        <span className="text-signal-buy">{industry.buy_count} KÖP</span>
        <span>{industry.watch_count} BEV</span>
      </div>
      {industry.breakout_count > 0 && (
        <div className="mt-0.5 text-[8px] font-mono text-signal-buy font-bold">⚡ {industry.breakout_count} breakout</div>
      )}
    </button>
  );
}

function getDisplayPrice(stock: TopSetupDisplay, fallbackCloseMap: Record<string, number>) {
  const candidate = typeof stock.price === 'number' && Number.isFinite(stock.price) && stock.price > 0
    ? stock.price
    : fallbackCloseMap[stock.symbol];
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
}

function TopSetupRow({
  stock,
  rank,
  fallbackCloseMap,
  buildStockDetailPath,
}: {
  stock: TopSetupDisplay;
  rank: number;
  fallbackCloseMap: Record<string, number>;
  buildStockDetailPath: (symbol: string, sector?: string, industry?: string) => string;
}) {
  const positive = stock.changePercent >= 0;
  const displayPrice = getDisplayPrice(stock, fallbackCloseMap);

  return (
    <tr className="border-b border-border/30 hover:bg-muted/20 transition-colors">
      <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{rank}</td>
      <td className="px-2 py-2">
        <Link to={buildStockDetailPath(stock.symbol, stock.sector, stock.industry)} className="hover:text-primary transition-colors">
          <span className="font-mono text-xs font-bold text-foreground">{stock.symbol}</span>
        </Link>
      </td>
      <td className="px-2 py-2 font-mono text-xs text-foreground">${displayPrice.toFixed(2)}</td>
      <td className="px-2 py-2">
        <span className={`flex items-center gap-0.5 font-mono text-xs font-medium ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
          {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {positive ? '+' : ''}{stock.changePercent.toFixed(2)}%
        </span>
      </td>
      <td className="px-2 py-2"><PatternBadge pattern={stock.pattern} /></td>
      <td className="px-2 py-2 text-center">
        <div className="flex justify-center">
          <WSPScoreRing score={stock.score} maxScore={stock.maxScore} size={32} />
        </div>
      </td>
      <td className="px-2 py-2">
        <span className={`font-mono text-xs ${stock.volumeMultiple != null && stock.volumeMultiple >= 2 ? 'text-signal-buy font-semibold' : 'text-muted-foreground'}`}>
          {stock.volumeMultiple != null ? `${stock.volumeMultiple.toFixed(1)}x` : '—'}
        </span>
      </td>
      <td className="px-2 py-2 text-[9px] text-muted-foreground truncate max-w-[160px]">
        <Link to={`/screener?sector=${encodeURIComponent(stock.sector)}&industry=${encodeURIComponent(stock.industry)}`} className="hover:text-foreground">
          {stock.sector} → {stock.industry}
        </Link>
      </td>
      <td className="px-2 py-2"><RecommendationBadge recommendation={stock.recommendation} /></td>
    </tr>
  );
}

export default Index;
