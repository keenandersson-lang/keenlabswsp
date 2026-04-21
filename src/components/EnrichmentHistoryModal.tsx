import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, History, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface EnrichmentAttempt {
  symbol: string;
  attempts: number;
  last_attempt_at: string;
  last_error: string | null;
  last_source_tried: string | null;
  created_at: string;
}

interface SymbolMeta {
  symbol: string;
  name: string | null;
  canonical_sector: string | null;
  canonical_industry: string | null;
  classification_status: string | null;
  classification_confidence_level: string | null;
  enriched_at: string | null;
  eligible_for_backfill: boolean | null;
  support_level: string | null;
}

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('sv-SE', { hour12: false });
}

export default function EnrichmentHistoryModal() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['enrichment-history', searched],
    enabled: !!searched,
    queryFn: async () => {
      const sym = searched!.toUpperCase();
      const [attemptRes, symbolRes] = await Promise.all([
        (supabase as any).from('enrichment_attempts').select('*').eq('symbol', sym).maybeSingle(),
        supabase.from('symbols').select('symbol, name, canonical_sector, canonical_industry, classification_status, classification_confidence_level, enriched_at, eligible_for_backfill, support_level').eq('symbol', sym).maybeSingle(),
      ]);
      return {
        attempt: (attemptRes.data as EnrichmentAttempt | null) ?? null,
        symbol: (symbolRes.data as SymbolMeta | null) ?? null,
        error: attemptRes.error?.message ?? symbolRes.error?.message ?? null,
      };
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim().toUpperCase();
    if (trimmed) setSearched(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="font-mono text-xs">
          <History className="h-3.5 w-3.5 mr-1.5" /> Enrichment History
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm flex items-center gap-2">
            <History className="h-4 w-4" /> Symbol Enrichment History
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="flex gap-2 items-center">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            placeholder="Sök ticker (t.ex. AAPB, GLD)…"
            className="font-mono text-xs uppercase"
          />
          <Button type="submit" size="sm" disabled={!query.trim() || isFetching} className="font-mono text-xs">
            <Search className="h-3.5 w-3.5 mr-1" /> Sök
          </Button>
        </form>

        {isLoading && <p className="text-xs font-mono text-muted-foreground">Laddar…</p>}

        {data?.error && (
          <div className="text-xs font-mono text-signal-danger">Fel: {data.error}</div>
        )}

        {data && !data.attempt && !data.symbol && searched && (
          <div className="rounded border border-border p-3 text-xs font-mono text-muted-foreground">
            Symbolen <span className="text-foreground">{searched}</span> finns inte i symbols-tabellen.
          </div>
        )}

        {data?.symbol && (
          <div className="space-y-3 text-xs font-mono">
            <div className="rounded border border-border p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold">{data.symbol.symbol}</span>
                <span className="text-muted-foreground">{data.symbol.name ?? '—'}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
                <div><span className="text-muted-foreground">Sektor:</span> {data.symbol.canonical_sector ?? '—'}</div>
                <div><span className="text-muted-foreground">Industri:</span> {data.symbol.canonical_industry ?? '—'}</div>
                <div><span className="text-muted-foreground">Status:</span> {data.symbol.classification_status ?? '—'}</div>
                <div><span className="text-muted-foreground">Confidence:</span> {data.symbol.classification_confidence_level ?? '—'}</div>
                <div><span className="text-muted-foreground">Support:</span> {data.symbol.support_level ?? '—'}</div>
                <div><span className="text-muted-foreground">Backfill:</span> {data.symbol.eligible_for_backfill ? 'ja' : 'nej'}</div>
                <div className="col-span-2"><span className="text-muted-foreground">Senast berikad:</span> {fmt(data.symbol.enriched_at)}</div>
              </div>
            </div>

            {data.attempt ? (
              <div className="rounded border border-border p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Enrichment Attempts</span>
                  {data.attempt.attempts >= 3 ? (
                    <Badge className="bg-signal-danger/15 text-signal-danger border-signal-danger/30 text-[9px]">
                      <AlertTriangle className="h-3 w-3 mr-1" /> Olöslig
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[9px]">{data.attempt.attempts} försök</Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div><span className="text-muted-foreground">Antal försök:</span> {data.attempt.attempts}</div>
                  <div><span className="text-muted-foreground">Senaste källa:</span> {data.attempt.last_source_tried ?? '—'}</div>
                  <div className="col-span-2"><span className="text-muted-foreground">Senaste försök:</span> {fmt(data.attempt.last_attempt_at)}</div>
                  <div className="col-span-2"><span className="text-muted-foreground">Första försök:</span> {fmt(data.attempt.created_at)}</div>
                </div>
                {data.attempt.last_error && (
                  <div className="pt-2 border-t border-border">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Senaste fel</div>
                    <pre className="whitespace-pre-wrap text-[10px] text-signal-danger bg-background rounded p-2 max-h-40 overflow-y-auto">{data.attempt.last_error}</pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded border border-border p-3 text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-signal-success" />
                Inga registrerade fel — symbolen har aldrig misslyckats med enrichment.
              </div>
            )}

            <Button onClick={() => refetch()} variant="ghost" size="sm" className="font-mono text-xs" disabled={isFetching}>
              Uppdatera
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
