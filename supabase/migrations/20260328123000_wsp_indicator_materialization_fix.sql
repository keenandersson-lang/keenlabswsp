-- Fix indicator materialization path: compute and upsert wsp_indicators directly from daily_prices.

CREATE OR REPLACE FUNCTION public.materialize_wsp_indicators_from_prices(
  p_symbols text[] DEFAULT NULL,
  p_as_of_date date DEFAULT (now() AT TIME ZONE 'utc')::date,
  p_min_bars integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
      dp.volume::bigint AS volume,
      avg(dp.close::numeric) OVER (
        PARTITION BY dp.symbol
        ORDER BY dp.date
        ROWS BETWEEN 49 PRECEDING AND CURRENT ROW
      ) AS ma50,
      avg(dp.close::numeric) OVER (
        PARTITION BY dp.symbol
        ORDER BY dp.date
        ROWS BETWEEN 149 PRECEDING AND CURRENT ROW
      ) AS ma150,
      lag(dp.close::numeric) OVER (
        PARTITION BY dp.symbol
        ORDER BY dp.date
      ) AS prev_close,
      avg(dp.volume::numeric) OVER (
        PARTITION BY dp.symbol
        ORDER BY dp.date
        ROWS BETWEEN 4 PRECEDING AND CURRENT ROW
      ) AS avg_volume_5d,
      max(dp.close::numeric) OVER (
        PARTITION BY dp.symbol
        ORDER BY dp.date
        ROWS BETWEEN 251 PRECEDING AND CURRENT ROW
      ) AS high_52w,
      lag(dp.close::numeric, 200) OVER (
        PARTITION BY dp.symbol
        ORDER BY dp.date
      ) AS close_200ago,
      count(*) OVER (
        PARTITION BY dp.symbol
        ORDER BY dp.date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )::integer AS bars_to_date
    FROM public.daily_prices dp
    JOIN target_symbols ts ON ts.symbol = dp.symbol
    WHERE dp.date <= p_as_of_date
  ),
  priced_with_slope AS (
    SELECT
      sp.*,
      lag(sp.ma50) OVER (
        PARTITION BY sp.symbol
        ORDER BY sp.date
      ) AS ma50_prev,
      row_number() OVER (
        PARTITION BY sp.symbol
        ORDER BY sp.date DESC
      ) AS rn
    FROM source_prices sp
  ),
  spy_reference AS (
    SELECT
      pws.date,
      ((pws.close / NULLIF(pws.close_200ago, 0)) - 1) * 100.0 AS spy_return_200d
    FROM priced_with_slope pws
    WHERE pws.symbol = 'SPY'
  ),
  final_rows AS (
    SELECT
      pws.symbol,
      pws.date AS calc_date,
      pws.close,
      pws.ma50,
      pws.ma150,
      CASE
        WHEN pws.ma50_prev IS NULL OR pws.ma50 IS NULL THEN 'flat'
        WHEN pws.ma50 > pws.ma50_prev THEN 'up'
        WHEN pws.ma50 < pws.ma50_prev THEN 'down'
        ELSE 'flat'
      END AS ma50_slope,
      (pws.close > pws.ma50) AS above_ma50,
      (pws.close > pws.ma150) AS above_ma150,
      pws.volume,
      round(pws.avg_volume_5d)::bigint AS avg_volume_5d,
      CASE WHEN pws.avg_volume_5d > 0 THEN pws.volume / pws.avg_volume_5d ELSE NULL END AS volume_ratio,
      CASE
        WHEN pws.close > pws.ma50 AND pws.ma50 > pws.ma150 THEN 'CLIMBING'
        WHEN pws.close > pws.ma150 THEN 'BASE'
        ELSE 'TIRED'
      END AS wsp_pattern,
      (
        (CASE WHEN pws.close > pws.ma50 THEN 2 ELSE 0 END) +
        (CASE WHEN pws.close > pws.ma150 THEN 2 ELSE 0 END) +
        (CASE WHEN pws.ma50_prev IS NOT NULL AND pws.ma50 > pws.ma50_prev THEN 2 ELSE 0 END) +
        (CASE WHEN pws.avg_volume_5d > 0 AND (pws.volume / pws.avg_volume_5d) >= 1.1 THEN 2 ELSE 0 END) +
        (CASE WHEN ((pws.close / NULLIF(pws.close_200ago, 0)) - 1) > 0 THEN 2 ELSE 0 END)
      )::integer AS wsp_score,
      CASE WHEN pws.prev_close > 0 THEN ((pws.close / pws.prev_close) - 1) * 100.0 ELSE NULL END AS pct_change_1d,
      CASE WHEN pws.high_52w > 0 THEN ((pws.close / pws.high_52w) - 1) * 100.0 ELSE NULL END AS pct_from_52w_high,
      (((pws.close / NULLIF(pws.close_200ago, 0)) - 1) * 100.0) - COALESCE(sr.spy_return_200d, 0) AS mansfield_rs
    FROM priced_with_slope pws
    LEFT JOIN spy_reference sr ON sr.date = pws.date
    WHERE pws.rn = 1
      AND pws.bars_to_date >= p_min_bars
      AND pws.ma50 IS NOT NULL
      AND pws.ma150 IS NOT NULL
      AND pws.prev_close IS NOT NULL
      AND pws.avg_volume_5d IS NOT NULL
      AND pws.close_200ago IS NOT NULL
  ),
  counted AS (
    SELECT COUNT(*)::bigint AS total_candidates
    FROM target_symbols
  ),
  existing AS (
    SELECT COUNT(*)::bigint AS existing_rows
    FROM final_rows fr
    JOIN public.wsp_indicators wi
      ON wi.symbol = fr.symbol
     AND wi.calc_date = fr.calc_date
  ),
  upserted AS (
    INSERT INTO public.wsp_indicators (
      symbol,
      calc_date,
      close,
      ma50,
      ma150,
      ma50_slope,
      above_ma50,
      above_ma150,
      volume,
      avg_volume_5d,
      volume_ratio,
      wsp_pattern,
      wsp_score,
      pct_change_1d,
      pct_from_52w_high,
      mansfield_rs
    )
    SELECT
      fr.symbol,
      fr.calc_date,
      fr.close,
      fr.ma50,
      fr.ma150,
      fr.ma50_slope,
      fr.above_ma50,
      fr.above_ma150,
      fr.volume,
      fr.avg_volume_5d,
      fr.volume_ratio,
      fr.wsp_pattern,
      fr.wsp_score,
      fr.pct_change_1d,
      fr.pct_from_52w_high,
      fr.mansfield_rs
    FROM final_rows fr
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
    (SELECT COUNT(*)::bigint FROM final_rows),
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
$$;

GRANT EXECUTE ON FUNCTION public.materialize_wsp_indicators_from_prices(text[], date, integer) TO service_role;
