# Canonical Pipeline Live Schema Reconciliation (2026-04-02)

Purpose: reconcile production/live DB so canonical orchestrator objects exist **before** any runtime debugging.

## 0) Confirm target project

Project ref expected by this repo env: `xvdhpztohozxdsxcsidf`.

- Source: `.env` (`SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`).

## 1) Audit migration history in live DB

Run in SQL editor (privileged session):

```sql
select version, name, inserted_at
from supabase_migrations.schema_migrations
where version in (
  '20260402110000', -- equity_canonical_snapshot_pipeline
  '20260402133000', -- equity_exposure_lineage_fix
  '20260402143000', -- admin_canonical_console_hardening
  '20260402152000'  -- canonical_pipeline_bootstrap_fix
)
order by version;
```

Interpretation:
- No rows: migrations never applied to this project.
- Subset of rows: partial apply.
- Rows exist but objects missing: likely applied to different project or failed/rolled back manually.

## 2) Audit required object existence

```sql
with required_tables as (
  select unnest(array[
    'pipeline_runs',
    'pipeline_run_steps',
    'data_snapshots'
  ]) as object_name
),
required_functions as (
  select unnest(array[
    'run_equity_pipeline',
    'get_equity_pipeline_console_runs',
    'get_equity_publish_history',
    'get_equity_canonical_price_bar_range',
    'get_equity_snapshot_coverage_report',
    'get_equity_canonical_funnel_counts'
  ]) as object_name
)
select 'table' as object_type,
       t.object_name,
       exists(
         select 1
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname = t.object_name
           and c.relkind in ('r','p','v','m')
       ) as exists_in_public
from required_tables t
union all
select 'function' as object_type,
       f.object_name,
       exists(
         select 1
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = f.object_name
       ) as exists_in_public
from required_functions f
order by object_type, object_name;
```

## 3) Canonical source-of-truth migrations in this repo

These migrations define required canonical objects:

1. `supabase/migrations/20260402110000_equity_canonical_snapshot_pipeline.sql`
   - creates `pipeline_runs`, `pipeline_run_steps`, `data_snapshots`
   - defines `run_equity_pipeline` and base pipeline RPC surface
2. `supabase/migrations/20260402133000_equity_exposure_lineage_fix.sql`
   - defines `get_equity_snapshot_coverage_report`
   - defines `get_equity_canonical_funnel_counts`
3. `supabase/migrations/20260402143000_admin_canonical_console_hardening.sql`
   - defines `get_equity_pipeline_console_runs`
   - defines `get_equity_publish_history`
   - defines `get_equity_canonical_price_bar_range`
4. `supabase/migrations/20260402152000_canonical_pipeline_bootstrap_fix.sql`
   - replaces `run_equity_pipeline` for canonical bootstrap and first-publish readiness

## 4) Reconcile live DB

Apply missing migrations to the **same** project ref as production Admin UI.

Recommended sequence:
1. Ensure deployment target project ref is correct.
2. Apply migrations through deployment pipeline or SQL editor in exact order above.
3. Re-run steps (1) and (2) until all required rows/objects exist.

## 5) Post-reconcile first privileged run checks

After schema is reconciled, run one privileged orchestration call (`daily_sync` or `backfill`) and verify:

```sql
-- latest run
select *
from public.pipeline_runs
order by started_at desc
limit 1;

-- latest run steps
select *
from public.pipeline_run_steps
where run_id = (select id from public.pipeline_runs order by started_at desc limit 1)
order by id;

-- latest snapshot
select *
from public.data_snapshots
order by started_at desc
limit 1;
```

If failed, return exact first failing step:

```sql
select run_id, step_name, status, error_text, started_at, finished_at
from public.pipeline_run_steps
where run_id = (select id from public.pipeline_runs order by started_at desc limit 1)
  and status = 'failed'
order by id
limit 1;
```
