ALTER TABLE public.symbols
  ADD COLUMN IF NOT EXISTS raw_sector text,
  ADD COLUMN IF NOT EXISTS raw_industry text,
  ADD COLUMN IF NOT EXISTS canonical_sector text,
  ADD COLUMN IF NOT EXISTS canonical_industry text,
  ADD COLUMN IF NOT EXISTS classification_confidence numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS classification_confidence_level text DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS classification_source text,
  ADD COLUMN IF NOT EXISTS classification_status text DEFAULT 'unresolved',
  ADD COLUMN IF NOT EXISTS classification_reason text,
  ADD COLUMN IF NOT EXISTS review_needed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS manually_reviewed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_override_sector text,
  ADD COLUMN IF NOT EXISTS manual_override_industry text,
  ADD COLUMN IF NOT EXISTS manual_review_notes text,
  ADD COLUMN IF NOT EXISTS manual_reviewed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'symbols_classification_status_valid'
  ) THEN
    ALTER TABLE public.symbols
      ADD CONSTRAINT symbols_classification_status_valid
      CHECK (classification_status IN ('canonicalized', 'ambiguous', 'unresolved', 'proxy_mapped', 'manually_reviewed'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'symbols_classification_confidence_level_valid'
  ) THEN
    ALTER TABLE public.symbols
      ADD CONSTRAINT symbols_classification_confidence_level_valid
      CHECK (classification_confidence_level IN ('high', 'medium', 'low'));
  END IF;
END$$;

UPDATE public.symbols
SET
  raw_sector = COALESCE(raw_sector, NULLIF(sector, ''), NULL),
  raw_industry = COALESCE(raw_industry, NULLIF(industry, ''), NULL)
WHERE raw_sector IS NULL OR raw_industry IS NULL;

UPDATE public.symbols
SET
  canonical_sector = COALESCE(canonical_sector, NULLIF(sector, ''), NULL),
  canonical_industry = COALESCE(canonical_industry, NULLIF(industry, ''), NULL)
WHERE canonical_sector IS NULL OR canonical_industry IS NULL;

UPDATE public.symbols
SET
  classification_status = CASE
    WHEN manually_reviewed OR (manual_override_sector IS NOT NULL AND manual_override_industry IS NOT NULL) THEN 'manually_reviewed'
    WHEN canonical_sector IS NULL OR canonical_industry IS NULL THEN 'unresolved'
    WHEN canonical_industry ILIKE '%Proxy Basket%' THEN 'proxy_mapped'
    ELSE 'canonicalized'
  END,
  classification_confidence_level = CASE
    WHEN manually_reviewed OR (manual_override_sector IS NOT NULL AND manual_override_industry IS NOT NULL) THEN 'high'
    WHEN canonical_sector IS NOT NULL AND canonical_industry IS NOT NULL THEN COALESCE(NULLIF(classification_confidence_level, ''), 'medium')
    ELSE 'low'
  END,
  classification_confidence = CASE
    WHEN manually_reviewed OR (manual_override_sector IS NOT NULL AND manual_override_industry IS NOT NULL) THEN 1
    WHEN canonical_sector IS NOT NULL AND canonical_industry IS NOT NULL THEN GREATEST(COALESCE(classification_confidence, 0), 0.70)
    WHEN canonical_sector IS NOT NULL AND canonical_industry IS NULL THEN GREATEST(COALESCE(classification_confidence, 0), 0.40)
    ELSE COALESCE(classification_confidence, 0.20)
  END,
  classification_source = COALESCE(NULLIF(classification_source, ''), source_provider, 'bootstrap'),
  review_needed = CASE
    WHEN manually_reviewed OR (manual_override_sector IS NOT NULL AND manual_override_industry IS NOT NULL) THEN false
    WHEN canonical_sector IS NULL OR canonical_industry IS NULL THEN true
    WHEN classification_confidence_level = 'low' THEN true
    ELSE false
  END;

CREATE INDEX IF NOT EXISTS idx_symbols_classification_status
  ON public.symbols (classification_status, symbol);

CREATE INDEX IF NOT EXISTS idx_symbols_review_needed
  ON public.symbols (review_needed, classification_confidence_level, symbol);

CREATE OR REPLACE VIEW public.symbol_classification_review_queue AS
SELECT
  s.symbol,
  COALESCE(NULLIF(s.company_name, ''), NULLIF(s.name, ''), s.symbol) AS company_name,
  s.exchange,
  s.instrument_type,
  s.raw_sector,
  s.raw_industry,
  s.canonical_sector,
  s.canonical_industry,
  s.classification_confidence,
  s.classification_confidence_level,
  s.classification_source,
  s.classification_status,
  COALESCE(s.classification_reason, s.exclusion_reason, 'review_needed') AS flagged_reason,
  s.review_needed,
  s.support_level,
  s.eligible_for_full_wsp,
  s.manually_reviewed,
  s.manual_override_sector,
  s.manual_override_industry,
  s.manual_review_notes,
  s.manual_reviewed_at
FROM public.symbols s
WHERE s.review_needed = true
   OR s.classification_status IN ('ambiguous', 'unresolved')
   OR COALESCE(s.classification_confidence_level, 'low') = 'low';
