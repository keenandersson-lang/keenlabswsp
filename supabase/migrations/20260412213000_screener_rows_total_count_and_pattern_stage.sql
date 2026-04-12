CREATE OR REPLACE FUNCTION public.get_equity_screener_rows(
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50,
  p_universe_tier text DEFAULT NULL,
  p_sector text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_pattern_stage text DEFAULT NULL
)
RETURNS TABLE(
  symbol text,
  sector text,
  industry text,
  pattern_state text,
  recommendation text,
  wsp_score integer,
  total_count bigint,
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
      public.resolve_visible_surface_industry(msr.symbol, msr.industry) AS norm_industry,
      msr.pattern AS pattern_state,
      msr.recommendation,
      msr.score AS wsp_score,
      msr.payload,
      CASE
        WHEN public.resolve_visible_surface_industry(msr.symbol, msr.industry) IN ('Unknown', 'Stocks', 'ETF', 'Stocks Proxy Basket', '') THEN 0
        WHEN public.resolve_visible_surface_industry(msr.symbol, msr.industry) = 'Other' THEN -2
        ELSE 2
      END AS industry_quality,
      (
        COALESCE(msr.score, 0)::numeric * 9
        + GREATEST(LEAST(COALESCE((msr.payload->>'mansfield_rs')::numeric, 0), 35), -15) * 0.9
        + GREATEST(LEAST(COALESCE((msr.payload->>'volume_ratio')::numeric, 0), 4), 0) * 8
        + GREATEST(LEAST(20 + COALESCE((msr.payload->>'pct_from_52w_high')::numeric, -35), 20), 0)
        + CASE WHEN COALESCE((msr.payload->>'breakout_quality_pass')::boolean, false) THEN 18 ELSE 0 END
        + CASE WHEN COALESCE((msr.payload->>'breakout_confirmed')::boolean, false) THEN 10 ELSE 0 END
        + CASE WHEN msr.recommendation = 'KÖP' THEN 8 WHEN msr.recommendation = 'BEVAKA' THEN 3 ELSE 0 END
      ) AS quality_rank
    FROM public.market_scan_results_latest msr
    JOIN public.symbols s ON s.symbol = msr.symbol
    WHERE msr.symbol IS NOT NULL
      AND (p_universe_tier IS NULL OR s.universe_tier = p_universe_tier)
  ),
  filtered AS (
    SELECT *
    FROM ranked r
    WHERE (p_sector IS NULL OR r.norm_sector = p_sector)
      AND (p_industry IS NULL OR r.norm_industry = p_industry)
      AND (p_pattern_stage IS NULL OR r.pattern_state = p_pattern_stage)
  )
  SELECT
    r.symbol,
    r.norm_sector AS sector,
    r.norm_industry AS industry,
    r.pattern_state,
    r.recommendation,
    r.wsp_score,
    COUNT(*) OVER () AS total_count,
    r.payload
  FROM filtered r
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
    r.industry_quality DESC,
    CASE WHEN r.norm_industry = 'Other' THEN -70 ELSE 0 END,
    r.quality_rank DESC,
    r.wsp_score DESC NULLS LAST,
    r.symbol ASC
  LIMIT p_page_size
  OFFSET p_page * p_page_size;
$function$;
