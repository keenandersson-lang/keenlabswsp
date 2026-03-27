/**
 * WSP V1 Data Contract — Single Source of Truth
 *
 * This module defines every eligibility rule, symbol class, metadata
 * requirement, history threshold, and price-data constraint for the
 * Wall Street Protocol V1 product.
 *
 * NO other module may invent its own eligibility labels.
 * Import from here or derive from these constants.
 */

// ─── Symbol Support Classes ───────────────────────────────────────────────
/**
 * Every symbol in the broader universe must be assigned exactly one class.
 *
 * full_wsp_equity       — Scanner, discovery, full audit, full chart, full blocker logic.
 * limited_equity        — Chart/detail only, partial analysis, NOT a scanner candidate.
 * sector_benchmark_proxy — Benchmark or sector-ETF context instrument. NOT a stock candidate.
 * metals_limited        — Chart + limited analysis only, NOT scanner-eligible.
 * data_only             — Quote/history only, no WSP analysis.
 * excluded              — Known but not used in any V1 product flow.
 */
export type WspSymbolClass =
  | 'full_wsp_equity'
  | 'limited_equity'
  | 'sector_benchmark_proxy'
  | 'metals_limited'
  | 'data_only'
  | 'excluded';

export const WSP_SYMBOL_CLASS_META: Record<
  WspSymbolClass,
  {
    scannerEligible: boolean;
    discoveryEligible: boolean;
    chartEligible: boolean;
    fullAuditEligible: boolean;
    backfillPriority: 'high' | 'medium' | 'low' | 'none';
    description: string;
  }
> = {
  full_wsp_equity: {
    scannerEligible: true,
    discoveryEligible: true,
    chartEligible: true,
    fullAuditEligible: true,
    backfillPriority: 'high',
    description: 'Fully eligible for WSP scanner, discovery, audit, and chart.',
  },
  limited_equity: {
    scannerEligible: false,
    discoveryEligible: false,
    chartEligible: true,
    fullAuditEligible: false,
    backfillPriority: 'medium',
    description: 'Chart/detail only. Partial analysis. Not a scanner candidate.',
  },
  sector_benchmark_proxy: {
    scannerEligible: false,
    discoveryEligible: false,
    chartEligible: true,
    fullAuditEligible: false,
    backfillPriority: 'medium',
    description: 'Benchmark or sector-ETF. Context instrument only.',
  },
  metals_limited: {
    scannerEligible: false,
    discoveryEligible: false,
    chartEligible: true,
    fullAuditEligible: false,
    backfillPriority: 'low',
    description: 'Metals/commodity instrument. Chart + limited analysis only.',
  },
  data_only: {
    scannerEligible: false,
    discoveryEligible: false,
    chartEligible: true,
    fullAuditEligible: false,
    backfillPriority: 'low',
    description: 'Quote/history only. No WSP analysis.',
  },
  excluded: {
    scannerEligible: false,
    discoveryEligible: false,
    chartEligible: false,
    fullAuditEligible: false,
    backfillPriority: 'none',
    description: 'Known but excluded from all V1 flows.',
  },
};

// ─── Exclusion Reasons ────────────────────────────────────────────────────
export type ExclusionReason =
  | 'inactive_or_delisted'
  | 'invalid_symbol_format'
  | 'unsupported_instrument_type'
  | 'missing_sector'
  | 'missing_industry'
  | 'insufficient_history'
  | 'proxy_only'
  | 'non_common_stock'
  | 'exchange_not_allowed'
  | 'etf_not_eligible_for_full_wsp'
  | 'adr_excluded_v1'
  | 'preferred_share'
  | 'warrant_or_right'
  | 'unit_or_structured'
  | 'recently_listed_insufficient_history'
  | 'other';

// ─── Required Metadata Contract ───────────────────────────────────────────
/**
 * Every symbol in the broader universe must carry these fields.
 * Fields marked `requiredForFullWsp: true` must be present and valid
 * before a symbol can be classified as `full_wsp_equity`.
 */
export interface SymbolMetadataContract {
  symbol: string;
  companyName: string | null;
  exchange: string | null;
  assetClass: string | null;           // 'us_equity' | 'metals' | 'commodity' | etc.
  instrumentType: string | null;       // 'CS' (common stock) | 'ETF' | 'ADR' | 'UNIT' | 'RIGHT' | 'WARRANT' | 'PFD' | etc.
  sector: string | null;
  industry: string | null;
  isActive: boolean;
  isEtf: boolean;
  isBenchmark: boolean;
  isCommonStock: boolean;
  supportLevel: WspSymbolClass;
  eligibleForBackfill: boolean;
  eligibleForFullWsp: boolean;
  exclusionReason: ExclusionReason | null;
  sourceProvider: string | null;       // 'polygon' | 'alpaca' | 'manual' | etc.
}

