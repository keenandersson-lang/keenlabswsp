-- Canonical admin console hardening:
-- 1) canonical run console visibility with current step
-- 2) publish history surface
-- 3) canonical price bar lineage range
-- 4) tier-1 metadata guardrail backfill

CREATE OR REPLACE FUNCTION public.get_equity_pipeline_console_runs(p_limit integer DEFAULT 25)
RETURNS TABLE(
  id bigint,
  run_type public.pipeline_run_type,
  status public.pipeline_run_status,
  started_at timestamptz,
  finished_at timestamptz,
  trigger_source public.pipeline_trigger_source,
  requested_by text,
  current_step text,
  error_summary text,
  metadata_json jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH runs AS (
    SELECT r.*
    FROM public.pipeline_runs r
    WHERE r.asset_class = 'equities'
    ORDER BY r.started_at DESC
    LIMIT GREATEST(p_limit, 1)
  )
  SELECT
    r.id,
    r.run_type,
    r.status,
    r.started_at,
    r.finished_at,
    r.trigger_source,
    r.requested_by,
    step_pick.step_name AS current_step,
    r.error_summary,
    r.metadata_json
  FROM runs r
  LEFT JOIN LATERAL (
    SELECT s.step_name
    FROM public.pipeline_run_steps s
    WHERE s.run_id = r.id
    ORDER BY
      CASE
        WHEN s.status = 'running' THEN 0
        WHEN s.status = 'failed' THEN 1
        WHEN s.status = 'queued' THEN 2
        WHEN s.status = 'completed' THEN 3
        ELSE 4
      END,
      s.started_at DESC NULLS LAST,
      s.id DESC
    LIMIT 1
  ) step_pick ON true
  ORDER BY r.started_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_equity_publish_history(p_limit integer DEFAULT 5)
RETURNS TABLE(
  run_id bigint,
  snapshot_id bigint,
  published_at timestamptz,
  is_current_canonical boolean
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    r.id AS run_id,
    ds.snapshot_id,
    COALESCE(ps.finished_at, r.finished_at, ds.completed_at, ds.started_at) AS published_at,
    ds.is_canonical AS is_current_canonical
  FROM public.pipeline_runs r
  JOIN public.data_snapshots ds ON ds.run_id = r.id AND ds.asset_class = 'equities'
  LEFT JOIN public.pipeline_run_steps ps ON ps.run_id = r.id AND ps.step_name = 'publish_snapshot'
  WHERE r.asset_class = 'equities'
    AND r.status IN ('published', 'completed')
  ORDER BY COALESCE(ps.finished_at, r.finished_at, ds.completed_at, ds.started_at) DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.get_equity_canonical_price_bar_range()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH canonical AS (
    SELECT public.get_latest_canonical_snapshot_id('equities') AS sid
  ),
  scoped_symbols AS (
    SELECT DISTINCT s.symbol
    FROM public.get_equity_screener_rows(0, 20000) s
  ),
  active_equities AS (
    SELECT COUNT(*)::bigint AS n
    FROM public.symbols s
    WHERE s.is_active = true
      AND COALESCE(s.asset_class, 'equity') = 'equity'
  ),
  bars AS (
    SELECT dp.symbol, MIN(dp.date)::date AS min_date, MAX(dp.date)::date AS max_date
    FROM public.daily_prices dp
    JOIN scoped_symbols ss ON ss.symbol = dp.symbol
    GROUP BY dp.symbol
  ),
  stats AS (
    SELECT
      COUNT(*)::bigint AS symbols_with_prices,
      MIN(min_date)::date AS earliest_price_date,
      MAX(max_date)::date AS latest_price_date
    FROM bars
  )
  SELECT jsonb_build_object(
    'snapshot_id', (SELECT sid FROM canonical),
    'active_symbol_count', (SELECT n FROM active_equities),
    'symbols_with_prices', (SELECT symbols_with_prices FROM stats),
    'earliest_price_date', (SELECT earliest_price_date FROM stats),
    'latest_price_date', (SELECT latest_price_date FROM stats)
  );
$$;

WITH tier1_fix(symbol, canonical_sector, canonical_industry) AS (
  VALUES
    ('AAPL', 'Technology', 'Consumer Electronics'),
    ('MSFT', 'Technology', 'Software Infrastructure'),
    ('NVDA', 'Technology', 'Semiconductors'),
    ('AMZN', 'Consumer Discretionary', 'Internet Retail'),
    ('GOOGL', 'Communication Services', 'Internet Content Information'),
    ('META', 'Communication Services', 'Internet Content Information'),
    ('TSLA', 'Consumer Discretionary', 'Auto Manufacturers')
)
UPDATE public.symbols s
SET
  canonical_sector = t.canonical_sector,
  canonical_industry = t.canonical_industry,
  sector = COALESCE(NULLIF(s.sector, ''), t.canonical_sector),
  industry = COALESCE(NULLIF(s.industry, ''), t.canonical_industry),
  classification_status = COALESCE(s.classification_status, 'manually_reviewed'),
  classification_source = COALESCE(s.classification_source, 'tier1_manual_guardrail'),
  classification_confidence = GREATEST(COALESCE(s.classification_confidence, 0), 0.95),
  classification_confidence_level = COALESCE(s.classification_confidence_level, 'high'),
  review_needed = false,
  instrument_type = COALESCE(NULLIF(s.instrument_type, ''), 'CS'),
  support_level = COALESCE(NULLIF(s.support_level, ''), 'full_wsp_equity')
FROM tier1_fix t
WHERE s.symbol = t.symbol
  AND (
    s.canonical_sector IS NULL
    OR s.canonical_sector = 'Unknown'
    OR s.canonical_industry IS NULL
    OR s.canonical_industry = 'Unknown'
    OR s.support_level IS NULL
    OR s.support_level = ''
  );

GRANT EXECUTE ON FUNCTION public.get_equity_pipeline_console_runs(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_equity_publish_history(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_equity_canonical_price_bar_range() TO anon, authenticated, service_role;
