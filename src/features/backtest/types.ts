export type BacktestRunStatus = "completed" | "partial" | "failed" | "pending";

export type ArtifactFileName =
  | "summary_metrics.json"
  | "run_metadata.json"
  | "trades.csv"
  | "signals.csv"
  | "daily_equity.csv"
  | "ablation_results.csv"
  | "parameter_grid_results.csv"
  | "walkforward_results.csv"
  | "report.md";

export interface BacktestSummaryMetrics {
  totalTrades?: number;
  winRate?: number;
  profitFactor?: number;
  expectancy?: number;
  cagr?: number;
  sharpe?: number;
  maxDrawdown?: number;
  exposure?: number;
  averageHoldTime?: string;
}

export interface BacktestRunOverview {
  runId?: string;
  strategyVersion?: string;
  dateRange?: string;
  universe?: string;
  benchmark?: string;
  status?: BacktestRunStatus;
  generatedAt?: string;
}

export interface BacktestArtifactLink {
  name: ArtifactFileName | string;
  path: string;
  kind: "json" | "csv" | "markdown" | "image" | "other";
}

export interface BacktestArtifactsContract {
  run: BacktestRunOverview;
  metrics: BacktestSummaryMetrics;
  files: BacktestArtifactLink[];
  chartImages: BacktestArtifactLink[];
  notes?: string[];
  source: "mock" | "artifact-loader";
}

export interface BacktestArtifactLoadResult {
  data: BacktestArtifactsContract | null;
  mode: "empty" | "mock" | "partial";
}
