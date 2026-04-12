-- Surgical visible-surface cleanup pass:
-- 1) expose exact visible symbols still mapped to Other,
-- 2) tighten visible-surface industry fallback resolution,
-- 3) increase ranking penalty for Other in screener/top setups.

CREATE OR REPLACE FUNCTION public.resolve_visible_surface_industry(
  p_symbol text,
  p_scan_industry text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    NULLIF(public.display_industry(NULLIF(trim(p_scan_industry), '')), ''),
    NULLIF(public.display_industry(NULLIF(trim(sia.canonical_industry), '')), ''),
    NULLIF(public.display_industry(NULLIF(trim(s.canonical_industry), '')), ''),
    NULLIF(public.display_industry(NULLIF(trim(s.industry), '')), ''),
    NULLIF(NULLIF(trim(p_scan_industry), ''), 'Unknown'),
    NULLIF(NULLIF(trim(sia.canonical_industry), ''), 'Unknown'),
    NULLIF(NULLIF(trim(s.canonical_industry), ''), 'Unknown'),
    NULLIF(NULLIF(trim(s.industry), ''), 'Unknown'),
    'Unknown'
  )
  FROM public.symbols s
  LEFT JOIN public.symbol_industry_alignment_active sia ON sia.symbol = s.symbol
  WHERE s.symbol = p_symbol;
$function$;

