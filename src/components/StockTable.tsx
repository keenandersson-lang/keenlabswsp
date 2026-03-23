import { useState } from 'react';
import type { EvaluatedStock, WSPPattern, WSPRecommendation } from '@/lib/wsp-types';
import { PatternBadge } from './PatternBadge';
import { RecommendationBadge } from './RecommendationBadge';
import { EntryCriteria } from './EntryCriteria';
import { ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, Filter, Search, Check, X } from 'lucide-react';

interface StockTableProps {
  stocks: EvaluatedStock[];
}

type FilterValue = WSPPattern | WSPRecommendation | 'all' | 'valid-wsp';

const patternFilters: { value: FilterValue; label: string }[] = [
  { value: 'all', label: 'Alla' },
  { value: 'KÖP', label: '🟢 Köpsignaler' },
  { value: 'valid-wsp', label: '✓ Valid WSP Entry' },
  { value: 'CLIMBING', label: 'Climbing' },
  { value: 'BASE', label: 'Base' },
  { value: 'TIRED', label: 'Tired' },
  { value: 'DOWNHILL', label: 'Downhill' },
  { value: 'BEVAKA', label: 'Bevaka' },
  { value: 'SÄLJ', label: 'Sälj' },
  { value: 'UNDVIK', label: 'Undvik' },
];

type SortKey = 'symbol' | 'score' | 'changePercent' | 'mansfieldRS' | 'volumeMultiple';

function BoolIcon({ value }: { value: boolean }) {
  return value ? (
    <Check className="h-3.5 w-3.5 text-signal-buy" />
  ) : (
    <X className="h-3.5 w-3.5 text-signal-sell" />
  );
}

