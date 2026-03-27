
-- 1. Restrict data_sync_log to service_role only
DROP POLICY IF EXISTS "Anyone can read sync log" ON public.data_sync_log;
CREATE POLICY "Service role can read sync log"
  ON public.data_sync_log FOR SELECT
  TO service_role
  USING (true);

-- 2. Fix mutable search_path on functions
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.handle_new_user_credits() SET search_path = public;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public;
