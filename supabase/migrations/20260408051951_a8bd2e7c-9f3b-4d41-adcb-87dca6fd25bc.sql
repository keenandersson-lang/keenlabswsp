-- 1) Performance indexes for scanner execution path
CREATE INDEX IF NOT EXISTS idx_wsp_indicators_symbol_calc_date_desc
  ON public.wsp_indicators (symbol, calc_date DESC);

CREATE INDEX IF NOT EXISTS idx_scanner_universe_snapshot_run_baseline_symbol
  ON public.scanner_universe_snapshot (run_id, baseline_eligible, symbol);

-- 2) Function-level statement_timeout guards (15 min)
ALTER FUNCTION public.refresh_scanner_universe_snapshot(date, text)
  SET statement_timeout = '15min';

ALTER FUNCTION public.run_broad_market_scan(date, text)
  SET statement_timeout = '15min';

ALTER FUNCTION public.backfill_symbol_yahoo(text)
  SET statement_timeout = '15min';