
-- 1. Update materialization RPC
CREATE OR REPLACE FUNCTION public.materialize_wsp_indicators_from_prices(
  p_as_of_date date DEFAULT CURRENT_DATE,
  p_min_bars integer DEFAULT 50,
  p_symbols text[] DEFAULT NULL
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
    SELECT s.symbol, s.universe_tier, s.canonical_sector
    FROM public.symbols s
    WHERE s.is_active = true
      AND (p_symbols IS NULL OR s.symbol = ANY(p_symbols))
  ),
  sector_etf_map(sector_name, etf_symbol) AS (
    VALUES
      ('Information Technology', 'XLK'),
      ('Financials', 'XLF'),
      ('Healthcare', 'XLV'),
      ('Health Care', 'XLV'),
      ('Industrials', 'XLI'),
      ('Consumer Discretionary', 'XLY'),
      ('Consumer Staples', 'XLP'),
      ('Energy', 'XLE'),
      ('Utilities', 'XLU'),
      ('Real Estate', 'XLRE'),
      ('Communication Services', 'XLC'),
      ('Materials', 'XLB')
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
    SELECT ws.date, ws.close AS spy_close, ws.sma200 AS spy_sma200
    FROM with_slope ws
    WHERE ws.symbol = 'SPY'
  ),
  sector_etf_prices AS (
    SELECT ws.symbol AS etf_symbol, ws.date, ws.close AS etf_close, ws.sma200 AS etf_sma200
    FROM with_slope ws
    WHERE ws.symbol IN ('XLK','XLF','XLV','XLI','XLY','XLP','XLE','XLU','XLRE','XLC','XLB')
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
      END AS mansfield_rs,
      CASE
        WHEN ts.universe_tier = 'core'
          AND ws.sma200 IS NOT NULL AND ws.sma200 > 0
          AND sep.etf_sma200 IS NOT NULL AND sep.etf_sma200 > 0
        THEN ROUND((((ws.close / ws.sma200) / (sep.etf_close / sep.etf_sma200)) - 1) * 100.0, 2)
        ELSE NULL
      END AS mansfield_rs_sector
    FROM with_slope ws
    LEFT JOIN spy_ref sr ON sr.date = ws.date
    LEFT JOIN target_symbols ts ON ts.symbol = ws.symbol
    LEFT JOIN sector_etf_map sem ON sem.sector_name = ts.canonical_sector
    LEFT JOIN sector_etf_prices sep ON sep.etf_symbol = sem.etf_symbol AND sep.date = ws.date
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
      pct_change_1d, pct_from_52w_high, mansfield_rs, mansfield_rs_sector, created_at
    )
    SELECT
      wp.symbol, wp.calc_date, wp.close, wp.ma50, wp.ma150, wp.ma50_slope,
      wp.above_ma50, wp.above_ma150, wp.volume, wp.avg_volume_5d,
      wp.volume_ratio, wp.wsp_pattern, wp.wsp_score,
      wp.pct_change_1d, wp.pct_from_52w_high, wp.mansfield_rs, wp.mansfield_rs_sector, now()
    FROM with_pattern wp
    ON CONFLICT (symbol, calc_date)
    DO UPDATE SET
      close = EXCLUDED.close, ma50 = EXCLUDED.ma50, ma150 = EXCLUDED.ma150,
      ma50_slope = EXCLUDED.ma50_slope, above_ma50 = EXCLUDED.above_ma50,
      above_ma150 = EXCLUDED.above_ma150, volume = EXCLUDED.volume,
      avg_volume_5d = EXCLUDED.avg_volume_5d, volume_ratio = EXCLUDED.volume_ratio,
      wsp_pattern = EXCLUDED.wsp_pattern, wsp_score = EXCLUDED.wsp_score,
      pct_change_1d = EXCLUDED.pct_change_1d, pct_from_52w_high = EXCLUDED.pct_from_52w_high,
      mansfield_rs = EXCLUDED.mansfield_rs, mansfield_rs_sector = EXCLUDED.mansfield_rs_sector,
      created_at = now()
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

-- 2. Recreate get_symbol_detail with mansfield_rs_sector
DROP FUNCTION IF EXISTS public.get_symbol_detail(text);

CREATE FUNCTION public.get_symbol_detail(p_symbol text)
RETURNS TABLE(
  symbol text,
  canonical_sector text,
  canonical_industry text,
  calc_date date,
  close numeric,
  ma50 numeric,
  ma150 numeric,
  ma50_slope text,
  above_ma50 boolean,
  above_ma150 boolean,
  volume bigint,
  avg_volume_5d bigint,
  volume_ratio numeric,
  mansfield_rs numeric,
  mansfield_rs_sector numeric,
  pct_change_1d numeric,
  pct_from_52w_high numeric,
  wsp_pattern text,
  wsp_score integer
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.symbol,
    s.canonical_sector,
    s.canonical_industry,
    wi.calc_date,
    wi.close,
    wi.ma50,
    wi.ma150,
    wi.ma50_slope,
    wi.above_ma50,
    wi.above_ma150,
    wi.volume,
    wi.avg_volume_5d,
    wi.volume_ratio,
    wi.mansfield_rs,
    wi.mansfield_rs_sector,
    wi.pct_change_1d,
    wi.pct_from_52w_high,
    wi.wsp_pattern,
    wi.wsp_score
  FROM public.symbols s
  LEFT JOIN public.wsp_indicators wi
    ON wi.symbol = s.symbol
    AND wi.calc_date = (
      SELECT MAX(w2.calc_date) FROM public.wsp_indicators w2 WHERE w2.symbol = s.symbol
    )
  WHERE s.symbol = p_symbol;
$$;
