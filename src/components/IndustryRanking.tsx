import { useState } from 'react';
import { ArrowUpRight, ArrowDownRight, ChevronRight, Scan, TrendingUp } from 'lucide-react';
import { sectorData, getSectorAvgChange, type SectorData } from '@/lib/sector-data';
import { PremiumScanCTA } from './PremiumScanCTA';

interface IndustryRankingProps {
  activeSector: string | null;
  onScanIndustry?: (industry: string) => void;
}

export function IndustryRanking({ activeSector, onScanIndustry }: IndustryRankingProps) {
  const [expandedIndustry, setExpandedIndustry] = useState<string | null>(null);

  const sector = sectorData.find(s => s.name === activeSector);
  if (!sector) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <TrendingUp className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">Välj en sektor ovan för att se industri-ranking</p>
      </div>
    );
  }

  const sorted = [...sector.industries].sort((a, b) => b.changePercent - a.changePercent);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Industrier — {sector.name}
        </h3>
        <span className="text-xs text-muted-foreground">{sorted.length} industrier</span>
      </div>

      <div className="space-y-1.5">
        {sorted.map((ind, idx) => {
          const positive = ind.changePercent >= 0;
          const isExpanded = expandedIndustry === ind.symbol;
          const isTop3 = idx < 3;

          return (
            <div key={ind.symbol}>
              <button
                onClick={() => setExpandedIndustry(isExpanded ? null : ind.symbol)}
                className={`w-full flex items-center justify-between rounded-lg border p-3 text-left transition-all hover:border-primary/30 ${
                  isTop3 ? 'border-signal-buy/20 bg-signal-buy/5' : 'border-border bg-card'
                } ${isExpanded ? 'border-primary/40' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold ${
                    isTop3 ? 'bg-signal-buy/20 text-signal-buy' : 'bg-muted text-muted-foreground'
                  }`}>
                    {idx + 1}
                  </span>
                  <div>
                    <span className="text-xs font-medium text-foreground">{ind.name}</span>
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">{ind.symbol}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`font-mono text-xs font-semibold ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
                    {positive ? '+' : ''}{ind.changePercent.toFixed(2)}%
                  </span>
                  <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </div>
              </button>

              {isExpanded && (
                <div className="mt-1 ml-9 space-y-2 animate-in slide-in-from-top-2 duration-150">
                  <div className="rounded-lg border border-border bg-card/50 p-3">
                    <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Pris</span>
                        <span className="font-mono text-foreground">{ind.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Förändring</span>
                        <span className={`font-mono font-medium ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
                          {positive ? '+' : ''}{ind.change.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <PremiumScanCTA
                      industryName={ind.name}
                      onScanTriggered={() => onScanIndustry?.(ind.name)}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
