
-- Drop and recreate with strict canonical industry verification
DROP FUNCTION IF EXISTS get_equity_screener_rows(text, integer, integer, text, text, text);
DROP FUNCTION IF EXISTS get_equity_screener_count(text, text, text, text);
DROP FUNCTION IF EXISTS get_top_wsp_setups();

-- Screener rows: strict canonical gate
CREATE OR REPLACE FUNCTION get_equity_screener_rows(
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
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH resolved AS (
    SELECT
      r.symbol,
      cgs.sector_name AS res_sector,
      COALESCE(
        (SELECT gi.industry_name FROM taxonomy_alias_map tam
         JOIN canonical_gics_industries gi ON gi.industry_code = tam.canonical_industry_code
         WHERE tam.raw_label = COALESCE(r.industry, s.canonical_industry, s.industry)
         LIMIT 1),
        (SELECT gi2.industry_name FROM canonical_gics_industries gi2
         WHERE gi2.industry_name = s.canonical_industry LIMIT 1)
      ) AS res_industry,
      r.pattern AS pattern_state,
      r.recommendation,
      COALESCE(r.score, 0) AS wsp_score,
      r.payload,
      r.blockers,
      r.breakout_status,
      s.universe_tier
    FROM market_scan_results_latest r
    JOIN symbols s ON s.symbol = r.symbol
    JOIN canonical_gics_sectors cgs ON cgs.sector_name = COALESCE(
      NULLIF(NULLIF(r.sector, ''), 'Stocks'), s.canonical_sector
    )
    WHERE s.is_active = true
      AND COALESCE(s.is_etf, false) = false
      AND s.universe_tier IN ('core', 'expanded')
  )
  SELECT
    resolved.symbol, resolved.res_sector, resolved.res_industry,
    resolved.pattern_state, resolved.recommendation, resolved.wsp_score,
    resolved.payload, resolved.blockers, resolved.breakout_status
  FROM resolved
  WHERE resolved.res_industry IS NOT NULL
    AND (p_universe_tier IS NULL OR resolved.universe_tier = p_universe_tier)
    AND (p_sector IS NULL OR resolved.res_sector = p_sector)
    AND (p_industry IS NULL OR resolved.res_industry = p_industry)
    AND (p_pattern IS NULL OR lower(resolved.pattern_state) = lower(p_pattern))
  ORDER BY resolved.wsp_score DESC, resolved.symbol
  LIMIT p_page_size OFFSET (p_page - 1) * p_page_size;
$$;

-- Screener count: same strict gate
CREATE OR REPLACE FUNCTION get_equity_screener_count(
  p_universe_tier text DEFAULT NULL,
  p_sector text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_pattern text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH resolved AS (
    SELECT
      r.symbol,
      cgs.sector_name AS res_sector,
      COALESCE(
        (SELECT gi.industry_name FROM taxonomy_alias_map tam
         JOIN canonical_gics_industries gi ON gi.industry_code = tam.canonical_industry_code
         WHERE tam.raw_label = COALESCE(r.industry, s.canonical_industry, s.industry)
         LIMIT 1),
        (SELECT gi2.industry_name FROM canonical_gics_industries gi2
         WHERE gi2.industry_name = s.canonical_industry LIMIT 1)
      ) AS res_industry,
      r.pattern AS pattern_state,
      s.universe_tier
    FROM market_scan_results_latest r
    JOIN symbols s ON s.symbol = r.symbol
    JOIN canonical_gics_sectors cgs ON cgs.sector_name = COALESCE(
      NULLIF(NULLIF(r.sector, ''), 'Stocks'), s.canonical_sector
    )
    WHERE s.is_active = true
      AND COALESCE(s.is_etf, false) = false
      AND s.universe_tier IN ('core', 'expanded')
  )
  SELECT COUNT(*)::integer
  FROM resolved
  WHERE resolved.res_industry IS NOT NULL
    AND (p_universe_tier IS NULL OR resolved.universe_tier = p_universe_tier)
    AND (p_sector IS NULL OR resolved.res_sector = p_sector)
    AND (p_industry IS NULL OR resolved.res_industry = p_industry)
    AND (p_pattern IS NULL OR lower(resolved.pattern_state) = lower(p_pattern));
$$;

-- Top setups: strict canonical gate
CREATE OR REPLACE FUNCTION get_top_wsp_setups()
RETURNS TABLE(
  symbol text, score integer, pattern text, recommendation text,
  vol_ratio numeric, sector text, industry text, payload jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH resolved AS (
    SELECT
      r.symbol,
      COALESCE(r.score, 0) AS score,
      r.pattern,
      r.recommendation,
      (r.payload->>'volume_ratio')::numeric AS vol_ratio,
      cgs.sector_name AS res_sector,
      COALESCE(
        (SELECT gi.industry_name FROM taxonomy_alias_map tam
         JOIN canonical_gics_industries gi ON gi.industry_code = tam.canonical_industry_code
         WHERE tam.raw_label = COALESCE(r.industry, s.canonical_industry, s.industry)
         LIMIT 1),
        (SELECT gi2.industry_name FROM canonical_gics_industries gi2
         WHERE gi2.industry_name = s.canonical_industry LIMIT 1)
      ) AS res_industry,
      r.payload
    FROM market_scan_results_latest r
    JOIN symbols s ON s.symbol = r.symbol
    JOIN canonical_gics_sectors cgs ON cgs.sector_name = COALESCE(
      NULLIF(NULLIF(r.sector, ''), 'Stocks'), s.canonical_sector
    )
    WHERE r.recommendation IN ('KÖP', 'BEVAKA')
      AND COALESCE(r.score, 0) >= 3
      AND s.is_active = true
      AND COALESCE(s.is_etf, false) = false
      AND s.universe_tier IN ('core', 'expanded')
  )
  SELECT
    resolved.symbol, resolved.score, resolved.pattern, resolved.recommendation,
    resolved.vol_ratio, resolved.res_sector, resolved.res_industry, resolved.payload
  FROM resolved
  WHERE resolved.res_industry IS NOT NULL
  ORDER BY resolved.score DESC, resolved.vol_ratio DESC NULLS LAST
  LIMIT 20;
$$;

-- Industry ranking: strict canonical gate (only show canonical GICS industries)
DROP FUNCTION IF EXISTS get_industry_ranking(boolean, integer);
CREATE OR REPLACE FUNCTION get_industry_ranking(
  p_leading_only boolean DEFAULT false,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  display_industry text, sector text, rank_position bigint, rank_score numeric,
  avg_wsp_score numeric, symbol_count bigint, buy_count bigint, watch_count bigint,
  valid_entry_count bigint, breakout_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH resolved AS (
    SELECT
      r.symbol,
      cgs.sector_name AS res_sector,
      COALESCE(
        (SELECT gi.industry_name FROM taxonomy_alias_map tam
         JOIN canonical_gics_industries gi ON gi.industry_code = tam.canonical_industry_code
         WHERE tam.raw_label = COALESCE(r.industry, s.canonical_industry, s.industry)
         LIMIT 1),
        (SELECT gi2.industry_name FROM canonical_gics_industries gi2
         WHERE gi2.industry_name = s.canonical_industry LIMIT 1)
      ) AS res_industry,
      r.recommendation,
      COALESCE(r.score, 0) AS wsp_score,
      r.breakout_status
    FROM market_scan_results_latest r
    JOIN symbols s ON s.symbol = r.symbol
    JOIN canonical_gics_sectors cgs ON cgs.sector_name = COALESCE(
      NULLIF(NULLIF(r.sector, ''), 'Stocks'), s.canonical_sector
    )
    WHERE s.is_active = true
      AND COALESCE(s.is_etf, false) = false
      AND s.universe_tier IN ('core', 'expanded')
  ),
  ranked AS (
    SELECT
      resolved.res_industry AS display_industry,
      resolved.res_sector AS sector,
      COUNT(*) AS symbol_count,
      ROUND(AVG(resolved.wsp_score)::numeric, 1) AS avg_wsp_score,
      COUNT(*) FILTER (WHERE resolved.recommendation = 'KÖP') AS buy_count,
      COUNT(*) FILTER (WHERE resolved.recommendation IN ('BEVAKA', 'AVVAKTA')) AS watch_count,
      COUNT(*) FILTER (WHERE resolved.recommendation = 'KÖP' AND resolved.wsp_score >= 3) AS valid_entry_count,
      COUNT(*) FILTER (WHERE resolved.breakout_status IN ('FRESH_BREAKOUT', 'APPROACHING')) AS breakout_count,
      ROUND((
        AVG(resolved.wsp_score) * 0.4 +
        (COUNT(*) FILTER (WHERE resolved.recommendation = 'KÖP'))::numeric / NULLIF(COUNT(*), 0) * 3.0 +
        (COUNT(*) FILTER (WHERE resolved.breakout_status IN ('FRESH_BREAKOUT', 'APPROACHING')))::numeric / NULLIF(COUNT(*), 0) * 2.0
      )::numeric, 2) AS rank_score
    FROM resolved
    WHERE resolved.res_industry IS NOT NULL
    GROUP BY resolved.res_industry, resolved.res_sector
    HAVING COUNT(*) >= 2
  )
  SELECT
    ranked.display_industry,
    ranked.sector,
    ROW_NUMBER() OVER (ORDER BY ranked.rank_score DESC) AS rank_position,
    ranked.rank_score,
    ranked.avg_wsp_score,
    ranked.symbol_count,
    ranked.buy_count,
    ranked.watch_count,
    ranked.valid_entry_count,
    ranked.breakout_count
  FROM ranked
  WHERE (NOT p_leading_only OR ranked.rank_score > 1.0)
  ORDER BY ranked.rank_score DESC
  LIMIT p_limit;
$$;
