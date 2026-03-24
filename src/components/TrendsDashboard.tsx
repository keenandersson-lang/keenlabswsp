import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EvaluatedStock } from '@/lib/wsp-types';
import { buildTrendBuckets, type TrendBucket } from '@/lib/discovery';

const TABS: TrendBucket[] = ['HOT', 'BREAKOUT', 'BULLISH', 'BEARISH'];

export function TrendsDashboard({ stocks }: { stocks: EvaluatedStock[] }) {
  const [active, setActive] = useState<TrendBucket>('HOT');
  const buckets = useMemo(() => buildTrendBuckets(stocks), [stocks]);
  const visible = buckets[active] ?? [];

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Trends dashboard</h3>
        <span className="text-xs text-muted-foreground">Top-down opportunity streams</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${active === tab ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`}
          >
            {tab} ({buckets[tab].length})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">No candidates in this trend bucket for the current snapshot.</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {visible.slice(0, 18).map((stock) => (
            <Link
              key={`${active}-${stock.symbol}`}
              to={`/stock/${stock.symbol}`}
              className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-sm font-semibold text-foreground">{stock.symbol}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{stock.name}</div>
                </div>
                <span className={`font-mono text-xs ${stock.changePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                  {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                </span>
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                <span className="text-foreground">${stock.price.toFixed(2)}</span> · {stock.pattern} · {stock.finalRecommendation}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
