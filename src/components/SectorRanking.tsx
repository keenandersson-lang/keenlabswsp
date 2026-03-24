import { ArrowUpRight, ArrowDownRight, BarChart3, ChevronRight } from 'lucide-react';
import { sectorData, getSectorAvgChange, getSectorChartUrl } from '@/lib/sector-data';
import type { SectorStatus } from '@/lib/wsp-types';

interface SectorRankingProps {
  sectorStatuses?: SectorStatus[];
  activeSector: string | null;
  onSectorSelect: (sector: string) => void;
}

export function SectorRanking({ sectorStatuses, activeSector, onSectorSelect }: SectorRankingProps) {
  const sortedSectors = [...sectorData].sort((a, b) => getSectorAvgChange(b) - getSectorAvgChange(a));

  const statusMap = Object.fromEntries((sectorStatuses ?? []).map(s => [s.sector, s]));

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Sektor-ranking</h2>
        <span className="text-[10px] text-muted-foreground">({sortedSectors.length} sektorer)</span>
      </div>

      {/* Heatmap bar */}
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
        {sortedSectors.map(sector => {
          const avg = getSectorAvgChange(sector);
          const positive = avg >= 0;
          const isActive = activeSector === sector.name;
          return (
            <button
              key={sector.name}
              onClick={() => onSectorSelect(sector.name)}
              className={`flex-shrink-0 rounded-md border px-2.5 py-1.5 text-center transition-all ${
                isActive
                  ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                  : positive
                    ? 'border-signal-buy/20 bg-signal-buy/10 hover:border-signal-buy/40'
                    : 'border-signal-sell/20 bg-signal-sell/10 hover:border-signal-sell/40'
              }`}
            >
              <span className="block text-[10px] text-muted-foreground whitespace-nowrap">{sector.name}</span>
              <span className={`block font-mono text-xs font-bold ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
                {positive ? '+' : ''}{avg.toFixed(2)}%
              </span>
            </button>
          );
        })}
      </div>

      {/* Sector list */}
      <div className="space-y-1">
        {sortedSectors.map((sector, idx) => {
          const avg = getSectorAvgChange(sector);
          const positive = avg >= 0;
          const isActive = activeSector === sector.name;
          const status = statusMap[sector.name];
          const isBullish = status?.isBullish;

          return (
            <button
              key={sector.name}
              onClick={() => onSectorSelect(sector.name)}
              className={`w-full flex items-center justify-between rounded-lg border p-3 text-left transition-all ${
                isActive
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card hover:border-primary/20'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold ${
                  idx < 3 ? 'bg-signal-buy/20 text-signal-buy' : 'bg-muted text-muted-foreground'
                }`}>
                  {idx + 1}
                </span>
                <div>
                  <span className="text-xs font-medium text-foreground">{sector.name}</span>
                  <span className="ml-2 text-[10px] text-muted-foreground">({sector.industries.length})</span>
                </div>
                {isBullish !== undefined && (
                  <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold ${
                    isBullish
                      ? 'border-signal-buy/30 bg-signal-buy/10 text-signal-buy'
                      : 'border-signal-sell/30 bg-signal-sell/10 text-signal-sell'
                  }`}>
                    {isBullish ? 'BULL' : 'BEAR'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`font-mono text-xs font-semibold ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
                  {positive ? '+' : ''}{avg.toFixed(2)}%
                </span>
                <ChevronRight className={`h-3.5 w-3.5 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
