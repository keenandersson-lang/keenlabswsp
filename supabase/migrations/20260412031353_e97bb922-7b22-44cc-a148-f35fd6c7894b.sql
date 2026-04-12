-- Fix get_equity_screener_rows: BEVAKA → AVVAKTA
CREATE OR REPLACE FUNCTION public.get_equity_screener_rows(p_page integer DEFAULT 0, p_page_size integer DEFAULT 50)
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
SET search_path = public
AS $$
  SELECT
    msr.symbol,
    msr.sector,
    msr.industry,
    msr.pattern AS pattern_state,
    msr.recommendation,
    msr.score AS wsp_score,
    msr.payload
  FROM public.market_scan_results_latest msr
  WHERE msr.symbol IS NOT NULL
  ORDER BY
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

-- Fix get_top_wsp_setups: BEVAKA → AVVAKTA
CREATE OR REPLACE FUNCTION public.get_top_wsp_setups()
RETURNS TABLE(
  symbol text,
  pattern text,
  recommendation text,
  score integer,
  sector text,
  industry text,
  payload jsonb,
  vol_ratio numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    r.symbol, r.pattern, r.recommendation, r.score, r.sector, r.industry, r.payload,
    (r.payload->>'volume_ratio')::numeric as vol_ratio
  FROM public.market_scan_results_latest r
  WHERE r.recommendation IN ('KÖP', 'AVVAKTA', 'BEVAKA')
    AND r.pattern IN ('climbing', 'base_or_climbing')
  ORDER BY
    CASE WHEN r.recommendation = 'KÖP' THEN 0 ELSE 1 END,
    CASE WHEN r.pattern = 'climbing' THEN 0 ELSE 1 END,
    CASE WHEN r.approved_for_live_scanner THEN 0 ELSE 1 END,
    r.score DESC,
    (LEAST((r.payload->>'volume_ratio')::numeric, 20.0)
     * CASE
         WHEN COALESCE((r.payload->>'avg_volume_5d')::numeric, 0) >= 500000 THEN 3.0
         WHEN COALESCE((r.payload->>'avg_volume_5d')::numeric, 0) >= 100000 THEN 2.0
         WHEN COALESCE((r.payload->>'avg_volume_5d')::numeric, 0) >= 50000  THEN 1.5
         WHEN COALESCE((r.payload->>'avg_volume_5d')::numeric, 0) >= 10000  THEN 1.0
         ELSE 0.3
       END
    ) DESC NULLS LAST
  LIMIT 15;
$$;