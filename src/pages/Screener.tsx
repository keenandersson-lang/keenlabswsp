import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useEquityScreener, type ScreenerRow } from '@/hooks/use-equity-screener';
import { useSectorRanking } from '@/hooks/use-sector-ranking';
import { useIndustryRanking } from '@/hooks/use-industry-ranking';
import { PatternBadge } from '@/components/PatternBadge';
import { RecommendationBadge } from '@/components/RecommendationBadge';
import { WSPScoreRing } from '@/components/WSPScoreRing';
import { CreditsBadge } from '@/components/CreditsBadge';
import { Scan, ShieldCheck, Expand, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type { WSPPattern, WSPRecommendation } from '@/lib/wsp-types';

const PATTERN_OPTIONS = [
  { value: null as string | null, label: 'Alla stadier' },
  { value: 'climbing', label: 'Climbing' },
  { value: 'base', label: 'Base' },
  { value: 'tired', label: 'Tired' },
  { value: 'downhill', label: 'Downhill' },
];

const PAGE_SIZE = 50;

export default function Screener() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSector = searchParams.get('sector') || null;
  const selectedIndustry = searchParams.get('industry') || null;
  const selectedPattern = searchParams.get('pattern_stage') || null;
  const selectedSignal = searchParams.get('signal') || null;
  const [universeTier, setUniverseTier] = useState<'core' | 'expanded'>('core');
  const [page, setPage] = useState(0);

  const { data: industryRanking = [] } = useIndustryRanking(false, null);
  const { data: sectorRanking = [] } = useSectorRanking();
  const { data: screenerData, isLoading, isFetching } = useEquityScreener({
    page,
    pageSize: PAGE_SIZE,
    universeTier,
    sector: selectedSector,
    industry: selectedIndustry,
    pattern: selectedPattern,
    signalFilter: (selectedSignal as 'breakout' | 'bullish' | 'bearish' | null),
  });
  const rows = screenerData?.rows ?? [];
  const totalCount = screenerData?.totalCount ?? 0;

  const updateFilter = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, val] of Object.entries(updates)) {
      if (val) params.set(key, val);
      else params.delete(key);
    }
    setSearchParams(params, { replace: true });
    setPage(0);
  };

  const canLoadMore = (page + 1) * PAGE_SIZE < totalCount;

  if (isLoading && rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Scan className="h-6 w-6 mx-auto mb-2 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground font-mono">Laddar screener...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4 max-w-7xl mx-auto pb-20 md:pb-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-3">
          <Scan className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" />
          <div>
            <h2 className="text-xs font-bold text-foreground font-mono tracking-wider">WSP SCREENER</h2>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
              Visar {rows.length} av {totalCount} aktier
              {isFetching && <span className="text-primary"> · Uppdaterar...</span>}
            </p>
          </div>
        </div>
        <CreditsBadge />
      </div>

      {/* Universe tier toggle */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => { setUniverseTier('core'); setPage(0); }}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-mono font-semibold transition-colors ${
            universeTier === 'core'
              ? 'border-primary/50 bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Core Universe
        </button>
        <button
          type="button"
          onClick={() => { setUniverseTier('expanded'); setPage(0); }}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-mono font-semibold transition-colors ${
            universeTier === 'expanded'
              ? 'border-primary/50 bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <Expand className="h-3.5 w-3.5" />
          Expanded Universe
        </button>
        <span className="ml-2 text-[9px] font-mono text-muted-foreground">
          {universeTier === 'core' ? '✓ High-trust · 11 GICS sectors' : '🔄 Broader US equity scan'}
        </span>
      </div>

      {/* Filter bar */}
      <div className="rounded-md border border-border bg-card px-3 py-2.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[10px] font-bold font-mono tracking-wider text-foreground">FILTER</h3>
          {(selectedSector || selectedIndustry || selectedPattern || selectedSignal) && (
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
              onClick={() => updateFilter({ sector: null, industry: null, pattern_stage: null, signal: null })}
            >
              Rensa alla
            </button>
          )}
        </div>

        {/* Sector pills */}
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={`rounded border px-2 py-1 text-[10px] font-mono ${!selectedSector ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
            onClick={() => updateFilter({ sector: null, industry: null })}
          >
            Alla sektorer
          </button>
          {sectorRanking.map((s) => (
            <button
              key={s.sector_name}
              type="button"
              className={`rounded border px-2 py-1 text-[10px] font-mono ${selectedSector === s.sector_name ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
              onClick={() => updateFilter({ sector: s.sector_name, industry: null })}
            >
              {s.sector_name}
              {s.is_leading && <span className="ml-1 text-signal-buy">★</span>}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={`rounded border px-2 py-1 text-[10px] font-mono ${!selectedIndustry ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
            onClick={() => updateFilter({ industry: null })}
          >
            Alla industrier
          </button>
          {industryRanking
            .filter((ind) => !selectedSector || ind.sector === selectedSector)
            .slice(0, 70)
            .map((ind) => (
              <button
                key={`${ind.sector}-${ind.display_industry}`}
                type="button"
                className={`rounded border px-2 py-1 text-[10px] font-mono ${selectedIndustry === ind.display_industry ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
                onClick={() => updateFilter({ industry: ind.display_industry })}
              >
                {ind.display_industry}
              </button>
            ))}
        </div>

        {/* Pattern stage pills */}
        <div className="flex flex-wrap gap-1.5">
          {PATTERN_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              className={`rounded border px-2 py-1 text-[10px] font-mono ${selectedPattern === opt.value ? 'border-primary/40 bg-primary/10 text-foreground' : !selectedPattern && !opt.value ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
              onClick={() => updateFilter({ pattern_stage: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[
            { value: null, label: 'Alla signaler' },
            { value: 'breakout', label: 'Breakout' },
            { value: 'bullish', label: 'Bullish' },
            { value: 'bearish', label: 'Bearish' },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              className={`rounded border px-2 py-1 text-[10px] font-mono ${selectedSignal === opt.value ? 'border-primary/40 bg-primary/10 text-foreground' : !selectedSignal && !opt.value ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
              onClick={() => updateFilter({ signal: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Active filter summary */}
        <p className="text-[9px] font-mono text-muted-foreground">
          {selectedSector ?? 'Alla sektorer'} → {selectedIndustry ?? 'Alla industrier'} · {selectedPattern ?? 'Alla stadier'} · {selectedSignal ?? 'Alla signaler'} · {totalCount} resultat
        </p>
      </div>

      {/* Results table */}
      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 text-left text-[10px] text-muted-foreground font-mono">
              <th className="px-3 py-2">#</th>
              <th className="px-2 py-2">SYMBOL</th>
              <th className="px-2 py-2">PRIS</th>
              <th className="px-2 py-2">ÄNDR.</th>
              <th className="px-2 py-2">MÖNSTER</th>
              <th className="px-2 py-2">BREAKOUT</th>
              <th className="px-2 py-2 text-center">SCORE</th>
              <th className="px-2 py-2">VOL</th>
              <th className="px-2 py-2">SEKTOR → INDUSTRI</th>
              <th className="px-2 py-2">SIGNAL</th>
              <th className="px-2 py-2">BLOCKERS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <ScreenerTableRow key={row.symbol} row={row} rank={page * PAGE_SIZE + idx + 1} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground font-mono">
            Inga resultat matchar aktuella filter.
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono text-muted-foreground">
          Sida {page + 1} · Visar {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} av {totalCount}
        </p>
        <div className="flex gap-2">
          {page > 0 && (
            <button
              type="button"
              onClick={() => setPage((p) => p - 1)}
              className="rounded border border-border px-3 py-1.5 text-xs font-mono text-foreground hover:bg-muted"
            >
              ← Föregående
            </button>
          )}
          {canLoadMore && (
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={isFetching}
              className="rounded border border-border px-3 py-1.5 text-xs font-mono text-foreground hover:bg-muted disabled:opacity-50"
            >
              {isFetching ? 'Laddar...' : 'Nästa →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const BLOCKER_LABELS: Record<string, string> = {
  volume_not_confirmed: 'Vol < 2x',
  ma50_slope_not_rising: 'MA50↓',
  below_ma50: '< MA50',
  below_ma150: '< MA150',
  mansfield_negative: 'RS < 0',
  no_breakout: 'Ej breakout',
  stale_breakout: 'Stale BO',
};

const BREAKOUT_LABELS: Record<string, { label: string; color: string }> = {
  FRESH_BREAKOUT: { label: 'FRESH', color: 'text-signal-buy' },
  AGING_BREAKOUT: { label: 'AGING', color: 'text-yellow-500' },
  STALE_BREAKOUT: { label: 'STALE', color: 'text-muted-foreground' },
  APPROACHING: { label: 'NÄRA', color: 'text-blue-400' },
  NONE: { label: '—', color: 'text-muted-foreground' },
};

function ScreenerTableRow({ row, rank }: { row: ScreenerRow; rank: number }) {
  const positive = row.changePercent >= 0;
  const bo = BREAKOUT_LABELS[row.breakout_status] ?? BREAKOUT_LABELS.NONE;
  return (
    <tr className="border-b border-border/30 hover:bg-muted/20 transition-colors">
      <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{rank}</td>
      <td className="px-2 py-2">
        <Link to={`/stock/${row.symbol}`} className="hover:text-primary transition-colors">
          <span className="font-mono text-xs font-bold text-foreground">{row.symbol}</span>
        </Link>
      </td>
      <td className="px-2 py-2 font-mono text-xs text-foreground">
        {row.price != null ? `$${row.price.toFixed(2)}` : '—'}
      </td>
      <td className="px-2 py-2">
        <span className={`flex items-center gap-0.5 font-mono text-xs font-medium ${positive ? 'text-signal-buy' : 'text-signal-sell'}`}>
          {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {positive ? '+' : ''}{row.changePercent.toFixed(2)}%
        </span>
      </td>
      <td className="px-2 py-2"><PatternBadge pattern={row.pattern_state as WSPPattern} /></td>
      <td className="px-2 py-2">
        <span className={`font-mono text-[10px] font-semibold ${bo.color}`}>{bo.label}</span>
      </td>
      <td className="px-2 py-2 text-center">
        <div className="flex justify-center">
          <WSPScoreRing score={row.wsp_score} maxScore={5} size={32} />
        </div>
      </td>
      <td className="px-2 py-2">
        <span className={`font-mono text-xs ${row.volumeRatio != null && row.volumeRatio >= 2 ? 'text-signal-buy font-semibold' : 'text-muted-foreground'}`}>
          {row.volumeRatio != null ? `${row.volumeRatio.toFixed(1)}x` : '—'}
        </span>
      </td>
      <td className="px-2 py-2 text-[9px] text-muted-foreground truncate max-w-[160px]">
        <Link
          to={`/screener?sector=${encodeURIComponent(row.sector)}&industry=${encodeURIComponent(row.industry)}`}
          className="hover:text-foreground"
        >
          {row.sector} → {row.industry}
        </Link>
      </td>
      <td className="px-2 py-2"><RecommendationBadge recommendation={row.recommendation as WSPRecommendation} /></td>
      <td className="px-2 py-2">
        {row.blockers.length > 0 ? (
          <div className="flex flex-wrap gap-0.5">
            {row.blockers.slice(0, 3).map((b) => (
              <span key={b} className="inline-block rounded bg-destructive/10 px-1 py-0.5 text-[8px] font-mono text-destructive">
                {BLOCKER_LABELS[b] ?? b}
              </span>
            ))}
            {row.blockers.length > 3 && (
              <span className="text-[8px] font-mono text-muted-foreground">+{row.blockers.length - 3}</span>
            )}
          </div>
        ) : (
          <span className="text-[8px] font-mono text-signal-buy">✓ OK</span>
        )}
      </td>
    </tr>
  );
}
