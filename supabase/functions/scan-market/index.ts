import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SCAN_STATEMENT_TIMEOUT_MS = '600000';

type EdgeRuntimeLike = {
  waitUntil?: (promise: Promise<unknown>) => void;
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
          'x-statement-timeout': SCAN_STATEMENT_TIMEOUT_MS,
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

  const backgroundScan = (async () => {
    console.log('Running broad market scan in background...');

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
          metadata: {
            as_of_date: asOfDate,
            run_label: runLabel,
            step: 'broad_market_scan',
          },
        }).eq('id', logRow.id);
      }
      return;
    }

    console.log(`Scan done, scan_run_id=${scanRunId}`);

    const { data: scanRunMeta } = await supabase
      .from('market_scan_runs')
      .select('universe_run_id')
      .eq('id', scanRunId)
      .maybeSingle();

    const universeRunId = scanRunMeta?.universe_run_id ?? null;
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
          operator_snapshot: operatorSnapshot ?? null,
        },
      }).eq('id', logRow.id);
    }
  })().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Unexpected scan-market failure:', message);

    if (logRow?.id) {
      await supabase.from('data_sync_log').update({
        status: 'error',
        completed_at: new Date().toISOString(),
        error_message: `Unexpected scan failure: ${message}`,
        metadata: {
          as_of_date: asOfDate,
          run_label: runLabel,
          step: 'background_dispatch',
        },
      }).eq('id', logRow.id);
    }
  });

  const edgeRuntime = (globalThis as typeof globalThis & { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  edgeRuntime?.waitUntil?.(backgroundScan);

  return jsonResponse(202, {
    ok: true,
    queued: true,
    status: 'running',
    logId: logRow?.id ?? null,
    asOfDate,
    runLabel,
  });
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
