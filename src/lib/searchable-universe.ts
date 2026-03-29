import { supabase } from '@/integrations/supabase/client';

export interface SearchableSymbol {
  symbol: string;
  name: string;
  canonicalSector: string | null;
}

export interface BroadScanSymbol {
  symbol: string;
  supportLevel: string | null;
  eligibleForBackfill: boolean | null;
  eligibleForFullWsp: boolean | null;
}

export interface ApprovedLiveScannerRow {
  symbol: string;
  approvedForLiveScanner: boolean;
  isTier1Default: boolean;
  score: number | null;
  scanDate: string | null;
}

interface SymbolRegistryRow {
  symbol: string;
  name: string | null;
  canonical_sector: string | null;
  is_active: boolean | null;
}

const SEARCHABLE_SYMBOL_COLUMNS = [
  'symbol',
  'name',
  'canonical_sector',
  'is_active',
].join(', ');

function mapSearchableSymbol(row: SymbolRegistryRow): SearchableSymbol {
  return {
    symbol: row.symbol,
    name: row.name ?? row.symbol,
    canonicalSector: row.canonical_sector,
  };
}

export async function searchSearchableSymbols(query: string, limit = 25): Promise<SearchableSymbol[]> {
  const q = query.trim();
  if (!q) return [];

  const symbolQuery = q.toUpperCase();
  const textQuery = `%${q}%`;

  const { data: rows, error } = await supabase
    .from('symbols')
    .select(SEARCHABLE_SYMBOL_COLUMNS)
    .eq('is_active', true)
    .or([
      `symbol.ilike.%${symbolQuery}%`,
      `name.ilike.${textQuery}`,
    ].join(','))
    .order('symbol', { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);

  const activeRows = ((rows ?? []) as unknown as SymbolRegistryRow[]).filter((row) => row.is_active !== false);
  return activeRows.map((row) => mapSearchableSymbol(row));
}

export async function fetchSearchableSymbolByTicker(symbol: string): Promise<SearchableSymbol | null> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return null;

  const { data: row, error } = await supabase
    .from('symbols')
    .select(SEARCHABLE_SYMBOL_COLUMNS)
    .eq('symbol', normalized)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row) return null;

  const typed = row as unknown as SymbolRegistryRow;
  if (typed.is_active === false) return null;

  return mapSearchableSymbol(typed);
}
