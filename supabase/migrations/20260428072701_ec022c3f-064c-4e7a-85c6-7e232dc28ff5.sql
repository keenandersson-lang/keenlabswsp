
ALTER TABLE public.symbols
  ADD COLUMN IF NOT EXISTS market_cap bigint,
  ADD COLUMN IF NOT EXISTS description text;

UPDATE public.symbols SET canonical_sector = CASE canonical_sector
  WHEN 'Banking' THEN 'Financials'
  WHEN 'Insurance' THEN 'Financials'
  WHEN 'Healthcare' THEN 'Health Care'
  WHEN 'Biotechnology' THEN 'Health Care'
  WHEN 'Pharmaceuticals' THEN 'Health Care'
  WHEN 'Life Sciences Tools Services' THEN 'Health Care'
  WHEN 'Technology' THEN 'Information Technology'
  WHEN 'Semiconductors' THEN 'Information Technology'
  WHEN 'Media' THEN 'Communication Services'
  WHEN 'Telecommunication' THEN 'Communication Services'
  WHEN 'Communications' THEN 'Communication Services'
  WHEN 'Metals & Mining' THEN 'Materials'
  WHEN 'Metals Mining' THEN 'Materials'
  WHEN 'Chemicals' THEN 'Materials'
  WHEN 'Paper Forest' THEN 'Materials'
  WHEN 'Packaging' THEN 'Materials'
  WHEN 'Retail' THEN 'Consumer Discretionary'
  WHEN 'Hotels Restaurants Leisure' THEN 'Consumer Discretionary'
  WHEN 'Automobiles' THEN 'Consumer Discretionary'
  WHEN 'Auto Components' THEN 'Consumer Discretionary'
  WHEN 'Leisure Products' THEN 'Consumer Discretionary'
  WHEN 'Textiles Apparel Luxury Goods' THEN 'Consumer Discretionary'
  WHEN 'Diversified Consumer Services' THEN 'Consumer Discretionary'
  WHEN 'Food Products' THEN 'Consumer Staples'
  WHEN 'Beverages' THEN 'Consumer Staples'
  WHEN 'Consumer Products' THEN 'Consumer Staples'
  WHEN 'Aerospace Defense' THEN 'Industrials'
  WHEN 'Machinery' THEN 'Industrials'
  WHEN 'Construction' THEN 'Industrials'
  WHEN 'Building' THEN 'Industrials'
  WHEN 'Marine' THEN 'Industrials'
  WHEN 'Airlines' THEN 'Industrials'
  WHEN 'Road Rail' THEN 'Industrials'
  WHEN 'Logistics Transportation' THEN 'Industrials'
  WHEN 'Transportation Infrastructure' THEN 'Industrials'
  WHEN 'Trading Companies Distributors' THEN 'Industrials'
  WHEN 'Distributors' THEN 'Industrials'
  WHEN 'Commercial Services Supplies' THEN 'Industrials'
  WHEN 'Professional Services' THEN 'Industrials'
  WHEN 'Electrical Equipment' THEN 'Industrials'
  WHEN 'Industrial Conglomerates' THEN 'Industrials'
  WHEN 'Stocks' THEN NULL
  WHEN 'N A' THEN NULL
  WHEN 'ETF' THEN NULL
  WHEN 'Unknown' THEN NULL
  WHEN '' THEN NULL
  ELSE canonical_sector
END
WHERE canonical_sector IS NOT NULL
  AND canonical_sector NOT IN (SELECT sector_name FROM public.canonical_gics_sectors);
