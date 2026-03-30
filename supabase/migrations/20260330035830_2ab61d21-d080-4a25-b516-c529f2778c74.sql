
-- Remove the authenticated policy on market_scan_runs (keep only service_role)
DROP POLICY IF EXISTS "Authenticated can read market scan runs safe" ON public.market_scan_runs;
