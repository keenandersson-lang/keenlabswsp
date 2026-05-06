# memory.md — Decisions, Gotchas, Anti-patterns

> **Read this before starting any session.** This file captures decisions made, recurring failure modes, and things-not-to-repeat. It is updated AT THE END of every meaningful session.

---

## How to use this file

- **DECISIONS** = irreversible choices made deliberately. Don't relitigate.
- **GOTCHAS** = surprises that cost time. Avoid in future.
- **ANTI-PATTERNS** = things that look reasonable but caused damage. Reject on sight.
- **OPEN QUESTIONS** = unresolved tensions. Pick one up if relevant to your task.

When adding entries, date them and keep them terse. Don't explain — just record.

---

## DECISIONS

### 2026-05-06 — KÖP gate stays strict, PRIMED tier added
- KÖP requires ALL doctrine entry criteria including confirmed breakout + 2x volume. Per doctrine §2.2, this is non-negotiable.
- New tier PRIMED captures stocks meeting all criteria EXCEPT confirmed breakout — these are the buy-stop-limit-GTC candidates per doctrine §2.3.
- PRIMED is operationally as important as KÖP because the doctrine workflow places buy stops in advance, not market orders on confirmation.
- Implication: scanner output schema must include suggested_buy_stop_price and suggested_stop_loss for PRIMED rows.

### 2026-05-06 — Doctrine over flexibility
- The doctrine is treated as immutable in code. Any agent or fix must cite the doctrine clause it implements.
- If a code change would conflict with doctrine, doctrine wins.
- The Quant Agent (planned) is allowed to challenge the doctrine empirically, but findings go to the human for doctrinal review — they do NOT auto-modify gates.

### 2026-05-06 — Daily close prices only
- Scoring system uses daily close prices exclusively. Intraday data is not used.
- daily-sync runs 21:30 UTC after US close. This cadence stays.
- If real-time data is desired in the UI, it goes in a separate "live quote" surface and is NEVER mixed into scoring.

### 2026-05-06 — Multi-agent vision committed
- Project is no longer "personal screener" — it's the foundation for micro/macro/quant agents (see `agents.md`).
- This implies stricter discipline on schemas, contracts, and tech debt.
- Scanner output is now a public contract that downstream agents depend on.

### 2026-04-XX — Stabilization audit acknowledged but largely unimplemented
- `docs/stabilization-audit-2026-03-31.md` identified Priority 0 (canonical screener path) and Priority 1 (trust-state normalization) as the foundation work.
- A month of fixes were applied AROUND the audit, not THROUGH it.
- The audit's priorities remain valid. Re-read it before any architectural change.

### 2026-04-XX — Lovable for UI, surgical prompts only
- Lovable remains the primary editor for UI changes and small SQL migrations.
- For consolidation work or anything touching ≥ 3 files, prefer Cursor or Claude Code with full repo context.
- Lovable prompts must be surgical — explicit "DO NOT touch X" lists are mandatory.

---

## GOTCHAS

### Lovable forgets architecture between sessions
- Symptom: Lovable creates `get_market_summary_v2()` instead of modifying `get_market_summary()` in place.
- Symptom: 62 separate migrations modify `canonical_sector` over 6 weeks.
- Mitigation: paste relevant section of `context.md` at top of every Lovable session. Use the explicit ruleset in `WSP_Fix_Package.md` preamble.

### Doctrine 100/100 is misleading
- The Doctrine Compliance widget shows 100/100 but only measures absence of *violations* (no non-canonical writes).
- It does NOT measure coverage. Right now 5,613 equity symbols lack canonical_industry — that's a coverage failure, not a doctrine score failure.
- When reading the admin dashboard: check Pipeline Coverage section, not just doctrine score.

### "Module Dataflow Tracker IDLE" doesn't mean modules aren't running
- The tracker shows IDLE for API Data Collector / Universe Scan / GICS Classifier even after Hard Refresh completes.
- Likely cause: the bootstrap pipeline calls underlying functions directly, bypassing the doctrine module wrappers that write to `module_runs` with the tracked module names.
- Implication: the Doctrine page can show false IDLE state even when work is happening. Don't panic; check actual data freshness instead.

