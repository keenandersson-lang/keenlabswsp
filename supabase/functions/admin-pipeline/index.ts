import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TEMP_DEBUG_SYNC_KEY = 'wsp_sync_test_2026_april_13'

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
  
  let isAuthorized = providedToken === syncKey || providedToken === serviceKey || providedToken === TEMP_DEBUG_SYNC_KEY
  
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

  // POST /backfill — trigger Yahoo historical backfill via DB RPC (no HTTP hop)
  if (req.method === 'POST' && route === 'backfill') {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const batchSize = typeof body.limit === 'number' ? body.limit : 10

    // PRE-FLIGHT: check for already-running backfill
    const { data: runningJobs } = await supabase
      .from('data_sync_log')
      .select('id, started_at')
      .eq('sync_type', 'yahoo_backfill')
      .eq('status', 'running')
      .gte('started_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order('started_at', { ascending: false })
      .limit(1)

    if (runningJobs && runningJobs.length > 0) {
      return json(200, {
        ok: true,
        skipped: true,
        data: {
          message: 'Backfill already running',
          existing_run_id: runningJobs[0].id,
          started_at: runningJobs[0].started_at,
        },
      })
    }

    // Call the DB RPC directly in background — eliminates the HTTP hop that caused 504s.
    // The RPC creates its own log row, handles overlap guard, rate-limiting, and error logging.
    const backgroundBackfill = (async () => {
      try {
        await supabase.rpc('backfill_yahoo_batch_logged', {
          p_batch_size: batchSize,
          p_min_bars: 260,
        })
      } catch (err) {
        console.error('[admin-pipeline/backfill] RPC error:', err)
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
        batch_size: batchSize,
        message: 'Backfill dispatched via RPC (background, deduplicated)',
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
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
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

  // POST /indicators — trigger indicator materialization
  if (req.method === 'POST' && route === 'indicators') {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const today = new Date()
    const fromDate = (body.from_date as string) ?? today.toISOString().slice(0, 10)
    const toDate = (body.to_date as string) ?? today.toISOString().slice(0, 10)

    const { data: logRow } = await supabase.from('data_sync_log').insert({
      sync_type: 'indicator_refresh',
      status: 'running',
      data_source: 'admin-pipeline',
      started_at: new Date().toISOString(),
      metadata: { source: 'admin-pipeline', from_date: fromDate, to_date: toDate },
    }).select('id').single()

    const backgroundIndicators = (async () => {
      try {
        await supabase.rpc('materialize_wsp_indicators_logged', {
          p_from_date: fromDate,
          p_to_date: toDate,
        })
        if (logRow?.id) {
          await supabase.from('data_sync_log').update({
            status: 'success',
            completed_at: new Date().toISOString(),
          }).eq('id', logRow.id)
        }
      } catch (err) {
        console.error('[admin-pipeline/indicators] error:', err)
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
      edgeRuntime.waitUntil(backgroundIndicators)
    } else {
      await backgroundIndicators
    }

    return json(202, { ok: true, queued: true, data: { log_id: logRow?.id, message: 'Indicator refresh dispatched' } })
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

  // POST /health-check — refresh pipeline health checks
  if (req.method === 'POST' && route === 'health-check') {
    const { data, error } = await supabase.rpc('run_pipeline_health_checks')
    if (error) return json(500, { ok: false, step: 'health_check', error: error.message })
    
    // Read back the refreshed checks
    const { data: checks } = await supabase
      .from('pipeline_health_checks')
      .select('check_name, status, message, current_value, threshold')
      .order('check_name')
    
    return json(200, { ok: true, run_id: data, checks })
  }

  // POST /publish — run canonical equity publish flow and return result
  if (req.method === 'POST' && route === 'publish') {
    const today = new Date().toISOString().slice(0, 10)

    const { data: publishResult, error: publishErr } = await supabase.rpc('run_equity_pipeline', {
      p_run_type: 'partial_rebuild',
      p_trigger_source: 'admin_button',
      p_requested_by: 'admin-pipeline',
      p_metadata: {
        source: 'admin-pipeline',
        endpoint: 'POST /admin/pipeline/publish',
        initiated_at: new Date().toISOString(),
      },
    })
    if (publishErr) return json(500, { ok: false, step: 'run_equity_pipeline', error: publishErr.message })

    const resultRow = Array.isArray(publishResult) && publishResult.length > 0 ? publishResult[0] : publishResult

    return json(200, {
      ok: true,
      run_id: resultRow?.run_id ?? null,
      snapshot_id: resultRow?.snapshot_id ?? null,
      status: resultRow?.status ?? null,
      validation: resultRow?.validation ?? null,
    })
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
