"""Shared test helper: a daily-returns Series in the shape production hands the matcher.

WHY this exists (167.1.1.1 round 2, CR-01): every series the matcher joins in production
(a strategy's, a candidate's, and since the fix a holding's) is built by
``services.wealth_returns.records_to_series``, a tz-naive ``DatetimeIndex``. The phase's
own tests built candidates with plain "YYYY-MM-DD" string indexes, which joined cleanly
with the string-indexed holding series of the same tests, so none of them could see that
the holding series never matched a real candidate. A fixture built through the same
converter cannot pass on a string-indexed series.
"""

from __future__ import annotations

from collections.abc import Sequence

import pandas as pd

from services.wealth_returns import records_to_series


def production_series(days: Sequence[str], values: Sequence[float], name: str = "") -> pd.Series:
    """``values`` on the ISO ``days``, through the converter production uses."""
    if len(days) != len(values):
        raise ValueError("days and values must have the same length")
    series = records_to_series(
        [{"date": day, "value": value} for day, value in zip(days, values)], name
    )
    assert series is not None, "a fixture series must hold at least one finite value"
    return series
