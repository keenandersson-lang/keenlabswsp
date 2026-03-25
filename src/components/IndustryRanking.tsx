import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { EvaluatedStock } from '@/lib/wsp-types';
import { buildIndustryHeatmap } from '@/lib/discovery';
import { PremiumScanCTA } from './PremiumScanCTA';
import { ChevronRight, Zap } from 'lucide-react';

interface IndustryRankingProps {
  stocks: EvaluatedStock[];
  activeSector: string | null;
  activeIndustry: string | null;
  onIndustrySelect: (industry: string) => void;
}

export function IndustryRanking({ stocks, activeSector, activeIndustry, onIndustrySelect }: IndustryRankingProps) {
  const industries = useMemo(() => activeSector ? buildIndustryHeatmap(stocks, activeSector) : [], [stocks, activeSector]);

  if (!activeSector) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
        <ChevronRight className="h-5 w-5 text-muted-foreground mb-2" />
        <p className="text-xs text-muted-foreground">Select a sector to explore its industries</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Industries — {activeSector}</h3>
        <span className="text-[10px] text-muted-foreground">{industries.length} groups</span>
      </div>

      {industries.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">No active industry coverage in this sector.</div>
      ) : industries.map((industry, idx) => {
        const isActive = activeIndustry === industry.industry;
        return (
          <div key={industry.industry} className={`rounded-lg border transition-all ${isActive ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'}`}>
            <button className="w-full text-left p-3" onClick={() => onIndustrySelect(industry.industry)}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-muted text-[9px] font-bold text-muted-foreground">{idx + 1}</span>
                  <div>
                    <div className="text-xs font-semibold text-foreground">{industry.industry}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {industry.stocks.length} stocks
                      {industry.breakoutCount > 0 && <> · <span className="text-signal-buy">{industry.breakoutCount} breakout-ready</span></>}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-mono text-xs font-semibold ${industry.avgChange >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                    {industry.avgChange >= 0 ? '+' : ''}{industry.avgChange.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-muted-foreground">str. {industry.strengthScore.toFixed(1)}</div>
                </div>
              </div>
            </button>

            {isActive && (
              <div className="border-t border-border px-3 pb-3 pt-2 space-y-2">
                <div className="grid gap-1">
                  {industry.stocks.slice(0, 6).map((stock) => (
                    <Link
                      key={stock.symbol}
                      to={`/stock/${stock.symbol}`}
                      className="flex items-center justify-between rounded border border-border bg-background px-2.5 py-1.5 text-xs transition-colors hover:border-primary/30"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-foreground">{stock.symbol}</span>
                        <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{stock.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-[10px] ${stock.changePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                          {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(1)}%
                        </span>
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${recClass(stock.finalRecommendation)}`}>
                          {stock.finalRecommendation}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
                {industry.stocks.length > 6 && (
                  <p className="text-[10px] text-muted-foreground text-center">+{industry.stocks.length - 6} more stocks</p>
                )}
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
