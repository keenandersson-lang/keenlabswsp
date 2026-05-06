# skills.md — Reusable Procedures

> Step-by-step procedures for common operations. When in doubt, follow these exactly. Deviations need to be justified in the session log.

---

## SKILL: Add or modify a SQL function

### When to use
You need to change signal logic, add an aggregation, or fix an aggregation bug.

### Procedure
1. **Search first** — find existing function:
   ```bash
   grep -l "FUNCTION public.<function_name>" supabase/migrations/*.sql
   ```
2. **Read latest version** — get the most recent `CREATE OR REPLACE`:
   ```bash
   LATEST=$(grep -l "FUNCTION public.<function_name>" supabase/migrations/*.sql | tail -1)
   cat "$LATEST"
   ```
3. **Decide: modify or create?**
   - Function exists → ALWAYS `CREATE OR REPLACE` (never new function with `_v2` suffix)
   - Function doesn't exist → confirm via search no synonym exists (e.g., `get_sectors` vs `get_sector_summary`)
4. **Write migration** with format `YYYYMMDDHHMMSS_<descriptive_name>.sql`
5. **Migration content:**
   - Single `CREATE OR REPLACE FUNCTION` statement
   - No table modifications mixed in (separate migration if both needed)
   - Comment block at top explaining WHY (not WHAT — code says what)
   - Reference doctrine clause if applicable
6. **Verify** — run a SELECT calling the function and check output shape and counts

### Example skeleton
```sql
-- Doctrine §2.2 — KÖP entry criteria require ALL conditions
-- Adding PRIMED tier (doctrine §2.3 — Buy Stop Limit GTC workflow)
-- This sits BETWEEN KÖP (confirmed breakout) and BEVAKA (interesting but not setup-grade)

CREATE OR REPLACE FUNCTION public.<name>(...)
RETURNS ...
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
  -- implementation
$$;
```

### DO NOT
- Create `<name>_v2`, `<name>_new`, `<name>_canonical`
- Combine schema changes and function logic in one migration
- Modify doctrine_failures or canonical_gics_sectors via this skill — those are reference data

---

## SKILL: Add or modify a Supabase Edge Function

### When to use
You need scheduled work, third-party API calls (Polygon, Yahoo, etc.), or work too heavy for SQL.

### Procedure
1. **Check if function exists:** `ls supabase/functions/`
2. **Existing function with similar role?** — modify it. Don't create a parallel function.
3. **For new functions:**
   - Create `supabase/functions/<kebab-name>/index.ts`
   - Use `Deno.serve` pattern (see `scan-market` for reference)
   - Auth: support both SYNC_SECRET_KEY header (for cron) and service-role JWT
   - Background work: use `EdgeRuntime.waitUntil` for fire-and-forget
   - Always log to `data_sync_log` for auditing
4. **For long-running work:**
   - Set `x-statement-timeout` header on Supabase client (e.g., `'600000'` for 10min)
   - Always update `module_runs` checkpoints throughout
5. **Schedule via pg_cron** if periodic — see `supabase/functions/_shared/` for cron examples

### Reference function structure
```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = { /* ... */ };
const TEMP_DEBUG_SYNC_KEY = '...';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  
  // Auth check
  const authorized = await checkAuth(req);
  if (!authorized) return jsonResponse(401, { error: 'Unauthorized' });
  
  // Setup client with extended timeout
  const supabase = createClient(/* ... */, { global: { headers: { 'x-statement-timeout': '600000' }}});
  
  // Log start
  const logRow = await supabase.from('data_sync_log').insert({ status: 'running', /* ... */ }).select('id').single();
  
  // Background work (fire and forget)
  const work = (async () => {
    try {
      // ... do work, update checkpoints ...
      await supabase.from('data_sync_log').update({ status: 'success' }).eq('id', logRow.id);
    } catch (err) {
      await supabase.from('data_sync_log').update({ status: 'error', error_message: err.message }).eq('id', logRow.id);
    }
  })();
  
  EdgeRuntime?.waitUntil?.(work);
  
  return jsonResponse(202, { ok: true, queued: true, logId: logRow.id });
});
```

---

## SKILL: Verify a fix end-to-end

### When to use
After ANY change. No exceptions.

### Procedure
1. **Apply migration / deploy edge function**
2. **Trigger pipeline** — Admin → Hard Refresh → wait for all 6 steps green
3. **Run verification SQL** — every fix has a SELECT that proves it works
4. **Check UI surface** — the user-visible change is the real test
5. **Compare before/after** — if you have screenshots, diff them
6. **Update memory.md** if the fix taught you something general

### Example verification SQL pattern
```sql
-- Before fix
SELECT recommendation, COUNT(*) FROM market_scan_results_latest GROUP BY recommendation;
-- Expected before: KÖP=0
-- Expected after:  KÖP=0, PRIMED>0
```

### DO NOT
- Skip verification because "it should work"
- Verify only the SQL — UI may not pick up RPC changes due to TanStack Query caching
- Declare done before Hard Refresh has completed

---

## SKILL: Diagnose a "X says Y but should say Z" UI bug

### When to use
Dashboard / screener / sectors shows wrong value, can't tell where the bug is.

### Procedure (in order — stop when you find it)
1. **Run the underlying RPC directly** in SQL editor:
   ```sql
   SELECT * FROM <rpc_name>();
   ```
   - Does the RPC return correct data? If NO → fix is in the RPC.
   - If YES → continue.
