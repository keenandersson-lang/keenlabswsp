import type { EvaluatedStock, ProviderStatus } from '@/lib/wsp-types';
import { Bug, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

interface DebugPanelProps {
  stocks: EvaluatedStock[];
  providerStatus: ProviderStatus;
}

export function DebugPanel({ stocks, providerStatus }: DebugPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const validEntries = stocks.filter((s) => s.gate.isValidWspEntry).length;
  const buyCount = stocks.filter((s) => s.recommendation === 'KÖP').length;
  const blockedMA50 = stocks.filter((s) => !s.gate.priceAboveMA50).length;
  const blockedMA150 = stocks.filter((s) => !s.gate.priceAboveMA150).length;
  const blockedVolume = stocks.filter((s) => !s.gate.volumeSufficient).length;
  const blockedSector = stocks.filter((s) => !s.gate.sectorAligned).length;
  const blockedBreakout = stocks.filter((s) => !s.gate.breakoutValid).length;
  const blockedMansfield = stocks.filter((s) => !s.gate.mansfieldValid).length;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Bug className="h-3.5 w-3.5" />
          <span className="font-medium">Debug Panel</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium border ${badgeClass(providerStatus.uiState)}`}>
            {providerStatus.uiState}
          </span>
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground">
            {providerStatus.provider.toUpperCase()}
          </span>
        </div>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
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
          <Stat label="Blockade: under 50 MA" value={blockedMA50} warn />
          <Stat label="Blockade: under 150 MA" value={blockedMA150} warn />
          <Stat label="Blockade: svag volym" value={blockedVolume} warn />
          <Stat label="Blockade: breakout ej" value={blockedBreakout} warn />
          <Stat label="Blockade: Mansfield" value={blockedMansfield} warn />
          <Stat label="Blockade: sektor" value={blockedSector} warn />
          {providerStatus.errorMessage && <Stat label="Felmeddelande" value={providerStatus.errorMessage} warn className="sm:col-span-4" />}
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
      <span className="text-muted-foreground block text-[10px]">{label}</span>
      <span className={`font-mono font-semibold break-words ${highlight ? 'text-signal-buy' : warn ? 'text-signal-sell' : 'text-foreground'}`}>
        {value}
      </span>
    </div>
  );
}
