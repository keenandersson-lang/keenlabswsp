# Product Stabilization Audit (2026-03-31)

## A. Current system map

### 1) Product surfaces and page composition
- **Dashboard (`/`)** assembles one payload (`useWspScreener`) then builds additional derived slices client-side (counts, top setups, fallback close prices) and wires market header, regime, heatmap, and setup lists in the page itself.
- **Screener (`/screener`)** reuses the same hook but does page-local pagination accumulation, page-local counts, and page-local manual refresh logic.
- **Stock detail (`/stock/:symbol`)** mixes data from 6+ query sources: screener snapshot, symbol detail endpoint, scanner row table, symbol metadata table, daily prices table, and indicators table; then conditionally re-runs WSP evaluation client-side.

### 2) Data fetching paths (live/side/fallback)
- **Primary active screener path in UI currently = direct Supabase table path** (`market_scan_results_latest` + `wsp_indicators`) from `fetchWspScreenerData`.
- If that direct path fails, UI falls back to local `demoStocks`/`demoMarket` and labels as fallback.
- There is **additional edge-route fetch machinery and response processor still present in the hook file** but not part of the active return path.
- Server-side Node route (`server/wsp-screener-route.ts`) still contains a full provider pipeline with staged quality/fallback logic.

### 3) Stock-detail data path
- `useStockDetail` targets `/api/wsp-symbol-detail` in dev and Supabase edge function in prod.
- Stock detail page then bypasses/overlays that with direct table queries for scanner row, prices, indicators, and symbol meta, and may recompute `evaluateStock` from those merged fragments.

## B. Main architectural problems

1. **Two competing architectures coexist (provider route pipeline vs direct DB path), but only one is truly active in the client path.**
   - This creates dead/half-alive logic, high cognitive load, and contradictory diagnostics.

2. **`use-wsp-screener.ts` is an overgrown mixed-responsibility module.**
   - It contains transport concerns, data sanitation, scoring assembly, fallback policy, direct SQL adapter behavior, sector/indicator enrichment, and UI-oriented provider status shaping.

3. **Page-level orchestration duplicates business logic.**
   - Dashboard and Screener each recompute counts and refresh flows; Dashboard performs an additional multi-page fetch loop for top setups.

4. **Stock detail is tightly coupled to screener internals and raw tables simultaneously.**
   - It depends on screener market state, scanner payload fields, raw daily_prices and wsp_indicators, and symbol-detail endpoint semantics at once.

5. **Fallback semantics are inconsistent across modules.**
   - FALLBACK is often displayed/treated as STALE, while some payloads declare `isLive: true` even with stale benchmark state.

6. **Contract drift risk between server routes and client adapters.**
   - Separate implementations of similar concerns (snapshot assembly, benchmark logic, fallback typing) are maintained in multiple places.

## C. Main product-trust problems

1. **State labeling can overstate freshness/reliability.**
   - Example: direct path marks `uiState: 'LIVE'` while benchmark status is `stale`; components also map FALLBACK to STALE labels.

2. **Users may see internally inconsistent stock detail outputs.**
   - One symbol view can combine endpoint data + direct table reads + screener-derived gates + freshly recomputed evaluation, causing silent source blending.

3. **Dashboard Top Setups can diverge from Screener table due to separate fetch/pagination loop and local filtering criteria.**

4. **Operational trust suffers because diagnostics imply multiple backends while runtime mostly uses one direct path.**

5. **Fallback to demo data is safe for rendering but can undermine product confidence if not explicitly and consistently communicated as simulated.**

## D. Recommended minimum module boundaries (freeze going forward)

1. **Snapshot Service boundary (single source of truth for screener payload)**
   - Input: page/pageSize/refresh options.
   - Output: canonical `ScreenerSnapshot` contract used by dashboard + screener.
   - Responsibility: choose one acquisition strategy internally (direct DB or provider route), normalize states, expose provenance.

2. **State/Trust Policy boundary**
   - One utility that maps raw backend states into user-facing trust levels (`LIVE`, `STALE`, `FALLBACK`, `ERROR`) and copy/labels.
   - All components consume this utility; no component-local relabeling.

3. **Stock Detail Read Model boundary**
   - A dedicated adapter/hook returns one coherent `StockDetailViewModel` with explicit source priorities and timestamps.
   - Page component should render only; no direct Supabase table joins in page component.

4. **Evaluation Engine boundary**
   - `evaluateStock` remains pure domain logic; adapters prepare inputs.
   - No UI modules should decide when to partially bypass the engine based on ad-hoc table availability.

5. **Presentation boundary**
   - `MarketHeader`, `MarketHeatmap`, `StockChartModule`, `StockTable` should be stateless/presentational with no implicit state remapping.

## E. Priority-ordered stabilization roadmap

### Priority 0 — Establish canonical runtime path (highest impact, lowest ambiguity)
- Decide and document **one** active screener acquisition path for production (direct DB snapshot OR provider route snapshot).
- Mark the other path as deprecated behind explicit feature flag or remove from active code path.
- Add explicit `dataProvenance` field (`direct_db`, `provider_route`, `demo_fallback`) in snapshot contract.

### Priority 1 — Normalize trust-state semantics end-to-end
- Define strict truth table for `uiState`, `benchmarkState`, `isLive`, `fallbackActive`, and display label.
- Remove component-local FALLBACK→STALE remapping and replace with shared mapper.
- Ensure every surface displays the same trust state for the same payload.

### Priority 2 — Split `use-wsp-screener` into adapters + contract mapper
- Extract:
  - direct DB adapter,
  - provider-route adapter (if retained),
  - canonical snapshot mapper,
  - fallback builder.
- Keep hook thin: query orchestration only.

### Priority 3 — Stabilize stock-detail read model
- Introduce `useStockDetailViewModel(symbol)` that resolves source precedence and timestamp reconciliation.
- Move all direct table joins out of page component.
- Ensure chart/checklist/sizer consume one resolved model.

### Priority 4 — Align dashboard/screener derivations
- Centralize shared derivations (counts, ranking, top setups criteria) in one selector module.
- Remove page-specific duplicated logic unless intentionally different and documented.

### Priority 5 — Add contract and trust regression checks
- Add unit tests for state-truth table and mapper outputs.
- Add integration tests for: direct path success, direct path failure to fallback, and stock-detail source precedence.

## F. First area to fix and why

**Fix first: canonical screener snapshot path + trust-state normalization (Priority 0 + 1).**

Why this first:
1. It is the foundation for dashboard, header, heatmap, screener table, and part of stock detail.
2. It removes the biggest source of contradiction (multiple partially active pipelines).
3. It directly addresses user trust: a product cannot be perceived as reliable if “LIVE/STALE/FALLBACK” means different things per module.
4. Every later stabilization step (stock detail read model, selector reuse, test hardening) becomes simpler once the canonical snapshot contract is stable.
