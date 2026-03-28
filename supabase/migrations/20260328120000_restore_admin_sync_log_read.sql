-- Restore read visibility for Admin sync-log panel.
-- data_sync_log writes remain service-role only via existing manage policy.
DROP POLICY IF EXISTS "Service role can read sync log" ON public.data_sync_log;
DROP POLICY IF EXISTS "Anyone can read sync log" ON public.data_sync_log;

CREATE POLICY "Authenticated users can read sync log"
  ON public.data_sync_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anon users can read sync log"
  ON public.data_sync_log FOR SELECT
  TO anon
  USING (true);
