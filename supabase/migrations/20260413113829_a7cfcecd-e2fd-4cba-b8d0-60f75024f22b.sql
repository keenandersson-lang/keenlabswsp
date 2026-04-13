
-- ============================================================
-- 0. Alias mappings
-- ============================================================
INSERT INTO taxonomy_alias_map (raw_label, label_type, canonical_industry_code, canonical_sector_code, mapping_method, confidence, notes)
VALUES
  ('Advertising','industry',202010,20,'SIC_TO_GICS_BRIDGE','medium','→ Commercial Services & Supplies'),
  ('Apparel','industry',252030,25,'SIC_TO_GICS_BRIDGE','high','→ Textiles, Apparel & Luxury Goods'),
  ('Apparel Retail','industry',255040,25,'SIC_TO_GICS_BRIDGE','high','→ Specialty Retail'),
  ('Auto Parts','industry',251010,25,'SIC_TO_GICS_BRIDGE','high','→ Automobile Components'),
  ('Building Materials','industry',201020,20,'SIC_TO_GICS_BRIDGE','high','→ Building Products'),
  ('Business Services','industry',202010,20,'SIC_TO_GICS_BRIDGE','medium','→ Commercial Services & Supplies'),
  ('Cable & Streaming','industry',502010,50,'SIC_TO_GICS_BRIDGE','high','→ Media'),
  ('Computer Hardware','industry',452020,45,'SIC_TO_GICS_BRIDGE','high','→ Technology Hardware, Storage & Peripherals'),
  ('Conglomerates','industry',201050,20,'SIC_TO_GICS_BRIDGE','high','→ Industrial Conglomerates'),
  ('Consumer Electronics','industry',452020,45,'SIC_TO_GICS_BRIDGE','high','→ Technology Hardware, Storage & Peripherals'),
  ('Copper','industry',151040,15,'SIC_TO_GICS_BRIDGE','high','→ Metals & Mining'),
  ('Defense Electronics','industry',201010,20,'SIC_TO_GICS_BRIDGE','high','→ Aerospace & Defense'),
  ('Diagnostics','industry',351010,35,'SIC_TO_GICS_BRIDGE','high','→ Health Care Equipment & Supplies'),
  ('Discount Stores','industry',301010,30,'SIC_TO_GICS_BRIDGE','high','→ Consumer Staples Distribution & Retail'),
  ('Distribution','industry',255010,25,'SIC_TO_GICS_BRIDGE','medium','→ Distributors'),
  ('E-Commerce','industry',255030,25,'SIC_TO_GICS_BRIDGE','high','→ Broadline Retail'),
  ('Education','industry',253020,25,'SIC_TO_GICS_BRIDGE','medium','→ Diversified Consumer Services'),
  ('Electronic Components','industry',452030,45,'SIC_TO_GICS_BRIDGE','high','→ Electronic Equipment, Instruments & Components'),
  ('Gold','industry',151040,15,'SIC_TO_GICS_BRIDGE','high','→ Metals & Mining'),
  ('Gold Miners','industry',151040,15,'SIC_TO_GICS_BRIDGE','high','→ Metals & Mining'),
  ('Healthcare Services','industry',351020,35,'SIC_TO_GICS_BRIDGE','high','→ Health Care Providers & Services'),
  ('Health Care Providers','industry',351020,35,'SIC_TO_GICS_BRIDGE','high','→ Health Care Providers & Services'),
  ('Home Improvement','industry',255040,25,'SIC_TO_GICS_BRIDGE','high','→ Specialty Retail'),
  ('Home Improvement Retail','industry',255040,25,'SIC_TO_GICS_BRIDGE','high','→ Specialty Retail'),
  ('Homebuilders','industry',252010,25,'SIC_TO_GICS_BRIDGE','high','→ Household Durables'),
  ('Integrated Oil & Gas','industry',101020,10,'SIC_TO_GICS_BRIDGE','high','→ Oil, Gas & Consumable Fuels'),
  ('Interactive Media','industry',502030,50,'SIC_TO_GICS_BRIDGE','high','→ Interactive Media & Services'),
  ('Internet Content & Information','industry',502030,50,'SIC_TO_GICS_BRIDGE','high','→ Interactive Media & Services'),
  ('Logistics','industry',203010,20,'SIC_TO_GICS_BRIDGE','high','→ Air Freight & Logistics'),
  ('Integrated Freight & Logistics','industry',203010,20,'SIC_TO_GICS_BRIDGE','high','→ Air Freight & Logistics'),
  ('Medical Devices','industry',351010,35,'SIC_TO_GICS_BRIDGE','high','→ Health Care Equipment & Supplies'),
  ('Networking Equipment','industry',452010,45,'SIC_TO_GICS_BRIDGE','high','→ Communications Equipment'),
  ('Oil & Gas E&P','industry',101020,10,'SIC_TO_GICS_BRIDGE','high','→ Oil, Gas & Consumable Fuels'),
  ('Oil & Gas Equipment & Services','industry',101010,10,'SIC_TO_GICS_BRIDGE','high','→ Energy Equipment & Services'),
  ('Oil & Gas Services','industry',101010,10,'SIC_TO_GICS_BRIDGE','high','→ Energy Equipment & Services'),
  ('Paper & Packaging','industry',151030,15,'SIC_TO_GICS_BRIDGE','high','→ Containers & Packaging'),
  ('Payment Services','industry',403010,40,'SIC_TO_GICS_BRIDGE','high','→ Financial Services'),
  ('REITs','industry',601010,60,'SIC_TO_GICS_BRIDGE','high','→ Equity REITs'),
  ('REIT - Specialty','industry',601010,60,'SIC_TO_GICS_BRIDGE','high','→ Equity REITs'),
  ('REIT - Industrial','industry',601010,60,'SIC_TO_GICS_BRIDGE','high','→ Equity REITs'),
  ('REIT - Retail','industry',601010,60,'SIC_TO_GICS_BRIDGE','high','→ Equity REITs'),
  ('Restaurants','industry',253010,25,'SIC_TO_GICS_BRIDGE','high','→ Hotels, Restaurants & Leisure'),
  ('Scientific Instruments','industry',452030,45,'SIC_TO_GICS_BRIDGE','high','→ Electronic Equipment, Instruments & Components'),
  ('Semiconductors','industry',453010,45,'SIC_TO_GICS_BRIDGE','high','→ Semiconductors & Semiconductor Equipment'),
  ('Steel','industry',151040,15,'SIC_TO_GICS_BRIDGE','high','→ Metals & Mining'),
  ('Telecom','industry',501010,50,'SIC_TO_GICS_BRIDGE','high','→ Diversified Telecommunication Services'),
  ('Telecom Services','industry',501010,50,'SIC_TO_GICS_BRIDGE','high','→ Diversified Telecommunication Services'),
  ('Utilities - Diversified','industry',551030,55,'SIC_TO_GICS_BRIDGE','high','→ Multi-Utilities'),
  ('Drug Manufacturers','industry',352020,35,'SIC_TO_GICS_BRIDGE','high','→ Pharmaceuticals'),
  ('Travel Services','industry',253010,25,'SIC_TO_GICS_BRIDGE','high','→ Hotels, Restaurants & Leisure'),
  ('Household & Personal Products','industry',303010,30,'SIC_TO_GICS_BRIDGE','high','→ Household Products'),
  ('Specialty Chemicals','industry',151010,15,'SIC_TO_GICS_BRIDGE','high','→ Chemicals')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 1. DROP all functions
