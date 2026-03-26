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
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[10px] font-mono font-bold uppercase tracking-widest text-foreground">SECTOR RANKING</h2>
        <span className="text-[8px] font-mono text-muted-foreground">{uiState === 'FALLBACK' ? 'TRACKED STR' : 'PROXY/STR'}</span>
      </div>
      <div className="space-y-1">
        {sectors.map((sector, idx) => {
          const active = activeSector === sector.sector;
          const trendIcon = sector.trendState === 'bullish'
            ? <TrendingUp className="h-2.5 w-2.5 text-signal-buy" />
            : sector.trendState === 'bearish'
            ? <TrendingDown className="h-2.5 w-2.5 text-signal-sell" />
            : <Minus className="h-2.5 w-2.5 text-signal-caution" />;

          return (
            <button
              key={sector.sector}
              onClick={() => onSectorSelect(sector.sector)}
              className={`flex w-full items-center justify-between rounded border p-2.5 text-left transition-all ${active ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20' : 'border-border bg-card hover:border-primary/20'}`}
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-muted text-[9px] font-mono font-bold text-muted-foreground">{idx + 1}</span>
                <div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-mono font-semibold text-foreground">{sector.sector}</span>
                    {trendIcon}
                  </div>
                  <div className="text-[8px] font-mono text-muted-foreground">{sector.industries.length} ind · {sector.stocks.length} stk</div>
                </div>
              </div>
              <div className="text-right">
                <div className={`font-mono text-[11px] font-bold ${sector.displayValue >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                  {sector.valueMode === 'proxy_return'
                    ? `${sector.displayValue >= 0 ? '+' : ''}${sector.displayValue.toFixed(2)}%`
                    : `S${sector.displayValue.toFixed(1)}`}
                </div>
                <div className="text-[8px] font-mono text-muted-foreground">{sector.valueLabel}</div>
                {sector.confidence !== 'high' && <div className="text-[8px] font-mono text-signal-caution">Limited</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
