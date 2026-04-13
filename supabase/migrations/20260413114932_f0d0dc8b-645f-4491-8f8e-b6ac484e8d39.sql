
-- 1. Drop existing functions to avoid overload ambiguity
DROP FUNCTION IF EXISTS get_equity_screener_rows(text, integer, integer, text, text, text);
DROP FUNCTION IF EXISTS get_equity_screener_count(text, text, text, text);
DROP FUNCTION IF EXISTS get_top_wsp_setups();
DROP FUNCTION IF EXISTS get_heatmap_data();
DROP FUNCTION IF EXISTS get_market_summary();

-- 2. Screener rows: exclude Unclassified/Other/Unknown industries from public output
CREATE OR REPLACE FUNCTION get_equity_screener_rows(
  p_universe_tier text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
  p_sector text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_pattern text DEFAULT NULL
)
RETURNS TABLE(
  symbol text,
  sector text,
  industry text,
  pattern_state text,
  recommendation text,
  wsp_score integer,
  payload jsonb,
  blockers text[],
  breakout_status text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH resolved AS (
    SELECT
      r.symbol,
      COALESCE(
        NULLIF(r.sector, ''), NULLIF(r.sector, 'Stocks'),
        s.canonical_sector, s.sector
      ) AS raw_sector,
      COALESCE(
        (SELECT gi.industry_name FROM taxonomy_alias_map tam
         JOIN canonical_gics_industries gi ON gi.industry_code = tam.canonical_industry_code
         WHERE tam.raw_label = COALESCE(r.industry, s.canonical_industry, s.industry)
         LIMIT 1),
        NULLIF(s.canonical_industry, 'Other'),
        NULLIF(s.canonical_industry, 'Unknown'),
        NULLIF(r.industry, 'Other'),
        NULLIF(r.industry, 'Unknown')
      ) AS raw_industry,
      r.pattern AS pattern_state,
      r.recommendation,
      COALESCE(r.score, 0) AS wsp_score,
      r.payload,
      r.blockers,
      r.breakout_status
    FROM market_scan_results_latest r
    JOIN symbols s ON s.symbol = r.symbol
    WHERE s.is_active = true
      AND COALESCE(s.is_etf, false) = false
      AND s.universe_tier IN ('core', 'expanded')
  )
  SELECT
    resolved.symbol,
    resolved.raw_sector AS sector,
    resolved.raw_industry AS industry,
    resolved.pattern_state,
    resolved.recommendation,
    resolved.wsp_score,
    resolved.payload,
    resolved.blockers,
    resolved.breakout_status
  FROM resolved
  WHERE resolved.raw_sector IS NOT NULL
    AND resolved.raw_sector NOT IN ('Unknown', 'Stocks', '')
    -- Exclude non-canonical industries from public output
    AND resolved.raw_industry IS NOT NULL
    AND resolved.raw_industry NOT IN ('Unclassified', 'Other', 'Unknown', 'ETF', 'Stocks', '')
    -- Verify sector is canonical GICS
    AND EXISTS (SELECT 1 FROM canonical_gics_sectors cgs WHERE cgs.sector_name = resolved.raw_sector)
    AND (p_universe_tier IS NULL OR (
      SELECT universe_tier FROM symbols WHERE symbols.symbol = resolved.symbol
    ) = p_universe_tier)
    AND (p_sector IS NULL OR resolved.raw_sector = p_sector)
    AND (p_industry IS NULL OR resolved.raw_industry = p_industry)
    AND (p_pattern IS NULL OR lower(resolved.pattern_state) = lower(p_pattern))
  ORDER BY resolved.wsp_score DESC, resolved.symbol
  LIMIT p_page_size
  OFFSET (p_page - 1) * p_page_size;
$$;

-- 3. Screener count: same filtering
CREATE OR REPLACE FUNCTION get_equity_screener_count(
  p_universe_tier text DEFAULT NULL,
  p_sector text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_pattern text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH resolved AS (
    SELECT
      r.symbol,
      COALESCE(
        NULLIF(r.sector, ''), NULLIF(r.sector, 'Stocks'),
        s.canonical_sector, s.sector
      ) AS raw_sector,
      COALESCE(
        (SELECT gi.industry_name FROM taxonomy_alias_map tam
         JOIN canonical_gics_industries gi ON gi.industry_code = tam.canonical_industry_code
         WHERE tam.raw_label = COALESCE(r.industry, s.canonical_industry, s.industry)
         LIMIT 1),
        NULLIF(s.canonical_industry, 'Other'),
        NULLIF(s.canonical_industry, 'Unknown'),
        NULLIF(r.industry, 'Other'),
        NULLIF(r.industry, 'Unknown')
      ) AS raw_industry,
      r.pattern AS pattern_state
    FROM market_scan_results_latest r
    JOIN symbols s ON s.symbol = r.symbol
    WHERE s.is_active = true
      AND COALESCE(s.is_etf, false) = false
      AND s.universe_tier IN ('core', 'expanded')
  )
  SELECT COUNT(*)::integer
  FROM resolved
  WHERE resolved.raw_sector IS NOT NULL
    AND resolved.raw_sector NOT IN ('Unknown', 'Stocks', '')
    AND resolved.raw_industry IS NOT NULL
    AND resolved.raw_industry NOT IN ('Unclassified', 'Other', 'Unknown', 'ETF', 'Stocks', '')
    AND EXISTS (SELECT 1 FROM canonical_gics_sectors cgs WHERE cgs.sector_name = resolved.raw_sector)
    AND (p_universe_tier IS NULL OR (
      SELECT universe_tier FROM symbols WHERE symbols.symbol = resolved.symbol
    ) = p_universe_tier)
    AND (p_sector IS NULL OR resolved.raw_sector = p_sector)
    AND (p_industry IS NULL OR resolved.raw_industry = p_industry)
    AND (p_pattern IS NULL OR lower(resolved.pattern_state) = lower(p_pattern));
$$;

-- 4. Top WSP setups: canonical only
CREATE OR REPLACE FUNCTION get_top_wsp_setups()
RETURNS TABLE(
  symbol text,
  score integer,
  pattern text,
  recommendation text,
  vol_ratio numeric,
  sector text,
  industry text,
  payload jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH resolved AS (
    SELECT
      r.symbol,
      COALESCE(r.score, 0) AS score,
      r.pattern,
      r.recommendation,
      (r.payload->>'volume_ratio')::numeric AS vol_ratio,
      COALESCE(NULLIF(r.sector, ''), NULLIF(r.sector, 'Stocks'), s.canonical_sector) AS res_sector,
      COALESCE(
        (SELECT gi.industry_name FROM taxonomy_alias_map tam
         JOIN canonical_gics_industries gi ON gi.industry_code = tam.canonical_industry_code
         WHERE tam.raw_label = COALESCE(r.industry, s.canonical_industry, s.industry)
         LIMIT 1),
        NULLIF(s.canonical_industry, 'Other'),
        NULLIF(s.canonical_industry, 'Unknown'),
        NULLIF(r.industry, 'Other'),
        NULLIF(r.industry, 'Unknown')
      ) AS res_industry,
      r.payload
    FROM market_scan_results_latest r
    JOIN symbols s ON s.symbol = r.symbol
    WHERE r.recommendation IN ('KÖP', 'BEVAKA')
      AND COALESCE(r.score, 0) >= 3
      AND s.is_active = true
      AND COALESCE(s.is_etf, false) = false
      AND s.universe_tier IN ('core', 'expanded')
  )
  SELECT
    resolved.symbol,
    resolved.score,
    resolved.pattern,
    resolved.recommendation,
    resolved.vol_ratio,
    resolved.res_sector AS sector,
    resolved.res_industry AS industry,
    resolved.payload
  FROM resolved
  WHERE resolved.res_sector IS NOT NULL
    AND EXISTS (SELECT 1 FROM canonical_gics_sectors cgs WHERE cgs.sector_name = resolved.res_sector)
    AND resolved.res_industry IS NOT NULL
    AND resolved.res_industry NOT IN ('Unclassified', 'Other', 'Unknown', 'ETF', 'Stocks', '')
  ORDER BY resolved.score DESC, resolved.vol_ratio DESC NULLS LAST
  LIMIT 20;
$$;

-- 5. Heatmap: canonical sectors only, exclude unmapped industries
CREATE OR REPLACE FUNCTION get_heatmap_data()
RETURNS TABLE(
  symbol text,
  canonical_sector text,
  close numeric,
  pct_change_1d numeric,
  wsp_pattern text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (w.symbol)
    w.symbol,
    s.canonical_sector,
    w.close,
    w.pct_change_1d,
    w.wsp_pattern
  FROM wsp_indicators w
  JOIN symbols s ON s.symbol = w.symbol
  WHERE s.is_active = true
    AND COALESCE(s.is_etf, false) = false
    AND s.universe_tier IN ('core', 'expanded')
    AND s.canonical_sector IS NOT NULL
    AND EXISTS (SELECT 1 FROM canonical_gics_sectors cgs WHERE cgs.sector_name = s.canonical_sector)
  ORDER BY w.symbol, w.calc_date DESC;
$$;

-- 6. Market summary: canonical sectors, median daily %
CREATE OR REPLACE FUNCTION get_market_summary()
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
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (w.symbol)
      w.symbol,
      s.canonical_sector,
      w.pct_change_1d,
      w.above_ma50,
      w.wsp_score,
      w.wsp_pattern,
      w.ma50_slope
    FROM wsp_indicators w
    JOIN symbols s ON s.symbol = w.symbol
    WHERE s.is_active = true
      AND COALESCE(s.is_etf, false) = false
      AND s.universe_tier IN ('core', 'expanded')
      AND s.canonical_sector IS NOT NULL
      AND EXISTS (SELECT 1 FROM canonical_gics_sectors cgs WHERE cgs.sector_name = s.canonical_sector)
    ORDER BY w.symbol, w.calc_date DESC
  )
  SELECT
    l.canonical_sector AS sector_name,
    COUNT(*) AS symbol_count,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(l.pct_change_1d, 0))::numeric, 2) AS avg_pct_today,
    ROUND(100.0 * COUNT(*) FILTER (WHERE l.above_ma50 = true) / NULLIF(COUNT(*), 0), 1) AS pct_above_ma50,
    ROUND(AVG(COALESCE(l.wsp_score, 0))::numeric, 1) AS avg_wsp_score,
    COUNT(*) FILTER (WHERE l.wsp_score >= 3) AS wsp_setups,
    MODE() WITHIN GROUP (ORDER BY COALESCE(l.wsp_pattern, 'base')) AS top_pattern,
    CASE
      WHEN 100.0 * COUNT(*) FILTER (WHERE l.above_ma50 = true) / NULLIF(COUNT(*), 0) >= 60 THEN 'Bullish'
      WHEN 100.0 * COUNT(*) FILTER (WHERE l.above_ma50 = true) / NULLIF(COUNT(*), 0) <= 40 THEN 'Bearish'
      ELSE 'Neutral'
    END AS wsp_regime
  FROM latest l
  GROUP BY l.canonical_sector
  ORDER BY PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(l.pct_change_1d, 0)) DESC;
