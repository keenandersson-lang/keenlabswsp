# Two-Layer Equity Product Architecture

## Status: Phases 1–3 ✅ Complete | Phase 4 Planned

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
- Mansfield RS measured against SPY (current) → sector ETF (Phase 4)
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

### Phase 3 — Dashboard Coverage Widget ✅
- `get_universe_coverage_stats` RPC returns core/expanded/benchmark counts, indicator coverage %, and 7-day enrichment growth
- `UniverseCoverage` component on dashboard with progress bars and trend labels
- Live stats: Core ~1,049 (97% coverage) · Expanded ~9,600 (2% coverage, +1,032/week)

---

## D. Phase 4 — Sector-Relative Mansfield RS (Planned)

### Goal
Replace SPY-only Mansfield RS with sector-relative RS for core symbols, giving users a more precise measure of relative strength within their sector.

### Formula
`mansfield_rs_sector = ((Stock / Stock_SMA200) / (SectorETF / SectorETF_SMA200) - 1) * 100`

### Data Changes

1. **New column on `wsp_indicators`**:
   ```sql
   ALTER TABLE wsp_indicators ADD COLUMN mansfield_rs_sector NUMERIC;
   ```

2. **Sector ETF mapping** (already implicit via `canonical_sector` → sector ETF):
   | canonical_sector | ETF |
   |---|---|
   | Information Technology | XLK |
   | Financials | XLF |
   | Healthcare | XLV |
   | Industrials | XLI |
   | Consumer Discretionary | XLY |
   | Consumer Staples | XLP |
   | Energy | XLE |
   | Utilities | XLU |
   | Real Estate | XLRE |
   | Communication Services | XLC |
   | Materials | XLB |

3. **Update `materialize_wsp_indicators_from_prices`**:
   - For `universe_tier = 'core'` symbols: compute `mansfield_rs_sector` using sector ETF price/SMA200
   - For `universe_tier = 'expanded'` symbols: leave `mansfield_rs_sector` NULL (continue using SPY-based `mansfield_rs`)
   - Requires sector ETF to have ≥200 bars of history (already satisfied for all 11)

4. **Update `get_symbol_detail`**: Return `mansfield_rs_sector` alongside existing `mansfield_rs`

5. **Update `get_equity_screener_rows`**: Include `mansfield_rs_sector` in payload for core symbols

### UI Changes

1. **Stock Detail page**: Show both values for core symbols:
   - "RS vs Sector (XLK): +3.2" — primary
   - "RS vs SPY: +1.8" — secondary/tooltip
   
2. **Screener**: Sort/filter by sector-relative RS for core tab

3. **Heatmap**: Optional toggle between SPY RS and sector RS coloring

### Prerequisites
- All 11 sector ETFs must have `universe_tier = 'benchmark'` and ≥200 bars ✅
- Core symbols must have valid `canonical_sector` mapping ✅

### Implementation Steps
1. Migration: Add `mansfield_rs_sector` column
2. Update materialization RPC to compute sector-relative RS for core symbols
3. Update `get_symbol_detail` and screener RPCs to surface the new column
4. Update Stock Detail UI to display sector RS
5. Update Screener to allow sorting by sector RS

### Safety
- Additive only — existing `mansfield_rs` (SPY-based) remains unchanged
- Expanded universe continues using SPY-based RS
- No breaking changes to existing queries or UI

---

## E. Future Considerations

- **Auto-promotion**: When expanded symbols gain valid GICS sector + high/medium confidence, auto-promote to core tier
- **Industry ETF mapping**: Deferred until reliable industry ETF universe is available
- **Weekly delta tracking**: Store weekly coverage snapshots for trend visualization
