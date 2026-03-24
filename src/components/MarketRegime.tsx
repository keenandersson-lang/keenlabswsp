import { ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { MarketOverview } from '@/lib/wsp-types';

interface MarketRegimeProps {
  market: MarketOverview;
}

export function MarketRegime({ market }: MarketRegimeProps) {
  const trendConfig = {
    bullish: { label: 'BULLISH', icon: TrendingUp, colorClass: 'text-signal-buy', bgClass: 'bg-signal-buy/10', borderClass: 'border-signal-buy/30', desc: 'SPY & QQQ ovan 50MA, 50MA > 200MA' },
    bearish: { label: 'BEARISH', icon: TrendingDown, colorClass: 'text-signal-sell', bgClass: 'bg-signal-sell/10', borderClass: 'border-signal-sell/30', desc: 'Både SPY och QQQ under viktiga glidande medelvärden' },
    neutral: { label: 'NEUTRAL', icon: Minus, colorClass: 'text-signal-caution', bgClass: 'bg-signal-caution/10', borderClass: 'border-signal-caution/30', desc: 'Blandade signaler — en av indexen visar svaghet' },
  };

  const t = trendConfig[market.marketTrend];
  const TrendIcon = t.icon;

  return (
    <div className={`rounded-xl border ${t.borderClass} ${t.bgClass} p-5`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${t.bgClass} border ${t.borderClass}`}>
            <TrendIcon className={`h-5 w-5 ${t.colorClass}`} />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Marknadsregim</h2>
            <p className="text-[10px] text-muted-foreground">{t.desc}</p>
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${t.colorClass} ${t.bgClass} ${t.borderClass}`}>
          {t.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <IndexCard label="S&P 500" symbol="SPY" change={market.sp500Change} />
        <IndexCard label="NASDAQ 100" symbol="QQQ" change={market.nasdaqChange} />
      </div>

      <p className="mt-3 text-[10px] text-muted-foreground">
        WSP strategy context: aggressive long setups are favored only in <span className="text-signal-buy font-medium">BULLISH</span> regime.
        {market.marketTrend === 'neutral' && <span className="text-signal-caution"> Neutral tape: prioritize selective, higher-quality setups.</span>}
        {market.marketTrend === 'bearish' && <span className="text-signal-sell"> Bearish tape: protect capital and avoid aggressive breakout exposure.</span>}
      </p>
    </div>
  );
}

function IndexCard({ label, symbol, change }: { label: string; symbol: string; change: number }) {
  const positive = change >= 0;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">({symbol})</span>
        </div>
        <div className={`flex items-center gap-0.5 font-mono text-sm font-semibold ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
          {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {positive ? '+' : ''}{change.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}
