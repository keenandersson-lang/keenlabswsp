from __future__ import annotations

from pathlib import Path
import matplotlib.pyplot as plt
import pandas as pd


def plot_equity(equity: pd.DataFrame, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.figure(figsize=(8,4))
    plt.plot(pd.to_datetime(equity["date"]), equity["equity"])
    plt.title("Equity Curve")
    plt.tight_layout()
    plt.savefig(out_path)
    plt.close()
