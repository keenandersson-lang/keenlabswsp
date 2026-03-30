
-- 1. Restrict market_scan_results: remove anon access, keep authenticated
DROP POLICY IF EXISTS "Anyone can read market scan results" ON public.market_scan_results;
CREATE POLICY "Authenticated can read market scan results"
  ON public.market_scan_results FOR SELECT TO authenticated
  USING (true);

-- 2. Restrict wsp_indicators: remove anon access, keep authenticated
DROP POLICY IF EXISTS "Anyone can read wsp indicators" ON public.wsp_indicators;
CREATE POLICY "Authenticated can read wsp indicators"
  ON public.wsp_indicators FOR SELECT TO authenticated
  USING (true);

-- 3. Restrict scanner_universe_snapshot: remove anon access, keep authenticated
DROP POLICY IF EXISTS "Anyone can read scanner universe snapshot" ON public.scanner_universe_snapshot;
CREATE POLICY "Authenticated can read scanner universe snapshot"
  ON public.scanner_universe_snapshot FOR SELECT TO authenticated
  USING (true);

-- 4. Restrict market_scan_runs: remove authenticated broad access, use safe view
DROP POLICY IF EXISTS "Authenticated can read market scan runs" ON public.market_scan_runs;

-- 5. Recreate views with security_invoker = on
DROP VIEW IF EXISTS public.market_scan_results_latest CASCADE;
CREATE VIEW public.market_scan_results_latest
WITH (security_invoker = on) AS
  SELECT DISTINCT ON (symbol) symbol,
    recommendation, scan_date, scan_timestamp, score,
    approved_for_live_scanner, review_needed, blocked_low_quality,
    is_tier1_default, payload, run_id, blockers, promotion_status,
    trend_state, sector, industry, alignment_status, alignment_reason,
    confidence_level, support_level, pattern
  FROM public.market_scan_results msr
  ORDER BY symbol, scan_date DESC, id DESC;

DROP VIEW IF EXISTS public.market_scan_runs_safe CASCADE;
CREATE VIEW public.market_scan_runs_safe
WITH (security_invoker = on) AS
  SELECT id, scan_date, status, started_at, completed_at,
    symbols_targeted, symbols_scanned, symbols_failed,
    run_label, universe_run_id, stage_counts, blocker_summary, metadata
  FROM public.market_scan_runs;

-- Grant authenticated SELECT on the safe view
CREATE POLICY "Authenticated can read market scan runs safe"
  ON public.market_scan_runs FOR SELECT TO authenticated
  USING (true);

DROP VIEW IF EXISTS public.symbol_industry_alignment_active CASCADE;
CREATE VIEW public.symbol_industry_alignment_active
WITH (security_invoker = on) AS
  SELECT symbol, canonical_sector, canonical_industry,
    CASE WHEN canonical_sector IS NOT NULL AND canonical_sector <> 'Unknown'
         AND canonical_industry IS NOT NULL AND canonical_industry <> 'Unknown'
         THEN true ELSE false END AS alignment_eligible,
    CASE WHEN canonical_sector IS NOT NULL AND canonical_sector <> 'Unknown'
         AND canonical_industry IS NOT NULL AND canonical_industry <> 'Unknown'
         THEN 'aligned' ELSE 'unresolved' END AS alignment_status,
    CASE WHEN canonical_sector IS NOT NULL AND canonical_sector <> 'Unknown'
         AND canonical_industry IS NOT NULL AND canonical_industry <> 'Unknown'
         THEN 'sector_industry_present' ELSE 'missing_classification' END AS alignment_reason
  FROM public.symbols sus
  WHERE is_active = true;

