CREATE OR REPLACE FUNCTION public.run_broad_market_scan(p_as_of_date date, p_run_label text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_universe_run_id bigint;
  v_scan_run_id bigint;
BEGIN
  v_universe_run_id := public.refresh_scanner_universe_snapshot(p_as_of_date, CONCAT('universe_', p_run_label));

  INSERT INTO public.market_scan_runs (scan_date, run_label, universe_run_id, status)
  VALUES (p_as_of_date, p_run_label, v_universe_run_id, 'running')
  RETURNING id INTO v_scan_run_id;

  WITH latest_wsp AS (
    SELECT DISTINCT ON (wi.symbol)
      wi.symbol, wi.calc_date, wi.wsp_pattern, wi.wsp_score,
      wi.ma50, wi.ma150, wi.ma50_slope, wi.above_ma50, wi.above_ma150,
      wi.volume_ratio, wi.mansfield_rs, wi.pct_change_1d
    FROM public.wsp_indicators wi
    ORDER BY wi.symbol, wi.calc_date DESC
  ),
  universe AS (
    SELECT * FROM public.scanner_universe_snapshot
    WHERE run_id = v_universe_run_id AND baseline_eligible = true
  ),
  scan_payload AS (
    SELECT
      u.symbol, u.support_level, u.canonical_sector, u.canonical_industry,
      u.classification_confidence_level,
      COALESCE(sia.alignment_status, 'unresolved') AS alignment_status,
      COALESCE(sia.alignment_reason, 'alignment_unresolved') AS alignment_reason,
      l.wsp_pattern, l.wsp_score, l.ma50, l.ma150, l.ma50_slope,
      l.above_ma50, l.above_ma150, l.volume_ratio, l.mansfield_rs, l.pct_change_1d,
      COALESCE(s.eligible_for_full_wsp, false) AS eligible_for_full_wsp
    FROM universe u
    JOIN latest_wsp l ON l.symbol = u.symbol
    JOIN public.symbols s ON s.symbol = u.symbol
    LEFT JOIN public.symbol_industry_alignment_active sia ON sia.symbol = u.symbol
  )
  INSERT INTO public.market_scan_results (
    run_id, symbol, scan_date, scan_timestamp,
    support_level, pattern, recommendation, blockers,
    score, trend_state, sector, industry,
    alignment_status, alignment_reason, confidence_level,
    promotion_status, approved_for_live_scanner,
    review_needed, blocked_low_quality, is_tier1_default, payload
  )
  SELECT
    v_scan_run_id, p.symbol, p_as_of_date, now(), p.support_level,
    p.wsp_pattern,
    -- Recommendation: full WSP rules for KÖP
    CASE
      WHEN p.wsp_pattern = 'climbing'
           AND COALESCE(p.above_ma50, false) = true
           AND p.ma50_slope = 'rising'
           AND COALESCE(p.above_ma150, false) = true
           AND COALESCE(p.volume_ratio, 0) >= 2.0
           AND COALESCE(p.mansfield_rs, 0) > 0
        THEN 'KÖP'
      WHEN p.wsp_pattern IN ('climbing', 'base_or_climbing', 'base')
        THEN 'BEVAKA'
      WHEN p.wsp_pattern = 'tired' OR (NOT COALESCE(p.above_ma150, false))
        THEN 'SÄLJ'
      WHEN p.wsp_pattern = 'downhill'
        THEN 'UNDVIK'
      ELSE 'NEUTRAL'
    END,
    -- Blockers: volume threshold 2.0x, slope uses 'rising'
    array_remove(ARRAY[
      CASE WHEN COALESCE(p.above_ma50, false) = false THEN 'below_ma50' END,
      CASE WHEN COALESCE(p.above_ma150, false) = false THEN 'below_ma150' END,
      CASE WHEN p.ma50_slope NOT IN ('rising') THEN 'slope_50_not_positive' END,
      CASE WHEN COALESCE(p.volume_ratio, 0) < 2.0 THEN 'volume_not_confirmed' END,
      CASE WHEN COALESCE(p.mansfield_rs, 0) <= 0 THEN 'mansfield_not_valid' END
    ], NULL)::text[],
    COALESCE(p.wsp_score, 0),
    -- Trend state: uses 'rising' consistently
    CASE
      WHEN COALESCE(p.above_ma50, false) AND COALESCE(p.above_ma150, false)
           AND p.ma50_slope = 'rising' THEN 'bullish'
      WHEN COALESCE(p.above_ma150, false) = false THEN 'bearish'
      ELSE 'neutral'
    END,
    p.canonical_sector, p.canonical_industry,
    p.alignment_status, p.alignment_reason, p.classification_confidence_level,
    -- Promotion status
    CASE
      WHEN p.support_level = 'full_wsp_equity' AND p.eligible_for_full_wsp THEN 'tier1_default'
      WHEN p.classification_confidence_level = 'low' THEN 'blocked_low_quality'
      WHEN p.wsp_pattern = 'climbing' AND COALESCE(p.wsp_score, 0) >= 5
           AND p.classification_confidence_level IN ('high', 'medium') THEN 'approved_for_live_scanner'
      WHEN p.wsp_pattern IN ('climbing', 'base_or_climbing') THEN 'review_needed'
      ELSE 'broader_candidate'
    END,
    -- approved_for_live_scanner
    CASE
      WHEN p.support_level = 'full_wsp_equity' AND p.eligible_for_full_wsp THEN true
      WHEN p.wsp_pattern = 'climbing' AND COALESCE(p.wsp_score, 0) >= 5
           AND p.classification_confidence_level IN ('high', 'medium') THEN true
      ELSE false
    END,
    -- review_needed
    CASE WHEN p.wsp_pattern IN ('climbing', 'base_or_climbing') AND COALESCE(p.wsp_score, 0) BETWEEN 3 AND 4 THEN true ELSE false END,
    -- blocked_low_quality
    CASE WHEN p.classification_confidence_level = 'low' THEN true ELSE false END,
    -- is_tier1_default
    CASE WHEN p.support_level = 'full_wsp_equity' AND p.eligible_for_full_wsp THEN true ELSE false END,
    jsonb_build_object(
      'wsp_pattern',   p.wsp_pattern,
      'wsp_score',     COALESCE(p.wsp_score, 0),
      'ma50',          p.ma50,
      'ma150',         p.ma150,
      'ma50_slope',    p.ma50_slope,
      'above_ma50',    COALESCE(p.above_ma50, false),
      'above_ma150',   COALESCE(p.above_ma150, false),
      'volume_ratio',  p.volume_ratio,
      'mansfield_rs',  p.mansfield_rs,
      'pct_change_1d', p.pct_change_1d
    )
  FROM scan_payload p;

  UPDATE public.market_scan_runs r
  SET
    completed_at = now(),
    symbols_targeted = (SELECT COUNT(*) FROM public.scanner_universe_snapshot WHERE run_id = v_universe_run_id AND baseline_eligible = true),
    symbols_scanned = (SELECT COUNT(*) FROM public.market_scan_results WHERE run_id = v_scan_run_id),
    symbols_failed = GREATEST(
      (SELECT COUNT(*) FROM public.scanner_universe_snapshot WHERE run_id = v_universe_run_id AND baseline_eligible = true)
      - (SELECT COUNT(*) FROM public.market_scan_results WHERE run_id = v_scan_run_id), 0),
    status = CASE
      WHEN (SELECT COUNT(*) FROM public.market_scan_results WHERE run_id = v_scan_run_id) = 0 THEN 'failed'
      WHEN (SELECT COUNT(*) FROM public.market_scan_results WHERE run_id = v_scan_run_id)
         < (SELECT COUNT(*) FROM public.scanner_universe_snapshot WHERE run_id = v_universe_run_id AND baseline_eligible = true)
        THEN 'partial'
      ELSE 'completed'
    END,
    metadata = jsonb_build_object('universe_run_id', v_universe_run_id, 'rule_version', 'phase9_unified_v2')
  WHERE r.id = v_scan_run_id;

  RETURN v_scan_run_id;
END;
$function$;