CREATE OR REPLACE FUNCTION public.get_visible_surface_other_symbols(
  p_screener_limit integer DEFAULT 100
)
RETURNS TABLE(
  visible_surface text,
  symbol text,
  sector text,
  resolved_industry text,
  scan_industry text,
  canonical_industry text,
  alignment_industry text,
  fallback_hint text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      msr.symbol,
      CASE msr.sector
        WHEN 'Information Technology' THEN 'Technology'
        WHEN 'Health Care' THEN 'Healthcare'
        WHEN 'Metals & Mining' THEN 'Materials'
        ELSE msr.sector
      END AS sector,
      msr.industry AS scan_industry,
      s.canonical_industry,
      sia.canonical_industry AS alignment_industry,
      public.resolve_visible_surface_industry(msr.symbol, msr.industry) AS resolved_industry,
      msr.pattern,
      msr.recommendation,
      msr.score,
      msr.payload,
      (
        COALESCE(msr.score, 0)::numeric * 9
        + GREATEST(LEAST(COALESCE((msr.payload->>'mansfield_rs')::numeric, 0), 35), -15) * 0.9
        + GREATEST(LEAST(COALESCE((msr.payload->>'volume_ratio')::numeric, 0), 4), 0) * 8
        + GREATEST(LEAST(20 + COALESCE((msr.payload->>'pct_from_52w_high')::numeric, -35), 20), 0)
        + CASE WHEN COALESCE((msr.payload->>'breakout_quality_pass')::boolean, false) THEN 18 ELSE 0 END
        + CASE WHEN COALESCE((msr.payload->>'breakout_confirmed')::boolean, false) THEN 10 ELSE 0 END
      ) AS quality_rank
    FROM public.market_scan_results_latest msr
    JOIN public.symbols s ON s.symbol = msr.symbol
    LEFT JOIN public.symbol_industry_alignment_active sia ON sia.symbol = msr.symbol
    WHERE msr.symbol IS NOT NULL
  ),
  top_setups AS (
    SELECT 'dashboard_top_setups'::text AS visible_surface, b.*
    FROM base b
    ORDER BY
      CASE b.recommendation
        WHEN 'KÖP' THEN 0 WHEN 'BEVAKA' THEN 1 WHEN 'AVVAKTA' THEN 2 WHEN 'SÄLJ' THEN 3 ELSE 4 END,
      CASE b.pattern
        WHEN 'climbing' THEN 0 WHEN 'base' THEN 1 WHEN 'tired' THEN 2 WHEN 'downhill' THEN 3 ELSE 4 END,
      b.quality_rank DESC,
      b.score DESC NULLS LAST,
      b.symbol ASC
    LIMIT 15
  ),
  screener_top AS (
    SELECT 'screener_top_100'::text AS visible_surface, b.*
    FROM base b
    ORDER BY
      CASE b.recommendation
        WHEN 'KÖP' THEN 0 WHEN 'BEVAKA' THEN 1 WHEN 'AVVAKTA' THEN 2 WHEN 'SÄLJ' THEN 3 ELSE 4 END,
      CASE b.pattern
        WHEN 'climbing' THEN 0 WHEN 'base' THEN 1 WHEN 'tired' THEN 2 WHEN 'downhill' THEN 3 ELSE 4 END,
      b.quality_rank DESC,
      b.score DESC NULLS LAST,
      b.symbol ASC
    LIMIT GREATEST(COALESCE(p_screener_limit, 100), 1)
  ),
  heatmap_visible AS (
    SELECT *
    FROM (
      SELECT
        'heatmap_visible_symbols'::text AS visible_surface,
        b.*,
        ROW_NUMBER() OVER (
          PARTITION BY b.sector
          ORDER BY
            CASE b.recommendation
              WHEN 'KÖP' THEN 0 WHEN 'BEVAKA' THEN 1 WHEN 'AVVAKTA' THEN 2 WHEN 'SÄLJ' THEN 3 ELSE 4 END,
            b.quality_rank DESC,
            b.score DESC NULLS LAST,
            b.symbol ASC
        ) AS sector_row
      FROM base b
      WHERE b.sector IN (
        'Communication Services','Consumer Discretionary','Consumer Staples',
        'Energy','Financials','Healthcare','Industrials','Materials',
        'Real Estate','Technology','Utilities'
      )
    ) ranked
    WHERE ranked.sector_row <= 5
  )
  SELECT
    v.visible_surface,
    v.symbol,
    v.sector,
    v.resolved_industry,
    v.scan_industry,
    v.canonical_industry,
    v.alignment_industry,
    CASE
      WHEN v.canonical_industry IS NOT NULL AND v.canonical_industry NOT IN ('', 'Unknown', 'Other') THEN 'promote_symbols.canonical_industry'
      WHEN v.alignment_industry IS NOT NULL AND v.alignment_industry NOT IN ('', 'Unknown', 'Other') THEN 'promote_symbol_industry_alignment_active.canonical_industry'
      WHEN v.scan_industry IS NOT NULL AND v.scan_industry NOT IN ('', 'Unknown', 'Other') THEN 'expand_display_industry_pattern_for_scan_industry'
      ELSE 'manual_review_required'
    END AS fallback_hint
  FROM (
    SELECT * FROM top_setups
    UNION ALL
    SELECT * FROM screener_top
    UNION ALL
    SELECT * FROM heatmap_visible
  ) v
  WHERE v.resolved_industry = 'Other'
  ORDER BY v.visible_surface, v.sector, v.symbol;
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
    r.industry_quality DESC,
    CASE WHEN r.norm_industry = 'Other' THEN -70 ELSE 0 END,
    r.quality_rank DESC,
    r.wsp_score DESC NULLS LAST,
    r.symbol ASC
  LIMIT p_page_size
  OFFSET p_page * p_page_size;
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
      public.resolve_visible_surface_industry(msr.symbol, msr.industry) AS industry,
      msr.pattern,
      msr.recommendation,
      msr.score,
      (msr.payload->>'volume_ratio')::numeric AS vol_ratio,
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
      ) AS quality_rank
    FROM public.market_scan_results_latest msr
    JOIN public.symbols s ON s.symbol = msr.symbol
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
    CASE r.pattern
      WHEN 'climbing' THEN 0 WHEN 'base' THEN 1 WHEN 'tired' THEN 2 WHEN 'downhill' THEN 3 ELSE 4 END,
    r.industry_quality DESC,
    CASE WHEN r.industry = 'Other' THEN -70 ELSE 0 END,
    r.quality_rank DESC,
    r.score DESC NULLS LAST,
    r.symbol ASC
  LIMIT 15;
$function$;
