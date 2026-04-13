
-- 1. Add columns
ALTER TABLE public.market_scan_results
  ADD COLUMN IF NOT EXISTS breakout_status text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS is_base_origin boolean NOT NULL DEFAULT false;

-- 2. Update view FIRST so functions can reference new columns
DROP VIEW IF EXISTS public.market_scan_results_latest;
CREATE VIEW public.market_scan_results_latest AS
SELECT msr.*
FROM public.market_scan_results msr
JOIN (
  SELECT MAX(id) AS max_run_id
  FROM public.market_scan_runs
  WHERE status = 'completed'
) lr ON msr.run_id = lr.max_run_id;

-- 3. Fix get_market_summary — median aggregation
CREATE OR REPLACE FUNCTION public.get_market_summary()
 RETURNS TABLE(sector_name text, symbol_count bigint, avg_pct_today numeric, pct_above_ma50 numeric, wsp_regime text, wsp_setups bigint, avg_wsp_score numeric, top_pattern text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH latest_per_symbol AS (
    SELECT DISTINCT ON (wi.symbol)
      wi.symbol,
      wi.pct_change_1d,
      wi.above_ma50,
      wi.wsp_pattern,
      wi.wsp_score
    FROM public.wsp_indicators wi
    ORDER BY wi.symbol, wi.calc_date DESC
  ),
  joined AS (
    SELECT
      CASE
        WHEN s.canonical_sector = 'Health Care' THEN 'Healthcare'
        WHEN s.canonical_sector = 'Information Technology' THEN 'Technology'
        ELSE s.canonical_sector
      END AS sector_name,
      lps.*
    FROM latest_per_symbol lps
    JOIN public.symbols s ON s.symbol = lps.symbol
    WHERE s.is_active = true
      AND s.canonical_sector IS NOT NULL
      AND s.canonical_sector NOT IN ('Stocks', 'ETF', 'Unknown', 'Market Benchmark', '')
      AND s.canonical_sector IN (
        'Technology','Healthcare','Health Care','Information Technology',
        'Financials','Consumer Discretionary','Consumer Staples','Industrials',
        'Energy','Materials','Utilities','Real Estate','Communication Services'
      )
  )
  SELECT
    j.sector_name,
    COUNT(DISTINCT j.symbol)::bigint AS symbol_count,
    ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY j.pct_change_1d))::numeric, 2) AS avg_pct_today,
    ROUND(AVG(CASE WHEN j.above_ma50 THEN 1.0 ELSE 0.0 END)::numeric * 100, 1) AS pct_above_ma50,
    CASE
      WHEN AVG(CASE WHEN j.above_ma50 THEN 1.0 ELSE 0.0 END) > 0.6 THEN 'Bullish'
      WHEN AVG(CASE WHEN j.above_ma50 THEN 1.0 ELSE 0.0 END) < 0.4 THEN 'Bearish'
      ELSE 'Neutral'
    END AS wsp_regime,
    COUNT(*) FILTER (WHERE j.wsp_pattern = 'climbing' AND j.wsp_score >= 4)::bigint AS wsp_setups,
    ROUND(AVG(j.wsp_score)::numeric, 1) AS avg_wsp_score,
    MODE() WITHIN GROUP (ORDER BY j.wsp_pattern) AS top_pattern
  FROM joined j
  GROUP BY j.sector_name
  ORDER BY (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY j.pct_change_1d))::numeric DESC NULLS LAST;
$function$;

-- 4. Fix get_equity_screener_rows — add blockers + breakout_status
DROP FUNCTION IF EXISTS public.get_equity_screener_rows(integer, integer, text, text, text, text);

