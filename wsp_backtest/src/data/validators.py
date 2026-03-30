from __future__ import annotations

import pandas as pd


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
    if (df[["open", "high", "low", "close"]] <= 0).any().any():
        raise ValueError("Non-positive prices found")
