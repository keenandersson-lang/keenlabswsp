import { MarketHeader } from '@/components/MarketHeader';
import { PatternSummary } from '@/components/PatternSummary';
import { StockTable } from '@/components/StockTable';
import { SectorAnalysis } from '@/components/SectorAnalysis';
import { DebugPanel } from '@/components/DebugPanel';
import { demoStocks, demoMarket } from '@/lib/demo-data';
import { Info } from 'lucide-react';

const Index = () => {
  const buyCount = demoStocks.filter(s => s.recommendation === 'KÖP').length;
  const sellCount = demoStocks.filter(s => s.recommendation === 'SÄLJ').length;
  const watchCount = demoStocks.filter(s => s.recommendation === 'BEVAKA').length;
  const avoidCount = demoStocks.filter(s => s.recommendation === 'UNDVIK').length;

  return (
    <div className="min-h-screen bg-background">
      <MarketHeader
        market={demoMarket}
        buyCount={buyCount}
        sellCount={sellCount}
        watchCount={watchCount}
        avoidCount={avoidCount}
        totalStocks={demoStocks.length}
      />

      <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        <PatternSummary stocks={demoStocks} />

        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
          <Info className="h-5 w-5 text-accent flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Wall Street Protocol — Strict Rules Engine</span> — Screener med 3-lagers logik: <span className="text-accent">Mönster</span> (chart-struktur) → <span className="text-accent">Entry Gate</span> (hårda regler) → <span className="text-accent">Rekommendation</span> (KÖP/BEVAKA/SÄLJ/UNDVIK). En aktie kan vara i CLIMBING utan att vara KÖP. <span className="font-bold text-signal-buy">KÖP</span> kräver att ALLA gate-regler passerar. Klicka på en rad för fullständig regelanalys. <span className="italic text-signal-caution">Demo-data visas — anslut live-API för realtidsberäkningar.</span>
          </div>
        </div>

        <DebugPanel
          stocks={demoStocks}
          dataSource={demoMarket.dataSource}
          lastUpdated={demoMarket.lastUpdated}
        />

        <SectorAnalysis />

        <StockTable stocks={demoStocks} />
      </main>
    </div>
  );
};

export default Index;
