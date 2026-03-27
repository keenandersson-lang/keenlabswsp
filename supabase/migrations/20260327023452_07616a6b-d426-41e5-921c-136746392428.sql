
-- Symbols table: tracks all symbols we monitor
CREATE TABLE public.symbols (
  symbol TEXT PRIMARY KEY,
  name TEXT,
  sector TEXT DEFAULT 'Unknown',
  industry TEXT,
  exchange TEXT,
  asset_class TEXT DEFAULT 'us_equity',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Daily OHLCV price cache
CREATE TABLE public.daily_prices (
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  open NUMERIC NOT NULL,
  high NUMERIC NOT NULL,
  low NUMERIC NOT NULL,
  close NUMERIC NOT NULL,
  volume BIGINT NOT NULL,
  data_source TEXT DEFAULT 'alpaca_iex',
  has_full_volume BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (symbol, date)
);

-- Indexes for common queries
CREATE INDEX idx_daily_prices_symbol ON public.daily_prices (symbol);
CREATE INDEX idx_daily_prices_date ON public.daily_prices (date DESC);
CREATE INDEX idx_daily_prices_symbol_date ON public.daily_prices (symbol, date DESC);
CREATE INDEX idx_symbols_active ON public.symbols (is_active) WHERE is_active = true;
CREATE INDEX idx_symbols_sector ON public.symbols (sector);

-- Data sync log
CREATE TABLE public.data_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type TEXT NOT NULL, -- 'daily', 'backfill', 'seed'
  status TEXT NOT NULL DEFAULT 'running', -- 'running', 'success', 'error'
  symbols_processed INTEGER DEFAULT 0,
  symbols_failed INTEGER DEFAULT 0,
  data_source TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Enable RLS
ALTER TABLE public.symbols ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_sync_log ENABLE ROW LEVEL SECURITY;

-- Public read access for symbols and daily_prices (market data is public)
CREATE POLICY "Anyone can read symbols" ON public.symbols FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can read daily prices" ON public.daily_prices FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can read sync log" ON public.data_sync_log FOR SELECT TO anon, authenticated USING (true);

-- Service role write access
CREATE POLICY "Service role can manage symbols" ON public.symbols FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage daily prices" ON public.daily_prices FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage sync log" ON public.data_sync_log FOR ALL TO service_role USING (true) WITH CHECK (true);
