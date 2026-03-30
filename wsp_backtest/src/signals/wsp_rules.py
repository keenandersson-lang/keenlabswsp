from __future__ import annotations

import pandas as pd


def clean_breakout_pass(row: pd.Series, min_body_ratio: float, max_upper_wick_ratio: float) -> bool:
    rng = row["high"] - row["low"]
    if rng <= 0:
        return False
    body = abs(row["close"] - row["open"])
    upper_wick = row["high"] - max(row["open"], row["close"])
    return body / rng >= min_body_ratio and upper_wick / rng <= max_upper_wick_ratio


def breakout_pass(close: float, breakout_level: float, buffer: float) -> bool:
    return close > breakout_level * (1 + buffer)
