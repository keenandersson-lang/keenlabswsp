import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const ROUTE_VERSION = 'supabase-wsp-scan-results@2026-03-27.1-phase7';

type Scope = 'live_default' | 'tier1_default' | 'approved_for_live_scanner' | 'review_needed' | 'blocked_low_quality' | 'all';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const scopeParam = (url.searchParams.get('scope') ?? 'live_default') as Scope;
    const supportedScopes: Scope[] = ['live_default', 'tier1_default', 'approved_for_live_scanner', 'review_needed', 'blocked_low_quality', 'all'];
    const scope: Scope = supportedScopes.includes(scopeParam) ? scopeParam : 'live_default';

    const limitParam = Number(url.searchParams.get('limit') ?? '250');
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(1000, Math.round(limitParam))) : 250;

    let query = supabase
      .from('market_scan_results_latest')
      .select('*')
      .order('score', { ascending: false })
      .order('symbol', { ascending: true })
      .limit(limit);

    if (scope === 'live_default') {
      query = query.or('is_tier1_default.eq.true,approved_for_live_scanner.eq.true');
    } else if (scope !== 'all') {
      if (scope === 'tier1_default') query = query.eq('is_tier1_default', true);
      else if (scope === 'approved_for_live_scanner') query = query.eq('approved_for_live_scanner', true);
      else if (scope === 'review_needed') query = query.eq('review_needed', true);
      else if (scope === 'blocked_low_quality') query = query.eq('blocked_low_quality', true);
    }

    const { data, error } = await query;
    if (error) {
      return jsonResponse(500, {
        ok: false,
        error: { code: 'QUERY_FAILED', message: error.message },
        routeVersion: ROUTE_VERSION,
      });
    }

    let results = data ?? [];
    if (results.length === 0) {
      const fallback = await supabase
        .from('symbols')
        .select('symbol, sector, industry')
        .eq('is_active', true)
        .order('symbol', { ascending: true })
        .limit(limit);
      if (!fallback.error && fallback.data) {
        results = fallback.data.map((row: { symbol: string; sector?: string | null; industry?: string | null }) => ({
          symbol: row.symbol,
          sector: row.sector ?? null,
          industry: row.industry ?? null,
          pattern: null,
          recommendation: null,
          score: null,
          trend_state: null,
        }));
      }
    }

    const { data: operatorSnapshot, error: snapshotError } = await supabase.rpc('scanner_operator_snapshot');

    return jsonResponse(200, {
      ok: true,
      scope,
      count: results.length,
      results,
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