-- 6. Harden get_top_wsp_setups with SECURITY DEFINER + search_path
CREATE OR REPLACE FUNCTION public.get_top_wsp_setups()
  RETURNS TABLE(symbol text, pattern text, recommendation text, score integer, sector text, industry text, payload jsonb, vol_ratio numeric)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT 
    symbol, pattern, recommendation, score, sector, industry, payload,
    (payload->>'volume_ratio')::numeric as vol_ratio
  FROM public.market_scan_results_latest
  WHERE pattern = 'climbing'
  ORDER BY score DESC, (payload->>'volume_ratio')::numeric DESC NULLS LAST
  LIMIT 10;
$$;

-- 7. Harden get_scanner_funnel_counts
CREATE OR REPLACE FUNCTION public.get_scanner_funnel_counts()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'climbing', COUNT(*) FILTER (WHERE pattern = 'climbing'),
    'base', COUNT(*) FILTER (WHERE pattern = 'base_or_climbing'),
    'downhill', COUNT(*) FILTER (WHERE pattern = 'downhill'),
    'total', COUNT(*)
  )
  FROM public.market_scan_results_latest;
$$;

-- 8. Harden get_symbols_needing_backfill
CREATE OR REPLACE FUNCTION public.get_symbols_needing_backfill(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
  RETURNS TABLE(symbol text, bars bigint)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT s.symbol, COALESCE(dp.bars, 0) as bars
  FROM public.symbols s
  LEFT JOIN (
    SELECT symbol, COUNT(*) as bars 
    FROM public.daily_prices 
    GROUP BY symbol
  ) dp ON dp.symbol = s.symbol
  WHERE s.is_active = true
  AND s.is_etf = false
  AND COALESCE(dp.bars, 0) < 200
  ORDER BY COALESCE(dp.bars, 0) DESC
  LIMIT p_limit OFFSET p_offset;
$$;

-- 9. Harden run_broad_market_scan
CREATE OR REPLACE FUNCTION public.run_broad_market_scan(p_as_of_date date, p_run_label text)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
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
    CASE
      WHEN p.wsp_pattern = 'climbing' AND COALESCE(p.wsp_score, 0) >= 3 THEN 'KÖP'
      WHEN p.wsp_pattern IN ('climbing', 'base_or_climbing') THEN 'BEVAKA'
      WHEN p.wsp_pattern = 'downhill' THEN 'UNDVIK'
      ELSE 'NEUTRAL'
    END,
    array_remove(ARRAY[
      CASE WHEN COALESCE(p.above_ma50, false) = false THEN 'below_ma50' END,
      CASE WHEN COALESCE(p.above_ma150, false) = false THEN 'below_ma150' END,
      CASE WHEN COALESCE(p.volume_ratio, 0) < 1.1 THEN 'volume_not_confirmed' END,
      CASE WHEN COALESCE(p.mansfield_rs, 0) <= 0 THEN 'mansfield_not_valid' END
    ], NULL)::text[],
    COALESCE(p.wsp_score, 0),
    CASE
      WHEN COALESCE(p.above_ma50, false) AND COALESCE(p.above_ma150, false)
           AND p.ma50_slope = 'rising' THEN 'bullish'
      WHEN COALESCE(p.above_ma150, false) = false THEN 'bearish'
      ELSE 'neutral'
    END,
    p.canonical_sector, p.canonical_industry,
    p.alignment_status, p.alignment_reason, p.classification_confidence_level,
    CASE
      WHEN p.support_level = 'full_wsp_equity' AND p.eligible_for_full_wsp THEN 'tier1_default'
      WHEN p.classification_confidence_level = 'low' THEN 'blocked_low_quality'
      WHEN p.wsp_pattern = 'climbing' AND COALESCE(p.wsp_score, 0) >= 3
           AND p.classification_confidence_level IN ('high', 'medium') THEN 'approved_for_live_scanner'
      WHEN p.wsp_pattern = 'climbing' THEN 'review_needed'
      ELSE 'broader_candidate'
    END,
    CASE
      WHEN p.support_level = 'full_wsp_equity' AND p.eligible_for_full_wsp THEN true
      WHEN p.wsp_pattern = 'climbing' AND COALESCE(p.wsp_score, 0) >= 3
           AND p.classification_confidence_level IN ('high', 'medium') THEN true
      ELSE false
    END,
    CASE WHEN p.wsp_pattern = 'climbing' AND COALESCE(p.wsp_score, 0) = 2 THEN true ELSE false END,
    CASE WHEN p.classification_confidence_level = 'low' THEN true ELSE false END,
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
    metadata = jsonb_build_object('universe_run_id', v_universe_run_id, 'rule_version', 'phase7_v3_baseline')
  WHERE r.id = v_scan_run_id;

  RETURN v_scan_run_id;
END;
$function$;

-- 10. Harden refresh_scanner_universe_snapshot
CREATE OR REPLACE FUNCTION public.refresh_scanner_universe_snapshot(p_as_of_date date, p_run_label text)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $function$
DECLARE
  v_run_id bigint;
BEGIN
  INSERT INTO public.scanner_universe_runs (as_of_date, run_label)
  VALUES (p_as_of_date, p_run_label)
  RETURNING id INTO v_run_id;

  WITH price_coverage AS (
    SELECT dp.symbol, COUNT(*)::integer AS history_bars, MAX(dp.date) AS latest_price_date
    FROM public.daily_prices dp GROUP BY dp.symbol
  ),
  latest_indicators AS (
    SELECT DISTINCT ON (wi.symbol) wi.symbol, wi.calc_date, wi.ma50, wi.ma150, wi.mansfield_rs,
      wi.volume_ratio, wi.wsp_score, wi.wsp_pattern, wi.pct_change_1d, wi.close, wi.volume
    FROM public.wsp_indicators wi ORDER BY wi.symbol, wi.calc_date DESC
  ),
  symbol_base AS (
    SELECT
      s.symbol, s.support_level,
      COALESCE(NULLIF(s.canonical_sector, ''), NULLIF(s.sector, ''), 'Unknown') AS canonical_sector,
      COALESCE(NULLIF(s.canonical_industry, ''), NULLIF(s.industry, ''), 'Unknown') AS canonical_industry,
      COALESCE(s.classification_status, 'unresolved') AS classification_status,
      COALESCE(s.classification_confidence_level, 'low') AS classification_confidence_level,
      COALESCE(pc.history_bars, 0) AS history_bars, pc.latest_price_date,
      li.calc_date AS latest_indicator_date, li.close AS latest_close, li.volume AS latest_volume,
      (li.calc_date IS NOT NULL AND li.ma50 IS NOT NULL AND li.ma150 IS NOT NULL
       AND li.mansfield_rs IS NOT NULL AND li.volume_ratio IS NOT NULL) AS indicator_ready,
      COALESCE(sia.alignment_eligible, false) AS alignment_eligible,
      COALESCE(s.eligible_for_backfill, false) AS eligible_for_backfill,
      COALESCE(s.eligible_for_full_wsp, false) AS eligible_for_full_wsp,
      COALESCE(s.is_common_stock, false) AS is_common_stock,
      COALESCE(s.instrument_type, '') AS instrument_type,
      COALESCE(s.is_etf, false) AS is_etf,
      COALESCE(s.is_adr, false) AS is_adr,
      COALESCE(s.exchange, '') AS exchange
    FROM public.symbols s
    LEFT JOIN price_coverage pc ON pc.symbol = s.symbol
    LEFT JOIN latest_indicators li ON li.symbol = s.symbol
    LEFT JOIN public.symbol_industry_alignment_active sia ON sia.symbol = s.symbol
    WHERE s.is_active = true
  )
  INSERT INTO public.scanner_universe_snapshot (
    run_id, symbol, support_level, canonical_sector, canonical_industry,
    classification_status, classification_confidence_level,
    history_bars, latest_price_date, latest_indicator_date,
    indicator_ready, alignment_eligible, is_scanner_eligible, exclusion_reasons,
    baseline_eligible, blocker_no_price_data, blocker_low_confidence,
    blocker_unknown_sector, blocker_alignment_ineligible,
    blocker_below_min_price, blocker_below_min_volume
  )
  SELECT v_run_id, sb.symbol, sb.support_level, sb.canonical_sector, sb.canonical_industry,
    sb.classification_status, sb.classification_confidence_level,
    sb.history_bars, sb.latest_price_date, sb.latest_indicator_date,
    sb.indicator_ready, sb.alignment_eligible,
    (sb.support_level IN ('full_wsp_equity', 'limited_equity')
      AND sb.eligible_for_backfill AND sb.is_common_stock AND sb.instrument_type = 'CS'
      AND NOT sb.is_etf AND NOT sb.is_adr
      AND sb.exchange IN ('NYSE', 'NASDAQ', 'AMEX', 'ARCA')
      AND sb.classification_status IN ('canonicalized', 'manually_reviewed')
      AND sb.classification_confidence_level IN ('high', 'medium')
      AND sb.canonical_sector <> 'Unknown' AND sb.canonical_industry <> 'Unknown'
      AND sb.history_bars >= 260 AND sb.indicator_ready AND sb.alignment_eligible),
    array_remove(ARRAY[
      CASE WHEN sb.support_level NOT IN ('full_wsp_equity', 'limited_equity') THEN 'unsupported_support_level' END,
      CASE WHEN NOT sb.eligible_for_backfill THEN 'not_eligible_for_backfill' END,
      CASE WHEN NOT sb.is_common_stock OR sb.instrument_type <> 'CS' THEN 'not_common_stock' END,
      CASE WHEN sb.is_etf THEN 'etf_not_supported' END,
      CASE WHEN sb.is_adr THEN 'adr_not_supported' END,
      CASE WHEN sb.exchange NOT IN ('NYSE', 'NASDAQ', 'AMEX', 'ARCA') THEN 'unsupported_exchange' END,
      CASE WHEN sb.classification_status NOT IN ('canonicalized', 'manually_reviewed') THEN 'classification_not_ready' END,
      CASE WHEN sb.classification_confidence_level NOT IN ('high', 'medium') THEN 'classification_low_confidence' END,
      CASE WHEN sb.canonical_sector = 'Unknown' OR sb.canonical_industry = 'Unknown' THEN 'missing_sector_industry' END,
      CASE WHEN sb.history_bars < 260 THEN 'insufficient_price_history' END,
      CASE WHEN NOT sb.indicator_ready THEN 'indicator_not_ready' END,
      CASE WHEN NOT sb.alignment_eligible THEN 'alignment_not_ready' END
    ], NULL)::text[],
    (NOT sb.is_etf AND sb.indicator_ready AND COALESCE(sb.latest_close, 0) >= 1.0
     AND COALESCE(sb.latest_volume, 0) >= 50000 AND sb.canonical_sector NOT IN ('Unknown', 'ETF')),
    (sb.latest_price_date IS NULL),
    (sb.classification_confidence_level = 'low'),
    (sb.canonical_sector = 'Unknown' OR sb.canonical_industry = 'Unknown'),
    (NOT sb.alignment_eligible),
    (COALESCE(sb.latest_close, 0) < 1.0),
    (COALESCE(sb.latest_volume, 0) < 50000)
  FROM symbol_base sb;

  UPDATE public.scanner_universe_runs r
  SET
    total_symbols = counts.total_symbols,
    eligible_symbols = counts.eligible_symbols,
    blocked_symbols = counts.total_symbols - counts.eligible_symbols,
    metadata = jsonb_build_object('as_of_date', p_as_of_date, 'rule_version', 'phase7_v3_baseline', 'baseline_eligible', counts.baseline_count)
  FROM (
    SELECT COUNT(*)::bigint AS total_symbols,
      COUNT(*) FILTER (WHERE is_scanner_eligible)::bigint AS eligible_symbols,
      COUNT(*) FILTER (WHERE baseline_eligible)::bigint AS baseline_count
    FROM public.scanner_universe_snapshot WHERE run_id = v_run_id
  ) counts
  WHERE r.id = v_run_id;

  RETURN v_run_id;
END;
$function$;

-- 11. Harden backfill_symbol_yahoo
CREATE OR REPLACE FUNCTION public.backfill_symbol_yahoo(p_symbol text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $function$
DECLARE
  v_request_id bigint;
  v_response record;
  v_data jsonb;
  v_result jsonb;
  v_timestamps jsonb;
  v_opens jsonb;
  v_highs jsonb;
  v_lows jsonb;
  v_closes jsonb;
  v_volumes jsonb;
  v_bars_inserted int := 0;
  v_i int;
  v_date text;
  v_open numeric;
  v_high numeric;
  v_low numeric;
  v_close numeric;
  v_volume bigint;
  v_attempts int := 0;
BEGIN
  SELECT net.http_get(
    url := 'https://query1.finance.yahoo.com/v8/finance/chart/' || p_symbol || '?interval=1d&range=2y'
  ) INTO v_request_id;
  
  LOOP
    PERFORM pg_sleep(2);
    v_attempts := v_attempts + 1;
    SELECT * INTO v_response FROM net._http_response WHERE id = v_request_id;
    EXIT WHEN v_response IS NOT NULL OR v_attempts >= 7;
  END LOOP;
  
  IF v_response IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'symbol', p_symbol, 'error', 'Timeout');
  END IF;
  
  IF v_response.status_code != 200 THEN
    RETURN jsonb_build_object('ok', false, 'symbol', p_symbol, 'error', 'HTTP ' || v_response.status_code);
  END IF;
  
  v_data := v_response.content::jsonb;
  v_result := v_data->'chart'->'result'->0;
  
  IF v_result IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'symbol', p_symbol, 'error', 'No result');
  END IF;
  
  v_timestamps := v_result->'timestamp';
  v_opens := v_result->'indicators'->'quote'->0->'open';
  v_highs := v_result->'indicators'->'quote'->0->'high';
  v_lows := v_result->'indicators'->'quote'->0->'low';
  v_closes := v_result->'indicators'->'quote'->0->'close';
  v_volumes := v_result->'indicators'->'quote'->0->'volume';
  
  FOR v_i IN 0..jsonb_array_length(v_timestamps)-1 LOOP
    v_date := to_char(to_timestamp((v_timestamps->v_i)::bigint), 'YYYY-MM-DD');
    v_open := (v_opens->v_i)::numeric;
    v_high := (v_highs->v_i)::numeric;
    v_low := (v_lows->v_i)::numeric;
    v_close := (v_closes->v_i)::numeric;
    v_volume := (v_volumes->v_i)::bigint;
    
    IF v_close IS NOT NULL THEN
      INSERT INTO public.daily_prices (symbol, date, open, high, low, close, volume, data_source)
      VALUES (p_symbol, v_date::date, v_open, v_high, v_low, v_close, v_volume, 'yahoo')
      ON CONFLICT (symbol, date) DO UPDATE SET
        open = EXCLUDED.open, high = EXCLUDED.high,
        low = EXCLUDED.low, close = EXCLUDED.close,
        volume = EXCLUDED.volume;
      v_bars_inserted := v_bars_inserted + 1;
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object('ok', true, 'symbol', p_symbol, 'bars', v_bars_inserted);
END;
$function$;

