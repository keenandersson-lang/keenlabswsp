
-- Allow anon SELECT on wsp_indicators
CREATE POLICY "Anon can read wsp indicators"
ON public.wsp_indicators
FOR SELECT
TO anon
USING (true);

-- Allow anon SELECT on market_scan_results (same scope as existing limited preview)
-- The existing "Limited public preview" policy already restricts anon to approved_for_live_scanner + recent 7 days
-- This broader policy replaces it for consistency with SECURITY DEFINER functions
-- We keep the existing limited preview policy as-is since it's more restrictive
