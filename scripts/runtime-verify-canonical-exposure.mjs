#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(path.join(process.cwd(), '.env'));

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !anonKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (or VITE_ equivalents).');
  process.exit(1);
}

async function rpc(name, payload = {}) {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'count=exact',
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = bodyText;
  }

  if (!res.ok) {
    throw new Error(`${name} failed: HTTP ${res.status} ${res.statusText} :: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }

  return body;
}

function indexBySymbol(rows) {
  return new Map(rows.map((row) => [row.symbol, row]));
}

async function run() {
  const coverage = await rpc('get_equity_snapshot_coverage_report');
  const canonicalFunnel = await rpc('get_equity_canonical_funnel_counts');
  const screenerRows = await rpc('get_equity_screener_rows', { p_page: 0, p_page_size: 20000 });
  const dashboardRows = await rpc('get_equity_dashboard_rows');

  const scannedCount = screenerRows.length;
  const matchingAllFilter = screenerRows.length;
  const matchingImpossibleFilter = screenerRows.filter((row) => row.symbol === '__NO_MATCH__').length;

  const dashboardMap = indexBySymbol(dashboardRows);
  const screenerMap = indexBySymbol(screenerRows);

  const onlyInDashboard = [...dashboardMap.keys()].filter((symbol) => !screenerMap.has(symbol));
  const onlyInScreener = [...screenerMap.keys()].filter((symbol) => !dashboardMap.has(symbol));

  const output = {
    generatedAt: new Date().toISOString(),
    snapshotCoverageReport: coverage,
    canonicalFunnelCounts: canonicalFunnel,
    visibleScreenerParity: {
      scannedCount,
      matchingCountForNoFilter: matchingAllFilter,
      matchingCountForImpossibleFilter: matchingImpossibleFilter,
      emptyStateMessageExpected: `0 matching rows out of ${scannedCount} scanned rows.`,
      rowExposureCount: screenerRows.length,
    },
    dashboardVsScreenerExposure: {
      dashboardCount: dashboardRows.length,
      screenerCount: screenerRows.length,
      onlyInDashboardCount: onlyInDashboard.length,
      onlyInScreenerCount: onlyInScreener.length,
      onlyInDashboardSample: onlyInDashboard.slice(0, 25),
      onlyInScreenerSample: onlyInScreener.slice(0, 25),
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
