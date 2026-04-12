
SELECT cron.unschedule('weekly-yahoo-backfill');

SELECT cron.schedule(
  'daily-yahoo-backfill',
  '0 3 * * 1-6',
  $$SELECT public.backfill_yahoo_batch_logged(10, 260)$$
);
