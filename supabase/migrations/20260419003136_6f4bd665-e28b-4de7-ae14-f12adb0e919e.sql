-- Watchdog: auto-fail bootstrap_jobs that have been running but not updated for >15 min
CREATE OR REPLACE FUNCTION public.bootstrap_jobs_watchdog()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH updated AS (
    UPDATE public.bootstrap_jobs
       SET status = 'failed',
           finished_at = now(),
           error_message = COALESCE(error_message, '') ||
             CASE WHEN error_message IS NULL OR error_message = '' THEN '' ELSE E'\n' END ||
             'Watchdog: no heartbeat for >15 min — orchestrator process likely died. Auto-failed at ' || now()::text
     WHERE status IN ('running', 'queued')
       AND updated_at < now() - interval '15 minutes'
     RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;
  RETURN v_count;
END;
$$;

-- Schedule watchdog every 5 minutes
SELECT cron.unschedule('bootstrap_jobs_watchdog')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bootstrap_jobs_watchdog');

SELECT cron.schedule(
  'bootstrap_jobs_watchdog',
  '*/5 * * * *',
  $$ SELECT public.bootstrap_jobs_watchdog(); $$
);

-- Faster auto-enrich loop — multi-source means we can call it every 2 minutes
-- with batch=100 instead of 15. Replace the existing loop.
DO $$
DECLARE
  v_url text;
  v_anon text;
BEGIN
  -- Unschedule old loop if present
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wsp_auto_enrich_loop') THEN
    PERFORM cron.unschedule('wsp_auto_enrich_loop');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wsp_auto_enrich_loop_fast') THEN
    PERFORM cron.unschedule('wsp_auto_enrich_loop_fast');
  END IF;
END $$;

-- New fast loop: every 2 min, batch=100, multi-source fallback inside the function
SELECT cron.schedule(
  'wsp_auto_enrich_loop_fast',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://xvdhpztohozxdsxcsidf.supabase.co/functions/v1/bulk-enrich-sectors',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer wsp_sync_test_2026_april_13'
    ),
    body := jsonb_build_object('maxSymbols', 100)
  );
  $$
);
