"""Phase 167.1.2.2 round-1 WR-01 — a day the TWR writer dropped has a LEVEL (D-15) but no
RETURN, and the book returns must say so instead of reading it as 0.

THE DEFECT (167.1.2.2-REVIEW.md WR-01, measured by the reviewer). D-15 puts each dropped
day's P&L into the key's level series, so the $-curve moves on that day. ``payload.returns``
(which the factsheet KPIs and the Scenario own-book delta read, never ratios of the curve)
still said ``r = 0.0`` there: ``portfolio_returns._return_on`` returned 0 for any day with
no stored return row. One trustworthy payload then carried a curve that fell 0.36% on a day
and a return series that said the day was flat. And a dust or P&L-dominated dropped day that
is not a flow day lost the one signal that marked it (``missing_return_inside_coverage``),
because it now has a level.

THE FIX UNDER TEST. A dropped day's return is UNDEFINED: the writer left it out because
its prior capital could not be a denominator. The key sits out that day's sums (as it sits
out the day it joins), the key-day is counted under ``missing_return_inside_coverage``, and
a day on which no key has a defined return is absent from ``payload.returns``. Never 0.

THE ORACLE IS INDEPENDENT OF THE CODE UNDER TEST. The expected returns are
``pnl_t / nav_{t-1}`` from the exact ``Fraction`` book (the writer's own definition), the
expected absent days are the book's restated guard rule (pinned against the real
``chain_linked_twr`` in ``test_allocator_equity_dropped_day_pnl.py``), and the multi-key
expectation is the capital-weighted mean over exact ``Fraction`` levels.
"""
from __future__ import annotations

import logging
import math
from fractions import Fraction

import pandas as pd
import pytest

from services.allocator_equity_compose import compose_allocator_equity, portfolio_returns
from services.allocator_equity_derive import KeyEquity
from services.external_flows import ExternalFlow
from tests.test_allocator_equity_dropped_day_pnl import (
    Book,
    _iso,
    _window_flow,
    _window_pnl,
    funding_and_dominated_book,
)


def _compose(book: Book, **kw):
    return compose_allocator_equity(
        {"k": book.stored_returns},
        {"k": book.flows},
        {"k": book.anchor},
        full_history_keys={"k"},
        dropped_day_pnl_by_key={"k": book.dropped_pnl},
        **kw,
    )


def _ret(payload: dict) -> dict[str, float]:
    return {row["date"]: row["r"] for row in payload["returns"]}


def _curve(payload: dict) -> dict[str, float]:
    return {row["date"]: row["equity_usd"] for row in payload["curve"]}


def test_a_dropped_day_is_absent_from_the_returns_never_zero() -> None:
    book = funding_and_dominated_book()
    interior_dropped = [i for i in book.dropped_idx if i >= 1]
    assert interior_dropped == [2] and book.pnl[2] == -700  # the flow-dominated day, P&L -700
    payload = _compose(book)
    returns = _ret(payload)

    # the first union day has no prior level; the dropped day has no defined return
    expected_days = [book.days[i] for i in range(1, len(book.days)) if i not in book.dropped_idx]
    assert sorted(returns) == expected_days
    assert book.days[2] not in returns
    # and every day that is there is the writer's own definition, pnl / prior nav, exactly
    for i in range(1, len(book.days)):
        if i in book.dropped_idx:
            continue
        want = book.pnl[i] / book.nav[i - 1]
        assert want != 0
        assert returns[book.days[i]] == pytest.approx(float(want), rel=1e-9), book.days[i]
    assert all(r != 0.0 for r in returns.values())


def test_the_returns_chained_with_the_flows_reproduce_the_curve_on_every_returned_day() -> None:
    """The reviewer's pin: curve and KPIs in one payload agree. On each returned day
    ``curve_t = curve_{t-1} (1 + r_t) + F_t``; on the dropped day the curve moves by exactly
    that day's real P&L plus its flow, and the returns say nothing about it."""
    book = funding_and_dominated_book()
    payload = _compose(book)
    returns, curve = _ret(payload), _curve(payload)
    flow = {_iso(i): float(f) for i, f in enumerate(book.flow)}

    for i in range(1, len(book.days)):
        day, prev = book.days[i], book.days[i - 1]
        if day in returns:
            assert curve[day] == pytest.approx(curve[prev] * (1 + returns[day]) + flow[day], rel=1e-9), day
    dropped = book.days[2]
    assert curve[dropped] - curve[book.days[1]] - flow[dropped] == pytest.approx(float(book.pnl[2]), abs=1e-6)
    assert dropped not in returns


def test_a_dropped_day_is_reported_not_silent(caplog: pytest.LogCaptureFixture) -> None:
    book = funding_and_dominated_book()
    with caplog.at_level(logging.WARNING, logger="services.allocator_equity_compose"):
        payload = _compose(book)

    assert "missing_return_inside_coverage" in payload["flags"]
    assert payload["is_trustworthy"] is True  # reported, not blocking
    assert "skipped_nonpositive_denominator" not in payload["flags"]  # a different fact
    (record,) = [r for r in caplog.records if "left the day out" in r.getMessage()]
    assert record.levelno == logging.WARNING
    assert record.getMessage().startswith("compose: 1 key-day(s)")  # counts only


