
-- 1. Health check results table
CREATE TABLE public.pipeline_health_checks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL DEFAULT gen_random_uuid(),
  check_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'warning', 'critical')),
  message text NOT NULL,
  current_value text,
  threshold text,
  checked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_health_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read health checks"
  ON public.pipeline_health_checks FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Anon can read health checks"
  ON public.pipeline_health_checks FOR SELECT
  TO anon USING (true);

CREATE POLICY "Service role can manage health checks"
  ON public.pipeline_health_checks FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_health_checks_run ON public.pipeline_health_checks (run_id);
CREATE INDEX idx_health_checks_status ON public.pipeline_health_checks (status, checked_at DESC);

-- 2. Health check function
CREATE OR REPLACE FUNCTION public.run_pipeline_health_checks()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'America/New_York')::date;
  -- Day-of-week aware: on weekends/Monday morning, allow more staleness
  v_dow int := EXTRACT(DOW FROM v_today); -- 0=Sun,6=Sat
  v_is_weekend boolean := v_dow IN (0, 6);
  v_price_warn_hours int := CASE WHEN v_is_weekend THEN 72 ELSE 26 END;
  v_price_crit_hours int := CASE WHEN v_is_weekend THEN 96 ELSE 48 END;

  v_latest_price_date date;
  v_latest_indicator_date date;
  v_latest_scan_completed timestamptz;
  v_latest_scan_symbols bigint;
  v_prev_scan_symbols bigint;
  v_benchmark_date date;
  v_stale_jobs int;
  v_price_symbols bigint;
  v_indicator_symbols bigint;
  v_screener_symbols bigint;
  v_sector_count int;
  v_backfill_remaining bigint;
  v_status text;
  v_msg text;