2. **Inspect the hook** in `src/hooks/use-<name>.ts`:
   - Does the hook call the right RPC?
   - Does it map the response correctly? Watch for `.map()` that drops fields.
   - If broken → fix is in hook mapping.
3. **Inspect the page component**:
   - Does it read the right field? (e.g., `s.is_leading` vs `s.isLeading`)
   - Does it filter incorrectly? (e.g., `.filter(s => s.is_leading === 'true')` for boolean column)
   - If broken → fix is in page.
4. **Inspect TanStack Query** for staleness:
   - `staleTime` too long?
   - Stale query in cache from old session?
   - Try hard refresh in browser.

### Debug helper
If you can't tell where data is dropped, log at each layer:
```typescript
// in the hook
console.log('[useSectorRanking RAW]', data);

// in the page
console.log('[Index leadingSectors]', leadingSectors);
```

---

## SKILL: Add a doctrine clause to scoring or recommendation logic

### When to use
You're translating a doctrine rule into code.

### Procedure
1. **Cite the clause** in code comment AND in migration comment AND in PR description
2. **Read the full clause** (not a paraphrase) — doctrine details matter
3. **Check `context.md` §2** for canonical doctrine summary
4. **Implement minimally** — don't add interpretation. If doctrine says "≥ 2x volume", code says `volume_ratio >= 2.0`, not `volume_ratio >= 1.5 OR /* helpful softening */`
5. **Add inverse check** — if you implement an inclusion rule, also implement its exclusion (e.g., if "must be above MA150" gates KÖP, "below MA150" should block KÖP)
6. **Add to memory.md DECISIONS** — record the doctrine→code mapping

### Doctrine citation format
```sql
-- Doctrine §2.2.3 — Volume Analysis
-- "Breakout volume is at least 2x average of previous week"
-- Formula: today_volume / avg_volume_5d ≥ 2
IF v_volume_ratio IS NULL OR v_volume_ratio < 2.0 THEN
  v_blockers := array_append(v_blockers, 'volume_not_confirmed');
END IF;
```

---

## SKILL: Compose a Lovable prompt that doesn't cause thrash

### When to use
Any change you're routing through Lovable instead of editing locally.

### Required structure
```
[CONTEXT BLOCK]
Reference context.md §<section> and memory.md anti-pattern <name>.
This task touches <file path> and only <file path>.

[OBJECTIVE]
Single sentence. What changes from what to what.

[EXACT CHANGE]
Code block showing the BEFORE and AFTER, or the SQL with full CREATE OR REPLACE.

[DO NOT]
- Specific list of things to leave untouched
- Reference parallel files that should NOT be modified
- "DO NOT create _v2" if that's a risk

[VERIFICATION]
SQL or UI check that proves the fix.
```

### Anti-patterns to flag in the prompt
- "Let me also improve..." → reject, single change only
- New file when existing should be modified → reject
- Schema change to fix display issue → reject
- Removing existing functions without explicit deprecation task → reject

---

## SKILL: Onboard a new agent (yourself, in a new session)

### When to use
Starting any session on this project — by you or a fresh agent.

### Procedure
1. Read `context.md` fully (everything, no skipping)
2. Read `memory.md` SESSION LOG (last 3 entries)
3. Read `memory.md` ANTI-PATTERNS section
4. If your task involves an agent role (scanner / micro / macro / quant), read that agent in `agents.md`
5. If your task involves doctrine, re-read the relevant clause in the doctrine PDFs
6. **Now and only now** — start the task

This adds ~10 minutes and saves hours.

---

## SKILL: Update memory.md at end of session

### When to use
End of every session that produced a decision, learning, or gotcha.

### What to add
- New DECISION: dated, terse, irreversible-only
- New GOTCHA: dated, what surprised you and why
- New ANTI-PATTERN: only if you saw the system about to repeat a known failure mode
- SESSION LOG entry: 1-3 bullets

### What NOT to add
- Things that are properly in `context.md` (project facts) — those go there
- Things that are temporary (today's blocker) — use a TODO, not memory
- Long explanations — terse only

---

## SKILL: Handle migration history hygiene

### When to use
Adding a new migration.

### Procedure
1. Filename format: `YYYYMMDDHHMMSS_<lowercase_kebab_description>.sql`
2. Single concern per migration. Don't combine schema + RLS + function.
3. Comment block at top:
   ```sql
   -- Migration: <name>
   -- Doctrine clause: <reference if applicable>
   -- Why: <2-line explanation>
   -- Reverses: <name of migration this replaces, if applicable>
   ```
4. If your migration replaces logic from a prior migration, NOTE that in the new file's header. Don't try to mark old migrations as deprecated — they're applied; they're history.
5. After 3+ migrations on the same function in a quarter: stop and propose squashing them into a single canonical CREATE OR REPLACE.

---

## SKILL: Manage the strategic context

This isn't a code skill but it's a system constraint.

### When to apply
When the user asks for a "big" change.

### Procedure
1. Estimate effort: hours / days / weeks
2. Compare to the user's other commitments (per memory.md or context):
   - ai.keenlabs.pro (commercial bet, active build crisis)
   - Payroll exam (academic, hard deadline)
   - LIA application (career, weeks 40-49)
   - WSP scanner (this project, becoming serious per agent vision)
3. If the proposed change is ≥ 1 week and conflicts with another active commitment, name it explicitly: "This is 5-7 days of work. ai.keenlabs.pro has 3 weeks of runway. Confirm priority order."
4. If user confirms, proceed. If not, descope.

The user values direct, no-fluff calls. Don't be passive about strategic conflicts.
