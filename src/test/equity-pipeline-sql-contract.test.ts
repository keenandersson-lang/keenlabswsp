import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(process.cwd(), 'supabase/migrations/20260402110000_equity_canonical_snapshot_pipeline.sql');
const sql = readFileSync(migrationPath, 'utf8');

describe('equity canonical pipeline SQL contract', () => {
  it('public read RPCs are canonical-only and snapshot-scoped', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_equity_screener_rows');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_equity_dashboard_rows');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_equity_stock_detail');
    expect(sql).toContain("JOIN canonical c ON s.snapshot_id = c.sid");
    expect(sql).toContain("JOIN canonical c ON d.snapshot_id = c.sid");
    expect(sql).toContain("AND status = 'canonical'");
  });

  it('pipeline run orchestration includes lock, parity validation and publish gating', () => {
    expect(sql).toContain("pg_try_advisory_lock(hashtext('equities_pipeline_lock'))");
    expect(sql).toContain("'materialization_build','parity_validation','publish_snapshot'");
    expect(sql).toContain("SELECT public.validate_equity_snapshot(v_snapshot_id) INTO v_validation");
    expect(sql).toContain("RETURN QUERY SELECT v_run_id, v_snapshot_id, 'failed'::text, v_validation;");
    expect(sql).toContain('PERFORM public.publish_equity_snapshot(v_snapshot_id, v_run_id);');
  });

  it('publish path keeps one canonical snapshot', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uniq_single_canonical_equity_snapshot');
    expect(sql).toContain('SET is_canonical = false');
    expect(sql).toContain('SET is_canonical = true');
  });

  it('symbol detail path has canonical unavailable error guard', () => {
    const detailFn = readFileSync(join(process.cwd(), 'supabase/functions/wsp-symbol-detail/index.ts'), 'utf8');
    expect(detailFn).toContain('CANONICAL_SNAPSHOT_UNAVAILABLE');
    expect(detailFn).toContain("if (!canonicalDetail)");
  });
});
