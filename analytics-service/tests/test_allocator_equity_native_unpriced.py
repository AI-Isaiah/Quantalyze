"""164.6.6.2.1 plan 09 — a BTC key in the USD allocator book, and the days it cannot be priced.

D-01 (allocator totals are in USD), D-09 (a key on an unpriced day is left out of the book
BY NAME, never priced at a stale close), D-20 (a drop in the total is never silent: the
payload names the key and the day).

The BTC key arrives from plan 08 as a USD series (its native returns priced at the close of
each day), a realized terminal in USD, and either a USD anchor (its live balance priced at the
latest completed close) or a NULL anchor ``native_unpriced`` (that one close is missing).

Every oracle is a hand-worked invariant over literals chosen so the sums are exact; none reads
a number back from the compose or from MEASUREMENT's probe:

    key A (USD)  : returns 0.0, no flows, realized terminal and anchor 100000.0 -> level 100000.0
    key B (BTC)  : USD returns 0.0, realized terminal 60000.0 (1.0 BTC x 60000)  -> level 60000.0
    book         : 100000.0 + 60000.0 = 160000.0 while both are in it
    B leaving the book is an exit of 60000.0, never a return: a booked return would read
    -60000 / 160000 = -0.375.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import pandas as pd
import pytest

from services.allocator_equity_compose import (
    compose_allocator_equity,
    hole_segment_ends,
    read_native_key_inputs,
)

A_LEVEL = 100_000.0
B_LEVEL = 60_000.0
BOOK = A_LEVEL + B_LEVEL  # 160000.0

D1 = "2026-06-06"
D = "2026-06-10"


def _days(start: str, n: int) -> list[str]:
    base = date.fromisoformat(start)
    return [(base + timedelta(days=i)).isoformat() for i in range(n)]


DAYS = _days(D1, 5)  # 06-06 .. 06-10; DAYS[-1] == D
assert DAYS[-1] == D


def _flat(days: list[str]) -> pd.Series:
    return pd.Series([0.0] * len(days), index=days)


def _curve(payload: dict[str, Any]) -> dict[str, float]:
    return {row["date"]: row["equity_usd"] for row in payload["curve"]}


def _returns(payload: dict[str, Any]) -> dict[str, float]:
    return {row["date"]: row["r"] for row in payload["returns"]}


def _key_a() -> dict[str, Any]:
    return {
        "returns_by_key": {"A": _flat(DAYS)},
        "flows_by_key": {"A": []},
        "anchors_by_key": {"A": A_LEVEL},
        "realized_terminal_by_key": {"A": (D, A_LEVEL)},
    }


def _with_b(
    b_days: list[str],
    *,
    anchor: float | None,
    reason: str | None = None,
    terminal_day: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    kwargs = _key_a()
    kwargs["returns_by_key"]["B"] = _flat(b_days)
    kwargs["flows_by_key"]["B"] = []
    kwargs["anchors_by_key"]["B"] = anchor
    if terminal_day is not None:
        kwargs["realized_terminal_by_key"]["B"] = (terminal_day, B_LEVEL)
    if reason is not None:
        kwargs["null_anchor_reasons"] = {"B": reason}
    kwargs.update(extra)
    return kwargs


def _compose(kwargs: dict[str, Any]) -> dict[str, Any]:
    positional = (
        kwargs.pop("returns_by_key"),
        kwargs.pop("flows_by_key"),
        kwargs.pop("anchors_by_key"),
    )
    return compose_allocator_equity(*positional, **kwargs)


def test_a_priced_btc_key_is_in_the_usd_book_at_its_usd_levels() -> None:
    """D-01: B's series ends D-1 with its live anchor priced at that close (60000.0). The book
    over a USD key and a priced BTC key is the hand sum of their levels on EVERY day: A holds
    100000.0, B holds 60000.0 (carried flat on D, the existing stale-mark semantic), 160000.0
    each day. Nothing is omitted, so no flag and no list."""
    payload = _compose(_with_b(DAYS[:-1], anchor=B_LEVEL, terminal_day=DAYS[-2]))

    assert _curve(payload) == {day: pytest.approx(BOOK, abs=1e-9) for day in DAYS}
    assert all(r == pytest.approx(0.0, abs=1e-12) for r in _returns(payload).values())
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "native_unpriced_key_omitted" not in payload["flags"]
    assert "unpriced_native_keys" not in payload


def test_an_unpriced_anchor_btc_key_is_composed_through_its_last_priced_day_then_exits() -> None:
    """D-09 / T1. B is priced through P = D-2 and the live close (C = D-1) is missing, so B's
    anchor is its realized USD level on P (60000.0). The book is 160000.0 through P and A alone
    (100000.0) after it. B's leaving is an EXIT: the book's return on P+1 is A's own 0.0, where a
    booked loss would read -60000 / 160000 = -0.375. D-20: the omission is named, with the day
    of the close that is missing."""
    p_day, c_day = DAYS[2], DAYS[3]
    payload = _compose(
        _with_b(
            DAYS[:3],
            anchor=B_LEVEL,
            terminal_day=p_day,
            departed_end_by_key={"B": p_day},
            unpriced_close_day_by_key={"B": c_day},
        )
    )

    curve = _curve(payload)
    for day in DAYS[:3]:
        assert curve[day] == pytest.approx(BOOK, abs=1e-9), day
    for day in DAYS[3:]:
        assert curve[day] == pytest.approx(A_LEVEL, abs=1e-9), day
    assert _returns(payload)[c_day] == pytest.approx(0.0, abs=1e-12)
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "dropped_key" not in payload["degrade_reasons"]
    assert "native_unpriced_key_omitted" in payload["flags"]
    assert payload["unpriced_native_keys"] == [{"api_key_id": "B", "day": c_day}]


def test_a_key_named_unpriced_without_a_departed_end_is_still_rotated_out_not_carried() -> None:
    """The job always sends the end day. A caller that does not must not get a stale carry: the
    key leaves the book after its last return day, which is the same answer."""
    p_day, c_day = DAYS[2], DAYS[3]
    payload = _compose(
        _with_b(
            DAYS[:3],
            anchor=B_LEVEL,
            terminal_day=p_day,
            unpriced_close_day_by_key={"B": c_day},
        )
    )

    assert _curve(payload)[D] == pytest.approx(A_LEVEL, abs=1e-9)
    assert payload["unpriced_native_keys"] == [{"api_key_id": "B", "day": c_day}]


def test_a_key_whose_last_priced_day_is_the_books_last_day_is_not_listed() -> None:
    """The list names the keys left out of the curve's LAST day (D-20). B priced through D is
    in the book on D, so nothing is omitted: no flag, no list, the book is 160000.0 throughout."""
    payload = _compose(
        _with_b(
            DAYS,
            anchor=B_LEVEL,
            terminal_day=D,
            departed_end_by_key={"B": D},
            unpriced_close_day_by_key={"B": "2026-06-11"},
        )
    )

    assert _curve(payload)[D] == pytest.approx(BOOK, abs=1e-9)
    assert "unpriced_native_keys" not in payload
    assert "native_unpriced_key_omitted" not in payload["flags"]


@pytest.mark.parametrize("with_series", [False, True])
def test_a_key_with_nothing_priced_is_omitted_by_name_and_never_degrades_the_book(
    with_series: bool,
) -> None:
    """Nothing could be priced at all: NULL anchor, reason ``native_unpriced``. Real capital
    that is not a read failure, so NO ``dropped_key`` / ``no_anchor`` / ``missing_series``; the
    book over the USD key stays trustworthy, and the key is listed with its missing close."""
    kwargs = _key_a()
    kwargs["flows_by_key"]["B"] = []
    kwargs["anchors_by_key"]["B"] = None
    if with_series:
        kwargs["returns_by_key"]["B"] = _flat(DAYS)
    kwargs["null_anchor_reasons"] = {"B": "native_unpriced"}
    kwargs["unpriced_close_day_by_key"] = {"B": "2026-06-09"}
    payload = _compose(kwargs)

    assert _curve(payload) == {day: pytest.approx(A_LEVEL, abs=1e-9) for day in DAYS}
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    for blocked in ("dropped_key", "no_anchor", "missing_series"):
        assert blocked not in payload["degrade_reasons"]
    assert "native_unpriced_key_omitted" in payload["flags"]
    assert payload["unpriced_native_keys"] == [{"api_key_id": "B", "day": "2026-06-09"}]


def test_an_unsupported_unit_key_keeps_the_native_unit_path_unchanged() -> None:
    """EUR (no price source) stays ``native_unit``: its own token, and none of the unpriced
    machinery fires for it."""
    kwargs = _key_a()
    kwargs["flows_by_key"]["B"] = []
    kwargs["anchors_by_key"]["B"] = None
    kwargs["null_anchor_reasons"] = {"B": "native_unit"}
    payload = _compose(kwargs)

    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "native_unit_key_omitted" in payload["flags"]
    assert "native_unpriced_key_omitted" not in payload["flags"]
    assert "unpriced_native_keys" not in payload


def test_native_unpriced_is_not_a_no_capital_anchor_reason() -> None:
    """A BTC account whose live close is missing has capital. In this set, an empty positions
    poll could PROVE it was zero and write a $0 row."""
    from services.equity_reconstruction import _NO_CAPITAL_ANCHOR_REASONS

    assert "native_unpriced" not in _NO_CAPITAL_ANCHOR_REASONS


def test_reader_returns_none_for_a_usd_row_and_the_fields_for_a_native_one() -> None:
    assert read_native_key_inputs({"anchor_usd": 1.0}) is None
    got = read_native_key_inputs(
        {"native_unit": "BTC", "priced_through": "2026-06-08", "unpriced_close_day": "2026-06-09"}
    )
    assert got is not None
    assert (got.priced_through, got.unpriced_close_day) == ("2026-06-08", "2026-06-09")
    bare = read_native_key_inputs({"native_unit": "BTC"})
    assert bare is not None and (bare.priced_through, bare.unpriced_close_day) == (None, None)


@pytest.mark.parametrize(
    "payload",
    [
        {"native_unit": 7},
        {"native_unit": ""},
        {"native_unit": "BTC", "priced_through": "not-a-day"},
        {"native_unit": "BTC", "priced_through": "20260608"},
        {"native_unit": "BTC", "priced_through": 20260608},
        {"native_unit": "BTC", "unpriced_close_day": "2026-13-40"},
    ],
)
def test_reader_refuses_a_malformed_native_field_rather_than_guess(payload: dict[str, Any]) -> None:
    """T-164.6.6.2.1-23: the JSONB is worker-written but untrusted."""
    with pytest.raises((ValueError, TypeError)):
        read_native_key_inputs(payload)


# --- interior holes (mechanism I2) ---------------------------------------------------------


def _series(days: list[str], values: list[float]) -> pd.Series:
    return pd.Series(values, index=days)


def test_an_interior_unpriced_day_leaves_the_key_out_of_that_day_never_carried() -> None:
    """D-09 "that day". B is priced on d1, d2 and d5 and has no USD return on d3 and d4 (their
    close is missing). Hand values: A holds 100000.0, B 60000.0. The book is 160000.0 on d1, d2 and
    d5 and 100000.0 on d3 and d4 (a stale carry would read 160000.0 there). B leaving on d3 and
    re-entering on d5 is an exit and an entry: the book return on d3, d4 and d5 is A's own 0.0
    (booking them as returns would read -0.375 and +0.6). The level before the hole is B's stored
    60000.0 on d2, so the hole did not shift d1 either."""
    d1, d2, d3, d4, d5 = DAYS
    kwargs = _key_a()
    kwargs["returns_by_key"]["B"] = _series([d1, d2, d5], [0.0, 0.0, 0.0])
    kwargs["flows_by_key"]["B"] = []
    kwargs["anchors_by_key"]["B"] = B_LEVEL
    kwargs["realized_terminal_by_key"]["B"] = (d5, B_LEVEL)
    kwargs["unpriced_days_by_key"] = {"B": [d3, d4]}
    kwargs["segment_terminals_by_key"] = {"B": {d2: B_LEVEL}}
    payload = _compose(kwargs)

    curve = _curve(payload)
    assert [curve[d] for d in (d1, d2, d5)] == [pytest.approx(BOOK, abs=1e-9)] * 3
    assert [curve[d] for d in (d3, d4)] == [pytest.approx(A_LEVEL, abs=1e-9)] * 2
    returns = _returns(payload)
    for day in (d3, d4, d5):
        assert returns[day] == pytest.approx(0.0, abs=1e-12), day
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "missing_return_inside_coverage" not in payload["flags"]
    assert "departed_history_included" not in payload["flags"]
    assert "native_unpriced_key_omitted" in payload["flags"]
    # SFH-02: the curve's last day is priced, so the key has no ``day`` (that field means "left
    # out of the LAST day"), but the key is still NAMED with the interior days it was left out of.
    assert payload["unpriced_native_keys"] == [{"api_key_id": "B", "day": None, "hole_days": [d3, d4]}]
    assert payload["inputs"]["n_keys"] == 2  # a segment is not a key


def test_the_ledger_books_the_exit_and_the_entry_so_a_flat_book_has_zero_gain() -> None:
    """The cashflow ledger behind the Dietz / MWR scalars must see B leave and come back. A book
    that is flat throughout (every return 0.0, the same 60000.0 out and back in) has made no money,
    so its Modified Dietz is exactly 0. Booking the exit without the entry would read the 60000.0
    that returned as a gain."""
    d1, d2, d3, d4, d5 = DAYS
    kwargs = _key_a()
    kwargs["returns_by_key"]["B"] = _series([d1, d2, d5], [0.0, 0.0, 0.0])
    kwargs["flows_by_key"]["B"] = []
    kwargs["anchors_by_key"]["B"] = B_LEVEL
    kwargs["realized_terminal_by_key"]["B"] = (d5, B_LEVEL)
    kwargs["unpriced_days_by_key"] = {"B": [d3, d4]}
    kwargs["segment_terminals_by_key"] = {"B": {d2: B_LEVEL}}
    payload = _compose(kwargs)

    assert payload["scalars"]["computable"] is True
    assert payload["scalars"]["dietz"] == pytest.approx(0.0, abs=1e-9)


# MEASUREMENT M3's fixture, with every level a hand literal (native level x that day's close,
# worked by hand in the MEASUREMENT file): the close of 06-05 is missing, so the USD return is
# absent on 06-05 (no close) and 06-06 (it pairs against 06-05).
_M3_LEVEL = {
    "2026-06-01": 60_000.0,
    "2026-06-02": 62_730.0,
    "2026-06-03": 59_590.0,
    "2026-06-04": 65_100.0,
    "2026-06-06": 68_040.0,
    "2026-06-07": 64_735.0,
    "2026-06-08": 70_400.0,
    "2026-06-09": 72_800.0,
    "2026-06-10": 68_125.0,
}
_M3_HOLE = ["2026-06-05", "2026-06-06"]
_M3_RETURN_DAYS = [
    "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10",
]


def _m3_returns() -> pd.Series:
    """USD return of day d = level(d) / level(previous priced day) - 1. The previous day of
    06-07 is 06-06 (it has a close), which is exactly why the converter can price 06-07."""
    previous = {
        "2026-06-02": "2026-06-01", "2026-06-03": "2026-06-02", "2026-06-04": "2026-06-03",
        "2026-06-07": "2026-06-06", "2026-06-08": "2026-06-07", "2026-06-09": "2026-06-08",
        "2026-06-10": "2026-06-09",
    }
    return _series(
        _M3_RETURN_DAYS, [_M3_LEVEL[d] / _M3_LEVEL[previous[d]] - 1.0 for d in _M3_RETURN_DAYS]
    )


def _m3_kwargs(*, with_a: bool = True) -> dict[str, Any]:
    days_a = _days("2026-06-02", 9)  # 06-02 .. 06-10
    kwargs: dict[str, Any] = {
        "returns_by_key": {"B": _m3_returns()},
        "flows_by_key": {"B": []},
        "anchors_by_key": {"B": _M3_LEVEL["2026-06-10"]},
        "realized_terminal_by_key": {"B": ("2026-06-10", _M3_LEVEL["2026-06-10"])},
        "unpriced_days_by_key": {"B": _M3_HOLE},
        "segment_terminals_by_key": {"B": {"2026-06-04": _M3_LEVEL["2026-06-04"]}},
    }
    if with_a:
        kwargs["returns_by_key"]["A"] = _flat(days_a)
        kwargs["flows_by_key"]["A"] = []
        kwargs["anchors_by_key"]["A"] = A_LEVEL
        kwargs["realized_terminal_by_key"]["A"] = ("2026-06-10", A_LEVEL)
    return kwargs


def test_levels_before_an_interior_hole_are_the_stored_levels_not_a_mis_rolled_history() -> None:
    """The M3 finding: without segments the return after the hole is applied to the level of the
    day BEFORE it, so every earlier level is wrong (M3 measured contributions of 65562.97,
    62281.16 and 68040.0 on 06-02..06-04 against the hand 62730.0, 59590.0 and 65100.0). With the
    stored level on the last priced day before the hole, B's contribution equals its hand level on
    EVERY priced day, is 0 on the unpriced days, and the book is A's 100000.0 plus that."""
    payload = _compose(_m3_kwargs())

    curve = _curve(payload)
    # 06-06 has a close, but its return cannot be formed (it pairs against 06-05), so the writer
    # names it unpriced and B contributes nothing on it, like 06-05.
    expected_b = {d: _M3_LEVEL[d] for d in _M3_LEVEL if d != "2026-06-01" and d not in _M3_HOLE}
    for day in _days("2026-06-02", 9):
        assert curve[day] == pytest.approx(A_LEVEL + expected_b.get(day, 0.0), abs=1e-6), day
    assert curve["2026-06-05"] == pytest.approx(A_LEVEL, abs=1e-9)
    assert curve["2026-06-06"] == pytest.approx(A_LEVEL, abs=1e-9)
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "missing_return_inside_coverage" not in payload["flags"]

    # Book returns, each (change in B's hand level) / (A + B's prior hand level); an exit and an
    # entry are never returns, so 06-05, 06-06 and the entry day 06-07 are A's own 0.0.
    returns = _returns(payload)
    lv = _M3_LEVEL
    for day, prev in (
        ("2026-06-03", "2026-06-02"), ("2026-06-04", "2026-06-03"),
        ("2026-06-08", "2026-06-07"), ("2026-06-09", "2026-06-08"), ("2026-06-10", "2026-06-09"),
    ):
        assert returns[day] == pytest.approx((lv[day] - lv[prev]) / (A_LEVEL + lv[prev]), abs=1e-12), day
    for day in ("2026-06-05", "2026-06-06", "2026-06-07"):
        assert returns[day] == pytest.approx(0.0, abs=1e-12), day


