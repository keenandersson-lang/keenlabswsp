-- Bootstrap fix for first canonical run publication.
-- Removes dependency on legacy market_scan_results_latest during materialization.
-- Makes validation thresholds snapshot-scoped so first canonical run can complete.

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
  v_min_required bigint := 0;
BEGIN
  SELECT COALESCE(NULLIF(ds.symbols_expected, 0), (
    SELECT count(*)
    FROM public.symbols s
    WHERE s.is_active = true
      AND COALESCE(s.asset_class, 'equity') = 'equity'
  ))
  INTO v_expected_symbols
  FROM public.data_snapshots ds
  WHERE ds.snapshot_id = p_snapshot_id;

  SELECT count(*) INTO v_completed_symbols
  FROM public.screener_rows_materialized
  WHERE snapshot_id = p_snapshot_id;

  v_min_required := CASE
    WHEN v_expected_symbols < 20 THEN v_expected_symbols
    ELSE GREATEST((v_expected_symbols * 0.5)::bigint, 20)
  END;

  IF v_completed_symbols = 0 THEN
    v_critical := array_append(v_critical, 'No screener rows materialized for snapshot.');
  END IF;

  IF v_completed_symbols < v_min_required THEN
    v_critical := array_append(v_critical, 'Symbol completeness below threshold.');
  END IF;

  SELECT count(*) INTO v_drift
  FROM public.screener_rows_materialized s
  JOIN public.dashboard_materialized d ON d.snapshot_id = s.snapshot_id AND d.symbol = s.symbol
  JOIN public.stock_detail_materialized sd ON sd.snapshot_id = s.snapshot_id AND sd.symbol = s.symbol
  WHERE s.snapshot_id = p_snapshot_id
    AND (
      COALESCE(s.close, -1) <> COALESCE(d.close, -1)
      OR COALESCE(s.close, -1) <> COALESCE(sd.close, -1)
      OR COALESCE(s.wsp_score, -1) <> COALESCE(d.wsp_score, -1)
      OR COALESCE(s.wsp_score, -1) <> COALESCE(sd.wsp_score, -1)
      OR COALESCE(s.validity, false) <> COALESCE(d.validity, false)
      OR COALESCE(s.validity, false) <> COALESCE(sd.validity, false)
      OR COALESCE(s.breakout_freshness, '') <> COALESCE(d.breakout_freshness, '')
      OR COALESCE(s.breakout_freshness, '') <> COALESCE(sd.breakout_freshness, '')
      OR COALESCE(s.sector, '') <> COALESCE(d.sector, '')
      OR COALESCE(s.sector, '') <> COALESCE(sd.sector, '')
      OR COALESCE(s.industry, '') <> COALESCE(d.industry, '')
      OR COALESCE(s.industry, '') <> COALESCE(sd.industry, '')
    );

  IF v_drift > 0 THEN
    v_critical := array_append(v_critical, format('Cross-view parity drift detected on %s rows.', v_drift));
  END IF;

  RETURN jsonb_build_object(
    'passed', COALESCE(array_length(v_critical, 1), 0) = 0,
    'critical_errors', to_jsonb(v_critical),
    'warning_errors', to_jsonb(v_warning),
    'drift_count', v_drift,
    'summary', jsonb_build_object(
      'symbols_expected', v_expected_symbols,
      'symbols_completed', v_completed_symbols,
      'symbols_min_required', v_min_required
    )
  );
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
  VALUES (p_run_type, 'equities', p_trigger_source, 'running', p_requested_by, COALESCE(p_metadata, '{}'::jsonb))
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
      SELECT
        v_snapshot_id,
        i.symbol,
        i.calc_date,
        i.close,
        i.pct_change_1d,
        i.volume_ratio,
        i.mansfield_rs,
        i.ma50_slope,
        i.above_ma50
      FROM public.wsp_indicators i
      WHERE i.calc_date = (
        SELECT max(i2.calc_date)
        FROM public.wsp_indicators i2
        WHERE i2.symbol = i.symbol
      );

      DELETE FROM public.screener_rows_materialized WHERE snapshot_id = v_snapshot_id;
      WITH universe AS (
        SELECT
          s.symbol,
          COALESCE(NULLIF(s.canonical_sector, ''), NULLIF(s.sector, ''), 'Unknown') AS sector,
          COALESCE(NULLIF(s.canonical_industry, ''), NULLIF(s.industry, ''), 'Unknown') AS industry
        FROM public.symbols s
        WHERE s.is_active = true
          AND COALESCE(s.asset_class, 'equity') = 'equity'
      ),
      latest_i AS (
        SELECT DISTINCT ON (i.symbol)
          i.symbol,
          i.calc_date,
          i.close,
          i.pct_change_1d,
          i.volume_ratio,
          i.mansfield_rs,
          i.ma50_slope,
          i.above_ma50
        FROM public.indicator_snapshots i
        WHERE i.snapshot_id = v_snapshot_id
        ORDER BY i.symbol, i.calc_date DESC
      ),
      pattern AS (
        SELECT p.symbol,
               COALESCE(p.pattern_state,
                 CASE
                   WHEN COALESCE(li.above_ma50, false) AND COALESCE(li.ma50_slope, '') = 'rising' THEN 'climbing'
                   WHEN COALESCE(li.ma50_slope, '') = 'falling' THEN 'downhill'
                   ELSE 'base_or_climbing'
                 END
               ) AS pattern_state,
               COALESCE(p.breakout_freshness, 'unknown') AS breakout_freshness
        FROM latest_i li
        LEFT JOIN public.pattern_states p ON p.snapshot_id = v_snapshot_id AND p.symbol = li.symbol
      )
      INSERT INTO public.screener_rows_materialized(
        snapshot_id, symbol, close, daily_pct, sector, industry, pattern_state, recommendation,
        wsp_score, validity, breakout_freshness, volume_ratio, blockers, warnings, payload
      )
      SELECT
        v_snapshot_id,
        u.symbol,
        li.close,
        li.pct_change_1d,
        u.sector,
        u.industry,
        p.pattern_state,
        CASE
          WHEN p.pattern_state = 'climbing' AND COALESCE(li.volume_ratio, 0) >= 1.1 THEN 'KÖP'
          WHEN p.pattern_state = 'downhill' THEN 'UNDVIK'
          ELSE 'BEVAKA'
        END AS recommendation,
        COALESCE(li.mansfield_rs, 0) * 50
          + (CASE WHEN COALESCE(li.above_ma50, false) THEN 20 ELSE 0 END)
          + (CASE WHEN COALESCE(li.volume_ratio, 0) >= 1.1 THEN 15 ELSE 0 END)
          + (CASE WHEN p.pattern_state = 'climbing' THEN 15 ELSE 0 END) AS wsp_score,
        (p.pattern_state = 'climbing'
          AND COALESCE(li.above_ma50, false)
          AND COALESCE(li.ma50_slope, '') = 'rising'
          AND COALESCE(li.volume_ratio, 0) >= 1.1
          AND COALESCE(li.mansfield_rs, 0) > 0) AS validity,
        p.breakout_freshness,
        li.volume_ratio,
        '[]'::jsonb,
        '[]'::jsonb,
        jsonb_build_object(
          'pipeline', 'canonical_orchestrator',
          'calc_date', li.calc_date,
          'close', li.close,
          'pct_change_1d', li.pct_change_1d,
          'volume_ratio', li.volume_ratio,
          'mansfield_rs', li.mansfield_rs,
          'ma50_slope', li.ma50_slope,
          'above_ma50', li.above_ma50,
          'wsp_pattern', p.pattern_state
        ) AS payload
      FROM universe u
      JOIN latest_i li ON li.symbol = u.symbol
      JOIN pattern p ON p.symbol = u.symbol;

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
          symbols_expected = (SELECT count(DISTINCT symbol) FROM public.indicator_snapshots WHERE snapshot_id = v_snapshot_id),
          sectors_expected = (SELECT count(DISTINCT sector) FROM public.screener_rows_materialized WHERE snapshot_id = v_snapshot_id),
          industries_expected = (SELECT count(DISTINCT industry) FROM public.screener_rows_materialized WHERE snapshot_id = v_snapshot_id)
      WHERE snapshot_id = v_snapshot_id;
    END IF;

    IF v_step = 'parity_validation' THEN
      SELECT public.validate_equity_snapshot(v_snapshot_id) INTO v_validation;
      IF COALESCE((v_validation->>'passed')::boolean, false) THEN
        UPDATE public.data_snapshots SET status = 'validated' WHERE snapshot_id = v_snapshot_id;
      ELSE
        UPDATE public.pipeline_run_steps
        SET status = 'failed', finished_at = now(), error_text = COALESCE(v_validation->'critical_errors','[]'::jsonb)::text
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
  UPDATE public.pipeline_run_steps
  SET status = 'failed', finished_at = now(), error_text = SQLERRM
  WHERE run_id = v_run_id AND step_name = v_step;

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
