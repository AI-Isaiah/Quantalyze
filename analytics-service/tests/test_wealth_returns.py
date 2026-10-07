"""Phase 164.6.6.2.2 (D-01, D-02): a stored ``strategy_analytics`` row read as
DAILY RETURNS, proven on ONE oracle shared with the TypeScript resolver.

WHY these tests exist: ``returns_series`` is the cumulative wealth CURVE, not
returns (CR-01). Every Python blend that weighted it as returns used a level
(about 1.0x) where a daily return (about 0.00x) belongs. The cases live in
``fixtures/wealth_to_returns_oracle.json``, which the TypeScript test reads too;
every ``expected`` there is a HAND-COMPUTED literal, so neither runtime can pass
by agreeing with its own arithmetic. This file READS the fixture; it never
copies a value out of it.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from services.wealth_returns import (
    daily_returns_from_row,
    equity_from_daily_returns,
)

_FIXTURE = Path(__file__).parent / "fixtures" / "wealth_to_returns_oracle.json"
_ORACLE: dict[str, Any] = json.loads(_FIXTURE.read_text(encoding="utf-8"))
_CASES: list[dict[str, Any]] = _ORACLE["cases"]
_TOL: float = _ORACLE["tolerance"]


def _row(case: dict[str, Any]) -> dict[str, Any]:
    return {
        "daily_returns": case["daily_returns"],
        "returns_series": case["curve"],
        "data_quality_flags": case["data_quality_flags"],
    }


def _pairs(series: pd.Series | None) -> list[tuple[str, float]]:
    if series is None:
        return []
    return [(pd.Timestamp(d).strftime("%Y-%m-%d"), float(v)) for d, v in series.items()]


def test_fixture_is_a_real_oracle() -> None:
    assert _TOL <= 1e-12
    assert _CASES
    for c in _CASES:
        assert len(c["arithmetic"]) > 10, c["name"]


@pytest.mark.parametrize("case", _CASES, ids=[c["name"] for c in _CASES])
def test_python_reads_the_oracle(case: dict[str, Any]) -> None:
    result = daily_returns_from_row(_row(case), name=case["name"])
    got = _pairs(result)
    want = [(e["date"], float(e["value"])) for e in case["expected"]]
    assert [d for d, _ in got] == [d for d, _ in want], case["name"]
    for (d, g), (_, w) in zip(got, want):
        assert math.isclose(g, w, abs_tol=_TOL, rel_tol=0), (case["name"], d, g, w)


def test_headline_geometric_day_one_is_a_ratio_not_the_level() -> None:
    """By literal, so a variant cannot hide behind the fixture it reads: a curve
    1.0 -> 1.1 is a +10% DAY, and the level 1.1 must never be the return."""
    row = {
        "returns_series": [
            {"date": "2026-03-02", "value": 1.0},
            {"date": "2026-03-03", "value": 1.1},
        ]
    }
    result = daily_returns_from_row(row, name="s")
    assert result is not None
    assert len(result) == 1
    assert result.iloc[0] == pytest.approx(0.1, abs=1e-12)
    assert result.iloc[0] != pytest.approx(1.1, abs=1e-3)


def test_equity_from_daily_returns_endpoint_ratio_is_the_compounded_return() -> None:
    """The TWR scaffold plan 04 feeds to ``total_return_from_equity``: the base
    point keeps day 1 in the window, so the endpoint ratio is prod(1 + r) - 1."""
    from services.metrics import total_return_from_equity

    returns = pd.Series(
        [0.10, -0.10, 0.05],
        index=pd.DatetimeIndex(["2026-03-03", "2026-03-04", "2026-03-05"]),
        name="s",
    )
    equity = equity_from_daily_returns(returns)
    # 1.0 base on the day before the first return, then 1.1, 0.99, 1.0395.
    assert [d.strftime("%Y-%m-%d") for d in equity.index][0] == "2026-03-02"
    assert list(equity.to_numpy()) == pytest.approx([1.0, 1.1, 0.99, 1.0395], abs=1e-12)
    # 1.1 * 0.9 * 1.05 - 1 = 0.0395, written by hand.
    assert total_return_from_equity(equity) == pytest.approx(0.0395, abs=1e-12)
