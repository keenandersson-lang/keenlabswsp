import type { WSPPattern } from '@/lib/wsp-types';
import type { EvaluatedStock } from '@/lib/wsp-types';
import { TrendingUp, TrendingDown, Pause, ArrowDown } from 'lucide-react';

interface PatternSummaryProps {
  stocks: EvaluatedStock[];
}

const icons: Record<WSPPattern, React.ReactNode> = {
  BASE: <Pause className="h-5 w-5" />,
  CLIMBING: <TrendingUp className="h-5 w-5" />,
  TIRED: <Pause className="h-5 w-5" />,
  DOWNHILL: <TrendingDown className="h-5 w-5" />,
};

const config: Record<WSPPattern, { label: string; color: string; bg: string; border: string; action: string }> = {
  BASE: { label: 'Base', color: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/30', action: 'BEVAKA' },
  CLIMBING: { label: 'Climbing', color: 'text-signal-buy', bg: 'bg-signal-buy/10', border: 'border-signal-buy/30', action: 'KÖP om gate PASS' },
  TIRED: { label: 'Tired', color: 'text-signal-caution', bg: 'bg-signal-caution/10', border: 'border-signal-caution/30', action: 'SÄLJ' },
  DOWNHILL: { label: 'Downhill', color: 'text-signal-sell', bg: 'bg-signal-sell/10', border: 'border-signal-sell/30', action: 'UNDVIK' },
};

export function PatternSummary({ stocks }: PatternSummaryProps) {
  const patterns: WSPPattern[] = ['CLIMBING', 'BASE', 'TIRED', 'DOWNHILL'];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {patterns.map(pattern => {
        const c = config[pattern];
        const count = stocks.filter(s => s.pattern === pattern).length;
        return (
          <div
            key={pattern}
            className={`rounded-lg border ${c.border} ${c.bg} p-4 transition-all hover:scale-[1.02]`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`${c.color}`}>{icons[pattern]}</span>
              <span className={`font-mono text-2xl font-bold ${c.color}`}>{count}</span>
            </div>
            <p className={`text-sm font-semibold ${c.color}`}>{c.label}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{c.action}</p>
          </div>
        );
      })}
    </div>
  );
}
