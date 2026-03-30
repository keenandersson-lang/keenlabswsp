from __future__ import annotations

from pathlib import Path
import json
import typer
import yaml
import pandas as pd

from core.config import load_config
from data.ingestion import ingest_sector_etf_data
from data.loaders import load_ohlcv
from data.preprocess import preprocess
from data.validators import validate_ingested_universe
from signals.signal_engine import generate_signals
from signals.signal_study import compute_forward_returns
from portfolio.trade_engine import simulate_trades
from portfolio.portfolio_engine import build_equity_curve
from analytics.metrics import compute_trade_metrics
from analytics.robustness import iter_grid, top_results
from analytics.walkforward import build_windows
from analytics.reports import build_markdown_report
from analytics.charts import plot_equity
from analytics.artifact_export import export_bundle
from analytics.validation import run_full_validation
from utils.io import write_csv, write_json

app = typer.Typer(help="WSP isolated backtest engine")


def _cfg_dict(cfg):
    return cfg.model_dump()


def _load_data_sources_config(path: str) -> dict:
    return yaml.safe_load(Path(path).read_text(encoding="utf-8"))


def _build_first_run_summary(
    data_sources_cfg: dict,
    ingest_summary: dict,
    data_validation: dict,
    run_result: dict | None,
    output_dir: Path,
) -> dict:
    final_status = run_result["validation_status"] if run_result else {"validation_complete": False, "states": ["validation_incomplete"]}
    symbols_failed = ingest_summary.get("symbols_failed", {})
    summary = {
        "provider_used": data_sources_cfg.get("provider", {}).get("name", "disabled"),
        "symbols_requested": ingest_summary.get("symbols_requested", []),
        "symbols_fetched_successfully": ingest_summary.get("symbols_fetched", []),
        "symbols_failed": symbols_failed,
        "missing_symbols": ingest_summary.get("missing_sector_symbols", []),
        "local_files_written": ingest_summary.get("written_files", []),
        "date_coverage": ingest_summary.get("date_coverage", {}),
        "adjusted_data_used": ingest_summary.get("adjusted", False),
        "validate_strategy_completed": bool(run_result),
        "validation_status": final_status,
        "data_validation": data_validation,
        "artifacts_dir": str(output_dir.as_posix()),
        "key_blockers": data_validation.get("blockers", []) + [f"{k}: {v}" for k, v in symbols_failed.items()],
        "first_run_complete": bool(run_result) and bool(final_status.get("validation_complete")),
    }
    return summary


def _write_first_run_markdown(path: Path, summary: dict) -> None:
    lines = [
        "# First Validation Run Summary",
        "",
        f"- Provider used: `{summary.get('provider_used')}`",
        f"- Requested symbols: {', '.join(summary.get('symbols_requested', []))}",
        f"- Successfully fetched: {', '.join(summary.get('symbols_fetched_successfully', [])) or 'none'}",
        f"- Failed symbols: {json.dumps(summary.get('symbols_failed', {}), indent=2)}",
        f"- Missing symbols: {', '.join(summary.get('missing_symbols', [])) or 'none'}",
        f"- Adjusted data used: {summary.get('adjusted_data_used')}",
        f"- validate-strategy completed: {summary.get('validate_strategy_completed')}",
        f"- Final validation complete: {summary.get('validation_status', {}).get('validation_complete')}",
        f"- Artifacts dir: `{summary.get('artifacts_dir')}`",
        "",
        "## Date Coverage",
        "",
    ]
    coverage = summary.get("date_coverage", {})
    if coverage:
        for symbol, details in coverage.items():
            lines.append(f"- {symbol}: {details.get('start')} -> {details.get('end')} ({details.get('rows')} rows)")
    else:
        lines.append("- none")

    blockers = summary.get("key_blockers", [])
    lines.extend(["", "## Key Blockers", ""])
    if blockers:
        lines.extend([f"- {b}" for b in blockers])
    else:
        lines.append("- none")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


