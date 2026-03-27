
ALTER TABLE public.symbols
  ADD COLUMN IF NOT EXISTS instrument_type text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_etf boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_adr boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sic_code text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sic_description text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS primary_exchange text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS enriched_at timestamp with time zone DEFAULT NULL;
