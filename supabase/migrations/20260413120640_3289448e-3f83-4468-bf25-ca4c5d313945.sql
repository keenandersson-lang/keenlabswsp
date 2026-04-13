
-- ============================================================
-- STEP 1: Massive SIC → GICS industry mapping table
-- ============================================================
-- We'll do direct UPDATE on symbols using CASE-based mapping

-- First normalize sector names
UPDATE symbols SET canonical_sector = 'Health Care' WHERE canonical_sector = 'Healthcare' AND is_active = true;
UPDATE symbols SET canonical_sector = 'Consumer Discretionary' WHERE canonical_sector = 'Consumer Cyclical' AND is_active = true;
UPDATE symbols SET canonical_sector = 'Consumer Staples' WHERE canonical_sector = 'Consumer Defensive' AND is_active = true;

-- ============================================================
-- STEP 2: Map SIC descriptions to GICS industries + correct sectors
-- Using a temp mapping table for clarity
-- ============================================================
CREATE TEMP TABLE sic_gics_map (
  sic_pattern text,
  gics_industry text,
  gics_sector text
);

INSERT INTO sic_gics_map VALUES
-- HEALTH CARE (sector_code=35)
('PHARMACEUTICAL PREPARATIONS', 'Pharmaceuticals', 'Health Care'),
('Pharmaceutical Preparations', 'Pharmaceuticals', 'Health Care'),
('BIOLOGICAL PRODUCTS%', 'Biotechnology', 'Health Care'),
('Biological Products%', 'Biotechnology', 'Health Care'),
('IN VITRO%', 'Biotechnology', 'Health Care'),
('In Vitro%', 'Biotechnology', 'Health Care'),
('SURGICAL & MEDICAL INSTRUMENTS%', 'Health Care Equipment & Supplies', 'Health Care'),
('Surgical Medical Instruments%', 'Health Care Equipment & Supplies', 'Health Care'),
('ELECTROMEDICAL%', 'Health Care Equipment & Supplies', 'Health Care'),
('Electromedical%', 'Health Care Equipment & Supplies', 'Health Care'),
('ORTHOPEDIC%', 'Health Care Equipment & Supplies', 'Health Care'),
('Orthopedic%', 'Health Care Equipment & Supplies', 'Health Care'),
('DENTAL EQUIPMENT%', 'Health Care Equipment & Supplies', 'Health Care'),
('X-RAY APPARATUS%', 'Health Care Equipment & Supplies', 'Health Care'),
('SERVICES-MEDICAL LABORATORIES', 'Life Sciences Tools & Services', 'Health Care'),
('Services Medical Laboratories', 'Life Sciences Tools & Services', 'Health Care'),
('SERVICES-HEALTH SERVICES', 'Health Care Providers & Services', 'Health Care'),
('SERVICES-HOSPITALS', 'Health Care Providers & Services', 'Health Care'),
('SERVICES-HOME HEALTH CARE%', 'Health Care Providers & Services', 'Health Care'),
('SERVICES-SKILLED NURSING%', 'Health Care Providers & Services', 'Health Care'),
('SERVICES-NURSING%', 'Health Care Providers & Services', 'Health Care'),
('SERVICES-SPECIALTY OUTPATIENT%', 'Health Care Providers & Services', 'Health Care'),
('SERVICES-MISC HEALTH%', 'Health Care Providers & Services', 'Health Care'),
('SERVICES-TESTING LABORATORIES%', 'Life Sciences Tools & Services', 'Health Care'),
('SERVICES-COMMERCIAL PHYSICAL & BIOLOGICAL RESEARCH', 'Life Sciences Tools & Services', 'Health Care'),
('Services Commercial Physical Biological Research', 'Life Sciences Tools & Services', 'Health Care'),
('CHEMICALS & ALLIED PRODUCTS', 'Pharmaceuticals', 'Health Care'),
-- But some CHEMICALS should be Materials - we'll handle those with sector context below

-- INFORMATION TECHNOLOGY (sector_code=45)
('SERVICES-PREPACKAGED SOFTWARE', 'Software', 'Information Technology'),
('Services Prepackaged Software', 'Software', 'Information Technology'),
('SERVICES-COMPUTER PROGRAMMING SERVICES', 'IT Services', 'Information Technology'),
('Services Computer Programming Services', 'IT Services', 'Information Technology'),
('SERVICES-COMPUTER PROGRAMMING, DATA PROCESSING%', 'IT Services', 'Information Technology'),
('Services Computer Programming Data Processing%', 'IT Services', 'Information Technology'),
('SERVICES-COMPUTER PROCESSING & DATA PREPARATION', 'IT Services', 'Information Technology'),
('Services Computer Processing Data Preparation', 'IT Services', 'Information Technology'),
('SERVICES-COMPUTER INTEGRATED SYSTEMS DESIGN', 'IT Services', 'Information Technology'),
('Services Computer Integrated Systems Design', 'IT Services', 'Information Technology'),
('SERVICES-COMPUTER RENTAL & LEASING', 'IT Services', 'Information Technology'),
('SERVICES-COMPUTER MAINTENANCE & REPAIR', 'IT Services', 'Information Technology'),
('SERVICES-BUSINESS SERVICES, NEC', 'IT Services', 'Information Technology'),
('Services Business Services Nec', 'IT Services', 'Information Technology'),
('SEMICONDUCTORS & RELATED DEVICES', 'Semiconductors & Semiconductor Equipment', 'Information Technology'),
('Semiconductors Related Devices', 'Semiconductors & Semiconductor Equipment', 'Information Technology'),
('PRINTED CIRCUIT BOARDS', 'Electronic Equipment, Instruments & Components', 'Information Technology'),
('ELECTRONIC COMPONENTS, NEC', 'Electronic Equipment, Instruments & Components', 'Information Technology'),
('Electronic Components Nec', 'Electronic Equipment, Instruments & Components', 'Information Technology'),
('ELECTRONIC CONNECTORS', 'Electronic Equipment, Instruments & Components', 'Information Technology'),
('ELECTRONIC%INSTRUMENTS%', 'Electronic Equipment, Instruments & Components', 'Information Technology'),
('ELECTRONIC COILS%', 'Electronic Equipment, Instruments & Components', 'Information Technology'),
('ELECTRONIC COMPUTERS', 'Technology Hardware, Storage & Peripherals', 'Information Technology'),
('Electronic Computers', 'Technology Hardware, Storage & Peripherals', 'Information Technology'),
('COMPUTER PERIPHERAL EQUIPMENT%', 'Technology Hardware, Storage & Peripherals', 'Information Technology'),
('Computer Peripheral Equipment%', 'Technology Hardware, Storage & Peripherals', 'Information Technology'),
('COMPUTER STORAGE DEVICES', 'Technology Hardware, Storage & Peripherals', 'Information Technology'),
('COMPUTER COMMUNICATIONS EQUIPMENT', 'Communications Equipment', 'Information Technology'),
('Computer Communications Equipment', 'Communications Equipment', 'Information Technology'),
('RADIO & TV BROADCASTING & COMMUNICATIONS EQUIPMENT', 'Communications Equipment', 'Information Technology'),
('Radio Tv Broadcasting Communications Equipment', 'Communications Equipment', 'Information Technology'),
('MISCELLANEOUS ELECTRICAL MACHINERY%', 'Electronic Equipment, Instruments & Components', 'Information Technology'),
('Miscellaneous Electrical Machinery%', 'Electronic Equipment, Instruments & Components', 'Information Technology'),
('MEASURING & CONTROLLING DEVICES%', 'Electronic Equipment, Instruments & Components', 'Information Technology'),
('Measuring Controlling Devices%', 'Electronic Equipment, Instruments & Components', 'Information Technology'),
('INSTRUMENTS FOR MEASURING%', 'Electronic Equipment, Instruments & Components', 'Information Technology'),