@app.command("ingest-sector-data")
def ingest_sector_data(config: str = "config/data_sources.yaml"):
    cfg = _load_data_sources_config(config)
    summary = ingest_sector_etf_data(cfg, refresh_mode="overwrite")
    out = Path(cfg.get("paths", {}).get("outputs_dir", "outputs"))
    write_json(out / "ingestion_summary.json", summary)
    typer.echo(json.dumps(summary, indent=2))


@app.command("refresh-sector-data")
def refresh_sector_data(config: str = "config/data_sources.yaml"):
    cfg = _load_data_sources_config(config)
    summary = ingest_sector_etf_data(cfg, refresh_mode="update")
    out = Path(cfg.get("paths", {}).get("outputs_dir", "outputs"))
    write_json(out / "ingestion_summary.json", summary)
    typer.echo(json.dumps(summary, indent=2))


@app.command("first-validation-run")
def first_validation_run(
    config: str = "config/base.yaml",
    data_sources_config: str = "config/data_sources.yaml",
    grid_config: str = "config/parameter_grid.yaml",
    walkforward_config: str = "config/walkforward.yaml",
):
    data_cfg = _load_data_sources_config(data_sources_config)
    ingest_summary = ingest_sector_etf_data(data_cfg, refresh_mode=data_cfg.get("ingestion", {}).get("mode", "update"))

    format_name = data_cfg.get("ingestion", {}).get("output_format", "csv")
    paths = data_cfg.get("paths", {})
    ext = "parquet" if format_name == "parquet" else "csv"
    benchmark_symbol = data_cfg.get("ingestion", {}).get("benchmark_symbol", "SPY")

    benchmark_path = Path(paths.get("benchmark_dir", "data/benchmark")) / f"{benchmark_symbol}.{ext}"
    sectors_dir = Path(paths.get("sectors_dir", "data/sectors"))
    sector_files = sorted(sectors_dir.glob(f"*.{ext}"))
    frames: list[pd.DataFrame] = []

    if benchmark_path.exists():
        frames.append(pd.read_parquet(benchmark_path) if ext == "parquet" else pd.read_csv(benchmark_path))
    for fp in sector_files:
        frames.append(pd.read_parquet(fp) if ext == "parquet" else pd.read_csv(fp))

    combined = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=["date", "open", "high", "low", "close", "volume", "symbol"])
    data_validation = validate_ingested_universe(
        universe_df=combined,
        benchmark_symbol=benchmark_symbol,
        required_symbols=[s for s in data_cfg.get("ingestion", {}).get("symbols", []) if s != benchmark_symbol],
        start_date=data_cfg.get("ingestion", {}).get("start_date"),
        end_date=data_cfg.get("ingestion", {}).get("end_date"),
    ) if not combined.empty else {
        "passed": False,
        "benchmark_symbol": benchmark_symbol,
        "required_symbols": data_cfg.get("ingestion", {}).get("symbols", []),
        "missing_symbols": data_cfg.get("ingestion", {}).get("symbols", []),
        "coverage": {},
        "blockers": ["no local data files available for validation"],
    }

    outputs_dir = Path(paths.get("outputs_dir", "outputs"))
    write_json(outputs_dir / "ingestion_summary.json", ingest_summary)
    write_json(outputs_dir / "data_validation.json", data_validation)

    run_result = None
    if data_validation.get("passed"):
        run_result = run_full_validation(
            base_config_path=config,
            grid_config_path=grid_config,
            walkforward_config_path=walkforward_config,
            output_dir=str(outputs_dir),
        )

    first_run_summary = _build_first_run_summary(data_cfg, ingest_summary, data_validation, run_result, outputs_dir)
    write_json(outputs_dir / "first_run_summary.json", first_run_summary)
    _write_first_run_markdown(outputs_dir / "first_run_summary.md", first_run_summary)
    typer.echo(json.dumps(first_run_summary, indent=2))


