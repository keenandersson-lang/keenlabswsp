
-- Fix 1: Add avg_volume_5d and close to run_broad_market_scan payload
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
  -- Get latest universe run
  SELECT id INTO v_universe_run_id
  FROM scanner_universe_runs
  ORDER BY run_at DESC LIMIT 1;

  -- Create scan run
  INSERT INTO market_scan_runs (scan_date, run_label, universe_run_id, status)
  VALUES (p_as_of_date, p_run_label, v_universe_run_id, 'running')
  RETURNING id INTO v_run_id;

  -- Count targeted symbols
  SELECT COUNT(*) INTO v_symbols_targeted
  FROM scanner_universe_snapshot
  WHERE run_id = v_universe_run_id AND is_scanner_eligible = true;

  UPDATE market_scan_runs SET symbols_targeted = v_symbols_targeted WHERE id = v_run_id;

  -- Process each eligible symbol
  FOR v_rec IN
    SELECT sus.symbol, sus.canonical_sector, sus.canonical_industry,
           sus.support_level, sus.classification_confidence_level,
           sus.alignment_eligible
    FROM scanner_universe_snapshot sus
    WHERE sus.run_id = v_universe_run_id AND sus.is_scanner_eligible = true
  LOOP
    BEGIN
      -- Get latest indicators
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

      -- Determine trend state
      IF v_above_ma50 AND v_ma50_slope = 'rising' THEN
        v_trend_state := 'uptrend';
      ELSIF v_above_ma50 THEN
        v_trend_state := 'neutral_above';
      ELSIF NOT v_above_ma50 AND v_ma50_slope = 'falling' THEN
        v_trend_state := 'downtrend';
      ELSE
        v_trend_state := 'neutral_below';
      END IF;

      -- Determine recommendation
      IF v_pattern IN ('climbing') AND v_score >= 70 THEN
        v_recommendation := 'KÖP';
      ELSIF v_pattern IN ('climbing', 'base_or_climbing') AND v_score >= 50 THEN
        v_recommendation := 'BEVAKA';
      ELSIF v_pattern IN ('downhill', 'tired') THEN
        v_recommendation := 'SÄLJ';
      ELSE
        v_recommendation := 'AVVAKTA';
      END IF;

      -- Determine blockers
      v_blockers := ARRAY[]::text[];
      IF v_volume_ratio IS NULL OR v_volume_ratio < 0.5 THEN
        v_blockers := array_append(v_blockers, 'low_volume');
      END IF;
      IF v_score IS NULL OR v_score < 30 THEN
        v_blockers := array_append(v_blockers, 'low_score');
      END IF;

      -- Promotion logic
      v_blocked := array_length(v_blockers, 1) > 0;
      v_approved := NOT v_blocked AND v_recommendation IN ('KÖP', 'BEVAKA');
      v_review := v_recommendation = 'BEVAKA' AND NOT v_blocked;
      v_is_tier1 := v_rec.support_level = 'full_wsp_equity' AND v_approved;

      IF v_approved THEN
        v_promotion := 'approved';
      ELSIF v_blocked THEN
        v_promotion := 'blocked';
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

      -- Insert result
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

  -- Compute stage counts
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

  -- Compute blocker summary
  SELECT jsonb_build_object(
    'low_volume', COUNT(*) FILTER (WHERE 'low_volume' = ANY(blockers)),
    'low_score', COUNT(*) FILTER (WHERE 'low_score' = ANY(blockers))
  ) INTO v_blocker_summary
  FROM market_scan_results WHERE run_id = v_run_id;

  -- Finalize run
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

-- Fix 2: Update bulk_enrich_sectors_from_data to handle 'Stocks' sector and expand SIC mappings
CREATE OR REPLACE FUNCTION public.bulk_enrich_sectors_from_data()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated integer := 0;
  v_rec record;
  v_sector text;
  v_industry text;
