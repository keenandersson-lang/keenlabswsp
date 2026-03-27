import type { EvaluatedStock } from '@/lib/wsp-types';
import { CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';

interface WSPChecklistProps {
  stock: EvaluatedStock;
  onOpenPositionSizer?: () => void;
}

const criteria = [
  {
    key: 'sectorAligned' as const,
    label: 'Sektor är i upptrend',
    tooltip: 'WSP kräver att hela sektorn rör sig uppåt. Enskilda aktier följer sektortrender.',
    detail: (s: EvaluatedStock) => `${s.sector} — sektor ${s.gate.sectorAligned ? 'i upptrend' : 'ej i upptrend'}`,
    pass: (s: EvaluatedStock) => s.gate.sectorAligned,
  },
  {
    key: 'priceAboveMA50' as const,
    label: 'Pris är över 50-dagars MA',
    tooltip: 'Aktier under 50MA bör undvikas per WSP — de är i svagt territorium.',
    detail: (s: EvaluatedStock) => {
      const sma50 = s.audit.sma50;
      if (sma50 == null) return 'MA50 ej tillgänglig';
      const pct = ((s.price - sma50) / sma50 * 100).toFixed(1);
      return `Close $${s.price.toFixed(2)} ${s.price > sma50 ? '>' : '<'} MA50 $${sma50.toFixed(2)} (${Number(pct) >= 0 ? '+' : ''}${pct}%)`;
    },
    pass: (s: EvaluatedStock) => s.gate.priceAboveMA50,
  },
  {
    key: 'ma50Rising' as const,
    label: '50-dagars MA lutar uppåt',
    tooltip: 'En stigande 50MA indikerar institutionellt köptryck. Platt eller fallande = varning.',
    detail: (s: EvaluatedStock) => `MA50 slope: ${s.audit.sma50SlopeDirection}`,
    pass: (s: EvaluatedStock) => s.gate.ma50Rising,
  },
  {
    key: 'priceAboveMA150' as const,
    label: 'Pris är över 150-dagars MA',
    tooltip: 'Under 150MA = DOWNHILL pattern. WSP säger sälja omedelbart.',
    detail: (s: EvaluatedStock) => {
      const sma150 = s.audit.sma150;
      if (sma150 == null) return 'MA150 ej tillgänglig';
      const pct = ((s.price - sma150) / sma150 * 100).toFixed(1);
      return `Close $${s.price.toFixed(2)} ${s.price > sma150 ? '>' : '<'} MA150 $${sma150.toFixed(2)} (${Number(pct) >= 0 ? '+' : ''}${pct}%)`;
    },
    pass: (s: EvaluatedStock) => s.gate.priceAboveMA150,
  },
  {
    key: 'volumeSufficient' as const,
    label: 'Volym ≥ 2x veckosnittet',
    tooltip: 'Breakouts utan volym är falska. WSP kräver minst 2x normalvolym. 4-6x är idealt.',
    detail: (s: EvaluatedStock) => {
      const vm = s.audit.volumeMultiple;
      if (vm == null) return 'Volymdata ej tillgänglig';
      return `Idag: ${vm.toFixed(1)}x (behöver ≥ 2.0x för WSP-godkänt)`;
    },
    pass: (s: EvaluatedStock) => s.gate.volumeSufficient,
  },
  {
    key: 'breakoutValid' as const,
    label: 'Breakout över tydlig motståndsnivå',
    tooltip: 'Köp när priset bryter OVANFÖR motstånd, inte när det rör vid det.',
    detail: (s: EvaluatedStock) => {
      const r = s.audit.resistanceLevel;
      if (r == null) return 'Motståndsnivå ej identifierad';
      return `Resistance $${r.toFixed(2)} — pris är nu ${s.price > r ? 'ovanför' : 'under'}`;
    },
    pass: (s: EvaluatedStock) => s.gate.breakoutValid,
  },
  {
    key: 'mansfieldValid' as const,
    label: 'Mansfield RS i upptrend eller nyligen vänt positiv',
    tooltip: 'Mansfield RS mäter aktiens styrka relativt S&P 500. Positiv = outperformar marknaden.',
    detail: (s: EvaluatedStock) => {
      const v = s.audit.mansfieldValue;
      if (v == null) return 'Data ej tillgänglig';
      return `Mansfield RS: ${v.toFixed(2)} (${s.audit.mansfieldTrend})`;
    },
    pass: (s: EvaluatedStock) => s.gate.mansfieldValid,
  },
];

function getScoreSummary(passCount: number, stock: EvaluatedStock): { emoji: string; text: string } {
  const total = criteria.length;
  if (passCount === total) return { emoji: '✅', text: 'Perfekt WSP-setup. Alla kriterier uppfyllda.' };
  if (passCount >= 5) {
    const failing = criteria.filter(c => !c.pass(stock));
    const missing = failing.map(c => c.label).join(', ');
    return { emoji: '⚠️', text: `Nästan klar. ${missing} behöver bekräftas.` };
  }
  if (passCount >= 3) return { emoji: '🔶', text: 'Partiell setup. Vänta på fler bekräftelser.' };
  return { emoji: '🔴', text: 'Undvik köp. För få WSP-kriterier uppfyllda.' };
}

export function WSPChecklist({ stock, onOpenPositionSizer }: WSPChecklistProps) {
  const passCount = criteria.filter(c => c.pass(stock)).length;
  const pct = Math.round((passCount / criteria.length) * 100);
  const summary = getScoreSummary(passCount, stock);

  return (
    <div className="space-y-4">
      <div className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
        Entry Criteria — alla måste vara sanna ✓
      </div>

      <div className="space-y-2">
        {criteria.map((c) => {
          const passed = c.pass(stock);
          return (
            <div key={c.key} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {passed
                    ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-signal-buy" />
                    : <XCircle className="h-4 w-4 flex-shrink-0 text-signal-sell" />}
                  <span className="text-sm text-foreground">{c.label}</span>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="rounded-full p-1 text-muted-foreground hover:text-foreground">
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-[280px] text-xs">
                    {c.tooltip}
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="mt-1 ml-6 text-xs text-muted-foreground">{c.detail(stock)}</p>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-lg font-bold text-foreground">{passCount}/{criteria.length}</span>
          <span className="text-sm text-muted-foreground">kriterier uppfyllda</span>
        </div>
        <Progress value={pct} className="h-2" />
        <p className="text-sm text-muted-foreground">
          {summary.emoji} {summary.text}
        </p>
        {passCount >= 5 && onOpenPositionSizer && (
          <button
            onClick={onOpenPositionSizer}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Öppna Position Sizer →
          </button>
        )}
      </div>
    </div>
  );
}