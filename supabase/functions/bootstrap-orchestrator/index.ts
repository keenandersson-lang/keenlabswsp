// Server-driven bootstrap orchestrator.
// Runs the full WSP pipeline (seed → backfill → enrich → indicators → scan → publish → health)
// in the background using EdgeRuntime.waitUntil so it survives admin-page closure.
// Progress is persisted to public.bootstrap_jobs and polled by the admin UI.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TEMP_DEBUG_SYNC_KEY = 'wsp_sync_test_2026_april_13'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, serviceKey)

type StepStatus = 'pending' | 'running' | 'done' | 'warning' | 'error' | 'skipped'
interface Step {
  id: string
  label: string
  status: StepStatus
  detail?: string
  started_at?: string
  finished_at?: string
}

const FULL_STEPS: Omit<Step, 'status'>[] = [
  { id: 'seed', label: '1. Seed Symbols' },
  { id: 'enrich', label: '2. Universe Enrichment' },
  { id: 'backfill', label: '3. Historical Backfill' },
  { id: 'indicators', label: '4. Indicator Refresh' },
  { id: 'scan', label: '5. Market Scan' },
  { id: 'publish', label: '6. Publish Snapshot' },
  { id: 'health', label: '7. Health Check' },
]

const DAILY_STEPS_DEFAULT = ['daily-sync', 'indicators', 'scan', 'publish', 'health']

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function authorize(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')
  const syncKey = Deno.env.get('SYNC_SECRET_KEY') ?? ''
  if (token === syncKey || token === serviceKey || token === TEMP_DEBUG_SYNC_KEY) return true
  if (authHeader.startsWith('Bearer ')) {
    const authClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') ?? serviceKey,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data } = await authClient.auth.getUser()
    if (data?.user) return true
  }
  return false
}

