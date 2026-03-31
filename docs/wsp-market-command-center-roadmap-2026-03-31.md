# WSP Market Command Center Roadmap (Market → Sector → Industry → Equity → Detail)

Date: 2026-03-31  
Scope: Controlled redesign roadmap using current WSP codebase and schema.

---

## A) Current project pieces that already support this model

### 1) Existing daily scan backbone is already close to top-down
- `daily-sync` orchestrates prices → indicators → broad scan execution (`run_broad_market_scan`) and therefore already has a daily batch spine suitable for “market-first” workflows.
- `run_broad_market_scan` already writes `sector`, `industry`, WSP pattern/score, recommendation, blockers, and payload per symbol into `market_scan_results`.
- `market_scan_results_latest` is a canonical latest-per-symbol read view that the UI already consumes.

**Practical implication:** The backend already computes equity-level outcomes on a daily cadence; we can aggregate upward into market/sector/industry snapshots instead of rebuilding the scanner.

### 2) Sector/industry classification infrastructure already exists
- `symbols` stores canonical sector/industry; `symbol_industry_alignment_active` exposes alignment eligibility and reasons.
- `refresh_scanner_universe_snapshot` already tracks sector/industry support readiness and baseline eligibility in `scanner_universe_snapshot`.

**Practical implication:** Sector→industry drilldowns can be grounded in canonical classifications already in production paths.

### 3) UI surfaces already map roughly to the five layers
- `Index` already renders market regime, sector heatmap, and top setups from shared screener payload.
- `Sectors`/`SectorAnalysis` and `MarketSummary` already compute sector-level and ETF-level summaries from `wsp_indicators` + symbol metadata.
- `Screener` + `StockTable` already present equity ranking lists.
- `StockDetail` already serves as final detailed analysis/chart page.

**Practical implication:** Main gap is orchestration and data contract coherence, not blank-page UI creation.

### 4) Existing stabilization direction is aligned
- The recent stabilization audit already recommends canonical snapshot boundaries, trust-state normalization, and selector centralization.

**Practical implication:** This roadmap can extend that effort directly rather than introducing a new architecture branch.

---

## B) What is missing for a true Market → Sector → Industry → Equity → Detail model

### 1) No explicit multi-layer snapshot contract
Current payloads are mostly equity-first (`stocks[]`) with market/sector fragments derived ad hoc in different pages. Missing:
- `market_layer`
- `sector_layer[]`
- `industry_layer[]` (keyed by sector)
- `equity_layer[]` (keyed by industry)
- deterministic drilldown metadata and counts.

### 2) Aggregations are duplicated and page-local
- `Index`, `Screener`, and `MarketSummary` each compute counts/ranking logic in different ways.
- Top setups in dashboard use a separate pagination/fetch loop from screener list, causing drift.

### 3) Industry is underrepresented in navigation and read model
- Industry is present in data but not promoted as first-class route state.
- Drill path is not canonicalized as sector → industry → ranked equities.

### 4) Trust/freshness semantics are not layer-aware
- Trust state exists, but not tied to per-layer as-of timestamps and source provenance.
- Product cannot confidently say: market is live, sector stale by 1 day, equity stale by 2 days, etc.

### 5) Detail still acts as a parallel entry mode
- Global symbol search in `AppLayout` routes directly to `/stock/:symbol`, preserving symbol-first behavior.
- This should remain available as utility, but not define primary workflow.

### 6) Missing persisted layer snapshots for fast, stable reads
- UI currently pulls raw/latest tables and recomputes layer summaries client-side.
- Need DB-level/materialized read models so all surfaces read the same “daily market command center snapshot.”

---

## C) Recommended canonical data pipeline

## Guiding rule
Keep the existing ingestion/scanner jobs; add a **post-scan aggregation stage** that produces explicit layer snapshots.

### Pipeline stages (daily, in order)
1. **Ingest & enrich (existing):** `daily-sync` / historical feeds write `daily_prices`, refresh symbol enrichment/classification.
2. **Materialize indicators (existing):** `materialize_wsp_indicators_from_prices` updates `wsp_indicators`.
3. **Run broad scan (existing):** `run_broad_market_scan` fills `market_scan_results` and `market_scan_results_latest`.
4. **Build command-center snapshots (new):** `build_market_command_snapshot(as_of_date, run_id)` computes:
   - market regime + breadth + risk-on/risk-off
   - sector ranking/regime/breadth/setup count
   - industry ranking within sectors
   - equity ranking within industries with setup quality facets.
5. **Publish active snapshot (new):** write `active_snapshot_id` (or latest by date) for stable frontend reads.

### Data provenance requirement
Every record in each layer includes:
- `as_of_date`
- `source_run_id` (market scan run)
- `built_at`
- `freshness_state` (live/stale/fallback/error)
- `rule_version`.

### Why this works with current code
It reuses existing scanners and indicator tables, avoids a rewrite, and moves layer aggregation out of page components.

---

## D) Recommended snapshot/view/table architecture

Use additive tables/views first (no destructive refactor in phase 1).

### 1) Snapshot registry
- `market_command_snapshots`
  - `id`, `as_of_date`, `scan_run_id`, `status`, `built_at`, `rule_version`, `metadata`.

### 2) Market layer table
- `market_layer_snapshot`
  - one row per snapshot
  - fields: benchmark regime, breadth metrics (`pct_above_50`, `pct_above_150`), risk-on score, setup totals, market condition label.

### 3) Sector layer table
- `sector_layer_snapshot`
  - one row per snapshot+sector
  - fields: `sector`, `rank`, `strength_score`, `regime`, `breadth`, `valid_setup_count`, `leader_equity_count`, `momentum_1d/1w/1m`.

