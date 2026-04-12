
-- Drop the old 2-parameter overload that causes PGRST203 ambiguity
DROP FUNCTION IF EXISTS public.get_equity_screener_rows(integer, integer);
