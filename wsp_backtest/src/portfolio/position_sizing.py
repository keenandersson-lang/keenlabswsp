from __future__ import annotations

import math


def position_size(equity: float, risk_pct: float, entry_price: float, stop_price: float, max_position_value: float | None = None) -> int:
    risk_per_share = entry_price - stop_price
    if risk_per_share <= 0:
        return 0
    shares = math.floor((equity * risk_pct) / risk_per_share)
    if max_position_value is not None and shares * entry_price > max_position_value:
        shares = math.floor(max_position_value / entry_price)
    return max(shares, 0)
