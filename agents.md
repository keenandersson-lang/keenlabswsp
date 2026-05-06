# agents.md — WSP Agent System

> The WSP project is being built as a **multi-agent swing trading system**. The scanner is module 1. This file declares the agent roster — current and planned — and how they communicate.

---

## Architectural principle

Each agent is a **specialist** with a narrow, well-defined responsibility. Agents communicate through **canonical Supabase tables** (not direct API calls), so any agent can be replaced or upgraded independently. The doctrine (`context.md` §2) is the universal contract — every agent must respect it.

```
                  ┌──────────────────────┐
                  │   WSP DOCTRINE       │  ← single source of truth
                  └──────────┬───────────┘
                             │
   ┌─────────────────────────┼─────────────────────────┐
   │                         │                         │
   ▼                         ▼                         ▼
┌────────────┐        ┌────────────┐           ┌────────────┐
│ SCANNER    │        │ MICRO      │           │ MACRO      │
│ (live)     │ ──→    │ (planned)  │ ──→       │ (planned)  │
└────────────┘        └────────────┘           └────────────┘
                             │
                             ▼
                      ┌────────────┐
                      │ QUANT      │
                      │ (planned)  │
                      └────────────┘
                             │
                             ▼
                  Trade decisions / journal
```

---

## Agent 1: WSP Scanner — STATUS: LIVE

**Mission:** Apply WSP doctrine to the entire US equity universe daily and surface PRIMED setups + triggered KÖP signals.

**Inputs:**
- `daily_prices` (Polygon EOD)
- `symbols` with canonical GICS sector + industry
- Benchmarks: SPY, QQQ, sector ETFs (XLK, XLV, etc.)

**Outputs:**
- `wsp_indicators` — per-symbol indicators (MA50, MA150, slope, volume ratio, Mansfield RS, pattern, score)
- `market_scan_results` — per-symbol recommendation (KÖP / PRIMED / BEVAKA / SÄLJ / UNDVIK) + blockers
- Surfaced in UI: dashboard, screener, sectors, industries, stock detail

**Doctrine clauses implemented:**
- §2.2 Entry criteria → KÖP gate
- §2.3 Operational entry → PRIMED tier (suggested buy stop + stop loss)
- §2.4 Exit rules → SÄLJ gate (below MA150, tired, downhill)
- §2.7 Forbidden conditions → UNDVIK + blockers array

**SLA:**
- Pipeline complete by 22:30 UTC daily (1h after US close)
- Data freshness: latest close ≤ 1 trading day
- Coverage: ≥ 4,000 equity symbols with full WSP scoring

**Known gaps (May 2026):**
- PRIMED tier not yet implemented (in active fix package)
- Suggested buy stop / stop loss not in output schema
- Position sizing recommendation missing

---

## Agent 2: Micro Agent — STATUS: PLANNED

**Mission:** Per-stock entry/exit execution intelligence. Takes scanner output and adds:
- Optimal buy stop price (resistance + buffer per chart structure)
- Optimal stop loss (prior reaction low vs 4-6% rule, whichever is tighter)
- Position size recommendation (per current market regime + portfolio risk)
- Trend line management (3-point detection, partial exit triggers)
- Entry timing alerts (fresh breakout vs late chase)

**Inputs:**
- `market_scan_results_latest` (scanner output)
- `daily_prices` (for trend line and reaction low detection)
- User portfolio context (size, risk tolerance, current positions)

**Outputs (planned tables):**
- `micro_recommendations` (symbol, action, buy_stop, stop_loss, position_pct, rationale)
- `micro_trade_journal` (per-trade documentation per doctrine §Pre-Trade Checklist)

**Doctrine clauses to implement:**
- §2.5 Stop loss placement (reaction low detection, round-number avoidance)
- §2.6 Position sizing (market-regime-conditional)
- §Trend Line Management (3-point detection, partial exits)
- §Pre-Trade Checklist (risk %, R:R ratio, screenshot, documentation)

