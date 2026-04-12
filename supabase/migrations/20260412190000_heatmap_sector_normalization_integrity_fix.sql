-- Integrity fix: enforce 11-sector GICS normalization for heatmap and screener read paths.

CREATE OR REPLACE FUNCTION public.get_heatmap_data()
 RETURNS TABLE(symbol text, canonical_sector text, pct_change_1d numeric, close numeric, wsp_pattern text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (wi.symbol)
    wi.symbol,
    CASE
      WHEN s.canonical_sector = 'Health Care' THEN 'Healthcare'
      WHEN s.canonical_sector = 'Information Technology' THEN 'Technology'
      WHEN s.canonical_sector = 'Metals & Mining' THEN 'Materials'
      ELSE s.canonical_sector
    END AS canonical_sector,
    wi.pct_change_1d,
    wi.close,
    wi.wsp_pattern
  FROM wsp_indicators wi
  JOIN symbols s ON s.symbol = wi.symbol
  WHERE s.canonical_sector IN (
    'Communication Services',
    'Consumer Discretionary',
    'Consumer Staples',
    'Energy',
    'Financials',
    'Healthcare',
    'Health Care',
    'Industrials',
    'Materials',
    'Metals & Mining',
    'Real Estate',
    'Technology',
    'Information Technology',
    'Utilities'
  )
    AND wi.pct_change_1d IS NOT NULL
  ORDER BY wi.symbol, wi.calc_date DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_equity_screener_rows(
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50,
  p_universe_tier text DEFAULT NULL,
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
  payload jsonb
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  WITH ranked AS (
    SELECT
      msr.symbol,
      CASE msr.sector
        WHEN 'Information Technology' THEN 'Technology'
        WHEN 'Health Care' THEN 'Healthcare'
        WHEN 'Metals & Mining' THEN 'Materials'
        ELSE msr.sector
      END AS norm_sector,
      COALESCE(public.display_industry(msr.industry), msr.industry) AS norm_industry,
      msr.pattern AS pattern_state,
      msr.recommendation,
      msr.score AS wsp_score,
      msr.payload,
      (CASE WHEN (msr.payload->>'mansfield_rs') IS NOT NULL THEN 15 ELSE 0 END
       + CASE WHEN msr.industry IS NOT NULL AND msr.industry NOT IN ('Unknown','Stocks','') THEN 10 ELSE 0 END
       + CASE WHEN (msr.payload->>'resistance_level') IS NOT NULL THEN 5 ELSE 0 END)
      + (CASE
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 5000000 THEN 25
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 1000000 THEN 20
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 500000  THEN 15
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 100000  THEN 10
          ELSE 0 END)
      + (CASE
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 20 THEN 20
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 10 THEN 15
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 5  THEN 10
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 0  THEN 5
          ELSE 0 END)
      + (CASE
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -2  THEN 15
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -5  THEN 12
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -10 THEN 8
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -20 THEN 4
          ELSE 0 END)
      + (CASE
          WHEN (msr.payload->>'volume_ratio')::numeric >= 2.0 THEN 10
          WHEN (msr.payload->>'volume_ratio')::numeric >= 1.5 THEN 7
          WHEN (msr.payload->>'volume_ratio')::numeric >= 1.0 THEN 4
          ELSE 0 END)
      AS trust_rank
    FROM public.market_scan_results_latest msr
    JOIN public.symbols s ON s.symbol = msr.symbol
    WHERE msr.symbol IS NOT NULL
      AND (p_universe_tier IS NULL OR s.universe_tier = p_universe_tier)
  )
  SELECT r.symbol, r.norm_sector AS sector, r.norm_industry AS industry,
         r.pattern_state, r.recommendation, r.wsp_score, r.payload
  FROM ranked r
  WHERE (p_sector IS NULL OR r.norm_sector = p_sector)
    AND (p_industry IS NULL OR r.norm_industry = p_industry)
    AND (p_pattern IS NULL OR r.pattern_state = p_pattern)
  ORDER BY
    CASE WHEN r.norm_sector IN (
      'Communication Services','Consumer Discretionary','Consumer Staples',
      'Energy','Financials','Healthcare','Industrials','Materials',
      'Real Estate','Technology','Utilities'
    ) THEN 0 ELSE 1 END,
    CASE r.recommendation
      WHEN 'KÖP' THEN 0 WHEN 'BEVAKA' THEN 1 WHEN 'AVVAKTA' THEN 2 WHEN 'SÄLJ' THEN 3 ELSE 4 END,
    CASE r.pattern_state
      WHEN 'climbing' THEN 0 WHEN 'base' THEN 1 WHEN 'tired' THEN 2 WHEN 'downhill' THEN 3 ELSE 4 END,
    r.trust_rank DESC,
    r.wsp_score DESC NULLS LAST,
    r.symbol ASC
  LIMIT p_page_size
  OFFSET p_page * p_page_size;
$function$;

CREATE OR REPLACE FUNCTION public.get_equity_screener_count(
  p_universe_tier text DEFAULT NULL,
  p_sector text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_pattern text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  SELECT count(*)::integer
  FROM public.market_scan_results_latest msr
  JOIN public.symbols s ON s.symbol = msr.symbol
  WHERE msr.symbol IS NOT NULL
    AND (p_universe_tier IS NULL OR s.universe_tier = p_universe_tier)
    AND (p_sector IS NULL OR CASE msr.sector
      WHEN 'Information Technology' THEN 'Technology'
      WHEN 'Health Care' THEN 'Healthcare'
      WHEN 'Metals & Mining' THEN 'Materials'
      ELSE msr.sector END = p_sector)
    AND (p_industry IS NULL OR COALESCE(public.display_industry(msr.industry), msr.industry) = p_industry)
    AND (p_pattern IS NULL OR msr.pattern = p_pattern);
$function$;

CREATE OR REPLACE FUNCTION public.get_top_wsp_setups()
RETURNS TABLE(symbol text, sector text, industry text, pattern text, recommendation text, score integer, vol_ratio numeric, payload jsonb)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  WITH ranked AS (
    SELECT
      msr.symbol,
      CASE msr.sector
        WHEN 'Information Technology' THEN 'Technology'
        WHEN 'Health Care' THEN 'Healthcare'
        WHEN 'Metals & Mining' THEN 'Materials'
        ELSE msr.sector
      END AS sector,
      COALESCE(public.display_industry(msr.industry), msr.industry) AS industry,
      msr.pattern,
      msr.recommendation,
      msr.score,
      (msr.payload->>'volume_ratio')::numeric AS vol_ratio,
      msr.payload,
      (CASE WHEN (msr.payload->>'mansfield_rs') IS NOT NULL THEN 15 ELSE 0 END
       + CASE WHEN msr.industry IS NOT NULL AND msr.industry NOT IN ('Unknown','Stocks','') THEN 10 ELSE 0 END
       + CASE WHEN (msr.payload->>'resistance_level') IS NOT NULL THEN 5 ELSE 0 END)
      + (CASE
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 5000000 THEN 25
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 1000000 THEN 20
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 500000  THEN 15
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 100000  THEN 10
          ELSE 0 END)
      + (CASE
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 20 THEN 20
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 10 THEN 15
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 5  THEN 10
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 0  THEN 5
          ELSE 0 END)
      + (CASE
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -2  THEN 15
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -5  THEN 12
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -10 THEN 8
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -20 THEN 4
          ELSE 0 END)
      + (CASE
          WHEN (msr.payload->>'volume_ratio')::numeric >= 2.0 THEN 10
          WHEN (msr.payload->>'volume_ratio')::numeric >= 1.5 THEN 7
          WHEN (msr.payload->>'volume_ratio')::numeric >= 1.0 THEN 4
          ELSE 0 END)
      AS trust_rank
    FROM public.market_scan_results_latest msr
    WHERE msr.symbol IS NOT NULL
      AND msr.sector IN (
        'Communication Services','Consumer Discretionary','Consumer Staples',
        'Energy','Financials','Healthcare','Industrials','Materials',
        'Real Estate','Technology','Utilities','Information Technology',
        'Health Care','Metals & Mining'
      )
  )
  SELECT r.symbol, r.sector, r.industry, r.pattern, r.recommendation,
         r.score, r.vol_ratio, r.payload
  FROM ranked r
  ORDER BY
    CASE r.recommendation
      WHEN 'KÖP' THEN 0 WHEN 'BEVAKA' THEN 1 WHEN 'AVVAKTA' THEN 2 WHEN 'SÄLJ' THEN 3 ELSE 4 END,
    CASE WHEN r.industry IS NULL OR r.industry IN ('Unknown','Stocks','Stocks Proxy Basket','') THEN 1 ELSE 0 END,
    r.trust_rank DESC,
    r.score DESC NULLS LAST,
    r.symbol ASC
  LIMIT 15;
$function$;
