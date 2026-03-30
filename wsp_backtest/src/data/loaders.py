from __future__ import annotations

from pathlib import Path
import pandas as pd

from utils.io import read_table
from utils.dates import ensure_datetime_index
from data.validators import validate_ohlcv


def load_ohlcv(path: str, fmt: str = "combined_csv") -> pd.DataFrame:
    p = Path(path)
    if fmt == "per_symbol":
        frames = []
        for file in sorted(p.glob("*.csv")) + sorted(p.glob("*.parquet")):
            frames.append(read_table(file))
        df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    else:
        df = read_table(p)
    df = ensure_datetime_index(df, "date")
    validate_ohlcv(df)
    return df


def load_sector_map(path: str) -> pd.DataFrame:
    df = read_table(Path(path))
    if not {"symbol", "sector_symbol"}.issubset(df.columns):
        raise ValueError("Sector map must include symbol and sector_symbol")
    return df.drop_duplicates(subset=["symbol"])
