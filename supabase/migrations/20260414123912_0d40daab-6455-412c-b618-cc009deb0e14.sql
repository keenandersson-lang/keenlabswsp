
ALTER FUNCTION public.get_market_summary() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.get_heatmap_data() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.get_top_wsp_setups() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.get_industry_ranking(boolean, integer) SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.get_equity_screener_rows(text, integer, integer, text, text, text) SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.get_equity_screener_count(text, text, text, text) SECURITY DEFINER SET search_path = public;