@app.command("preprocess-data")
def preprocess_data(config: str = "config/base.yaml"):
    cfg = load_config(config)
    raw = load_ohlcv(cfg.data["path"], cfg.data.get("format", "combined_csv"))
    processed = preprocess(raw)
    out = Path("data/processed/processed.csv")
    write_csv(out, processed)
    typer.echo(f"Wrote {out}")


@app.command("run-signal-study")
def run_signal_study(config: str = "config/base.yaml"):
    cfg = load_config(config)
    dcfg = _cfg_dict(cfg)
    raw = preprocess(load_ohlcv(cfg.data["path"], cfg.data.get("format", "combined_csv")))
    bmk = load_ohlcv(cfg.data["benchmark_path"], "combined_csv")
    signals = []
    for sym, sdf in raw.groupby("symbol"):
        if sym == cfg.run.benchmark_symbol:
            continue
        s = generate_signals(sdf, bmk[bmk["symbol"] == cfg.run.benchmark_symbol], dcfg)
        if not s.empty:
            signals.append(s)
    signal_df = pd.concat(signals, ignore_index=True) if signals else pd.DataFrame()
    study = compute_forward_returns(raw, signal_df, cfg.analytics["forward_windows"])
    write_csv(Path("outputs/tables/signals.csv"), signal_df)
    write_csv(Path("outputs/tables/signal_study.csv"), study)
    typer.echo("Signal study complete")


@app.command("run-backtest")
def run_backtest(config: str = "config/base.yaml"):
    cfg = load_config(config)
    dcfg = _cfg_dict(cfg)
    raw = preprocess(load_ohlcv(cfg.data["path"], cfg.data.get("format", "combined_csv")))
    bmk = load_ohlcv(cfg.data["benchmark_path"], "combined_csv")
    signals = []
    for sym, sdf in raw.groupby("symbol"):
        if sym == cfg.run.benchmark_symbol:
            continue
        s = generate_signals(sdf, bmk[bmk["symbol"] == cfg.run.benchmark_symbol], dcfg)
        if not s.empty:
            signals.append(s)
    signals_df = pd.concat(signals, ignore_index=True) if signals else pd.DataFrame()
    trades = simulate_trades(raw, signals_df, dcfg)
    equity = build_equity_curve(trades, cfg.run.initial_equity)
    metrics = compute_trade_metrics(trades, equity, cfg.run.initial_equity)
    write_csv(Path("outputs/tables/trades.csv"), trades)
    write_csv(Path("outputs/tables/daily_equity.csv"), equity)
    write_json(Path("outputs/tables/summary_metrics.json"), metrics)
    typer.echo("Backtest complete")


@app.command("run-ablation")
def run_ablation(config: str = "config/base.yaml"):
    variants = ["baseline", "no_market_filter", "no_sector_filter", "no_mansfield", "no_volume_filter", "no_stock_150dma", "no_breakout_freshness", "no_clean_breakout"]
    rows = [{"variant_name": v, "trades": 0, "CAGR": 0.0, "PF": 0.0, "Sharpe": 0.0, "maxDD": 0.0, "expectancy": 0.0, "exposure": 0.0} for v in variants]
    df = pd.DataFrame(rows)
    write_csv(Path("outputs/tables/ablation_results.csv"), df)
    typer.echo("Ablation scaffold complete")


@app.command("run-grid")
def run_grid(config: str = "config/parameter_grid.yaml"):
    g = yaml.safe_load(Path(config).read_text(encoding="utf-8"))
    base = load_config(g["base_config"]).model_dump()
    rows = []
    for combo in iter_grid(base, g["parameters"]):
        rows.append({"variant": combo["label"], "trades": 0, "cagr": 0.0, "profitFactor": 0.0, "sharpe": 0.0, "maxDrawdown": 0.0, "expectancy": 0.0})
    df = pd.DataFrame(rows)
    write_csv(Path("outputs/tables/parameter_grid_results.csv"), df)
    write_csv(Path("outputs/tables/parameter_grid_top.csv"), top_results(df).copy())
    typer.echo("Grid run scaffold complete")


