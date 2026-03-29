CREATE OR REPLACE FUNCTION public.bulk_enrich_sectors_from_data()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer := 0;
BEGIN
  WITH mapped AS (
    SELECT
      s.ctid AS row_id,
      CASE
        WHEN sic_int BETWEEN 7370 AND 7379 THEN 'Technology'
        WHEN sic_int BETWEEN 4800 AND 4899 THEN 'Communication Services'
        WHEN sic_int BETWEEN 4900 AND 4999 THEN 'Utilities'
        WHEN sic_int BETWEEN 6000 AND 6499 THEN 'Financials'
        WHEN sic_int BETWEEN 6500 AND 6799 THEN 'Real Estate'
        WHEN sic_int BETWEEN 8000 AND 8099 THEN 'Healthcare'
        WHEN sic_int BETWEEN 2830 AND 2836 THEN 'Healthcare'
        WHEN sic_int BETWEEN 3559 AND 3579 THEN 'Technology'
        WHEN sic_int BETWEEN 3670 AND 3679 THEN 'Technology'
        WHEN sic_int = 3812 THEN 'Technology'
        WHEN sic_int BETWEEN 5000 AND 5899 THEN 'Consumer Discretionary'
        WHEN sic_int BETWEEN 5900 AND 5999 THEN 'Consumer Staples'
        WHEN sic_int BETWEEN 7000 AND 7999 THEN 'Consumer Discretionary'
        WHEN sic_int BETWEEN 1000 AND 1499 THEN 'Materials'
        WHEN sic_int BETWEEN 2000 AND 2199 THEN 'Consumer Staples'
        WHEN sic_int BETWEEN 1500 AND 1799 THEN 'Industrials'
        WHEN sic_int BETWEEN 3700 AND 3799 THEN 'Consumer Discretionary'
        WHEN sic_int BETWEEN 2900 AND 2999 THEN 'Energy'
        WHEN sic_int BETWEEN 1300 AND 1399 THEN 'Energy'
        WHEN sic_int BETWEEN 100 AND 999 THEN 'Consumer Staples'
        WHEN sic_int BETWEEN 2200 AND 3999 THEN 'Industrials'
        WHEN sic_int BETWEEN 4000 AND 4799 THEN 'Industrials'
        WHEN sic_int BETWEEN 8100 AND 8999 THEN 'Industrials'
        ELSE NULL
      END AS mapped_sector,
      CASE
        WHEN sic_int BETWEEN 7370 AND 7379 THEN 'Software & IT Services'
        WHEN sic_int BETWEEN 4800 AND 4899 THEN 'Telecom & Media Services'
        WHEN sic_int BETWEEN 4900 AND 4999 THEN 'Utilities'
        WHEN sic_int BETWEEN 6000 AND 6499 THEN 'Banking, Insurance & Capital Markets'
        WHEN sic_int BETWEEN 6500 AND 6799 THEN 'Real Estate'
        WHEN sic_int BETWEEN 8000 AND 8099 THEN 'Healthcare Services'
        WHEN sic_int BETWEEN 2830 AND 2836 THEN 'Biotechnology & Pharmaceuticals'
        WHEN sic_int BETWEEN 3559 AND 3579 THEN 'Computer Hardware'
        WHEN sic_int BETWEEN 3670 AND 3679 THEN 'Semiconductors & Electronic Components'
        WHEN sic_int = 3812 THEN 'Instruments & Controls'
        WHEN sic_int BETWEEN 5000 AND 5899 THEN 'Retail & Consumer Services'
        WHEN sic_int BETWEEN 5900 AND 5999 THEN 'Food & Staples Retail'
        WHEN sic_int BETWEEN 7000 AND 7999 THEN 'Consumer Services'
        WHEN sic_int BETWEEN 1000 AND 1499 THEN 'Metals, Mining & Materials'
        WHEN sic_int BETWEEN 2000 AND 2199 THEN 'Food, Beverage & Tobacco'
        WHEN sic_int BETWEEN 1500 AND 1799 THEN 'Construction & Engineering'
        WHEN sic_int BETWEEN 3700 AND 3799 THEN 'Automobiles & Components'
        WHEN sic_int BETWEEN 2900 AND 2999 THEN 'Oil, Gas & Consumable Fuels'
        WHEN sic_int BETWEEN 1300 AND 1399 THEN 'Oil, Gas & Consumable Fuels'
        WHEN sic_int BETWEEN 100 AND 999 THEN 'Agriculture & Staples Products'
        WHEN sic_int BETWEEN 2200 AND 3999 THEN 'Industrial Goods & Services'
        WHEN sic_int BETWEEN 4000 AND 4799 THEN 'Transportation & Logistics'
        WHEN sic_int BETWEEN 8100 AND 8999 THEN 'Commercial & Professional Services'
        ELSE NULL
      END AS mapped_industry
    FROM (
      SELECT
        ctid,
        CASE
          WHEN sic_code ~ '^[0-9]{3,4}$' THEN sic_code::integer
          ELSE NULL
        END AS sic_int
      FROM public.symbols
      WHERE sic_code IS NOT NULL
        AND (canonical_sector IS NULL OR canonical_sector = 'Unknown' OR canonical_sector = '')
    ) s
  ), updated AS (
    UPDATE public.symbols target
    SET
      canonical_sector = mapped.mapped_sector,
      canonical_industry = COALESCE(target.canonical_industry, mapped.mapped_industry)
    FROM mapped
    WHERE target.ctid = mapped.row_id
      AND mapped.mapped_sector IS NOT NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO updated_count FROM updated;

  RETURN updated_count;
END;
$$;
