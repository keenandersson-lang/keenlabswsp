from __future__ import annotations

import copy
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import yaml

from analytics.artifact_export import export_bundle
from analytics.metrics import compute_trade_metrics
from analytics.walkforward import build_windows
from data.loaders import load_ohlcv
from portfolio.portfolio_engine import build_equity_curve
from portfolio.trade_engine import simulate_trades
from signals.signal_engine import generate_signals
from signals.signal_study import compute_forward_returns
from utils.io import write_csv, write_json

DEFAULT_UNIVERSE = ["XLB", "XLE", "XLF", "XLI", "XLK", "XLP", "XLU", "XLV", "XLY", "XLC", "XLRE"]


def _set_nested(d: dict[str, Any], key: str, value: Any) -> None:
    parts = key.split(".")
    cur = d
    for part in parts[:-1]:
        cur = cur[part]
    cur[parts[-1]] = value


def _regime_for_dates(benchmark_df: pd.DataFrame) -> pd.DataFrame:
    bmk = benchmark_df.sort_values("date").copy()
    bmk["ma50"] = bmk["close"].rolling(50).mean()
    bmk["ma150"] = bmk["close"].rolling(150).mean()
    bmk["ma50_slope"] = bmk["ma50"] - bmk["ma50"].shift(10)
    bmk["market_regime"] = np.where(
        (bmk["close"] > bmk["ma50"]) & (bmk["ma50"] > bmk["ma150"]) & (bmk["ma50_slope"] > 0),
        "bullish",
        np.where((bmk["close"] < bmk["ma50"]) & (bmk["ma50"] < bmk["ma150"]), "bearish", "sideways"),
    )
    return bmk[["date", "market_regime"]]


def _volume_bucket(series: pd.Series) -> pd.Series:
    return pd.cut(series, bins=[-np.inf, 1.5, 2.0, 3.0, np.inf], labels=["lt_1_5", "1_5_2", "2_3", "gte_3"])


def _mansfield_bucket(series: pd.Series) -> pd.Series:
    return pd.cut(series, bins=[-np.inf, -0.1, 0.0, 0.1, np.inf], labels=["lt_-0_1", "-0_1_0", "0_0_1", "gte_0_1"])


