
-- Update the enrich-symbols cron job to skip the daily-sync window (21:25-21:45 UTC)
-- Old schedule: */5 * * * * (every 5 minutes)
-- New schedule: every 5 minutes, but NOT during minute 25-45 of hour 21
-- We use two schedules merged: run at minutes 0,5,10,15,20,50,55 during hour 21, 
-- and every 5 min for all other hours.
-- Simplest approach: replace with a schedule that skips the 21:25-21:45 window.

SELECT cron.unschedule(5);

SELECT cron.schedule(
  'enrich-symbols-with-daily-sync-gap',
  '0,5,10,15,20,50,55 21 * * *',
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

SELECT cron.schedule(
  'enrich-symbols-non-daily-sync-hours',
  '*/5 0-20,22-23 * * *',
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
