-- ============================================================
-- 1. MODULE_RUNS: add checkpoints column for per-step tracking
-- ============================================================
ALTER TABLE public.module_runs
  ADD COLUMN IF NOT EXISTS checkpoints jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Helper to append a checkpoint atomically from edge functions
CREATE OR REPLACE FUNCTION public.add_module_checkpoint(
  p_run_id bigint,
  p_step text,
  p_status text DEFAULT 'ok',
  p_rows_in integer DEFAULT NULL,
  p_rows_out integer DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.module_runs
  SET checkpoints = COALESCE(checkpoints, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'step', p_step,
      'status', p_status,
      'rows_in', p_rows_in,
      'rows_out', p_rows_out,
      'at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'meta', COALESCE(p_meta, '{}'::jsonb)
    )
  )
  WHERE id = p_run_id;
END;
$$;

-- ============================================================
-- 2. DOCTRINE_FAILURES: retry + backoff fields
-- ============================================================
ALTER TABLE public.doctrine_failures
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS permanently_failed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_doctrine_failures_retry
  ON public.doctrine_failures (next_retry_at)
  WHERE resolved_at IS NULL AND permanently_failed = false;

-- Backoff schedule in minutes
CREATE OR REPLACE FUNCTION public._doctrine_backoff_minutes(p_attempt integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_attempt
    WHEN 0 THEN 5
    WHEN 1 THEN 15
    WHEN 2 THEN 60
    WHEN 3 THEN 360
    WHEN 4 THEN 1440
    ELSE 2880
  END;
$$;

-- Returns symbols due for retry and bumps their retry counter
CREATE OR REPLACE FUNCTION public.auto_retry_doctrine_failures(
  p_max integer DEFAULT 50,
  p_max_attempts integer DEFAULT 5
)
RETURNS TABLE(symbol text, retry_count integer, next_retry_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_due text[];
BEGIN
  -- Mark anything with retry_count >= max as permanently failed
  UPDATE public.doctrine_failures
  SET permanently_failed = true
  WHERE resolved_at IS NULL
    AND permanently_failed = false
    AND retry_count >= p_max_attempts;

  -- Initialise next_retry_at for newly-inserted rows
  UPDATE public.doctrine_failures
  SET next_retry_at = failed_at + (public._doctrine_backoff_minutes(retry_count) || ' minutes')::interval
  WHERE next_retry_at IS NULL
    AND resolved_at IS NULL
    AND permanently_failed = false;

  -- Pick distinct symbols that are due
  WITH due AS (
    SELECT DISTINCT ON (df.symbol) df.symbol, df.retry_count
    FROM public.doctrine_failures df
    WHERE df.resolved_at IS NULL
      AND df.permanently_failed = false
      AND df.next_retry_at <= now()
    ORDER BY df.symbol, df.failed_at DESC
    LIMIT p_max
  )
  SELECT array_agg(d.symbol) INTO v_due FROM due d;

  IF v_due IS NULL OR array_length(v_due, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Bump counters and schedule next retry
  UPDATE public.doctrine_failures df
  SET retry_count = df.retry_count + 1,
      last_retry_at = now(),
      next_retry_at = now() + (public._doctrine_backoff_minutes(df.retry_count + 1) || ' minutes')::interval
  WHERE df.symbol = ANY(v_due)
    AND df.resolved_at IS NULL
    AND df.permanently_failed = false;

  RETURN QUERY
    SELECT df.symbol, df.retry_count, df.next_retry_at
    FROM public.doctrine_failures df
    WHERE df.symbol = ANY(v_due)
      AND df.resolved_at IS NULL
    ORDER BY df.symbol, df.failed_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_retry_doctrine_failures(integer, integer) TO authenticated;

-- ============================================================
-- 3. UNIVERSE HISTORY + DIFF
-- ============================================================
CREATE TABLE IF NOT EXISTS public.wsp_eligible_universe_history (
  id bigserial PRIMARY KEY,
  taken_at timestamptz NOT NULL DEFAULT now(),
  symbol text NOT NULL,
  canonical_sector text,
  canonical_industry text,
  support_level text,
  is_active boolean,
  UNIQUE (taken_at, symbol)
);

CREATE INDEX IF NOT EXISTS idx_wsp_universe_history_taken
  ON public.wsp_eligible_universe_history (taken_at DESC);

ALTER TABLE public.wsp_eligible_universe_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_read_universe_history ON public.wsp_eligible_universe_history;
CREATE POLICY auth_read_universe_history
  ON public.wsp_eligible_universe_history
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS srv_universe_history ON public.wsp_eligible_universe_history;
CREATE POLICY srv_universe_history
  ON public.wsp_eligible_universe_history
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Snapshot current eligible universe
CREATE OR REPLACE FUNCTION public.snapshot_wsp_eligible_universe()
RETURNS TABLE(taken_at timestamptz, total integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ts timestamptz := now();
  v_total integer;
BEGIN
  INSERT INTO public.wsp_eligible_universe_history
    (taken_at, symbol, canonical_sector, canonical_industry, support_level, is_active)
  SELECT v_ts, s.symbol, s.canonical_sector, s.canonical_industry, s.support_level, s.is_active
  FROM public.symbols s
  WHERE s.is_active = true
    AND s.canonical_sector IS NOT NULL
    AND s.canonical_industry IS NOT NULL
    AND COALESCE(s.eligible_for_full_wsp, false) = true;

  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN QUERY SELECT v_ts, v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_wsp_eligible_universe() TO authenticated;

-- Diff between the two most recent snapshots
CREATE OR REPLACE FUNCTION public.get_wsp_eligible_universe_diff()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curr timestamptz;
  v_prev timestamptz;
  v_added jsonb;
  v_removed jsonb;
BEGIN
  SELECT taken_at INTO v_curr
  FROM public.wsp_eligible_universe_history
  GROUP BY taken_at ORDER BY taken_at DESC LIMIT 1;

  SELECT taken_at INTO v_prev
  FROM public.wsp_eligible_universe_history
  WHERE taken_at < v_curr
  GROUP BY taken_at ORDER BY taken_at DESC LIMIT 1;

  IF v_curr IS NULL OR v_prev IS NULL THEN
    RETURN jsonb_build_object(
      'current', v_curr, 'previous', v_prev,
      'added', '[]'::jsonb, 'removed', '[]'::jsonb,
      'added_count', 0, 'removed_count', 0
    );
  END IF;

  WITH curr AS (
    SELECT symbol, canonical_sector, canonical_industry, support_level, is_active
    FROM public.wsp_eligible_universe_history WHERE taken_at = v_curr
  ),
  prev AS (
    SELECT symbol, canonical_sector, canonical_industry, support_level, is_active
    FROM public.wsp_eligible_universe_history WHERE taken_at = v_prev
  ),
  added AS (
    SELECT c.symbol, c.canonical_sector, c.canonical_industry, c.support_level, 'added' AS change
    FROM curr c LEFT JOIN prev p USING (symbol) WHERE p.symbol IS NULL
  ),
  removed AS (
    SELECT p.symbol, p.canonical_sector, p.canonical_industry, p.support_level,
      CASE
        WHEN s.symbol IS NULL THEN 'symbol_deleted'
        WHEN COALESCE(s.is_active,false) = false THEN 'inactive'
        WHEN s.canonical_sector IS NULL OR s.canonical_industry IS NULL THEN 'gics_invalid'
        WHEN s.support_level = 'etf_excluded' THEN 'etf_excluded'
        WHEN s.support_level = 'sector_benchmark_proxy' THEN 'proxy_change'
        WHEN COALESCE(s.eligible_for_full_wsp, false) = false THEN 'wsp_ineligible'
        ELSE 'unknown'
      END AS reason
    FROM prev p
    LEFT JOIN curr c USING (symbol)
    LEFT JOIN public.symbols s ON s.symbol = p.symbol
    WHERE c.symbol IS NULL
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'symbol', a.symbol, 'sector', a.canonical_sector, 'industry', a.canonical_industry,
      'support_level', a.support_level
    )) FILTER (WHERE a.symbol IS NOT NULL), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
      'symbol', r.symbol, 'sector', r.canonical_sector, 'industry', r.canonical_industry,
      'support_level', r.support_level, 'reason', r.reason
    )) FILTER (WHERE r.symbol IS NOT NULL), '[]'::jsonb)
  INTO v_added, v_removed
  FROM added a FULL OUTER JOIN removed r ON false;

  RETURN jsonb_build_object(
    'current', v_curr,
    'previous', v_prev,
    'added', v_added,
    'removed', v_removed,
    'added_count', jsonb_array_length(v_added),
    'removed_count', jsonb_array_length(v_removed)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_wsp_eligible_universe_diff() TO authenticated;

-- ============================================================
-- 4. UNIVERSE CONSISTENCY VERIFICATION
--    Compare scanner_universe_snapshot vs. wsp_eligible_universe
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_universe_consistency()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest_run bigint;
  v_eligible_count integer;
  v_snapshot_count integer;
  v_in_snapshot_not_eligible integer;
  v_in_eligible_not_snapshot integer;
  v_match boolean;
BEGIN
  SELECT id INTO v_latest_run FROM public.scanner_universe_runs ORDER BY id DESC LIMIT 1;

  SELECT count(*) INTO v_eligible_count FROM public.wsp_eligible_universe;

  SELECT count(*) INTO v_snapshot_count
  FROM public.scanner_universe_snapshot
  WHERE run_id = v_latest_run AND is_scanner_eligible = true;

  SELECT count(*) INTO v_in_snapshot_not_eligible
  FROM public.scanner_universe_snapshot s
  LEFT JOIN public.wsp_eligible_universe e ON e.symbol = s.symbol
  WHERE s.run_id = v_latest_run AND s.is_scanner_eligible = true AND e.symbol IS NULL;

  SELECT count(*) INTO v_in_eligible_not_snapshot
  FROM public.wsp_eligible_universe e
  LEFT JOIN public.scanner_universe_snapshot s
    ON s.symbol = e.symbol AND s.run_id = v_latest_run AND s.is_scanner_eligible = true
  WHERE s.symbol IS NULL;

  v_match := (v_in_snapshot_not_eligible = 0 AND v_in_eligible_not_snapshot = 0);

  RETURN jsonb_build_object(
    'latest_run_id', v_latest_run,
    'wsp_eligible_count', v_eligible_count,
    'snapshot_eligible_count', v_snapshot_count,
    'in_snapshot_not_eligible', v_in_snapshot_not_eligible,
    'in_eligible_not_snapshot', v_in_eligible_not_snapshot,
    'consistent', v_match,
    'as_of', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_universe_consistency() TO authenticated;

-- ============================================================
-- 5. COMPLIANCE EXPORT (single JSON document)
-- ============================================================
CREATE OR REPLACE FUNCTION public.export_compliance_report()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_compliance jsonb;
  v_validation jsonb;
  v_proxies jsonb;
  v_diff jsonb;
  v_dataflow jsonb;
  v_consistency jsonb;
  v_failures_open integer;
BEGIN
  BEGIN v_compliance := public.get_doctrine_compliance(); EXCEPTION WHEN OTHERS THEN v_compliance := NULL; END;
  BEGIN v_validation := public.validate_doctrine_triggers_views(); EXCEPTION WHEN OTHERS THEN v_validation := NULL; END;
  BEGIN
    SELECT jsonb_agg(row_to_json(t)) INTO v_proxies FROM public.get_proxy_verification() t;
  EXCEPTION WHEN OTHERS THEN v_proxies := NULL; END;
  BEGIN v_diff := public.get_wsp_eligible_universe_diff(); EXCEPTION WHEN OTHERS THEN v_diff := NULL; END;
  BEGIN v_dataflow := public.get_module_dataflow(); EXCEPTION WHEN OTHERS THEN v_dataflow := NULL; END;
  BEGIN v_consistency := public.verify_universe_consistency(); EXCEPTION WHEN OTHERS THEN v_consistency := NULL; END;

  SELECT count(*) INTO v_failures_open
  FROM public.doctrine_failures
  WHERE resolved_at IS NULL AND permanently_failed = false;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'project', 'WSP Doctrine',
    'compliance', v_compliance,
    'validation', v_validation,
    'proxies', COALESCE(v_proxies, '[]'::jsonb),
    'universe_diff', v_diff,
    'universe_consistency', v_consistency,
    'dataflow', v_dataflow,
    'open_doctrine_failures', v_failures_open
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.export_compliance_report() TO authenticated;
