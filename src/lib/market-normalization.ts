/**
 * Market Normalization — maps legacy/provider sector names to official GICS names.
 * 
 * The canonical GICS sectors used by the backend RPCs are:
 *   Energy, Materials, Industrials, Consumer Discretionary, Consumer Staples,
 *   Health Care, Financials, Information Technology, Communication Services,
 *   Utilities, Real Estate
 *
 * The backend RPCs now handle normalization internally, but the frontend
 * still normalizes to protect against any edge cases.
 */

export const CANONICAL_GICS_SECTOR_NAMES = [
  'Energy',
  'Materials',
  'Industrials',
  'Consumer Discretionary',
  'Consumer Staples',
  'Health Care',
  'Financials',
  'Information Technology',
  'Communication Services',
  'Utilities',
  'Real Estate',
] as const;

const SECTOR_ALIAS_MAP: Record<string, string> = {
  'Technology': 'Information Technology',
  'Healthcare': 'Health Care',
  'Metals & Mining': 'Materials',
};

export function normalizeSectorName(sector: string | null | undefined): string {
  if (!sector) return 'Unknown';
  return SECTOR_ALIAS_MAP[sector] ?? sector;
}

export function isCanonicalGicsSector(sector: string | null | undefined): boolean {
  const normalized = normalizeSectorName(sector);
  return (CANONICAL_GICS_SECTOR_NAMES as readonly string[]).includes(normalized);
}
