-- Ensure long-running scanner and Yahoo backfill RPCs are protected from default statement_timeout.
-- This applies at the database execution path so it works even when request headers are ignored.

ALTER FUNCTION public.refresh_scanner_universe_snapshot(date, text)
  SET statement_timeout = '15min';

ALTER FUNCTION public.run_broad_market_scan(date, text)
  SET statement_timeout = '15min';

ALTER FUNCTION public.backfill_symbol_yahoo(text)
  SET statement_timeout = '15min';
