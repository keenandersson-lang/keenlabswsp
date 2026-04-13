
-- Canonical GICS Sectors
CREATE TABLE public.canonical_gics_sectors (
  sector_code integer PRIMARY KEY,
  sector_name text NOT NULL UNIQUE,
  display_order integer NOT NULL DEFAULT 0
);
ALTER TABLE public.canonical_gics_sectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read canonical sectors" ON public.canonical_gics_sectors FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Service role manages canonical sectors" ON public.canonical_gics_sectors FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.canonical_gics_sectors (sector_code, sector_name, display_order) VALUES
  (10, 'Energy', 1), (15, 'Materials', 2), (20, 'Industrials', 3),
  (25, 'Consumer Discretionary', 4), (30, 'Consumer Staples', 5),
  (35, 'Health Care', 6), (40, 'Financials', 7),
  (45, 'Information Technology', 8), (50, 'Communication Services', 9),
  (55, 'Utilities', 10), (60, 'Real Estate', 11);

-- Canonical GICS Industries
CREATE TABLE public.canonical_gics_industries (
  industry_code integer PRIMARY KEY,
  industry_name text NOT NULL UNIQUE,
  sector_code integer NOT NULL REFERENCES public.canonical_gics_sectors(sector_code),
  display_order integer NOT NULL DEFAULT 0
);
ALTER TABLE public.canonical_gics_industries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read canonical industries" ON public.canonical_gics_industries FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Service role manages canonical industries" ON public.canonical_gics_industries FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.canonical_gics_industries (industry_code, industry_name, sector_code, display_order) VALUES
  (101010, 'Energy Equipment & Services', 10, 1),
  (101020, 'Oil, Gas & Consumable Fuels', 10, 2),
  (151010, 'Chemicals', 15, 3),
  (151020, 'Construction Materials', 15, 4),
  (151030, 'Containers & Packaging', 15, 5),
  (151040, 'Metals & Mining', 15, 6),
  (151050, 'Paper & Forest Products', 15, 7),
  (201010, 'Aerospace & Defense', 20, 8),
  (201020, 'Building Products', 20, 9),
  (201030, 'Construction & Engineering', 20, 10),
  (201040, 'Electrical Equipment', 20, 11),
  (201050, 'Industrial Conglomerates', 20, 12),
  (201060, 'Machinery', 20, 13),
  (201070, 'Trading Companies & Distributors', 20, 14),
  (202010, 'Commercial Services & Supplies', 20, 15),
  (202020, 'Professional Services', 20, 16),
  (203010, 'Air Freight & Logistics', 20, 17),
  (203020, 'Passenger Airlines', 20, 18),
  (203030, 'Marine Transportation', 20, 19),
  (203040, 'Ground Transportation', 20, 20),
  (203050, 'Transportation Infrastructure', 20, 21),
  (251010, 'Automobile Components', 25, 22),
  (251020, 'Automobiles', 25, 23),
  (252010, 'Household Durables', 25, 24),
  (252020, 'Leisure Products', 25, 25),
  (252030, 'Textiles, Apparel & Luxury Goods', 25, 26),
  (253010, 'Hotels, Restaurants & Leisure', 25, 27),
  (253020, 'Diversified Consumer Services', 25, 28),
  (255010, 'Distributors', 25, 29),
  (255030, 'Broadline Retail', 25, 30),
  (255040, 'Specialty Retail', 25, 31),
  (301010, 'Consumer Staples Distribution & Retail', 30, 32),
  (302010, 'Beverages', 30, 33),
  (302020, 'Food Products', 30, 34),
  (302030, 'Tobacco', 30, 35),
  (303010, 'Household Products', 30, 36),
  (303020, 'Personal Care Products', 30, 37),
  (351010, 'Health Care Equipment & Supplies', 35, 38),
  (351020, 'Health Care Providers & Services', 35, 39),
  (351030, 'Health Care Technology', 35, 40),
  (352010, 'Biotechnology', 35, 41),
  (352020, 'Pharmaceuticals', 35, 42),
  (352030, 'Life Sciences Tools & Services', 35, 43),
  (401010, 'Banks', 40, 44),
  (401020, 'Thrifts & Mortgage Finance', 40, 45),
  (402010, 'Diversified Financial Services', 40, 46),
  (402020, 'Consumer Finance', 40, 47),
  (402030, 'Capital Markets', 40, 48),
  (402040, 'Mortgage Real Estate Investment Trusts (Mortgage REITs)', 40, 49),
  (403010, 'Financial Services', 40, 50),
  (403020, 'Insurance', 40, 51),
  (451010, 'Software', 45, 52),
  (451020, 'IT Services', 45, 53),
  (452010, 'Communications Equipment', 45, 54),
  (452020, 'Technology Hardware, Storage & Peripherals', 45, 55),
  (452030, 'Electronic Equipment, Instruments & Components', 45, 56),
  (453010, 'Semiconductors & Semiconductor Equipment', 45, 57),
  (501010, 'Diversified Telecommunication Services', 50, 58),
  (501020, 'Wireless Telecommunication Services', 50, 59),
  (502010, 'Media', 50, 60),
  (502020, 'Entertainment', 50, 61),
  (502030, 'Interactive Media & Services', 50, 62),
  (551010, 'Electric Utilities', 55, 63),
  (551020, 'Gas Utilities', 55, 64),
  (551030, 'Multi-Utilities', 55, 65),
  (551040, 'Water Utilities', 55, 66),
  (551050, 'Independent Power and Renewable Electricity Producers', 55, 67),
  (601010, 'Equity Real Estate Investment Trusts (Equity REITs)', 60, 68),
  (601020, 'Real Estate Management & Development', 60, 69);

