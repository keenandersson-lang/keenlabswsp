# WSP Equity Product — Disciplined Rebuild Roadmap

## Status: Phase A+B ✅ | Phase E1–E4 ✅ | Phase F In Progress

**Last updated**: 2026-04-12

---

## Current Data Maturity Metrics

| Metric | Value | Target |
|--------|-------|--------|
| Core universe size | 1,622 symbols | — |
| Core with valid GICS sector | 1,195 (74%) | >95% |
| Core with generic 'Stocks' sector | 427 (26%) | 0 |
| Core with latest indicators | 1,612 (99%) | 100% |
| Core with mansfield_rs_sector | 137 (8.5%) | >80% |
| Core with resistance_level | 0 (awaiting re-materialization) | >90% |
| Core with ≥200 bars (SMA200-ready) | ~320 (20%) | >60% |
| Core backfill-eligible | 1,622 | — |
| Yahoo backfill batch size | 50/run | — |
| Latest scan: BEVAKA | 1,477 | — |
| Latest scan: SÄLJ | 1,664 | — |
| Latest scan: KÖP | 0 (breakout logic just deployed) | >0 on real breakouts |

---

## A. Two-Layer Architecture

### Module 1 — Baseline Core (High-Trust Layer)
- **Benchmarks (15)**: SPY, QQQ, DIA, IWM + 11 GICS sector ETFs
- **Core Equities**: `universe_tier = 'core'`, active, ≥50 bars
- **Data contract**: Mansfield RS vs SPY + sector ETF; dashboard/heatmap use only Module 1

### Module 2 — Expanded Universe (Discovery Layer)
- ~9,600 symbols not yet in Module 1
- RS against SPY only; labeled "Expanding Universe" in Screener

---

## B. Completed Phases

### Phase 1–4 — Foundation, Screener Tabs, Coverage Widget, Sector RS ✅
- `universe_tier` column, core/expanded tabs, coverage RPC, `mansfield_rs_sector` computation
- Sector ETFs reclassified to benchmark tier, Stock Detail shows dual RS badges
- Full details in git history

### Phase A — Label & Stage Semantics Cleanup ✅ (2026-04-12)
- Eliminated `base_or_climbing` — stages are now strictly: `climbing`, `base`, `tired`, `downhill`
- Recommendations mapped to WSP-faithful Swedish labels: `KÖP`, `BEVAKA`, `SÄLJ`, `UNDVIK`
- `run_broad_market_scan` updated with correct stage→recommendation mapping
- Industry cleanup logic removes garbage SIC descriptions from scan results

### Phase B — Sector RS & Pipeline Repair ✅ (2026-04-12)
- Fixed duplicate `materialize_wsp_indicators_from_prices` overload (SQL ambiguity error)
- Fixed `daily-sync` pagination: all 1,800+ symbols now synced (was hitting 1,000-row limit)
- Sector ETF prices synced to current date
- `mansfield_rs_sector` now computes for all symbols with valid sector (not just core tier)
- `Technology` → `XLK` mapping added alongside `Information Technology`
- Reference symbols (SPY + 11 ETFs) always included in materialization chunks
- Promoted mega-caps (AAPL, MSFT, NVDA, GOOGL, AMZN, META, JPM, V, UNH, JNJ, PG, HD, LLY) to core

### Phase E1 — Bulk Enrichment for 'Stocks' Symbols ✅ (2026-04-12)
- `bulk-enrich-sectors` filter updated to include `canonical_sector = 'Stocks'` (427 symbols)
- Edge function deployed; ready to run from Admin panel

### Phase E2 — Yahoo Backfill Acceleration ✅ (2026-04-12)
- Batch size increased from 10 → 50 symbols per run
- Faster path to 200-bar SMA200 threshold for Mansfield RS computation

