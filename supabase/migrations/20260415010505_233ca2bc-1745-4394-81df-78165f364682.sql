
-- First drop the old functions that reference the old return types
DROP FUNCTION IF EXISTS public.get_equity_pipeline_console_runs(integer);
DROP FUNCTION IF EXISTS public.get_equity_snapshots(integer);
DROP FUNCTION IF EXISTS public.get_equity_publish_history(integer);

-- Recreate using plpgsql to avoid the SQL stable validation against missing tables issue
CREATE OR REPLACE FUNCTION public.get_equity_pipeline_console_runs(p_limit integer DEFAULT 25)
RETURNS TABLE(
  id bigint, run_type text, status text, started_at timestamptz, finished_at timestamptz,
  trigger_source text, requested_by text, error_summary text, current_step text
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT r.id, r.run_type::text, r.status::text, r.started_at, r.finished_at,
         r.trigger_source::text, r.requested_by, r.error_summary,
         (SELECT s.step_name FROM public.pipeline_run_steps s WHERE s.run_id = r.id AND s.status = 'running' ORDER BY s.id DESC LIMIT 1) AS current_step
  FROM public.pipeline_runs r WHERE r.asset_class = 'equities'
  ORDER BY r.started_at DESC LIMIT GREATEST(p_limit, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_equity_snapshots(p_limit integer DEFAULT 25)
RETURNS TABLE(
  snapshot_id bigint, run_id bigint, status text, is_canonical boolean,
  completed_at timestamptz, symbols_expected integer, symbols_completed integer,
  sectors_expected integer, sectors_completed integer, industries_expected integer, industries_completed integer
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT ds.snapshot_id, ds.run_id, ds.status::text, ds.is_canonical, ds.completed_at,
         ds.symbols_expected, ds.symbols_completed, ds.sectors_expected, ds.sectors_completed, ds.industries_expected, ds.industries_completed
  FROM public.data_snapshots ds WHERE ds.asset_class = 'equities'
  ORDER BY ds.started_at DESC LIMIT GREATEST(p_limit, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_equity_publish_history(p_limit integer DEFAULT 10)
RETURNS TABLE(snapshot_id bigint, run_id bigint, published_at timestamptz, is_current_canonical boolean)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT ds.snapshot_id, ds.run_id, ds.completed_at, ds.is_canonical
  FROM public.data_snapshots ds
  WHERE ds.asset_class = 'equities' AND ds.status IN ('canonical', 'validated')
  ORDER BY ds.completed_at DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_equity_pipeline_console_runs(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_equity_snapshots(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_equity_publish_history(integer) TO authenticated, service_role;
