import { BacktestArtifactsContract } from "./types";

export const mockBacktestArtifacts: BacktestArtifactsContract = {
  source: "mock",
  run: {
    runId: "wsp-research-2026-03-28-a",
    strategyVersion: "wsp-v0.4-research",
    dateRange: "2020-01-01 to 2025-12-31",
    universe: "US Equities (liquid, common stock)",
    benchmark: "SPY",
    status: "completed",
    generatedAt: "2026-03-29T18:20:00Z",
  },
  metrics: {
    totalTrades: 412,
    winRate: 0.56,
    profitFactor: 1.38,
    expectancy: 0.21,
    cagr: 0.14,
    sharpe: 1.12,
    maxDrawdown: -0.18,
    exposure: 0.63,
    averageHoldTime: "9 trading days",
  },
  files: [
    { name: "summary_metrics.json", path: "/artifacts/summary_metrics.json", kind: "json" },
    { name: "run_metadata.json", path: "/artifacts/run_metadata.json", kind: "json" },
    { name: "trades.csv", path: "/artifacts/trades.csv", kind: "csv" },
    { name: "signals.csv", path: "/artifacts/signals.csv", kind: "csv" },
    { name: "report.md", path: "/artifacts/report.md", kind: "markdown" },
  ],
  chartImages: [
    { name: "equity_curve.png", path: "/artifacts/charts/equity_curve.png", kind: "image" },
    { name: "drawdown_curve.png", path: "/artifacts/charts/drawdown_curve.png", kind: "image" },
  ],
  notes: [
    "Sample data shown for UI development.",
    "Connect generated artifacts to populate production results.",
  ],
};
