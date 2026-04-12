
CREATE OR REPLACE FUNCTION public.backfill_yahoo_batch_logged(p_batch_size integer DEFAULT 5, p_min_bars integer DEFAULT 260)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '900000'
AS $function$
DECLARE
  v_log_id uuid;
  v_start timestamptz := clock_timestamp();
  v_symbol text;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_processed int := 0;
  v_failed int := 0;
  v_total_bars int := 0;
  v_err text;
  v_existing_run_id uuid;
BEGIN
  -- OVERLAP GUARD: check for already-running backfill (started < 30 min ago)
  SELECT id INTO v_existing_run_id
  FROM public.data_sync_log
  WHERE sync_type = 'yahoo_backfill'
    AND status = 'running'
    AND started_at > clock_timestamp() - INTERVAL '30 minutes'
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_existing_run_id IS NOT NULL THEN
    -- Log the skip and exit
    INSERT INTO public.data_sync_log (
      sync_type, status, data_source, metadata, started_at, completed_at,
      symbols_processed, symbols_failed
    ) VALUES (
      'yahoo_backfill', 'skipped', 'yahoo_finance',
      jsonb_build_object(
        'batch_size', p_batch_size,
        'min_bars_threshold', p_min_bars,
        'source', 'cron',
        'skip_reason', 'already_running',
        'existing_run_id', v_existing_run_id::text
      ),
      v_start, clock_timestamp(), 0, 0
    );
    RETURN;
  END IF;

  -- Log start
  INSERT INTO public.data_sync_log (
    sync_type, status, data_source, metadata, started_at
  ) VALUES (
    'yahoo_backfill', 'running', 'yahoo_finance',
    jsonb_build_object('batch_size', p_batch_size, 'min_bars_threshold', p_min_bars, 'source', 'cron'),
    v_start
  ) RETURNING id INTO v_log_id;

  -- Process batch: symbols with fewest bars first
  FOR v_symbol IN
    SELECT s.symbol
    FROM public.symbols s
    LEFT JOIN (
      SELECT dp.symbol, COUNT(*)::int AS bars
      FROM public.daily_prices dp GROUP BY dp.symbol
    ) pc ON pc.symbol = s.symbol
    WHERE s.is_active = true
      AND s.eligible_for_backfill = true
      AND COALESCE(pc.bars, 0) < p_min_bars
    ORDER BY COALESCE(pc.bars, 0) ASC, s.symbol ASC
    LIMIT p_batch_size
  LOOP
    BEGIN
      v_result := public.backfill_symbol_yahoo(v_symbol);
      v_processed := v_processed + 1;

      IF (v_result->>'ok')::boolean THEN
        v_total_bars := v_total_bars + COALESCE((v_result->>'bars')::int, 0);
      ELSE
        v_failed := v_failed + 1;
      END IF;

      v_results := v_results || jsonb_build_array(v_result);

      -- Rate-limit: 3s pause between symbols
      PERFORM pg_sleep(3);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_failed := v_failed + 1;
      v_processed := v_processed + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object('ok', false, 'symbol', v_symbol, 'error', v_err)
      );
    END;
  END LOOP;

  -- Log completion
  UPDATE public.data_sync_log
  SET status = CASE
        WHEN v_processed = 0 THEN 'success'
        WHEN v_failed = 0 THEN 'success'
        WHEN v_failed < v_processed THEN 'partial'
        ELSE 'error'
      END,
      symbols_processed = v_processed,
      symbols_failed = v_failed,
      completed_at = clock_timestamp(),
      metadata = jsonb_build_object(
        'batch_size', p_batch_size,
        'min_bars_threshold', p_min_bars,
        'source', 'cron',
        'total_bars_inserted', v_total_bars,
        'duration_ms', EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000,
        'per_symbol', v_results
      )
  WHERE id = v_log_id;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  UPDATE public.data_sync_log
  SET status = 'error',
      completed_at = clock_timestamp(),
      error_message = v_err,
      metadata = jsonb_build_object(
        'batch_size', p_batch_size,
        'source', 'cron',
        'duration_ms', EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000
      )
  WHERE id = v_log_id;
END;
$function$;
