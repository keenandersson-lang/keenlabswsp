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

  const equitiesBySelection = screener.stocks.filter((stock) => {
    if (sectorFilter && stock.sector !== sectorFilter) return false;
    if (industryFilter && stock.industry !== industryFilter) return false;
    return true;
  });

  const statusesBySector = new Map(screener.sectorStatuses.map((status) => [status.sector, status]));
  const sectorBuckets = new Map<string, EvaluatedStock[]>();
  for (const stock of screener.stocks) {
    const bucket = sectorBuckets.get(stock.sector) ?? [];
    bucket.push(stock);
    sectorBuckets.set(stock.sector, bucket);
  }

  const industryBuckets = new Map<string, { industry: string; sector: string; equityCount: number }>();
  for (const stock of screener.stocks) {
    const key = `${stock.sector}::${stock.industry}`;
    const current = industryBuckets.get(key);
    if (current) {
      current.equityCount += 1;
    } else {
      industryBuckets.set(key, {
        industry: stock.industry,
        sector: stock.sector,
        equityCount: 1,
      });
    }
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
      activeSector: sectorFilter,
      items: [...sectorBuckets.entries()]
        .map(([sector, stocks]) => ({
          sector,
          status: statusesBySector.get(sector) ?? null,
          equityCount: stocks.length,
          topEquities: stocks
            .slice()
            .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
            .slice(0, 3)
            .map((stock) => stock.symbol),
        }))
        .sort((left, right) => right.equityCount - left.equityCount),
    },
    industries: {
      activeIndustry: industryFilter,
      items: [...industryBuckets.values()]
        .filter((item) => (sectorFilter ? item.sector === sectorFilter : true))
        .sort((left, right) => right.equityCount - left.equityCount),
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
  };
}
