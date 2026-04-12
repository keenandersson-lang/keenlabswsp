import { useMemo, useState } from 'react';
import type { EvaluatedStock, ScreenerTrustContract, SectorStatus } from '@/lib/wsp-types';
import { buildSectorHeatmap } from '@/lib/discovery';
import { AlertTriangle } from 'lucide-react';
import { heatmapCellClass } from '@/lib/heatmap-scale';

type HeatmapColorMode = 'dailyChange' | 'sectorRS';

/** Scale mansfield RS value (~-0.15 to +0.15) into heatmap-compatible range (-3 to +3) */
function rsToHeatValue(rs: number | null | undefined): number {
  if (rs == null || !Number.isFinite(rs)) return 0;
  // Mansfield RS values typically range -0.2 to +0.2; scale ×20 to map into -4..+4 band
  return rs * 20;
}

interface MarketHeatmapProps {
  stocks: EvaluatedStock[];
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
  trust,
  activeSector,
  activeIndustry,
  onSectorSelect,
  onIndustrySelect,
  onStockSelect,
  degradedMessage,
}: MarketHeatmapProps) {
  const [colorMode, setColorMode] = useState<HeatmapColorMode>('dailyChange');
  const sectors = useMemo(() => buildSectorHeatmap(stocks, sectorStatuses, trust.uiState), [stocks, sectorStatuses, trust.uiState]);

  if (sectors.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded border border-border bg-card p-4 text-[10px] text-muted-foreground font-mono">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-signal-caution" />
        <span>{degradedMessage ?? 'Heatmap unavailable — waiting for data.'}</span>
      </div>
    );
  }

  const totalStockCount = sectors.reduce((sum, s) => sum + s.stocks.length, 0);

  const getStockHeatValue = (stock: EvaluatedStock): number => {
    if (colorMode === 'sectorRS') return rsToHeatValue(stock.audit?.mansfieldSectorValue);
    return stock.changePercent;
  };

  const getSectorHeatValue = (sector: typeof sectors[0]): number => {
    if (colorMode === 'sectorRS') {
      const rsValues = sector.stocks
        .map((s) => s.audit?.mansfieldSectorValue)
        .filter((v): v is number => v != null && Number.isFinite(v));
      if (rsValues.length === 0) return 0;
      return rsToHeatValue(rsValues.reduce((a, b) => a + b, 0) / rsValues.length);
    }
    return sector.avgChange;
  };

  const formatValue = (value: number): string => {
    if (colorMode === 'sectorRS') {
      return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
    }
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const getStockDisplayValue = (stock: EvaluatedStock): string => {
    if (colorMode === 'sectorRS') {
      const v = stock.audit?.mansfieldSectorValue;
      if (v == null) return 'N/A';
      return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
    }
    return `${stock.changePercent >= 0 ? '+' : ''}${stock.changePercent.toFixed(1)}%`;
  };

  const getSectorDisplayValue = (sector: typeof sectors[0]): string => {
    if (colorMode === 'sectorRS') {
      const rsValues = sector.stocks
        .map((s) => s.audit?.mansfieldSectorValue)
        .filter((v): v is number => v != null && Number.isFinite(v));
      if (rsValues.length === 0) return 'N/A';
      const avg = rsValues.reduce((a, b) => a + b, 0) / rsValues.length;
      return `${avg >= 0 ? '+' : ''}${avg.toFixed(3)}`;
    }
    return `${sector.avgChange >= 0 ? '+' : ''}${sector.avgChange.toFixed(2)}%`;
  };

  const heatmapTrustScore = (stock: EvaluatedStock): number => {
    const taxonomyQuality = stock.industry !== 'Unknown' && stock.industry !== 'Other' ? 10 : -12;
    const breakoutQuality = stock.audit.breakoutQualityPass ? 15 : 0;
    const rsStrength = Math.max(-10, Math.min(20, (stock.audit.mansfieldValue ?? 0) * 10));
    const liquidity = Math.max(0, Math.min(18, (stock.audit.volumeMultiple ?? 0) * 6));
    const setupQuality = stock.isValidWspEntry ? 12 : 0;
    const supportQuality = stock.supportsFullWsp ? 8 : -6;
    const blockerPenalty = stock.blockedReasons.length * 3;

    return (stock.score ?? 0) + taxonomyQuality + breakoutQuality + rsStrength + liquidity + setupQuality + supportQuality - blockerPenalty;
  };

  return (
    <section className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-foreground">MARKET HEATMAP</h3>
          <span className="text-[8px] font-mono text-muted-foreground">{sectors.length} GICS-sektorer · {totalStockCount} aktier med sektordata</span>
        </div>
        <div className="flex items-center gap-1.5">
          <HeatmapModeToggle mode={colorMode} onChange={setColorMode} />
          <HeatmapLegend mode={colorMode} />
        </div>
      </div>

      {degradedMessage && (
        <div className="flex items-center gap-2 rounded border border-signal-caution/20 bg-signal-caution/5 px-2 py-1 text-[9px] font-mono text-signal-caution">
          <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0" />
          {degradedMessage}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
        {sectors.map((sector) => {
          const sectorActive = activeSector === sector.sector;
          const sectorHeatVal = getSectorHeatValue(sector);
          const topStocks = [...sector.stocks]
            .sort((a, b) => {
              const trustDelta = heatmapTrustScore(b) - heatmapTrustScore(a);
              if (trustDelta !== 0) return trustDelta;
              if (colorMode === 'sectorRS') {
                return (b.audit?.mansfieldSectorValue ?? -Infinity) - (a.audit?.mansfieldSectorValue ?? -Infinity);
              }
              return (b.score - a.score) || (b.changePercent - a.changePercent);
            })
            .slice(0, 5);

          return (
            <article
              key={sector.sector}
              className={`rounded border p-1.5 ${heatmapCellClass(sectorHeatVal)} ${sectorActive ? 'ring-1 ring-primary/50 ring-offset-1 ring-offset-background' : ''}`}
            >
              <button className="mb-1 flex w-full items-center justify-between gap-1" onClick={() => onSectorSelect(sector.sector)}>
                <span className="text-[9px] font-mono font-bold text-foreground truncate">{sector.sector}</span>
                <span className={`font-mono text-[9px] font-semibold flex-shrink-0 ${sectorHeatVal >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
                  {getSectorDisplayValue(sector)}
                </span>
              </button>

              <div className="space-y-0.5">
                {topStocks.length === 0 && (
                  <div className="rounded border border-dashed border-border/60 px-1 py-1 text-[8px] font-mono text-muted-foreground">
                    No stocks in scan for this sector.
                  </div>
                )}

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
                        title={`${stock.symbol} ${getStockDisplayValue(stock)} · ${stock.supportsFullWsp ? 'Full WSP' : 'Limited'}`}
                      >
                        <span className="text-[8px] font-mono font-bold text-foreground">{stock.symbol}</span>
                        <span className={`text-[7px] font-mono ml-0.5 ${stockHeatVal >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
                          {getStockDisplayValue(stock)}
                        </span>
                      </button>
                    );
                  })}
                </div>
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
      <button
        onClick={() => onChange('dailyChange')}
        className={`px-1.5 py-0.5 rounded-l transition-colors ${mode === 'dailyChange' ? 'bg-primary/20 text-primary font-bold' : 'text-muted-foreground hover:text-foreground'}`}
      >
        1D %
      </button>
      <button
        onClick={() => onChange('sectorRS')}
        className={`px-1.5 py-0.5 rounded-r transition-colors ${mode === 'sectorRS' ? 'bg-primary/20 text-primary font-bold' : 'text-muted-foreground hover:text-foreground'}`}
      >
        RS vs Sektor
      </button>
    </div>
  );
}

function HeatmapLegend({ mode }: { mode: HeatmapColorMode }) {
  const bands = [-3, -2, -1, 0, 1, 2, 3];
  const labelFn = (band: number) => {
    if (mode === 'sectorRS') {
      const rsVal = band * 0.05;
      return rsVal > 0 ? `+${rsVal.toFixed(2)}` : rsVal.toFixed(2);
    }
    return band > 0 ? `+${band}%` : `${band}%`;
  };

  return (
    <div className="flex items-center gap-1 text-[8px] font-mono text-muted-foreground">
      {bands.map((band) => (
        <span key={band} className={`rounded border px-1 py-0.5 ${heatmapCellClass(band)}`}>
          {labelFn(band)}
        </span>
      ))}
    </div>
  );
}
