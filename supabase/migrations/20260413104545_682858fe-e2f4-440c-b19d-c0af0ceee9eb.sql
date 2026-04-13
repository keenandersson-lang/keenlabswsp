
-- Fix view security definer issue
ALTER VIEW public.market_scan_results_latest SET (security_invoker = true);

-- Fix search_path on run_broad_market_scan
ALTER FUNCTION public.run_broad_market_scan(date, text) SET search_path = 'public';