-- ============================================================
DROP FUNCTION IF EXISTS public.get_sector_performance();
DROP FUNCTION IF EXISTS public.get_heatmap_data();
DROP FUNCTION IF EXISTS public.get_market_summary();
DROP FUNCTION IF EXISTS public.get_industry_ranking(boolean, integer);
DROP FUNCTION IF EXISTS public.get_equity_screener_rows(text, text, text, integer, integer, text);
DROP FUNCTION IF EXISTS public.get_equity_screener_count(text, text, text, text);

-- ============================================================
-- 2. get_sector_performance
-- ============================================================
CREATE FUNCTION public.get_sector_performance()
RETURNS TABLE(sector_name text, avg_daily_pct numeric, stock_count bigint, pct_above_ma50 numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (wi.symbol) wi.symbol, wi.pct_change_1d, wi.above_ma50, s.canonical_sector
    FROM wsp_indicators wi JOIN symbols s ON s.symbol = wi.symbol
    WHERE s.canonical_sector IN (SELECT gs.sector_name FROM canonical_gics_sectors gs)
      AND s.is_etf IS NOT TRUE AND s.universe_tier != 'benchmark'
    ORDER BY wi.symbol, wi.calc_date DESC
  )
  SELECT canonical_sector,
    ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pct_change_1d))::numeric, 2),
    COUNT(*)::bigint,
    ROUND(AVG(CASE WHEN above_ma50 THEN 100.0 ELSE 0.0 END)::numeric, 1)
  FROM latest GROUP BY canonical_sector ORDER BY 2 DESC NULLS LAST;
