import type { WSPPattern } from '@/lib/wsp-types';
import { TrendingUp, TrendingDown, Pause } from 'lucide-react';

interface PatternSummaryProps {
  counts: Record<WSPPattern, number>;
}

const icons: Record<WSPPattern, React.ReactNode> = {
  base_or_climbing: <Pause className="h-5 w-5" />,
  base: <Pause className="h-5 w-5" />,
  climbing: <TrendingUp className="h-5 w-5" />,
  tired: <Pause className="h-5 w-5" />,
  downhill: <TrendingDown className="h-5 w-5" />,
};

const config: Record<WSPPattern, { label: string; color: string; bg: string; border: string; action: string }> = {
  base_or_climbing: { label: 'Base/Climbing', color: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/30', action: 'BEVAKA' },
  base: { label: 'Base', color: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/30', action: 'BEVAKA' },
  climbing: { label: 'Climbing', color: 'text-signal-buy', bg: 'bg-signal-buy/10', border: 'border-signal-buy/30', action: 'KÖP om gate PASS' },
  tired: { label: 'Tired', color: 'text-signal-caution', bg: 'bg-signal-caution/10', border: 'border-signal-caution/30', action: 'SÄLJ' },
  downhill: { label: 'Downhill', color: 'text-signal-sell', bg: 'bg-signal-sell/10', border: 'border-signal-sell/30', action: 'UNDVIK' },
};

export function PatternSummary({ counts }: PatternSummaryProps) {
  const patterns: WSPPattern[] = ['climbing', 'base_or_climbing', 'tired', 'downhill'];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {patterns.map(pattern => {
        const c = config[pattern];
        const count = counts[pattern] ?? 0;
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
