import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${Deno.env.get("SYNC_SECRET_KEY")}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const requestedBy = typeof body.requested_by === 'string' ? body.requested_by : 'historical-backfill-edge';

  const { data, error } = await supabase.rpc('run_equity_pipeline', {
    p_run_type: 'backfill',
    p_trigger_source: 'manual_api',
    p_requested_by: requestedBy,
    p_metadata: {
      source: 'supabase/functions/historical-backfill',
      mode: body.mode ?? 'orchestrated_backfill',
      lookback: body.lookback ?? 'max',
      requested_at: new Date().toISOString(),
    },
  });

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, result: data }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
