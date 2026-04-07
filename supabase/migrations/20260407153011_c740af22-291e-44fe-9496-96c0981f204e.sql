
-- 1. Add pct_change_1d to daily_prices
ALTER TABLE public.daily_prices ADD COLUMN IF NOT EXISTS pct_change_1d numeric;

-- 2. Create get_equity_dashboard_rows RPC
-- Returns benchmark symbols (SPY, QQQ) with latest close and daily change
CREATE OR REPLACE FUNCTION public.get_equity_dashboard_rows()
RETURNS TABLE(symbol text, close numeric, daily_pct numeric, above_ma50 boolean, ma50_slope text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (wi.symbol)
    wi.symbol,
    wi.close,
    wi.pct_change_1d AS daily_pct,
    wi.above_ma50,
    wi.ma50_slope
  FROM public.wsp_indicators wi
  WHERE wi.symbol IN ('SPY', 'QQQ', 'DIA', 'IWM')
  ORDER BY wi.symbol, wi.calc_date DESC;
$$;

-- 3. Create get_equity_screener_rows RPC
-- Returns paginated screener results from latest scan run
CREATE OR REPLACE FUNCTION public.get_equity_screener_rows(
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 5000
)
RETURNS TABLE(
  symbol text,
  sector text,
  industry text,
  pattern_state text,
  recommendation text,
  wsp_score integer,
  payload jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    msr.symbol,
    msr.sector,
    msr.industry,
    msr.pattern AS pattern_state,
    msr.recommendation,
    msr.score AS wsp_score,
    msr.payload
  FROM public.market_scan_results_latest msr
  WHERE msr.symbol IS NOT NULL
  ORDER BY msr.score DESC NULLS LAST, msr.symbol ASC
  LIMIT p_page_size
  OFFSET p_page * p_page_size;
$$;

-- 4. Update materialize_wsp_indicators_from_prices to use previous trading day
CREATE OR REPLACE FUNCTION public.materialize_wsp_indicators_from_prices(
  p_symbols text[] DEFAULT NULL::text[],
  p_as_of_date date DEFAULT ((now() AT TIME ZONE 'utc'::text))::date,
  p_min_bars integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_candidates bigint := 0;
  v_computed_rows bigint := 0;
  v_existing_rows bigint := 0;
  v_written_rows bigint := 0;
BEGIN
  WITH target_symbols AS (
    SELECT s.symbol
    FROM public.symbols s
    WHERE s.is_active = true
      AND (p_symbols IS NULL OR s.symbol = ANY (p_symbols))
  ),
  source_prices AS (
    SELECT
      dp.symbol,
      dp.date,
      dp.close::numeric AS close,
      dp.high::numeric AS high,
      dp.low::numeric AS low,
      dp.volume::bigint AS volume,
      avg(dp.close::numeric) OVER w50 AS ma50,
      avg(dp.close::numeric) OVER w150 AS ma150,
      -- Use LAG to get previous trading day's close (not just previous row)
      lag(dp.close::numeric) OVER wsym AS prev_close,
      avg(dp.volume::numeric) OVER (
        PARTITION BY dp.symbol ORDER BY dp.date
        ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING
      ) AS avg_volume_5d,
      max(dp.close::numeric) OVER (
        PARTITION BY dp.symbol ORDER BY dp.date
        ROWS BETWEEN 251 PRECEDING AND CURRENT ROW
      ) AS high_52w,
      avg(dp.close::numeric) OVER (
        PARTITION BY dp.symbol ORDER BY dp.date
        ROWS BETWEEN 199 PRECEDING AND CURRENT ROW
      ) AS sma200_stock,
      count(*) OVER (
        PARTITION BY dp.symbol ORDER BY dp.date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )::integer AS bars_to_date
    FROM public.daily_prices dp
    JOIN target_symbols ts ON ts.symbol = dp.symbol
    WHERE dp.date <= p_as_of_date
    WINDOW
      wsym AS (PARTITION BY dp.symbol ORDER BY dp.date),
      w50  AS (PARTITION BY dp.symbol ORDER BY dp.date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW),
      w150 AS (PARTITION BY dp.symbol ORDER BY dp.date ROWS BETWEEN 149 PRECEDING AND CURRENT ROW)
  ),
  priced_with_slope AS (
    SELECT
      sp.*,
      lag(sp.ma50, 5) OVER (PARTITION BY sp.symbol ORDER BY sp.date) AS ma50_5d_ago,
      row_number() OVER (PARTITION BY sp.symbol ORDER BY sp.date DESC) AS rn
    FROM source_prices sp
  ),
  spy_prices AS (
    SELECT
      dp.date,
      dp.close::numeric AS close,
      avg(dp.close::numeric) OVER (
        ORDER BY dp.date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW
      ) AS sma200_bench
    FROM public.daily_prices dp
    WHERE dp.symbol = 'SPY'
      AND dp.date <= p_as_of_date
  ),
  final_rows AS (
    SELECT
      pws.symbol,
      pws.date AS calc_date,
      pws.close,
      pws.ma50,
      pws.ma150,
      pws.prev_close,
      CASE
        WHEN pws.ma50_5d_ago IS NULL OR pws.ma50 IS NULL THEN 'flat'
        WHEN pws.ma50 > pws.ma50_5d_ago THEN 'rising'
        WHEN pws.ma50 < pws.ma50_5d_ago THEN 'falling'
        ELSE 'flat'
      END AS ma50_slope,
      (pws.close > pws.ma50) AS above_ma50,
      (pws.close > pws.ma150) AS above_ma150,
      pws.volume,
      round(COALESCE(pws.avg_volume_5d, 0))::bigint AS avg_volume_5d,
      CASE WHEN COALESCE(pws.avg_volume_5d, 0) > 0
        THEN round((pws.volume::numeric / pws.avg_volume_5d)::numeric, 2)
        ELSE NULL
      END AS volume_ratio,
      CASE
        WHEN pws.sma200_stock IS NOT NULL AND pws.sma200_stock > 0
             AND spy.sma200_bench IS NOT NULL AND spy.sma200_bench > 0
             AND spy.close > 0
          THEN round(
            (((pws.close / pws.sma200_stock) / (spy.close / spy.sma200_bench)) - 1) * 100,
            2
          )
        ELSE NULL
      END AS mansfield_rs,
      CASE WHEN pws.prev_close > 0
        THEN round(((pws.close / pws.prev_close) - 1) * 100, 2)
        ELSE NULL
      END AS pct_change_1d,
      CASE WHEN pws.high_52w > 0
        THEN round(((pws.close / pws.high_52w) - 1) * 100, 2)
        ELSE NULL
      END AS pct_from_52w_high
    FROM priced_with_slope pws
    LEFT JOIN spy_prices spy ON spy.date = pws.date
    WHERE pws.rn = 1
      AND pws.bars_to_date >= p_min_bars
      AND pws.ma50 IS NOT NULL
      AND pws.ma150 IS NOT NULL
      AND pws.prev_close IS NOT NULL
      AND pws.avg_volume_5d IS NOT NULL
      AND pws.sma200_stock IS NOT NULL
  ),
  scored_rows AS (
    SELECT
      fr.*,
      CASE
        WHEN fr.close > fr.ma50 AND fr.ma50 > fr.ma150
             AND COALESCE(fr.volume_ratio, 0) >= 1.5
             AND COALESCE(fr.mansfield_rs, 0) > 0
          THEN 'climbing'
        WHEN fr.close > fr.ma50 AND fr.close > fr.ma150
          THEN 'base_or_climbing'
        WHEN fr.close < fr.ma50 AND fr.close < fr.ma150
             AND fr.ma50_slope = 'falling'
          THEN 'downhill'
        WHEN fr.close > fr.ma150
          THEN 'base'
        ELSE 'tired'
      END AS wsp_pattern,
      (
        (CASE WHEN fr.close > fr.ma50 THEN 1 ELSE 0 END)
        + (CASE WHEN fr.close > fr.ma150 THEN 1 ELSE 0 END)
        + (CASE WHEN fr.ma50_slope = 'rising' THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(fr.volume_ratio, 0) >= 2.0 THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(fr.mansfield_rs, 0) > 0 THEN 1 ELSE 0 END)
        + 0 + 0 + 0 + 0
      )::integer AS wsp_score
  ),
  counted AS (
    SELECT COUNT(*)::bigint AS total_candidates FROM target_symbols
  ),
  existing AS (
    SELECT COUNT(*)::bigint AS existing_rows
    FROM scored_rows sr
    JOIN public.wsp_indicators wi ON wi.symbol = sr.symbol AND wi.calc_date = sr.calc_date
  ),
  upserted AS (
    INSERT INTO public.wsp_indicators (
      symbol, calc_date, close, ma50, ma150,
      ma50_slope, above_ma50, above_ma150,
      volume, avg_volume_5d, volume_ratio,
      wsp_pattern, wsp_score,
      pct_change_1d, pct_from_52w_high, mansfield_rs
    )
    SELECT
      sr.symbol, sr.calc_date, sr.close, sr.ma50, sr.ma150,
      sr.ma50_slope, sr.above_ma50, sr.above_ma150,
      sr.volume, sr.avg_volume_5d, sr.volume_ratio,
      sr.wsp_pattern, sr.wsp_score,
      sr.pct_change_1d, sr.pct_from_52w_high, sr.mansfield_rs
    FROM scored_rows sr
    ON CONFLICT (symbol, calc_date)
    DO UPDATE SET
      close = EXCLUDED.close,
      ma50 = EXCLUDED.ma50,
      ma150 = EXCLUDED.ma150,
      ma50_slope = EXCLUDED.ma50_slope,
      above_ma50 = EXCLUDED.above_ma50,
      above_ma150 = EXCLUDED.above_ma150,
      volume = EXCLUDED.volume,
      avg_volume_5d = EXCLUDED.avg_volume_5d,
      volume_ratio = EXCLUDED.volume_ratio,
      wsp_pattern = EXCLUDED.wsp_pattern,
      wsp_score = EXCLUDED.wsp_score,
      pct_change_1d = EXCLUDED.pct_change_1d,
      pct_from_52w_high = EXCLUDED.pct_from_52w_high,
      mansfield_rs = EXCLUDED.mansfield_rs,
      created_at = now()
    RETURNING 1
  )
  SELECT
    counted.total_candidates,
    (SELECT COUNT(*)::bigint FROM scored_rows),
    existing.existing_rows,
    (SELECT COUNT(*)::bigint FROM upserted)
  INTO v_total_candidates, v_computed_rows, v_existing_rows, v_written_rows
  FROM counted, existing;

  RETURN jsonb_build_object(
    'as_of_date', p_as_of_date,
    'min_bars', p_min_bars,
    'target_symbols', v_total_candidates,
    'computed_rows', v_computed_rows,
    'written_rows', v_written_rows,
    'inserted_rows', GREATEST(v_computed_rows - v_existing_rows, 0),
    'updated_rows', LEAST(v_existing_rows, v_written_rows),
    'skipped_rows', GREATEST(v_total_candidates - v_computed_rows, 0)
  );
END;
$function$;
