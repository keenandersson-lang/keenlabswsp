from __future__ import annotations

import pandas as pd


def build_equity_curve(trades: pd.DataFrame, initial_equity: float) -> pd.DataFrame:
    if trades.empty:
        return pd.DataFrame([{"date": pd.Timestamp.today().normalize(), "equity": initial_equity}])
    t = trades.sort_values("exit_date").copy()
    equity = initial_equity
    rows = []
    for _, row in t.iterrows():
        equity += float(row["pnl"])
        rows.append({"date": row["exit_date"], "equity": equity})
    return pd.DataFrame(rows)
