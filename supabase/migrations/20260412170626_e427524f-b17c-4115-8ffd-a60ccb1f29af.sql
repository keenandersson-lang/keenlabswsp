
-- 1. Industry display taxonomy function
CREATE OR REPLACE FUNCTION public.display_industry(raw_industry text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    -- Technology
    WHEN raw_industry ILIKE '%SEMICONDUCTOR%' THEN 'Semiconductors'
    WHEN raw_industry ILIKE '%PRINTED CIRCUIT%' THEN 'Semiconductors'
    WHEN raw_industry ILIKE '%ELECTRONIC COMPONENT%' THEN 'Electronic Components'
    WHEN raw_industry ILIKE '%ELECTRONIC CONNECTOR%' THEN 'Electronic Components'
    WHEN raw_industry ILIKE '%ELECTRONIC COIL%' THEN 'Electronic Components'
    WHEN raw_industry ILIKE '%COMPUTER COMMUNICATIONS%' THEN 'Networking Equipment'
    WHEN raw_industry ILIKE '%COMMUNICATIONS EQUIPMENT%' THEN 'Communications Equipment'
    WHEN raw_industry ILIKE '%COMPUTER PERIPHERAL%' THEN 'Computer Hardware'
    WHEN raw_industry ILIKE '%COMPUTER & OFFICE%' THEN 'Computer Hardware'
    WHEN raw_industry ILIKE '%CALCULATING%' THEN 'Computer Hardware'
    WHEN raw_industry ILIKE '%ELECTRONIC%COMPUTER%' THEN 'Computer Hardware'
    WHEN raw_industry ILIKE '%PREPACKAGED SOFTWARE%' THEN 'Software'
    WHEN raw_industry ILIKE '%SOFTWARE%' THEN 'Software'
    WHEN raw_industry ILIKE '%INFORMATION RETRIEVAL%' THEN 'IT Services'
    WHEN raw_industry ILIKE '%COMPUTER PROCESSING%' THEN 'IT Services'
    WHEN raw_industry ILIKE '%COMPUTER INTEGRATED%' THEN 'IT Services'
    WHEN raw_industry ILIKE '%COMPUTER PROGRAMMING%' THEN 'IT Services'
    WHEN raw_industry ILIKE '%COMPUTER RENTAL%' THEN 'IT Services'
    WHEN raw_industry ILIKE 'Information Technology%' THEN 'IT Services'
    WHEN raw_industry ILIKE '%PATENT OWNERS%' THEN 'IT Services'
    WHEN raw_industry ILIKE '%OPTICAL INSTRUMENT%' THEN 'Scientific Instruments'
    WHEN raw_industry ILIKE '%MEASURING & CONTROLLING%' THEN 'Scientific Instruments'
    WHEN raw_industry ILIKE '%LABORATORY%INSTRUMENT%' THEN 'Scientific Instruments'
    WHEN raw_industry ILIKE '%SEARCH, DETECTION%' THEN 'Defense Electronics'
    
    -- Healthcare
    WHEN raw_industry ILIKE '%PHARMACEUTICAL%' THEN 'Pharmaceuticals'
    WHEN raw_industry ILIKE '%Drug Manufacturer%' THEN 'Pharmaceuticals'
    WHEN raw_industry ILIKE '%BIOLOGICAL PRODUCT%' THEN 'Biotechnology'
    WHEN raw_industry ILIKE '%Biotechnology%' THEN 'Biotechnology'
    WHEN raw_industry ILIKE '%IN VITRO%' THEN 'Diagnostics'
    WHEN raw_industry ILIKE '%SURGICAL & MEDICAL%' THEN 'Medical Devices'
    WHEN raw_industry ILIKE '%ELECTROMEDICAL%' THEN 'Medical Devices'
    WHEN raw_industry ILIKE '%Medical Device%' THEN 'Medical Devices'
    WHEN raw_industry ILIKE '%Medical Instrument%' THEN 'Medical Devices'
    WHEN raw_industry ILIKE '%DENTAL EQUIPMENT%' THEN 'Medical Devices'
    WHEN raw_industry ILIKE '%ORTHOPEDIC%' THEN 'Medical Devices'
    WHEN raw_industry ILIKE '%HOSPITAL%' THEN 'Healthcare Services'
    WHEN raw_industry ILIKE '%HEALTH SERVICES%' THEN 'Healthcare Services'
    WHEN raw_industry ILIKE '%SERVICES-HEALTH%' THEN 'Healthcare Services'
    WHEN raw_industry ILIKE '%HOME HEALTH CARE%' THEN 'Healthcare Services'
    WHEN raw_industry ILIKE '%MEDICAL LABORATORIES%' THEN 'Healthcare Services'
    WHEN raw_industry ILIKE '%Health Care%' THEN 'Healthcare Services'
    WHEN raw_industry ILIKE '%Managed Health%' THEN 'Healthcare Services'
    
    -- Financials
    WHEN raw_industry ILIKE '%NATIONAL COMMERCIAL BANK%' THEN 'Banks'
    WHEN raw_industry ILIKE '%STATE COMMERCIAL BANK%' THEN 'Banks'
    WHEN raw_industry ILIKE '%COMMERCIAL BANKS%' THEN 'Banks'
    WHEN raw_industry ILIKE '%SAVINGS INSTITUTION%' THEN 'Banks'
    WHEN raw_industry ILIKE 'Banks' THEN 'Banks'
    WHEN raw_industry ILIKE '%FUNCTIONS RELATED TO DEPOSITORY%' THEN 'Banks'
    WHEN raw_industry ILIKE '%INSURANCE AGENT%' THEN 'Insurance'
    WHEN raw_industry ILIKE '%FIRE, MARINE%' THEN 'Insurance'
    WHEN raw_industry ILIKE '%LIFE INSURANCE%' THEN 'Insurance'
    WHEN raw_industry ILIKE '%ACCIDENT & HEALTH%' THEN 'Insurance'
    WHEN raw_industry ILIKE '%SURETY INSURANCE%' THEN 'Insurance'
    WHEN raw_industry ILIKE '%Insurance%' THEN 'Insurance'
    WHEN raw_industry ILIKE '%SECURITY & COMMODITY%' THEN 'Capital Markets'
    WHEN raw_industry ILIKE '%INVESTMENT ADVICE%' THEN 'Capital Markets'
    WHEN raw_industry ILIKE '%COMMODITY CONTRACT%' THEN 'Capital Markets'
    WHEN raw_industry ILIKE '%Capital Markets%' THEN 'Capital Markets'
    WHEN raw_industry ILIKE '%FINANCE SERVICES%' THEN 'Financial Services'
    WHEN raw_industry ILIKE '%Financial Data%' THEN 'Financial Services'
    WHEN raw_industry ILIKE '%SHORT-TERM BUSINESS CREDIT%' THEN 'Financial Services'
    WHEN raw_industry ILIKE '%PERSONAL CREDIT%' THEN 'Consumer Finance'
    WHEN raw_industry ILIKE '%LOAN BROKERS%' THEN 'Consumer Finance'
    WHEN raw_industry ILIKE '%MORTGAGE BANK%' THEN 'Mortgage Finance'
    WHEN raw_industry ILIKE '%REAL ESTATE INVESTMENT%' THEN 'REITs'
    WHEN raw_industry ILIKE '%REIT%' THEN 'REITs'
    WHEN raw_industry ILIKE '%BLANK CHECK%' THEN 'SPACs'
    WHEN raw_industry ILIKE '%ASSET-BACKED%' THEN 'Financial Services'
    
    -- Energy
    WHEN raw_industry ILIKE '%CRUDE PETROLEUM%' THEN 'Oil & Gas E&P'
    WHEN raw_industry ILIKE '%Oil & Gas E&P%' THEN 'Oil & Gas E&P'
    WHEN raw_industry ILIKE '%DRILLING OIL%' THEN 'Oil & Gas Services'
    WHEN raw_industry ILIKE '%OIL & GAS FIELD%' THEN 'Oil & Gas Services'
    WHEN raw_industry ILIKE '%PETROLEUM REFINING%' THEN 'Oil & Gas Refining'
    WHEN raw_industry ILIKE '%NATURAL GAS DISTRIBUTION%' THEN 'Natural Gas'
    WHEN raw_industry ILIKE '%NATURAL GAS TRANSMIS%' THEN 'Natural Gas'
    WHEN raw_industry ILIKE '%PIPELINE%' THEN 'Pipelines'
    WHEN raw_industry ILIKE '%Oil & Gas Midstream%' THEN 'Pipelines'
    WHEN raw_industry ILIKE '%COAL%' THEN 'Coal & Consumable Fuels'
    
    -- Industrials
    WHEN raw_industry ILIKE '%AIRCRAFT%' THEN 'Aerospace & Defense'
    WHEN raw_industry ILIKE '%Aerospace%' THEN 'Aerospace & Defense'
    WHEN raw_industry ILIKE '%GUIDED MISSILE%' THEN 'Aerospace & Defense'
    WHEN raw_industry ILIKE '%SHIP & BOAT%' THEN 'Aerospace & Defense'
    WHEN raw_industry ILIKE '%RAILROAD%' THEN 'Railroads'
    WHEN raw_industry ILIKE '%TRUCKING%' THEN 'Trucking'
    WHEN raw_industry ILIKE '%AIR TRANSPORTATION%' THEN 'Airlines'
    WHEN raw_industry ILIKE '%AIR COURIER%' THEN 'Air Freight'
    WHEN raw_industry ILIKE '%ARRANGEMENT OF TRANSPORT%' THEN 'Logistics'
    WHEN raw_industry ILIKE '%DEEP SEA%' THEN 'Marine Transportation'
    WHEN raw_industry ILIKE '%CONSTRUCTION MACHINERY%' THEN 'Machinery'
    WHEN raw_industry ILIKE '%CONSTRUCTION, MINING%' THEN 'Machinery'
    WHEN raw_industry ILIKE '%FARM MACHINERY%' THEN 'Machinery'
    WHEN raw_industry ILIKE '%GENERAL INDUSTRIAL MACHINERY%' THEN 'Machinery'
    WHEN raw_industry ILIKE '%SPECIAL INDUSTRY MACHINERY%' THEN 'Machinery'
    WHEN raw_industry ILIKE '%METALWORKG MACHINERY%' THEN 'Machinery'
    WHEN raw_industry ILIKE '%ENGINES & TURBINES%' THEN 'Machinery'
    WHEN raw_industry ILIKE '%Machinery%' THEN 'Machinery'
    WHEN raw_industry ILIKE '%GENERAL BLDG CONTRACTOR%' THEN 'Construction'
    WHEN raw_industry ILIKE '%HEAVY CONSTRUCTION%' THEN 'Construction'
    WHEN raw_industry ILIKE '%CONSTRUCTION - SPECIAL%' THEN 'Construction'
    WHEN raw_industry ILIKE '%ELECTRICAL WORK%' THEN 'Construction'
    WHEN raw_industry ILIKE '%ELECTRIC LIGHTING%' THEN 'Electrical Equipment'
    WHEN raw_industry ILIKE '%ELECTRIC HOUSEWARES%' THEN 'Electrical Equipment'
    WHEN raw_industry ILIKE '%Electrical Equipment%' THEN 'Electrical Equipment'
    WHEN raw_industry ILIKE '%INDUSTRIAL INSTRUMENTS%' THEN 'Industrial Technology'
    WHEN raw_industry ILIKE '%PROCESS CONTROL%' THEN 'Industrial Technology'
    WHEN raw_industry ILIKE '%SERVICES-MANAGEMENT CONSULTING%' THEN 'Professional Services'
    WHEN raw_industry ILIKE '%SERVICES-ENGINEERING%' THEN 'Professional Services'
    WHEN raw_industry ILIKE '%SERVICES-MISC BUSINESS%' THEN 'Professional Services'
    WHEN raw_industry ILIKE '%SERVICES-HELP SUPPLY%' THEN 'Staffing'
    WHEN raw_industry ILIKE '%Staffing%' THEN 'Staffing'
    WHEN raw_industry ILIKE '%SERVICES-TO BUILDINGS%' THEN 'Facility Services'
    WHEN raw_industry ILIKE '%Waste Management%' THEN 'Waste Management'
    WHEN raw_industry ILIKE '%REFUSE SYSTEMS%' THEN 'Waste Management'
    WHEN raw_industry ILIKE '%Conglomerate%' THEN 'Conglomerates'
    
    -- Materials
    WHEN raw_industry ILIKE '%STEEL%' THEN 'Steel'
    WHEN raw_industry ILIKE '%IRON ORES%' THEN 'Steel'
    WHEN raw_industry ILIKE '%ALUMINUM%' THEN 'Aluminum'
    WHEN raw_industry ILIKE '%GOLD%' THEN 'Gold'
    WHEN raw_industry ILIKE '%Gold Miner%' THEN 'Gold'
    WHEN raw_industry ILIKE '%Copper%' THEN 'Copper'
    WHEN raw_industry ILIKE '%METAL MINING%' THEN 'Mining'
    WHEN raw_industry ILIKE '%MINING%QUARRYING%' THEN 'Mining'
    WHEN raw_industry ILIKE '%CHEMICALS%' THEN 'Chemicals'
    WHEN raw_industry ILIKE '%Specialty Chemical%' THEN 'Specialty Chemicals'
    WHEN raw_industry ILIKE '%AGRICULTURAL CHEMICAL%' THEN 'Chemicals'
    WHEN raw_industry ILIKE '%INDUSTRIAL ORGANIC CHEMICAL%' THEN 'Chemicals'
    WHEN raw_industry ILIKE '%INDUSTRIAL INORGANIC CHEMICAL%' THEN 'Chemicals'
    WHEN raw_industry ILIKE '%PLASTIC MATERIAL%' THEN 'Chemicals'
    WHEN raw_industry ILIKE '%SOAP%DETERGENT%' THEN 'Chemicals'
    WHEN raw_industry ILIKE '%CEMENT%' THEN 'Building Materials'
    WHEN raw_industry ILIKE '%GLASS PRODUCT%' THEN 'Building Materials'
    WHEN raw_industry ILIKE '%LUMBER%' THEN 'Building Materials'
    WHEN raw_industry ILIKE '%CONCRETE%' THEN 'Building Materials'
    WHEN raw_industry ILIKE '%PAPER MILL%' THEN 'Paper & Packaging'
    WHEN raw_industry ILIKE '%PAPERBOARD%' THEN 'Paper & Packaging'
    WHEN raw_industry ILIKE '%CONVERTED PAPER%' THEN 'Paper & Packaging'
    WHEN raw_industry ILIKE '%METAL CAN%' THEN 'Packaging'
    WHEN raw_industry ILIKE '%FABRICATED PLATE%' THEN 'Fabricated Metals'
    WHEN raw_industry ILIKE '%FABRICATED STRUCTURAL%' THEN 'Fabricated Metals'
    WHEN raw_industry ILIKE '%FABRICATED RUBBER%' THEN 'Fabricated Metals'
    WHEN raw_industry ILIKE '%CUTLERY%' THEN 'Fabricated Metals'
    WHEN raw_industry ILIKE '%DRAWING & INSULATING%' THEN 'Fabricated Metals'
    
    -- Consumer Staples
    WHEN raw_industry ILIKE '%GRAIN MILL%' THEN 'Food Products'
    WHEN raw_industry ILIKE '%CANNED, FROZEN%' THEN 'Food Products'
    WHEN raw_industry ILIKE '%FOOD AND KINDRED%' THEN 'Food Products'
    WHEN raw_industry ILIKE '%FATS & OILS%' THEN 'Food Products'
    WHEN raw_industry ILIKE '%MEAT PACKING%' THEN 'Food Products'
    WHEN raw_industry ILIKE '%SUGAR%' THEN 'Food Products'
    WHEN raw_industry ILIKE '%SAUSAGE%' THEN 'Food Products'
    WHEN raw_industry ILIKE '%BOTTLED%' THEN 'Beverages'
    WHEN raw_industry ILIKE '%BEVERAGES%' THEN 'Beverages'
    WHEN raw_industry ILIKE '%Beverages%' THEN 'Beverages'
    WHEN raw_industry ILIKE '%MALT BEVERAGES%' THEN 'Beverages'
    WHEN raw_industry ILIKE '%Cigarettes%' THEN 'Tobacco'
    WHEN raw_industry ILIKE '%TOBACCO%' THEN 'Tobacco'
    WHEN raw_industry ILIKE '%PERFUME%' THEN 'Household Products'
    WHEN raw_industry ILIKE '%Household%' THEN 'Household Products'
    WHEN raw_industry ILIKE '%WHOLESALE-GROCERIES%' THEN 'Food Distribution'
    WHEN raw_industry ILIKE '%RETAIL-GROCERY%' THEN 'Food Retail'
    
    -- Consumer Discretionary
    WHEN raw_industry ILIKE '%MOTOR VEHICLE%' THEN 'Automobiles'
    WHEN raw_industry ILIKE '%Automobiles%' THEN 'Automobiles'
    WHEN raw_industry ILIKE '%MOTORCYCLES%' THEN 'Automobiles'
    WHEN raw_industry ILIKE '%RETAIL-AUTO DEALER%' THEN 'Auto Dealers'
    WHEN raw_industry ILIKE '%RETAIL-AUTO & HOME%' THEN 'Auto Parts Retail'
    WHEN raw_industry ILIKE '%RETAIL-EATING%' THEN 'Restaurants'
    WHEN raw_industry ILIKE '%RETAIL-EATING & DRINKING%' THEN 'Restaurants'
    WHEN raw_industry ILIKE '%HOTELS%' THEN 'Hotels & Leisure'
    WHEN raw_industry ILIKE '%SERVICES-MISCELLANEOUS AMUSEMENT%' THEN 'Hotels & Leisure'
    WHEN raw_industry ILIKE '%SERVICES-AMUSEMENT%' THEN 'Hotels & Leisure'
    WHEN raw_industry ILIKE '%RETAIL-FAMILY CLOTHING%' THEN 'Apparel Retail'
    WHEN raw_industry ILIKE '%Apparel Retail%' THEN 'Apparel Retail'
    WHEN raw_industry ILIKE '%APPAREL%' THEN 'Apparel'
    WHEN raw_industry ILIKE '%FOOTWEAR%' THEN 'Apparel'
    WHEN raw_industry ILIKE '%RETAIL-CATALOG%' THEN 'E-Commerce'
    WHEN raw_industry ILIKE '%Broadline Retail%' THEN 'E-Commerce'
    WHEN raw_industry ILIKE '%RETAIL-DEPARTMENT%' THEN 'Department Stores'
    WHEN raw_industry ILIKE '%RETAIL-VARIETY%' THEN 'Discount Stores'
    WHEN raw_industry ILIKE '%Discount Store%' THEN 'Discount Stores'
    WHEN raw_industry ILIKE '%RETAIL-LUMBER%' THEN 'Home Improvement'
    WHEN raw_industry ILIKE '%RETAIL-BUILDING MATERIAL%' THEN 'Home Improvement'
    WHEN raw_industry ILIKE '%RETAIL-FURNITURE%' THEN 'Home Furnishings'
    WHEN raw_industry ILIKE '%RETAIL-MISCELLANEOUS%' THEN 'Specialty Retail'
    WHEN raw_industry ILIKE '%RETAIL-RETAIL STORES%' THEN 'Specialty Retail'
    WHEN raw_industry ILIKE '%RETAIL-RADIO%' THEN 'Specialty Retail'
    WHEN raw_industry ILIKE '%RETAIL-NONSTORE RETAILER%' THEN 'Specialty Retail'
    WHEN raw_industry ILIKE '%SPORTING%' THEN 'Leisure Products'
    WHEN raw_industry ILIKE '%GAMES, TOYS%' THEN 'Leisure Products'
    WHEN raw_industry ILIKE '%SERVICES-EDUCATIONAL%' THEN 'Education'
    WHEN raw_industry ILIKE '%SERVICES-PERSONAL%' THEN 'Personal Services'
    WHEN raw_industry ILIKE '%Consumer Electronics%' THEN 'Consumer Electronics'
    
    -- Communication Services
    WHEN raw_industry ILIKE '%TELEPHONE COMMUNICATION%' THEN 'Telecom'
    WHEN raw_industry ILIKE '%Telecom%' THEN 'Telecom'
    WHEN raw_industry ILIKE '%TELEGRAPH%' THEN 'Telecom'
    WHEN raw_industry ILIKE '%RADIO BROADCASTING%' THEN 'Media'
    WHEN raw_industry ILIKE '%TELEVISION BROADCASTING%' THEN 'Media'
    WHEN raw_industry ILIKE '%SERVICES-MOTION PICTURE%' THEN 'Entertainment'
    WHEN raw_industry ILIKE '%SERVICES-VIDEO TAPE%' THEN 'Entertainment'
    WHEN raw_industry ILIKE '%Entertainment%' THEN 'Entertainment'
    WHEN raw_industry ILIKE '%SERVICES-RACING%' THEN 'Entertainment'
    WHEN raw_industry ILIKE '%CABLE%PAY TELEVISION%' THEN 'Cable & Streaming'
    WHEN raw_industry ILIKE '%COMMUNICATIONS SERVICES%' THEN 'Interactive Media'
    WHEN raw_industry ILIKE '%Internet Content%' THEN 'Interactive Media'
    WHEN raw_industry ILIKE '%SERVICES-COMPUTER PROGRAMMING%' AND raw_industry ILIKE '%DATA PROC%' THEN 'Interactive Media'
    
    -- Utilities
    WHEN raw_industry ILIKE '%ELECTRIC SERVICE%' THEN 'Electric Utilities'
    WHEN raw_industry ILIKE '%ELECTRIC & OTHER SERVICE%' THEN 'Electric Utilities'
    WHEN raw_industry ILIKE '%Utilities - Regulated Electric%' THEN 'Electric Utilities'
    WHEN raw_industry ILIKE '%COGENERATION%' THEN 'Independent Power'
    WHEN raw_industry ILIKE '%Independent Power%' THEN 'Independent Power'
    WHEN raw_industry ILIKE '%GAS & OTHER SERVICES%' THEN 'Gas Utilities'
    WHEN raw_industry ILIKE '%WATER SUPPLY%' THEN 'Water Utilities'
    WHEN raw_industry ILIKE '%Utilities%' THEN 'Utilities - Diversified'
    
    -- Real Estate
    WHEN raw_industry ILIKE '%REAL ESTATE%' THEN 'REITs'
    WHEN raw_industry ILIKE '%REIT%' THEN 'REITs'
    WHEN raw_industry ILIKE '%LAND SUBDIVID%' THEN 'Real Estate Development'
    WHEN raw_industry ILIKE '%OPERATIVE BUILDER%' THEN 'Homebuilders'
    
    -- Wholesale/Distribution
    WHEN raw_industry ILIKE '%WHOLESALE-DRUGS%' THEN 'Distribution'
    WHEN raw_industry ILIKE '%WHOLESALE-LUMBER%' THEN 'Distribution'
    WHEN raw_industry ILIKE '%WHOLESALE-MISCELLANEOUS%' THEN 'Distribution'
    WHEN raw_industry ILIKE '%WHOLESALE-MACHINERY%' THEN 'Distribution'
    WHEN raw_industry ILIKE '%WHOLESALE-ELECTRONIC%' THEN 'Distribution'
    WHEN raw_industry ILIKE '%WHOLESALE-MOTOR VEHICLE%' THEN 'Distribution'
    WHEN raw_industry ILIKE '%WHOLESALE-PETROLEUM%' THEN 'Distribution'
    WHEN raw_industry ILIKE '%WHOLESALE-METALS%' THEN 'Distribution'
    WHEN raw_industry ILIKE '%WHOLESALE-HARDWARE%' THEN 'Distribution'
    WHEN raw_industry ILIKE '%WHOLESALE-INDUSTRIAL%' THEN 'Distribution'
    WHEN raw_industry ILIKE '%WHOLESALE-MEDICAL%' THEN 'Distribution'
    WHEN raw_industry ILIKE '%WHOLESALE-%' THEN 'Distribution'
    
    -- Services catchalls
    WHEN raw_industry ILIKE '%SERVICES-ADVERTISING%' THEN 'Advertising'
    WHEN raw_industry ILIKE '%Advertising%' THEN 'Advertising'
    WHEN raw_industry ILIKE '%SERVICES-DETECTIVE%' THEN 'Security Services'
    WHEN raw_industry ILIKE '%Security Software%' THEN 'Cybersecurity'
    WHEN raw_industry ILIKE '%Payment Service%' THEN 'Payment Services'
    WHEN raw_industry ILIKE '%SERVICES-PREPACKAGED SOFTWARE%' THEN 'Software'
    WHEN raw_industry ILIKE '%SERVICES-COMPUTER%' THEN 'IT Services'
    WHEN raw_industry ILIKE '%SERVICES-%' THEN 'Business Services'
    
    -- Manufacturing catchalls
    WHEN raw_industry ILIKE '%MISCELLANEOUS MANUFACTURING%' THEN 'Diversified Manufacturing'
    WHEN raw_industry ILIKE '%COATING, ENGRAVING%' THEN 'Diversified Manufacturing'
    WHEN raw_industry ILIKE '%COMMERCIAL PRINTING%' THEN 'Diversified Manufacturing'
    WHEN raw_industry ILIKE '%BLANKBOOK%' THEN 'Diversified Manufacturing'
    
    -- Clean passthrough for already-clean names
    WHEN raw_industry = 'Software' THEN 'Software'
    WHEN raw_industry = 'Banks' THEN 'Banks'
    WHEN raw_industry = 'Semiconductors' THEN 'Semiconductors'
    WHEN raw_industry = 'Beverages' THEN 'Beverages'
    WHEN raw_industry = 'Drug Manufacturers' THEN 'Pharmaceuticals'
    WHEN raw_industry = 'Conglomerates' THEN 'Conglomerates'
    
    -- Fallback
    ELSE COALESCE(raw_industry, 'Other')
  END;
$$;

-- 2. Sector ranking RPC
CREATE OR REPLACE FUNCTION public.get_sector_ranking()
RETURNS TABLE (
  sector_name text,
  rank_position int,
  is_leading boolean,
  wsp_regime text,
  pct_above_ma50 numeric,
  avg_wsp_score numeric,
  avg_pct_today numeric,
  symbol_count bigint,
  wsp_setups bigint,
  top_pattern text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT * FROM get_market_summary()
  ),
  ranked AS (
    SELECT
      b.sector_name,
      b.wsp_regime,
      b.pct_above_ma50,
      b.avg_wsp_score,
      b.avg_pct_today,
      b.symbol_count,
      b.wsp_setups,
      b.top_pattern,
      -- Composite rank: regime weight + breadth + score
      ROW_NUMBER() OVER (ORDER BY
        CASE b.wsp_regime WHEN 'Bullish' THEN 3 WHEN 'Neutral' THEN 2 ELSE 1 END DESC,
        b.pct_above_ma50 DESC,
        b.avg_wsp_score DESC
      ) AS rank_position
    FROM base b
  )
  SELECT
    r.sector_name,
    r.rank_position::int,
    (r.wsp_regime IN ('Bullish','Neutral') AND r.pct_above_ma50 >= 45) AS is_leading,
    r.wsp_regime,
    r.pct_above_ma50,
    r.avg_wsp_score,
    r.avg_pct_today,
    r.symbol_count,
    r.wsp_setups,
    r.top_pattern
  FROM ranked r
  ORDER BY r.rank_position;
$$;

-- 3. Industry ranking RPC
CREATE OR REPLACE FUNCTION public.get_industry_ranking(
  p_leading_only boolean DEFAULT true,
  p_limit int DEFAULT 30
)
RETURNS TABLE (
  display_industry text,
  sector text,
  symbol_count bigint,
  avg_wsp_score numeric,
  breakout_count bigint,
  valid_entry_count bigint,
  buy_count bigint,
  watch_count bigint,
  rank_score numeric,
  rank_position int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH leading_sectors AS (
    SELECT sector_name FROM get_sector_ranking()
    WHERE is_leading = true
  ),
  latest_run AS (
    SELECT id FROM market_scan_runs
    WHERE status IN ('completed','partial')
    ORDER BY id DESC LIMIT 1
  ),
  industry_agg AS (
    SELECT
      display_industry(COALESCE(msr.industry, s.canonical_industry)) AS di,
      CASE
        WHEN msr.sector = 'Information Technology' THEN 'Technology'
        WHEN msr.sector = 'Health Care' THEN 'Healthcare'
        ELSE COALESCE(msr.sector, s.canonical_sector)
      END AS sec,
      count(*) AS sym_count,
      avg(COALESCE(msr.score, 0))::numeric(5,2) AS avg_score,
      count(*) FILTER (WHERE wi.resistance_level IS NOT NULL AND wi.close > wi.resistance_level * 1.02) AS bo_count,
      count(*) FILTER (WHERE msr.recommendation IN ('KÖP','BEVAKA') AND COALESCE(msr.score,0) >= 3) AS ve_count,
      count(*) FILTER (WHERE msr.recommendation = 'KÖP') AS buy_cnt,
      count(*) FILTER (WHERE msr.recommendation = 'BEVAKA') AS watch_cnt
    FROM market_scan_results msr
    JOIN latest_run lr ON msr.run_id = lr.id
    LEFT JOIN symbols s ON s.symbol = msr.symbol
    LEFT JOIN wsp_indicators wi ON wi.symbol = msr.symbol AND wi.calc_date = (SELECT max(calc_date) FROM wsp_indicators)
    WHERE COALESCE(msr.industry, s.canonical_industry) IS NOT NULL
      AND COALESCE(msr.industry, s.canonical_industry) NOT IN ('Unknown','Stocks','ETF','')
      AND (
        NOT p_leading_only
        OR CASE
            WHEN msr.sector = 'Information Technology' THEN 'Technology'
            WHEN msr.sector = 'Health Care' THEN 'Healthcare'
            ELSE COALESCE(msr.sector, s.canonical_sector)
          END IN (SELECT sector_name FROM leading_sectors)
      )
    GROUP BY di, sec
    HAVING count(*) >= 2
  )
  SELECT
    ia.di,
    ia.sec,
    ia.sym_count,
    ia.avg_score,
    ia.bo_count,
    ia.ve_count,
    ia.buy_cnt,
    ia.watch_cnt,
    (ia.avg_score * 10 + ia.bo_count * 8 + ia.ve_count * 4 + ia.buy_cnt * 15 + ia.watch_cnt * 2)::numeric(8,2) AS rank_score,
    ROW_NUMBER() OVER (ORDER BY
      (ia.avg_score * 10 + ia.bo_count * 8 + ia.ve_count * 4 + ia.buy_cnt * 15 + ia.watch_cnt * 2) DESC,
      ia.sym_count DESC
    )::int AS rank_position
  FROM industry_agg ia
  ORDER BY rank_position
  LIMIT p_limit;
$$;
