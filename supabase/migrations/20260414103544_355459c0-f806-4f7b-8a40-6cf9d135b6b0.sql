-- Drop the text overload to resolve PostgREST ambiguity
DROP FUNCTION IF EXISTS public.refresh_scanner_universe_snapshot(text, text);