from __future__ import annotations

import pandas as pd

from indicators.moving_averages import sma, slope
from indicators.mansfield import mansfield, mansfield_pass
from indicators.pivots import pivot_highs
from indicators.resistance import detect_resistance_zone
from indicators.volume import volume_multiple
from signals.wsp_rules import clean_breakout_pass, breakout_pass


def _fresh_breakout(df: pd.DataFrame, idx: int, zone_high: float, bars: int, buffer: float) -> bool:
    start = max(0, idx - bars + 1)
    recent = df.iloc[start : idx + 1]
    threshold = zone_high * (1 + buffer)
    return bool((recent["close"] > threshold).any())


def generate_signals(symbol_df: pd.DataFrame, benchmark_df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    df = symbol_df.sort_values("date").reset_index(drop=True).copy()
    bmk = benchmark_df.sort_values("date").reset_index(drop=True)
    merged = df.merge(bmk[["date", "close"]].rename(columns={"close": "benchmark_close"}), on="date", how="left")

    df["ma50"] = sma(merged["close"], cfg["stock_ma"]["ma_short"])
    df["ma150"] = sma(merged["close"], cfg["stock_ma"]["ma_long"])
    df["ma50_slope"] = slope(df["ma50"], cfg["stock_ma"]["slope_lookback"])
    df["mansfield"] = mansfield(merged["close"], merged["benchmark_close"], cfg["mansfield"]["lookback"])
    df["mansfield_ok"] = mansfield_pass(df["mansfield"], cfg["mansfield"]["mode"], cfg["mansfield"]["cross_window"])
    df["vol_mult"] = volume_multiple(df["volume"], cfg["volume"]["lookback"])
    piv = pivot_highs(df["high"], cfg["resistance"]["pivot_left"], cfg["resistance"]["pivot_right"])

    filters = cfg.get("filters", {})
    rows = []
    for i in range(len(df)):
        sub = df.iloc[: i + 1]
        confirmed_piv = piv.iloc[: i + 1].copy()
        right = int(cfg["resistance"].get("pivot_right", 3))
        if right > 0:
            confirmed_piv.iloc[max(0, len(confirmed_piv) - right) :] = False
        zone = detect_resistance_zone(
            sub,
            confirmed_piv,
            cfg["resistance"]["lookback_window"],
            cfg["resistance"]["tolerance"],
            cfg["resistance"]["min_touches"],
        )
        if zone is None:
            continue
        row = df.iloc[i]

        ma_ok = bool(row["close"] > row["ma50"] and row["close"] > row["ma150"] and row["ma50_slope"] > 0)
        if not filters.get("stock_ma_enabled", True):
            ma_ok = True

        bo_ok = breakout_pass(float(row["close"]), zone.zone_high, cfg["resistance"]["breakout_buffer"])
        clean_ok = clean_breakout_pass(row, cfg["clean_breakout"]["min_body_ratio"], cfg["clean_breakout"]["max_upper_wick_ratio"])
        if not filters.get("clean_breakout_enabled", True):
            clean_ok = True

        vol_ok = bool(row["vol_mult"] >= cfg["volume"]["min_multiplier"])
        if not filters.get("volume_enabled", True):
            vol_ok = True

        mansfield_ok = bool(row["mansfield_ok"])
        if not filters.get("mansfield_enabled", True):
            mansfield_ok = True

        freshness_ok = _fresh_breakout(df, i, zone.zone_high, int(cfg["resistance"].get("breakout_freshness_bars", 3)), float(cfg["resistance"]["breakout_buffer"]))
        if not filters.get("breakout_freshness_enabled", True):
            freshness_ok = True

        if ma_ok and bo_ok and mansfield_ok and clean_ok and vol_ok and freshness_ok:
            rows.append(
                {
                    "symbol": row["symbol"],
                    "signal_date": row["date"],
                    "signal_close": row["close"],
                    "breakout_level": zone.zone_high,
                    "volume_multiple": row["vol_mult"],
                    "mansfield": row["mansfield"],
                    "zone_low": zone.zone_low,
                    "zone_high": zone.zone_high,
                    "touch_count": zone.touch_count,
                }
            )
    return pd.DataFrame(rows)
