
-- Whitelist: kända sektor- och index-proxies behåller sector_benchmark_proxy
UPDATE public.symbols
SET support_level = 'sector_benchmark_proxy',
    eligible_for_backfill = true,
    eligible_for_full_wsp = false,
    canonical_sector = NULL,
    canonical_industry = NULL
WHERE symbol IN ('XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLC','XLRE',
                 'SPY','QQQ','IWM','DIA','VTI','VOO','VEA','VWO','EEM','EFA',
                 'GLD','SLV','GDX','GDXJ','COPX','PPLT','PALL','URA','UNG','USO');

-- Övriga ETF:er → exkluderade från WSP
UPDATE public.symbols
SET support_level = 'etf_excluded',
    eligible_for_backfill = false,
    eligible_for_full_wsp = false,
    canonical_sector = NULL,
    canonical_industry = NULL
WHERE (is_etf = true OR instrument_type ILIKE '%ETF%')
  AND symbol NOT IN ('XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLC','XLRE',
                     'SPY','QQQ','IWM','DIA','VTI','VOO','VEA','VWO','EEM','EFA',
                     'GLD','SLV','GDX','GDXJ','COPX','PPLT','PALL','URA','UNG','USO');
