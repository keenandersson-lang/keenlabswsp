# Two-Layer Equity Product Architecture

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

**Current qualifying count**: ~1,049 (1,163 full_wsp minus 114 with sector='Stocks'). After indicator_ready: ~800-900.

**Data contract**:
- Mansfield RS measured against sector ETF (e.g., AAPL vs XLK) — Phase 2 enhancement
- Each core equity maps to exactly one `canonical_sector` → one sector ETF
- Industry ETF mapping deferred (no reliable industry ETF universe yet)
- Dashboard, heatmap, and top-down flow use ONLY Module 1 data

---

## B. Module 2 — Expanded US Equity Universe (Discovery Layer)

**Definition**: Broader US equity scan beyond the core. Quality improves as enrichment/backfill continues.

**Composition**: All active symbols NOT in Module 1:
- `full_wsp_equity` with sector='Stocks' or low confidence
- `limited_equity` or pending classification
- Newly enriched symbols without 50+ bars yet

**Current count**: ~9,500+ symbols

**Data contract**:
- Mansfield RS against SPY only (broad benchmark)
- May have incomplete metadata or shorter history
- Screener labels these as "Expanding Universe"
- NOT used for dashboard regime/heatmap calculations

---

## C. Data/Model Changes

### 1. New `universe_tier` column on `symbols`
```sql
ALTER TABLE symbols ADD COLUMN universe_tier TEXT DEFAULT 'expanded';
UPDATE symbols SET universe_tier = 'benchmark' WHERE support_level = 'sector_benchmark_proxy';
UPDATE symbols SET universe_tier = 'core'
  WHERE support_level = 'full_wsp_equity'
  AND canonical_sector IN ('Healthcare','Information Technology','Industrials','Financials',
    'Consumer Discretionary','Materials','Communication Services','Consumer Staples',
    'Utilities','Real Estate','Energy')
  AND classification_confidence_level IN ('high','medium');
```

### 2. Sector-relative Mansfield RS (Phase 2, not blocking)
- New column `mansfield_rs_sector` on `wsp_indicators`
- Materialization calculates RS vs sector ETF for core symbols
- Current SPY-based Mansfield continues working

### 3. No other schema changes — `universe_tier` is the sole discriminator

---

## D. Dashboard & Screener Structure

### Dashboard
- **Market Regime**: Module 1 benchmarks only (unchanged)
- **Heatmap**: Module 1 core only (`universe_tier = 'core'`)
- **Sector Analysis**: Module 1 only
- **New**: "Universe Coverage" card — Core: X symbols (stable) / Expanding: Y symbols (+Z this week)

### Screener
- **Default tab**: "Core Universe" — `universe_tier = 'core'` results only
- **Second tab**: "Expanded Universe" — `universe_tier = 'expanded'` results
- Visual badge: ✓ Core (trusted) vs 🔄 Expanded (growing)

### Stock Detail
- Tier badge: "Core Universe" or "Expanded Universe"
- Subtle note for expanded: "Part of the expanding coverage"

---

## E. Progress/Coverage Metrics

### Admin (/admin)
- Core coverage: X/Y core symbols with fresh indicators
- Expanded: X enriched, Y pending
- Velocity: +N symbols/day

### Public dashboard
- "849 Core Equities • 11 Sectors • Daily Updates"
- "2,400+ Expanding Universe • Growing Daily"
- Weekly delta indicator

---

## F. Implementation Sequence

### Phase 1 — Foundation (1 session)
1. Migration: `universe_tier` column + backfill
2. Update `get_heatmap_data`, `get_market_summary` to filter `universe_tier IN ('core','benchmark')`
3. Add tier badge to screener

### Phase 2 — Screener tabs (1 session)
4. Core/Expanded tabs on Screener page
5. `get_equity_screener_rows` accepts `p_universe_tier` parameter

### Phase 3 — Dashboard coverage widget (1 session)
6. `get_universe_coverage_stats` RPC
7. Coverage card on dashboard

### Phase 4 — Sector-relative RS (future)
8. `mansfield_rs_sector` column
9. Update materialization for sector-relative RS

**Safety**: All changes additive. `universe_tier` defaults to 'expanded', so existing queries unchanged until explicitly filtered.