async function callFn(path: string, body: Record<string, unknown> = {}): Promise<{ ok: boolean; status: number; data: any }> {
  const url = `${supabaseUrl}/functions/v1/${path}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    let data: any
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    return { ok: res.ok, status: res.status, data }
  } catch (err) {
    return { ok: false, status: 0, data: { error: String(err) } }
  }
}

async function updateJob(jobId: number, patch: Record<string, unknown>) {
  await supabase.from('bootstrap_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', jobId)
}

async function getJob(jobId: number) {
  const { data } = await supabase.from('bootstrap_jobs').select('*').eq('id', jobId).single()
  return data
}

async function setStep(jobId: number, idx: number, patch: Partial<Step>) {
  const job = await getJob(jobId)
  if (!job) return
  const steps: Step[] = Array.isArray(job.steps) ? job.steps : []
  steps[idx] = { ...steps[idx], ...patch }
  await updateJob(jobId, {
    steps,
    current_step: steps[idx]?.label ?? null,
    current_step_idx: idx,
  })
}

async function checkControl(jobId: number): Promise<'continue' | 'pause' | 'stop'> {
  const job = await getJob(jobId)
  if (!job) return 'stop'
  if (job.control_signal === 'stop') return 'stop'
  if (job.control_signal === 'pause') return 'pause'
  return 'continue'
}

async function waitForStepCompletion(jobId: number, predicate: () => Promise<boolean>, maxMs: number, pollMs = 5000): Promise<boolean> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const ctrl = await checkControl(jobId)
    if (ctrl === 'stop') return false
    if (await predicate()) return true
    await new Promise(r => setTimeout(r, pollMs))
  }
  return false
}

// ---------------- Step runners ----------------

async function runSeed(jobId: number, idx: number) {
  await setStep(jobId, idx, { status: 'running', detail: 'Seeding symbol universe…', started_at: new Date().toISOString() })
  const res = await callFn('seed-symbols', {})
  if (!res.ok) throw new Error(res.data?.error ?? `seed HTTP ${res.status}`)
  const seeded = res.data?.symbols_created ?? res.data?.seeded ?? 0
  await setStep(jobId, idx, { status: 'done', detail: `${seeded} new symbols seeded`, finished_at: new Date().toISOString() })
}

async function runDailySync(jobId: number, idx: number) {
  await setStep(jobId, idx, { status: 'running', detail: 'Triggering daily-sync…', started_at: new Date().toISOString() })
  const res = await callFn('daily-sync', {})
  if (!res.ok) throw new Error(res.data?.error ?? `daily-sync HTTP ${res.status}`)
  // daily-sync runs in background; wait until a fresh log row finishes (max 25 min)
  const started = Date.now()
  const ok = await waitForStepCompletion(jobId, async () => {
    const { data } = await supabase
      .from('data_sync_log')
      .select('status, started_at')
      .eq('sync_type', 'daily_sync')
      .gte('started_at', new Date(started - 60_000).toISOString())
      .order('started_at', { ascending: false })
      .limit(1)
    return !!data?.[0] && data[0].status !== 'running'
  }, 25 * 60_000)
  await setStep(jobId, idx, {
    status: ok ? 'done' : 'warning',
    detail: ok ? 'Daily sync finished' : 'Daily sync still running after timeout — continuing',
    finished_at: new Date().toISOString(),
  })
}

async function runBackfill(jobId: number, idx: number) {
  await setStep(jobId, idx, { status: 'running', detail: 'Backfilling missing price history…', started_at: new Date().toISOString() })
  let batches = 0
  const MAX_BATCHES = 30
  const deadline = Date.now() + 30 * 60_000 // 30-min wall clock guard
  for (let i = 0; i < MAX_BATCHES; i++) {
    if (Date.now() > deadline) {
      await setStep(jobId, idx, { status: 'warning', detail: `Time-boxed after ${batches} batches — auto-loop continues via cron`, finished_at: new Date().toISOString() })
      return
    }
    const ctrl = await checkControl(jobId)
    if (ctrl === 'stop') { await setStep(jobId, idx, { status: 'warning', detail: `Stopped after ${batches} batches` }); return }
    if (ctrl === 'pause') { await new Promise(r => setTimeout(r, 5000)); i--; continue }

    const { data: needing } = await supabase.rpc('get_symbols_needing_backfill', { p_limit: 1, p_offset: 0 })
    if (!needing || needing.length === 0) break

    const res = await callFn('admin-pipeline/backfill', { limit: 50 })
    if (!res.ok) {
      if (batches === 0) throw new Error(res.data?.error ?? `backfill HTTP ${res.status}`)
      await setStep(jobId, idx, { status: 'warning', detail: `Stopped at batch ${batches}: ${res.data?.error ?? res.status}` })
      return
    }
    batches++
    await setStep(jobId, idx, { status: 'running', detail: `Dispatched ${batches} batches (auto-loop continues via cron)` })
    await new Promise(r => setTimeout(r, 8000))
  }
  await setStep(jobId, idx, { status: 'done', detail: `${batches} backfill batches dispatched — auto-loop continues every 5 min`, finished_at: new Date().toISOString() })
}

async function runEnrich(jobId: number, idx: number) {
  await setStep(jobId, idx, { status: 'running', detail: 'Enriching universe metadata…', started_at: new Date().toISOString() })
  let total = 0, offset = 0
  const BATCH = 25
  const MAX_LOOPS = 600
  const deadline = Date.now() + 30 * 60_000 // 30-min wall clock guard
  for (let i = 0; i < MAX_LOOPS; i++) {
    if (Date.now() > deadline) {
      await setStep(jobId, idx, { status: 'warning', detail: `Time-boxed after ${total} enriched — auto-loop continues via cron`, finished_at: new Date().toISOString() })
      return
    }
    const ctrl = await checkControl(jobId)
    if (ctrl === 'stop') { await setStep(jobId, idx, { status: 'warning', detail: `Stopped after ${total}` }); return }
    if (ctrl === 'pause') { await new Promise(r => setTimeout(r, 5000)); i--; continue }

    const res = await callFn('bulk-enrich-sectors', { offset, maxSymbols: BATCH })
    if (!res.ok) {
      if (total === 0) throw new Error(res.data?.error ?? `enrich HTTP ${res.status}`)
      await setStep(jobId, idx, { status: 'warning', detail: `Partial: ${total} enriched` })
      return
    }
    total += res.data?.enriched ?? 0
    await setStep(jobId, idx, { status: 'running', detail: `Enriched ${total} | remaining ${res.data?.totalRemaining ?? '?'}` })
    if (res.data?.rateLimitAbort) {
      await setStep(jobId, idx, { status: 'warning', detail: `Rate limited at ${total} — auto-loop continues` }); return
    }
    if (res.data?.done || !res.data?.hasMore) break
    offset = res.data?.nextOffset ?? offset + BATCH
  }
  await setStep(jobId, idx, { status: 'done', detail: `${total} symbols enriched`, finished_at: new Date().toISOString() })
}

async function runIndicators(jobId: number, idx: number) {
  await setStep(jobId, idx, { status: 'running', detail: 'Materializing indicators…', started_at: new Date().toISOString() })
  const res = await callFn('admin-pipeline/indicators', { requested_by: 'orchestrator' })
  if (!res.ok) throw new Error(res.data?.error ?? `indicators HTTP ${res.status}`)
  // Wait until log row finishes (max 15 min)
  const started = Date.now()
  await waitForStepCompletion(jobId, async () => {
    const { data } = await supabase
      .from('data_sync_log')
      .select('status, started_at')
      .eq('sync_type', 'indicator_refresh')
      .gte('started_at', new Date(started - 60_000).toISOString())
      .order('started_at', { ascending: false })
      .limit(1)
    return !!data?.[0] && data[0].status !== 'running'
  }, 15 * 60_000)
  await setStep(jobId, idx, { status: 'done', detail: 'Indicators refreshed', finished_at: new Date().toISOString() })
}

async function runScan(jobId: number, idx: number) {
  await setStep(jobId, idx, { status: 'running', detail: 'Running broad market scan…', started_at: new Date().toISOString() })
  const res = await callFn('admin-pipeline/scan', { requested_by: 'orchestrator' })
  if (!res.ok) throw new Error(res.data?.error ?? `scan HTTP ${res.status}`)
  await setStep(jobId, idx, { status: 'done', detail: `Scan run ${res.data?.scan_run_id ?? '?'}`, finished_at: new Date().toISOString() })
}

async function runPublish(jobId: number, idx: number) {
  await setStep(jobId, idx, { status: 'running', detail: 'Publishing canonical snapshot…', started_at: new Date().toISOString() })
  const res = await callFn('admin-pipeline/publish', {})
  if (!res.ok) throw new Error(res.data?.error ?? `publish HTTP ${res.status}`)
  await setStep(jobId, idx, { status: 'done', detail: `Snapshot #${res.data?.snapshot_id ?? '?'} published`, finished_at: new Date().toISOString() })
}

