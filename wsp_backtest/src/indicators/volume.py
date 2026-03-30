from __future__ import annotations

import pandas as pd


def volume_multiple(volume: pd.Series, lookback: int = 5) -> pd.Series:
    avg = volume.shift(1).rolling(lookback, min_periods=lookback).mean()
    return volume / avg