export function StockTable({ stocks }: StockTableProps) {
  const [filter, setFilter] = useState<FilterValue>('all');
  const [search, setSearch] = useState('');
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filtered = stocks
    .filter(s => {
      if (search) {
        const q = search.toLowerCase();
        if (!s.symbol.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q) && !s.sector.toLowerCase().includes(q)) return false;
      }
      if (filter === 'all') return true;
      if (filter === 'valid-wsp') return s.gate.isValidWspEntry;
      if (filter === 'KÖP' || filter === 'BEVAKA' || filter === 'SÄLJ' || filter === 'UNDVIK') return s.recommendation === filter;
      return s.pattern === filter;
    })
    .sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      if (sortBy === 'symbol') return dir * a.symbol.localeCompare(b.symbol);
      if (sortBy === 'mansfieldRS') return dir * (a.indicators.mansfieldRS - b.indicators.mansfieldRS);
      if (sortBy === 'volumeMultiple') return dir * (a.indicators.volumeMultiple - b.indicators.volumeMultiple);
      return dir * ((a[sortBy] as number) - (b[sortBy] as number));
    });

  const handleSort = (col: SortKey) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortBy !== col) return null;
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  };

  return (
    <div>
      {/* Search + Filter bar */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Sök ticker, företag, sektor..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-md border border-border bg-card pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
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
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort('symbol')}>
                <span className="flex items-center gap-1">Ticker <SortIcon col="symbol" /></span>
              </th>
              <th className="px-3 py-3">Pris</th>
              <th className="px-3 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort('changePercent')}>
                <span className="flex items-center gap-1">Ändr. <SortIcon col="changePercent" /></span>
              </th>
              <th className="px-3 py-3">Mönster</th>
              <th className="px-3 py-3 text-center" title="Pris > 50 MA">50MA</th>
              <th className="px-3 py-3 text-center" title="50 MA stigande">50↗</th>
              <th className="px-3 py-3 text-center" title="Pris > 150 MA">150MA</th>
              <th className="px-3 py-3 text-center" title="Breakout bekräftat">BRK</th>
              <th className="px-3 py-3 text-center" title="Volym ≥ 2x snitt">VOL</th>
              <th className="px-3 py-3 cursor-pointer hover:text-foreground text-center" onClick={() => handleSort('mansfieldRS')} title="Mansfield RS">
                <span className="flex items-center justify-center gap-1">MRS <SortIcon col="mansfieldRS" /></span>
              </th>
              <th className="px-3 py-3 text-center" title="Sektor i upptrend">SEK</th>
              <th className="px-3 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort('score')}>
                <span className="flex items-center gap-1">Score <SortIcon col="score" /></span>
              </th>
              <th className="px-3 py-3">Signal</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(stock => (
              <>
                <tr
                  key={stock.symbol}
                  onClick={() => setExpandedTicker(expandedTicker === stock.symbol ? null : stock.symbol)}
                  className={`cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/30 ${
                    stock.recommendation === 'KÖP' ? 'bg-signal-buy\/5' :
                    stock.recommendation === 'UNDVIK' ? 'bg-signal-sell\/5' : ''
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <div>
                      <span className="font-mono font-bold text-xs">{stock.symbol}</span>
                      <p className="text-[10px] text-muted-foreground truncate max-w-[100px]">{stock.name}</p>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs font-medium">${stock.price.toFixed(2)}</td>
                  <td className="px-3 py-2.5">
                    <div className={`flex items-center gap-0.5 font-mono text-xs font-medium ${stock.changePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                      {stock.changePercent >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><PatternBadge pattern={stock.pattern} /></td>
                  <td className="px-3 py-2.5 text-center"><BoolIcon value={stock.gate.priceAboveMA50} /></td>
                  <td className="px-3 py-2.5 text-center"><BoolIcon value={stock.gate.ma50Rising} /></td>
                  <td className="px-3 py-2.5 text-center"><BoolIcon value={stock.gate.priceAboveMA150} /></td>
                  <td className="px-3 py-2.5 text-center"><BoolIcon value={stock.gate.breakoutValid} /></td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <BoolIcon value={stock.gate.volumeSufficient} />
                      <span className="font-mono text-[10px] text-muted-foreground">{stock.indicators.volumeMultiple}x</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`font-mono text-xs font-medium ${stock.indicators.mansfieldRS > 0 ? 'text-signal-buy' : stock.indicators.mansfieldRS < 0 ? 'text-signal-sell' : 'text-muted-foreground'}`}>
                      {stock.indicators.mansfieldRS > 0 ? '+' : ''}{stock.indicators.mansfieldRS.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center"><BoolIcon value={stock.gate.sectorAligned} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      {[...Array(stock.maxScore)].map((_, i) => (
                        <div
                          key={i}
                          className={`h-1.5 w-2 rounded-full ${i < stock.score ? 'bg-primary' : 'bg-border'}`}
                        />
                      ))}
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground">{stock.score}/{stock.maxScore}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <RecommendationBadge recommendation={stock.recommendation} />
                  </td>
                </tr>
                {expandedTicker === stock.symbol && (
                  <tr key={`${stock.symbol}-detail`} className="border-b border-border bg-muted/20">
                    <td colSpan={13} className="px-4 py-4">
                      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                        <div>
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">WSP Entry Gate — Hårda regler</h4>
                          <EntryCriteria stock={stock} />
                        </div>
                        <div>
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Indikatorer</h4>
                          <div className="space-y-1.5 text-xs">
                            <Row label="SMA 20" value={stock.indicators.sma20 ? `$${stock.indicators.sma20.toFixed(2)}` : '—'} />
                            <Row label="SMA 50" value={stock.indicators.sma50 ? `$${stock.indicators.sma50.toFixed(2)}` : '—'} highlight={stock.gate.priceAboveMA50} />
                            <Row label="SMA 50 Slope" value={stock.indicators.sma50Slope.toFixed(2)} highlight={stock.gate.ma50Rising} />
                            <Row label="SMA 150" value={stock.indicators.sma150 ? `$${stock.indicators.sma150.toFixed(2)}` : '—'} highlight={stock.gate.priceAboveMA150} />
                            <Row label="SMA 200" value={stock.indicators.sma200 ? `$${stock.indicators.sma200.toFixed(2)}` : '—'} />
                            <Row label="Resistans" value={stock.indicators.resistanceZone ? `$${stock.indicators.resistanceZone.toFixed(2)} (${stock.indicators.resistanceTouches} toucher)` : '—'} />
                            <Row label="Bars sedan breakout" value={stock.indicators.barsSinceBreakout !== null ? `${stock.indicators.barsSinceBreakout}` : '—'} />
                            <Row label="Volym-multipel" value={`${stock.indicators.volumeMultiple}x`} highlight={stock.gate.volumeSufficient} />
                            <Row label="Mansfield RS" value={`${stock.indicators.mansfieldRS > 0 ? '+' : ''}${stock.indicators.mansfieldRS.toFixed(1)} (${stock.indicators.mansfieldRSTrend})`} highlight={stock.gate.mansfieldValid} />
                          </div>
                        </div>
                        <div>
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Exit-regler</h4>
                          <div className="space-y-1.5 text-xs text-muted-foreground">
                            <p>• Pris under 150 MA = <span className="font-bold text-signal-sell">OMEDELBAR SÄLJ</span></p>
                            <p>• Trendlinjebrott = <span className="text-signal-caution">Sälj 50%</span></p>
                            <p>• Max risk: <span className="font-mono text-foreground">2%</span> per trade</p>
                          </div>
                          <h4 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Meta</h4>
                          <div className="space-y-1 text-xs">
                            <Row label="Datakälla" value={stock.dataSource === 'live' ? '🟢 Live' : '🟡 Demo'} />
                            <Row label="Sektor" value={stock.sector} />
                            <Row label="Industri" value={stock.industry} />
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

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${highlight === true ? 'text-signal-buy' : highlight === false ? 'text-signal-sell' : ''}`}>{value}</span>
    </div>
  );
}
