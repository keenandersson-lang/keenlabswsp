/**
 * WSP Engine Contract v1 — Single Source of Truth
 *
 * This file defines the EXACT rules that govern every WSP decision
 * across dashboard, screener, stock detail, and top setups.
 *
 * NO other module may invent independent logic for these decisions.
 * The SQL RPCs (materialize_wsp_indicators_from_prices, run_broad_market_scan)
 * and the TypeScript engine (wsp-engine.ts) MUST implement identical semantics.
 *
 * Source: Wall Street Protocol — Weinstein Stage Analysis
 */

// ─── MARKET REGIME ──────────────────────────────────────────────────────
/**
 * Market regime is determined by the broad benchmark (SPY, QQQ).
 *
 * BULLISH:  price > MA50 AND MA50 slope = 'rising'
 * BEARISH:  MA50 slope = 'falling' (regardless of price vs MA50)
 * NEUTRAL:  price > MA50 but MA50 slope is flat, OR price < MA50 but slope not falling
 *
 * A falling MA50 slope triggers BEARISH even if price is above MA50.
 * This ensures regime reflects negative momentum early.
 */
export const MARKET_REGIME_RULES = {
  bullish: 'price > MA50 AND MA50_slope = rising',
  bearish: 'MA50_slope = falling',
  neutral: 'everything else',
} as const;

// ─── STAGE MODEL (Pattern Classification) ───────────────────────────────
/**
 * WSP defines exactly 4 distinct stages. There is NO "base_or_climbing" blend.
 *
 * CLIMBING (Weinstein Stage 2 — Advancing):
 *   - price > MA50
 *   - MA50 > MA150 (MAs stacked correctly)
 *   - MA50 slope = 'rising'
 *   Prerequisites for KÖP signal. The strongest stage.
 *
 * BASE (Weinstein Stage 1 — Basing):
 *   - price > MA150 (still above long-term support)
 *   - NOT meeting climbing criteria (MAs not stacked or slope not rising)
 *   Watchlist candidate. Potential future climbing setup.
 *
 * TIRED (Weinstein Stage 3 — Topping):
 *   - price > MA150 but MA50 slope = 'falling'
 *   - OR price < MA50 and close to MA150
 *   Warning stage. Momentum fading.
 *
 * DOWNHILL (Weinstein Stage 4 — Declining):
 *   - price < MA50 AND price < MA150
 *   - MA50 slope = 'falling'
 *   Avoid. Structural downtrend.
 *
 * Classification order (first match wins):
 *   1. climbing: close > MA50 AND MA50 > MA150 AND slope = 'rising'
 *   2. downhill: close < MA50 AND close < MA150 AND slope = 'falling'
 *   3. tired:    close < MA50 OR slope = 'falling' (but above MA150)
 *   4. base:     everything else above MA150 or above MA50
 *   5. tired:    final fallback (below both MAs, slope not falling)
 */
export const STAGE_MODEL = {
  climbing: {
    weinsteinStage: 2,
    criteria: 'close > MA50 AND MA50 > MA150 AND MA50_slope = rising',
    allowsEntry: true,
  },
  base: {
    weinsteinStage: 1,
    criteria: 'above MA150 but not meeting climbing criteria',
    allowsEntry: false,
  },
  tired: {
    weinsteinStage: 3,
    criteria: 'momentum fading — slope falling or below MA50 while above MA150',
    allowsEntry: false,
  },
  downhill: {
    weinsteinStage: 4,
    criteria: 'close < MA50 AND close < MA150 AND MA50_slope = falling',
    allowsEntry: false,
  },
} as const;

export type WSPStage = keyof typeof STAGE_MODEL;

// ─── ENTRY GATE (KÖP Qualification) ────────────────────────────────────
/**
 * A symbol qualifies for KÖP ONLY if ALL of these are true:
 *
 * 1. Stage = 'climbing'
 * 2. Price > MA50
 * 3. Price > MA150
 * 4. MA50 slope = 'rising'
 * 5. Volume ratio >= 2.0x (vs 5-day average, excluding current day)
 * 6. Mansfield RS > 0 (outperforming benchmark)
 *
 * Future gates (Phase E — not yet implemented in SQL):
 * 7. Breakout above resistance zone confirmed
 * 8. Breakout is fresh (within N bars)
 * 9. Sector aligned (sector ETF in uptrend)
 * 10. Market favorable (SPY regime = bullish)
 */
export const ENTRY_GATE_RULES = {
  stage: 'climbing',
  priceAboveMA50: true,
  priceAboveMA150: true,
  ma50SlopeRising: true,
  volumeRatioMin: 2.0,
  mansfieldPositive: true,
} as const;

// ─── WSP SCORE (0–5 integer scale) ─────────────────────────────────────
/**
 * Each check = 1 point. Max = 5.
 *
 * 1. price > MA50
 * 2. price > MA150
 * 3. MA50 slope = 'rising'
 * 4. volume ratio >= 2.0
 * 5. Mansfield RS > 0
 *
 * Score thresholds for recommendation:
 * - KÖP:    score = 5 AND stage = 'climbing'  (all gates pass)
 * - BEVAKA: score >= 3 AND stage IN ('climbing', 'base')
 * - SÄLJ:   stage = 'tired' OR stage = 'downhill'
 * - UNDVIK: stage = 'downhill' OR (below MA50 AND slope falling)
 */
export const SCORE_SCALE = {
  max: 5,
  kopMinimum: 5,
  bevakaMinimum: 3,
} as const;

