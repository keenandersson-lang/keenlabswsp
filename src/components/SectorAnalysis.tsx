import { useState } from 'react';
import {
  sectorData,
  getSectorChartUrl,
  getIndustryChangeForTimeframe,
  getSectorAvgChangeForTimeframe,
  type SectorData,
  type SectorTimeframe,
} from '@/lib/sector-data';
import { ArrowUpRight, ArrowDownRight, ChevronDown, ChevronRight, BarChart3, ExternalLink } from 'lucide-react';

const timeframes: { value: SectorTimeframe; label: string }[] = [
  { value: 'eod', label: 'Daglig' },
  { value: '1w', label: '1V' },
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Å' },
];

function SectorCard({ sector, timeframe }: { sector: SectorData; timeframe: SectorTimeframe }) {
  const [expanded, setExpanded] = useState(false);
  const avgChange = getSectorAvgChangeForTimeframe(sector, timeframe);
  const positive = avgChange >= 0;
  const bestIndustry = [...sector.industries].sort(
    (a, b) => getIndustryChangeForTimeframe(b, timeframe) - getIndustryChangeForTimeframe(a, timeframe),
  )[0];
  const worstIndustry = [...sector.industries].sort(
    (a, b) => getIndustryChangeForTimeframe(a, timeframe) - getIndustryChangeForTimeframe(b, timeframe),
  )[0];

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden transition-all">
      {/* Sector header with chart */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <h3 className="font-semibold text-sm">{sector.name}</h3>
            <span className="text-xs text-muted-foreground">({sector.industries.length})</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`flex items-center gap-0.5 font-mono text-xs font-semibold ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
              {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {positive ? '+' : ''}{avgChange.toFixed(2)}%
            </span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="animate-in slide-in-from-top-2 duration-200">
          {/* Live chart image from StockCharts */}
          <div className="p-3 border-b border-border/50 bg-background/50">
            <div className="relative rounded-md overflow-hidden border border-border/30">
              <img
                src={getSectorChartUrl(sector.chartSymbol, timeframe)}
                alt={`${sector.name} chart`}
                className="w-full h-auto"
                loading="lazy"
              />
              <a
                href={`https://stockcharts.com/acp/?s=${sector.chartSymbol}`}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute top-2 right-2 flex items-center gap-1 rounded bg-background/80 backdrop-blur-sm px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors border border-border/50"
              >
                StockCharts <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground text-center">
              20/50/200 SMA • {sector.chartSymbol} • Källa: StockCharts.com
            </p>
          </div>

          {/* Best/Worst quick view */}
          <div className="grid grid-cols-2 gap-px bg-border/30">
            <div className="bg-card px-3 py-2">
              <span className="text-[10px] text-muted-foreground block">Bästa industri</span>
              <span className="text-xs font-medium text-signal-buy">{bestIndustry.name}</span>
              <span className="text-[10px] font-mono text-signal-buy ml-1">
                {getIndustryChangeForTimeframe(bestIndustry, timeframe) >= 0 ? '+' : ''}
                {getIndustryChangeForTimeframe(bestIndustry, timeframe).toFixed(2)}%
              </span>
            </div>
            <div className="bg-card px-3 py-2">
              <span className="text-[10px] text-muted-foreground block">Sämsta industri</span>
              <span className="text-xs font-medium text-signal-sell">{worstIndustry.name}</span>
              <span className="text-[10px] font-mono text-signal-sell ml-1">
                {getIndustryChangeForTimeframe(worstIndustry, timeframe).toFixed(2)}%
              </span>
            </div>
          </div>

          {/* Industry table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left">Symbol</th>
                  <th className="px-3 py-2 text-left">Industri</th>
                  <th className="px-3 py-2 text-right">Pris</th>
                  <th className="px-3 py-2 text-right">Förändring</th>
                </tr>
              </thead>
              <tbody>
                {[...sector.industries]
                  .sort((a, b) => getIndustryChangeForTimeframe(b, timeframe) - getIndustryChangeForTimeframe(a, timeframe))
                  .map(ind => (
                    <tr key={ind.symbol} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-1.5">
                        <a
                          href={`https://stockcharts.com/acp/?s=${ind.symbol}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-accent hover:underline"
                        >
                          {ind.symbol}
                        </a>
                      </td>
                      <td className="px-3 py-1.5 text-foreground">{ind.name}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                        {ind.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <span className={`font-mono font-medium ${getIndustryChangeForTimeframe(ind, timeframe) >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                          {getIndustryChangeForTimeframe(ind, timeframe) >= 0 ? '+' : ''}
                          {getIndustryChangeForTimeframe(ind, timeframe).toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function SectorAnalysis() {
  const [timeframe, setTimeframe] = useState<SectorTimeframe>('eod');

  // Sort sectors by avg performance
  const sortedSectors = [...sectorData].sort(
    (a, b) => getSectorAvgChangeForTimeframe(b, timeframe) - getSectorAvgChangeForTimeframe(a, timeframe),
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-accent" />
          <h2 className="text-sm font-bold uppercase tracking-wider">Sektoranalys — US Industries</h2>
          <span className="text-[10px] text-muted-foreground">(StockCharts)</span>
        </div>
        <div className="flex items-center gap-1">
          {timeframes.map(tf => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                timeframe === tf.value
                  ? 'bg-accent/20 text-accent border border-accent/30'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sector heatmap bar */}
      <div className="mb-4 flex gap-1 overflow-x-auto pb-1">
        {sortedSectors.map(sector => {
          const avg = getSectorAvgChangeForTimeframe(sector, timeframe);
          const positive = avg >= 0;
          return (
            <div
              key={sector.name}
              className={`flex-shrink-0 rounded-md border px-2.5 py-1.5 text-center ${
                positive
                  ? 'border-signal-buy/20 bg-signal-buy\/10'
                  : 'border-signal-sell/20 bg-signal-sell\/10'
              }`}
            >
              <span className="block text-[10px] text-muted-foreground whitespace-nowrap">{sector.name}</span>
              <span className={`block font-mono text-xs font-bold ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
                {positive ? '+' : ''}{avg.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Sector cards */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {sortedSectors.map(sector => (
          <SectorCard key={sector.name} sector={sector} timeframe={timeframe} />
        ))}
      </div>

      <p className="mt-3 text-[10px] text-muted-foreground text-center italic">
        Data från StockCharts.com — Dow Jones US Industry Groups. Charts visar 20/50/200 SMA. Demo-data visas.
      </p>
    </div>
  );
}
