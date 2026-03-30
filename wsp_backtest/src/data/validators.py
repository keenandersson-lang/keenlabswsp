from __future__ import annotations

import pandas as pd

DEFAULT_VALIDATION_UNIVERSE = ["XLB", "XLE", "XLF", "XLI", "XLK", "XLP", "XLU", "XLV", "XLY", "XLC", "XLRE"]


def validate_ohlcv(df: pd.DataFrame) -> None:
    required = {"date", "open", "high", "low", "close", "volume", "symbol"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")
    if df.duplicated(subset=["symbol", "date"]).any():
        raise ValueError("Duplicate symbol/date rows detected")
    if df[["open", "high", "low", "close"]].isna().any().any():
        raise ValueError("OHLC contains nulls")
    if (df["high"] < df["low"]).any():
        raise ValueError("High lower than low found")
    if ((df["open"] > df["high"]) | (df["open"] < df["low"]) | (df["close"] > df["high"]) | (df["close"] < df["low"])).any():
        raise ValueError("OHLC relationship invalid (open/close outside high-low range)")
    if (df[["open", "high", "low", "close"]] <= 0).any().any():
        raise ValueError("Non-positive prices found")


def validate_ingested_universe(
    universe_df: pd.DataFrame,
    benchmark_symbol: str,
    required_symbols: list[str] | None,
    start_date: str,
    end_date: str,
) -> dict:
    validate_ohlcv(universe_df)
    start = pd.Timestamp(start_date)
    end = pd.Timestamp(end_date)
    required = required_symbols or DEFAULT_VALIDATION_UNIVERSE

    report: dict = {
        "passed": True,
        "benchmark_symbol": benchmark_symbol,
        "required_symbols": required,
        "missing_symbols": [],
        "coverage": {},
        "blockers": [],
    }

    found_symbols = sorted(universe_df["symbol"].astype(str).unique().tolist())

    required_all = [benchmark_symbol] + [s for s in required if s != benchmark_symbol]
    report["missing_symbols"] = [s for s in required_all if s not in found_symbols]
    if report["missing_symbols"]:
        report["passed"] = False
        report["blockers"].append(f"missing required symbols: {report['missing_symbols']}")

    for sym, sdf in universe_df.groupby("symbol"):
        ordered = sdf.sort_values("date")
        if not ordered["date"].is_monotonic_increasing:
            report["passed"] = False
            report["blockers"].append(f"{sym} dates are not monotonic")

        sym_start = pd.Timestamp(ordered["date"].min())
        sym_end = pd.Timestamp(ordered["date"].max())
        report["coverage"][str(sym)] = {
            "start": str(sym_start.date()),
            "end": str(sym_end.date()),
            "rows": int(len(ordered)),
        }
        if sym_start > start or sym_end < end:
            report["passed"] = False
            report["blockers"].append(
                f"{sym} date coverage incomplete ({sym_start.date()} to {sym_end.date()}) for required {start.date()} to {end.date()}"
            )

    bmk = universe_df[universe_df["symbol"] == benchmark_symbol]
    if bmk.empty:
        report["passed"] = False
        report["blockers"].append("benchmark symbol missing")

    return report
