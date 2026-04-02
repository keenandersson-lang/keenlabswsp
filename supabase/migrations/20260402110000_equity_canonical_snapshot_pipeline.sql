-- Canonical snapshot-based equities pipeline

DO $$ BEGIN
  CREATE TYPE public.pipeline_run_type AS ENUM ('backfill', 'daily_sync', 'partial_rebuild');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pipeline_trigger_source AS ENUM ('admin_button', 'cron', 'github_action', 'manual_api');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pipeline_run_status AS ENUM ('queued', 'running', 'failed', 'completed', 'published');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pipeline_step_status AS ENUM ('queued', 'running', 'failed', 'completed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.snapshot_status AS ENUM ('building', 'validated', 'failed', 'canonical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id bigserial PRIMARY KEY,
  run_type public.pipeline_run_type NOT NULL,
  asset_class text NOT NULL DEFAULT 'equities',
  trigger_source public.pipeline_trigger_source NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status public.pipeline_run_status NOT NULL DEFAULT 'queued',
  requested_by text,
  error_summary text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.pipeline_run_steps (
  id bigserial PRIMARY KEY,
  run_id bigint NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  step_name text NOT NULL,
  status public.pipeline_step_status NOT NULL DEFAULT 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  processed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_text text,
  UNIQUE(run_id, step_name)
);

CREATE TABLE IF NOT EXISTS public.data_snapshots (
  snapshot_id bigserial PRIMARY KEY,
  run_id bigint NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  asset_class text NOT NULL DEFAULT 'equities',
  effective_date date NOT NULL DEFAULT current_date,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status public.snapshot_status NOT NULL DEFAULT 'building',
  is_canonical boolean NOT NULL DEFAULT false,
  symbols_expected integer NOT NULL DEFAULT 0,
  symbols_completed integer NOT NULL DEFAULT 0,
  sectors_expected integer NOT NULL DEFAULT 0,
  sectors_completed integer NOT NULL DEFAULT 0,
  industries_expected integer NOT NULL DEFAULT 0,
  industries_completed integer NOT NULL DEFAULT 0,
  notes text
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_single_canonical_equity_snapshot
ON public.data_snapshots(asset_class)
WHERE is_canonical = true AND asset_class = 'equities';

CREATE TABLE IF NOT EXISTS public.equity_pipeline_locks (
  asset_class text PRIMARY KEY,
  active_run_id bigint,
  locked_at timestamptz NOT NULL DEFAULT now(),
  locked_by text
);

CREATE TABLE IF NOT EXISTS public.indicator_snapshots (
  snapshot_id bigint NOT NULL,
  symbol text NOT NULL,
  calc_date date NOT NULL,
  close numeric,
  pct_change_1d numeric,
  volume_ratio numeric,
  mansfield_rs numeric,
  ma50_slope text,
  above_ma50 boolean,
  PRIMARY KEY (snapshot_id, symbol, calc_date)
);

CREATE TABLE IF NOT EXISTS public.regime_snapshots (
  snapshot_id bigint NOT NULL,
  regime_scope text NOT NULL,
  regime_key text NOT NULL,
  regime_value text,
  PRIMARY KEY (snapshot_id, regime_scope, regime_key)
);

CREATE TABLE IF NOT EXISTS public.pattern_states (
  snapshot_id bigint NOT NULL,
  symbol text NOT NULL,
  pattern_state text,
  breakout_freshness text,
  PRIMARY KEY (snapshot_id, symbol)
);

CREATE TABLE IF NOT EXISTS public.resistance_zones (
  snapshot_id bigint NOT NULL,
  symbol text NOT NULL,
  resistance_level numeric,
  overhead_supply text,
  PRIMARY KEY (snapshot_id, symbol)
);

CREATE TABLE IF NOT EXISTS public.wsp_evaluations (
  snapshot_id bigint NOT NULL,
  symbol text NOT NULL,
  wsp_score numeric,
  validity boolean,
  blockers jsonb,
  warnings jsonb,
  breakout_freshness text,
  volume_ratio numeric,
  PRIMARY KEY (snapshot_id, symbol)
);

CREATE TABLE IF NOT EXISTS public.dashboard_materialized (
  snapshot_id bigint NOT NULL,
  symbol text NOT NULL,
  close numeric,
  daily_pct numeric,
  sector text,
  industry text,
  pattern_state text,
  wsp_score numeric,
  validity boolean,
  breakout_freshness text,
  volume_ratio numeric,
  blockers jsonb,
  warnings jsonb,
  as_of timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, symbol)
);

CREATE TABLE IF NOT EXISTS public.sector_rankings_materialized (
  snapshot_id bigint NOT NULL,
  sector text NOT NULL,
  score numeric,
  symbol_count integer,
  PRIMARY KEY (snapshot_id, sector)
);

CREATE TABLE IF NOT EXISTS public.industry_rankings_materialized (
  snapshot_id bigint NOT NULL,
  industry text NOT NULL,
  score numeric,
  symbol_count integer,
  PRIMARY KEY (snapshot_id, industry)
);

CREATE TABLE IF NOT EXISTS public.screener_rows_materialized (
  snapshot_id bigint NOT NULL,
  symbol text NOT NULL,
  close numeric,
  daily_pct numeric,
  sector text,
  industry text,
  pattern_state text,
  recommendation text,
  wsp_score numeric,
  validity boolean,
  breakout_freshness text,
  volume_ratio numeric,
  blockers jsonb,
  warnings jsonb,
  payload jsonb,
  as_of timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, symbol)
);

