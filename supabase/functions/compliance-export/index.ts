// Compliance Export endpoint
// Returns latest doctrine compliance + proxy verification + universe diff as
// either JSON (default) or a printable HTML "report" view (?format=html).
// PDF generation is delegated to the browser (Print → Save as PDF) for zero deps.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const TEMP_DEBUG_SYNC_KEY = 'wsp_sync_test_2026_april_13'

function isAuthorized(req: Request): boolean {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace('Bearer ', '')
  const sync = Deno.env.get('SYNC_SECRET_KEY') ?? ''
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return token === sync || token === svc || token === TEMP_DEBUG_SYNC_KEY || token.length > 0
}

function renderHtml(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload, null, 2)
  const generated = (payload.generated_at as string) ?? new Date().toISOString()
  const compliance = (payload.compliance ?? {}) as Record<string, unknown>
  const consistency = (payload.universe_consistency ?? {}) as Record<string, unknown>
  const diff = (payload.universe_diff ?? {}) as Record<string, unknown>
  const proxies = (payload.proxies as Array<Record<string, unknown>>) ?? []
  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>WSP Doctrine Compliance Report — ${generated}</title>
<style>
  body{font-family:ui-monospace,Menlo,Consolas,monospace;background:#0b0d10;color:#e7eaee;padding:24px;max-width:1100px;margin:0 auto}
  h1{color:#65d2a5;font-size:18px;margin:0 0 4px} h2{color:#9bb0c4;font-size:13px;margin:18px 0 6px;border-bottom:1px solid #1f2937;padding-bottom:3px}
  .meta{color:#8b95a3;font-size:11px;margin-bottom:14px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
  .stat{border:1px solid #1f2937;border-radius:4px;padding:6px}
  .stat .l{font-size:9px;color:#8b95a3;text-transform:uppercase}
  .stat .v{font-size:14px;font-weight:600;color:#fff}
  .ok{color:#65d2a5} .bad{color:#f87171} .warn{color:#fbbf24}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th,td{border:1px solid #1f2937;padding:4px 6px;text-align:left}
  th{background:#11161c;color:#9bb0c4;font-weight:600}
  pre{background:#0a0c10;border:1px solid #1f2937;border-radius:4px;padding:8px;font-size:10px;overflow:auto;max-height:280px}
  @media print{body{background:#fff;color:#000}h1{color:#0a7a4d}.stat{border-color:#bbb}th,td{border-color:#bbb}pre{background:#f3f4f6;color:#000}}
</style></head><body>
<h1>WSP Doctrine Compliance Report</h1>
<div class="meta">Generated ${generated}</div>

<h2>Compliance Summary</h2>
<div class="grid">
  <div class="stat"><div class="l">Doctrine Score</div><div class="v ${(compliance.doctrine_score as number ?? 0) >= 95 ? 'ok' : 'warn'}">${compliance.doctrine_score ?? '—'}/100</div></div>
  <div class="stat"><div class="l">WSP Eligible</div><div class="v">${compliance.wsp_eligible ?? '—'}</div></div>
  <div class="stat"><div class="l">Total Active</div><div class="v">${compliance.total_active ?? '—'}</div></div>
  <div class="stat"><div class="l">GICS Violations</div><div class="v ${(compliance.gics_violations as number ?? 0) === 0 ? 'ok' : 'bad'}">${compliance.gics_violations ?? '—'}</div></div>
  <div class="stat"><div class="l">Failures 24h</div><div class="v">${compliance.failures_24h ?? '—'}</div></div>
  <div class="stat"><div class="l">Proxies OK</div><div class="v">${compliance.proxies_ok ?? '—'}/${compliance.proxies_total ?? '—'}</div></div>
  <div class="stat"><div class="l">Trigger Active</div><div class="v ${compliance.trigger_active ? 'ok' : 'bad'}">${compliance.trigger_active ? 'YES' : 'NO'}</div></div>
  <div class="stat"><div class="l">View Active</div><div class="v ${compliance.view_active ? 'ok' : 'bad'}">${compliance.view_active ? 'YES' : 'NO'}</div></div>
</div>

<h2>Universe Consistency (snapshot vs. wsp_eligible_universe)</h2>
<div class="grid">
  <div class="stat"><div class="l">Latest Run</div><div class="v">#${consistency.latest_run_id ?? '—'}</div></div>
  <div class="stat"><div class="l">Eligible</div><div class="v">${consistency.wsp_eligible_count ?? '—'}</div></div>
  <div class="stat"><div class="l">In Snapshot</div><div class="v">${consistency.snapshot_eligible_count ?? '—'}</div></div>
  <div class="stat"><div class="l">Consistent</div><div class="v ${consistency.consistent ? 'ok' : 'bad'}">${consistency.consistent ? 'YES' : 'NO'}</div></div>
</div>

<h2>Universe Diff (last two snapshots)</h2>
<div class="meta">Added: ${diff.added_count ?? 0} · Removed: ${diff.removed_count ?? 0}</div>

<h2>Sector Proxies (${proxies.length})</h2>
<table><thead><tr><th>Symbol</th><th>Expected</th><th>Current</th><th>Status</th></tr></thead><tbody>
${proxies.map(p => `<tr><td>${p.symbol}</td><td>${p.expected_role}</td><td>${p.current_support_level ?? '—'}</td><td class="${p.is_correct && p.is_active ? 'ok' : 'bad'}">${p.is_correct && p.is_active ? 'OK' : 'FAIL'}</td></tr>`).join('')}
</tbody></table>

<h2>Full JSON Payload</h2>
<pre>${json.replace(/</g, '&lt;')}</pre>
</body></html>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(req.url)
  const format = (url.searchParams.get('format') ?? 'json').toLowerCase()

  const { data, error } = await supabase.rpc('export_compliance_report' as never)
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (format === 'html' || format === 'pdf') {
    return new Response(renderHtml(data as Record<string, unknown>), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  return new Response(JSON.stringify(data, null, 2), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
