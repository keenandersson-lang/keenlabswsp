
-- Drop the OLD overload (p_symbols first, different default for p_as_of_date)
DROP FUNCTION IF EXISTS public.materialize_wsp_indicators_from_prices(text[], date, integer);

-- Verify only one remains by testing the call works
-- The remaining signature is: (p_as_of_date date, p_min_bars integer, p_symbols text[])
