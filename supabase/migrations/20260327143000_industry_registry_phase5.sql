CREATE TABLE IF NOT EXISTS public.industry_registry_versions (
  version integer PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  notes text,
  is_active boolean NOT NULL DEFAULT false,
  activated_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.industry_proxy_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_industry text NOT NULL,
  canonical_sector text,
  registry_version integer NOT NULL REFERENCES public.industry_registry_versions(version) ON DELETE CASCADE,
  registry_status text NOT NULL DEFAULT 'draft',
  proxy_type text NOT NULL DEFAULT 'unresolved',
  proxy_symbol text,
  basket_name text,
  basket_method text,
  basket_source text,
  confidence_level text NOT NULL DEFAULT 'low',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  updated_by text NOT NULL DEFAULT 'system',
  CONSTRAINT industry_proxy_registry_industry_version_unique UNIQUE (canonical_industry, registry_version),
  CONSTRAINT industry_proxy_registry_status_valid CHECK (registry_status IN ('draft', 'active', 'deprecated', 'superseded')),
  CONSTRAINT industry_proxy_registry_proxy_type_valid CHECK (proxy_type IN ('direct_proxy_symbol', 'internal_equal_weight_basket', 'internal_weighted_basket', 'unresolved')),
  CONSTRAINT industry_proxy_registry_confidence_valid CHECK (confidence_level IN ('high', 'medium', 'low'))
);

CREATE TABLE IF NOT EXISTS public.industry_basket_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_industry text NOT NULL,
  registry_version integer NOT NULL REFERENCES public.industry_registry_versions(version) ON DELETE CASCADE,
  symbol text NOT NULL REFERENCES public.symbols(symbol) ON DELETE CASCADE,
  membership_status text NOT NULL DEFAULT 'included',
  weight_method text,
  weight_value numeric(10,6),
  inclusion_reason text,
  exclusion_reason text,
  confidence_level text NOT NULL DEFAULT 'low',
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  updated_by text NOT NULL DEFAULT 'system',
  CONSTRAINT industry_basket_memberships_industry_version_symbol_unique UNIQUE (canonical_industry, registry_version, symbol),
  CONSTRAINT industry_basket_memberships_status_valid CHECK (membership_status IN ('included', 'excluded', 'watchlist')),
  CONSTRAINT industry_basket_memberships_confidence_valid CHECK (confidence_level IN ('high', 'medium', 'low')),
  CONSTRAINT industry_basket_memberships_weight_method_valid CHECK (
    weight_method IS NULL OR weight_method IN ('equal_weight', 'manual_weight', 'market_cap_weight', 'liquidity_weight')
  )
);

CREATE TABLE IF NOT EXISTS public.industry_registry_audit_log (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL,
  action text NOT NULL,
  changed_by text NOT NULL DEFAULT 'system',
  change_source text NOT NULL DEFAULT 'system',
  reason text,
  affected_industry text,
  affected_symbols text[],
  registry_version integer,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT industry_registry_audit_log_entity_type_valid CHECK (
    entity_type IN ('registry_version', 'industry_proxy_registry', 'industry_basket_membership', 'registry_activation', 'rollback')
  )
);

CREATE INDEX IF NOT EXISTS idx_industry_proxy_registry_version_status
  ON public.industry_proxy_registry (registry_version, registry_status, proxy_type);

CREATE INDEX IF NOT EXISTS idx_industry_proxy_registry_sector
  ON public.industry_proxy_registry (canonical_sector, canonical_industry);

CREATE INDEX IF NOT EXISTS idx_industry_basket_memberships_industry
  ON public.industry_basket_memberships (registry_version, canonical_industry, membership_status);

CREATE INDEX IF NOT EXISTS idx_industry_registry_audit_log_created
  ON public.industry_registry_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_industry_registry_audit_log_industry
  ON public.industry_registry_audit_log (affected_industry, registry_version);

CREATE OR REPLACE FUNCTION public.set_timestamp_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_industry_proxy_registry_updated_at ON public.industry_proxy_registry;
CREATE TRIGGER trg_industry_proxy_registry_updated_at
BEFORE UPDATE ON public.industry_proxy_registry
FOR EACH ROW
EXECUTE FUNCTION public.set_timestamp_updated_at();

DROP TRIGGER IF EXISTS trg_industry_basket_memberships_updated_at ON public.industry_basket_memberships;
CREATE TRIGGER trg_industry_basket_memberships_updated_at
BEFORE UPDATE ON public.industry_basket_memberships
FOR EACH ROW
EXECUTE FUNCTION public.set_timestamp_updated_at();

