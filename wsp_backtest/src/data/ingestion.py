from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json
import os
import time
import urllib.parse
import urllib.request
from typing import Any, Protocol

import pandas as pd

from data.validators import validate_ohlcv
from utils.io import write_csv

DEFAULT_VALIDATION_UNIVERSE = ["SPY", "XLB", "XLE", "XLF", "XLI", "XLK", "XLP", "XLU", "XLV", "XLY", "XLC", "XLRE"]


class DailyOhlcvProvider(Protocol):
    def fetch_symbol(self, symbol: str, start_date: str, end_date: str, adjusted: bool) -> pd.DataFrame:
        ...


@dataclass
class ProviderConfig:
    name: str
    api_key_env_var: str | None
    endpoint: str | None
    timeout_seconds: int = 30
    retry_count: int = 2
    retry_backoff_seconds: float = 1.0


class EodHdProvider:
    def __init__(self, config: ProviderConfig) -> None:
        self.config = config
        if not self.config.endpoint:
            raise ValueError("EODHD provider requires an endpoint")
        if not self.config.api_key_env_var:
            raise ValueError("EODHD provider requires api_key_env_var")
        api_key = os.getenv(self.config.api_key_env_var)
        if not api_key:
            raise ValueError(f"Missing provider API key in environment variable: {self.config.api_key_env_var}")
        self.api_key = api_key

    def fetch_symbol(self, symbol: str, start_date: str, end_date: str, adjusted: bool) -> pd.DataFrame:
        symbol_code = f"{symbol}.US"
        query = {
            "from": start_date,
            "to": end_date,
            "fmt": "json",
            "period": "d",
            "api_token": self.api_key,
        }
        url = f"{self.config.endpoint.rstrip('/')}/{symbol_code}?{urllib.parse.urlencode(query)}"
        payload = _http_get_json(
            url=url,
            timeout_seconds=self.config.timeout_seconds,
            retry_count=self.config.retry_count,
            retry_backoff_seconds=self.config.retry_backoff_seconds,
        )
        if not isinstance(payload, list):
            raise ValueError(f"Malformed provider payload for {symbol}: expected list, got {type(payload)}")
        return normalize_provider_frame(payload, symbol=symbol, adjusted=adjusted)


class DisabledProvider:
    def fetch_symbol(self, symbol: str, start_date: str, end_date: str, adjusted: bool) -> pd.DataFrame:
        raise RuntimeError(
            "Provider is disabled and no local CSV fallback was available. "
            f"Unable to fetch symbol {symbol} for {start_date}..{end_date}."
        )


class LocalCsvProvider:
    def __init__(self, input_dir: str) -> None:
        self.input_dir = Path(input_dir)

    def fetch_symbol(self, symbol: str, start_date: str, end_date: str, adjusted: bool) -> pd.DataFrame:
        path = self.input_dir / f"{symbol}.csv"
        if not path.exists():
            raise FileNotFoundError(f"Local CSV not found for symbol {symbol}: {path}")
        df = pd.read_csv(path)
        if "symbol" not in df.columns:
            df["symbol"] = symbol
        normalized = normalize_ohlcv_frame(df)
        mask = (normalized["date"] >= pd.Timestamp(start_date)) & (normalized["date"] <= pd.Timestamp(end_date))
        sliced = normalized.loc[mask].copy()
        if sliced.empty:
            raise ValueError(f"Local CSV {path} has no rows inside requested date range {start_date}..{end_date}")
        if adjusted and "adjusted_close" in sliced.columns:
            sliced["close"] = sliced["adjusted_close"]
        return sliced


def _http_get_json(url: str, timeout_seconds: int, retry_count: int, retry_backoff_seconds: float) -> Any:
    attempts = retry_count + 1
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout_seconds) as resp:  # noqa: S310
                status = getattr(resp, "status", 200)
                if status >= 400:
                    raise RuntimeError(f"HTTP {status} for url: {url}")
                data = resp.read()
                return json.loads(data.decode("utf-8"))
        except Exception:
            if attempt >= attempts:
                raise
            time.sleep(retry_backoff_seconds * attempt)
    raise RuntimeError("unreachable")


def normalize_provider_frame(rows: list[dict[str, Any]], symbol: str, adjusted: bool) -> pd.DataFrame:
    if not rows:
        raise ValueError(f"Provider returned no rows for symbol {symbol}")

    df = pd.DataFrame(rows)
    rename_map = {
        "adjustedClose": "adjusted_close",
        "adjClose": "adjusted_close",
        "Adj Close": "adjusted_close",
    }
    use_map = {k: v for k, v in rename_map.items() if k in df.columns}
    if use_map:
        df = df.rename(columns=use_map)

    df["symbol"] = symbol
    normalized = normalize_ohlcv_frame(df)
    if adjusted and "adjusted_close" in normalized.columns:
        normalized["close"] = normalized["adjusted_close"]
    return normalized