### Market Summary, Sector Ranking, and Sector Performance return DIFFERENT counts
- Same underlying tables, three different filters.
- `get_sector_performance` is the most correct (excludes ETFs and benchmarks).
- `get_market_summary` includes everything → inflated counts.
- `get_sector_ranking` wraps `get_market_summary` → inherits the issue.
- Fix package (#2) consolidates filters. Until done: trust `get_sector_performance`.

### Partial rebuild fails silently with "Parity validation failed"
- Last 5 partial_rebuild runs failed. Hard Refresh still works.
- Root cause not yet known (Fix #4 in package is diagnostic).
- Until fixed: rely on Hard Refresh, never partial.

### `use-wsp-screener.ts` has two data acquisition paths
- A direct Supabase table path AND a server-route path coexist in the file.
- Only direct DB path is wired into the active client return.
- DO NOT remove the dead path without explicit consolidation task — there may be diagnostic value still wired into hooks.

### The `wsp_backtest/` Python module is independent
- It runs locally, not in the Supabase pipeline.
- Outputs to `wsp_backtest/outputs/` (filesystem).
- When Quant Agent is built, this becomes the bridge — for now, treat it as orphaned.

### `is_leading` filter on Index dashboard returns 0 despite Bullish sectors
- Bug location unknown without diagnostic run (Fix #3 in package).
- Likely either: hook drops the field, RPC criterion too strict, or column name mismatch.
- Check `useSectorRanking` hook before changing RPC.

### Lovable preview at id-preview--*.lovable.app vs production at wsp.keenlabs.pro
- Preview = latest unmerged branch.
- Production = main branch deployed.
- Always verify which one screenshots are from before debugging.

---

## ANTI-PATTERNS — REJECT ON SIGHT

### Creating `_v2`, `_new`, `_fixed`, `_canonical` versions of existing functions
- Cause of the 137-migration thrash.
- Always `CREATE OR REPLACE` the existing function.

### "Just adding a feature flag" instead of removing dead code
- The audit identified two competing data paths. The "deprecate behind flag" approach was suggested. It was never executed.
- A flag is not a fix. Either it's the path or it isn't.

### Adding new RPCs to "fix" a display issue
- If the dashboard shows wrong sector counts, the fix is in the existing RPC's filter, not a new RPC.
- Three sector RPCs already exist. We don't need a fourth.

### "Doctrine 100/100, ship it"
- Doctrine score measures violations, not coverage. Always check both.

### Lengthening migration history "for safety"
- Every migration is a bet that the next one knows what it implies.
- 62 migrations on `canonical_sector` is evidence that next-migration discipline failed.
- If you can do it with `CREATE OR REPLACE`, do it that way.

### Adding intraday data to "make it more real-time"
- Doctrine is daily-close-based. Adding intraday breaks the foundation.
- If the user asks for intraday: separate surface, never mixed into scoring.

### Beautiful refactor of `use-wsp-screener.ts` without scope
- It's 1619 lines for a reason: it accumulated. Refactoring it is a multi-day project, not a side task.
- Touch only the section relevant to your task.

### "Auto-fix" on the doctrine_failures table
- Failed canonical classifications land here intentionally — they need human review.
- Do not auto-classify them with weaker fallback logic. Fix the source data instead.

### Pasting full code dumps as Lovable prompts
- Lovable will rewrite everything you paste, often wrong.
- Always reference files by path and ask for surgical edits.

---

## OPEN QUESTIONS

### Q1: PRIMED tier — buy stop price calculation
- Doctrine: "set order slightly above previous high (e.g., $104 if previous high was $103.50)"
- Implementation: `resistance_level * 1.005`? Or `resistance_level + 0.50`? Or per-stock based on tick size?
- Decide before Fix #1 lands.

### Q2: Sector concentration in Industries page
- Industries page currently shows ranks for industries within ALL sectors.
- Per doctrine §3, top-down workflow filters industries to those WITHIN leading sectors only.
- Should the Industries page have a toggle: "All" vs "Leading sectors only"?

### Q3: Backtest UI scope
- Quant agent doesn't exist yet, but `/backtest` route is empty.
- Option A: leave route hidden until Quant agent is real
- Option B: build placeholder that shows last `wsp_backtest/outputs/` JSON
- Option C: skip until Quant agent build starts

### Q4: User authentication scope
- Current: app uses Lovable Cloud Auth.
- Future: if multi-user, do per-user portfolios get stored in Supabase?
- Not blocking, but affects Micro Agent design.

### Q5: How does Macro Agent communicate "step aside" to user?
- Doctrine §2.7: when market conditions are unclear, recommend cash.
- Where does this recommendation surface? Banner on dashboard? Disable KÖP signals? Add a "regime override" badge?

### Q6: Watchlist semantics
- `/watchlist` route exists but is empty.
- Should it be: (a) user-curated list of symbols to monitor, (b) saved screener filters, (c) both?
- Not part of scanner — likely belongs to Micro Agent's surface.

---

## SESSION LOG (most recent first)

### 2026-05-06 — Doctrine integration session
- User shared 3 doctrine PDFs (Ultimate Checklist, Workbook, Position Sizing)
- Discovered: KÖP gate is doctrinally correct; PRIMED is the missing tier (per §2.3 buy stop workflow)
- Created context.md, agents.md, memory.md, skills.md
- Updated WSP_Fix_Package.md Fix #1 to use PRIMED with doctrine-aligned schema (suggested_buy_stop, suggested_stop_loss)
- User committed strategically to multi-agent vision (scanner → micro → macro → quant)

### 2026-05-06 — Audit-vs-reality session
- Read full repo (50,615 LOC, 137 migrations)
- Identified Lovable thrash patterns
- Diagnosed 0 KÖP signals as "gate too strict" — partially wrong, see next session
- Created initial WSP_Fix_Package.md with 5 surgical prompts
- User pushed back on "mothball it" framing

### Prior sessions
- (Migrate older session notes here as they become relevant)