export const METADATA_FIELD_REQUIREMENTS: Record<
  keyof SymbolMetadataContract,
  { requiredForStorage: boolean; requiredForBackfill: boolean; requiredForFullWsp: boolean }
> = {
  symbol:              { requiredForStorage: true,  requiredForBackfill: true,  requiredForFullWsp: true  },
  companyName:         { requiredForStorage: false, requiredForBackfill: false, requiredForFullWsp: true  },
  exchange:            { requiredForStorage: false, requiredForBackfill: false, requiredForFullWsp: true  },
  assetClass:          { requiredForStorage: false, requiredForBackfill: true,  requiredForFullWsp: true  },
  instrumentType:      { requiredForStorage: false, requiredForBackfill: false, requiredForFullWsp: true  },
  sector:              { requiredForStorage: false, requiredForBackfill: false, requiredForFullWsp: true  },
  industry:            { requiredForStorage: false, requiredForBackfill: false, requiredForFullWsp: true  },
  isActive:            { requiredForStorage: true,  requiredForBackfill: true,  requiredForFullWsp: true  },
  isEtf:               { requiredForStorage: false, requiredForBackfill: false, requiredForFullWsp: false },
  isBenchmark:         { requiredForStorage: false, requiredForBackfill: false, requiredForFullWsp: false },
  isCommonStock:       { requiredForStorage: false, requiredForBackfill: false, requiredForFullWsp: true  },
  supportLevel:        { requiredForStorage: true,  requiredForBackfill: true,  requiredForFullWsp: true  },
  eligibleForBackfill: { requiredForStorage: true,  requiredForBackfill: true,  requiredForFullWsp: true  },
  eligibleForFullWsp:  { requiredForStorage: true,  requiredForBackfill: false, requiredForFullWsp: true  },
  exclusionReason:     { requiredForStorage: false, requiredForBackfill: false, requiredForFullWsp: false },
  sourceProvider:      { requiredForStorage: false, requiredForBackfill: false, requiredForFullWsp: false },
};

// ─── V1 Universe Rules — Allowed Exchanges ───────────────────────────────
export const V1_ALLOWED_EXCHANGES_FULL_WSP = ['NASDAQ', 'NYSE', 'XNYS', 'XNAS'] as const;
export const V1_ALLOWED_EXCHANGES_BACKFILL = ['NASDAQ', 'NYSE', 'XNYS', 'XNAS', 'ARCA', 'BATS', 'ARCX', 'NYSEARCA'] as const;

// ─── V1 Instrument Type Rules ─────────────────────────────────────────────
export const V1_FULL_WSP_ALLOWED_INSTRUMENT_TYPES = ['CS'] as const;  // Common Stock only
export const V1_EXCLUDED_INSTRUMENT_TYPES = [
  'WARRANT', 'RIGHT', 'UNIT', 'PFD',      // warrants, rights, units, preferred
  'FUND', 'SP', 'BOND', 'NOTE',           // funds, structured products, bonds
  'OS', 'GDR',                             // other securities, global depositary receipts
] as const;

// ─── V1 Symbol Format Validation ──────────────────────────────────────────
/** Symbols with these patterns are excluded from full WSP in V1 */
const INVALID_SYMBOL_PATTERNS = [
  /\./,           // dots (e.g. BRK.B, BF.B) — no clean Polygon mapping
  /\//,           // slashes
  /\s/,           // spaces
  /[^A-Z0-9]/,   // any non-alphanumeric (after uppercase)
];

export function isValidSymbolFormat(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  if (upper.length === 0 || upper.length > 5) return false;
  return !INVALID_SYMBOL_PATTERNS.some((p) => p.test(upper));
}

// ─── V1 ADR Policy ───────────────────────────────────────────────────────
/**
 * ADRs are EXCLUDED from full WSP in V1.
 * Reason: ADR volume doesn't reflect true domestic trading,
 * making volume-surge and breakout-quality unreliable.
 */
export const V1_ADRS_EXCLUDED = true;

// ─── V1 ETF Policy ───────────────────────────────────────────────────────
/**
 * ETFs are EXCLUDED from full WSP scanner in V1.
 * They may appear as sector/benchmark proxies or as chart-only instruments.
 */
