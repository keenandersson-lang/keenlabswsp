import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Table2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type Regime = 'BULLISH' | 'NEUTRAL' | 'BEARISH';

type SummaryRow = {
  key: string;
  name: string;
  itemCount: number;
  pctToday: number | null;
  pct1Week: number | null;
  pct1Month: number | null;
  pct3Month: number | null;
  wspRegime: Regime | null;
  wspSetupsCount: number | null;
};

type SectorSummary = SummaryRow & {
  etfs: SummaryRow[];
};

type IndicatorSnapshot = {
  symbol: string;
  calc_date: string;
  close: number;
  pct_change_1d: number | null;
  above_ma50: boolean | null;
  above_ma150: boolean | null;
  ma50_slope: string | null;
  mansfield_rs: number | null;
};

type SymbolMeta = {
  symbol: string;
  sector: string | null;
  industry: string | null;
  canonical_sector: string | null;
  canonical_industry: string | null;
};

const FALLBACK_LABEL = 'Unclassified';
const GICS_SECTOR_ORDER = [
  'Technology',
  'Financials',
  'Healthcare',
  'Energy',
  'Materials',
  'Industrials',
  'Consumer Discretionary',
  'Consumer Staples',
  'Utilities',
  'Real Estate',
  'Communication Services',
] as const;

const SECTOR_ETF_MAP: Record<string, string[]> = {
  Technology: ['XLK', 'SOXX', 'IGV', 'SKYY', 'HACK'],
  Financials: ['XLF', 'KBE', 'KIE', 'IAI'],
  Healthcare: ['XLV', 'IBB', 'IHI', 'XBI'],
  Energy: ['XLE', 'OIH', 'FCG'],
  Materials: ['XLB', 'GDX', 'COPX', 'SLV', 'GLD'],
  Industrials: ['XLI', 'ITA', 'XAR'],
  'Consumer Discretionary': ['XLY', 'XRT', 'JETS'],
  'Consumer Staples': ['XLP', 'PBJ'],
  Utilities: ['XLU', 'FUTY'],
  'Real Estate': ['XLRE', 'REM', 'VNQ'],
  'Communication Services': ['XLC', 'SOCL'],
};

const METALS_AND_COMMODITIES = ['GLD', 'SLV', 'GDX', 'GDXJ', 'COPX', 'USO', 'UNG', 'DBA'] as const;

function subtractDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() - days);
  return next.toISOString().slice(0, 10);
}

