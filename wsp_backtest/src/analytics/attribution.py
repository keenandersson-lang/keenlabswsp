from __future__ import annotations

import pandas as pd


def segment_by_regime(trades: pd.DataFrame) -> pd.DataFrame:
    if trades.empty or "regime" not in trades:
        return pd.DataFrame()
    return trades.groupby("regime")["pnl"].agg(["count", "mean", "sum"]).reset_index()
