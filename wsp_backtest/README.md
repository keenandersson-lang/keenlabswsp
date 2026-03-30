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

## Provider Credentials (Environment Variables)

No secrets are committed.

1. Copy `.env.example` and set credentials:

```bash
cp .env.example .env
```

2. Export values in your shell (or load via your environment manager):

```bash
export WSP_EODHD_API_KEY="..."
```

Required env vars:

- `WSP_EODHD_API_KEY` (required only when `provider.name: eodhd`)

## Default Validation Universe

- Benchmark: `SPY`
- Sectors: `XLB, XLE, XLF, XLI, XLK, XLP, XLU, XLV, XLY, XLC, XLRE`

These are configured by default in `config/data_sources.yaml` and can be overridden there.

## Data Ingestion

Historical ingestion is provider-based via `config/data_sources.yaml`.

Supported provider modes:

- `eodhd`: HTTP EOD fetcher (requires API key)
- `local_csv`: local drop-in CSV mode (`provider.local_csv_input_dir`)
- `disabled`: explicit no-provider mode (fails loudly)

Run ingestion from `wsp_backtest/`:

```bash
python -m src.cli ingest-sector-data --config config/data_sources.yaml
python -m src.cli refresh-sector-data --config config/data_sources.yaml
```

- `ingest-sector-data`: overwrite mode
- `refresh-sector-data`: update mode (merge new rows with local files)

## First Full Validation Run

End-to-end orchestration command:

```bash
python -m src.cli first-validation-run --config config/base.yaml --data-sources-config config/data_sources.yaml
```

This command performs:

1. data ingestion/refresh
2. ingestion data validation
3. preprocess/validation pipeline execution (`validate-strategy` equivalent)
4. artifact export
5. first-run summary generation

If data is incomplete or provider fails, run status stays incomplete and blockers are written explicitly.

## Expected Local File Layout

CSV mode (default):

- `data/benchmark/SPY.csv`
- `data/sectors/XLB.csv` ... `data/sectors/XLRE.csv`
- `data/raw/ohlcv.csv`

Parquet mode (if configured):

- `data/benchmark/SPY.parquet`
- `data/sectors/XLB.parquet` ... `data/sectors/XLRE.parquet`
- `data/raw/ohlcv.parquet`

## Input Schema

Expected normalized daily schema:

- `date`
- `open`
- `high`
- `low`
- `close`
- `volume`
- `symbol`

Optional:

- `adjusted_close`

## Artifacts

Generated under `outputs/`.

Core Module 1-compatible artifact contract (unchanged):

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

Additional first-run artifacts:

- `ingestion_summary.json`
- `data_validation.json`
- `first_run_summary.json`
- `first_run_summary.md`

Validation pipeline artifacts remain available (`engine_validation.json`, `validation_status.json`, etc.).

## Local CSV-only Mode

To run without remote fetching:

1. set `provider.name: local_csv`
2. place one file per symbol in `provider.local_csv_input_dir`
3. run `first-validation-run`

If symbols are missing, the run is marked incomplete with blockers.

## What “First Validation Run Complete” Means

A run is only considered complete when:

1. required benchmark + sector files were ingested and validated
2. `validate-strategy` actually executed
3. `validation_status.validation_complete` is true
4. first-run summary reports no blocking missing symbols/provider failures

If any condition fails, status remains **incomplete**.

## EODHD Historical Depth Caveat

If `provider.name` is `eodhd` and your account is on the **free plan**, EODHD limits EOD history depth to roughly the most recent year even if `from`/`to` request a wider range.

That means a config like `start_date: "2020-01-01"` and `end_date: "2025-12-31"` can still return data starting around late March 2025 when queried in late March 2026.

In that case, ingestion code is working as written; the fix is to use a paid plan/API key with deeper historical access.

## Testing

```bash
cd wsp_backtest
pytest
```
