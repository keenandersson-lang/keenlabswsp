import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${Deno.env.get('SYNC_SECRET_KEY')}`) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const limit = typeof body.limit === 'number' ? body.limit : 10;
  const offset = typeof body.offset === 'number' ? body.offset : 0;

  // Get symbols needing backfill
  const { data: symbols, error: fetchErr } = await supabase.rpc('get_symbols_needing_backfill', {
    p_limit: limit,
    p_offset: offset,
  });

  if (fetchErr) {
    return jsonResponse(500, { ok: false, error: fetchErr.message });
  }

  if (!symbols || symbols.length === 0) {
    return jsonResponse(200, {
      ok: true,
      done: true,
      hasMore: false,
      processed: 0,
      results: [],
      nextOffset: offset,
      totalRemaining: 0,
    });
  }

  const results: Array<{ symbol: string; ok: boolean; bars?: number; error?: string }> = [];

  for (const sym of symbols) {
    try {
      const { data, error } = await supabase.rpc('backfill_symbol_yahoo', {
        p_symbol: sym.symbol,
      });

      if (error) {
        results.push({ symbol: sym.symbol, ok: false, error: error.message });
      } else {
        const result = data as { ok: boolean; bars?: number; error?: string } | null;
        results.push({
          symbol: sym.symbol,
          ok: result?.ok ?? false,
          bars: result?.bars ?? 0,
          error: result?.error ?? undefined,
        });
      }
    } catch (err) {
      results.push({ symbol: sym.symbol, ok: false, error: String(err).slice(0, 200) });
    }

    // Small delay between symbols to avoid rate limiting
    await new Promise((r) => setTimeout(r, 1500));
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const totalBars = results.reduce((sum, r) => sum + (r.bars ?? 0), 0);

  // Check remaining
  const { data: remaining } = await supabase.rpc('get_symbols_needing_backfill', {
    p_limit: 1,
    p_offset: offset + symbols.length,
  });

  const hasMore = Array.isArray(remaining) && remaining.length > 0;

  return jsonResponse(200, {
    ok: true,
    done: !hasMore,
    hasMore,
    processed: symbols.length,
    enriched: succeeded,
    failed,
    totalBars,
    results,
    nextOffset: offset + symbols.length,
    totalRemaining: hasMore ? null : 0,
  });
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