-- FINANCIALS (sector_code=40)
('STATE COMMERCIAL BANKS', 'Banks', 'Financials'),
('State Commercial Banks', 'Banks', 'Financials'),
('NATIONAL COMMERCIAL BANKS', 'Banks', 'Financials'),
('National Commercial Banks', 'Banks', 'Financials'),
('COMMERCIAL BANKS, NEC', 'Banks', 'Financials'),
('Commercial Banks Nec', 'Banks', 'Financials'),
('SAVINGS INSTITUTION%', 'Thrifts & Mortgage Finance', 'Financials'),
('Savings Institution%', 'Thrifts & Mortgage Finance', 'Financials'),
('BLANK CHECKS', 'Diversified Financial Services', 'Financials'),
('Blank Checks', 'Diversified Financial Services', 'Financials'),
('INVESTMENT ADVICE', 'Capital Markets', 'Financials'),
('Investment Advice', 'Capital Markets', 'Financials'),
('FINANCE SERVICES', 'Financial Services', 'Financials'),
('Finance Services', 'Financial Services', 'Financials'),
('SECURITY BROKERS%', 'Capital Markets', 'Financials'),
('Security Brokers%', 'Capital Markets', 'Financials'),
('SECURITY & COMMODITY EXCHANGES', 'Capital Markets', 'Financials'),
('FIRE, MARINE & CASUALTY INSURANCE', 'Insurance', 'Financials'),
('Fire Marine Casualty Insurance', 'Insurance', 'Financials'),
('LIFE INSURANCE', 'Insurance', 'Financials'),
('Life Insurance', 'Insurance', 'Financials'),
('ACCIDENT & HEALTH INSURANCE', 'Insurance', 'Financials'),
('INSURANCE AGENTS%', 'Insurance', 'Financials'),
('INSURANCE CARRIERS, NEC', 'Insurance', 'Financials'),
('TITLE INSURANCE', 'Insurance', 'Financials'),
('SURETY INSURANCE', 'Insurance', 'Financials'),
('PERSONAL CREDIT INSTITUTIONS%', 'Consumer Finance', 'Financials'),
('Personal Credit Institutions%', 'Consumer Finance', 'Financials'),
('SHORT-TERM BUSINESS CREDIT%', 'Financial Services', 'Financials'),
('MORTGAGE BANKERS%', 'Thrifts & Mortgage Finance', 'Financials'),
('LOAN BROKERS', 'Financial Services', 'Financials'),
('REAL ESTATE INVESTMENT TRUSTS', 'Equity Real Estate Investment Trusts (Equity REITs)', 'Real Estate'),
('Real Estate Investment Trusts', 'Equity Real Estate Investment Trusts (Equity REITs)', 'Real Estate'),
('INVESTORS, NEC', 'Capital Markets', 'Financials'),
('SERVICES-MISC BUSINESS SERVICES', 'Financial Services', 'Financials'),
('FUNCTIONS RELATED TO DEPOSITORY BANKING%', 'Banks', 'Financials'),

