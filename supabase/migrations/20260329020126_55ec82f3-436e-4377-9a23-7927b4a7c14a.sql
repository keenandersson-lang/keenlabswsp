
-- Remove authenticated read from base table
DROP POLICY IF EXISTS "Authenticated can read market scan runs" ON public.market_scan_runs;

-- Create a safe view excluding internal error details
CREATE VIEW public.market_scan_runs_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  scan_date,
  status,
  started_at,
  completed_at,
  symbols_targeted,
  symbols_scanned,
  symbols_failed,
  run_label,
  universe_run_id,
  stage_counts,
  blocker_summary,
  metadata
FROM public.market_scan_runs;

-- Grant authenticated users SELECT on the safe view only
GRANT SELECT ON public.market_scan_runs_safe TO authenticated;
