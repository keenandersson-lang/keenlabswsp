-- Beta-truth guardrails:
-- 1) enforce canonical sector/industry pairing at symbol level
-- 2) make all public beta surfaces read from latest published canonical snapshot
-- 3) make admin coverage semantics explicit
-- 4) make health checks snapshot-scoped (11-sector model)

-- ---------------------------------------------------------------------------
-- Symbol-level canonical consistency: sector must match canonical industry
-- ---------------------------------------------------------------------------
UPDATE public.symbols s
SET canonical_sector = cgs.sector_name
FROM public.canonical_gics_industries cgi
JOIN public.canonical_gics_sectors cgs ON cgs.sector_code = cgi.sector_code
WHERE s.canonical_industry = cgi.industry_name
  AND COALESCE(s.is_etf, false) = false
  AND s.is_active = true
  AND COALESCE(s.canonical_sector, '') <> cgs.sector_name;

-- ---------------------------------------------------------------------------
-- Canonical latest published snapshot helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_latest_published_equity_snapshot_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ds.snapshot_id
  FROM public.data_snapshots ds
  WHERE ds.asset_class = 'equities'
    AND ds.is_canonical = true
    AND ds.status = 'published'
  ORDER BY COALESCE(ds.completed_at, ds.started_at) DESC, ds.snapshot_id DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_public_beta_snapshot_status()
