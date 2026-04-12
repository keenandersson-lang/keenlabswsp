
CREATE OR REPLACE FUNCTION public.run_broad_market_scan(p_as_of_date date, p_run_label text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id bigint;
  v_universe_run_id bigint;
  v_symbols_targeted bigint;
  v_symbols_scanned bigint := 0;
  v_symbols_failed bigint := 0;
  v_failure_reasons jsonb := '{}'::jsonb;
  v_stage_counts jsonb;
  v_blocker_summary jsonb;
  v_rec record;
  v_pattern text;
  v_score int;
  v_recommendation text;
  v_trend_state text;
  v_above_ma50 boolean;
  v_above_ma150 boolean;
  v_ma50_slope text;
  v_volume_ratio numeric;
  v_mansfield_rs numeric;
  v_pct_from_52w_high numeric;
  v_pct_change_1d numeric;
  v_close numeric;
  v_avg_volume_5d bigint;
  v_blockers text[];
  v_approved boolean;
  v_blocked boolean;
  v_review boolean;
  v_promotion text;
  v_confidence text;
  v_alignment_status text;
  v_alignment_reason text;
  v_is_tier1 boolean;
BEGIN
  SELECT id INTO v_universe_run_id
  FROM scanner_universe_runs
  ORDER BY run_at DESC LIMIT 1;

  INSERT INTO market_scan_runs (scan_date, run_label, universe_run_id, status)
  VALUES (p_as_of_date, p_run_label, v_universe_run_id, 'running')
  RETURNING id INTO v_run_id;

  SELECT COUNT(*) INTO v_symbols_targeted
  FROM scanner_universe_snapshot
  WHERE run_id = v_universe_run_id AND is_scanner_eligible = true;

  UPDATE market_scan_runs SET symbols_targeted = v_symbols_targeted WHERE id = v_run_id;

  FOR v_rec IN
    SELECT sus.symbol, sus.canonical_sector, sus.canonical_industry,
           sus.support_level, sus.classification_confidence_level,
           sus.alignment_eligible
    FROM scanner_universe_snapshot sus
    WHERE sus.run_id = v_universe_run_id AND sus.is_scanner_eligible = true
  LOOP
    BEGIN
      SELECT wi.above_ma50, wi.above_ma150, wi.ma50_slope,
             wi.volume_ratio, wi.mansfield_rs, wi.pct_from_52w_high,
             wi.wsp_pattern, wi.wsp_score, wi.pct_change_1d,
             wi.close, wi.avg_volume_5d
      INTO v_above_ma50, v_above_ma150, v_ma50_slope,
           v_volume_ratio, v_mansfield_rs, v_pct_from_52w_high,
           v_pattern, v_score, v_pct_change_1d,
           v_close, v_avg_volume_5d
      FROM wsp_indicators wi
      WHERE wi.symbol = v_rec.symbol
      ORDER BY wi.calc_date DESC LIMIT 1;

      IF v_above_ma50 AND v_ma50_slope = 'rising' THEN
        v_trend_state := 'uptrend';
      ELSIF v_above_ma50 THEN
        v_trend_state := 'neutral_above';
      ELSIF NOT v_above_ma50 AND v_ma50_slope = 'falling' THEN
        v_trend_state := 'downtrend';
      ELSE
        v_trend_state := 'neutral_below';
      END IF;

      IF v_pattern IN ('climbing') AND v_score >= 70 THEN
        v_recommendation := 'KÖP';
      ELSIF v_pattern IN ('climbing', 'base_or_climbing') AND v_score >= 50 THEN
        v_recommendation := 'BEVAKA';
      ELSIF v_pattern IN ('downhill', 'tired') THEN
        v_recommendation := 'SÄLJ';
      ELSE
        v_recommendation := 'AVVAKTA';
      END IF;

      v_blockers := ARRAY[]::text[];
      IF v_volume_ratio IS NULL OR v_volume_ratio < 0.5 THEN
        v_blockers := array_append(v_blockers, 'low_volume');
      END IF;
      IF v_score IS NULL OR v_score < 30 THEN
        v_blockers := array_append(v_blockers, 'low_score');
      END IF;

      v_blocked := array_length(v_blockers, 1) > 0;
      v_approved := NOT v_blocked AND v_recommendation IN ('KÖP', 'BEVAKA');
      v_review := v_recommendation = 'BEVAKA' AND NOT v_blocked;
      v_is_tier1 := v_rec.support_level = 'full_wsp_equity' AND v_approved;

      -- Use constraint-valid promotion_status values
      IF v_is_tier1 THEN
        v_promotion := 'tier1_default';
      ELSIF v_approved THEN
        v_promotion := 'approved_for_live_scanner';
      ELSIF v_review THEN
        v_promotion := 'review_needed';
      ELSIF v_blocked THEN
        v_promotion := 'blocked_low_quality';
      ELSE
        v_promotion := 'broader_candidate';
      END IF;

      v_confidence := v_rec.classification_confidence_level;

      IF v_rec.alignment_eligible THEN
        v_alignment_status := 'aligned';
        v_alignment_reason := 'sector_confirmed';
      ELSE
        v_alignment_status := 'unaligned';
        v_alignment_reason := 'missing_classification';
      END IF;

      INSERT INTO market_scan_results (
        run_id, scan_date, symbol, pattern, score, recommendation,
        sector, industry, trend_state, support_level,
        confidence_level, alignment_status, alignment_reason,
        blockers, approved_for_live_scanner, blocked_low_quality,
        review_needed, promotion_status, is_tier1_default,
        payload
      ) VALUES (
        v_run_id, p_as_of_date, v_rec.symbol, v_pattern, v_score, v_recommendation,
        v_rec.canonical_sector, v_rec.canonical_industry, v_trend_state, v_rec.support_level,
        v_confidence, v_alignment_status, v_alignment_reason,
        v_blockers, v_approved, v_blocked,
        v_review, v_promotion, v_is_tier1,
        jsonb_build_object(
          'above_ma50', v_above_ma50,
          'above_ma150', v_above_ma150,
          'ma50_slope', v_ma50_slope,
          'volume_ratio', v_volume_ratio,
          'mansfield_rs', v_mansfield_rs,
          'pct_from_52w_high', v_pct_from_52w_high,
          'pct_change_1d', v_pct_change_1d,
          'trend_state', v_trend_state,
          'avg_volume_5d', v_avg_volume_5d,
          'close', v_close
        )
      );

      v_symbols_scanned := v_symbols_scanned + 1;

    EXCEPTION WHEN OTHERS THEN
      v_symbols_failed := v_symbols_failed + 1;
      v_failure_reasons := v_failure_reasons || jsonb_build_object(
        v_rec.symbol, jsonb_build_object('error', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;

  SELECT jsonb_build_object(
    'total', COUNT(*),
    'approved', COUNT(*) FILTER (WHERE approved_for_live_scanner),
    'blocked', COUNT(*) FILTER (WHERE blocked_low_quality),
    'review', COUNT(*) FILTER (WHERE review_needed),
    'kop', COUNT(*) FILTER (WHERE recommendation = 'KÖP'),
    'bevaka', COUNT(*) FILTER (WHERE recommendation = 'BEVAKA'),
    'salj', COUNT(*) FILTER (WHERE recommendation = 'SÄLJ'),
    'avvakta', COUNT(*) FILTER (WHERE recommendation = 'AVVAKTA')
  ) INTO v_stage_counts
  FROM market_scan_results WHERE run_id = v_run_id;

  SELECT jsonb_build_object(
    'low_volume', COUNT(*) FILTER (WHERE 'low_volume' = ANY(blockers)),
    'low_score', COUNT(*) FILTER (WHERE 'low_score' = ANY(blockers))
  ) INTO v_blocker_summary
  FROM market_scan_results WHERE run_id = v_run_id;

  UPDATE market_scan_runs SET
    status = 'completed',
    completed_at = now(),
    symbols_scanned = v_symbols_scanned,
    symbols_failed = v_symbols_failed,
    failure_reasons = v_failure_reasons,
    stage_counts = v_stage_counts,
    blocker_summary = v_blocker_summary
  WHERE id = v_run_id;

  RETURN v_run_id;
END;
$function$;
