import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Shield, CheckCircle2, XCircle, AlertTriangle, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

interface ComplianceData {
  total_active: number;
  wsp_eligible: number;
  gics_violations: number;
  failures_24h: number;
  trigger_active: boolean;
  view_active: boolean;
  proxies_ok: number;
  proxies_total: number;
  doctrine_score: number;
  as_of: string;
}

interface ValidationData {
  trg_enforce_canonical_gics: { exists: boolean; status: string };
  wsp_eligible_universe: { exists: boolean; row_count: number; status: string };
  canonical_gics_sectors: { count: number; expected: number; status: string };
  canonical_gics_industries: { count: number; expected_min: number; status: string };
  as_of: string;
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const ok = status === 'OK';
  const icon = ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${ok ? 'bg-signal-success/15 text-signal-success border border-signal-success/30' : 'bg-signal-danger/15 text-signal-danger border border-signal-danger/30'}`}>
      {icon} {label}
    </span>
  );
}

export default function DoctrineComplianceWidget() {
  const queryClient = useQueryClient();

  const { data: compliance, isLoading: cLoading } = useQuery<ComplianceData | null>({
    queryKey: ['doctrine-compliance'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_doctrine_compliance');
      if (error) throw error;
      return data as ComplianceData;
    },
    refetchInterval: 60_000,
  });

  const { data: validation } = useQuery<ValidationData | null>({
    queryKey: ['doctrine-validation'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('validate_doctrine_triggers_views');
      if (error) throw error;
      return data as ValidationData;
    },
    refetchInterval: 60_000,
  });

  const refetch = useMutation({
    mutationFn: async () => {
      await queryClient.invalidateQueries({ queryKey: ['doctrine-compliance'] });
      await queryClient.invalidateQueries({ queryKey: ['doctrine-validation'] });
    },
  });

  const score = compliance?.doctrine_score ?? 0;
  const scoreColor = score >= 95 ? 'text-signal-success' : score >= 70 ? 'text-signal-caution' : 'text-signal-danger';

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          Doctrine Compliance
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={() => refetch.mutate()} className="h-6 px-2 text-[10px]">
          <RotateCcw className="w-3 h-3" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {cLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : !compliance ? (
          <div className="text-xs text-signal-danger">Failed to load compliance</div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Doctrine Score</div>
                <div className={`text-3xl font-mono font-bold ${scoreColor}`}>{score}/100</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">WSP-Eligible</div>
                <div className="text-lg font-mono font-semibold tabular-nums">{compliance.wsp_eligible.toLocaleString()}</div>
                <div className="text-[10px] text-muted-foreground">/ {compliance.total_active.toLocaleString()} active</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-border p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">GICS Violations</div>
                <div className={`font-mono text-base font-semibold ${compliance.gics_violations === 0 ? 'text-signal-success' : 'text-signal-danger'}`}>
                  {compliance.gics_violations}
                </div>
              </div>
              <div className="rounded border border-border p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Failures 24h</div>
                <div className={`font-mono text-base font-semibold ${compliance.failures_24h === 0 ? 'text-signal-success' : 'text-signal-caution'}`}>
                  {compliance.failures_24h}
                </div>
              </div>
              <div className="rounded border border-border p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Trigger Guard</div>
                <div className="mt-1">
                  {compliance.trigger_active ? <StatusPill status="OK" label="ACTIVE" /> : <StatusPill status="FAIL" label="MISSING" />}
                </div>
              </div>
              <div className="rounded border border-border p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Eligible View</div>
                <div className="mt-1">
                  {compliance.view_active ? <StatusPill status="OK" label="ACTIVE" /> : <StatusPill status="FAIL" label="MISSING" />}
                </div>
              </div>
              <div className="rounded border border-border p-2 col-span-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Sector Proxies</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="font-mono text-sm">{compliance.proxies_ok} / {compliance.proxies_total}</span>
                  {compliance.proxies_ok === compliance.proxies_total
                    ? <StatusPill status="OK" label="ALL GOOD" />
                    : <StatusPill status="FAIL" label={`${compliance.proxies_total - compliance.proxies_ok} BROKEN`} />}
                </div>
              </div>
            </div>
          </>
        )}

        {validation && (
          <div className="border-t border-border pt-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Trigger & View Validation</div>
            <div className="space-y-1 text-[11px] font-mono">
              <div className="flex items-center justify-between">
                <span>trg_enforce_canonical_gics</span>
                <StatusPill status={validation.trg_enforce_canonical_gics.status} label={validation.trg_enforce_canonical_gics.status} />
              </div>
              <div className="flex items-center justify-between">
                <span>wsp_eligible_universe ({validation.wsp_eligible_universe.row_count})</span>
                <StatusPill status={validation.wsp_eligible_universe.status} label={validation.wsp_eligible_universe.status} />
              </div>
              <div className="flex items-center justify-between">
                <span>canonical_gics_sectors ({validation.canonical_gics_sectors.count}/11)</span>
                <StatusPill status={validation.canonical_gics_sectors.status} label={validation.canonical_gics_sectors.status} />
              </div>
              <div className="flex items-center justify-between">
                <span>canonical_gics_industries ({validation.canonical_gics_industries.count}/69+)</span>
                <StatusPill status={validation.canonical_gics_industries.status} label={validation.canonical_gics_industries.status} />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
