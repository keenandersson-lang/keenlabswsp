import { Activity, ArrowUpRight, ArrowDownRight, RefreshCw, Wifi, WifiOff, Clock3, ServerCrash, AlertTriangle, Shield } from 'lucide-react';
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
    <header className="border-b border-border bg-card/80 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Brand + status */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
              <Activity className="h-4.5 w-4.5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-foreground">WSP Screener</h1>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${stateMeta.className}`}>
                  <stateMeta.icon className="h-2.5 w-2.5" />
                  {uiState}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground truncate">Wall Street Protocol · Strict 3-Layer Engine</p>
            </div>
          </div>

          {/* Benchmarks + Signals + Controls */}
          <div className="flex flex-col gap-2 lg:items-end">
            <div className="flex flex-wrap items-center gap-4">
              <BenchmarkChip label="S&P 500" symbol={market.sp500Symbol} change={market.sp500Change} price={market.sp500Price} />
              <div className="hidden h-6 w-px bg-border lg:block" />
              <BenchmarkChip label="Nasdaq" symbol={market.nasdaqSymbol} change={market.nasdaqChange} price={market.nasdaqPrice} />
              <div className="hidden h-6 w-px bg-border lg:block" />
              <div className="flex items-center gap-2.5">
                <SignalDot label="KÖP" count={buyCount} colorVar="signal-buy" pulse />
                <SignalDot label="BEVAKA" count={watchCount} colorVar="accent" />
                <SignalDot label="SÄLJ" count={sellCount} colorVar="signal-caution" />
                <SignalDot label="UNDVIK" count={avoidCount} colorVar="signal-sell" />
                <span className="text-[11px] text-muted-foreground">{totalStocks} <span className="hidden sm:inline">tracked</span></span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-muted-foreground">
                <Clock3 className="h-3 w-3" />
                <select
                  value={pollingIntervalMs}
                  onChange={(e) => onPollingIntervalChange(Number(e.target.value))}
                  className="bg-transparent text-foreground outline-none text-xs"
                >
                  {pollingOptions.map((opt) => (
                    <option key={opt} value={opt}>{formatInterval(opt)}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
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
  return `${Math.round(value / 60_000)}m`;
}

function BenchmarkChip({ label, symbol, change, price }: { label: string; symbol: string; change: number; price: number | null }) {
  const positive = change >= 0;
  return (
    <div className="flex items-center gap-2">
      <div>
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-sm font-medium text-foreground">{price === null ? '—' : `$${price.toFixed(2)}`}</span>
          <span className={`flex items-center gap-0.5 font-mono text-xs font-semibold ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
            {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {positive ? '+' : ''}{change.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function SignalDot({ label, count, colorVar, pulse }: { label: string; count: number; colorVar: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-1" title={label}>
      <div className={`h-1.5 w-1.5 rounded-full bg-${colorVar} ${pulse && count > 0 ? 'animate-pulse' : ''}`} />
      <span className={`font-mono text-xs font-semibold text-${colorVar}`}>{count}</span>
    </div>
  );
}
