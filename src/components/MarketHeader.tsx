import { TrendingUp, TrendingDown, Activity, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { MarketOverview } from '@/lib/wsp-engine';

interface MarketHeaderProps {
  market: MarketOverview;
  buyCount: number;
  sellCount: number;
  totalStocks: number;
}

export function MarketHeader({ market, buyCount, sellCount, totalStocks }: MarketHeaderProps) {
  return (
    <div className="border-b border-border bg-card/50 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 py-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">WSP Screener</h1>
              <p className="text-xs text-muted-foreground">Wall Street Protocol • Senast uppdaterad {market.lastUpdated}</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Market indices */}
            <div className="flex items-center gap-4">
              <IndexChip label="S&P 500" change={market.sp500Change} />
              <IndexChip label="NASDAQ" change={market.nasdaqChange} />
            </div>

            <div className="h-8 w-px bg-border" />

            {/* Signal summary */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-signal-buy animate-pulse-subtle" />
                <span className="font-mono text-sm text-signal-buy font-semibold">{buyCount}</span>
                <span className="text-xs text-muted-foreground">KÖP</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-signal-sell" />
                <span className="font-mono text-sm text-signal-sell font-semibold">{sellCount}</span>
                <span className="text-xs text-muted-foreground">SÄLJ</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-sm text-muted-foreground">{totalStocks}</span>
                <span className="text-xs text-muted-foreground">totalt</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IndexChip({ label, change }: { label: string; change: number }) {
  const positive = change >= 0;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className={`flex items-center gap-0.5 font-mono text-sm font-medium ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
        {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
        {positive ? '+' : ''}{change.toFixed(2)}%
      </div>
    </div>
  );
}
