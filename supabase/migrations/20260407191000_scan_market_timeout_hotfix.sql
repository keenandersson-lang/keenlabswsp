-- scan-market timeout hotfix
-- 1) Add execution-path indexes used by run_broad_market_scan + refresh_scanner_universe_snapshot
CREATE INDEX IF NOT EXISTS idx_wsp_indicators_symbol_calc_date_desc
  ON public.wsp_indicators (symbol, calc_date DESC);

CREATE INDEX IF NOT EXISTS idx_scanner_universe_snapshot_run_baseline_symbol
  ON public.scanner_universe_snapshot (run_id, baseline_eligible, symbol);

-- 2) Raise function-level statement timeout for the heavy scanner RPC chain.
-- This protects scan-market runs even when request-level timeout headers are not honored.
ALTER FUNCTION public.refresh_scanner_universe_snapshot(date, text)
  SET statement_timeout = '15min';

ALTER FUNCTION public.run_broad_market_scan(date, text)
  SET statement_timeout = '15min';
