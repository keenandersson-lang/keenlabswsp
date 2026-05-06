# context.md — WSP Scanner Project Context

> **READ THIS FIRST.** Every agent session must consume this file before making any code or schema change. If anything you're about to do conflicts with this document, stop and ask.

---

## 1. Project identity

- **Name:** WSP Scanner (Wall Street Protocol)
- **Live URL:** https://wsp.keenlabs.pro
- **Owner:** Keen Andersson (solo)
- **Repo:** https://github.com/keenandersson-lang/keenlabswsp
- **Primary user (today):** owner himself
- **Future users:** retail swing traders following the WSP doctrine
- **Strategic role:** foundation layer for a multi-agent swing trading system. Scanner is module 1; future modules (micro / macro / quant agents) consume scanner output. See `agents.md`.

## 2. The WSP Doctrine — non-negotiable

This system implements the Wall Street Protocol (Goat Academy) framework. The doctrine is the source of truth for ALL signal logic. UI / infra serves the doctrine, never the other way around.

### 2.1 The four patterns

| Pattern | Description | Action |
|---|---|---|
| **Base** | Sideways consolidation. Volume drying up. "Winston before a hike." Longer base = bigger upside potential. | Watch — never sell |
| **Climbing** | Breakout above resistance + 50MA + 50MA sloping up + 2x+ volume + Mansfield RS positive. "Winston climbing." | Buy zone — never sell |
| **Tired** | Sideways at top after climb. Heavy volume, choppy, 50MA flattens. | **SELL** |
| **Downhill** | Breakdown below support with higher volume. Recovers on weak volume. | **SELL / AVOID** |

**Position rules:**
- Never buy in Tired or Downhill
- Never sell in Base or Climbing
- Never trade without protective stops

### 2.2 Entry criteria (KÖP) — ALL must be true

1. **Breakout confirmation**
   - Price breaks above clear resistance zone (3+ prior highs)
   - Resistance validated by multiple touches
   - Breakout is clean and decisive (not choppy)
   - Sector is in uptrend (do NOT fight sector trend)
2. **Moving averages**
   - Price > 50-day MA
   - 50-day MA sloping upward
   - Price > 150-day MA
3. **Volume**
   - Breakout volume ≥ 2x average of previous week
   - Formula: `today_volume / avg_volume_5d ≥ 2`
   - Ideal: 4-6x
4. **Mansfield Relative Strength**
   - Currently in uptrend, OR
   - Recently transitioned from negative to positive

### 2.3 Operational entry pattern — Buy Stop Limit + GTC

Doctrine workflow is NOT "watch chart and click buy." It is:
1. Identify PRIMED setups (all criteria except confirmed breakout)
2. Place **Buy Stop Limit order**, GTC, at resistance + small buffer (e.g., $104 if resistance is $103.50)
3. Limit price 25-50¢ above stop price (cap unfavorable gap fills)
4. Wait for breakout to trigger order automatically
5. Stop loss set immediately on fill

**Implication for the scanner:** PRIMED setups are operationally as important as triggered KÖPs. The screener must surface both. PRIMED stocks need suggested buy stop and stop loss prices visible in the UI.

### 2.4 Exit rules — ANY one triggers

- **Hard stops:**
  - Price < 150-day MA → IMMEDIATE SELL
  - Price breaches confirmed trend line → SELL 50% of position
  - Original stop loss hit → SELL remaining
- **Pattern transition:**
  - Tired pattern detected → SELL
  - Downhill pattern detected → SELL
- **Trend line management:**
  - Once 3 clear low points form trend line: stop = 1 point below trend line for 50% of position; original stop for the other 50%

### 2.5 Stop loss placement

- Just below closest prior reaction low (preferred), OR
- 4-6% below breakout price (default)
- Maximum 8%
- Avoid round numbers — set ~1/8 below (e.g., $9.75 not $10.00)

### 2.6 Position sizing

| Market condition | Per-stock allocation |
|---|---|
| Strong uptrend, all conditions optimal | 20-25% |
| Difficult / sideways / beginner | 5-10% |
| Correction / bear market / unclear | Cash |

Portfolio risk: 1-2% total. Example: $100k portfolio × 1% = $1k max loss; 10% position with 6% stop = $600 risk = 0.6% of portfolio.

### 2.7 What the doctrine forbids

- Buying against bearish market trend
- Buying in underperforming sectors ("don't try to find gems in bearish sectors")
- Guessing market bottoms — wait for breakout patterns
- Buying below 50-day MA
- Chasing breakouts 8+ days late
- Weak-volume breakouts

## 3. Top-down analytical workflow (DAILY)

This is the daily workflow the scanner must support:

1. **Market regime check** — SPY and QQQ vs MA50/MA200, MA50 slope. Set Bullish / Neutral / Bearish.
2. **Sector rotation** — rank 11 GICS sectors by daily %, breadth (% above MA50), avg WSP score, regime. Identify leading sectors.
3. **Industry filter within leading sectors** — find industries with highest concentration of CLIMBING patterns and PRIMED setups.
4. **Stock-level setup screening** — filter to stocks in leading industries that are PRIMED or have triggered KÖP.
5. **Position planning** — for each setup: suggested buy stop, stop loss, position size (per market regime).

## 4. Data fundamentals

- **Scoring basis:** daily close prices ONLY. Intraday data is NOT used for scoring. Do not introduce intraday data without explicit scope change.
- **Update cadence:** daily-sync runs 21:30 UTC after US close. Polygon grouped daily endpoint. Scoring is point-in-time as of latest close.
- **Universe:** US equities only. Common stock + ADRs. ETFs excluded except 18 sector/index/metals proxies (SPY, QQQ, XLK, XLV, GLD, SLV, etc).
- **History requirement:** ≥ 200 daily bars to be eligible for full WSP scoring. Symbols with insufficient history land in `eligible_for_backfill`.

