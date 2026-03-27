import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const ROUTE_VERSION = 'supabase-wsp-scan-results@2026-03-27.1-phase7';

type Scope = 'tier1_default' | 'approved_for_live_scanner' | 'review_needed' | 'broader_candidate' | 'all';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const scopeParam = (url.searchParams.get('scope') ?? 'tier1_default') as Scope;
    const supportedScopes: Scope[] = ['tier1_default', 'approved_for_live_scanner', 'review_needed', 'broader_candidate', 'all'];
    const scope: Scope = supportedScopes.includes(scopeParam) ? scopeParam : 'tier1_default';

    const limitParam = Number(url.searchParams.get('limit') ?? '250');
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(1000, Math.round(limitParam))) : 250;

    let query = supabase
      .from('market_scan_results_latest')
      .select('*')
      .order('score', { ascending: false })
      .order('scan_timestamp', { ascending: false })
      .limit(limit);

    if (scope !== 'all') {
      query = query.eq('promotion_status', scope);
    }

    const { data, error } = await query;
    if (error) {
      return jsonResponse(500, {
        ok: false,
        error: { code: 'QUERY_FAILED', message: error.message },
        routeVersion: ROUTE_VERSION,
      });
    }

    const { data: operatorSnapshot, error: snapshotError } = await supabase.rpc('scanner_operator_snapshot');

    return jsonResponse(200, {
      ok: true,
      scope,
      count: data?.length ?? 0,
      results: data ?? [],
      operator: snapshotError ? null : operatorSnapshot,
      routeVersion: ROUTE_VERSION,
    });
  } catch (err) {
    console.error('wsp-scan-results error', err);
    return jsonResponse(500, {
      ok: false,
      error: {
        code: 'SERVER_ERROR',
        message: err instanceof Error ? err.message : 'Unknown server error',
      },
      routeVersion: ROUTE_VERSION,
    });
  }
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
