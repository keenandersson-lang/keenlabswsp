import type {
  DiscoveryBuckets,
  DiscoveryMeta,
  EvaluatedStock,
  RankValueMode,
  ScreenerUiState,
  SectorStatus,
  TrendBucket,
  TrendClassificationMode,
} from './wsp-types';

export interface SectorHeatCell {
  sector: string;
  stocks: EvaluatedStock[];
  industries: string[];
  avgChange: number;
  bullishRatio: number;
  strengthScore: number;
  trendState: 'bullish' | 'neutral' | 'bearish';
  status?: SectorStatus;
  valueMode: RankValueMode;
  displayValue: number;
  confidence: 'high' | 'medium' | 'low';
  valueLabel: string;
}

export interface IndustryHeatCell {
  industry: string;
  sector: string;
  stocks: EvaluatedStock[];
  avgChange: number;
  breakoutCount: number;
  bullishRatio: number;
  strengthScore: number;
  valueMode: RankValueMode;
  displayValue: number;
  confidence: 'high' | 'medium' | 'low';
  valueLabel: string;
}

interface TrendClassificationResult {
  bucket: TrendBucket;
  strictQualified: boolean;
  degradedQualified: boolean;
}

export interface DiscoveryStockTrustContext {
  bucket: TrendBucket;
  strictQualified: boolean;
  degradedQualified: boolean;
  withinTrackedUniverse: boolean;
  uiState: ScreenerUiState;
}

export function buildSectorHeatmap(
  stocks: EvaluatedStock[],
  sectorStatuses: SectorStatus[] = [],
  uiState: ScreenerUiState = 'LIVE',
): SectorHeatCell[] {
  const statusMap = new Map(sectorStatuses.map((item) => [item.sector, item]));
  const bySector = new Map<string, EvaluatedStock[]>();

  for (const stock of stocks) {
    const existing = bySector.get(stock.sector) ?? [];
    existing.push(stock);
    bySector.set(stock.sector, existing);
  }

  return [...bySector.entries()]
    .map(([sector, items]) => {
      const avgChange = avg(items.map((s) => s.changePercent));
      const bullishRatio = ratio(items.filter((s) => isConstructiveStock(s)).length, items.length);
      const breakoutRatio = ratio(items.filter((s) => isStrictBreakout(s)).length, items.length);
      const baseStrength = normalizeStrengthScore(avgChange, bullishRatio, breakoutRatio);
      const samplePenalty = items.length >= 4 ? 0 : (4 - items.length) * 6;
      const strengthScore = clamp(baseStrength - samplePenalty, 0, 100);
      const status = statusMap.get(sector);
      const valueMode: RankValueMode = status && uiState !== 'FALLBACK' ? 'proxy_return' : 'tracked_strength';
      const displayValue = valueMode === 'proxy_return' ? status!.changePercent : strengthScore;
      const confidence = confidenceFromSample(items.length, uiState);
      const trendState: 'bullish' | 'neutral' | 'bearish' = strengthScore >= 66 || status?.isBullish
        ? 'bullish'
        : strengthScore <= 38
          ? 'bearish'
          : 'neutral';

      return {
        sector,
        stocks: items,
        industries: [...new Set(items.map((s) => s.industry))],
        avgChange: Number(avgChange.toFixed(2)),
        bullishRatio,
        strengthScore: Number(strengthScore.toFixed(2)),
        trendState,
        status,
        valueMode,
        displayValue: Number(displayValue.toFixed(2)),
        confidence,
        valueLabel: valueMode === 'proxy_return' ? 'ETF proxy return' : 'Tracked strength score',
      };
    })
    .sort((a, b) => b.strengthScore - a.strengthScore);
}

