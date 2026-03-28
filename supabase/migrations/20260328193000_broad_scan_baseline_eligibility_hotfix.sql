-- Hotfix: make broad market scanner production-usable with baseline eligibility + metadata modifiers

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
      AND sb.is_common_stock
      AND sb.instrument_type = 'CS'
      AND sb.is_etf = false
      AND sb.is_adr = false
      AND sb.exchange IN ('NYSE', 'NASDAQ', 'AMEX', 'ARCA')
      AND sb.history_bars >= 260
      AND sb.indicator_ready
    ) AS is_scanner_eligible,
    array_remove(ARRAY[
      CASE WHEN sb.support_level NOT IN ('full_wsp_equity', 'limited_equity') THEN 'unsupported_support_level' END,
      CASE WHEN sb.eligible_for_backfill = false THEN 'not_eligible_for_backfill' END,
      CASE WHEN sb.is_common_stock = false OR sb.instrument_type <> 'CS' THEN 'not_common_stock' END,
      CASE WHEN sb.is_etf = true THEN 'etf_not_supported' END,
      CASE WHEN sb.is_adr = true THEN 'adr_not_supported' END,
      CASE WHEN sb.exchange NOT IN ('NYSE', 'NASDAQ', 'AMEX', 'ARCA') THEN 'unsupported_exchange' END,
      CASE WHEN sb.history_bars < 260 THEN 'insufficient_price_history' END,
      CASE WHEN sb.indicator_ready = false THEN 'indicator_not_ready' END,
      CASE WHEN sb.classification_status NOT IN ('canonicalized', 'manually_reviewed') THEN 'classification_not_ready' END,
      CASE WHEN sb.classification_confidence_level NOT IN ('high', 'medium') THEN 'classification_low_confidence' END,
      CASE WHEN sb.canonical_sector = 'Unknown' OR sb.canonical_industry = 'Unknown' THEN 'missing_sector_industry' END,
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
      'rule_version', 'phase7_v2_baseline_hotfix',
      'stage_counts', jsonb_build_object(
        'snapshot_symbols_considered', counts.total_symbols,
        'price_history_pass', counts.price_history_pass,
        'indicator_gate_pass', counts.indicator_gate_pass,
        'metadata_or_alignment_blocked_only', counts.metadata_or_alignment_blocked_only,
        'baseline_eligible_symbols', counts.eligible_symbols
      )
    )
  FROM (
    SELECT
      COUNT(*)::bigint AS total_symbols,
      COUNT(*) FILTER (
        WHERE history_bars >= 260
      )::bigint AS price_history_pass,
      COUNT(*) FILTER (
        WHERE history_bars >= 260 AND indicator_ready
      )::bigint AS indicator_gate_pass,
      COUNT(*) FILTER (
        WHERE history_bars >= 260
          AND indicator_ready
          AND is_scanner_eligible
          AND (
            classification_status NOT IN ('canonicalized', 'manually_reviewed')
            OR classification_confidence_level NOT IN ('high', 'medium')
            OR canonical_sector = 'Unknown'
            OR canonical_industry = 'Unknown'
            OR alignment_eligible = false
          )
      )::bigint AS metadata_or_alignment_blocked_only,
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
  v_snapshot_considered bigint := 0;
  v_price_history_pass bigint := 0;
  v_indicator_gate_pass bigint := 0;
  v_metadata_blocked_only bigint := 0;
  v_baseline_targeted bigint := 0;
  v_inserted_count bigint := 0;
BEGIN
  v_universe_run_id := public.refresh_scanner_universe_snapshot(p_as_of_date, CONCAT('universe_', p_run_label));

  INSERT INTO public.market_scan_runs (scan_date, run_label, universe_run_id, status)
  VALUES (p_as_of_date, p_run_label, v_universe_run_id, 'running')
  RETURNING id INTO v_scan_run_id;

  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE sus.history_bars >= 260)::bigint,
    COUNT(*) FILTER (WHERE sus.history_bars >= 260 AND sus.indicator_ready)::bigint,
    COUNT(*) FILTER (
      WHERE sus.history_bars >= 260
        AND sus.indicator_ready
        AND sus.support_level IN ('full_wsp_equity', 'limited_equity')
        AND sus.is_scanner_eligible
        AND (
          sus.classification_status NOT IN ('canonicalized', 'manually_reviewed')
          OR sus.classification_confidence_level NOT IN ('high', 'medium')
          OR sus.canonical_sector = 'Unknown'
          OR sus.canonical_industry = 'Unknown'
          OR COALESCE(sus.alignment_eligible, false) = false
        )
    )::bigint,
    COUNT(*) FILTER (WHERE sus.is_scanner_eligible)::bigint
  INTO
    v_snapshot_considered,
    v_price_history_pass,
    v_indicator_gate_pass,
    v_metadata_blocked_only,
    v_baseline_targeted
  FROM public.scanner_universe_snapshot sus
  WHERE sus.run_id = v_universe_run_id;

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
      CASE WHEN p.classification_confidence_level NOT IN ('high', 'medium') THEN 'classification_low_confidence' END,
      CASE WHEN p.canonical_sector = 'Unknown' OR p.canonical_industry = 'Unknown' THEN 'missing_sector_industry' END,
      CASE WHEN COALESCE(p.alignment_eligible, false) = false THEN 'alignment_not_ready' END,
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
      WHEN p.classification_confidence_level = 'low'
        OR p.canonical_sector = 'Unknown'
        OR p.canonical_industry = 'Unknown'
        OR COALESCE(p.alignment_eligible, false) = false
        OR p.alignment_status = 'blocked_low_quality_classification'
      THEN 'blocked_low_quality'
      WHEN p.wsp_pattern = 'CLIMBING'
        AND COALESCE(p.wsp_score, 0) >= 8
        AND p.classification_confidence_level IN ('high', 'medium')
        AND p.canonical_sector <> 'Unknown'
        AND p.canonical_industry <> 'Unknown'
        AND COALESCE(p.alignment_eligible, false) = true
        AND p.alignment_status NOT IN ('blocked_low_quality_classification', 'unresolved')
      THEN 'approved_for_live_scanner'
      WHEN p.wsp_pattern = 'CLIMBING' AND COALESCE(p.wsp_score, 0) >= 6 THEN 'review_needed'
      ELSE 'broader_candidate'
    END AS promotion_status,
    CASE
      WHEN p.support_level = 'full_wsp_equity' AND p.eligible_for_full_wsp THEN true
      WHEN p.wsp_pattern = 'CLIMBING'
        AND COALESCE(p.wsp_score, 0) >= 8
        AND p.classification_confidence_level IN ('high', 'medium')
        AND p.canonical_sector <> 'Unknown'
        AND p.canonical_industry <> 'Unknown'
        AND COALESCE(p.alignment_eligible, false) = true
        AND p.alignment_status NOT IN ('blocked_low_quality_classification', 'unresolved')
      THEN true
      ELSE false
    END AS approved_for_live_scanner,
    CASE
      WHEN p.wsp_pattern = 'CLIMBING' AND COALESCE(p.wsp_score, 0) BETWEEN 6 AND 7 THEN true
      ELSE false
    END AS review_needed,
    CASE
      WHEN p.classification_confidence_level = 'low'
        OR p.canonical_sector = 'Unknown'
        OR p.canonical_industry = 'Unknown'
        OR COALESCE(p.alignment_eligible, false) = false
        OR p.alignment_status = 'blocked_low_quality_classification'
      THEN true
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
      'pct_change_1d', p.pct_change_1d,
      'metadata_quality', jsonb_build_object(
        'classification_status', p.classification_status,
        'classification_confidence_level', p.classification_confidence_level,
        'alignment_eligible', COALESCE(p.alignment_eligible, false),
        'has_canonical_sector_industry', (p.canonical_sector <> 'Unknown' AND p.canonical_industry <> 'Unknown')
      )
    ) AS payload
  FROM scan_payload p;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  UPDATE public.market_scan_runs r
  SET
    completed_at = now(),
    symbols_targeted = v_baseline_targeted,
    symbols_scanned = v_inserted_count,
    symbols_failed = GREATEST(v_baseline_targeted - v_inserted_count, 0),
    status = CASE
      WHEN v_inserted_count = 0 THEN 'failed'
      WHEN v_inserted_count < v_baseline_targeted THEN 'partial'
      ELSE 'completed'
    END,
    metadata = jsonb_build_object(
      'universe_run_id', v_universe_run_id,
      'rule_version', 'phase7_v2_baseline_hotfix',
      'stage_counts', jsonb_build_object(
        'snapshot_symbols_considered', v_snapshot_considered,
        'price_history_pass', v_price_history_pass,
        'indicator_gate_pass', v_indicator_gate_pass,
        'metadata_or_alignment_blocked_only', v_metadata_blocked_only,
        'baseline_targeted', v_baseline_targeted,
        'inserted_rows', v_inserted_count
      )
    )
  WHERE r.id = v_scan_run_id;

  RETURN v_scan_run_id;
END;
$$;
