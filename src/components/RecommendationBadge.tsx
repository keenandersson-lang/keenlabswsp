import type { WSPRecommendation } from '@/lib/wsp-types';

const recConfig: Record<WSPRecommendation, { colorClass: string; bgClass: string; borderClass: string; glow?: string }> = {
  'KÖP': { colorClass: 'text-signal-buy', bgClass: 'bg-signal-buy\/10', borderClass: 'border-signal-buy', glow: 'glow-green' },
  'BEVAKA': { colorClass: 'text-accent', bgClass: 'bg-accent/10', borderClass: 'border-accent/50' },
  'SÄLJ': { colorClass: 'text-signal-caution', bgClass: 'bg-signal-caution\/10', borderClass: 'border-signal-caution' },
  'UNDVIK': { colorClass: 'text-signal-sell', bgClass: 'bg-signal-sell\/10', borderClass: 'border-signal-sell' },
};

interface RecommendationBadgeProps {
  recommendation: string;
}

const fallbackConfig: { colorClass: string; bgClass: string; borderClass: string; glow?: string } = { colorClass: 'text-muted-foreground', bgClass: 'bg-muted/10', borderClass: 'border-muted' };

function normalizeRecommendation(recommendation: string): string {
  const upper = recommendation.trim().toUpperCase();
  if (!upper) return 'OKÄND';
  if (upper === 'BUY') return 'KÖP';
  if (upper === 'WATCH') return 'BEVAKA';
  if (upper === 'SELL') return 'SÄLJ';
  if (upper === 'AVOID') return 'UNDVIK';
  if (upper === 'KÖP' || upper === 'BEVAKA' || upper === 'SÄLJ' || upper === 'UNDVIK') return upper;
  return 'OKÄND';
}

export function RecommendationBadge({ recommendation }: RecommendationBadgeProps) {
  const normalized = normalizeRecommendation(recommendation);
  const config = recConfig[normalized as WSPRecommendation] ?? fallbackConfig;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold border ${config.colorClass} ${config.bgClass} ${config.borderClass} ${config.glow ?? ''}`}
    >
      {normalized}
    </span>
  );
}
