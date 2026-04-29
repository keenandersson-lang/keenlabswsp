
CREATE OR REPLACE FUNCTION public.build_scanner_universe_snapshot()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout TO '15min'
AS $$
DECLARE
  v_run_id bigint;
  v_today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  -- Wrapper that explicitly invokes the canonical universe-snapshot builder
  -- using the doctrine source of truth (wsp_eligible_universe view drives same
  -- filters as refresh_scanner_universe_snapshot).
  v_run_id := public.refresh_scanner_universe_snapshot(v_today, 'doctrine_pipeline');
  RETURN v_run_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.build_scanner_universe_snapshot() TO service_role;

CREATE OR REPLACE FUNCTION public.daily_universe_after_close()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout TO '20min'
AS $$
DECLARE
  v_run_id bigint;
  v_eligible bigint;
  v_blocked bigint;
BEGIN
  v_run_id := public.refresh_scanner_universe_snapshot((now() AT TIME ZONE 'utc')::date, 'daily_after_close');

  SELECT count(*) FILTER (WHERE baseline_eligible),
         count(*) FILTER (WHERE NOT baseline_eligible)
    INTO v_eligible, v_blocked
  FROM public.scanner_universe_snapshot
  WHERE run_id = v_run_id;

  UPDATE public.scanner_universe_runs
  SET total_symbols = v_eligible + v_blocked,
      eligible_symbols = v_eligible,
      blocked_symbols = v_blocked
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'eligible', v_eligible,
    'blocked', v_blocked,
    'view_eligible', (SELECT count(*) FROM public.wsp_eligible_universe),
    'as_of', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.daily_universe_after_close() TO service_role;
