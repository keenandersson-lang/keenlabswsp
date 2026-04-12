
-- ============================================================
-- TRUST-RANKED get_top_wsp_setups
-- Composite quality score: data completeness, liquidity, RS, proximity to high, volume surge
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_top_wsp_setups()
RETURNS TABLE(
  symbol text,
  sector text,
  industry text,
  pattern text,
  recommendation text,
  score integer,
  vol_ratio numeric,
  payload jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  WITH ranked AS (
    SELECT
      msr.symbol,
      CASE msr.sector
        WHEN 'Information Technology' THEN 'Technology'
        WHEN 'Health Care' THEN 'Healthcare'
        ELSE msr.sector
      END AS sector,
      msr.industry,
      msr.pattern,
      msr.recommendation,
      msr.score,
      (msr.payload->>'volume_ratio')::numeric AS vol_ratio,
      msr.payload,
      -- === COMPOSITE TRUST RANK (higher = better) ===
      -- 1. Data completeness (0-30 pts)
      (CASE WHEN (msr.payload->>'mansfield_rs') IS NOT NULL THEN 15 ELSE 0 END
       + CASE WHEN msr.industry IS NOT NULL AND msr.industry NOT IN ('Unknown','Stocks','') THEN 10 ELSE 0 END
       + CASE WHEN (msr.payload->>'resistance_level') IS NOT NULL THEN 5 ELSE 0 END
      )
      -- 2. Liquidity tier (0-25 pts) based on avg_volume_5d
      + (CASE
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 5000000 THEN 25
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 1000000 THEN 20
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 500000  THEN 15
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 100000  THEN 10
          ELSE 0
        END)
      -- 3. Relative strength (0-20 pts)
      + (CASE
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 20 THEN 20
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 10 THEN 15
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 5  THEN 10
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 0  THEN 5
          ELSE 0
        END)
      -- 4. Proximity to 52w high (0-15 pts, closer = better)
      + (CASE
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -2  THEN 15
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -5  THEN 12
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -10 THEN 8
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -20 THEN 4
          ELSE 0
        END)
      -- 5. Volume surge (0-10 pts)
      + (CASE
          WHEN (msr.payload->>'volume_ratio')::numeric >= 2.0 THEN 10
          WHEN (msr.payload->>'volume_ratio')::numeric >= 1.5 THEN 7
          WHEN (msr.payload->>'volume_ratio')::numeric >= 1.0 THEN 4
          ELSE 0
        END)
      AS trust_rank
    FROM public.market_scan_results_latest msr
    WHERE msr.symbol IS NOT NULL
      AND msr.sector IN (
        'Communication Services','Consumer Discretionary','Consumer Staples',
        'Energy','Financials','Healthcare','Industrials','Materials',
        'Real Estate','Technology','Utilities','Information Technology',
        'Health Care'
      )
  )
  SELECT r.symbol, r.sector, r.industry, r.pattern, r.recommendation,
         r.score, r.vol_ratio, r.payload
  FROM ranked r
  ORDER BY
    CASE r.recommendation
      WHEN 'KÖP' THEN 0
      WHEN 'BEVAKA' THEN 1
      WHEN 'AVVAKTA' THEN 2
      WHEN 'SÄLJ' THEN 3
      ELSE 4
    END,
    r.trust_rank DESC,
    r.score DESC NULLS LAST,
    r.symbol ASC
  LIMIT 15;
$$;

-- ============================================================
-- TRUST-RANKED get_equity_screener_rows
-- Same composite rank applied to full screener pagination
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_equity_screener_rows(
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50,
  p_universe_tier text DEFAULT NULL
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
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  WITH ranked AS (
    SELECT
      msr.symbol,
      CASE msr.sector
        WHEN 'Information Technology' THEN 'Technology'
        WHEN 'Health Care' THEN 'Healthcare'
        ELSE msr.sector
      END AS sector,
      msr.industry,
      msr.pattern AS pattern_state,
      msr.recommendation,
      msr.score AS wsp_score,
      msr.payload,
      -- === COMPOSITE TRUST RANK (higher = better) ===
      -- 1. Data completeness (0-30 pts)
      (CASE WHEN (msr.payload->>'mansfield_rs') IS NOT NULL THEN 15 ELSE 0 END
       + CASE WHEN msr.industry IS NOT NULL AND msr.industry NOT IN ('Unknown','Stocks','') THEN 10 ELSE 0 END
       + CASE WHEN (msr.payload->>'resistance_level') IS NOT NULL THEN 5 ELSE 0 END
      )
      -- 2. Liquidity tier (0-25 pts)
      + (CASE
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 5000000 THEN 25
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 1000000 THEN 20
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 500000  THEN 15
          WHEN (msr.payload->>'avg_volume_5d')::numeric >= 100000  THEN 10
          ELSE 0
        END)
      -- 3. Relative strength (0-20 pts)
      + (CASE
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 20 THEN 20
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 10 THEN 15
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 5  THEN 10
          WHEN (msr.payload->>'mansfield_rs')::numeric >= 0  THEN 5
          ELSE 0
        END)
      -- 4. Proximity to 52w high (0-15 pts)
      + (CASE
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -2  THEN 15
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -5  THEN 12
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -10 THEN 8
          WHEN (msr.payload->>'pct_from_52w_high')::numeric >= -20 THEN 4
          ELSE 0
        END)
      -- 5. Volume surge (0-10 pts)
      + (CASE
          WHEN (msr.payload->>'volume_ratio')::numeric >= 2.0 THEN 10
          WHEN (msr.payload->>'volume_ratio')::numeric >= 1.5 THEN 7
          WHEN (msr.payload->>'volume_ratio')::numeric >= 1.0 THEN 4
          ELSE 0
        END)
      AS trust_rank
    FROM public.market_scan_results_latest msr
    JOIN public.symbols s ON s.symbol = msr.symbol
    WHERE msr.symbol IS NOT NULL
      AND (p_universe_tier IS NULL OR s.universe_tier = p_universe_tier)
  )
  SELECT r.symbol, r.sector, r.industry, r.pattern_state, r.recommendation,
         r.wsp_score, r.payload
  FROM ranked r
  ORDER BY
    -- Primary: sector quality
    CASE WHEN r.sector IN (
      'Communication Services','Consumer Discretionary','Consumer Staples',
      'Energy','Financials','Healthcare','Industrials','Materials',
      'Real Estate','Technology','Utilities'
    ) THEN 0 ELSE 1 END,
    -- Secondary: recommendation
    CASE r.recommendation
      WHEN 'KÖP' THEN 0
      WHEN 'BEVAKA' THEN 1
      WHEN 'AVVAKTA' THEN 2
      WHEN 'SÄLJ' THEN 3
      ELSE 4
    END,
    -- Tertiary: pattern stage
    CASE r.pattern_state
      WHEN 'climbing' THEN 0
      WHEN 'base' THEN 1
      WHEN 'tired' THEN 2
      WHEN 'downhill' THEN 3
      ELSE 4
    END,
    -- Quaternary: composite trust rank
    r.trust_rank DESC,
    r.wsp_score DESC NULLS LAST,
    r.symbol ASC
  LIMIT p_page_size
  OFFSET p_page * p_page_size;
$$;
