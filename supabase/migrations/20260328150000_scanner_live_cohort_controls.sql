-- Cohort-based, reversible promotion controls for broad scanner rollout.
-- Keeps Tier 1 behavior unchanged while allowing explicit, auditable expansion cohorts.

CREATE TABLE IF NOT EXISTS public.scanner_live_promotion_overrides (
  id bigserial PRIMARY KEY,
  scan_run_id bigint NOT NULL REFERENCES public.market_scan_runs(id) ON DELETE CASCADE,
  symbol text NOT NULL REFERENCES public.symbols(symbol) ON DELETE CASCADE,
  cohort_label text NOT NULL,
  previous_promotion_status text NOT NULL,
  applied_promotion_status text NOT NULL DEFAULT 'approved_for_live_scanner',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT scanner_live_promotion_overrides_applied_status_valid CHECK (
    applied_promotion_status IN ('approved_for_live_scanner')
  ),
  CONSTRAINT scanner_live_promotion_overrides_prev_status_valid CHECK (
    previous_promotion_status IN ('review_needed', 'broader_candidate', 'approved_for_live_scanner', 'tier1_default', 'blocked_low_quality')
  ),
  CONSTRAINT scanner_live_promotion_overrides_unique_active UNIQUE (scan_run_id, symbol, cohort_label)
);

CREATE INDEX IF NOT EXISTS idx_scanner_live_promotion_overrides_scan_run
  ON public.scanner_live_promotion_overrides (scan_run_id, is_active, symbol);

