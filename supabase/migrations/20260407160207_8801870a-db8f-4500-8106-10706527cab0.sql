
-- Drop materialize_wsp_indicators first because return type changes from jsonb to void
DROP FUNCTION IF EXISTS public.materialize_wsp_indicators(date, date);

-- DEL 1: Replace materialize_wsp_indicators_from_prices
CREATE OR REPLACE FUNCTION public.materialize_wsp_indicators_from_prices(
  p_symbols text[] DEFAULT NULL::text[],
  p_as_of_date date DEFAULT (now() AT TIME ZONE 'utc')::date,
  p_min_bars integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
      AVG(dp.close::numeric) OVER (
        PARTITION BY dp.symbol ORDER BY dp.date
        ROWS BETWEEN 149 PRECEDING AND CURRENT ROW
      ) AS ma150,
      AVG(dp.close::numeric) OVER (
        PARTITION BY dp.symbol ORDER BY dp.date
        ROWS BETWEEN 199 PRECEDING AND CURRENT ROW
      ) AS sma200,
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
      ws.sma200,
      CASE
        WHEN ws.ma50_5d_ago IS NULL OR ws.ma50 IS NULL THEN 'flat'
        WHEN ws.ma50 > ws.ma50_5d_ago THEN 'rising'
        WHEN ws.ma50 < ws.ma50_5d_ago THEN 'falling'
        ELSE 'flat'
      END AS ma50_slope,
      (ws.close > ws.ma50) AS above_ma50,
      (ws.close > ws.ma150) AS above_ma150,
      ws.volume,
      ROUND(ws.avg_volume_5d)::bigint AS avg_volume_5d,
      CASE WHEN ws.avg_volume_5d > 0 THEN ROUND(ws.volume::numeric / ws.avg_volume_5d, 2) ELSE NULL END AS volume_ratio,
      CASE WHEN ws.prev_close > 0 THEN ROUND(((ws.close / ws.prev_close) - 1) * 100.0, 2) ELSE NULL END AS pct_change_1d,
      CASE WHEN ws.high_52w > 0 THEN ROUND(((ws.close / ws.high_52w) - 1) * 100.0, 2) ELSE NULL END AS pct_from_52w_high,
      CASE
        WHEN ws.sma200 > 0 AND sr.spy_sma200 > 0
        THEN ROUND((((ws.close / ws.sma200) / (sr.spy_close / sr.spy_sma200)) - 1) * 100.0, 2)
        ELSE 0
      END AS mansfield_rs
    FROM with_slope ws
    LEFT JOIN spy_ref sr ON sr.date = ws.date
    WHERE ws.rn = 1
      AND ws.bars_to_date >= p_min_bars
      AND ws.ma50 IS NOT NULL
      AND ws.ma150 IS NOT NULL
      AND ws.sma200 IS NOT NULL
      AND ws.prev_close IS NOT NULL
      AND ws.avg_volume_5d IS NOT NULL
  ),
  with_pattern AS (
    SELECT
      fr.*,
      CASE
        WHEN fr.close > fr.ma50 AND fr.ma50 > fr.ma150
          AND COALESCE(fr.volume_ratio, 0) >= 1.5 AND fr.mansfield_rs > 0
        THEN 'climbing'
        WHEN fr.close > fr.ma50 AND fr.close > fr.ma150
        THEN 'base_or_climbing'
        WHEN fr.close < fr.ma50 AND fr.close < fr.ma150 AND fr.ma50_slope = 'falling'
        THEN 'downhill'
        WHEN fr.close > fr.ma150
        THEN 'base'
        ELSE 'tired'
      END AS wsp_pattern,
      (
        (CASE WHEN fr.close > fr.ma50 THEN 1 ELSE 0 END) +
        (CASE WHEN fr.close > fr.ma150 THEN 1 ELSE 0 END) +
        (CASE WHEN fr.ma50_slope = 'rising' THEN 1 ELSE 0 END) +
        (CASE WHEN COALESCE(fr.volume_ratio, 0) >= 2.0 THEN 1 ELSE 0 END) +
        (CASE WHEN fr.mansfield_rs > 0 THEN 1 ELSE 0 END)
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

-- DEL 2: Replace materialize_wsp_indicators (historical backfill, returns void)
CREATE OR REPLACE FUNCTION public.materialize_wsp_indicators(
  p_from_date date DEFAULT '2024-01-01'::date,
  p_to_date date DEFAULT CURRENT_DATE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.wsp_indicators (
    symbol, calc_date, close, volume,
    ma50, ma150, ma50_slope,
    above_ma50, above_ma150,
    avg_volume_5d, volume_ratio,
    pct_change_1d, pct_from_52w_high,
    mansfield_rs, wsp_pattern, wsp_score,
    created_at
  )
  WITH step1_windows AS (
    SELECT symbol, date, close, volume,
      AVG(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS ma50,
      AVG(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 149 PRECEDING AND CURRENT ROW) AS ma150,
      AVG(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS sma200,
      AVG(volume) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS avg_vol_5d,
      MAX(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 251 PRECEDING AND CURRENT ROW) AS high_52w
    FROM public.daily_prices
    WHERE date BETWEEN (p_from_date - INTERVAL '200 days') AND p_to_date
      AND close > 0 AND volume > 0
  ),
  step2_lags AS (
    SELECT *,
      LAG(close, 1) OVER (PARTITION BY symbol ORDER BY date) AS prev_close,
      LAG(ma50, 5) OVER (PARTITION BY symbol ORDER BY date) AS ma50_5d_ago
    FROM step1_windows
  ),
  spy_ref AS (
    SELECT date, close AS spy_close, sma200 AS spy_sma200
    FROM step2_lags
    WHERE symbol = 'SPY'
  ),
  step3_calc AS (
    SELECT
      s.symbol, s.date, s.close, s.volume, s.ma50, s.ma150, s.sma200,
      s.avg_vol_5d::bigint AS avg_volume_5d, s.high_52w,
      CASE
        WHEN s.ma50_5d_ago IS NULL THEN 'flat'
        WHEN s.ma50 > s.ma50_5d_ago THEN 'rising'
        WHEN s.ma50 < s.ma50_5d_ago THEN 'falling'
        ELSE 'flat'
      END AS ma50_slope,
      s.close > s.ma50 AS above_ma50,
      s.close > s.ma150 AS above_ma150,
      CASE WHEN s.avg_vol_5d > 0 THEN ROUND(s.volume::numeric / s.avg_vol_5d, 2) ELSE 1 END AS volume_ratio,
      CASE WHEN s.prev_close > 0 THEN ROUND((s.close - s.prev_close) / s.prev_close * 100, 2) ELSE 0 END AS pct_change_1d,
      CASE WHEN s.high_52w > 0 THEN ROUND((s.close - s.high_52w) / s.high_52w * 100, 2) ELSE 0 END AS pct_from_52w_high,
      CASE
        WHEN s.sma200 > 0 AND sr.spy_sma200 > 0
        THEN ROUND((((s.close / s.sma200) / (sr.spy_close / sr.spy_sma200)) - 1) * 100.0, 2)
        ELSE 0
      END AS mansfield_rs
    FROM step2_lags s
    LEFT JOIN spy_ref sr ON sr.date = s.date
    WHERE s.date BETWEEN p_from_date AND p_to_date
      AND s.ma50 IS NOT NULL AND s.ma150 IS NOT NULL AND s.sma200 IS NOT NULL
  )
  SELECT symbol, date, close, volume, ma50, ma150, ma50_slope,
    above_ma50, above_ma150, avg_volume_5d, volume_ratio,
    pct_change_1d, pct_from_52w_high, mansfield_rs,
    CASE
      WHEN above_ma50 AND ma50 > ma150 AND volume_ratio >= 1.5 AND mansfield_rs > 0 THEN 'climbing'
      WHEN above_ma50 AND above_ma150 THEN 'base_or_climbing'
      WHEN NOT above_ma50 AND NOT above_ma150 AND ma50_slope = 'falling' THEN 'downhill'
      WHEN above_ma150 THEN 'base'
      ELSE 'tired'
    END AS wsp_pattern,
    (CASE WHEN above_ma50 THEN 1 ELSE 0 END
     + CASE WHEN above_ma150 THEN 1 ELSE 0 END
     + CASE WHEN ma50_slope = 'rising' THEN 1 ELSE 0 END
     + CASE WHEN volume_ratio >= 2.0 THEN 1 ELSE 0 END
     + CASE WHEN mansfield_rs > 0 THEN 1 ELSE 0 END
    ) AS wsp_score,
    now()
  FROM step3_calc
  ON CONFLICT (symbol, calc_date) DO UPDATE SET
    close = EXCLUDED.close, volume = EXCLUDED.volume,
    ma50 = EXCLUDED.ma50, ma150 = EXCLUDED.ma150,
    ma50_slope = EXCLUDED.ma50_slope,
    above_ma50 = EXCLUDED.above_ma50, above_ma150 = EXCLUDED.above_ma150,
    avg_volume_5d = EXCLUDED.avg_volume_5d, volume_ratio = EXCLUDED.volume_ratio,
    pct_change_1d = EXCLUDED.pct_change_1d, pct_from_52w_high = EXCLUDED.pct_from_52w_high,
    mansfield_rs = EXCLUDED.mansfield_rs,
    wsp_pattern = EXCLUDED.wsp_pattern, wsp_score = EXCLUDED.wsp_score,
    created_at = now();
END;
$$;
