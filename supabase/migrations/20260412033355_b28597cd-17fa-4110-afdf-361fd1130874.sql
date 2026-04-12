CREATE OR REPLACE FUNCTION public.get_equity_screener_rows(
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 5000
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
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
    msr.payload
  FROM public.market_scan_results_latest msr
  WHERE msr.symbol IS NOT NULL
  ORDER BY
    CASE WHEN msr.sector IN (
      'Communication Services','Consumer Discretionary','Consumer Staples',
      'Energy','Financials','Healthcare','Health Care','Industrials','Materials',
      'Real Estate','Technology','Information Technology','Utilities'
    ) THEN 0 ELSE 1 END,
    CASE msr.recommendation
      WHEN 'KÖP' THEN 0
      WHEN 'AVVAKTA' THEN 1
      WHEN 'BEVAKA' THEN 1
      WHEN 'SÄLJ' THEN 2
      ELSE 3
    END,
    CASE msr.pattern
      WHEN 'climbing' THEN 0
      WHEN 'base_or_climbing' THEN 1
      WHEN 'base' THEN 2
      WHEN 'tired' THEN 3
      WHEN 'downhill' THEN 4
      ELSE 5
    END,
    CASE WHEN msr.approved_for_live_scanner THEN 0 ELSE 1 END,
    msr.score DESC NULLS LAST,
    msr.symbol ASC
  LIMIT p_page_size
  OFFSET p_page * p_page_size;
$$;