"""Shared test helper: build a stored-shape cumulative CURVE from daily returns.

WHY this exists (Phase 164.6.6.2.2, CR-01): ``strategy_analytics.returns_series``
is the cumulative wealth curve the analytics worker writes (``(1 + r).cumprod()``
geometric, ``1 + r.cumsum()`` simple), not daily returns. The 164.6.6.2 router
tests fed return-shaped data into that column, so every blend that weighted the
column as returns passed its tests while the defect survived in production. A
fixture that has the stored shape cannot pass on a curve read as returns.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any


def curve_from_returns(
    returns: Sequence[float],
    dates: Sequence[str],
    method: str = "geometric",
) -> list[dict[str, Any]]:
    """``[{date, value}, ...]`` curve for ``returns`` on ``dates``.

    Starts from a level of 1.0 BEFORE ``dates[0]`` and applies ``returns[0]`` on
    ``dates[0]`` (geometric ``level *= 1 + r``; simple ``level += r``), which is
    the shape ``compute_all_metrics`` stores: the first stored value is
    ``1 + r_0``, near 1.0. Reading it back yields ``returns[1:]`` on
    ``dates[1:]`` (day 0 has no stored predecessor).
    """
    if len(returns) != len(dates):
        raise ValueError("returns and dates must have the same length")
    if method not in ("geometric", "simple"):
        raise ValueError(f"unknown curve method {method!r}")
    level = 1.0
    out: list[dict[str, Any]] = []
    for r, d in zip(returns, dates):
        level = level * (1.0 + r) if method == "geometric" else level + r
        out.append({"date": d, "value": level})
    return out
