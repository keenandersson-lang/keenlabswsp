import type { WSPPattern } from '@/lib/wsp-types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const patternConfig: Record<WSPPattern, { label: string; description: string; colorClass: string; bgClass: string; borderClass: string }> = {
  base_or_climbing: { label: 'BASE/CLIMBING', description: 'Sidledes konsolidering — väntar på breakout', colorClass: 'text-accent', bgClass: 'bg-signal-base\/10', borderClass: 'border-accent' },
  base: { label: 'BASE', description: 'Basformation utan tydlig trend — bevaka', colorClass: 'text-accent', bgClass: 'bg-signal-base\/10', borderClass: 'border-accent' },
  climbing: { label: 'CLIMBING', description: 'Upptrend med stigande 50MA — potentiell köpsignal vid breakout', colorClass: 'text-signal-buy', bgClass: 'bg-signal-buy\/10', borderClass: 'border-signal-buy' },
  tired: { label: 'TIRED', description: 'Topp-konsolidering nära ATH med flat momentum — säljsignal', colorClass: 'text-signal-caution', bgClass: 'bg-signal-caution\/10', borderClass: 'border-signal-caution' },
  downhill: { label: 'DOWNHILL', description: 'Pris under 150MA — nedtrend, undvik', colorClass: 'text-signal-sell', bgClass: 'bg-signal-sell\/10', borderClass: 'border-signal-sell' },
};

interface PatternBadgeProps {
  pattern: WSPPattern;
  size?: 'sm' | 'md';
}

export function PatternBadge({ pattern, size = 'sm' }: PatternBadgeProps) {
  const config = patternConfig[pattern];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs font-semibold tracking-wider cursor-help ${config.colorClass} ${config.bgClass} ${config.borderClass} ${size === 'md' ? 'px-3 py-1 text-sm' : ''}`}
        >
          {config.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] text-xs">
        {config.description}
      </TooltipContent>
    </Tooltip>
  );
}

export function getPatternInfo(pattern: WSPPattern) {
  return patternConfig[pattern];
}
