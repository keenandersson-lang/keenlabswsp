

## Root Cause Analysis

**PRIMARY BUG — Every upsert fails silently due to type mismatch:**

The `daily_prices.volume` column is defined as `bigint`. Polygon's API returns fractional volume values (e.g. `2359513.995438`). The edge function logs confirm this clearly:

```text
Upsert error for AAPL: invalid input syntax for type bigint: "37308155.220558"
Upsert error for A: invalid input syntax for type bigint: "2359513.995438"
```

Every symbol fails at the upsert stage. Zero rows written. This affects both `historical-backfill` and `daily-sync`.

**SECONDARY BUG — 13-second sleep per symbol causes timeout risk:**

With `batchSize=3` and 13s sleep per symbol, minimum wall-clock is 39s + API calls + DB ops ≈ close to edge function timeout (150s). Combined with retry logic and the `fetchPolygonBarsWithRetry` pagination, this can push past limits.

**BUILD ERROR — `process-email-queue` type errors (unrelated):**

The `moveToDlq` function signature uses `ReturnType<typeof createClient>` which doesn't match the inferred generic type. Also missing type annotations on `.map()` callbacks.

---

## Fix Plan

### 1. Fix volume type mismatch in `historical-backfill/index.ts`

On line 370 where bars are assembled:
```typescript
bars.push({ date, open, high, low, close, volume: Math.round(volume) })
```

### 2. Fix volume type mismatch in `daily-sync/index.ts`

On line 93 where upserts are built:
```typescript
volume: Math.round(r.v),
```

### 3. Reduce sleep from 13s to 2s in `historical-backfill`

Line 213: change `await sleep(13000)` to `await sleep(2000)`. Polygon free tier allows 5 requests/minute. With pagination (multi-page symbols), 2s is safe. This allows ~50 symbols per 150s edge function window instead of ~3.

### 4. Increase default `batchSize` from 5 to 20

With 2s sleep, we can process ~20 symbols per invocation safely.

### 5. Fix `process-email-queue/index.ts` build errors

- Add `as any` cast on the supabase client parameter to `moveToDlq`
- Add explicit types to `.map()` and `.filter()` callbacks
- Cast insert/rpc arguments to bypass strict generic inference

### 6. Admin page improvements

- Add "Resume from offset" input field so user can restart from last known good offset
- Show `rowsWritten` from batch response
- Show failure categories in progress display
- Add explicit stopped/error state messaging

---

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/historical-backfill/index.ts` | `Math.round(volume)`, reduce sleep to 2s, increase default batch to 20 |
| `supabase/functions/daily-sync/index.ts` | `Math.round(r.v)` for volume |
| `supabase/functions/process-email-queue/index.ts` | Fix type errors with explicit casts |
| `src/pages/Admin.tsx` | Resume offset, better progress display, failure categories |

---

## Technical Details

- The `bigint` column type is correct for volume (we want whole numbers). The fix is to round the Polygon fractional values before insert.
- `wsp_indicators` table also has `volume bigint` and `avg_volume_5d bigint` — any future writes there must also round.
- The `onConflict: 'symbol,date'` constraint exists and is correct (composite unique from the migration).
- RLS is correct: service_role has ALL access on daily_prices.
- No schema migration needed — the fix is purely in the edge function transform layer.

