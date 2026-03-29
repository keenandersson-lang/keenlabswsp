import { supabase } from '@/integrations/supabase/client';

export interface SearchableSymbol {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  instrumentType: string | null;
  supportLevel: string | null;
  isApprovedLiveCohort: boolean;
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
  company_name?: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  instrument_type: string | null;
  is_active: boolean | null;
  is_etf: boolean | null;
  is_adr: boolean | null;
  support_level?: string | null;
}

const SEARCHABLE_SYMBOL_COLUMNS = [
  'symbol',
  'name',
  'company_name',
  'sector',
  'industry',
  'exchange',
  'instrument_type',
  'is_active',
  'is_etf',
  'is_adr',
  'support_level',
].join(', ');

function isSearchableSymbolRow(row: SymbolRegistryRow): boolean {
  if (row.is_active === false) return false;
  if (row.instrument_type && row.instrument_type !== 'CS') return false;
  if (row.is_etf === true) return false;
  if (row.is_adr === true) return false;
  return true;
}

function mapSearchableSymbol(row: SymbolRegistryRow, approvedSet: Set<string>): SearchableSymbol {
  return {
    symbol: row.symbol,
    name: row.company_name ?? row.name ?? row.symbol,
    sector: row.sector,
    industry: row.industry,
    exchange: row.exchange,
    instrumentType: row.instrument_type,
    supportLevel: row.support_level ?? null,
    isApprovedLiveCohort: approvedSet.has(row.symbol),
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
      `symbol.ilike.${symbolQuery}%`,
      `name.ilike.${textQuery}`,
      `company_name.ilike.${textQuery}`,
      `sector.ilike.${textQuery}`,
      `industry.ilike.${textQuery}`,
    ].join(','))
    .order('symbol', { ascending: true })
    .limit(limit * 3);

  if (error) throw new Error(error.message);

  const eligibleRows = ((rows ?? []) as SymbolRegistryRow[]).filter(isSearchableSymbolRow).slice(0, limit);

  if (eligibleRows.length === 0) return [];

  const symbols = eligibleRows.map((row) => row.symbol);
  let approvedSet = new Set<string>();

  const { data: cohortRows, error: cohortError } = await supabase
    .from('market_scan_results_latest')
    .select('symbol, approved_for_live_scanner, is_tier1_default')
    .in('symbol', symbols)
    .or('approved_for_live_scanner.eq.true,is_tier1_default.eq.true');

  if (!cohortError && cohortRows) {
    approvedSet = new Set(
      cohortRows
        .map((row: { symbol?: string | null }) => row.symbol)
        .filter((symbol): symbol is string => Boolean(symbol)),
    );
  }

  return eligibleRows.map((row) => mapSearchableSymbol(row, approvedSet));
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

  const typed = row as SymbolRegistryRow;
  if (!isSearchableSymbolRow(typed)) return null;

  const { data: cohortRow } = await supabase
    .from('market_scan_results_latest')
    .select('symbol, approved_for_live_scanner, is_tier1_default')
    .eq('symbol', normalized)
    .or('approved_for_live_scanner.eq.true,is_tier1_default.eq.true')
    .limit(1)
    .maybeSingle();

  return mapSearchableSymbol(typed, new Set(cohortRow?.symbol ? [cohortRow.symbol] : []));
}
