import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${Deno.env.get('SYNC_SECRET_KEY')}`) {
    return json(401, { ok: false, error: 'Unauthorized' })
  }

  const url = new URL(req.url)
  const path = url.pathname.split('/').filter(Boolean)
  const route = path[path.length - 1]
  const secondToLast = path[path.length - 2]

  // POST /backfill — trigger Yahoo historical backfill via the existing edge function pattern
  if (req.method === 'POST' && route === 'backfill') {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const limit = typeof body.limit === 'number' ? body.limit : 10
    const offset = typeof body.offset === 'number' ? body.offset : 0

    // Log the run
    await supabase.from('data_sync_log').insert({
      sync_type: 'backfill',
      status: 'running',
      data_source: 'yahoo',
      metadata: { source: 'admin-pipeline', limit, offset },
    })

    // Call the existing backfill RPC for each symbol
    const { data: symbols, error: fetchErr } = await supabase.rpc('get_symbols_needing_backfill', {
      p_limit: limit,
      p_offset: offset,
    })

    if (fetchErr) return json(500, { ok: false, error: fetchErr.message })

    return json(200, {
      ok: true,
      data: {
        symbols_queued: (symbols ?? []).length,
        message: 'Backfill pipeline started',
      },
    })
  }

  // POST /daily-sync — trigger daily price sync + indicator materialization
  if (req.method === 'POST' && route === 'daily-sync') {
    // Log the run
    const { data: logRow } = await supabase.from('data_sync_log').insert({
      sync_type: 'daily_sync',
      status: 'running',
      data_source: 'admin-pipeline',
      metadata: { source: 'admin-pipeline', endpoint: 'POST /admin/pipeline/daily-sync' },
    }).select('id').single()

    return json(200, {
      ok: true,
      data: {
        log_id: logRow?.id,
        message: 'Daily sync pipeline started. Use the daily-sync edge function for full execution.',
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
