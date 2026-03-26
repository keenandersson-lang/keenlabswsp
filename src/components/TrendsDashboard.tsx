import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { DiscoveryBuckets, DiscoveryMeta, TrendBucket } from '@/lib/wsp-types';
import { Flame, Zap, TrendingUp, TrendingDown } from 'lucide-react';
import { deriveStockTrustContext } from '@/lib/discovery';

const TABS: { id: TrendBucket; label: string; icon: typeof Flame; desc: string }[] = [
  { id: 'HOT', label: 'HOT', icon: Flame, desc: 'Highest-conviction WSP setups' },
  { id: 'BREAKOUT', label: 'BREAKOUT', icon: Zap, desc: 'Confirmed breakouts with volume' },
  { id: 'BULLISH', label: 'BULLISH', icon: TrendingUp, desc: 'Constructive climbing patterns' },
  { id: 'BEARISH', label: 'BEARISH', icon: TrendingDown, desc: 'Weakening or declining setups' },
];

export function TrendsDashboard({ discovery, discoveryMeta }: { discovery: DiscoveryBuckets; discoveryMeta?: DiscoveryMeta }) {
  const [active, setActive] = useState<TrendBucket>('HOT');
  const visible = discovery[active] ?? [];
  const activeTab = TABS.find(t => t.id === active)!;

  return (
    <section className="rounded border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-foreground">TREND STREAMS</h3>
        <span className="text-[8px] font-mono text-muted-foreground">
          {discoveryMeta?.trendClassificationMode === 'degraded_snapshot' ? 'DEGRADED' : 'STRICT WSP'}
        </span>
      </div>

      <div className="flex gap-1 px-3 pb-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          const count = discovery[tab.id].length;
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`flex items-center gap-1 rounded border px-2.5 py-1 text-[9px] font-mono font-semibold tracking-wider transition-all ${isActive ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="h-2.5 w-2.5" />
              {tab.label}
              <span className={`text-[8px] ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>({count})</span>
            </button>
          );
        })}
      </div>

      <div className="px-3 pb-2">
        <p className="text-[9px] font-mono text-muted-foreground">{activeTab.desc}</p>
      </div>

      <div className="border-t border-border px-3 py-2.5">
        {visible.length === 0 ? (
          <p className="rounded border border-dashed border-border bg-background/50 p-4 text-center text-[10px] font-mono text-muted-foreground">
            No candidates in {active} bucket.
          </p>
        ) : (
          <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
            {visible.slice(0, 18).map((stock) => {
              const trust = deriveStockTrustContext(stock, discoveryMeta?.dataState ?? 'LIVE');

              return (
                <Link
                  key={`${active}-${stock.symbol}`}
                  to={`/stock/${stock.symbol}`}
                  className="group rounded border border-border bg-background p-2.5 transition-all hover:border-primary/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] font-bold text-foreground">{stock.symbol}</div>
                      <div className="truncate text-[8px] font-mono text-muted-foreground">{stock.name}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`font-mono text-[10px] font-bold ${stock.changePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                        {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                      </div>
                      <div className="font-mono text-[9px] text-muted-foreground">${stock.price.toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className={`rounded px-1 py-0.5 text-[7px] font-mono font-semibold ${patternClass(stock.pattern)}`}>{stock.pattern}</span>
                    <span className={`rounded px-1 py-0.5 text-[7px] font-mono font-semibold ${recClass(stock.finalRecommendation)}`}>{stock.finalRecommendation}</span>
                    {trust.degradedQualified && (
                      <span className="rounded border border-signal-caution/20 bg-signal-caution/10 px-1 py-0.5 text-[7px] font-mono text-signal-caution">
                        DEGRADED
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
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
