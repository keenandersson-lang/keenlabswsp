# WSP Scanner Scope Audit — Real Connectivity vs Architecture
Date: 2026-03-31

## Scope audited
- Frontend runtime: dashboard (`/`), screener (`/screener`), stock detail (`/stock/:symbol`), chart module.
- Frontend data adapters/hooks: `use-wsp-screener`, `use-market-command`, `use-stock-detail`.
- Server routes: `wsp-screener-route`, `wsp-symbol-detail-route`, provider selection.
- Supabase edge functions: `daily-sync`, `scan-market`, `wsp-screener`, `wsp-symbol-detail`, `historical-backfill`, `yahoo-backfill`, `enrich-symbols`, `bulk-enrich-sectors`.
- Schema/runtime artifacts: `daily_prices`, `wsp_indicators`, `market_scan_results_latest`, scanner functions (`run_broad_market_scan`, `refresh_scanner_universe_snapshot`, `materialize_wsp_indicators_from_prices`), and funnel/ops views.

---

## A) Exact WSP scope components audited

1. **Data providers / transport paths**
   - Node provider abstraction supports `alpaca` or `finnhub` via `MARKET_DATA_PROVIDER`; key requirements are explicit in provider creation logic.  
   - Separate combined source layer (`server/data-sources/combined.ts`) contains optional Polygon/SIP logic, but this is **parallel architecture**, not the canonical browser runtime path.

2. **Secrets / API key dependencies**
   - Node routes: `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, optionally `FINNHUB_API_KEY`.
   - Edge functions: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SYNC_SECRET_KEY` + provider-specific keys (`POLYGON_API_KEY`; Alpaca keys in edge screener for quote overlays).

3. **Supabase storage layer**
   - Price cache table: `daily_prices`.
   - Indicator table: `wsp_indicators`.
   - Scan result read view: `market_scan_results_latest` (latest-per-symbol view backed by `market_scan_results`).
   - Universe/eligibility staging: `scanner_universe_snapshot` and alignment views/functions.

4. **Edge/server execution surfaces**
   - `daily-sync` (Polygon grouped daily -> `daily_prices`, then materialize indicators).
   - `scan-market` -> RPC `run_broad_market_scan`.
   - `wsp-screener` edge function (cache-first from tables + optional Alpaca live quote overlay).
   - `wsp-symbol-detail` edge function (reads cached bars from `daily_prices`).
   - Local node routes still exist for `wsp-screener` and `wsp-symbol-detail` provider-based live fetch.

5. **Runtime scanner path actually used by UI**
   - `use-market-command` -> `fetchMarketCommandSnapshot` -> `fetchWspScreenerData`.
   - `fetchWspScreenerData` currently uses **direct Supabase table/view reads** (`market_scan_results_latest`, `wsp_indicators`) as canonical path; if that fails it drops to local demo fallback.

6. **Product surfaces audited**
   - Dashboard: uses `useMarketCommand`; still does fallback close lookup from `daily_prices` when card prices are missing.
   - Screener: paged accumulation from same command snapshot hook.
   - Stock detail: mixes command snapshot + symbol-detail endpoint + direct indicator/price probes for selective enrichment/fallback behavior.
   - Chart data: primarily from symbol detail endpoint (`barsDaily`/`barsWeekly`) and benchmark series included there.

---

## B) Fully connected to real data (today)

1. **Daily market data ingestion backbone (equities + benchmarks + sector ETFs) is real and connected.**
   - `daily-sync` calls Polygon grouped daily endpoint and upserts `daily_prices`, then calls `materialize_wsp_indicators_from_prices`.

2. **Broad scanner compute path is real and connected.**
   - `scan-market` invokes `run_broad_market_scan` RPC and writes run status to `data_sync_log`; scanner result view is queryable via `market_scan_results_latest`.

3. **UI canonical screener path is connected to production DB reads (not static mock by default).**
   - `fetchWspScreenerData` direct-queries `market_scan_results_latest` and `wsp_indicators` and constructs market/sector/stocks snapshot.

4. **Symbol detail bars are connected to real cached market history.**
   - Edge symbol detail reads `daily_prices` for symbol + SPY benchmark and returns daily+weekly bars.

5. **Dashboard/Screener are connected to same canonical command snapshot composition path.**
   - `useMarketCommand` wraps the same screener snapshot source and feeds both pages.

---

## C) Connected only to stored snapshots/materialized/cache data

1. **Primary scanner UI is snapshot/materialized driven, not direct live provider streaming.**
   - Browser canonical path reads `market_scan_results_latest` + `wsp_indicators`.

