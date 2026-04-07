import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Table2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type Regime = 'Bullish' | 'Neutral' | 'Bearish';

type SectorRow = {
  sector_name: string;
  symbol_count: number;
  avg_pct_today: number | null;
  pct_above_ma50: number | null;
  wsp_regime: Regime;
  wsp_setups: number;
  avg_wsp_score: number | null;
  top_pattern: string | null;
};

const GICS_SECTOR_ORDER = [
  'Technology',
  'Financials',
  'Healthcare',
  'Energy',
  'Materials',
  'Industrials',
  'Consumer Discretionary',
  'Consumer Staples',
  'Utilities',
  'Real Estate',
  'Communication Services',
] as const;

function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return 'N/A';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function pctClass(value: number | null) {
  if (value === null || Number.isNaN(value)) return 'text-muted-foreground';
  return value >= 0 ? 'text-signal-buy' : 'text-signal-sell';
}

function regimeClass(regime: Regime) {
  if (regime === 'Bullish') return 'text-signal-buy';
  if (regime === 'Bearish') return 'text-signal-sell';
  return 'text-signal-caution';
}

function patternLabel(pattern: string | null) {
  if (!pattern) return '—';
  const map: Record<string, string> = {
    climbing: '📈 Climbing',
    base_or_climbing: '📊 Base/Climbing',
    base: '📊 Base',
    tired: '⚠️ Tired',
    downhill: '📉 Downhill',
  };
  return map[pattern] ?? pattern;
}

async function fetchMarketSummary(): Promise<SectorRow[]> {
  const { data, error } = await supabase.rpc('get_market_summary');

  if (error) throw new Error(error.message);
  if (!data || !Array.isArray(data) || data.length === 0) {
    return [];
  }

  return (data as any[]).map((row) => ({
    sector_name: row.sector_name,
    symbol_count: Number(row.symbol_count ?? 0),
    avg_pct_today: row.avg_pct_today != null ? Number(row.avg_pct_today) : null,
    pct_above_ma50: row.pct_above_ma50 != null ? Number(row.pct_above_ma50) : null,
    wsp_regime: (row.wsp_regime ?? 'Neutral') as Regime,
    wsp_setups: Number(row.wsp_setups ?? 0),
    avg_wsp_score: row.avg_wsp_score != null ? Number(row.avg_wsp_score) : null,
    top_pattern: row.top_pattern ?? null,
  }));
}

export default function MarketSummary() {
  const [expandedSectors, setExpandedSectors] = useState<Record<string, boolean>>({});

  const marketSummaryQuery = useQuery({
    queryKey: ['market-summary'],
    queryFn: fetchMarketSummary,
    staleTime: 5 * 60 * 1000,
  });

  const rawSectors = marketSummaryQuery.data ?? [];

  // Order by GICS first, then remaining sectors alphabetically
  const gicsSet = new Set<string>(GICS_SECTOR_ORDER);
  const orderedGics = GICS_SECTOR_ORDER
    .map((name) => rawSectors.find((s) => s.sector_name === name))
    .filter((s): s is SectorRow => Boolean(s));
  const otherSectors = rawSectors
    .filter((s) => !gicsSet.has(s.sector_name))
    .sort((a, b) => a.sector_name.localeCompare(b.sector_name));
  const sectors = [...orderedGics, ...otherSectors];

  const toggleSector = (sectorKey: string) => {
    setExpandedSectors((prev) => ({ ...prev, [sectorKey]: !prev[sectorKey] }));
  };

  return (
    <div className="space-y-3 px-2 py-2 sm:px-4 sm:py-4 max-w-7xl mx-auto pb-20 md:pb-4">
      <div className="flex items-start gap-3">
        <Table2 className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" />
        <div>
          <h2 className="text-xs font-bold text-foreground font-mono tracking-wider">MARKET SUMMARY</h2>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            Sector overview · latest WSP indicators per symbol
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left">Sector</th>
                <th className="px-3 py-2 text-right">Stocks</th>
                <th className="px-3 py-2 text-right">% Today</th>
                <th className="px-3 py-2 text-right">% Above MA50</th>
                <th className="px-3 py-2 text-right">WSP Regime</th>
                <th className="px-3 py-2 text-right">WSP Setups</th>
                <th className="px-3 py-2 text-right">Avg Score</th>
                <th className="px-3 py-2 text-right">Top Pattern</th>
              </tr>
            </thead>
            <tbody>
              {marketSummaryQuery.isLoading && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground font-mono">Loading market summary...</td>
                </tr>
              )}

              {marketSummaryQuery.isError && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-signal-sell font-mono">
                    Failed to load market summary: {(marketSummaryQuery.error as Error).message}
                  </td>
                </tr>
              )}

              {!marketSummaryQuery.isLoading && !marketSummaryQuery.isError && sectors.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground font-mono">No market summary data available.</td>
                </tr>
              )}

              {sectors.map((sector) => {
                const expanded = Boolean(expandedSectors[sector.sector_name]);
                return (
                  <Fragment key={sector.sector_name}>
                    <tr
                      className="border-b border-border/30 hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => toggleSector(sector.sector_name)}
                    >
                      <td className="px-3 py-2">
                        <button type="button" className="flex items-center gap-1.5 text-left">
                          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          <span className="font-medium text-foreground">{sector.sector_name}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{sector.symbol_count}</td>
                      <td className={`px-3 py-2 text-right font-mono ${pctClass(sector.avg_pct_today)}`}>{formatPercent(sector.avg_pct_today)}</td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">
                        {sector.pct_above_ma50 != null ? `${sector.pct_above_ma50.toFixed(1)}%` : 'N/A'}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${regimeClass(sector.wsp_regime)}`}>
                        {sector.wsp_regime}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">{sector.wsp_setups}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        {sector.avg_wsp_score != null ? sector.avg_wsp_score.toFixed(1) : 'N/A'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground text-[10px]">
                        {patternLabel(sector.top_pattern)}
                      </td>
                    </tr>

                    {expanded && (
                      <tr className="border-b border-border/20 bg-background/30">
                        <td colSpan={8} className="px-6 py-3 text-[10px] text-muted-foreground font-mono">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div>
                              <span className="block text-muted-foreground/70">Symbol Count</span>
                              <span className="text-foreground font-medium">{sector.symbol_count}</span>
                            </div>
                            <div>
                              <span className="block text-muted-foreground/70">% Above MA50</span>
                              <span className="text-foreground font-medium">
                                {sector.pct_above_ma50 != null ? `${sector.pct_above_ma50.toFixed(1)}%` : 'N/A'}
                              </span>
                            </div>
                            <div>
                              <span className="block text-muted-foreground/70">Avg WSP Score</span>
                              <span className="text-foreground font-medium">
                                {sector.avg_wsp_score != null ? `${sector.avg_wsp_score.toFixed(1)} / 9` : 'N/A'}
                              </span>
                            </div>
                            <div>
                              <span className="block text-muted-foreground/70">Dominant Pattern</span>
                              <span className="text-foreground font-medium">{patternLabel(sector.top_pattern)}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
