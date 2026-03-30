from __future__ import annotations

import pandas as pd
from indicators.moving_averages import sma, slope


def regime_labels(close: pd.Series, ma_long: int = 150, slope_lookback: int = 10) -> pd.Series:
    ma = sma(close, ma_long)
    sl = slope(ma, slope_lookback)
    out = pd.Series("sideways", index=close.index)
    out[(close > ma) & (sl > 0)] = "bullish"
    out[(close < ma) & (sl < 0)] = "bearish"
    return out
