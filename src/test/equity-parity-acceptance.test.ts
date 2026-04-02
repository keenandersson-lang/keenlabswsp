import { describe, it, expect } from 'vitest';
import { validateCrossViewParity, type EquityParityRow } from '@/lib/equity-parity';

const ACCEPTANCE_SYMBOLS = ['NVDA', 'MSFT', 'AAPL', 'XLE', 'XLK', 'WEAKX', 'STALEB'];

const baseRows: EquityParityRow[] = [
  { symbol: 'NVDA', snapshot_id: 101, close: 1012.4, sector: 'Technology', industry: 'Semiconductors', wsp_score: 3.8, validity: true, breakout_freshness: 'fresh', blockers: [], warnings: ['extended'] },
  { symbol: 'MSFT', snapshot_id: 101, close: 512.2, sector: 'Technology', industry: 'Software', wsp_score: 3.2, validity: true, breakout_freshness: 'fresh', blockers: [], warnings: [] },
  { symbol: 'AAPL', snapshot_id: 101, close: 237.9, sector: 'Technology', industry: 'Consumer Electronics', wsp_score: 2.6, validity: true, breakout_freshness: 'aging', blockers: [], warnings: ['low_volume'] },
  { symbol: 'XLE', snapshot_id: 101, close: 98.4, sector: 'Energy', industry: 'Sector ETF', wsp_score: 2.2, validity: true, breakout_freshness: 'fresh', blockers: [], warnings: [] },
  { symbol: 'XLK', snapshot_id: 101, close: 209.8, sector: 'Technology', industry: 'Sector ETF', wsp_score: 2.4, validity: true, breakout_freshness: 'fresh', blockers: [], warnings: [] },
  { symbol: 'WEAKX', snapshot_id: 101, close: 12.1, sector: 'Industrials', industry: 'Machinery', wsp_score: 0.8, validity: false, breakout_freshness: 'none', blockers: ['below_ma150'], warnings: ['weak_rs'] },
  { symbol: 'STALEB', snapshot_id: 101, close: 45.2, sector: 'Healthcare', industry: 'Biotech', wsp_score: 1.1, validity: false, breakout_freshness: 'stale', blockers: ['stale_breakout'], warnings: ['volume_fade'] },
];

describe('equity parity acceptance set', () => {
  it('passes when dashboard/screener/detail match on canonical snapshot fields', () => {
    const dashboard = baseRows;
    const screener = baseRows.map((row) => ({ ...row }));
    const detail = baseRows.map((row) => ({ ...row }));

    const result = validateCrossViewParity(dashboard, screener, detail, ACCEPTANCE_SYMBOLS);
    expect(result.passed).toBe(true);
    expect(result.drift).toHaveLength(0);
  });

  it('fails when one symbol drifts across views and blocks publish', () => {
    const dashboard = baseRows;
    const screener = baseRows.map((row) => ({ ...row }));
    const detail = baseRows.map((row) => ({ ...row }));
    detail[0] = { ...detail[0], wsp_score: 1.5 };

    const result = validateCrossViewParity(dashboard, screener, detail, ACCEPTANCE_SYMBOLS);
    expect(result.passed).toBe(false);
    expect(result.drift.some((entry) => entry.includes('NVDA: mismatch on wsp_score'))).toBe(true);
  });
});
