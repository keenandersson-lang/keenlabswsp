
DROP FUNCTION IF EXISTS public.get_sector_ranking();
DROP FUNCTION IF EXISTS public.get_industry_ranking(boolean, integer);
DROP FUNCTION IF EXISTS public.get_market_summary();
DROP FUNCTION IF EXISTS public.get_equity_screener_rows(integer, integer, text, text, text, text);
DROP FUNCTION IF EXISTS public.get_equity_screener_count(text, text, text, text);

CREATE FUNCTION public.get_sector_ranking()
RETURNS TABLE(
  sector_name text, rank_position bigint, is_leading boolean, wsp_regime text,
  pct_above_ma50 numeric, avg_wsp_score numeric, avg_pct_today numeric,
  symbol_count bigint, wsp_setups bigint, top_pattern text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH sm AS (
    SELECT CASE r.sector WHEN 'Technology' THEN 'Information Technology' WHEN 'Healthcare' THEN 'Health Care' ELSE r.sector END AS ms, r.*
    FROM market_scan_results_latest r WHERE r.symbol IS NOT NULL AND r.sector IS NOT NULL
  ),
  f AS (SELECT * FROM sm WHERE ms IN (SELECT s.sector_name FROM canonical_gics_sectors s)),
  ag AS (
    SELECT ms, count(*) AS c,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (payload->>'pct_change_1d')::numeric) AS med,
      avg(COALESCE(score,0))::numeric AS avs,
      count(*) FILTER (WHERE (payload->>'above_ma50')::boolean IS TRUE) AS a50,
      count(*) FILTER (WHERE recommendation='KÖP' OR recommendation='BEVAKA') AS su,
      mode() WITHIN GROUP (ORDER BY COALESCE(pattern,'base')) AS dp
    FROM f GROUP BY ms
  )
  SELECT ag.ms, ROW_NUMBER() OVER (ORDER BY ag.avs DESC, ag.med DESC),
    (ag.avs >= 2.5 AND ag.a50::numeric/NULLIF(ag.c,0) >= 0.5),
    CASE WHEN ag.a50::numeric/NULLIF(ag.c,0)>=0.7 THEN 'BULLISH' WHEN ag.a50::numeric/NULLIF(ag.c,0)>=0.4 THEN 'NEUTRAL' ELSE 'BEARISH' END,
    ROUND(ag.a50::numeric/NULLIF(ag.c,0)*100,1), ROUND(ag.avs,2), ROUND(COALESCE(ag.med,0)::numeric,2),
    ag.c, ag.su, ag.dp
  FROM ag ORDER BY 2;
$$;

