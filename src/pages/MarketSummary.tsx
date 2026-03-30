import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Table2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type Regime = 'BULLISH' | 'NEUTRAL' | 'BEARISH';

type SummaryRow = {
  key: string;
  name: string;
  industryCount: number;
  pctToday: number | null;
  pct1Week: number | null;
  pct1Month: number | null;
  pct3Month: number | null;
  wspRegime: Regime;
  wspSetupsCount: number;
};

type SectorSummary = SummaryRow & {
  industries: SummaryRow[];
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
  const sectorBuckets = new Map<string, SymbolMeta[]>();

  for (const meta of symbolMetas) {
    const sector = meta.canonical_sector || meta.sector || FALLBACK_LABEL;
    const bucket = sectorBuckets.get(sector) ?? [];
    bucket.push(meta);
    sectorBuckets.set(sector, bucket);
  }

  const sectorSummaries: SectorSummary[] = [];

  for (const [sectorName, sectorSymbols] of sectorBuckets.entries()) {
    const industryBuckets = new Map<string, SymbolMeta[]>();
    for (const meta of sectorSymbols) {
      const industry = meta.canonical_industry || meta.industry || FALLBACK_LABEL;
      const bucket = industryBuckets.get(industry) ?? [];
      bucket.push(meta);
      industryBuckets.set(industry, bucket);
    }

    const industries: SummaryRow[] = [...industryBuckets.entries()].map(([industryName, members]) => {
      const latestRows = members.map((m) => snapshotsBySymbol.get(m.symbol)?.get(latestDate) ?? null);
      const rows1Week = members.map((m) => snapshotsBySymbol.get(m.symbol)?.get(date1Week) ?? null);
      const rows1Month = members.map((m) => snapshotsBySymbol.get(m.symbol)?.get(date1Month) ?? null);
      const rows3Month = members.map((m) => snapshotsBySymbol.get(m.symbol)?.get(date3Month) ?? null);

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

      return {
        key: `${sectorName}::${industryName}`,
        name: industryName,
        industryCount: 1,
        pctToday: average(latestRows.map((row) => row?.pct_change_1d ?? null)),
        pct1Week: average(latestRows.map((row, idx) => computePerformance(row?.close ?? null, rows1Week[idx]?.close ?? null))),
        pct1Month: average(latestRows.map((row, idx) => computePerformance(row?.close ?? null, rows1Month[idx]?.close ?? null))),
        pct3Month: average(latestRows.map((row, idx) => computePerformance(row?.close ?? null, rows3Month[idx]?.close ?? null))),
        wspRegime: calcRegime(above50Ratio, above150Ratio),
        wspSetupsCount: setupsCount,
      };
    });

    industries.sort((a, b) => (b.pct1Month ?? Number.NEGATIVE_INFINITY) - (a.pct1Month ?? Number.NEGATIVE_INFINITY));

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
      industryCount: industries.length,
      pctToday: average(latestRows.map((row) => row?.pct_change_1d ?? null)),
      pct1Week: average(latestRows.map((row, idx) => computePerformance(row?.close ?? null, rows1Week[idx]?.close ?? null))),
      pct1Month: average(latestRows.map((row, idx) => computePerformance(row?.close ?? null, rows1Month[idx]?.close ?? null))),
      pct3Month: average(latestRows.map((row, idx) => computePerformance(row?.close ?? null, rows3Month[idx]?.close ?? null))),
      wspRegime: calcRegime(above50Ratio, above150Ratio),
      wspSetupsCount: setupsCount,
      industries: industries.slice(0, 5),
    });
  }

  return sectorSummaries.sort((a, b) => (b.pct1Month ?? Number.NEGATIVE_INFINITY) - (a.pct1Month ?? Number.NEGATIVE_INFINITY));
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

  const symbols = symbolMetas.map((row) => row.symbol);
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
            Sector & industry overview · {resolvedDateRangeLabel}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left">Sector name</th>
                <th className="px-3 py-2 text-right">Industry count</th>
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
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{sector.industryCount}</td>
                      <td className={`px-3 py-2 text-right font-mono ${pctClass(sector.pctToday)}`}>{formatPercent(sector.pctToday)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${pctClass(sector.pct1Week)}`}>{formatPercent(sector.pct1Week)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${pctClass(sector.pct1Month)}`}>{formatPercent(sector.pct1Month)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${pctClass(sector.pct3Month)}`}>{formatPercent(sector.pct3Month)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${regimeClass(sector.wspRegime)}`}>{sector.wspRegime}</td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">{sector.wspSetupsCount}</td>
                    </tr>

                    {expanded && sector.industries.map((industry) => (
                      <tr key={industry.key} className="border-b border-border/20 bg-background/30">
                        <td className="px-3 py-2 pl-8 text-muted-foreground">{industry.name}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">—</td>
                        <td className={`px-3 py-2 text-right font-mono ${pctClass(industry.pctToday)}`}>{formatPercent(industry.pctToday)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${pctClass(industry.pct1Week)}`}>{formatPercent(industry.pct1Week)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${pctClass(industry.pct1Month)}`}>{formatPercent(industry.pct1Month)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${pctClass(industry.pct3Month)}`}>{formatPercent(industry.pct3Month)}</td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold ${regimeClass(industry.wspRegime)}`}>{industry.wspRegime}</td>
                        <td className="px-3 py-2 text-right font-mono text-foreground">{industry.wspSetupsCount}</td>
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
