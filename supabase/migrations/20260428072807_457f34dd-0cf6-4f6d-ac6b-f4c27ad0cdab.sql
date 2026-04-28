
-- Trigger som blockerar non-canonical sector/industry vid insert/update
CREATE OR REPLACE FUNCTION public.enforce_canonical_gics_taxonomy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.canonical_sector IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.canonical_gics_sectors
      WHERE sector_name = NEW.canonical_sector
    ) THEN
      RAISE EXCEPTION 'DOCTRINE VIOLATION: canonical_sector "%" is not a valid GICS sector.', NEW.canonical_sector
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.canonical_industry IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.canonical_gics_industries
      WHERE industry_name = NEW.canonical_industry
    ) THEN
      RAISE EXCEPTION 'DOCTRINE VIOLATION: canonical_industry "%" is not a valid GICS industry.', NEW.canonical_industry
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_canonical_gics ON public.symbols;
CREATE TRIGGER trg_enforce_canonical_gics
BEFORE INSERT OR UPDATE OF canonical_sector, canonical_industry
ON public.symbols
FOR EACH ROW
EXECUTE FUNCTION public.enforce_canonical_gics_taxonomy();

-- Vy: enda källan för WSP-pipelinen
DROP VIEW IF EXISTS public.wsp_eligible_universe;
CREATE VIEW public.wsp_eligible_universe
WITH (security_invoker = on)
AS
SELECT
  s.symbol,
  s.name,
  s.canonical_sector,
  s.canonical_industry,
  s.market_cap,
  s.support_level,
  s.eligible_for_full_wsp,
  s.is_common_stock,
  s.classification_confidence_level,
  s.enriched_at
FROM public.symbols s
WHERE s.is_active = true
  AND s.canonical_sector IS NOT NULL
  AND s.canonical_industry IS NOT NULL
  AND s.eligible_for_full_wsp = true
  AND (s.is_common_stock = true OR s.support_level = 'sector_benchmark_proxy');

GRANT SELECT ON public.wsp_eligible_universe TO anon, authenticated, service_role;

-- Index för enrichment-loop
CREATE INDEX IF NOT EXISTS idx_symbols_needs_classification
ON public.symbols (enriched_at NULLS FIRST)
WHERE canonical_industry IS NULL
  AND classification_status IS DISTINCT FROM 'unresolvable'
  AND is_active = true;

-- Doktrin compliance RPC för admin-widgeten
CREATE OR REPLACE FUNCTION public.get_doctrine_compliance()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_symbols', (SELECT COUNT(*) FROM symbols WHERE is_active = true),
    'sector_classified', (SELECT COUNT(*) FROM symbols WHERE is_active = true AND canonical_sector IS NOT NULL),
    'industry_classified', (SELECT COUNT(*) FROM symbols WHERE is_active = true AND canonical_industry IS NOT NULL),
    'wsp_eligible', (SELECT COUNT(*) FROM wsp_eligible_universe),
    'sector_proxies', (SELECT COUNT(*) FROM symbols WHERE support_level = 'sector_benchmark_proxy'),
    'etf_excluded', (SELECT COUNT(*) FROM symbols WHERE support_level = 'etf_excluded'),
    'unresolvable', (SELECT COUNT(*) FROM symbols WHERE classification_status = 'unresolvable'),
    'pending_enrichment', (SELECT COUNT(*) FROM symbols WHERE is_active = true AND canonical_industry IS NULL AND classification_status IS DISTINCT FROM 'unresolvable' AND support_level IS DISTINCT FROM 'etf_excluded'),
    'non_canonical_sector_violations', (SELECT COUNT(*) FROM symbols WHERE canonical_sector IS NOT NULL AND canonical_sector NOT IN (SELECT sector_name FROM canonical_gics_sectors)),
    'non_canonical_industry_violations', (SELECT COUNT(*) FROM symbols WHERE canonical_industry IS NOT NULL AND canonical_industry NOT IN (SELECT industry_name FROM canonical_gics_industries)),
    'updated_at', now()
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_doctrine_compliance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_doctrine_compliance() TO authenticated, service_role;
