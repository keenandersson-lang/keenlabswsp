import { useMemo } from 'react';
import type { EvaluatedStock, ScreenerUiState, SectorStatus } from '@/lib/wsp-types';
import { buildSectorHeatmap } from '@/lib/discovery';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface SectorRankingProps {
  stocks: EvaluatedStock[];
  sectorStatuses?: SectorStatus[];
  uiState: ScreenerUiState;
  activeSector: string | null;
  onSectorSelect: (sector: string) => void;
}

export function SectorRanking({ stocks, sectorStatuses, uiState, activeSector, onSectorSelect }: SectorRankingProps) {
  const sectors = useMemo(() => buildSectorHeatmap(stocks, sectorStatuses ?? [], uiState), [stocks, sectorStatuses, uiState]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Sector Ranking</h2>
        <span className="text-[10px] text-muted-foreground">{uiState === 'FALLBACK' ? 'Tracked strength ranked' : 'Proxy/strength ranked'}</span>
      </div>
      <div className="space-y-1.5">
        {sectors.map((sector, idx) => {
          const active = activeSector === sector.sector;
          const trendIcon = sector.trendState === 'bullish'
            ? <TrendingUp className="h-3 w-3 text-signal-buy" />
            : sector.trendState === 'bearish'
            ? <TrendingDown className="h-3 w-3 text-signal-sell" />
            : <Minus className="h-3 w-3 text-signal-caution" />;

          return (
            <button
              key={sector.sector}
              onClick={() => onSectorSelect(sector.sector)}
              className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-all ${active ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20' : 'border-border bg-card hover:border-primary/20'}`}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">{idx + 1}</span>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground">{sector.sector}</span>
                    {trendIcon}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{sector.industries.length} industries · {sector.stocks.length} stocks</div>
                </div>
              </div>
              <div className="text-right">
                <div className={`font-mono text-xs font-semibold ${sector.displayValue >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                  {sector.valueMode === 'proxy_return'
                    ? `${sector.displayValue >= 0 ? '+' : ''}${sector.displayValue.toFixed(2)}%`
                    : `S${sector.displayValue.toFixed(1)}`}
                </div>
                <div className="text-[10px] text-muted-foreground">{sector.valueLabel}</div>
                {sector.confidence !== 'high' && <div className="text-[10px] text-signal-caution">Limited sample confidence</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
