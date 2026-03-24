import { useMemo, useState, type ReactNode } from 'react';
import type { DiscoveryMeta, MarketOverview, ProviderStatus, ScreenerDebugSummary, ValidationFixtureResult, WSPBlockedReason } from '@/lib/wsp-types';
import { BLOCKED_REASON_ORDERED, formatBlockedReason } from '@/lib/wsp-assertions';
import { AlertTriangle, Bug, ChevronDown, ChevronUp, FlaskConical, ListChecks, RadioTower } from 'lucide-react';

interface DebugPanelProps {
  providerStatus: ProviderStatus;
  debugSummary: ScreenerDebugSummary;
  market: MarketOverview;
  discoveryMeta: DiscoveryMeta;
}

export function DebugPanel({ providerStatus, debugSummary, market, discoveryMeta }: DebugPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const qaChecks = useMemo(() => ([
    { label: 'Engine fixtures passing', value: `${debugSummary.fixturePassCount}/${debugSummary.fixturePassCount + debugSummary.fixtureFailCount}`, ok: debugSummary.fixtureFailCount === 0 },
    { label: 'Indicator fixtures passing', value: `${debugSummary.indicatorTestPassCount}/${debugSummary.indicatorTestPassCount + debugSummary.indicatorTestFailCount}`, ok: debugSummary.indicatorTestFailCount === 0 },
    { label: 'Logic violations', value: String(debugSummary.logicViolationCount), ok: debugSummary.logicViolationCount === 0 },
    { label: 'Fallback active', value: providerStatus.fallbackActive ? 'yes' : 'no', ok: !providerStatus.fallbackActive },
    { label: 'Live provider configured', value: providerStatus.readiness.envVarPresent ? 'yes' : 'no', ok: providerStatus.readiness.envVarPresent },
    { label: 'Benchmark fetch status', value: providerStatus.benchmarkFetchStatus, ok: providerStatus.benchmarkFetchStatus === 'success' },
    { label: 'Stocks with missing audit fields', value: String(debugSummary.missingAuditFieldStocks), ok: debugSummary.missingAuditFieldStocks === 0 },
    { label: 'Stocks with insufficient history', value: String(debugSummary.insufficientHistoryCases), ok: debugSummary.insufficientHistoryCases === 0 },
  ]), [debugSummary, providerStatus]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Bug className="h-3.5 w-3.5" />
          <span className="font-medium">Debug Panel</span>
          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${badgeClass(providerStatus.uiState)}`}>
            {providerStatus.uiState}
          </span>
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground">
            {providerStatus.provider.toUpperCase()}
          </span>
          <span className="rounded border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[10px] text-primary">
            Gate fixtures {debugSummary.fixturePassCount}/{debugSummary.fixturePassCount + debugSummary.fixtureFailCount}
          </span>
          <span className="rounded border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[10px] text-primary">
            Indicator fixtures {debugSummary.indicatorTestPassCount}/{debugSummary.indicatorTestPassCount + debugSummary.indicatorTestFailCount}
          </span>
          {debugSummary.logicViolationCount > 0 && (
            <span className="rounded border border-signal-sell/30 bg-signal-sell/10 px-1.5 py-0.5 text-[10px] text-signal-sell">
              Impossible states {debugSummary.logicViolationCount}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border px-4 py-3">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <SectionCard title="Manual QA Checklist" icon={ListChecks}>
              <div className="grid gap-2 sm:grid-cols-2">
                {qaChecks.map((check) => (
                  <div key={check.label} className={`rounded-md border p-2 text-xs ${check.ok ? 'border-signal-buy/20 bg-signal-buy/5' : 'border-signal-caution/30 bg-signal-caution/10'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{check.label}</span>
                      <span className={`rounded border px-1.5 py-0.5 font-medium ${check.ok ? 'border-signal-buy/30 text-signal-buy' : 'border-signal-caution/30 text-signal-caution'}`}>
                        {check.ok ? 'OK' : 'CHECK'}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-foreground">{check.value}</div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Provider Readiness" icon={RadioTower}>
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                <Stat label="Env var present" value={providerStatus.readiness.envVarPresent ? 'yes' : 'no'} warn={!providerStatus.readiness.envVarPresent} />
                <Stat label="Provider route reachable" value={providerStatus.readiness.routeReachable ? 'yes' : 'no'} warn={!providerStatus.readiness.routeReachable} />
                <Stat label="Benchmark configured" value={providerStatus.readiness.benchmarkSymbolConfigured ? 'yes' : 'no'} warn={!providerStatus.readiness.benchmarkSymbolConfigured} />
                <Stat label="S&P proxy symbol" value={market.sp500Symbol} />
                <Stat label="Nasdaq proxy symbol" value={market.nasdaqSymbol} />
                <Stat label="Tracked symbols" value={providerStatus.readiness.trackedSymbolsCount} />
                <Stat label="Fetched successfully" value={providerStatus.readiness.symbolsFetchedSuccessfully} highlight={providerStatus.readiness.symbolsFetchedSuccessfully > 0} />
                <Stat label="Symbols failed" value={providerStatus.readiness.symbolsFailed} warn={providerStatus.readiness.symbolsFailed > 0} />
                <Stat label="Benchmark fetch" value={providerStatus.benchmarkFetchStatus} warn={providerStatus.benchmarkFetchStatus !== 'success'} />
                <Stat label="Current provider state" value={providerStatus.uiState} warn={providerStatus.uiState !== 'LIVE'} />
                <Stat label="Benchmark refresh" value={market.benchmarkLastUpdated} className="sm:col-span-3" />
                <Stat label="Benchmark data state" value={market.benchmarkState} warn={market.benchmarkState !== 'live'} />
                <Stat label="Last successful live fetch" value={providerStatus.readiness.lastSuccessfulLiveFetch ?? '—'} warn={!providerStatus.readiness.lastSuccessfulLiveFetch} className="sm:col-span-3" />
                {providerStatus.debugPipeline && (
                  <>
                    <Stat label="Pipeline stage" value={providerStatus.debugPipeline.stage} warn={providerStatus.debugPipeline.stage !== 'completed'} />
                    <Stat label="Provider auth" value={providerStatus.debugPipeline.providerAuth} warn={providerStatus.debugPipeline.providerAuth !== 'success'} />
                    <Stat label="Benchmark success/fail" value={`${providerStatus.debugPipeline.benchmarkSuccessCount}/${providerStatus.debugPipeline.benchmarkFailureCount}`} warn={providerStatus.debugPipeline.benchmarkSuccessCount === 0} />
                    <Stat label="Stock success/fail" value={`${providerStatus.debugPipeline.stockSuccessCount}/${providerStatus.debugPipeline.stockFailureCount}`} warn={providerStatus.debugPipeline.stockSuccessCount === 0} />
                    <Stat label="Stale cache available" value={providerStatus.debugPipeline.staleCacheAvailable ? 'yes' : 'no'} />
                    <Stat label="Fallback builder" value={providerStatus.debugPipeline.fallbackBuild} warn={providerStatus.debugPipeline.fallbackBuild !== 'success' && providerStatus.uiState === 'FALLBACK'} />
                    <Stat label="Mode reason" value={providerStatus.debugPipeline.finalModeReason} className="sm:col-span-3" />
                  </>
                )}
              </div>
            </SectionCard>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Stat label="Discovery source" value={discoveryMeta.source} />
            <Stat label="Discovery data state" value={discoveryMeta.dataState} warn={discoveryMeta.dataState !== 'LIVE'} />
            <Stat label="HOT count" value={discoveryMeta.categoryCounts.HOT} />
            <Stat label="BREAKOUT count" value={discoveryMeta.categoryCounts.BREAKOUT} />
            <Stat label="BULLISH count" value={discoveryMeta.categoryCounts.BULLISH} />
            <Stat label="BEARISH count" value={discoveryMeta.categoryCounts.BEARISH} />
            <Stat label="Discovery generated" value={discoveryMeta.generatedAt} className="sm:col-span-4" />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Stat label="Totala symboler" value={debugSummary.totalStocks} />
            <Stat label="Provider symbol count" value={providerStatus.symbolCount} />
            <Stat label="Valid WSP Entry" value={debugSummary.validEntryCount} highlight />
            <Stat label="KÖP signaler" value={debugSummary.recommendationCounts['KÖP']} highlight />
            <Stat label="BEVAKA" value={debugSummary.recommendationCounts['BEVAKA']} />
            <Stat label="SÄLJ" value={debugSummary.recommendationCounts['SÄLJ']} warn={debugSummary.recommendationCounts['SÄLJ'] > 0} />
            <Stat label="UNDVIK" value={debugSummary.recommendationCounts['UNDVIK']} warn={debugSummary.recommendationCounts['UNDVIK'] > 0} />
            <Stat label="Provider status" value={providerStatus.uiState} />
            <Stat label="Provider fetch" value={providerStatus.successCount > 0 ? 'success' : 'failed'} warn={providerStatus.successCount === 0} />
            <Stat label="Fallback active" value={providerStatus.fallbackActive ? 'yes' : 'no'} warn={providerStatus.fallbackActive} />
            <Stat label="Benchmark fetch" value={providerStatus.benchmarkFetchStatus} warn={providerStatus.benchmarkFetchStatus !== 'success'} />
            <Stat label="Benchmark" value={providerStatus.benchmarkSymbol} />
            <Stat label="Senast uppdaterad" value={providerStatus.lastFetch ?? '—'} />
            <Stat label="Misslyckade symboler" value={providerStatus.failedSymbols.length} warn={providerStatus.failedSymbols.length > 0} />
            <Stat label="Missing audit stocks" value={debugSummary.missingAuditFieldStocks} warn={debugSummary.missingAuditFieldStocks > 0} />
            <Stat label="Invalid indicator stocks" value={debugSummary.invalidIndicatorValueStocks} warn={debugSummary.invalidIndicatorValueStocks > 0} />
            <Stat label="Polling" value={`${Math.round(providerStatus.refreshIntervalMs / 60000)} min`} />
            {providerStatus.errorMessage && <Stat label="Status message" value={providerStatus.errorMessage} warn className="sm:col-span-4" />}
          </div>

          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              <FlaskConical className="h-3.5 w-3.5 text-primary" />
              <span>Validation Summary</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Stat label="Gate fixture pass" value={debugSummary.fixturePassCount} highlight />
              <Stat label="Gate fixture fail" value={debugSummary.fixtureFailCount} warn={debugSummary.fixtureFailCount > 0} />
              <Stat label="Indicator test pass" value={debugSummary.indicatorTestPassCount} highlight />
              <Stat label="Indicator test fail" value={debugSummary.indicatorTestFailCount} warn={debugSummary.indicatorTestFailCount > 0} />
              <Stat label="Logic violations" value={debugSummary.logicViolationCount} warn={debugSummary.logicViolationCount > 0} />
              <Stat label="Insufficient history" value={debugSummary.insufficientHistoryCases} warn={debugSummary.insufficientHistoryCases > 0} />
              <Stat label="Missing audit fields" value={debugSummary.missingAuditFieldStocks} warn={debugSummary.missingAuditFieldStocks > 0} />
              <Stat label="Valid KÖP candidates" value={debugSummary.validBuyCandidates} highlight />
              <Stat label="Formula warnings" value={debugSummary.formulaInconsistencyWarnings.length} warn={debugSummary.formulaInconsistencyWarnings.length > 0} />
              {BLOCKED_REASON_ORDERED.map((reason) => (
                <Stat
                  key={reason}
                  label={`Blockerade: ${formatBlockedReason(reason)}`}
                  value={debugSummary.blockedCounts[reason]}
                  warn={debugSummary.blockedCounts[reason] > 0}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Indicator Validation</div>
              <div className="space-y-2 text-xs">
                {debugSummary.indicatorFixtureResults.map((fixture) => (
                  <div key={fixture.id} className="rounded-md border border-border/70 bg-card/50 p-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-mono text-foreground">{fixture.id}</div>
                        <p className="mt-1 text-muted-foreground">{fixture.description}</p>
                      </div>
                      <span className={`rounded border px-2 py-0.5 font-medium ${fixture.passed ? 'border-signal-buy/30 bg-signal-buy/10 text-signal-buy' : 'border-signal-sell/30 bg-signal-sell/10 text-signal-sell'}`}>
                        {fixture.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                      <ComparisonRow label="Expected" value={fixture.expected} />
                      <ComparisonRow label="Actual" value={fixture.actual} warn={!fixture.passed} />
                    </div>
                    {!fixture.passed && fixture.mismatches.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-signal-sell">
                        {fixture.mismatches.map((mismatch) => <li key={mismatch}>{mismatch}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background/40 p-3">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Indicator Warnings</div>
              {debugSummary.formulaInconsistencyWarnings.length === 0 ? (
                <p className="text-xs text-muted-foreground">No formula inconsistency warnings detected in the current dataset.</p>
              ) : (
                <ul className="space-y-2 text-xs text-signal-sell">
                  {debugSummary.formulaInconsistencyWarnings.map((warning) => (
                    <li key={warning} className="rounded-md border border-signal-sell/30 bg-signal-sell/5 p-2 font-mono">
                      {warning}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Fixture Results</div>
              <div className="space-y-2 text-xs">
                {debugSummary.fixtureResults.map((fixture) => (
                  <FixtureResultCard key={fixture.id} fixture={fixture} />
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background/40 p-3">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-signal-caution" />
                <span>Logic Violations</span>
              </div>
              {debugSummary.logicViolations.length === 0 ? (
                <p className="text-xs text-muted-foreground">No impossible KÖP states detected in the current stock set.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {debugSummary.logicViolations.map((violation) => (
                    <div key={violation.symbol} className="rounded-md border border-signal-sell/30 bg-signal-sell/5 p-2">
                      <div className="font-mono font-semibold text-foreground">{violation.symbol}</div>
                      <div className="mt-1 text-muted-foreground">{violation.pattern} → {violation.finalRecommendation}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {violation.violatedRules.map((rule) => (
                          <BlockedReasonPill key={rule} reason={rule} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: typeof ListChecks; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function FixtureResultCard({ fixture }: { fixture: ValidationFixtureResult }) {
  return (
    <div className="rounded-md border border-border/70 bg-card/50 p-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-foreground">{fixture.id}</div>
          <p className="mt-1 text-muted-foreground">{fixture.description}</p>
        </div>
        <span className={`rounded border px-2 py-0.5 font-medium ${fixture.passed ? 'border-signal-buy/30 bg-signal-buy/10 text-signal-buy' : 'border-signal-sell/30 bg-signal-sell/10 text-signal-sell'}`}>
          {fixture.passed ? 'PASS' : 'FAIL'}
        </span>
      </div>

      <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
        <ComparisonRow label="Expected recommendation" value={fixture.expectedRecommendation} />
        <ComparisonRow label="Actual recommendation" value={fixture.actualRecommendation} warn={fixture.expectedRecommendation !== fixture.actualRecommendation} />
        <ComparisonRow label="Expected blockers" value={formatReasonList(fixture.expectedBlockedReasons)} />
        <ComparisonRow label="Actual blockers" value={formatReasonList(fixture.actualBlockedReasons)} warn={formatReasonList(fixture.expectedBlockedReasons) !== formatReasonList(fixture.actualBlockedReasons)} />
      </div>

      {!fixture.passed && fixture.mismatches.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-signal-sell">
          {fixture.mismatches.map((mismatch) => <li key={mismatch}>{mismatch}</li>)}
        </ul>
      )}
    </div>
  );
}

function ComparisonRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">{label}</span>
      <span className={warn ? 'font-mono text-signal-sell' : 'font-mono text-foreground'}>{value}</span>
    </div>
  );
}

function formatReasonList(reasons: WSPBlockedReason[]) {
  if (reasons.length === 0) {
    return 'none';
  }

  return reasons.join(', ');
}

function badgeClass(state: ProviderStatus['uiState']) {
  if (state === 'LIVE') return 'bg-signal-buy/10 text-signal-buy border-signal-buy/30';
  if (state === 'ERROR') return 'bg-signal-sell/10 text-signal-sell border-signal-sell/30';
  return 'bg-signal-caution/10 text-signal-caution border-signal-caution/30';
}

function BlockedReasonPill({ reason }: { reason: WSPBlockedReason }) {
  return (
    <span className="rounded border border-signal-sell/20 bg-signal-sell/10 px-2 py-0.5 font-mono text-[10px] text-signal-sell">
      {reason}
    </span>
  );
}

function Stat({
  label,
  value,
  highlight,
  warn,
  className,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
  warn?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="block text-[10px] text-muted-foreground">{label}</span>
      <span className={`break-words font-mono font-semibold ${highlight ? 'text-signal-buy' : warn ? 'text-signal-sell' : 'text-foreground'}`}>
        {value}
      </span>
    </div>
  );
}
