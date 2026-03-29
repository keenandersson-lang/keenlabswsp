-- Schedule enrich-symbols in sector-only mode every 5 minutes.
-- This calls the existing Edge Function with batchSize=50.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Replace existing job (if present)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enrich-symbols-sector-only') THEN
    PERFORM cron.unschedule('enrich-symbols-sector-only');
  END IF;
END $$;

SELECT cron.schedule(
  'enrich-symbols-sector-only',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := CONCAT(current_setting('app.settings.supabase_url'), '/functions/v1/enrich-symbols'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', CONCAT(
        'Bearer ',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sync_secret_key' LIMIT 1)
      )
    ),
    body := jsonb_build_object(
      'batchSize', 50,
      'sector_only', true
    )
  );
  $$
);
