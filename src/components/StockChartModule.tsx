import { memo, useMemo, useState } from 'react';
import { BarChart, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, Brush, Cell } from 'recharts';
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
}

const TIMEFRAMES: ChartTimeframe[] = ['1D', '1W', '1M', '3M', '6M', '1Y', '2Y'];

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
}: StockChartModuleProps) {
  const { bars, cadence } = useMemo(() => barsForTimeframe(timeframe, dailyBars, weeklyBars), [timeframe, dailyBars, weeklyBars]);
  const benchmarkBars = barsForTimeframe(timeframe, dailyBenchmark, weeklyBenchmark).bars;

  const clampedAsOfIndex = clampAsOfIndex(asOfIndex, bars.length);
  const visibleBars = asOfEnabled ? bars.slice(0, clampedAsOfIndex + 1) : bars;

  const [zoomRange, setZoomRange] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const zoomedBars = useMemo(() => {
    if (!zoomRange) return visibleBars;
    const start = clampAsOfIndex(zoomRange.startIndex, visibleBars.length);
    const end = clampAsOfIndex(zoomRange.endIndex, visibleBars.length);
    if (start >= end) return visibleBars;
    return visibleBars.slice(start, end + 1);
  }, [visibleBars, zoomRange]);

  const chartData = useMemo(() => {
    const rsi = new Map(computeRsiSeries(visibleBars).map((item) => [item.date, item.value]));
    const mansfield = new Map(computeMansfieldSeries(visibleBars, benchmarkBars).map((item) => [item.date, item.value]));

    return zoomedBars.map((bar, index, array) => {
      const localSeries = array.slice(0, index + 1);
      return {
        ...bar,
        isBull: bar.close >= bar.open,
        sma20: sma(localSeries, 20),
        sma50: sma(localSeries, 50),
        sma150: sma(localSeries, 150),
        sma200: sma(localSeries, 200),
        rsi: rsi.get(bar.date) ?? null,
        mansfield: mansfield.get(bar.date) ?? null,
      };
    });
  }, [zoomedBars, visibleBars, benchmarkBars]);

  const breakoutIndex = stock.indicators.barsSinceBreakout !== null
    ? Math.max(0, chartData.length - 1 - stock.indicators.barsSinceBreakout)
    : null;
  const breakoutDate = breakoutIndex !== null ? chartData[breakoutIndex]?.date : null;

  if (bars.length === 0) {
    return <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">No chart data available for this symbol.</div>;
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" value={timeframe} onValueChange={(value) => value && onTimeframeChange(value as ChartTimeframe)} className="rounded-md border border-border bg-background p-1">
          {TIMEFRAMES.map((tf) => (
            <ToggleGroupItem key={tf} value={tf} className="px-2.5 py-1 text-xs data-[state=on]:bg-primary/20 data-[state=on]:text-primary">
              {tf}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Label htmlFor="asof-mode" className="text-xs text-muted-foreground">As-Of mode</Label>
          <Switch id="asof-mode" checked={asOfEnabled} onCheckedChange={onAsOfEnabledChange} />
          <span className="rounded border border-border px-2 py-0.5 font-mono uppercase">{cadence}</span>
        </div>
      </div>

      {asOfEnabled && (
        <div className="grid gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <div className="mb-2 text-xs text-muted-foreground">Historical cutoff: {bars[clampedAsOfIndex]?.date ?? 'N/A'}</div>
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
            className="h-8 w-full md:w-[160px]"
          />
        </div>
      )}

      <div className="h-[460px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} syncId="stock-detail-sync" margin={{ left: 4, right: 8, top: 8, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} minTickGap={36} />
            <YAxis yAxisId="price" domain={['dataMin - 2', 'dataMax + 2']} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} width={72} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} labelStyle={{ color: 'hsl(var(--foreground))' }} cursor={{ stroke: 'hsl(var(--primary))', strokeDasharray: '4 4' }} />

            <Bar yAxisId="price" dataKey="close" shape={<CandlestickShape />} isAnimationActive={false} />

            <Line yAxisId="price" type="monotone" dataKey="sma20" dot={false} stroke="#22d3ee" strokeWidth={1.4} isAnimationActive={false} />
            <Line yAxisId="price" type="monotone" dataKey="sma50" dot={false} stroke="#10b981" strokeWidth={1.5} isAnimationActive={false} />
            <Line yAxisId="price" type="monotone" dataKey="sma150" dot={false} stroke="#f59e0b" strokeWidth={1.4} isAnimationActive={false} />
            <Line yAxisId="price" type="monotone" dataKey="sma200" dot={false} stroke="#a855f7" strokeWidth={1.6} isAnimationActive={false} />

            {stock.audit.resistanceLevel !== null && <ReferenceLine yAxisId="price" y={stock.audit.resistanceLevel} stroke="#eab308" strokeDasharray="4 4" label={{ value: 'Resistance', fill: '#eab308', fontSize: 10 }} />}
            {stock.audit.breakoutLevel !== null && <ReferenceLine yAxisId="price" y={stock.audit.breakoutLevel} stroke="#3b82f6" strokeDasharray="3 3" label={{ value: 'Breakout', fill: '#60a5fa', fontSize: 10 }} />}
            {stock.audit.resistanceUpperBound !== null && stock.audit.resistanceLevel !== null && (
              <ReferenceArea yAxisId="price" y1={stock.audit.resistanceLevel} y2={stock.audit.resistanceUpperBound} fill="#eab308" fillOpacity={0.08} />
            )}
            {breakoutDate && <ReferenceLine x={breakoutDate} stroke="#60a5fa" strokeDasharray="6 4" label={{ value: 'Breakout bar', fill: '#93c5fd', fontSize: 10, position: 'insideTopLeft' }} />}

            <Brush dataKey="date" height={24} stroke="#3b82f6" onChange={(range) => {
              if (!range || range.startIndex == null || range.endIndex == null) {
                setZoomRange(null);
              } else {
                setZoomRange({ startIndex: range.startIndex, endIndex: range.endIndex });
              }
            }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="h-[150px] rounded-md border border-border bg-background p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} syncId="stock-detail-sync">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" hide />
              <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} width={54} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} cursor={{ stroke: 'hsl(var(--primary))', strokeDasharray: '4 4' }} />
              <Bar dataKey="volume" isAnimationActive={false}>
                {chartData.map((entry) => <Cell key={`vol-${entry.date}`} fill={entry.isBull ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid gap-3">
          <IndicatorPanel title="RSI (14)" dataKey="rsi" data={chartData} thresholds={[70, 30]} />
          <IndicatorPanel title="Mansfield RS" dataKey="mansfield" data={chartData} thresholds={[0]} />
        </div>
      </div>
    </div>
  );
});

function IndicatorPanel({ title, data, dataKey, thresholds }: {
  title: string;
  data: Array<Record<string, unknown>>;
  dataKey: string;
  thresholds: number[];
}) {
  return (
    <div className="h-[120px] rounded-md border border-border bg-background p-2">
      <div className="mb-1 text-[11px] font-medium text-muted-foreground">{title}</div>
      <ResponsiveContainer width="100%" height="85%">
        <ComposedChart data={data} syncId="stock-detail-sync">
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" hide />
          <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} width={42} />
          <Tooltip contentStyle={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} cursor={{ stroke: 'hsl(var(--primary))', strokeDasharray: '4 4' }} />
          {thresholds.map((line) => <ReferenceLine key={`${title}-${line}`} y={line} stroke="rgba(148,163,184,0.6)" strokeDasharray="4 4" />)}
          <Line dataKey={dataKey} type="monotone" dot={false} stroke="#60a5fa" strokeWidth={1.5} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function CandlestickShape(props: any) {
  const { x, width, payload, yAxis } = props;
  if (!payload || !yAxis?.scale) return null;
  const scale = yAxis.scale;
  const openY = scale(payload.open);
  const closeY = scale(payload.close);
  const highY = scale(payload.high);
  const lowY = scale(payload.low);
  const bodyTop = Math.min(openY, closeY);
  const bodyHeight = Math.max(1, Math.abs(openY - closeY));
  const color = payload.close >= payload.open ? '#22c55e' : '#ef4444';
  const centerX = x + (width / 2);

  return (
    <g>
      <line x1={centerX} y1={highY} x2={centerX} y2={lowY} stroke={color} strokeWidth={1} />
      <rect x={x + 1} y={bodyTop} width={Math.max(1, width - 2)} height={bodyHeight} fill={color} opacity={0.85} />
    </g>
  );
}
