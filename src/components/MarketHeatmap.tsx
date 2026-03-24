import { useMemo } from 'react';
import type { EvaluatedStock, SectorStatus } from '@/lib/wsp-types';
import { buildSectorHeatmap, type SectorHeatCell } from '@/lib/discovery';

interface MarketHeatmapProps {
  stocks: EvaluatedStock[];
  sectorStatuses: SectorStatus[];
  activeSector: string | null;
  onSectorSelect: (sector: string) => void;
  degradedMessage?: string;
}

export function MarketHeatmap({ stocks, sectorStatuses, activeSector, onSectorSelect, degradedMessage }: MarketHeatmapProps) {
  const sectors = useMemo(() => buildSectorHeatmap(stocks, sectorStatuses), [stocks, sectorStatuses]);

  if (sectors.length === 0) {
    return <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">{degradedMessage ?? 'Market heatmap unavailable until sector data is loaded.'}</div>;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Market heatmap</h3>
        <span className="text-xs text-muted-foreground">Click a sector to drill down</span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
        {sectors.map((sector) => {
          const isActive = activeSector === sector.sector;
          const tone = toneClass(sector);
          const blockSize = sizeClass(sector.stocks.length);
          return (
            <button
              key={sector.sector}
              onClick={() => onSectorSelect(sector.sector)}
              className={`rounded-xl border p-3 text-left transition-all ${tone} ${blockSize} ${isActive ? 'ring-2 ring-primary/50' : 'hover:border-primary/40'}`}
            >
              <div className="text-xs font-semibold text-foreground">{sector.sector}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">{sector.industries.length} industries · {sector.stocks.length} stocks</div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="text-[10px] text-muted-foreground">Avg change</div>
                  <div className="font-mono text-sm font-semibold">{formatSigned(sector.avgChange)}%</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-muted-foreground">Strength</div>
                  <div className="font-mono text-sm">{sector.strengthScore.toFixed(1)}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function toneClass(sector: SectorHeatCell): string {
  if (sector.trendState === 'bullish') return 'border-signal-buy/30 bg-signal-buy/10 text-signal-buy';
  if (sector.trendState === 'bearish') return 'border-signal-sell/30 bg-signal-sell/10 text-signal-sell';
  return 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution';
}

function sizeClass(stockCount: number): string {
  if (stockCount >= 4) return 'min-h-[140px]';
  if (stockCount >= 2) return 'min-h-[120px]';
  return 'min-h-[100px]';
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
