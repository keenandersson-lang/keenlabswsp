-- Mark benchmark ETFs as eligible for daily sync
UPDATE public.symbols
SET eligible_for_backfill = true,
    support_level = 'sector_benchmark_proxy'
WHERE symbol IN ('SPY', 'QQQ', 'DIA', 'IWM')
  AND is_active = true;