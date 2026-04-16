CREATE OR REPLACE FUNCTION public.run_equity_pipeline(
  p_run_type pipeline_run_type,
  p_trigger_source pipeline_trigger_source DEFAULT 'manual_api'::pipeline_trigger_source,
  p_requested_by text DEFAULT NULL::text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(run_id bigint, snapshot_id bigint, status text, validation jsonb)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
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
    UPDATE public.pipeline_run_steps SET status='running', started_at=now()
    WHERE pipeline_run_steps.run_id=v_run_id AND step_name=v_step;

    IF v_step = 'materialization_build' THEN
      DELETE FROM public.indicator_snapshots isnap WHERE isnap.snapshot_id = v_snapshot_id;
      INSERT INTO public.indicator_snapshots(snapshot_id, symbol, calc_date, close, pct_change_1d, volume_ratio, mansfield_rs, ma50_slope, above_ma50)
      SELECT v_snapshot_id, i.symbol, i.calc_date, i.close, i.pct_change_1d, i.volume_ratio, i.mansfield_rs, i.ma50_slope, i.above_ma50
      FROM public.wsp_indicators i WHERE i.calc_date = (SELECT max(i2.calc_date) FROM public.wsp_indicators i2 WHERE i2.symbol = i.symbol);

      DELETE FROM public.screener_rows_materialized srm WHERE srm.snapshot_id = v_snapshot_id;
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

      DELETE FROM public.dashboard_materialized dm WHERE dm.snapshot_id = v_snapshot_id;
      INSERT INTO public.dashboard_materialized(snapshot_id,symbol,close,daily_pct,sector,industry,pattern_state,wsp_score,validity,breakout_freshness,volume_ratio,blockers,warnings)
      SELECT srm.snapshot_id,srm.symbol,srm.close,srm.daily_pct,srm.sector,srm.industry,srm.pattern_state,srm.wsp_score,srm.validity,srm.breakout_freshness,srm.volume_ratio,srm.blockers,srm.warnings
      FROM public.screener_rows_materialized srm WHERE srm.snapshot_id = v_snapshot_id;

      DELETE FROM public.stock_detail_materialized sdm WHERE sdm.snapshot_id = v_snapshot_id;
      INSERT INTO public.stock_detail_materialized(snapshot_id,symbol,close,daily_pct,sector,industry,pattern_state,wsp_score,validity,breakout_freshness,volume_ratio,blockers,warnings,payload)
      SELECT srm.snapshot_id,srm.symbol,srm.close,srm.daily_pct,srm.sector,srm.industry,srm.pattern_state,srm.wsp_score,srm.validity,srm.breakout_freshness,srm.volume_ratio,srm.blockers,srm.warnings,srm.payload
      FROM public.screener_rows_materialized srm WHERE srm.snapshot_id = v_snapshot_id;

      UPDATE public.data_snapshots ds SET
        symbols_completed = (SELECT count(*) FROM public.screener_rows_materialized srm WHERE srm.snapshot_id = v_snapshot_id),
        sectors_completed = (SELECT count(DISTINCT srm.sector) FROM public.screener_rows_materialized srm WHERE srm.snapshot_id = v_snapshot_id),
        industries_completed = (SELECT count(DISTINCT srm.industry) FROM public.screener_rows_materialized srm WHERE srm.snapshot_id = v_snapshot_id),
        symbols_expected = (SELECT count(*) FROM public.symbols s WHERE s.is_active = true AND COALESCE(s.asset_class,'equity')='equity'),
        sectors_expected = (SELECT count(DISTINCT s.sector) FROM public.symbols s WHERE s.is_active = true),
        industries_expected = (SELECT count(DISTINCT s.industry) FROM public.symbols s WHERE s.is_active = true)
      WHERE ds.snapshot_id = v_snapshot_id;
    END IF;

    IF v_step = 'parity_validation' THEN
      SELECT public.validate_equity_snapshot(v_snapshot_id) INTO v_validation;
      IF COALESCE((v_validation->>'passed')::boolean, false) THEN
        UPDATE public.data_snapshots ds SET status = 'validated' WHERE ds.snapshot_id = v_snapshot_id;
      ELSE
        UPDATE public.pipeline_run_steps prs SET status='failed', finished_at=now(), error_text=COALESCE(v_validation->'critical_errors','[]'::jsonb)::text
        WHERE prs.run_id=v_run_id AND prs.step_name=v_step;
        UPDATE public.pipeline_runs pr SET status='failed', finished_at=now(), error_summary='Parity validation failed' WHERE pr.id=v_run_id;
        UPDATE public.data_snapshots ds SET status='failed', completed_at=now(), notes='Parity validation failed' WHERE ds.snapshot_id=v_snapshot_id;
        PERFORM pg_advisory_unlock(hashtext('equities_pipeline_lock'));
        RETURN QUERY SELECT v_run_id, v_snapshot_id, 'failed'::text, v_validation;
        RETURN;
      END IF;
    END IF;

    IF v_step = 'publish_snapshot' THEN
      PERFORM public.publish_equity_snapshot(v_snapshot_id, v_run_id);
    END IF;

    UPDATE public.pipeline_run_steps prs SET status='completed', finished_at=now(), processed_count=GREATEST(prs.processed_count,1)
    WHERE prs.run_id=v_run_id AND prs.step_name=v_step AND prs.status<>'failed';
  END LOOP;

  UPDATE public.pipeline_runs pr SET status='published', finished_at=now(), metadata_json=pr.metadata_json||jsonb_build_object('validation',v_validation) WHERE pr.id=v_run_id;
  PERFORM pg_advisory_unlock(hashtext('equities_pipeline_lock'));
  RETURN QUERY SELECT v_run_id, v_snapshot_id, 'published'::text, v_validation;

EXCEPTION WHEN OTHERS THEN
  UPDATE public.pipeline_runs pr SET status='failed', finished_at=now(), error_summary=SQLERRM WHERE pr.id=v_run_id;
  UPDATE public.data_snapshots ds SET status='failed', completed_at=now(), notes=SQLERRM WHERE ds.snapshot_id=v_snapshot_id;
  PERFORM pg_advisory_unlock(hashtext('equities_pipeline_lock'));
  RAISE;
END;
$function$;