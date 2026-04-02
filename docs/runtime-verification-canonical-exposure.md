# Runtime verification — canonical exposure & lineage

Run this against staging/runtime after deploying migrations.

## Command

```bash
node scripts/runtime-verify-canonical-exposure.mjs > artifacts/canonical-exposure-verification.json
```

## What it verifies

1. `get_equity_snapshot_coverage_report()` output
2. `get_equity_canonical_funnel_counts()` output
3. Screener parity primitives:
   - scanned count
   - matching count (no filter)
   - matching count (impossible filter)
   - empty-state message contract (`0 matching rows out of N scanned rows`)
   - screener row exposure count
4. Dashboard exposure vs Screener exposure from the same canonical snapshot:
   - dashboard count
   - screener count
   - symbols only in dashboard/screener

## Pass criteria

- `dashboardCount === screenerCount`
- `onlyInDashboardCount === 0`
- `onlyInScreenerCount === 0`
- `matchingCountForImpossibleFilter === 0`
- `emptyStateMessageExpected` matches UI copy.
