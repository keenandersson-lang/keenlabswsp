import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';

type SourceKey = 'polygon' | 'finnhub' | 'yahoo' | 'alpaca';

interface SourceAttribution {
  window_24h: Record<SourceKey | 'unresolved' | 'total_failed', number>;
  fallback_recovery_24h: Record<'polygon' | 'yahoo' | 'alpaca', number>;
  window_1h: Record<SourceKey | 'failed', number>;
  last_success_at: Record<SourceKey, string | null>;
  metals_coverage?: { total: number; updated_24h: number; threshold: number };
  generated_at: string;
}

const SOURCE_COLORS: Record<SourceKey, string> = {
  polygon: 'bg-primary',
  finnhub: 'bg-signal-buy',
  yahoo: 'bg-signal-caution',
  alpaca: 'bg-muted-foreground',
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'aldrig';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just nu';
  if (mins < 60) return `${mins}m sedan`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h sedan`;
  return `${Math.floor(hours / 24)}d sedan`;
}

export default function SourceAttributionPanel() {
  const { data, isLoading } = useQuery<SourceAttribution>({
    queryKey: ['admin-source-attribution-24h'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_source_attribution_24h');
      if (error) throw error;
      return data as SourceAttribution;
    },
    refetchInterval: 30_000,
  });

  const w24 = data?.window_24h ?? { polygon: 0, finnhub: 0, yahoo: 0, alpaca: 0, unresolved: 0, total_failed: 0 };
  const w1h = data?.window_1h ?? { polygon: 0, finnhub: 0, yahoo: 0, alpaca: 0, failed: 0 };
  const fallback = data?.fallback_recovery_24h ?? { polygon: 0, yahoo: 0, alpaca: 0 };
  const lastSuccess = data?.last_success_at ?? { polygon: null, finnhub: null, yahoo: null, alpaca: null };

  const total24h = w24.polygon + w24.finnhub + w24.yahoo + w24.alpaca;
  const max24h = Math.max(1, w24.polygon, w24.finnhub, w24.yahoo, w24.alpaca);
  const total1h = w1h.polygon + w1h.finnhub + w1h.yahoo + w1h.alpaca;
  const failureRate1h = total1h + w1h.failed > 0 ? w1h.failed / (total1h + w1h.failed) : 0;
  const alarmHigh = failureRate1h > 0.2;

  const sources: SourceKey[] = ['polygon', 'finnhub', 'yahoo', 'alpaca'];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono flex items-center gap-2">
          <Activity className="h-4 w-4" /> H. Source Attribution (24h)
          {alarmHigh && (
            <Badge className="bg-signal-danger/15 text-signal-danger border-signal-danger/30 text-[9px]">
              <AlertTriangle className="h-3 w-3 mr-1" /> {(failureRate1h * 100).toFixed(0)}% fel senaste 1h
            </Badge>
          )}
          {!alarmHigh && total1h > 0 && (
            <Badge className="bg-signal-success/15 text-signal-success border-signal-success/30 text-[9px]">
              <CheckCircle2 className="h-3 w-3 mr-1" /> friskt
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-xs font-mono text-muted-foreground">Laddar...</p>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
          {sources.map((src) => (
            <div key={src} className="rounded border border-border p-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{src}</div>
              <div className="font-mono text-sm font-semibold mt-1">{w24[src].toLocaleString()}</div>
              <div className="text-[9px] text-muted-foreground mt-0.5">senast: {timeAgo(lastSuccess[src])}</div>
              <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                <div className={`h-full ${SOURCE_COLORS[src]} transition-all`} style={{ width: `${(w24[src] / max24h) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs font-mono pt-2 border-t border-border">
          <div className="rounded border border-border p-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total lyckade 24h</div>
            <div className="font-mono text-sm font-semibold mt-1">{total24h.toLocaleString()}</div>
          </div>
          <div className="rounded border border-border p-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Olösta 24h</div>
            <div className={`font-mono text-sm font-semibold mt-1 ${w24.unresolved > 100 ? 'text-signal-caution' : ''}`}>
              {w24.unresolved.toLocaleString()}
            </div>
          </div>
          <div className="rounded border border-border p-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Fallback-räddade</div>
            <div className="font-mono text-sm font-semibold mt-1 text-signal-buy">
              {(fallback.alpaca + fallback.yahoo).toLocaleString()}
            </div>
            <div className="text-[9px] text-muted-foreground mt-0.5">
              alpaca: {fallback.alpaca} · yahoo: {fallback.yahoo}
            </div>
          </div>
        </div>

        <p className="text-[9px] font-mono text-muted-foreground">
          Larm utlöses om felfrekvens &gt;20% senaste timmen. Datakälla: data_sync_log → metadata.source_attribution.
        </p>
      </CardContent>
    </Card>
  );
}
