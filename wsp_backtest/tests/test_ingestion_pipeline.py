from pathlib import Path

import pandas as pd
import yaml
from typer.testing import CliRunner

from src.cli import app
from data.ingestion import ingest_sector_etf_data, normalize_provider_frame
from data.validators import validate_ingested_universe


def _sample_frame(symbol: str, start: str = "2023-01-02", periods: int = 5) -> pd.DataFrame:
    dates = pd.bdate_range(start=start, periods=periods)
    px = pd.Series(range(periods), dtype=float) + 100.0
    return pd.DataFrame(
        {
            "date": dates,
            "open": px,
            "high": px + 1,
            "low": px - 1,
            "close": px + 0.5,
            "adjusted_close": px + 0.4,
            "volume": 1_000_000,
            "symbol": symbol,
        }
    )


def test_provider_normalization_maps_adjusted_close():
    rows = [
        {
            "date": "2024-01-02",
            "open": 100,
            "high": 101,
            "low": 99,
            "close": 100.5,
            "adjustedClose": 100.2,
            "volume": 12345,
        }
    ]
    out = normalize_provider_frame(rows, symbol="SPY", adjusted=True)
    assert "adjusted_close" in out.columns
    assert out.iloc[0]["close"] == out.iloc[0]["adjusted_close"]


def test_symbol_file_writing_and_missing_detection(tmp_path: Path):
    input_dir = tmp_path / "input"
    input_dir.mkdir(parents=True)
    _sample_frame("SPY").to_csv(input_dir / "SPY.csv", index=False)
    _sample_frame("XLB").to_csv(input_dir / "XLB.csv", index=False)

    cfg = {
        "provider": {"name": "local_csv", "local_csv_input_dir": str(input_dir)},
        "ingestion": {
            "benchmark_symbol": "SPY",
            "symbols": ["SPY", "XLB", "XLK"],
            "start_date": "2023-01-01",
            "end_date": "2023-12-31",
            "adjusted": False,
            "output_format": "csv",
        },
        "paths": {
            "benchmark_dir": str(tmp_path / "data/benchmark"),
            "sectors_dir": str(tmp_path / "data/sectors"),
            "combined_path": str(tmp_path / "data/raw/ohlcv.csv"),
            "outputs_dir": str(tmp_path / "outputs"),
        },
    }

    summary = ingest_sector_etf_data(cfg, refresh_mode="overwrite")
    assert "SPY" in summary["symbols_fetched"]
    assert "XLB" in summary["symbols_fetched"]
    assert "XLK" in summary["symbols_failed"]
    assert (tmp_path / "data/benchmark/SPY.csv").exists()
    assert (tmp_path / "data/sectors/XLB.csv").exists()

    combined = pd.read_csv(tmp_path / "data/raw/ohlcv.csv")
    validation = validate_ingested_universe(
        combined,
        benchmark_symbol="SPY",
        required_symbols=["XLB", "XLK"],
        start_date="2023-01-01",
        end_date="2023-12-31",
    )
    assert validation["passed"] is False
    assert "XLK" in validation["missing_symbols"]


def test_first_validation_run_marks_incomplete_when_provider_disabled(tmp_path: Path):
    ds_cfg = {
        "provider": {"name": "disabled", "api_key_env_var": "WSP_EODHD_API_KEY"},
        "ingestion": {
            "benchmark_symbol": "SPY",
            "symbols": ["SPY", "XLB"],
            "start_date": "2023-01-01",
            "end_date": "2023-12-31",
            "output_format": "csv",
            "mode": "overwrite",
        },
        "paths": {
            "benchmark_dir": str(tmp_path / "data/benchmark"),
            "sectors_dir": str(tmp_path / "data/sectors"),
            "combined_path": str(tmp_path / "data/raw/ohlcv.csv"),
            "outputs_dir": str(tmp_path / "outputs"),
        },
    }
    ds_path = tmp_path / "data_sources.yaml"
    ds_path.write_text(yaml.safe_dump(ds_cfg), encoding="utf-8")

    base_cfg = yaml.safe_load(Path("config/base.yaml").read_text(encoding="utf-8"))
    base_path = tmp_path / "base.yaml"
    base_path.write_text(yaml.safe_dump(base_cfg), encoding="utf-8")

    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "first-validation-run",
            "--config",
            str(base_path),
            "--data-sources-config",
            str(ds_path),
            "--grid-config",
            "config/parameter_grid.yaml",
            "--walkforward-config",
            "config/walkforward.yaml",
        ],
    )

    assert result.exit_code == 0
    summary_path = tmp_path / "outputs/first_run_summary.json"
    assert summary_path.exists()
    summary = yaml.safe_load(summary_path.read_text(encoding="utf-8"))
    assert summary["first_run_complete"] is False
    assert summary["validate_strategy_completed"] is False
