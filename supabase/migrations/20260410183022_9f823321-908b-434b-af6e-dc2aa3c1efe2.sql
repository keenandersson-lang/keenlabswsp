
DROP FUNCTION IF EXISTS public.get_benchmark_prices();

CREATE OR REPLACE FUNCTION public.get_benchmark_prices()
 RETURNS TABLE(symbol text, close numeric, pct_change_1d numeric, calc_date date, above_ma50 boolean, ma50_slope text, prev_close_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ranked AS (
    SELECT
      wi.symbol, wi.close, wi.pct_change_1d, wi.calc_date,
      wi.above_ma50, wi.ma50_slope,
      LAG(wi.calc_date) OVER (PARTITION BY wi.symbol ORDER BY wi.calc_date) AS prev_close_date,
      ROW_NUMBER() OVER (PARTITION BY wi.symbol ORDER BY wi.calc_date DESC) AS rn
    FROM wsp_indicators wi
    WHERE wi.symbol IN ('SPY', 'QQQ')
  )
  SELECT r.symbol, r.close, r.pct_change_1d, r.calc_date,
         r.above_ma50, r.ma50_slope, r.prev_close_date
  FROM ranked r
  WHERE r.rn = 1;
$function$;
