import { useSectorRanking, type SectorRankingRow } from '@/hooks/use-sector-ranking';
import { ArrowUpRight, ArrowDownRight, BarChart3, TrendingUp, Activity, Target, Crown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PatternBadge } from '@/components/PatternBadge';

function RegimeBadge({ regime }: { regime: string }) {
  const r = regime.toLowerCase();
  if (r === 'bullish')
    return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold bg-signal-buy/15 text-signal-buy border border-signal-buy/30"><TrendingUp className="h-2.5 w-2.5" />Bullish</span>;
  if (r === 'bearish')
    return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold bg-signal-sell/15 text-signal-sell border border-signal-sell/30"><ArrowDownRight className="h-2.5 w-2.5" />Bearish</span>;
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold bg-muted text-muted-foreground border border-border"><Activity className="h-2.5 w-2.5" />Neutral</span>;
}

function SectorRow({ sector, rank }: { sector: SectorRankingRow; rank: number }) {
  const pctPositive = sector.avg_pct_today >= 0;
  return (
    <div className="rounded-lg border border-border bg-card p-3 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-bold ${
            rank <= 3 ? 'bg-primary/15 text-primary border border-primary/30' : 'bg-muted text-muted-foreground'
          }`}>
            {rank}
          </div>
          <div className="min-w-0">
            <Link to={`/industries?sector=${encodeURIComponent(sector.sector_name)}`} className="text-sm font-semibold text-foreground hover:text-primary transition-colors truncate block">
              {sector.sector_name}
            </Link>
            <div className="flex items-center gap-2 mt-0.5">
              <RegimeBadge regime={sector.wsp_regime} />
              <span className="text-[10px] font-mono text-muted-foreground">{sector.symbol_count} aktier</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {pctPositive ? <ArrowUpRight className="h-3.5 w-3.5 text-signal-buy" /> : <ArrowDownRight className="h-3.5 w-3.5 text-signal-sell" />}
          <span className={`font-mono text-sm font-bold ${pctPositive ? 'text-signal-buy' : 'text-signal-sell'}`}>
            {pctPositive ? '+' : ''}{sector.avg_pct_today.toFixed(2)}%
          </span>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-4 gap-2">
        <div className="text-center">
          <div className="text-[9px] font-mono uppercase text-muted-foreground">Bredd</div>
          <div className="text-xs font-mono font-semibold text-foreground mt-0.5">{sector.pct_above_ma50.toFixed(0)}%</div>
          <div className="mt-0.5 h-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, sector.pct_above_ma50)}%` }} />
          </div>
        </div>
        <div className="text-center">
          <div className="text-[9px] font-mono uppercase text-muted-foreground">Snitt WSP</div>
          <div className="text-xs font-mono font-semibold text-foreground mt-0.5">{sector.avg_wsp_score.toFixed(0)}</div>
        </div>
        <div className="text-center">
          <div className="text-[9px] font-mono uppercase text-muted-foreground">Setups</div>
          <div className="text-xs font-mono font-semibold text-foreground mt-0.5">{sector.wsp_setups}</div>
        </div>
        <div className="text-center">
          <div className="text-[9px] font-mono uppercase text-muted-foreground">Mönster</div>
          <div className="mt-0.5"><PatternBadge pattern={sector.top_pattern as any} /></div>
        </div>
      </div>
    </div>
  );
}

export default function Sectors() {
  const { data: sectorRanking = [], isLoading } = useSectorRanking();

  const bullishCount = sectorRanking.filter(s => s.wsp_regime === 'Bullish').length;
  const totalStocks = sectorRanking.reduce((sum, s) => sum + s.symbol_count, 0);

  return (
    <div className="space-y-4 px-2 py-2 sm:px-4 sm:py-4 max-w-5xl mx-auto pb-20 md:pb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <BarChart3 className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" />
          <div>
            <h2 className="text-xs font-bold text-foreground font-mono tracking-wider">SEKTORRANKING — KANONISK WSP</h2>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
              11 GICS-sektorer · Median daglig förändring · WSP-bredd och regime
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          <span className="flex items-center gap-1"><Crown className="h-3 w-3 text-primary" />{bullishCount} bullish</span>
          <span className="flex items-center gap-1"><Target className="h-3 w-3" />{totalStocks} aktier</span>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-3 animate-pulse">
              <div className="h-10 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {sectorRanking.map((sector) => (
            <SectorRow key={sector.sector_name} sector={sector} rank={sector.rank_position} />
          ))}
        </div>
      )}

      <p className="text-[9px] font-mono text-muted-foreground text-center">
        Kanonisk WSP sektorranking baserad på publicerad snapshot · Median dag-% · % ovanför MA50 breddmått
      </p>
    </div>
  );
}
