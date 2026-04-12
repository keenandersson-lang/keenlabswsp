
-- 1. Enable security_invoker on all views
ALTER VIEW public.market_scan_runs_safe SET (security_invoker = on);
ALTER VIEW public.market_scan_results_latest SET (security_invoker = on);
ALTER VIEW public.symbol_industry_alignment_active SET (security_invoker = on);

-- 2. Replace overly permissive anon policy on market_scan_results
DROP POLICY IF EXISTS "Public can read market scan results" ON public.market_scan_results;

CREATE POLICY "Limited public preview of scan results"
  ON public.market_scan_results
  FOR SELECT TO anon
  USING (approved_for_live_scanner = true AND scan_date >= current_date - interval '7 days');

-- 3. Remove anon access to pipeline health checks
DROP POLICY IF EXISTS "Anon can read health checks" ON public.pipeline_health_checks;

-- 4. Fix mutable search_path on update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;