export const V1_ETFS_EXCLUDED_FROM_FULL_WSP = true;

// ─── Daily Price Data Contract ────────────────────────────────────────────
export const DAILY_PRICE_CONTRACT = {
  /** Only daily bars (no intraday, no weekly in the raw table) */
  granularity: 'daily' as const,

  /** YYYY-MM-DD string format */
  dateFormat: 'YYYY-MM-DD' as const,

  /** Integer volume (bigint in DB). Always Math.round() before insert. */
  volumeFormat: 'integer_rounded' as const,

  /** V1 uses split-adjusted data from Polygon (adjusted=true) */
  adjustmentPolicy: 'split_adjusted' as const,

  /** Missing trading days: accepted (weekends, holidays). No synthetic fill. */
  missingDaysPolicy: 'accept_gaps' as const,

  /** Duplicate dates: upsert with onConflict 'symbol,date'. Last write wins. */
  duplicateDatePolicy: 'upsert_last_write_wins' as const,

  /** Malformed bars (NaN, negative, zero OHLC): skip bar, do not insert. */
  malformedBarPolicy: 'skip_and_log' as const,

  /** Required fields per bar row */
  requiredFields: ['symbol', 'date', 'open', 'high', 'low', 'close', 'volume'] as const,
} as const;

// ─── Minimum History Thresholds ───────────────────────────────────────────
/**
 * Minimum number of valid daily bars required for each analysis level.
 * These are hard minimums — the system must not attempt analysis if
 * the bar count is below the threshold.
 */
export const HISTORY_THRESHOLDS = {
  /** Minimum to store/backfill at all */
  eligibleForBackfill: 0,

  /** Minimum for basic charting (price line, candles) */
  chartableOnly: 20,

  /** Minimum for limited analysis (SMA20, SMA50, basic trend) */
  limitedAnalysis: 60,

  /** Required indicators and their minimum bars: */
  indicators: {
    sma20: 20,
    sma50: 50,
    sma150: 150,
    sma200: 200,
    rsi14: 15,
    averageVolume5d: 5,
    breakoutHistory: 100,    // WSP_CONFIG.wsp.resistanceLookbackBars
    mansfieldRS: 200,        // WSP_CONFIG.wsp.mansfieldLookbackBars
    smaSlope: 55,            // sma50 + smaSlopeLookbackBars
  },

  /**
   * Full WSP eligibility requires enough bars for ALL indicators.
   * This is max(all indicator minimums) = 200 bars.
   */
  fullWsp: 200,

  /** Benchmark comparison requires aligned history */
  benchmarkComparison: 200,
} as const;

// ─── Benchmark & Sector Proxy Contract ────────────────────────────────────
export const BENCHMARK_SYMBOLS = ['SPY', 'QQQ'] as const;
export const SECTOR_ETF_SYMBOLS = [
  'XLK', 'XLV', 'XLF', 'XLE', 'XLY', 'XLI', 'XLC', 'XLP', 'XLB', 'XLRE', 'XLU',
] as const;

/**
 * Benchmark and sector ETFs:
 * - Are backfilled (needed for Mansfield RS, sector alignment)
 * - Are NOT scanner candidates
 * - Are NOT discovery candidates
 * - May appear in chart/detail view as context
 * - Participate in Mansfield RS as denominator
 * - Participate in sector alignment checks
 */
export function isBenchmarkOrSectorProxy(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return (
    (BENCHMARK_SYMBOLS as readonly string[]).includes(upper) ||
    (SECTOR_ETF_SYMBOLS as readonly string[]).includes(upper)
  );
}

// ─── WSP Indicator Contract ───────────────────────────────────────────────
/**
 * For full WSP symbols, ALL of these indicators must be computed consistently.
 * No module may use a different formula or partial local approximation.
 *
 * Source of truth for computation: src/lib/wsp-indicators.ts
 * Source of truth for config params: src/lib/wsp-config.ts
 */
export const WSP_REQUIRED_INDICATORS = [
  'sma20',
  'sma50',
  'sma150',
  'sma200',
  'sma50Slope',
  'sma50SlopeDirection',
  'resistanceZone',
  'breakoutConfirmed',
  'breakoutQualityPass',
  'barsSinceBreakout',
  'breakoutStale',
  'averageVolumeReference',
  'volumeMultiple',
  'mansfieldRS',
  'mansfieldValid',
  'mansfieldUptrend',
] as const;

