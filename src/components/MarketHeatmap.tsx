import { useMemo } from 'react';
import type { EvaluatedStock, SectorStatus } from '@/lib/wsp-types';
import { buildSectorHeatmap, type SectorHeatCell } from '@/lib/discovery';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';

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
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-signal-caution" />
        <span>{degradedMessage ?? 'Market heatmap unavailable — waiting for sector data.'}</span>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Sector Heatmap</h3>
        <span className="text-[11px] text-muted-foreground">Click to drill down</span>
      </div>

      {degradedMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-signal-caution/20 bg-signal-caution/5 px-3 py-2 text-[11px] text-signal-caution">
          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
          {degradedMessage}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
        {sectors.map((sector) => {
          const isActive = activeSector === sector.sector;
          return (
            <button
              key={sector.sector}
              onClick={() => onSectorSelect(sector.sector)}
              className={`group relative rounded-xl border p-3.5 text-left transition-all ${toneClass(sector)} ${isActive ? 'ring-2 ring-primary/50 ring-offset-1 ring-offset-background' : 'hover:border-primary/30'}`}
            >
              <div className="flex items-start justify-between gap-1 mb-2">
                <div className="text-xs font-semibold text-foreground leading-tight">{sector.sector}</div>
                <TrendIcon state={sector.trendState} />
              </div>
              <div className="text-[10px] text-muted-foreground mb-3">
                {sector.industries.length} ind. · {sector.stocks.length} stocks
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Change</div>
                  <div className={`font-mono text-sm font-bold ${sector.avgChange >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                    {formatSigned(sector.avgChange)}%
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Score</div>
                  <div className="font-mono text-sm font-medium text-foreground">{sector.strengthScore.toFixed(1)}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function TrendIcon({ state }: { state: 'bullish' | 'neutral' | 'bearish' }) {
  if (state === 'bullish') return <TrendingUp className="h-3.5 w-3.5 text-signal-buy" />;
  if (state === 'bearish') return <TrendingDown className="h-3.5 w-3.5 text-signal-sell" />;
  return <Minus className="h-3.5 w-3.5 text-signal-caution" />;
}

function toneClass(sector: SectorHeatCell): string {
  if (sector.trendState === 'bullish') return 'border-signal-buy/20 bg-signal-buy/5';
  if (sector.trendState === 'bearish') return 'border-signal-sell/20 bg-signal-sell/5';
  return 'border-signal-caution/15 bg-signal-caution/5';
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
