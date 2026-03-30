from __future__ import annotations

from dataclasses import dataclass
import pandas as pd


@dataclass
class WalkForwardWindow:
    train_start: pd.Timestamp
    train_end: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp


def build_windows(start: str, end: str, train_years: int, test_years: int, step_years: int) -> list[WalkForwardWindow]:
    s = pd.Timestamp(start)
    e = pd.Timestamp(end)
    windows = []
    cur = s
    while True:
        tr_end = cur + pd.DateOffset(years=train_years) - pd.DateOffset(days=1)
        te_start = tr_end + pd.DateOffset(days=1)
        te_end = te_start + pd.DateOffset(years=test_years) - pd.DateOffset(days=1)
        if te_end > e:
            break
        windows.append(WalkForwardWindow(cur, tr_end, te_start, te_end))
        cur = cur + pd.DateOffset(years=step_years)
    return windows
