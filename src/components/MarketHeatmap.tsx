import { useMemo } from 'react';
import type { EvaluatedStock, ScreenerUiState, SectorStatus } from '@/lib/wsp-types';
import { buildSectorHeatmap } from '@/lib/discovery';
import { AlertTriangle } from 'lucide-react';
import { heatmapCellClass } from '@/lib/heatmap-scale';

interface MarketHeatmapProps {
  stocks: EvaluatedStock[];
  sectorStatuses: SectorStatus[];
  uiState: ScreenerUiState;
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
  uiState,
  activeSector,
  activeIndustry,
  onSectorSelect,
  onIndustrySelect,
  onStockSelect,
  degradedMessage,
}: MarketHeatmapProps) {
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
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-foreground">MARKET HEATMAP · SECTOR → INDUSTRY → STOCK</h3>
        <HeatmapLegend />
      </div>

      {degradedMessage && (
        <div className="flex items-center gap-2 rounded border border-signal-caution/20 bg-signal-caution/5 px-2.5 py-1.5 text-[9px] font-mono text-signal-caution">
          <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0" />
          {degradedMessage}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {sectors.map((sector) => {
          const sectorActive = activeSector === sector.sector;
          const byIndustry = new Map<string, EvaluatedStock[]>();
          for (const stock of sector.stocks) {
            const bucket = byIndustry.get(stock.industry) ?? [];
            bucket.push(stock);
            byIndustry.set(stock.industry, bucket);
          }

          return (
            <article
              key={sector.sector}
              className={`rounded border p-2 ${heatmapCellClass(sector.avgChange)} ${sectorActive ? 'ring-1 ring-primary/50 ring-offset-1 ring-offset-background' : ''}`}
            >
              <button className="mb-1 flex w-full items-center justify-between" onClick={() => onSectorSelect(sector.sector)}>
                <span className="text-[10px] font-mono font-bold text-foreground">{sector.sector}</span>
                <span className={`font-mono text-[10px] font-semibold ${sector.avgChange >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
                  {sector.avgChange >= 0 ? '+' : ''}{sector.avgChange.toFixed(2)}%
                </span>
              </button>

              <div className="space-y-1">
                {[...byIndustry.entries()].map(([industry, industryStocks]) => {
                  const industryChange = industryStocks.reduce((sum, stock) => sum + stock.changePercent, 0) / industryStocks.length;
                  const industryActive = sectorActive && activeIndustry === industry;
                  const shownStocks = [...industryStocks].sort((a, b) => b.changePercent - a.changePercent).slice(0, 8);

                  return (
                    <div key={industry} className={`rounded border ${heatmapCellClass(industryChange)} p-1.5`}>
                      <button className="mb-1 flex w-full items-center justify-between" onClick={() => { onSectorSelect(sector.sector); onIndustrySelect(industry); }}>
                        <span className="text-[9px] font-mono text-foreground">{industry}</span>
                        <span className="text-[8px] font-mono text-muted-foreground">{industryStocks.length} stk</span>
                      </button>

                      <div className="grid grid-cols-4 gap-1">
                        {shownStocks.map((stock) => (
                          <button
                            key={stock.symbol}
                            onClick={() => {
                              onSectorSelect(sector.sector);
                              onIndustrySelect(industry);
                              onStockSelect(stock.symbol);
                            }}
                            className={`rounded border px-1 py-1 text-left ${heatmapCellClass(stock.changePercent)} ${industryActive ? 'hover:border-primary/40' : ''}`}
                            title={`${stock.symbol} ${stock.changePercent >= 0 ? '+' : ''}${stock.changePercent.toFixed(2)}% · ${stock.supportsFullWsp ? 'Full WSP' : 'Limited WSP'}`}
                          >
                            <div className="text-[9px] font-mono font-bold text-foreground">{stock.symbol}</div>
                            <div className={`text-[8px] font-mono ${stock.changePercent >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
                              {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(1)}%
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
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

function HeatmapLegend() {
  const bands = [-3, -2, -1, 0, 1, 2, 3];
  return (
    <div className="flex items-center gap-1 text-[8px] font-mono text-muted-foreground">
      {bands.map((band) => (
        <span key={band} className={`rounded border px-1 py-0.5 ${heatmapCellClass(band)}`}>
          {band > 0 ? `+${band}%` : `${band}%`}
        </span>
      ))}
    </div>
  );
}