$$;

-- ============================================================
-- 3. get_heatmap_data
-- ============================================================
CREATE FUNCTION public.get_heatmap_data()
RETURNS TABLE(symbol text, canonical_sector text, pct_change_1d numeric, close numeric, wsp_pattern text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (wi.symbol)
    wi.symbol, s.canonical_sector, wi.pct_change_1d, wi.close, wi.wsp_pattern
  FROM wsp_indicators wi JOIN symbols s ON s.symbol = wi.symbol
  WHERE s.canonical_sector IN (SELECT gs.sector_name FROM canonical_gics_sectors gs)
    AND s.is_etf IS NOT TRUE AND s.universe_tier != 'benchmark' AND wi.pct_change_1d IS NOT NULL
  ORDER BY wi.symbol, wi.calc_date DESC;
$$;

-- ============================================================
-- 4. get_market_summary
-- ============================================================
CREATE FUNCTION public.get_market_summary()
RETURNS TABLE(sector_name text, avg_pct_today numeric, avg_wsp_score numeric,
  pct_above_ma50 numeric, symbol_count bigint, top_pattern text, wsp_regime text, wsp_setups bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (wi.symbol) wi.symbol, wi.pct_change_1d, wi.above_ma50, wi.wsp_score, wi.wsp_pattern, s.canonical_sector
    FROM wsp_indicators wi JOIN symbols s ON s.symbol = wi.symbol
    WHERE s.canonical_sector IN (SELECT gs.sector_name FROM canonical_gics_sectors gs)
      AND s.is_etf IS NOT TRUE AND s.universe_tier != 'benchmark'
    ORDER BY wi.symbol, wi.calc_date DESC
  ),
  agg AS (
    SELECT canonical_sector,
      ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pct_change_1d))::numeric, 2) AS med_pct,
      ROUND(AVG(COALESCE(wsp_score, 0))::numeric, 2) AS avg_sc,
      ROUND(AVG(CASE WHEN above_ma50 THEN 100.0 ELSE 0.0 END)::numeric, 1) AS pct50,
      COUNT(*)::bigint AS cnt,
      MODE() WITHIN GROUP (ORDER BY COALESCE(wsp_pattern, 'downhill')) AS tp,
      COUNT(*) FILTER (WHERE COALESCE(wsp_score,0) >= 3)::bigint AS setups
    FROM latest GROUP BY canonical_sector
  )
  SELECT canonical_sector, med_pct, avg_sc, pct50, cnt, tp,
    CASE WHEN pct50 >= 65 THEN 'BULLISH' WHEN pct50 >= 45 THEN 'NEUTRAL' ELSE 'BEARISH' END, setups
  FROM agg ORDER BY med_pct DESC NULLS LAST;
$$;

