import pandas as pd

from analytics.validation import (
    build_signal_validation,
    compute_validation_status,
    validate_data,
    validate_engine,
    build_validation_report,
)


def _sample_prices(symbol: str, start: str = "2023-01-01", periods: int = 260) -> pd.DataFrame:
    dates = pd.bdate_range(start=start, periods=periods)
    base = pd.Series(range(periods), dtype=float)
    close = 100 + base * 0.2
    return pd.DataFrame(
        {
            "date": dates,
            "open": close * 0.99,
            "high": close * 1.01,
            "low": close * 0.98,
            "close": close,
            "volume": 1_000_000 + (base * 1000),
            "symbol": symbol,
        }
    )


def test_data_validation_missing_symbol_flags_blocker():
    raw = _sample_prices("XLB")
    bmk = _sample_prices("SPY")
    cfg = {"run": {"start_date": "2023-01-01", "end_date": "2023-12-31", "benchmark_symbol": "SPY"}, "validation": {"universe": ["XLB", "XLK"]}}
    out = validate_data(raw, bmk, cfg)
    assert out["passed"] is False
    assert any("missing universe symbols" in b for b in out["blockers"])


def test_engine_validation_detects_negative_stop_distance_and_duplicates():
    signals = pd.DataFrame({"symbol": ["XLB"], "signal_date": [pd.Timestamp("2023-06-01")]})
    trades = pd.DataFrame(
        {
            "symbol": ["XLB", "XLB"],
            "entry_date": [pd.Timestamp("2023-06-02"), pd.Timestamp("2023-06-02")],
            "exit_date": [pd.Timestamp("2023-06-10"), pd.Timestamp("2023-06-10")],
            "entry_price": [100, 100],
            "stop_price": [100, 100],
            "shares": [10, 10],
        }
    )
    artifacts = {"files": [{"name": "summary_metrics.json"}]}
    cfg = {"run": {"run_id": "t"}}
    out = validate_engine(signals, trades, artifacts, cfg)
    assert out["passed"] is False
    assert any("duplicate trades" in b for b in out["blockers"])


def test_signal_validation_builds_summary():
    raw = pd.concat([_sample_prices("XLB"), _sample_prices("SPY")], ignore_index=True)
    bmk = raw[raw["symbol"] == "SPY"].copy()
    signals = pd.DataFrame(
        {
            "symbol": ["XLB"],
            "signal_date": [raw[raw["symbol"] == "XLB"]["date"].iloc[200]],
            "volume_multiple": [2.1],
            "mansfield": [0.2],
        }
    )
    detail, summary = build_signal_validation(raw, bmk, signals, [5, 10, 20, 40])
    assert not detail.empty
    assert summary["passed"] is True
    assert "avg_forward_returns" in summary


def test_validation_status_transitions():
    status = compute_validation_status(
        {"passed": True, "blockers": []},
        {"passed": True, "blockers": []},
        {"passed": True, "signal_edge": "positive"},
        {"passed": True, "trade_edge": "positive"},
        {"passed": True, "robustness": "strong", "ablation_runs": 1, "grid_runs": 1},
        {"passed": True, "walkforward_status": "passed", "windows": 2},
    )
    assert status["validation_complete"] is True
    assert "validation_complete" in status["states"]


def test_validation_report_generation(tmp_path):
    path = tmp_path / "validation_report.md"
    build_validation_report(
        path,
        {"run": {"run_id": "r1", "start_date": "2020-01-01", "end_date": "2020-12-31"}},
        {"passed": True, "blockers": [], "universe": ["XLB"], "benchmark": "SPY"},
        {"passed": True, "blockers": []},
        {"signal_count": 10, "signal_edge": "positive"},
        {"expectancy": 1.0, "profitFactor": 1.2, "trade_edge": "positive"},
        {"ablation_runs": 1, "grid_runs": 1, "robustness": "moderate"},
        {"windows": 1, "walkforward_status": "passed"},
        {"validation_complete": True},
    )
    content = path.read_text(encoding="utf-8")
    assert "Final Judgment" in content
