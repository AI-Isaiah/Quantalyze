"""``derive_basis_series(..., covered_days=...)`` (Phase 167.2.1.1.1 NAVMTM, plan 03, research OQ-8).

After a key's marks start (D-05, revised 2026-10-26) a day with no stored mark has no row,
and the next mark's single return spans it. Those absences are not data gaps to refuse and
not flat days to fill: the series derive must neither list them in ``gap_spans`` nor invent
a 0.0 return for them in the scalar input. D-15 (founder, 2026-10-26: "Yes, one
observation") decides that the spanning return then counts once in volatility, Sharpe and
drawdown. Without ``covered_days`` every output is byte-identical to before. All values are
synthetic.
"""
from __future__ import annotations

from typing import Any

import pandas as pd
import pytest

import services.basis_series as bs
from services.basis_series import derive_basis_series

_KW: dict[str, Any] = {
    "periods_per_year": 365,
    "cumulative_method": "geometric",
    "day_basis": "calendar",
}

_DAYS = [
    "2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05",
    "2026-03-06", "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12",
]
_VALUES = [0.004, -0.002, 0.006, -0.001, 0.003, 0.012, 0.008, -0.004, 0.002, 0.005]


def _series(drop: tuple[str, ...] = ()) -> pd.Series:
    """03-07 and 03-08 are absent by construction (the days a mark's return covers)."""
    pairs = [(d, v) for d, v in zip(_DAYS, _VALUES) if d not in drop]
    index = pd.DatetimeIndex([d for d, _ in pairs]).as_unit("us")
    return pd.Series([v for _, v in pairs], index=index, dtype="float64")


@pytest.mark.parametrize("policy", [None, "sparse", "broker_nan", "zero_fill"])
def test_covered_days_absent_is_byte_identical(policy: str | None) -> None:
    """Every existing caller omits the keyword. Omitting it, or passing None, must change
    nothing: the same gap spans, the same conventions keys, no ``covered_day_count``."""
    plain = derive_basis_series(_series(), None, densify_policy=policy, **_KW)
    explicit = derive_basis_series(
        _series(), None, densify_policy=policy, covered_days=None, **_KW
    )

    expected_conventions: dict[str, Any] = dict(_KW)
    if policy is not None:
        expected_conventions["densify"] = policy
    for result in (plain, explicit):
        assert result.gap_spans == [{"start": "2026-03-07", "end": "2026-03-08"}]
        assert result.conventions == expected_conventions
        assert "covered_day_count" not in result.conventions
    assert plain.series_rows == explicit.series_rows
    assert plain.metrics_json == explicit.metrics_json


def test_covered_absences_are_not_gap_spans() -> None:
    """A day a stored mark's return covers is not a hole in the coverage mask: listing it
    would make the reader draw a missing-segment annotation for a day that is, by design,
    inside the next return. A day NOT covered is still a real gap."""
    covered = ["2026-03-07", "2026-03-08"]

    result = derive_basis_series(
        _series(), None, densify_policy="broker_nan", covered_days=covered, **_KW
    )
    assert result.gap_spans == []
    assert result.conventions["densify"] == "broker_nan"
    assert result.conventions["covered_day_count"] == 2

    with_hole = derive_basis_series(
        _series(drop=("2026-03-03",)),
        None,
        densify_policy="broker_nan",
        covered_days=covered,
        **_KW,
    )
    assert with_hole.gap_spans == [{"start": "2026-03-03", "end": "2026-03-03"}]


def _capture_scalar_input(monkeypatch: pytest.MonkeyPatch) -> list[pd.Series]:
    seen: list[pd.Series] = []
    real = bs.compute_all_metrics

    def spy(returns: pd.Series, *args: Any, **kwargs: Any) -> Any:
        seen.append(returns)
        return real(returns, *args, **kwargs)

    monkeypatch.setattr(bs, "compute_all_metrics", spy)
    return seen


def test_covered_absences_are_not_zero_filled_in_the_default_scalar_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The default scalar input re-densifies the rows with 0.0. A covered day must not be
    filled: a flat day would count as an observation of its own (D-15 says the spanning
    return is ONE observation). An uncovered absence is still filled, as before."""
    seen = _capture_scalar_input(monkeypatch)

    derive_basis_series(
        _series(drop=("2026-03-03",)), None, covered_days=["2026-03-07", "2026-03-08"], **_KW
    )
    scalar_input = seen[-1]
    assert pd.Timestamp("2026-03-07") not in scalar_input.index
    assert pd.Timestamp("2026-03-08") not in scalar_input.index
    assert scalar_input[pd.Timestamp("2026-03-03")] == 0.0
    assert pd.Timestamp("2026-03-09") in scalar_input.index

    derive_basis_series(_series(drop=("2026-03-03",)), None, **_KW)
    legacy = seen[-1]
    assert legacy[pd.Timestamp("2026-03-07")] == 0.0
    assert legacy[pd.Timestamp("2026-03-08")] == 0.0


def test_a_caller_supplied_scalar_input_is_used_verbatim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The caller that passes ``scalar_returns`` has already conditioned it; covered days
    must not edit it behind that caller's back."""
    seen = _capture_scalar_input(monkeypatch)
    supplied = _series()

    derive_basis_series(
        _series(), None, scalar_returns=supplied, covered_days=["2026-03-07", "2026-03-08"], **_KW
    )

    assert seen[-1] is supplied


@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(["2026-3-6"], id="short-month-and-day"),
        pytest.param(["not-a-date"], id="not-a-date"),
        pytest.param(["2026-02-30"], id="not-a-calendar-date"),
        pytest.param(["20260307"], id="compact-form"),
        pytest.param([20260307], id="not-a-string"),
        pytest.param(["2026-03-06"], id="a-covered-day-that-has-a-row"),
    ],
)
def test_malformed_covered_days_are_refused(bad: list[Any]) -> None:
    """A covered day is a promise that a stored mark's return spans it. A day with a row of
    its own, or one that is not a real ISO date, breaks that promise and is refused with
    static text that never echoes the value."""
    with pytest.raises(ValueError, match="covered_days") as excinfo:
        derive_basis_series(_series(), None, covered_days=bad, **_KW)

    assert str(bad[0]) not in str(excinfo.value)
