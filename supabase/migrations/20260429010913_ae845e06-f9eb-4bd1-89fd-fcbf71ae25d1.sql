
-- 1. Module runs tracking table
CREATE TABLE IF NOT EXISTS public.module_runs (
  id BIGSERIAL PRIMARY KEY,
  module_name TEXT NOT NULL CHECK (module_name IN ('api-data-collector','universe-scan','gics-classifier')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed','partial')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  input_count INTEGER NOT NULL DEFAULT 0,
  output_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  triggered_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_module_runs_module_started ON public.module_runs(module_name, started_at DESC);

ALTER TABLE public.module_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_module_runs" ON public.module_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon_read_module_runs" ON public.module_runs FOR SELECT TO anon USING (started_at >= now() - interval '7 days');
CREATE POLICY "srv_module_runs" ON public.module_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. Doctrine failures capture table
CREATE TABLE IF NOT EXISTS public.doctrine_failures (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempted_sector TEXT,
  attempted_industry TEXT,
  failure_reason TEXT NOT NULL,
  source TEXT,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_doctrine_failures_symbol ON public.doctrine_failures(symbol, failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_doctrine_failures_unresolved ON public.doctrine_failures(failed_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.doctrine_failures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_doctrine_failures" ON public.doctrine_failures FOR SELECT TO authenticated USING (true);
CREATE POLICY "srv_doctrine_failures" ON public.doctrine_failures FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Broaden wsp_eligible_universe to cover the full US equity market
DROP VIEW IF EXISTS public.wsp_eligible_universe CASCADE;
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
  AND (
    -- Common stocks with full GICS classification
    (s.canonical_sector IS NOT NULL 
      AND s.canonical_industry IS NOT NULL 
      AND COALESCE(s.is_common_stock, false) = true
      AND s.support_level IN ('full_wsp_equity','limited_equity','data_only'))
    OR
    -- Sector benchmark proxies (XL*, SPY, QQQ, GLD, SLV, etc.)
    s.support_level = 'sector_benchmark_proxy'
  );

GRANT SELECT ON public.wsp_eligible_universe TO anon, authenticated;

-- 4. RPC: doctrine compliance
CREATE OR REPLACE FUNCTION public.get_doctrine_compliance()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INTEGER;
  v_eligible INTEGER;
  v_violations INTEGER;
  v_failures_24h INTEGER;
  v_trigger_exists BOOLEAN;
  v_view_exists BOOLEAN;
  v_proxies_ok INTEGER;
  v_proxies_total INTEGER;
BEGIN
  SELECT count(*) INTO v_total FROM public.symbols WHERE is_active = true;
  SELECT count(*) INTO v_eligible FROM public.wsp_eligible_universe;

  SELECT count(*) INTO v_violations
  FROM public.symbols
  WHERE is_active = true
    AND canonical_sector IS NOT NULL
    AND canonical_sector NOT IN (SELECT sector_name FROM public.canonical_gics_sectors);

  SELECT count(*) INTO v_failures_24h
  FROM public.doctrine_failures
  WHERE failed_at >= now() - interval '24 hours';

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trg_enforce_canonical_gics' AND NOT tgisinternal
  ) INTO v_trigger_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.views 
    WHERE table_schema='public' AND table_name='wsp_eligible_universe'
  ) INTO v_view_exists;

  SELECT count(*) FILTER (WHERE support_level='sector_benchmark_proxy'),
         count(*)
    INTO v_proxies_ok, v_proxies_total
  FROM public.symbols
  WHERE symbol IN ('SPY','QQQ','DIA','IWM','XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC','GLD','SLV','COPX');

  RETURN jsonb_build_object(
    'total_active', v_total,
    'wsp_eligible', v_eligible,
    'gics_violations', v_violations,
    'failures_24h', v_failures_24h,
    'trigger_active', v_trigger_exists,
    'view_active', v_view_exists,
    'proxies_ok', v_proxies_ok,
    'proxies_total', v_proxies_total,
    'doctrine_score', CASE 
      WHEN v_violations = 0 AND v_trigger_exists AND v_view_exists AND v_proxies_ok = v_proxies_total THEN 100
      ELSE GREATEST(0, 100 - (v_violations * 5) - (CASE WHEN NOT v_trigger_exists THEN 30 ELSE 0 END) - (CASE WHEN NOT v_view_exists THEN 30 ELSE 0 END) - ((v_proxies_total - v_proxies_ok) * 2))
    END,
    'as_of', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_doctrine_compliance() TO anon, authenticated;

-- 5. RPC: failures list with re-queue capability
CREATE OR REPLACE FUNCTION public.get_doctrine_failures(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  symbol TEXT,
  failed_at TIMESTAMPTZ,
  attempted_sector TEXT,
  attempted_industry TEXT,
  failure_reason TEXT,
  source TEXT,
  attempts INTEGER,
  last_error TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    df.symbol,
    df.failed_at,
    df.attempted_sector,
    df.attempted_industry,
    df.failure_reason,
    df.source,
    COALESCE(ea.attempts, 0)::INTEGER,
    ea.last_error
  FROM public.doctrine_failures df
  LEFT JOIN public.enrichment_attempts ea ON ea.symbol = df.symbol
  WHERE df.resolved_at IS NULL
  ORDER BY df.failed_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;
GRANT EXECUTE ON FUNCTION public.get_doctrine_failures(INTEGER) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.requeue_doctrine_failures(p_symbols TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cleared INTEGER;
  v_marked INTEGER;
BEGIN
  WITH del AS (
    DELETE FROM public.enrichment_attempts WHERE symbol = ANY(p_symbols) RETURNING 1
  )
  SELECT count(*) INTO v_cleared FROM del;

  UPDATE public.doctrine_failures
  SET resolved_at = now()
  WHERE symbol = ANY(p_symbols) AND resolved_at IS NULL;
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  -- Reset symbols so they get retried by bulk-enrich
  UPDATE public.symbols
  SET enriched_at = NULL,
      classification_status = NULL
  WHERE symbol = ANY(p_symbols);

  RETURN jsonb_build_object(
    'cleared_attempts', v_cleared,
    'resolved_failures', v_marked,
    'requeued_symbols', array_length(p_symbols, 1)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.requeue_doctrine_failures(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.requeue_doctrine_failures(TEXT[]) TO service_role;

-- 6. RPC: proxy verification
CREATE OR REPLACE FUNCTION public.get_proxy_verification()
RETURNS TABLE (
  symbol TEXT,
  expected_role TEXT,
  current_support_level TEXT,
  is_correct BOOLEAN,
  is_active BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH expected(symbol, expected_role) AS (
    VALUES 
      ('SPY','market_proxy'),('QQQ','market_proxy'),('DIA','market_proxy'),('IWM','market_proxy'),
      ('XLK','sector_proxy_information_technology'),('XLF','sector_proxy_financials'),
      ('XLE','sector_proxy_energy'),('XLV','sector_proxy_health_care'),
      ('XLI','sector_proxy_industrials'),('XLY','sector_proxy_consumer_discretionary'),
      ('XLP','sector_proxy_consumer_staples'),('XLU','sector_proxy_utilities'),
      ('XLB','sector_proxy_materials'),('XLRE','sector_proxy_real_estate'),('XLC','sector_proxy_communication_services'),
      ('GLD','metals_proxy'),('SLV','metals_proxy'),('COPX','metals_proxy')
  )
  SELECT 
    e.symbol,
    e.expected_role,
    s.support_level,
    (s.support_level = 'sector_benchmark_proxy') AS is_correct,
    COALESCE(s.is_active, false) AS is_active
  FROM expected e
  LEFT JOIN public.symbols s ON s.symbol = e.symbol
  ORDER BY e.symbol;
$$;
GRANT EXECUTE ON FUNCTION public.get_proxy_verification() TO anon, authenticated;

-- 7. RPC: module dataflow tracker
CREATE OR REPLACE FUNCTION public.get_module_dataflow()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB := '{}'::jsonb;
  v_module TEXT;
  v_modules TEXT[] := ARRAY['api-data-collector','universe-scan','gics-classifier'];
BEGIN
  FOREACH v_module IN ARRAY v_modules LOOP
    v_result := v_result || jsonb_build_object(
      v_module,
      (
        SELECT jsonb_build_object(
          'last_success', (SELECT to_jsonb(r.*) FROM public.module_runs r WHERE r.module_name = v_module AND r.status = 'success' ORDER BY r.finished_at DESC NULLS LAST LIMIT 1),
          'last_error', (SELECT to_jsonb(r.*) FROM public.module_runs r WHERE r.module_name = v_module AND r.status = 'failed' ORDER BY r.started_at DESC LIMIT 1),
          'currently_running', (SELECT count(*) FROM public.module_runs WHERE module_name = v_module AND status = 'running' AND started_at >= now() - interval '1 hour'),
          'runs_24h', (SELECT count(*) FROM public.module_runs WHERE module_name = v_module AND started_at >= now() - interval '24 hours'),
          'success_rate_24h', (
            SELECT ROUND(100.0 * count(*) FILTER (WHERE status='success') / NULLIF(count(*) FILTER (WHERE status IN ('success','failed')), 0), 1)
            FROM public.module_runs WHERE module_name = v_module AND started_at >= now() - interval '24 hours'
          )
        )
      )
    );
  END LOOP;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_module_dataflow() TO anon, authenticated;

-- 8. RPC: validate triggers/views
CREATE OR REPLACE FUNCTION public.validate_doctrine_triggers_views()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trigger_exists BOOLEAN;
  v_view_exists BOOLEAN;
  v_view_rows INTEGER;
  v_canonical_sectors INTEGER;
  v_canonical_industries INTEGER;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_enforce_canonical_gics' AND NOT tgisinternal) INTO v_trigger_exists;
  SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='wsp_eligible_universe') INTO v_view_exists;
  IF v_view_exists THEN
    SELECT count(*) INTO v_view_rows FROM public.wsp_eligible_universe;
  ELSE
    v_view_rows := 0;
  END IF;
  SELECT count(*) INTO v_canonical_sectors FROM public.canonical_gics_sectors;
  SELECT count(*) INTO v_canonical_industries FROM public.canonical_gics_industries;

  RETURN jsonb_build_object(
    'trg_enforce_canonical_gics', jsonb_build_object('exists', v_trigger_exists, 'status', CASE WHEN v_trigger_exists THEN 'OK' ELSE 'MISSING' END),
    'wsp_eligible_universe', jsonb_build_object('exists', v_view_exists, 'row_count', v_view_rows, 'status', CASE WHEN v_view_exists AND v_view_rows > 0 THEN 'OK' WHEN v_view_exists THEN 'EMPTY' ELSE 'MISSING' END),
    'canonical_gics_sectors', jsonb_build_object('count', v_canonical_sectors, 'expected', 11, 'status', CASE WHEN v_canonical_sectors = 11 THEN 'OK' ELSE 'DRIFT' END),
    'canonical_gics_industries', jsonb_build_object('count', v_canonical_industries, 'expected_min', 69, 'status', CASE WHEN v_canonical_industries >= 69 THEN 'OK' ELSE 'DRIFT' END),
    'as_of', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.validate_doctrine_triggers_views() TO anon, authenticated;
