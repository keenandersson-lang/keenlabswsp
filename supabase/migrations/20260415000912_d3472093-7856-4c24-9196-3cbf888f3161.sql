-- Drop the overly restrictive anon policy
DROP POLICY IF EXISTS "Limited public preview of scan results" ON public.market_scan_results;

-- Replace with a policy that allows anon to read recent scan results (last 7 days)
CREATE POLICY "Anon can read recent scan results"
  ON public.market_scan_results
  FOR SELECT
  TO anon
  USING (scan_date >= (CURRENT_DATE - interval '7 days'));
