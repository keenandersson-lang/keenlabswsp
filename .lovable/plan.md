

# WSP Framework v1 Compliance — Full Alignment Plan

## Problems Identified

### 1. Sector Daily % (avg_pct_today) is wildly wrong
The `get_market_summary` RPC uses `AVG(pct_change_1d)` without outlier protection. Healthcare has a single symbol at +3265% which skews the average to +15.07%. Industrials similarly shows +26.24%.

**Fix**: Modify `get_market_summary` to use **median** (`PERCENTILE_CONT(0.5)`) or a **trimmed mean** (exclude values outside ±50%) for `avg_pct_today`. Median is simplest and most robust.

### 2. Pattern + Breakout are coupled incorrectly
Currently `patternAllowsEntry = pattern === 'climbing'` (line 49, wsp-engine.ts). A BASE stock approaching breakout gets zero breakout recognition. The scan payload has no `breakout_status` field.

**Fix — Database migration**:
- Add `breakout_status` column to `market_scan_results` (text, default 'NONE')
- Values: `NONE`, `APPROACHING`, `FRESH_BREAKOUT`, `AGING_BREAKOUT`, `STALE_BREAKOUT`, `FAILED_BREAKOUT`
- Add `is_base_origin` boolean to payload
- Update `run_broad_market_scan` SQL to compute breakout_status from resistance_level, breakout age, and close price
- Decouple pattern_state from breakout_status in entry logic: a BASE + FRESH_BREAKOUT can qualify for KÖP if all other gates pass

**Fix — Frontend**:
- Update `wsp-engine-contract.ts` to reflect the decoupled model
- Update `ScreenerRow` interface to include `breakout_status` and expose it
- Allow `computeEntryGate` to accept BASE with fresh breakout

### 3. Industry-to-sector mapping is polluted
261 symbols have `sector = 'Stocks'` with raw SIC industries like "Crude Petroleum Natural Gas". The `display_industry()` function maps "Stocks Proxy Basket" to "ETF" but these non-ETF symbols under "Stocks" sector are just unclassified equities.

**Fix — Database**:
- Run a data cleanup: for symbols where `sector = 'Stocks'` and they have a real SIC-based industry, reclassify them via `canonical_sector` using their SIC code
- Filter out `sector IN ('Stocks', 'ETF', 'Unknown')` from `get_market_summary` (already partially done but 'Stocks' leaks through)
- Ensure `get_equity_screener_rows` excludes `sector = 'Stocks'` from GICS-priority sort
- Add 'Stocks' to the exclusion list in `get_market_summary` WHERE clause

### 4. Blocked reasons not shown in screener
The `blockers` array exists in `market_scan_results` but the screener RPC (`get_equity_screener_rows`) doesn't return it, and the `Screener.tsx` page doesn't display it.

**Fix**:
- Add `blockers` to the SELECT in `get_equity_screener_rows` RPC
- Add `blockers` to `ScreenerRow` interface
- Display blocked reasons as small tags/chips in each screener row (expandable on click)

### 5. Universe & eligibility counts are ambiguous
Dashboard shows "totalStocks" as heatmap row count without distinguishing tiers.

**Fix**:
- Add a dedicated query or extend `UniverseCoverage` to show:
  - Total active symbols (from `symbols` table)
  - Symbols with GICS sector data
  - Symbols with full indicator coverage (from `wsp_indicators`)
  - Core screener universe (universe_tier = 'core')
  - Currently screenable rows (from latest scan run)

### 6. Sector page mixes ETF performance with WSP metrics
Sector cards show `avg_pct_today` (which should be equity breadth) alongside regime — no distinction between ETF proxy performance and equity aggregate.

**Fix**:
- Add sector ETF daily % (from `wsp_indicators` for XLK, XLF, etc.) as a separate field
- Label clearly: "ETF: XLK +1.2%" vs "Snitt aktier: +0.8%"

---

## Implementation Order

### Step 1: Fix sector daily % aggregation (database migration)
Update `get_market_summary` RPC to use median instead of mean for `avg_pct_today`, and add outlier clamp.

### Step 2: Clean industry/sector mapping (data + migration)
- Exclude 'Stocks' sector from `get_market_summary`
- Reclassify misassigned symbols via canonical_sector update
- Ensure `display_industry()` covers remaining unmapped SIC codes

### Step 3: Add breakout_status to scan results (database migration)
- Add column to `market_scan_results`
- Update `run_broad_market_scan` to compute breakout_status
- Decouple pattern from breakout in entry gate logic

### Step 4: Expose blockers in screener (database + frontend)
- Add `blockers` to screener RPC output
- Update `ScreenerRow` and `Screener.tsx` to display blocked reasons

### Step 5: Clarify universe counts (frontend)
- Extend `UniverseCoverage` with breakdown tiers
- Label sector cards with ETF vs equity metrics separately

### Step 6: Update engine contract (frontend)
- Update `wsp-engine-contract.ts` with decoupled breakout model
- Update `wsp-engine.ts` `computeEntryGate` to accept BASE + FRESH_BREAKOUT

---

## Files Changed

**Database migrations** (4-5 new migration files):
- Fix `get_market_summary` — median aggregation + exclude 'Stocks'
- Fix `get_equity_screener_rows` — add blockers to output
- Add `breakout_status` column to `market_scan_results`
- Update `run_broad_market_scan` — compute breakout_status
- Data cleanup for misclassified 'Stocks' sector symbols

**Frontend files**:
- `src/lib/wsp-engine-contract.ts` — add breakout_status types, decouple model
- `src/lib/wsp-engine.ts` — update `computeEntryGate` for BASE + breakout
- `src/lib/wsp-types.ts` — add BreakoutStatus type
- `src/hooks/use-equity-screener.ts` — add blockers to ScreenerRow
- `src/pages/Screener.tsx` — display blockers per row
- `src/pages/Index.tsx` — sector ETF vs equity distinction
- `src/components/UniverseCoverage.tsx` — tier breakdown

