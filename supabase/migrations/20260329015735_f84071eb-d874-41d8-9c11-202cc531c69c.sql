
-- 1. Fix SECURITY DEFINER views by DROP + CREATE with security_invoker

-- market_scan_results_latest: drop and recreate
DROP VIEW IF EXISTS public.market_scan_results_latest;
CREATE VIEW public.market_scan_results_latest
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (msr.symbol)
  msr.symbol,
  msr.recommendation,
  msr.scan_date,
  msr.scan_timestamp,
  msr.score,
  msr.approved_for_live_scanner,
  msr.review_needed,
  msr.blocked_low_quality,
  msr.is_tier1_default,
  msr.payload,
  msr.run_id,
  msr.blockers,
  msr.promotion_status,
  msr.trend_state,
  msr.sector,
  msr.industry,
  msr.alignment_status,
  msr.alignment_reason,
  msr.confidence_level,
  msr.support_level,
  msr.pattern
FROM public.market_scan_results msr
ORDER BY msr.symbol, msr.scan_date DESC, msr.id DESC;

-- symbol_industry_alignment_active: drop and recreate
DROP VIEW IF EXISTS public.symbol_industry_alignment_active;
CREATE VIEW public.symbol_industry_alignment_active
WITH (security_invoker = true)
AS
SELECT
  sus.symbol,
  sus.canonical_sector,
  sus.canonical_industry,
  CASE
    WHEN sus.canonical_sector IS NOT NULL
      AND sus.canonical_sector <> 'Unknown'
      AND sus.canonical_industry IS NOT NULL
      AND sus.canonical_industry <> 'Unknown'
    THEN true
    ELSE false
  END AS alignment_eligible,
  CASE
    WHEN sus.canonical_sector IS NOT NULL
      AND sus.canonical_sector <> 'Unknown'
      AND sus.canonical_industry IS NOT NULL
      AND sus.canonical_industry <> 'Unknown'
    THEN 'aligned'
    ELSE 'unresolved'
  END AS alignment_status,
  CASE
    WHEN sus.canonical_sector IS NOT NULL
      AND sus.canonical_sector <> 'Unknown'
      AND sus.canonical_industry IS NOT NULL
      AND sus.canonical_industry <> 'Unknown'
    THEN 'sector_industry_present'
    ELSE 'missing_classification'
  END AS alignment_reason
FROM public.symbols sus
WHERE sus.is_active = true;

-- 2. Fix market_scan_runs info leak: restrict SELECT to authenticated only
DROP POLICY IF EXISTS "Anyone can read market scan runs" ON public.market_scan_runs;
CREATE POLICY "Authenticated can read market scan runs"
  ON public.market_scan_runs
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. Fix mutable search_path on all functions that lack it
ALTER FUNCTION public.materialize_wsp_indicators(date, date)
  SET search_path = 'public';

ALTER FUNCTION public.materialize_wsp_indicators_from_prices(text[], date, integer)
  SET search_path = 'public';

ALTER FUNCTION public.run_broad_market_scan(date, text)
  SET search_path = 'public';

ALTER FUNCTION public.refresh_scanner_universe_snapshot(date, text)
  SET search_path = 'public';

ALTER FUNCTION public.scanner_operator_snapshot()
  SET search_path = 'public';