function parseDateString(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return 'N/A';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function pctClass(value: number | null) {
  if (value === null || Number.isNaN(value)) return 'text-muted-foreground';
  return value >= 0 ? 'text-signal-buy' : 'text-signal-sell';
}

function regimeClass(regime: Regime) {
  if (regime === 'BULLISH') return 'text-signal-buy';
  if (regime === 'BEARISH') return 'text-signal-sell';
  return 'text-signal-caution';
}

function formatRegime(regime: Regime | null) {
  return regime ?? 'N/A';
}

function formatSetups(value: number | null) {
  if (value === null || Number.isNaN(value)) return 'N/A';
  return `${value}`;
}

function calcRegime(above50Ratio: number, above150Ratio: number): Regime {
  if (above50Ratio >= 0.6 && above150Ratio >= 0.6) return 'BULLISH';
  if (above50Ratio <= 0.4 && above150Ratio <= 0.4) return 'BEARISH';
  return 'NEUTRAL';
}

function average(values: Array<number | null>): number | null {
  const usable = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (usable.length === 0) return null;
  return usable.reduce((sum, n) => sum + n, 0) / usable.length;
}

function computePerformance(latestClose: number | null, referenceClose: number | null): number | null {
  if (latestClose == null || referenceClose == null || referenceClose === 0) return null;
  return ((latestClose / referenceClose) - 1) * 100;
}

function buildSummaryRows(
  snapshotsBySymbol: Map<string, Map<string, IndicatorSnapshot>>,
  symbolMetas: SymbolMeta[],
  latestDate: string,
  date1Week: string,
  date1Month: string,
  date3Month: string,
): SectorSummary[] {
  const buildEtfRow = (groupName: string, etfSymbol: string): SummaryRow => {
    const latestRow = snapshotsBySymbol.get(etfSymbol)?.get(latestDate) ?? null;
    const row1Week = snapshotsBySymbol.get(etfSymbol)?.get(date1Week) ?? null;
    const row1Month = snapshotsBySymbol.get(etfSymbol)?.get(date1Month) ?? null;
    const row3Month = snapshotsBySymbol.get(etfSymbol)?.get(date3Month) ?? null;

    const hasRegimeData = latestRow?.above_ma50 !== null && latestRow?.above_ma50 !== undefined
      && latestRow?.above_ma150 !== null && latestRow?.above_ma150 !== undefined;
    const wspRegime = hasRegimeData
      ? calcRegime(latestRow?.above_ma50 ? 1 : 0, latestRow?.above_ma150 ? 1 : 0)
      : null;

    const hasSetupsData = latestRow !== null;
    const wspSetupsCount = hasSetupsData
      ? (
        latestRow.above_ma50 === true
        && latestRow.above_ma150 === true
        && (latestRow.ma50_slope?.toLowerCase() === 'up' || latestRow.ma50_slope?.toLowerCase() === 'rising')
        && typeof latestRow.mansfield_rs === 'number'
        && latestRow.mansfield_rs > 0
          ? 1
          : 0
      )
      : null;

    return {
      key: `${groupName}::${etfSymbol}`,
      name: etfSymbol,
      itemCount: 1,
      pctToday: latestRow?.pct_change_1d ?? null,
      pct1Week: computePerformance(latestRow?.close ?? null, row1Week?.close ?? null),
      pct1Month: computePerformance(latestRow?.close ?? null, row1Month?.close ?? null),
      pct3Month: computePerformance(latestRow?.close ?? null, row3Month?.close ?? null),
      wspRegime,
      wspSetupsCount,
    };
  };

  const sectorBuckets = new Map<string, SymbolMeta[]>();

  for (const meta of symbolMetas) {
    const sector = meta.canonical_sector || meta.sector || FALLBACK_LABEL;
    const bucket = sectorBuckets.get(sector) ?? [];
    bucket.push(meta);
    sectorBuckets.set(sector, bucket);
  }

  const sectorSummaries: SectorSummary[] = [];

  for (const [sectorName, sectorSymbols] of sectorBuckets.entries()) {
    const etfs = (SECTOR_ETF_MAP[sectorName] ?? []).map((symbol) => buildEtfRow(sectorName, symbol));

    const latestRows = sectorSymbols.map((m) => snapshotsBySymbol.get(m.symbol)?.get(latestDate) ?? null);
    const rows1Week = sectorSymbols.map((m) => snapshotsBySymbol.get(m.symbol)?.get(date1Week) ?? null);
    const rows1Month = sectorSymbols.map((m) => snapshotsBySymbol.get(m.symbol)?.get(date1Month) ?? null);
    const rows3Month = sectorSymbols.map((m) => snapshotsBySymbol.get(m.symbol)?.get(date3Month) ?? null);

    const above50Ratio = latestRows.filter((r) => r?.above_ma50 === true).length / Math.max(latestRows.length, 1);
    const above150Ratio = latestRows.filter((r) => r?.above_ma150 === true).length / Math.max(latestRows.length, 1);

    const setupsCount = latestRows.filter((row) =>
      row
      && row.above_ma50 === true
      && row.above_ma150 === true
      && (row.ma50_slope?.toLowerCase() === 'up' || row.ma50_slope?.toLowerCase() === 'rising')
      && typeof row.mansfield_rs === 'number'
      && row.mansfield_rs > 0,
    ).length;

    sectorSummaries.push({
      key: sectorName,
      name: sectorName,
      itemCount: etfs.length,
      pctToday: average(latestRows.map((row) => row?.pct_change_1d ?? null)),
      pct1Week: average(latestRows.map((row, idx) => computePerformance(row?.close ?? null, rows1Week[idx]?.close ?? null))),
      pct1Month: average(latestRows.map((row, idx) => computePerformance(row?.close ?? null, rows1Month[idx]?.close ?? null))),
      pct3Month: average(latestRows.map((row, idx) => computePerformance(row?.close ?? null, rows3Month[idx]?.close ?? null))),
      wspRegime: calcRegime(above50Ratio, above150Ratio),
      wspSetupsCount: setupsCount,
      etfs,
    });
  }

  const sectorsByName = new Map(sectorSummaries.map((row) => [row.name, row]));
  const orderedGicsSectors = GICS_SECTOR_ORDER.map((name) => sectorsByName.get(name)).filter((row): row is SectorSummary => Boolean(row));

  const metalsEtfs = METALS_AND_COMMODITIES.map((symbol) => buildEtfRow('Metals & Commodities', symbol));
  const latestMetalsRows = metalsEtfs.map((etf) => snapshotsBySymbol.get(etf.name)?.get(latestDate) ?? null);
  const metalsRows1Week = metalsEtfs.map((etf) => snapshotsBySymbol.get(etf.name)?.get(date1Week) ?? null);
  const metalsRows1Month = metalsEtfs.map((etf) => snapshotsBySymbol.get(etf.name)?.get(date1Month) ?? null);
  const metalsRows3Month = metalsEtfs.map((etf) => snapshotsBySymbol.get(etf.name)?.get(date3Month) ?? null);

  const metalsAbove50Ratio = latestMetalsRows.filter((r) => r?.above_ma50 === true).length / Math.max(latestMetalsRows.length, 1);
  const metalsAbove150Ratio = latestMetalsRows.filter((r) => r?.above_ma150 === true).length / Math.max(latestMetalsRows.length, 1);
  const metalsSetupsCount = latestMetalsRows.filter((row) =>
    row
    && row.above_ma50 === true
    && row.above_ma150 === true
    && (row.ma50_slope?.toLowerCase() === 'up' || row.ma50_slope?.toLowerCase() === 'rising')
    && typeof row.mansfield_rs === 'number'
    && row.mansfield_rs > 0,
  ).length;

  const metalsSummary: SectorSummary = {
    key: 'Metals & Commodities',
    name: 'Metals & Commodities',
    itemCount: metalsEtfs.length,
    pctToday: average(latestMetalsRows.map((row) => row?.pct_change_1d ?? null)),
    pct1Week: average(latestMetalsRows.map((row, idx) => computePerformance(row?.close ?? null, metalsRows1Week[idx]?.close ?? null))),
    pct1Month: average(latestMetalsRows.map((row, idx) => computePerformance(row?.close ?? null, metalsRows1Month[idx]?.close ?? null))),
    pct3Month: average(latestMetalsRows.map((row, idx) => computePerformance(row?.close ?? null, metalsRows3Month[idx]?.close ?? null))),
    wspRegime: calcRegime(metalsAbove50Ratio, metalsAbove150Ratio),
    wspSetupsCount: metalsSetupsCount,
    etfs: metalsEtfs,
  };

  return [...orderedGicsSectors, metalsSummary];
}

async function resolveDateAtOrBefore(targetDate: string): Promise<string> {
  const { data, error } = await (supabase as any)
    .from('wsp_indicators')
    .select('calc_date')
    .lte('calc_date', targetDate)
    .order('calc_date', { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);
  const value = data?.[0]?.calc_date;
  if (!value) throw new Error(`Missing wsp_indicators calc_date <= ${targetDate}`);
  return value;
}

async function fetchMarketSummary(): Promise<SectorSummary[]> {
  const { data: latestRows, error: latestError } = await (supabase as any)
    .from('wsp_indicators')
    .select('calc_date')
    .order('calc_date', { ascending: false })
    .limit(1);

  if (latestError) throw new Error(latestError.message);
  const latestDate = latestRows?.[0]?.calc_date as string | undefined;
  if (!latestDate) throw new Error('No wsp_indicators data found.');

  const latestDateObj = parseDateString(latestDate);
  const [date1Week, date1Month, date3Month] = await Promise.all([
    resolveDateAtOrBefore(subtractDays(latestDateObj, 7)),
    resolveDateAtOrBefore(subtractDays(latestDateObj, 30)),
    resolveDateAtOrBefore(subtractDays(latestDateObj, 90)),
  ]);

  const { data: symbolData, error: symbolError } = await (supabase as any)
    .from('symbols')
    .select('symbol, sector, industry, canonical_sector, canonical_industry, is_active')
    .eq('is_active', true)
    .not('symbol', 'is', null);

  if (symbolError) throw new Error(symbolError.message);

  const symbolMetas: SymbolMeta[] = (symbolData ?? [])
    .filter((row: any) => typeof row.symbol === 'string')
    .map((row: any) => ({
      symbol: row.symbol,
      sector: row.sector,
      industry: row.industry,
      canonical_sector: row.canonical_sector,
      canonical_industry: row.canonical_industry,
    }));

  if (symbolMetas.length === 0) return [];

  const symbols = [...new Set([
    ...symbolMetas.map((row) => row.symbol),
    ...Object.values(SECTOR_ETF_MAP).flat(),
    ...METALS_AND_COMMODITIES,
  ])];
  const requiredDates = [...new Set([latestDate, date1Week, date1Month, date3Month])];

  const { data: indicatorRows, error: indicatorsError } = await (supabase as any)
    .from('wsp_indicators')
    .select('symbol, calc_date, close, pct_change_1d, above_ma50, above_ma150, ma50_slope, mansfield_rs')
    .in('symbol', symbols)
    .in('calc_date', requiredDates);

  if (indicatorsError) throw new Error(indicatorsError.message);

  const snapshotsBySymbol = new Map<string, Map<string, IndicatorSnapshot>>();
  for (const row of (indicatorRows ?? []) as IndicatorSnapshot[]) {
    const symbolSnapshots = snapshotsBySymbol.get(row.symbol) ?? new Map<string, IndicatorSnapshot>();
    symbolSnapshots.set(row.calc_date, row);
    snapshotsBySymbol.set(row.symbol, symbolSnapshots);
  }

  return buildSummaryRows(snapshotsBySymbol, symbolMetas, latestDate, date1Week, date1Month, date3Month);
}

export default function MarketSummary() {
  const [expandedSectors, setExpandedSectors] = useState<Record<string, boolean>>({});

  const marketSummaryQuery = useQuery({
    queryKey: ['market-summary'],
    queryFn: fetchMarketSummary,
    staleTime: 5 * 60 * 1000,
  });

  const sectors = marketSummaryQuery.data ?? [];
  const resolvedDateRangeLabel = useMemo(() => {
    if (!sectors.length) return 'latest snapshots';
    return 'ranked by 1M performance';
  }, [sectors.length]);

  const toggleSector = (sectorKey: string) => {
    setExpandedSectors((prev) => ({ ...prev, [sectorKey]: !prev[sectorKey] }));
  };

  return (
    <div className="space-y-3 px-2 py-2 sm:px-4 sm:py-4 max-w-7xl mx-auto pb-20 md:pb-4">
      <div className="flex items-start gap-3">
        <Table2 className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" />
        <div>
          <h2 className="text-xs font-bold text-foreground font-mono tracking-wider">MARKET SUMMARY</h2>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            Sector & ETF overview · {resolvedDateRangeLabel}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left">Sector name</th>
                <th className="px-3 py-2 text-right">ETF count</th>
                <th className="px-3 py-2 text-right">% Today</th>
                <th className="px-3 py-2 text-right">% 1 Week</th>
                <th className="px-3 py-2 text-right">% 1 Month</th>
                <th className="px-3 py-2 text-right">% 3 Month</th>
                <th className="px-3 py-2 text-right">WSP Regime</th>
                <th className="px-3 py-2 text-right">WSP Setups</th>
              </tr>
            </thead>
            <tbody>
              {marketSummaryQuery.isLoading && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground font-mono">Loading market summary...</td>
                </tr>
              )}

              {marketSummaryQuery.isError && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-signal-sell font-mono">
                    Failed to load market summary: {(marketSummaryQuery.error as Error).message}
                  </td>
                </tr>
              )}

              {!marketSummaryQuery.isLoading && !marketSummaryQuery.isError && sectors.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground font-mono">No market summary data available.</td>
                </tr>
              )}

              {sectors.map((sector) => {
                const expanded = Boolean(expandedSectors[sector.key]);
                return (
                  <Fragment key={sector.key}>
                    <tr
                      className="border-b border-border/30 hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => toggleSector(sector.key)}
                    >
                      <td className="px-3 py-2">
                        <button type="button" className="flex items-center gap-1.5 text-left">
                          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          <span className="font-medium text-foreground">{sector.name}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{sector.itemCount}</td>
                      <td className={`px-3 py-2 text-right font-mono ${pctClass(sector.pctToday)}`}>{formatPercent(sector.pctToday)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${pctClass(sector.pct1Week)}`}>{formatPercent(sector.pct1Week)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${pctClass(sector.pct1Month)}`}>{formatPercent(sector.pct1Month)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${pctClass(sector.pct3Month)}`}>{formatPercent(sector.pct3Month)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${sector.wspRegime ? regimeClass(sector.wspRegime) : 'text-muted-foreground'}`}>{formatRegime(sector.wspRegime)}</td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">{formatSetups(sector.wspSetupsCount)}</td>
                    </tr>

                    {expanded && sector.etfs.map((etf) => (
                      <tr key={etf.key} className="border-b border-border/20 bg-background/30">
                        <td className="px-3 py-2 pl-8 text-muted-foreground">{etf.name}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">—</td>
                        <td className={`px-3 py-2 text-right font-mono ${pctClass(etf.pctToday)}`}>{formatPercent(etf.pctToday)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${pctClass(etf.pct1Week)}`}>{formatPercent(etf.pct1Week)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${pctClass(etf.pct1Month)}`}>{formatPercent(etf.pct1Month)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${pctClass(etf.pct3Month)}`}>{formatPercent(etf.pct3Month)}</td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold ${etf.wspRegime ? regimeClass(etf.wspRegime) : 'text-muted-foreground'}`}>{formatRegime(etf.wspRegime)}</td>
                        <td className="px-3 py-2 text-right font-mono text-foreground">{formatSetups(etf.wspSetupsCount)}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground font-mono">
        WSP Regime is based on aggregate price position vs 50MA and 150MA. WSP Setups = symbols above 50MA & 150MA, rising 50MA, and Mansfield RS &gt; 0.
      </p>
    </div>
  );
}
