import { Activity, ArrowUpRight, ArrowDownRight, AlertTriangle, RefreshCw, Wifi, WifiOff, Clock3, ServerCrash } from 'lucide-react';
import type { MarketOverview, ScreenerUiState } from '@/lib/wsp-types';

interface MarketHeaderProps {
  market: MarketOverview;
  buyCount: number;
  sellCount: number;
  watchCount: number;
  avoidCount: number;
  totalStocks: number;
  uiState: ScreenerUiState;
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
  uiState,
  isFetching,
  pollingIntervalMs,
  onRefresh,
  onPollingIntervalChange,
}: MarketHeaderProps) {
  const stateMeta = getStateMeta(uiState);

  return (
    <div className="border-b border-border bg-card/50 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">WSP Screener</h1>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">Wall Street Protocol • {market.lastUpdated}</p>
                <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${stateMeta.className}`}>
                  <stateMeta.icon className="h-2.5 w-2.5" />
                  {uiState}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 xl:items-end">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-4">
                <IndexChip label="S&P 500" change={market.sp500Change} />
                <IndexChip label="NASDAQ" change={market.nasdaqChange} />
              </div>

              <div className="hidden h-8 w-px bg-border lg:block" />

              <div className="flex flex-wrap items-center gap-3">
                <SignalChip label="KÖP" count={buyCount} dotClass="bg-signal-buy" textClass="text-signal-buy" pulse />
                <SignalChip label="BEVAKA" count={watchCount} dotClass="bg-accent" textClass="text-accent" />
                <SignalChip label="SÄLJ" count={sellCount} dotClass="bg-signal-caution" textClass="text-signal-caution" />
                <SignalChip label="UNDVIK" count={avoidCount} dotClass="bg-signal-sell" textClass="text-signal-sell" />
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-sm text-muted-foreground">{totalStocks}</span>
                  <span className="text-xs text-muted-foreground">totalt</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                <span>Polling</span>
                <select
                  value={pollingIntervalMs}
                  onChange={(event) => onPollingIntervalChange(Number(event.target.value))}
                  className="bg-transparent text-foreground outline-none"
                >
                  {pollingOptions.map((option) => (
                    <option key={option} value={option}>
                      {formatInterval(option)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getStateMeta(uiState: ScreenerUiState) {
  switch (uiState) {
    case 'LIVE':
      return { icon: Wifi, className: 'border-signal-buy/30 bg-signal-buy/10 text-signal-buy' };
    case 'STALE':
      return { icon: Clock3, className: 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution' };
    case 'FALLBACK':
      return { icon: AlertTriangle, className: 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution' };
    case 'ERROR':
      return { icon: ServerCrash, className: 'border-signal-sell/30 bg-signal-sell/10 text-signal-sell' };
    default:
      return { icon: WifiOff, className: 'border-border bg-background text-muted-foreground' };
  }
}

function formatInterval(value: number) {
  const minutes = Math.round(value / 60_000);
  return `${minutes}m`;
}

function IndexChip({ label, change }: { label: string; change: number }) {
  const positive = change >= 0;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className={`flex items-center gap-0.5 font-mono text-sm font-medium ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
        {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
        {positive ? '+' : ''}{change.toFixed(2)}%
      </div>
    </div>
  );
}

function SignalChip({ label, count, dotClass, textClass, pulse }: { label: string; count: number; dotClass: string; textClass: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`h-2 w-2 rounded-full ${dotClass} ${pulse ? 'animate-pulse-subtle' : ''}`} />
      <span className={`font-mono text-sm font-semibold ${textClass}`}>{count}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
