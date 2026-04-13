
-- Drop the OLD version with different parameter order (p_page default 0, different order)
DROP FUNCTION IF EXISTS public.get_equity_screener_rows(integer, integer, text, text, text, text);
