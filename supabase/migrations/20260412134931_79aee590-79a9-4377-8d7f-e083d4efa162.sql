
-- Add universe_tier column
ALTER TABLE symbols ADD COLUMN universe_tier TEXT NOT NULL DEFAULT 'expanded';

-- Backfill benchmarks
UPDATE symbols SET universe_tier = 'benchmark'
WHERE support_level = 'sector_benchmark_proxy';

-- Backfill core equities
UPDATE symbols SET universe_tier = 'core'
WHERE support_level = 'full_wsp_equity'
  AND canonical_sector IN (
    'Healthcare','Information Technology','Industrials','Financials',
    'Consumer Discretionary','Materials','Communication Services',
    'Consumer Staples','Utilities','Real Estate','Energy'
  )
  AND classification_confidence_level IN ('high','medium');

-- Index for fast filtering
CREATE INDEX idx_symbols_universe_tier ON symbols (universe_tier);
