from __future__ import annotations

import pandas as pd


def preprocess(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out = out.sort_values(["symbol", "date"]).reset_index(drop=True)
    out["dollar_volume"] = out["close"] * out["volume"]
    return out