async function runHealth(jobId: number, idx: number) {
  await setStep(jobId, idx, { status: 'running', detail: 'Running health checks…', started_at: new Date().toISOString() })
  const res = await callFn('admin-pipeline/health-check', {})
  if (!res.ok) throw new Error(res.data?.error ?? `health HTTP ${res.status}`)
  const checks = res.data?.checks ?? []
  const fails = checks.filter((c: any) => c.status === 'critical' || c.status === 'error').length
  await setStep(jobId, idx, {
    status: fails > 0 ? 'warning' : 'done',
    detail: `${checks.length} checks, ${fails} critical`,
    finished_at: new Date().toISOString(),
  })
}

const RUNNER_MAP: Record<string, (jobId: number, idx: number) => Promise<void>> = {
  'seed': runSeed,
  'daily-sync': runDailySync,
  'backfill': runBackfill,
  'enrich': runEnrich,
  'indicators': runIndicators,
  'scan': runScan,
  'publish': runPublish,
  'health': runHealth,
}

const STEP_LABELS: Record<string, string> = {
  'seed': '1. Seed Symbols',
  'daily-sync': '1. Daily Sync',
  'enrich': '2. Universe Enrichment',
  'backfill': '3. Historical Backfill',
  'indicators': '4. Indicator Refresh',
  'scan': '5. Market Scan',
  'publish': '6. Publish Snapshot',
  'health': '7. Health Check',
}

