from __future__ import annotations

import pandas as pd
from indicators.pivots import pivot_lows


def initial_stop(df: pd.DataFrame, idx: int, fixed_stop_pct: float, swing_lookback: int, swing_buffer: float) -> float:
    sub = df.iloc[max(0, idx - swing_lookback):idx + 1].copy().reset_index(drop=True)
    piv = pivot_lows(sub["low"], 2, 2)
    lows = sub.loc[piv, "low"]
    entry = float(df.iloc[idx]["open"])
    below = lows[lows < entry]
    if not below.empty:
        return float(below.iloc[-1] * (1 - swing_buffer))
    return float(entry * (1 - fixed_stop_pct))