-- CONSUMER DISCRETIONARY (sector_code=25)
('MOTOR VEHICLE PARTS & ACCESSORIES', 'Automobile Components', 'Consumer Discretionary'),
('Motor Vehicle Parts Accessories', 'Automobile Components', 'Consumer Discretionary'),
('MOTOR VEHICLES & PASSENGER CAR BODIES', 'Automobiles', 'Consumer Discretionary'),
('Motor Vehicles Passenger Car Bodies', 'Automobiles', 'Consumer Discretionary'),
('MOTORCYCLES, BICYCLES & PARTS', 'Automobiles', 'Consumer Discretionary'),
('TRUCK TRAILERS', 'Automobile Components', 'Consumer Discretionary'),
('SERVICES-EDUCATIONAL SERVICES', 'Diversified Consumer Services', 'Consumer Discretionary'),
('Services Educational Services', 'Diversified Consumer Services', 'Consumer Discretionary'),
('RETAIL-EATING PLACES', 'Hotels, Restaurants & Leisure', 'Consumer Discretionary'),
('Retail Eating Places', 'Hotels, Restaurants & Leisure', 'Consumer Discretionary'),
('Retail Eating Drinking Places', 'Hotels, Restaurants & Leisure', 'Consumer Discretionary'),
('RETAIL-EATING & DRINKING PLACES', 'Hotels, Restaurants & Leisure', 'Consumer Discretionary'),
('HOTELS & MOTELS', 'Hotels, Restaurants & Leisure', 'Consumer Discretionary'),
('Hotels Motels', 'Hotels, Restaurants & Leisure', 'Consumer Discretionary'),
('HOTELS, ROOMING HOUSES%', 'Hotels, Restaurants & Leisure', 'Consumer Discretionary'),
('AMUSEMENT & RECREATION SERVICES%', 'Hotels, Restaurants & Leisure', 'Consumer Discretionary'),
('SERVICES-AMUSEMENT & RECREATION%', 'Hotels, Restaurants & Leisure', 'Consumer Discretionary'),
('SERVICES-MISCELLANEOUS AMUSEMENT & RECREATION', 'Hotels, Restaurants & Leisure', 'Consumer Discretionary'),
('SERVICES-RACING%', 'Hotels, Restaurants & Leisure', 'Consumer Discretionary'),
('RETAIL-AUTO DEALERS%', 'Specialty Retail', 'Consumer Discretionary'),
('RETAIL-CATALOG & MAIL-ORDER%', 'Broadline Retail', 'Consumer Discretionary'),
('Retail Catalog Mail Order Houses', 'Broadline Retail', 'Consumer Discretionary'),
('RETAIL-DEPARTMENT STORES', 'Broadline Retail', 'Consumer Discretionary'),
('Retail Department Stores', 'Broadline Retail', 'Consumer Discretionary'),
('RETAIL-FAMILY CLOTHING STORES', 'Specialty Retail', 'Consumer Discretionary'),
('Retail Family Clothing Stores', 'Specialty Retail', 'Consumer Discretionary'),
('RETAIL-APPAREL & ACCESSORY STORES', 'Specialty Retail', 'Consumer Discretionary'),
('RETAIL-AUTO & HOME SUPPLY STORES', 'Specialty Retail', 'Consumer Discretionary'),
('RETAIL-BUILDING MATERIALS%', 'Specialty Retail', 'Consumer Discretionary'),
('Retail Lumber Other Building Materials Dealers', 'Specialty Retail', 'Consumer Discretionary'),
('RETAIL-HOBBY, TOY & GAME SHOPS', 'Specialty Retail', 'Consumer Discretionary'),
('RETAIL-FURNITURE STORES', 'Specialty Retail', 'Consumer Discretionary'),
('RETAIL-HOME FURNITURE%', 'Specialty Retail', 'Consumer Discretionary'),
('RETAIL-VARIETY STORES', 'Broadline Retail', 'Consumer Discretionary'),
('RETAIL-RETAIL STORES%', 'Broadline Retail', 'Consumer Discretionary'),
('RETAIL-COMPUTER & COMPUTER SOFTWARE STORES', 'Specialty Retail', 'Consumer Discretionary'),
('RETAIL-DRUG STORES AND PROPRIETARY STORES', 'Specialty Retail', 'Consumer Discretionary'),
('RETAIL-JEWELRY STORES', 'Specialty Retail', 'Consumer Discretionary'),
('RETAIL-SHOE STORES', 'Specialty Retail', 'Consumer Discretionary'),
('RETAIL-NONSTORE RETAILERS', 'Broadline Retail', 'Consumer Discretionary'),
('GAMES, TOYS & CHILDREN''S VEHICLES%', 'Leisure Products', 'Consumer Discretionary'),
('JEWELRY, SILVERWARE & PLATED WARE', 'Textiles, Apparel & Luxury Goods', 'Consumer Discretionary'),
('MISCELLANEOUS MANUFACTURING INDUSTRIES', 'Household Durables', 'Consumer Discretionary'),
('HOUSEHOLD FURNITURE', 'Household Durables', 'Consumer Discretionary'),
('HOUSEHOLD APPLIANCES%', 'Household Durables', 'Consumer Discretionary'),
('HOUSEHOLD AUDIO & VIDEO%', 'Household Durables', 'Consumer Discretionary'),
('OPERATIVE BUILDERS', 'Household Durables', 'Consumer Discretionary'),
('Operative Builders', 'Household Durables', 'Consumer Discretionary'),
('GENERAL BLDG CONTRACTORS%', 'Household Durables', 'Consumer Discretionary'),
('APPAREL & OTHER FINISHED PRODUCTS%', 'Textiles, Apparel & Luxury Goods', 'Consumer Discretionary'),
('Apparel Other Finished Products%', 'Textiles, Apparel & Luxury Goods', 'Consumer Discretionary'),
('WOMEN''S, MISSES%', 'Textiles, Apparel & Luxury Goods', 'Consumer Discretionary'),
('MEN''S & BOYS'' FURNISHINGS%', 'Textiles, Apparel & Luxury Goods', 'Consumer Discretionary'),
('FOOTWEAR%', 'Textiles, Apparel & Luxury Goods', 'Consumer Discretionary'),
('Footwear%', 'Textiles, Apparel & Luxury Goods', 'Consumer Discretionary'),
('SERVICES-MOTION PICTURE%', 'Entertainment', 'Communication Services'),
('SERVICES-VIDEO TAPE RENTAL', 'Entertainment', 'Communication Services'),

-- AIRCRAFT / DEFENSE → Aerospace & Defense under INDUSTRIALS
('AIRCRAFT', 'Aerospace & Defense', 'Industrials'),
('Aircraft', 'Aerospace & Defense', 'Industrials'),
('AIRCRAFT & PARTS', 'Aerospace & Defense', 'Industrials'),
('AIRCRAFT ENGINES & ENGINE PARTS', 'Aerospace & Defense', 'Industrials'),
('AIRCRAFT PARTS & AUXILIARY EQUIPMENT%', 'Aerospace & Defense', 'Industrials'),
('GUIDED MISSILES & SPACE VEHICLES%', 'Aerospace & Defense', 'Industrials'),
('SHIP & BOAT BUILDING & REPAIRING', 'Aerospace & Defense', 'Industrials'),
('ORDNANCE & ACCESSORIES%', 'Aerospace & Defense', 'Industrials'),
('SEARCH, DETECTION, NAVIGATION%', 'Aerospace & Defense', 'Industrials'),
('RAILROAD EQUIPMENT', 'Machinery', 'Industrials'),

