import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { EvaluatedStock, ScreenerUiState } from '@/lib/wsp-types';
import { buildIndustryHeatmap } from '@/lib/discovery';
import { PremiumScanCTA } from './PremiumScanCTA';
import { ChevronRight } from 'lucide-react';

interface IndustryRankingProps {
  stocks: EvaluatedStock[];
  activeSector: string | null;
  activeIndustry: string | null;
  uiState: ScreenerUiState;
  onIndustrySelect: (industry: string) => void;
}

export function IndustryRanking({ stocks, activeSector, activeIndustry, uiState, onIndustrySelect }: IndustryRankingProps) {
  const industries = useMemo(() => activeSector ? buildIndustryHeatmap(stocks, activeSector, uiState) : [], [stocks, activeSector, uiState]);

  if (!activeSector) {
    return (
      <div className="flex flex-col items-center justify-center rounded border border-dashed border-border bg-card/50 p-6 text-center">
        <ChevronRight className="h-4 w-4 text-muted-foreground mb-1.5" />
        <p className="text-[10px] text-muted-foreground font-mono">Select a sector to explore industries</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-foreground">INDUSTRIES — {activeSector}</h3>
        <span className="text-[8px] font-mono text-muted-foreground">{industries.length} groups</span>
      </div>

      {industries.length === 0 ? (
        <div className="rounded border border-border bg-card p-3 text-[10px] text-muted-foreground font-mono">No industry coverage in this sector.</div>
      ) : industries.map((industry, idx) => {
        const isActive = activeIndustry === industry.industry;
        return (
          <div key={industry.industry} className={`rounded border transition-all ${isActive ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'}`}>
            <button className="w-full text-left p-2.5" onClick={() => onIndustrySelect(industry.industry)}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-muted text-[8px] font-mono font-bold text-muted-foreground">{idx + 1}</span>
                  <div>
                    <div className="text-[10px] font-mono font-semibold text-foreground">{industry.industry}</div>
                    <div className="text-[8px] font-mono text-muted-foreground">
                      {industry.stocks.length} stk
                      {industry.breakoutCount > 0 && <> · <span className="text-signal-buy">{industry.breakoutCount} BO</span></>}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] font-bold text-foreground">S{industry.displayValue.toFixed(1)}</div>
                  {industry.confidence !== 'high' && <div className="text-[8px] font-mono text-signal-caution">Limited</div>}
                </div>
              </div>
            </button>

            {isActive && (
              <div className="border-t border-border px-2.5 pb-2.5 pt-1.5 space-y-1.5">
                <div className="grid gap-1">
                  {industry.stocks.map((stock) => (
                    <Link
                      key={stock.symbol}
                      to={`/stock/${stock.symbol}`}
                      className="flex items-center justify-between rounded border border-border bg-background px-2 py-1.5 text-[10px] font-mono transition-colors hover:border-primary/30"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-foreground">{stock.symbol}</span>
                        <span className="text-[9px] text-muted-foreground truncate max-w-[100px]">{stock.name}</span>
                        <span className={`rounded px-1 py-0.5 text-[7px] font-semibold ${stock.supportsFullWsp ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'bg-amber-500/15 text-amber-300 border border-amber-500/20'}`}>{stock.supportsFullWsp ? 'Full WSP' : 'Limited'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[9px] ${stock.changePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                          {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(1)}%
                        </span>
                        <span className={`rounded px-1 py-0.5 text-[8px] font-semibold ${recClass(stock.finalRecommendation)}`}>
                          {stock.finalRecommendation}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
                <PremiumScanCTA industryName={industry.industry} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function recClass(rec: string): string {
  switch (rec) {
    case 'KÖP': return 'bg-signal-buy/15 text-signal-buy border border-signal-buy/20';
    case 'BEVAKA': return 'bg-accent/15 text-accent border border-accent/20';
    case 'SÄLJ': return 'bg-signal-caution/15 text-signal-caution border border-signal-caution/20';
    case 'UNDVIK': return 'bg-signal-sell/15 text-signal-sell border border-signal-sell/20';
    default: return 'bg-muted text-muted-foreground border border-border';
  }
}
