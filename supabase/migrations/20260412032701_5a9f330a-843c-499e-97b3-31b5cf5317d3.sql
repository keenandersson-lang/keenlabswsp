
DROP FUNCTION IF EXISTS public.get_top_wsp_setups();

CREATE FUNCTION public.get_top_wsp_setups()
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
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    msr.symbol,
    msr.sector,
    msr.industry,
    msr.pattern,
    msr.recommendation,
    msr.score,
    (msr.payload->>'volume_ratio')::numeric AS vol_ratio,
    msr.payload
  FROM public.market_scan_results_latest msr
  WHERE msr.symbol IS NOT NULL
    AND msr.sector IN (
      'Communication Services','Consumer Discretionary','Consumer Staples',
      'Energy','Financials','Healthcare','Industrials','Materials',
      'Real Estate','Technology','Utilities','Information Technology',
      'Health Care'
    )
    AND msr.industry IS NOT NULL
    AND msr.industry NOT IN ('Unknown', 'Stocks', '')
  ORDER BY
    CASE msr.recommendation
      WHEN 'KÖP' THEN 0
      WHEN 'AVVAKTA' THEN 1
      WHEN 'BEVAKA' THEN 1
      WHEN 'SÄLJ' THEN 2
      ELSE 3
    END,
    msr.score DESC NULLS LAST,
    (msr.payload->>'volume_ratio')::numeric DESC NULLS LAST,
    msr.symbol ASC
  LIMIT 15;
$$;