// ─── RECOMMENDATION MAPPING ────────────────────────────────────────────
/**
 * Exactly 4 recommendations. NO "AVVAKTA" — use BEVAKA for watch signals.
 *
 * KÖP:    climbing + all 5 entry gates pass (score = 5)
 * BEVAKA: climbing or base with score >= 3 but not all gates pass
 * SÄLJ:   tired pattern, OR price below MA150
 * UNDVIK: downhill pattern, OR below MA50 with falling slope
 *
 * Priority order (first match):
 *   1. price < MA150 → SÄLJ
 *   2. climbing + score = 5 → KÖP
 *   3. tired → SÄLJ
 *   4. downhill → UNDVIK
 *   5. below MA50 + slope not rising → UNDVIK
 *   6. climbing or base → BEVAKA
 *   7. fallback → UNDVIK
 */
export type WSPRecommendation = 'KÖP' | 'BEVAKA' | 'SÄLJ' | 'UNDVIK';

// ─── VOLUME CONFIRMATION ───────────────────────────────────────────────
/**
 * Volume ratio = current_day_volume / avg_volume_5d
 * avg_volume_5d = average of 5 PRECEDING days (excludes current day)
 * Threshold for entry: >= 2.0x
 * Threshold for score point: >= 2.0x
 */
export const VOLUME_RULES = {
  lookbackDays: 5,
  excludeCurrentDay: true,
  entryThreshold: 2.0,
  scoreThreshold: 2.0,
} as const;

// ─── MANSFIELD RELATIVE STRENGTH ───────────────────────────────────────
/**
 * Formula: ((stock_close / stock_SMA200) / (benchmark_close / benchmark_SMA200) - 1) * 100
 *
 * Two variants:
 * - mansfield_rs: measured against SPY (all symbols)
 * - mansfield_rs_sector: measured against sector ETF (core symbols only)
 *
 * Entry gate: mansfield_rs > 0 (outperforming SPY)
 * Score point: mansfield_rs > 0
 */
export const MANSFIELD_RULES = {
  lookbackBars: 200,
  benchmarkSymbol: 'SPY',
  positiveThreshold: 0,
  formula: '((close / SMA200) / (benchmark_close / benchmark_SMA200) - 1) * 100',
} as const;

// ─── SECTOR ETF MAPPING ────────────────────────────────────────────────
export const SECTOR_ETF_MAP: Record<string, string> = {
  'Technology': 'XLK',
  'Financials': 'XLF',
  'Healthcare': 'XLV',
  'Energy': 'XLE',
  'Consumer Discretionary': 'XLY',
  'Industrials': 'XLI',
  'Communication Services': 'XLC',
  'Consumer Staples': 'XLP',
  'Materials': 'XLB',
  'Real Estate': 'XLRE',
  'Utilities': 'XLU',
} as const;

// ─── BLOCKER REASONS ───────────────────────────────────────────────────
/**
 * Explicit reasons a symbol is blocked from KÖP.
 * These are stored in the scan payload for transparency.
 */
export const BLOCKER_DEFINITIONS = {
  volume_not_confirmed: 'volume_ratio < 2.0x',
  ma50_slope_not_rising: 'MA50 slope is not rising',
  below_ma50: 'price below MA50',
  below_ma150: 'price below MA150',
  mansfield_negative: 'Mansfield RS <= 0',
  pattern_not_climbing: 'stage is not climbing',
  low_score: 'WSP score below threshold',
} as const;

// ─── INDUSTRY SOURCE OF TRUTH ──────────────────────────────────────────
/**
 * The `canonical_industry` field from the symbols table is the source.
 * If canonical_industry is NULL, empty, or a raw SIC description,
 * display "—" in the UI. Do NOT show SIC codes or raw SIC descriptions.
 *
 * Known SIC junk patterns to filter:
 * - All-caps multi-word strings (e.g. "TELEPHONE COMMUNICATIONS (NO RADIOTELEPHONE)")
 * - Strings containing parentheses
 * - Strings longer than 50 characters
 */
export function isCleanIndustry(value: string | null | undefined): boolean {
  if (!value || value === 'Unknown' || value === '') return false;
  if (value.length > 50) return false;
  if (/\(/.test(value)) return false;
  if (value === value.toUpperCase() && value.includes(' ')) return false;
  return true;
}

// ─── PARTIAL DATA TREATMENT ────────────────────────────────────────────
/**
 * Symbols with < 200 bars may have NULL MA150, MA200, Mansfield RS.
 * These symbols:
 * - CAN appear in screener as 'base' or 'tired' (using MA50 only)
 * - CANNOT qualify for KÖP (missing gates)
 * - SHOULD be labeled as "partial data" in UI
 * - Score is computed on available gates only (max stays 5)
 */
export const PARTIAL_DATA_RULES = {
  minBarsForScanner: 50,
  minBarsForFullAnalysis: 200,
  minBarsForCharting: 20,
} as const;

// ─── TOP SETUP ELIGIBILITY ─────────────────────────────────────────────
/**
 * Top setups shown on the dashboard must meet:
 * 1. recommendation = 'KÖP' OR (recommendation = 'BEVAKA' AND score >= 4)
 * 2. canonical_sector is one of 11 GICS sectors
 * 3. approved_for_live_scanner = true
 * 4. NOT blocked_low_quality
 *
 * Ranking: score DESC, then volume_ratio DESC (capped at 20.0)
 */
export const TOP_SETUP_RULES = {
  minScore: 4,
  allowedRecommendations: ['KÖP', 'BEVAKA'] as const,
  requireGicsSector: true,
  requireApproved: true,
} as const;
