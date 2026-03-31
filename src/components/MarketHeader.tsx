import { Activity, ArrowUpRight, ArrowDownRight, RefreshCw, Wifi, WifiOff, Clock3, ServerCrash, AlertTriangle } from 'lucide-react';
import type { MarketOverview, ScreenerTrustContract, ScreenerUiState, SectorStatus } from '@/lib/wsp-types';

interface MarketHeaderProps {
  market: MarketOverview;
  buyCount: number;
  sellCount: number;
  watchCount: number;
  avoidCount: number;
  totalStocks: number;
  trust: ScreenerTrustContract;
  sectorStatuses?: SectorStatus[];
  isFetching: boolean;
  pollingIntervalMs: number;
  onRefresh: () => void;
  onPollingIntervalChange: (value: number) => void;
}

const pollingOptions = [60_000, 5 * 60_000, 15 * 60_000];

export function MarketHeader({
  market,
  buyCount,
  sellCount,
  watchCount,
  avoidCount,
  totalStocks,
  trust,
  sectorStatuses = [],
  isFetching,
  pollingIntervalMs,
  onRefresh,
  onPollingIntervalChange,
}: MarketHeaderProps) {
  const stateMeta = getStateMeta(trust.displayState);

  const rankedSectors = sectorStatuses
    .slice()
    .sort((left, right) => right.changePercent - left.changePercent)
    .slice(0, 3);
  const showSectorSummary = rankedSectors.length > 0;

  return (
    <header className="border-b border-border bg-card/90 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 py-2.5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          {/* Brand + status */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-primary/10 border border-primary/20">
              <Activity className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-widest text-foreground font-mono">WSP</h1>
                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8px] font-mono font-bold tracking-wider ${stateMeta.className}`}>
                  <stateMeta.icon className="h-2 w-2" />
                  {stateMeta.label}
                </span>
              </div>
              <p className="text-[9px] text-muted-foreground font-mono tracking-wider">WALL STREET PROTOCOL · {stateMeta.description}</p>
            </div>
          </div>

          {/* Benchmarks + Signals + Controls */}
          <div className="flex flex-col gap-1.5 lg:items-end">
            <div className="flex flex-wrap items-center gap-3">
              {showSectorSummary ? (
                <>
                  {rankedSectors.map((sector) => (
                    <SectorChip key={sector.sector} status={sector} />
                  ))}
                </>
              ) : (
                <>
                  <BenchmarkChip label="S&P 500" symbol={market.sp500Symbol} change={market.sp500Change} price={market.sp500Price} />
                  <div className="hidden h-5 w-px bg-border lg:block" />
                  <BenchmarkChip label="NASDAQ" symbol={market.nasdaqSymbol} change={market.nasdaqChange} price={market.nasdaqPrice} />
                </>
              )}
              <div className="hidden h-5 w-px bg-border lg:block" />
              <div className="flex items-center gap-2">
                <SignalDot label="KÖP" count={buyCount} color="hsl(var(--signal-buy))" pulse />
                <SignalDot label="BEV" count={watchCount} color="hsl(var(--accent))" />
                <SignalDot label="SÄLJ" count={sellCount} color="hsl(var(--signal-caution))" />
                <SignalDot label="UND" count={avoidCount} color="hsl(var(--signal-sell))" />
                <span className="text-[9px] text-muted-foreground font-mono">{totalStocks}</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[10px]">
              <label className="flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-muted-foreground font-mono">
                <Clock3 className="h-2.5 w-2.5" />
                <select
                  value={pollingIntervalMs}
                  onChange={(e) => onPollingIntervalChange(Number(e.target.value))}
                  className="bg-transparent text-foreground outline-none text-[10px] font-mono"
                >
                  {pollingOptions.map((opt) => (
                    <option key={opt} value={opt}>{formatInterval(opt)}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-foreground font-mono transition-colors hover:border-primary/40 hover:text-primary"
              >
                <RefreshCw className={`h-2.5 w-2.5 ${isFetching ? 'animate-spin' : ''}`} />
                REFRESH
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function SectorChip({ status }: { status: SectorStatus }) {
  const positive = status.changePercent >= 0;
  return (
    <div className="rounded border border-border/60 bg-background/60 px-2 py-1">
      <div className="text-[8px] font-mono text-muted-foreground tracking-wider">{status.sector}</div>
      <div className={`font-mono text-[10px] font-bold ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
        {positive ? '+' : ''}{status.changePercent.toFixed(2)}%
      </div>
    </div>
  );
}

function getStateMeta(uiState: ScreenerUiState) {
  switch (uiState) {
    case 'LIVE':
      return {
        icon: Wifi,
        className: 'border-signal-buy/30 bg-signal-buy/10 text-signal-buy',
        label: 'LIVE',
        description: 'Data uppdaterad',
      };
    case 'STALE':
      return {
        icon: Clock3,
        className: 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution',
        label: 'FÖRDRÖJD',
        description: 'Visar senast kända data',
      };
    case 'FALLBACK':
      return {
        icon: AlertTriangle,
        className: 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution',
        label: 'RESERVLÄGE',
        description: 'Alternativ datakälla används',
      };
    case 'ERROR':
      return {
        icon: ServerCrash,
        className: 'border-signal-sell/30 bg-signal-sell/10 text-signal-sell',
        label: 'DATAPROBLEM',
        description: 'Nya signaler kan saknas',
      };
    default:
      return {
        icon: WifiOff,
        className: 'border-border bg-background text-muted-foreground',
        label: uiState,
        description: 'Status okänd',
      };
  }
}

function formatInterval(value: number) {
  return `${Math.round(value / 60_000)}m`;
}

function BenchmarkChip({ label, symbol, change, price }: { label: string; symbol: string; change: number; price: number | null }) {
  const positive = change >= 0;
  return (
    <div className="flex items-center gap-1.5">
      <div>
        <span className="text-[8px] text-muted-foreground font-mono tracking-wider">{label}</span>
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs font-semibold text-foreground">{price === null ? '—' : `$${price.toFixed(2)}`}</span>
          <span className={`flex items-center gap-0.5 font-mono text-[10px] font-bold ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
            {positive ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
            {positive ? '+' : ''}{change.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function SignalDot({ label, count, color, pulse }: { label: string; count: number; color: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-0.5" title={label}>
      <div className={`h-1.5 w-1.5 rounded-full ${pulse && count > 0 ? 'animate-pulse' : ''}`} style={{ backgroundColor: color }} />
      <span className="font-mono text-[10px] font-bold" style={{ color }}>{count}</span>
    </div>
  );
}
