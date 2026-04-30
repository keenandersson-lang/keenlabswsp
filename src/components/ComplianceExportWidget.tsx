import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, FileJson, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function ComplianceExportWidget() {
  const [busy, setBusy] = useState<'json' | 'html' | null>(null);

  const projectUrl = import.meta.env.VITE_SUPABASE_URL ?? '';

  const download = async (format: 'json' | 'html') => {
    setBusy(format);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) {
        toast.error('Logga in först för att exportera');
        setBusy(null);
        return;
      }
      const url = `${projectUrl.replace(/\/$/, '')}/functions/v1/compliance-export?format=${format}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
      }
      const blob = await res.blob();
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const ext = format === 'json' ? 'json' : 'html';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `wsp-doctrine-report-${ts}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(`Exporterad: ${a.download}`);
    } catch (err) {
      toast.error(`Export misslyckades: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Download className="w-4 h-4 text-primary" />
          Compliance Export
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-[10px] text-muted-foreground font-mono">
          Exportera senaste doktrin-status, proxyverifiering, universe-diff och dataflow som delbar rapport.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => download('json')} disabled={busy !== null} className="font-mono text-[10px] flex-1">
            {busy === 'json' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <FileJson className="w-3 h-3 mr-1" />}
            JSON
          </Button>
          <Button size="sm" variant="outline" onClick={() => download('html')} disabled={busy !== null} className="font-mono text-[10px] flex-1">
            {busy === 'html' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <FileText className="w-3 h-3 mr-1" />}
            HTML / PDF
          </Button>
        </div>
        <p className="text-[9px] text-muted-foreground font-mono">
          Tip: Öppna HTML-rapporten i webbläsaren och välj <span className="text-foreground">Skriv ut → Spara som PDF</span>.
        </p>
      </CardContent>
    </Card>
  );
}
