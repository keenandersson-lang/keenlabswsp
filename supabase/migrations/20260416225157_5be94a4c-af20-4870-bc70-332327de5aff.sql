-- ============================================================
-- 1) Bootstrap job tracking table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bootstrap_jobs (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued', -- queued|running|paused|completed|failed|stopped
  current_step TEXT,
  current_step_idx INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 7,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of {id,label,status,detail,started_at,finished_at}
  error_message TEXT,
  requested_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  control_signal TEXT, -- pause|resume|stop (read by orchestrator between steps)
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bootstrap_jobs_status ON public.bootstrap_jobs(status, started_at DESC);

ALTER TABLE public.bootstrap_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS srv_bootstrap_jobs ON public.bootstrap_jobs;
CREATE POLICY srv_bootstrap_jobs ON public.bootstrap_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS auth_read_bootstrap_jobs ON public.bootstrap_jobs;
CREATE POLICY auth_read_bootstrap_jobs ON public.bootstrap_jobs FOR SELECT TO authenticated USING (true);

-- Helper: get latest active or recent job
CREATE OR REPLACE FUNCTION public.get_latest_bootstrap_job()
RETURNS public.bootstrap_jobs
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.bootstrap_jobs ORDER BY started_at DESC LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_bootstrap_job() TO anon, authenticated, service_role;

-- ============================================================
-- 2) Auto-backfill loop: every 5 min dispatch a batch if any symbols still need history
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove old jobs if they exist
DO $$
DECLARE jid BIGINT;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname IN (
    'wsp_auto_backfill_loop',
    'wsp_daily_full_pipeline',
    'wsp_daily_indicators',
    'wsp_daily_publish'
  ) LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

-- Auto-backfill loop: every 5 min, run a batch only if symbols are still missing history
SELECT cron.schedule(
  'wsp_auto_backfill_loop',
  '*/5 * * * *',
  $cron$
  DO $body$
  DECLARE
    needing_count INTEGER;
    already_running INTEGER;
  BEGIN
    -- Skip if a backfill is currently running
    SELECT COUNT(*) INTO already_running
    FROM public.data_sync_log
    WHERE sync_type = 'yahoo_backfill'
      AND status = 'running'
      AND started_at >= now() - INTERVAL '20 minutes';
    IF already_running > 0 THEN RETURN; END IF;

    -- Check if any symbols still need backfill
    SELECT COUNT(*) INTO needing_count FROM public.get_symbols_needing_backfill(1, 0);
    IF needing_count = 0 THEN RETURN; END IF;

    PERFORM public.backfill_yahoo_batch_logged(50, 260);
  END
  $body$;
  $cron$
);

-- ============================================================
-- 3) Daily full pipeline (after US close): 23:30 UTC Mon-Fri
--    Triggers daily-sync, which we then chain via the orchestrator.
--    The orchestrator runs daily-sync -> indicators -> scan -> publish.
-- ============================================================
SELECT cron.schedule(
  'wsp_daily_full_pipeline',
  '30 23 * * 1-5',
  $cron$
  SELECT net.http_post(
    url := 'https://xvdhpztohozxdsxcsidf.supabase.co/functions/v1/bootstrap-orchestrator',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'mode', 'daily',
      'requested_by', 'pg_cron_daily',
      'steps', jsonb_build_array('daily-sync','indicators','scan','publish','health')
    )
  );
  $cron$
);