-- 12. Harden materialize_wsp_indicators
CREATE OR REPLACE FUNCTION public.materialize_wsp_indicators(p_from_date date DEFAULT '2024-01-01'::date, p_to_date date DEFAULT CURRENT_DATE)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.wsp_indicators (
    symbol, calc_date, close, volume,
    ma50, ma150, ma50_slope,
    above_ma50, above_ma150,
    avg_volume_5d, volume_ratio,
    pct_change_1d, pct_from_52w_high,
    mansfield_rs, wsp_pattern, wsp_score,
    created_at
  )
  WITH step1_windows AS (
    SELECT symbol, date, close, volume,
      AVG(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS ma50,
      AVG(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 149 PRECEDING AND CURRENT ROW) AS ma150,
      AVG(volume) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS avg_vol_5d,
      MAX(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 251 PRECEDING AND CURRENT ROW) AS high_52w
    FROM public.daily_prices
    WHERE date BETWEEN (p_from_date - INTERVAL '200 days') AND p_to_date
      AND close > 0 AND volume > 0
  ),
  step2_lags AS (
    SELECT *, LAG(close, 1) OVER (PARTITION BY symbol ORDER BY date) AS prev_close,
      LAG(ma50, 5) OVER (PARTITION BY symbol ORDER BY date) AS ma50_5d_ago
    FROM step1_windows
  ),
  step3_final AS (
    SELECT symbol, date, close, volume, ma50, ma150,
      avg_vol_5d::bigint AS avg_volume_5d, high_52w,
      CASE WHEN ma50_5d_ago IS NULL THEN 'flat' WHEN ma50 > ma50_5d_ago THEN 'rising' WHEN ma50 < ma50_5d_ago THEN 'falling' ELSE 'flat' END AS ma50_slope,
      close > ma50 AS above_ma50, close > ma150 AS above_ma150,
      CASE WHEN avg_vol_5d > 0 THEN ROUND(volume::numeric / avg_vol_5d, 2) ELSE 1 END AS volume_ratio,
      CASE WHEN prev_close > 0 THEN ROUND((close - prev_close) / prev_close * 100, 2) ELSE 0 END AS pct_change_1d,
      CASE WHEN high_52w > 0 THEN ROUND((close - high_52w) / high_52w * 100, 2) ELSE 0 END AS pct_from_52w_high,
      CASE WHEN ma150 > 0 THEN ROUND((close / ma150 - 1) * 100, 2) ELSE 0 END AS mansfield_rs
    FROM step2_lags WHERE date BETWEEN p_from_date AND p_to_date
  )
  SELECT symbol, date, close, volume, ma50, ma150, ma50_slope, above_ma50, above_ma150,
    avg_volume_5d, volume_ratio, pct_change_1d, pct_from_52w_high, mansfield_rs,
    CASE
      WHEN above_ma50 AND above_ma150 AND volume_ratio >= 1.5 AND mansfield_rs > 0 THEN 'climbing'
      WHEN above_ma50 AND above_ma150 THEN 'base_or_climbing'
      WHEN NOT above_ma50 THEN 'downhill'
      ELSE 'base'
    END AS wsp_pattern,
    (CASE WHEN above_ma50 THEN 1 ELSE 0 END + CASE WHEN above_ma150 THEN 1 ELSE 0 END
     + CASE WHEN volume_ratio >= 1.5 THEN 1 ELSE 0 END + CASE WHEN mansfield_rs > 0 THEN 1 ELSE 0 END) AS wsp_score,
    now()
  FROM step3_final
  ON CONFLICT (symbol, calc_date) DO UPDATE SET
    close = EXCLUDED.close, volume = EXCLUDED.volume, ma50 = EXCLUDED.ma50, ma150 = EXCLUDED.ma150,
    ma50_slope = EXCLUDED.ma50_slope, above_ma50 = EXCLUDED.above_ma50, above_ma150 = EXCLUDED.above_ma150,
    avg_volume_5d = EXCLUDED.avg_volume_5d, volume_ratio = EXCLUDED.volume_ratio,
    pct_change_1d = EXCLUDED.pct_change_1d, pct_from_52w_high = EXCLUDED.pct_from_52w_high,
    mansfield_rs = EXCLUDED.mansfield_rs, wsp_pattern = EXCLUDED.wsp_pattern,
    wsp_score = EXCLUDED.wsp_score, created_at = now();
END;
$function$;
