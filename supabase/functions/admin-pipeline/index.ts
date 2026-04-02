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
    return json(401, { error: 'Unauthorized' })
  }

  const url = new URL(req.url)
  const path = url.pathname.split('/').filter(Boolean)
  const route = path[path.length - 1]
  const secondToLast = path[path.length - 2]

  if (req.method === 'POST' && route === 'backfill') {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const { data, error } = await supabase.rpc('run_equity_pipeline', {
      p_run_type: 'backfill',
      p_trigger_source: 'admin_button',
      p_requested_by: (body.requested_by as string | undefined) ?? 'admin',
      p_metadata: {
        source: 'admin-pipeline',
        endpoint: 'POST /admin/pipeline/backfill',
        lookback: body.lookback ?? 'max',
      },
    })
    if (error) return json(409, { ok: false, error: error.message })
    return json(200, { ok: true, data })
  }

  if (req.method === 'POST' && route === 'daily-sync') {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const { data, error } = await supabase.rpc('run_equity_pipeline', {
      p_run_type: 'daily_sync',
      p_trigger_source: 'admin_button',
      p_requested_by: (body.requested_by as string | undefined) ?? 'admin',
      p_metadata: {
        source: 'admin-pipeline',
        endpoint: 'POST /admin/pipeline/daily-sync',
      },
    })
    if (error) return json(409, { ok: false, error: error.message })
    return json(200, { ok: true, data })
  }

  if (req.method === 'GET' && route === 'runs') {
    const { data, error } = await supabase.rpc('get_equity_pipeline_runs', { p_limit: 50 })
    if (error) return json(500, { ok: false, error: error.message })
    return json(200, { ok: true, data })
  }

  if (req.method === 'GET' && secondToLast === 'runs') {
    const runId = Number(route)
    if (!Number.isFinite(runId)) return json(400, { ok: false, error: 'Invalid run id' })

    const [{ data: run, error: runError }, { data: steps, error: stepsError }] = await Promise.all([
      supabase.from('pipeline_runs').select('*').eq('id', runId).maybeSingle(),
      supabase.rpc('get_equity_pipeline_run_steps', { p_run_id: runId }),
    ])

    if (runError || stepsError) return json(500, { ok: false, error: runError?.message ?? stepsError?.message })
    return json(200, { ok: true, data: { run, steps } })
  }

  if (req.method === 'GET' && route === 'snapshots') {
    const { data, error } = await supabase.rpc('get_equity_snapshots', { p_limit: 50 })
    if (error) return json(500, { ok: false, error: error.message })
    return json(200, { ok: true, data })
  }

  if (req.method === 'GET' && secondToLast === 'validate') {
    const snapshotId = Number(route)
    if (!Number.isFinite(snapshotId)) return json(400, { ok: false, error: 'Invalid snapshot id' })
    const { data, error } = await supabase.rpc('validate_equity_snapshot', { p_snapshot_id: snapshotId })
    if (error) return json(500, { ok: false, error: error.message })
    return json(200, { ok: true, data })
  }

  return json(404, { ok: false, error: 'Not found' })
})