2. **Edge screener function itself is also cache-first.**
   - It reads scanner cohort from `market_scan_results_latest`, bars from `daily_prices`, indicators from `wsp_indicators`, and only overlays live quotes if keys exist.

3. **Stock detail relies on cached DB history, not provider fetch-per-request (in production edge path).**
   - `wsp-symbol-detail` fetches from `daily_prices`; if no cached rows, it returns `NO_CACHED_DATA`.

4. **Market regime/benchmark state in UI is built from indicator snapshots.**
   - Benchmark market overview in hook comes from latest `wsp_indicators` rows for SPY/QQQ.

---

## D) Still on fallback / degraded / demo logic

1. **Hard demo fallback remains active as terminal safety mode in screener hook.**
   - If direct DB path fails or returns empty, hook returns `demoStocks`/`demoMarket` with trust state `FALLBACK`.

2. **Trust/degraded semantics are still synthetic in parts of canonical path.**
   - Provider status is labeled `provider: 'finnhub'` in direct DB mode even though runtime source is Supabase tables.

3. **Stock detail is not a single-source read model yet (degraded compositing persists).**
   - Page combines canonical stock (if available), symbol-detail response, direct indicator lookup, direct sector ETF lookup, and optional local `evaluateStock` recomputation.

4. **Legacy provider-route pipeline still exists but is not canonical client runtime.**
   - `processEdgeResponse` pipeline is explicitly marked inactive for client runtime in hook comments.

5. **Node symbol detail route is still limited metadata mode.**
   - It infers unknown metadata, sets `supportsFullWsp: false`, `wspSupport: 'limited'`, and does provider-fetch fallback semantics (mostly dev path now).

---

## E) Missing provider/API integrations for intended full WSP production scope

1. **No single, fully-live end-user runtime path using provider-grade candles + quotes for all surfaces.**
   - Current production UX depends on DB snapshots/cache; provider live path exists but is not canonical runtime.

2. **Volume-quality provider integration is incomplete for strict WSP volume fidelity.**
   - Combined-source module references Polygon/SIP superiority, but canonical runtime does not route through this standardized “best source” arbitration.

3. **Provider consistency is fragmented across environments.**
   - Node path defaults Alpaca/Finnhub; daily sync/backfill are Polygon/Yahoo based; edge screener uses DB + optional Alpaca overlays.

4. **No explicit provider health/freshness contract exposed end-to-end per layer.**
   - UI trust is inferred from table freshness and local logic, not provider-level SLO-backed status objects for market/sector/equity/detail layers.

5. **Search/enrichment still has external dependency gaps.**
   - `enrich-symbols` and `bulk-enrich-sectors` require Polygon/Nasdaq connectivity and can leave partial classification states that degrade full-WSP eligibility.

---

## F) Brutally honest status map (current product truth)

### What is genuinely production-capable right now
- End-to-end **daily batch scanner** is real and useful: ingest -> indicators -> broad scan -> latest view -> dashboard/screener rendering.
- Equity ranking, sector/industry framing, and detail charts are working off real persisted data when pipelines are healthy.

### What is not yet “fully complete WSP”
- Real-time provider connectivity is **not** the canonical user-facing source of truth.
- Stock detail is still multi-source stitched, not a hardened single contract.
- Fallback/demo logic remains part of normal resilience path.
- Parallel architectures (legacy live route vs canonical DB snapshot path) still coexist.

### Required to make WSP scanner scope truly complete
1. **Pick one canonical production runtime contract** (either fully DB snapshot-driven with clear SLAs, or fully live-provider-driven with cache as secondary), and remove ambiguous dual-path semantics.
2. **Unify provider/source metadata truth** so provider labels match actual source (`direct_db_snapshot`, `provider_live`, `demo_fallback`) everywhere.
3. **Promote stock detail to one canonical read model** (single adapter resolving bars, indicators, gates, trust, timestamps) and stop page-level source blending.
4. **Formalize freshness guarantees** with per-layer timestamps and quality gates (market, sector, industry, equity, detail).
5. **Close provider strategy gap** for volume fidelity (Polygon/SIP-grade where needed) and make this explicit in runtime diagnostics.
6. **Keep demo fallback but isolate it operationally** (feature flag + unmistakable UI state + telemetry when triggered).

## Bottom line
As of **March 31, 2026**, the scanner is **operational and data-connected**, but primarily as a **batch/materialized snapshot product with fallback safety rails**, not yet as a fully unified real-time production-grade WSP data plane.
