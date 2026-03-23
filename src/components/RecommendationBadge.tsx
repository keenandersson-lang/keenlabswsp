import type { WSPRecommendation } from '@/lib/wsp-types';

const recConfig: Record<WSPRecommendation, { colorClass: string; bgClass: string; borderClass: string; glow?: string }> = {
  'KÖP': { colorClass: 'text-signal-buy', bgClass: 'bg-signal-buy\/10', borderClass: 'border-signal-buy', glow: 'glow-green' },
  'BEVAKA': { colorClass: 'text-accent', bgClass: 'bg-accent/10', borderClass: 'border-accent/50' },
  'SÄLJ': { colorClass: 'text-signal-caution', bgClass: 'bg-signal-caution\/10', borderClass: 'border-signal-caution' },
  'UNDVIK': { colorClass: 'text-signal-sell', bgClass: 'bg-signal-sell\/10', borderClass: 'border-signal-sell' },
};

interface RecommendationBadgeProps {
  recommendation: WSPRecommendation;
}

export function RecommendationBadge({ recommendation }: RecommendationBadgeProps) {
  const config = recConfig[recommendation];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold border ${config.colorClass} ${config.bgClass} ${config.borderClass} ${config.glow ?? ''}`}
    >
      {recommendation}
    </span>
  );
}
