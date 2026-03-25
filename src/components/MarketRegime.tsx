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
    guidance: 'Aggressive long setups favored. WSP breakout entries are high-probability in this environment.',
    context: 'Both S&P 500 and Nasdaq 100 trading above rising 50-day moving averages with 50MA > 200MA.',
  },
  bearish: {
    label: 'BEARISH',
    icon: TrendingDown,
    colorClass: 'text-signal-sell',
    bgClass: 'bg-signal-sell/8',
    borderClass: 'border-signal-sell/25',
    guidance: 'Protect capital. Avoid aggressive breakout exposure. Reduce position sizing.',
    context: 'Both S&P 500 and Nasdaq 100 below key moving averages — indicating broad market weakness.',
  },
  neutral: {
    label: 'NEUTRAL',
    icon: Minus,
    colorClass: 'text-signal-caution',
    bgClass: 'bg-signal-caution/8',
    borderClass: 'border-signal-caution/25',
    guidance: 'Selective approach required. Prioritize only the highest-quality setups with strong volume confirmation.',
    context: 'Mixed signals — one major index showing strength while the other signals weakness.',
  },
};

export function MarketRegime({ market }: MarketRegimeProps) {
  const config = regimeConfig[market.marketTrend];
  const TrendIcon = config.icon;

  return (
    <section className={`rounded-xl border ${config.borderClass} ${config.bgClass} overflow-hidden`}>
      {/* Regime header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg border ${config.borderClass} bg-background/60`}>
            <TrendIcon className={`h-5 w-5 ${config.colorClass}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Market Regime</h2>
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${config.colorClass} ${config.borderClass} bg-background/40`}>
                {config.label}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 max-w-lg">{config.context}</p>
          </div>
        </div>
      </div>

      {/* Benchmark cards */}
      <div className="grid grid-cols-1 gap-3 px-5 sm:grid-cols-2">
        <BenchmarkCard label="S&P 500" symbol={market.sp500Symbol} change={market.sp500Change} price={market.sp500Price} />
        <BenchmarkCard label="Nasdaq 100" symbol={market.nasdaqSymbol} change={market.nasdaqChange} price={market.nasdaqPrice} />
      </div>

      {/* Strategy guidance */}
      <div className="flex items-start gap-2 px-5 py-4 mt-2">
        <Shield className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${config.colorClass}`} />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">WSP strategy context:</span> {config.guidance}
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
      className="group flex items-center justify-between rounded-lg border border-border/60 bg-card/80 px-4 py-3 transition-all hover:border-primary/30 hover:bg-card"
    >
      <div>
        <div className="text-[11px] text-muted-foreground">{label} <span className="font-mono opacity-60">({symbol})</span></div>
        <div className="font-mono text-lg font-semibold text-foreground mt-0.5">
          {price === null ? '—' : `$${price.toFixed(2)}`}
        </div>
      </div>
      <div className={`flex items-center gap-1 font-mono text-base font-bold ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
        {positive ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
        {positive ? '+' : ''}{change.toFixed(2)}%
      </div>
    </Link>
  );
}
