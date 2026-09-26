"""Shared constant-yield fixtures for the dispersion-floor tests (Phase 166.1 D-03).

Moved from ``tests/test_metrics.py`` (Phase 166 review round 2), where they were
``_q166r2_nav_constant_yield``, ``_q166r2_apy`` and ``_Q166R2_CONSTANT_YIELDS``.
``test_metrics.py`` imports them back under those names, so its test bodies and
``parametrize`` decorators are unchanged. A test module imports from HERE, never
from another test module.
"""

import numpy as np
import pandas as pd


def nav_constant_yield(
    daily_yield: float, n: int = 366, start: float = 10_000.0, cents: bool = False
) -> pd.Series:
    """Returns taken the way the platform takes them: ``pct_change`` over an
    exactly compounding NAV. Each return is ``E_t / E_{t-1} - 1``, so its
    rounding residue is about 1e-16 ABSOLUTE, whatever the yield (CR-01). With
    ``cents=True`` the NAV is rounded to cents first, which is real
    quantisation dispersion, not residue."""
    nav = start * (1.0 + daily_yield) ** np.arange(n + 1)
    if cents:
        nav = np.round(nav, 2)
    idx = pd.date_range("2024-01-01", periods=n + 1, freq="D")
    return pd.Series(nav, index=idx).pct_change().dropna().rename("returns")


def apy(apy: float) -> float:
    return (1.0 + apy) ** (1.0 / 365.0) - 1.0


#: id -> daily yield. The daily ids are the review's table; the APY ids span
#: SFH R2-HIGH-1's 0.01% .. 100% sweep.
CONSTANT_YIELDS: dict[str, float] = {
    "daily_1e-5": 1e-5,
    "daily_1e-4": 1e-4,
    "daily_1e-3": 1e-3,
    "apy_0.01pct": apy(0.0001),
    "apy_0.1pct": apy(0.001),
    "apy_1pct": apy(0.01),
    "apy_3pct": apy(0.03),
    "apy_5pct": apy(0.05),
    "apy_10pct": apy(0.10),
    "apy_50pct": apy(0.50),
    "apy_100pct": apy(1.00),
}
