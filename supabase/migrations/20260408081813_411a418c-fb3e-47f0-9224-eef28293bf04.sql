-- Fix get_equity_snapshots to return actual industry counts from scan results
CREATE OR REPLACE FUNCTION public.get_equity_snapshots(p_limit integer DEFAULT 20)
 RETURNS TABLE(snapshot_id bigint, run_id bigint, status text, is_canonical boolean, completed_at timestamp with time zone, symbols_expected bigint, symbols_completed bigint, sectors_expected integer, sectors_completed integer, industries_expected integer, industries_completed integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH run_data AS (
    SELECT
      msr.id,
      msr.status,
      msr.completed_at,
      msr.symbols_targeted,
      msr.symbols_scanned,
      ROW_NUMBER() OVER (ORDER BY msr.id DESC) AS rn
    FROM market_scan_runs msr
    ORDER BY msr.id DESC
    LIMIT p_limit
  ),
  industry_counts AS (
    SELECT
      r.run_id,
      COUNT(DISTINCT r.industry) FILTER (
        WHERE r.industry IS NOT NULL AND r.industry != 'Unknown' AND r.industry != ''
      )::integer AS industries_completed
    FROM public.market_scan_results r
    WHERE r.run_id IN (SELECT id FROM run_data)
    GROUP BY r.run_id
  ),
  sector_counts AS (
    SELECT
      r.run_id,
      COUNT(DISTINCT r.sector) FILTER (
        WHERE r.sector IS NOT NULL AND r.sector != 'Unknown' AND r.sector != ''
      )::integer AS sectors_completed
    FROM public.market_scan_results r
    WHERE r.run_id IN (SELECT id FROM run_data)
    GROUP BY r.run_id
  ),
  reference_counts AS (
    SELECT
      COUNT(DISTINCT canonical_sector) FILTER (
        WHERE canonical_sector IS NOT NULL AND canonical_sector != 'Unknown' AND canonical_sector != ''
      )::integer AS sectors_expected,
      COUNT(DISTINCT canonical_industry) FILTER (
        WHERE canonical_industry IS NOT NULL AND canonical_industry != 'Unknown' AND canonical_industry != ''
      )::integer AS industries_expected
    FROM public.symbols
    WHERE is_active = true
  )
  SELECT
    rd.id AS snapshot_id,
    rd.id AS run_id,
    rd.status,
    (rd.rn = 1) AS is_canonical,
    rd.completed_at,
    rd.symbols_targeted AS symbols_expected,
    rd.symbols_scanned AS symbols_completed,
    COALESCE(rc.sectors_expected, 11) AS sectors_expected,
    COALESCE(sc.sectors_completed, 0) AS sectors_completed,
    COALESCE(rc.industries_expected, 0) AS industries_expected,
    COALESCE(ic.industries_completed, 0) AS industries_completed
  FROM run_data rd
  CROSS JOIN reference_counts rc
  LEFT JOIN industry_counts ic ON ic.run_id = rd.id
  LEFT JOIN sector_counts sc ON sc.run_id = rd.id
  ORDER BY rd.id DESC;
$function$;

-- Fix get_equity_snapshot_coverage_report to include industry metrics
CREATE OR REPLACE FUNCTION public.get_equity_snapshot_coverage_report()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'snapshot_id', NULL,
    'coverage', jsonb_build_object(
      'active_scannable_equities_in_universe', (SELECT COUNT(*) FROM symbols WHERE is_active = true),
      'equities_materialized_into_screener_rows_materialized', (SELECT COUNT(DISTINCT symbol) FROM market_scan_results_latest),
      'equities_with_daily_bars', (SELECT COUNT(DISTINCT symbol) FROM daily_prices),
      'equities_with_indicators', (SELECT COUNT(DISTINCT symbol) FROM wsp_indicators),
      'equities_with_pattern_states', (SELECT COUNT(DISTINCT symbol) FROM wsp_indicators WHERE wsp_pattern IS NOT NULL),
      'equities_with_wsp_evaluations', (SELECT COUNT(DISTINCT symbol) FROM market_scan_results_latest WHERE score IS NOT NULL),
      'equities_exposed_to_screener_table', (SELECT COUNT(DISTINCT symbol) FROM market_scan_results_latest),
      'equities_exposed_to_dashboard', (SELECT COUNT(DISTINCT symbol) FROM wsp_indicators WHERE symbol IN ('SPY','QQQ','DIA','IWM')),
      'distinct_sectors_in_universe', (SELECT COUNT(DISTINCT canonical_sector) FROM symbols WHERE is_active = true AND canonical_sector IS NOT NULL AND canonical_sector != 'Unknown' AND canonical_sector != ''),
      'distinct_industries_in_universe', (SELECT COUNT(DISTINCT canonical_industry) FROM symbols WHERE is_active = true AND canonical_industry IS NOT NULL AND canonical_industry != 'Unknown' AND canonical_industry != ''),
      'distinct_industries_in_latest_scan', (SELECT COUNT(DISTINCT industry) FROM market_scan_results_latest WHERE industry IS NOT NULL AND industry != 'Unknown' AND industry != ''),
      'equities_with_industry_metadata', (SELECT COUNT(*) FROM symbols WHERE is_active = true AND canonical_industry IS NOT NULL AND canonical_industry != 'Unknown' AND canonical_industry != '')
    ),
    'ui_count_lineage', '{}'::jsonb
  );
$function$;
