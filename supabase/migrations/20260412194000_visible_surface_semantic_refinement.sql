-- Visible-surface semantic refinement pass:
-- 1) reduce taxonomy leakage in high-priority rows,
-- 2) improve ranking separation,
-- 3) improve trust quality for heatmap-facing symbols.

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
      COALESCE(
        NULLIF(public.display_industry(
          COALESCE(NULLIF(msr.industry, ''), NULLIF(s.canonical_industry, ''), NULLIF(s.industry, ''), 'Unknown')
        ), ''),
        'Unknown'
      ) AS norm_industry,
      msr.pattern AS pattern_state,
      msr.recommendation,
      msr.score AS wsp_score,
      msr.payload,
      CASE
        WHEN COALESCE(
          NULLIF(public.display_industry(COALESCE(NULLIF(msr.industry, ''), NULLIF(s.canonical_industry, ''), NULLIF(s.industry, ''), 'Unknown')), ''),
          'Unknown'
        ) IN ('Unknown', 'Other', 'Stocks', 'ETF', 'Stocks Proxy Basket', '') THEN 0
        ELSE 1
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
      COALESCE(
        NULLIF(public.display_industry(
          COALESCE(NULLIF(msr.industry, ''), NULLIF(s.canonical_industry, ''), NULLIF(s.industry, ''), 'Unknown')
        ), ''),
        'Unknown'
      ) AS industry,
      msr.pattern,
      msr.recommendation,
      msr.score,
      (msr.payload->>'volume_ratio')::numeric AS vol_ratio,
      msr.payload,
      CASE
        WHEN COALESCE(
          NULLIF(public.display_industry(COALESCE(NULLIF(msr.industry, ''), NULLIF(s.canonical_industry, ''), NULLIF(s.industry, ''), 'Unknown')), ''),
          'Unknown'
        ) IN ('Unknown', 'Other', 'Stocks', 'ETF', 'Stocks Proxy Basket', '') THEN 0
        ELSE 1
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
    r.quality_rank DESC,
    r.score DESC NULLS LAST,
    r.symbol ASC
  LIMIT 15;
$function$;

CREATE OR REPLACE FUNCTION public.get_industry_ranking(
  p_leading_only boolean DEFAULT true,
  p_limit int DEFAULT 30
)
RETURNS TABLE (
  display_industry text,
  sector text,
  symbol_count bigint,
  avg_wsp_score numeric,
  breakout_count bigint,
  valid_entry_count bigint,
  buy_count bigint,
  watch_count bigint,
  rank_score numeric,
  rank_position int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH leading_sectors AS (
    SELECT sector_name FROM get_sector_ranking()
    WHERE is_leading = true
  ),
  industry_agg AS (
    SELECT
      COALESCE(
        NULLIF(display_industry(COALESCE(NULLIF(msr.industry, ''), NULLIF(s.canonical_industry, ''), NULLIF(s.industry, ''), 'Unknown')), ''),
        'Unknown'
      ) AS di,
      CASE
        WHEN msr.sector = 'Information Technology' THEN 'Technology'
        WHEN msr.sector = 'Health Care' THEN 'Healthcare'
        WHEN msr.sector = 'Metals & Mining' THEN 'Materials'
        ELSE COALESCE(msr.sector, s.canonical_sector)
      END AS sec,
      count(*) AS sym_count,
      avg(COALESCE(msr.score, 0))::numeric(5,2) AS avg_score,
      count(*) FILTER (
        WHERE COALESCE((msr.payload->>'breakout_quality_pass')::boolean, false)
           OR COALESCE((msr.payload->>'breakout_confirmed')::boolean, false)
      ) AS bo_count,
      count(*) FILTER (
        WHERE msr.recommendation IN ('KÖP','BEVAKA')
          AND COALESCE(msr.score,0) >= 3
      ) AS ve_count,
      count(*) FILTER (WHERE msr.recommendation = 'KÖP') AS buy_cnt,
      count(*) FILTER (WHERE msr.recommendation = 'BEVAKA') AS watch_cnt,
      avg(COALESCE((msr.payload->>'mansfield_rs')::numeric, 0))::numeric(8,3) AS avg_rs,
      avg(COALESCE((msr.payload->>'volume_ratio')::numeric, 0))::numeric(8,3) AS avg_vol,
      avg(COALESCE((msr.payload->>'pct_from_52w_high')::numeric, -25))::numeric(8,3) AS avg_52w
    FROM market_scan_results_latest msr
    LEFT JOIN symbols s ON s.symbol = msr.symbol
    WHERE msr.symbol IS NOT NULL
      AND COALESCE(
        NULLIF(display_industry(COALESCE(NULLIF(msr.industry, ''), NULLIF(s.canonical_industry, ''), NULLIF(s.industry, ''), 'Unknown')), ''),
        'Unknown'
      ) NOT IN ('Unknown','Stocks','ETF','Stocks Proxy Basket','')
      AND (
        NOT p_leading_only
        OR CASE
            WHEN msr.sector = 'Information Technology' THEN 'Technology'
            WHEN msr.sector = 'Health Care' THEN 'Healthcare'
            WHEN msr.sector = 'Metals & Mining' THEN 'Materials'
            ELSE COALESCE(msr.sector, s.canonical_sector)
          END IN (SELECT sector_name FROM leading_sectors)
      )
    GROUP BY di, sec
    HAVING count(*) >= 2
  )
  SELECT
    ia.di,
    ia.sec,
    ia.sym_count,
    ia.avg_score,
    ia.bo_count,
    ia.ve_count,
    ia.buy_cnt,
    ia.watch_cnt,
    (
      ia.avg_score * 12
      + ia.bo_count * 10
      + ia.ve_count * 6
      + ia.buy_cnt * 18
      + ia.watch_cnt * 2
      + GREATEST(LEAST(ia.avg_rs, 30), -10) * 0.9
      + GREATEST(LEAST(ia.avg_vol, 3), 0) * 7
      + GREATEST(LEAST(22 + ia.avg_52w, 22), 0)
      + CASE WHEN ia.di = 'Other' THEN -25 ELSE 0 END
    )::numeric(10,2) AS rank_score,
    ROW_NUMBER() OVER (
      ORDER BY
        (
          ia.avg_score * 12
          + ia.bo_count * 10
          + ia.ve_count * 6
          + ia.buy_cnt * 18
          + ia.watch_cnt * 2
          + GREATEST(LEAST(ia.avg_rs, 30), -10) * 0.9
          + GREATEST(LEAST(ia.avg_vol, 3), 0) * 7
          + GREATEST(LEAST(22 + ia.avg_52w, 22), 0)
          + CASE WHEN ia.di = 'Other' THEN -25 ELSE 0 END
        ) DESC,
        ia.sym_count DESC,
        ia.di ASC
    )::int AS rank_position
  FROM industry_agg ia
  ORDER BY rank_position
  LIMIT p_limit;
$function$;
