import { useMemo } from 'react';
import type { EvaluatedStock, ScreenerUiState, SectorStatus } from '@/lib/wsp-types';
import { buildSectorHeatmap, type SectorHeatCell } from '@/lib/discovery';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';

interface MarketHeatmapProps {
  stocks: EvaluatedStock[];
  sectorStatuses: SectorStatus[];
  uiState: ScreenerUiState;
  activeSector: string | null;
  onSectorSelect: (sector: string) => void;
  degradedMessage?: string;
}

export function MarketHeatmap({ stocks, sectorStatuses, uiState, activeSector, onSectorSelect, degradedMessage }: MarketHeatmapProps) {
  const sectors = useMemo(() => buildSectorHeatmap(stocks, sectorStatuses, uiState), [stocks, sectorStatuses, uiState]);

  if (sectors.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded border border-border bg-card p-4 text-[10px] text-muted-foreground font-mono">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-signal-caution" />
        <span>{degradedMessage ?? 'Heatmap unavailable — waiting for data.'}</span>
      </div>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-foreground">SECTOR HEATMAP</h3>
        <span className="text-[9px] font-mono text-muted-foreground">Click to drill down</span>
      </div>

      {degradedMessage && (
        <div className="flex items-center gap-2 rounded border border-signal-caution/20 bg-signal-caution/5 px-2.5 py-1.5 text-[9px] font-mono text-signal-caution">
          <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0" />
          {degradedMessage}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-4">
        {sectors.map((sector) => {
          const isActive = activeSector === sector.sector;
          return (
            <button
              key={sector.sector}
              onClick={() => onSectorSelect(sector.sector)}
              className={`group relative rounded border p-3 text-left transition-all ${toneClass(sector)} ${isActive ? 'ring-1 ring-primary/50 ring-offset-1 ring-offset-background' : 'hover:border-primary/30'}`}
            >
              <div className="flex items-start justify-between gap-1 mb-1.5">
                <div className="text-[10px] font-mono font-bold text-foreground leading-tight">{sector.sector}</div>
                <TrendIcon state={sector.trendState} />
              </div>
              <div className="text-[8px] font-mono text-muted-foreground mb-2">
                {sector.industries.length} ind · {sector.stocks.length} stk
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[7px] font-mono uppercase tracking-widest text-muted-foreground">
                    {sector.valueMode === 'proxy_return' ? 'PROXY' : 'STR'}
                  </div>
                  <div className={`font-mono text-sm font-bold ${sector.displayValue >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                    {sector.valueMode === 'proxy_return' ? `${formatSigned(sector.displayValue)}%` : `S${sector.displayValue.toFixed(1)}`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[7px] font-mono uppercase tracking-widest text-muted-foreground">SCORE</div>
                  <div className="font-mono text-xs font-semibold text-foreground">{sector.strengthScore.toFixed(1)}</div>
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
  if (state === 'bullish') return <TrendingUp className="h-3 w-3 text-signal-buy" />;
  if (state === 'bearish') return <TrendingDown className="h-3 w-3 text-signal-sell" />;
  return <Minus className="h-3 w-3 text-signal-caution" />;
}

function toneClass(sector: SectorHeatCell): string {
  if (sector.trendState === 'bullish') return 'border-signal-buy/20 bg-signal-buy/5';
  if (sector.trendState === 'bearish') return 'border-signal-sell/20 bg-signal-sell/5';
  return 'border-signal-caution/15 bg-signal-caution/5';
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