**Dependencies on Scanner:**
- Scanner must output `wsp_pattern`, `wsp_score`, `recommendation`, `resistance_level`, `support_level`
- Scanner must support PRIMED tier
- Scanner must expose suggested_buy_stop and suggested_stop_loss as nullable fields

**Open design questions:**
- Where does the agent live? Edge function called from UI? Background job? Conversational interface?
- How does user portfolio context get in? Manual input vs broker integration?
- Local model or LLM call?

---

## Agent 3: Macro Agent — STATUS: PLANNED

**Mission:** Top-down regime intelligence. Determines:
- Market regime (Bullish / Neutral / Bearish) for SPY + QQQ + Russell
- Sector rotation phase (which sectors are entering Climbing, which are Tired)
- Position sizing modifier per regime (per doctrine §2.6)
- "When to step aside" detection (corrections, choppy markets per doctrine §2.7)

**Inputs:**
- Benchmark indicator history (SPY, QQQ, IWM, sector ETFs)
- `wsp_indicators` aggregated by sector + industry
- VIX / breadth indicators (future addition)

**Outputs (planned tables):**
- `macro_regime` (date, market_regime, vix_state, breadth_pct, allocation_recommendation)
- `sector_rotation_signals` (sector, current_phase, transition_alert)

**Doctrine clauses to implement:**
- §3 Top-down workflow (market → sector → industry → equity)
- §2.6 Position sizing matrix (strong uptrend vs difficult vs cash)
- §2.7 "When to reduce/avoid trading"

**Dependencies on Scanner:**
- Sector-level breadth (% above MA50) per sector
- Sector regime classification (already exists)
- Industry concentration of CLIMBING patterns per sector

---

## Agent 4: Quant Agent — STATUS: PLANNED

**Mission:** Statistical validation and edge measurement. Backtests doctrine variations and surfaces empirical gaps.

**Inputs:**
- Full `daily_prices` history (ideally 5+ years)
- `wsp_indicators` history
- Hypothetical trade journal (simulated KÖP trades with stops)

**Outputs (planned tables):**
- `backtest_runs` (config, period, metrics)
- `signal_quality` (per-signal-type win rate, avg gain, avg loss, expectancy)
- `parameter_sensitivity` (e.g., "what if volume threshold is 1.5x vs 2x?")

**Doctrine relationship:**
- Validates the doctrine empirically — does following WSP strictly outperform a benchmark?
- Identifies parameter sensitivities — but does NOT auto-modify the doctrine. Findings go to user for doctrinal review.

**Existing scaffolding:**
- `wsp_backtest/` Python module already exists
- Config in `wsp_backtest/config/`
- Outputs in `wsp_backtest/outputs/`

**Next steps:**
- Lift `wsp_backtest/` outputs into Supabase tables
- Build `/backtest` UI page (currently empty route)
- Add scheduled re-run on parameter changes

---

## Inter-agent communication

**Rule:** agents never call each other directly. They publish to canonical tables and subscribe to others' outputs. This makes each agent independently testable and replaceable.

```
Scanner    → market_scan_results        ← read by Micro, Macro, Quant
Macro      → macro_regime               ← read by Micro (modifies position sizing)
Micro      → micro_recommendations      ← read by user / future trade journal
Quant      → signal_quality             ← read by user, informs doctrinal review
```

---

## Future agent: Trade Execution — NOT PLANNED YET

Auto-execution against broker APIs (Webull, IBKR, etc.) is **explicitly out of scope** until:
- Quant agent has validated the system over ≥ 1 year of paper trading
- Micro agent recommendations have been manually executed for ≥ 6 months with documented outcomes
- A clear doctrinal stance on slippage, partial fills, after-hours gaps exists

Before then: doctrine recommends manual buy-stop-limit GTC orders placed Sunday for the week (§How To Buy.6).

---

## When adding a new agent

1. Define its mission in 1 sentence
2. List doctrine clauses it implements
3. Specify inputs (must already exist or define new tables explicitly)
4. Specify outputs (canonical tables, never function returns)
5. Declare SLA (cadence, freshness, coverage)
6. Add to `memory.md` decision log

If you can't write all 5, the agent isn't ready to build.