RETURNS TABLE(snapshot_id bigint, source_layer text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.get_latest_published_equity_snapshot_id() AS snapshot_id,
    'screener_rows_materialized@latest_published_canonical_snapshot'::text AS source_layer;
$$;

-- ---------------------------------------------------------------------------
-- Public screener + rankings: single source of truth = published snapshot
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_equity_screener_rows(text, integer, integer, text, text, text);
DROP FUNCTION IF EXISTS public.get_equity_screener_count(text, text, text, text);
DROP FUNCTION IF EXISTS public.get_top_wsp_setups();
DROP FUNCTION IF EXISTS public.get_industry_ranking(boolean, integer);
DROP FUNCTION IF EXISTS public.get_heatmap_data();
DROP FUNCTION IF EXISTS public.get_market_summary();

CREATE OR REPLACE FUNCTION public.get_equity_screener_rows(
  p_universe_tier text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
  p_sector text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_pattern text DEFAULT NULL
)
RETURNS TABLE(
  symbol text, sector text, industry text, pattern_state text,
  recommendation text, wsp_score integer, payload jsonb,
  blockers text[], breakout_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH canonical AS (
    SELECT public.get_latest_published_equity_snapshot_id() AS sid
  )
  SELECT
    srm.symbol,
    sym.canonical_sector AS sector,
    sym.canonical_industry AS industry,
    srm.pattern_state,
    srm.recommendation,
    COALESCE(srm.wsp_score, 0)::int AS wsp_score,
    srm.payload,
    srm.blockers,
    CASE
      WHEN srm.breakout_freshness IS NULL THEN 'NONE'
      WHEN srm.breakout_freshness = 'fresh' THEN 'FRESH_BREAKOUT'
      WHEN srm.breakout_freshness = 'approaching' THEN 'APPROACHING'
      WHEN srm.breakout_freshness = 'aging' THEN 'AGING_BREAKOUT'
      WHEN srm.breakout_freshness = 'stale' THEN 'STALE_BREAKOUT'
      WHEN srm.breakout_freshness = 'failed' THEN 'FAILED_BREAKOUT'
      ELSE upper(srm.breakout_freshness)
    END AS breakout_status
  FROM public.screener_rows_materialized srm
  JOIN canonical c ON srm.snapshot_id = c.sid
  JOIN public.symbols sym ON sym.symbol = srm.symbol
  WHERE sym.is_active = true
    AND COALESCE(sym.is_etf, false) = false
    AND sym.universe_tier IN ('core', 'expanded')
    AND sym.canonical_sector IS NOT NULL
    AND sym.canonical_industry IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.canonical_gics_sectors cgs WHERE cgs.sector_name = sym.canonical_sector)
    AND EXISTS (SELECT 1 FROM public.canonical_gics_industries cgi WHERE cgi.industry_name = sym.canonical_industry)
    AND (p_universe_tier IS NULL OR sym.universe_tier = p_universe_tier)
    AND (p_sector IS NULL OR sym.canonical_sector = p_sector)
    AND (p_industry IS NULL OR sym.canonical_industry = p_industry)
    AND (p_pattern IS NULL OR lower(COALESCE(srm.pattern_state, '')) = lower(p_pattern))
  ORDER BY COALESCE(srm.wsp_score, 0) DESC, srm.symbol
  LIMIT p_page_size OFFSET GREATEST(p_page - 1, 0) * p_page_size;
$$;

CREATE OR REPLACE FUNCTION public.get_equity_screener_count(
  p_universe_tier text DEFAULT NULL,
  p_sector text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_pattern text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH canonical AS (
    SELECT public.get_latest_published_equity_snapshot_id() AS sid
  )
  SELECT COUNT(*)::int
  FROM public.screener_rows_materialized srm
  JOIN canonical c ON srm.snapshot_id = c.sid
  JOIN public.symbols sym ON sym.symbol = srm.symbol
  WHERE sym.is_active = true
    AND COALESCE(sym.is_etf, false) = false
    AND sym.universe_tier IN ('core', 'expanded')
    AND sym.canonical_sector IS NOT NULL
    AND sym.canonical_industry IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.canonical_gics_sectors cgs WHERE cgs.sector_name = sym.canonical_sector)
    AND EXISTS (SELECT 1 FROM public.canonical_gics_industries cgi WHERE cgi.industry_name = sym.canonical_industry)
    AND (p_universe_tier IS NULL OR sym.universe_tier = p_universe_tier)
    AND (p_sector IS NULL OR sym.canonical_sector = p_sector)
    AND (p_industry IS NULL OR sym.canonical_industry = p_industry)
    AND (p_pattern IS NULL OR lower(COALESCE(srm.pattern_state, '')) = lower(p_pattern));
$$;

CREATE OR REPLACE FUNCTION public.get_top_wsp_setups()
RETURNS TABLE(symbol text, score integer, pattern text, recommendation text, vol_ratio numeric, sector text, industry text, payload jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH canonical AS (
    SELECT public.get_latest_published_equity_snapshot_id() AS sid
  )
  SELECT
    srm.symbol,
    COALESCE(srm.wsp_score, 0)::int AS score,
    srm.pattern_state AS pattern,
    srm.recommendation,
    COALESCE(srm.volume_ratio, (srm.payload->>'volume_ratio')::numeric) AS vol_ratio,
    sym.canonical_sector AS sector,
    sym.canonical_industry AS industry,
    srm.payload
  FROM public.screener_rows_materialized srm
  JOIN canonical c ON srm.snapshot_id = c.sid
  JOIN public.symbols sym ON sym.symbol = srm.symbol
  WHERE sym.is_active = true
    AND COALESCE(sym.is_etf, false) = false
    AND sym.universe_tier IN ('core', 'expanded')
    AND sym.canonical_sector IS NOT NULL
    AND sym.canonical_industry IS NOT NULL
    AND srm.recommendation IN ('KÖP', 'BEVAKA')
    AND COALESCE(srm.wsp_score, 0) >= 3
  ORDER BY COALESCE(srm.wsp_score, 0) DESC, COALESCE(srm.volume_ratio, (srm.payload->>'volume_ratio')::numeric) DESC NULLS LAST
  LIMIT 20;
$$;

CREATE OR REPLACE FUNCTION public.get_market_summary()
RETURNS TABLE(
  sector_name text,
  symbol_count bigint,
  avg_pct_today numeric,
  pct_above_ma50 numeric,
  avg_wsp_score numeric,
  wsp_setups bigint,
  top_pattern text,
  wsp_regime text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH canonical AS (
    SELECT public.get_latest_published_equity_snapshot_id() AS sid
  ),
  base AS (
    SELECT
      sym.canonical_sector AS sector_name,
      srm.daily_pct,
      srm.validity,
      srm.wsp_score,
      srm.pattern_state
    FROM public.screener_rows_materialized srm
    JOIN canonical c ON srm.snapshot_id = c.sid
    JOIN public.symbols sym ON sym.symbol = srm.symbol
    WHERE sym.is_active = true
      AND COALESCE(sym.is_etf, false) = false
      AND sym.universe_tier IN ('core', 'expanded')
      AND sym.canonical_sector IS NOT NULL
      AND sym.canonical_industry IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.canonical_gics_sectors cgs WHERE cgs.sector_name = sym.canonical_sector)
      AND EXISTS (SELECT 1 FROM public.canonical_gics_industries cgi WHERE cgi.industry_name = sym.canonical_industry)
  )
  SELECT
    b.sector_name,
    COUNT(*) AS symbol_count,
    ROUND(AVG(COALESCE(b.daily_pct, 0))::numeric, 2) AS avg_pct_today,
    ROUND(100.0 * COUNT(*) FILTER (WHERE b.validity = true) / NULLIF(COUNT(*), 0), 1) AS pct_above_ma50,
    ROUND(AVG(COALESCE(b.wsp_score, 0))::numeric, 1) AS avg_wsp_score,
    COUNT(*) FILTER (WHERE COALESCE(b.wsp_score, 0) >= 3) AS wsp_setups,
    MODE() WITHIN GROUP (ORDER BY COALESCE(b.pattern_state, 'base')) AS top_pattern,
    CASE
      WHEN 100.0 * COUNT(*) FILTER (WHERE b.validity = true) / NULLIF(COUNT(*), 0) >= 60 THEN 'Bullish'
      WHEN 100.0 * COUNT(*) FILTER (WHERE b.validity = true) / NULLIF(COUNT(*), 0) <= 40 THEN 'Bearish'
      ELSE 'Neutral'
    END AS wsp_regime
  FROM base b
  GROUP BY b.sector_name
  ORDER BY avg_pct_today DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_sector_ranking()
RETURNS TABLE (
  sector_name text,
  rank_position int,
  is_leading boolean,
  wsp_regime text,
  pct_above_ma50 numeric,
  avg_wsp_score numeric,
  avg_pct_today numeric,
  symbol_count bigint,
  wsp_setups bigint,
  top_pattern text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT * FROM public.get_market_summary()
  )
  SELECT
    b.sector_name,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE b.wsp_regime WHEN 'Bullish' THEN 3 WHEN 'Neutral' THEN 2 ELSE 1 END DESC,
        b.pct_above_ma50 DESC,
        b.avg_wsp_score DESC
    )::int AS rank_position,
    (b.wsp_regime IN ('Bullish','Neutral') AND b.pct_above_ma50 >= 45) AS is_leading,
    b.wsp_regime,
    b.pct_above_ma50,
    b.avg_wsp_score,
    b.avg_pct_today,
    b.symbol_count,
    b.wsp_setups,
    b.top_pattern
  FROM base b
  ORDER BY rank_position;
$$;

CREATE OR REPLACE FUNCTION public.get_industry_ranking(
  p_leading_only boolean DEFAULT false,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(display_industry text, sector text, rank_position bigint, rank_score numeric, avg_wsp_score numeric, symbol_count bigint, buy_count bigint, watch_count bigint, valid_entry_count bigint, breakout_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH canonical AS (
    SELECT public.get_latest_published_equity_snapshot_id() AS sid
  ),
  leading_sectors AS (
    SELECT sector_name FROM public.get_sector_ranking() WHERE is_leading = true
  ),
  ranked AS (
    SELECT
      sym.canonical_industry AS display_industry,
      sym.canonical_sector AS sector,
      COUNT(*) AS symbol_count,
      ROUND(AVG(COALESCE(srm.wsp_score, 0))::numeric, 1) AS avg_wsp_score,
      COUNT(*) FILTER (WHERE srm.recommendation = 'KÖP') AS buy_count,
      COUNT(*) FILTER (WHERE srm.recommendation IN ('BEVAKA', 'AVVAKTA')) AS watch_count,
      COUNT(*) FILTER (WHERE srm.recommendation = 'KÖP' AND COALESCE(srm.wsp_score, 0) >= 3) AS valid_entry_count,
      COUNT(*) FILTER (WHERE srm.breakout_freshness IN ('fresh', 'approaching')) AS breakout_count,
      ROUND((
        AVG(COALESCE(srm.wsp_score, 0)) * 0.4
        + (COUNT(*) FILTER (WHERE srm.recommendation = 'KÖP'))::numeric / NULLIF(COUNT(*), 0) * 3.0
        + (COUNT(*) FILTER (WHERE srm.breakout_freshness IN ('fresh', 'approaching')))::numeric / NULLIF(COUNT(*), 0) * 2.0
      )::numeric, 2) AS rank_score
    FROM public.screener_rows_materialized srm
    JOIN canonical c ON srm.snapshot_id = c.sid
    JOIN public.symbols sym ON sym.symbol = srm.symbol
    WHERE sym.is_active = true
      AND COALESCE(sym.is_etf, false) = false
      AND sym.universe_tier IN ('core', 'expanded')
      AND sym.canonical_sector IS NOT NULL
      AND sym.canonical_industry IS NOT NULL
      AND (NOT p_leading_only OR sym.canonical_sector IN (SELECT sector_name FROM leading_sectors))
    GROUP BY sym.canonical_industry, sym.canonical_sector
    HAVING COUNT(*) >= 2
  )
  SELECT
    r.display_industry,
    r.sector,
    ROW_NUMBER() OVER (ORDER BY r.rank_score DESC, r.symbol_count DESC, r.display_industry ASC) AS rank_position,
    r.rank_score,
    r.avg_wsp_score,
    r.symbol_count,
    r.buy_count,
    r.watch_count,
    r.valid_entry_count,
    r.breakout_count
  FROM ranked r
  ORDER BY rank_position
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.get_heatmap_data()
RETURNS TABLE(symbol text, canonical_sector text, close numeric, pct_change_1d numeric, wsp_pattern text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH canonical AS (
    SELECT public.get_latest_published_equity_snapshot_id() AS sid
  )
  SELECT
    srm.symbol,
    sym.canonical_sector AS canonical_sector,
    srm.close,
    srm.daily_pct AS pct_change_1d,
    srm.pattern_state AS wsp_pattern
  FROM public.screener_rows_materialized srm
  JOIN canonical c ON srm.snapshot_id = c.sid
  JOIN public.symbols sym ON sym.symbol = srm.symbol
  WHERE sym.is_active = true
    AND COALESCE(sym.is_etf, false) = false
    AND sym.universe_tier IN ('core', 'expanded')
    AND sym.canonical_sector IS NOT NULL
    AND sym.canonical_industry IS NOT NULL;
$$;

-- ---------------------------------------------------------------------------
-- Admin coverage semantics: explicit populations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_universe_coverage_detailed()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH canonical AS (
    SELECT public.get_latest_published_equity_snapshot_id() AS sid
  ),
  base_equity AS (
    SELECT s.symbol
    FROM public.symbols s
    WHERE s.is_active = true
      AND COALESCE(s.is_etf, false) = false
      AND s.universe_tier <> 'benchmark'
  )
  SELECT jsonb_build_object(
    'active_universe', (SELECT COUNT(*) FROM public.symbols WHERE is_active = true),
    'equity_universe', (SELECT COUNT(*) FROM base_equity),
    'raw_scanned_population', (SELECT COUNT(DISTINCT r.symbol) FROM public.market_scan_results_latest r),
    'canonical_mapped_population', (
      SELECT COUNT(*) FROM public.symbols s
      WHERE s.symbol IN (SELECT symbol FROM base_equity)
        AND s.canonical_sector IS NOT NULL
        AND s.canonical_industry IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.canonical_gics_sectors cgs WHERE cgs.sector_name = s.canonical_sector)
        AND EXISTS (SELECT 1 FROM public.canonical_gics_industries cgi WHERE cgi.industry_name = s.canonical_industry)
    ),
    'wsp_evaluated_population', (
      SELECT COUNT(DISTINCT srm.symbol)
      FROM public.screener_rows_materialized srm
      JOIN canonical c ON srm.snapshot_id = c.sid
    ),
    'public_eligible_population', (
      SELECT COUNT(*) FROM public.symbols s
      WHERE s.symbol IN (SELECT symbol FROM base_equity)
        AND s.canonical_sector IS NOT NULL
        AND s.canonical_industry IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.canonical_gics_sectors cgs WHERE cgs.sector_name = s.canonical_sector)
        AND EXISTS (SELECT 1 FROM public.canonical_gics_industries cgi WHERE cgi.industry_name = s.canonical_industry)
    ),
    'public_screener_population', (
      SELECT COUNT(DISTINCT srm.symbol)
      FROM public.screener_rows_materialized srm
      JOIN canonical c ON srm.snapshot_id = c.sid
      JOIN public.symbols s ON s.symbol = srm.symbol
      WHERE s.universe_tier IN ('core', 'expanded')
        AND s.canonical_sector IS NOT NULL
        AND s.canonical_industry IS NOT NULL
    ),
    'core_tier', (SELECT COUNT(*) FROM public.symbols WHERE universe_tier = 'core' AND is_active = true),
    'expanded_tier', (SELECT COUNT(*) FROM public.symbols WHERE universe_tier = 'expanded' AND is_active = true),
    'benchmark_tier', (SELECT COUNT(*) FROM public.symbols WHERE universe_tier = 'benchmark' AND is_active = true),
    'latest_published_snapshot_id', (SELECT sid FROM canonical)
  );
$$;

-- ---------------------------------------------------------------------------
-- Health checks: 11-sector count must reflect public published snapshot
-- ---------------------------------------------------------------------------
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
  v_prev_trading_day date := CASE
    WHEN v_dow = 1 THEN v_today - 3
    WHEN v_dow = 0 THEN v_today - 2
    WHEN v_dow = 6 THEN v_today - 1
    ELSE v_today - 1
  END;
  v_latest_price_date date;
  v_latest_indicator_date date;
  v_latest_scan_completed timestamptz;
  v_latest_scan_symbols bigint;
  v_prev_scan_symbols bigint;
  v_benchmark_date date;
  v_stale_jobs int;
  v_sector_count int;
  v_status text;
  v_msg text;
  v_snapshot_id bigint := public.get_latest_published_equity_snapshot_id();
BEGIN
  DELETE FROM public.pipeline_health_checks;

  SELECT MAX(date) INTO v_latest_price_date FROM public.daily_prices;
  SELECT MAX(calc_date) INTO v_latest_indicator_date FROM public.wsp_indicators;

  SELECT completed_at, symbols_scanned INTO v_latest_scan_completed, v_latest_scan_symbols
  FROM public.market_scan_runs WHERE status IN ('completed', 'partial')
  ORDER BY completed_at DESC NULLS LAST LIMIT 1;

  SELECT symbols_scanned INTO v_prev_scan_symbols
  FROM public.market_scan_runs WHERE status IN ('completed', 'partial')
  ORDER BY completed_at DESC NULLS LAST LIMIT 1 OFFSET 1;

  SELECT MAX(calc_date) INTO v_benchmark_date
  FROM public.wsp_indicators WHERE symbol IN ('SPY', 'QQQ');

  SELECT COUNT(*) INTO v_stale_jobs
  FROM public.data_sync_log WHERE status = 'running' AND started_at < v_now - INTERVAL '30 minutes';

  SELECT COUNT(DISTINCT srm.sector) INTO v_sector_count
  FROM public.screener_rows_materialized srm
  WHERE srm.snapshot_id = v_snapshot_id
    AND EXISTS (SELECT 1 FROM public.canonical_gics_sectors cgs WHERE cgs.sector_name = srm.sector);

  IF v_latest_price_date IS NULL THEN
    v_status := 'critical'; v_msg := 'No price data exists';
  ELSIF v_latest_price_date >= v_prev_trading_day THEN
    v_status := 'ok'; v_msg := 'Price data fresh: ' || v_latest_price_date::text;
  ELSIF v_latest_price_date >= v_prev_trading_day - 1 THEN
    v_status := 'warning'; v_msg := 'Price data 1 day behind: ' || v_latest_price_date::text;
  ELSE
    v_status := 'critical'; v_msg := 'Price data stale: ' || v_latest_price_date::text;
  END IF;
  INSERT INTO public.pipeline_health_checks(run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'price_freshness', v_status, v_msg, COALESCE(v_latest_price_date::text, 'null'), 'prev trading day');

  IF v_latest_indicator_date IS NULL THEN
    v_status := 'critical'; v_msg := 'No indicator data exists';
  ELSIF v_latest_indicator_date < v_latest_price_date - 1 THEN
    v_status := 'critical'; v_msg := 'Indicators lag prices: ' || v_latest_indicator_date::text;
  ELSIF v_latest_indicator_date < v_latest_price_date THEN
    v_status := 'warning'; v_msg := 'Indicators 1 day behind prices: ' || v_latest_indicator_date::text;
  ELSE
    v_status := 'ok'; v_msg := 'Indicators aligned with prices: ' || v_latest_indicator_date::text;
  END IF;
  INSERT INTO public.pipeline_health_checks(run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'indicator_freshness', v_status, v_msg, COALESCE(v_latest_indicator_date::text, 'null'), 'must match latest price date');

  IF v_latest_scan_completed IS NULL THEN
    v_status := 'critical'; v_msg := 'No completed scan found';
  ELSIF (v_latest_scan_completed AT TIME ZONE 'America/New_York')::date >= v_prev_trading_day THEN
    v_status := 'ok'; v_msg := 'Scan fresh: ' || v_latest_scan_completed::text;
  ELSE
    v_status := 'warning'; v_msg := 'Scan may be stale: ' || v_latest_scan_completed::text;
  END IF;
  INSERT INTO public.pipeline_health_checks(run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'scan_freshness', v_status, v_msg, COALESCE(v_latest_scan_completed::text, 'null'), 'prev trading day');

  IF v_benchmark_date IS NULL THEN
    v_status := 'critical'; v_msg := 'No benchmark indicator data';
  ELSIF v_benchmark_date >= v_prev_trading_day THEN
    v_status := 'ok'; v_msg := 'Benchmark data fresh: ' || v_benchmark_date::text;
  ELSE
    v_status := 'warning'; v_msg := 'Benchmark data behind: ' || v_benchmark_date::text;
  END IF;
  INSERT INTO public.pipeline_health_checks(run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'benchmark_freshness', v_status, v_msg, COALESCE(v_benchmark_date::text, 'null'), 'prev trading day');

  IF v_sector_count = 11 THEN
    v_status := 'ok'; v_msg := 'All 11 canonical GICS sectors represented in published snapshot';
  ELSIF v_sector_count >= 9 THEN
    v_status := 'warning'; v_msg := v_sector_count || ' of 11 GICS sectors represented in published snapshot';
  ELSE
    v_status := 'critical'; v_msg := 'Only ' || v_sector_count || ' of 11 GICS sectors represented in published snapshot';
  END IF;
  INSERT INTO public.pipeline_health_checks(run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'gics_sector_coverage', v_status, v_msg, COALESCE(v_sector_count::text, '0'), '11');

  IF v_stale_jobs > 0 THEN
    v_status := 'warning'; v_msg := v_stale_jobs || ' jobs stuck in running state > 30 min';
  ELSE
    v_status := 'ok'; v_msg := 'No stale jobs';
  END IF;
  INSERT INTO public.pipeline_health_checks(run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'stale_jobs', v_status, v_msg, v_stale_jobs::text, '0');

  IF v_latest_scan_symbols IS NOT NULL AND v_prev_scan_symbols IS NOT NULL AND v_prev_scan_symbols > 0 THEN
    IF v_latest_scan_symbols < v_prev_scan_symbols * 0.90 THEN
      v_status := 'critical'; v_msg := 'Raw scan population dropped >10%: ' || v_latest_scan_symbols || ' vs ' || v_prev_scan_symbols;
    ELSE
      v_status := 'ok'; v_msg := 'Raw scan population stable: ' || v_latest_scan_symbols;
    END IF;
  ELSE
    v_status := 'ok'; v_msg := 'Raw scan population: ' || COALESCE(v_latest_scan_symbols::text, 'N/A');
  END IF;
  INSERT INTO public.pipeline_health_checks(run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'scan_population_stability', v_status, v_msg, COALESCE(v_latest_scan_symbols::text, '0'), '>= 90% of previous');

  INSERT INTO public.pipeline_health_checks(run_id, check_name, status, message, current_value, threshold)
  VALUES (
    v_run_id,
    'public_snapshot_source',
    CASE WHEN v_snapshot_id IS NULL THEN 'critical' ELSE 'ok' END,
    CASE WHEN v_snapshot_id IS NULL THEN 'No published canonical equity snapshot found' ELSE 'Public surfaces locked to published snapshot ' || v_snapshot_id::text END,
    COALESCE(v_snapshot_id::text, 'null'),
    'must exist'
  );

  RETURN v_run_id::text;
END;
$$;
