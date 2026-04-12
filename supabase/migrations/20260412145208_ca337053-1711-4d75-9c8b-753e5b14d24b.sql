
-- Must drop first due to return type conflict
DROP FUNCTION IF EXISTS public.materialize_wsp_indicators_from_prices(date, integer, text[]);

-- ============================================================
-- FIX 1: materialize_wsp_indicators_from_prices
-- ============================================================
CREATE FUNCTION public.materialize_wsp_indicators_from_prices(
  p_as_of_date date DEFAULT CURRENT_DATE,
  p_min_bars integer DEFAULT 50,
  p_symbols text[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_candidates bigint := 0;
  v_computed_rows bigint := 0;
  v_written_rows bigint := 0;
BEGIN
  WITH target_symbols AS (
    SELECT s.symbol
    FROM public.symbols s
    WHERE s.is_active = true
      AND (p_symbols IS NULL OR s.symbol = ANY(p_symbols))
  ),
  source_prices AS (
    SELECT
      dp.symbol, dp.date,
      dp.close::numeric AS close,
      dp.volume::bigint AS volume,
      AVG(dp.close::numeric) OVER (PARTITION BY dp.symbol ORDER BY dp.date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS ma50,
      CASE WHEN COUNT(*) OVER (PARTITION BY dp.symbol ORDER BY dp.date ROWS BETWEEN 149 PRECEDING AND CURRENT ROW) >= 150
        THEN AVG(dp.close::numeric) OVER (PARTITION BY dp.symbol ORDER BY dp.date ROWS BETWEEN 149 PRECEDING AND CURRENT ROW)
        ELSE NULL END AS ma150,
      CASE WHEN COUNT(*) OVER (PARTITION BY dp.symbol ORDER BY dp.date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) >= 200
        THEN AVG(dp.close::numeric) OVER (PARTITION BY dp.symbol ORDER BY dp.date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW)
        ELSE NULL END AS sma200,
      LAG(dp.close::numeric) OVER (PARTITION BY dp.symbol ORDER BY dp.date) AS prev_close,
      AVG(dp.volume::numeric) OVER (PARTITION BY dp.symbol ORDER BY dp.date ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS avg_volume_5d,
      MAX(dp.close::numeric) OVER (PARTITION BY dp.symbol ORDER BY dp.date ROWS BETWEEN 251 PRECEDING AND CURRENT ROW) AS high_52w,
      COUNT(*) OVER (PARTITION BY dp.symbol ORDER BY dp.date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::integer AS bars_to_date
    FROM public.daily_prices dp
    JOIN target_symbols ts ON ts.symbol = dp.symbol
    WHERE dp.date <= p_as_of_date
  ),
  with_slope AS (
    SELECT sp.*,
      LAG(sp.ma50, 5) OVER (PARTITION BY sp.symbol ORDER BY sp.date) AS ma50_5d_ago,
      ROW_NUMBER() OVER (PARTITION BY sp.symbol ORDER BY sp.date DESC) AS rn
    FROM source_prices sp
  ),
  spy_ref AS (
    SELECT ws.date, ws.close AS spy_close, ws.sma200 AS spy_sma200
    FROM with_slope ws WHERE ws.symbol = 'SPY'
  ),
  sector_etf_ref AS (
    SELECT ws.date, ws.symbol AS etf_symbol, ws.close AS etf_close, ws.sma200 AS etf_sma200
    FROM with_slope ws
    WHERE ws.symbol IN ('XLK','XLF','XLV','XLE','XLY','XLI','XLC','XLP','XLB','XLRE','XLU')
  ),
  symbol_sector_map AS (
    SELECT s.symbol,
      CASE s.canonical_sector
        WHEN 'Technology' THEN 'XLK'
        WHEN 'Financials' THEN 'XLF'
        WHEN 'Healthcare' THEN 'XLV'
        WHEN 'Energy' THEN 'XLE'
        WHEN 'Consumer Discretionary' THEN 'XLY'
        WHEN 'Industrials' THEN 'XLI'
        WHEN 'Communication Services' THEN 'XLC'
        WHEN 'Consumer Staples' THEN 'XLP'
        WHEN 'Materials' THEN 'XLB'
        WHEN 'Real Estate' THEN 'XLRE'
        WHEN 'Utilities' THEN 'XLU'
        ELSE NULL
      END AS sector_etf
    FROM public.symbols s
    WHERE s.universe_tier = 'core'
  ),
  final_rows AS (
    SELECT
      ws.symbol, ws.date AS calc_date, ws.close, ws.ma50, ws.ma150,
      CASE
        WHEN ws.ma50_5d_ago IS NULL OR ws.ma50 IS NULL THEN 'flat'
        WHEN ws.ma50 > ws.ma50_5d_ago THEN 'rising'
        WHEN ws.ma50 < ws.ma50_5d_ago THEN 'falling'
        ELSE 'flat'
      END AS ma50_slope,
      (ws.close > ws.ma50) AS above_ma50,
      (CASE WHEN ws.ma150 IS NOT NULL THEN ws.close > ws.ma150 ELSE NULL END) AS above_ma150,
      ws.volume,
      ROUND(ws.avg_volume_5d)::bigint AS avg_volume_5d,
      CASE WHEN ws.avg_volume_5d > 0 THEN ROUND(ws.volume::numeric / ws.avg_volume_5d, 2) ELSE NULL END AS volume_ratio,
      CASE WHEN ws.prev_close > 0 THEN ROUND(((ws.close / ws.prev_close) - 1) * 100.0, 2) ELSE NULL END AS pct_change_1d,
      CASE WHEN ws.high_52w > 0 THEN ROUND(((ws.close / ws.high_52w) - 1) * 100.0, 2) ELSE NULL END AS pct_from_52w_high,
      CASE
        WHEN ws.sma200 IS NOT NULL AND ws.sma200 > 0 AND sr.spy_sma200 IS NOT NULL AND sr.spy_sma200 > 0
        THEN ROUND((((ws.close / ws.sma200) / (sr.spy_close / sr.spy_sma200)) - 1) * 100.0, 2)
        ELSE NULL
      END AS mansfield_rs,
      CASE
        WHEN ws.sma200 IS NOT NULL AND ws.sma200 > 0
          AND ser.etf_sma200 IS NOT NULL AND ser.etf_sma200 > 0
        THEN ROUND((((ws.close / ws.sma200) / (ser.etf_close / ser.etf_sma200)) - 1) * 100.0, 2)
        ELSE NULL
      END AS mansfield_rs_sector
    FROM with_slope ws
    LEFT JOIN spy_ref sr ON sr.date = ws.date
    LEFT JOIN symbol_sector_map ssm ON ssm.symbol = ws.symbol
    LEFT JOIN sector_etf_ref ser ON ser.date = ws.date AND ser.etf_symbol = ssm.sector_etf
    WHERE ws.rn = 1
      AND ws.bars_to_date >= p_min_bars
      AND ws.ma50 IS NOT NULL
      AND ws.prev_close IS NOT NULL
      AND ws.avg_volume_5d IS NOT NULL
  ),
  with_pattern AS (
    SELECT fr.*,
      CASE
        WHEN fr.ma150 IS NOT NULL AND fr.close > fr.ma50 AND fr.ma50 > fr.ma150 AND fr.ma50_slope = 'rising'
        THEN 'climbing'
        WHEN fr.ma150 IS NOT NULL AND fr.close < fr.ma50 AND fr.close < fr.ma150 AND fr.ma50_slope = 'falling'
        THEN 'downhill'
        WHEN fr.ma150 IS NOT NULL AND fr.close > fr.ma150 AND (fr.ma50_slope = 'falling' OR fr.close < fr.ma50)
        THEN 'tired'
        WHEN fr.close > fr.ma50 THEN 'base'
        WHEN fr.ma150 IS NOT NULL AND fr.close > fr.ma150 THEN 'base'
        ELSE 'tired'
      END AS wsp_pattern,
      (
        (CASE WHEN fr.close > fr.ma50 THEN 1 ELSE 0 END) +
        (CASE WHEN fr.ma150 IS NOT NULL AND fr.close > fr.ma150 THEN 1 ELSE 0 END) +
        (CASE WHEN fr.ma50_slope = 'rising' THEN 1 ELSE 0 END) +
        (CASE WHEN COALESCE(fr.volume_ratio, 0) >= 2.0 THEN 1 ELSE 0 END) +
        (CASE WHEN COALESCE(fr.mansfield_rs, 0) > 0 THEN 1 ELSE 0 END)
      )::integer AS wsp_score
    FROM final_rows fr
  ),
  counted AS (SELECT COUNT(*)::bigint AS cnt FROM target_symbols),
  upserted AS (
    INSERT INTO public.wsp_indicators (
      symbol, calc_date, close, ma50, ma150, ma50_slope,
      above_ma50, above_ma150, volume, avg_volume_5d,
      volume_ratio, wsp_pattern, wsp_score,
      pct_change_1d, pct_from_52w_high, mansfield_rs, mansfield_rs_sector, created_at
    )
    SELECT
      wp.symbol, wp.calc_date, wp.close, wp.ma50, wp.ma150, wp.ma50_slope,
      wp.above_ma50, wp.above_ma150, wp.volume, wp.avg_volume_5d,
      wp.volume_ratio, wp.wsp_pattern, wp.wsp_score,
      wp.pct_change_1d, wp.pct_from_52w_high, wp.mansfield_rs, wp.mansfield_rs_sector, now()
    FROM with_pattern wp
    ON CONFLICT (symbol, calc_date)
    DO UPDATE SET
      close = EXCLUDED.close, ma50 = EXCLUDED.ma50, ma150 = EXCLUDED.ma150,
      ma50_slope = EXCLUDED.ma50_slope, above_ma50 = EXCLUDED.above_ma50,
      above_ma150 = EXCLUDED.above_ma150, volume = EXCLUDED.volume,
      avg_volume_5d = EXCLUDED.avg_volume_5d, volume_ratio = EXCLUDED.volume_ratio,
      wsp_pattern = EXCLUDED.wsp_pattern, wsp_score = EXCLUDED.wsp_score,
      pct_change_1d = EXCLUDED.pct_change_1d, pct_from_52w_high = EXCLUDED.pct_from_52w_high,
      mansfield_rs = EXCLUDED.mansfield_rs, mansfield_rs_sector = EXCLUDED.mansfield_rs_sector,
      created_at = now()
    RETURNING 1
  )
  SELECT counted.cnt, (SELECT COUNT(*)::bigint FROM with_pattern), (SELECT COUNT(*)::bigint FROM upserted)
  INTO v_total_candidates, v_computed_rows, v_written_rows
  FROM counted;

  RETURN jsonb_build_object(
    'ok', true,
    'total_candidates', v_total_candidates,
    'computed_rows', v_computed_rows,
    'written_rows', v_written_rows
  );
END;
$$;

-- ============================================================
-- FIX 2: run_broad_market_scan
-- ============================================================
CREATE OR REPLACE FUNCTION public.run_broad_market_scan(
  p_as_of_date date,
  p_run_label text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_clean_industry text;
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

      -- RECOMMENDATION (WSP Engine Contract v1, 0-5 scale)
      IF v_above_ma150 IS NOT NULL AND NOT v_above_ma150 THEN
        v_recommendation := 'SÄLJ';
      ELSIF v_pattern = 'climbing' AND v_score = 5 THEN
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

      -- BLOCKERS (specific)
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

      -- INDUSTRY CLEANUP
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
        review_needed, promotion_status, is_tier1_default, payload
      ) VALUES (
        v_run_id, p_as_of_date, v_rec.symbol, v_pattern, v_score, v_recommendation,
        v_rec.canonical_sector, v_clean_industry, v_trend_state, v_rec.support_level,
        v_confidence, v_alignment_status, v_alignment_reason,
        v_blockers, v_approved, v_blocked,
        v_review, v_promotion, v_is_tier1,
        jsonb_build_object(
          'above_ma50', v_above_ma50, 'above_ma150', v_above_ma150,
          'ma50_slope', v_ma50_slope, 'volume_ratio', v_volume_ratio,
          'mansfield_rs', v_mansfield_rs, 'pct_from_52w_high', v_pct_from_52w_high,
          'pct_change_1d', v_pct_change_1d, 'trend_state', v_trend_state,
          'avg_volume_5d', v_avg_volume_5d, 'close', v_close
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
    'mansfield_negative', COUNT(*) FILTER (WHERE 'mansfield_negative' = ANY(blockers))
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
$$;