def normalize_ohlcv_frame(df: pd.DataFrame) -> pd.DataFrame:
    col_map = {
        "Date": "date",
        "Open": "open",
        "High": "high",
        "Low": "low",
        "Close": "close",
        "Volume": "volume",
        "Symbol": "symbol",
        "Adj Close": "adjusted_close",
        "AdjClose": "adjusted_close",
    }
    use_map = {k: v for k, v in col_map.items() if k in df.columns}
    if use_map:
        df = df.rename(columns=use_map)

    required = ["date", "open", "high", "low", "close", "volume", "symbol"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns after normalization: {missing}")

    out_cols = required + (["adjusted_close"] if "adjusted_close" in df.columns else [])
    out = df[out_cols].copy()
    out["date"] = pd.to_datetime(out["date"], utc=False)
    for c in ["open", "high", "low", "close", "volume"]:
        out[c] = pd.to_numeric(out[c], errors="raise")
    if "adjusted_close" in out.columns:
        out["adjusted_close"] = pd.to_numeric(out["adjusted_close"], errors="coerce")
    out["symbol"] = out["symbol"].astype(str)
    out = out.sort_values(["symbol", "date"]).drop_duplicates(subset=["symbol", "date"], keep="last")
    validate_ohlcv(out)
    return out


def build_provider(data_sources_cfg: dict[str, Any]) -> DailyOhlcvProvider:
    provider_cfg = data_sources_cfg.get("provider", {})
    provider_name = provider_cfg.get("name", "disabled")

    if provider_name == "disabled":
        return DisabledProvider()
    if provider_name == "local_csv":
        input_dir = provider_cfg.get("local_csv_input_dir", "data/input")
        return LocalCsvProvider(input_dir=input_dir)
    if provider_name == "eodhd":
        return EodHdProvider(
            ProviderConfig(
                name="eodhd",
                api_key_env_var=provider_cfg.get("api_key_env_var"),
                endpoint=provider_cfg.get("endpoint", "https://eodhd.com/api/eod"),
                timeout_seconds=int(provider_cfg.get("timeout_seconds", 30)),
                retry_count=int(provider_cfg.get("retry", {}).get("max_attempts", 2)),
                retry_backoff_seconds=float(provider_cfg.get("retry", {}).get("backoff_seconds", 1.0)),
            )
        )

    raise ValueError(f"Unsupported provider name: {provider_name}")


def write_symbol_frame(df: pd.DataFrame, output_path: Path, output_format: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_format == "parquet":
        df.to_parquet(output_path, index=False)
    else:
        write_csv(output_path, df)


def ingest_sector_etf_data(data_sources_cfg: dict[str, Any], refresh_mode: str = "update") -> dict[str, Any]:
    settings = data_sources_cfg.get("ingestion", {})
    universe = settings.get("symbols") or DEFAULT_VALIDATION_UNIVERSE
    benchmark = settings.get("benchmark_symbol", "SPY")
    start_date = settings.get("start_date")
    end_date = settings.get("end_date")
    adjusted = bool(settings.get("adjusted", False))
    output_format = settings.get("output_format", "csv")

    if not start_date or not end_date:
        raise ValueError("Ingestion requires start_date and end_date")

    if benchmark not in universe:
        universe = [benchmark, *[s for s in universe if s != benchmark]]

    paths = data_sources_cfg.get("paths", {})
    benchmark_dir = Path(paths.get("benchmark_dir", "data/benchmark"))
    sectors_dir = Path(paths.get("sectors_dir", "data/sectors"))
    combined_path = Path(paths.get("combined_path", f"data/raw/ohlcv.{output_format}"))

    provider = build_provider(data_sources_cfg)
    fetched: list[str] = []
    failed: dict[str, str] = {}
    written_files: list[str] = []
    frames: list[pd.DataFrame] = []

    for symbol in universe:
        try:
            df = provider.fetch_symbol(symbol=symbol, start_date=start_date, end_date=end_date, adjusted=adjusted)
            target_dir = benchmark_dir if symbol == benchmark else sectors_dir
            ext = "parquet" if output_format == "parquet" else "csv"
            output_path = target_dir / f"{symbol}.{ext}"

            if refresh_mode == "update" and output_path.exists():
                existing = pd.read_parquet(output_path) if output_path.suffix == ".parquet" else pd.read_csv(output_path)
                existing = normalize_ohlcv_frame(existing)
                df = pd.concat([existing, df], ignore_index=True)
                df = df.sort_values(["symbol", "date"]).drop_duplicates(subset=["symbol", "date"], keep="last")

            write_symbol_frame(df, output_path=output_path, output_format=output_format)
            fetched.append(symbol)
            written_files.append(str(output_path.as_posix()))
            frames.append(df)
        except Exception as exc:
            failed[symbol] = str(exc)

    if frames:
        combined = pd.concat(frames, ignore_index=True).sort_values(["symbol", "date"])
        write_symbol_frame(combined, output_path=combined_path, output_format=output_format)
        written_files.append(str(combined_path.as_posix()))

    sectors_requested = [s for s in universe if s != benchmark]
    sectors_loaded = [s for s in fetched if s != benchmark]
    missing_sector_symbols = sorted(set(sectors_requested) - set(sectors_loaded))

    date_coverage: dict[str, dict[str, str | int]] = {}
    for df in frames:
        symbol = str(df["symbol"].iloc[0])
        date_coverage[symbol] = {
            "start": str(pd.Timestamp(df["date"].min()).date()),
            "end": str(pd.Timestamp(df["date"].max()).date()),
            "rows": int(len(df)),
        }

    return {
        "provider": data_sources_cfg.get("provider", {}).get("name", "disabled"),
        "symbols_requested": universe,
        "symbols_fetched": fetched,
        "symbols_failed": failed,
        "missing_sector_symbols": missing_sector_symbols,
        "written_files": written_files,
        "date_coverage": date_coverage,
        "adjusted": adjusted,
        "refresh_mode": refresh_mode,
        "output_format": output_format,
        "validation_ready": len(fetched) > 0 and benchmark in fetched and len(missing_sector_symbols) == 0 and len(failed) == 0,
    }
