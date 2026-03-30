from __future__ import annotations


def apply_slippage(price: float, bps: float, side: str) -> float:
    mult = 1 + (bps / 10000.0)
    if side == "sell":
        mult = 1 - (bps / 10000.0)
    return price * mult


def commission(shares: int, per_share: float, minimum: float) -> float:
    return max(shares * per_share, minimum)
