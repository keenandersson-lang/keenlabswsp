from __future__ import annotations

import pandas as pd


def sma(series: pd.Series, length: int) -> pd.Series:
    return series.rolling(length, min_periods=length).mean()


def slope(series: pd.Series, lookback: int) -> pd.Series:
    return series - series.shift(lookback)
