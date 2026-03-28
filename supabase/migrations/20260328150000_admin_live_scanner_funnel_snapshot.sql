-- Admin instrumentation: expose end-to-end live scanner funnel counts and bottleneck stage.

CREATE OR REPLACE FUNCTION public.admin_live_scanner_funnel_snapshot()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $$
WITH active_symbols AS (
  SELECT
    s.symbol,
    s.support_level,
    COALESCE(s.classification_status, 'unresolved') AS classification_status,
    COALESCE(s.classification_confidence_level, 'low') AS classification_confidence_level,
    COALESCE(s.is_active, false) AS is_active,
    COALESCE(s.is_etf, false) AS is_etf,
    COALESCE(s.instrument_type, '') AS instrument_type
  FROM public.symbols s
  WHERE s.is_active = true
),
price_counts AS (
  SELECT dp.symbol, COUNT(*)::integer AS bar_count
  FROM public.daily_prices dp
  GROUP BY dp.symbol
),
indicator_symbols AS (
  SELECT DISTINCT wi.symbol
  FROM public.wsp_indicators wi
),
aligned_symbols AS (
  SELECT DISTINCT sia.symbol
  FROM public.symbol_industry_alignment_active sia
  WHERE sia.alignment_eligible = true
),
stage_counts AS (
  SELECT
    COUNT(*)::bigint AS active_symbols,
    COUNT(*) FILTER (WHERE COALESCE(pc.bar_count, 0) > 0)::bigint AS symbols_with_any_daily_prices,
    COUNT(*) FILTER (WHERE COALESCE(pc.bar_count, 0) >= 200)::bigint AS symbols_with_200_plus_bars,
    COUNT(*) FILTER (WHERE ins.symbol IS NOT NULL)::bigint AS symbols_present_in_wsp_indicators,
    COUNT(*) FILTER (
      WHERE a.support_level IN ('full_wsp_equity', 'limited_equity')
        AND a.classification_status IN ('canonicalized', 'manually_reviewed')
        AND a.classification_confidence_level IN ('high', 'medium')
        AND als.symbol IS NOT NULL
    )::bigint AS symbols_passing_classification_support_alignment
  FROM active_symbols a
  LEFT JOIN price_counts pc ON pc.symbol = a.symbol
  LEFT JOIN indicator_symbols ins ON ins.symbol = a.symbol
  LEFT JOIN aligned_symbols als ON als.symbol = a.symbol
),
latest_scan_symbols AS (
  SELECT DISTINCT m.symbol
  FROM public.market_scan_results_latest m
),
promotion_counts AS (
  SELECT
    m.promotion_status,
    COUNT(DISTINCT m.symbol)::bigint AS symbol_count
  FROM public.market_scan_results_latest m
  GROUP BY m.promotion_status
),
live_endpoint_rows AS (
  SELECT DISTINCT m.symbol
  FROM public.market_scan_results_latest m
  WHERE m.promotion_status IN ('tier1_default', 'approved_for_live_scanner')
),
live_endpoint_symbols AS (
  SELECT
    ler.symbol,
    CASE
      WHEN s.instrument_type = 'CS' AND COALESCE(s.is_etf, false) = false THEN true
      ELSE false
    END AS exposed_after_endpoint_filters
  FROM live_endpoint_rows ler
  LEFT JOIN public.symbols s ON s.symbol = ler.symbol
),
funnel_numbers AS (
  SELECT
    sc.active_symbols,
    sc.symbols_with_any_daily_prices,
    sc.symbols_with_200_plus_bars,
    sc.symbols_present_in_wsp_indicators,
    sc.symbols_passing_classification_support_alignment,
    COALESCE((SELECT COUNT(*)::bigint FROM latest_scan_symbols), 0) AS symbols_in_market_scan_results_latest,
    COALESCE((SELECT COUNT(*)::bigint FROM live_endpoint_rows), 0) AS symbols_matching_live_endpoint_statuses,
    COALESCE((
      SELECT COUNT(*)::bigint
      FROM live_endpoint_symbols les
      WHERE les.exposed_after_endpoint_filters
    ), 0) AS symbols_exposed_by_live_endpoint
  FROM stage_counts sc
),
dropoffs AS (
  SELECT
    stage_from,
    stage_to,
    count_from,
    count_to,
    GREATEST(count_from - count_to, 0)::bigint AS drop_count
  FROM (
    SELECT
      'active_symbols'::text AS stage_from,
      'symbols_with_any_daily_prices'::text AS stage_to,
      fn.active_symbols AS count_from,
      fn.symbols_with_any_daily_prices AS count_to
    FROM funnel_numbers fn
    UNION ALL
    SELECT
      'symbols_with_any_daily_prices',
      'symbols_with_200_plus_bars',
      fn.symbols_with_any_daily_prices,
      fn.symbols_with_200_plus_bars
    FROM funnel_numbers fn
    UNION ALL
    SELECT
      'symbols_with_200_plus_bars',
      'symbols_present_in_wsp_indicators',
      fn.symbols_with_200_plus_bars,
      fn.symbols_present_in_wsp_indicators
    FROM funnel_numbers fn
    UNION ALL
    SELECT
      'symbols_present_in_wsp_indicators',
      'symbols_passing_classification_support_alignment',
      fn.symbols_present_in_wsp_indicators,
      fn.symbols_passing_classification_support_alignment
    FROM funnel_numbers fn
    UNION ALL
    SELECT
      'symbols_passing_classification_support_alignment',
      'symbols_in_market_scan_results_latest',
      fn.symbols_passing_classification_support_alignment,
      fn.symbols_in_market_scan_results_latest
    FROM funnel_numbers fn
    UNION ALL
    SELECT
      'symbols_in_market_scan_results_latest',
      'symbols_exposed_by_live_endpoint',
      fn.symbols_in_market_scan_results_latest,
      fn.symbols_exposed_by_live_endpoint
    FROM funnel_numbers fn
  ) ordered
),
biggest_drop AS (
  SELECT d.*
  FROM dropoffs d
  ORDER BY d.drop_count DESC, d.stage_from
  LIMIT 1
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'funnel', (
    SELECT to_jsonb(fn) FROM funnel_numbers fn
  ),
  'promotion_status_counts', COALESCE((
    SELECT jsonb_object_agg(pc.promotion_status, pc.symbol_count)
    FROM promotion_counts pc
  ), '{}'::jsonb),
  'live_endpoint_details', jsonb_build_object(
    'source_view', 'market_scan_results_latest',
    'promotion_statuses_included', jsonb_build_array('tier1_default', 'approved_for_live_scanner'),
    'additional_symbol_filters', jsonb_build_array(
      'instrument_type = CS',
      'is_etf = false'
    )
  ),
  'biggest_dropoff', (
    SELECT to_jsonb(bd) FROM biggest_drop bd
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.admin_live_scanner_funnel_snapshot() TO anon, authenticated, service_role;
