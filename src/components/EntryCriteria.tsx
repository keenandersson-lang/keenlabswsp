import { StockData } from '@/lib/wsp-engine';
import { Check, X } from 'lucide-react';

interface EntryCriteriaProps {
  stock: StockData;
}

const criteria = [
  { key: 'breakoutConfirmed' as const, label: 'Breakout ovan resistans' },
  { key: 'aboveMA50' as const, label: 'Pris > 50 MA' },
  { key: 'ma50SlopingUp' as const, label: '50 MA lutar uppåt' },
  { key: 'aboveMA150' as const, label: 'Pris > 150 MA' },
  { key: 'volumeBreakout' as const, label: 'Volym ≥ 2x snitt' },
  { key: 'mansfieldBullish' as const, label: 'Mansfield RS bullish' },
];

export function EntryCriteria({ stock }: EntryCriteriaProps) {
  return (
    <div className="space-y-1.5">
      {criteria.map(({ key, label }) => {
        const met = stock[key];
        return (
          <div key={key} className="flex items-center gap-2 text-xs">
            {met ? (
              <Check className="h-3.5 w-3.5 text-signal-buy flex-shrink-0" />
            ) : (
              <X className="h-3.5 w-3.5 text-signal-sell flex-shrink-0" />
            )}
            <span className={met ? 'text-foreground' : 'text-muted-foreground'}>
              {label}
            </span>
          </div>
        );
      })}
      <div className="mt-2 pt-2 border-t border-border">
        <span className="font-mono text-xs text-muted-foreground">
          Score: <span className={stock.entryScore >= 5 ? 'text-signal-buy font-bold' : stock.entryScore >= 3 ? 'text-signal-caution font-bold' : 'text-signal-sell font-bold'}>{stock.entryScore}/6</span>
        </span>
      </div>
    </div>
  );
}
