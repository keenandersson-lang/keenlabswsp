DROP FUNCTION IF EXISTS public.run_pipeline_health_checks();

CREATE OR REPLACE FUNCTION public.run_pipeline_health_checks()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'America/New_York')::date;
  v_dow int := EXTRACT(DOW FROM v_today);
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
  v_canonical_industry_count int;
  v_unmapped_industry_count int;
  v_backfill_remaining bigint;
  v_public_eligible bigint;
  v_status text;
  v_msg text;
BEGIN
  DELETE FROM public.pipeline_health_checks WHERE true;

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

  SELECT COUNT(DISTINCT dp.symbol) INTO v_price_symbols 
  FROM daily_prices dp 
  JOIN symbols s ON s.symbol = dp.symbol 
  WHERE s.is_active = true AND COALESCE(s.is_etf, false) = false AND s.universe_tier != 'benchmark';
  
  SELECT COUNT(DISTINCT wi.symbol) INTO v_indicator_symbols 
  FROM wsp_indicators wi 
  JOIN symbols s ON s.symbol = wi.symbol 
  WHERE s.is_active = true AND COALESCE(s.is_etf, false) = false AND s.universe_tier != 'benchmark';
  
  SELECT COUNT(DISTINCT r.symbol) INTO v_screener_symbols 
  FROM market_scan_results_latest r
  JOIN symbols s ON s.symbol = r.symbol 
  WHERE s.is_active = true AND COALESCE(s.is_etf, false) = false;

  SELECT COUNT(DISTINCT r.symbol) INTO v_public_eligible
  FROM market_scan_results_latest r
  JOIN symbols s ON s.symbol = r.symbol
  WHERE s.is_active = true AND COALESCE(s.is_etf, false) = false
    AND s.canonical_sector IS NOT NULL
    AND EXISTS (SELECT 1 FROM canonical_gics_sectors cgs WHERE cgs.sector_name = s.canonical_sector)
    AND s.canonical_industry IS NOT NULL
    AND EXISTS (SELECT 1 FROM canonical_gics_industries gi WHERE gi.industry_name = s.canonical_industry);

  SELECT COUNT(DISTINCT s.canonical_sector) INTO v_sector_count
  FROM symbols s
  WHERE s.is_active = true AND COALESCE(s.is_etf, false) = false
    AND s.canonical_sector IS NOT NULL
    AND EXISTS (SELECT 1 FROM canonical_gics_sectors cgs WHERE cgs.sector_name = s.canonical_sector);

  SELECT COUNT(*) INTO v_canonical_industry_count
  FROM symbols s
  WHERE s.is_active = true AND COALESCE(s.is_etf, false) = false AND s.universe_tier != 'benchmark'
    AND s.canonical_industry IS NOT NULL
    AND EXISTS (SELECT 1 FROM canonical_gics_industries gi WHERE gi.industry_name = s.canonical_industry);

  SELECT COUNT(*) INTO v_unmapped_industry_count
  FROM symbols s
  WHERE s.is_active = true AND COALESCE(s.is_etf, false) = false AND s.universe_tier != 'benchmark'
    AND (s.canonical_industry IS NULL 
      OR NOT EXISTS (SELECT 1 FROM canonical_gics_industries gi WHERE gi.industry_name = s.canonical_industry));

  SELECT COUNT(*) INTO v_backfill_remaining
  FROM symbols s
  LEFT JOIN (SELECT symbol, COUNT(*) AS bars FROM daily_prices GROUP BY symbol) pc ON pc.symbol = s.symbol
  WHERE s.is_active = true AND s.eligible_for_backfill = true AND COALESCE(pc.bars, 0) < 260;

  -- CHECK 1: Price freshness (weekend-aware)
  IF v_latest_price_date IS NULL THEN
    v_status := 'critical'; v_msg := 'No price data exists';
  ELSIF v_now - (v_latest_price_date + TIME '21:30')::timestamptz > (v_price_crit_hours || ' hours')::interval THEN
    v_status := 'critical'; v_msg := 'Price data critically stale: ' || v_latest_price_date::text;
  ELSIF v_now - (v_latest_price_date + TIME '21:30')::timestamptz > (v_price_warn_hours || ' hours')::interval THEN
    v_status := 'warning'; v_msg := 'Price data may be stale: ' || v_latest_price_date::text;
  ELSE
    v_status := 'ok'; v_msg := 'Price data fresh: ' || v_latest_price_date::text || ' (weekend-aware)';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'price_freshness', v_status, v_msg, v_latest_price_date::text,
    v_price_warn_hours || 'h warn / ' || v_price_crit_hours || 'h crit');

  -- CHECK 2: Indicator freshness
  IF v_latest_indicator_date IS NULL THEN
    v_status := 'critical'; v_msg := 'No indicator data exists';
  ELSIF v_latest_indicator_date < v_latest_price_date - 1 THEN
    v_status := 'critical'; v_msg := 'Indicators lag prices by >1 day: ' || v_latest_indicator_date::text;
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
    v_status := 'warning'; v_msg := 'Scan may be stale: ' || v_latest_scan_completed::text;
  ELSE
    v_status := 'ok'; v_msg := 'Scan fresh: ' || v_latest_scan_completed::text;
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'scan_freshness', v_status, v_msg, v_latest_scan_completed::text,
    v_price_warn_hours || 'h warn / ' || v_price_crit_hours || 'h crit');

  -- CHECK 4: Benchmark freshness
  IF v_benchmark_date IS NULL THEN
    v_status := 'critical'; v_msg := 'No benchmark indicator data';
  ELSIF v_benchmark_date < v_latest_price_date - 1 THEN
    v_status := 'warning'; v_msg := 'Benchmark data behind: ' || v_benchmark_date::text;
  ELSE
    v_status := 'ok'; v_msg := 'Benchmark data fresh: ' || v_benchmark_date::text;
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'benchmark_freshness', v_status, v_msg, v_benchmark_date::text, 'must match latest price date');

  -- CHECK 5: GICS sector coverage (exactly 11 canonical sectors)
  IF v_sector_count = 11 THEN
    v_status := 'ok'; v_msg := 'All 11 canonical GICS sectors represented';
  ELSIF v_sector_count >= 9 THEN
    v_status := 'warning'; v_msg := v_sector_count || ' of 11 GICS sectors have equity coverage';
  ELSE
    v_status := 'critical'; v_msg := 'Only ' || v_sector_count || ' of 11 GICS sectors have equity coverage';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'gics_sector_coverage', v_status, v_msg, v_sector_count::text, '11');

  -- CHECK 6: Canonical industry coverage
  IF v_unmapped_industry_count = 0 THEN
    v_status := 'ok'; v_msg := 'All equity symbols have canonical GICS industry';
  ELSIF v_unmapped_industry_count < 500 THEN
    v_status := 'warning'; v_msg := v_unmapped_industry_count || ' equity symbols lack canonical GICS industry';
  ELSE
    v_status := 'critical'; v_msg := v_unmapped_industry_count || ' equity symbols lack canonical GICS industry (of ' || (v_canonical_industry_count + v_unmapped_industry_count) || ' total)';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'gics_industry_coverage', v_status, v_msg, 
    v_canonical_industry_count || ' mapped / ' || v_unmapped_industry_count || ' unmapped', '< 500 unmapped');

  -- CHECK 7: Stale jobs
  IF v_stale_jobs > 0 THEN
    v_status := 'warning'; v_msg := v_stale_jobs || ' jobs stuck in running state > 30 min';
  ELSE
    v_status := 'ok'; v_msg := 'No stale jobs';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'stale_jobs', v_status, v_msg, v_stale_jobs::text, '0');

  -- CHECK 8: Scan population stability
  IF v_latest_scan_symbols IS NOT NULL AND v_prev_scan_symbols IS NOT NULL AND v_prev_scan_symbols > 0 THEN
    IF v_latest_scan_symbols < v_prev_scan_symbols * 0.90 THEN
      v_status := 'critical'; v_msg := 'Scan population dropped >10%: ' || v_latest_scan_symbols || ' vs prev ' || v_prev_scan_symbols;
    ELSE
      v_status := 'ok'; v_msg := 'Scan population stable: ' || v_latest_scan_symbols || ' (raw scanned)';
    END IF;
  ELSE
    v_status := 'ok'; v_msg := 'Scan population: ' || COALESCE(v_latest_scan_symbols::text, 'N/A');
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'scan_population_stability', v_status, v_msg, 
    COALESCE(v_latest_scan_symbols::text, '0'), '>= 90% of previous');

  -- CHECK 9: Backfill remaining
  IF v_backfill_remaining = 0 THEN
    v_status := 'ok'; v_msg := 'All backfill-eligible symbols have >= 260 bars';
  ELSIF v_backfill_remaining < 100 THEN
    v_status := 'ok'; v_msg := v_backfill_remaining || ' symbols still need history backfill';
  ELSE
    v_status := 'warning'; v_msg := v_backfill_remaining || ' symbols need history backfill (< 260 bars)';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'backfill_remaining', v_status, v_msg, v_backfill_remaining::text, '< 100');

  -- CHECK 10: Pipeline coverage (info) — raw scanned vs public eligible
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'equity_pipeline_coverage', 'info', 
    'Pipeline: ' || v_price_symbols || ' prices → ' || v_indicator_symbols || ' indicators → ' || v_screener_symbols || ' scanned → ' || v_public_eligible || ' public eligible',
    v_price_symbols || '/' || v_indicator_symbols || '/' || v_screener_symbols || '/' || v_public_eligible, 'info only');

  RETURN v_run_id::text;
END;
$$;