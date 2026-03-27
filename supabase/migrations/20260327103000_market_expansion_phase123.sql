ALTER TABLE public.symbols
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS is_common_stock boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS support_level text DEFAULT 'data_only',
  ADD COLUMN IF NOT EXISTS eligible_for_backfill boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS eligible_for_full_wsp boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclusion_reason text,
  ADD COLUMN IF NOT EXISTS source_provider text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'symbols_support_level_valid'
  ) THEN
    ALTER TABLE public.symbols
      ADD CONSTRAINT symbols_support_level_valid
      CHECK (
        support_level IN (
          'full_wsp_equity',
          'limited_equity',
          'sector_benchmark_proxy',
          'metals_limited',
          'data_only',
          'excluded'
        )
      );
  END IF;
END$$;

UPDATE public.symbols
SET company_name = COALESCE(NULLIF(company_name, ''), NULLIF(name, ''), symbol)
WHERE company_name IS NULL OR company_name = '';

UPDATE public.symbols
SET
  is_common_stock = COALESCE(is_common_stock, false) OR COALESCE(instrument_type, '') = 'CS',
  source_provider = COALESCE(NULLIF(source_provider, ''), 'seed_v1'),
  support_level = COALESCE(NULLIF(support_level, ''), 'data_only'),
  eligible_for_backfill = COALESCE(eligible_for_backfill, false),
  eligible_for_full_wsp = COALESCE(eligible_for_full_wsp, false);

CREATE INDEX IF NOT EXISTS idx_symbols_backfill_eligibility
  ON public.symbols (eligible_for_backfill, symbol);

CREATE INDEX IF NOT EXISTS idx_symbols_support_level
  ON public.symbols (support_level, symbol);

CREATE INDEX IF NOT EXISTS idx_symbols_full_wsp_eligibility
  ON public.symbols (eligible_for_full_wsp, symbol);
