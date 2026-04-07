
-- 1. get_chart_data: price bars for charting
CREATE OR REPLACE FUNCTION public.get_chart_data(p_symbol text, p_days integer DEFAULT 365)
RETURNS TABLE(
  date date,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT dp.date, dp.open, dp.high, dp.low, dp.close, dp.volume::bigint
  FROM daily_prices dp
  WHERE dp.symbol = p_symbol
    AND dp.date >= CURRENT_DATE - (p_days || ' days')::interval
  ORDER BY dp.date ASC;
$$;

-- 2. get_symbol_detail: latest indicators + metadata for a symbol
CREATE OR REPLACE FUNCTION public.get_symbol_detail(p_symbol text)
RETURNS TABLE(
  symbol text,
  calc_date date,
  close numeric,
  ma50 numeric,
  ma150 numeric,
  ma50_slope text,
  above_ma50 boolean,
  above_ma150 boolean,
  volume bigint,
  avg_volume_5d bigint,
  volume_ratio numeric,
  mansfield_rs numeric,
  pct_change_1d numeric,
  pct_from_52w_high numeric,
  wsp_pattern text,
  wsp_score integer,
  canonical_sector text,
  canonical_industry text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    wi.symbol, wi.calc_date, wi.close, wi.ma50, wi.ma150, wi.ma50_slope,
    wi.above_ma50, wi.above_ma150, wi.volume, wi.avg_volume_5d,
    wi.volume_ratio, wi.mansfield_rs, wi.pct_change_1d, wi.pct_from_52w_high,
    wi.wsp_pattern, wi.wsp_score,
    s.canonical_sector, s.canonical_industry
  FROM wsp_indicators wi
  JOIN symbols s ON s.symbol = wi.symbol
  WHERE wi.symbol = p_symbol
  ORDER BY wi.calc_date DESC
  LIMIT 1;
$$;

-- 3. get_benchmark_prices: latest SPY/QQQ data
CREATE OR REPLACE FUNCTION public.get_benchmark_prices()
RETURNS TABLE(
  symbol text,
  close numeric,
  pct_change_1d numeric,
  calc_date date,
  above_ma50 boolean,
  ma50_slope text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (wi.symbol)
    wi.symbol, wi.close, wi.pct_change_1d, wi.calc_date,
    wi.above_ma50, wi.ma50_slope
  FROM wsp_indicators wi
  WHERE wi.symbol IN ('SPY', 'QQQ')
  ORDER BY wi.symbol, wi.calc_date DESC;
$$;

-- 4. get_heatmap_data: per-stock daily change for heatmap
CREATE OR REPLACE FUNCTION public.get_heatmap_data()
RETURNS TABLE(
  symbol text,
  canonical_sector text,
  pct_change_1d numeric,
  close numeric,
  wsp_pattern text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (wi.symbol)
    wi.symbol,
    CASE WHEN s.canonical_sector = 'Health Care' THEN 'Healthcare' ELSE s.canonical_sector END,
    wi.pct_change_1d, wi.close, wi.wsp_pattern
  FROM wsp_indicators wi
  JOIN symbols s ON s.symbol = wi.symbol
  WHERE s.canonical_sector IN (
    'Technology','Healthcare','Health Care','Financials',
    'Consumer Discretionary','Consumer Staples','Industrials',
    'Energy','Materials','Utilities','Real Estate','Communication Services'
  )
  AND wi.pct_change_1d IS NOT NULL
  ORDER BY wi.symbol, wi.calc_date DESC;
$$;
