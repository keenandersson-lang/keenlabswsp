from __future__ import annotations

import pandas as pd


def pivot_highs(high: pd.Series, left: int = 3, right: int = 3) -> pd.Series:
    out = pd.Series(False, index=high.index)
    for i in range(left, len(high) - right):
        window = high.iloc[i-left:i+right+1]
        out.iloc[i] = high.iloc[i] == window.max() and (window == high.iloc[i]).sum() == 1
    return out


def pivot_lows(low: pd.Series, left: int = 3, right: int = 3) -> pd.Series:
    out = pd.Series(False, index=low.index)
    for i in range(left, len(low) - right):
        window = low.iloc[i-left:i+right+1]
        out.iloc[i] = low.iloc[i] == window.min() and (window == low.iloc[i]).sum() == 1
    return out
