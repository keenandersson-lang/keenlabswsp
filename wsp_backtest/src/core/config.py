from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


class RunConfig(BaseModel):
    run_id: str
    strategy_version: str
    start_date: str
    end_date: str
    initial_equity: float
    risk_per_trade: float
    max_positions: int = 10
    max_portfolio_risk: float = 0.02
    benchmark_symbol: str = "SPY"
    universe_name: str = "US Equities"


class RootConfig(BaseModel):
    run: RunConfig
    data: dict[str, Any]
    filters: dict[str, Any]
    market_regime: dict[str, Any]
    sector_regime: dict[str, Any]
    stock_ma: dict[str, Any]
    mansfield: dict[str, Any]
    resistance: dict[str, Any]
    clean_breakout: dict[str, Any]
    volume: dict[str, Any]
    execution: dict[str, Any]
    stops: dict[str, Any]
    analytics: dict[str, Any]


def load_config(path: str | Path) -> RootConfig:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    return RootConfig.model_validate(data)
