import { useMemo } from 'react';
import type { EvaluatedStock, SectorStatus } from '@/lib/wsp-types';
import { buildSectorHeatmap } from '@/lib/discovery';

interface SectorRankingProps {
  stocks: EvaluatedStock[];
  sectorStatuses?: SectorStatus[];
  activeSector: string | null;
  onSectorSelect: (sector: string) => void;
}

export function SectorRanking({ stocks, sectorStatuses, activeSector, onSectorSelect }: SectorRankingProps) {
  const sectors = useMemo(() => buildSectorHeatmap(stocks, sectorStatuses ?? []), [stocks, sectorStatuses]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Sector ranking</h2>
        <span className="text-[10px] text-muted-foreground">Strength-ranked</span>
      </div>
      <div className="space-y-1.5">
        {sectors.map((sector, idx) => {
          const active = activeSector === sector.sector;
          return (
            <button
              key={sector.sector}
              onClick={() => onSectorSelect(sector.sector)}
              className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-all ${active ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:border-primary/20'}`}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">{idx + 1}</span>
                <div>
                  <div className="text-xs font-medium text-foreground">{sector.sector}</div>
                  <div className="text-[10px] text-muted-foreground">{sector.industries.length} industries · {sector.stocks.length} stocks</div>
                </div>
              </div>
              <div className="text-right">
                <div className={`font-mono text-xs font-semibold ${sector.avgChange >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>{sector.avgChange >= 0 ? '+' : ''}{sector.avgChange.toFixed(2)}%</div>
                <div className="text-[10px] text-muted-foreground">score {sector.strengthScore.toFixed(1)}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
