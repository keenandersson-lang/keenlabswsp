ALTER FUNCTION public.run_equity_pipeline(
  public.pipeline_run_type,
  public.pipeline_trigger_source,
  text,
  jsonb
) SET statement_timeout = '15min';

ALTER FUNCTION public.publish_equity_snapshot(bigint, bigint)
  SET statement_timeout = '5min';

ALTER FUNCTION public.validate_equity_snapshot(bigint)
  SET statement_timeout = '5min';