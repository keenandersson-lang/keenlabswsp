# Live runtime triage attempt — 2026-04-02

## Scope requested
The request required direct live checks against staging/prod for:

1. Canonical snapshot existence in `data_snapshots`.
2. Latest pipeline failure step in `pipeline_runs` / `pipeline_run_steps`.
3. Canonical coverage counts from `get_equity_snapshot_coverage_report`.
4. Public-read RPC outputs for dashboard, screener, and `NVDA` detail.

## Commands executed

```bash
node - <<'NODE'
// loads .env and queries Supabase REST + RPC endpoints
// /rest/v1/data_snapshots
// /rest/v1/pipeline_runs
// /rest/v1/pipeline_run_steps
// /rest/v1/rpc/get_equity_snapshot_coverage_report
// /rest/v1/rpc/get_equity_dashboard_rows
// /rest/v1/rpc/get_equity_screener_rows
// /rest/v1/rpc/get_equity_stock_detail (p_symbol='NVDA')
NODE
```

Result:

- `TypeError: fetch failed`
- Cause: `ENETUNREACH` when connecting to `xvdhpztohozxdsxcsidf.supabase.co:443`.

```bash
curl -I --max-time 15 https://xvdhpztohozxdsxcsidf.supabase.co/rest/v1/
```

Result:

- `curl: (56) CONNECT tunnel failed, response 403`
- Proxy response: `HTTP/1.1 403 Forbidden`

## Diagnosis from this execution environment

The runtime checks could not reach Supabase at all due to network egress/proxy denial from this container, so no live table rows or RPC payloads could be fetched.

This means the following requested live facts are **not retrievable from this environment right now**:

- Whether a canonical snapshot currently exists/published.
- Which latest pipeline step failed.
- Current canonical coverage counts.
- Current dashboard/screener/NVDA RPC output payloads.

## What is needed to complete exact live diagnosis

Any one of:

- Run the same queries from an environment with outbound access to `*.supabase.co`.
- Provide a bastion/VPN-enabled runner.
- Provide a dumped JSON output from those endpoints to analyze.
