import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(process.cwd(), 'supabase/migrations/20260413133000_beta_truth_guardrails.sql');
const sql = readFileSync(migrationPath, 'utf8');

describe('beta truth guardrails', () => {
  it('locks public surfaces to latest published canonical snapshot', () => {
    expect(sql).toContain('get_latest_published_equity_snapshot_id');
    expect(sql).toContain("screener_rows_materialized@latest_published_canonical_snapshot");
    expect(sql).toContain('JOIN canonical c ON srm.snapshot_id = c.sid');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_market_summary()');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_sector_ranking()');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_industry_ranking(');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_heatmap_data()');
  });

  it('enforces 11-sector health semantics from published snapshot', () => {
    expect(sql).toContain("COUNT(DISTINCT srm.sector)");
    expect(sql).toContain("gics_sector_coverage");
    expect(sql).toContain("All 11 canonical GICS sectors represented in published snapshot");
    expect(sql).toContain("public_snapshot_source");
  });

  it('exposes explicit admin populations', () => {
    expect(sql).toContain("'raw_scanned_population'");
    expect(sql).toContain("'canonical_mapped_population'");
    expect(sql).toContain("'wsp_evaluated_population'");
    expect(sql).toContain("'public_eligible_population'");
    expect(sql).toContain("'public_screener_population'");
  });
});

