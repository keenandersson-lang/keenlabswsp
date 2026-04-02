export interface EquityParityRow {
  symbol: string;
  snapshot_id: number;
  close: number;
  sector: string;
  industry: string;
  wsp_score: number;
  validity: boolean;
  breakout_freshness: string;
  blockers: string[];
  warnings: string[];
}

export interface EquityParityValidationResult {
  passed: boolean;
  drift: string[];
}

function normalizeList(input: string[]): string[] {
  return [...input].sort((a, b) => a.localeCompare(b));
}

export function validateCrossViewParity(
  dashboardRows: EquityParityRow[],
  screenerRows: EquityParityRow[],
  detailRows: EquityParityRow[],
  symbols: string[],
): EquityParityValidationResult {
  const drift: string[] = [];
  const dashMap = new Map(dashboardRows.map((row) => [row.symbol, row]));
  const screenMap = new Map(screenerRows.map((row) => [row.symbol, row]));
  const detailMap = new Map(detailRows.map((row) => [row.symbol, row]));

  for (const symbol of symbols) {
    const d = dashMap.get(symbol);
    const s = screenMap.get(symbol);
    const dt = detailMap.get(symbol);
    if (!d || !s || !dt) {
      drift.push(`${symbol}: missing row in one or more views`);
      continue;
    }

    const fields: Array<keyof EquityParityRow> = [
      'snapshot_id',
      'close',
      'sector',
      'industry',
      'wsp_score',
      'validity',
      'breakout_freshness',
    ];

    for (const field of fields) {
      if (d[field] !== s[field] || d[field] !== dt[field]) {
        drift.push(`${symbol}: mismatch on ${field}`);
      }
    }

    if (JSON.stringify(normalizeList(d.blockers)) !== JSON.stringify(normalizeList(s.blockers))
      || JSON.stringify(normalizeList(d.blockers)) !== JSON.stringify(normalizeList(dt.blockers))) {
      drift.push(`${symbol}: mismatch on blockers`);
    }

    if (JSON.stringify(normalizeList(d.warnings)) !== JSON.stringify(normalizeList(s.warnings))
      || JSON.stringify(normalizeList(d.warnings)) !== JSON.stringify(normalizeList(dt.warnings))) {
      drift.push(`${symbol}: mismatch on warnings`);
    }
  }

  return {
    passed: drift.length === 0,
    drift,
  };
}
