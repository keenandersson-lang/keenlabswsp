CREATE OR REPLACE FUNCTION public.materialize_wsp_indicators_from_prices(
  p_symbols text[] DEFAULT NULL,
  p_as_of_date date DEFAULT (timezone('utc', now()))::date,
  p_min_bars integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '900000'
AS $$
DECLARE
  v_total_candidates bigint := 0;
  v_computed_rows bigint := 0;
  v_written_rows bigint := 0;
BEGIN
  WITH target_symbols AS (
    SELECT s.symbol
    FROM public.symbols s
    WHERE s.is_active = true
      AND (p_symbols IS NULL OR s.symbol = ANY(p_symbols))
  ),
  source_prices AS (
    SELECT
      dp.symbol,
      dp.date,
      dp.close::numeric AS close,
      dp.volume::bigint AS volume,
      AVG(dp.close::numeric) OVER (
        PARTITION BY dp.symbol ORDER BY dp.date
        ROWS BETWEEN 49 PRECEDING AND CURRENT ROW
      ) AS ma50,
      CASE WHEN COUNT(*) OVER (
        PARTITION BY dp.symbol ORDER BY dp.date
        ROWS BETWEEN 149 PRECEDING AND CURRENT ROW
      ) >= 150 THEN
        AVG(dp.close::numeric) OVER (
          PARTITION BY dp.symbol ORDER BY dp.date
          ROWS BETWEEN 149 PRECEDING AND CURRENT ROW
        )
      ELSE NULL END AS ma150,
      CASE WHEN COUNT(*) OVER (
        PARTITION BY dp.symbol ORDER BY dp.date
        ROWS BETWEEN 199 PRECEDING AND CURRENT ROW
      ) >= 200 THEN
        AVG(dp.close::numeric) OVER (
          PARTITION BY dp.symbol ORDER BY dp.date
          ROWS BETWEEN 199 PRECEDING AND CURRENT ROW
        )
      ELSE NULL END AS sma200,
      LAG(dp.close::numeric) OVER (
        PARTITION BY dp.symbol ORDER BY dp.date
      ) AS prev_close,
      AVG(dp.volume::numeric) OVER (
        PARTITION BY dp.symbol ORDER BY dp.date
        ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING
      ) AS avg_volume_5d,
      MAX(dp.close::numeric) OVER (
        PARTITION BY dp.symbol ORDER BY dp.date
        ROWS BETWEEN 251 PRECEDING AND CURRENT ROW
      ) AS high_52w,
      COUNT(*) OVER (
        PARTITION BY dp.symbol ORDER BY dp.date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )::integer AS bars_to_date
    FROM public.daily_prices dp
    JOIN target_symbols ts ON ts.symbol = dp.symbol
    WHERE dp.date <= p_as_of_date
  ),
  with_slope AS (
    SELECT
      sp.*,
      LAG(sp.ma50, 5) OVER (
        PARTITION BY sp.symbol ORDER BY sp.date
      ) AS ma50_5d_ago,
      ROW_NUMBER() OVER (
        PARTITION BY sp.symbol ORDER BY sp.date DESC
      ) AS rn
    FROM source_prices sp
  ),
  spy_ref AS (
    SELECT
      ws.date,
      ws.close AS spy_close,
      ws.sma200 AS spy_sma200
    FROM with_slope ws
    WHERE ws.symbol = 'SPY'
  ),
  final_rows AS (
    SELECT
      ws.symbol,
      ws.date AS calc_date,
      ws.close,
      ws.ma50,
      ws.ma150,
      CASE
        WHEN ws.ma50_5d_ago IS NULL OR ws.ma50 IS NULL THEN 'flat'
        WHEN ws.ma50 > ws.ma50_5d_ago THEN 'rising'
        WHEN ws.ma50 < ws.ma50_5d_ago THEN 'falling'
        ELSE 'flat'
      END AS ma50_slope,
      (ws.close > ws.ma50) AS above_ma50,
      (CASE WHEN ws.ma150 IS NOT NULL THEN ws.close > ws.ma150 ELSE NULL END) AS above_ma150,
      ws.volume,
      ROUND(ws.avg_volume_5d)::bigint AS avg_volume_5d,
      CASE WHEN ws.avg_volume_5d > 0 THEN ROUND(ws.volume::numeric / ws.avg_volume_5d, 2) ELSE NULL END AS volume_ratio,
      CASE WHEN ws.prev_close > 0 THEN ROUND(((ws.close / ws.prev_close) - 1) * 100.0, 2) ELSE NULL END AS pct_change_1d,
      CASE WHEN ws.high_52w > 0 THEN ROUND(((ws.close / ws.high_52w) - 1) * 100.0, 2) ELSE NULL END AS pct_from_52w_high,
      CASE
        WHEN ws.sma200 IS NOT NULL AND ws.sma200 > 0 AND sr.spy_sma200 IS NOT NULL AND sr.spy_sma200 > 0
        THEN ROUND((((ws.close / ws.sma200) / (sr.spy_close / sr.spy_sma200)) - 1) * 100.0, 2)
        ELSE NULL
      END AS mansfield_rs
    FROM with_slope ws
    LEFT JOIN spy_ref sr ON sr.date = ws.date
    WHERE ws.rn = 1
      AND ws.bars_to_date >= p_min_bars
      AND ws.ma50 IS NOT NULL
      AND ws.prev_close IS NOT NULL
      AND ws.avg_volume_5d IS NOT NULL
  ),
  with_pattern AS (
    SELECT
      fr.*,
      CASE
        WHEN fr.ma150 IS NOT NULL AND fr.close > fr.ma50 AND fr.ma50 > fr.ma150
          AND COALESCE(fr.volume_ratio, 0) >= 1.5 AND COALESCE(fr.mansfield_rs, 0) > 0
        THEN 'climbing'
        WHEN fr.ma150 IS NOT NULL AND fr.close > fr.ma50 AND fr.close > fr.ma150
        THEN 'base_or_climbing'
        WHEN fr.ma150 IS NOT NULL AND fr.close < fr.ma50 AND fr.close < fr.ma150 AND fr.ma50_slope = 'falling'
        THEN 'downhill'
        WHEN fr.ma150 IS NOT NULL AND fr.close > fr.ma150
        THEN 'base'
        WHEN fr.close > fr.ma50
        THEN 'base'
        ELSE 'tired'
      END AS wsp_pattern,
      (
        (CASE WHEN fr.close > fr.ma50 THEN 1 ELSE 0 END) +
        (CASE WHEN fr.ma150 IS NOT NULL AND fr.close > fr.ma150 THEN 1 ELSE 0 END) +
        (CASE WHEN fr.ma50_slope = 'rising' THEN 1 ELSE 0 END) +
        (CASE WHEN COALESCE(fr.volume_ratio, 0) >= 2.0 THEN 1 ELSE 0 END) +
        (CASE WHEN COALESCE(fr.mansfield_rs, 0) > 0 THEN 1 ELSE 0 END)
      )::integer AS wsp_score
    FROM final_rows fr
  ),
  counted AS (
    SELECT COUNT(*)::bigint AS cnt FROM target_symbols
  ),
  upserted AS (
    INSERT INTO public.wsp_indicators (
      symbol, calc_date, close, ma50, ma150, ma50_slope,
      above_ma50, above_ma150, volume, avg_volume_5d,
      volume_ratio, wsp_pattern, wsp_score,
      pct_change_1d, pct_from_52w_high, mansfield_rs, created_at
    )
    SELECT
      wp.symbol, wp.calc_date, wp.close, wp.ma50, wp.ma150, wp.ma50_slope,
      wp.above_ma50, wp.above_ma150, wp.volume, wp.avg_volume_5d,
      wp.volume_ratio, wp.wsp_pattern, wp.wsp_score,
      wp.pct_change_1d, wp.pct_from_52w_high, wp.mansfield_rs, now()
    FROM with_pattern wp
    ON CONFLICT (symbol, calc_date)
    DO UPDATE SET
      close = EXCLUDED.close, ma50 = EXCLUDED.ma50, ma150 = EXCLUDED.ma150,
      ma50_slope = EXCLUDED.ma50_slope, above_ma50 = EXCLUDED.above_ma50,
      above_ma150 = EXCLUDED.above_ma150, volume = EXCLUDED.volume,
      avg_volume_5d = EXCLUDED.avg_volume_5d, volume_ratio = EXCLUDED.volume_ratio,
      wsp_pattern = EXCLUDED.wsp_pattern, wsp_score = EXCLUDED.wsp_score,
      pct_change_1d = EXCLUDED.pct_change_1d, pct_from_52w_high = EXCLUDED.pct_from_52w_high,
      mansfield_rs = EXCLUDED.mansfield_rs, created_at = now()
    RETURNING 1
  )
  SELECT
    counted.cnt,
    (SELECT COUNT(*)::bigint FROM with_pattern),
    (SELECT COUNT(*)::bigint FROM upserted)
  INTO v_total_candidates, v_computed_rows, v_written_rows
  FROM counted;

  RETURN jsonb_build_object(
    'ok', true,
    'total_candidates', v_total_candidates,
    'computed_rows', v_computed_rows,
    'written_rows', v_written_rows
  );
END;
$$;