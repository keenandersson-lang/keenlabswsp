# Two-Layer Equity Product Architecture

## Status: Phases 1–4 ✅ Complete | Phase 5 Planned

---

## A. Module 1 — Baseline Core (High-Trust Layer)

**Definition**: The curated, fully-classified equity universe that updates reliably every trading day and serves as the primary trust layer.

**Composition**:
- **Benchmarks (15)**: SPY, QQQ, DIA, IWM + 11 GICS sector ETFs (XLK, XLF, XLV, XLI, XLY, XLP, XLE, XLU, XLRE, XLC, XLB)
- **Core Equities**: Symbols meeting ALL of:
  - `support_level = 'full_wsp_equity'`
  - `classification_confidence_level IN ('high', 'medium')`
  - `canonical_sector` is one of the 11 GICS sectors (not 'Stocks' or 'Unknown')
  - `eligible_for_backfill = true`
  - ≥50 bars of history (`indicator_ready`)

**Current qualifying count**: ~1,049 core symbols.

**Data contract**:
- Mansfield RS measured against SPY (`mansfield_rs`) AND sector ETF (`mansfield_rs_sector`) for core symbols
- Each core equity maps to exactly one `canonical_sector` → one sector ETF
- Dashboard, heatmap, and top-down flow use ONLY Module 1 data

---

## B. Module 2 — Expanded US Equity Universe (Discovery Layer)

**Definition**: Broader US equity scan beyond the core. Quality improves as enrichment/backfill continues.

**Composition**: All active symbols NOT in Module 1:
- `full_wsp_equity` with sector='Stocks' or low confidence
- `limited_equity` or pending classification
- Newly enriched symbols without 50+ bars yet

**Current count**: ~9,600 symbols

**Data contract**:
- Mansfield RS against SPY only (broad benchmark)
- May have incomplete metadata or shorter history
- Screener labels these as "Expanding Universe"
- NOT used for dashboard regime/heatmap calculations

---

## C. Completed Phases

### Phase 1 — Foundation ✅
- Migration: `universe_tier` column added to `symbols` table with values `benchmark`, `core`, `expanded`
- Backfill logic: benchmarks set by `support_level = 'sector_benchmark_proxy'`, core by GICS sector + high/medium confidence + full_wsp_equity
- `get_heatmap_data` and `get_market_summary` filter by `universe_tier IN ('core', 'benchmark')`

### Phase 2 — Screener Tabs ✅
- Core/Expanded tabs on Screener page with visual badges
- `get_equity_screener_rows` accepts `p_universe_tier` parameter (`'core'`, `'expanded'`, or NULL for all)
- Tier filter threaded through `useMarketCommand` → `snapshot.ts` → RPC
- Fixed PostgREST PGRST203 ambiguity by dropping old 2-parameter overload

### Phase 3 — Dashboard Coverage Widget ✅
- `get_universe_coverage_stats` RPC returns core/expanded/benchmark counts, indicator coverage %, and 7-day enrichment growth
- `UniverseCoverage` component on dashboard with progress bars and trend labels
- Live stats: Core ~1,049 (97% coverage) · Expanded ~9,600 (2% coverage, +1,032/week)

### Phase 4 — Sector-Relative Mansfield RS ✅
- **Database**: Added `mansfield_rs_sector` column to `wsp_indicators`
- **Materialization**: Updated `materialize_wsp_indicators_from_prices` to compute sector-relative RS for core symbols using their mapped sector ETF (XLK, XLF, etc.)
- **Benchmark tier fix**: Reclassified 11 sector ETFs from `universe_tier = 'expanded'` to `'benchmark'`
- **Stock Detail UI**: Shows color-coded badges for both "RS vs SPY" and "RS vs Sektor" in header
- **Screener**: Added "Starkast RS vs Sektor" sort option in Core Universe tab, plumbed `mansfield_rs_sector` through payload → `EvaluatedStock`
- **Daily sync**: Triggered ETF price refresh to populate `mansfield_rs_sector` for current dates
- **Verified**: Materialization produces correct values; UI displays both RS metrics

---

## D. Phase 5 — Production Hardening & Auto-Promotion (Planned)

### Goal
Harden the two-layer architecture for daily production reliability, add auto-promotion of expanded symbols to core, and improve observability.

### 5.1 Auto-Promotion Pipeline
- When an expanded symbol gains valid GICS `canonical_sector` + `classification_confidence_level IN ('high','medium')` + ≥50 bars, auto-promote `universe_tier` to `'core'`
- Run as part of daily materialization or as a separate scheduled function
- Log promotions to `data_sync_log` for auditability

### 5.2 Pipeline Health & Observability
- Extend `run_pipeline_health_checks` to verify:
  - All 11 sector ETFs have fresh prices (≤1 trading day stale)
  - `mansfield_rs_sector` is non-NULL for ≥95% of core symbols on latest calc_date
  - No universe_tier regressions (core count doesn't drop >5% day-over-day)
- Surface health check results on Admin panel

### 5.3 Heatmap Sector RS Toggle
- Optional toggle on heatmap between SPY-relative and sector-relative RS coloring
- Core symbols use `mansfield_rs_sector` when sector toggle active; expanded symbols always use `mansfield_rs`

### 5.4 Industry-Level Drill-Down (Stretch)
- Group core symbols by `canonical_industry` within each sector
- Show industry-level RS aggregates in Sector Analysis view
- Deferred until reliable industry ETF universe is available

### Prerequisites
- Phase 4 fully operational ✅
- Daily sync running reliably for all benchmarks ✅
- Sector ETF prices current ✅

### Safety
- Auto-promotion is additive — symbols only move core→expanded via manual admin action
- Health checks are read-only alerts, not automated rollbacks
- All changes backward-compatible with existing queries

---

## E. Future Considerations

- **Industry ETF mapping**: Deferred until reliable industry ETF universe is available
- **Weekly delta tracking**: Store weekly coverage snapshots for trend visualization
- **Multi-timeframe RS**: Weekly/monthly Mansfield RS alongside daily
- **RS momentum**: Rate of change of Mansfield RS to detect improving/deteriorating relative strength
