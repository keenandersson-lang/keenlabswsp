-- Canonical exposure + lineage fixes for broad equity coverage.

CREATE OR REPLACE FUNCTION public.get_equity_screener_rows(p_page integer DEFAULT 0, p_page_size integer DEFAULT 100)
RETURNS TABLE (
  snapshot_id bigint,
  symbol text,
  close numeric,
  daily_pct numeric,
  sector text,
  industry text,
  pattern_state text,
  recommendation text,
  wsp_score numeric,
  validity boolean,
  breakout_freshness text,
  volume_ratio numeric,
  blockers jsonb,
  warnings jsonb,
  payload jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH canonical AS (
    SELECT public.get_latest_canonical_snapshot_id('equities') AS sid
  ),
  universe AS (
    SELECT s.symbol,
           COALESCE(NULLIF(s.sector, ''), 'Unknown') AS sector,
           COALESCE(NULLIF(s.industry, ''), 'Unknown') AS industry
    FROM public.symbols s
    WHERE s.is_active = true
      AND COALESCE(s.asset_class, 'equity') = 'equity'
  ),
  latest_i AS (
    SELECT DISTINCT ON (i.symbol)
      i.symbol,
      i.close,
      i.pct_change_1d,
      i.volume_ratio,
      i.mansfield_rs,
      i.ma50_slope,
      i.above_ma50
    FROM public.indicator_snapshots i
    JOIN canonical c ON i.snapshot_id = c.sid
    ORDER BY i.symbol, i.calc_date DESC
  ),
  materialized AS (
    SELECT s.*
    FROM public.screener_rows_materialized s
    JOIN canonical c ON s.snapshot_id = c.sid
  )
  SELECT
    c.sid AS snapshot_id,
    u.symbol,
    COALESCE(m.close, i.close) AS close,
    COALESCE(m.daily_pct, i.pct_change_1d) AS daily_pct,
    COALESCE(m.sector, u.sector) AS sector,
    COALESCE(m.industry, u.industry) AS industry,
    COALESCE(m.pattern_state, COALESCE(m.payload->>'wsp_pattern', 'base')) AS pattern_state,
    COALESCE(
      m.recommendation,
      CASE
        WHEN COALESCE(m.validity, false) THEN 'KÖP'
        WHEN COALESCE(m.pattern_state, m.payload->>'wsp_pattern', 'base') = 'downhill' THEN 'UNDVIK'
        ELSE 'BEVAKA'
      END
    ) AS recommendation,
    COALESCE(m.wsp_score, (m.payload->>'wsp_score')::numeric, 0) AS wsp_score,
    COALESCE(
      m.validity,
      CASE
        WHEN COALESCE(m.pattern_state, m.payload->>'wsp_pattern', 'base') = 'climbing'
             AND COALESCE(i.above_ma50, false)
             AND COALESCE(i.ma50_slope, '') = 'rising'
             AND COALESCE(i.volume_ratio, 0) >= 1.1
             AND COALESCE(i.mansfield_rs, 0) > 0
          THEN true
        ELSE false
      END
    ) AS validity,
    COALESCE(m.breakout_freshness, 'unknown') AS breakout_freshness,
    COALESCE(m.volume_ratio, i.volume_ratio) AS volume_ratio,
    COALESCE(m.blockers, '[]'::jsonb) AS blockers,
    COALESCE(m.warnings, '[]'::jsonb) AS warnings,
    COALESCE(
      m.payload,
      jsonb_build_object(
        'wsp_pattern', COALESCE(m.pattern_state, 'base'),
        'wsp_score', COALESCE(m.wsp_score, 0),
        'close', i.close,
        'pct_change_1d', i.pct_change_1d,
        'volume_ratio', i.volume_ratio,
        'mansfield_rs', i.mansfield_rs,
        'ma50_slope', i.ma50_slope,
        'above_ma50', i.above_ma50
      )
    ) AS payload
  FROM canonical c
  JOIN universe u ON true
  LEFT JOIN materialized m ON m.symbol = u.symbol
  LEFT JOIN latest_i i ON i.symbol = u.symbol
  WHERE i.symbol IS NOT NULL OR m.symbol IS NOT NULL
  ORDER BY COALESCE(m.wsp_score, (m.payload->>'wsp_score')::numeric, 0) DESC NULLS LAST, u.symbol ASC
  OFFSET GREATEST(p_page, 0) * GREATEST(p_page_size, 1)
  LIMIT GREATEST(p_page_size, 1);
$$;

CREATE OR REPLACE FUNCTION public.get_equity_dashboard_rows()
RETURNS TABLE (
  snapshot_id bigint,
  symbol text,
  close numeric,
  daily_pct numeric,
  sector text,
  industry text,
  pattern_state text,
  wsp_score numeric,
  validity boolean,
  breakout_freshness text,
  volume_ratio numeric,
  blockers jsonb,
  warnings jsonb
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.snapshot_id,
    s.symbol,
    s.close,
    s.daily_pct,
    s.sector,
    s.industry,
    s.pattern_state,
    s.wsp_score,
    s.validity,
    s.breakout_freshness,
    s.volume_ratio,
    s.blockers,
    s.warnings
  FROM public.get_equity_screener_rows(0, 20000) s
  ORDER BY s.wsp_score DESC NULLS LAST, s.symbol ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_equity_canonical_funnel_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'climbing', COUNT(*) FILTER (WHERE s.pattern_state = 'climbing'),
    'base', COUNT(*) FILTER (WHERE s.pattern_state = 'base_or_climbing'),
    'downhill', COUNT(*) FILTER (WHERE s.pattern_state = 'downhill'),
    'total', COUNT(*)
  )
  FROM public.get_equity_screener_rows(0, 20000) s;
$$;

CREATE OR REPLACE FUNCTION public.get_equity_snapshot_coverage_report()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH canonical AS (
    SELECT public.get_latest_canonical_snapshot_id('equities') AS sid
  ),
  active_equities AS (
    SELECT COUNT(*)::bigint AS n
    FROM public.symbols s
    WHERE s.is_active = true
      AND COALESCE(s.asset_class, 'equity') = 'equity'
  ),
  indicators AS (
    SELECT COUNT(DISTINCT i.symbol)::bigint AS n
    FROM public.indicator_snapshots i
    JOIN canonical c ON i.snapshot_id = c.sid
  ),
  patterns AS (
    SELECT COUNT(DISTINCT p.symbol)::bigint AS n
    FROM public.pattern_states p
    JOIN canonical c ON p.snapshot_id = c.sid
  ),
  evaluations AS (
    SELECT COUNT(DISTINCT e.symbol)::bigint AS n
    FROM public.wsp_evaluations e
    JOIN canonical c ON e.snapshot_id = c.sid
  ),
  materialized_screener AS (
    SELECT COUNT(*)::bigint AS n
    FROM public.screener_rows_materialized s
    JOIN canonical c ON s.snapshot_id = c.sid
  ),
  exposed_dashboard AS (
    SELECT COUNT(*)::bigint AS n FROM public.get_equity_dashboard_rows()
  ),
  exposed_screener AS (
    SELECT COUNT(*)::bigint AS n FROM public.get_equity_screener_rows(0, 20000)
  ),
  exposed_heatmap_names AS (
    SELECT COUNT(*)::bigint AS n
    FROM (
      SELECT symbol, ROW_NUMBER() OVER (PARTITION BY sector ORDER BY wsp_score DESC NULLS LAST, symbol) AS rn
      FROM public.get_equity_screener_rows(0, 20000)
    ) x
    WHERE x.rn <= 5
  ),
  bars AS (
    SELECT COUNT(DISTINCT dp.symbol)::bigint AS n
    FROM public.daily_prices dp
    WHERE dp.date >= current_date - INTERVAL '7 day'
  ),
  legacy_funnel AS (
    SELECT public.get_scanner_funnel_counts() AS payload
  ),
  canonical_funnel AS (
    SELECT public.get_equity_canonical_funnel_counts() AS payload
  )
  SELECT jsonb_build_object(
    'snapshot_id', (SELECT sid FROM canonical),
    'coverage', jsonb_build_object(
      'active_scannable_equities_in_universe', (SELECT n FROM active_equities),
      'equities_with_daily_bars', (SELECT n FROM bars),
      'equities_with_indicators', (SELECT n FROM indicators),
      'equities_with_pattern_states', (SELECT n FROM patterns),
      'equities_with_wsp_evaluations', (SELECT n FROM evaluations),
      'equities_materialized_into_screener_rows_materialized', (SELECT n FROM materialized_screener),
      'equities_exposed_to_dashboard', (SELECT n FROM exposed_dashboard),
      'equities_exposed_to_screener_table', (SELECT n FROM exposed_screener),
      'equities_exposed_to_heatmap', (SELECT n FROM exposed_heatmap_names)
    ),
    'ui_count_lineage', jsonb_build_object(
      'legacy_scanner_funnel_counts_from_market_scan_results_latest', (SELECT payload FROM legacy_funnel),
      'canonical_scanner_funnel_counts_from_get_equity_screener_rows', (SELECT payload FROM canonical_funnel),
      'sectors_count_from_market_command_sector_buckets', (SELECT COUNT(DISTINCT sector) FROM public.get_equity_screener_rows(0, 20000)),
      'industries_count_from_market_command_industry_buckets', (SELECT COUNT(DISTINCT industry) FROM public.get_equity_screener_rows(0, 20000)),
      'equities_count_from_market_command_market_breadth_total', (SELECT n FROM exposed_dashboard),
      'heatmap_names_count_from_top5_per_sector_over_screener_rows', (SELECT n FROM exposed_heatmap_names)
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_equity_canonical_funnel_counts() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_equity_snapshot_coverage_report() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_equity_dashboard_rows() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_equity_screener_rows(integer, integer) TO anon, authenticated, service_role;
