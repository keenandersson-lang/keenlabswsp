CREATE OR REPLACE FUNCTION public.get_scanner_funnel_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'climbing', COUNT(*) FILTER (WHERE pattern = 'climbing'),
    'base', COUNT(*) FILTER (WHERE pattern = 'base_or_climbing'),
    'downhill', COUNT(*) FILTER (WHERE pattern = 'downhill'),
    'total', COUNT(*)
  )
  FROM public.market_scan_results_latest;
$$;