CREATE OR REPLACE FUNCTION public.get_equity_screener_rows(
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50,
  p_universe_tier text DEFAULT NULL,
  p_sector text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_pattern text DEFAULT NULL
)
 RETURNS TABLE(symbol text, sector text, industry text, pattern_state text, recommendation text, wsp_score integer, payload jsonb, blockers text[], breakout_status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH ranked AS (
    SELECT
      msr.symbol,
      CASE msr.sector
        WHEN 'Information Technology' THEN 'Technology'
        WHEN 'Health Care' THEN 'Healthcare'
        ELSE msr.sector
      END AS norm_sector,
      COALESCE(public.display_industry(msr.industry), msr.industry) AS norm_industry,
      msr.pattern AS pattern_state,
      msr.recommendation,
      msr.score AS wsp_score,
      msr.payload,
      msr.blockers,
      msr.breakout_status,
      (CASE WHEN (msr.payload->>'mansfield_rs') IS NOT NULL THEN 15 ELSE 0 END
       + CASE WHEN msr.industry IS NOT NULL AND msr.industry NOT IN ('Unknown','Stocks','') THEN 10 ELSE 0 END
       + CASE WHEN (msr.payload->>'resistance_level') IS NOT NULL THEN 5 ELSE 0 END
       + CASE
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 5000000 THEN 25
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 1000000 THEN 20
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 500000  THEN 15
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 100000  THEN 10
          ELSE 0 END
       + CASE
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 20 THEN 20
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 10 THEN 15
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 5  THEN 10
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 0  THEN 5
          ELSE 0 END
       + CASE
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -2  THEN 15
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -5  THEN 12
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -10 THEN 8
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -20 THEN 4
          ELSE 0 END
       + CASE
          WHEN (msr.payload->>'volume_ratio')::numeric >= 2.0 THEN 10
          WHEN (msr.payload->>'volume_ratio')::numeric >= 1.5 THEN 7
          WHEN (msr.payload->>'volume_ratio')::numeric >= 1.0 THEN 4
          ELSE 0 END)
      AS trust_rank
    FROM public.market_scan_results_latest msr
    JOIN public.symbols s ON s.symbol = msr.symbol
    WHERE msr.symbol IS NOT NULL
      AND (p_universe_tier IS NULL OR s.universe_tier = p_universe_tier)
  )
  SELECT r.symbol, r.norm_sector AS sector, r.norm_industry AS industry,
         r.pattern_state, r.recommendation, r.wsp_score, r.payload,
         r.blockers, r.breakout_status
  FROM ranked r
  WHERE (p_sector IS NULL OR r.norm_sector = p_sector)
    AND (p_industry IS NULL OR r.norm_industry = p_industry)
    AND (p_pattern IS NULL OR r.pattern_state = p_pattern)
  ORDER BY
    CASE WHEN r.norm_sector IN (
      'Communication Services','Consumer Discretionary','Consumer Staples',
      'Energy','Financials','Healthcare','Industrials','Materials',
      'Real Estate','Technology','Utilities'
    ) THEN 0 ELSE 1 END,
    CASE r.recommendation
      WHEN 'KÖP' THEN 0 WHEN 'BEVAKA' THEN 1 WHEN 'AVVAKTA' THEN 2 WHEN 'SÄLJ' THEN 3 ELSE 4 END,
    CASE r.pattern_state
      WHEN 'climbing' THEN 0 WHEN 'base' THEN 1 WHEN 'tired' THEN 2 WHEN 'downhill' THEN 3 ELSE 4 END,
    r.trust_rank DESC,
    r.wsp_score DESC NULLS LAST,
    r.symbol ASC
  LIMIT p_page_size
  OFFSET p_page * p_page_size;
$function$;

-- 5. Update run_broad_market_scan with breakout_status + decoupled entry
CREATE OR REPLACE FUNCTION public.run_broad_market_scan(p_as_of_date date, p_run_label text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET statement_timeout TO '900s'
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
  v_resistance_level numeric;
  v_blockers text[];
  v_approved boolean;
  v_blocked boolean;
  v_review boolean;
  v_promotion text;
  v_confidence text;
  v_alignment_status text;
  v_alignment_reason text;
  v_is_tier1 boolean;
  v_clean_industry text;
  v_breakout_detected boolean;
  v_breakout_status text;
  v_is_base_origin boolean;
  v_breakout_age int;
BEGIN
  SELECT id INTO v_universe_run_id
  FROM scanner_universe_runs ORDER BY run_at DESC LIMIT 1;

  INSERT INTO market_scan_runs (scan_date, run_label, universe_run_id, status)
  VALUES (p_as_of_date, p_run_label, v_universe_run_id, 'running')
  RETURNING id INTO v_run_id;

  SELECT COUNT(*) INTO v_symbols_targeted
  FROM scanner_universe_snapshot
  WHERE run_id = v_universe_run_id AND baseline_eligible = true;

  UPDATE market_scan_runs SET symbols_targeted = v_symbols_targeted WHERE id = v_run_id;

  FOR v_rec IN
    SELECT sus.symbol, sus.canonical_sector, sus.canonical_industry,
           sus.support_level, sus.classification_confidence_level,
           sus.alignment_eligible
    FROM scanner_universe_snapshot sus
    WHERE sus.run_id = v_universe_run_id AND baseline_eligible = true
  LOOP
    BEGIN
      SELECT wi.above_ma50, wi.above_ma150, wi.ma50_slope,
             wi.volume_ratio, wi.mansfield_rs, wi.pct_from_52w_high,
             wi.wsp_pattern, wi.wsp_score, wi.pct_change_1d,
             wi.close, wi.avg_volume_5d, wi.resistance_level
      INTO v_above_ma50, v_above_ma150, v_ma50_slope,
           v_volume_ratio, v_mansfield_rs, v_pct_from_52w_high,
           v_pattern, v_score, v_pct_change_1d,
           v_close, v_avg_volume_5d, v_resistance_level
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

      v_breakout_detected := false;
      v_breakout_status := 'NONE';
      v_is_base_origin := false;

      IF v_resistance_level IS NOT NULL AND v_resistance_level > 0 THEN
        IF v_close > v_resistance_level * 1.02 THEN
          SELECT COUNT(*) INTO v_breakout_age
          FROM (
            SELECT calc_date, close
            FROM wsp_indicators
            WHERE symbol = v_rec.symbol
            ORDER BY calc_date DESC
            LIMIT 20
          ) sub
          WHERE sub.close > v_resistance_level * 1.02;

          IF v_breakout_age <= 3 THEN
            v_breakout_status := 'FRESH_BREAKOUT';
          ELSIF v_breakout_age <= 7 THEN
            v_breakout_status := 'AGING_BREAKOUT';
          ELSE
            v_breakout_status := 'STALE_BREAKOUT';
          END IF;

          IF COALESCE(v_volume_ratio, 0) >= 2.0 THEN
            v_breakout_detected := true;
          END IF;

          IF v_pattern = 'base' THEN
            v_is_base_origin := true;
          END IF;

        ELSIF v_close > v_resistance_level * 0.95 AND v_close <= v_resistance_level * 1.02 THEN
          v_breakout_status := 'APPROACHING';
          IF v_pattern = 'base' THEN
            v_is_base_origin := true;
          END IF;
        END IF;
      END IF;

      IF v_above_ma150 IS NOT NULL AND NOT v_above_ma150 THEN
        v_recommendation := 'SÄLJ';
      ELSIF v_pattern IN ('climbing', 'base')
            AND v_score = 5
            AND v_breakout_detected
            AND v_breakout_status IN ('FRESH_BREAKOUT', 'AGING_BREAKOUT')
      THEN
        v_recommendation := 'KÖP';
      ELSIF v_pattern = 'tired' THEN
        v_recommendation := 'SÄLJ';
      ELSIF v_pattern = 'downhill' THEN
        v_recommendation := 'UNDVIK';
      ELSIF NOT COALESCE(v_above_ma50, false) AND v_ma50_slope = 'falling' THEN
        v_recommendation := 'UNDVIK';
      ELSIF v_pattern IN ('climbing', 'base') AND v_score >= 3 THEN
        v_recommendation := 'BEVAKA';
      ELSE
        v_recommendation := 'UNDVIK';
      END IF;

      v_blockers := ARRAY[]::text[];
      IF v_volume_ratio IS NULL OR v_volume_ratio < 2.0 THEN
        v_blockers := array_append(v_blockers, 'volume_not_confirmed');
      END IF;
      IF v_ma50_slope IS NULL OR v_ma50_slope != 'rising' THEN
        v_blockers := array_append(v_blockers, 'ma50_slope_not_rising');
      END IF;
      IF NOT COALESCE(v_above_ma50, false) THEN
        v_blockers := array_append(v_blockers, 'below_ma50');
      END IF;
      IF v_above_ma150 IS NOT NULL AND NOT v_above_ma150 THEN
        v_blockers := array_append(v_blockers, 'below_ma150');
      END IF;
      IF COALESCE(v_mansfield_rs, 0) <= 0 THEN
        v_blockers := array_append(v_blockers, 'mansfield_negative');
      END IF;
      IF v_resistance_level IS NOT NULL AND v_resistance_level > 0 AND v_close <= v_resistance_level * 1.02 THEN
        v_blockers := array_append(v_blockers, 'no_breakout');
      END IF;
      IF v_breakout_status = 'STALE_BREAKOUT' THEN
        v_blockers := array_append(v_blockers, 'stale_breakout');
      END IF;

      v_blocked := array_length(v_blockers, 1) > 0;
      v_approved := NOT v_blocked AND v_recommendation IN ('KÖP', 'BEVAKA');
      v_review := v_recommendation = 'BEVAKA' AND v_blocked;
      v_is_tier1 := v_rec.support_level = 'full_wsp_equity' AND v_approved;

      IF v_is_tier1 THEN v_promotion := 'tier1_default';
      ELSIF v_approved THEN v_promotion := 'approved_for_live_scanner';
      ELSIF v_review THEN v_promotion := 'review_needed';
      ELSIF v_blocked AND v_recommendation IN ('SÄLJ', 'UNDVIK') THEN v_promotion := 'blocked_low_quality';
      ELSE v_promotion := 'broader_candidate';
      END IF;

      v_confidence := v_rec.classification_confidence_level;

      IF v_rec.alignment_eligible THEN
        v_alignment_status := 'aligned'; v_alignment_reason := 'sector_confirmed';
      ELSE
        v_alignment_status := 'unaligned'; v_alignment_reason := 'missing_classification';
      END IF;

      v_clean_industry := v_rec.canonical_industry;
      IF v_clean_industry IS NOT NULL AND (
        length(v_clean_industry) > 50
        OR v_clean_industry ~ '\('
        OR (v_clean_industry = upper(v_clean_industry) AND v_clean_industry ~ ' ')
      ) THEN
        v_clean_industry := NULL;
      END IF;

      INSERT INTO market_scan_results (
        run_id, scan_date, symbol, pattern, score, recommendation,
        sector, industry, trend_state, support_level,
        confidence_level, alignment_status, alignment_reason,
        blockers, approved_for_live_scanner, blocked_low_quality,
        review_needed, promotion_status, is_tier1_default,
        breakout_status, is_base_origin, payload
      ) VALUES (
        v_run_id, p_as_of_date, v_rec.symbol, v_pattern, v_score, v_recommendation,
        v_rec.canonical_sector, v_clean_industry, v_trend_state, v_rec.support_level,
        v_confidence, v_alignment_status, v_alignment_reason,
        v_blockers, v_approved, v_blocked,
        v_review, v_promotion, v_is_tier1,
        v_breakout_status, v_is_base_origin,
        jsonb_build_object(
          'above_ma50', v_above_ma50, 'above_ma150', v_above_ma150,
          'ma50_slope', v_ma50_slope, 'volume_ratio', v_volume_ratio,
          'mansfield_rs', v_mansfield_rs, 'pct_from_52w_high', v_pct_from_52w_high,
          'pct_change_1d', v_pct_change_1d, 'trend_state', v_trend_state,
          'avg_volume_5d', v_avg_volume_5d, 'close', v_close,
          'resistance_level', v_resistance_level, 'breakout_detected', v_breakout_detected,
          'breakout_status', v_breakout_status, 'is_base_origin', v_is_base_origin
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
    'undvik', COUNT(*) FILTER (WHERE recommendation = 'UNDVIK')
  ) INTO v_stage_counts
  FROM market_scan_results WHERE run_id = v_run_id;

  SELECT jsonb_build_object(
    'volume_not_confirmed', COUNT(*) FILTER (WHERE 'volume_not_confirmed' = ANY(blockers)),
    'ma50_slope_not_rising', COUNT(*) FILTER (WHERE 'ma50_slope_not_rising' = ANY(blockers)),
    'below_ma50', COUNT(*) FILTER (WHERE 'below_ma50' = ANY(blockers)),
    'below_ma150', COUNT(*) FILTER (WHERE 'below_ma150' = ANY(blockers)),
    'mansfield_negative', COUNT(*) FILTER (WHERE 'mansfield_negative' = ANY(blockers)),
    'no_breakout', COUNT(*) FILTER (WHERE 'no_breakout' = ANY(blockers)),
    'stale_breakout', COUNT(*) FILTER (WHERE 'stale_breakout' = ANY(blockers))
  ) INTO v_blocker_summary
  FROM market_scan_results WHERE run_id = v_run_id;

  UPDATE market_scan_runs SET
    status = 'completed', completed_at = now(),
    symbols_scanned = v_symbols_scanned, symbols_failed = v_symbols_failed,
    failure_reasons = v_failure_reasons, stage_counts = v_stage_counts,
    blocker_summary = v_blocker_summary
  WHERE id = v_run_id;

  RETURN v_run_id;
END;
$function$;
