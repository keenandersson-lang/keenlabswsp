-- Improve get_top_wsp_setups: quality-weighted ranking
CREATE OR REPLACE FUNCTION public.get_top_wsp_setups()
 RETURNS TABLE(symbol text, pattern text, recommendation text, score integer, sector text, industry text, payload jsonb, vol_ratio numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    r.symbol, r.pattern, r.recommendation, r.score, r.sector, r.industry, r.payload,
    (r.payload->>'volume_ratio')::numeric as vol_ratio
  FROM public.market_scan_results_latest r
  WHERE r.recommendation IN ('KÖP', 'BEVAKA')
    AND r.pattern IN ('climbing', 'base_or_climbing')
  ORDER BY
    -- Tier 1: KÖP always first
    CASE WHEN r.recommendation = 'KÖP' THEN 0 ELSE 1 END,
    -- Tier 2: climbing > base_or_climbing
    CASE WHEN r.pattern = 'climbing' THEN 0 ELSE 1 END,
    -- Tier 3: approved_for_live_scanner first
    CASE WHEN r.approved_for_live_scanner THEN 0 ELSE 1 END,
    -- Tier 4: WSP score
    r.score DESC,
    -- Tier 5: quality-adjusted volume rank
    -- Cap vol_ratio at 20 to prevent illiquid spikes, weight by avg_volume bucket
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
$function$;

-- Improve get_equity_screener_rows: multi-tier quality ranking
CREATE OR REPLACE FUNCTION public.get_equity_screener_rows(p_page integer DEFAULT 0, p_page_size integer DEFAULT 5000)
 RETURNS TABLE(symbol text, sector text, industry text, pattern_state text, recommendation text, wsp_score integer, payload jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Tier 1: recommendation priority
    CASE msr.recommendation
      WHEN 'KÖP' THEN 0
      WHEN 'BEVAKA' THEN 1
      WHEN 'SÄLJ' THEN 2
      ELSE 3
    END,
    -- Tier 2: pattern quality
    CASE msr.pattern
      WHEN 'climbing' THEN 0
      WHEN 'base_or_climbing' THEN 1
      WHEN 'base' THEN 2
      WHEN 'tired' THEN 3
      WHEN 'downhill' THEN 4
      ELSE 5
    END,
    -- Tier 3: approved symbols first
    CASE WHEN msr.approved_for_live_scanner THEN 0 ELSE 1 END,
    -- Tier 4: score
    msr.score DESC NULLS LAST,
    -- Tier 5: alphabetical
    msr.symbol ASC
  LIMIT p_page_size
  OFFSET p_page * p_page_size;
$function$;