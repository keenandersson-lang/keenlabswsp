import { memo, type ReactNode, useMemo, useState } from 'react';
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, Brush, Cell, Customized } from 'recharts';
import type { Bar as PriceBar, EvaluatedStock } from '@/lib/wsp-types';
import type { ChartTimeframe } from '@/lib/chart-types';
import { barsForTimeframe, clampAsOfIndex } from '@/lib/charting';
import { computeMansfieldSeries, computeRsiSeries, sma } from '@/lib/wsp-indicators';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface StockChartModuleProps {
  stock: EvaluatedStock;
  dailyBars: PriceBar[];
  weeklyBars: PriceBar[];
  dailyBenchmark: PriceBar[];
  weeklyBenchmark: PriceBar[];
  timeframe: ChartTimeframe;
  onTimeframeChange: (value: ChartTimeframe) => void;
  asOfEnabled: boolean;
  onAsOfEnabledChange: (value: boolean) => void;
  asOfIndex: number;
  onAsOfIndexChange: (value: number) => void;
  dataState?: 'LIVE' | 'STALE' | 'FALLBACK' | 'ERROR';
}

const TIMEFRAMES: ChartTimeframe[] = ['1D', '1W', '1M', '3M', '6M', '1Y', '2Y'];

const SMA_COLORS = {
  sma20: '#22d3ee',
  sma50: '#10b981',
  sma150: '#f59e0b',
  sma200: '#a855f7',
} as const;