-- ============================================================
-- 5. get_industry_ranking
-- ============================================================
CREATE FUNCTION public.get_industry_ranking(p_leading_only boolean DEFAULT false, p_limit integer DEFAULT NULL)
RETURNS TABLE(display_industry text, sector text, symbol_count bigint, avg_wsp_score numeric,
  breakout_count bigint, valid_entry_count bigint, buy_count bigint, watch_count bigint,
  rank_score numeric, rank_position bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH scan AS (
    SELECT r.symbol, r.score, r.recommendation, r.breakout_status, r.industry,
      CASE r.sector WHEN 'Technology' THEN 'Information Technology' WHEN 'Healthcare' THEN 'Health Care' ELSE r.sector END AS ns
    FROM market_scan_results_latest r
    WHERE r.symbol IS NOT NULL AND r.sector IS NOT NULL AND r.industry IS NOT NULL
      AND r.industry NOT IN ('ETF','Stocks Proxy Basket','Unknown','Stocks','Other')
      AND r.sector NOT IN ('Stocks','ETF','Unknown')
  ),
  resolved AS (
    SELECT s.symbol, s.score, s.recommendation, s.breakout_status,
      COALESCE(gi_a.industry_name, gi_d.industry_name) AS ci,
      COALESCE(gs_a.sector_name, gs_d.sector_name, s.ns) AS cs
    FROM scan s
    LEFT JOIN taxonomy_alias_map tam ON tam.raw_label = display_industry(s.industry) AND tam.label_type = 'industry'
    LEFT JOIN canonical_gics_industries gi_a ON gi_a.industry_code = tam.canonical_industry_code
    LEFT JOIN canonical_gics_sectors gs_a ON gs_a.sector_code = tam.canonical_sector_code
    LEFT JOIN canonical_gics_industries gi_d ON gi_d.industry_name = display_industry(s.industry)
    LEFT JOIN canonical_gics_sectors gs_d ON gs_d.sector_code = gi_d.sector_code
  ),
  canonical AS (
    SELECT * FROM resolved WHERE ci IS NOT NULL AND cs IN (SELECT sector_name FROM canonical_gics_sectors)
  ),
  ag AS (
    SELECT ci, cs, count(*) AS c, avg(COALESCE(score,0))::numeric AS a,
      count(*) FILTER (WHERE breakout_status IN ('FRESH_BREAKOUT','APPROACHING')) AS bo,
      count(*) FILTER (WHERE recommendation='KÖP' OR (recommendation='BEVAKA' AND COALESCE(score,0)>=3)) AS ve,
      count(*) FILTER (WHERE recommendation='KÖP') AS bu,
      count(*) FILTER (WHERE recommendation='BEVAKA') AS wa
    FROM canonical GROUP BY ci, cs HAVING count(*) >= 2
  ),
  rk AS (
    SELECT *, (a*20+bo*15+bu*10+ve*5)::numeric AS sc,
      ROW_NUMBER() OVER (ORDER BY (a*20+bo*15+bu*10+ve*5) DESC) AS rp
    FROM ag WHERE (NOT p_leading_only OR (a*20+bo*15+bu*10+ve*5) > 0)
  )
  SELECT rk.ci, rk.cs, rk.c, ROUND(rk.a,2), rk.bo, rk.ve, rk.bu, rk.wa, ROUND(rk.sc,1), rk.rp
  FROM rk ORDER BY rk.rp LIMIT p_limit;
$$;

-- ============================================================
-- 6. get_equity_screener_rows
-- ============================================================
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
      COALESCE(gi.industry_name,
        CASE WHEN display_industry(r.industry) IN (SELECT industry_name FROM canonical_gics_industries) THEN display_industry(r.industry) ELSE NULL END
      ) AS ni,
      COALESCE(r.score, 0)::integer AS ws, r.pattern AS ps, r.breakout_status AS bs, r.recommendation AS rc, r.payload, r.blockers
    FROM market_scan_results_latest r
    JOIN symbols s ON s.symbol = r.symbol
    LEFT JOIN taxonomy_alias_map tam ON tam.raw_label = display_industry(r.industry) AND tam.label_type = 'industry'
    LEFT JOIN canonical_gics_industries gi ON gi.industry_code = tam.canonical_industry_code
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

-- ============================================================
-- 7. get_equity_screener_count
-- ============================================================
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
      COALESCE(gi.industry_name,
        CASE WHEN display_industry(r.industry) IN (SELECT industry_name FROM canonical_gics_industries) THEN display_industry(r.industry) ELSE NULL END
      ) AS ni,
      r.pattern AS ps
    FROM market_scan_results_latest r
    JOIN symbols s ON s.symbol = r.symbol
    LEFT JOIN taxonomy_alias_map tam ON tam.raw_label = display_industry(r.industry) AND tam.label_type = 'industry'
    LEFT JOIN canonical_gics_industries gi ON gi.industry_code = tam.canonical_industry_code
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