def _run_baseline(cfg: dict[str, Any], raw: pd.DataFrame, benchmark: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    universe = cfg.get("validation", {}).get("universe") or DEFAULT_UNIVERSE
    signal_frames: list[pd.DataFrame] = []
    for sym in universe:
        sdf = raw[raw["symbol"] == sym]
        if sdf.empty:
            continue
        sig = generate_signals(sdf, benchmark, cfg)
        if not sig.empty:
            signal_frames.append(sig)
    signals = pd.concat(signal_frames, ignore_index=True) if signal_frames else pd.DataFrame()
    trades = simulate_trades(raw, signals, cfg)
    equity = build_equity_curve(trades, cfg["run"]["initial_equity"])
    metrics = compute_trade_metrics(trades, equity, cfg["run"]["initial_equity"]) if not equity.empty else {"totalTrades": 0}
    return signals, trades, equity, metrics


def validate_data(raw: pd.DataFrame, benchmark: pd.DataFrame, cfg: dict[str, Any]) -> dict[str, Any]:
    required = {"date", "open", "high", "low", "close", "volume", "symbol"}
    universe = cfg.get("validation", {}).get("universe") or DEFAULT_UNIVERSE
    start = pd.Timestamp(cfg["run"]["start_date"])
    end = pd.Timestamp(cfg["run"]["end_date"])
    report: dict[str, Any] = {
        "passed": True,
        "blockers": [],
        "universe": universe,
        "benchmark": cfg["run"].get("benchmark_symbol", "SPY"),
        "coverage": {},
    }

    for name, df in {"universe": raw, "benchmark": benchmark}.items():
        missing = sorted(required - set(df.columns))
        if missing:
            report["passed"] = False
            report["blockers"].append(f"{name} missing required columns: {missing}")

    found_symbols = sorted(set(raw["symbol"].unique())) if "symbol" in raw.columns else []
    missing_symbols = [s for s in universe if s not in found_symbols]
    if missing_symbols:
        report["passed"] = False
        report["blockers"].append(f"missing universe symbols: {missing_symbols}")

    for sym in universe:
        sdf = raw[raw["symbol"] == sym]
        if sdf.empty:
            continue
        sym_start = pd.Timestamp(sdf["date"].min())
        sym_end = pd.Timestamp(sdf["date"].max())
        report["coverage"][sym] = {"start": str(sym_start.date()), "end": str(sym_end.date()), "rows": int(len(sdf))}
        if sym_start > start or sym_end < end:
            report["blockers"].append(f"{sym} has incomplete range ({sym_start.date()} to {sym_end.date()})")
            report["passed"] = False

    bmk = benchmark[benchmark["symbol"] == cfg["run"].get("benchmark_symbol", "SPY")]
    if bmk.empty:
        report["passed"] = False
        report["blockers"].append("benchmark symbol missing from benchmark dataset")
    else:
        bmk_start = pd.Timestamp(bmk["date"].min())
        bmk_end = pd.Timestamp(bmk["date"].max())
        report["coverage"]["benchmark"] = {"start": str(bmk_start.date()), "end": str(bmk_end.date()), "rows": int(len(bmk))}
        if bmk_start > start or bmk_end < end:
            report["passed"] = False
            report["blockers"].append("benchmark date coverage does not span configured run range")

    report["real_data_detected"] = bool(len(raw) > 0 and len(benchmark) > 0)
    return report


def validate_engine(signals: pd.DataFrame, trades: pd.DataFrame, artifacts: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    blockers: list[str] = []
    if signals.empty:
        blockers.append("signals output is empty")
    if trades.empty:
        blockers.append("trades output is empty")
    if not trades.empty:
        if (trades["shares"] <= 0).any():
            blockers.append("invalid share counts detected")
        if (trades["entry_price"] <= trades["stop_price"]).any():
            blockers.append("negative/zero stop distance detected")
        if (pd.to_datetime(trades["exit_date"]) < pd.to_datetime(trades["entry_date"])).any():
            blockers.append("exit before entry detected")
        if trades.duplicated(subset=["symbol", "entry_date", "exit_date", "entry_price"]).any():
            blockers.append("duplicate trades detected")

    if not signals.empty:
        merged = signals.merge(trades[["symbol", "entry_date"]], left_on=["symbol", "signal_date"], right_on=["symbol", "entry_date"], how="left")
        if merged["entry_date"].notna().any():
            blockers.append("lookahead leakage: entry date equals signal date")

    required_files = {"summary_metrics.json", "run_metadata.json", "trades.csv", "signals.csv", "daily_equity.csv", "ablation_results.csv", "parameter_grid_results.csv", "walkforward_results.csv", "report.md"}
    artifact_files = {f.get("name") for f in artifacts.get("files", [])}
    if not required_files.issubset(artifact_files):
        blockers.append("artifact bundle missing required files")

    return {"passed": len(blockers) == 0, "blockers": blockers, "checks_run": 8, "run_id": cfg["run"]["run_id"]}


def build_signal_validation(raw: pd.DataFrame, benchmark: pd.DataFrame, signals: pd.DataFrame, forward_windows: list[int]) -> tuple[pd.DataFrame, dict[str, Any]]:
    if signals.empty:
        return pd.DataFrame(), {"passed": False, "reason": "no signals to validate", "aggregations": {}}

    px = raw.sort_values(["symbol", "date"])
    detail = compute_forward_returns(px, signals, forward_windows)

    records = []
    by_symbol = {k: v.reset_index(drop=True) for k, v in px.groupby("symbol")}
    for _, row in signals.iterrows():
        sdf = by_symbol[row["symbol"]]
        loc = sdf.index[sdf["date"] == pd.Timestamp(row["signal_date"])]
        if len(loc) == 0:
            continue
        i = int(loc[0])
        horizon = min(i + max(forward_windows), len(sdf) - 1)
        window = sdf.iloc[i + 1 : horizon + 1]
        if window.empty:
            continue
        entry = float(sdf.iloc[i]["close"])
        mfe = float(window["high"].max() / entry - 1)
        mae = float(window["low"].min() / entry - 1)
        records.append({"symbol": row["symbol"], "signal_date": row["signal_date"], "mfe": mfe, "mae": mae})

    excursion_df = pd.DataFrame(records)
    detail = detail.merge(excursion_df, on=["symbol", "signal_date"], how="left")
    detail["year"] = pd.to_datetime(detail["signal_date"]).dt.year
    detail["volume_bucket"] = _volume_bucket(detail["volume_multiple"].astype(float))
    detail["mansfield_bucket"] = _mansfield_bucket(detail["mansfield"].astype(float))
    detail = detail.merge(_regime_for_dates(benchmark), left_on="signal_date", right_on="date", how="left").drop(columns=["date"], errors="ignore")

    agg_cols = [f"fwd_{w}" for w in forward_windows] + ["mfe", "mae"]
    aggregations = {}
    for key in ["symbol", "year", "market_regime", "volume_bucket", "mansfield_bucket"]:
        grouped = detail.groupby(key, dropna=False)[agg_cols].mean(numeric_only=True).reset_index()
        aggregations[key] = grouped.to_dict(orient="records")

    avg_20 = float(detail["fwd_20"].dropna().mean()) if "fwd_20" in detail else 0.0
    summary = {
        "passed": True,
        "signal_count": int(len(detail)),
        "avg_forward_returns": {f"fwd_{w}": float(detail[f"fwd_{w}"].dropna().mean()) for w in forward_windows if f"fwd_{w}" in detail},
        "avg_mfe": float(detail["mfe"].dropna().mean()) if "mfe" in detail else 0.0,
        "avg_mae": float(detail["mae"].dropna().mean()) if "mae" in detail else 0.0,
        "signal_edge": "positive" if avg_20 > 0 else "inconclusive",
        "aggregations": aggregations,
    }
    return detail, summary


def _streaks(trades: pd.DataFrame) -> tuple[int, int]:
    max_win = max_loss = cur_win = cur_loss = 0
    for pnl in trades["pnl"].tolist():
        if pnl > 0:
            cur_win += 1
            cur_loss = 0
        else:
            cur_loss += 1
            cur_win = 0
        max_win = max(max_win, cur_win)
        max_loss = max(max_loss, cur_loss)
    return max_win, max_loss


def build_trade_validation(trades: pd.DataFrame, equity: pd.DataFrame, initial_equity: float) -> tuple[pd.DataFrame, dict[str, Any]]:
    if trades.empty or equity.empty:
        return pd.DataFrame(), {"passed": False, "reason": "no trades/equity"}
    metrics = compute_trade_metrics(trades, equity, initial_equity)
    daily_ret = equity["equity"].pct_change().fillna(0.0)
    dd = equity["equity"] / equity["equity"].cummax() - 1
    ulcer = float(np.sqrt(np.mean(np.square(np.minimum(dd, 0.0)))))
    longest_win, longest_loss = _streaks(trades)
    metrics["ulcerIndex"] = ulcer
    metrics["longestWinningStreak"] = int(longest_win)
    metrics["longestLosingStreak"] = int(longest_loss)
    metrics["annualizedVolatility"] = float(daily_ret.std(ddof=0) * np.sqrt(252))
    avg_daily = daily_ret.mean()
    metrics["sharpe"] = float((avg_daily / (daily_ret.std(ddof=0) + 1e-12)) * np.sqrt(252))
    downside = daily_ret[daily_ret < 0]
    metrics["sortino"] = float((avg_daily / (downside.std(ddof=0) + 1e-12)) * np.sqrt(252))
    metrics["trade_edge"] = "positive" if metrics.get("expectancy", 0.0) > 0 and metrics.get("profitFactor", 0.0) > 1.0 else "inconclusive"
    return trades.copy(), {"passed": True, **metrics}


def _run_variant(base_cfg: dict[str, Any], overrides: dict[str, Any], raw: pd.DataFrame, benchmark: pd.DataFrame) -> dict[str, Any]:
    cfg = copy.deepcopy(base_cfg)
    for key, value in overrides.items():
        _set_nested(cfg, key, value)
    _, trades, equity, metrics = _run_baseline(cfg, raw, benchmark)
    return {
        "trades": int(len(trades)),
        "cagr": float(metrics.get("cagr", 0.0)),
        "profitFactor": float(metrics.get("profitFactor", 0.0)),
        "sharpe": float(metrics.get("sharpe", 0.0)),
        "maxDrawdown": float(metrics.get("maxDrawdown", 0.0)),
        "expectancy": float(metrics.get("expectancy", 0.0)),
        "exposure": float(metrics.get("exposure", 0.0)),
    }


def run_robustness(base_cfg: dict[str, Any], raw: pd.DataFrame, benchmark: pd.DataFrame, parameter_grid_path: str) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    ablation_variants = {
        "baseline": {},
        "no_market_filter": {"filters.market_enabled": False},
        "no_sector_filter": {"filters.sector_enabled": False},
        "no_mansfield": {"filters.mansfield_enabled": False},
        "no_volume_filter": {"filters.volume_enabled": False},
        "no_150dma_stock_filter": {"filters.stock_ma_enabled": False},
        "no_breakout_freshness_filter": {"filters.breakout_freshness_enabled": False},
        "no_clean_breakout_filter": {"filters.clean_breakout_enabled": False},
    }
    ablation_rows = []
    for name, overrides in ablation_variants.items():
        row = {"variant_name": name, **_run_variant(base_cfg, overrides, raw, benchmark)}
        ablation_rows.append(row)
    ablation_df = pd.DataFrame(ablation_rows)

    grid_cfg = yaml.safe_load(Path(parameter_grid_path).read_text(encoding="utf-8"))
    grid_rows = []
    from analytics.robustness import iter_grid

    for combo in iter_grid(base_cfg, grid_cfg["parameters"]):
        row = {"variant": combo["label"], **_run_variant(combo["config"], {}, raw, benchmark)}
        grid_rows.append(row)
    grid_df = pd.DataFrame(grid_rows)

    slippage_rows = []
    for bps in [0, 5, 10, 20]:
        row = _run_variant(base_cfg, {"execution.entry_slippage_bps": bps, "execution.exit_slippage_bps": bps}, raw, benchmark)
        slippage_rows.append({"slippage_bps": bps, **row})
    slippage_df = pd.DataFrame(slippage_rows)

    robust_score = int((ablation_df["expectancy"] > 0).sum() + (grid_df["expectancy"] > 0).sum())
    robustness_level = "strong" if robust_score >= max(10, int(0.2 * (len(ablation_df) + len(grid_df)))) else "moderate" if robust_score > 0 else "weak"
    summary = {
        "passed": True,
        "ablation_runs": int(len(ablation_df)),
        "grid_runs": int(len(grid_df)),
        "slippage_runs": int(len(slippage_df)),
        "robustness": robustness_level,
    }
    return ablation_df, grid_df, slippage_df, summary


def run_walkforward(base_cfg: dict[str, Any], raw: pd.DataFrame, benchmark: pd.DataFrame, walkforward_cfg_path: str) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    wf = yaml.safe_load(Path(walkforward_cfg_path).read_text(encoding="utf-8"))
    windows = build_windows(base_cfg["run"]["start_date"], base_cfg["run"]["end_date"], wf["train_years"], wf["test_years"], wf["step_years"])

    rows = []
    stitched: list[pd.DataFrame] = []
    from analytics.robustness import iter_grid

    param_grid = iter_grid(base_cfg, wf["optimize_parameters"])
    for idx, win in enumerate(windows, start=1):
        train_raw = raw[(raw["date"] >= win.train_start) & (raw["date"] <= win.train_end)]
        test_raw = raw[(raw["date"] >= win.test_start) & (raw["date"] <= win.test_end)]
        train_bmk = benchmark[(benchmark["date"] >= win.train_start) & (benchmark["date"] <= win.train_end)]
        test_bmk = benchmark[(benchmark["date"] >= win.test_start) & (benchmark["date"] <= win.test_end)]

        best_cfg = base_cfg
        best_sharpe = -np.inf
        for combo in param_grid:
            _, tr, eq, mt = _run_baseline(combo["config"], train_raw, train_bmk)
            sharpe = mt.get("sharpe", 0.0) if not eq.empty else -np.inf
            if sharpe > best_sharpe:
                best_sharpe = sharpe
                best_cfg = combo["config"]

        _, oos_trades, oos_eq, oos_metrics = _run_baseline(best_cfg, test_raw, test_bmk)
        if not oos_eq.empty:
            stitched.append(oos_eq.assign(window=idx))
        rows.append(
            {
                "window": idx,
                "train_start": str(win.train_start.date()),
                "train_end": str(win.train_end.date()),
                "test_start": str(win.test_start.date()),
                "test_end": str(win.test_end.date()),
                "chosen_params": json.dumps(
                    {
                        "volume.min_multiplier": best_cfg["volume"]["min_multiplier"],
                        "stops.fixed_stop_pct": best_cfg["stops"]["fixed_stop_pct"],
                        "resistance.breakout_buffer": best_cfg["resistance"]["breakout_buffer"],
                    }
                ),
                "oos_trades": int(len(oos_trades)),
                "oos_sharpe": float(oos_metrics.get("sharpe", 0.0)),
                "oos_expectancy": float(oos_metrics.get("expectancy", 0.0)),
            }
        )

    wf_df = pd.DataFrame(rows)
    stitched_df = pd.concat(stitched, ignore_index=True) if stitched else pd.DataFrame(columns=["date", "equity", "window"])
    summary = {
        "passed": not wf_df.empty,
        "windows": int(len(wf_df)),
        "avg_oos_sharpe": float(wf_df["oos_sharpe"].mean()) if not wf_df.empty else 0.0,
        "avg_oos_expectancy": float(wf_df["oos_expectancy"].mean()) if not wf_df.empty else 0.0,
        "walkforward_status": "passed" if (not wf_df.empty and float(wf_df["oos_expectancy"].mean()) > 0) else "failed",
    }
    return wf_df, stitched_df, summary


def compute_validation_status(data_validation: dict[str, Any], engine_validation: dict[str, Any], signal_summary: dict[str, Any], trade_summary: dict[str, Any], robustness_summary: dict[str, Any], walkforward_summary: dict[str, Any]) -> dict[str, Any]:
    states: list[str] = []
    missing: list[str] = []
    if not data_validation.get("passed"):
        states.append("validation_incomplete")
        missing.append("data_validation")
    if engine_validation.get("passed"):
        states.append("engine_verified")
    else:
        states.append("scaffold_only")
        missing.append("engine_validation")

    states.append("signal_edge_positive" if signal_summary.get("signal_edge") == "positive" else "signal_edge_inconclusive")
    states.append("trade_edge_positive" if trade_summary.get("trade_edge") == "positive" else "trade_edge_inconclusive")

    robustness = robustness_summary.get("robustness", "weak")
    states.append(f"robustness_{robustness}")
    states.append("walkforward_passed" if walkforward_summary.get("walkforward_status") == "passed" else "walkforward_failed")

    required = [
        data_validation.get("passed"),
        engine_validation.get("passed"),
        signal_summary.get("passed"),
        trade_summary.get("passed"),
        robustness_summary.get("passed"),
        walkforward_summary.get("passed"),
    ]
    validation_complete = all(bool(x) for x in required) and not missing and walkforward_summary.get("walkforward_status") == "passed"
    states.append("validation_complete" if validation_complete else "validation_incomplete")

    return {
        "states": sorted(set(states)),
        "what_ran": {
            "data_validation": True,
            "engine_validation": True,
            "signal_validation": bool(signal_summary),
            "trade_validation": bool(trade_summary),
            "ablation": robustness_summary.get("ablation_runs", 0) > 0,
            "parameter_sweep": robustness_summary.get("grid_runs", 0) > 0,
            "walkforward": walkforward_summary.get("windows", 0) > 0,
        },
        "passed": {
            "data": data_validation.get("passed", False),
            "engine": engine_validation.get("passed", False),
            "signals": signal_summary.get("passed", False),
            "trades": trade_summary.get("passed", False),
            "robustness": robustness_summary.get("passed", False),
            "walkforward": walkforward_summary.get("passed", False) and walkforward_summary.get("walkforward_status") == "passed",
        },
        "failed": {
            "data_blockers": data_validation.get("blockers", []),
            "engine_blockers": engine_validation.get("blockers", []),
        },
        "missing": missing,
        "validation_complete": validation_complete,
    }


def build_validation_report(path: Path, cfg: dict[str, Any], data_validation: dict[str, Any], engine_validation: dict[str, Any], signal_summary: dict[str, Any], trade_summary: dict[str, Any], robustness_summary: dict[str, Any], walkforward_summary: dict[str, Any], status: dict[str, Any]) -> None:
    lines = [
        "# WSP Strategy Validation Report",
        "",
        "## 1. Validation Scope",
        "- Strategy validation pipeline for isolated wsp_backtest engine.",
        "",
        "## 2. Data Universe",
        f"- Universe: {', '.join(data_validation.get('universe', []))}",
        "",
        "## 3. Benchmark",
        f"- Benchmark: {data_validation.get('benchmark')}",
        "",
        "## 4. Data Coverage",
        f"- Data validation passed: {data_validation.get('passed')}",
        f"- Blockers: {data_validation.get('blockers', [])}",
        "",
        "## 5. Baseline Strategy Definition",
        f"- Run ID: {cfg['run']['run_id']}",
        f"- Date range: {cfg['run']['start_date']} to {cfg['run']['end_date']}",
        "",
        "## 6. Engine Validation Outcome",
        f"- Passed: {engine_validation.get('passed')}",
        f"- Blockers: {engine_validation.get('blockers', [])}",
        "",
        "## 7. Signal Validation Outcome",
        f"- Signal count: {signal_summary.get('signal_count', 0)}",
        f"- Edge result: {signal_summary.get('signal_edge', 'inconclusive')}",
        "",
        "## 8. Trade Validation Outcome",
        f"- Expectancy: {trade_summary.get('expectancy', 0.0)}",
        f"- Profit factor: {trade_summary.get('profitFactor', 0.0)}",
        f"- Trade edge: {trade_summary.get('trade_edge', 'inconclusive')}",
        "",
        "## 9. Ablation Findings",
        f"- Ablation runs: {robustness_summary.get('ablation_runs', 0)}",
        "",
        "## 10. Parameter Robustness Findings",
        f"- Grid runs: {robustness_summary.get('grid_runs', 0)}",
        f"- Robustness level: {robustness_summary.get('robustness', 'weak')}",
        "",
        "## 11. Slippage Sensitivity Findings",
        "- Slippage scenarios: 0, 5, 10, 20 bps.",
        "",
        "## 12. Walk-forward Findings",
        f"- Windows: {walkforward_summary.get('windows', 0)}",
        f"- Status: {walkforward_summary.get('walkforward_status', 'failed')}",
        "",
        "## 13. Key Risks",
        "- Validation quality depends on local real-data availability and continuity.",
        "- Regime and filter assumptions are daily-bar approximations.",
        "",
        "## 14. Final Judgment",
        f"- Strategy validation status: {'complete' if status.get('validation_complete') else 'incomplete'}",
        f"- Is there evidence of signal edge? {'yes' if signal_summary.get('signal_edge') == 'positive' else 'inconclusive'}",
        f"- Is there evidence of trade expectancy after costs? {'yes' if trade_summary.get('trade_edge') == 'positive' else 'inconclusive'}",
        f"- Is robustness acceptable? {'yes' if robustness_summary.get('robustness') in {'moderate', 'strong'} else 'inconclusive'}",
        f"- Is walk-forward acceptable? {'yes' if walkforward_summary.get('walkforward_status') == 'passed' else 'no'}",
        "- Recommended next action: gather more data" if not status.get("validation_complete") else "- Recommended next action: proceed to controlled deployment",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def run_full_validation(base_config_path: str = "config/base.yaml", grid_config_path: str = "config/parameter_grid.yaml", walkforward_config_path: str = "config/walkforward.yaml", output_dir: str = "outputs") -> dict[str, Any]:
    cfg = yaml.safe_load(Path(base_config_path).read_text(encoding="utf-8"))
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    raw = load_ohlcv(cfg["data"]["path"], cfg["data"].get("format", "combined_csv"))
    benchmark = load_ohlcv(cfg["data"]["benchmark_path"], "combined_csv")
    benchmark = benchmark[benchmark["symbol"] == cfg["run"].get("benchmark_symbol", "SPY")].copy()

    data_validation = validate_data(raw, benchmark, cfg)
    write_json(out_dir / "data_validation.json", data_validation)

    signals, trades, equity, metrics = _run_baseline(cfg, raw, benchmark)
    write_csv(out_dir / "signals.csv", signals)
    write_csv(out_dir / "trades.csv", trades)
    write_csv(out_dir / "daily_equity.csv", equity)
    write_json(out_dir / "summary_metrics.json", metrics)
    write_json(out_dir / "run_metadata.json", cfg["run"])

    signal_validation_df, signal_summary = build_signal_validation(raw, benchmark, signals, cfg["analytics"].get("forward_windows", [5, 10, 20, 40]))
    write_csv(out_dir / "signal_validation.csv", signal_validation_df)
    write_json(out_dir / "signal_validation_summary.json", signal_summary)

    trade_validation_df, trade_summary = build_trade_validation(trades, equity, cfg["run"]["initial_equity"])
    write_csv(out_dir / "trade_validation.csv", trade_validation_df)
    write_json(out_dir / "portfolio_validation_summary.json", trade_summary)

    ablation_df, grid_df, slippage_df, robustness_summary = run_robustness(cfg, raw, benchmark, grid_config_path)
    write_csv(out_dir / "ablation_results.csv", ablation_df)
    write_csv(out_dir / "parameter_grid_results.csv", grid_df)
    write_csv(out_dir / "slippage_sensitivity.csv", slippage_df)
    write_json(out_dir / "robustness_summary.json", robustness_summary)

    walkforward_df, stitched_oos, walkforward_summary = run_walkforward(cfg, raw, benchmark, walkforward_config_path)
    write_csv(out_dir / "walkforward_results.csv", walkforward_df)
    write_csv(out_dir / "stitched_oos_equity.csv", stitched_oos)
    write_json(out_dir / "walkforward_summary.json", walkforward_summary)

    report_path = out_dir / "validation_report.md"
    base_report_path = out_dir / "report.md"

    artifact_bundle = export_bundle(out_dir, cfg["run"], metrics, trades, signals, equity, ablation_df, grid_df, walkforward_df, report_relpath="report.md")
    build_validation_report(report_path, cfg, data_validation, {"passed": False, "blockers": []}, signal_summary, trade_summary, robustness_summary, walkforward_summary, {"validation_complete": False})

    engine_validation = validate_engine(signals, trades, artifact_bundle, cfg)
    write_json(out_dir / "engine_validation.json", engine_validation)

    status = compute_validation_status(data_validation, engine_validation, signal_summary, trade_summary, robustness_summary, walkforward_summary)
    write_json(out_dir / "validation_status.json", status)
    build_validation_report(report_path, cfg, data_validation, engine_validation, signal_summary, trade_summary, robustness_summary, walkforward_summary, status)
    build_validation_report(base_report_path, cfg, data_validation, engine_validation, signal_summary, trade_summary, robustness_summary, walkforward_summary, status)

    write_json(out_dir / "artifact_bundle.json", artifact_bundle)
    return {
        "data_validation": data_validation,
        "engine_validation": engine_validation,
        "signal_validation_summary": signal_summary,
        "portfolio_validation_summary": trade_summary,
        "robustness_summary": robustness_summary,
        "walkforward_summary": walkforward_summary,
        "validation_status": status,
    }
