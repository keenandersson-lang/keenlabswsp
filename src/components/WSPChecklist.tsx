import type { EvaluatedStock } from '@/lib/wsp-types';
import { CheckCircle2, XCircle } from 'lucide-react';

interface ChecklistContext {
  volumeRatio: number | null;
  mansfieldRs: number | null;
  sectorEtfSymbol: string | null;
  sectorEtfClose: number | null;
  sectorEtfMa50: number | null;
  sectorEtfAbove50MA: boolean | null;
  stopLossRecommended: number | null;
  stopLossFourPct: number | null;
  stopLossSixPct: number | null;
  stopLossPriorLow: number | null;
}

interface WSPChecklistProps {
  stock: EvaluatedStock;
  context: ChecklistContext;
  onOpenPositionSizer?: () => void;
}

interface ChecklistItem {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

function formatCurrency(value: number | null): string {
  return value == null || !Number.isFinite(value) ? 'N/A' : `$${value.toFixed(2)}`;
}

function renderIcon(passed: boolean) {
  return passed
    ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-signal-buy" />
    : <XCircle className="h-4 w-4 flex-shrink-0 text-signal-sell" />;
}

export function WSPChecklist({ stock, context, onOpenPositionSizer }: WSPChecklistProps) {
  const ma50 = stock.audit.sma50;
  const ma150 = stock.audit.sma150;
  const ma50SlopeRising = stock.audit.sma50SlopeDirection === 'rising';

  const entryCriteria: ChecklistItem[] = [
    {
      id: 'price-above-50ma',
      label: 'Price above 50MA',
      passed: stock.gate.priceAboveMA50,
      detail: `Close: ${formatCurrency(stock.price)} · MA50: ${formatCurrency(ma50)} ${ma50SlopeRising ? '↑ rising' : '↓ not rising'}`,
    },
    {
      id: '50ma-rising',
      label: '50MA is sloping upward',
      passed: ma50SlopeRising,
      detail: `MA50 slope: ${stock.audit.sma50SlopeDirection}`,
    },
    {
      id: 'price-above-150ma',
      label: 'Price above 150MA',
      passed: stock.gate.priceAboveMA150,
      detail: `Close: ${formatCurrency(stock.price)} · MA150: ${formatCurrency(ma150)}`,
    },
    {
      id: 'breakout-volume',
      label: 'Breakout volume ≥ 2x average',
      passed: context.volumeRatio != null && context.volumeRatio >= 2,
      detail: `volume_ratio: ${context.volumeRatio != null ? `${context.volumeRatio.toFixed(2)}x` : 'N/A'}`,
    },
    {
      id: 'mansfield-positive',
      label: 'Mansfield RS positive (> 0)',
      passed: context.mansfieldRs != null && context.mansfieldRs > 0,
      detail: `Mansfield RS: ${context.mansfieldRs != null ? context.mansfieldRs.toFixed(2) : 'N/A'}`,
    },
    {
      id: 'sector-uptrend',
      label: 'Sector is in uptrend (sector ETF above its 50MA)',
      passed: context.sectorEtfAbove50MA === true,
      detail: `${context.sectorEtfSymbol ?? 'Sector ETF'} close: ${formatCurrency(context.sectorEtfClose)} · MA50: ${formatCurrency(context.sectorEtfMa50)}`,
    },
  ];

  const metCount = entryCriteria.filter((criterion) => criterion.passed).length;
  const summaryColor = metCount >= 5 ? 'text-signal-buy' : metCount >= 3 ? 'text-signal-caution' : 'text-signal-sell';

  const exitStillAbove150 = stock.gate.priceAboveMA150;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">ENTRY CRITERIA (all must be true for KÖP)</span>
          <span className={`text-sm font-mono font-bold ${summaryColor}`}>{metCount}/6 criteria met</span>
        </div>
      </div>

      <div className="space-y-2">
        {entryCriteria.map((criterion, idx) => (
          <div key={criterion.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2 text-sm text-foreground">
              {renderIcon(criterion.passed)}
              <span className="font-mono text-xs text-muted-foreground">{idx + 1}.</span>
              <span>{criterion.label}</span>
            </div>
            <p className="mt-1 ml-6 text-xs text-muted-foreground">{criterion.detail}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 text-sm font-semibold text-foreground">EXIT CRITERIA</div>
        <div className="space-y-2">
          <div className="rounded-md border border-border/80 p-3">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <span className="font-mono text-xs text-muted-foreground">7.</span>
              <span>Stop loss level</span>
            </div>
            <p className="mt-1 ml-5 text-xs text-muted-foreground">
              Recommended: {formatCurrency(context.stopLossRecommended)} · 4% below entry: {formatCurrency(context.stopLossFourPct)} · 6% below entry: {formatCurrency(context.stopLossSixPct)} · prior low: {formatCurrency(context.stopLossPriorLow)}
            </p>
          </div>
          <div className="rounded-md border border-border/80 p-3">
            <div className="flex items-center gap-2 text-sm text-foreground">
              {renderIcon(exitStillAbove150)}
              <span className="font-mono text-xs text-muted-foreground">8.</span>
              <span>Price still above 150MA (if NO → SELL signal)</span>
            </div>
            <p className="mt-1 ml-6 text-xs text-muted-foreground">Close: {formatCurrency(stock.price)} · MA150: {formatCurrency(ma150)}</p>
          </div>
        </div>

        {metCount >= 5 && onOpenPositionSizer && (
          <button
            onClick={onOpenPositionSizer}
            className="mt-4 w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Öppna Position Sizer →
          </button>
        )}
      </div>
    </div>
  );
}
