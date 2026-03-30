from __future__ import annotations

from pathlib import Path
import json
import typer
import yaml
import pandas as pd

from core.config import load_config
from data.loaders import load_ohlcv
from data.preprocess import preprocess
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
