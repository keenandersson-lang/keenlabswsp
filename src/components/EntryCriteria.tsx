import type { EvaluatedStock } from '@/lib/wsp-types';
import { Check, X } from 'lucide-react';

interface EntryCriteriaProps {
  stock: EvaluatedStock;
}

const gateChecks: { key: keyof EvaluatedStock['gate']; label: string }[] = [
  { key: 'patternAllowsEntry', label: 'Mönster = CLIMBING' },
  { key: 'breakoutValid', label: 'Clean breakout ovan resistans' },
  { key: 'breakoutFresh', label: 'Breakout < 8 bars gammalt' },
  { key: 'priceAboveMA50', label: 'Pris > 50 MA' },
  { key: 'ma50Rising', label: '50 MA lutar uppåt' },
  { key: 'priceAboveMA150', label: 'Pris > 150 MA' },
  { key: 'volumeSufficient', label: 'Volym ≥ 2.0x föregående 5 bars snitt' },
  { key: 'mansfieldValid', label: 'Mansfield bullish/transition' },
  { key: 'sectorAligned', label: 'Sektor i upptrend' },
  { key: 'marketFavorable', label: 'Marknadstrend gynnsam' },
];

export function EntryCriteria({ stock }: EntryCriteriaProps) {
  const passCount = gateChecks.filter(c => stock.gate[c.key]).length;

  return (
    <div className="space-y-1.5">
      {gateChecks.map(({ key, label }) => {
        const met = stock.gate[key];
        return (
          <div key={key} className="flex items-center gap-2 text-xs">
            {met ? (
              <Check className="h-3.5 w-3.5 text-signal-buy flex-shrink-0" />
            ) : (
              <X className="h-3.5 w-3.5 text-signal-sell flex-shrink-0" />
            )}
            <span className={met ? 'text-foreground' : 'text-muted-foreground line-through'}>
              {label}
            </span>
          </div>
        );
      })}
      <div className="mt-2 pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs text-muted-foreground">
            Gate: <span className={stock.gate.isValidWspEntry ? 'text-signal-buy font-bold' : 'text-signal-sell font-bold'}>
              {stock.gate.isValidWspEntry ? 'PASS ✓' : 'FAIL ✗'}
            </span>
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {passCount}/{gateChecks.length}
          </span>
        </div>
      </div>
    </div>
  );
}
