CREATE OR REPLACE VIEW public.market_scan_results_latest AS
SELECT DISTINCT ON (symbol)
  symbol, recommendation, scan_date, scan_timestamp, score,
  approved_for_live_scanner, review_needed, blocked_low_quality,
  is_tier1_default, payload, run_id, blockers, promotion_status,
  trend_state, sector, industry, alignment_status, alignment_reason,
  confidence_level, support_level, pattern
FROM public.market_scan_results msr
WHERE msr.run_id >= (
  SELECT COALESCE(MIN(id), 0) FROM (
    SELECT id FROM public.market_scan_runs
    WHERE status IN ('completed', 'partial')
    ORDER BY id DESC
    LIMIT 2
  ) recent
)
ORDER BY symbol, scan_date DESC, id DESC;