import type { EvaluatedStock } from '@/lib/wsp-types';

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
  const passCount = gateChecks.filter((criterion) => stock.gate[criterion.key]).length;

  return (
    <div className="space-y-2">
      {gateChecks.map(({ key, label }) => {
        const met = stock.gate[key];
        return (
          <div key={key} className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-card/40 px-2.5 py-2 text-xs">
            <span className={met ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
            <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${met ? 'border-signal-buy/30 bg-signal-buy/10 text-signal-buy' : 'border-signal-sell/30 bg-signal-sell/10 text-signal-sell'}`}>
              {met ? 'YES / PASS' : 'NO / FAIL'}
            </span>
          </div>
        );
      })}
      <div className="mt-2 border-t border-border pt-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs text-muted-foreground">
            Gate overall:{' '}
            <span className={stock.gate.isValidWspEntry ? 'font-bold text-signal-buy' : 'font-bold text-signal-sell'}>
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