-- INDUSTRIALS (sector_code=20)
('SERVICES-MANAGEMENT CONSULTING%', 'Professional Services', 'Industrials'),
('Services Management Consulting%', 'Professional Services', 'Industrials'),
('SERVICES-ENGINEERING SERVICES', 'Construction & Engineering', 'Industrials'),
('Services Engineering Services', 'Construction & Engineering', 'Industrials'),
('SERVICES-DETECTIVE, GUARD & ARMORED CAR SERVICES', 'Commercial Services & Supplies', 'Industrials'),
('SERVICES-HELP SUPPLY SERVICES', 'Professional Services', 'Industrials'),
('Services Help Supply Services', 'Professional Services', 'Industrials'),
('SERVICES-ADVERTISING%', 'Professional Services', 'Industrials'),
('Services Advertising%', 'Professional Services', 'Industrials'),
('SERVICES-STAFFING%', 'Professional Services', 'Industrials'),
('SERVICES-ACCOUNTING%', 'Professional Services', 'Industrials'),
('SERVICES-MISC GENERAL GOVERNMENT', 'Professional Services', 'Industrials'),
('SERVICES-FACILITIES SUPPORT MANAGEMENT%', 'Commercial Services & Supplies', 'Industrials'),
('HEAVY CONSTRUCTION%', 'Construction & Engineering', 'Industrials'),
('Heavy Construction%', 'Construction & Engineering', 'Industrials'),
('CONSTRUCTION SPECIAL TRADE%', 'Construction & Engineering', 'Industrials'),
('TRUCKING%', 'Ground Transportation', 'Industrials'),
('Trucking%', 'Ground Transportation', 'Industrials'),
('AIR TRANSPORTATION%', 'Passenger Airlines', 'Industrials'),
('Air Transportation%', 'Passenger Airlines', 'Industrials'),
('RAILROADS%', 'Ground Transportation', 'Industrials'),
('DEEP SEA FOREIGN TRANSPORTATION%', 'Marine Transportation', 'Industrials'),
('ARRANGEMENT OF TRANSPORTATION%', 'Air Freight & Logistics', 'Industrials'),
('SERVICES-EQUIPMENT RENTAL & LEASING%', 'Trading Companies & Distributors', 'Industrials'),
('FARM MACHINERY & EQUIPMENT', 'Machinery', 'Industrials'),
('Farm Machinery Equipment', 'Machinery', 'Industrials'),
('CONSTRUCTION MACHINERY & EQUIP', 'Machinery', 'Industrials'),
('SPECIAL INDUSTRY MACHINERY%', 'Machinery', 'Industrials'),
('Special Industry Machinery%', 'Machinery', 'Industrials'),
('GENERAL INDUSTRIAL MACHINERY%', 'Machinery', 'Industrials'),
('General Industrial Machinery%', 'Machinery', 'Industrials'),
('INDUSTRIAL & COMMERCIAL MACHINERY%', 'Machinery', 'Industrials'),
('Industrial Commercial Machinery%', 'Machinery', 'Industrials'),
('METALWORKING MACHINERY%', 'Machinery', 'Industrials'),
('Metalworking Machinery%', 'Machinery', 'Industrials'),
('REFRIGERATION & HEATING EQUIPMENT', 'Building Products', 'Industrials'),
('PUMPS & PUMPING EQUIPMENT', 'Machinery', 'Industrials'),
('BALL & ROLLER BEARINGS', 'Machinery', 'Industrials'),
('INDUSTRIAL TRUCKS%', 'Machinery', 'Industrials'),
('ELECTRIC LIGHTING & WIRING%', 'Electrical Equipment', 'Industrials'),
('MOTORS & GENERATORS', 'Electrical Equipment', 'Industrials'),
('SWITCHGEAR & SWITCHBOARD APPARATUS', 'Electrical Equipment', 'Industrials'),
('ELECTRICAL INDUSTRIAL APPARATUS%', 'Electrical Equipment', 'Industrials'),
('ELECTRICAL APPARATUS & EQUIPMENT%', 'Electrical Equipment', 'Industrials'),
('HOUSEHOLD LAUNDRY MACHINES', 'Electrical Equipment', 'Industrials'),
('SERVICES-TO DWELLINGS & OTHER BUILDINGS', 'Commercial Services & Supplies', 'Industrials'),
('SERVICES-SERVICES, NEC', 'Professional Services', 'Industrials'),
('SERVICES-PHOTOFINISHING LABORATORIES', 'Commercial Services & Supplies', 'Industrials'),
('REFUSE SYSTEMS', 'Commercial Services & Supplies', 'Industrials'),
('WATER, SEWER, PIPELINE%', 'Construction & Engineering', 'Industrials'),

-- ENERGY (sector_code=10)
('CRUDE PETROLEUM & NATURAL GAS', 'Oil, Gas & Consumable Fuels', 'Energy'),
('Crude Petroleum Natural Gas', 'Oil, Gas & Consumable Fuels', 'Energy'),
('PETROLEUM REFINING', 'Oil, Gas & Consumable Fuels', 'Energy'),
('Petroleum Refining', 'Oil, Gas & Consumable Fuels', 'Energy'),
('NATURAL GAS DISTRIBUTION', 'Oil, Gas & Consumable Fuels', 'Energy'),
('Natural Gas Distribution', 'Oil, Gas & Consumable Fuels', 'Energy'),
('NATURAL GAS TRANSMISSION%', 'Oil, Gas & Consumable Fuels', 'Energy'),
('OIL & GAS FIELD SERVICES%', 'Energy Equipment & Services', 'Energy'),
('Oil Gas Field Services%', 'Energy Equipment & Services', 'Energy'),
('DRILLING OIL & GAS WELLS', 'Energy Equipment & Services', 'Energy'),
('Drilling Oil Gas Wells', 'Energy Equipment & Services', 'Energy'),
('NATURAL GAS LIQUIDS', 'Oil, Gas & Consumable Fuels', 'Energy'),
('PETROLEUM & PETROLEUM PRODUCTS%', 'Oil, Gas & Consumable Fuels', 'Energy'),
('BITUMINOUS COAL%', 'Oil, Gas & Consumable Fuels', 'Energy'),

