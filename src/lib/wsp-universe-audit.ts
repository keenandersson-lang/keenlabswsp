/**
 * WSP Universe Audit — Reporting utility
 *
 * Produces exact counts by symbol class, exclusion reason, and eligibility
 * for both the curated universe and DB-seeded symbols.
 */

import { MARKET_UNIVERSE, type MarketUniverseStock } from './market-universe';
import {
  classifyCuratedSymbol,
  classifySymbol,
  type WspSymbolClass,
  type ExclusionReason,
  BENCHMARK_SYMBOLS,
  SECTOR_ETF_SYMBOLS,
} from './wsp-data-contract';

export interface UniverseAuditReport {
  totalSymbols: number;
  byClass: Record<WspSymbolClass, number>;
  eligibleForBackfill: number;
  eligibleForFullWsp: number;
  limitedAnalysis: number;
  dataOnly: number;
  excluded: number;
  exclusionCounts: Partial<Record<ExclusionReason, number>>;
  benchmarkSymbols: string[];
  sectorEtfSymbols: string[];
}

/**
 * Audit the curated (hardcoded) market universe.
 */
export function auditCuratedUniverse(): UniverseAuditReport {
  const byClass: Record<WspSymbolClass, number> = {
    full_wsp_equity: 0,
    limited_equity: 0,
    sector_benchmark_proxy: 0,
    metals_limited: 0,
    data_only: 0,
    excluded: 0,
  };
  const exclusionCounts: Partial<Record<ExclusionReason, number>> = {};

  for (const item of MARKET_UNIVERSE) {
    const cls = classifyCuratedSymbol(item);
    byClass[cls]++;
  }

  return {
    totalSymbols: MARKET_UNIVERSE.length,
    byClass,
    eligibleForBackfill: byClass.full_wsp_equity + byClass.limited_equity + byClass.sector_benchmark_proxy + byClass.metals_limited + byClass.data_only,
    eligibleForFullWsp: byClass.full_wsp_equity,
    limitedAnalysis: byClass.limited_equity + byClass.metals_limited,
    dataOnly: byClass.data_only,
    excluded: byClass.excluded,
    exclusionCounts,
    benchmarkSymbols: [...BENCHMARK_SYMBOLS],
    sectorEtfSymbols: [...SECTOR_ETF_SYMBOLS],
  };
}

/**
 * Audit DB-seeded symbols.
 * Pass the raw rows from the `symbols` table.
 */
export function auditDbSymbols(rows: Array<{
  symbol: string;
  name: string | null;
  exchange: string | null;
  asset_class: string | null;
  sector: string | null;
  industry: string | null;
  is_active: boolean | null;
}>): UniverseAuditReport {
  const byClass: Record<WspSymbolClass, number> = {
    full_wsp_equity: 0,
    limited_equity: 0,
    sector_benchmark_proxy: 0,
    metals_limited: 0,
    data_only: 0,
    excluded: 0,
  };
  const exclusionCounts: Partial<Record<ExclusionReason, number>> = {};

  for (const row of rows) {
    const result = classifySymbol(row);
    byClass[result.symbolClass]++;
    if (result.exclusionReason) {
      exclusionCounts[result.exclusionReason] = (exclusionCounts[result.exclusionReason] ?? 0) + 1;
    }
  }

  return {
    totalSymbols: rows.length,
    byClass,
    eligibleForBackfill: byClass.full_wsp_equity + byClass.limited_equity + byClass.sector_benchmark_proxy + byClass.metals_limited + byClass.data_only,
    eligibleForFullWsp: byClass.full_wsp_equity,
    limitedAnalysis: byClass.limited_equity + byClass.metals_limited,
    dataOnly: byClass.data_only,
    excluded: byClass.excluded,
    exclusionCounts,
    benchmarkSymbols: [...BENCHMARK_SYMBOLS],
    sectorEtfSymbols: [...SECTOR_ETF_SYMBOLS],
  };
}
