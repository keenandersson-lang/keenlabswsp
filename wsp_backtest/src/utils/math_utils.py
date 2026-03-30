from __future__ import annotations

import numpy as np


def safe_div(numerator: float, denominator: float) -> float:
    if denominator == 0:
        return np.nan
    return numerator / denominator
