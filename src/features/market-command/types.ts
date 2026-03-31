import type {
  EvaluatedStock,
  MarketOverview,
  ScreenerDataProvenance,
  ScreenerTrustContract,
  SectorStatus,
} from '@/lib/wsp-types';

export interface MarketCommandSnapshot {
  asOf: string;
  provenance: ScreenerDataProvenance;
  trust: ScreenerTrustContract;
  market: MarketLayerSnapshot;
  sectors: SectorLayerSnapshot;
  industries: IndustryLayerSnapshot;
  equities: EquityLayerSnapshot;
  detail: DetailLayerSnapshot;
}

export interface MarketLayerSnapshot {
  overview: MarketOverview;
  breadth: {
    total: number;
    buy: number;
    watch: number;
    sell: number;
    avoid: number;
  };
}

export interface SectorLayerSnapshot {
  activeSector: string | null;
  items: SectorSnapshot[];
}

export interface SectorSnapshot {
  sector: string;
  status: SectorStatus | null;
  equityCount: number;
  topEquities: string[];
}

export interface IndustryLayerSnapshot {
  activeIndustry: string | null;
  items: IndustrySnapshot[];
}

export interface IndustrySnapshot {
  industry: string;
  sector: string;
  equityCount: number;
}

export interface EquityLayerSnapshot {
  activeSymbol: string | null;
  items: EvaluatedStock[];
}

export interface DetailLayerSnapshot {
  symbol: string | null;
  state: 'stub' | 'ready';
}

export interface MarketCommandSelection {
  sector?: string | null;
  industry?: string | null;
  symbol?: string | null;
}
