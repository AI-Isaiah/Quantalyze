"""Phase 188 TINYBASE plan 02 - the book follows the realized-era rule with no compose change
(SC-2, SC-3, SC-5; plan 01 T-OQ5).

What this pins
--------------
A key whose realized-era tiny days the writer left out stores each day's real P&L in
``key_inputs.dropped_day_pnl`` (the field the compose already reads, 167.1.2.2 D-15). The real
``compose_allocator_equity`` then makes the key sit out those days' return sums and keeps every
dollar level. The book here is ``tiny_base_after_withdrawal_book()`` (the exact-arithmetic
oracle, key C's realized shape): the funding day 0, a withdrawal on day 30 that leaves exactly
400, and tiny days 31, 32 and 33 with P&L +188, -310 and -29 on start NAVs 400, 588 and 278.

Hand arithmetic. The stored returns are the oracle's own ``pnl / prior nav`` on every day the
writer keeps, and the tiny days (31..33) have no stored return. Every curve level is the
oracle's exact NAV. For two keys, key B returns a constant 0.001 a day with no flows, so on a
tiny day of key A the book return is B's 0.001 alone (A sits out the numerator AND the
denominator). The honest gap (RESEARCH option A): leaving the day's return out while its
dollars stay in the curve means the chained identity ``curve_t = curve_{t-1}(1 + r_t) + F_t``
is off by exactly the tiny key's P&L less ``r_t`` times its prior level; for a sole key there is
no ``r_t``, so the curve moves by exactly the P&L.

Why each test can fail: on a book whose oracle does not restate the rule, the tiny days keep
their returns (+0.47, -310/588, -29/278) and the absent-day assertions fail; a compose that
read the missing return as 0.0 fails the "never 0.0" and the level assertions; and the
no-stored-P&L partner shows the levels are wrong without the field.
"""
from __future__ import annotations

import logging
from fractions import Fraction

import pandas as pd
import pytest

from services.allocator_equity_compose import compose_allocator_equity
from tests.test_allocator_equity_dropped_day_pnl import (
    _levels_error,
    _replay,
    tiny_base_after_withdrawal_book,
)
from tests.test_allocator_equity_dropped_day_returns import _compose, _curve, _ret

TINY = (31, 32, 33)


def test_the_fixture_is_key_cs_shape() -> None:
    """Independent of the code under test: the closing levels the arithmetic says."""
    book = tiny_base_after_withdrawal_book()
    assert [float(book.nav[i]) for i in (30, 31, 32, 33)] == [400.0, 588.0, 278.0, 249.0]
    assert [float(book.pnl[i]) for i in TINY] == [188.0, -310.0, -29.0]
    assert float(book.prev[30]) > 90000  # the withdrawal day opens on a normal NAV


def test_a_sole_key_leaves_the_tiny_days_out_of_its_returns_and_keeps_every_level() -> None:
    book = tiny_base_after_withdrawal_book()
    assert book.dropped_idx == [0, 31, 32, 33]
    payload = _compose(book)
    returns, curve = _ret(payload), _curve(payload)

    for i in TINY:
        assert book.days[i] not in returns, book.days[i]  # SC-5: absent, never 0.0
    assert all(r != 0.0 for day, r in returns.items() if day != book.days[30])
    # the withdrawal day opens on a normal NAV and carries a real return of exactly 0
    assert returns[book.days[30]] == 0.0
    # every measured day is the writer's definition, pnl / prior nav
    for i in range(1, 31):
        assert returns[book.days[i]] == pytest.approx(float(book.pnl[i] / book.nav[i - 1]), rel=1e-9)
    # and every dollar level is the oracle's NAV
    for i, day in enumerate(book.days):
        assert curve[day] == pytest.approx(float(book.nav[i]), rel=1e-9), day
    assert payload["is_trustworthy"] is True
    assert payload["degrade_reasons"] == []


def test_the_curve_moves_by_exactly_the_days_pnl_when_the_return_is_left_out() -> None:
    """The bounded gap, sole key: no return row, so the curve step minus the day's flow IS the
    tiny key's P&L (188, -310, -29), to the cent."""
    book = tiny_base_after_withdrawal_book()
    curve = _curve(_compose(book))

    for i, want in zip(TINY, (188.0, -310.0, -29.0)):
        step = curve[book.days[i]] - curve[book.days[i - 1]] - float(book.flow[i])
        assert step == pytest.approx(want, abs=1e-6), book.days[i]


