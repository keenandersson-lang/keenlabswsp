-- Normalize visible industry labels into a compact taxonomy (~70 buckets)
CREATE OR REPLACE FUNCTION public.display_industry(raw_industry text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE
    WHEN raw_industry IS NULL OR btrim(raw_industry) = '' THEN 'Other'

    -- Technology
    WHEN raw_industry ILIKE '%SEMICONDUCTOR%' OR raw_industry ILIKE '%PRINTED CIRCUIT%' THEN 'Semiconductors'
    WHEN raw_industry ILIKE '%ELECTRONIC COMPONENT%' OR raw_industry ILIKE '%ELECTRONIC CONNECTOR%' OR raw_industry ILIKE '%ELECTRONIC COIL%' THEN 'Electronic Components'
    WHEN raw_industry ILIKE '%COMMUNICATIONS EQUIPMENT%' OR raw_industry ILIKE '%COMPUTER COMMUNICATIONS%' THEN 'Communications Equipment'
    WHEN raw_industry ILIKE '%COMPUTER PERIPHERAL%' OR raw_industry ILIKE '%CALCULATING%' OR raw_industry ILIKE '%ELECTRONIC%COMPUTER%' THEN 'Computer Hardware'
    WHEN raw_industry ILIKE '%SOFTWARE%' OR raw_industry ILIKE '%PREPACKAGED SOFTWARE%' THEN 'Software'
    WHEN raw_industry ILIKE '%INFORMATION TECHNOLOGY%' OR raw_industry ILIKE '%COMPUTER PROGRAMMING%' OR raw_industry ILIKE '%COMPUTER PROCESSING%' OR raw_industry ILIKE '%IT SERVICES%' THEN 'IT Services'
    WHEN raw_industry ILIKE '%CYBER%' THEN 'Cybersecurity'
    WHEN raw_industry ILIKE '%INSTRUMENT%' OR raw_industry ILIKE '%MEASURING%' OR raw_industry ILIKE '%LABORATORY%' THEN 'Scientific Instruments'

    -- Healthcare
    WHEN raw_industry ILIKE '%PHARMACEUTICAL%' OR raw_industry ILIKE '%DRUG MANUFACTURER%' THEN 'Pharmaceuticals'
    WHEN raw_industry ILIKE '%BIOLOGICAL PRODUCT%' OR raw_industry ILIKE '%BIOTECH%' THEN 'Biotechnology'
    WHEN raw_industry ILIKE '%IN VITRO%' OR raw_industry ILIKE '%DIAGNOSTIC%' THEN 'Diagnostics'
    WHEN raw_industry ILIKE '%SURGICAL%' OR raw_industry ILIKE '%ELECTROMEDICAL%' OR raw_industry ILIKE '%ORTHOPEDIC%' OR raw_industry ILIKE '%MEDICAL DEVICE%' THEN 'Medical Devices'
    WHEN raw_industry ILIKE '%HOSPITAL%' OR raw_industry ILIKE '%HEALTH SERVICES%' OR raw_industry ILIKE '%MANAGED HEALTH%' OR raw_industry ILIKE '%MEDICAL LABORATORIES%' THEN 'Healthcare Services'

    -- Financials / Real Estate
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

    -- Energy / Utilities
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

    -- Industrials
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

    -- Materials
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

    -- Consumer staples / discretionary
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

    -- Communication services
    WHEN raw_industry ILIKE '%TELEPHONE COMMUNICATION%' OR raw_industry ILIKE '%TELEGRAPH%' OR raw_industry ILIKE '%TELECOM%' THEN 'Telecom'
    WHEN raw_industry ILIKE '%BROADCASTING%' THEN 'Media'
    WHEN raw_industry ILIKE '%MOTION PICTURE%' OR raw_industry ILIKE '%VIDEO TAPE%' OR raw_industry ILIKE '%ENTERTAINMENT%' THEN 'Entertainment'
    WHEN raw_industry ILIKE '%CABLE%' OR raw_industry ILIKE '%STREAMING%' THEN 'Cable & Streaming'
    WHEN raw_industry ILIKE '%INTERNET CONTENT%' OR raw_industry ILIKE '%INTERACTIVE MEDIA%' OR raw_industry ILIKE '%COMMUNICATIONS SERVICES%' THEN 'Interactive Media'

    -- Cross-sector services catchalls
    WHEN raw_industry ILIKE '%ADVERTISING%' THEN 'Advertising'
    WHEN raw_industry ILIKE '%SECURITY SERVICES%' OR raw_industry ILIKE '%DETECTIVE%' THEN 'Security Services'
    WHEN raw_industry ILIKE '%WHOLESALE-%' THEN 'Distribution'

    ELSE 'Other'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.get_latest_symbol_indicators(p_symbols text[] DEFAULT NULL)
RETURNS TABLE(symbol text, calc_date date, close numeric, pct_change_1d numeric, ma50 numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT DISTINCT ON (wi.symbol)
    wi.symbol,
    wi.calc_date,
    wi.close,
    wi.pct_change_1d,
    wi.ma50
  FROM public.wsp_indicators wi
  WHERE p_symbols IS NULL OR wi.symbol = ANY (p_symbols)
  ORDER BY wi.symbol, wi.calc_date DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_equity_screener_rows(
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50,
  p_universe_tier text DEFAULT NULL,
  p_sector text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_pattern_stage text DEFAULT NULL,
  p_signal_filter text DEFAULT NULL
)
RETURNS TABLE(symbol text, sector text, industry text, pattern_state text, recommendation text, wsp_score integer, total_count bigint, payload jsonb)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH ranked AS (
    SELECT
      msr.symbol,
      CASE msr.sector
        WHEN 'Information Technology' THEN 'Technology'
        WHEN 'Health Care' THEN 'Healthcare'
        WHEN 'Metals & Mining' THEN 'Materials'
        ELSE msr.sector
      END AS norm_sector,
      public.resolve_visible_surface_industry(msr.symbol, msr.industry) AS norm_industry,
      msr.pattern AS pattern_state,
      msr.recommendation,
      GREATEST(0, LEAST(5, COALESCE(msr.score, 0)))::integer AS wsp_score,
      msr.payload,
      (
        COALESCE(msr.score, 0)::numeric * 9
        + GREATEST(LEAST(COALESCE((msr.payload->>'mansfield_rs')::numeric, 0), 35), -15) * 0.9
        + GREATEST(LEAST(COALESCE((msr.payload->>'volume_ratio')::numeric, 0), 4), 0) * 8
        + GREATEST(LEAST(20 + COALESCE((msr.payload->>'pct_from_52w_high')::numeric, -35), 20), 0)
        + CASE WHEN COALESCE((msr.payload->>'breakout_quality_pass')::boolean, false) THEN 18 ELSE 0 END
        + CASE WHEN COALESCE((msr.payload->>'breakout_confirmed')::boolean, false) THEN 10 ELSE 0 END
      ) AS quality_rank
    FROM public.market_scan_results_latest msr
    JOIN public.symbols s ON s.symbol = msr.symbol
    WHERE msr.symbol IS NOT NULL
      AND (p_universe_tier IS NULL OR s.universe_tier = p_universe_tier)
  ),
  filtered AS (
    SELECT *
    FROM ranked r
    WHERE (p_sector IS NULL OR r.norm_sector = p_sector)
      AND (p_industry IS NULL OR r.norm_industry = p_industry)
      AND (p_pattern_stage IS NULL OR r.pattern_state = p_pattern_stage)
      AND (
        p_signal_filter IS NULL
        OR (p_signal_filter = 'breakout' AND (COALESCE((r.payload->>'breakout_quality_pass')::boolean, false) OR COALESCE((r.payload->>'breakout_confirmed')::boolean, false)))
        OR (p_signal_filter = 'bullish' AND r.recommendation IN ('KÖP', 'BEVAKA'))
        OR (p_signal_filter = 'bearish' AND r.recommendation IN ('SÄLJ', 'UNDVIK'))
      )
  )
  SELECT
    r.symbol,
    r.norm_sector AS sector,
    r.norm_industry AS industry,
    r.pattern_state,
    r.recommendation,
    r.wsp_score,
    COUNT(*) OVER () AS total_count,
    r.payload
  FROM filtered r
  ORDER BY r.quality_rank DESC, r.wsp_score DESC NULLS LAST, r.symbol ASC
  LIMIT p_page_size OFFSET p_page * p_page_size;
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
      COALESCE(NULLIF(public.display_industry(COALESCE(NULLIF(msr.industry, ''), NULLIF(s.canonical_industry, ''), NULLIF(s.industry, ''), '')), ''), 'Other') AS di,
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
    HAVING COUNT(*) >= 2
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
