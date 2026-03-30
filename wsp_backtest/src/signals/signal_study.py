from __future__ import annotations

import pandas as pd


def compute_forward_returns(df: pd.DataFrame, signals: pd.DataFrame, windows: list[int]) -> pd.DataFrame:
    if signals.empty:
        return pd.DataFrame()
    px = df.sort_values(["symbol", "date"]).copy()
    out = signals.copy()
    for w in windows:
        out[f"fwd_{w}"] = None
    for i, row in out.iterrows():
        sym = row["symbol"]
        d = pd.Timestamp(row["signal_date"])
        sdf = px[px["symbol"] == sym].reset_index(drop=True)
        locs = sdf.index[sdf["date"] == d]
        if len(locs) == 0:
            continue
        loc = int(locs[0])
        for w in windows:
            if loc + w < len(sdf):
                out.loc[i, f"fwd_{w}"] = sdf.loc[loc + w, "close"] / sdf.loc[loc, "close"] - 1
    return out
