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
import logging
import math
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from services.native_to_usd import convert_native_returns_to_usd
from services.transforms import cap_data_points
from services.wealth_returns import (
    STORED_CURVE_MAX_POINTS,
    curve_method_from_flags,
    curve_to_daily_returns,
    daily_returns_from_row,
    equity_from_daily_returns,
    records_to_series,
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
    names = {c["name"] for c in _CASES}
    assert {
        "geometric_ratio",
        "simple_difference",
        "nonpositive_level_mid_series",
        "nonpositive_level_is_legal_on_simple",
        "daily_returns_first_wins",
        "unsorted_input_is_sorted",
        "unknown_method_string_reads_geometric",
        "native_leg_loses_only_day_zero",
        "native_absent_day_is_priced_over_its_own_day",
        "four_day_stored_curve_reads_n_returns_geometric",
        "four_day_stored_curve_reads_n_returns_simple",
        "geometric_nonpositive_first_level_day_zero_is_absent",
        "simple_negative_first_level_is_a_legal_day_zero",
        "one_point_series_is_its_day_zero",
        "dropped_head_reads_with_the_old_pairing",
    } <= names


@pytest.mark.parametrize("case", _CASES, ids=[c["name"] for c in _CASES])
def test_python_reads_the_oracle(case: dict[str, Any]) -> None:
    # WR-02: a native leg is read with keep_absent=True, exactly as every router
    # that hands the series to the converter next does, so an absent day stays a
    # placeholder and the next day is priced over its own interval.
    result = daily_returns_from_row(
        _row(case), name=case["name"], keep_absent="native_unit" in case
    )
    if "native_unit" in case:
        # Pitfall 7 parity: the boundary, THEN the BTC conversion, which drops its
        # own first day too, so a native leg loses its first two days.
        assert result is not None
        dates = sorted(case["closes"])
        closes = pd.Series(
            [float(case["closes"][d]) for d in dates],
            index=pd.DatetimeIndex(dates),
            name="BTC",
            dtype=float,
        )
        result = convert_native_returns_to_usd(result, case["native_unit"], closes)
    got = _pairs(result)
    want = [(e["date"], float(e["value"])) for e in case["expected"]]
    assert [d for d, _ in got] == [d for d, _ in want], case["name"]
    for (d, g), (_, w) in zip(got, want):
        assert math.isclose(g, w, abs_tol=_TOL, rel_tol=0), (case["name"], d, g, w)


def test_headline_geometric_day_one_is_a_ratio_not_the_level() -> None:
    """By literal, so a variant cannot hide behind the fixture it reads: a curve
    1.0 -> 1.1 is a +10% DAY, and the level 1.1 must never be the return. Day 0 is
    the first level against the implicit 1.0 base: 1.0 / 1 - 1 = 0.0."""
    row = {
        "returns_series": [
            {"date": "2026-03-02", "value": 1.0},
            {"date": "2026-03-03", "value": 1.1},
        ]
    }
    result = daily_returns_from_row(row, name="s")
    assert result is not None
    assert len(result) == 2
    assert result.iloc[0] == pytest.approx(0.0, abs=1e-12)
    assert result.iloc[1] == pytest.approx(0.1, abs=1e-12)
    assert result.iloc[1] != pytest.approx(1.1, abs=1e-3)


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


# ---------------------------------------------------------------------------
# Python-only cases (not in the shared oracle: TypeScript does not dedupe,
# and logging is Python's own contract)
# ---------------------------------------------------------------------------


def test_duplicate_dates_keep_the_last_record_by_input_order() -> None:
    row = {
        "returns_series": [
            {"date": "2026-03-02", "value": 1.0},
            {"date": "2026-03-03", "value": 9.0},
            {"date": "2026-03-03", "value": 1.1},
        ]
    }
    result = daily_returns_from_row(row, name="s")
    assert result is not None
    # The last record on 03-03 wins (1.1), so day 0 = 1.0 / 1 - 1 = 0.0 and
    # d1 = 1.1 / 1.0 - 1 = 0.1, not 8.0.
    assert list(result.to_numpy()) == pytest.approx([0.0, 0.1], abs=1e-12)


def test_malformed_records_are_skipped_with_one_warning_naming_the_series(
    caplog: pytest.LogCaptureFixture,
) -> None:
    row = {
        "returns_series": [
            "not-a-dict",
            {"value": 1.05},  # no date
            {"date": "2026-03-02", "value": 1.0},
            {"date": "2026-03-03", "value": 1.1},
        ]
    }
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
        result = daily_returns_from_row(row, name="strat-77")
    assert result is not None
    # WR-01: the stored head ("not-a-dict") was dropped, so 1.0 is NOT the curve's
    # day-0 level and is not read against the implicit 1.0 base: only the
    # pair 1.1 / 1.0 - 1 = 0.1 is formed.
    assert list(result.to_numpy()) == pytest.approx([0.1], abs=1e-12)
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "strat-77" in warnings[0].getMessage()
    assert "skipped 2 " in warnings[0].getMessage()  # the skipped count
    assert "1.05" not in warnings[0].getMessage()  # never a stored value


def test_method_flag_warns_once_on_an_unexpected_value_and_is_silent_on_absence(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
        assert curve_method_from_flags(None) == "geometric"
        assert curve_method_from_flags({}) == "geometric"
        assert curve_method_from_flags({"cumulative_method": None}) == "geometric"
        assert curve_method_from_flags("garbage") == "geometric"
        assert curve_method_from_flags({"cumulative_method": "simple"}) == "simple"
        assert curve_method_from_flags({"cumulative_method": "geometric"}) == "geometric"
    assert not [r for r in caplog.records if r.levelno == logging.WARNING]
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
        assert curve_method_from_flags({"cumulative_method": "arithmetic"}) == "geometric"
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "arithmetic" not in warnings[0].getMessage()


def test_an_empty_or_missing_row_is_none_never_an_empty_series() -> None:
    assert daily_returns_from_row({}, name="s") is None
    assert daily_returns_from_row(None, name="s") is None
    assert daily_returns_from_row({"returns_series": None, "daily_returns": []}, name="s") is None
    assert records_to_series([{"date": "2026-03-02", "value": None}], "s") is None


def test_a_boolean_level_is_not_a_level_of_one() -> None:
    row = {
        "returns_series": [
            {"date": "2026-03-02", "value": True},
            {"date": "2026-03-03", "value": 1.1},
        ]
    }
    assert daily_returns_from_row(row, name="s") is None


# ---------------------------------------------------------------------------
# WR-02: an absent day must not widen the next day's price interval.
# ---------------------------------------------------------------------------

_GAP_CURVE = [
    {"date": "2026-03-02", "value": 1.0},
    {"date": "2026-03-03", "value": 1.1},
    {"date": "2026-03-04", "value": None},
    {"date": "2026-03-05", "value": 1.2},
    {"date": "2026-03-06", "value": 1.32},
]
_GAP_CLOSES = pd.Series(
    [100.0, 100.0, 200.0, 400.0, 400.0],
    index=pd.DatetimeIndex(
        ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"]
    ),
)


def _gap_row(flags: dict[str, Any]) -> dict[str, Any]:
    return {"returns_series": _GAP_CURVE, "data_quality_flags": flags}


def test_wr02_usd_return_after_an_absent_day_is_the_one_day_return() -> None:
    """The review's repro, with the expected value written by literal from the
    independent invariant ``(1 + r_native) * (P_k / P_{k-1}) - 1`` over the SAME
    day: 03-06's native return is +10% and BTC closed flat that day (400 -> 400),
    so USD is +10%. Pricing it against 03-03 (close 100) gave +340%."""
    row = _gap_row({"native_unit": "BTC"})
    native = daily_returns_from_row(row, name="s", keep_absent=True)
    assert native is not None
    out = convert_native_returns_to_usd(native, "BTC", _GAP_CLOSES)
    # Day 0 (03-02) is the converter's interval anchor and is not priced. 03-03 is
    # priced over [03-02, 03-03] (closes 100 -> 100): 1.1 * 1 - 1 = 0.1. 03-06 is
    # the one-day return, priced over its own day (400 -> 400): 1.1 * 1 - 1 = 0.1.
    assert [d.strftime("%Y-%m-%d") for d in out.index] == ["2026-03-03", "2026-03-06"]
    assert math.isclose(float(out.iloc[0]), 0.10, abs_tol=1e-12)
    assert math.isclose(float(out.iloc[1]), 0.10, abs_tol=1e-12)
    assert not out.isna().any()


def test_wr02_default_read_still_deletes_the_absent_day_so_a_blend_never_sees_nan() -> None:
    """``keep_absent`` is opt-in: the default series is exactly the pre-fix one
    (absent days deleted, no NaN), which is what every non-converting reader gets."""
    native = daily_returns_from_row(_gap_row({"native_unit": "BTC"}), name="s")
    assert native is not None
    assert [d.strftime("%Y-%m-%d") for d in native.index] == [
        "2026-03-02",
        "2026-03-03",
        "2026-03-06",
    ]
    assert not native.isna().any()


def test_wr02_keep_absent_is_inert_for_a_usd_row() -> None:
    """A USD row passes the converter untouched, so a NaN placeholder on it would
    reach a blend. ``keep_absent`` must therefore do nothing without a unit."""
    for flags in ({}, {"cumulative_method": "geometric"}, {"native_unit": "not-a-code"}):
        usd = daily_returns_from_row(_gap_row(flags), name="s", keep_absent=True)
        assert usd is not None
        assert [d.strftime("%Y-%m-%d") for d in usd.index] == [
            "2026-03-02",
            "2026-03-03",
            "2026-03-06",
        ], flags
        assert not usd.isna().any(), flags


def test_wr02_keep_absent_does_not_touch_a_daily_returns_column() -> None:
    row = {
        "daily_returns": [
            {"date": "2026-03-03", "value": 0.1},
            {"date": "2026-03-06", "value": 0.1},
        ],
        "returns_series": _GAP_CURVE,
        "data_quality_flags": {"native_unit": "BTC"},
    }
    got = daily_returns_from_row(row, name="s", keep_absent=True)
    assert got is not None
    assert not got.isna().any()
    assert len(got) == 2


def test_wr02_a_curve_with_no_formable_day_is_none_even_when_absent_days_are_kept() -> None:
    row = {
        "returns_series": [
            {"date": "2026-03-02", "value": None},
            {"date": "2026-03-03", "value": 1.0},
        ],
        "data_quality_flags": {"native_unit": "BTC"},
    }
    # Day 0 has no usable level and day 1 pairs with it: nothing is formable.
    assert daily_returns_from_row(row, name="s", keep_absent=True) is None


# SFH M1: a row that HOLDS a curve but yields no day used to vanish from its
# blend with no trace. Nothing stored stays silent; stored-but-unusable warns once.


def _unusable_warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        r.getMessage()
        for r in caplog.records
        if r.levelno == logging.WARNING and "no daily return derivable" in r.getMessage()
    ]


@pytest.mark.parametrize(
    ("curve", "flags", "points", "method", "from_base"),
    [
        # one point of a CUT curve (from_base=False): day 0 has no stored predecessor
        ([{"date": "2026-03-02", "value": 1.07}], None, 1, "geometric", False),
        # one non-positive point of a stored curve: day 0 is w0 = 0, not > 0
        ([{"date": "2026-03-02", "value": 0.0}], None, 1, "geometric", True),
        # every level non-finite
        (
            [{"date": "2026-03-02", "value": None}, {"date": "2026-03-03", "value": "x"}],
            None,
            2,
            "geometric",
            True,
        ),
        # every pair non-positive: unusable on the geometric curve
        (
            [
                {"date": "2026-03-02", "value": 0.0},
                {"date": "2026-03-03", "value": -0.5},
                {"date": "2026-03-04", "value": -0.2},
            ],
            {"cumulative_method": "geometric"},
            3,
            "geometric",
            True,
        ),
        # one point on a cut simple curve names the method that was read
        (
            [{"date": "2026-03-02", "value": 1.07}],
            {"cumulative_method": "simple"},
            1,
            "simple",
            False,
        ),
    ],
)
def test_a_stored_curve_with_no_derivable_day_warns_once_naming_the_row(
    caplog: pytest.LogCaptureFixture,
    curve: list[dict[str, Any]],
    flags: dict[str, Any] | None,
    points: int,
    method: str,
    from_base: bool,
) -> None:
    row = {"returns_series": curve, "data_quality_flags": flags}
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
        assert daily_returns_from_row(row, name="strat-91", from_base=from_base) is None
    msgs = _unusable_warnings(caplog)
    assert len(msgs) == 1, msgs
    assert "strat-91" in msgs[0]
    assert f"returns_series points: {points}" in msgs[0]
    assert f"curve method: {method}" in msgs[0]
    assert "1.07" not in msgs[0]  # never a stored value


def test_non_positive_levels_are_unusable_geometric_but_legal_simple(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The same stored levels warn under one method and derive under the other,
    so the warning reports the method the row was READ with."""
    curve = [
        {"date": "2026-03-02", "value": 0.0},
        {"date": "2026-03-03", "value": -0.5},
    ]
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
        simple = daily_returns_from_row(
            {"returns_series": curve, "data_quality_flags": {"cumulative_method": "simple"}},
            name="s",
        )
    assert simple is not None
    assert not _unusable_warnings(caplog)


def test_a_row_with_nothing_stored_or_a_derivable_curve_stays_silent(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
        assert daily_returns_from_row({}, name="s") is None
        assert daily_returns_from_row(None, name="s") is None
        assert daily_returns_from_row(
            {"returns_series": None, "daily_returns": []}, name="s"
        ) is None
        assert daily_returns_from_row(
            {"returns_series": [], "daily_returns": {}}, name="s"
        ) is None
        ok = daily_returns_from_row(
            {
                "returns_series": [
                    {"date": "2026-03-02", "value": 1.0},
                    {"date": "2026-03-03", "value": 1.1},
                ]
            },
            name="s",
        )
    assert ok is not None
    assert not _unusable_warnings(caplog)


def test_unusable_daily_returns_with_no_curve_warns_too(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """daily_returns holds entries but none is finite, and there is no curve."""
    row = {"daily_returns": [{"date": "2026-03-03", "value": None}], "returns_series": None}
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
        assert daily_returns_from_row(row, name="strat-5") is None
    msgs = _unusable_warnings(caplog)
    assert len(msgs) == 1 and "strat-5" in msgs[0]
    assert "daily_returns points: 1" in msgs[0]


# ---------------------------------------------------------------------------
# G3-1 (a), Phase 155.2 plan 15: a stored curve is anchored at an implicit 1.0, so
# day 0 is read as w0 - 1 and n stored points read as n returns.
# ---------------------------------------------------------------------------


def test_the_runtime_cap_constant_equals_the_oracle_and_the_writers_default() -> None:
    """The reader's cap, the oracle's and the writer's move together: if
    ``cap_data_points`` ever keeps a different number of points, a curve it has cut
    would be read against 1.0 as if it were whole."""
    import inspect

    assert STORED_CURVE_MAX_POINTS == _ORACLE["stored_curve_max_points"]
    default = inspect.signature(cap_data_points).parameters["max_points"].default
    assert default == STORED_CURVE_MAX_POINTS


def test_four_stored_points_read_as_four_returns_by_literal() -> None:
    """By literal, beside the oracle. Returns 0.02, -0.01, 0.03, 0.01 stored as the
    writer stores them (no base point): 1.02, 1.0098, 1.040094, 1.05049494. All four
    come back; the first return is NOT lost with the missing base."""
    row = {
        "returns_series": [
            {"date": "2026-03-02", "value": 1.02},
            {"date": "2026-03-03", "value": 1.0098},
            {"date": "2026-03-04", "value": 1.040094},
            {"date": "2026-03-05", "value": 1.05049494},
        ]
    }
    got = daily_returns_from_row(row, name="s")
    assert got is not None
    assert list(got.to_numpy()) == pytest.approx([0.02, -0.01, 0.03, 0.01], abs=1e-12)
    cut = daily_returns_from_row(row, name="s", from_base=False)
    assert cut is not None
    assert list(cut.to_numpy()) == pytest.approx([-0.01, 0.03, 0.01], abs=1e-12)


def _simple_curve(points: int) -> dict[str, Any]:
    """A simple curve with a constant +0.001 per day: level k (0-based) is
    1.0 + 0.001 * (k + 1), so day 0 = 0.001 and every later day is 0.001."""
    dates = pd.date_range("2000-01-01", periods=points, freq="D")
    return {
        "returns_series": [
            {"date": d.strftime("%Y-%m-%d"), "value": 1.0 + 0.001 * (k + 1)}
            for k, d in enumerate(dates)
        ],
        "data_quality_flags": {"cumulative_method": "simple"},
    }


def test_a_curve_below_the_writer_cap_emits_day_zero_and_at_the_cap_it_does_not() -> None:
    below = daily_returns_from_row(_simple_curve(STORED_CURVE_MAX_POINTS - 1), name="s")
    assert below is not None
    assert len(below) == STORED_CURVE_MAX_POINTS - 1
    assert pd.Timestamp(below.index[0]).strftime("%Y-%m-%d") == "2000-01-01"
    assert float(below.iloc[0]) == pytest.approx(0.001, abs=1e-12)

    for points in (STORED_CURVE_MAX_POINTS, STORED_CURVE_MAX_POINTS + 1):
        at_cap = daily_returns_from_row(_simple_curve(points), name="s")
        assert at_cap is not None
        # n - 1 returns, from the SECOND stored day: day 0 would be a head the
        # writer may have cut, read against a 1.0 it was never anchored at.
        assert len(at_cap) == points - 1, points
        assert pd.Timestamp(at_cap.index[0]).strftime("%Y-%m-%d") == "2000-01-02", points


def test_the_raw_curve_function_defaults_to_the_old_pairing() -> None:
    """``curve_to_daily_returns`` is also called on curves with no 1.0 base (a
    blend's equity), so day 0 stays off unless a caller asks for it."""
    levels = pd.Series(
        [1.05, 0.945, 1.0395], index=pd.DatetimeIndex(["2026-01-02", "2026-01-03", "2026-01-04"])
    )
    old = curve_to_daily_returns(levels, "geometric")
    assert old is not None
    # 0.945 / 1.05 - 1 = -0.10; 1.0395 / 0.945 - 1 = +0.10
    assert list(old.to_numpy()) == pytest.approx([-0.10, 0.10], abs=1e-12)
    new = curve_to_daily_returns(levels, "geometric", from_base=True)
    assert new is not None
    # day 0 = 1.05 / 1 - 1 = +0.05
    assert list(new.to_numpy()) == pytest.approx([0.05, -0.10, 0.10], abs=1e-12)


def test_an_unusable_day_zero_is_a_nan_placeholder_when_absent_days_are_kept() -> None:
    """keep_absent + from_base: day 0 with w0 = 0 on a geometric curve is absent at
    its own date (a NaN placeholder), never 0 and never dropped."""
    levels = pd.Series(
        [0.0, 1.0, 1.1], index=pd.DatetimeIndex(["2026-03-02", "2026-03-03", "2026-03-04"])
    )
    got = curve_to_daily_returns(levels, "geometric", keep_absent=True, from_base=True)
    assert got is not None
    assert [d.strftime("%Y-%m-%d") for d in got.index] == [
        "2026-03-02",
        "2026-03-03",
        "2026-03-04",
    ]
    assert list(got.notna()) == [False, False, True]
    assert float(got.iloc[2]) == pytest.approx(0.1, abs=1e-12)


def test_g31_a_stored_native_curves_day_one_is_priced_over_day_zero_to_day_one() -> None:
    """NAV 1.05 -> 1.155 in BTC on closes 60000 -> 66000, through ``daily_returns_from_row``
    (keep_absent, as every converting caller passes it) and then the converter.
    Native returns: day 0 = 1.05 / 1 - 1 = 0.05 on 2026-01-01 (the curve is anchored at an
    implicit 1.0), day 1 = 1.155 / 1.05 - 1 = 0.10 on 2026-01-02. Before G3-1 (a) the curve
    read as ONE return (day 1) and the converter dropped it as its own first day, so the leg
    priced to nothing. USD: (1 + 0.10) * (66000 / 60000) - 1 = 1.1 * 1.1 - 1 = 0.21. Day 0
    has no interval and is the anchor only, so it is not priced."""
    row = {
        "returns_series": [
            {"date": "2026-01-01", "value": 1.05},
            {"date": "2026-01-02", "value": 1.155},
        ],
        "data_quality_flags": {"native_unit": "BTC"},
    }
    native = daily_returns_from_row(row, name="s", keep_absent=True)
    assert native is not None
    assert [d.strftime("%Y-%m-%d") for d in native.index] == ["2026-01-01", "2026-01-02"]
    closes = pd.Series(
        [60000.0, 66000.0], index=pd.DatetimeIndex(["2026-01-01", "2026-01-02"]), dtype=float
    )
    usd = convert_native_returns_to_usd(native, "BTC", closes)
    assert [d.strftime("%Y-%m-%d") for d in usd.index] == ["2026-01-02"]
    assert math.isclose(float(usd.iloc[0]), 0.21, abs_tol=1e-12)
