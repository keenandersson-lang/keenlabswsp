import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { AlertTriangle, FileText, FlaskConical, Info, LineChart } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadBacktestArtifacts } from "@/features/backtest/loader";
import { BacktestArtifactsContract } from "@/features/backtest/types";

const requiredArtifacts = [
  "summary_metrics.json",
  "run_metadata.json",
  "trades.csv",
  "signals.csv",
  "daily_equity.csv",
  "ablation_results.csv",
  "parameter_grid_results.csv",
  "walkforward_results.csv",
  "report.md",
];

function fmtPct(value?: number) {
  if (value === undefined) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function fmtNum(value?: number) {
  if (value === undefined) return "—";
  return value.toLocaleString();
}

function fmtSignedPct(value?: number) {
  if (value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function runStatus(status?: string) {
  switch (status) {
    case "completed":
      return <Badge variant="default">Completed</Badge>;
    case "partial":
      return <Badge variant="secondary">Partial</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "pending":
      return <Badge variant="outline">Pending</Badge>;
    default:
      return <Badge variant="outline">Unknown</Badge>;
  }
}

function ArtifactAvailability({ data }: { data: BacktestArtifactsContract | null }) {
  const available = new Set(data?.files.map((file) => file.name) ?? []);

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {requiredArtifacts.map((artifact) => (
        <Card key={artifact} className="border-border/80">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-mono">{artifact}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-3">
            {available.has(artifact) ? (
              <Badge variant="secondary">Available</Badge>
            ) : (
              <Badge variant="outline">Not available yet</Badge>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Backtest() {
  const location = useLocation();
  const query = useQuery({
    queryKey: ["backtest-artifacts", location.search],
    queryFn: () => loadBacktestArtifacts(location.search),
  });

  const data = query.data?.data ?? null;
  const mode = query.data?.mode;

  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/20 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl font-mono tracking-wide">WSP Backtest Lab</CardTitle>
            <CardDescription>
              This page displays outputs from a separate backtesting engine. It is an isolated UI shell and does not execute backtests.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">Module 1: Web App Layer</Badge>
            <Badge variant="outline">Use ?demo=1 to preview sample artifacts</Badge>
            <Badge variant="outline">Use ?error=1 to verify error handling</Badge>
          </CardContent>
        </Card>

        {query.isLoading && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Loading artifacts…</CardTitle>
              <CardDescription>Checking for backtest result files.</CardDescription>
            </CardHeader>
          </Card>
        )}

        {query.isError && (
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Artifact loading failed
              </CardTitle>
              <CardDescription>
                We could not read the backtest artifacts. Verify file format and artifact paths, then retry.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {!query.isLoading && !query.isError && !data && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No backtest artifacts found yet.</CardTitle>
              <CardDescription>
                Connect generated artifacts to populate this section. Empty state is expected before Module 2 integration.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {!query.isLoading && !query.isError && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Run Overview</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-4">
                <div><span className="text-muted-foreground">Run ID:</span> {data?.run.runId ?? "—"}</div>
                <div><span className="text-muted-foreground">Strategy Version:</span> {data?.run.strategyVersion ?? "—"}</div>
                <div><span className="text-muted-foreground">Date Range:</span> {data?.run.dateRange ?? "—"}</div>
                <div><span className="text-muted-foreground">Universe:</span> {data?.run.universe ?? "—"}</div>
                <div><span className="text-muted-foreground">Benchmark:</span> {data?.run.benchmark ?? "—"}</div>
                <div><span className="text-muted-foreground">Status:</span> {" "}{runStatus(data?.run.status)}</div>
                <div><span className="text-muted-foreground">Generated At:</span> {data?.run.generatedAt ?? "—"}</div>
                <div><span className="text-muted-foreground">Data Source:</span> {data?.source ?? "artifact-loader"}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Summary Metrics</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <div>Total Trades: {fmtNum(data?.metrics.totalTrades)}</div>
                <div>Win Rate: {fmtPct(data?.metrics.winRate)}</div>
                <div>Profit Factor: {data?.metrics.profitFactor?.toFixed(2) ?? "—"}</div>
                <div>Expectancy: {data?.metrics.expectancy?.toFixed(2) ?? "—"}</div>
                <div>CAGR: {fmtPct(data?.metrics.cagr)}</div>
                <div>Sharpe: {data?.metrics.sharpe?.toFixed(2) ?? "—"}</div>
                <div>Max Drawdown: {fmtSignedPct(data?.metrics.maxDrawdown)}</div>
                <div>Exposure: {fmtPct(data?.metrics.exposure)}</div>
                <div>Average Hold Time: {data?.metrics.averageHoldTime ?? "—"}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Study Sections</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <Card><CardHeader className="py-3"><CardTitle className="text-sm">Signal Study</CardTitle></CardHeader><CardContent className="pt-0 text-xs text-muted-foreground">Waiting for signals.csv artifact.</CardContent></Card>
                <Card><CardHeader className="py-3"><CardTitle className="text-sm">Ablation Results</CardTitle></CardHeader><CardContent className="pt-0 text-xs text-muted-foreground">Connect ablation_results.csv to populate.</CardContent></Card>
                <Card><CardHeader className="py-3"><CardTitle className="text-sm">Parameter Robustness</CardTitle></CardHeader><CardContent className="pt-0 text-xs text-muted-foreground">Connect parameter_grid_results.csv to populate.</CardContent></Card>
                <Card><CardHeader className="py-3"><CardTitle className="text-sm">Walk-forward Validation</CardTitle></CardHeader><CardContent className="pt-0 text-xs text-muted-foreground">Connect walkforward_results.csv to populate.</CardContent></Card>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Artifacts</CardTitle>
                <CardDescription>Availability status for the frontend artifact contract.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ArtifactAvailability data={data} />
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Available files</h3>
                  {data?.files.length ? (
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {data.files.map((file) => (
                        <li key={file.path}>
                          <span className="font-mono">{file.name}</span>
                          <span className="text-muted-foreground"> — {file.path}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No file artifacts available yet.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Charts</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {["Equity Curve", "Drawdown", "Parameter Heatmap", "Walk-forward"].map((chart) => (
                  <div key={chart} className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
                    <LineChart className="mb-2 h-4 w-4" />
                    {chart} placeholder
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Reports & Downloads</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground"><FileText className="h-4 w-4" /> Report markdown: {data?.files.find((f) => f.name === "report.md")?.path ?? "Not available yet"}</div>
                <div className="flex items-center gap-2 text-muted-foreground"><FlaskConical className="h-4 w-4" /> {mode === "mock" ? "Sample data shown for UI development." : "No download bundle connected yet."}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Notes & Caveats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p className="flex items-start gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" />Backtest results come from a separate research engine and are not produced by this page.</p>
                <p>This interface does not execute strategy logic, scanner logic, or order logic.</p>
                <p>Outputs are for research workflow support and are not investment advice.</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