CREATE OR REPLACE FUNCTION public.log_industry_registry_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  change_actor text := COALESCE(current_setting('request.jwt.claim.sub', true), current_user, 'system');
  source_label text := COALESCE(current_setting('request.jwt.claim.role', true), 'system');
BEGIN
  IF TG_TABLE_NAME = 'industry_proxy_registry' THEN
    INSERT INTO public.industry_registry_audit_log (
      entity_type,
      action,
      changed_by,
      change_source,
      affected_industry,
      registry_version,
      previous_value,
      new_value
    )
    VALUES (
      'industry_proxy_registry',
      lower(TG_OP),
      change_actor,
      source_label,
      COALESCE(NEW.canonical_industry, OLD.canonical_industry),
      COALESCE(NEW.registry_version, OLD.registry_version),
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
    );
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'industry_basket_memberships' THEN
    INSERT INTO public.industry_registry_audit_log (
      entity_type,
      action,
      changed_by,
      change_source,
      affected_industry,
      affected_symbols,
      registry_version,
      previous_value,
      new_value
    )
    VALUES (
      'industry_basket_membership',
      lower(TG_OP),
      change_actor,
      source_label,
      COALESCE(NEW.canonical_industry, OLD.canonical_industry),
      ARRAY[COALESCE(NEW.symbol, OLD.symbol)],
      COALESCE(NEW.registry_version, OLD.registry_version),
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
    );
    RETURN COALESCE(NEW, OLD);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_industry_proxy_registry_audit ON public.industry_proxy_registry;
CREATE TRIGGER trg_industry_proxy_registry_audit
AFTER INSERT OR UPDATE OR DELETE ON public.industry_proxy_registry
FOR EACH ROW
EXECUTE FUNCTION public.log_industry_registry_change();

DROP TRIGGER IF EXISTS trg_industry_basket_memberships_audit ON public.industry_basket_memberships;
CREATE TRIGGER trg_industry_basket_memberships_audit
AFTER INSERT OR UPDATE OR DELETE ON public.industry_basket_memberships
FOR EACH ROW
EXECUTE FUNCTION public.log_industry_registry_change();

INSERT INTO public.industry_registry_versions (version, created_by, notes, is_active, activated_at)
SELECT 1, 'phase5_bootstrap', 'Bootstrap registry from classified symbol universe', true, now()
WHERE NOT EXISTS (SELECT 1 FROM public.industry_registry_versions WHERE version = 1);