def _two_key_payload(book, caplog=None):
    n = len(book.days)
    rb = Fraction(1, 1000)
    b_anchor = Fraction(250_000)
    b_level = [b_anchor / (1 + rb) ** (n - 1 - i) for i in range(n)]
    b_returns = pd.Series([float(rb)] * n, index=book.days, name="b")
    kwargs = dict(
        full_history_keys={"a"},
        dropped_day_pnl_by_key={"a": book.dropped_pnl},
    )
    args = (
        {"a": book.stored_returns, "b": b_returns},
        {"a": book.flows, "b": []},
        {"a": book.anchor, "b": float(b_anchor)},
    )
    if caplog is None:
        return compose_allocator_equity(*args, **kwargs), b_level, rb
    with caplog.at_level(logging.WARNING, logger="services.allocator_equity_compose"):
        return compose_allocator_equity(*args, **kwargs), b_level, rb


def test_with_two_keys_the_tiny_key_sits_out_numerator_and_denominator() -> None:
    book = tiny_base_after_withdrawal_book()
    payload, _b_level, rb = _two_key_payload(book)
    returns = _ret(payload)

    for i in TINY:
        # key A has no defined return, so the book return is key B's alone, exactly
        assert returns[book.days[i]] == pytest.approx(float(rb), abs=1e-12), book.days[i]


def test_with_two_keys_the_gap_is_the_tiny_pnl_less_the_return_on_its_prior_level() -> None:
    """The identity curve_t = curve_{t-1}(1 + r_t) + F_t is NOT asserted on a tiny day; its
    miss is pnl_A - r_t * level_A(t-1), a number the oracle states exactly."""
    book = tiny_base_after_withdrawal_book()
    payload, _b_level, rb = _two_key_payload(book)
    returns, curve = _ret(payload), _curve(payload)

    for i in TINY:
        day, prev_day = book.days[i], book.days[i - 1]
        r = returns[day]
        miss = curve[day] - curve[prev_day] * (1 + r) - float(book.flow[i])
        want = float(book.pnl[i] - rb * book.nav[i - 1])
        assert miss == pytest.approx(want, abs=1e-6), day


def test_the_tiny_days_are_reported_not_silent_and_the_log_carries_counts_only(
    caplog: pytest.LogCaptureFixture,
) -> None:
    book = tiny_base_after_withdrawal_book()
    payload, _b_level, _rb = _two_key_payload(book, caplog)

    assert "missing_return_inside_coverage" in payload["flags"]
    assert payload["is_trustworthy"] is True  # reported, not blocking
    (record,) = [r for r in caplog.records if "left the day out" in r.getMessage()]
    text = record.getMessage()
    assert text.startswith("compose: 3 key-day(s)")  # days 31, 32, 33 of key A: a count
    for leak in ("188", "310", "-29", "2026-03"):
        assert leak not in text, leak


def test_without_the_stored_pnl_the_early_levels_are_off_by_the_tiny_days_pnl() -> None:
    """Why the P&L is stored at all: with an old payload (no ``dropped_day_pnl``) the replay
    reads each tiny day as flat, so every level BEFORE them is off by their summed P&L,
    188 - 310 - 29 = -151, measured at day 30 (400 true against the 249 anchor, which the replay
    places on day 30 because that is the last day with anything stored)."""
    book = tiny_base_after_withdrawal_book()

    ke = _replay(book, with_pnl=False)
    # no stored return and no stored P&L: the tail days are not in the level series at all, and
    # the 249 anchor lands on the last day that has a return (day 30) instead of day 33
    assert book.days[31] not in ke.equity.index
    assert float(ke.equity[book.days[30]]) - float(book.nav[30]) == pytest.approx(-151.0, abs=1e-6)
    # day 30's own return is 0, so the whole stretch before it shifts by the same -151
    assert float(ke.equity[book.days[29]]) - float(book.nav[29]) == pytest.approx(-151.0, abs=1e-6)

    exact = _levels_error(book, _replay(book, with_pnl=True))
    assert max(abs(e) for e in exact) < 1e-6 * float(book.nav[30]) + 1e-6
