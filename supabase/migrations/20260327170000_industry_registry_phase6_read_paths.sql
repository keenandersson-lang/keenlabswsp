CREATE OR REPLACE VIEW public.industry_registry_active_entries AS
WITH active_version AS (
  SELECT version
  FROM public.industry_registry_active_version
  LIMIT 1
)
SELECT
  v.version AS active_registry_version,
  r.canonical_sector,
  r.canonical_industry,
  r.registry_status,
  r.proxy_type,
  r.proxy_symbol,
  r.basket_name,
  r.basket_method,
  r.basket_source,
  r.confidence_level,
  r.notes,
  r.updated_at
FROM active_version v
JOIN public.industry_proxy_registry r
  ON r.registry_version = v.version
WHERE r.registry_status = 'active';

CREATE OR REPLACE VIEW public.industry_registry_active_memberships AS
WITH active_version AS (
  SELECT version
  FROM public.industry_registry_active_version
  LIMIT 1
)
SELECT
  v.version AS active_registry_version,
  m.canonical_industry,
  m.symbol,
  m.membership_status,
  m.weight_method,
  m.weight_value,
  m.inclusion_reason,
  m.exclusion_reason,
  m.confidence_level,
  m.updated_at
FROM active_version v
JOIN public.industry_basket_memberships m
  ON m.registry_version = v.version;

CREATE OR REPLACE VIEW public.sector_industry_stock_drilldown_active AS
WITH active_registry AS (
  SELECT *
  FROM public.industry_registry_active_entries
),
active_memberships AS (
  SELECT *
  FROM public.industry_registry_active_memberships
)
SELECT
  ar.active_registry_version,
  COALESCE(NULLIF(s.canonical_sector, ''), ar.canonical_sector, 'Unknown') AS canonical_sector,
  COALESCE(NULLIF(s.canonical_industry, ''), ar.canonical_industry) AS canonical_industry,
  s.symbol,
  COALESCE(NULLIF(s.company_name, ''), NULLIF(s.name, ''), s.symbol) AS company_name,
  s.support_level,
  s.classification_status,
  COALESCE(s.classification_confidence_level, 'low') AS classification_confidence_level,
  CASE
    WHEN s.classification_status IN ('canonicalized', 'manually_reviewed')
      AND COALESCE(s.classification_confidence_level, 'low') IN ('high', 'medium') THEN true
    ELSE false
  END AS passes_quality_gate,
  ar.proxy_type,
  ar.proxy_symbol,
  ar.basket_name,
  ar.basket_method,
  am.membership_status,
  am.weight_method,
  am.weight_value,
  am.inclusion_reason,
  am.exclusion_reason,
  CASE WHEN s.support_level = 'full_wsp_equity' THEN true ELSE false END AS is_tier1_visible_default
FROM public.symbols s
JOIN active_registry ar
  ON ar.canonical_industry = s.canonical_industry
LEFT JOIN active_memberships am
  ON am.canonical_industry = s.canonical_industry
 AND am.symbol = s.symbol
WHERE s.canonical_industry IS NOT NULL
  AND s.canonical_sector IS NOT NULL;

CREATE OR REPLACE VIEW public.symbol_industry_alignment_active AS
WITH active_registry AS (
  SELECT *
  FROM public.industry_registry_active_entries
),
active_memberships AS (
  SELECT *
  FROM public.industry_registry_active_memberships
)
SELECT
  ar.active_registry_version,
  s.symbol,
  COALESCE(NULLIF(s.canonical_sector, ''), ar.canonical_sector, 'Unknown') AS canonical_sector,
  COALESCE(NULLIF(s.canonical_industry, ''), ar.canonical_industry) AS canonical_industry,
  s.support_level,
  s.classification_status,
  COALESCE(s.classification_confidence_level, 'low') AS classification_confidence_level,
  ar.proxy_type,
  ar.proxy_symbol,
  ar.basket_name,
  ar.basket_method,
  am.membership_status,
  am.weight_method,
  am.weight_value,
  CASE
    WHEN s.classification_status NOT IN ('canonicalized', 'manually_reviewed')
      OR COALESCE(s.classification_confidence_level, 'low') = 'low'
      THEN 'blocked_low_quality_classification'
    WHEN ar.proxy_type = 'unresolved'
      THEN 'unresolved'
    WHEN ar.proxy_type = 'direct_proxy_symbol' AND ar.proxy_symbol = s.symbol
      THEN 'direct_proxy_symbol'
    WHEN ar.proxy_type = 'direct_proxy_symbol' AND ar.proxy_symbol IS NOT NULL
      THEN 'aligned_to_direct_proxy'
    WHEN ar.proxy_type IN ('internal_equal_weight_basket', 'internal_weighted_basket')
      AND COALESCE(am.membership_status, 'excluded') = 'included'
      THEN 'aligned_to_internal_basket'
    WHEN ar.proxy_type IN ('internal_equal_weight_basket', 'internal_weighted_basket')
      AND COALESCE(am.membership_status, 'excluded') <> 'included'
      THEN 'basket_membership_not_included'
    ELSE 'unresolved'
  END AS alignment_status,
  CASE
    WHEN s.classification_status NOT IN ('canonicalized', 'manually_reviewed')
      OR COALESCE(s.classification_confidence_level, 'low') = 'low'
      THEN COALESCE(NULLIF(s.classification_status, ''), 'unknown_classification_status')
    WHEN ar.proxy_type = 'unresolved'
      THEN 'industry_registry_unresolved'
    WHEN ar.proxy_type = 'direct_proxy_symbol' AND ar.proxy_symbol = s.symbol
      THEN 'symbol_is_designated_proxy'
    WHEN ar.proxy_type = 'direct_proxy_symbol' AND ar.proxy_symbol IS NOT NULL
      THEN CONCAT('uses_proxy_symbol_', ar.proxy_symbol)
    WHEN ar.proxy_type IN ('internal_equal_weight_basket', 'internal_weighted_basket')
      THEN CONCAT('membership_', COALESCE(am.membership_status, 'excluded'))
    ELSE 'alignment_unresolved'
  END AS alignment_reason,
  CASE
    WHEN s.classification_status IN ('canonicalized', 'manually_reviewed')
      AND COALESCE(s.classification_confidence_level, 'low') IN ('high', 'medium')
      AND ar.proxy_type <> 'unresolved'
      THEN true
    ELSE false
  END AS alignment_eligible
