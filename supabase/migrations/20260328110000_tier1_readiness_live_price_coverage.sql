-- Tier 1 readiness should reflect live daily_prices coverage, independent of metadata enrichment.
CREATE OR REPLACE FUNCTION public.admin_tier1_price_coverage(p_symbols text[])
RETURNS TABLE (
  symbol text,
  bars bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH universe AS (
    SELECT DISTINCT UPPER(TRIM(sym)) AS symbol
    FROM unnest(COALESCE(p_symbols, ARRAY[]::text[])) AS sym
    WHERE sym IS NOT NULL
      AND TRIM(sym) <> ''
  ),
  price_counts AS (
    SELECT dp.symbol, COUNT(*)::bigint AS bars
    FROM public.daily_prices dp
    INNER JOIN universe u ON u.symbol = dp.symbol
    GROUP BY dp.symbol
  )
  SELECT
    u.symbol,
    COALESCE(pc.bars, 0)::bigint AS bars
  FROM universe u
  LEFT JOIN price_counts pc USING (symbol)
  ORDER BY u.symbol;
$$;

GRANT EXECUTE ON FUNCTION public.admin_tier1_price_coverage(text[]) TO anon, authenticated, service_role;
