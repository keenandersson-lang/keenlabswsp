
-- Drop and recreate screener functions to use symbols.canonical_industry as fallback
DROP FUNCTION IF EXISTS public.get_equity_screener_rows(text, text, text, integer, integer, text);
DROP FUNCTION IF EXISTS public.get_equity_screener_count(text, text, text, text);

CREATE FUNCTION public.get_equity_screener_rows(
  p_sector text DEFAULT NULL, p_pattern text DEFAULT NULL, p_industry text DEFAULT NULL,
  p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_universe_tier text DEFAULT NULL
)
RETURNS TABLE(symbol text, sector text, industry text, wsp_score integer,
  pattern_state text, breakout_status text, recommendation text, payload jsonb, blockers text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT r.symbol,
      CASE r.sector WHEN 'Technology' THEN 'Information Technology' WHEN 'Healthcare' THEN 'Health Care' ELSE r.sector END AS ns,
      -- Try alias map on scan industry, then on symbol canonical_industry
      COALESCE(
        gi1.industry_name,
        gi2.industry_name,
        CASE WHEN display_industry(r.industry) IN (SELECT industry_name FROM canonical_gics_industries) THEN display_industry(r.industry) ELSE NULL END,
        CASE WHEN display_industry(s.canonical_industry) IN (SELECT industry_name FROM canonical_gics_industries) THEN display_industry(s.canonical_industry) ELSE NULL END
      ) AS ni,
      COALESCE(r.score, 0)::integer AS ws, r.pattern AS ps, r.breakout_status AS bs, r.recommendation AS rc, r.payload, r.blockers
    FROM market_scan_results_latest r
    JOIN symbols s ON s.symbol = r.symbol
    LEFT JOIN taxonomy_alias_map tam1 ON tam1.raw_label = display_industry(r.industry) AND tam1.label_type = 'industry'
    LEFT JOIN canonical_gics_industries gi1 ON gi1.industry_code = tam1.canonical_industry_code
    LEFT JOIN taxonomy_alias_map tam2 ON tam2.raw_label = display_industry(s.canonical_industry) AND tam2.label_type = 'industry'
    LEFT JOIN canonical_gics_industries gi2 ON gi2.industry_code = tam2.canonical_industry_code
    WHERE r.symbol IS NOT NULL AND r.sector NOT IN ('Stocks','ETF','Unknown')
      AND s.is_etf IS NOT TRUE AND s.universe_tier != 'benchmark'
      AND (p_universe_tier IS NULL OR s.universe_tier = p_universe_tier)
  ),
  filtered AS (
    SELECT * FROM base
    WHERE ns IN (SELECT sector_name FROM canonical_gics_sectors)
      AND (p_sector IS NULL OR ns = p_sector)
      AND (p_pattern IS NULL OR ps = p_pattern)
      AND (p_industry IS NULL OR ni = p_industry)
  )
  SELECT f.symbol, f.ns, COALESCE(f.ni, 'Unclassified'), f.ws, f.ps, f.bs, f.rc, f.payload, f.blockers
  FROM filtered f ORDER BY f.ws DESC, f.symbol
  OFFSET ((p_page - 1) * p_page_size) ROWS FETCH NEXT p_page_size ROWS ONLY;
$$;

CREATE FUNCTION public.get_equity_screener_count(
  p_sector text DEFAULT NULL, p_pattern text DEFAULT NULL,
  p_industry text DEFAULT NULL, p_universe_tier text DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT r.symbol,
      CASE r.sector WHEN 'Technology' THEN 'Information Technology' WHEN 'Healthcare' THEN 'Health Care' ELSE r.sector END AS ns,
      COALESCE(
        gi1.industry_name,
        gi2.industry_name,
        CASE WHEN display_industry(r.industry) IN (SELECT industry_name FROM canonical_gics_industries) THEN display_industry(r.industry) ELSE NULL END,
        CASE WHEN display_industry(s.canonical_industry) IN (SELECT industry_name FROM canonical_gics_industries) THEN display_industry(s.canonical_industry) ELSE NULL END
      ) AS ni,
      r.pattern AS ps
    FROM market_scan_results_latest r
    JOIN symbols s ON s.symbol = r.symbol
    LEFT JOIN taxonomy_alias_map tam1 ON tam1.raw_label = display_industry(r.industry) AND tam1.label_type = 'industry'
    LEFT JOIN canonical_gics_industries gi1 ON gi1.industry_code = tam1.canonical_industry_code
    LEFT JOIN taxonomy_alias_map tam2 ON tam2.raw_label = display_industry(s.canonical_industry) AND tam2.label_type = 'industry'
    LEFT JOIN canonical_gics_industries gi2 ON gi2.industry_code = tam2.canonical_industry_code
    WHERE r.symbol IS NOT NULL AND r.sector NOT IN ('Stocks','ETF','Unknown')
      AND s.is_etf IS NOT TRUE AND s.universe_tier != 'benchmark'
      AND (p_universe_tier IS NULL OR s.universe_tier = p_universe_tier)
  )
  SELECT count(*)::bigint FROM base
  WHERE ns IN (SELECT sector_name FROM canonical_gics_sectors)
    AND (p_sector IS NULL OR ns = p_sector)
    AND (p_pattern IS NULL OR ps = p_pattern)
    AND (p_industry IS NULL OR ni = p_industry);
$$;
