import { Star } from 'lucide-react';

export default function Watchlist() {
  return (
    <div className="space-y-4 px-4 py-4 max-w-7xl mx-auto pb-20 md:pb-4">
      <div className="flex items-start gap-3">
        <Star className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" />
        <div>
          <h2 className="text-xs font-bold text-foreground font-mono tracking-wider">WATCHLIST</h2>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
            Dina sparade aktier
          </p>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <Star className="h-8 w-8 mx-auto mb-3 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground font-mono">Ingen watchlist ännu</p>
        <p className="text-xs text-muted-foreground/70 font-mono mt-1">
          Lägg till din första aktie via Screener → stjärnikonen
        </p>
      </div>
    </div>
  );
}
