import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Database, Shuffle, Tag, Shield, BookOpen, ExternalLink } from 'lucide-react';
import DoctrineComplianceWidget from '@/components/DoctrineComplianceWidget';
import DataflowTrackerWidget from '@/components/DataflowTrackerWidget';

interface ModuleSpec {
  num: number;
  name: string;
  edgeFunction: string;
  icon: typeof Database;
  description: string;
  inputs: string[];
  outputs: string[];
  guards: string[];
  source: string;
}

const MODULES: ModuleSpec[] = [
  {
    num: 1,
    name: 'API Data Collector',
    edgeFunction: 'api-data-collector',
    icon: Database,
    description: 'Hämtar in all relevant marknadsdata för US equities från upstream-källor och normaliserar till stabilt schema för universe upsert.',
    inputs: ['Polygon Reference v3 (primary)', 'Finnhub fallback', 'Yahoo fallback', 'Alpaca fallback'],
    outputs: ['symbols (upsert): symbol, name, primary_exchange, instrument_type, is_etf, is_active, asset_class'],
    guards: ['Endast US equities', 'Symbol-format validering /^[A-Z][A-Z0-9.\\-]*$/', 'Skriver till `module_runs` med source attribution'],
    source: 'polygon_reference_v3',
  },
  {
    num: 2,
    name: 'Universe Scan',
    edgeFunction: 'universe-scan',
    icon: Shuffle,
    description: 'Full marknadsgenomsökning av aktiva US equities. Bygger om scanner_universe_snapshot dagligen efter close. Spårar last_success / last_error per körning.',
    inputs: ['symbols (is_active=true)', 'wsp_eligible_universe (vy)'],
    outputs: ['scanner_universe_snapshot', 'scanner_universe_runs (run_id, eligible/blocked counts)'],
    guards: ['Läser endast från wsp_eligible_universe — doktrin-vyn', 'Statusspårning i `module_runs`', 'Idempotent — kan köras minst dagligen'],
    source: 'wsp_eligible_universe',
  },
  {
    num: 3,
    name: 'GICS Classifier',
    edgeFunction: 'gics-classifier',
    icon: Tag,
    description: 'Tilldelar varje ticker både GICS-sektor (1 av 11) och GICS-industri (1 av 72-74). Server-side trigger blockar varje icke-kanonisk skrivning.',
    inputs: ['Oklassificerade symbols (canonical_sector IS NULL OR canonical_industry IS NULL)', 'Multi-source enrich-kedja'],
    outputs: ['symbols.canonical_sector', 'symbols.canonical_industry', 'symbols.market_cap', 'symbols.description', 'doctrine_failures (vid avvisning)'],
    guards: ['trg_enforce_canonical_gics — DB-nivå hard guard', 'computeSectorIndustryClassification() canonical mapping', 'Misslyckade skrivningar landar i doctrine_failures för admin re-queue'],
    source: 'multi-source (Polygon → Finnhub → Yahoo → Alpaca)',
  },
];

export default function Doctrine() {
  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-1">
            <BookOpen className="w-3 h-3" />
            Doktrin & Framework
          </div>
          <h1 className="text-2xl font-bold tracking-tight">WSP Pipeline Doctrine</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Hela systemet följer Wyckoff-Stansberry-Pivot (WSP)-logiken. Pipelinen är uppdelad i tre sekventiella moduler.
            Varje modul har strikt definierade in/utgångar och statusspårning. Server-side guards säkerställer doktrinefterlevnad.
          </p>
        </div>
        <Link to="/admin" className="text-xs text-primary hover:underline flex items-center gap-1">
          Admin Console <ExternalLink className="w-3 h-3" />
        </Link>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DoctrineComplianceWidget />
        <DataflowTrackerWidget />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">Module Contracts</h2>

        <div className="space-y-3">
          {MODULES.map((mod, idx) => {
            const Icon = mod.icon;
            return (
              <div key={mod.num}>
                <Card className="border-border bg-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center font-mono text-xs font-bold">
                          {mod.num}
                        </span>
                        <Icon className="w-4 h-4 text-primary" />
                        {mod.name}
                      </span>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        edge: {mod.edgeFunction}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">{mod.description}</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded border border-border p-2.5 bg-muted/20">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">⬇ INPUT</div>
                        <ul className="space-y-1 text-[11px] font-mono">
                          {mod.inputs.map((i, j) => <li key={j} className="text-foreground">• {i}</li>)}
                        </ul>
                      </div>
                      <div className="rounded border border-border p-2.5 bg-primary/5">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">⬆ OUTPUT</div>
                        <ul className="space-y-1 text-[11px] font-mono">
                          {mod.outputs.map((o, j) => <li key={j} className="text-foreground">• {o}</li>)}
                        </ul>
                      </div>
                    </div>

                    <div className="rounded border border-border p-2.5">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5 flex items-center gap-1">
                        <Shield className="w-3 h-3" /> GUARDS
                      </div>
                      <ul className="space-y-0.5 text-[11px] font-mono">
                        {mod.guards.map((g, j) => <li key={j} className="text-foreground">• {g}</li>)}
                      </ul>
                    </div>

                    <div className="text-[10px] font-mono text-muted-foreground">
                      Source: <span className="text-foreground">{mod.source}</span>
                    </div>
                  </CardContent>
                </Card>

                {idx < MODULES.length - 1 && (
                  <div className="flex justify-center py-1">
                    <ArrowRight className="w-4 h-4 text-muted-foreground rotate-90" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" />
              Downstream Consumers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              När de tre modulerna ovan har slutfört körning levererar pipelinen en single source of truth till hela WSP-systemet:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="rounded border border-border p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">View</div>
                <div className="font-semibold">wsp_eligible_universe</div>
                <div className="text-muted-foreground text-[10px] mt-1">Active common stocks med valid GICS + sector benchmark proxies</div>
              </div>
              <div className="rounded border border-border p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Consumed by</div>
                <div className="font-semibold">scan-market, wsp-screener</div>
                <div className="text-muted-foreground text-[10px] mt-1">Inga gamla sektor/industry-tabeller används längre</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
