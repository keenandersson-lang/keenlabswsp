from __future__ import annotations

import pandas as pd


def ensure_datetime_index(df: pd.DataFrame, column: str = "date") -> pd.DataFrame:
    out = df.copy()
    out[column] = pd.to_datetime(out[column], utc=False)
    return out.sort_values(column).reset_index(drop=True)