@app.command("run-walkforward")
def run_walkforward(config: str = "config/walkforward.yaml"):
    w = yaml.safe_load(Path(config).read_text(encoding="utf-8"))
    base = load_config(w["base_config"])
    windows = build_windows(base.run.start_date, base.run.end_date, w["train_years"], w["test_years"], w["step_years"])
    rows = []
    for idx, win in enumerate(windows):
        rows.append({"window": idx + 1, "train_start": str(win.train_start.date()), "train_end": str(win.train_end.date()), "test_start": str(win.test_start.date()), "test_end": str(win.test_end.date()), "chosen_params": json.dumps({"volume.min_multiplier": 2.0, "stops.fixed_stop_pct": 0.06, "resistance.breakout_buffer": 0.005}), "oos_sharpe": 0.0})
    write_csv(Path("outputs/tables/walkforward_results.csv"), pd.DataFrame(rows))
    typer.echo("Walkforward scaffold complete")


@app.command("build-report")
def build_report(config: str = "config/base.yaml"):
    cfg = load_config(config)
    metrics_path = Path("outputs/tables/summary_metrics.json")
    metrics = json.loads(metrics_path.read_text(encoding="utf-8")) if metrics_path.exists() else {}
    report_path = Path("outputs/reports/report.md")
    build_markdown_report(report_path, cfg.run.model_dump(), metrics)
    eq_path = Path("outputs/tables/daily_equity.csv")
    if eq_path.exists():
        eq = pd.read_csv(eq_path)
        if not eq.empty:
            plot_equity(eq, Path("outputs/charts/equity_curve.png"))
    typer.echo("Report build complete")


@app.command("export-artifacts")
def export_artifacts(config: str = "config/base.yaml"):
    cfg = load_config(config)
    out_dir = Path("outputs")
    trades = pd.read_csv(out_dir / "tables/trades.csv") if (out_dir / "tables/trades.csv").exists() else pd.DataFrame()
    signals = pd.read_csv(out_dir / "tables/signals.csv") if (out_dir / "tables/signals.csv").exists() else pd.DataFrame()
    daily_equity = pd.read_csv(out_dir / "tables/daily_equity.csv") if (out_dir / "tables/daily_equity.csv").exists() else pd.DataFrame()
    ablation = pd.read_csv(out_dir / "tables/ablation_results.csv") if (out_dir / "tables/ablation_results.csv").exists() else pd.DataFrame()
    grid = pd.read_csv(out_dir / "tables/parameter_grid_results.csv") if (out_dir / "tables/parameter_grid_results.csv").exists() else pd.DataFrame()
    walkforward = pd.read_csv(out_dir / "tables/walkforward_results.csv") if (out_dir / "tables/walkforward_results.csv").exists() else pd.DataFrame()
    summary = json.loads((out_dir / "tables/summary_metrics.json").read_text(encoding="utf-8")) if (out_dir / "tables/summary_metrics.json").exists() else {"totalTrades": 0}
    bundle = export_bundle(out_dir, cfg.run.model_dump(), summary, trades, signals, daily_equity, ablation, grid, walkforward)
    write_json(out_dir / "artifact_bundle.json", bundle)
    typer.echo("Artifacts exported")


@app.command("validate-data")
def validate_data(config: str = "config/base.yaml"):
    run_full_validation(base_config_path=config)
    typer.echo("Data validation complete")


@app.command("validate-engine")
def validate_engine(config: str = "config/base.yaml"):
    run_full_validation(base_config_path=config)
    typer.echo("Engine validation complete")


@app.command("validate-signals")
def validate_signals(config: str = "config/base.yaml"):
    run_full_validation(base_config_path=config)
    typer.echo("Signal validation complete")


@app.command("validate-strategy")
def validate_strategy(config: str = "config/base.yaml", grid_config: str = "config/parameter_grid.yaml", walkforward_config: str = "config/walkforward.yaml"):
    run_full_validation(base_config_path=config, grid_config_path=grid_config, walkforward_config_path=walkforward_config)
    typer.echo("Full strategy validation complete")


if __name__ == "__main__":
    app()
