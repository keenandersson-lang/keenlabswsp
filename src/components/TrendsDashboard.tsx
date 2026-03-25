import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DiscoveryBuckets, TrendBucket } from '@/lib/wsp-types';
import { Flame, Zap, TrendingUp, TrendingDown } from 'lucide-react';

const TABS: { id: TrendBucket; label: string; icon: typeof Flame; desc: string }[] = [
  { id: 'HOT', label: 'Hot', icon: Flame, desc: 'Highest-conviction WSP setups' },
  { id: 'BREAKOUT', label: 'Breakout', icon: Zap, desc: 'Confirmed breakouts with volume' },
  { id: 'BULLISH', label: 'Bullish', icon: TrendingUp, desc: 'Constructive climbing patterns' },
  { id: 'BEARISH', label: 'Bearish', icon: TrendingDown, desc: 'Weakening or declining setups' },
];

export function TrendsDashboard({ discovery }: { discovery: DiscoveryBuckets }) {
  const [active, setActive] = useState<TrendBucket>('HOT');
  const visible = discovery[active] ?? [];
  const activeTab = TABS.find(t => t.id === active)!;

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Trend Streams</h3>
        <span className="text-[10px] text-muted-foreground">WSP opportunity classification</span>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-4 pb-3">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          const count = discovery[tab.id].length;
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${isActive ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/20'}`}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
              <span className={`font-mono text-[10px] ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>({count})</span>
            </button>
          );
        })}
      </div>

      {/* Description */}
      <div className="px-4 pb-3">
        <p className="text-[11px] text-muted-foreground">{activeTab.desc}</p>
      </div>

      {/* Content */}
      <div className="border-t border-border px-4 py-3">
        {visible.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-background/50 p-4 text-center text-xs text-muted-foreground">
            No candidates in {active} bucket for the current snapshot.
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {visible.slice(0, 18).map((stock) => (
              <Link
                key={`${active}-${stock.symbol}`}
                to={`/stock/${stock.symbol}`}
                className="group rounded-lg border border-border bg-background p-3 transition-all hover:border-primary/30 hover:bg-card"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-semibold text-foreground">{stock.symbol}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{stock.name}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`font-mono text-xs font-semibold ${stock.changePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                      {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">${stock.price.toFixed(2)}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${patternClass(stock.pattern)}`}>{stock.pattern}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${recClass(stock.finalRecommendation)}`}>{stock.finalRecommendation}</span>
                  {stock.audit.breakoutValid && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-accent border border-accent/20">Breakout</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function patternClass(pattern: string): string {
  switch (pattern) {
    case 'CLIMBING': return 'bg-signal-climbing/10 text-signal-climbing border border-signal-climbing/20';
    case 'BASE': return 'bg-signal-base/10 text-signal-base border border-signal-base/20';
    case 'TIRED': return 'bg-signal-tired/10 text-signal-tired border border-signal-tired/20';
    case 'DOWNHILL': return 'bg-signal-downhill/10 text-signal-downhill border border-signal-downhill/20';
    default: return 'bg-muted text-muted-foreground border border-border';
  }
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
