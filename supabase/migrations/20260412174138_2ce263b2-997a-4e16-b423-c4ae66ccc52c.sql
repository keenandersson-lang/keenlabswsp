
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
      ELSE s.canonical_sector 
    END,
    wi.pct_change_1d, wi.close, wi.wsp_pattern
  FROM wsp_indicators wi
  JOIN symbols s ON s.symbol = wi.symbol
  WHERE s.canonical_sector IN (
    'Technology','Information Technology','Healthcare','Health Care','Financials',
    'Consumer Discretionary','Consumer Staples','Industrials',
    'Energy','Materials','Utilities','Real Estate','Communication Services',
    'Metals & Mining'
  )
  AND wi.pct_change_1d IS NOT NULL
  ORDER BY wi.symbol, wi.calc_date DESC;
$function$;
