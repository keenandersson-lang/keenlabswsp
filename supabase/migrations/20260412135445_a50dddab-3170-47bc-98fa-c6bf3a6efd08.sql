
CREATE OR REPLACE FUNCTION public.get_universe_coverage_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'core', (SELECT jsonb_build_object(
      'total', COUNT(*),
      'with_indicators', COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM wsp_indicators w WHERE w.symbol = s.symbol AND w.calc_date >= CURRENT_DATE - 7
      )),
      'enriched_last_7d', COUNT(*) FILTER (WHERE s.enriched_at >= NOW() - INTERVAL '7 days')
    ) FROM symbols s WHERE s.is_active AND s.universe_tier = 'core'),
    'expanded', (SELECT jsonb_build_object(
      'total', COUNT(*),
      'with_indicators', COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM wsp_indicators w WHERE w.symbol = s.symbol AND w.calc_date >= CURRENT_DATE - 7
      )),
      'enriched_last_7d', COUNT(*) FILTER (WHERE s.enriched_at >= NOW() - INTERVAL '7 days')
    ) FROM symbols s WHERE s.is_active AND s.universe_tier = 'expanded'),
    'benchmark', (SELECT jsonb_build_object(
      'total', COUNT(*)
    ) FROM symbols s WHERE s.is_active AND s.universe_tier = 'benchmark')
  );
$$;
