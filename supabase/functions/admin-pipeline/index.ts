import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

type EdgeRuntimeLike = {
  waitUntil?: (promise: Promise<unknown>) => void
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  // Auth: accept SYNC_SECRET_KEY or service_role key
  const authHeader = req.headers.get('Authorization') ?? ''
  const providedToken = authHeader.replace('Bearer ', '')
  const syncKey = Deno.env.get('SYNC_SECRET_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  
  let isAuthorized = providedToken === syncKey || providedToken === serviceKey
  
  // Also accept authenticated admin users (for Lovable tooling)
  if (!isAuthorized && authHeader.startsWith('Bearer ')) {
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data } = await authClient.auth.getUser()
    if (data?.user) isAuthorized = true
  }
  
  if (!isAuthorized) {
    return json(401, { ok: false, error: 'Unauthorized' })
  }

  const url = new URL(req.url)
  const path = url.pathname.split('/').filter(Boolean)
  const route = path[path.length - 1]
  const secondToLast = path[path.length - 2]

  // POST /backfill — trigger Yahoo historical backfill
  if (req.method === 'POST' && route === 'backfill') {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const limit = typeof body.limit === 'number' ? body.limit : 10
    const offset = typeof body.offset === 'number' ? body.offset : 0

    // Log the run
    const { data: logRow } = await supabase.from('data_sync_log').insert({
      sync_type: 'backfill',
      status: 'running',
      data_source: 'yahoo',
      started_at: new Date().toISOString(),
      metadata: { source: 'admin-pipeline', limit, offset },
    }).select('id').single()

    // Call the existing backfill RPC for each symbol
    const { data: symbols, error: fetchErr } = await supabase.rpc('get_symbols_needing_backfill', {
      p_limit: limit,
      p_offset: offset,
    })

    if (fetchErr) {
      if (logRow?.id) {
        await supabase.from('data_sync_log').update({
          status: 'error',
          completed_at: new Date().toISOString(),
          error_message: fetchErr.message,
        }).eq('id', logRow.id)
      }
      return json(500, { ok: false, error: fetchErr.message })
    }

    const symbolList = symbols ?? []

    if (symbolList.length === 0) {
      if (logRow?.id) {
        await supabase.from('data_sync_log').update({
          status: 'success',
          completed_at: new Date().toISOString(),
          symbols_processed: 0,
          metadata: { source: 'admin-pipeline', limit, offset, message: 'no_symbols_needing_backfill' },
        }).eq('id', logRow.id)
      }
      return json(200, { ok: true, data: { symbols_queued: 0, message: 'No symbols need backfill' } })
    }

    // Fire-and-forget: call historical-backfill edge function
    const functionsBaseUrl = `${Deno.env.get('SUPABASE_URL')!}/functions/v1`

    const backgroundBackfill = (async () => {
      try {
        const bfRes = await fetch(`${functionsBaseUrl}/historical-backfill`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${syncKey}`,
          },
          body: JSON.stringify({ limit, offset }),
        })

        const bfPayload = await bfRes.json().catch(() => null)
        const succeeded = bfPayload?.enriched ?? bfPayload?.processed ?? symbolList.length
        const failed = bfPayload?.failed ?? 0

        if (logRow?.id) {
          await supabase.from('data_sync_log').update({
            status: bfRes.ok && failed === 0 ? 'success' : bfRes.ok ? 'partial' : 'error',
            completed_at: new Date().toISOString(),
            symbols_processed: succeeded,
            symbols_failed: failed,
            error_message: !bfRes.ok ? `HTTP ${bfRes.status}` : null,
            metadata: {
              source: 'admin-pipeline',
              limit,
              offset,
              backfill_response: bfPayload,
            },
          }).eq('id', logRow.id)
        }
      } catch (err) {
        if (logRow?.id) {
          await supabase.from('data_sync_log').update({
            status: 'error',
            completed_at: new Date().toISOString(),
            error_message: String(err).slice(0, 500),
          }).eq('id', logRow.id)
        }
      }
    })()

    const edgeRuntime = (globalThis as typeof globalThis & { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(backgroundBackfill)
    } else {
      await backgroundBackfill
    }

    return json(202, {
      ok: true,
      queued: true,
      data: {
        log_id: logRow?.id ?? null,
        symbols_queued: symbolList.length,
        message: 'Backfill pipeline started',
      },
    })
  }

  // POST /daily-sync — trigger daily price sync + indicator materialization
  if (req.method === 'POST' && route === 'daily-sync') {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    // This is just a dispatch proxy — daily-sync creates its own log row.
    // We create a thin "dispatch" log that we finalize immediately.
    const { data: logRow, error: logInsertError } = await supabase.from('data_sync_log').insert({
      sync_type: 'daily_sync_dispatch',
      status: 'running',
      data_source: 'admin-pipeline',
      started_at: new Date().toISOString(),
      metadata: {
        source: 'admin-pipeline',
        endpoint: 'POST /admin/pipeline/daily-sync',
        forwarded_to: 'daily-sync',
        request_payload: body,
      },
    }).select('id').single()

    if (logInsertError || !logRow?.id) {
      return json(500, {
        ok: false,
        error: logInsertError?.message ?? 'Failed to create daily sync log row',
      })
    }

    const functionsBaseUrl = `${Deno.env.get('SUPABASE_URL')!}/functions/v1`

    const dispatchDailySync = (async () => {
      try {
        const syncResponse = await fetch(`${functionsBaseUrl}/daily-sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SYNC_SECRET_KEY')}`,
          },
          body: JSON.stringify({ ...body }),
        })

        const syncPayload = await syncResponse.json().catch(() => null)

        // Finalize the dispatch log — daily-sync manages its own detailed log
        await supabase.from('data_sync_log').update({
          status: syncResponse.ok ? 'success' : 'error',
          completed_at: new Date().toISOString(),
          error_message: syncResponse.ok ? null : (syncPayload?.error ?? `HTTP ${syncResponse.status}`),
          metadata: {
            source: 'admin-pipeline',
            endpoint: 'POST /admin/pipeline/daily-sync',
            forwarded_to: 'daily-sync',
            dispatch_status: syncResponse.ok ? 'dispatched' : 'failed',
            downstream_log_id: syncPayload?.logId ?? null,
            request_payload: body,
          },
        }).eq('id', logRow.id)
      } catch (error) {
        await supabase.from('data_sync_log').update({
          status: 'error',
          completed_at: new Date().toISOString(),
          error_message: String(error).slice(0, 500),
          metadata: {
            source: 'admin-pipeline',
            endpoint: 'POST /admin/pipeline/daily-sync',
            forwarded_to: 'daily-sync',
            dispatch_status: 'failed',
            request_payload: body,
          },
        }).eq('id', logRow.id)
      }
    })()

    const edgeRuntime = (globalThis as typeof globalThis & { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(dispatchDailySync)
    } else {
      await dispatchDailySync
    }

    return json(202, {
      ok: true,
      queued: true,
      data: {
        log_id: logRow.id,
        message: 'Daily sync queued and dispatching in background.',
        dispatch_status: 'queued',
      },
    })
  }

  // POST /scan — trigger broad market scan
  if (req.method === 'POST' && route === 'scan') {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const today = new Date()
    const dateStr = (body.as_of_date as string) ?? today.toISOString().slice(0, 10)
    const label = (body.run_label as string) ?? `admin_scan_${dateStr}`

    const { data, error } = await supabase.rpc('run_broad_market_scan', {
      p_as_of_date: dateStr,
      p_run_label: label,
    })

    if (error) return json(500, { ok: false, step: 'broad_market_scan', error: error.message })
    return json(200, { ok: true, scan_run_id: data })
  }

  // GET /runs — list recent pipeline runs from data_sync_log
  if (req.method === 'GET' && route === 'runs') {
    const { data, error } = await supabase.rpc('get_equity_pipeline_console_runs', { p_limit: 50 })
    if (error) return json(500, { ok: false, error: error.message })
    return json(200, { ok: true, data })
  }

  // GET /snapshots — list recent scan snapshots
  if (req.method === 'GET' && route === 'snapshots') {
    const { data, error } = await supabase.rpc('get_equity_snapshots', { p_limit: 50 })
    if (error) return json(500, { ok: false, error: error.message })
    return json(200, { ok: true, data })
  }

  // GET /validate/<id> — validate a snapshot
  if (req.method === 'GET' && secondToLast === 'validate') {
    const snapshotId = Number(route)
    if (!Number.isFinite(snapshotId)) return json(400, { ok: false, error: 'Invalid snapshot id' })
    const { data, error } = await supabase.rpc('validate_equity_snapshot', { p_snapshot_id: snapshotId })
    if (error) return json(500, { ok: false, error: error.message })
    return json(200, { ok: true, data })
  }

  return json(404, { ok: false, error: 'Not found' })
})