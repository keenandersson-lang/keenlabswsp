
-- 1. Create logged wrapper
CREATE OR REPLACE FUNCTION public.materialize_wsp_indicators_logged(
  p_from_date date DEFAULT CURRENT_DATE - INTERVAL '3 days',
  p_to_date date DEFAULT CURRENT_DATE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '900000'
AS $$
DECLARE
  v_log_id uuid;
  v_start timestamptz := clock_timestamp();
  v_err text;
BEGIN
  INSERT INTO public.data_sync_log (sync_type, status, data_source, metadata, started_at)
  VALUES (
    'indicator_materialize', 'running', 'rpc_materialize_wsp_indicators',
    jsonb_build_object('from_date', p_from_date::text, 'to_date', p_to_date::text, 'source', 'cron'),
    v_start
  )
  RETURNING id INTO v_log_id;

  BEGIN
    PERFORM public.materialize_wsp_indicators(p_from_date, p_to_date);

    UPDATE public.data_sync_log
    SET status = 'success',
        completed_at = clock_timestamp(),
        metadata = jsonb_build_object(
          'from_date', p_from_date::text,
          'to_date', p_to_date::text,
          'source', 'cron',
          'duration_ms', EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000
        )
    WHERE id = v_log_id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    UPDATE public.data_sync_log
    SET status = 'error',
        completed_at = clock_timestamp(),
        error_message = v_err,
        metadata = jsonb_build_object(
          'from_date', p_from_date::text,
          'to_date', p_to_date::text,
          'source', 'cron',
          'duration_ms', EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000
        )
    WHERE id = v_log_id;
  END;
END;
$$;

-- 2. Re-route cron to use logged wrapper
SELECT cron.unschedule('daily-indicators');

SELECT cron.schedule(
  'daily-indicators',
  '0 5 * * *',
  $$SELECT public.materialize_wsp_indicators_logged()$$
);
