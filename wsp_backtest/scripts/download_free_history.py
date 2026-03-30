#!/usr/bin/env python3
from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd
import yfinance as yf

SYMBOLS = [
    "SPY",
    "XLB",
    "XLE",
    "XLF",
    "XLI",
    "XLK",
    "XLP",
    "XLU",
    "XLV",
    "XLY",
    "XLC",
    "XLRE",
]
START_DATE = "2020-01-01"


def download_symbol(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    df = yf.download(
        tickers=symbol,
        start=start_date,
        end=end_date,
        interval="1d",
        auto_adjust=False,
        progress=False,
    )

    if df.empty:
        raise ValueError(f"No data returned for symbol {symbol}")

    df = df.reset_index()

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]

    column_map = {
        "Date": "date",
        "Open": "open",
        "High": "high",
        "Low": "low",
        "Close": "close",
        "Volume": "volume",
        "Adj Close": "adjusted_close",
    }
    df = df.rename(columns=column_map)

    needed = ["date", "open", "high", "low", "close", "volume", "adjusted_close"]
    missing = [c for c in needed if c not in df.columns]
    if missing:
        raise ValueError(f"Missing expected columns for {symbol}: {missing}")

    out = df[needed].copy()
    out["date"] = pd.to_datetime(out["date"]).dt.strftime("%Y-%m-%d")
    out = out.sort_values("date")
    return out


def main() -> None:
    project_root = Path(__file__).resolve().parents[1]
    output_dir = project_root / "data" / "raw"
    output_dir.mkdir(parents=True, exist_ok=True)

    end_date_exclusive = (date.today() + pd.Timedelta(days=1)).isoformat()

    print("Local CSV provider filename format: <SYMBOL>.csv (example: SPY.csv)")
    print(
        "Local CSV provider normalized required schema: "
        "date, open, high, low, close, volume, symbol (optional: adjusted_close)"
    )
    print("Writing files with columns: date, open, high, low, close, volume, adjusted_close")

    for symbol in SYMBOLS:
        out_df = download_symbol(symbol=symbol, start_date=START_DATE, end_date=end_date_exclusive)
        out_path = output_dir / f"{symbol}.csv"
        out_df.to_csv(out_path, index=False)
        print(f"Wrote {out_path} ({len(out_df)} rows)")


if __name__ == "__main__":
    main()