-- MATERIALS (sector_code=15)
('STEEL WORKS%', 'Metals & Mining', 'Materials'),
('Steel Works%', 'Metals & Mining', 'Materials'),
('PRIMARY SMELTING%', 'Metals & Mining', 'Materials'),
('GOLD AND SILVER ORES MINING', 'Metals & Mining', 'Materials'),
('Gold Silver Ores Mining', 'Metals & Mining', 'Materials'),
('GOLD MINING', 'Metals & Mining', 'Materials'),
('COPPER ORES', 'Metals & Mining', 'Materials'),
('METAL MINING, NEC', 'Metals & Mining', 'Materials'),
('MISCELLANEOUS METAL ORES', 'Metals & Mining', 'Materials'),
('IRON ORES', 'Metals & Mining', 'Materials'),
('ALUMINUM%', 'Metals & Mining', 'Materials'),
('ROLLING DRAWING%', 'Metals & Mining', 'Materials'),
('FABRICATED PLATE WORK%', 'Metals & Mining', 'Materials'),
('INDUSTRIAL INORGANIC CHEMICALS', 'Chemicals', 'Materials'),
('Industrial Inorganic Chemicals', 'Chemicals', 'Materials'),
('INDUSTRIAL ORGANIC CHEMICALS', 'Chemicals', 'Materials'),
('Industrial Organic Chemicals', 'Chemicals', 'Materials'),
('PLASTICS MATERIALS%', 'Chemicals', 'Materials'),
('Plastics Materials%', 'Chemicals', 'Materials'),
('AGRICULTURAL CHEMICALS', 'Chemicals', 'Materials'),
('SPECIALTY CLEANING%', 'Chemicals', 'Materials'),
('ADHESIVES AND SEALANTS', 'Chemicals', 'Materials'),
('PAINTS, VARNISHES%', 'Chemicals', 'Materials'),
('CEMENT, HYDRAULIC', 'Construction Materials', 'Materials'),
('CONCRETE, GYPSUM%', 'Construction Materials', 'Materials'),
('MINING & QUARRYING%', 'Construction Materials', 'Materials'),
('PAPERBOARD CONTAINERS & BOXES', 'Containers & Packaging', 'Materials'),
('METAL CANS', 'Containers & Packaging', 'Materials'),
('CONVERTED PAPER%', 'Containers & Packaging', 'Materials'),
('GLASS CONTAINERS', 'Containers & Packaging', 'Materials'),
('PAPER MILLS', 'Paper & Forest Products', 'Materials'),
('PULP MILLS', 'Paper & Forest Products', 'Materials'),
('LUMBER & WOOD PRODUCTS%', 'Paper & Forest Products', 'Materials'),

-- CONSUMER STAPLES (sector_code=30)
('BEVERAGES', 'Beverages', 'Consumer Staples'),
('Beverages', 'Beverages', 'Consumer Staples'),
('MALT BEVERAGES', 'Beverages', 'Consumer Staples'),
('BOTTLED & CANNED SOFT DRINKS%', 'Beverages', 'Consumer Staples'),
('DAIRY PRODUCTS', 'Food Products', 'Consumer Staples'),
('Dairy Products', 'Food Products', 'Consumer Staples'),
('CANNED, FROZEN%', 'Food Products', 'Consumer Staples'),
('Canned Frozen%', 'Food Products', 'Consumer Staples'),
('GRAIN MILL PRODUCTS', 'Food Products', 'Consumer Staples'),
('SUGAR & CONFECTIONERY PRODUCTS', 'Food Products', 'Consumer Staples'),
('MEAT PACKING PLANTS', 'Food Products', 'Consumer Staples'),
('SAUSAGES%', 'Food Products', 'Consumer Staples'),
('FATS & OILS', 'Food Products', 'Consumer Staples'),
('FOOD AND KINDRED PRODUCTS%', 'Food Products', 'Consumer Staples'),
('CIGARETTES', 'Tobacco', 'Consumer Staples'),
('TOBACCO%', 'Tobacco', 'Consumer Staples'),
('SOAP%', 'Household Products', 'Consumer Staples'),
('Soap%', 'Household Products', 'Consumer Staples'),
('PERFUMES, COSMETICS%', 'Personal Care Products', 'Consumer Staples'),
('Perfumes Cosmetics%', 'Personal Care Products', 'Consumer Staples'),
('WHOLESALE-GROCERIES%', 'Consumer Staples Distribution & Retail', 'Consumer Staples'),
('RETAIL-GROCERY STORES', 'Consumer Staples Distribution & Retail', 'Consumer Staples'),

-- UTILITIES (sector_code=55)
('ELECTRIC SERVICES', 'Electric Utilities', 'Utilities'),
('Electric Services', 'Electric Utilities', 'Utilities'),
('GAS & OTHER SERVICES COMBINED', 'Multi-Utilities', 'Utilities'),
('COMBINATION ELECTRIC & GAS%', 'Multi-Utilities', 'Utilities'),
('WATER SUPPLY', 'Water Utilities', 'Utilities'),
('ELECTRIC AND OTHER SERVICES COMBINED', 'Multi-Utilities', 'Utilities'),