-- Taxonomy Alias Map
CREATE TABLE public.taxonomy_alias_map (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  raw_label text NOT NULL,
  label_type text NOT NULL DEFAULT 'industry',
  canonical_industry_code integer REFERENCES public.canonical_gics_industries(industry_code),
  canonical_sector_code integer REFERENCES public.canonical_gics_sectors(sector_code),
  mapping_method text NOT NULL DEFAULT 'SIC_TO_GICS_BRIDGE',
  confidence text NOT NULL DEFAULT 'medium',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(raw_label, label_type)
);
ALTER TABLE public.taxonomy_alias_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read alias map" ON public.taxonomy_alias_map FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Service role manages alias map" ON public.taxonomy_alias_map FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.taxonomy_alias_map (raw_label, label_type, canonical_industry_code, canonical_sector_code, mapping_method, confidence) VALUES
  ('PHARMACEUTICAL PREPARATIONS', 'industry', 352020, 35, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('Pharmaceutical Preparations', 'industry', 352020, 35, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('SERVICES-PREPACKAGED SOFTWARE', 'industry', 451010, 45, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('Services Prepackaged Software', 'industry', 451010, 45, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('BIOLOGICAL PRODUCTS, (NO DIAGNOSTIC SUBSTANCES)', 'industry', 352010, 35, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('Biological Products No Diagnostic Substances', 'industry', 352010, 35, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('STATE COMMERCIAL BANKS', 'industry', 401010, 40, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('State Commercial Banks', 'industry', 401010, 40, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('NATIONAL COMMERCIAL BANKS', 'industry', 401010, 40, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('National Commercial Banks', 'industry', 401010, 40, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('SURGICAL & MEDICAL INSTRUMENTS & APPARATUS', 'industry', 351010, 35, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('Surgical Medical Instruments Apparatus', 'industry', 351010, 35, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('ELECTROMEDICAL & ELECTROTHERAPEUTIC APPARATUS', 'industry', 351010, 35, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('ORTHOPEDIC, PROSTHETIC & SURGICAL APPLIANCES & SUPPLIES', 'industry', 351010, 35, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('SERVICES-BUSINESS SERVICES, NEC', 'industry', 451020, 45, 'SIC_TO_GICS_BRIDGE', 'medium'),
  ('Services Business Services Nec', 'industry', 451020, 45, 'SIC_TO_GICS_BRIDGE', 'medium'),
  ('SERVICES-COMPUTER PROCESSING & DATA PREPARATION', 'industry', 451020, 45, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('Services Computer Processing Data Preparation', 'industry', 451020, 45, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('SERVICES-COMPUTER INTEGRATED SYSTEMS DESIGN', 'industry', 451020, 45, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('Services Computer Integrated Systems Design', 'industry', 451020, 45, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('SERVICES-COMPUTER PROGRAMMING, DATA PROCESSING, ETC.', 'industry', 451020, 45, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('SERVICES-COMPUTER PROGRAMMING SERVICES', 'industry', 451010, 45, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('SEMICONDUCTORS & RELATED DEVICES', 'industry', 453010, 45, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('Semiconductors Related Devices', 'industry', 453010, 45, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('FIRE, MARINE & CASUALTY INSURANCE', 'industry', 403020, 40, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('FINANCE SERVICES', 'industry', 403010, 40, 'SIC_TO_GICS_BRIDGE', 'medium'),
  ('Finance Services', 'industry', 403010, 40, 'SIC_TO_GICS_BRIDGE', 'medium'),
  ('INVESTMENT ADVICE', 'industry', 402030, 40, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('REAL ESTATE INVESTMENT TRUSTS', 'industry', 601010, 60, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('Real Estate Investment Trusts', 'industry', 601010, 60, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('BLANK CHECKS', 'industry', 403010, 40, 'SIC_TO_GICS_BRIDGE', 'medium'),
  ('Blank Checks', 'industry', 403010, 40, 'SIC_TO_GICS_BRIDGE', 'medium'),
  ('CRUDE PETROLEUM & NATURAL GAS', 'industry', 101020, 10, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('Crude Petroleum Natural Gas', 'industry', 101020, 10, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('CHEMICALS & ALLIED PRODUCTS', 'industry', 151010, 15, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('SERVICES-MANAGEMENT CONSULTING SERVICES', 'industry', 202020, 20, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('SERVICES-COMMERCIAL PHYSICAL & BIOLOGICAL RESEARCH', 'industry', 352030, 35, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('SERVICES-MEDICAL LABORATORIES', 'industry', 351020, 35, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('SERVICES-EDUCATIONAL SERVICES', 'industry', 253020, 25, 'SIC_TO_GICS_BRIDGE', 'high'),
  ('MOTOR VEHICLE PARTS & ACCESSORIES', 'industry', 251010, 25, 'SIC_TO_GICS_BRIDGE', 'high')
ON CONFLICT (raw_label, label_type) DO NOTHING;