FROM public.symbols s
JOIN active_registry ar
  ON ar.canonical_industry = s.canonical_industry
LEFT JOIN active_memberships am
  ON am.canonical_industry = s.canonical_industry
 AND am.symbol = s.symbol
WHERE s.canonical_industry IS NOT NULL;

CREATE OR REPLACE VIEW public.industry_registry_active_operator_summary AS
WITH active_version AS (
  SELECT version
  FROM public.industry_registry_active_version
  LIMIT 1
),
registry_counts AS (
  SELECT
    r.registry_version,
    COUNT(*)::bigint AS active_industries,
    COUNT(*) FILTER (WHERE r.proxy_type = 'direct_proxy_symbol')::bigint AS direct_proxy_industries,
    COUNT(*) FILTER (WHERE r.proxy_type = 'internal_equal_weight_basket')::bigint AS internal_equal_weight_industries,
    COUNT(*) FILTER (WHERE r.proxy_type = 'internal_weighted_basket')::bigint AS internal_weighted_industries,
    COUNT(*) FILTER (WHERE r.proxy_type = 'unresolved')::bigint AS unresolved_industries
  FROM public.industry_proxy_registry r
  JOIN active_version av ON av.version = r.registry_version
  WHERE r.registry_status = 'active'
  GROUP BY r.registry_version
),
membership_counts AS (
  SELECT
    m.registry_version,
    COUNT(DISTINCT m.canonical_industry)::bigint AS industries_with_memberships,
    COUNT(*) FILTER (WHERE m.membership_status = 'included')::bigint AS included_memberships,
    COUNT(*) FILTER (WHERE m.membership_status = 'watchlist')::bigint AS watchlist_memberships,
    COUNT(*) FILTER (WHERE m.membership_status = 'excluded')::bigint AS excluded_memberships
  FROM public.industry_basket_memberships m
  JOIN active_version av ON av.version = m.registry_version
  GROUP BY m.registry_version
),
alignment_counts AS (
  SELECT
    a.active_registry_version AS registry_version,
    COUNT(*) FILTER (WHERE a.alignment_status = 'blocked_low_quality_classification')::bigint AS blocked_low_quality_symbols,
    COUNT(*) FILTER (WHERE a.alignment_status = 'aligned_to_internal_basket')::bigint AS aligned_internal_basket_symbols,
    COUNT(*) FILTER (WHERE a.alignment_status IN ('aligned_to_direct_proxy', 'direct_proxy_symbol'))::bigint AS aligned_direct_proxy_symbols,
    COUNT(*) FILTER (WHERE a.alignment_status = 'unresolved')::bigint AS unresolved_alignment_symbols
  FROM public.symbol_industry_alignment_active a
  GROUP BY a.active_registry_version
)
SELECT
  av.version AS active_registry_version,
  COALESCE(rc.active_industries, 0) AS active_industries,
  COALESCE(rc.direct_proxy_industries, 0) AS direct_proxy_industries,
  COALESCE(rc.internal_equal_weight_industries, 0) AS internal_equal_weight_industries,
  COALESCE(rc.internal_weighted_industries, 0) AS internal_weighted_industries,
  COALESCE(rc.unresolved_industries, 0) AS unresolved_industries,
  COALESCE(mc.industries_with_memberships, 0) AS industries_with_memberships,
  COALESCE(mc.included_memberships, 0) AS included_memberships,
  COALESCE(mc.watchlist_memberships, 0) AS watchlist_memberships,
  COALESCE(mc.excluded_memberships, 0) AS excluded_memberships,
  COALESCE(ac.blocked_low_quality_symbols, 0) AS blocked_low_quality_symbols,
  COALESCE(ac.aligned_internal_basket_symbols, 0) AS aligned_internal_basket_symbols,
  COALESCE(ac.aligned_direct_proxy_symbols, 0) AS aligned_direct_proxy_symbols,
  COALESCE(ac.unresolved_alignment_symbols, 0) AS unresolved_alignment_symbols
FROM active_version av
LEFT JOIN registry_counts rc ON rc.registry_version = av.version
LEFT JOIN membership_counts mc ON mc.registry_version = av.version
LEFT JOIN alignment_counts ac ON ac.registry_version = av.version;
