from __future__ import annotations

import numpy as np
import pandas as pd


def compute_trade_metrics(trades: pd.DataFrame, equity_curve: pd.DataFrame, initial_equity: float) -> dict:
    if trades.empty:
        return {"totalTrades": 0}
    wins = trades[trades["pnl"] > 0]
    losses = trades[trades["pnl"] <= 0]
    gross_profit = float(wins["pnl"].sum())
    gross_loss = float(losses["pnl"].sum())
    pf = gross_profit / abs(gross_loss) if gross_loss != 0 else np.inf
    expectancy = float(trades["pnl"].mean())
    total_return = (equity_curve["equity"].iloc[-1] / initial_equity) - 1
    dd = (equity_curve["equity"] / equity_curve["equity"].cummax() - 1).min()
    return {
        "totalTrades": int(len(trades)),
        "winRate": float(len(wins) / len(trades)),
        "averageWin": float(wins["pnl"].mean()) if len(wins) else 0.0,
        "averageLoss": float(losses["pnl"].mean()) if len(losses) else 0.0,
        "payoffRatio": float((wins["pnl"].mean() / abs(losses["pnl"].mean())) if len(wins) and len(losses) and losses["pnl"].mean()!=0 else 0),
        "expectancy": expectancy,
        "grossProfit": gross_profit,
        "grossLoss": gross_loss,
        "profitFactor": float(pf),
        "cagr": float(total_return),
        "annualReturn": float(total_return),
        "annualizedVolatility": float(trades["return"].std(ddof=0) * np.sqrt(252)) if len(trades)>1 else 0.0,
        "sharpe": float((trades["return"].mean() / (trades["return"].std(ddof=0)+1e-12)) * np.sqrt(252)) if len(trades)>1 else 0.0,
        "sortino": float((trades["return"].mean() / (trades[trades['return']<0]['return'].std(ddof=0)+1e-12)) * np.sqrt(252)) if len(trades)>1 else 0.0,
        "maxDrawdown": float(dd),
        "exposure": float(min(1.0, trades["hold_bars"].sum() / max(1, len(trades) * 40))),
        "averageHoldTime": float(trades["hold_bars"].mean()),
        "medianHoldTime": float(trades["hold_bars"].median()),
    }
