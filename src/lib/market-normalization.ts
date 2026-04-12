import { CANONICAL_GICS_SECTORS } from './wsp-data-contract';

const SECTOR_ALIAS_MAP: Record<string, string> = {
  'Information Technology': 'Technology',
  'Health Care': 'Healthcare',
  'Metals & Mining': 'Materials',
};

export function normalizeSectorName(sector: string | null | undefined): string {
  if (!sector) return 'Unknown';
  return SECTOR_ALIAS_MAP[sector] ?? sector;
}

export function isNormalizedGicsSector(sector: string | null | undefined): boolean {
  const normalized = normalizeSectorName(sector);
  return (CANONICAL_GICS_SECTORS as readonly string[]).includes(normalized);
}
