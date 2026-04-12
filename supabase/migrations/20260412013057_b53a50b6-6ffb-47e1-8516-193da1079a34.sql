
-- 1. Route daily-broad-scan through the scan-market Edge Function for full logging
SELECT cron.unschedule('daily-broad-scan');

SELECT cron.schedule(
  'daily-broad-scan',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := CONCAT(current_setting('app.settings.supabase_url'), '/functions/v1/scan-market'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', CONCAT(
        'Bearer ',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sync_secret_key' LIMIT 1)
      )
    ),
    body := jsonb_build_object(
      'asOfDate', CURRENT_DATE::text,
      'runLabel', 'cron_daily'
    )
  ) AS request_id;
  $$
);

-- 2. Auto-close stale jobs (>30 min in running state)
SELECT cron.schedule(
  'daily-stale-job-cleanup',
  '*/15 * * * *',
  $$
  UPDATE public.data_sync_log
  SET status = 'stale_closed',
      completed_at = now(),
      error_message = 'Auto-closed: exceeded 30-minute max runtime'
  WHERE status = 'running'
    AND started_at < now() - INTERVAL '30 minutes';
  $$
);