export function buildIndustryHeatmap(
  stocks: EvaluatedStock[],
  sector: string,
  uiState: ScreenerUiState = 'LIVE',
): IndustryHeatCell[] {
  const scoped = stocks.filter((stock) => stock.sector === sector);
  const byIndustry = new Map<string, EvaluatedStock[]>();

  for (const stock of scoped) {
    const existing = byIndustry.get(stock.industry) ?? [];
    existing.push(stock);
    byIndustry.set(stock.industry, existing);
  }

  return [...byIndustry.entries()]
    .map(([industry, items]) => {
      const avgChange = avg(items.map((s) => s.changePercent));
      const breakoutCount = items.filter((s) => isStrictBreakout(s)).length;
      const bullishRatio = ratio(items.filter((s) => isConstructiveStock(s)).length, items.length);
      const breakoutRatio = ratio(breakoutCount, items.length);
      const baseStrength = normalizeStrengthScore(avgChange, bullishRatio, breakoutRatio);
      const samplePenalty = items.length >= 3 ? 0 : (3 - items.length) * 8;
      const strengthScore = clamp(baseStrength - samplePenalty, 0, 100);

      return {
        industry,
        sector,
        stocks: items,
        avgChange: Number(avgChange.toFixed(2)),
        breakoutCount,
        bullishRatio,
        strengthScore: Number(strengthScore.toFixed(2)),
        valueMode: 'tracked_strength',
        displayValue: Number(strengthScore.toFixed(2)),
        confidence: confidenceFromSample(items.length, uiState),
        valueLabel: 'Tracked strength score',
      };
    })
    .sort((a, b) => b.strengthScore - a.strengthScore);
}

export function classifyTrendBucket(stock: EvaluatedStock, uiState: ScreenerUiState = 'LIVE'): TrendClassificationResult {
  const strictBreakout = isStrictBreakout(stock);
  const constructive = isConstructiveStock(stock);
  const exhausted = isWeakeningStock(stock);

  if (uiState !== 'LIVE' && stock.dataSource !== 'live') {
    if (strictBreakout) {
      return { bucket: 'BREAKOUT', strictQualified: true, degradedQualified: true };
    }
    if (constructive) {
      return { bucket: 'BULLISH', strictQualified: true, degradedQualified: true };
    }
    return { bucket: 'BEARISH', strictQualified: exhausted, degradedQualified: true };
  }

  if (strictBreakout) {
    return { bucket: 'BREAKOUT', strictQualified: true, degradedQualified: false };
  }

  if (constructive) {
    return { bucket: 'BULLISH', strictQualified: true, degradedQualified: false };
  }

  return { bucket: 'BEARISH', strictQualified: exhausted, degradedQualified: false };
}

export function deriveStockTrustContext(
  stock: EvaluatedStock,
  uiState: ScreenerUiState = 'LIVE',
): DiscoveryStockTrustContext {
  const classification = classifyTrendBucket(stock, uiState);
  return {
    bucket: classification.bucket,
    strictQualified: classification.strictQualified,
    degradedQualified: classification.degradedQualified,
    withinTrackedUniverse: true,
    uiState,
  };
}

export function buildTrendBuckets(stocks: EvaluatedStock[], uiState: ScreenerUiState = 'LIVE'): {
  buckets: DiscoveryBuckets;
  categoryDiagnostics: DiscoveryMeta['categoryDiagnostics'];
} {
  const buckets: DiscoveryBuckets = { HOT: [], BREAKOUT: [], BULLISH: [], BEARISH: [] };
  const categoryDiagnostics: DiscoveryMeta['categoryDiagnostics'] = {
    HOT: { strictQualified: 0, degradedQualified: 0 },
    BREAKOUT: { strictQualified: 0, degradedQualified: 0 },
    BULLISH: { strictQualified: 0, degradedQualified: 0 },
    BEARISH: { strictQualified: 0, degradedQualified: 0 },
  };

  for (const stock of stocks) {
    const classification = classifyTrendBucket(stock, uiState);
    buckets[classification.bucket].push(stock);
    if (classification.strictQualified) categoryDiagnostics[classification.bucket].strictQualified += 1;
    if (classification.degradedQualified) categoryDiagnostics[classification.bucket].degradedQualified += 1;
  }

  buckets.BREAKOUT.sort(sortByOpportunity);
  buckets.BULLISH.sort(sortByOpportunity);
  buckets.BEARISH.sort((a, b) => a.score - b.score);

  buckets.HOT = [...stocks]
    .filter((stock) => {
      const classification = classifyTrendBucket(stock, uiState);
      const highPriorityOpportunity = classification.bucket !== 'BEARISH'
        && stock.isValidWspEntry
        && stock.audit.breakoutQualityPass
        && stock.audit.mansfieldValid
        && stock.audit.slope50Positive
        && stock.score >= 65;
      return highPriorityOpportunity;
    })
    .sort(sortByOpportunity)
    .slice(0, 12);

  categoryDiagnostics.HOT.strictQualified = buckets.HOT.length;
  categoryDiagnostics.HOT.degradedQualified = uiState === 'LIVE' ? 0 : buckets.HOT.filter((stock) => stock.dataSource !== 'live').length;

  return { buckets, categoryDiagnostics };
}

