CREATE OR REPLACE FUNCTION public.display_industry(raw_industry text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE
    WHEN raw_industry IS NULL OR btrim(raw_industry) = '' THEN 'Other'
    WHEN btrim(raw_industry) IN (
      'Semiconductors','Electronic Components','Communications Equipment','Computer Hardware','Software','IT Services','Cybersecurity','Scientific Instruments',
      'Pharmaceuticals','Biotechnology','Diagnostics','Medical Devices','Healthcare Services',
      'Banks','Insurance','Capital Markets','Consumer Finance','Mortgage Finance','Payment Services','Financial Services','REITs','Real Estate Services','SPACs',
      'Oil & Gas E&P','Oil & Gas Services','Oil & Gas Refining','Pipelines','Natural Gas','Coal & Consumable Fuels','Electric Utilities','Independent Power','Gas Utilities','Water Utilities',
      'Aerospace & Defense','Railroads','Trucking','Airlines','Air Freight','Logistics','Machinery','Construction','Electrical Equipment','Industrial Technology','Professional Services','Staffing','Waste Management','Conglomerates',
      'Steel','Aluminum','Gold','Silver','Copper','Mining','Specialty Chemicals','Chemicals','Building Materials','Paper & Packaging','Packaging','Fabricated Metals',
      'Food Products','Beverages','Tobacco','Household Products','Food Distribution','Food Retail','Automobiles','Auto Dealers','Auto Parts Retail','Restaurants','Hotels & Leisure','Apparel Retail','Apparel','E-Commerce','Department Stores','Discount Stores','Home Improvement','Home Furnishings','Leisure Products','Education',
      'Telecom','Media','Entertainment','Cable & Streaming','Interactive Media',
      'Advertising','Security Services','Distribution'
    ) THEN btrim(raw_industry)

    WHEN raw_industry ILIKE '%SEMICONDUCTOR%' OR raw_industry ILIKE '%PRINTED CIRCUIT%' THEN 'Semiconductors'
    WHEN raw_industry ILIKE '%ELECTRONIC COMPONENT%' OR raw_industry ILIKE '%ELECTRONIC CONNECTOR%' OR raw_industry ILIKE '%ELECTRONIC COIL%' THEN 'Electronic Components'
    WHEN raw_industry ILIKE '%COMMUNICATIONS EQUIPMENT%' OR raw_industry ILIKE '%COMPUTER COMMUNICATIONS%' THEN 'Communications Equipment'
    WHEN raw_industry ILIKE '%COMPUTER PERIPHERAL%' OR raw_industry ILIKE '%CALCULATING%' OR raw_industry ILIKE '%ELECTRONIC%COMPUTER%' THEN 'Computer Hardware'
    WHEN raw_industry ILIKE '%SOFTWARE%' OR raw_industry ILIKE '%PREPACKAGED SOFTWARE%' THEN 'Software'
    WHEN raw_industry ILIKE '%INFORMATION TECHNOLOGY%' OR raw_industry ILIKE '%COMPUTER PROGRAMMING%' OR raw_industry ILIKE '%COMPUTER PROCESSING%' OR raw_industry ILIKE '%IT SERVICES%' THEN 'IT Services'
    WHEN raw_industry ILIKE '%CYBER%' THEN 'Cybersecurity'
    WHEN raw_industry ILIKE '%INSTRUMENT%' OR raw_industry ILIKE '%MEASURING%' OR raw_industry ILIKE '%LABORATORY%' THEN 'Scientific Instruments'

    WHEN raw_industry ILIKE '%PHARMACEUTICAL%' OR raw_industry ILIKE '%DRUG MANUFACTURER%' THEN 'Pharmaceuticals'
    WHEN raw_industry ILIKE '%BIOLOGICAL PRODUCT%' OR raw_industry ILIKE '%BIOTECH%' THEN 'Biotechnology'
    WHEN raw_industry ILIKE '%IN VITRO%' OR raw_industry ILIKE '%DIAGNOSTIC%' THEN 'Diagnostics'
    WHEN raw_industry ILIKE '%SURGICAL%' OR raw_industry ILIKE '%ELECTROMEDICAL%' OR raw_industry ILIKE '%ORTHOPEDIC%' OR raw_industry ILIKE '%MEDICAL DEVICE%' THEN 'Medical Devices'
    WHEN raw_industry ILIKE '%HOSPITAL%' OR raw_industry ILIKE '%HEALTH SERVICES%' OR raw_industry ILIKE '%MANAGED HEALTH%' OR raw_industry ILIKE '%MEDICAL LABORATORIES%' THEN 'Healthcare Services'

    WHEN raw_industry ILIKE '%COMMERCIAL BANK%' OR raw_industry ILIKE '%SAVINGS INSTITUTION%' OR raw_industry ILIKE '%DEPOSITORY%' OR raw_industry = 'Banks' THEN 'Banks'
    WHEN raw_industry ILIKE '%INSURANCE%' THEN 'Insurance'
    WHEN raw_industry ILIKE '%SECURITY & COMMODITY%' OR raw_industry ILIKE '%INVESTMENT ADVICE%' OR raw_industry ILIKE '%CAPITAL MARKETS%' THEN 'Capital Markets'
    WHEN raw_industry ILIKE '%CONSUMER FINANCE%' OR raw_industry ILIKE '%PERSONAL CREDIT%' OR raw_industry ILIKE '%LOAN BROKER%' THEN 'Consumer Finance'
    WHEN raw_industry ILIKE '%MORTGAGE%' THEN 'Mortgage Finance'
    WHEN raw_industry ILIKE '%PAYMENT%' THEN 'Payment Services'
    WHEN raw_industry ILIKE '%FINANCE%' OR raw_industry ILIKE '%FINANCIAL SERVICES%' OR raw_industry ILIKE '%ASSET-BACKED%' THEN 'Financial Services'
    WHEN raw_industry ILIKE '%REIT%' OR raw_industry ILIKE '%REAL ESTATE INVESTMENT%' THEN 'REITs'
    WHEN raw_industry ILIKE '%REAL ESTATE%' THEN 'Real Estate Services'
    WHEN raw_industry ILIKE '%BLANK CHECK%' THEN 'SPACs'

    WHEN raw_industry ILIKE '%CRUDE PETROLEUM%' OR raw_industry ILIKE '%OIL & GAS E&P%' THEN 'Oil & Gas E&P'
    WHEN raw_industry ILIKE '%DRILLING OIL%' OR raw_industry ILIKE '%OIL & GAS FIELD%' THEN 'Oil & Gas Services'
    WHEN raw_industry ILIKE '%PETROLEUM REFINING%' THEN 'Oil & Gas Refining'
    WHEN raw_industry ILIKE '%PIPELINE%' OR raw_industry ILIKE '%MIDSTREAM%' THEN 'Pipelines'
    WHEN raw_industry ILIKE '%NATURAL GAS%' THEN 'Natural Gas'
    WHEN raw_industry ILIKE '%COAL%' THEN 'Coal & Consumable Fuels'
    WHEN raw_industry ILIKE '%ELECTRIC SERVICE%' OR raw_industry ILIKE '%REGULATED ELECTRIC%' THEN 'Electric Utilities'
    WHEN raw_industry ILIKE '%INDEPENDENT POWER%' OR raw_industry ILIKE '%COGENERATION%' THEN 'Independent Power'
    WHEN raw_industry ILIKE '%GAS & OTHER SERVICES%' THEN 'Gas Utilities'
    WHEN raw_industry ILIKE '%WATER SUPPLY%' THEN 'Water Utilities'

    WHEN raw_industry ILIKE '%AIRCRAFT%' OR raw_industry ILIKE '%AEROSPACE%' OR raw_industry ILIKE '%GUIDED MISSILE%' THEN 'Aerospace & Defense'
    WHEN raw_industry ILIKE '%RAILROAD%' THEN 'Railroads'
    WHEN raw_industry ILIKE '%TRUCKING%' THEN 'Trucking'
    WHEN raw_industry ILIKE '%AIR TRANSPORTATION%' THEN 'Airlines'
    WHEN raw_industry ILIKE '%AIR COURIER%' THEN 'Air Freight'
    WHEN raw_industry ILIKE '%TRANSPORT%' THEN 'Logistics'
    WHEN raw_industry ILIKE '%MACHINERY%' OR raw_industry ILIKE '%TURBINES%' THEN 'Machinery'
    WHEN raw_industry ILIKE '%CONSTRUCTION%' THEN 'Construction'
    WHEN raw_industry ILIKE '%ELECTRIC LIGHTING%' OR raw_industry ILIKE '%ELECTRICAL EQUIPMENT%' THEN 'Electrical Equipment'
    WHEN raw_industry ILIKE '%INDUSTRIAL INSTRUMENT%' OR raw_industry ILIKE '%PROCESS CONTROL%' THEN 'Industrial Technology'
    WHEN raw_industry ILIKE '%ENGINEERING%' OR raw_industry ILIKE '%MANAGEMENT CONSULTING%' OR raw_industry ILIKE '%BUSINESS SERVICES%' THEN 'Professional Services'
    WHEN raw_industry ILIKE '%STAFFING%' OR raw_industry ILIKE '%HELP SUPPLY%' THEN 'Staffing'
    WHEN raw_industry ILIKE '%REFUSE%' OR raw_industry ILIKE '%WASTE MANAGEMENT%' THEN 'Waste Management'
    WHEN raw_industry ILIKE '%CONGLOMERATE%' THEN 'Conglomerates'

    WHEN raw_industry ILIKE '%STEEL%' OR raw_industry ILIKE '%IRON ORES%' THEN 'Steel'
    WHEN raw_industry ILIKE '%ALUMINUM%' THEN 'Aluminum'
    WHEN raw_industry ILIKE '%GOLD%' THEN 'Gold'
    WHEN raw_industry ILIKE '%SILVER%' THEN 'Silver'
    WHEN raw_industry ILIKE '%COPPER%' THEN 'Copper'
    WHEN raw_industry ILIKE '%MINING%' OR raw_industry ILIKE '%QUARRYING%' THEN 'Mining'
    WHEN raw_industry ILIKE '%SPECIALTY CHEMICAL%' THEN 'Specialty Chemicals'
    WHEN raw_industry ILIKE '%CHEMICAL%' THEN 'Chemicals'
    WHEN raw_industry ILIKE '%CEMENT%' OR raw_industry ILIKE '%GLASS PRODUCT%' OR raw_industry ILIKE '%LUMBER%' OR raw_industry ILIKE '%CONCRETE%' THEN 'Building Materials'
    WHEN raw_industry ILIKE '%PAPER%' THEN 'Paper & Packaging'
    WHEN raw_industry ILIKE '%PACKAGING%' OR raw_industry ILIKE '%METAL CAN%' THEN 'Packaging'
    WHEN raw_industry ILIKE '%FABRICATED%' OR raw_industry ILIKE '%CUTLERY%' THEN 'Fabricated Metals'

    WHEN raw_industry ILIKE '%FOOD%' OR raw_industry ILIKE '%GRAIN MILL%' OR raw_industry ILIKE '%MEAT PACKING%' THEN 'Food Products'
    WHEN raw_industry ILIKE '%BEVERAGE%' OR raw_industry ILIKE '%BOTTLED%' THEN 'Beverages'
    WHEN raw_industry ILIKE '%TOBACCO%' OR raw_industry ILIKE '%CIGARETTES%' THEN 'Tobacco'
    WHEN raw_industry ILIKE '%HOUSEHOLD%' OR raw_industry ILIKE '%PERSONAL PRODUCTS%' OR raw_industry ILIKE '%PERFUME%' THEN 'Household Products'
    WHEN raw_industry ILIKE '%WHOLESALE-GROCERIES%' THEN 'Food Distribution'
    WHEN raw_industry ILIKE '%RETAIL-GROCERY%' THEN 'Food Retail'
    WHEN raw_industry ILIKE '%AUTOMOBILE%' OR raw_industry ILIKE '%MOTOR VEHICLE%' OR raw_industry ILIKE '%MOTORCYCLE%' THEN 'Automobiles'
    WHEN raw_industry ILIKE '%AUTO DEALER%' THEN 'Auto Dealers'
    WHEN raw_industry ILIKE '%AUTO PART%' THEN 'Auto Parts Retail'
    WHEN raw_industry ILIKE '%RETAIL-EATING%' OR raw_industry ILIKE '%RESTAURANT%' THEN 'Restaurants'
    WHEN raw_industry ILIKE '%HOTEL%' OR raw_industry ILIKE '%LEISURE%' OR raw_industry ILIKE '%AMUSEMENT%' THEN 'Hotels & Leisure'
    WHEN raw_industry ILIKE '%APPAREL RETAIL%' THEN 'Apparel Retail'
    WHEN raw_industry ILIKE '%APPAREL%' OR raw_industry ILIKE '%FOOTWEAR%' THEN 'Apparel'
    WHEN raw_industry ILIKE '%E-COMMERCE%' OR raw_industry ILIKE '%BROADLINE RETAIL%' OR raw_industry ILIKE '%RETAIL-CATALOG%' THEN 'E-Commerce'
    WHEN raw_industry ILIKE '%DEPARTMENT%' THEN 'Department Stores'
    WHEN raw_industry ILIKE '%DISCOUNT STORE%' OR raw_industry ILIKE '%RETAIL-VARIETY%' THEN 'Discount Stores'
    WHEN raw_industry ILIKE '%HOME IMPROVEMENT%' OR raw_industry ILIKE '%RETAIL-LUMBER%' OR raw_industry ILIKE '%RETAIL-BUILDING MATERIAL%' THEN 'Home Improvement'
    WHEN raw_industry ILIKE '%FURNITURE%' THEN 'Home Furnishings'
    WHEN raw_industry ILIKE '%SPORTING%' OR raw_industry ILIKE '%GAMES, TOYS%' THEN 'Leisure Products'
    WHEN raw_industry ILIKE '%EDUCATIONAL%' THEN 'Education'

    WHEN raw_industry ILIKE '%TELEPHONE COMMUNICATION%' OR raw_industry ILIKE '%TELEGRAPH%' OR raw_industry ILIKE '%TELECOM%' THEN 'Telecom'
    WHEN raw_industry ILIKE '%BROADCASTING%' THEN 'Media'
    WHEN raw_industry ILIKE '%MOTION PICTURE%' OR raw_industry ILIKE '%VIDEO TAPE%' OR raw_industry ILIKE '%ENTERTAINMENT%' THEN 'Entertainment'
    WHEN raw_industry ILIKE '%CABLE%' OR raw_industry ILIKE '%STREAMING%' THEN 'Cable & Streaming'
    WHEN raw_industry ILIKE '%INTERNET CONTENT%' OR raw_industry ILIKE '%INTERACTIVE MEDIA%' OR raw_industry ILIKE '%COMMUNICATIONS SERVICES%' THEN 'Interactive Media'

    WHEN raw_industry ILIKE '%ADVERTISING%' THEN 'Advertising'
    WHEN raw_industry ILIKE '%SECURITY SERVICES%' OR raw_industry ILIKE '%DETECTIVE%' THEN 'Security Services'
    WHEN raw_industry ILIKE '%WHOLESALE-%' THEN 'Distribution'

    ELSE 'Other'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.get_industry_ranking(
  p_leading_only boolean DEFAULT true,
  p_limit int DEFAULT NULL
)
RETURNS TABLE(
  display_industry text,
  sector text,
  symbol_count bigint,
  avg_wsp_score numeric,
  breakout_count bigint,
  breakout_rate numeric,
  bullish_count bigint,
  bearish_count bigint,
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
AS $function$
  WITH leading_sectors AS (
    SELECT sector_name FROM public.get_sector_ranking() WHERE is_leading = true
  ),
  industry_agg AS (
    SELECT
      COALESCE(
        NULLIF(public.display_industry(COALESCE(NULLIF(s.canonical_industry, ''), NULLIF(msr.industry, ''), NULLIF(s.industry, ''), '')), ''),
        'Other'
      ) AS di,
      CASE
        WHEN msr.sector = 'Information Technology' THEN 'Technology'
        WHEN msr.sector = 'Health Care' THEN 'Healthcare'
        WHEN msr.sector = 'Metals & Mining' THEN 'Materials'
        ELSE COALESCE(msr.sector, s.canonical_sector, 'Other')
      END AS sec,
      COUNT(*) AS sym_count,
      AVG(GREATEST(0, LEAST(5, COALESCE(msr.score, 0))))::numeric(5,2) AS avg_score,
      COUNT(*) FILTER (WHERE COALESCE((msr.payload->>'breakout_quality_pass')::boolean, false) OR COALESCE((msr.payload->>'breakout_confirmed')::boolean, false)) AS bo_count,
      COUNT(*) FILTER (WHERE msr.recommendation IN ('KÖP','BEVAKA')) AS bull_count,
      COUNT(*) FILTER (WHERE msr.recommendation IN ('SÄLJ','UNDVIK')) AS bear_count,
      COUNT(*) FILTER (WHERE msr.recommendation IN ('KÖP','BEVAKA') AND COALESCE(msr.score,0) >= 3) AS ve_count,
      COUNT(*) FILTER (WHERE msr.recommendation = 'KÖP') AS buy_cnt,
      COUNT(*) FILTER (WHERE msr.recommendation = 'BEVAKA') AS watch_cnt,
      AVG(COALESCE((msr.payload->>'mansfield_rs')::numeric, 0))::numeric(8,3) AS avg_rs,
      AVG(COALESCE((msr.payload->>'volume_ratio')::numeric, 0))::numeric(8,3) AS avg_vol
    FROM public.market_scan_results_latest msr
    LEFT JOIN public.symbols s ON s.symbol = msr.symbol
    WHERE msr.symbol IS NOT NULL
      AND (NOT p_leading_only OR (
        CASE
          WHEN msr.sector = 'Information Technology' THEN 'Technology'
          WHEN msr.sector = 'Health Care' THEN 'Healthcare'
          WHEN msr.sector = 'Metals & Mining' THEN 'Materials'
          ELSE COALESCE(msr.sector, s.canonical_sector)
        END
      ) IN (SELECT sector_name FROM leading_sectors))
    GROUP BY di, sec
  )
  SELECT
    ia.di AS display_industry,
    ia.sec AS sector,
    ia.sym_count AS symbol_count,
    ia.avg_score AS avg_wsp_score,
    ia.bo_count AS breakout_count,
    ROUND((ia.bo_count::numeric / NULLIF(ia.sym_count, 0)) * 100, 2) AS breakout_rate,
    ia.bull_count AS bullish_count,
    ia.bear_count AS bearish_count,
    ia.ve_count AS valid_entry_count,
    ia.buy_cnt AS buy_count,
    ia.watch_cnt AS watch_count,
    (
      ia.avg_score * 12
      + ia.bo_count * 10
      + ia.bull_count * 3
      + ia.ve_count * 6
      + ia.buy_cnt * 18
      + ia.watch_cnt * 2
      + GREATEST(LEAST(ia.avg_rs, 30), -10) * 0.9
      + GREATEST(LEAST(ia.avg_vol, 3), 0) * 7
      + CASE WHEN ia.di = 'Other' THEN -25 ELSE 0 END
    )::numeric(10,2) AS rank_score,
    ROW_NUMBER() OVER (
      ORDER BY
        (
          ia.avg_score * 12
          + ia.bo_count * 10
          + ia.bull_count * 3
          + ia.ve_count * 6
          + ia.buy_cnt * 18
          + ia.watch_cnt * 2
          + GREATEST(LEAST(ia.avg_rs, 30), -10) * 0.9
          + GREATEST(LEAST(ia.avg_vol, 3), 0) * 7
          + CASE WHEN ia.di = 'Other' THEN -25 ELSE 0 END
        ) DESC,
        ia.sym_count DESC,
        ia.di ASC
    )::int AS rank_position
  FROM industry_agg ia
  ORDER BY rank_score DESC, symbol_count DESC, display_industry ASC
  LIMIT COALESCE(p_limit, 2147483647);
$function$;
