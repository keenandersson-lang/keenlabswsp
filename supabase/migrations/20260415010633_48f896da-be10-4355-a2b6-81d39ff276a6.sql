
-- Create enum types
DO $$ BEGIN CREATE TYPE public.pipeline_run_type AS ENUM ('backfill', 'daily_sync', 'partial_rebuild'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.pipeline_trigger_source AS ENUM ('admin_button', 'cron', 'github_action', 'manual_api'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.pipeline_run_status AS ENUM ('queued', 'running', 'failed', 'completed', 'published'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.pipeline_step_status AS ENUM ('queued', 'running', 'failed', 'completed', 'skipped'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.snapshot_status AS ENUM ('building', 'validated', 'failed', 'canonical'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create tables
CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id bigserial PRIMARY KEY, run_type public.pipeline_run_type NOT NULL, asset_class text NOT NULL DEFAULT 'equities',
  trigger_source public.pipeline_trigger_source NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  status public.pipeline_run_status NOT NULL DEFAULT 'queued', requested_by text, error_summary text, metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.pipeline_run_steps (
  id bigserial PRIMARY KEY, run_id bigint NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  step_name text NOT NULL, status public.pipeline_step_status NOT NULL DEFAULT 'queued',
  started_at timestamptz, finished_at timestamptz, processed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0, metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb, error_text text,
  UNIQUE(run_id, step_name)
);

CREATE TABLE IF NOT EXISTS public.data_snapshots (
  snapshot_id bigserial PRIMARY KEY, run_id bigint NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  asset_class text NOT NULL DEFAULT 'equities', effective_date date NOT NULL DEFAULT current_date,
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  status public.snapshot_status NOT NULL DEFAULT 'building', is_canonical boolean NOT NULL DEFAULT false,
  symbols_expected integer NOT NULL DEFAULT 0, symbols_completed integer NOT NULL DEFAULT 0,
  sectors_expected integer NOT NULL DEFAULT 0, sectors_completed integer NOT NULL DEFAULT 0,
  industries_expected integer NOT NULL DEFAULT 0, industries_completed integer NOT NULL DEFAULT 0, notes text
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_single_canonical_equity_snapshot ON public.data_snapshots(asset_class) WHERE is_canonical = true AND asset_class = 'equities';

CREATE TABLE IF NOT EXISTS public.indicator_snapshots (
  snapshot_id bigint NOT NULL, symbol text NOT NULL, calc_date date NOT NULL,
  close numeric, pct_change_1d numeric, volume_ratio numeric, mansfield_rs numeric, ma50_slope text, above_ma50 boolean,
  PRIMARY KEY (snapshot_id, symbol, calc_date)
);

CREATE TABLE IF NOT EXISTS public.screener_rows_materialized (
  snapshot_id bigint NOT NULL, symbol text NOT NULL, close numeric, daily_pct numeric,
  sector text, industry text, pattern_state text, recommendation text, wsp_score numeric,
  validity boolean, breakout_freshness text, volume_ratio numeric, blockers jsonb, warnings jsonb, payload jsonb,
  as_of timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (snapshot_id, symbol)
);

CREATE TABLE IF NOT EXISTS public.dashboard_materialized (
  snapshot_id bigint NOT NULL, symbol text NOT NULL, close numeric, daily_pct numeric,
  sector text, industry text, pattern_state text, wsp_score numeric, validity boolean,
  breakout_freshness text, volume_ratio numeric, blockers jsonb, warnings jsonb,
  as_of timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (snapshot_id, symbol)
);

CREATE TABLE IF NOT EXISTS public.stock_detail_materialized (
  snapshot_id bigint NOT NULL, symbol text NOT NULL, close numeric, daily_pct numeric,
  sector text, industry text, pattern_state text, wsp_score numeric, validity boolean,
  breakout_freshness text, volume_ratio numeric, blockers jsonb, warnings jsonb, payload jsonb,
  as_of timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (snapshot_id, symbol)
);

CREATE TABLE IF NOT EXISTS public.wsp_evaluations (
  snapshot_id bigint NOT NULL, symbol text NOT NULL, wsp_score numeric, validity boolean,
  blockers jsonb, warnings jsonb, breakout_freshness text, volume_ratio numeric,
  PRIMARY KEY (snapshot_id, symbol)
);

CREATE TABLE IF NOT EXISTS public.pattern_states (
  snapshot_id bigint NOT NULL, symbol text NOT NULL, pattern_state text, breakout_freshness text,
  PRIMARY KEY (snapshot_id, symbol)
);

-- RLS
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indicator_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screener_rows_materialized ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_materialized ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_detail_materialized ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wsp_evaluations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
CREATE POLICY "srv_pipeline_runs" ON public.pipeline_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
CREATE POLICY "auth_read_pipeline_runs" ON public.pipeline_runs FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
CREATE POLICY "srv_pipeline_run_steps" ON public.pipeline_run_steps FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
CREATE POLICY "auth_read_pipeline_run_steps" ON public.pipeline_run_steps FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
CREATE POLICY "srv_data_snapshots" ON public.data_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
CREATE POLICY "auth_read_data_snapshots" ON public.data_snapshots FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
CREATE POLICY "srv_indicator_snapshots" ON public.indicator_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
CREATE POLICY "srv_screener_mat" ON public.screener_rows_materialized FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
CREATE POLICY "pub_read_screener_mat" ON public.screener_rows_materialized FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
CREATE POLICY "srv_dashboard_mat" ON public.dashboard_materialized FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
CREATE POLICY "pub_read_dashboard_mat" ON public.dashboard_materialized FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
CREATE POLICY "srv_stock_detail_mat" ON public.stock_detail_materialized FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
CREATE POLICY "pub_read_stock_detail_mat" ON public.stock_detail_materialized FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
CREATE POLICY "srv_wsp_eval" ON public.wsp_evaluations FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Helper functions
CREATE OR REPLACE FUNCTION public.get_latest_canonical_snapshot_id(p_asset_class text DEFAULT 'equities')
RETURNS bigint LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT snapshot_id FROM public.data_snapshots
  WHERE asset_class = p_asset_class AND is_canonical = true AND status = 'canonical'
  ORDER BY completed_at DESC NULLS LAST, snapshot_id DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.publish_equity_snapshot(p_snapshot_id bigint, p_run_id bigint)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.data_snapshots SET is_canonical = false, status = 'validated'
  WHERE asset_class = 'equities' AND is_canonical = true AND snapshot_id <> p_snapshot_id;
  UPDATE public.data_snapshots SET is_canonical = true, status = 'canonical', completed_at = now()
  WHERE snapshot_id = p_snapshot_id;
  UPDATE public.pipeline_runs SET status = 'published', finished_at = now() WHERE id = p_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_equity_snapshot(p_snapshot_id bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_critical text[] := ARRAY[]::text[];
  v_warning text[] := ARRAY[]::text[];
  v_drift bigint := 0;
  v_expected bigint := 0;
  v_completed bigint := 0;
  v_min_req bigint := 0;
BEGIN
  SELECT COALESCE(NULLIF(ds.symbols_expected, 0),
    (SELECT count(*) FROM public.symbols s WHERE s.is_active = true AND COALESCE(s.asset_class,'equity')='equity'))
  INTO v_expected FROM public.data_snapshots ds WHERE ds.snapshot_id = p_snapshot_id;

  SELECT count(*) INTO v_completed FROM public.screener_rows_materialized WHERE snapshot_id = p_snapshot_id;
  v_min_req := CASE WHEN v_expected < 20 THEN v_expected ELSE GREATEST((v_expected*0.5)::bigint, 20) END;

  IF v_completed = 0 THEN v_critical := array_append(v_critical, 'No screener rows materialized.'); END IF;
  IF v_completed < v_min_req THEN v_critical := array_append(v_critical, 'Symbol completeness below threshold.'); END IF;

  SELECT count(*) INTO v_drift
  FROM public.screener_rows_materialized s
  JOIN public.dashboard_materialized d ON d.snapshot_id=s.snapshot_id AND d.symbol=s.symbol
  JOIN public.stock_detail_materialized sd ON sd.snapshot_id=s.snapshot_id AND sd.symbol=s.symbol
  WHERE s.snapshot_id = p_snapshot_id AND (COALESCE(s.close,-1)<>COALESCE(d.close,-1) OR COALESCE(s.close,-1)<>COALESCE(sd.close,-1));

  IF v_drift > 0 THEN v_critical := array_append(v_critical, format('Parity drift on %s rows.', v_drift)); END IF;

  RETURN jsonb_build_object('passed', COALESCE(array_length(v_critical,1),0)=0,
    'critical_errors', to_jsonb(v_critical), 'warning_errors', to_jsonb(v_warning), 'drift_count', v_drift,
    'summary', jsonb_build_object('symbols_expected',v_expected,'symbols_completed',v_completed,'symbols_min_required',v_min_req));
END;
$$;

-- Main orchestrator
CREATE OR REPLACE FUNCTION public.run_equity_pipeline(
  p_run_type public.pipeline_run_type,
  p_trigger_source public.pipeline_trigger_source DEFAULT 'manual_api',
  p_requested_by text DEFAULT null,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(run_id bigint, snapshot_id bigint, status text, validation jsonb)
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_run_id bigint; v_snapshot_id bigint; v_validation jsonb; v_step text;
  v_steps text[] := ARRAY['materialization_build','parity_validation','publish_snapshot'];
  v_is_locked boolean;
BEGIN
  SELECT pg_try_advisory_lock(hashtext('equities_pipeline_lock')) INTO v_is_locked;
  IF NOT v_is_locked THEN RAISE EXCEPTION 'Pipeline already active.'; END IF;

  INSERT INTO public.pipeline_runs(run_type, asset_class, trigger_source, status, requested_by, metadata_json)
  VALUES (p_run_type, 'equities', p_trigger_source, 'running', p_requested_by, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_run_id;

  INSERT INTO public.data_snapshots(run_id, asset_class, status, started_at, effective_date)
  VALUES (v_run_id, 'equities', 'building', now(), current_date)
  RETURNING data_snapshots.snapshot_id INTO v_snapshot_id;

  INSERT INTO public.pipeline_run_steps(run_id, step_name, status)
  SELECT v_run_id, unnest(v_steps), 'queued'::public.pipeline_step_status;

  FOREACH v_step IN ARRAY v_steps LOOP
    UPDATE public.pipeline_run_steps SET status='running', started_at=now() WHERE run_id=v_run_id AND step_name=v_step;

    IF v_step = 'materialization_build' THEN
      DELETE FROM public.indicator_snapshots WHERE snapshot_id = v_snapshot_id;
      INSERT INTO public.indicator_snapshots(snapshot_id, symbol, calc_date, close, pct_change_1d, volume_ratio, mansfield_rs, ma50_slope, above_ma50)
      SELECT v_snapshot_id, i.symbol, i.calc_date, i.close, i.pct_change_1d, i.volume_ratio, i.mansfield_rs, i.ma50_slope, i.above_ma50
      FROM public.wsp_indicators i WHERE i.calc_date = (SELECT max(i2.calc_date) FROM public.wsp_indicators i2 WHERE i2.symbol = i.symbol);

      DELETE FROM public.screener_rows_materialized WHERE snapshot_id = v_snapshot_id;
      WITH universe AS (
        SELECT s.symbol, COALESCE(NULLIF(s.canonical_sector,''),NULLIF(s.sector,''),'Unknown') AS sector,
               COALESCE(NULLIF(s.canonical_industry,''),NULLIF(s.industry,''),'Unknown') AS industry
        FROM public.symbols s WHERE s.is_active = true AND COALESCE(s.asset_class,'equity')='equity'
      ),
      latest_i AS (
        SELECT DISTINCT ON (i.symbol) i.symbol, i.calc_date, i.close, i.pct_change_1d, i.volume_ratio, i.mansfield_rs, i.ma50_slope, i.above_ma50
        FROM public.indicator_snapshots i WHERE i.snapshot_id = v_snapshot_id ORDER BY i.symbol, i.calc_date DESC
      ),
      pattern AS (
        SELECT li.symbol,
          CASE WHEN COALESCE(li.above_ma50,false) AND COALESCE(li.ma50_slope,'')='rising' THEN 'climbing'
               WHEN COALESCE(li.ma50_slope,'')='falling' THEN 'downhill' ELSE 'base_or_climbing' END AS pattern_state,
          'unknown' AS breakout_freshness
        FROM latest_i li
      )
      INSERT INTO public.screener_rows_materialized(snapshot_id, symbol, close, daily_pct, sector, industry, pattern_state, recommendation,
        wsp_score, validity, breakout_freshness, volume_ratio, blockers, warnings, payload)
      SELECT v_snapshot_id, u.symbol, li.close, li.pct_change_1d, u.sector, u.industry, p.pattern_state,
        CASE WHEN p.pattern_state='climbing' AND COALESCE(li.volume_ratio,0)>=1.1 THEN 'KÖP'
             WHEN p.pattern_state='downhill' THEN 'UNDVIK' ELSE 'BEVAKA' END,
        COALESCE(li.mansfield_rs,0)*50 + (CASE WHEN COALESCE(li.above_ma50,false) THEN 20 ELSE 0 END)
          + (CASE WHEN COALESCE(li.volume_ratio,0)>=1.1 THEN 15 ELSE 0 END)
          + (CASE WHEN p.pattern_state='climbing' THEN 15 ELSE 0 END),
        (p.pattern_state='climbing' AND COALESCE(li.above_ma50,false) AND COALESCE(li.ma50_slope,'')='rising'
          AND COALESCE(li.volume_ratio,0)>=1.1 AND COALESCE(li.mansfield_rs,0)>0),
        p.breakout_freshness, li.volume_ratio, '[]'::jsonb, '[]'::jsonb,
        jsonb_build_object('pipeline','canonical_orchestrator','calc_date',li.calc_date,'close',li.close,
          'pct_change_1d',li.pct_change_1d,'volume_ratio',li.volume_ratio,'mansfield_rs',li.mansfield_rs,
          'ma50_slope',li.ma50_slope,'above_ma50',li.above_ma50,'wsp_pattern',p.pattern_state)
      FROM universe u JOIN latest_i li ON li.symbol=u.symbol JOIN pattern p ON p.symbol=u.symbol;

      DELETE FROM public.dashboard_materialized WHERE snapshot_id = v_snapshot_id;
      INSERT INTO public.dashboard_materialized(snapshot_id,symbol,close,daily_pct,sector,industry,pattern_state,wsp_score,validity,breakout_freshness,volume_ratio,blockers,warnings)
      SELECT snapshot_id,symbol,close,daily_pct,sector,industry,pattern_state,wsp_score,validity,breakout_freshness,volume_ratio,blockers,warnings
      FROM public.screener_rows_materialized WHERE snapshot_id = v_snapshot_id;

      DELETE FROM public.stock_detail_materialized WHERE snapshot_id = v_snapshot_id;
      INSERT INTO public.stock_detail_materialized(snapshot_id,symbol,close,daily_pct,sector,industry,pattern_state,wsp_score,validity,breakout_freshness,volume_ratio,blockers,warnings,payload)
      SELECT snapshot_id,symbol,close,daily_pct,sector,industry,pattern_state,wsp_score,validity,breakout_freshness,volume_ratio,blockers,warnings,payload
      FROM public.screener_rows_materialized WHERE snapshot_id = v_snapshot_id;

      UPDATE public.data_snapshots SET
        symbols_completed = (SELECT count(*) FROM public.screener_rows_materialized WHERE snapshot_id = v_snapshot_id),
        sectors_completed = (SELECT count(DISTINCT sector) FROM public.screener_rows_materialized WHERE snapshot_id = v_snapshot_id),
        industries_completed = (SELECT count(DISTINCT industry) FROM public.screener_rows_materialized WHERE snapshot_id = v_snapshot_id),
        symbols_expected = (SELECT count(*) FROM public.symbols WHERE is_active = true AND COALESCE(asset_class,'equity')='equity'),
        sectors_expected = (SELECT count(DISTINCT sector) FROM public.symbols WHERE is_active = true),
        industries_expected = (SELECT count(DISTINCT industry) FROM public.symbols WHERE is_active = true)
      WHERE snapshot_id = v_snapshot_id;
    END IF;

    IF v_step = 'parity_validation' THEN
      SELECT public.validate_equity_snapshot(v_snapshot_id) INTO v_validation;
      IF COALESCE((v_validation->>'passed')::boolean, false) THEN
        UPDATE public.data_snapshots SET status = 'validated' WHERE snapshot_id = v_snapshot_id;
      ELSE
        UPDATE public.pipeline_run_steps SET status='failed', finished_at=now(), error_text=COALESCE(v_validation->'critical_errors','[]'::jsonb)::text
        WHERE run_id=v_run_id AND step_name=v_step;
        UPDATE public.pipeline_runs SET status='failed', finished_at=now(), error_summary='Parity validation failed' WHERE id=v_run_id;
        UPDATE public.data_snapshots SET status='failed', completed_at=now(), notes='Parity validation failed' WHERE snapshot_id=v_snapshot_id;
        PERFORM pg_advisory_unlock(hashtext('equities_pipeline_lock'));
        RETURN QUERY SELECT v_run_id, v_snapshot_id, 'failed'::text, v_validation;
        RETURN;
      END IF;
    END IF;

    IF v_step = 'publish_snapshot' THEN
      PERFORM public.publish_equity_snapshot(v_snapshot_id, v_run_id);
    END IF;

    UPDATE public.pipeline_run_steps SET status='completed', finished_at=now(), processed_count=GREATEST(processed_count,1)
    WHERE run_id=v_run_id AND step_name=v_step AND status<>'failed';
  END LOOP;

  UPDATE public.pipeline_runs SET status='published', finished_at=now(), metadata_json=metadata_json||jsonb_build_object('validation',v_validation) WHERE id=v_run_id;
  PERFORM pg_advisory_unlock(hashtext('equities_pipeline_lock'));
  RETURN QUERY SELECT v_run_id, v_snapshot_id, 'published'::text, v_validation;

EXCEPTION WHEN OTHERS THEN
  UPDATE public.pipeline_runs SET status='failed', finished_at=now(), error_summary=SQLERRM WHERE id=v_run_id;
  UPDATE public.data_snapshots SET status='failed', completed_at=now(), notes=SQLERRM WHERE snapshot_id=v_snapshot_id;
  PERFORM pg_advisory_unlock(hashtext('equities_pipeline_lock'));
  RAISE;
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION public.get_latest_canonical_snapshot_id(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_equity_snapshot(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_equity_pipeline(public.pipeline_run_type, public.pipeline_trigger_source, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_equity_snapshot(bigint, bigint) TO service_role;
