
-- Promote active non-ETF, non-ADR stocks on major exchanges with valid GICS sectors
UPDATE public.symbols
SET universe_tier = 'core',
    eligible_for_backfill = true,
    support_level = 'full_wsp_equity',
    eligible_for_full_wsp = true
WHERE is_active = true
  AND (is_etf IS NULL OR is_etf = false)
  AND (is_adr IS NULL OR is_adr = false)
  AND COALESCE(primary_exchange, exchange) IN ('NYSE','NASDAQ','AMEX','ARCA')
  AND canonical_sector IS NOT NULL
  AND canonical_sector != 'Unknown'
  AND classification_confidence_level IN ('high','medium')
  AND universe_tier != 'benchmark';
