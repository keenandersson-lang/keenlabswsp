from __future__ import annotations

from itertools import product
import copy
import pandas as pd


def _set_nested(d: dict, key: str, value):
    parts = key.split('.')
    cur = d
    for p in parts[:-1]:
        cur = cur[p]
    cur[parts[-1]] = value


def iter_grid(base_cfg: dict, grid: dict) -> list[dict]:
    keys = list(grid.keys())
    combos = []
    for values in product(*(grid[k] for k in keys)):
        cfg = copy.deepcopy(base_cfg)
        label_parts = []
        for k, v in zip(keys, values):
            _set_nested(cfg, k, v)
            label_parts.append(f"{k}={v}")
        combos.append({"label": "|".join(label_parts), "config": cfg})
    return combos


def top_results(df: pd.DataFrame, n: int = 20) -> pd.DataFrame:
    if df.empty:
        return df
    return df.sort_values(["sharpe", "cagr", "profitFactor"], ascending=False).head(n)