def test_a_sole_btc_key_with_a_hole_has_no_rows_on_the_unpriced_days_and_stays_computable() -> None:
    """With no other key the segments hand off through a coverage seam (one booking of the
    handoff, not an exit plus an entry). The curve is B's hand level on each priced day and has
    no row on the unpriced days; nothing blocks."""
    payload = _compose(_m3_kwargs(with_a=False))

    curve = _curve(payload)
    assert set(curve) == {d for d in _M3_LEVEL if d != "2026-06-01" and d not in _M3_HOLE}
    for day, level in curve.items():
        assert level == pytest.approx(_M3_LEVEL[day], abs=1e-6), day
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert payload["scalars"]["computable"] is True


def test_a_hole_without_its_stored_level_is_never_guessed_and_blocks() -> None:
    """The writer must store the level on the last priced day before each hole. A row without it
    cannot say what the earlier levels were: the key composes unsplit and the book is
    untrustworthy (``key_inputs_mismatch``), loud rather than a quietly wrong history."""
    kwargs = _m3_kwargs()
    kwargs["segment_terminals_by_key"] = {"B": {}}
    payload = _compose(kwargs)

    assert "key_inputs_mismatch" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False


def test_a_key_with_unpriced_days_but_no_interior_hole_composes_as_before() -> None:
    """Unpriced days before the first or after the last priced day separate nothing."""
    d1, d2, d3, d4, d5 = DAYS
    kwargs = _key_a()
    kwargs["returns_by_key"]["B"] = _series([d3, d4, d5], [0.0, 0.0, 0.0])
    kwargs["flows_by_key"]["B"] = []
    kwargs["anchors_by_key"]["B"] = B_LEVEL
    kwargs["realized_terminal_by_key"]["B"] = (d5, B_LEVEL)
    kwargs["unpriced_days_by_key"] = {"B": [d1, d2]}
    payload = _compose(kwargs)

    assert _curve(payload)[d3] == pytest.approx(BOOK, abs=1e-9)
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "native_unpriced_key_omitted" not in payload["flags"]
    assert "unpriced_native_keys" not in payload


