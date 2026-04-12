
-- Fix search_path on the two functions we just created
ALTER FUNCTION public.get_top_wsp_setups() SET search_path = public;
ALTER FUNCTION public.get_equity_screener_rows(integer, integer, text) SET search_path = public;
