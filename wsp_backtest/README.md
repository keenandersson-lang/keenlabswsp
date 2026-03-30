# WSP Backtest Engine (Module 2)

This directory contains an **isolated Python backtesting engine** for the Wall Street Protocol (WSP) strategy.
It is intentionally decoupled from the live scanner runtime and frontend app runtime.

## Isolation & Safety

- Module 1 (web UI `/backtest`) is read-only from this engine's perspective.
- Module 2 (this folder) contains all research/backtest logic.
- Module 3 bridge is file-based artifacts only (no browser-side execution, no live scanner coupling).

## Setup

```bash
cd wsp_backtest
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Expected Data Format

Daily OHLCV schema:

- `date`
- `open`
- `high`
- `low`
- `close`
- `volume`
- `symbol`

Optional:

- `adjusted_close`
- `sector_symbol`

Supported load patterns:

1. One combined CSV/Parquet
2. One file per symbol (`format: per_symbol`)

Benchmark and sector mapping are configured in `config/base.yaml`.

## Config Files

- `config/base.yaml`: baseline strategy and run config
- `config/data_sources.yaml`: input source documentation
- `config/parameter_grid.yaml`: parameter sweeps
- `config/walkforward.yaml`: walk-forward schedule + optimization knobs

All key thresholds are config-driven and rule toggles live under `filters` and component sections.

## CLI Commands

Run from `wsp_backtest/`:

```bash
python -m src.cli preprocess-data --config config/base.yaml
python -m src.cli run-signal-study --config config/base.yaml
python -m src.cli run-backtest --config config/base.yaml
python -m src.cli run-ablation --config config/base.yaml
python -m src.cli run-grid --config config/parameter_grid.yaml
python -m src.cli run-walkforward --config config/walkforward.yaml
python -m src.cli build-report --config config/base.yaml
python -m src.cli export-artifacts --config config/base.yaml
```

## Output Artifacts

Primary artifact contract files generated under `outputs/`:

- `summary_metrics.json`
- `run_metadata.json`
- `trades.csv`
- `signals.csv`
- `daily_equity.csv`
- `ablation_results.csv`
- `parameter_grid_results.csv`
- `walkforward_results.csv`
- `reports/report.md`
- `artifact_bundle.json` (frontend contract bundle)

The artifact bundle includes `run`, `metrics`, `files`, and `chartImages` so Module 1 can map directly to the `/backtest` loader contract.

## Strategy Coverage (V1)

Implemented objectively and testably:

- MA regime/filter logic
- Mansfield RS with configurable modes
- Pivot-based resistance zone detection
- Breakout + clean breakout + volume confirmation
- Next-open execution with slippage/commission
- Initial stop logic and max-hold exits
- Signal studies with forward returns
- Core trade/performance metrics
- Parameter grid skeleton and walk-forward windowing
- Artifact export contract

## Limitations / Placeholders

- Partial exit on trendline break is not enabled (placeholder by design).
- Ablation/grid currently scaffold outputs with deterministic placeholders for comparative table plumbing.
- No external data downloader in-repo; local files only.

## Module 1 Consumption Notes

Module 1 `/backtest` expects specific filenames and summary fields. This engine exports those names and a bundle (`artifact_bundle.json`) that can be wired by loader logic later.

## Testing

```bash
cd wsp_backtest
pytest
```
