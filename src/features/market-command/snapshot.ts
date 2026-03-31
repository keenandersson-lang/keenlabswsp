import { fetchWspScreenerData } from '@/hooks/use-wsp-screener';
import type { EvaluatedStock, ScreenerApiResponse } from '@/lib/wsp-types';
import type { MarketCommandSelection, MarketCommandSnapshot } from './types';

export interface MarketCommandSnapshotRequest extends MarketCommandSelection {
  intervalMs?: number;
  page?: number;
  pageSize?: number;
  forceRefresh?: boolean;
}

export async function fetchMarketCommandSnapshot(
  request: MarketCommandSnapshotRequest = {},
): Promise<MarketCommandSnapshot> {
  const screener = await fetchWspScreenerData({
    intervalMs: request.intervalMs,
    page: request.page,
    pageSize: request.pageSize,
    forceRefresh: request.forceRefresh,
  });

  return buildMarketCommandSnapshot(screener, request);
}

export function buildMarketCommandSnapshot(
  screener: ScreenerApiResponse,
  selection: MarketCommandSelection = {},
): MarketCommandSnapshot {
  const sectorFilter = selection.sector ?? null;
  const industryFilter = selection.industry ?? null;
  const symbolFilter = selection.symbol ?? null;
  const stockBySymbol = new Map(screener.stocks.map((stock) => [stock.symbol, stock]));

  const effectiveSector =
    sectorFilter
    ?? (industryFilter ? findSectorForIndustry(screener.stocks, industryFilter) : null)
    ?? (symbolFilter ? stockBySymbol.get(symbolFilter)?.sector ?? null : null);

  const effectiveIndustry =
    industryFilter
    ?? (symbolFilter ? stockBySymbol.get(symbolFilter)?.industry ?? null : null);

  const equitiesBySelection = screener.stocks.filter((stock) => {
    if (effectiveSector && stock.sector !== effectiveSector) return false;
    if (effectiveIndustry && stock.industry !== effectiveIndustry) return false;
    return true;
  });

  const statusesBySector = new Map(screener.sectorStatuses.map((status) => [status.sector, status]));
  const sectorBuckets = new Map<string, EvaluatedStock[]>();
  for (const stock of screener.stocks) {
    const bucket = sectorBuckets.get(stock.sector) ?? [];
    bucket.push(stock);
    sectorBuckets.set(stock.sector, bucket);
  }

  const industryBuckets = new Map<string, IndustryAccumulator>();
  for (const stock of screener.stocks) {
    const key = `${stock.sector}::${stock.industry}`;
    const current = industryBuckets.get(key) ?? createIndustryAccumulator(stock.sector, stock.industry);
    current.equityCount += 1;
    current.totalScore += stock.score ?? 0;
    current.totalChangePercent += stock.changePercent ?? 0;
    if (stock.isValidWspEntry) current.validEntryCount += 1;
    if (stock.gate.breakoutValid && stock.gate.breakoutFresh) current.breakoutCount += 1;

    if (stock.finalRecommendation === 'KÖP') current.recommendationCounts.buy += 1;
    else if (stock.finalRecommendation === 'BEVAKA') current.recommendationCounts.watch += 1;
    else if (stock.finalRecommendation === 'SÄLJ') current.recommendationCounts.sell += 1;
    else current.recommendationCounts.avoid += 1;

    current.stocks.push(stock);
    industryBuckets.set(key, current);
  }

  const asOf = screener.market.lastUpdated ?? screener.providerStatus.lastFetch ?? new Date().toISOString();

  return {
    asOf,
    provenance: screener.trust.dataProvenance,
    trust: screener.trust,
    market: {
      overview: screener.market,
      breadth: {
        total: screener.stocks.length,
        buy: screener.stocks.filter((stock) => stock.finalRecommendation === 'KÖP').length,
        watch: screener.stocks.filter((stock) => stock.finalRecommendation === 'BEVAKA').length,
        sell: screener.stocks.filter((stock) => stock.finalRecommendation === 'SÄLJ').length,
        avoid: screener.stocks.filter((stock) => stock.finalRecommendation === 'UNDVIK').length,
      },
    },
    sectors: {
      activeSector: effectiveSector,
      items: [...sectorBuckets.entries()]
        .map(([sector, stocks]) => ({
          sector,
          status: statusesBySector.get(sector) ?? null,
          equityCount: stocks.length,
          industryCount: new Set(stocks.map((stock) => stock.industry)).size,
          topIndustries: buildTopIndustries(stocks),
          topEquities: stocks
            .slice()
            .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
            .slice(0, 3)
            .map((stock) => stock.symbol),
        }))
        .sort((left, right) => right.equityCount - left.equityCount),
    },
    industries: {
      activeIndustry: effectiveIndustry,
      items: [...industryBuckets.values()]
        .filter((item) => (effectiveSector ? item.sector === effectiveSector : true))
        .map((item) => {
          const averageScore = item.equityCount > 0 ? item.totalScore / item.equityCount : 0;
          const averageChangePercent = item.equityCount > 0 ? item.totalChangePercent / item.equityCount : 0;
          const rankScore = averageScore * 0.7 + averageChangePercent * 6 + item.breakoutCount * 4 + item.validEntryCount * 2;
          return {
            industry: item.industry,
            sector: item.sector,
            equityCount: item.equityCount,
            averageScore: Number(averageScore.toFixed(2)),
            averageChangePercent: Number(averageChangePercent.toFixed(2)),
            breakoutCount: item.breakoutCount,
            validEntryCount: item.validEntryCount,
            recommendationCounts: item.recommendationCounts,
            topEquities: item.stocks
              .slice()
              .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
              .slice(0, 5)
              .map((stock) => stock.symbol),
            rankScore: Number(rankScore.toFixed(2)),
          };
        })
        .sort((left, right) => right.rankScore - left.rankScore),
    },
    equities: {
      activeSymbol: symbolFilter,
      items: symbolFilter
        ? equitiesBySelection.filter((stock) => stock.symbol === symbolFilter)
        : equitiesBySelection,
    },
    detail: {
      symbol: symbolFilter,
      state: symbolFilter ? 'ready' : 'stub',
    },
    runtime: {
      providerStatus: screener.providerStatus,
      discoveryMeta: screener.discoveryMeta,
      debugSummary: screener.debugSummary,
    },
  };
}

interface IndustryAccumulator {
  industry: string;
  sector: string;
  equityCount: number;
  totalScore: number;
  totalChangePercent: number;
  breakoutCount: number;
  validEntryCount: number;
  recommendationCounts: {
    buy: number;
    watch: number;
    sell: number;
    avoid: number;
  };
  stocks: EvaluatedStock[];
}

function createIndustryAccumulator(sector: string, industry: string): IndustryAccumulator {
  return {
    industry,
    sector,
    equityCount: 0,
    totalScore: 0,
    totalChangePercent: 0,
    breakoutCount: 0,
    validEntryCount: 0,
    recommendationCounts: {
      buy: 0,
      watch: 0,
      sell: 0,
      avoid: 0,
    },
    stocks: [],
  };
}

function findSectorForIndustry(stocks: EvaluatedStock[], industry: string): string | null {
  const match = stocks.find((stock) => stock.industry === industry);
  return match?.sector ?? null;
}

function buildTopIndustries(stocks: EvaluatedStock[]): string[] {
  const counts = new Map<string, number>();
  for (const stock of stocks) {
    counts.set(stock.industry, (counts.get(stock.industry) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([industry]) => industry);
}