-- COMMUNICATION SERVICES (sector_code=50)
('TELEPHONE COMMUNICATIONS%', 'Diversified Telecommunication Services', 'Communication Services'),
('Telephone Communications%', 'Diversified Telecommunication Services', 'Communication Services'),
('TELEGRAPH & OTHER MESSAGE%', 'Diversified Telecommunication Services', 'Communication Services'),
('COMMUNICATIONS SERVICES, NEC', 'Diversified Telecommunication Services', 'Communication Services'),
('CABLE & OTHER PAY TELEVISION%', 'Media', 'Communication Services'),
('Cable Other Pay Television%', 'Media', 'Communication Services'),
('RADIO BROADCASTING%', 'Media', 'Communication Services'),
('TELEVISION BROADCASTING%', 'Media', 'Communication Services'),

-- REAL ESTATE (sector_code=60)
('REAL ESTATE', 'Real Estate Management & Development', 'Real Estate'),
('Real Estate', 'Real Estate Management & Development', 'Real Estate'),
('LAND SUBDIVIDERS%', 'Real Estate Management & Development', 'Real Estate'),

-- WHOLESALERS → Distributors (Consumer Discretionary) or Trading Companies (Industrials)
('WHOLESALE-ELECTRONIC PARTS%', 'Trading Companies & Distributors', 'Industrials'),
('WHOLESALE-INDUSTRIAL MACHINERY%', 'Trading Companies & Distributors', 'Industrials'),
('WHOLESALE-MISCELLANEOUS%', 'Trading Companies & Distributors', 'Industrials'),
('WHOLESALE-MEDICAL%', 'Health Care Providers & Services', 'Health Care'),
('WHOLESALE-DRUGS%', 'Health Care Providers & Services', 'Health Care'),
('WHOLESALE-PETROLEUM%', 'Oil, Gas & Consumable Fuels', 'Energy'),
('WHOLESALE-METALS%', 'Trading Companies & Distributors', 'Industrials'),
('WHOLESALE-HARDWARE%', 'Trading Companies & Distributors', 'Industrials'),
('WHOLESALE-LUMBER%', 'Trading Companies & Distributors', 'Industrials'),
('WHOLESALE-FARM PRODUCT%', 'Food Products', 'Consumer Staples')
;

-- ============================================================
-- STEP 3: Apply mappings to symbols table
-- ============================================================
UPDATE symbols s
SET 
  canonical_industry = m.gics_industry,
  canonical_sector = m.gics_sector
FROM sic_gics_map m
WHERE s.is_active = true
  AND s.canonical_industry IS NOT NULL
  AND s.canonical_industry LIKE m.sic_pattern;

-- Also fix "Stocks Proxy Basket" - these are likely equities that got a bad label
UPDATE symbols 
SET canonical_industry = NULL, canonical_sector = NULL
WHERE canonical_industry = 'Stocks Proxy Basket' AND is_active = true;

-- Fix symbols with sector = 'Stocks' - clear their bad canonical fields
UPDATE symbols 
SET canonical_sector = NULL 
WHERE canonical_sector = 'Stocks' AND is_active = true;

-- ============================================================
-- STEP 4: Fix coverage RPC - correct denominators
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_universe_coverage_detailed()
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  WITH equity AS (
    SELECT symbol, canonical_sector, canonical_industry
    FROM symbols 
    WHERE is_active = true 
      AND COALESCE(is_etf, false) = false 
      AND universe_tier NOT IN ('benchmark')
  ),
  eq_count AS (SELECT COUNT(*) AS n FROM equity),
  -- Price history: only count equity symbols that have price data
  price_eq AS (
    SELECT COUNT(DISTINCT dp.symbol) AS n
    FROM daily_prices dp
    JOIN equity e ON e.symbol = dp.symbol
  ),
  -- Indicators: only count equity symbols
  ind_eq AS (
    SELECT COUNT(DISTINCT wi.symbol) AS n
    FROM wsp_indicators wi
    JOIN equity e ON e.symbol = wi.symbol
  ),
  -- WSP evaluated: only equity symbols in scan results
  wsp_eq AS (
    SELECT COUNT(DISTINCT msr.symbol) AS n
    FROM market_scan_results msr
    JOIN equity e ON e.symbol = msr.symbol
  )
  SELECT jsonb_build_object(
    'active_universe', (SELECT COUNT(*) FROM symbols WHERE is_active = true),
    'equity_universe', (SELECT n FROM eq_count),
    'canonically_mapped_sector', (
      SELECT COUNT(*) FROM equity e
      WHERE e.canonical_sector IS NOT NULL 
        AND EXISTS (SELECT 1 FROM canonical_gics_sectors cgs WHERE cgs.sector_name = e.canonical_sector)
    ),
    'canonically_mapped_industry', (
      SELECT COUNT(*) FROM equity e
      WHERE e.canonical_industry IS NOT NULL 
        AND EXISTS (SELECT 1 FROM canonical_gics_industries gi WHERE gi.industry_name = e.canonical_industry)
    ),
    'price_history_ready', (SELECT n FROM price_eq),
    'indicator_ready', (SELECT n FROM ind_eq),
    'wsp_evaluated', (SELECT n FROM wsp_eq),
    'public_eligible', (
      SELECT COUNT(DISTINCT r.symbol)
      FROM market_scan_results_latest r
      JOIN equity e ON e.symbol = r.symbol
      JOIN symbols s ON s.symbol = r.symbol
      WHERE s.canonical_sector IS NOT NULL
        AND EXISTS (SELECT 1 FROM canonical_gics_sectors cgs WHERE cgs.sector_name = s.canonical_sector)
        AND s.canonical_industry IS NOT NULL
        AND EXISTS (SELECT 1 FROM canonical_gics_industries gi WHERE gi.industry_name = s.canonical_industry)
    ),
    'core_tier', (SELECT COUNT(*) FROM symbols WHERE universe_tier = 'core' AND is_active = true),
    'expanded_tier', (SELECT COUNT(*) FROM symbols WHERE universe_tier = 'expanded' AND is_active = true),
    'benchmark_tier', (SELECT COUNT(*) FROM symbols WHERE universe_tier = 'benchmark' AND is_active = true),
    'unmapped_industry_count', (
      SELECT COUNT(*) FROM equity e
      WHERE e.canonical_industry IS NULL 
        OR NOT EXISTS (SELECT 1 FROM canonical_gics_industries gi WHERE gi.industry_name = e.canonical_industry)
    )
  );