### 4) Industry layer table
- `industry_layer_snapshot`
  - one row per snapshot+sector+industry
  - fields: `sector`, `industry`, `rank_within_sector`, `strength_score`, `breadth`, `valid_setup_count`, `top_equity_symbol`, `avg_mansfield`.

### 5) Equity layer table
- `equity_layer_snapshot`
  - one row per snapshot+symbol
  - fields: `sector`, `industry`, `rank_within_industry`, `wsp_score`, `setup_quality`, `breakout_freshness_days`, `volume_multiple`, `mansfield_rs`, `recommendation`, `why_included`.

### 6) Read views for frontend
- `market_command_active_snapshot`
- `market_layer_active`
- `sector_layer_active`
- `industry_layer_active`
- `equity_layer_active`

### 7) Keep current tables as source-of-truth inputs
Preserve `market_scan_results_latest`, `wsp_indicators`, `symbols`, `daily_prices` as computation inputs during migration.

---

## E) Recommended frontend module structure

Move from page-driven assembly to a single command-center query + selectors.

### 1) New feature boundary
Create `src/features/market-command/`:
- `api/fetch-market-command-snapshot.ts`
- `hooks/use-market-command.ts`
- `selectors/market.ts`
- `selectors/sector.ts`
- `selectors/industry.ts`
- `selectors/equity.ts`
- `types.ts`

### 2) Page responsibilities (minimal churn)
- `Index` becomes **Market layer + Sector leaders entry point** using `useMarketCommand`.
- `Sectors` becomes canonical Sector + Industry drilldown page.
- `Screener` becomes canonical Equity layer list scoped by selected industry/sector from route params.
- `StockDetail` remains final layer and consumes selected symbol context from upstream drill path.

### 3) Route/query-state drilldown contract
Without visual overhaul, enforce query params:
- `/` (market)
- `/sectors?sector=Technology`
- `/screener?sector=Technology&industry=Software`
- `/stock/NVDA?sector=Technology&industry=Semiconductors&snapshot=...`

### 4) Search behavior adjustment
Keep global search, but:
- default CTA from market/sectors/industry should push drilldown flow, not symbol jump.
- search jump remains secondary utility.

---

## F) Recommended rollout plan in phases

### Phase 0 — Contract freeze and instrumentation (1–2 days)
- Freeze canonical definitions for market/sector/industry/equity layer metrics and formulas.
- Add rule versioning and layer freshness fields.
- Add a lightweight `market_command_snapshots` registry table.

### Phase 1 — Backend aggregation MVP (3–5 days)
- Implement `build_market_command_snapshot` SQL function/procedure.
- Populate market/sector/industry/equity layer tables from existing scan + indicator data.
- Add active-layer views.
- Add smoke SQL checks ensuring row counts and no null sector/industry keys.

### Phase 2 — Frontend read-model adoption (3–5 days)
- Add `src/features/market-command` hook + selectors.
- Switch `Index` and `Sectors` to read new views.
- Keep `Screener` and `StockDetail` on existing path initially, with bridge mapping.

### Phase 3 — Drilldown enforcement and equity alignment (3–4 days)
- Route state for sector→industry→equity.
- Refactor `Screener` to consume `equity_layer_active` and remove page-local ranking duplication.
- Standardize top setups to read same equity-layer ranking criteria.

### Phase 4 — Detail layer integration + deprecation cleanup (2–4 days)
- Feed `StockDetail` with upstream snapshot context (as-of/source).
- Remove dead/duplicated derivations and fallback remapping from pages/hook internals.
- Keep old endpoints behind feature flag one release, then remove.

### Phase 5 — Trust and regression hardening (ongoing)
- Tests for layer consistency (counts roll up correctly market↔sector↔industry↔equity).
- Tests for stale/live/fallback labels with explicit timestamps.
- Admin diagnostics updated to include layer snapshot health.

---

## G) What to build first for maximum leverage

### Build first: **Snapshot aggregation + active views (Phase 1)**

Why this is highest leverage:
1. Eliminates page-local recomputation drift immediately.
2. Enables all frontend layers to consume one coherent dataset.
3. Makes drilldown routing mostly a UI/state problem rather than a data integrity problem.
4. De-risks later `StockDetail` cleanup by providing consistent as-of context.

**Concrete first deliverables:**
- `build_market_command_snapshot()`
- `market_layer_active`, `sector_layer_active`, `industry_layer_active`, `equity_layer_active`
- one React hook `useMarketCommand()` that returns all four layers in one contract.

---

## H) Preserve vs deprecate vs reconnect

### Preserve
- Ingestion/scanner backbone: `daily-sync`, indicator materialization, `run_broad_market_scan`, `market_scan_results_latest`.
- Presentational components already useful in layered flow (`MarketHeader`, `MarketRegime`, `MarketHeatmap`, `StockTable`, chart/checklist modules).
- Canonical classification/alignment machinery.

### Deprecate (gradually)
- Page-local derivation duplication (counts/rankings/top setups computed separately in `Index`, `Screener`, `MarketSummary`).
- Equity-first mental model as primary navigation entry.
- Mixed/parallel adapter behavior inside large `use-wsp-screener` internals once `useMarketCommand` is stable.

### Reconnect
- `Index` should consume market + top sectors from snapshot layers (not raw stocks only).
- `Sectors` should become sector→industry control surface using the same snapshot id.
- `Screener` should become industry-scoped equity ranking list.
- `StockDetail` should accept snapshot context and render as final drilldown.
- Admin funnel should report layer snapshot build status and freshness next to existing scanner funnel.

---

## Non-goals / constraints respected
- No full rewrite.
- No aesthetic redesign mandate.
- No metals/crypto expansion in this task.
- Controlled additive migration on top of current schema and UI.
