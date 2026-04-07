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
SET search_path TO 'public'
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
      COALESCE(NULLIF(s.canonical_sector, ''), NULLIF(s.sector, ''), 'Unknown') AS sector_name,
      lps.*
    FROM latest_per_symbol lps
    JOIN public.symbols s ON s.symbol = lps.symbol
    WHERE s.is_active = true
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
    COUNT(*) FILTER (WHERE j.wsp_pattern = 'climbing' AND j.wsp_score >= 5)::bigint AS wsp_setups,
    ROUND(AVG(j.wsp_score), 1) AS avg_wsp_score,
    MODE() WITHIN GROUP (ORDER BY j.wsp_pattern) AS top_pattern
  FROM joined j
  WHERE j.sector_name <> 'Unknown'
  GROUP BY j.sector_name
  ORDER BY AVG(j.pct_change_1d) DESC NULLS LAST;
$$;