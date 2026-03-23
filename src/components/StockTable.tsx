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

const blockedReasonFilters: WSPBlockedReason[] = [
  'below_50ma',
  'below_150ma',
  'slope_50_not_positive',
  'breakout_not_valid',
  'breakout_not_clean',
  'breakout_late_8plus',
  'volume_below_threshold',
  'mansfield_not_valid',
  'sector_not_aligned',
  'market_not_aligned',
  'pattern_not_climbing',
];

const patternFilters: { value: FilterValue; label: string }[] = [
  { value: 'all', label: 'Alla' },
  { value: 'KÖP', label: '🟢 Köpsignaler' },
  { value: 'valid-wsp', label: '✓ Valid WSP Entry' },
  { value: 'below_50ma', label: 'Blockerad: under 50 MA' },
  { value: 'below_150ma', label: 'Blockerad: under 150 MA' },
  { value: 'slope_50_not_positive', label: 'Blockerad: svag slope' },
  { value: 'breakout_not_valid', label: 'Blockerad: breakout saknas' },
  { value: 'breakout_not_clean', label: 'Blockerad: smutsigt breakout' },
  { value: 'breakout_late_8plus', label: 'Blockerad: breakout 8+ bars gammalt' },
  { value: 'volume_below_threshold', label: 'Blockerad: svag volym' },
  { value: 'mansfield_not_valid', label: 'Blockerad: svag Mansfield' },
  { value: 'sector_not_aligned', label: 'Blockerad: svag sektor' },
  { value: 'market_not_aligned', label: 'Blockerad: svag marknad' },
  { value: 'pattern_not_climbing', label: 'Blockerad: ej CLIMBING' },
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
      if (blockedReasonFilters.includes(filter as WSPBlockedReason)) {
        return s.blockedReasons.includes(filter as WSPBlockedReason);
      }
      return s.pattern === filter;
    })
    .sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      if (sortBy === 'symbol') return dir * a.symbol.localeCompare(b.symbol);
      if (sortBy === 'mansfieldRS') return dir * ((a.audit?.mansfieldValue ?? Number.NEGATIVE_INFINITY) - (b.audit?.mansfieldValue ?? Number.NEGATIVE_INFINITY));
      if (sortBy === 'volumeMultiple') return dir * ((a.audit?.volumeMultiple ?? Number.NEGATIVE_INFINITY) - (b.audit?.volumeMultiple ?? Number.NEGATIVE_INFINITY));
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
            {filtered.map((stock) => {
              const audit = stock.audit;
              const blockedReasons = audit?.blockedReasons ?? stock.blockedReasons ?? [];
              const logicViolations = stock.logicViolations ?? [];
              const mansfieldValue = audit?.mansfieldValue ?? null;
              const volumeMultiple = audit?.volumeMultiple ?? null;

              return (
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
                    <td className="px-3 py-2.5 font-mono text-xs font-medium">{formatCurrency(stock.price)}</td>
                    <td className="px-3 py-2.5">
                      <div className={`flex items-center gap-0.5 font-mono text-xs font-medium ${stock.changePercent >= 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
                        {stock.changePercent >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {formatPercent(stock.changePercent)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><PatternBadge pattern={stock.pattern} /></td>
                    <td className="px-3 py-2.5 text-center"><BoolIcon value={audit?.above50MA ?? false} /></td>
                    <td className="px-3 py-2.5 text-center"><BoolIcon value={audit?.slope50Positive ?? false} /></td>
                    <td className="px-3 py-2.5 text-center"><BoolIcon value={audit?.above150MA ?? false} /></td>
                    <td className="px-3 py-2.5 text-center"><BoolIcon value={audit?.breakoutValid ?? false} /></td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <BoolIcon value={audit?.volumeValid ?? false} />
                        <span className="font-mono text-[10px] text-muted-foreground">{formatMultiple(volumeMultiple)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`font-mono text-xs font-medium ${mansfieldValue !== null && mansfieldValue > 0 ? 'text-signal-buy' : mansfieldValue !== null && mansfieldValue < 0 ? 'text-signal-sell' : 'text-muted-foreground'}`}>
                        {formatSignedNumber(mansfieldValue, 1)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center"><BoolIcon value={audit?.sectorAligned ?? false} /></td>
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
                              {blockedReasons.length === 0 ? (
                                <p className="text-xs text-signal-buy">No hard-rule blockers. This setup is fully WSP-valid.</p>
                              ) : (
                                <div className="flex flex-wrap gap-1.5">
                                  {blockedReasons.map((reason) => (
                                    <span key={reason} className="rounded border border-signal-sell/20 bg-signal-sell/10 px-2 py-0.5 font-mono text-[10px] text-signal-sell">
                                      {reason}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {logicViolations.length > 0 && (
                                <div className="mt-3 rounded-md border border-signal-caution/30 bg-signal-caution/10 p-2 text-xs text-signal-caution">
                                  <div className="font-semibold">Logic violation detected</div>
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {logicViolations.map((rule) => (
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
                              <Row label="Pattern" value={audit?.pattern ?? stock.pattern} />
                              <Row label="Final recommendation" value={audit?.finalRecommendation ?? stock.finalRecommendation} highlight={stock.isValidWspEntry} />
                              <Row label="Price" value={formatCurrency(stock.price)} />
                              <Row label="SMA 20" value={formatCurrencyOrDash(audit?.sma20)} />
                              <Row label="SMA 50" value={formatCurrencyOrDash(audit?.sma50)} highlight={audit?.above50MA} />
                              <Row label="SMA 150" value={formatCurrencyOrDash(audit?.sma150)} highlight={audit?.above150MA} />
                              <Row label="SMA 200" value={formatCurrencyOrDash(audit?.sma200)} />
                              <Row label="Slope 50 value" value={formatNumberOrDash(audit?.sma50SlopeValue, 4)} highlight={audit?.slope50Positive} />
                              <Row label="Slope 50 direction" value={audit?.sma50SlopeDirection ?? '—'} highlight={audit?.slope50Positive} />
                              <Row label="Resistance level" value={formatCurrencyOrDash(audit?.resistanceLevel)} />
                              <Row label="Resistance upper bound" value={formatCurrencyOrDash(audit?.resistanceUpperBound)} />
                              <Row label="Resistance touches" value={formatInteger(audit?.resistanceTouches)} />
                              <Row label="Resistance tolerance %" value={formatPercentFromRatio(audit?.resistanceTolerancePct)} />
                              <Row label="Breakout level" value={formatCurrencyOrDash(audit?.breakoutLevel)} />
                              <Row label="Current close" value={formatCurrencyOrDash(audit?.currentClose)} />
                              <Row label="Close vs breakout" value={formatSignedCurrency(audit?.breakoutCloseDelta)} highlight={audit?.breakoutValid} />
                              <Row label="Close above resistance %" value={formatPercentFromRatio(audit?.closeAboveResistancePct)} highlight={audit?.breakoutQualityPass} />
                              <Row label="Breakout CLV" value={formatNumberOrDash(audit?.breakoutClv, 3)} highlight={audit?.breakoutQualityPass} />
                              <Row label="False breakouts (10 bars)" value={formatInteger(audit?.recentFalseBreakoutsCount)} highlight={audit ? audit.recentFalseBreakoutsCount <= audit.wspSpec.falseBreakoutMaxCount : undefined} />
                              <Row label="Breakout age bars" value={formatInteger(audit?.breakoutAgeBars)} highlight={audit ? !audit.breakoutStale : undefined} />
                              <Row label="Breakout valid" value={formatBooleanLabel(audit?.breakoutValid)} highlight={audit?.breakoutValid} />
                              <Row label="Breakout stale" value={formatBooleanLabel(audit?.breakoutStale)} highlight={audit ? !audit.breakoutStale : undefined} />
                              <Row label="Breakout quality pass" value={formatBooleanLabel(audit?.breakoutQualityPass)} highlight={audit?.breakoutQualityPass} />
                              <Row label="Breakout quality reasons" value={audit?.breakoutQualityReasons.join(', ') || 'none'} />
                              <Row label="Current volume" value={formatInteger(audit?.currentVolume)} />
                              <Row label="Average volume ref" value={formatNumberOrDash(audit?.averageVolumeReference, 2)} />
                              <Row label="Volume multiple" value={formatMultiple(audit?.volumeMultiple)} highlight={audit?.volumeValid} />
                              <Row label="Mansfield lookback" value={formatInteger(audit?.mansfieldLookbackBars)} />
                              <Row label="Mansfield value" value={formatSignedNumber(audit?.mansfieldValue, 4)} highlight={audit?.mansfieldValid} />
                              <Row label="Mansfield prev" value={formatSignedNumber(audit?.mansfieldValuePrev, 4)} />
                              <Row label="Mansfield trend" value={audit?.mansfieldTrend ?? '—'} highlight={audit?.mansfieldValid} />
                              <Row label="Mansfield uptrend" value={formatBooleanLabel(audit?.mansfieldUptrend)} highlight={audit?.mansfieldUptrend} />
                              <Row label="Mansfield transition" value={formatBooleanLabel(audit?.mansfieldRecentTransition)} highlight={audit?.mansfieldRecentTransition} />
                              <Row label="Mansfield valid" value={formatBooleanLabel(audit?.mansfieldValid)} highlight={audit?.mansfieldValid} />
                              <Row label="Chronology normalized" value={formatBooleanLabel(audit?.chronologyNormalized)} highlight={audit ? !audit.chronologyNormalized : undefined} />
                              <Row label="Indicator warnings" value={formatIndicatorWarnings(audit?.indicatorWarnings)} />
                              <Row label="Sector aligned" value={formatBooleanLabel(audit?.sectorAligned)} highlight={audit?.sectorAligned} />
                              <Row label="Market aligned" value={formatBooleanLabel(audit?.marketAligned)} highlight={audit?.marketAligned} />
                              <Row label="Exit reasons" value={audit?.exitReasons.join(', ') || 'none'} />
                              <Row label="Score" value={`${stock.score}/${stock.maxScore}`} />
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Decision Summary</h4>
                              <div className="space-y-1.5 text-xs">
                                <Row label="WSP valid entry" value={stock.isValidWspEntry ? 'Ja' : 'Nej'} highlight={stock.isValidWspEntry} />
                                <Row label="Score role" value="Rankning endast" />
                                <Row label="Sector" value={stock.sector || '—'} />
                                <Row label="Industry" value={stock.industry || '—'} />
                                <Row label="Data source" value={stock.dataSource === 'live' ? '🟢 Live' : '🟡 Fallback'} />
                                <Row label="Updated" value={stock.lastUpdated || '—'} />
                              </div>
                            </div>


                            <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">WSP Spec</h4>
                              <div className="space-y-1.5 text-xs">
                                <Row label="Touches min" value={formatInteger(audit?.wspSpec.resistanceTouchesMin)} />
                                <Row label="Resistance tolerance %" value={formatPercentFromRatio(audit?.wspSpec.resistanceTolerancePct)} />
                                <Row label="Breakout min above %" value={formatPercentFromRatio(audit?.wspSpec.breakoutMinCloseAboveResistancePct)} />
                                <Row label="Stale breakout bars" value={formatInteger(audit?.wspSpec.staleBreakoutBars)} />
                                <Row label="Volume lookback bars" value={formatInteger(audit?.wspSpec.volumeLookbackBars)} />
                                <Row label="Volume min" value={formatMultiple(audit?.wspSpec.volumeMultipleMin)} />
                                <Row label="Mansfield lookback" value={formatInteger(audit?.wspSpec.mansfieldLookbackBars)} />
                                <Row label="Mansfield transition bars" value={formatInteger(audit?.wspSpec.mansfieldTransitionLookbackBars)} />
                              </div>
                            </div>

                            <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Readable blockers</h4>
                              {blockedReasons.length === 0 ? (
                                <p className="text-xs text-muted-foreground">Nothing is blocking this symbol; all hard gates passed.</p>
                              ) : (
                                <ul className="space-y-1 text-xs text-muted-foreground">
                                  {blockedReasons.map((reason) => (
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
              );
            })}
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

function formatCurrency(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(2)}` : '—';
}

function formatCurrencyOrDash(value: number | null | undefined) {
  return formatCurrency(value);
}

function formatNumberOrDash(value: number | null | undefined, decimals = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : '—';
}

function formatSignedNumber(value: number | null | undefined, decimals = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  return `${value > 0 ? '+' : ''}${value.toFixed(decimals)}`;
}

function formatMultiple(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}x` : '—';
}

function formatSignedCurrency(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }

  return `${value > 0 ? '+' : ''}$${value.toFixed(2)}`;
}

function formatIndicatorWarnings(warnings: string[] | null | undefined) {
  if (!warnings || warnings.length === 0) {
    return 'none';
  }

  return warnings.join(', ');
}

function formatInteger(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }

  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatBooleanLabel(value: boolean | null | undefined) {
  if (typeof value !== 'boolean') {
    return '—';
  }
  return value ? 'Ja' : 'Nej';
}

function formatPercentFromRatio(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(2)}%`;
}


