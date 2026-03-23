import type { EvaluatedStock, ProviderStatus, ScreenerDebugSummary, WSPBlockedReason } from '@/lib/wsp-types';
import { BLOCKED_REASON_ORDERED, formatBlockedReason } from '@/lib/wsp-assertions';
import { AlertTriangle, Bug, ChevronDown, ChevronUp, FlaskConical } from 'lucide-react';
import { useState } from 'react';

interface DebugPanelProps {
  stocks: EvaluatedStock[];
  providerStatus: ProviderStatus;
  debugSummary: ScreenerDebugSummary;
}

export function DebugPanel({ stocks, providerStatus, debugSummary }: DebugPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const validEntries = stocks.filter((s) => s.isValidWspEntry).length;
  const buyCount = stocks.filter((s) => s.finalRecommendation === 'KÖP').length;

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
            Fixtures {debugSummary.fixturePassCount}/{debugSummary.fixturePassCount + debugSummary.fixtureFailCount}
          </span>
        </div>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border px-4 py-3">
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Stat label="Totala symboler" value={stocks.length} />
            <Stat label="Provider symbol count" value={providerStatus.symbolCount} />
            <Stat label="Valid WSP Entry" value={validEntries} highlight />
            <Stat label="KÖP signaler" value={buyCount} highlight />
            <Stat label="Provider status" value={providerStatus.uiState} />
            <Stat label="Provider fetch" value={providerStatus.successCount > 0 ? 'success' : 'failed'} warn={providerStatus.successCount === 0} />
            <Stat label="Fallback active" value={providerStatus.fallbackActive ? 'yes' : 'no'} warn={providerStatus.fallbackActive} />
            <Stat label="Benchmark fetch" value={providerStatus.benchmarkFetchStatus} warn={providerStatus.benchmarkFetchStatus !== 'success'} />
            <Stat label="Benchmark" value={providerStatus.benchmarkSymbol} />
            <Stat label="Senast uppdaterad" value={providerStatus.lastFetch ?? '—'} />
            <Stat label="Misslyckade symboler" value={providerStatus.failedSymbols.length} warn={providerStatus.failedSymbols.length > 0} />
            <Stat label="Polling" value={`${Math.round(providerStatus.refreshIntervalMs / 60000)} min`} />
            {providerStatus.errorMessage && <Stat label="Felmeddelande" value={providerStatus.errorMessage} warn className="sm:col-span-4" />}
          </div>

          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              <FlaskConical className="h-3.5 w-3.5 text-primary" />
              <span>Validation Summary</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Stat label="Fixture pass" value={debugSummary.fixturePassCount} highlight />
              <Stat label="Fixture fail" value={debugSummary.fixtureFailCount} warn={debugSummary.fixtureFailCount > 0} />
              <Stat label="Logic violations" value={debugSummary.logicViolationCount} warn={debugSummary.logicViolationCount > 0} />
              <Stat label="Valid KÖP candidates" value={debugSummary.validBuyCandidates} highlight />
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
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Fixture Results</div>
              <div className="space-y-2 text-xs">
                {debugSummary.fixtureResults.map((fixture) => (
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