// ─── Full-WSP Eligibility Checklist ───────────────────────────────────────
export interface FullWspEligibilityResult {
  eligible: boolean;
  checks: {
    isActive: boolean;
    isCommonStock: boolean;
    exchangeAllowed: boolean;
    validSymbolFormat: boolean;
    sectorPresent: boolean;
    industryPresent: boolean;
    notEtf: boolean;
    notAdr: boolean;
    notExcludedInstrumentType: boolean;
    notBenchmarkProxy: boolean;
  };
  failedChecks: string[];
  exclusionReason: ExclusionReason | null;
}

/**
 * Evaluate whether a symbol qualifies for full WSP treatment.
 * Uses metadata only (not history — history is checked at runtime).
 */
export function evaluateFullWspEligibility(meta: {
  symbol: string;
  isActive: boolean;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  instrumentType: string | null;
  isEtf: boolean;
  isAdr?: boolean;
}): FullWspEligibilityResult {
  const upper = meta.symbol.toUpperCase();
  const exchangeUpper = meta.exchange?.toUpperCase() ?? '';

  const checks = {
    isActive: meta.isActive,
    isCommonStock: meta.instrumentType === 'CS' || meta.instrumentType === null, // null = assume CS for curated universe
    exchangeAllowed: (V1_ALLOWED_EXCHANGES_FULL_WSP as readonly string[]).includes(exchangeUpper) || exchangeUpper === '',
    validSymbolFormat: isValidSymbolFormat(upper),
    sectorPresent: meta.sector !== null && meta.sector !== '' && meta.sector !== 'Unknown',
    industryPresent: meta.industry !== null && meta.industry !== '',
    notEtf: !meta.isEtf,
    notAdr: !(meta.isAdr ?? false),
    notExcludedInstrumentType:
      meta.instrumentType === null ||
      !(V1_EXCLUDED_INSTRUMENT_TYPES as readonly string[]).includes(meta.instrumentType),
    notBenchmarkProxy: !isBenchmarkOrSectorProxy(upper),
  };

  const failedChecks: string[] = [];
  let exclusionReason: ExclusionReason | null = null;

  if (!checks.isActive) { failedChecks.push('isActive'); exclusionReason ??= 'inactive_or_delisted'; }
  if (!checks.validSymbolFormat) { failedChecks.push('validSymbolFormat'); exclusionReason ??= 'invalid_symbol_format'; }
  if (!checks.isCommonStock) { failedChecks.push('isCommonStock'); exclusionReason ??= 'non_common_stock'; }
  if (!checks.exchangeAllowed) { failedChecks.push('exchangeAllowed'); exclusionReason ??= 'exchange_not_allowed'; }
  if (!checks.sectorPresent) { failedChecks.push('sectorPresent'); exclusionReason ??= 'missing_sector'; }
  if (!checks.industryPresent) { failedChecks.push('industryPresent'); exclusionReason ??= 'missing_industry'; }
  if (!checks.notEtf) { failedChecks.push('notEtf'); exclusionReason ??= 'etf_not_eligible_for_full_wsp'; }
  if (!checks.notAdr) { failedChecks.push('notAdr'); exclusionReason ??= 'adr_excluded_v1'; }
  if (!checks.notExcludedInstrumentType) { failedChecks.push('notExcludedInstrumentType'); exclusionReason ??= 'unsupported_instrument_type'; }
  if (!checks.notBenchmarkProxy) { failedChecks.push('notBenchmarkProxy'); exclusionReason ??= 'proxy_only'; }

  return {
    eligible: failedChecks.length === 0,
    checks,
    failedChecks,
    exclusionReason,
  };
}

// ─── Classify Symbol from DB Row ──────────────────────────────────────────
/**
 * Given a raw DB symbol row, classify it into the correct WspSymbolClass.
 * This is the ONLY function that should assign symbol classes.
 */
