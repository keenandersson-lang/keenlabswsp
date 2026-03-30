from __future__ import annotations

import pandas as pd


def summarize_forward_returns(study: pd.DataFrame) -> pd.DataFrame:
    if study.empty:
        return pd.DataFrame()
    cols = [c for c in study.columns if c.startswith("fwd_")]
    return study[cols].astype(float).describe().T.reset_index().rename(columns={"index":"window"})
