import { useMemo, useState } from 'react';
import type { ScreenerTrustContract, SectorStatus } from '@/lib/wsp-types';
import { AlertTriangle } from 'lucide-react';
import { heatmapCellClass } from '@/lib/heatmap-scale';
import type { ScreenerRow } from '@/hooks/use-equity-screener';

type HeatmapColorMode = 'dailyChange' | 'sectorRS';

function rsToHeatValue(rs: number | null | undefined): number {
  if (rs == null || !Number.isFinite(rs)) return 0;
  return rs * 20;
}

interface MarketHeatmapProps {
  stocks: ScreenerRow[];
  sectorStatuses: SectorStatus[];
  trust: ScreenerTrustContract;
  activeSector: string | null;
  activeIndustry: string | null;
  onSectorSelect: (sector: string) => void;
  onIndustrySelect: (industry: string) => void;
  onStockSelect: (symbol: string) => void;
  degradedMessage?: string;
}

export function MarketHeatmap({
  stocks,
  sectorStatuses,
  activeSector,
  onSectorSelect,
  onIndustrySelect,
  onStockSelect,
  degradedMessage,
}: MarketHeatmapProps) {
  const [colorMode, setColorMode] = useState<HeatmapColorMode>('dailyChange');

  const sectors = useMemo(() => {
    const bySector = new Map<string, ScreenerRow[]>();
    for (const stock of stocks) {
      const rows = bySector.get(stock.sector) ?? [];
      rows.push(stock);
      bySector.set(stock.sector, rows);
    }

    return [...bySector.entries()].map(([sector, rows]) => ({
      sector,
      stocks: rows,
      avgChange: rows.reduce((sum, r) => sum + r.changePercent, 0) / Math.max(1, rows.length),
      status: sectorStatuses.find((s) => s.sector === sector),
    }));
  }, [stocks, sectorStatuses]);

  if (sectors.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded border border-border bg-card p-4 text-[10px] text-muted-foreground font-mono">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-signal-caution" />
        <span>{degradedMessage ?? 'Heatmap unavailable — waiting for data.'}</span>
      </div>
    );
  }

  const getStockHeatValue = (stock: ScreenerRow): number => colorMode === 'sectorRS' ? rsToHeatValue(stock.mansfieldRs) : stock.changePercent;

  const getSectorHeatValue = (sector: typeof sectors[0]): number => {
    if (colorMode === 'dailyChange') return sector.avgChange;
    const rsValues = sector.stocks.map((s) => s.mansfieldRs).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (rsValues.length === 0) return 0;
    return rsToHeatValue(rsValues.reduce((a, b) => a + b, 0) / rsValues.length);
  };

  const heatmapTrustScore = (stock: ScreenerRow): number => {
    const taxonomyQuality = stock.industry !== 'Unknown' && stock.industry !== 'Other' ? 10 : -20;
    const patternQuality = stock.pattern_state === 'climbing' ? 12 : stock.pattern_state === 'base' ? 6 : -2;
    const rsStrength = Math.max(-8, Math.min(20, (stock.mansfieldRs ?? 0) * 8));
    const liquidity = Math.max(0, Math.min(16, (stock.volumeRatio ?? 0) * 5));
    return (stock.wsp_score ?? 0) * 10 + taxonomyQuality + patternQuality + rsStrength + liquidity;
  };

  return (
    <section className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-foreground">MARKET HEATMAP</h3>
          <span className="text-[8px] font-mono text-muted-foreground">{sectors.length} GICS-sektorer · {stocks.length} aktier med sektordata</span>
        </div>
        <HeatmapModeToggle mode={colorMode} onChange={setColorMode} />
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
        {sectors.map((sector) => {
          const sectorHeatVal = getSectorHeatValue(sector);
          const topStocks = [...sector.stocks]
            .sort((a, b) => heatmapTrustScore(b) - heatmapTrustScore(a) || (b.wsp_score - a.wsp_score))
            .slice(0, 5);

          return (
            <article key={sector.sector} className={`rounded border p-1.5 ${heatmapCellClass(sectorHeatVal)} ${activeSector === sector.sector ? 'ring-1 ring-primary/50 ring-offset-1 ring-offset-background' : ''}`}>
              <button className="mb-1 flex w-full items-center justify-between gap-1" onClick={() => onSectorSelect(sector.sector)}>
                <span className="text-[9px] font-mono font-bold text-foreground truncate">{sector.sector}</span>
                <span className={`font-mono text-[9px] font-semibold ${sectorHeatVal >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
                  {sectorHeatVal >= 0 ? '+' : ''}{sectorHeatVal.toFixed(2)}{colorMode === 'dailyChange' ? '%' : ''}
                </span>
              </button>

              <div className="flex flex-wrap gap-0.5">
                {topStocks.map((stock) => {
                  const stockHeatVal = getStockHeatValue(stock);
                  return (
                    <button
                      key={stock.symbol}
                      onClick={() => {
                        onSectorSelect(sector.sector);
                        onIndustrySelect(stock.industry);
                        onStockSelect(stock.symbol);
                      }}
                      className={`rounded border px-1 py-0.5 text-left ${heatmapCellClass(stockHeatVal)} hover:border-primary/40 transition-colors`}
                    >
                      <span className="text-[8px] font-mono font-bold text-foreground">{stock.symbol}</span>
                    </button>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function HeatmapModeToggle({ mode, onChange }: { mode: HeatmapColorMode; onChange: (m: HeatmapColorMode) => void }) {
  return (
    <div className="flex items-center rounded border border-border bg-card text-[8px] font-mono">
      <button onClick={() => onChange('dailyChange')} className={`px-1.5 py-0.5 rounded-l transition-colors ${mode === 'dailyChange' ? 'bg-primary/20 text-primary font-bold' : 'text-muted-foreground hover:text-foreground'}`}>
        1D %
      </button>
      <button onClick={() => onChange('sectorRS')} className={`px-1.5 py-0.5 rounded-r transition-colors ${mode === 'sectorRS' ? 'bg-primary/20 text-primary font-bold' : 'text-muted-foreground hover:text-foreground'}`}>
        RS
      </button>
    </div>
  );
}
