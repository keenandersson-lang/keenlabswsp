from __future__ import annotations

import pandas as pd
from indicators.moving_averages import sma


def mansfield(stock_close: pd.Series, benchmark_close: pd.Series, lookback: int = 200) -> pd.Series:
    rel = stock_close / benchmark_close
    return rel / sma(rel, lookback) - 1.0


def mansfield_pass(ms: pd.Series, mode: str = "positive_or_recent_cross", cross_window: int = 10) -> pd.Series:
    positive = ms > 0
    crossed = (ms > 0) & (ms.shift(1) <= 0)
    recent_cross = crossed.rolling(cross_window, min_periods=1).max().fillna(0).astype(bool)
    if mode == "positive_only":
        return positive
    return positive | recent_cross
