-- Hotfix: make broad market scan self-diagnosing with persisted failure metadata and stage counts.

CREATE OR REPLACE FUNCTION public.run_broad_market_scan(
  p_as_of_date date DEFAULT (now() AT TIME ZONE 'utc')::date,
  p_run_label text DEFAULT 'scheduled'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_universe_run_id bigint;
  v_scan_run_id bigint;
  v_snapshot_considered bigint := 0;
  v_price_history_pass bigint := 0;
  v_indicator_gate_pass bigint := 0;
  v_metadata_blocked_only bigint := 0;
  v_baseline_targeted bigint := 0;
  v_eligible_universe_count bigint := 0;
  v_latest_wsp_join_count bigint := 0;
  v_symbols_join_count bigint := 0;
  v_alignment_join_count bigint := 0;
  v_scan_payload_count bigint := 0;
  v_inserted_count bigint := 0;
  v_stage_counts jsonb := '{}'::jsonb;
  v_failing_step text := 'init';
  v_error_message text;
  v_error_sqlstate text;
BEGIN
  INSERT INTO public.market_scan_runs (scan_date, run_label, status, metadata)
  VALUES (
    p_as_of_date,
    p_run_label,
    'running',
    jsonb_build_object(
      'rule_version', 'phase7_v2_baseline_hotfix_diag_v1',
      'stage_counts', '{}'::jsonb
    )
  )
  RETURNING id INTO v_scan_run_id;

  BEGIN
    v_failing_step := 'refresh_universe_snapshot';
    v_universe_run_id := public.refresh_scanner_universe_snapshot(p_as_of_date, CONCAT('universe_', p_run_label));

    v_stage_counts := v_stage_counts || jsonb_build_object(
      'universe_snapshot_created', 1,
      'universe_run_id', v_universe_run_id
    );

    UPDATE public.market_scan_runs
    SET universe_run_id = v_universe_run_id,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('stage_counts', v_stage_counts)
    WHERE id = v_scan_run_id;

    v_failing_step := 'count_universe_snapshot';
    SELECT
      COUNT(*)::bigint,
      COUNT(*) FILTER (WHERE sus.history_bars >= 260)::bigint,
      COUNT(*) FILTER (WHERE sus.history_bars >= 260 AND sus.indicator_ready)::bigint,
      COUNT(*) FILTER (
        WHERE sus.history_bars >= 260
          AND sus.indicator_ready
          AND sus.support_level IN ('full_wsp_equity', 'limited_equity')
          AND sus.is_scanner_eligible
          AND (
            sus.classification_status NOT IN ('canonicalized', 'manually_reviewed')
            OR sus.classification_confidence_level NOT IN ('high', 'medium')
            OR sus.canonical_sector = 'Unknown'
            OR sus.canonical_industry = 'Unknown'
            OR COALESCE(sus.alignment_eligible, false) = false
          )
      )::bigint,
      COUNT(*) FILTER (WHERE sus.is_scanner_eligible)::bigint
    INTO
      v_snapshot_considered,
      v_price_history_pass,
      v_indicator_gate_pass,
      v_metadata_blocked_only,
      v_baseline_targeted
    FROM public.scanner_universe_snapshot sus
    WHERE sus.run_id = v_universe_run_id;

    v_stage_counts := v_stage_counts || jsonb_build_object(
      'snapshot_symbols_considered', v_snapshot_considered,
      'price_history_pass', v_price_history_pass,
      'indicator_gate_pass', v_indicator_gate_pass,
      'metadata_or_alignment_blocked_only', v_metadata_blocked_only,
      'baseline_targeted', v_baseline_targeted
    );

    UPDATE public.market_scan_runs
    SET
      symbols_targeted = v_baseline_targeted,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('stage_counts', v_stage_counts)
    WHERE id = v_scan_run_id;

    v_failing_step := 'count_insert_gates';
    WITH latest_wsp AS (
      SELECT DISTINCT ON (wi.symbol)
        wi.symbol,
        wi.calc_date,
        wi.wsp_pattern,
        wi.wsp_score,
        wi.ma50,
        wi.ma150,
        wi.ma50_slope,
        wi.above_ma50,
        wi.above_ma150,
        wi.volume_ratio,
        wi.mansfield_rs,
        wi.pct_change_1d
      FROM public.wsp_indicators wi
      ORDER BY wi.symbol, wi.calc_date DESC
    ),
    universe AS (
      SELECT *
      FROM public.scanner_universe_snapshot
      WHERE run_id = v_universe_run_id
        AND is_scanner_eligible = true
    ),
    joined_wsp AS (
      SELECT u.symbol
      FROM universe u
      JOIN latest_wsp l ON l.symbol = u.symbol
    ),
    joined_symbols AS (
      SELECT jw.symbol
      FROM joined_wsp jw
      JOIN public.symbols s ON s.symbol = jw.symbol
    ),
    joined_alignment AS (
      SELECT js.symbol
      FROM joined_symbols js
      LEFT JOIN public.symbol_industry_alignment_active sia ON sia.symbol = js.symbol
    )
    SELECT
      (SELECT COUNT(*)::bigint FROM universe),
      (SELECT COUNT(*)::bigint FROM joined_wsp),
      (SELECT COUNT(*)::bigint FROM joined_symbols),
      (SELECT COUNT(*)::bigint FROM joined_alignment)
    INTO
      v_eligible_universe_count,
      v_latest_wsp_join_count,
      v_symbols_join_count,
      v_alignment_join_count;

    v_scan_payload_count := v_alignment_join_count;

    v_stage_counts := v_stage_counts || jsonb_build_object(
      'eligible_universe_count', v_eligible_universe_count,
      'latest_wsp_join_count', v_latest_wsp_join_count,
      'symbols_join_count', v_symbols_join_count,
      'alignment_join_count', v_alignment_join_count,
      'scan_payload_count', v_scan_payload_count,
      'dropped_before_latest_wsp_join', GREATEST(v_eligible_universe_count - v_latest_wsp_join_count, 0),
      'dropped_before_symbols_join', GREATEST(v_latest_wsp_join_count - v_symbols_join_count, 0),
      'dropped_before_alignment_join', GREATEST(v_symbols_join_count - v_alignment_join_count, 0)
    );

    UPDATE public.market_scan_runs
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('stage_counts', v_stage_counts)
    WHERE id = v_scan_run_id;

    v_failing_step := 'insert_market_scan_results';
    WITH latest_wsp AS (
      SELECT DISTINCT ON (wi.symbol)
        wi.symbol,
        wi.calc_date,
        wi.wsp_pattern,
        wi.wsp_score,
        wi.ma50,
        wi.ma150,
        wi.ma50_slope,
        wi.above_ma50,
        wi.above_ma150,
        wi.volume_ratio,
        wi.mansfield_rs,
        wi.pct_change_1d
      FROM public.wsp_indicators wi
      ORDER BY wi.symbol, wi.calc_date DESC
    ),
    universe AS (
      SELECT *
      FROM public.scanner_universe_snapshot
      WHERE run_id = v_universe_run_id
        AND is_scanner_eligible = true
    ),
    scan_payload AS (
      SELECT
        u.symbol,
        u.support_level,
        u.canonical_sector,
        u.canonical_industry,
        u.classification_confidence_level,
        u.classification_status,
        u.alignment_eligible,
        l.wsp_pattern,
        l.wsp_score,
        l.ma50,
        l.ma150,
        l.ma50_slope,
        l.above_ma50,
        l.above_ma150,
        l.volume_ratio,
        l.mansfield_rs,
        l.pct_change_1d,
        COALESCE(sia.alignment_status, 'unresolved') AS alignment_status,
        COALESCE(sia.alignment_reason, 'alignment_unresolved') AS alignment_reason,
        COALESCE(s.eligible_for_full_wsp, false) AS eligible_for_full_wsp
      FROM universe u
      JOIN latest_wsp l ON l.symbol = u.symbol
      JOIN public.symbols s ON s.symbol = u.symbol
      LEFT JOIN public.symbol_industry_alignment_active sia ON sia.symbol = u.symbol
    )
    INSERT INTO public.market_scan_results (
      run_id,
      symbol,
      scan_date,
      scan_timestamp,
      support_level,
      pattern,
      recommendation,
      blockers,
      score,
      trend_state,
      sector,
      industry,
      alignment_status,
      alignment_reason,
      confidence_level,
      promotion_status,
      approved_for_live_scanner,
      review_needed,
      blocked_low_quality,
      is_tier1_default,
      payload
    )
    SELECT
      v_scan_run_id,
      p.symbol,
      p_as_of_date,
      now(),
      p.support_level,
      p.wsp_pattern,
      CASE
        WHEN p.wsp_pattern = 'CLIMBING' AND COALESCE(p.wsp_score, 0) >= 8 THEN 'KÖP'
        WHEN p.wsp_pattern IN ('CLIMBING', 'BASE') THEN 'BEVAKA'
        WHEN p.wsp_pattern = 'TIRED' THEN 'SÄLJ'
        ELSE 'UNDVIK'
      END AS recommendation,
      array_remove(ARRAY[
        CASE WHEN COALESCE(p.above_ma50, false) = false THEN 'below_ma50' END,
        CASE WHEN COALESCE(p.above_ma150, false) = false THEN 'below_ma150' END,
        CASE WHEN COALESCE(p.volume_ratio, 0) < 1.1 THEN 'volume_not_confirmed' END,
        CASE WHEN COALESCE(p.mansfield_rs, 0) <= 0 THEN 'mansfield_not_valid' END,
        CASE WHEN p.classification_confidence_level NOT IN ('high', 'medium') THEN 'classification_low_confidence' END,
        CASE WHEN p.canonical_sector = 'Unknown' OR p.canonical_industry = 'Unknown' THEN 'missing_sector_industry' END,
        CASE WHEN COALESCE(p.alignment_eligible, false) = false THEN 'alignment_not_ready' END,
        CASE WHEN p.alignment_status = 'blocked_low_quality_classification' THEN 'blocked_low_quality_classification' END
      ], NULL)::text[] AS blockers,
      COALESCE(p.wsp_score, 0) AS score,
      CASE
        WHEN COALESCE(p.above_ma50, false) AND COALESCE(p.above_ma150, false) AND p.ma50_slope = 'up' THEN 'bullish'
        WHEN COALESCE(p.above_ma150, false) = false THEN 'bearish'
        ELSE 'neutral'
      END AS trend_state,
      p.canonical_sector,
      p.canonical_industry,
      p.alignment_status,
      p.alignment_reason,
      p.classification_confidence_level,
      CASE
        WHEN p.support_level = 'full_wsp_equity' AND p.eligible_for_full_wsp THEN 'tier1_default'
        WHEN p.classification_confidence_level = 'low'
          OR p.canonical_sector = 'Unknown'
          OR p.canonical_industry = 'Unknown'
          OR COALESCE(p.alignment_eligible, false) = false
          OR p.alignment_status = 'blocked_low_quality_classification'
        THEN 'blocked_low_quality'
        WHEN p.wsp_pattern = 'CLIMBING'
          AND COALESCE(p.wsp_score, 0) >= 8
          AND p.classification_confidence_level IN ('high', 'medium')
          AND p.canonical_sector <> 'Unknown'
          AND p.canonical_industry <> 'Unknown'
          AND COALESCE(p.alignment_eligible, false) = true
          AND p.alignment_status NOT IN ('blocked_low_quality_classification', 'unresolved')
        THEN 'approved_for_live_scanner'
        WHEN p.wsp_pattern = 'CLIMBING' AND COALESCE(p.wsp_score, 0) >= 6 THEN 'review_needed'
        ELSE 'broader_candidate'
      END AS promotion_status,
      CASE
        WHEN p.support_level = 'full_wsp_equity' AND p.eligible_for_full_wsp THEN true
        WHEN p.wsp_pattern = 'CLIMBING'
          AND COALESCE(p.wsp_score, 0) >= 8
          AND p.classification_confidence_level IN ('high', 'medium')
          AND p.canonical_sector <> 'Unknown'
          AND p.canonical_industry <> 'Unknown'
          AND COALESCE(p.alignment_eligible, false) = true
          AND p.alignment_status NOT IN ('blocked_low_quality_classification', 'unresolved')
        THEN true
        ELSE false
      END AS approved_for_live_scanner,
      CASE
        WHEN p.wsp_pattern = 'CLIMBING' AND COALESCE(p.wsp_score, 0) BETWEEN 6 AND 7 THEN true
        ELSE false
      END AS review_needed,
      CASE
        WHEN p.classification_confidence_level = 'low'
          OR p.canonical_sector = 'Unknown'
          OR p.canonical_industry = 'Unknown'
          OR COALESCE(p.alignment_eligible, false) = false
          OR p.alignment_status = 'blocked_low_quality_classification'
        THEN true
        ELSE false
      END AS blocked_low_quality,
      CASE WHEN p.support_level = 'full_wsp_equity' AND p.eligible_for_full_wsp THEN true ELSE false END AS is_tier1_default,
      jsonb_build_object(
        'wsp_pattern', p.wsp_pattern,
        'wsp_score', COALESCE(p.wsp_score, 0),
        'ma50', p.ma50,
        'ma150', p.ma150,
        'ma50_slope', p.ma50_slope,
        'volume_ratio', p.volume_ratio,
        'mansfield_rs', p.mansfield_rs,
        'pct_change_1d', p.pct_change_1d,
        'metadata_quality', jsonb_build_object(
          'classification_status', p.classification_status,
          'classification_confidence_level', p.classification_confidence_level,
          'alignment_eligible', COALESCE(p.alignment_eligible, false),
          'has_canonical_sector_industry', (p.canonical_sector <> 'Unknown' AND p.canonical_industry <> 'Unknown')
        )
      ) AS payload
    FROM scan_payload p;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    v_stage_counts := v_stage_counts || jsonb_build_object(
      'inserted_rows', v_inserted_count,
      'dropped_before_insert', GREATEST(v_scan_payload_count - v_inserted_count, 0)
    );

    UPDATE public.market_scan_runs r
    SET
      completed_at = now(),
      symbols_targeted = v_baseline_targeted,
      symbols_scanned = v_inserted_count,
      symbols_failed = GREATEST(v_baseline_targeted - v_inserted_count, 0),
      status = CASE
        WHEN v_inserted_count = 0 THEN 'failed'
        WHEN v_inserted_count < v_baseline_targeted THEN 'partial'
        ELSE 'completed'
      END,
      metadata = COALESCE(r.metadata, '{}'::jsonb) || jsonb_build_object(
        'universe_run_id', v_universe_run_id,
        'rule_version', 'phase7_v2_baseline_hotfix_diag_v1',
        'symbols_targeted', v_baseline_targeted,
        'symbols_scanned', v_inserted_count,
        'symbols_failed', GREATEST(v_baseline_targeted - v_inserted_count, 0),
        'stage_counts', v_stage_counts,
        'failing_step', CASE WHEN v_inserted_count = 0 THEN 'no_rows_inserted' ELSE NULL END,
        'error_message', CASE WHEN v_inserted_count = 0 THEN 'Scan completed but inserted 0 rows.' ELSE NULL END,
        'sqlstate', NULL
      )
    WHERE r.id = v_scan_run_id;

    RETURN v_scan_run_id;

  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_error_message = MESSAGE_TEXT,
        v_error_sqlstate = RETURNED_SQLSTATE;

      UPDATE public.market_scan_runs r
      SET
        completed_at = now(),
        universe_run_id = COALESCE(r.universe_run_id, v_universe_run_id),
        symbols_targeted = COALESCE(v_baseline_targeted, 0),
        symbols_scanned = COALESCE(v_inserted_count, 0),
        symbols_failed = GREATEST(COALESCE(v_baseline_targeted, 0) - COALESCE(v_inserted_count, 0), 0),
        status = 'failed',
        metadata = COALESCE(r.metadata, '{}'::jsonb) || jsonb_build_object(
          'universe_run_id', v_universe_run_id,
          'rule_version', 'phase7_v2_baseline_hotfix_diag_v1',
          'error_message', v_error_message,
          'sqlstate', v_error_sqlstate,
          'failing_step', v_failing_step,
          'symbols_targeted', COALESCE(v_baseline_targeted, 0),
          'symbols_scanned', COALESCE(v_inserted_count, 0),
          'symbols_failed', GREATEST(COALESCE(v_baseline_targeted, 0) - COALESCE(v_inserted_count, 0), 0),
          'stage_counts', v_stage_counts
        )
      WHERE r.id = v_scan_run_id;

      RAISE;
  END;
END;
$$;

CREATE OR REPLACE VIEW public.market_scan_latest_failure_debug AS
SELECT
  r.id,
  r.started_at,
  r.completed_at,
  r.scan_date,
  r.run_label,
  r.universe_run_id,
  r.status,
  r.symbols_targeted,
  r.symbols_scanned,
  r.symbols_failed,
  r.metadata->>'failing_step' AS failing_step,
  r.metadata->>'error_message' AS error_message,
  r.metadata->>'sqlstate' AS sqlstate,
  COALESCE(r.metadata->'stage_counts', '{}'::jsonb) AS stage_counts,
  r.metadata
FROM public.market_scan_runs r
WHERE r.status = 'failed'
ORDER BY r.started_at DESC
LIMIT 1;

GRANT SELECT ON public.market_scan_latest_failure_debug TO anon, authenticated, service_role;
