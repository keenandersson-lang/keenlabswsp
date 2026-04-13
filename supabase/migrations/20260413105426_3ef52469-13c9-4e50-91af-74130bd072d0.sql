-- Fix: authenticated users need SELECT on market_scan_runs for the security_invoker view to work
CREATE POLICY "Authenticated can read market scan runs"
ON public.market_scan_runs
FOR SELECT
TO authenticated
USING (true);
