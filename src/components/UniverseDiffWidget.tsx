import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GitCompare, ArrowUp, ArrowDown } from 'lucide-react';

interface DiffPayload {
  current: string | null;
  previous: string | null;
  added: Array<{ symbol: string; sector: string | null; industry: string | null; support_level: string | null }>;
  removed: Array<{ symbol: string; sector: string | null; industry: string | null; support_level: string | null; reason: string }>;
  added_count: number;
  removed_count: number;
}

const REASON_COLOR: Record<string, string> = {
  gics_invalid: 'bg-signal-danger/15 text-signal-danger border-signal-danger/30',
  inactive: 'bg-muted text-muted-foreground border-border',
  etf_excluded: 'bg-signal-caution/15 text-signal-caution border-signal-caution/30',
  proxy_change: 'bg-primary/15 text-primary border-primary/30',
  symbol_deleted: 'bg-signal-danger/15 text-signal-danger border-signal-danger/30',
  wsp_ineligible: 'bg-signal-caution/15 text-signal-caution border-signal-caution/30',
  unknown: 'bg-muted text-muted-foreground border-border',
};

export default function UniverseDiffWidget() {
  const { data, isLoading } = useQuery<DiffPayload | null>({
    queryKey: ['universe-diff'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_wsp_eligible_universe_diff');
      if (error) throw error;
      return data as DiffPayload;
    },
    refetchInterval: 60_000,
  });

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-primary" />
          Universe Diff (last two snapshots)
        </CardTitle>
        <div className="flex gap-1.5">
          <Badge className="bg-signal-success/15 text-signal-success border-signal-success/30 text-[10px] h-5">
            <ArrowUp className="w-2.5 h-2.5 mr-1" />+{data?.added_count ?? 0}
          </Badge>
          <Badge className="bg-signal-danger/15 text-signal-danger border-signal-danger/30 text-[10px] h-5">
            <ArrowDown className="w-2.5 h-2.5 mr-1" />−{data?.removed_count ?? 0}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : !data || (!data.current || !data.previous) ? (
          <div className="text-xs text-muted-foreground py-3 text-center font-mono">
            Behöver minst 2 snapshots — kör <span className="text-foreground">daily-universe-refresh</span> två gånger.
          </div>
        ) : (
          <>
            <div className="text-[10px] font-mono text-muted-foreground">
              {new Date(data.previous).toLocaleString('sv-SE')} → {new Date(data.current).toLocaleString('sv-SE')}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-signal-success font-mono mb-1">
                  Added ({data.added_count})
                </div>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {data.added.length === 0 ? (
                    <div className="text-[10px] text-muted-foreground italic">none</div>
                  ) : data.added.slice(0, 50).map(a => (
                    <div key={a.symbol} className="flex items-center gap-1.5 text-[10px] font-mono border border-border rounded px-1.5 py-0.5">
                      <span className="font-semibold flex-1">{a.symbol}</span>
                      <span className="text-muted-foreground truncate max-w-[120px]" title={a.sector ?? ''}>{a.sector ?? '—'}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wide text-signal-danger font-mono mb-1">
                  Removed ({data.removed_count})
                </div>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {data.removed.length === 0 ? (
                    <div className="text-[10px] text-muted-foreground italic">none</div>
                  ) : data.removed.slice(0, 50).map(r => (
                    <div key={r.symbol} className="flex items-center gap-1.5 text-[10px] font-mono border border-border rounded px-1.5 py-0.5">
                      <span className="font-semibold flex-1">{r.symbol}</span>
                      <span className={`px-1 py-px rounded text-[9px] border ${REASON_COLOR[r.reason] ?? REASON_COLOR.unknown}`}>
                        {r.reason}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
