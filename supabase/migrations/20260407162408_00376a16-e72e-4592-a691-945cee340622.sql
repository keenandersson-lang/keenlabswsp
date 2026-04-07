
-- 1. Update get_market_summary to filter to GICS sectors only
CREATE OR REPLACE FUNCTION public.get_market_summary()
RETURNS TABLE(
  sector_name text,
  symbol_count bigint,
  avg_pct_today numeric,
  pct_above_ma50 numeric,
  wsp_regime text,
  wsp_setups bigint,
  avg_wsp_score numeric,
  top_pattern text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_per_symbol AS (
    SELECT DISTINCT ON (wi.symbol)
      wi.symbol,
      wi.calc_date,
      wi.close,
      wi.pct_change_1d,
      wi.above_ma50,
      wi.above_ma150,
      wi.ma50_slope,
      wi.mansfield_rs,
      wi.wsp_pattern,
      wi.wsp_score,
      wi.volume_ratio
    FROM public.wsp_indicators wi
    ORDER BY wi.symbol, wi.calc_date DESC
  ),
  joined AS (
    SELECT
      CASE WHEN s.canonical_sector = 'Health Care' THEN 'Healthcare' ELSE s.canonical_sector END AS sector_name,
      lps.*
    FROM latest_per_symbol lps
    JOIN public.symbols s ON s.symbol = lps.symbol
    WHERE s.is_active = true
      AND s.canonical_sector IN (
        'Technology','Healthcare','Health Care','Financials',
        'Consumer Discretionary','Consumer Staples','Industrials',
        'Energy','Materials','Utilities','Real Estate','Communication Services'
      )
  )
  SELECT
    j.sector_name,
    COUNT(DISTINCT j.symbol)::bigint AS symbol_count,
    ROUND(AVG(j.pct_change_1d), 2) AS avg_pct_today,
    ROUND(AVG(CASE WHEN j.above_ma50 THEN 1.0 ELSE 0.0 END) * 100, 1) AS pct_above_ma50,
    CASE
      WHEN AVG(CASE WHEN j.above_ma50 THEN 1.0 ELSE 0.0 END) > 0.6 THEN 'Bullish'
      WHEN AVG(CASE WHEN j.above_ma50 THEN 1.0 ELSE 0.0 END) < 0.4 THEN 'Bearish'
      ELSE 'Neutral'
    END AS wsp_regime,
    COUNT(*) FILTER (WHERE j.wsp_pattern = 'climbing' AND j.wsp_score >= 4)::bigint AS wsp_setups,
    ROUND(AVG(j.wsp_score), 1) AS avg_wsp_score,
    MODE() WITHIN GROUP (ORDER BY j.wsp_pattern) AS top_pattern
  FROM joined j
  GROUP BY j.sector_name
  ORDER BY AVG(j.pct_change_1d) DESC NULLS LAST;
$$;

-- 2. Create get_sector_performance for dashboard header
CREATE OR REPLACE FUNCTION public.get_sector_performance()
RETURNS TABLE(
  sector_name text,
  avg_daily_pct numeric,
  stock_count bigint,
  pct_above_ma50 numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (wi.symbol)
      wi.symbol, wi.pct_change_1d, wi.above_ma50,
      CASE WHEN s.canonical_sector = 'Health Care' THEN 'Healthcare' ELSE s.canonical_sector END AS canonical_sector
    FROM public.wsp_indicators wi
    JOIN public.symbols s ON s.symbol = wi.symbol
    WHERE s.canonical_sector IN (
      'Technology','Healthcare','Health Care','Financials',
      'Consumer Discretionary','Consumer Staples','Industrials',
      'Energy','Materials','Utilities','Real Estate','Communication Services'
    )
    ORDER BY wi.symbol, wi.calc_date DESC
  )
  SELECT
    canonical_sector AS sector_name,
    ROUND(AVG(pct_change_1d)::numeric, 2) AS avg_daily_pct,
    COUNT(*)::bigint AS stock_count,
    ROUND(AVG(CASE WHEN above_ma50 THEN 100.0 ELSE 0.0 END)::numeric, 1) AS pct_above_ma50
  FROM latest
  GROUP BY canonical_sector
  ORDER BY avg_daily_pct DESC NULLS LAST;
$$;
