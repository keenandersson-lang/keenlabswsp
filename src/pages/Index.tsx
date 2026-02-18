import { MarketHeader } from '@/components/MarketHeader';
import { PatternSummary } from '@/components/PatternSummary';
import { StockTable } from '@/components/StockTable';
import { demoStocks, demoMarket, getBuySignals, getSellSignals } from '@/lib/demo-data';
import { Info } from 'lucide-react';

const Index = () => {
  const buySignals = getBuySignals();
  const sellSignals = getSellSignals();

  return (
    <div className="min-h-screen bg-background">
      <MarketHeader
        market={demoMarket}
        buyCount={buySignals.length}
        sellCount={sellSignals.length}
        totalStocks={demoStocks.length}
      />

      <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        {/* Pattern overview */}
        <PatternSummary stocks={demoStocks} />

        {/* Info banner */}
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
          <Info className="h-5 w-5 text-accent flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Wall Street Protocol</span> — Screener flaggar aktier i <span className="text-signal-buy font-medium">Climbing Pattern</span> med breakout ovan resistans, pris över 50/150 MA, volym ≥2x snitt och positiv Mansfield RS. Klicka på en rad för att se detaljerade entry/exit-kriterier. <span className="italic">Demo-data visas — anslut live-API för realtidsdata.</span>
          </div>
        </div>

        {/* Stock screener table */}
        <StockTable stocks={demoStocks} />
      </main>
    </div>
  );
};

export default Index;
