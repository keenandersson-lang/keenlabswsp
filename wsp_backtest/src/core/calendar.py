from __future__ import annotations

import pandas as pd


def next_trading_day(series: pd.Series, current_idx: int) -> pd.Timestamp | None:
    nxt = current_idx + 1
    if nxt >= len(series):
        return None
    return pd.Timestamp(series.iloc[nxt])