## 5. Tech stack

- **Frontend:** Vite + React 18 + TypeScript + shadcn/ui + Tailwind
- **State:** TanStack Query for server state. No global store.
- **Backend:** Supabase (Postgres + Edge Functions on Deno)
- **Data sources:** Polygon (primary), Finnhub (fallback), Yahoo (history backfill), Alpaca (live quotes if needed)
- **Hosting:** Lovable preview + production deployment
- **Local dev:** clone repo, `npm install`, `npm run dev`

## 6. Architecture (current state, May 2026)

### 6.1 Daily pipeline (in order)

1. **api-data-collector** — Polygon Reference v3 → upsert symbols
2. **daily-sync** — Polygon grouped daily → daily_prices table
3. **enrich-symbols** + **gics-classifier** — multi-source enrichment chain → canonical_sector + canonical_industry
4. **Indicator refresh** (SQL function `materialize_wsp_indicators`) → wsp_indicators table
5. **scan-market** edge function → calls `run_broad_market_scan` SQL → market_scan_results
6. **Publish snapshot** — copies into market_scan_results_latest view backing
7. **Health check** — verifies freshness across all stages

### 6.2 Critical SQL functions

| Function | Role |
|---|---|
| `run_broad_market_scan(date, label)` | Computes recommendation per symbol from indicators. **THIS IS THE DOCTRINE GATE.** |
| `materialize_wsp_indicators*` | Computes per-symbol indicators (MA50, MA150, RS, pattern, score) |
| `get_sector_ranking()` | Returns 11 GICS sectors with regime + breadth + setups count |
| `get_market_summary()` | Sector overview (wrapped by ranking) |
| `get_sector_performance()` | Daily % per sector (independent filter) |
| `get_top_wsp_setups()` | Top N setups across universe |
| `get_industry_ranking()` | Industries within leading sectors |
| `get_heatmap_data()` | Symbol-level heatmap |
| `get_universe_coverage_detailed()` | Pipeline coverage stats for admin |

### 6.3 Critical tables

| Table | Role |
|---|---|
| `symbols` | Master symbol list with classification + support_level |
| `daily_prices` | OHLCV per symbol per day |
| `wsp_indicators` | Per-symbol per-day computed indicators (THE source of truth for scoring) |
| `market_scan_results` | Per-scan-run output of `run_broad_market_scan` |
| `market_scan_results_latest` | View pointing at latest published scan |
| `scanner_universe_snapshot` | Daily snapshot of eligible universe |
| `module_runs` | Per-pipeline-step status + checkpoints |
| `doctrine_failures` | Symbols that failed canonical classification |

### 6.4 Frontend pages

| Route | Purpose |
|---|---|
| `/` (Index) | Dashboard — market header, regime, leading sectors, leading industries, top setups, heatmap |
| `/screener` | Filterable table of all WSP-evaluated stocks |
| `/sectors` | Per-sector deep dive |
| `/industries` | Per-industry ranking within leading sectors |
| `/stock/:symbol` | Per-symbol detail with chart, indicators, suggested stops |
| `/market-summary` | Cross-sector summary |
| `/admin` | Pipeline ops, bootstrap, health, taxonomy audit |
| `/doctrine` | Pipeline contracts visible to operators |
| `/backtest` | Future home for backtest UI |

## 7. Current state (May 2026)

### 7.1 What works
- Universe: 10,653 active symbols, 4,104 with prices, 4,912 with indicators
- Daily-sync runs nightly via cron
- Multi-source enrichment chain (Polygon → Finnhub → Yahoo → Alpaca)
- Hard Refresh on admin completes 6/6 steps
- All UI surfaces render real data
- Source attribution stable: ~6,250 successful API calls / 24h

### 7.2 What's broken (active fix package)
- 0 KÖP signals (likely doctrinally correct given current market — needs PRIMED tier surfaced)
- 0 leading sectors shown despite Bullish sectors existing (logic bug)
- Three sector RPCs return different counts (consolidation needed)
- 5 consecutive partial_rebuild failures with "Parity validation failed"
- 5,613 of 7,356 equity symbols lack canonical GICS industry
- Module Dataflow Tracker shows IDLE despite pipeline running

See `WSP_Fix_Package.md` for the surgical prompt sequence.

### 7.3 Tech debt awareness
- 137 SQL migrations (62 touch `canonical_sector` alone) → schema is patched, not designed
- `use-wsp-screener.ts` is 1619 lines (God hook)
- Two competing data acquisition paths in screener hook (provider route + direct DB) — direct DB is active
- `docs/stabilization-audit-2026-03-31.md` is the canonical critique — its priorities remain valid

## 8. Working agreements (HARD RULES for any agent)

1. **The doctrine is law.** Any change to signal logic must cite the doctrine clause it implements.
2. **No parallel implementations.** If `get_market_summary` exists and is wrong, fix it in place with `CREATE OR REPLACE`. Do NOT create `get_market_summary_v2`.
3. **No new RPC if existing can be modified.** Search before creating.
4. **No new migration for cosmetic changes.** Migrations only for genuine schema changes or function logic changes.
5. **Daily close prices are the scoring basis.** Do not introduce intraday data.
6. **Verify before declaring done.** Every fix has a verification SQL or UI check. Run it and report result.
7. **Touch one thing.** If asked to fix the leading-sector logic, do not also "improve" the sector ranking display.
8. **Doctrine over framework.** If a beautiful piece of code conflicts with doctrine, doctrine wins.
9. **English in code, Swedish in user-facing copy.** Match the existing convention.
10. **Read `memory.md` for recent gotchas** before starting any session.
