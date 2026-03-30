from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


Regime = Literal["bullish", "bearish", "sideways"]


@dataclass
class ResistanceZone:
    zone_low: float
    zone_high: float
    touch_count: int
    first_touch_date: str
    last_touch_date: str


@dataclass
class Signal:
    symbol: str
    signal_date: str
    breakout_level: float
    signal_close: float
    volume_multiple: float
    mansfield: float
    regime_ok: bool


@dataclass
class Trade:
    symbol: str
    entry_date: str
    entry_price: float
    stop_price: float
    shares: int
    signal_price: float
    exit_date: str | None = None
    exit_price: float | None = None
    reason: str | None = None
