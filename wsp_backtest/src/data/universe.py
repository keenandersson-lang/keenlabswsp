from __future__ import annotations

import pandas as pd


def build_universe(df: pd.DataFrame, min_dollar_volume: float = 1_000_000) -> pd.DataFrame:
    stats = df.groupby("symbol")["dollar_volume"].median().rename("median_dollar_volume")
    eligible = stats[stats >= min_dollar_volume].index
    return df[df["symbol"].isin(eligible)].copy()