BEGIN
  -- Delete previous run results (keep only latest)
  DELETE FROM public.pipeline_health_checks;

  -- Gather metrics
  SELECT MAX(date) INTO v_latest_price_date FROM daily_prices;
  SELECT MAX(calc_date) INTO v_latest_indicator_date FROM wsp_indicators;
  
  SELECT completed_at, symbols_scanned INTO v_latest_scan_completed, v_latest_scan_symbols
  FROM market_scan_runs WHERE status IN ('completed', 'partial')
  ORDER BY completed_at DESC NULLS LAST LIMIT 1;

  SELECT symbols_scanned INTO v_prev_scan_symbols
  FROM market_scan_runs WHERE status IN ('completed', 'partial')
  ORDER BY completed_at DESC NULLS LAST LIMIT 1 OFFSET 1;

  SELECT MAX(calc_date) INTO v_benchmark_date
  FROM wsp_indicators WHERE symbol IN ('SPY', 'QQQ');

  SELECT COUNT(*) INTO v_stale_jobs
  FROM data_sync_log WHERE status = 'running' AND started_at < v_now - INTERVAL '30 minutes';

  SELECT COUNT(DISTINCT symbol) INTO v_price_symbols FROM daily_prices;
  SELECT COUNT(DISTINCT symbol) INTO v_indicator_symbols FROM wsp_indicators;
  SELECT COUNT(DISTINCT symbol) INTO v_screener_symbols FROM market_scan_results_latest;

  SELECT COUNT(DISTINCT canonical_sector) INTO v_sector_count
  FROM symbols WHERE is_active = true
    AND canonical_sector IS NOT NULL AND canonical_sector NOT IN ('Unknown', '');

  SELECT COUNT(*) INTO v_backfill_remaining
  FROM symbols s
  LEFT JOIN (SELECT symbol, COUNT(*) AS bars FROM daily_prices GROUP BY symbol) pc ON pc.symbol = s.symbol
  WHERE s.is_active = true AND s.eligible_for_backfill = true AND COALESCE(pc.bars, 0) < 260;

  -- CHECK 1: Price freshness
  IF v_latest_price_date IS NULL THEN
    v_status := 'critical'; v_msg := 'No price data exists';
  ELSIF v_now - (v_latest_price_date + TIME '21:30')::timestamptz > (v_price_crit_hours || ' hours')::interval THEN
    v_status := 'critical'; v_msg := 'Price data is critically stale: ' || v_latest_price_date::text;
  ELSIF v_now - (v_latest_price_date + TIME '21:30')::timestamptz > (v_price_warn_hours || ' hours')::interval THEN
    v_status := 'warning'; v_msg := 'Price data may be stale: ' || v_latest_price_date::text;
  ELSE
    v_status := 'ok'; v_msg := 'Price data fresh: ' || v_latest_price_date::text;
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'price_freshness', v_status, v_msg, v_latest_price_date::text,
    v_price_warn_hours || 'h warn / ' || v_price_crit_hours || 'h crit');

  -- CHECK 2: Indicator freshness
  IF v_latest_indicator_date IS NULL THEN
    v_status := 'critical'; v_msg := 'No indicator data exists';
  ELSIF v_latest_indicator_date < v_latest_price_date - 1 THEN
    v_status := 'critical'; v_msg := 'Indicators lag prices by >1 day: ' || v_latest_indicator_date::text || ' vs ' || v_latest_price_date::text;
  ELSIF v_latest_indicator_date < v_latest_price_date THEN
    v_status := 'warning'; v_msg := 'Indicators 1 day behind prices: ' || v_latest_indicator_date::text;
  ELSE
    v_status := 'ok'; v_msg := 'Indicators aligned with prices: ' || v_latest_indicator_date::text;
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'indicator_freshness', v_status, v_msg, v_latest_indicator_date::text, 'must match latest price date');

  -- CHECK 3: Scan freshness
  IF v_latest_scan_completed IS NULL THEN
    v_status := 'critical'; v_msg := 'No completed scan found';
  ELSIF v_now - v_latest_scan_completed > (v_price_crit_hours || ' hours')::interval THEN
    v_status := 'critical'; v_msg := 'Last scan critically stale: ' || v_latest_scan_completed::text;
  ELSIF v_now - v_latest_scan_completed > (v_price_warn_hours || ' hours')::interval THEN
    v_status := 'warning'; v_msg := 'Last scan may be stale: ' || v_latest_scan_completed::text;
  ELSE
    v_status := 'ok'; v_msg := 'Scan fresh: ' || v_latest_scan_completed::text;
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'scan_freshness', v_status, v_msg, v_latest_scan_completed::text,
    v_price_warn_hours || 'h warn / ' || v_price_crit_hours || 'h crit');

  -- CHECK 4: Benchmark freshness
  IF v_benchmark_date IS NULL THEN
    v_status := 'critical'; v_msg := 'No benchmark indicator data (SPY/QQQ)';
  ELSIF v_benchmark_date < v_latest_price_date THEN
    v_status := 'warning'; v_msg := 'Benchmark indicators behind prices: ' || v_benchmark_date::text;
  ELSE
    v_status := 'ok'; v_msg := 'Benchmark indicators fresh: ' || v_benchmark_date::text;
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'benchmark_freshness', v_status, v_msg, v_benchmark_date::text, 'must match latest price date');

  -- CHECK 5: Stale running jobs
  IF v_stale_jobs > 2 THEN
    v_status := 'critical'; v_msg := v_stale_jobs || ' jobs stuck in running >30min';
  ELSIF v_stale_jobs > 0 THEN
    v_status := 'warning'; v_msg := v_stale_jobs || ' job(s) stuck in running >30min';
  ELSE
    v_status := 'ok'; v_msg := 'No stale running jobs';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'stale_jobs', v_status, v_msg, v_stale_jobs::text, '0 ok / 1-2 warn / 3+ crit');

  -- CHECK 6: Price coverage
  IF v_price_symbols < 1000 THEN
    v_status := 'critical'; v_msg := 'Price coverage critically low: ' || v_price_symbols;
  ELSIF v_price_symbols < 3000 THEN
    v_status := 'warning'; v_msg := 'Price coverage below target: ' || v_price_symbols;
  ELSE
    v_status := 'ok'; v_msg := 'Price coverage healthy: ' || v_price_symbols || ' symbols';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'price_coverage', v_status, v_msg, v_price_symbols::text, '3000 warn / 1000 crit');

  -- CHECK 7: Screener population
  IF v_screener_symbols < 500 THEN
    v_status := 'critical'; v_msg := 'Screener population critically low: ' || v_screener_symbols;
  ELSIF v_screener_symbols < 2000 THEN
    v_status := 'warning'; v_msg := 'Screener population below target: ' || v_screener_symbols;
  ELSE
    v_status := 'ok'; v_msg := 'Screener population healthy: ' || v_screener_symbols || ' symbols';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'screener_population', v_status, v_msg, v_screener_symbols::text, '2000 warn / 500 crit');

  -- CHECK 8: Scan population drop (>20% drop = warning, >40% = critical)
  IF v_prev_scan_symbols IS NOT NULL AND v_prev_scan_symbols > 0 AND v_latest_scan_symbols IS NOT NULL THEN
    DECLARE v_drop_pct numeric := ROUND((1.0 - v_latest_scan_symbols::numeric / v_prev_scan_symbols) * 100, 1);
    BEGIN
      IF v_drop_pct > 40 THEN
        v_status := 'critical'; v_msg := 'Scan population dropped ' || v_drop_pct || '% (' || v_prev_scan_symbols || ' → ' || v_latest_scan_symbols || ')';
      ELSIF v_drop_pct > 20 THEN
        v_status := 'warning'; v_msg := 'Scan population dropped ' || v_drop_pct || '% (' || v_prev_scan_symbols || ' → ' || v_latest_scan_symbols || ')';
      ELSE
        v_status := 'ok'; v_msg := 'Scan population stable (' || v_drop_pct || '% change)';
      END IF;
      INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
      VALUES (v_run_id, 'scan_population_change', v_status, v_msg,
        v_latest_scan_symbols::text || ' (prev: ' || v_prev_scan_symbols::text || ')', '>20% warn / >40% crit');
    END;
  ELSE
    INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
    VALUES (v_run_id, 'scan_population_change', 'ok', 'Insufficient history for comparison', NULL, '>20% warn / >40% crit');
  END IF;

  -- CHECK 9: Sector integrity
  IF v_sector_count < 10 THEN
    v_status := 'warning'; v_msg := 'Missing GICS sectors: only ' || v_sector_count || '/11 present';
  ELSE
    v_status := 'ok'; v_msg := 'All ' || v_sector_count || ' GICS sectors present';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'sector_integrity', v_status, v_msg, v_sector_count::text, '11 expected');

  -- CHECK 10: Backfill progress
  IF v_backfill_remaining > 900 THEN
    v_status := 'warning'; v_msg := v_backfill_remaining || ' symbols still below 260 bars';
  ELSE
    v_status := 'ok'; v_msg := v_backfill_remaining || ' symbols remaining below 260 bars';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'backfill_progress', v_status, v_msg, v_backfill_remaining::text, '<900 ok');

  -- CHECK 11: Indicator-to-price alignment
  IF v_latest_indicator_date IS NOT NULL AND v_latest_price_date IS NOT NULL 
     AND v_latest_price_date - v_latest_indicator_date > 2 THEN
    v_status := 'critical'; v_msg := 'Indicators lag prices by ' || (v_latest_price_date - v_latest_indicator_date) || ' days';
  ELSE
    v_status := 'ok'; v_msg := 'Indicator-price date gap acceptable';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'indicator_price_alignment', v_status, v_msg,
    COALESCE((v_latest_price_date - v_latest_indicator_date)::text, 'N/A'), '<=2 days ok / >2 crit');

  -- CHECK 12: Recent sync failures
  DECLARE v_recent_errors int;
  BEGIN
    SELECT COUNT(*) INTO v_recent_errors
    FROM data_sync_log
    WHERE status = 'error' AND started_at > v_now - INTERVAL '24 hours';

    IF v_recent_errors > 3 THEN
      v_status := 'critical'; v_msg := v_recent_errors || ' pipeline errors in last 24h';
    ELSIF v_recent_errors > 0 THEN
      v_status := 'warning'; v_msg := v_recent_errors || ' pipeline error(s) in last 24h';
    ELSE
      v_status := 'ok'; v_msg := 'No pipeline errors in last 24h';
    END IF;
    INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
    VALUES (v_run_id, 'recent_sync_errors', v_status, v_msg, v_recent_errors::text, '0 ok / 1-3 warn / 4+ crit');
  END;

  -- Log the health check run itself
  INSERT INTO data_sync_log (sync_type, status, data_source, metadata, started_at, completed_at)
  VALUES ('health_check', 'success', 'pipeline_health_checks',
    jsonb_build_object(
      'run_id', v_run_id,
      'checks_run', 12,
      'critical', (SELECT COUNT(*) FROM pipeline_health_checks WHERE run_id = v_run_id AND status = 'critical'),
      'warning', (SELECT COUNT(*) FROM pipeline_health_checks WHERE run_id = v_run_id AND status = 'warning'),
      'ok', (SELECT COUNT(*) FROM pipeline_health_checks WHERE run_id = v_run_id AND status = 'ok')
    ),
    v_now, clock_timestamp()
  );

  RETURN v_run_id;
END;
$$;

-- 3. Schedule health checks every 2 hours
SELECT cron.schedule(
  'pipeline-health-check',
  '0 */2 * * *',
  $$SELECT public.run_pipeline_health_checks()$$
);
