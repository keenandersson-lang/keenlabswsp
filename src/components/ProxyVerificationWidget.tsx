import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Crosshair } from 'lucide-react';

interface ProxyRow {
  symbol: string;
  expected_role: string;
  current_support_level: string | null;
  is_correct: boolean;
  is_active: boolean;
}

export default function ProxyVerificationWidget() {
  const { data: proxies, isLoading } = useQuery<ProxyRow[]>({
    queryKey: ['proxy-verification'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_proxy_verification');
      if (error) throw error;
      return (data as ProxyRow[]) ?? [];
    },
    refetchInterval: 120_000,
  });

  const okCount = proxies?.filter(p => p.is_correct && p.is_active).length ?? 0;
  const total = proxies?.length ?? 0;

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-primary" />
            Sector Proxy Verification
          </span>
          <Badge className={okCount === total ? 'bg-signal-success/15 text-signal-success border-signal-success/30' : 'bg-signal-caution/15 text-signal-caution border-signal-caution/30'}>
            {okCount} / {total}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {proxies?.map((p) => {
              const ok = p.is_correct && p.is_active;
              return (
                <div
                  key={p.symbol}
                  className={`flex items-center justify-between rounded border px-2 py-1 ${ok ? 'border-signal-success/30 bg-signal-success/5' : 'border-signal-danger/40 bg-signal-danger/5'}`}
                  title={`Expected: ${p.expected_role}\nCurrent: ${p.current_support_level ?? 'NOT FOUND'}`}
                >
                  <span className="font-mono text-xs font-semibold">{p.symbol}</span>
                  {ok ? <CheckCircle2 className="w-3 h-3 text-signal-success" /> : <XCircle className="w-3 h-3 text-signal-danger" />}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
