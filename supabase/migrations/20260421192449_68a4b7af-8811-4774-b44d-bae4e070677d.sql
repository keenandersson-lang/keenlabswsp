
-- 1. Enrichment attempts tracking table
CREATE TABLE IF NOT EXISTS public.enrichment_attempts (
  symbol text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
  last_error text,
  last_source_tried text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.enrichment_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages enrichment_attempts"
  ON public.enrichment_attempts FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can read enrichment_attempts"
  ON public.enrichment_attempts FOR SELECT
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_enrichment_attempts_last_attempt
  ON public.enrichment_attempts(last_attempt_at);

-- 2. Heartbeat column on bootstrap_jobs (for tighter watchdog detection)
ALTER TABLE public.bootstrap_jobs
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamp with time zone DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_bootstrap_jobs_heartbeat
  ON public.bootstrap_jobs(heartbeat_at) WHERE status = 'running';

-- 3. Source attribution RPC for admin observability
CREATE OR REPLACE FUNCTION public.get_source_attribution_24h()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH source_data AS (
    SELECT
      sync_type,
      status,
      data_source,
      metadata,
      started_at,
      completed_at,
      symbols_processed,
      symbols_failed
    FROM public.data_sync_log
    WHERE started_at >= now() - interval '24 hours'
  ),
  per_source AS (
    SELECT
      coalesce(
        (metadata->'source_attribution'->>'polygon')::int, 0
      ) AS polygon_success,
      coalesce(
        (metadata->'source_attribution'->>'finnhub')::int, 0
      ) AS finnhub_success,
      coalesce(
        (metadata->'source_attribution'->>'yahoo')::int, 0
      ) AS yahoo_success,
      coalesce(
        (metadata->'source_attribution'->>'alpaca')::int, 0
      ) AS alpaca_success,
      coalesce(
        (metadata->'source_attribution'->>'none')::int, 0
      ) AS none_count,
      coalesce(
        (metadata->'fallback_recovered_per_source'->>'polygon')::int, 0
      ) AS polygon_fallback,
      coalesce(
        (metadata->'fallback_recovered_per_source'->>'yahoo')::int, 0
      ) AS yahoo_fallback,
      coalesce(
        (metadata->'fallback_recovered_per_source'->>'alpaca')::int, 0
      ) AS alpaca_fallback,
      symbols_failed,
      started_at,
      status
    FROM source_data
  ),
  per_source_hour AS (
    SELECT
      coalesce(
        (metadata->'source_attribution'->>'polygon')::int, 0
      ) AS polygon_success,
      coalesce(
        (metadata->'source_attribution'->>'finnhub')::int, 0
      ) AS finnhub_success,
      coalesce(
        (metadata->'source_attribution'->>'yahoo')::int, 0
      ) AS yahoo_success,
      coalesce(
        (metadata->'source_attribution'->>'alpaca')::int, 0
      ) AS alpaca_success,
      symbols_failed
    FROM source_data
    WHERE started_at >= now() - interval '1 hour'
  ),
  totals AS (
    SELECT
      sum(polygon_success) AS polygon_24h,
      sum(finnhub_success) AS finnhub_24h,
      sum(yahoo_success) AS yahoo_24h,
      sum(alpaca_success) AS alpaca_24h,
      sum(none_count) AS unresolved_24h,
      sum(polygon_fallback) AS polygon_fallback_24h,
      sum(yahoo_fallback) AS yahoo_fallback_24h,
      sum(alpaca_fallback) AS alpaca_fallback_24h,
      sum(symbols_failed) AS total_failed_24h
    FROM per_source
  ),
  totals_hour AS (
    SELECT
      sum(polygon_success) AS polygon_1h,
      sum(finnhub_success) AS finnhub_1h,
      sum(yahoo_success) AS yahoo_1h,
      sum(alpaca_success) AS alpaca_1h,
      sum(symbols_failed) AS failed_1h
    FROM per_source_hour
  ),
  last_success AS (
    SELECT
      max(started_at) FILTER (
        WHERE coalesce((metadata->'source_attribution'->>'polygon')::int, 0) > 0
      ) AS polygon_last,
      max(started_at) FILTER (
        WHERE coalesce((metadata->'source_attribution'->>'finnhub')::int, 0) > 0
      ) AS finnhub_last,
      max(started_at) FILTER (
        WHERE coalesce((metadata->'source_attribution'->>'yahoo')::int, 0) > 0
      ) AS yahoo_last,
      max(started_at) FILTER (
        WHERE coalesce((metadata->'source_attribution'->>'alpaca')::int, 0) > 0
      ) AS alpaca_last
    FROM source_data
  )
  SELECT jsonb_build_object(
    'window_24h', jsonb_build_object(
      'polygon', coalesce(t.polygon_24h, 0),
      'finnhub', coalesce(t.finnhub_24h, 0),
      'yahoo', coalesce(t.yahoo_24h, 0),
      'alpaca', coalesce(t.alpaca_24h, 0),
      'unresolved', coalesce(t.unresolved_24h, 0),
      'total_failed', coalesce(t.total_failed_24h, 0)
    ),
    'fallback_recovery_24h', jsonb_build_object(
      'polygon', coalesce(t.polygon_fallback_24h, 0),
      'yahoo', coalesce(t.yahoo_fallback_24h, 0),
      'alpaca', coalesce(t.alpaca_fallback_24h, 0)
    ),
    'window_1h', jsonb_build_object(
      'polygon', coalesce(th.polygon_1h, 0),
      'finnhub', coalesce(th.finnhub_1h, 0),
      'yahoo', coalesce(th.yahoo_1h, 0),
      'alpaca', coalesce(th.alpaca_1h, 0),
      'failed', coalesce(th.failed_1h, 0)
    ),
    'last_success_at', jsonb_build_object(
      'polygon', ls.polygon_last,
      'finnhub', ls.finnhub_last,
      'yahoo', ls.yahoo_last,
      'alpaca', ls.alpaca_last
    ),
    'generated_at', now()
  )
  INTO result
  FROM totals t
  CROSS JOIN totals_hour th
  CROSS JOIN last_success ls;

  RETURN coalesce(result, jsonb_build_object('window_24h', '{}'::jsonb, 'generated_at', now()));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_source_attribution_24h() TO anon, authenticated;