### Phase E3 — Resistance Level Computation ✅ (2026-04-12)
- Added `resistance_level` column to `wsp_indicators` (52-week high of daily highs)
- Materialization function computes `MAX(high) OVER 252 bars` for every symbol
- Available immediately after next materialization run

### Phase E4 — Breakout Detection in Scanner ✅ (2026-04-12)
- `run_broad_market_scan` now includes real breakout detection:
  - **KÖP** requires: `climbing` + `wsp_score = 5` + `close > resistance_level * 1.02` + `volume_ratio >= 2.0`
  - New `no_breakout` blocker tracked when close is below resistance
  - `resistance_level` and `breakout_detected` included in scan result payload
- KÖP is now the highest-conviction signal, gated by genuine resistance breakout

---

## C. Phase F — Data Maturity & Coverage (In Progress)

### F1 — Re-enrich 427 'Stocks' Sector Symbols
- **Status**: Deployed, awaiting execution
- **Action**: Run bulk enrichment batches from Admin until all 427 symbols have proper GICS sector
- **Impact**: Raises valid-sector coverage from 74% → ~95%+, enabling `mansfield_rs_sector` for those symbols
- **Dependency**: Polygon API quota (5 req/min free tier)

### F2 — Accelerate History Backfill to 200+ Bars
- **Status**: Batch size upgraded, running daily
- **Blocker**: ~1,300 core symbols have 50–199 bars, need 200+ for SMA200/Mansfield RS
- **Timeline**: At 50 symbols/run, ~26 runs to cover remaining symbols
- **Impact**: Each symbol reaching 200 bars immediately gains `mansfield_rs` and `mansfield_rs_sector`

### F3 — Re-materialize After Enrichment
- After F1 completes enrichment batches, re-run materialization to populate:
  - `resistance_level` for all core symbols
  - `mansfield_rs_sector` for newly-enriched symbols with 200+ bars
- Then re-run `run_broad_market_scan` to see KÖP signals fire on real breakouts

### F4 — Auto-Promotion Pipeline
- When expanded symbol gains valid GICS sector + high/medium confidence + ≥50 bars → auto-promote to core
- Run as part of daily materialization
- Log promotions to `data_sync_log`

---

## D. Phase G — Production Hardening & Observability (Planned)

### G1 — Pipeline Health Checks
- Extend `run_pipeline_health_checks` to verify:
  - All 11 sector ETFs have fresh prices (≤1 trading day stale)
  - `mansfield_rs_sector` ≥95% coverage for core symbols with 200+ bars
  - Core count stability (no >5% day-over-day drops)
  - `resistance_level` populated for ≥90% of core symbols

### G2 — Heatmap Sector RS Toggle
- Optional toggle between SPY-relative and sector-relative RS coloring
- Core uses `mansfield_rs_sector`; expanded uses `mansfield_rs`

### G3 — Industry-Level Drill-Down (Stretch)
- Group core symbols by `canonical_industry` within each sector
- Show industry-level RS aggregates in Sector Analysis view

---

## E. Key Blockers & Risks

| Blocker | Impact | Mitigation |
|---------|--------|------------|
| 427 'Stocks' sector symbols | No sector ETF mapping → no `mansfield_rs_sector` | Bulk enrichment via Polygon (deployed) |
| ~1,300 symbols < 200 bars | Cannot compute SMA200/Mansfield RS | Yahoo backfill at 50/batch (accelerated) |
| Polygon free-tier rate limits | Enrichment bottleneck (5 req/min) | Escalating backoff + circuit breaker |
| `resistance_level` = 0 populated | KÖP signals can't fire yet | Needs one materialization run post-deploy |

---

## F. Safety Principles

- Auto-promotion is additive only — core→expanded requires manual admin action
- Health checks are read-only alerts, not automated rollbacks
- All changes backward-compatible with existing queries
- KÖP is the highest bar: requires climbing + score 5 + breakout + volume confirmation
- Daily closes are the sole source of truth for all technical analysis
