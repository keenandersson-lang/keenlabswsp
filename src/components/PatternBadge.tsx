import type { WSPPattern } from '@/lib/wsp-types';

const patternConfig: Record<WSPPattern, { label: string; description: string; colorClass: string; bgClass: string; borderClass: string }> = {
  BASE: { label: 'BASE', description: 'Sidledes konsolidering — väntar på breakout', colorClass: 'text-accent', bgClass: 'bg-signal-base\/10', borderClass: 'border-accent' },
  CLIMBING: { label: 'CLIMBING', description: 'Upptrend — potentiell köpsignal vid breakout', colorClass: 'text-signal-buy', bgClass: 'bg-signal-buy\/10', borderClass: 'border-signal-buy' },
  TIRED: { label: 'TIRED', description: 'Topp-konsolidering — säljsignal', colorClass: 'text-signal-caution', bgClass: 'bg-signal-caution\/10', borderClass: 'border-signal-caution' },
  DOWNHILL: { label: 'DOWNHILL', description: 'Nedtrend — undvik', colorClass: 'text-signal-sell', bgClass: 'bg-signal-sell\/10', borderClass: 'border-signal-sell' },
};

interface PatternBadgeProps {
  pattern: WSPPattern;
  size?: 'sm' | 'md';
}

export function PatternBadge({ pattern, size = 'sm' }: PatternBadgeProps) {
  const config = patternConfig[pattern];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs font-semibold tracking-wider ${config.colorClass} ${config.bgClass} ${config.borderClass} ${size === 'md' ? 'px-3 py-1 text-sm' : ''}`}
    >
      {config.label}
    </span>
  );
}

export function getPatternInfo(pattern: WSPPattern) {
  return patternConfig[pattern];
}
