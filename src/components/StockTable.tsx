import { Fragment, useMemo, useState } from 'react';
import type { DiscoveryMeta, EvaluatedStock, IndicatorWarning, StockAudit, WSPBlockedReason, WSPPattern, WSPRecommendation } from '@/lib/wsp-types';
import { PatternBadge } from './PatternBadge';
import { RecommendationBadge } from './RecommendationBadge';
import { EntryCriteria } from './EntryCriteria';
import { ArrowDownRight, ArrowUpRight, AlertTriangle, ChevronDown, ChevronUp, Filter, Search } from 'lucide-react';
import { formatBlockedReason } from '@/lib/wsp-assertions';
import { Link } from 'react-router-dom';

interface StockTableProps {
  stocks: EvaluatedStock[];
  discoveryMeta?: DiscoveryMeta;
}

type FilterValue = WSPPattern | WSPRecommendation | WSPBlockedReason | 'all' | 'valid-wsp';
type SortKey = 'symbol' | 'score' | 'changePercent' | 'mansfieldRS' | 'volumeMultiple' | 'logicViolations' | 'breakoutAge' | 'missingIndicators';

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

const quickSorts: { key: SortKey; label: string }[] = [
  { key: 'logicViolations', label: 'Logic violations' },
  { key: 'volumeMultiple', label: 'Highest volume multiple' },
  { key: 'breakoutAge', label: 'Newest breakout age' },
  { key: 'mansfieldRS', label: 'Strongest Mansfield' },
  { key: 'missingIndicators', label: 'Missing/invalid indicators' },
];

const IMPORTANT_WARNING_SET = new Set<IndicatorWarning>([
  'empty_price_history',
  'insufficient_sma_history',
  'insufficient_sma_slope_history',
  'insufficient_resistance_history',
  'insufficient_breakout_history',
  'insufficient_volume_history',
  'insufficient_benchmark_history',
  'benchmark_history_length_mismatch',
  'benchmark_dates_misaligned',
]);

function BoolCell({ value }: { value: boolean | null | undefined }) {
  if (value == null) {
    return <span className="font-mono text-[10px] text-muted-foreground">N/A</span>;
  }

  return (
    <span className={`inline-flex min-w-[58px] items-center justify-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${value ? 'border-signal-buy/30 bg-signal-buy/10 text-signal-buy' : 'border-signal-sell/30 bg-signal-sell/10 text-signal-sell'}`}>
      {value ? 'YES' : 'NO'}
    </span>
  );
}

