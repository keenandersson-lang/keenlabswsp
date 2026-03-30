from __future__ import annotations

from pathlib import Path


def build_markdown_report(path: Path, run_meta: dict, metrics: dict) -> None:
    lines = [
        "# WSP Backtest Report",
        "",
        f"- Run ID: {run_meta.get('run_id')}",
        f"- Strategy Version: {run_meta.get('strategy_version')}",
        f"- Date Range: {run_meta.get('start_date')} to {run_meta.get('end_date')}",
        "",
        "## Summary Metrics",
    ]
    for k, v in metrics.items():
        lines.append(f"- {k}: {v}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
