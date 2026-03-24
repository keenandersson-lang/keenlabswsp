import type { EvaluatedStock, SectorStatus } from '@/lib/wsp-types';

export type TrendBucket = 'HOT' | 'BREAKOUT' | 'BULLISH' | 'BEARISH';

export interface SectorHeatCell {
  sector: string;
  stocks: EvaluatedStock[];
  industries: string[];
  avgChange: number;
  bullishRatio: number;
  strengthScore: number;
  trendState: 'bullish' | 'neutral' | 'bearish';
  status?: SectorStatus;
}

export interface IndustryHeatCell {
  industry: string;
  sector: string;
  stocks: EvaluatedStock[];
  avgChange: number;
  breakoutCount: number;
  bullishRatio: number;
  strengthScore: number;
}

export function buildSectorHeatmap(stocks: EvaluatedStock[], sectorStatuses: SectorStatus[] = []): SectorHeatCell[] {
  const statusMap = new Map(sectorStatuses.map((item) => [item.sector, item]));
  const bySector = new Map<string, EvaluatedStock[]>();

  for (const stock of stocks) {
    const existing = bySector.get(stock.sector) ?? [];
    existing.push(stock);
    bySector.set(stock.sector, existing);
  }

  return [...bySector.entries()].map(([sector, items]) => {
    const avgChange = avg(items.map((s) => s.changePercent));
    const bullishRatio = ratio(items.filter((s) => s.finalRecommendation === 'KÖP' || s.finalRecommendation === 'BEVAKA').length, items.length);
    const breakoutRatio = ratio(items.filter((s) => s.audit.breakoutValid).length, items.length);
    const strengthScore = Number((avgChange * 0.45 + bullishRatio * 100 * 0.35 + breakoutRatio * 100 * 0.2).toFixed(2));
    const status = statusMap.get(sector);
    const trendState = strengthScore >= 45 || status?.isBullish ? 'bullish' : strengthScore <= 20 ? 'bearish' : 'neutral';

    return {
      sector,
      stocks: items,
      industries: [...new Set(items.map((s) => s.industry))],
      avgChange: Number(avgChange.toFixed(2)),
      bullishRatio,
      strengthScore,
      trendState,
      status,
    };
  }).sort((a, b) => b.strengthScore - a.strengthScore);
}

export function buildIndustryHeatmap(stocks: EvaluatedStock[], sector: string): IndustryHeatCell[] {
  const scoped = stocks.filter((stock) => stock.sector === sector);
  const byIndustry = new Map<string, EvaluatedStock[]>();

  for (const stock of scoped) {
    const existing = byIndustry.get(stock.industry) ?? [];
    existing.push(stock);
    byIndustry.set(stock.industry, existing);
  }

  return [...byIndustry.entries()].map(([industry, items]) => {
    const avgChange = avg(items.map((s) => s.changePercent));
    const breakoutCount = items.filter((s) => s.audit.breakoutValid).length;
    const bullishRatio = ratio(items.filter((s) => s.finalRecommendation === 'KÖP' || s.finalRecommendation === 'BEVAKA').length, items.length);
    const strengthScore = Number((avgChange * 0.5 + bullishRatio * 100 * 0.3 + ratio(breakoutCount, items.length) * 100 * 0.2).toFixed(2));

    return {
      industry,
      sector,
      stocks: items,
      avgChange: Number(avgChange.toFixed(2)),
      breakoutCount,
      bullishRatio,
      strengthScore,
    };
  }).sort((a, b) => b.strengthScore - a.strengthScore);
}

export function classifyTrendBucket(stock: EvaluatedStock): TrendBucket {
  const breakoutReady = stock.audit.breakoutValid && stock.audit.breakoutQualityPass && stock.audit.volumeValid;
  const bullishStructure = stock.audit.above50MA && stock.audit.above150MA && stock.audit.slope50Positive;

  if (stock.finalRecommendation === 'SÄLJ' || stock.finalRecommendation === 'UNDVIK' || stock.pattern === 'DOWNHILL') {
    return 'BEARISH';
  }
  if (breakoutReady && stock.pattern === 'CLIMBING') {
    return 'BREAKOUT';
  }
  if (bullishStructure || stock.finalRecommendation === 'KÖP' || stock.finalRecommendation === 'BEVAKA') {
    return 'BULLISH';
  }
  return 'BEARISH';
}

export function buildTrendBuckets(stocks: EvaluatedStock[]): Record<TrendBucket, EvaluatedStock[]> {
  const buckets: Record<TrendBucket, EvaluatedStock[]> = { HOT: [], BREAKOUT: [], BULLISH: [], BEARISH: [] };
  for (const stock of stocks) {
    const bucket = classifyTrendBucket(stock);
    buckets[bucket].push(stock);
  }

  buckets.BREAKOUT.sort(sortByOpportunity);
  buckets.BULLISH.sort(sortByOpportunity);
  buckets.BEARISH.sort((a, b) => a.score - b.score);

  buckets.HOT = [...stocks]
    .filter((stock) => classifyTrendBucket(stock) !== 'BEARISH')
    .sort(sortByOpportunity)
    .slice(0, 12);

  return buckets;
}

function sortByOpportunity(a: EvaluatedStock, b: EvaluatedStock): number {
  const aMomentum = (a.audit.volumeMultiple ?? 0) + (a.audit.mansfieldValue ?? 0) + a.changePercent;
  const bMomentum = (b.audit.volumeMultiple ?? 0) + (b.audit.mansfieldValue ?? 0) + b.changePercent;
  return (b.score - a.score) || (bMomentum - aMomentum);
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}