$$;

-- 7. Detailed universe coverage for transparency widget
CREATE OR REPLACE FUNCTION get_universe_coverage_detailed()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'active_universe', (SELECT COUNT(*) FROM symbols WHERE is_active = true),
    'equity_universe', (SELECT COUNT(*) FROM symbols WHERE is_active = true AND COALESCE(is_etf, false) = false AND universe_tier NOT IN ('benchmark')),
    'canonically_mapped_sector', (SELECT COUNT(*) FROM symbols WHERE is_active = true AND canonical_sector IS NOT NULL AND EXISTS (SELECT 1 FROM canonical_gics_sectors cgs WHERE cgs.sector_name = canonical_sector)),
    'canonically_mapped_industry', (SELECT COUNT(*) FROM symbols WHERE is_active = true AND canonical_industry IS NOT NULL AND canonical_industry NOT IN ('Other', 'Unknown', 'Unclassified', '') AND EXISTS (SELECT 1 FROM canonical_gics_industries gi WHERE gi.industry_name = canonical_industry)),
    'price_history_ready', (SELECT COUNT(DISTINCT symbol) FROM daily_prices),
    'indicator_ready', (SELECT COUNT(DISTINCT symbol) FROM wsp_indicators),
    'wsp_evaluated', (SELECT COUNT(DISTINCT symbol) FROM market_scan_results),
    'public_eligible', (
      SELECT COUNT(DISTINCT r.symbol)
      FROM market_scan_results_latest r
      JOIN symbols s ON s.symbol = r.symbol
      WHERE s.is_active = true
        AND COALESCE(s.is_etf, false) = false
        AND s.canonical_sector IS NOT NULL
        AND EXISTS (SELECT 1 FROM canonical_gics_sectors cgs WHERE cgs.sector_name = s.canonical_sector)
        AND s.canonical_industry IS NOT NULL
        AND s.canonical_industry NOT IN ('Other', 'Unknown', 'Unclassified', '')
    ),
    'core_tier', (SELECT COUNT(*) FROM symbols WHERE universe_tier = 'core' AND is_active = true),
    'expanded_tier', (SELECT COUNT(*) FROM symbols WHERE universe_tier = 'expanded' AND is_active = true),
    'benchmark_tier', (SELECT COUNT(*) FROM symbols WHERE universe_tier = 'benchmark' AND is_active = true),
    'unmapped_industry_count', (SELECT COUNT(*) FROM symbols WHERE is_active = true AND COALESCE(is_etf, false) = false AND (canonical_industry IS NULL OR canonical_industry IN ('Other', 'Unknown', 'Unclassified', '')))
  );
$$;