export function buildDiscoverySnapshot(stocks: EvaluatedStock[], uiState: ScreenerUiState): {
  discovery: DiscoveryBuckets;
  discoveryMeta: DiscoveryMeta;
} {
  const { buckets: discovery, categoryDiagnostics } = buildTrendBuckets(stocks, uiState);
  const hasSectorCoverage = stocks.some((stock) => Boolean(stock.sector));
  const degradedReasons = uiState === 'LIVE'
    ? []
    : [uiState === 'STALE' ? 'Snapshot is stale/partial; rankings are constrained to conservative WSP classifications.' : 'Fallback/demo snapshot; discovery reflects tracked universe only.'];

  return {
    discovery,
    discoveryMeta: {
      source: 'backend_wsp_engine',
      dataState: uiState,
      trendClassificationMode: uiState === 'LIVE' ? 'strict_wsp' : 'degraded_snapshot',
      ranking: {
        sectorMode: uiState === 'FALLBACK' ? 'tracked_strength' : 'proxy_return',
        industryMode: 'tracked_strength',
        sectorValueLabel: uiState === 'FALLBACK' ? 'Tracked strength score' : 'ETF proxy return',
        industryValueLabel: 'Tracked strength score',
        usesProxyReturns: uiState !== 'FALLBACK' && hasSectorCoverage,
      },
      degraded: {
        snapshotLimited: uiState !== 'LIVE',
        reasons: degradedReasons,
      },
      categoryCounts: {
        HOT: discovery.HOT.length,
        BREAKOUT: discovery.BREAKOUT.length,
        BULLISH: discovery.BULLISH.length,
        BEARISH: discovery.BEARISH.length,
      },
      categoryDiagnostics,
      generatedAt: new Date().toISOString(),
    },
  };
}

function sortByOpportunity(a: EvaluatedStock, b: EvaluatedStock): number {
  const aMomentum = (a.audit.volumeMultiple ?? 0) + (a.audit.mansfieldValue ?? 0) + a.changePercent;
  const bMomentum = (b.audit.volumeMultiple ?? 0) + (b.audit.mansfieldValue ?? 0) + b.changePercent;
  return (b.score - a.score) || (bMomentum - aMomentum);
}

function isStrictBreakout(stock: EvaluatedStock): boolean {
  return stock.audit.breakoutValid
    && stock.audit.breakoutQualityPass
    && stock.audit.volumeValid
    && stock.audit.breakoutStale === false
    && stock.audit.mansfieldValid
    && stock.audit.slope50Positive
    && stock.audit.above50MA
    && stock.audit.above150MA;
}

function isConstructiveStock(stock: EvaluatedStock): boolean {
  return stock.pattern === 'CLIMBING'
    && stock.audit.above50MA
    && stock.audit.above150MA
    && stock.audit.slope50Positive
    && stock.audit.mansfieldValid
    && (stock.finalRecommendation === 'KÖP' || stock.finalRecommendation === 'BEVAKA');
}

function isWeakeningStock(stock: EvaluatedStock): boolean {
  return stock.pattern === 'DOWNHILL'
    || stock.pattern === 'TIRED'
    || stock.finalRecommendation === 'SÄLJ'
    || stock.finalRecommendation === 'UNDVIK';
}

function normalizeStrengthScore(avgChange: number, bullishRatio: number, breakoutRatio: number): number {
  const boundedChange = clamp(avgChange, -6, 6);
  const momentumComponent = ((boundedChange + 6) / 12) * 30;
  const constructiveComponent = bullishRatio * 45;
  const breakoutComponent = breakoutRatio * 25;
  return momentumComponent + constructiveComponent + breakoutComponent;
}

function confidenceFromSample(sampleSize: number, uiState: ScreenerUiState): 'high' | 'medium' | 'low' {
  if (uiState === 'FALLBACK') return 'low';
  if (sampleSize >= 6) return 'high';
  if (sampleSize >= 3) return 'medium';
  return 'low';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}