export function StockTable({ stocks, discoveryMeta }: StockTableProps) {
  const [filter, setFilter] = useState<FilterValue>('all');
  const [search, setSearch] = useState('');
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filtered = useMemo(() => stocks
    .filter((stock) => {
      if (search) {
        const q = search.toLowerCase();
        if (!stock.symbol.toLowerCase().includes(q) && !stock.name.toLowerCase().includes(q) && !stock.sector.toLowerCase().includes(q)) return false;
      }
      if (filter === 'all') return true;
      if (filter === 'valid-wsp') return stock.isValidWspEntry;
      if (filter === 'KÖP' || filter === 'BEVAKA' || filter === 'SÄLJ' || filter === 'UNDVIK') return stock.finalRecommendation === filter;
      if (blockedReasonFilters.includes(filter as WSPBlockedReason)) return stock.blockedReasons.includes(filter as WSPBlockedReason);
      return stock.pattern === filter;
    })
    .sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      if (sortBy === 'symbol') return dir * a.symbol.localeCompare(b.symbol);
      if (sortBy === 'mansfieldRS') return dir * ((a.audit?.mansfieldValue ?? Number.NEGATIVE_INFINITY) - (b.audit?.mansfieldValue ?? Number.NEGATIVE_INFINITY));
      if (sortBy === 'volumeMultiple') return dir * ((a.audit?.volumeMultiple ?? Number.NEGATIVE_INFINITY) - (b.audit?.volumeMultiple ?? Number.NEGATIVE_INFINITY));
      if (sortBy === 'logicViolations') return dir * (a.logicViolations.length - b.logicViolations.length);
      if (sortBy === 'breakoutAge') return dir * ((normalizeBreakoutAge(a.audit) ?? Number.POSITIVE_INFINITY) - (normalizeBreakoutAge(b.audit) ?? Number.POSITIVE_INFINITY));
      if (sortBy === 'missingIndicators') return dir * (getMissingIndicatorScore(a) - getMissingIndicatorScore(b));
      return dir * ((a[sortBy] as number) - (b[sortBy] as number));
    }), [filter, search, sortBy, sortDir, stocks]);

  const handleSort = (col: SortKey) => {
    if (sortBy === col) setSortDir((dir) => dir === 'asc' ? 'desc' : 'asc');
    else {
      setSortBy(col);
      setSortDir(col === 'breakoutAge' ? 'asc' : 'desc');
    }
  };

  const applyQuickSort = (key: SortKey) => {
    setSortBy(key);
    setSortDir(key === 'breakoutAge' ? 'asc' : 'desc');
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortBy !== col) return null;
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  };

  return (
    <div>
      <div className="mb-4 space-y-2">
        {discoveryMeta && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-[10px] text-muted-foreground">
            <span>Scanner provenance: backend WSP engine</span>
            <span>•</span>
            <span>Data: {discoveryMeta.dataState}</span>
            <span>•</span>
            <span>Trend mode: {discoveryMeta.trendClassificationMode}</span>
            <span>•</span>
            <span>Scope: tracked universe</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Sök ticker, företag, sektor..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {quickSorts.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => applyQuickSort(option.key)}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${sortBy === option.key ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Filter className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          {patternFilters.map((option) => (
            <button
              key={option.value}
              onClick={() => setFilter(option.value)}
              className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === option.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="w-[120px] cursor-pointer px-3 py-3 hover:text-foreground" onClick={() => handleSort('symbol')}>
                <span className="flex items-center gap-1">Ticker <SortIcon col="symbol" /></span>
              </th>
              <th className="w-[92px] px-3 py-3">Pris</th>
              <th className="w-[92px] cursor-pointer px-3 py-3 hover:text-foreground" onClick={() => handleSort('changePercent')}>
                <span className="flex items-center gap-1">Ändr. <SortIcon col="changePercent" /></span>
              </th>
              <th className="w-[110px] px-3 py-3">Mönster</th>
              <th className="w-[78px] px-3 py-3 text-center">50MA</th>
              <th className="w-[78px] px-3 py-3 text-center">50↗</th>
              <th className="w-[78px] px-3 py-3 text-center">150MA</th>
              <th className="w-[78px] px-3 py-3 text-center">BRK</th>
              <th className="w-[90px] px-3 py-3 text-center">VOL</th>
              <th className="w-[90px] cursor-pointer px-3 py-3 text-center hover:text-foreground" onClick={() => handleSort('mansfieldRS')}>
                <span className="flex items-center justify-center gap-1">MRS <SortIcon col="mansfieldRS" /></span>
              </th>
              <th className="w-[78px] px-3 py-3 text-center">SEK</th>
              <th className="w-[110px] cursor-pointer px-3 py-3 hover:text-foreground" onClick={() => handleSort('score')}>
                <span className="flex items-center gap-1">Score <SortIcon col="score" /></span>
              </th>
              <th className="w-[120px] px-3 py-3">Signal</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((stock) => {
              const audit = stock.audit;
              const blockedReasons = audit?.blockedReasons ?? stock.blockedReasons ?? [];
              const exitReasons = audit?.exitReasons ?? [];
              const logicViolations = stock.logicViolations ?? [];
              const mansfieldValue = audit?.mansfieldValue ?? null;
              const volumeMultiple = audit?.volumeMultiple ?? null;
              const rowWarnings = getRowWarnings(stock);
              const hasPartialData = rowWarnings.length > 0 || getMissingIndicatorScore(stock) > 0;

              return (
                <Fragment key={stock.symbol}>
                  <tr
                    onClick={() => setExpandedTicker(expandedTicker === stock.symbol ? null : stock.symbol)}
                    className={`cursor-pointer border-b border-border/50 align-top transition-colors hover:bg-muted/30 ${
                      stock.finalRecommendation === 'KÖP' ? 'bg-signal-buy/5' : stock.finalRecommendation === 'UNDVIK' ? 'bg-signal-sell/5' : ''
                    } ${hasPartialData ? 'ring-1 ring-inset ring-signal-caution/20' : ''}`}
                  >
                    <td className="px-3 py-2.5">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold">{stock.symbol}</span>
                          {hasPartialData && <AlertTriangle className="h-3.5 w-3.5 text-signal-caution" />}
                          <Link
                            to={`/stock/${stock.symbol}`}
                            onClick={(event) => event.stopPropagation()}
                            className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/20"
                          >
                            Detail
                          </Link>
                        </div>
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
                    <td className="px-3 py-2.5 text-center"><BoolCell value={audit?.above50MA} /></td>
                    <td className="px-3 py-2.5 text-center"><BoolCell value={audit?.slope50Positive} /></td>
                    <td className="px-3 py-2.5 text-center"><BoolCell value={audit?.above150MA} /></td>
                    <td className="px-3 py-2.5 text-center"><BoolCell value={audit?.breakoutValid} /></td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <BoolCell value={audit?.volumeValid} />
                        <span className={`font-mono text-[10px] ${volumeMultiple == null ? 'text-signal-caution' : 'text-muted-foreground'}`}>{formatMultiple(volumeMultiple)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`font-mono text-xs font-medium ${mansfieldValue !== null && mansfieldValue > 0 ? 'text-signal-buy' : mansfieldValue !== null && mansfieldValue < 0 ? 'text-signal-sell' : 'text-signal-caution'}`}>
                        {formatSignedNumber(mansfieldValue, 1)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center"><BoolCell value={audit?.sectorAligned} /></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        {[...Array(stock.maxScore)].map((_, index) => (
                          <div key={index} className={`h-1.5 w-2 rounded-full ${index < stock.score ? 'bg-primary' : 'bg-border'}`} />
                        ))}
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground">{stock.score}/{stock.maxScore}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="space-y-1">
                        <RecommendationBadge recommendation={stock.finalRecommendation} />
                        {hasPartialData && <span className="inline-flex rounded border border-signal-caution/30 bg-signal-caution/10 px-1.5 py-0.5 text-[10px] font-medium text-signal-caution">Partial data</span>}
                      </div>
                    </td>
                  </tr>
                  {expandedTicker === stock.symbol && (
                    <tr className="border-b border-border bg-muted/20">
                      <td colSpan={13} className="px-4 py-4">
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_1fr_1fr]">
                          <div className="space-y-4">
                            <div>
                              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">WSP Entry Gate — Hårda regler</h4>
                              <EntryCriteria stock={stock} />
                            </div>

                            <ReasonSection title="Blocked Reasons" emptyText="No hard-rule blockers. This setup is fully WSP-valid." reasons={blockedReasons} tone="blocked" />
                            <ReasonSection title="Exit Reasons" emptyText="No exit/hard-stop reasons on the current data." reasons={exitReasons} tone="exit" />

                            {logicViolations.length > 0 && (
                              <div className="rounded-lg border border-signal-caution/30 bg-signal-caution/10 p-3 text-xs text-signal-caution">
                                <div className="font-semibold">Logic violation detected</div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {logicViolations.map((rule) => (
                                    <span key={rule} className="rounded border border-signal-caution/30 px-2 py-0.5 font-mono text-[10px]">
                                      {rule}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Audit Snapshot</h4>
                            <div className="space-y-1.5 text-xs">
                              <Row label="Pattern" value={audit?.pattern ?? stock.pattern} />
                              <Row label="Final recommendation" value={audit?.finalRecommendation ?? stock.finalRecommendation} highlight={stock.isValidWspEntry} />
                              <Row label="Price" value={formatCurrency(stock.price)} />
                              <Row label="SMA 20" value={formatCurrencyOrUnavailable(audit?.sma20)} warn={audit?.sma20 == null} />
                              <Row label="SMA 50" value={formatCurrencyOrUnavailable(audit?.sma50)} highlight={audit?.above50MA} warn={audit?.sma50 == null} />
                              <Row label="SMA 150" value={formatCurrencyOrUnavailable(audit?.sma150)} highlight={audit?.above150MA} warn={audit?.sma150 == null} />
                              <Row label="SMA 200" value={formatCurrencyOrUnavailable(audit?.sma200)} warn={audit?.sma200 == null} />
                              <Row label="Slope 50 value" value={formatNumberOrUnavailable(audit?.sma50SlopeValue, 4)} highlight={audit?.slope50Positive} warn={audit?.sma50SlopeValue == null} />
                              <Row label="Slope 50 direction" value={audit?.sma50SlopeDirection ?? 'unavailable'} highlight={audit?.slope50Positive} />
                              <Row label="Resistance level" value={formatCurrencyOrUnavailable(audit?.resistanceLevel)} warn={audit?.resistanceLevel == null} />
                              <Row label="Resistance upper bound" value={formatCurrencyOrUnavailable(audit?.resistanceUpperBound)} warn={audit?.resistanceUpperBound == null} />
                              <Row label="Resistance touches" value={formatInteger(audit?.resistanceTouches)} />
                              <Row label="Resistance most recent touch" value={audit?.resistanceMostRecentTouchDate ?? 'unavailable'} warn={!audit?.resistanceMostRecentTouchDate} />
                              <Row label="Resistance tolerance %" value={formatPercentFromRatio(audit?.resistanceTolerancePct)} />
                              <Row label="Breakout level" value={formatCurrencyOrUnavailable(audit?.breakoutLevel)} warn={audit?.breakoutLevel == null} />
                              <Row label="Current close" value={formatCurrencyOrUnavailable(audit?.currentClose)} warn={audit?.currentClose == null} />
                              <Row label="Close vs breakout" value={formatSignedCurrency(audit?.breakoutCloseDelta)} highlight={audit?.breakoutValid} warn={audit?.breakoutCloseDelta == null} />
                              <Row label="Close above resistance %" value={formatPercentFromRatio(audit?.closeAboveResistancePct)} highlight={audit?.breakoutQualityPass} warn={audit?.closeAboveResistancePct == null} />
                              <Row label="Breakout CLV" value={formatNumberOrUnavailable(audit?.breakoutClv, 3)} highlight={audit?.breakoutQualityPass} warn={audit?.breakoutClv == null} />
                              <Row label="False breakouts (10 bars)" value={formatInteger(audit?.recentFalseBreakoutsCount)} highlight={audit ? audit.recentFalseBreakoutsCount <= audit.wspSpec.falseBreakoutMaxCount : undefined} />
                              <Row label="Breakout age bars" value={formatIntegerOrUnavailable(audit?.breakoutAgeBars)} highlight={audit ? !audit.breakoutStale : undefined} warn={audit?.breakoutAgeBars == null} />
                              <Row label="Breakout valid" value={formatBooleanLabel(audit?.breakoutValid)} highlight={audit?.breakoutValid} />
                              <Row label="Breakout stale" value={formatBooleanLabel(audit?.breakoutStale)} highlight={audit ? !audit.breakoutStale : undefined} />
                              <Row label="Breakout quality pass" value={formatBooleanLabel(audit?.breakoutQualityPass)} highlight={audit?.breakoutQualityPass} />
                              <Row label="Breakout quality reasons" value={formatList(audit?.breakoutQualityReasons, 'none')} />
                              <Row label="Current volume" value={formatInteger(audit?.currentVolume)} />
                              <Row label="Average volume ref" value={formatNumberOrUnavailable(audit?.averageVolumeReference, 2)} warn={audit?.averageVolumeReference == null} />
                              <Row label="Volume multiple" value={formatMultiple(audit?.volumeMultiple)} highlight={audit?.volumeValid} warn={audit?.volumeMultiple == null} />
                              <Row label="Mansfield lookback" value={formatInteger(audit?.mansfieldLookbackBars)} />
                              <Row label="Mansfield value" value={formatSignedNumber(audit?.mansfieldValue, 4)} highlight={audit?.mansfieldValid} warn={audit?.mansfieldValue == null} />
                              <Row label="Mansfield prev" value={formatSignedNumber(audit?.mansfieldValuePrev, 4)} warn={audit?.mansfieldValuePrev == null} />
                              <Row label="Mansfield trend" value={audit?.mansfieldTrend ?? 'unavailable'} highlight={audit?.mansfieldValid} />
                              <Row label="Mansfield uptrend" value={formatBooleanLabel(audit?.mansfieldUptrend)} highlight={audit?.mansfieldUptrend} />
                              <Row label="Mansfield transition" value={formatBooleanLabel(audit?.mansfieldRecentTransition)} highlight={audit?.mansfieldRecentTransition} />
                              <Row label="Mansfield valid" value={formatBooleanLabel(audit?.mansfieldValid)} highlight={audit?.mansfieldValid} />
                              <Row label="Chronology normalized" value={formatBooleanLabel(audit?.chronologyNormalized)} highlight={audit ? !audit.chronologyNormalized : undefined} />
                              <Row label="Indicator warnings" value={formatIndicatorWarnings(audit?.indicatorWarnings)} warn={(audit?.indicatorWarnings?.length ?? 0) > 0} />
                              <Row label="Sector aligned" value={formatBooleanLabel(audit?.sectorAligned)} highlight={audit?.sectorAligned} />
                              <Row label="Market aligned" value={formatBooleanLabel(audit?.marketAligned)} highlight={audit?.marketAligned} />
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
                                <Row label="Data health" value={hasPartialData ? 'partial / inspect warnings' : 'complete enough for QA'} warn={hasPartialData} />
                              </div>
                            </div>

                            <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">WSP Spec</h4>
                              <div className="grid gap-2 text-xs sm:grid-cols-2">
                                <SpecChip label="resistanceTouchesMin" value={formatInteger(audit?.wspSpec.resistanceTouchesMin)} />
                                <SpecChip label="resistanceTolerancePct" value={formatPercentFromRatio(audit?.wspSpec.resistanceTolerancePct)} />
                                <SpecChip label="breakoutMinCloseAboveResistancePct" value={formatPercentFromRatio(audit?.wspSpec.breakoutMinCloseAboveResistancePct)} />
                                <SpecChip label="staleBreakoutBars" value={formatInteger(audit?.wspSpec.staleBreakoutBars)} />
                                <SpecChip label="volumeLookbackBars" value={formatInteger(audit?.wspSpec.volumeLookbackBars)} />
                                <SpecChip label="volumeMultipleMin" value={formatMultiple(audit?.wspSpec.volumeMultipleMin)} />
                                <SpecChip label="mansfieldLookbackBars" value={formatInteger(audit?.wspSpec.mansfieldLookbackBars)} />
                                <SpecChip label="mansfieldTransitionLookbackBars" value={formatInteger(audit?.wspSpec.mansfieldTransitionLookbackBars)} />
                                <SpecChip label="smaSlopeLookbackBars" value={formatInteger(audit?.wspSpec.smaSlopeLookbackBars)} />
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

                            {rowWarnings.length > 0 && (
                              <div className="rounded-lg border border-signal-caution/30 bg-signal-caution/10 p-3">
                                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-signal-caution">Partial Data Warnings</h4>
                                <ul className="space-y-1 text-xs text-signal-caution">
                                  {rowWarnings.map((warning) => (
                                    <li key={warning}>• {warning}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
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
        {filtered.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">Inga aktier matchar filtret</div>}
      </div>
    </div>
  );
}

function ReasonSection({ title, emptyText, reasons, tone }: { title: string; emptyText: string; reasons: WSPBlockedReason[]; tone: 'blocked' | 'exit' }) {
  const toneClass = tone === 'blocked'
    ? 'border-signal-sell/20 bg-signal-sell/5 text-signal-sell'
    : 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution';

  return (
    <div className="rounded-lg border border-border/70 bg-card/50 p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
      {reasons.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {reasons.map((reason) => (
            <span key={reason} className={`rounded border px-2 py-0.5 font-mono text-[10px] ${toneClass}`}>
              {reason}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, highlight, warn }: { label: string; value: string; highlight?: boolean; warn?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,150px)_1fr] gap-3 border-b border-border/40 py-1 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`break-words font-mono ${highlight ? 'text-signal-buy' : warn ? 'text-signal-caution' : 'text-foreground'}`}>
        {value}
      </span>
    </div>
  );
}

function SpecChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-mono text-foreground">{value}</div>
    </div>
  );
}

function normalizeBreakoutAge(audit: StockAudit | undefined | null) {
  if (!audit) return null;
  return audit.breakoutAgeBars ?? Number.POSITIVE_INFINITY;
}

function getMissingIndicatorScore(stock: EvaluatedStock) {
  const audit = stock.audit;
  const missingFields = [
    audit?.sma20,
    audit?.sma50,
    audit?.sma150,
    audit?.sma200,
    audit?.sma50SlopeValue,
    audit?.resistanceLevel,
    audit?.breakoutLevel,
    audit?.averageVolumeReference,
    audit?.volumeMultiple,
    audit?.mansfieldValue,
  ].filter((value) => value == null).length;

  const invalidNumericValues = [stock.price, stock.changePercent, audit?.volumeMultiple, audit?.mansfieldValue]
    .filter((value) => value != null && !Number.isFinite(value)).length;

  return missingFields + invalidNumericValues + (audit?.indicatorWarnings.length ?? 0);
}

function getRowWarnings(stock: EvaluatedStock) {
  const warnings = new Set<string>();
  const audit = stock.audit;

  if (audit.indicatorWarnings.some((warning) => IMPORTANT_WARNING_SET.has(warning))) {
    warnings.add('Insufficient history for one or more indicators.');
  }
  if (audit.sma50 == null || audit.sma150 == null || audit.mansfieldValue == null || audit.volumeMultiple == null) {
    warnings.add('One or more key indicator values are unavailable.');
  }
  if (audit.indicatorWarnings.length > 0) {
    warnings.add(`Indicator warnings: ${audit.indicatorWarnings.join(', ')}`);
  }

  return [...warnings];
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatCurrencyOrUnavailable(value: number | null | undefined) {
  return value == null ? 'Unavailable' : formatCurrency(value);
}

function formatSignedCurrency(value: number | null | undefined) {
  if (value == null) return 'Unavailable';
  return `${value >= 0 ? '+' : ''}$${value.toFixed(2)}`;
}

function formatPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatPercentFromRatio(value: number | null | undefined) {
  if (value == null) return 'Unavailable';
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumberOrUnavailable(value: number | null | undefined, digits = 2) {
  if (value == null) return 'Unavailable';
  return value.toFixed(digits);
}

function formatSignedNumber(value: number | null | undefined, digits = 2) {
  if (value == null) return 'Unavailable';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function formatInteger(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 'Unavailable';
  return Math.round(value).toString();
}

function formatIntegerOrUnavailable(value: number | null | undefined) {
  return value == null ? 'Unavailable' : formatInteger(value);
}

function formatMultiple(value: number | null | undefined) {
  if (value == null) return 'N/A';
  return `${value.toFixed(2)}x`;
}

function formatBooleanLabel(value: boolean | null | undefined) {
  if (value == null) return 'Unavailable';
  return value ? 'Ja' : 'Nej';
}

function formatIndicatorWarnings(warnings: IndicatorWarning[] | undefined) {
  if (!warnings || warnings.length === 0) return 'none';
  return warnings.join(', ');
}

function formatList(values: string[] | undefined, emptyText: string) {
  if (!values || values.length === 0) return emptyText;
  return values.join(', ');
}