function computeBollingerBands(bars: PriceBar[], period: number = 20, multiplier: number = 2): { upper: number | null; lower: number | null; middle: number | null }[] {
  return bars.map((_, index, array) => {
    const slice = array.slice(0, index + 1);
    if (slice.length < period) return { upper: null, lower: null, middle: null };
    const window = slice.slice(-period);
    const mean = window.reduce((sum, b) => sum + b.close, 0) / period;
    const variance = window.reduce((sum, b) => sum + Math.pow(b.close - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    return { upper: mean + multiplier * std, lower: mean - multiplier * std, middle: mean };
  });
}

export const StockChartModule = memo(function StockChartModule({
  stock,
  dailyBars,
  weeklyBars,
  dailyBenchmark,
  weeklyBenchmark,
  timeframe,
  onTimeframeChange,
  asOfEnabled,
  onAsOfEnabledChange,
  asOfIndex,
  onAsOfIndexChange,
  dataState = 'LIVE',
}: StockChartModuleProps) {
  const [showBollinger, setShowBollinger] = useState(false);

  const { bars, cadence } = useMemo(() => barsForTimeframe(timeframe, dailyBars, weeklyBars), [timeframe, dailyBars, weeklyBars]);

  const clampedAsOfIndex = clampAsOfIndex(asOfIndex, bars.length);
  const visibleBars = asOfEnabled ? bars.slice(0, clampedAsOfIndex + 1) : bars;
  const asOfDate = visibleBars[visibleBars.length - 1]?.date ?? null;
  const historySourceBars = cadence === 'weekly' ? weeklyBars : dailyBars;
  const benchmarkHistorySourceBars = cadence === 'weekly' ? weeklyBenchmark : dailyBenchmark;

  const fullHistoryBars = useMemo(() => {
    if (!asOfDate) return historySourceBars;
    return historySourceBars.filter((bar) => bar.date <= asOfDate);
  }, [historySourceBars, asOfDate]);

  const fullBenchmarkBars = useMemo(() => {
    if (!asOfDate) return benchmarkHistorySourceBars;
    return benchmarkHistorySourceBars.filter((bar) => bar.date <= asOfDate);
  }, [benchmarkHistorySourceBars, asOfDate]);

  const [zoomRange, setZoomRange] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const zoomedBars = useMemo(() => {
    if (!zoomRange) return visibleBars;
    const start = clampAsOfIndex(zoomRange.startIndex, visibleBars.length);
    const end = clampAsOfIndex(zoomRange.endIndex, visibleBars.length);
    if (start >= end) return visibleBars;
    return visibleBars.slice(start, end + 1);
  }, [visibleBars, zoomRange]);

  const smaSeries = useMemo(() => {
    const periods = [20, 50, 150, 200] as const;
    const maps = {
      20: new Map<string, number | null>(),
      50: new Map<string, number | null>(),
      150: new Map<string, number | null>(),
      200: new Map<string, number | null>(),
    } as const;

    for (let index = 0; index < fullHistoryBars.length; index += 1) {
      const bar = fullHistoryBars[index];
      const slice = fullHistoryBars.slice(0, index + 1);
      for (const period of periods) {
        maps[period].set(bar.date, sma(slice, period));
      }
    }

    return maps;
  }, [fullHistoryBars]);

  const rsiByDate = useMemo(
    () => new Map(computeRsiSeries(fullHistoryBars).map((item) => [item.date, item.value])),
    [fullHistoryBars],
  );

  const mansfieldByDate = useMemo(
    () => new Map(computeMansfieldSeries(fullHistoryBars, fullBenchmarkBars).map((item) => [item.date, item.value])),
    [fullHistoryBars, fullBenchmarkBars],
  );

  const chartData = useMemo(() => {
    const bbands = showBollinger ? computeBollingerBands(zoomedBars) : null;

    return zoomedBars.map((bar, index) => {
      return {
        ...bar,
        isBull: bar.close >= bar.open,
        sma20: smaSeries[20].get(bar.date) ?? null,
        sma50: smaSeries[50].get(bar.date) ?? null,
        sma150: smaSeries[150].get(bar.date) ?? null,
        sma200: smaSeries[200].get(bar.date) ?? null,
        rsi: rsiByDate.get(bar.date) ?? null,
        mansfield: mansfieldByDate.get(bar.date) ?? null,
        bbUpper: bbands?.[index]?.upper ?? null,
        bbLower: bbands?.[index]?.lower ?? null,
      };
    });
  }, [zoomedBars, showBollinger, smaSeries, rsiByDate, mansfieldByDate]);

  const hasMansfieldData = chartData.some((entry) => typeof entry.mansfield === 'number' && Number.isFinite(entry.mansfield));

  const breakoutIndex = stock.indicators.barsSinceBreakout !== null
    ? Math.max(0, chartData.length - 1 - stock.indicators.barsSinceBreakout)
    : null;
  const breakoutDate = breakoutIndex !== null ? chartData[breakoutIndex]?.date : null;

  const currentPrice = chartData.length > 0 ? chartData[chartData.length - 1].close : null;

  if (bars.length === 0) {
    return <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground font-mono">No chart data available for this symbol.</div>;
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ToggleGroup type="single" value={timeframe} onValueChange={(value) => value && onTimeframeChange(value as ChartTimeframe)} className="rounded border border-border bg-background p-0.5">
            {TIMEFRAMES.map((tf) => (
              <ToggleGroupItem key={tf} value={tf} className="px-2 py-1 text-[10px] font-mono data-[state=on]:bg-primary/20 data-[state=on]:text-primary">
                {tf}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <button
            onClick={() => setShowBollinger(!showBollinger)}
            className={`rounded border px-2 py-1 text-[10px] font-mono transition-colors ${showBollinger ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            BB
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* SMA Legend */}
          <div className="hidden sm:flex items-center gap-2">
            {Object.entries(SMA_COLORS).map(([key, color]) => (
              <span key={key} className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground">
                <span className="inline-block h-[2px] w-3 rounded" style={{ backgroundColor: color }} />
                {key.toUpperCase()}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Label htmlFor="asof-mode" className="text-[10px] text-muted-foreground font-mono">AS-OF</Label>
            <Switch id="asof-mode" checked={asOfEnabled} onCheckedChange={onAsOfEnabledChange} />
            <span className="rounded border border-border px-1.5 py-0.5 font-mono uppercase text-[9px]">{cadence}</span>
          </div>
        </div>
      </div>

      {/* Info strip */}
      <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-mono">
        <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">{stock.pattern}</span>
        <span className={`rounded border px-1.5 py-0.5 ${stock.finalRecommendation === 'KÖP' ? 'border-signal-buy/30 bg-signal-buy/10 text-signal-buy' : stock.finalRecommendation === 'SÄLJ' ? 'border-signal-sell/30 bg-signal-sell/10 text-signal-sell' : 'border-border text-muted-foreground'}`}>
          {stock.finalRecommendation}
        </span>
        <span className={`rounded border px-1.5 py-0.5 ${dataState === 'LIVE' ? 'border-signal-buy/25 bg-signal-buy/10 text-signal-buy' : 'border-signal-caution/30 bg-signal-caution/10 text-signal-caution'}`}>
          {dataState}
        </span>
        {stock.blockedReasons.length > 0 && <span className="rounded border border-signal-caution/25 bg-signal-caution/10 px-1.5 py-0.5 text-signal-caution">{stock.blockedReasons.length} blockers</span>}
        {currentPrice !== null && (
          <span className="ml-auto rounded border border-primary/20 bg-primary/5 px-2 py-0.5 text-primary font-semibold">
            ${currentPrice.toFixed(2)}
          </span>
        )}
      </div>

      {asOfEnabled && (
        <div className="grid gap-2 rounded border border-primary/20 bg-primary/5 p-2 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <div className="mb-1.5 text-[10px] text-muted-foreground font-mono">Cutoff: {bars[clampedAsOfIndex]?.date ?? 'N/A'}</div>
            <Slider
              value={[clampedAsOfIndex]}
              max={Math.max(0, bars.length - 1)}
              step={1}
              onValueChange={(value) => onAsOfIndexChange(value[0] ?? bars.length - 1)}
            />
          </div>
          <Input
            type="date"
            value={bars[clampedAsOfIndex]?.date}
            max={bars[bars.length - 1]?.date}
            min={bars[0]?.date}
            onChange={(event) => {
              const targetDate = event.target.value;
              let idx = -1;
              for (let i = bars.length - 1; i >= 0; i--) { if (bars[i].date <= targetDate) { idx = i; break; } }
              onAsOfIndexChange(idx >= 0 ? idx : bars.length - 1);
            }}
            className="h-7 w-full md:w-[150px] font-mono text-[10px]"
          />
        </div>
      )}

      {/* Main price chart + RSI sub-panel */}
      <div className="grid h-[600px] w-full grid-rows-[1fr_120px] gap-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} syncId="stock-detail-sync" margin={{ left: 0, right: 8, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="hsl(220 14% 14%)" vertical={false} />
            <XAxis dataKey="date" hide />
            <YAxis yAxisId="price" domain={[(v: number) => Math.max(0, v * 0.985), (v: number) => v * 1.015]} tick={{ fill: 'hsl(215 15% 50%)', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }} width={68} orientation="right" axisLine={{ stroke: 'hsl(220 14% 18%)' }} tickLine={false} />
            <YAxis yAxisId="volume" hide domain={[0, 'dataMax']} />
            <Tooltip content={<PriceTooltip />} cursor={{ stroke: 'hsl(160 80% 45%)', strokeDasharray: '2 2', strokeWidth: 0.5 }} />

            {/* Invisible bar for Customized alignment */}
            <Bar yAxisId="price" dataKey="close" fill="transparent" stroke="transparent" isAnimationActive={false} legendType="none" />
            <Bar yAxisId="volume" dataKey="volume" isAnimationActive={false} legendType="none" barSize={4}>
              {chartData.map((entry) => <Cell key={`vol-overlay-${entry.date}`} fill={entry.isBull ? 'rgba(34,197,94,0.22)' : 'rgba(239,68,68,0.22)'} />)}
            </Bar>
            <Customized component={(customProps: any) => <CandlestickLayer {...customProps} />} />

            {/* Bollinger Bands */}
            {showBollinger && (
              <>
                <Line yAxisId="price" type="monotone" dataKey="bbUpper" dot={false} stroke="rgba(148,163,184,0.3)" strokeWidth={1} strokeDasharray="3 3" isAnimationActive={false} />
                <Line yAxisId="price" type="monotone" dataKey="bbLower" dot={false} stroke="rgba(148,163,184,0.3)" strokeWidth={1} strokeDasharray="3 3" isAnimationActive={false} />
              </>
            )}

            {/* SMA overlays */}
            <Line yAxisId="price" type="monotone" dataKey="sma20" dot={false} stroke={SMA_COLORS.sma20} strokeWidth={1} isAnimationActive={false} />
            <Line yAxisId="price" type="monotone" dataKey="sma50" dot={false} stroke={SMA_COLORS.sma50} strokeWidth={1.5} isAnimationActive={false} />
            <Line yAxisId="price" type="monotone" dataKey="sma150" dot={false} stroke={SMA_COLORS.sma150} strokeWidth={1.2} isAnimationActive={false} />
            <Line yAxisId="price" type="monotone" dataKey="sma200" dot={false} stroke={SMA_COLORS.sma200} strokeWidth={1.5} isAnimationActive={false} />

            {/* Technical levels */}
            {stock.audit.resistanceLevel !== null && <ReferenceLine yAxisId="price" y={stock.audit.resistanceLevel} stroke="#eab308" strokeDasharray="4 4" strokeWidth={0.8} label={{ value: 'R', fill: '#eab308', fontSize: 9, fontFamily: 'JetBrains Mono' }} />}
            {stock.audit.breakoutLevel !== null && <ReferenceLine yAxisId="price" y={stock.audit.breakoutLevel} stroke="#3b82f6" strokeDasharray="3 3" strokeWidth={0.8} label={{ value: 'BO', fill: '#60a5fa', fontSize: 9, fontFamily: 'JetBrains Mono' }} />}
            {currentPrice !== null && <ReferenceLine yAxisId="price" y={currentPrice} stroke="hsl(160 80% 45%)" strokeDasharray="6 3" strokeWidth={0.6} label={{ value: `$${currentPrice.toFixed(2)}`, fill: 'hsl(160 80% 45%)', fontSize: 9, fontFamily: 'JetBrains Mono', position: 'right' }} />}
            {stock.audit.resistanceUpperBound !== null && stock.audit.resistanceLevel !== null && (
              <ReferenceArea yAxisId="price" y1={stock.audit.resistanceLevel} y2={stock.audit.resistanceUpperBound} fill="#eab308" fillOpacity={0.04} />
            )}
            {breakoutDate && <ReferenceLine yAxisId="price" x={breakoutDate} stroke="#60a5fa" strokeDasharray="4 4" strokeWidth={0.6} label={{ value: '▲ BO', fill: '#93c5fd', fontSize: 8, position: 'insideTopLeft', fontFamily: 'JetBrains Mono' }} />}

            <Brush dataKey="date" height={20} stroke="hsl(220 14% 18%)" fill="hsl(220 20% 7%)" tickFormatter={() => ''} onChange={(range) => {
              if (!range || range.startIndex == null || range.endIndex == null) {
                setZoomRange(null);
              } else {
                setZoomRange({ startIndex: range.startIndex, endIndex: range.endIndex });
              }
            }} />
          </ComposedChart>
        </ResponsiveContainer>

        <div className="h-[120px] rounded border border-border bg-background p-1.5">
          <div className="mb-0.5 text-[9px] font-mono font-medium text-muted-foreground uppercase tracking-widest px-1">RSI (14)</div>
          <ResponsiveContainer width="100%" height="85%">
            <ComposedChart data={chartData} syncId="stock-detail-sync">
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(220 14% 14%)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: 'hsl(215 15% 50%)', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }} minTickGap={40} axisLine={{ stroke: 'hsl(220 14% 18%)' }} tickLine={false} />
              <YAxis tick={{ fill: 'hsl(215 15% 50%)', fontSize: 8, fontFamily: 'JetBrains Mono, monospace' }} width={38} axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip content={<IndicatorTooltip title="RSI (14)" valueKey="rsi" />} cursor={{ stroke: 'hsl(160 80% 45%)', strokeDasharray: '2 2', strokeWidth: 0.5 }} />
              <ReferenceLine y={70} stroke="rgba(148,163,184,0.35)" strokeDasharray="4 4" />
              <ReferenceLine y={30} stroke="rgba(148,163,184,0.35)" strokeDasharray="4 4" />
              <Line dataKey="rsi" type="monotone" dot={false} stroke="#60a5fa" strokeWidth={1.2} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Additional indicator */}
      <div className="grid gap-2">
        <IndicatorPanel title="Mansfield RS" dataKey="mansfield" data={chartData} thresholds={[0]} emptyState={hasMansfieldData ? null : 'Mansfield unavailable — benchmark data insufficient.'} />
      </div>
    </div>
  );
});

function IndicatorPanel({ title, data, dataKey, thresholds, emptyState }: {
  title: string;
  data: Array<Record<string, unknown>>;
  dataKey: string;
  thresholds: number[];
  emptyState?: string | null;
}) {
  const hasValues = data.some((row) => typeof row[dataKey] === 'number' && Number.isFinite(row[dataKey] as number));

  if (!hasValues) {
    return (
      <div className="h-[110px] rounded border border-border bg-background p-1.5">
        <div className="mb-0.5 text-[9px] font-mono font-medium text-muted-foreground uppercase tracking-widest px-1">{title}</div>
        <div className="flex h-[80%] items-center justify-center text-center text-[10px] text-muted-foreground font-mono">
          {emptyState ?? `${title} unavailable.`}
        </div>
      </div>
    );
  }

  return (
    <div className="h-[110px] rounded border border-border bg-background p-1.5">
      <div className="mb-0.5 text-[9px] font-mono font-medium text-muted-foreground uppercase tracking-widest px-1">{title}</div>
      <ResponsiveContainer width="100%" height="85%">
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsl(220 14% 14%)" vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis tick={{ fill: 'hsl(215 15% 50%)', fontSize: 8, fontFamily: 'JetBrains Mono, monospace' }} width={38} axisLine={false} tickLine={false} />
          <Tooltip content={<IndicatorTooltip title={title} valueKey={dataKey} />} cursor={{ stroke: 'hsl(160 80% 45%)', strokeDasharray: '2 2', strokeWidth: 0.5 }} />
          {thresholds.map((line) => <ReferenceLine key={`${title}-${line}`} y={line} stroke="rgba(148,163,184,0.35)" strokeDasharray="4 4" />)}
          <Line dataKey={dataKey} type="monotone" dot={false} stroke="#60a5fa" strokeWidth={1.2} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function TooltipCard({ children }: { children: ReactNode }) {
  return <div className="rounded border border-border bg-card/95 p-2 text-[10px] font-mono text-foreground shadow-lg backdrop-blur">{children}</div>;
}

function PriceTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const candle = payload[0]?.payload;
  if (!candle) return null;

  return (
    <TooltipCard>
      <div className="mb-1 text-[10px] font-semibold text-primary">{label}</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0">
        <span className="text-muted-foreground">O</span><span>{formatNumber(candle.open)}</span>
        <span className="text-muted-foreground">H</span><span>{formatNumber(candle.high)}</span>
        <span className="text-muted-foreground">L</span><span>{formatNumber(candle.low)}</span>
        <span className="text-muted-foreground">C</span><span className={candle.close >= candle.open ? 'text-signal-buy' : 'text-signal-sell'}>{formatNumber(candle.close)}</span>
        <span className="text-muted-foreground">Vol</span><span>{Math.round(Number(candle.volume) || 0).toLocaleString()}</span>
      </div>
      <div className="mt-1 border-t border-border pt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0">
        <span style={{ color: SMA_COLORS.sma20 }}>S20</span><span>{formatNumber(candle.sma20)}</span>
        <span style={{ color: SMA_COLORS.sma50 }}>S50</span><span>{formatNumber(candle.sma50)}</span>
        <span style={{ color: SMA_COLORS.sma150 }}>S150</span><span>{formatNumber(candle.sma150)}</span>
        <span style={{ color: SMA_COLORS.sma200 }}>S200</span><span>{formatNumber(candle.sma200)}</span>
        <span className="text-muted-foreground">RSI</span><span>{formatNumber(candle.rsi)}</span>
        <span className="text-muted-foreground">MRS</span><span>{formatNumber(candle.mansfield)}</span>
      </div>
    </TooltipCard>
  );
}

function IndicatorTooltip({ active, payload, label, title, valueKey }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <TooltipCard>
      <div className="text-[10px] font-semibold text-primary">{label}</div>
      <div className="text-[10px]">{title}: {formatNumber(row[valueKey])}</div>
    </TooltipCard>
  );
}

function formatNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
}

function CandlestickLayer(props: any) {
  const { formattedGraphicalItems, xAxisMap, yAxisMap, offset } = props;
  const payload = formattedGraphicalItems?.[0]?.props?.data ?? [];
  const xAxis = xAxisMap?.[0];
  const yAxis = yAxisMap?.price ?? yAxisMap?.[0];
  const xScale = xAxis?.scale;
  const yScale = yAxis?.scale;

  if (!Array.isArray(payload) || payload.length === 0 || typeof xScale !== 'function' || typeof yScale !== 'function') {
    return null;
  }

  const bandWidth = typeof xScale.bandwidth === 'function' ? xScale.bandwidth() : 0;
  const candleWidth = Math.max(2, Math.min(10, bandWidth > 0 ? bandWidth * 0.65 : 5));
  const clipId = 'stock-candles-clip';

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={offset?.left ?? 0} y={offset?.top ?? 0} width={offset?.width ?? 0} height={offset?.height ?? 0} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {payload.map((bar: any) => {
          const open = Number(bar.open);
          const high = Number(bar.high);
          const low = Number(bar.low);
          const close = Number(bar.close);
          if (![open, high, low, close].every(Number.isFinite)) return null;

          const baseX = xScale(bar.date);
          if (!Number.isFinite(baseX)) return null;

          const centerX = baseX + (bandWidth > 0 ? bandWidth / 2 : 0);
          const openY = yScale(open);
          const highY = yScale(high);
          const lowY = yScale(low);
          const closeY = yScale(close);
          if (![openY, highY, lowY, closeY].every(Number.isFinite)) return null;

          const isBull = close >= open;
          const color = isBull ? '#22c55e' : '#ef4444';
          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(1, Math.abs(openY - closeY));
          const bodyX = centerX - candleWidth / 2;

          return (
            <g key={`candle-${bar.date}`}>
              <line x1={centerX} x2={centerX} y1={highY} y2={lowY} stroke={color} strokeWidth={0.8} />
              <rect x={bodyX} y={bodyTop} width={candleWidth} height={bodyHeight} fill={color} opacity={0.85} />
            </g>
          );
        })}
      </g>
    </g>
  );
}
