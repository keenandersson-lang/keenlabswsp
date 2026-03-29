
-- Re-add authenticated read on base table for admin diagnostics
CREATE POLICY "Authenticated can read market scan runs"
  ON public.market_scan_runs
  FOR SELECT
  TO authenticated
  USING (true);
