import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, RotateCw, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface DoctrineFailure {
  symbol: string;
  failed_at: string;
  attempted_sector: string | null;
  attempted_industry: string | null;
  failure_reason: string;
  source: string | null;
  attempts: number;
  last_error: string | null;
}

export default function DoctrineFailuresWidget() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: failures, isLoading } = useQuery<DoctrineFailure[]>({
    queryKey: ['doctrine-failures'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_doctrine_failures', { p_limit: 100 });
      if (error) throw error;
      return (data as DoctrineFailure[]) ?? [];
    },
    refetchInterval: 60_000,
  });

  const requeue = useMutation({
    mutationFn: async (symbols: string[]) => {
      const { data, error } = await (supabase.rpc as any)('requeue_doctrine_failures', { p_symbols: symbols });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, symbols) => {
      toast.success(`Re-köade ${symbols.length} symboler`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['doctrine-failures'] });
      queryClient.invalidateQueries({ queryKey: ['doctrine-compliance'] });
    },
    onError: (err: Error) => toast.error(`Re-köning misslyckades: ${err.message}`),
  });

  const toggleSelect = (sym: string) => {
    const next = new Set(selected);
    if (next.has(sym)) next.delete(sym);
    else next.add(sym);
    setSelected(next);
  };

  const toggleAll = () => {
    if (!failures) return;
    if (selected.size === failures.length) setSelected(new Set());
    else setSelected(new Set(failures.map(f => f.symbol)));
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-signal-caution" />
          Doctrine Failures
          {failures && failures.length > 0 && (
            <Badge className="bg-signal-danger/15 text-signal-danger border-signal-danger/30 text-[9px] h-4 px-1.5">{failures.length}</Badge>
          )}
        </CardTitle>
        <div className="flex gap-1">
          {selected.size > 0 && (
            <Button
              size="sm"
              variant="default"
              onClick={() => requeue.mutate(Array.from(selected))}
              disabled={requeue.isPending}
              className="h-6 px-2 text-[10px]"
            >
              <RotateCw className="w-3 h-3 mr-1" />
              Re-köa {selected.size}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['doctrine-failures'] })}
            className="h-6 px-2 text-[10px]"
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : !failures || failures.length === 0 ? (
          <div className="text-xs text-signal-success font-mono py-3 text-center">
            ✓ Inga olösta doktrinfel
          </div>
        ) : (
          <div className="space-y-1 max-h-80 overflow-y-auto">
            <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground border-b border-border pb-1 mb-1">
              <input type="checkbox" checked={selected.size === failures.length} onChange={toggleAll} className="cursor-pointer" />
              <span className="flex-1">SYMBOL</span>
              <span className="w-16 text-right">ATTEMPTS</span>
            </div>
            {failures.map((f) => (
              <div key={f.symbol} className="border border-border rounded p-1.5 hover:bg-muted/30">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(f.symbol)}
                    onChange={() => toggleSelect(f.symbol)}
                    className="cursor-pointer"
                  />
                  <span className="font-mono font-semibold text-xs flex-1">{f.symbol}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{f.attempts} attempts</span>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground mt-0.5 ml-5">
                  <span className="text-signal-danger">{f.failure_reason.slice(0, 90)}</span>
                  {f.failure_reason.length > 90 ? '…' : ''}
                </div>
                <div className="flex items-center gap-2 mt-0.5 ml-5 text-[10px] font-mono text-muted-foreground">
                  {f.attempted_sector && <span>sector: <span className="text-foreground">{f.attempted_sector}</span></span>}
                  {f.attempted_industry && <span>· industry: <span className="text-foreground">{f.attempted_industry}</span></span>}
                  {f.source && <span>· src: {f.source}</span>}
                  <span className="ml-auto">{new Date(f.failed_at).toLocaleString('sv-SE')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
