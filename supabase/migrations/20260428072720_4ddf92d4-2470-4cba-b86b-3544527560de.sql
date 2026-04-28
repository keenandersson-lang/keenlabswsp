
UPDATE public.symbols
SET canonical_industry = NULL
WHERE canonical_industry IS NOT NULL
  AND canonical_industry NOT IN (
    SELECT industry_name FROM public.canonical_gics_industries
  );