$$;

-- ============================================================
-- STEP 5: Fix health check - 11 sectors not 15
-- ============================================================
-- Update the sector count check in run_pipeline_health_checks
-- We need to drop and recreate since the function is complex
-- Just update the sector count portion
CREATE OR REPLACE FUNCTION public.run_pipeline_health_checks()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'America/New_York')::date;
  v_dow int := EXTRACT(DOW FROM v_today);
  v_is_weekend boolean := v_dow IN (0, 6);
  v_price_warn_hours int := CASE WHEN v_is_weekend THEN 72 ELSE 26 END;
  v_price_crit_hours int := CASE WHEN v_is_weekend THEN 96 ELSE 48 END;
  v_latest_price_date date;
  v_latest_indicator_date date;
  v_latest_scan_completed timestamptz;
  v_latest_scan_symbols bigint;
  v_prev_scan_symbols bigint;
  v_benchmark_date date;
  v_stale_jobs int;
  v_price_symbols bigint;
  v_indicator_symbols bigint;
  v_screener_symbols bigint;
  v_sector_count int;
  v_canonical_industry_count int;
  v_unmapped_industry_count int;
  v_backfill_remaining bigint;
  v_status text;
  v_msg text;
BEGIN
  DELETE FROM public.pipeline_health_checks;

  SELECT MAX(date) INTO v_latest_price_date FROM daily_prices;
  SELECT MAX(calc_date) INTO v_latest_indicator_date FROM wsp_indicators;
  
  SELECT completed_at, symbols_scanned INTO v_latest_scan_completed, v_latest_scan_symbols
  FROM market_scan_runs WHERE status IN ('completed', 'partial')
  ORDER BY completed_at DESC NULLS LAST LIMIT 1;

  SELECT symbols_scanned INTO v_prev_scan_symbols
  FROM market_scan_runs WHERE status IN ('completed', 'partial')
  ORDER BY completed_at DESC NULLS LAST LIMIT 1 OFFSET 1;

  SELECT MAX(calc_date) INTO v_benchmark_date
  FROM wsp_indicators WHERE symbol IN ('SPY', 'QQQ');

  SELECT COUNT(*) INTO v_stale_jobs
  FROM data_sync_log WHERE status = 'running' AND started_at < v_now - INTERVAL '30 minutes';

  -- Count only equity symbols (not benchmarks/ETFs)
  SELECT COUNT(DISTINCT dp.symbol) INTO v_price_symbols 
  FROM daily_prices dp 
  JOIN symbols s ON s.symbol = dp.symbol 
  WHERE s.is_active = true AND COALESCE(s.is_etf, false) = false AND s.universe_tier != 'benchmark';
  
  SELECT COUNT(DISTINCT wi.symbol) INTO v_indicator_symbols 
  FROM wsp_indicators wi 
  JOIN symbols s ON s.symbol = wi.symbol 
  WHERE s.is_active = true AND COALESCE(s.is_etf, false) = false AND s.universe_tier != 'benchmark';
  
  SELECT COUNT(DISTINCT r.symbol) INTO v_screener_symbols 
  FROM market_scan_results_latest r
  JOIN symbols s ON s.symbol = r.symbol 
  WHERE s.is_active = true AND COALESCE(s.is_etf, false) = false;

  -- Count canonical GICS sectors present in equity symbols
  SELECT COUNT(DISTINCT s.canonical_sector) INTO v_sector_count
  FROM symbols s
  WHERE s.is_active = true AND COALESCE(s.is_etf, false) = false
    AND s.canonical_sector IS NOT NULL
    AND EXISTS (SELECT 1 FROM canonical_gics_sectors cgs WHERE cgs.sector_name = s.canonical_sector);

  -- Count symbols with valid canonical GICS industry
  SELECT COUNT(*) INTO v_canonical_industry_count
  FROM symbols s
  WHERE s.is_active = true AND COALESCE(s.is_etf, false) = false AND s.universe_tier != 'benchmark'
    AND s.canonical_industry IS NOT NULL
    AND EXISTS (SELECT 1 FROM canonical_gics_industries gi WHERE gi.industry_name = s.canonical_industry);

  SELECT COUNT(*) INTO v_unmapped_industry_count
  FROM symbols s
  WHERE s.is_active = true AND COALESCE(s.is_etf, false) = false AND s.universe_tier != 'benchmark'
    AND (s.canonical_industry IS NULL 
      OR NOT EXISTS (SELECT 1 FROM canonical_gics_industries gi WHERE gi.industry_name = s.canonical_industry));

  SELECT COUNT(*) INTO v_backfill_remaining
  FROM symbols s
  LEFT JOIN (SELECT symbol, COUNT(*) AS bars FROM daily_prices GROUP BY symbol) pc ON pc.symbol = s.symbol
  WHERE s.is_active = true AND s.eligible_for_backfill = true AND COALESCE(pc.bars, 0) < 260;

  -- CHECK 1: Price freshness
  IF v_latest_price_date IS NULL THEN
    v_status := 'critical'; v_msg := 'No price data exists';
  ELSIF v_now - (v_latest_price_date + TIME '21:30')::timestamptz > (v_price_crit_hours || ' hours')::interval THEN
    v_status := 'critical'; v_msg := 'Price data is critically stale: ' || v_latest_price_date::text;
  ELSIF v_now - (v_latest_price_date + TIME '21:30')::timestamptz > (v_price_warn_hours || ' hours')::interval THEN
    v_status := 'warning'; v_msg := 'Price data may be stale: ' || v_latest_price_date::text;
  ELSE
    v_status := 'ok'; v_msg := 'Price data fresh: ' || v_latest_price_date::text;
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'price_freshness', v_status, v_msg, v_latest_price_date::text,
    v_price_warn_hours || 'h warn / ' || v_price_crit_hours || 'h crit');

  -- CHECK 2: Indicator freshness
  IF v_latest_indicator_date IS NULL THEN
    v_status := 'critical'; v_msg := 'No indicator data exists';
  ELSIF v_latest_indicator_date < v_latest_price_date - 1 THEN
    v_status := 'critical'; v_msg := 'Indicators lag prices by >1 day: ' || v_latest_indicator_date::text || ' vs ' || v_latest_price_date::text;
  ELSIF v_latest_indicator_date < v_latest_price_date THEN
    v_status := 'warning'; v_msg := 'Indicators 1 day behind prices: ' || v_latest_indicator_date::text;
  ELSE
    v_status := 'ok'; v_msg := 'Indicators aligned with prices: ' || v_latest_indicator_date::text;
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'indicator_freshness', v_status, v_msg, v_latest_indicator_date::text, 'must match latest price date');

  -- CHECK 3: Scan freshness
  IF v_latest_scan_completed IS NULL THEN
    v_status := 'critical'; v_msg := 'No completed scan found';
  ELSIF v_now - v_latest_scan_completed > (v_price_crit_hours || ' hours')::interval THEN
    v_status := 'critical'; v_msg := 'Last scan critically stale: ' || v_latest_scan_completed::text;
  ELSIF v_now - v_latest_scan_completed > (v_price_warn_hours || ' hours')::interval THEN
    v_status := 'warning'; v_msg := 'Scan may be stale: ' || v_latest_scan_completed::text;
  ELSE
    v_status := 'ok'; v_msg := 'Scan fresh: ' || v_latest_scan_completed::text;
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'scan_freshness', v_status, v_msg, v_latest_scan_completed::text,
    v_price_warn_hours || 'h warn / ' || v_price_crit_hours || 'h crit');

  -- CHECK 4: Benchmark freshness
  IF v_benchmark_date IS NULL THEN
    v_status := 'critical'; v_msg := 'No benchmark indicator data';
  ELSIF v_benchmark_date < v_latest_price_date - 1 THEN
    v_status := 'warning'; v_msg := 'Benchmark data behind: ' || v_benchmark_date::text;
  ELSE
    v_status := 'ok'; v_msg := 'Benchmark data fresh: ' || v_benchmark_date::text;
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'benchmark_freshness', v_status, v_msg, v_benchmark_date::text, 'must match latest price date');

  -- CHECK 5: GICS sector coverage (must be exactly 11)
  IF v_sector_count = 11 THEN
    v_status := 'ok'; v_msg := 'All 11 canonical GICS sectors represented';
  ELSIF v_sector_count >= 9 THEN
    v_status := 'warning'; v_msg := v_sector_count || ' of 11 GICS sectors have equity coverage';
  ELSE
    v_status := 'critical'; v_msg := 'Only ' || v_sector_count || ' of 11 GICS sectors have equity coverage';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'gics_sector_coverage', v_status, v_msg, v_sector_count::text, '11');

  -- CHECK 6: Canonical industry coverage
  IF v_unmapped_industry_count = 0 THEN
    v_status := 'ok'; v_msg := 'All equity symbols have canonical GICS industry';
  ELSIF v_unmapped_industry_count < 500 THEN
    v_status := 'warning'; v_msg := v_unmapped_industry_count || ' equity symbols lack canonical GICS industry (of ' || (v_canonical_industry_count + v_unmapped_industry_count) || ' total)';
  ELSE
    v_status := 'critical'; v_msg := v_unmapped_industry_count || ' equity symbols lack canonical GICS industry (of ' || (v_canonical_industry_count + v_unmapped_industry_count) || ' total)';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'gics_industry_coverage', v_status, v_msg, 
    v_canonical_industry_count || ' mapped / ' || v_unmapped_industry_count || ' unmapped', '< 500 unmapped');

  -- CHECK 7: Stale jobs
  IF v_stale_jobs > 0 THEN
    v_status := 'warning'; v_msg := v_stale_jobs || ' jobs stuck in running state > 30 min';
  ELSE
    v_status := 'ok'; v_msg := 'No stale jobs';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'stale_jobs', v_status, v_msg, v_stale_jobs::text, '0');

  -- CHECK 8: Scan population stability
  IF v_latest_scan_symbols IS NOT NULL AND v_prev_scan_symbols IS NOT NULL AND v_prev_scan_symbols > 0 THEN
    IF v_latest_scan_symbols < v_prev_scan_symbols * 0.90 THEN
      v_status := 'critical'; v_msg := 'Scan population dropped >10%: ' || v_latest_scan_symbols || ' vs prev ' || v_prev_scan_symbols;
    ELSE
      v_status := 'ok'; v_msg := 'Scan population stable: ' || v_latest_scan_symbols;
    END IF;
  ELSE
    v_status := 'ok'; v_msg := 'Scan population: ' || COALESCE(v_latest_scan_symbols::text, 'N/A');
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'scan_population_stability', v_status, v_msg, 
    COALESCE(v_latest_scan_symbols::text, '0'), '>= 90% of previous');

  -- CHECK 9: Backfill remaining
  IF v_backfill_remaining = 0 THEN
    v_status := 'ok'; v_msg := 'All backfill-eligible symbols have >= 260 bars';
  ELSIF v_backfill_remaining < 100 THEN
    v_status := 'ok'; v_msg := v_backfill_remaining || ' symbols still need history backfill';
  ELSE
    v_status := 'warning'; v_msg := v_backfill_remaining || ' symbols need history backfill (< 260 bars)';
  END IF;
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'backfill_remaining', v_status, v_msg, v_backfill_remaining::text, '< 100');

  -- CHECK 10: Price/Indicator/Screener equity coverage
  INSERT INTO pipeline_health_checks (run_id, check_name, status, message, current_value, threshold)
  VALUES (v_run_id, 'equity_pipeline_coverage', 'info', 
    'Equity pipeline: ' || v_price_symbols || ' with prices → ' || v_indicator_symbols || ' with indicators → ' || v_screener_symbols || ' in screener',
    v_price_symbols || '/' || v_indicator_symbols || '/' || v_screener_symbols, 'info only');

  RETURN v_run_id;
END;
$function$;