CREATE FUNCTION public.get_industry_ranking(p_leading_only boolean DEFAULT false, p_limit integer DEFAULT NULL)
RETURNS TABLE(
  display_industry text, sector text, symbol_count bigint, avg_wsp_score numeric,
  breakout_count bigint, valid_entry_count bigint, buy_count bigint, watch_count bigint,
  rank_score numeric, rank_position bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH sm AS (
    SELECT CASE r.sector WHEN 'Technology' THEN 'Information Technology' WHEN 'Healthcare' THEN 'Health Care' ELSE r.sector END AS ms, r.*
    FROM market_scan_results_latest r WHERE r.symbol IS NOT NULL AND r.sector IS NOT NULL AND r.industry IS NOT NULL
  ),
  cr AS (SELECT * FROM sm WHERE ms IN (SELECT sector_name FROM canonical_gics_sectors) AND industry NOT IN ('ETF','Stocks Proxy Basket','Unknown','Stocks','Other')),
  im AS (
    SELECT cr.*, COALESCE(gi.industry_name, display_industry(cr.industry)) AS ri, COALESCE(gs.sector_name, cr.ms) AS rs
    FROM cr LEFT JOIN taxonomy_alias_map tam ON tam.raw_label=cr.industry AND tam.label_type='industry'
    LEFT JOIN canonical_gics_industries gi ON gi.industry_code=tam.canonical_industry_code
    LEFT JOIN canonical_gics_sectors gs ON gs.sector_code=tam.canonical_sector_code
  ),
  ag AS (
    SELECT ri, rs, count(*) AS c, avg(COALESCE(score,0))::numeric AS a,
      count(*) FILTER (WHERE breakout_status IN ('FRESH_BREAKOUT','APPROACHING')) AS bo,
      count(*) FILTER (WHERE recommendation='KÖP' OR (recommendation='BEVAKA' AND COALESCE(score,0)>=3)) AS ve,
      count(*) FILTER (WHERE recommendation='KÖP') AS bu,
      count(*) FILTER (WHERE recommendation='BEVAKA') AS wa
    FROM im GROUP BY ri, rs HAVING count(*)>=2
  ),
  rk AS (
    SELECT *, (a*20+bo*15+bu*10+ve*5)::numeric AS sc, ROW_NUMBER() OVER (ORDER BY (a*20+bo*15+bu*10+ve*5) DESC) AS rp FROM ag
  )
  SELECT rk.ri, rk.rs, rk.c, ROUND(rk.a,2), rk.bo, rk.ve, rk.bu, rk.wa, ROUND(rk.sc,1), rk.rp
  FROM rk ORDER BY rk.rp LIMIT p_limit;
$$;

CREATE FUNCTION public.get_market_summary()
RETURNS TABLE(
  sector_name text, symbol_count bigint, avg_pct_today numeric, pct_above_ma50 numeric,
  avg_wsp_score numeric, wsp_setups bigint, top_pattern text, wsp_regime text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH sm AS (
    SELECT CASE r.sector WHEN 'Technology' THEN 'Information Technology' WHEN 'Healthcare' THEN 'Health Care' ELSE r.sector END AS ms, r.*
    FROM market_scan_results_latest r WHERE r.symbol IS NOT NULL AND r.sector IS NOT NULL
  ),
  f AS (SELECT * FROM sm WHERE ms IN (SELECT sector_name FROM canonical_gics_sectors)),
  ag AS (
    SELECT ms, count(*) AS c,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (payload->>'pct_change_1d')::numeric) AS med,
      avg(COALESCE(score,0))::numeric AS a,
      count(*) FILTER (WHERE (payload->>'above_ma50')::boolean IS TRUE) AS a50,
      count(*) FILTER (WHERE recommendation='KÖP' OR recommendation='BEVAKA') AS su,
      mode() WITHIN GROUP (ORDER BY COALESCE(pattern,'base')) AS dp
    FROM f GROUP BY ms
  )
  SELECT ag.ms, ag.c, ROUND(COALESCE(ag.med,0)::numeric,2), ROUND(ag.a50::numeric/NULLIF(ag.c,0)*100,1),
    ROUND(ag.a,2), ag.su, ag.dp,
    CASE WHEN ag.a50::numeric/NULLIF(ag.c,0)>=0.7 THEN 'BULLISH' WHEN ag.a50::numeric/NULLIF(ag.c,0)>=0.4 THEN 'NEUTRAL' ELSE 'BEARISH' END
  FROM ag ORDER BY ag.a DESC;
$$;

CREATE FUNCTION public.get_equity_screener_rows(
  p_page integer DEFAULT 0, p_page_size integer DEFAULT 50,
  p_universe_tier text DEFAULT NULL, p_sector text DEFAULT NULL,
  p_industry text DEFAULT NULL, p_pattern text DEFAULT NULL
)
RETURNS TABLE(
  symbol text, sector text, industry text, pattern_state text,
  recommendation text, wsp_score integer, payload jsonb,
  blockers text[], breakout_status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH base AS (
    SELECT r.symbol,
      CASE r.sector WHEN 'Technology' THEN 'Information Technology' WHEN 'Healthcare' THEN 'Health Care' ELSE r.sector END AS ms,
      COALESCE(gi.industry_name, display_industry(r.industry)) AS mi,
      COALESCE(r.pattern,'base') AS p, COALESCE(r.recommendation,'BEVAKA') AS rc,
      COALESCE(r.score,0) AS sc, r.payload, r.blockers,
      COALESCE(r.breakout_status,'NONE') AS bs, s.universe_tier
    FROM market_scan_results_latest r
    JOIN symbols s ON s.symbol=r.symbol
    LEFT JOIN taxonomy_alias_map tam ON tam.raw_label=r.industry AND tam.label_type='industry'
    LEFT JOIN canonical_gics_industries gi ON gi.industry_code=tam.canonical_industry_code
    WHERE r.symbol IS NOT NULL
  )
  SELECT b.symbol, b.ms, b.mi, b.p, b.rc, b.sc, b.payload, b.blockers, b.bs
  FROM base b
  WHERE (p_universe_tier IS NULL OR b.universe_tier=p_universe_tier)
    AND (p_sector IS NULL OR b.ms=p_sector)
    AND (p_industry IS NULL OR b.mi=p_industry)
    AND (p_pattern IS NULL OR b.p=p_pattern)
  ORDER BY CASE WHEN b.ms IN (SELECT sector_name FROM canonical_gics_sectors) THEN 0 ELSE 1 END, b.sc DESC, b.symbol
  OFFSET p_page*p_page_size LIMIT p_page_size;
$$;

CREATE FUNCTION public.get_equity_screener_count(
  p_universe_tier text DEFAULT NULL, p_sector text DEFAULT NULL,
  p_industry text DEFAULT NULL, p_pattern text DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH base AS (
    SELECT r.symbol,
      CASE r.sector WHEN 'Technology' THEN 'Information Technology' WHEN 'Healthcare' THEN 'Health Care' ELSE r.sector END AS ms,
      COALESCE(gi.industry_name, display_industry(r.industry)) AS mi,
      COALESCE(r.pattern,'base') AS p, s.universe_tier
    FROM market_scan_results_latest r
    JOIN symbols s ON s.symbol=r.symbol
    LEFT JOIN taxonomy_alias_map tam ON tam.raw_label=r.industry AND tam.label_type='industry'
    LEFT JOIN canonical_gics_industries gi ON gi.industry_code=tam.canonical_industry_code
    WHERE r.symbol IS NOT NULL
  )
  SELECT count(*) FROM base b
  WHERE (p_universe_tier IS NULL OR b.universe_tier=p_universe_tier)
    AND (p_sector IS NULL OR b.ms=p_sector)
    AND (p_industry IS NULL OR b.mi=p_industry)
    AND (p_pattern IS NULL OR b.p=p_pattern);
$$;
