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

## Sector-ETF Data Requirements (Validation Phase)

Validation in this phase targets **SPY + sector ETFs**:

- Benchmark: `SPY`
- Universe: `XLB, XLE, XLF, XLI, XLK, XLP, XLU, XLV, XLY, XLC, XLRE`

Expected daily OHLCV schema:

- `date`
- `open`
- `high`
- `low`
- `close`
- `volume`
- `symbol`

Optional:

- `adjusted_close`

Supported load patterns:

1. One combined CSV/Parquet
2. One file per symbol (`format: per_symbol`)

Benchmark and source paths are configured in `config/base.yaml`.

## Validation CLI

Run from `wsp_backtest/`:

```bash
python -m src.cli validate-data --config config/base.yaml
python -m src.cli validate-engine --config config/base.yaml
python -m src.cli validate-signals --config config/base.yaml
python -m src.cli validate-strategy --config config/base.yaml
```

`validate-strategy` orchestrates:

- data validation
- engine validation
- baseline signal/trade validation
- ablation tests
- parameter sweep
- slippage sensitivity
- walk-forward optimization and OOS stitching
- artifact export + report generation

## Validation Artifacts

Generated under `outputs/`:

Core Module 1 contract artifacts (unchanged):

- `summary_metrics.json`
- `run_metadata.json`
- `trades.csv`
- `signals.csv`
- `daily_equity.csv`
- `ablation_results.csv`
- `parameter_grid_results.csv`
- `walkforward_results.csv`
- `report.md`
- `artifact_bundle.json`

Validation-specific artifacts:

- `validation_status.json`
- `data_validation.json`
- `engine_validation.json`
- `signal_validation.csv`
- `signal_validation_summary.json`
- `trade_validation.csv`
- `portfolio_validation_summary.json`
- `slippage_sensitivity.csv`
- `robustness_summary.json`
- `walkforward_summary.json`
- `stitched_oos_equity.csv`
- `validation_report.md`

## Validation Complete Criteria

`validation_status.json` marks `validation_complete=true` **only when all are true**:

1. data validation passed on real input data
2. engine validation passed
3. baseline signal validation ran successfully
4. baseline trade validation ran successfully
5. ablation and parameter sweep ran
6. walk-forward ran and passed
7. no critical blockers remain

If real data is missing/incomplete, the status remains **incomplete**.

## Known Limitations

- No in-repo market data downloader; local data files are required.
- Sector and market filters are config-driven toggles and rely on daily-bar approximations.
- Validation quality is bounded by date coverage and survivorship of supplied datasets.

## Testing

```bash
cd wsp_backtest
pytest
```