def test_a_key_with_an_interior_hole_and_a_missing_last_close_is_one_entry_with_both() -> None:
    """SFH-02. B has an interior hole (d3) AND its live close is missing, so it leaves the book
    after d4. One entry per key: ``day`` keeps its meaning (the missing live close), and the
    interior days ride beside it as ``hole_days`` so neither fact is lost."""
    d1, d2, d3, d4, d5 = DAYS
    kwargs = _key_a()
    kwargs["returns_by_key"]["B"] = _series([d1, d2, d4], [0.0, 0.0, 0.0])
    kwargs["flows_by_key"]["B"] = []
    kwargs["anchors_by_key"]["B"] = B_LEVEL
    kwargs["realized_terminal_by_key"]["B"] = (d4, B_LEVEL)
    kwargs["departed_end_by_key"] = {"B": d4}
    kwargs["unpriced_close_day_by_key"] = {"B": d5}
    kwargs["unpriced_days_by_key"] = {"B": [d3]}
    kwargs["segment_terminals_by_key"] = {"B": {d2: B_LEVEL}}
    payload = _compose(kwargs)

    assert payload["unpriced_native_keys"] == [{"api_key_id": "B", "day": d5, "hole_days": [d3]}]


def test_a_key_left_out_with_no_known_day_is_named_with_the_reason_not_a_bare_null() -> None:
    """WR-02 / SFH-02. A key whose native row could not be read has a NULL anchor and no missing-
    close day. It is still listed, and the entry says WHY it has no day, so the reader can render
    a sentence without a date instead of dropping the account."""
    payload = _compose(_with_b(DAYS, anchor=None, reason="native_unpriced"))

    assert payload["unpriced_native_keys"] == [
        {"api_key_id": "B", "day": None, "reason": "day_unknown"}
    ]
    assert "native_unpriced_key_omitted" in payload["flags"]


