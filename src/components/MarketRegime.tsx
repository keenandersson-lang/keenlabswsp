import { ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, Minus, Shield } from 'lucide-react';
import type { MarketOverview } from '@/lib/wsp-types';
import { Link } from 'react-router-dom';

interface MarketRegimeProps {
  market: MarketOverview;
}

const regimeConfig = {
  bullish: {
    label: 'BULLISH',
    icon: TrendingUp,
    colorClass: 'text-signal-buy',
    bgClass: 'bg-signal-buy/8',
    borderClass: 'border-signal-buy/25',
    guidance: 'Aggressive long setups favored. WSP breakout entries are high-probability.',
    context: 'Both benchmarks trading above rising 50MA with 50MA > 200MA.',
  },
  bearish: {
    label: 'BEARISH',
    icon: TrendingDown,
    colorClass: 'text-signal-sell',
    bgClass: 'bg-signal-sell/8',
    borderClass: 'border-signal-sell/25',
    guidance: 'Protect capital. Avoid breakout exposure. Reduce sizing.',
    context: 'Both benchmarks below key moving averages — broad weakness.',
  },
  neutral: {
    label: 'NEUTRAL',
    icon: Minus,
    colorClass: 'text-signal-caution',
    bgClass: 'bg-signal-caution/8',
    borderClass: 'border-signal-caution/25',
    guidance: 'Selective. Only highest-quality setups with strong volume.',
    context: 'Mixed signals — one index strong, other weak.',
  },
};

export function MarketRegime({ market }: MarketRegimeProps) {
  const config = regimeConfig[market.marketTrend];
  const TrendIcon = config.icon;

  return (
    <section className={`rounded border ${config.borderClass} ${config.bgClass} overflow-hidden`}>
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-8 w-8 items-center justify-center rounded border ${config.borderClass} bg-background/60`}>
            <TrendIcon className={`h-4 w-4 ${config.colorClass}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[10px] font-mono font-bold uppercase tracking-widest text-foreground">MARKET REGIME</h2>
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-mono font-bold ${config.colorClass} ${config.borderClass} bg-background/40`}>
                {config.label}
              </span>
            </div>
            <p className="text-[9px] text-muted-foreground font-mono mt-0.5 max-w-md">{config.context}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 px-4 sm:grid-cols-2">
        <BenchmarkCard label="S&P 500" symbol={market.sp500Symbol} change={market.sp500Change} price={market.sp500Price} />
        <BenchmarkCard label="NASDAQ 100" symbol={market.nasdaqSymbol} change={market.nasdaqChange} price={market.nasdaqPrice} />
      </div>

      <div className="flex items-start gap-2 px-4 py-3 mt-1">
        <Shield className={`mt-0.5 h-3 w-3 flex-shrink-0 ${config.colorClass}`} />
        <p className="text-[9px] text-muted-foreground font-mono leading-relaxed">
          <span className="font-semibold text-foreground">WSP:</span> {config.guidance}
        </p>
      </div>
    </section>
  );
}

function BenchmarkCard({ label, symbol, change, price }: { label: string; symbol: string; change: number; price: number | null }) {
  const positive = change >= 0;
  return (
    <Link
      to={`/stock/${symbol}`}
      className="group flex items-center justify-between rounded border border-border/60 bg-card/80 px-3 py-2.5 transition-all hover:border-primary/30"
    >
      <div>
        <div className="text-[8px] font-mono text-muted-foreground tracking-wider">{label} <span className="opacity-60">({symbol})</span></div>
        <div className="font-mono text-base font-bold text-foreground mt-0.5">
          {price === null ? '—' : `$${price.toFixed(2)}`}
        </div>
      </div>
      <div className={`flex items-center gap-0.5 font-mono text-sm font-bold ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
        {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
        {positive ? '+' : ''}{change.toFixed(2)}%
      </div>
    </Link>
  );
}
