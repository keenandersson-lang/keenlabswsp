import { Fragment, useMemo, useState } from 'react';
import type { EvaluatedStock, WSPBlockedReason, WSPPattern, WSPRecommendation } from '@/lib/wsp-types';
import { PatternBadge } from './PatternBadge';
import { RecommendationBadge } from './RecommendationBadge';
import { EntryCriteria } from './EntryCriteria';
import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, ChevronUp, Filter, Search, X } from 'lucide-react';
import { formatBlockedReason } from '@/lib/wsp-assertions';

interface StockTableProps {
  stocks: EvaluatedStock[];
}

type FilterValue = WSPPattern | WSPRecommendation | WSPBlockedReason | 'all' | 'valid-wsp';

const patternFilters: { value: FilterValue; label: string }[] = [
  { value: 'all', label: 'Alla' },
  { value: 'KÖP', label: '🟢 Köpsignaler' },
  { value: 'valid-wsp', label: '✓ Valid WSP Entry' },
  { value: 'below_50ma', label: 'Blockerad: under 50 MA' },
  { value: 'below_150ma', label: 'Blockerad: under 150 MA' },
  { value: 'slope_50_not_positive', label: 'Blockerad: svag slope' },
  { value: 'breakout_not_valid', label: 'Blockerad: breakout saknas' },
  { value: 'breakout_stale', label: 'Blockerad: stale breakout' },
  { value: 'volume_below_threshold', label: 'Blockerad: svag volym' },
  { value: 'mansfield_not_valid', label: 'Blockerad: svag Mansfield' },
  { value: 'sector_not_aligned', label: 'Blockerad: svag sektor' },
  { value: 'market_not_aligned', label: 'Blockerad: svag marknad' },
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

  const filtered = useMemo(() => stocks
    .filter((s) => {
      if (search) {
        const q = search.toLowerCase();
        if (!s.symbol.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q) && !s.sector.toLowerCase().includes(q)) return false;
      }
      if (filter === 'all') return true;
      if (filter === 'valid-wsp') return s.isValidWspEntry;
      if (filter === 'KÖP' || filter === 'BEVAKA' || filter === 'SÄLJ' || filter === 'UNDVIK') return s.finalRecommendation === filter;
      if (
        filter === 'below_50ma' ||
        filter === 'below_150ma' ||
        filter === 'slope_50_not_positive' ||
        filter === 'breakout_not_valid' ||
        filter === 'breakout_stale' ||
        filter === 'volume_below_threshold' ||
        filter === 'mansfield_not_valid' ||
        filter === 'sector_not_aligned' ||
        filter === 'market_not_aligned'
      ) {
        return s.blockedReasons.includes(filter);
      }
      return s.pattern === filter;
    })
    .sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      if (sortBy === 'symbol') return dir * a.symbol.localeCompare(b.symbol);
      if (sortBy === 'mansfieldRS') return dir * (a.indicators.mansfieldRS - b.indicators.mansfieldRS);
      if (sortBy === 'volumeMultiple') return dir * (a.indicators.volumeMultiple - b.indicators.volumeMultiple);
      return dir * ((a[sortBy] as number) - (b[sortBy] as number));
    }), [filter, search, sortBy, sortDir, stocks]);

  const handleSort = (col: SortKey) => {
    if (sortBy === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortBy !== col) return null;
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  };

  return (
    <div>
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Sök ticker, företag, sektor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Filter className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          {patternFilters.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="cursor-pointer px-3 py-3 hover:text-foreground" onClick={() => handleSort('symbol')}>
                <span className="flex items-center gap-1">Ticker <SortIcon col="symbol" /></span>
              </th>
              <th className="px-3 py-3">Pris</th>
              <th className="cursor-pointer px-3 py-3 hover:text-foreground" onClick={() => handleSort('changePercent')}>
                <span className="flex items-center gap-1">Ändr. <SortIcon col="changePercent" /></span>
              </th>
              <th className="px-3 py-3">Mönster</th>
              <th className="px-3 py-3 text-center" title="Pris > 50 MA">50MA</th>
              <th className="px-3 py-3 text-center" title="50 MA stigande">50↗</th>
              <th className="px-3 py-3 text-center" title="Pris > 150 MA">150MA</th>
              <th className="px-3 py-3 text-center" title="Breakout bekräftat">BRK</th>
              <th className="px-3 py-3 text-center" title="Volym ≥ 2x snitt">VOL</th>
              <th className="cursor-pointer px-3 py-3 text-center hover:text-foreground" onClick={() => handleSort('mansfieldRS')} title="Mansfield RS">
                <span className="flex items-center justify-center gap-1">MRS <SortIcon col="mansfieldRS" /></span>
              </th>
              <th className="px-3 py-3 text-center" title="Sektor i upptrend">SEK</th>
              <th className="cursor-pointer px-3 py-3 hover:text-foreground" onClick={() => handleSort('score')}>
                <span className="flex items-center gap-1">Score <SortIcon col="score" /></span>
              </th>
              <th className="px-3 py-3">Signal</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((stock) => (
              <Fragment key={stock.symbol}>
                <tr
                  onClick={() => setExpandedTicker(expandedTicker === stock.symbol ? null : stock.symbol)}
                  className={`cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/30 ${
                    stock.finalRecommendation === 'KÖP' ? 'bg-signal-buy/5' :
                    stock.finalRecommendation === 'UNDVIK' ? 'bg-signal-sell/5' : ''
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <div>
                      <span className="font-mono text-xs font-bold">{stock.symbol}</span>
                      <p className="max-w-[100px] truncate text-[10px] text-muted-foreground">{stock.name}</p>
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
                  <td className="px-3 py-2.5 text-center"><BoolIcon value={stock.audit.above50MA} /></td>
                  <td className="px-3 py-2.5 text-center"><BoolIcon value={stock.audit.slope50Positive} /></td>
                  <td className="px-3 py-2.5 text-center"><BoolIcon value={stock.audit.above150MA} /></td>
                  <td className="px-3 py-2.5 text-center"><BoolIcon value={stock.audit.breakoutValid} /></td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <BoolIcon value={stock.audit.volumeValid} />
                      <span className="font-mono text-[10px] text-muted-foreground">{stock.audit.volumeMultiple.toFixed(1)}x</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`font-mono text-xs font-medium ${stock.audit.mansfieldValue > 0 ? 'text-signal-buy' : stock.audit.mansfieldValue < 0 ? 'text-signal-sell' : 'text-muted-foreground'}`}>
                      {stock.audit.mansfieldValue > 0 ? '+' : ''}{stock.audit.mansfieldValue.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center"><BoolIcon value={stock.audit.sectorAligned} /></td>
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
                    <RecommendationBadge recommendation={stock.finalRecommendation} />
                  </td>
                </tr>
                {expandedTicker === stock.symbol && (
                  <tr className="border-b border-border bg-muted/20">
                    <td colSpan={13} className="px-4 py-4">
                      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1fr_1fr]">
                        <div className="space-y-4">
                          <div>
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">WSP Entry Gate — Hårda regler</h4>
                            <EntryCriteria stock={stock} />
                          </div>
                          <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Blocked Reasons</h4>
                            {stock.blockedReasons.length === 0 ? (
                              <p className="text-xs text-signal-buy">No hard-rule blockers. This setup is fully WSP-valid.</p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {stock.blockedReasons.map((reason) => (
                                  <span key={reason} className="rounded border border-signal-sell/20 bg-signal-sell/10 px-2 py-0.5 font-mono text-[10px] text-signal-sell">
                                    {reason}
                                  </span>
                                ))}
                              </div>
                            )}
                            {stock.logicViolations.length > 0 && (
                              <div className="mt-3 rounded-md border border-signal-caution/30 bg-signal-caution/10 p-2 text-xs text-signal-caution">
                                <div className="font-semibold">Logic violation detected</div>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  {stock.logicViolations.map((rule) => (
                                    <span key={rule} className="rounded border border-signal-caution/30 px-2 py-0.5 font-mono text-[10px]">
                                      {rule}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Audit Snapshot</h4>
                          <div className="space-y-1.5 text-xs">
                            <Row label="Pattern" value={stock.audit.pattern} />
                            <Row label="Final recommendation" value={stock.audit.finalRecommendation} highlight={stock.isValidWspEntry} />
                            <Row label="Price" value={`$${stock.price.toFixed(2)}`} />
                            <Row label="SMA 50" value={stock.indicators.sma50 ? `$${stock.indicators.sma50.toFixed(2)}` : '—'} highlight={stock.audit.above50MA} />
                            <Row label="SMA 150" value={stock.indicators.sma150 ? `$${stock.indicators.sma150.toFixed(2)}` : '—'} highlight={stock.audit.above150MA} />
                            <Row label="Slope 50" value={stock.indicators.sma50Slope.toFixed(2)} highlight={stock.audit.slope50Positive} />
                            <Row label="Resistance level" value={stock.audit.resistanceLevel !== null ? `$${stock.audit.resistanceLevel.toFixed(2)}` : '—'} />
                            <Row label="Breakout level" value={stock.audit.breakoutLevel !== null ? `$${stock.audit.breakoutLevel.toFixed(2)}` : '—'} />
                            <Row label="Breakout valid" value={stock.audit.breakoutValid ? 'Ja' : 'Nej'} highlight={stock.audit.breakoutValid} />
                            <Row label="Breakout stale" value={stock.audit.breakoutStale ? 'Ja' : 'Nej'} highlight={!stock.audit.breakoutStale} />
                            <Row label="Current volume" value={stock.audit.currentVolume.toLocaleString('en-US')} />
                            <Row label="Average volume ref" value={stock.audit.averageVolumeReference.toLocaleString('en-US')} />
                            <Row label="Volume multiple" value={`${stock.audit.volumeMultiple.toFixed(1)}x`} highlight={stock.audit.volumeValid} />
                            <Row label="Mansfield value" value={`${stock.audit.mansfieldValue > 0 ? '+' : ''}${stock.audit.mansfieldValue.toFixed(1)}`} highlight={stock.audit.mansfieldValid} />
                            <Row label="Mansfield valid" value={stock.audit.mansfieldValid ? 'Ja' : 'Nej'} highlight={stock.audit.mansfieldValid} />
                            <Row label="Sector aligned" value={stock.audit.sectorAligned ? 'Ja' : 'Nej'} highlight={stock.audit.sectorAligned} />
                            <Row label="Market aligned" value={stock.audit.marketAligned ? 'Ja' : 'Nej'} highlight={stock.audit.marketAligned} />
                            <Row label="Score" value={`${stock.score}/${stock.maxScore}`} />
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Decision Summary</h4>
                            <div className="space-y-1.5 text-xs">
                              <Row label="WSP valid entry" value={stock.isValidWspEntry ? 'Ja' : 'Nej'} highlight={stock.isValidWspEntry} />
                              <Row label="Score role" value="Rankning endast" />
                              <Row label="Sector" value={stock.sector} />
                              <Row label="Industry" value={stock.industry} />
                              <Row label="Data source" value={stock.dataSource === 'live' ? '🟢 Live' : '🟡 Fallback'} />
                              <Row label="Updated" value={stock.lastUpdated} />
                            </div>
                          </div>

                          <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Readable blockers</h4>
                            {stock.blockedReasons.length === 0 ? (
                              <p className="text-xs text-muted-foreground">Nothing is blocking this symbol; all hard gates passed.</p>
                            ) : (
                              <ul className="space-y-1 text-xs text-muted-foreground">
                                {stock.blockedReasons.map((reason) => (
                                  <li key={reason}>• {formatBlockedReason(reason)}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
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
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono text-right ${highlight === true ? 'text-signal-buy' : highlight === false ? 'text-signal-sell' : ''}`}>{value}</span>
    </div>
  );
}
