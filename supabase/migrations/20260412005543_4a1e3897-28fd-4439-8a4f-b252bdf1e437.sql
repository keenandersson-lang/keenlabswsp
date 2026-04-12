
CREATE OR REPLACE FUNCTION public.refresh_scanner_universe_snapshot(p_as_of_date date, p_run_label text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '15min'
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
      -- RELAXED: indicator_ready no longer requires mansfield_rs or ma150 to be non-null
      -- Per WSP data contract, these can be NULL when history < 200/150 bars
      (li.calc_date IS NOT NULL AND li.ma50 IS NOT NULL AND li.volume_ratio IS NOT NULL) AS indicator_ready,
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
    metadata = jsonb_build_object('as_of_date', p_as_of_date, 'rule_version', 'phase7_v4_relaxed_indicator', 'baseline_eligible', counts.baseline_count)
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
