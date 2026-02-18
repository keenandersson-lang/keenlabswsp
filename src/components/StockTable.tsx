import { useState } from 'react';
import { StockData, WSPPattern } from '@/lib/wsp-engine';
import { PatternBadge } from './PatternBadge';
import { EntryCriteria } from './EntryCriteria';
import { ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, Filter } from 'lucide-react';

interface StockTableProps {
  stocks: StockData[];
}

const patternFilters: { value: WSPPattern | 'all' | 'buy'; label: string }[] = [
  { value: 'all', label: 'Alla' },
  { value: 'buy', label: '🟢 Köpsignaler' },
  { value: 'climbing', label: 'Climbing' },
  { value: 'base', label: 'Base' },
  { value: 'tired', label: 'Tired' },
  { value: 'downhill', label: 'Downhill' },
];

export function StockTable({ stocks }: StockTableProps) {
  const [filter, setFilter] = useState<WSPPattern | 'all' | 'buy'>('all');
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'entryScore' | 'changePercent' | 'ticker'>('entryScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filtered = stocks
    .filter(s => {
      if (filter === 'all') return true;
      if (filter === 'buy') return s.isBuySignal;
      return s.pattern === filter;
    })
    .sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      if (sortBy === 'ticker') return dir * a.ticker.localeCompare(b.ticker);
      return dir * ((a[sortBy] as number) - (b[sortBy] as number));
    });

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
        <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        {patternFilters.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f.value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/20'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort('ticker')}>
                <span className="flex items-center gap-1">Ticker {sortBy === 'ticker' && (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}</span>
              </th>
              <th className="px-4 py-3">Pris</th>
              <th className="px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort('changePercent')}>
                <span className="flex items-center gap-1">Förändring {sortBy === 'changePercent' && (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}</span>
              </th>
              <th className="px-4 py-3">Volym</th>
              <th className="px-4 py-3">Mönster</th>
              <th className="px-4 py-3">50 MA</th>
              <th className="px-4 py-3">150 MA</th>
              <th className="px-4 py-3">Mansfield RS</th>
              <th className="px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort('entryScore')}>
                <span className="flex items-center gap-1">Score {sortBy === 'entryScore' && (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}</span>
              </th>
              <th className="px-4 py-3">Signal</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(stock => (
              <>
                <tr
                  key={stock.ticker}
                  onClick={() => setExpandedTicker(expandedTicker === stock.ticker ? null : stock.ticker)}
                  className={`cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/30 ${
                    stock.isBuySignal ? 'bg-signal-buy\/10 hover:bg-signal-buy\/10' : stock.isSellSignal ? 'bg-signal-sell\/10 hover:bg-signal-sell\/10' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <div>
                      <span className="font-mono font-bold">{stock.ticker}</span>
                      <p className="text-xs text-muted-foreground">{stock.name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono font-medium">${stock.price.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <div className={`flex items-center gap-1 font-mono text-xs font-medium ${stock.changePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                      {stock.changePercent >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                      {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-mono text-xs ${stock.volumeBreakout ? 'text-signal-buy font-bold' : 'text-muted-foreground'}`}>
                      {(stock.volume / 1e6).toFixed(1)}M
                      {stock.volumeBreakout && <span className="ml-1 text-[10px]">🔥</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3"><PatternBadge pattern={stock.pattern} /></td>
                  <td className="px-4 py-3">
                    <span className={`font-mono text-xs ${stock.aboveMA50 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                      ${stock.ma50.toFixed(0)} {stock.ma50Slope === 'up' ? '↗' : stock.ma50Slope === 'down' ? '↘' : '→'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-mono text-xs ${stock.aboveMA150 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                      ${stock.ma150.toFixed(0)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-mono text-xs font-medium ${stock.mansfieldRS > 0 ? 'text-signal-buy' : stock.mansfieldRS < 0 ? 'text-signal-sell' : 'text-muted-foreground'}`}>
                      {stock.mansfieldRS > 0 ? '+' : ''}{stock.mansfieldRS.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {[...Array(6)].map((_, i) => (
                        <div
                          key={i}
                          className={`h-1.5 w-3 rounded-full ${i < stock.entryScore ? 'bg-primary' : 'bg-border'}`}
                        />
                      ))}
                      <span className="ml-1 font-mono text-xs text-muted-foreground">{stock.entryScore}/6</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {stock.isBuySignal && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-signal-buy\/10 px-2 py-0.5 text-xs font-bold text-signal-buy border border-signal-buy glow-green">
                        KÖP
                      </span>
                    )}
                    {stock.isSellSignal && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-signal-sell\/10 px-2 py-0.5 text-xs font-bold text-signal-sell border border-signal-sell">
                        SÄLJ
                      </span>
                    )}
                    {!stock.isBuySignal && !stock.isSellSignal && (
                      <span className="text-xs text-muted-foreground">BEVAKA</span>
                    )}
                  </td>
                </tr>
                {expandedTicker === stock.ticker && (
                  <tr key={`${stock.ticker}-detail`} className="border-b border-border bg-muted/20">
                    <td colSpan={10} className="px-4 py-4">
                      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                        <div>
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Entry-kriterier (WSP)</h4>
                          <EntryCriteria stock={stock} />
                        </div>
                        <div>
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nyckelnivåer</h4>
                          <div className="space-y-1.5 text-xs">
                            <div className="flex justify-between"><span className="text-muted-foreground">Resistans</span><span className="font-mono">{stock.resistanceZone ? `$${stock.resistanceZone.toFixed(2)}` : '—'}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Stöd</span><span className="font-mono">{stock.supportZone ? `$${stock.supportZone.toFixed(2)}` : '—'}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Reaction Low</span><span className="font-mono">{stock.reactionLow ? `$${stock.reactionLow.toFixed(2)}` : '—'}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Volym / 5d Snitt</span><span className="font-mono">{(stock.volume / stock.avgVolume5d).toFixed(1)}x</span></div>
                          </div>
                        </div>
                        <div>
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Exit-regler</h4>
                          <div className="space-y-1.5 text-xs text-muted-foreground">
                            <p>• <span className="text-foreground">Stop loss</span> strax under reaction low: <span className="font-mono text-signal-sell">{stock.reactionLow ? `$${stock.reactionLow.toFixed(2)}` : '4-6% under entry'}</span></p>
                            <p>• Pris under 150 MA = <span className="font-bold text-signal-sell">OMEDELBAR SÄLJ</span></p>
                            <p>• Trendlinjebrott = <span className="text-signal-caution">Sälj 50% av position</span></p>
                            <p>• Max risk: <span className="font-mono text-foreground">2%</span> per trade</p>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">Inga aktier matchar filtret</div>
        )}
      </div>
    </div>
  );
}