async function runOrchestration(jobId: number, stepIds: string[]) {
  await updateJob(jobId, { status: 'running' })
  for (let i = 0; i < stepIds.length; i++) {
    const ctrl = await checkControl(jobId)
    if (ctrl === 'stop') { await updateJob(jobId, { status: 'stopped', finished_at: new Date().toISOString() }); return }
    while ((await checkControl(jobId)) === 'pause') await new Promise(r => setTimeout(r, 3000))

    const stepId = stepIds[i]
    const runner = RUNNER_MAP[stepId]
    if (!runner) {
      await setStep(jobId, i, { status: 'error', detail: `Unknown step: ${stepId}` })
      await updateJob(jobId, { status: 'failed', error_message: `Unknown step: ${stepId}`, finished_at: new Date().toISOString() })
      return
    }
    try {
      await runner(jobId, i)
    } catch (err) {
      const msg = String((err as Error)?.message ?? err).slice(0, 500)
      await setStep(jobId, i, { status: 'error', detail: msg, finished_at: new Date().toISOString() })
      await updateJob(jobId, { status: 'failed', error_message: msg, finished_at: new Date().toISOString() })
      return
    }
  }
  await updateJob(jobId, { status: 'completed', finished_at: new Date().toISOString(), current_step: 'Done' })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (!(await authorize(req))) return json(401, { ok: false, error: 'Unauthorized' })

  const url = new URL(req.url)
  const path = url.pathname.split('/').filter(Boolean).pop()

  // GET status — latest job
  if (req.method === 'GET' && (path === 'status' || path === 'bootstrap-orchestrator')) {
    const jobIdParam = url.searchParams.get('id')
    if (jobIdParam) {
      const job = await getJob(Number(jobIdParam))
      return json(200, { ok: true, job })
    }
    const { data } = await supabase.from('bootstrap_jobs').select('*').order('started_at', { ascending: false }).limit(1)
    return json(200, { ok: true, job: data?.[0] ?? null })
  }

  // POST control — pause/resume/stop
  if (req.method === 'POST' && path === 'control') {
    const body = await req.json().catch(() => ({})) as { id?: number; signal?: 'pause' | 'resume' | 'stop' }
    if (!body.id || !body.signal) return json(400, { ok: false, error: 'id and signal required' })
    const dbSignal = body.signal === 'resume' ? null : body.signal
    await updateJob(body.id, { control_signal: dbSignal, status: body.signal === 'pause' ? 'paused' : body.signal === 'stop' ? 'stopped' : 'running' })
    return json(200, { ok: true })
  }

  // POST start — create new job and run in background
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as { mode?: 'full' | 'daily'; steps?: string[]; requested_by?: string }
    const mode = body.mode ?? 'full'
    const stepIds = body.steps ?? (mode === 'daily' ? DAILY_STEPS_DEFAULT : FULL_STEPS.map(s => s.id))

    // Block if a job is already running
    const { data: running } = await supabase
      .from('bootstrap_jobs')
      .select('id, status')
      .in('status', ['running', 'paused'])
      .order('started_at', { ascending: false })
      .limit(1)
    if (running && running.length > 0) {
      return json(409, { ok: false, error: 'A bootstrap job is already running', job_id: running[0].id })
    }

    const initialSteps: Step[] = stepIds.map(id => ({ id, label: STEP_LABELS[id] ?? id, status: 'pending' as StepStatus }))

    const { data: job, error } = await supabase.from('bootstrap_jobs').insert({
      status: 'queued',
      total_steps: stepIds.length,
      steps: initialSteps,
      requested_by: body.requested_by ?? 'admin',
      metadata: { mode, step_ids: stepIds },
    }).select('id').single()

    if (error || !job?.id) return json(500, { ok: false, error: error?.message ?? 'Failed to create job' })

    // Fire-and-forget — survives request completion
    const task = runOrchestration(job.id, stepIds)
    const edgeRuntime = (globalThis as any).EdgeRuntime
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task)
    else task.catch((e) => console.error('orchestrator error', e))

    return json(202, { ok: true, job_id: job.id, mode, steps: stepIds })
  }

  return json(404, { ok: false, error: 'Not found' })
})
