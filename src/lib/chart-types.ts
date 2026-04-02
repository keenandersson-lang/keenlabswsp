import type { Bar, EvaluatedStock } from './wsp-types';

export type ChartTimeframe = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '2Y';

export interface StockDetailPayload {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  exchange?: string;
  assetClass?: 'equity' | 'metals' | 'commodity';
  supportsFullWsp?: boolean;
  wspSupport?: 'full' | 'limited';
  supportLevel?: string | null;
  isApprovedLiveCohort?: boolean;
  metadataCompleteness?: 'complete' | 'partial' | 'missing';
  barsDaily: Bar[];
  barsWeekly: Bar[];
  benchmarkDaily: Bar[];
  benchmarkWeekly: Bar[];
  canonicalSnapshotId?: number;
  fetchedAt: string;
}

export interface StockDetailApiResponse {
  ok: boolean;
  data: StockDetailPayload | null;
  error: {
    code: string;
    message: string;
  } | null;
}

export interface HistoricalEvaluation {
  asOfDate: string;
  asOfIndex: number;
  stock: EvaluatedStock;
}
