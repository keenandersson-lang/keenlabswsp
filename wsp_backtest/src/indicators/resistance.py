from __future__ import annotations

import pandas as pd

from core.types import ResistanceZone


def detect_resistance_zone(df: pd.DataFrame, pivot_mask: pd.Series, lookback_window: int, tolerance: float, min_touches: int) -> ResistanceZone | None:
    piv = df.loc[pivot_mask, ["date", "high"]].tail(lookback_window)
    if len(piv) < min_touches:
        return None
    piv = piv.sort_values("high")
    highs = piv["high"].to_numpy()
    best = None
    for i, h in enumerate(highs):
        lo = h * (1 - tolerance)
        hi = h * (1 + tolerance)
        cluster = piv[(piv["high"] >= lo) & (piv["high"] <= hi)]
        if len(cluster) >= min_touches:
            zone_low = float(cluster["high"].min())
            zone_high = float(cluster["high"].max())
            candidate = ResistanceZone(zone_low, zone_high, int(len(cluster)), str(cluster["date"].min().date()), str(cluster["date"].max().date()))
            if best is None or candidate.touch_count > best.touch_count:
                best = candidate
    return best