def test_a_dust_dropped_day_that_is_not_a_flow_day_keeps_its_signal() -> None:
    """The signal the reviewer found lost. Day 1 is below the dust floor with no flow:
    before D-15 it had no level and was counted as a gap; D-15 gave it one, and it is
    still not a return."""
    book = Book(
        Fraction(0),
        [Fraction(500), Fraction(100), Fraction(50), Fraction(300)] + _window_pnl(20),
        [Fraction(200), Fraction(0), Fraction(5000), Fraction(0)] + _window_flow(20),
    )
    assert book.dropped_idx == [0, 1, 2] and book.flow[1] == 0  # day 1: dust, not a flow day
    payload = compose_allocator_equity(
        {"k": book.stored_returns}, {"k": book.flows}, {"k": book.anchor},
        dropped_day_pnl_by_key={"k": book.dropped_pnl},
    )
    returns = _ret(payload)

    assert book.days[1] not in returns and book.days[2] not in returns
    assert "missing_return_inside_coverage" in payload["flags"]


def test_a_book_with_no_dropped_day_is_unchanged() -> None:
    # an ordinary key: returns on every day, no stored P&L at all
    ordinary = pd.Series([0.001] * 12, index=[_iso(i) for i in range(12)], name="k")
    payload = compose_allocator_equity({"k": ordinary}, {"k": []}, {"k": 1000.0})
    assert sorted(_ret(payload)) == [_iso(i) for i in range(1, 12)]
    assert all(r == pytest.approx(0.001, rel=1e-12) for r in _ret(payload).values())
    assert "missing_return_inside_coverage" not in payload["flags"]


def test_with_several_keys_the_dropped_key_sits_out_and_the_others_carry_the_day() -> None:
    """Key A drops day 2; key B is ordinary. The book return that day is B's alone, exactly;
    on every other day it is the capital-weighted mean over exact levels."""
    book = funding_and_dominated_book()
    n = len(book.days)
    rb = Fraction(1, 1000)
    b_anchor = Fraction(250_000)
    # B's levels, rolled back exactly from its anchor with a constant return, no flows
    b_level = [b_anchor / (1 + rb) ** (n - 1 - i) for i in range(n)]
    b_returns = pd.Series([float(rb)] * n, index=book.days, name="b")

    payload = compose_allocator_equity(
        {"a": book.stored_returns, "b": b_returns},
        {"a": book.flows, "b": []},
        {"a": book.anchor, "b": float(b_anchor)},
        full_history_keys={"a"},
        dropped_day_pnl_by_key={"a": book.dropped_pnl},
    )
    returns = _ret(payload)

    assert returns[book.days[2]] == pytest.approx(float(rb), rel=1e-12)  # B's, alone
    for i in range(1, n):
        if i in book.dropped_idx:
            continue
        a_prev, b_prev = book.nav[i - 1], b_level[i - 1]
        want = (a_prev * (book.pnl[i] / book.nav[i - 1]) + b_prev * rb) / (a_prev + b_prev)
        assert returns[book.days[i]] == pytest.approx(float(want), rel=1e-9), book.days[i]
    # the day-1 return exists too: A's level is there on day 0, so A is in the sum
    assert book.days[1] in returns


def test_a_day_where_no_key_has_a_defined_return_is_absent_and_is_not_a_skipped_denominator() -> None:
    """Direct on ``portfolio_returns``: the only key drops the day. There is no book
    return, the day is absent, and it is counted as an undefined key-day, not as the
    benign non-positive-denominator skip (a different fact)."""
    days = ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04"]
    equity = {"k": KeyEquity(pd.Series([100.0, 110.0, 120.0, 130.0], index=days))}
    returns = {"k": pd.Series([0.1, 0.05], index=["2026-02-02", "2026-02-04"])}

    result = portfolio_returns(equity, returns, dropped_days_by_key={"k": {"2026-02-03"}})

    assert [row["date"] for row in result.rows] == ["2026-02-02", "2026-02-04"]
    assert result.undefined_return_days == 1
    assert result.skipped_nonpositive_days == 0
    assert result.nonfinite_days == 0
    # the same input without the stored day is the old behaviour: r = 0 on the flat day
    old = portfolio_returns(equity, returns)
    assert [row["date"] for row in old.rows] == ["2026-02-02", "2026-02-03", "2026-02-04"]
    assert old.rows[1]["r"] == 0.0 and old.undefined_return_days == 0


def test_the_payload_still_satisfies_the_readers_contract() -> None:
    """``extractTrustworthyDerivedSeries`` (src/lib/queries.ts) accepts a non-empty
    returns array in STRICTLY ascending date order with finite values, and nothing about
    the days being contiguous (a skipped day is already a possible shape). A payload with a
    dropped day absent must still meet it."""
    payload = _compose(funding_and_dominated_book())
    dates = [row["date"] for row in payload["returns"]]

    assert payload["version"] == 2 and payload["is_trustworthy"] is True
    assert dates, "returns must stay non-empty"
    assert all(a < b for a, b in zip(dates, dates[1:])), "strictly ascending"
    assert all(math.isfinite(row["r"]) for row in payload["returns"])


def test_an_old_row_with_no_stored_pnl_composes_as_before() -> None:
    """No stored P&L -> no dropped days to know about -> the pre-WR-01 arithmetic, with
    the old r = 0 on a day that is in the level series for another reason (a flow)."""
    ordinary = pd.Series(
        [0.0, 0.01, 0.01], index=["2026-08-01", "2026-08-02", "2026-08-04"], name="k"
    )
    payload = compose_allocator_equity(
        {"k": ordinary},
        {"k": [ExternalFlow(utc_day_iso="2026-08-03", usd_signed=50.0)]},
        {"k": 1000.0},
    )
    returns = _ret(payload)
    assert returns["2026-08-03"] == 0.0  # a flow-only day: r = 0 is right (D-06)
    assert "missing_return_inside_coverage" not in payload["flags"]
