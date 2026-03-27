-- Phase 7: Broad-market scanner universe, cached scan results, and controlled promotion

CREATE TABLE IF NOT EXISTS public.scanner_universe_runs (
  id bigserial PRIMARY KEY,
  run_at timestamptz NOT NULL DEFAULT now(),
  as_of_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  run_label text,
  total_symbols bigint NOT NULL DEFAULT 0,
  eligible_symbols bigint NOT NULL DEFAULT 0,
  blocked_symbols bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.scanner_universe_snapshot (
  run_id bigint NOT NULL REFERENCES public.scanner_universe_runs(id) ON DELETE CASCADE,
  symbol text NOT NULL REFERENCES public.symbols(symbol) ON DELETE CASCADE,
  support_level text,
  canonical_sector text,
  canonical_industry text,
  classification_status text,
  classification_confidence_level text,
  history_bars integer NOT NULL DEFAULT 0,
  latest_price_date date,
  latest_indicator_date date,
  indicator_ready boolean NOT NULL DEFAULT false,
  alignment_eligible boolean,
  is_scanner_eligible boolean NOT NULL DEFAULT false,
  exclusion_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_scanner_universe_snapshot_symbol
  ON public.scanner_universe_snapshot (symbol, run_id DESC);

CREATE INDEX IF NOT EXISTS idx_scanner_universe_snapshot_eligible
  ON public.scanner_universe_snapshot (run_id, is_scanner_eligible, symbol);

CREATE TABLE IF NOT EXISTS public.market_scan_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  scan_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  run_label text,
  universe_run_id bigint REFERENCES public.scanner_universe_runs(id) ON DELETE SET NULL,
  symbols_targeted bigint NOT NULL DEFAULT 0,
  symbols_scanned bigint NOT NULL DEFAULT 0,
  symbols_failed bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  failure_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT market_scan_runs_status_valid CHECK (status IN ('running', 'completed', 'partial', 'failed'))
);

CREATE TABLE IF NOT EXISTS public.market_scan_results (
  id bigserial PRIMARY KEY,
  run_id bigint NOT NULL REFERENCES public.market_scan_runs(id) ON DELETE CASCADE,
  symbol text NOT NULL REFERENCES public.symbols(symbol) ON DELETE CASCADE,
  scan_date date NOT NULL,
  scan_timestamp timestamptz NOT NULL DEFAULT now(),
  support_level text,
  pattern text,
  recommendation text,
  blockers text[] NOT NULL DEFAULT ARRAY[]::text[],
  score integer,
  trend_state text,
  sector text,
  industry text,
  alignment_status text,
  alignment_reason text,
  confidence_level text,
  promotion_status text NOT NULL DEFAULT 'broader_candidate',
  approved_for_live_scanner boolean NOT NULL DEFAULT false,
  review_needed boolean NOT NULL DEFAULT false,
  blocked_low_quality boolean NOT NULL DEFAULT false,
  is_tier1_default boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_scan_results_promotion_valid CHECK (
    promotion_status IN ('approved_for_live_scanner', 'review_needed', 'blocked_low_quality', 'tier1_default', 'broader_candidate')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_scan_results_run_symbol
  ON public.market_scan_results (run_id, symbol);

CREATE INDEX IF NOT EXISTS idx_market_scan_results_symbol_date
  ON public.market_scan_results (symbol, scan_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_scan_results_promotion
  ON public.market_scan_results (promotion_status, scan_date DESC, score DESC);

ALTER TABLE public.scanner_universe_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scanner_universe_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_scan_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_scan_results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'scanner_universe_runs' AND policyname = 'Anyone can read scanner universe runs'
  ) THEN
    CREATE POLICY "Anyone can read scanner universe runs" ON public.scanner_universe_runs
      FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'scanner_universe_snapshot' AND policyname = 'Anyone can read scanner universe snapshot'
  ) THEN
    CREATE POLICY "Anyone can read scanner universe snapshot" ON public.scanner_universe_snapshot
      FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'market_scan_runs' AND policyname = 'Anyone can read market scan runs'
  ) THEN
    CREATE POLICY "Anyone can read market scan runs" ON public.market_scan_runs
      FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'market_scan_results' AND policyname = 'Anyone can read market scan results'
  ) THEN
    CREATE POLICY "Anyone can read market scan results" ON public.market_scan_results
      FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'scanner_universe_runs' AND policyname = 'Service role can manage scanner universe runs'
  ) THEN
    CREATE POLICY "Service role can manage scanner universe runs" ON public.scanner_universe_runs
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'scanner_universe_snapshot' AND policyname = 'Service role can manage scanner universe snapshot'
  ) THEN
    CREATE POLICY "Service role can manage scanner universe snapshot" ON public.scanner_universe_snapshot
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'market_scan_runs' AND policyname = 'Service role can manage market scan runs'
  ) THEN
    CREATE POLICY "Service role can manage market scan runs" ON public.market_scan_runs
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'market_scan_results' AND policyname = 'Service role can manage market scan results'
  ) THEN
    CREATE POLICY "Service role can manage market scan results" ON public.market_scan_results
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_scanner_universe_snapshot(
  p_as_of_date date DEFAULT (now() AT TIME ZONE 'utc')::date,
  p_run_label text DEFAULT 'scheduled'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_run_id bigint;
BEGIN
  INSERT INTO public.scanner_universe_runs (as_of_date, run_label)
  VALUES (p_as_of_date, p_run_label)
  RETURNING id INTO v_run_id;

  WITH price_coverage AS (
    SELECT
      dp.symbol,
      COUNT(*)::integer AS history_bars,
      MAX(dp.date) AS latest_price_date
    FROM public.daily_prices dp
    GROUP BY dp.symbol
  ),
  latest_indicators AS (
    SELECT DISTINCT ON (wi.symbol)
      wi.symbol,
      wi.calc_date,
      wi.ma50,
      wi.ma150,
      wi.mansfield_rs,
      wi.volume_ratio,
      wi.wsp_score,
      wi.wsp_pattern,
      wi.pct_change_1d
    FROM public.wsp_indicators wi
    ORDER BY wi.symbol, wi.calc_date DESC
  ),
  symbol_base AS (
    SELECT
      s.symbol,
      s.support_level,
      COALESCE(NULLIF(s.canonical_sector, ''), NULLIF(s.sector, ''), 'Unknown') AS canonical_sector,
      COALESCE(NULLIF(s.canonical_industry, ''), NULLIF(s.industry, ''), 'Unknown') AS canonical_industry,
      COALESCE(s.classification_status, 'unresolved') AS classification_status,
      COALESCE(s.classification_confidence_level, 'low') AS classification_confidence_level,
      COALESCE(pc.history_bars, 0) AS history_bars,
      pc.latest_price_date,
      li.calc_date AS latest_indicator_date,
      (
        li.calc_date IS NOT NULL
        AND li.ma50 IS NOT NULL
        AND li.ma150 IS NOT NULL
        AND li.mansfield_rs IS NOT NULL
        AND li.volume_ratio IS NOT NULL
      ) AS indicator_ready,
      COALESCE(sia.alignment_eligible, false) AS alignment_eligible,
      s.is_active,
      COALESCE(s.eligible_for_backfill, false) AS eligible_for_backfill,
      COALESCE(s.eligible_for_full_wsp, false) AS eligible_for_full_wsp,
      COALESCE(s.is_common_stock, false) AS is_common_stock,
      COALESCE(s.instrument_type, '') AS instrument_type,
      COALESCE(s.is_etf, false) AS is_etf,
      COALESCE(s.is_adr, false) AS is_adr,
      COALESCE(s.exchange, '') AS exchange
    FROM public.symbols s
    LEFT JOIN price_coverage pc ON pc.symbol = s.symbol
    LEFT JOIN latest_indicators li ON li.symbol = s.symbol
    LEFT JOIN public.symbol_industry_alignment_active sia ON sia.symbol = s.symbol
    WHERE s.is_active = true
  )
  INSERT INTO public.scanner_universe_snapshot (
    run_id,
    symbol,
    support_level,
    canonical_sector,
    canonical_industry,
    classification_status,
    classification_confidence_level,
    history_bars,
    latest_price_date,
    latest_indicator_date,
    indicator_ready,
    alignment_eligible,
    is_scanner_eligible,
    exclusion_reasons
  )
  SELECT
    v_run_id,
    sb.symbol,
    sb.support_level,
    sb.canonical_sector,
    sb.canonical_industry,
    sb.classification_status,
    sb.classification_confidence_level,
    sb.history_bars,
    sb.latest_price_date,
    sb.latest_indicator_date,
    sb.indicator_ready,
    sb.alignment_eligible,
    (
      sb.support_level IN ('full_wsp_equity', 'limited_equity')
      AND sb.eligible_for_backfill
      AND sb.is_common_stock
      AND sb.instrument_type = 'CS'
      AND sb.is_etf = false
      AND sb.is_adr = false
      AND sb.exchange IN ('NYSE', 'NASDAQ', 'AMEX', 'ARCA')
      AND sb.classification_status IN ('canonicalized', 'manually_reviewed')
      AND sb.classification_confidence_level IN ('high', 'medium')
      AND sb.canonical_sector <> 'Unknown'
      AND sb.canonical_industry <> 'Unknown'
      AND sb.history_bars >= 260
      AND sb.indicator_ready
      AND sb.alignment_eligible
    ) AS is_scanner_eligible,
    array_remove(ARRAY[
      CASE WHEN sb.support_level NOT IN ('full_wsp_equity', 'limited_equity') THEN 'unsupported_support_level' END,
      CASE WHEN sb.eligible_for_backfill = false THEN 'not_eligible_for_backfill' END,
      CASE WHEN sb.is_common_stock = false OR sb.instrument_type <> 'CS' THEN 'not_common_stock' END,
      CASE WHEN sb.is_etf = true THEN 'etf_not_supported' END,
      CASE WHEN sb.is_adr = true THEN 'adr_not_supported' END,
      CASE WHEN sb.exchange NOT IN ('NYSE', 'NASDAQ', 'AMEX', 'ARCA') THEN 'unsupported_exchange' END,
      CASE WHEN sb.classification_status NOT IN ('canonicalized', 'manually_reviewed') THEN 'classification_not_ready' END,
      CASE WHEN sb.classification_confidence_level NOT IN ('high', 'medium') THEN 'classification_low_confidence' END,
      CASE WHEN sb.canonical_sector = 'Unknown' OR sb.canonical_industry = 'Unknown' THEN 'missing_sector_industry' END,
      CASE WHEN sb.history_bars < 260 THEN 'insufficient_price_history' END,
      CASE WHEN sb.indicator_ready = false THEN 'indicator_not_ready' END,
      CASE WHEN sb.alignment_eligible = false THEN 'alignment_not_ready' END
    ], NULL)::text[] AS exclusion_reasons
  FROM symbol_base sb;

  UPDATE public.scanner_universe_runs r
  SET
    total_symbols = counts.total_symbols,
    eligible_symbols = counts.eligible_symbols,
    blocked_symbols = counts.total_symbols - counts.eligible_symbols,
    metadata = jsonb_build_object(
      'as_of_date', p_as_of_date,
      'rule_version', 'phase7_v1'
    )
  FROM (
    SELECT
      COUNT(*)::bigint AS total_symbols,
      COUNT(*) FILTER (WHERE is_scanner_eligible)::bigint AS eligible_symbols
    FROM public.scanner_universe_snapshot
    WHERE run_id = v_run_id
  ) counts
  WHERE r.id = v_run_id;

  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_broad_market_scan(
  p_as_of_date date DEFAULT (now() AT TIME ZONE 'utc')::date,
  p_run_label text DEFAULT 'scheduled'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_universe_run_id bigint;
  v_scan_run_id bigint;
BEGIN
  v_universe_run_id := public.refresh_scanner_universe_snapshot(p_as_of_date, CONCAT('universe_', p_run_label));

  INSERT INTO public.market_scan_runs (scan_date, run_label, universe_run_id, status)
  VALUES (p_as_of_date, p_run_label, v_universe_run_id, 'running')
  RETURNING id INTO v_scan_run_id;

  WITH latest_wsp AS (
    SELECT DISTINCT ON (wi.symbol)
      wi.symbol,
      wi.calc_date,
      wi.wsp_pattern,
      wi.wsp_score,
      wi.ma50,
      wi.ma150,
      wi.ma50_slope,
      wi.above_ma50,
      wi.above_ma150,
      wi.volume_ratio,
      wi.mansfield_rs,
      wi.pct_change_1d
    FROM public.wsp_indicators wi
    ORDER BY wi.symbol, wi.calc_date DESC
  ),
  universe AS (
    SELECT *
    FROM public.scanner_universe_snapshot
    WHERE run_id = v_universe_run_id
      AND is_scanner_eligible = true
  ),
  scan_payload AS (
    SELECT
      u.symbol,
      u.support_level,
      u.canonical_sector,
      u.canonical_industry,
      u.classification_confidence_level,
      u.classification_status,
      u.alignment_eligible,
      l.wsp_pattern,
      l.wsp_score,
      l.ma50,
      l.ma150,
      l.ma50_slope,
      l.above_ma50,
      l.above_ma150,
      l.volume_ratio,
      l.mansfield_rs,
      l.pct_change_1d,
      COALESCE(sia.alignment_status, 'unresolved') AS alignment_status,
      COALESCE(sia.alignment_reason, 'alignment_unresolved') AS alignment_reason,
      COALESCE(s.eligible_for_full_wsp, false) AS eligible_for_full_wsp
    FROM universe u
    JOIN latest_wsp l ON l.symbol = u.symbol
    JOIN public.symbols s ON s.symbol = u.symbol
    LEFT JOIN public.symbol_industry_alignment_active sia ON sia.symbol = u.symbol
  )
  INSERT INTO public.market_scan_results (
    run_id,
    symbol,
    scan_date,
    scan_timestamp,
    support_level,
    pattern,
    recommendation,
    blockers,
    score,
    trend_state,
    sector,
    industry,
    alignment_status,
    alignment_reason,
    confidence_level,
    promotion_status,
    approved_for_live_scanner,
    review_needed,
    blocked_low_quality,
    is_tier1_default,
    payload
  )
  SELECT
    v_scan_run_id,
    p.symbol,
    p_as_of_date,
    now(),
    p.support_level,
    p.wsp_pattern,
    CASE
      WHEN p.wsp_pattern = 'CLIMBING' AND COALESCE(p.wsp_score, 0) >= 8 THEN 'KÖP'
      WHEN p.wsp_pattern IN ('CLIMBING', 'BASE') THEN 'BEVAKA'
      WHEN p.wsp_pattern = 'TIRED' THEN 'SÄLJ'
      ELSE 'UNDVIK'
    END AS recommendation,
    array_remove(ARRAY[
      CASE WHEN COALESCE(p.above_ma50, false) = false THEN 'below_ma50' END,
      CASE WHEN COALESCE(p.above_ma150, false) = false THEN 'below_ma150' END,
      CASE WHEN COALESCE(p.volume_ratio, 0) < 1.1 THEN 'volume_not_confirmed' END,
      CASE WHEN COALESCE(p.mansfield_rs, 0) <= 0 THEN 'mansfield_not_valid' END,
      CASE WHEN p.alignment_status = 'blocked_low_quality_classification' THEN 'blocked_low_quality_classification' END
    ], NULL)::text[] AS blockers,
    COALESCE(p.wsp_score, 0) AS score,
    CASE
      WHEN COALESCE(p.above_ma50, false) AND COALESCE(p.above_ma150, false) AND p.ma50_slope = 'up' THEN 'bullish'
      WHEN COALESCE(p.above_ma150, false) = false THEN 'bearish'
      ELSE 'neutral'
    END AS trend_state,
    p.canonical_sector,
    p.canonical_industry,
    p.alignment_status,
    p.alignment_reason,
    p.classification_confidence_level,
    CASE
      WHEN p.support_level = 'full_wsp_equity' AND p.eligible_for_full_wsp THEN 'tier1_default'
      WHEN p.classification_confidence_level = 'low' OR p.alignment_status = 'blocked_low_quality_classification' THEN 'blocked_low_quality'
      WHEN p.wsp_pattern = 'CLIMBING' AND COALESCE(p.wsp_score, 0) >= 8 AND p.alignment_status NOT IN ('blocked_low_quality_classification', 'unresolved') THEN 'approved_for_live_scanner'
      WHEN p.wsp_pattern = 'CLIMBING' AND COALESCE(p.wsp_score, 0) >= 6 THEN 'review_needed'
      ELSE 'broader_candidate'
    END AS promotion_status,
    CASE
      WHEN p.support_level = 'full_wsp_equity' AND p.eligible_for_full_wsp THEN true
      WHEN p.wsp_pattern = 'CLIMBING' AND COALESCE(p.wsp_score, 0) >= 8 AND p.classification_confidence_level IN ('high', 'medium') AND p.alignment_status NOT IN ('blocked_low_quality_classification', 'unresolved') THEN true
      ELSE false
    END AS approved_for_live_scanner,
    CASE
      WHEN p.wsp_pattern = 'CLIMBING' AND COALESCE(p.wsp_score, 0) BETWEEN 6 AND 7 THEN true
      ELSE false
    END AS review_needed,
    CASE
      WHEN p.classification_confidence_level = 'low' OR p.alignment_status = 'blocked_low_quality_classification' THEN true
      ELSE false
    END AS blocked_low_quality,
    CASE WHEN p.support_level = 'full_wsp_equity' AND p.eligible_for_full_wsp THEN true ELSE false END AS is_tier1_default,
    jsonb_build_object(
      'wsp_pattern', p.wsp_pattern,
      'wsp_score', COALESCE(p.wsp_score, 0),
      'ma50', p.ma50,
      'ma150', p.ma150,
      'ma50_slope', p.ma50_slope,
      'volume_ratio', p.volume_ratio,
      'mansfield_rs', p.mansfield_rs,
      'pct_change_1d', p.pct_change_1d
    ) AS payload
  FROM scan_payload p;

  UPDATE public.market_scan_runs r
  SET
    completed_at = now(),
    symbols_targeted = (SELECT COUNT(*) FROM public.scanner_universe_snapshot WHERE run_id = v_universe_run_id AND is_scanner_eligible = true),
    symbols_scanned = (SELECT COUNT(*) FROM public.market_scan_results WHERE run_id = v_scan_run_id),
    symbols_failed = GREATEST(
      (SELECT COUNT(*) FROM public.scanner_universe_snapshot WHERE run_id = v_universe_run_id AND is_scanner_eligible = true)
      - (SELECT COUNT(*) FROM public.market_scan_results WHERE run_id = v_scan_run_id),
      0
    ),
    status = CASE
      WHEN (SELECT COUNT(*) FROM public.market_scan_results WHERE run_id = v_scan_run_id) = 0 THEN 'failed'
      WHEN (SELECT COUNT(*) FROM public.market_scan_results WHERE run_id = v_scan_run_id)
         < (SELECT COUNT(*) FROM public.scanner_universe_snapshot WHERE run_id = v_universe_run_id AND is_scanner_eligible = true)
        THEN 'partial'
      ELSE 'completed'
    END,
    metadata = jsonb_build_object('universe_run_id', v_universe_run_id, 'rule_version', 'phase7_v1')
  WHERE r.id = v_scan_run_id;

  RETURN v_scan_run_id;
END;
$$;

CREATE OR REPLACE VIEW public.market_scan_results_latest AS
SELECT DISTINCT ON (r.symbol)
  r.symbol,
  r.scan_date,
  r.scan_timestamp,
  r.support_level,
  r.pattern,
  r.recommendation,
  r.blockers,
  r.score,
  r.trend_state,
  r.sector,
  r.industry,
  r.alignment_status,
  r.alignment_reason,
  r.confidence_level,
  r.promotion_status,
  r.approved_for_live_scanner,
  r.review_needed,
  r.blocked_low_quality,
  r.is_tier1_default,
  r.payload,
  r.run_id
FROM public.market_scan_results r
ORDER BY r.symbol, r.scan_timestamp DESC, r.id DESC;

CREATE OR REPLACE VIEW public.scanner_operator_summary AS
WITH latest_universe_run AS (
  SELECT id
  FROM public.scanner_universe_runs
  ORDER BY run_at DESC, id DESC
  LIMIT 1
),
latest_scan_run AS (
  SELECT id
  FROM public.market_scan_runs
  ORDER BY started_at DESC, id DESC
  LIMIT 1
),
exclusion_agg AS (
  SELECT reason, COUNT(*)::bigint AS reason_count
  FROM latest_universe_run lur
  JOIN public.scanner_universe_snapshot sus ON sus.run_id = lur.id
  CROSS JOIN LATERAL unnest(COALESCE(sus.exclusion_reasons, ARRAY[]::text[])) AS reason
  GROUP BY reason
),
promotion_agg AS (
  SELECT
    COUNT(*)::bigint AS generated_results,
    COUNT(*) FILTER (WHERE promotion_status = 'approved_for_live_scanner')::bigint AS approved_for_live_scanner,
    COUNT(*) FILTER (WHERE promotion_status = 'review_needed')::bigint AS review_needed,
    COUNT(*) FILTER (WHERE promotion_status = 'blocked_low_quality')::bigint AS blocked_low_quality,
    COUNT(*) FILTER (WHERE promotion_status = 'tier1_default')::bigint AS tier1_default,
    COUNT(*) FILTER (WHERE promotion_status = 'broader_candidate')::bigint AS broader_candidate
  FROM latest_scan_run lsr
  JOIN public.market_scan_results msr ON msr.run_id = lsr.id
)
SELECT
  lur.id AS universe_run_id,
  lsr.id AS scan_run_id,
  COALESCE((SELECT COUNT(*) FROM public.scanner_universe_snapshot WHERE run_id = lur.id), 0)::bigint AS universe_total_symbols,
  COALESCE((SELECT COUNT(*) FROM public.scanner_universe_snapshot WHERE run_id = lur.id AND is_scanner_eligible = true), 0)::bigint AS scanner_eligible_symbols,
  COALESCE((SELECT COUNT(*) FROM public.scanner_universe_snapshot WHERE run_id = lur.id AND is_scanner_eligible = false), 0)::bigint AS scanner_blocked_symbols,
  COALESCE(pa.generated_results, 0) AS generated_scan_results,
  COALESCE(pa.approved_for_live_scanner, 0) AS approved_for_live_scanner,
  COALESCE(pa.review_needed, 0) AS review_needed,
  COALESCE(pa.blocked_low_quality, 0) AS blocked_low_quality,
  COALESCE(pa.tier1_default, 0) AS tier1_default,
  COALESCE(pa.broader_candidate, 0) AS broader_candidate,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', ea.reason, 'count', ea.reason_count) ORDER BY ea.reason_count DESC)
    FROM (SELECT reason, reason_count FROM exclusion_agg ORDER BY reason_count DESC LIMIT 8) ea), '[]'::jsonb) AS top_exclusion_reasons
FROM latest_universe_run lur
CROSS JOIN latest_scan_run lsr
LEFT JOIN promotion_agg pa ON true;

CREATE OR REPLACE FUNCTION public.scanner_operator_snapshot()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_build_object(
        'summary', to_jsonb(sos),
        'sample_candidates', COALESCE((
          SELECT jsonb_agg(to_jsonb(x))
          FROM (
            SELECT symbol, sector, industry, pattern, recommendation, score, trend_state, promotion_status, blockers
            FROM public.market_scan_results_latest
            ORDER BY
              CASE promotion_status
                WHEN 'approved_for_live_scanner' THEN 0
                WHEN 'tier1_default' THEN 1
                WHEN 'review_needed' THEN 2
                ELSE 3
              END,
              score DESC,
              symbol ASC
            LIMIT 25
          ) x
        ), '[]'::jsonb)
      )
      FROM public.scanner_operator_summary sos
      LIMIT 1
    ),
    jsonb_build_object('summary', NULL, 'sample_candidates', '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.refresh_scanner_universe_snapshot(date, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_broad_market_scan(date, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.scanner_operator_snapshot() TO anon, authenticated, service_role;