def test_hole_segment_ends_names_the_priced_day_before_each_interior_hole() -> None:
    d1, d2, d3, d4, d5, d6, d7 = _days(D1, 7)
    # one hole: d3 and d4 unpriced between d2 and d5
    assert hole_segment_ends({d1, d2, d5}, {d3, d4}) == [d2]
    # a flow on an unpriced day is not an event: it does not move the end
    assert hole_segment_ends({d1, d2, d3, d5}, {d3, d4}) == [d2]
    # two holes
    assert hole_segment_ends({d1, d2, d4, d5, d7}, {d3, d6}) == [d2, d5]
    # leading and trailing unpriced stretches separate nothing
    assert hole_segment_ends({d3, d4}, {d1, d2, d5, d6}) == []
    # adjacent events with no unpriced day between them are one segment
    assert hole_segment_ends({d1, d2, d3}, {d6}) == []


def test_reader_reads_the_interior_hole_fields_and_refuses_malformed_ones() -> None:
    got = read_native_key_inputs(
        {
            "native_unit": "BTC",
            "unpriced_days": ["2026-06-06", "2026-06-05", "2026-06-05"],
            "segment_terminals": [{"utc_day_iso": "2026-06-04", "level_usd": 65100.0}],
        }
    )
    assert got is not None
    assert got.unpriced_days == ("2026-06-05", "2026-06-06")
    assert got.segment_terminals == (("2026-06-04", 65100.0),)
    for bad in (
        {"unpriced_days": "2026-06-05"},
        {"unpriced_days": ["nope"]},
        {"segment_terminals": {"utc_day_iso": "2026-06-04", "level_usd": 1.0}},
        {"segment_terminals": [{"utc_day_iso": "2026-06-04", "level_usd": True}]},
        {"segment_terminals": [{"utc_day_iso": "2026-06-04", "level_usd": float("nan")}]},
        {"segment_terminals": [{"utc_day_iso": "2026-06-04", "level_usd": -5.0}]},
        {"segment_terminals": [{"utc_day_iso": "2026-06-04", "level_usd": 1.0}] * 2},
        {"segment_terminals": [{"utc_day_iso": "2026-06-04"}]},
    ):
        with pytest.raises((ValueError, TypeError, KeyError)):
            read_native_key_inputs({"native_unit": "BTC", **bad})
