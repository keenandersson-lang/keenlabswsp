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
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  // Create client with extended statement timeout for heavy RPC
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {
      db: {
        schema: 'public',
      },
      global: {
        headers: {
          // 120 second statement timeout
          'x-statement-timeout': '120000',
        },
      },
    }
  );

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);
  const asOfDate = typeof body.asOfDate === 'string' && body.asOfDate.trim() ? body.asOfDate.trim() : today;
  const runLabel = typeof body.runLabel === 'string' && body.runLabel.trim() ? body.runLabel.trim() : 'manual_admin';

  const { data: logRow, error: logInsertError } = await supabase
    .from('data_sync_log')
    .insert({
      sync_type: 'scan_market',
      status: 'running',
      data_source: 'rpc_run_broad_market_scan',
      metadata: {
        as_of_date: asOfDate,
        run_label: runLabel,
      },
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (logInsertError) {
    console.error('scan-market log insert failed:', logInsertError.message);
  }

  // Step 1: Refresh universe snapshot separately (can be slow)
  console.log('Step 1: Refreshing scanner universe snapshot...');
  const { data: universeRunId, error: universeErr } = await supabase.rpc('refresh_scanner_universe_snapshot', {
    p_as_of_date: asOfDate,
    p_run_label: `universe_${runLabel}`,
  });

  if (universeErr) {
    console.error('Universe snapshot failed:', universeErr.message);
    if (logRow?.id) {
      await supabase.from('data_sync_log').update({
        status: 'error',
        completed_at: new Date().toISOString(),
        error_message: `Universe snapshot failed: ${universeErr.message}`,
      }).eq('id', logRow.id);
    }
    return jsonResponse(500, {
      ok: false,
      step: 'universe_snapshot',
      error: universeErr.message,
    });
  }

  console.log(`Universe snapshot done, run_id=${universeRunId}`);

  // Step 2: Run the broad market scan (uses the universe snapshot)
  console.log('Step 2: Running broad market scan...');
  const { data: scanRunId, error: scanErr } = await supabase.rpc('run_broad_market_scan', {
    p_as_of_date: asOfDate,
    p_run_label: runLabel,
  });

  if (scanErr) {
    console.error('Broad market scan failed:', scanErr.message);
    if (logRow?.id) {
      await supabase.from('data_sync_log').update({
        status: 'error',
        completed_at: new Date().toISOString(),
        error_message: `Scan failed: ${scanErr.message}`,
        metadata: { as_of_date: asOfDate, run_label: runLabel, universe_run_id: universeRunId },
      }).eq('id', logRow.id);
    }
    return jsonResponse(500, {
      ok: false,
      step: 'broad_market_scan',
      universeRunId,
      error: scanErr.message,
    });
  }

  console.log(`Scan done, scan_run_id=${scanRunId}`);

  // Step 3: Get operator snapshot for response
  const { data: operatorSnapshot } = await supabase.rpc('scanner_operator_snapshot');

  if (logRow?.id) {
    await supabase.from('data_sync_log').update({
      status: 'success',
      symbols_processed: 1,
      completed_at: new Date().toISOString(),
      metadata: {
        as_of_date: asOfDate,
        run_label: runLabel,
        universe_run_id: universeRunId,
        scan_run_id: scanRunId,
      },
    }).eq('id', logRow.id);
  }

  return jsonResponse(200, {
    ok: true,
    scanRunId,
    universeRunId,
    operatorSnapshot,
  });
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