export function classifySymbol(row: {
  symbol: string;
  name: string | null;
  exchange: string | null;
  asset_class: string | null;
  sector: string | null;
  industry: string | null;
  is_active: boolean | null;
  instrument_type?: string | null;
  is_etf?: boolean | null;
  is_adr?: boolean | null;
}): {
  symbolClass: WspSymbolClass;
  eligibleForBackfill: boolean;
  eligibleForFullWsp: boolean;
  exclusionReason: ExclusionReason | null;
} {
  const symbol = row.symbol.toUpperCase();
  const isActive = row.is_active ?? false;

  // 1. Inactive → excluded
  if (!isActive) {
    return { symbolClass: 'excluded', eligibleForBackfill: false, eligibleForFullWsp: false, exclusionReason: 'inactive_or_delisted' };
  }

  // 2. Invalid symbol format → excluded
  if (!isValidSymbolFormat(symbol)) {
    return { symbolClass: 'excluded', eligibleForBackfill: false, eligibleForFullWsp: false, exclusionReason: 'invalid_symbol_format' };
  }

  // 3. Benchmark / sector proxy → sector_benchmark_proxy
  if (isBenchmarkOrSectorProxy(symbol)) {
    return { symbolClass: 'sector_benchmark_proxy', eligibleForBackfill: true, eligibleForFullWsp: false, exclusionReason: 'proxy_only' };
  }

  // 4. Metals asset class → metals_limited
  if (row.asset_class === 'metals' || row.asset_class === 'commodity') {
    return { symbolClass: 'metals_limited', eligibleForBackfill: true, eligibleForFullWsp: false, exclusionReason: null };
  }

  // 4a. Excluded instrument types (warrants, rights, units, preferred, etc.)
  const instrType = row.instrument_type ?? null;
  if (instrType && (V1_EXCLUDED_INSTRUMENT_TYPES as readonly string[]).includes(instrType)) {
    return { symbolClass: 'excluded', eligibleForBackfill: false, eligibleForFullWsp: false, exclusionReason: 'unsupported_instrument_type' };
  }

  // 4b. ETFs → limited (not full WSP)
  if (row.is_etf) {
    return { symbolClass: 'limited_equity', eligibleForBackfill: true, eligibleForFullWsp: false, exclusionReason: 'etf_not_eligible_for_full_wsp' };
  }

  // 4c. ADRs → limited (excluded from full WSP in V1)
  if (row.is_adr) {
    return { symbolClass: 'limited_equity', eligibleForBackfill: true, eligibleForFullWsp: false, exclusionReason: 'adr_excluded_v1' };
  }

  // 5. Check full WSP eligibility using enriched metadata
  const eligibility = evaluateFullWspEligibility({
    symbol,
    isActive,
    exchange: row.exchange,
    sector: row.sector,
    industry: row.industry,
    instrumentType: instrType,
    isEtf: row.is_etf ?? false,
    isAdr: row.is_adr ?? false,
  });

  if (eligibility.eligible) {
    return { symbolClass: 'full_wsp_equity', eligibleForBackfill: true, eligibleForFullWsp: true, exclusionReason: null };
  }

  // 6. Has some metadata but fails full WSP → limited_equity (still backfill-worthy)
  const hasMinimalMeta = row.exchange !== null || row.sector !== null;
  if (hasMinimalMeta) {
    return { symbolClass: 'limited_equity', eligibleForBackfill: true, eligibleForFullWsp: false, exclusionReason: eligibility.exclusionReason };
  }

  // 7. No meaningful metadata → data_only
  return { symbolClass: 'data_only', eligibleForBackfill: true, eligibleForFullWsp: false, exclusionReason: eligibility.exclusionReason };
}

// ─── Classify Curated Universe Entry ──────────────────────────────────────
/**
 * For the hardcoded MarketUniverseStock entries, classify using known metadata.
 */
export function classifyCuratedSymbol(item: {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  exchange: string;
  assetClass: string;
  wspSupport: string;
}): WspSymbolClass {
  const symbol = item.symbol.toUpperCase();

  if (isBenchmarkOrSectorProxy(symbol)) return 'sector_benchmark_proxy';
  if (item.assetClass === 'metals' || item.assetClass === 'commodity') return 'metals_limited';

  if (item.wspSupport === 'full') {
    // Verify format
    if (!isValidSymbolFormat(symbol)) return 'limited_equity';
    return 'full_wsp_equity';
  }

  return 'limited_equity';
}

// ─── Runtime History Eligibility ──────────────────────────────────────────
/**
 * Given actual bar count, determine the maximum analysis level available.
 */
export function getHistoryEligibility(barCount: number): {
  canChart: boolean;
  canLimitedAnalysis: boolean;
  canFullWsp: boolean;
  maxLevel: 'none' | 'chartable' | 'limited' | 'full';
} {
  const canChart = barCount >= HISTORY_THRESHOLDS.chartableOnly;
  const canLimitedAnalysis = barCount >= HISTORY_THRESHOLDS.limitedAnalysis;
  const canFullWsp = barCount >= HISTORY_THRESHOLDS.fullWsp;

  const maxLevel = canFullWsp ? 'full' : canLimitedAnalysis ? 'limited' : canChart ? 'chartable' : 'none';
  return { canChart, canLimitedAnalysis, canFullWsp, maxLevel };
}
