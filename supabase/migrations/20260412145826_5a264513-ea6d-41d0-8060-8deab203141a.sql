
-- Fix sector ETF metadata so daily sync includes them
UPDATE public.symbols
SET support_level = 'sector_benchmark_proxy',
    eligible_for_backfill = true,
    eligible_for_full_wsp = false
WHERE symbol IN ('XLK','XLF','XLV','XLE','XLI','XLY','XLP','XLU','XLB','XLRE','XLC')
  AND is_etf = true;

-- Also ensure benchmark symbols have correct flags
UPDATE public.symbols
SET support_level = 'sector_benchmark_proxy',
    eligible_for_backfill = true,
    eligible_for_full_wsp = false
WHERE symbol IN ('SPY','QQQ','DIA','IWM')
  AND eligible_for_backfill IS DISTINCT FROM true;