CREATE TABLE IF NOT EXISTS public.stock_detail_materialized (
  snapshot_id bigint NOT NULL,
  symbol text NOT NULL,
  close numeric,
  daily_pct numeric,
  sector text,
  industry text,
  pattern_state text,
  wsp_score numeric,
  validity boolean,
  breakout_freshness text,
  volume_ratio numeric,
  blockers jsonb,
  warnings jsonb,
  payload jsonb,
  as_of timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, symbol)
);

CREATE OR REPLACE FUNCTION public.get_latest_canonical_snapshot_id(p_asset_class text DEFAULT 'equities')
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT snapshot_id
  FROM public.data_snapshots
  WHERE asset_class = p_asset_class
    AND is_canonical = true
    AND status = 'canonical'
  ORDER BY completed_at DESC NULLS LAST, snapshot_id DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_equity_screener_rows(p_page integer DEFAULT 0, p_page_size integer DEFAULT 100)
RETURNS TABLE (
  snapshot_id bigint,
  symbol text,
  close numeric,
  daily_pct numeric,
  sector text,
  industry text,
  pattern_state text,
  recommendation text,
  wsp_score numeric,
  validity boolean,
  breakout_freshness text,
  volume_ratio numeric,
  blockers jsonb,
  warnings jsonb,
  payload jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH canonical AS (
    SELECT public.get_latest_canonical_snapshot_id('equities') AS sid
  )
  SELECT s.snapshot_id, s.symbol, s.close, s.daily_pct, s.sector, s.industry, s.pattern_state,
         s.recommendation, s.wsp_score, s.validity, s.breakout_freshness, s.volume_ratio,
         s.blockers, s.warnings, s.payload
  FROM public.screener_rows_materialized s
  JOIN canonical c ON s.snapshot_id = c.sid
  ORDER BY s.wsp_score DESC NULLS LAST, s.symbol ASC
  OFFSET GREATEST(p_page, 0) * GREATEST(p_page_size, 1)
  LIMIT GREATEST(p_page_size, 1);
$$;

CREATE OR REPLACE FUNCTION public.get_equity_dashboard_rows()
RETURNS TABLE (
  snapshot_id bigint,
  symbol text,
  close numeric,
  daily_pct numeric,
  sector text,
  industry text,
  pattern_state text,
  wsp_score numeric,
  validity boolean,
  breakout_freshness text,
  volume_ratio numeric,
  blockers jsonb,
  warnings jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH canonical AS (
    SELECT public.get_latest_canonical_snapshot_id('equities') AS sid
  )
  SELECT d.snapshot_id, d.symbol, d.close, d.daily_pct, d.sector, d.industry, d.pattern_state,
         d.wsp_score, d.validity, d.breakout_freshness, d.volume_ratio, d.blockers, d.warnings
  FROM public.dashboard_materialized d
  JOIN canonical c ON d.snapshot_id = c.sid
  ORDER BY d.wsp_score DESC NULLS LAST, d.symbol ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_equity_stock_detail(p_symbol text)
RETURNS TABLE (
  snapshot_id bigint,
  symbol text,
  close numeric,
  daily_pct numeric,
  sector text,
  industry text,
  pattern_state text,
  wsp_score numeric,
  validity boolean,
  breakout_freshness text,
  volume_ratio numeric,
  blockers jsonb,
  warnings jsonb,
  payload jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH canonical AS (
    SELECT public.get_latest_canonical_snapshot_id('equities') AS sid
  )
  SELECT d.snapshot_id, d.symbol, d.close, d.daily_pct, d.sector, d.industry, d.pattern_state,
         d.wsp_score, d.validity, d.breakout_freshness, d.volume_ratio, d.blockers, d.warnings, d.payload
  FROM public.stock_detail_materialized d
  JOIN canonical c ON d.snapshot_id = c.sid
  WHERE d.symbol = upper(trim(p_symbol))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.validate_equity_snapshot(p_snapshot_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_critical text[] := ARRAY[]::text[];
  v_warning text[] := ARRAY[]::text[];
  v_drift bigint := 0;
  v_expected_symbols bigint := 0;
  v_completed_symbols bigint := 0;
BEGIN
  SELECT count(*) INTO v_expected_symbols
  FROM public.symbols
  WHERE is_active = true
    AND coalesce(asset_class, 'equity') = 'equity';

  SELECT count(*) INTO v_completed_symbols
  FROM public.screener_rows_materialized
  WHERE snapshot_id = p_snapshot_id;

  IF v_completed_symbols = 0 THEN
    v_critical := array_append(v_critical, 'No screener rows materialized for snapshot.');
  END IF;

  IF v_completed_symbols < GREATEST(v_expected_symbols * 0.5, 20) THEN
    v_critical := array_append(v_critical, 'Symbol completeness below threshold.');
  END IF;

  SELECT count(*) INTO v_drift
  FROM public.screener_rows_materialized s
  JOIN public.dashboard_materialized d ON d.snapshot_id = s.snapshot_id AND d.symbol = s.symbol
  JOIN public.stock_detail_materialized sd ON sd.snapshot_id = s.snapshot_id AND sd.symbol = s.symbol
  WHERE s.snapshot_id = p_snapshot_id
    AND (
      coalesce(s.close, -1) <> coalesce(d.close, -1)
      OR coalesce(s.close, -1) <> coalesce(sd.close, -1)
      OR coalesce(s.wsp_score, -1) <> coalesce(d.wsp_score, -1)
      OR coalesce(s.wsp_score, -1) <> coalesce(sd.wsp_score, -1)
      OR coalesce(s.validity, false) <> coalesce(d.validity, false)
      OR coalesce(s.validity, false) <> coalesce(sd.validity, false)
      OR coalesce(s.breakout_freshness, '') <> coalesce(d.breakout_freshness, '')
      OR coalesce(s.breakout_freshness, '') <> coalesce(sd.breakout_freshness, '')
      OR coalesce(s.sector, '') <> coalesce(d.sector, '')
      OR coalesce(s.sector, '') <> coalesce(sd.sector, '')
      OR coalesce(s.industry, '') <> coalesce(d.industry, '')
      OR coalesce(s.industry, '') <> coalesce(sd.industry, '')
    );

  IF v_drift > 0 THEN
    v_critical := array_append(v_critical, format('Cross-view parity drift detected on %s rows.', v_drift));
  END IF;

  RETURN jsonb_build_object(
    'passed', coalesce(array_length(v_critical, 1), 0) = 0,
    'critical_errors', to_jsonb(v_critical),
    'warning_errors', to_jsonb(v_warning),
    'drift_count', v_drift,
    'summary', jsonb_build_object(
      'symbols_expected', v_expected_symbols,
      'symbols_completed', v_completed_symbols
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_equity_snapshot(p_snapshot_id bigint, p_run_id bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.data_snapshots
  SET is_canonical = false,
      status = 'validated'
  WHERE asset_class = 'equities'
    AND is_canonical = true
    AND snapshot_id <> p_snapshot_id;

  UPDATE public.data_snapshots
  SET is_canonical = true,
      status = 'canonical',
      completed_at = now()
  WHERE snapshot_id = p_snapshot_id;

  UPDATE public.pipeline_runs
  SET status = 'published',
      finished_at = now()
  WHERE id = p_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_equity_pipeline(
  p_run_type public.pipeline_run_type,
  p_trigger_source public.pipeline_trigger_source DEFAULT 'manual_api',
  p_requested_by text DEFAULT null,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(run_id bigint, snapshot_id bigint, status text, validation jsonb)
LANGUAGE plpgsql
AS $$
DECLARE
  v_run_id bigint;
  v_snapshot_id bigint;
  v_validation jsonb;
  v_step text;
  v_steps text[] := ARRAY[
    'universe_build','historical_price_ingest','incremental_price_ingest','aggregate_build','indicator_build',
    'benchmark_build','regime_build','pattern_build','resistance_build','evaluation_build',
    'materialization_build','parity_validation','publish_snapshot'
  ];
  v_is_locked boolean;
BEGIN
  SELECT pg_try_advisory_lock(hashtext('equities_pipeline_lock')) INTO v_is_locked;
  IF NOT v_is_locked THEN
    RAISE EXCEPTION 'An equities pipeline run is already active.';
  END IF;

  INSERT INTO public.pipeline_runs(run_type, asset_class, trigger_source, status, requested_by, metadata_json)
  VALUES (p_run_type, 'equities', p_trigger_source, 'running', p_requested_by, coalesce(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_run_id;

  INSERT INTO public.data_snapshots(run_id, asset_class, status, started_at, effective_date)
  VALUES (v_run_id, 'equities', 'building', now(), current_date)
  RETURNING data_snapshots.snapshot_id INTO v_snapshot_id;

  INSERT INTO public.pipeline_run_steps(run_id, step_name, status)
  SELECT v_run_id, unnest(v_steps), 'queued'::public.pipeline_step_status;

  FOREACH v_step IN ARRAY v_steps LOOP
    UPDATE public.pipeline_run_steps
    SET status = 'running', started_at = now()
    WHERE run_id = v_run_id AND step_name = v_step;

    IF v_step = 'materialization_build' THEN
      DELETE FROM public.indicator_snapshots WHERE snapshot_id = v_snapshot_id;
      INSERT INTO public.indicator_snapshots(snapshot_id, symbol, calc_date, close, pct_change_1d, volume_ratio, mansfield_rs, ma50_slope, above_ma50)
      SELECT v_snapshot_id, i.symbol, i.calc_date, i.close, i.pct_change_1d, i.volume_ratio, i.mansfield_rs, i.ma50_slope, i.above_ma50
      FROM public.wsp_indicators i
      WHERE i.calc_date = (SELECT max(calc_date) FROM public.wsp_indicators i2 WHERE i2.symbol = i.symbol);

      DELETE FROM public.screener_rows_materialized WHERE snapshot_id = v_snapshot_id;
      INSERT INTO public.screener_rows_materialized(
        snapshot_id, symbol, close, daily_pct, sector, industry, pattern_state, recommendation,
        wsp_score, validity, breakout_freshness, volume_ratio, blockers, warnings, payload
      )
      SELECT
        v_snapshot_id,
        m.symbol,
        coalesce((m.payload->>'close')::numeric, i.close),
        coalesce((m.payload->>'pct_change_1d')::numeric, i.pct_change_1d),
        m.sector,
        m.industry,
        coalesce(m.pattern, i.wsp_pattern, 'base'),
        m.recommendation,
        coalesce((m.payload->>'wsp_score')::numeric, m.score, i.wsp_score),
        CASE
          WHEN coalesce(m.recommendation, '') IN ('UNDVIK', 'SÄLJ') THEN false
          ELSE true
        END,
        coalesce(m.payload->>'breakout_freshness', 'unknown'),
        coalesce((m.payload->>'volume_ratio')::numeric, i.volume_ratio),
        coalesce(m.payload->'blockers', '[]'::jsonb),
        coalesce(m.payload->'warnings', '[]'::jsonb),
        coalesce(m.payload, '{}'::jsonb)
      FROM public.market_scan_results_latest m
      LEFT JOIN public.indicator_snapshots i ON i.snapshot_id = v_snapshot_id AND i.symbol = m.symbol
      WHERE m.symbol IS NOT NULL;

      DELETE FROM public.dashboard_materialized WHERE snapshot_id = v_snapshot_id;
      INSERT INTO public.dashboard_materialized(
        snapshot_id, symbol, close, daily_pct, sector, industry, pattern_state,
        wsp_score, validity, breakout_freshness, volume_ratio, blockers, warnings
      )
      SELECT snapshot_id, symbol, close, daily_pct, sector, industry, pattern_state,
             wsp_score, validity, breakout_freshness, volume_ratio, blockers, warnings
      FROM public.screener_rows_materialized
      WHERE snapshot_id = v_snapshot_id;

      DELETE FROM public.stock_detail_materialized WHERE snapshot_id = v_snapshot_id;
      INSERT INTO public.stock_detail_materialized(
        snapshot_id, symbol, close, daily_pct, sector, industry, pattern_state,
        wsp_score, validity, breakout_freshness, volume_ratio, blockers, warnings, payload
      )
      SELECT snapshot_id, symbol, close, daily_pct, sector, industry, pattern_state,
             wsp_score, validity, breakout_freshness, volume_ratio, blockers, warnings, payload
      FROM public.screener_rows_materialized
      WHERE snapshot_id = v_snapshot_id;

      DELETE FROM public.wsp_evaluations WHERE snapshot_id = v_snapshot_id;
      INSERT INTO public.wsp_evaluations(snapshot_id, symbol, wsp_score, validity, blockers, warnings, breakout_freshness, volume_ratio)
      SELECT snapshot_id, symbol, wsp_score, validity, blockers, warnings, breakout_freshness, volume_ratio
      FROM public.screener_rows_materialized
      WHERE snapshot_id = v_snapshot_id;

      UPDATE public.data_snapshots
      SET symbols_completed = (SELECT count(*) FROM public.screener_rows_materialized WHERE snapshot_id = v_snapshot_id),
          sectors_completed = (SELECT count(DISTINCT sector) FROM public.screener_rows_materialized WHERE snapshot_id = v_snapshot_id),
          industries_completed = (SELECT count(DISTINCT industry) FROM public.screener_rows_materialized WHERE snapshot_id = v_snapshot_id),
          symbols_expected = (SELECT count(*) FROM public.symbols WHERE is_active = true AND coalesce(asset_class, 'equity') = 'equity'),
          sectors_expected = (SELECT count(DISTINCT sector) FROM public.symbols WHERE is_active = true),
          industries_expected = (SELECT count(DISTINCT industry) FROM public.symbols WHERE is_active = true)
      WHERE snapshot_id = v_snapshot_id;
    END IF;

    IF v_step = 'parity_validation' THEN
      SELECT public.validate_equity_snapshot(v_snapshot_id) INTO v_validation;
      IF coalesce((v_validation->>'passed')::boolean, false) THEN
        UPDATE public.data_snapshots SET status = 'validated' WHERE snapshot_id = v_snapshot_id;
      ELSE
        UPDATE public.pipeline_run_steps
        SET status = 'failed', finished_at = now(), error_text = coalesce(v_validation->'critical_errors','[]'::jsonb)::text
        WHERE run_id = v_run_id AND step_name = v_step;

        UPDATE public.pipeline_runs
        SET status = 'failed', finished_at = now(), error_summary = 'Parity validation failed', metadata_json = metadata_json || jsonb_build_object('validation', v_validation)
        WHERE id = v_run_id;

        UPDATE public.data_snapshots
        SET status = 'failed', completed_at = now(), notes = 'Parity validation failed'
        WHERE snapshot_id = v_snapshot_id;

        PERFORM pg_advisory_unlock(hashtext('equities_pipeline_lock'));
        RETURN QUERY SELECT v_run_id, v_snapshot_id, 'failed'::text, v_validation;
        RETURN;
      END IF;
    END IF;

    IF v_step = 'publish_snapshot' THEN
      PERFORM public.publish_equity_snapshot(v_snapshot_id, v_run_id);
    END IF;

    UPDATE public.pipeline_run_steps
    SET status = 'completed', finished_at = now(), processed_count = GREATEST(processed_count, 1)
    WHERE run_id = v_run_id AND step_name = v_step AND status <> 'failed';
  END LOOP;

  UPDATE public.pipeline_runs
  SET status = 'published', finished_at = now(), metadata_json = metadata_json || jsonb_build_object('validation', v_validation)
  WHERE id = v_run_id;

  PERFORM pg_advisory_unlock(hashtext('equities_pipeline_lock'));
  RETURN QUERY SELECT v_run_id, v_snapshot_id, 'published'::text, v_validation;

EXCEPTION WHEN OTHERS THEN
  UPDATE public.pipeline_runs
  SET status = 'failed', finished_at = now(), error_summary = SQLERRM
  WHERE id = v_run_id;

  UPDATE public.data_snapshots
  SET status = 'failed', completed_at = now(), notes = SQLERRM
  WHERE snapshot_id = v_snapshot_id;

  PERFORM pg_advisory_unlock(hashtext('equities_pipeline_lock'));
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_equity_pipeline_runs(p_limit integer DEFAULT 25)
RETURNS TABLE(
  id bigint,
  run_type public.pipeline_run_type,
  status public.pipeline_run_status,
  started_at timestamptz,
  finished_at timestamptz,
  trigger_source public.pipeline_trigger_source,
  requested_by text,
  error_summary text,
  metadata_json jsonb
)
LANGUAGE sql
STABLE
AS $$
  SELECT r.id, r.run_type, r.status, r.started_at, r.finished_at, r.trigger_source, r.requested_by, r.error_summary, r.metadata_json
  FROM public.pipeline_runs r
  WHERE r.asset_class = 'equities'
  ORDER BY r.started_at DESC
  LIMIT GREATEST(p_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.get_equity_pipeline_run_steps(p_run_id bigint)
RETURNS TABLE(
  id bigint,
  run_id bigint,
  step_name text,
  status public.pipeline_step_status,
  started_at timestamptz,
  finished_at timestamptz,
  processed_count integer,
  failed_count integer,
  metadata_json jsonb,
  error_text text
)
LANGUAGE sql
STABLE
AS $$
  SELECT s.id, s.run_id, s.step_name, s.status, s.started_at, s.finished_at, s.processed_count, s.failed_count, s.metadata_json, s.error_text
  FROM public.pipeline_run_steps s
  WHERE s.run_id = p_run_id
  ORDER BY s.id;
$$;

CREATE OR REPLACE FUNCTION public.get_equity_snapshots(p_limit integer DEFAULT 25)
RETURNS TABLE(
  snapshot_id bigint,
  run_id bigint,
  status public.snapshot_status,
  is_canonical boolean,
  effective_date date,
  started_at timestamptz,
  completed_at timestamptz,
  symbols_expected integer,
  symbols_completed integer,
  sectors_expected integer,
  sectors_completed integer,
  industries_expected integer,
  industries_completed integer,
  notes text
)
LANGUAGE sql
STABLE
AS $$
  SELECT snapshot_id, run_id, status, is_canonical, effective_date, started_at, completed_at,
         symbols_expected, symbols_completed, sectors_expected, sectors_completed, industries_expected, industries_completed, notes
  FROM public.data_snapshots
  WHERE asset_class = 'equities'
  ORDER BY started_at DESC
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_canonical_snapshot_id(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_equity_screener_rows(integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_equity_dashboard_rows() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_equity_stock_detail(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_equity_snapshot(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_equity_pipeline(public.pipeline_run_type, public.pipeline_trigger_source, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_equity_pipeline_runs(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_equity_pipeline_run_steps(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_equity_snapshots(integer) TO authenticated, service_role;