ALTER TABLE public.scanner_live_promotion_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'scanner_live_promotion_overrides' AND policyname = 'Anyone can read scanner live promotion overrides'
  ) THEN
    CREATE POLICY "Anyone can read scanner live promotion overrides" ON public.scanner_live_promotion_overrides
      FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'scanner_live_promotion_overrides' AND policyname = 'Service role can manage scanner live promotion overrides'
  ) THEN
    CREATE POLICY "Service role can manage scanner live promotion overrides" ON public.scanner_live_promotion_overrides
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.apply_scanner_live_cohort(
  p_symbols text[],
  p_cohort_label text,
  p_scan_run_id bigint DEFAULT NULL,
  p_allow_from_statuses text[] DEFAULT ARRAY['review_needed']::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scan_run_id bigint;
  v_inserted bigint := 0;
  v_updated bigint := 0;
  v_skipped bigint := 0;
BEGIN
  IF p_cohort_label IS NULL OR btrim(p_cohort_label) = '' THEN
    RAISE EXCEPTION 'p_cohort_label is required';
  END IF;

  v_scan_run_id := COALESCE(
    p_scan_run_id,
    (SELECT id FROM public.market_scan_runs ORDER BY started_at DESC, id DESC LIMIT 1)
  );

  IF v_scan_run_id IS NULL THEN
    RAISE EXCEPTION 'No market_scan_runs available to apply cohort';
  END IF;

  WITH requested AS (
    SELECT DISTINCT UPPER(TRIM(sym)) AS symbol
    FROM unnest(COALESCE(p_symbols, ARRAY[]::text[])) AS sym
    WHERE sym IS NOT NULL AND TRIM(sym) <> ''
  ),
  target AS (
    SELECT msr.symbol, msr.promotion_status
    FROM public.market_scan_results msr
    JOIN requested r ON r.symbol = msr.symbol
    WHERE msr.run_id = v_scan_run_id
      AND msr.promotion_status = ANY(COALESCE(p_allow_from_statuses, ARRAY['review_needed']::text[]))
  ),
  upsert_overrides AS (
    INSERT INTO public.scanner_live_promotion_overrides (
      scan_run_id,
      symbol,
      cohort_label,
      previous_promotion_status,
      applied_promotion_status,
      is_active,
      reverted_at,
      metadata
    )
    SELECT
      v_scan_run_id,
      t.symbol,
      btrim(p_cohort_label),
      t.promotion_status,
      'approved_for_live_scanner',
      true,
      NULL,
      jsonb_build_object('allow_from_statuses', COALESCE(p_allow_from_statuses, ARRAY['review_needed']::text[]))
    FROM target t
    ON CONFLICT (scan_run_id, symbol, cohort_label)
    DO UPDATE SET
      previous_promotion_status = EXCLUDED.previous_promotion_status,
      applied_promotion_status = EXCLUDED.applied_promotion_status,
      is_active = true,
      reverted_at = NULL,
      metadata = EXCLUDED.metadata
    RETURNING xmax = 0 AS inserted
  ),
  apply_updates AS (
    UPDATE public.market_scan_results msr
    SET
      promotion_status = 'approved_for_live_scanner',
      approved_for_live_scanner = true,
      review_needed = false,
      blocked_low_quality = false,
      payload = COALESCE(msr.payload, '{}'::jsonb) || jsonb_build_object(
        'cohort_override', true,
        'cohort_label', btrim(p_cohort_label),
        'cohort_override_applied_at', now()
      )
    FROM target t
    WHERE msr.run_id = v_scan_run_id
      AND msr.symbol = t.symbol
    RETURNING 1
  )
  SELECT
    COALESCE((SELECT COUNT(*) FROM upsert_overrides WHERE inserted), 0),
    COALESCE((SELECT COUNT(*) FROM apply_updates), 0),
    GREATEST((SELECT COUNT(*) FROM requested) - COALESCE((SELECT COUNT(*) FROM target), 0), 0)
  INTO v_inserted, v_updated, v_skipped;

  RETURN jsonb_build_object(
    'scan_run_id', v_scan_run_id,
    'cohort_label', btrim(p_cohort_label),
    'inserted_overrides', v_inserted,
    'updated_scan_rows', v_updated,
    'skipped_symbols', v_skipped
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_scanner_live_cohort(
  p_cohort_label text,
  p_scan_run_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scan_run_id bigint;
  v_reverted bigint := 0;
  v_deactivated bigint := 0;
BEGIN
  IF p_cohort_label IS NULL OR btrim(p_cohort_label) = '' THEN
    RAISE EXCEPTION 'p_cohort_label is required';
  END IF;

  v_scan_run_id := COALESCE(
    p_scan_run_id,
    (SELECT id FROM public.market_scan_runs ORDER BY started_at DESC, id DESC LIMIT 1)
  );

  IF v_scan_run_id IS NULL THEN
    RAISE EXCEPTION 'No market_scan_runs available to revert cohort';
  END IF;

  WITH active_overrides AS (
    SELECT o.symbol, o.previous_promotion_status
    FROM public.scanner_live_promotion_overrides o
    WHERE o.scan_run_id = v_scan_run_id
      AND o.cohort_label = btrim(p_cohort_label)
      AND o.is_active = true
  ),
  restored AS (
    UPDATE public.market_scan_results msr
    SET
      promotion_status = ao.previous_promotion_status,
      approved_for_live_scanner = (ao.previous_promotion_status IN ('tier1_default', 'approved_for_live_scanner')),
      review_needed = (ao.previous_promotion_status = 'review_needed'),
      blocked_low_quality = (ao.previous_promotion_status = 'blocked_low_quality'),
      payload = COALESCE(msr.payload, '{}'::jsonb) || jsonb_build_object(
        'cohort_override_reverted', true,
        'cohort_label', btrim(p_cohort_label),
        'cohort_override_reverted_at', now()
      )
    FROM active_overrides ao
    WHERE msr.run_id = v_scan_run_id
      AND msr.symbol = ao.symbol
    RETURNING 1
  ),
  deactivate AS (
    UPDATE public.scanner_live_promotion_overrides o
    SET is_active = false,
        reverted_at = now()
    WHERE o.scan_run_id = v_scan_run_id
      AND o.cohort_label = btrim(p_cohort_label)
      AND o.is_active = true
    RETURNING 1
  )
  SELECT
    COALESCE((SELECT COUNT(*) FROM restored), 0),
    COALESCE((SELECT COUNT(*) FROM deactivate), 0)
  INTO v_reverted, v_deactivated;

  RETURN jsonb_build_object(
    'scan_run_id', v_scan_run_id,
    'cohort_label', btrim(p_cohort_label),
    'reverted_symbols', v_reverted,
    'deactivated_overrides', v_deactivated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_scanner_live_cohort(text[], text, bigint, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revert_scanner_live_cohort(text, bigint) TO anon, authenticated, service_role;
