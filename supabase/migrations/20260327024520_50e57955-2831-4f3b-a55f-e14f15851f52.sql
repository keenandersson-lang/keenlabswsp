
CREATE TABLE IF NOT EXISTS public.wsp_indicators (
  symbol TEXT NOT NULL,
  calc_date DATE NOT NULL,
  close NUMERIC NOT NULL,
  ma50 NUMERIC,
  ma150 NUMERIC,
  ma50_slope TEXT DEFAULT 'flat',
  above_ma50 BOOLEAN DEFAULT false,
  above_ma150 BOOLEAN DEFAULT false,
  volume BIGINT,
  avg_volume_5d BIGINT,
  volume_ratio NUMERIC,
  wsp_pattern TEXT,
  wsp_score INTEGER DEFAULT 0,
  pct_change_1d NUMERIC,
  pct_from_52w_high NUMERIC,
  mansfield_rs NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (symbol, calc_date)
);

CREATE INDEX IF NOT EXISTS idx_wsp_indicators_calc_date ON public.wsp_indicators (calc_date DESC);
CREATE INDEX IF NOT EXISTS idx_wsp_indicators_score ON public.wsp_indicators (calc_date, wsp_score DESC);

ALTER TABLE public.wsp_indicators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read wsp indicators" ON public.wsp_indicators
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Service role can manage wsp indicators" ON public.wsp_indicators
  FOR ALL TO service_role USING (true) WITH CHECK (true);
