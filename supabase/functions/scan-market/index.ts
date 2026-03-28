import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${Deno.env.get('SYNC_SECRET_KEY')}`) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const asOfDate = typeof body.asOfDate === 'string' ? body.asOfDate : undefined;
  const runLabel = typeof body.runLabel === 'string' && body.runLabel.trim() ? body.runLabel.trim() : 'manual_admin';

  const { data: logRow, error: logInsertError } = await supabase
    .from('data_sync_log')
    .insert({
      sync_type: 'scan_market',
      status: 'running',
      data_source: 'rpc_run_broad_market_scan',
      metadata: {
        as_of_date: asOfDate ?? null,
        run_label: runLabel,
      },
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (logInsertError) {
    console.error('scan-market log insert failed:', logInsertError.message);
  }

  const { data: scanRunId, error } = await supabase.rpc('run_broad_market_scan', {
    p_as_of_date: asOfDate,
    p_run_label: runLabel,
  });

  if (error) {
    if (logRow?.id) {
      await supabase
        .from('data_sync_log')
        .update({
          status: 'error',
          completed_at: new Date().toISOString(),
          error_message: error.message,
          metadata: {
            as_of_date: asOfDate ?? null,
            run_label: runLabel,
            rpc_error: error.message,
          },
        })
        .eq('id', logRow.id);
    }

    return jsonResponse(500, {
      ok: false,
      error: error.message,
    });
  }

  const { data: operatorSnapshot } = await supabase.rpc('scanner_operator_snapshot');

  if (logRow?.id) {
    await supabase
      .from('data_sync_log')
      .update({
        status: 'success',
        symbols_processed: 1,
        completed_at: new Date().toISOString(),
        metadata: {
          as_of_date: asOfDate ?? null,
          run_label: runLabel,
          scan_run_id: scanRunId,
        },
      })
      .eq('id', logRow.id);
  }

  return jsonResponse(200, {
    ok: true,
    scanRunId,
    operatorSnapshot,
  });
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
