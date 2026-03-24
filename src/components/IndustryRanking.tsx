import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { EvaluatedStock } from '@/lib/wsp-types';
import { buildIndustryHeatmap } from '@/lib/discovery';
import { PremiumScanCTA } from './PremiumScanCTA';

interface IndustryRankingProps {
  stocks: EvaluatedStock[];
  activeSector: string | null;
  activeIndustry: string | null;
  onIndustrySelect: (industry: string) => void;
}

export function IndustryRanking({ stocks, activeSector, activeIndustry, onIndustrySelect }: IndustryRankingProps) {
  const industries = useMemo(() => activeSector ? buildIndustryHeatmap(stocks, activeSector) : [], [stocks, activeSector]);

  if (!activeSector) {
    return <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">Select a sector in the heatmap to unlock industry discovery.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Industries — {activeSector}</h3>
        <span className="text-xs text-muted-foreground">Free discovery layer</span>
      </div>

      {industries.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">No industries with active coverage in this sector.</div>
      ) : industries.map((industry, idx) => {
        const isActive = activeIndustry === industry.industry;
        return (
          <div key={industry.industry} className={`rounded-lg border p-3 ${isActive ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'}`}>
            <button className="w-full text-left" onClick={() => onIndustrySelect(industry.industry)}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-foreground">#{idx + 1} {industry.industry}</div>
                  <div className="text-[10px] text-muted-foreground">{industry.stocks.length} stocks · {industry.breakoutCount} breakout-ready</div>
                </div>
                <div className={`font-mono text-xs font-semibold ${industry.avgChange >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>{industry.avgChange >= 0 ? '+' : ''}{industry.avgChange.toFixed(2)}%</div>
              </div>
            </button>
            {isActive && (
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                <div className="grid gap-1.5">
                  {industry.stocks.slice(0, 6).map((stock) => (
                    <Link key={stock.symbol} to={`/stock/${stock.symbol}`} className="flex items-center justify-between rounded border border-border bg-background px-2.5 py-1.5 text-xs hover:border-primary/40">
                      <span className="font-mono text-foreground">{stock.symbol}</span>
                      <span className="text-muted-foreground">{stock.finalRecommendation}</span>
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