CREATE OR REPLACE FUNCTION public.create_industry_registry_version(
  p_created_by text DEFAULT 'system',
  p_notes text DEFAULT NULL,
  p_copy_from_version integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_version integer;
  source_version integer;
BEGIN
  SELECT COALESCE(MAX(version), 0) + 1 INTO new_version FROM public.industry_registry_versions;

  INSERT INTO public.industry_registry_versions (version, created_by, notes, is_active)
  VALUES (new_version, COALESCE(NULLIF(p_created_by, ''), 'system'), p_notes, false);

  source_version := COALESCE(
    p_copy_from_version,
    (SELECT version FROM public.industry_registry_versions WHERE is_active = true ORDER BY version DESC LIMIT 1)
  );

  IF source_version IS NOT NULL THEN
    INSERT INTO public.industry_proxy_registry (
      canonical_industry,
      canonical_sector,
      registry_version,
      registry_status,
      proxy_type,
      proxy_symbol,
      basket_name,
      basket_method,
      basket_source,
      confidence_level,
      notes,
      created_by,
      updated_by
    )
    SELECT
      canonical_industry,
      canonical_sector,
      new_version,
      'draft',
      proxy_type,
      proxy_symbol,
      basket_name,
      basket_method,
      basket_source,
      confidence_level,
      notes,
      COALESCE(NULLIF(p_created_by, ''), 'system'),
      COALESCE(NULLIF(p_created_by, ''), 'system')
    FROM public.industry_proxy_registry
    WHERE registry_version = source_version;

    INSERT INTO public.industry_basket_memberships (
      canonical_industry,
      registry_version,
      symbol,
      membership_status,
      weight_method,
      weight_value,
      inclusion_reason,
      exclusion_reason,
      confidence_level,
      source,
      created_by,
      updated_by
    )
    SELECT
      canonical_industry,
      new_version,
      symbol,
      membership_status,
      weight_method,
      weight_value,
      inclusion_reason,
      exclusion_reason,
      confidence_level,
      source,
      COALESCE(NULLIF(p_created_by, ''), 'system'),
      COALESCE(NULLIF(p_created_by, ''), 'system')
    FROM public.industry_basket_memberships
    WHERE registry_version = source_version;
  END IF;

  INSERT INTO public.industry_registry_audit_log (
    entity_type,
    action,
    changed_by,
    change_source,
    registry_version,
    reason,
    new_value
  ) VALUES (
    'registry_version',
    'create',
    COALESCE(NULLIF(p_created_by, ''), 'system'),
    'manual_or_automation',
    new_version,
    p_notes,
    jsonb_build_object('copied_from_version', source_version)
  );

  RETURN new_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_industry_registry_from_symbols(
  p_registry_version integer,
  p_changed_by text DEFAULT 'system',
  p_reason text DEFAULT 'automated_refresh'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted_registry integer := 0;
  v_upserted_members integer := 0;
BEGIN
  INSERT INTO public.industry_proxy_registry (
    canonical_industry,
    canonical_sector,
    registry_version,
    registry_status,
    proxy_type,
    basket_name,
    basket_method,
    basket_source,
    confidence_level,
    notes,
    created_by,
    updated_by
  )
  SELECT
    s.canonical_industry,
    MAX(s.canonical_sector) AS canonical_sector,
    p_registry_version,
    'draft',
    CASE
      WHEN COUNT(*) FILTER (
        WHERE s.support_level = 'full_wsp_equity'
          AND s.classification_status IN ('canonicalized', 'manually_reviewed')
          AND COALESCE(s.classification_confidence_level, 'low') IN ('high', 'medium')
      ) >= 3 THEN 'internal_equal_weight_basket'
      ELSE 'unresolved'
    END AS proxy_type,
    CONCAT(s.canonical_industry, ' Internal Basket') AS basket_name,
    CASE
      WHEN COUNT(*) FILTER (
        WHERE s.support_level = 'full_wsp_equity'
          AND s.classification_status IN ('canonicalized', 'manually_reviewed')
          AND COALESCE(s.classification_confidence_level, 'low') IN ('high', 'medium')
      ) >= 3 THEN 'quality_gated_equal_weight'
      ELSE NULL
    END AS basket_method,
    'phase5_registry_refresh',
    CASE
      WHEN COUNT(*) FILTER (
        WHERE s.support_level = 'full_wsp_equity'
          AND s.classification_status IN ('canonicalized', 'manually_reviewed')
          AND COALESCE(s.classification_confidence_level, 'low') = 'high'
      ) >= 5 THEN 'high'
      WHEN COUNT(*) FILTER (
        WHERE s.support_level = 'full_wsp_equity'
          AND s.classification_status IN ('canonicalized', 'manually_reviewed')
          AND COALESCE(s.classification_confidence_level, 'low') IN ('high', 'medium')
      ) >= 3 THEN 'medium'
      ELSE 'low'
    END AS confidence_level,
    'auto_generated_from_symbol_quality',
    COALESCE(NULLIF(p_changed_by, ''), 'system'),
    COALESCE(NULLIF(p_changed_by, ''), 'system')
  FROM public.symbols s
  WHERE s.canonical_industry IS NOT NULL
    AND s.canonical_sector IS NOT NULL
    AND s.classification_status IN ('canonicalized', 'manually_reviewed')
    AND s.support_level IN ('full_wsp_equity', 'limited_equity')
  GROUP BY s.canonical_industry
  ON CONFLICT (canonical_industry, registry_version)
  DO UPDATE SET
    canonical_sector = EXCLUDED.canonical_sector,
    proxy_type = EXCLUDED.proxy_type,
    basket_name = EXCLUDED.basket_name,
    basket_method = EXCLUDED.basket_method,
    basket_source = EXCLUDED.basket_source,
    confidence_level = EXCLUDED.confidence_level,
    notes = EXCLUDED.notes,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  GET DIAGNOSTICS v_inserted_registry = ROW_COUNT;

  INSERT INTO public.industry_basket_memberships (
    canonical_industry,
    registry_version,
    symbol,
    membership_status,
    weight_method,
    weight_value,
    inclusion_reason,
    exclusion_reason,
    confidence_level,
    source,
    created_by,
    updated_by
  )
  SELECT
    s.canonical_industry,
    p_registry_version,
    s.symbol,
    CASE
      WHEN s.support_level = 'full_wsp_equity'
        AND s.classification_status IN ('canonicalized', 'manually_reviewed')
        AND COALESCE(s.classification_confidence_level, 'low') IN ('high', 'medium') THEN 'included'
      WHEN s.support_level = 'limited_equity'
        AND COALESCE(s.classification_confidence_level, 'low') IN ('high', 'medium') THEN 'watchlist'
      ELSE 'excluded'
    END AS membership_status,
    CASE
      WHEN s.support_level = 'full_wsp_equity'
        AND s.classification_status IN ('canonicalized', 'manually_reviewed')
        AND COALESCE(s.classification_confidence_level, 'low') IN ('high', 'medium') THEN 'equal_weight'
      ELSE NULL
    END AS weight_method,
    CASE
      WHEN s.support_level = 'full_wsp_equity'
        AND s.classification_status IN ('canonicalized', 'manually_reviewed')
        AND COALESCE(s.classification_confidence_level, 'low') IN ('high', 'medium') THEN 1
      ELSE NULL
    END AS weight_value,
    CASE
      WHEN s.support_level = 'full_wsp_equity'
        AND s.classification_status IN ('canonicalized', 'manually_reviewed')
        AND COALESCE(s.classification_confidence_level, 'low') IN ('high', 'medium') THEN 'passes_quality_gate_for_internal_basket'
      ELSE NULL
    END AS inclusion_reason,
    CASE
      WHEN s.support_level NOT IN ('full_wsp_equity', 'limited_equity') THEN CONCAT('support_level_', s.support_level)
      WHEN COALESCE(s.classification_confidence_level, 'low') = 'low' THEN 'low_classification_confidence'
      WHEN s.classification_status NOT IN ('canonicalized', 'manually_reviewed') THEN CONCAT('classification_', s.classification_status)
      ELSE NULL
    END AS exclusion_reason,
    COALESCE(s.classification_confidence_level, 'low'),
    'phase5_registry_refresh',
    COALESCE(NULLIF(p_changed_by, ''), 'system'),
    COALESCE(NULLIF(p_changed_by, ''), 'system')
  FROM public.symbols s
  WHERE s.canonical_industry IS NOT NULL
    AND s.classification_status IN ('canonicalized', 'manually_reviewed', 'ambiguous', 'unresolved')
    AND s.support_level IN ('full_wsp_equity', 'limited_equity', 'data_only', 'excluded')
  ON CONFLICT (canonical_industry, registry_version, symbol)
  DO UPDATE SET
    membership_status = EXCLUDED.membership_status,
    weight_method = EXCLUDED.weight_method,
    weight_value = EXCLUDED.weight_value,
    inclusion_reason = EXCLUDED.inclusion_reason,
    exclusion_reason = EXCLUDED.exclusion_reason,
    confidence_level = EXCLUDED.confidence_level,
    source = EXCLUDED.source,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  GET DIAGNOSTICS v_upserted_members = ROW_COUNT;

  INSERT INTO public.industry_registry_audit_log (
    entity_type,
    action,
    changed_by,
    change_source,
    registry_version,
    reason,
    new_value
  ) VALUES (
    'registry_version',
    'refresh',
    COALESCE(NULLIF(p_changed_by, ''), 'system'),
    'automation',
    p_registry_version,
    p_reason,
    jsonb_build_object('registry_rows_touched', v_inserted_registry, 'membership_rows_touched', v_upserted_members)
  );

  RETURN jsonb_build_object(
    'registry_rows_touched', v_inserted_registry,
    'membership_rows_touched', v_upserted_members,
    'version', p_registry_version
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_active_industry_registry_version(
  p_target_version integer,
  p_changed_by text DEFAULT 'operator',
  p_reason text DEFAULT 'promotion_to_active'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  previous_active integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.industry_registry_versions WHERE version = p_target_version) THEN
    RAISE EXCEPTION 'Registry version % not found', p_target_version;
  END IF;

  SELECT version INTO previous_active
  FROM public.industry_registry_versions
  WHERE is_active = true
  ORDER BY version DESC
  LIMIT 1;

  UPDATE public.industry_registry_versions
  SET is_active = false
  WHERE is_active = true;

  UPDATE public.industry_registry_versions
  SET is_active = true,
      activated_at = now()
  WHERE version = p_target_version;

  UPDATE public.industry_proxy_registry
  SET registry_status = CASE WHEN registry_version = p_target_version THEN 'active' ELSE 'superseded' END,
      updated_by = COALESCE(NULLIF(p_changed_by, ''), 'operator'),
      updated_at = now()
  WHERE registry_version IN (p_target_version, COALESCE(previous_active, -1));

  INSERT INTO public.industry_registry_audit_log (
    entity_type,
    action,
    changed_by,
    change_source,
    registry_version,
    reason,
    previous_value,
    new_value
  ) VALUES (
    'registry_activation',
    'activate',
    COALESCE(NULLIF(p_changed_by, ''), 'operator'),
    'manual_or_automation',
    p_target_version,
    p_reason,
    jsonb_build_object('previous_active_version', previous_active),
    jsonb_build_object('active_version', p_target_version)
  );

  RETURN jsonb_build_object('previous_active_version', previous_active, 'active_version', p_target_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_industry_registry_version(
  p_target_version integer,
  p_changed_by text DEFAULT 'operator',
  p_reason text DEFAULT 'rollback'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  result := public.set_active_industry_registry_version(
    p_target_version,
    COALESCE(NULLIF(p_changed_by, ''), 'operator'),
    p_reason
  );

  INSERT INTO public.industry_registry_audit_log (
    entity_type,
    action,
    changed_by,
    change_source,
    registry_version,
    reason,
    new_value
  ) VALUES (
    'rollback',
    'rollback_activate',
    COALESCE(NULLIF(p_changed_by, ''), 'operator'),
    'manual_or_automation',
    p_target_version,
    p_reason,
    result
  );

  RETURN result;
END;
$$;

DO $$
DECLARE
  has_registry_rows boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.industry_proxy_registry WHERE registry_version = 1
  ) INTO has_registry_rows;

  IF NOT has_registry_rows THEN
    PERFORM public.refresh_industry_registry_from_symbols(1, 'phase5_bootstrap', 'bootstrap_from_symbols');
    UPDATE public.industry_proxy_registry
    SET registry_status = 'active', updated_by = 'phase5_bootstrap'
    WHERE registry_version = 1;
  END IF;
END;
$$;

CREATE OR REPLACE VIEW public.industry_registry_active_version AS
SELECT version, created_at, created_by, notes, is_active, activated_at
FROM public.industry_registry_versions
WHERE is_active = true
ORDER BY version DESC
LIMIT 1;

CREATE OR REPLACE VIEW public.industry_registry_status_counts AS
SELECT
  r.registry_version,
  r.registry_status,
  COUNT(*)::bigint AS industry_count
FROM public.industry_proxy_registry r
GROUP BY r.registry_version, r.registry_status;

CREATE OR REPLACE VIEW public.industry_registry_proxy_type_counts AS
SELECT
  r.registry_version,
  r.proxy_type,
  COUNT(*)::bigint AS industry_count
FROM public.industry_proxy_registry r
GROUP BY r.registry_version, r.proxy_type;

CREATE OR REPLACE VIEW public.industry_registry_pending_queue AS
SELECT
  r.registry_version,
  r.canonical_sector,
  r.canonical_industry,
  r.proxy_type,
  r.registry_status,
  r.confidence_level,
  r.proxy_symbol,
  r.basket_name,
  r.basket_method,
  COALESCE(member_counts.included_count, 0) AS included_count,
  COALESCE(member_counts.watchlist_count, 0) AS watchlist_count,
  COALESCE(member_counts.excluded_count, 0) AS excluded_count,
  r.updated_at,
  r.updated_by,
  r.notes
FROM public.industry_proxy_registry r
LEFT JOIN (
  SELECT
    canonical_industry,
    registry_version,
    COUNT(*) FILTER (WHERE membership_status = 'included')::bigint AS included_count,
    COUNT(*) FILTER (WHERE membership_status = 'watchlist')::bigint AS watchlist_count,
    COUNT(*) FILTER (WHERE membership_status = 'excluded')::bigint AS excluded_count
  FROM public.industry_basket_memberships
  GROUP BY canonical_industry, registry_version
) member_counts
  ON member_counts.canonical_industry = r.canonical_industry
 AND member_counts.registry_version = r.registry_version
WHERE r.proxy_type = 'unresolved'
   OR r.registry_status IN ('draft', 'deprecated')
   OR r.confidence_level = 'low';

CREATE OR REPLACE VIEW public.industry_registry_recent_audit AS
SELECT
  id,
  entity_type,
  action,
  changed_by,
  change_source,
  reason,
  affected_industry,
  affected_symbols,
  registry_version,
  previous_value,
  new_value,
  created_at
FROM public.industry_registry_audit_log
ORDER BY created_at DESC
LIMIT 200;
