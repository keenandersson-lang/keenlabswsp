from __future__ import annotations

import pandas as pd
from portfolio.execution import apply_slippage, commission
from portfolio.position_sizing import position_size
from portfolio.stops import initial_stop


def simulate_trades(price_df: pd.DataFrame, signals: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    if signals.empty:
        return pd.DataFrame(columns=["symbol","entry_date","exit_date","entry_price","exit_price","shares","pnl","return","reason"]) 
    trades = []
    for _, s in signals.sort_values("signal_date").iterrows():
        sym_df = price_df[price_df["symbol"] == s["symbol"]].sort_values("date").reset_index(drop=True)
        locs = sym_df.index[sym_df["date"] == pd.Timestamp(s["signal_date"])]
        if len(locs) == 0 or int(locs[0]) + 1 >= len(sym_df):
            continue
        sig_idx = int(locs[0])
        entry_idx = sig_idx + 1
        entry_open = float(sym_df.iloc[entry_idx]["open"])
        entry_price = apply_slippage(entry_open, cfg["execution"]["entry_slippage_bps"], "buy")
        stop = initial_stop(sym_df, entry_idx, cfg["stops"]["fixed_stop_pct"], cfg["stops"]["swing_lookback"], cfg["stops"]["swing_buffer"])
        shares = position_size(cfg["run"]["initial_equity"], cfg["run"]["risk_per_trade"], entry_price, stop)
        if shares <= 0:
            continue
        exit_idx = min(entry_idx + cfg["stops"]["max_holding_bars"], len(sym_df)-1)
        reason = "max_hold"
        exit_price = float(sym_df.iloc[exit_idx]["open"])
        for j in range(entry_idx, min(exit_idx + 1, len(sym_df))):
            r = sym_df.iloc[j]
            if float(r["low"]) <= stop:
                exit_idx = j
                exit_price = stop if float(r["open"]) >= stop else float(r["open"])
                reason = "hard_stop"
                break
        exit_price = apply_slippage(exit_price, cfg["execution"]["exit_slippage_bps"], "sell")
        fees = commission(shares, cfg["execution"]["commission_per_share"], cfg["execution"]["min_commission"]) * 2
        pnl = (exit_price - entry_price) * shares - fees
        trades.append({
            "symbol": s["symbol"],
            "entry_date": sym_df.iloc[entry_idx]["date"],
            "exit_date": sym_df.iloc[exit_idx]["date"],
            "entry_price": entry_price,
            "exit_price": exit_price,
            "stop_price": stop,
            "signal_price": s["signal_close"],
            "shares": shares,
            "pnl": pnl,
            "return": (exit_price / entry_price) - 1,
            "hold_bars": exit_idx - entry_idx,
            "reason": reason,
        })
    return pd.DataFrame(trades)