BEGIN
  FOR v_rec IN
    SELECT symbol, sic_code, sic_description, industry
    FROM symbols
    WHERE sic_code IS NOT NULL
      AND (canonical_sector IS NULL OR canonical_sector IN ('Unknown', '', 'Stocks'))
  LOOP
    v_sector := NULL;
    v_industry := NULL;

    -- Map SIC code ranges to GICS sectors
    CASE
      WHEN v_rec.sic_code::int BETWEEN 100 AND 999 THEN
        v_sector := 'Materials'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
      WHEN v_rec.sic_code::int BETWEEN 1000 AND 1499 THEN
        v_sector := 'Materials'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
      WHEN v_rec.sic_code::int BETWEEN 1500 AND 1799 THEN
        v_sector := 'Industrials'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
      WHEN v_rec.sic_code::int BETWEEN 2000 AND 3999 THEN
        -- Manufacturing: split into sub-sectors
        CASE
          WHEN v_rec.sic_code::int BETWEEN 2000 AND 2111 THEN
            v_sector := 'Consumer Staples'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          WHEN v_rec.sic_code::int BETWEEN 2800 AND 2899 THEN
            v_sector := 'Healthcare'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          WHEN v_rec.sic_code::int BETWEEN 3500 AND 3599 THEN
            v_sector := 'Industrials'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          WHEN v_rec.sic_code::int BETWEEN 3600 AND 3699 THEN
            v_sector := 'Information Technology'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          WHEN v_rec.sic_code::int BETWEEN 3670 AND 3679 THEN
            v_sector := 'Information Technology'; v_industry := 'Semiconductors';
          WHEN v_rec.sic_code::int BETWEEN 3700 AND 3799 THEN
            v_sector := 'Consumer Discretionary'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          WHEN v_rec.sic_code::int BETWEEN 3800 AND 3899 THEN
            v_sector := 'Healthcare'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          WHEN v_rec.sic_code::int BETWEEN 3900 AND 3999 THEN
            v_sector := 'Consumer Discretionary'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          ELSE
            v_sector := 'Industrials'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
        END CASE;
      WHEN v_rec.sic_code::int BETWEEN 4000 AND 4999 THEN
        CASE
          WHEN v_rec.sic_code::int BETWEEN 4800 AND 4899 THEN
            v_sector := 'Communication Services'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          WHEN v_rec.sic_code::int BETWEEN 4900 AND 4999 THEN
            v_sector := 'Utilities'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          ELSE
            v_sector := 'Industrials'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
        END CASE;
      WHEN v_rec.sic_code::int BETWEEN 5000 AND 5199 THEN
        v_sector := 'Consumer Discretionary'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
      WHEN v_rec.sic_code::int BETWEEN 5200 AND 5999 THEN
        CASE
          WHEN v_rec.sic_code::int BETWEEN 5400 AND 5499 THEN
            v_sector := 'Consumer Staples'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          WHEN v_rec.sic_code::int BETWEEN 5912 AND 5912 THEN
            v_sector := 'Consumer Staples'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          ELSE
            v_sector := 'Consumer Discretionary'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
        END CASE;
      WHEN v_rec.sic_code::int BETWEEN 6000 AND 6799 THEN
        CASE
          WHEN v_rec.sic_code::int BETWEEN 6500 AND 6553 THEN
            v_sector := 'Real Estate'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          ELSE
            v_sector := 'Financials'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
        END CASE;
      WHEN v_rec.sic_code::int BETWEEN 7000 AND 8999 THEN
        CASE
          WHEN v_rec.sic_code::int BETWEEN 7300 AND 7399 THEN
            v_sector := 'Information Technology'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          WHEN v_rec.sic_code::int BETWEEN 7370 AND 7379 THEN
            v_sector := 'Information Technology'; v_industry := 'Software & IT Services';
          WHEN v_rec.sic_code::int BETWEEN 7800 AND 7999 THEN
            v_sector := 'Communication Services'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          WHEN v_rec.sic_code::int BETWEEN 8000 AND 8099 THEN
            v_sector := 'Healthcare'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          WHEN v_rec.sic_code::int BETWEEN 8700 AND 8799 THEN
            v_sector := 'Industrials'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
          ELSE
            v_sector := 'Consumer Discretionary'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
        END CASE;
      WHEN v_rec.sic_code::int BETWEEN 9000 AND 9999 THEN
        v_sector := 'Industrials'; v_industry := COALESCE(v_rec.sic_description, v_rec.industry);
      ELSE
        CONTINUE;
    END CASE;

    IF v_sector IS NOT NULL THEN
      UPDATE symbols SET
        canonical_sector = v_sector,
        canonical_industry = v_industry,
        classification_status = COALESCE(classification_status, 'sic_mapped'),
        classification_confidence_level = CASE
          WHEN classification_confidence_level IS NULL OR classification_confidence_level = '' THEN 'medium'
          ELSE classification_confidence_level
        END,
        updated_at = now()
      WHERE symbol = v_rec.symbol;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  RETURN v_updated;
END;
$function$;
