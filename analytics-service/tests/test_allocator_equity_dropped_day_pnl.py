"""Phase 167.1.2.2 D-15 — a day the TWR writer drops still has P&L, and the compose uses it.

THE DEFECT (debug .planning/debug/derivecron-compose-divergence.md, Follow-up 2). The
D-13 zero-start check read "this day has no stored return" as "this day had no P&L". It
did: the writer leaves a day out when its prior capital cannot be a denominator (the
funding day, ``negative_nav_guard``; a day whose prior NAV is dust,
``dust_nav_guard``), and such a day's P&L is real and already inside the NAV. So
the check measured one ordinary day's P&L as "missing start capital", and the replay's
forced ``r = 0`` moved a dropped interior day's P&L into every earlier level.

THE FIX UNDER TEST. The derive stores each dropped day's actual P&L in ``key_inputs``
(``dropped_day_pnl``); the compose (1) uses it on those days instead of ``r = 0`` and
(2) checks the real invariant ``level(d0) - pnl(d0) - F(d0)`` within the 1e-4 band.

THE ORACLE IS INDEPENDENT OF THE CODE UNDER TEST. Every book is built FORWARD in exact
``fractions.Fraction`` arithmetic from a CHOSEN pre-funding capital (0 for a clean
account): ``nav_t = nav_{t-1} + pnl_t + F_t``. The expected levels are those navs. The
expected dropped set is the writer's own published guard rule restated here as three
literals (prev <= 0, prev < the $100 dust floor, |pnl| >= 10 x prev), and
``test_the_oracle_book_is_what_the_real_writer_produces`` pins that restatement against
the real ``chain_linked_twr`` so the fixture cannot drift from the writer.

FLOWTIMING (164.6.6.2.3 D-05): the writer used to drop a FOURTH kind of day, one whose flow
was at least the prior NAV (``flow_dominated_guard``). That guard is deleted; a flow, however
large, never drops a day. So the rule above has three literals, the "dominated" fixture's
deposit day is a MEASURED day (it carries a return and is no longer in ``dropped_idx``), and
the tests that need an INTERIOR dropped day use a day the remaining guards still drop
(``funding_and_dust_interior_book``).

167.1.2 D-27 moved the dust floor from 1000 to 100. The interior dropped days those fixtures
exist to produce used to be dust-base drops; they are now ``pnl_dominated_guard`` drops on a
base of at least 100 (a base under 100 would be an EMPTIED level, which is not the case under
test). The ``dust`` names of the fixture and of its parametrize id are kept as lineage.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from fractions import Fraction

import pandas as pd
import pytest

from services.allocator_equity_derive import (
    DegradeReason,
    dropped_day_pnl_payload,
    read_dropped_day_pnl,
    replay_key_equity,
    stitch_dropped_day_pnl,
)
from services.broker_dailies import (
    combine_mt5_deal_ledger,
    combine_native_ledger,
    mt5_day_pnl,
    native_ledger_day_pnl,
)
from services.external_flows import ExternalFlow
from services.native_nav import NativeLedger
from services.nav_twr import chain_linked_twr, level_day_pnl

# The founder's band (D-14), restated: the test must not read it from the module it checks.
BAND = Fraction(1, 10_000)

D0 = date(2026, 2, 1)

# The writer's guard rule, restated as literals (DQ-01 / Phase 92 HARD-01). The flow clause
# (|F| >= prev) is gone with the flow-dominated guard (164.6.6.2.3 D-05).
# 167.1.2 D-27: the USD dust floor is 100 (it was 1000), restated here as a literal, never read
# from the module it checks. It equals EMPTIED_RESTART_FLOOR_USD, so a dropped day that is meant
# to stay INTERIOR must open on a base of at least 100 and be dropped by the P&L guard instead.
_DUST = Fraction(100)
_PNL_DOM = Fraction(10)


def _iso(i: int) -> str:
    return (D0 + timedelta(days=i)).isoformat()


# ── the exact-arithmetic oracle ──────────────────────────────────────────────


@dataclass
class Book:
    """A ledger built forward from a chosen pre-funding capital, in exact arithmetic."""

    c0: Fraction
    pnl: list[Fraction]
    flow: list[Fraction]

    def __post_init__(self) -> None:
        self.nav: list[Fraction] = []
        self.prev: list[Fraction] = []
        level = Fraction(self.c0)
        for p, f in zip(self.pnl, self.flow):
            self.prev.append(level)
            level = level + p + f
            self.nav.append(level)

    @property
    def days(self) -> list[str]:
        return [_iso(i) for i in range(len(self.pnl))]

    def is_dropped(self, i: int) -> bool:
        prev, p = self.prev[i], self.pnl[i]
        return (
            prev <= 0
            or prev < _DUST
            or abs(p) >= _PNL_DOM * prev
        )

    @property
    def dropped_idx(self) -> list[int]:
        return [i for i in range(len(self.pnl)) if self.is_dropped(i)]

    @property
    def stored_returns(self) -> pd.Series:
        """What the writer persists: ``pnl / prev`` on every day it does not drop."""
        keep = [i for i in range(len(self.pnl)) if not self.is_dropped(i)]
        return pd.Series(
            [float(self.pnl[i] / self.prev[i]) for i in keep],
            index=[_iso(i) for i in keep],
            name="k",
        )

    @property
    def flows(self) -> list[ExternalFlow]:
        return [
            ExternalFlow(_iso(i), float(f)) for i, f in enumerate(self.flow) if f != 0
        ]

    @property
    def dropped_pnl(self) -> dict[str, float]:
        """The oracle's own statement of D-15's payload: each dropped day's real P&L."""
        return {_iso(i): float(self.pnl[i]) for i in self.dropped_idx}

    @property
    def anchor(self) -> float:
        return float(self.nav[-1])

    def share(self) -> Fraction:
        """The capital before the first flow as a share of the first return day's level."""
        first_return = min(i for i in range(len(self.pnl)) if not self.is_dropped(i))
        return abs(self.c0) / self.nav[first_return]


def _window_pnl(n: int) -> list[Fraction]:
    """Integer daily P&L for ``n`` ordinary days (a fixed, non-trivial pattern)."""
    pattern = [2500, -1800, 3100, 900, -2200, 1400, -600, 2700, -3300, 800]
    return [Fraction(pattern[i % len(pattern)]) for i in range(n)]


def _window_flow(n: int) -> list[Fraction]:
    """Small flows on a few ordinary days (never dominating the prior NAV)."""
    return [
        Fraction(2000) if i % 9 == 4 else Fraction(-1500) if i % 9 == 7 else Fraction(0)
        for i in range(n)
    ]


def funding_and_dominated_book(c0: Fraction = Fraction(0)) -> Book:
    """The PROD account-A shape: a funding day with P&L (day 0), an ordinary day, a
    deposit larger than the prior NAV carrying its own P&L (day 2), then ordinary days.

    FLOWTIMING D-05: day 2 was dropped by ``flow_dominated_guard``; it is now a MEASURED
    day (P&L / prior NAV, the flow counted at the end of the day), so the only dropped
    day is the funding day 0. The shape is kept: it is the account the writer used to
    drop twice, and the compose must now reproduce its levels from one dropped day."""
    pnl = [Fraction(-683), Fraction(-110), Fraction(-700), Fraction(7600)] + _window_pnl(26)
    flow = [Fraction(192875), Fraction(0), Fraction(450000), Fraction(9000)] + _window_flow(26)
    return Book(c0, pnl, flow)


def funding_and_dust_interior_book(c0: Fraction = Fraction(0)) -> Book:
    """The funding-and-dominated account with an INTERIOR dropped day the writer still drops.

    FLOWTIMING D-05 retired the flow-dominated drop that used to make day 2 of
    ``funding_and_dominated_book`` the interior dropped day. The tests that exist to prove
    an interior dropped day's P&L keeps every earlier level exact need a day the remaining
    guards still drop. Here day 2 withdraws almost the whole book (NAV 382, above the
    emptied band, and at the D-27 floor of 100 a measured base, no longer dust), so day 3,
    which opens on that 382 NAV and carries a 450000 deposit and a 7600 P&L (at least ten
    times the base), is dropped by ``pnl_dominated_guard``. Day 2 itself is a measured day
    (its withdrawal no longer drops it). The base stays at or above 100 on purpose: under
    100 the level would be an EMPTIED level, not an interior dropped day."""
    pnl = [Fraction(-683), Fraction(-110), Fraction(-700), Fraction(7600)] + _window_pnl(26)
    flow = [Fraction(192875), Fraction(0), Fraction(-191000), Fraction(450000)] + _window_flow(26)
    return Book(c0, pnl, flow)


def two_day_run_book() -> Book:
    """The MT5 opening shape: TWO consecutive funding days before the first return day
    (day 1's deposit exceeds day 0's NAV), each with P&L.

    FLOWTIMING D-05: day 1 used to be dropped because its 300000 deposit dominated day 0's
    NAV. A dominating deposit is measured now, so the run is kept by the guard that still
    applies: day 0 funds only 900 (NAV 217 after its -683). 167.1.2 D-27 moved the dust floor
    to 100, so 217 is a measured base, not dust; day 1 is kept dropped by ``pnl_dominated_guard``
    instead: its P&L of 2400 is at least ten times the 217 prior NAV (2170), and it carries the
    large deposit. The base stays at or above 100 so the day is not an emptied level."""
    pnl = [Fraction(-683), Fraction(2400), Fraction(-90)] + _window_pnl(27)
    flow = [Fraction(900), Fraction(300000), Fraction(0)] + _window_flow(27)
    return Book(Fraction(0), pnl, flow)


def _levels_error(book: Book, ke) -> list[float]:
    assert ke.equity is not None
    return [float(ke.equity[d]) - float(book.nav[i]) for i, d in enumerate(book.days)]


def _replay(book: Book, *, with_pnl: bool = True):
    return replay_key_equity(
        book.stored_returns,
        book.flows,
        book.anchor,
        history_reaches_inception=True,
        dropped_day_pnl=book.dropped_pnl if with_pnl else None,
    )


# ── the fixture is what the real writer produces ─────────────────────────────


@pytest.mark.parametrize(
    "book",
    [
        funding_and_dominated_book(),
        two_day_run_book(),
        funding_and_dust_interior_book(),
        # D-27: a 900 start is a measured base at the 100 floor; 99 is still dust (and still
        # outside the band), so the funding day stays dropped and the zero-start check is made.
        funding_and_dominated_book(Fraction(99)),
        funding_and_dominated_book(Fraction(20000)),
    ],
    ids=[
        "funding+dominated",
        "two-day-run",
        "dust-interior",
        "missing-start-capital",
        "real-start-capital-measured-funding-day",
    ],
)
def test_the_oracle_book_is_what_the_real_writer_produces(book: Book) -> None:
    """The restated guard rule must match ``chain_linked_twr`` day for day, and
    ``level_day_pnl`` must return the oracle's P&L on every day — the dropped ones
    included. Otherwise every test below proves things about a fixture, not the writer."""
    index = pd.DatetimeIndex([pd.Timestamp(d) for d in book.days])
    nav = pd.Series([float(x) for x in book.nav], index=index)
    pnl = pd.Series([float(x) for x in book.pnl], index=index)
    flows = pd.Series([float(x) for x in book.flow], index=index)

    returns, _flags = chain_linked_twr(nav, pnl, flows, prev0=float(book.c0))

    assert [i for i, v in enumerate(returns) if pd.isna(v)] == book.dropped_idx
    kept = returns.dropna()
    assert [d.date().isoformat() for d in kept.index] == list(book.stored_returns.index)
    assert list(kept) == pytest.approx(list(book.stored_returns), rel=1e-12)

    day_pnl = level_day_pnl(nav, flows, prev0=float(book.c0))
    assert list(day_pnl) == pytest.approx([float(x) for x in book.pnl], rel=1e-12, abs=1e-9)


# ── 1. the funding day's P&L reconciles at 1e-4 ──────────────────────────────


def test_pnl_on_the_funding_day_reconciles_at_the_band() -> None:
    book = funding_and_dominated_book()
    assert book.c0 == 0 and book.dropped_idx[:1] == [0]  # a real funding day, P&L -683
    ke = _replay(book)

    assert ke.degrade_reasons == frozenset()
    assert ke.is_trustworthy is True
    assert ke.flags["opening_flows_reconciled"] == 1
    assert "inception_unreconciled_flows" not in ke.flags


def test_without_the_stored_pnl_the_funding_day_reads_as_missing_capital() -> None:
    """The defect, pinned: the same account, an old payload (no stored P&L), measures
    the funding day's P&L as capital that was never funded. The share is far outside
    the band (it is one ordinary day's P&L), and it is NOT genuinely missing capital:
    the oracle's pre-funding capital is exactly 0."""
    book = funding_and_dominated_book()
    ke = _replay(book, with_pnl=False)

    first_return = min(i for i in range(len(book.pnl)) if not book.is_dropped(i))
    measured = abs(book.pnl[0]) / book.nav[first_return]
    assert measured > 3 * BAND  # the fixture bites: the P&L is well outside the band
    assert ke.degrade_reasons == frozenset({DegradeReason.INCEPTION_UNRECONCILED})
    assert ke.flags["inception_unreconciled_flows"] == 1


# ── 2. an interior dropped day, every early level equals the true NAV ──


def test_the_dominating_deposit_day_is_measured_not_dropped() -> None:
    """FLOWTIMING D-05, pinned on the fixture the guard used to drop: day 2's 450000 deposit
    exceeds the 192082 prior NAV, and the writer now gives the day a return (its P&L over the
    prior NAV, the flow at the end of the day), so only the funding day is left out and the
    replay still reproduces every level from that one stored P&L."""
    book = funding_and_dominated_book()
    assert book.flow[2] > book.prev[2]  # the deposit dominates the prior NAV
    assert book.dropped_idx == [0]
    assert _iso(2) in book.stored_returns.index
    # the prior NAV is 192875 - 683 - 110 = 192082
    assert book.stored_returns[_iso(2)] == pytest.approx(-700 / 192082, rel=1e-12)
    ke = _replay(book)

    assert ke.degrade_reasons == frozenset()
    for i, day in enumerate(book.days):
        assert float(ke.equity[day]) == pytest.approx(float(book.nav[i]), rel=1e-9), day
    assert ke.flags["dropped_day_pnl_days"] == 1


def test_a_real_start_capital_makes_the_funding_day_a_measured_day() -> None:
    """With 20000 in the account before the first flow the funding day has a real base, so
    FLOWTIMING D-05 measures it (a 192875 deposit no longer drops it). There is no dropped
    funding day and so no zero-start check to fail: the capital is inside the day-0 return."""
    book = funding_and_dominated_book(Fraction(20000))
    assert book.dropped_idx == []
    assert _iso(0) in book.stored_returns.index
    ke = _replay(book)

    assert ke.degrade_reasons == frozenset()
    assert "inception_unreconciled_flows" not in ke.flags
    for i, day in enumerate(book.days):
        assert float(ke.equity[day]) == pytest.approx(float(book.nav[i]), rel=1e-9), day


def test_pnl_on_a_dust_base_interior_day_keeps_every_early_level_exact() -> None:
    """Re-aimed (FLOWTIMING D-05, then D-27). This test used to drop a flow-dominated interior
    day; that drop is gone, so it drops an interior day the guards still drop: day 3 opens on
    a 382 NAV after day 2's near-total withdrawal. 167.1.2 D-27 made 382 a measured base (the
    floor is 100), so the day is dropped by ``pnl_dominated_guard`` (7600 >= 10 x 382), on a
    base that is still at or above 100 and therefore not an emptied level."""
    book = funding_and_dust_interior_book()
    assert book.dropped_idx == [0, 3] and book.pnl[3] == 7600  # the interior dropped day
    assert book.prev[3] >= _DUST  # D-27: a measured base, not dust and not emptied
    assert abs(book.pnl[3]) >= _PNL_DOM * book.prev[3]  # dropped by pnl_dominated_guard
    ke = _replay(book)

    # EVERY level, the early ones (days 0-1, before the dropped day) included, is the
    # true NAV. 1e-9 relative is ~6 orders tighter than the -700 error it must exclude.
    for i, day in enumerate(book.days):
        assert float(ke.equity[day]) == pytest.approx(float(book.nav[i]), rel=1e-9), day
    assert ke.flags["dropped_day_pnl_days"] == 2


def test_without_the_stored_pnl_the_early_levels_are_off_by_the_dropped_days_pnl() -> None:
    """Why the fix is needed at all, as a number: forcing r = 0 on the dropped day
    mis-states the levels BEFORE it by that day's P&L (here 7600 in magnitude). The dropped
    day is the pnl-dominated interior day 3 (FLOWTIMING D-05 retired the flow-dominated one;
    D-27 moved the dust floor under its 382 base)."""
    book = funding_and_dust_interior_book()
    err = _levels_error(book, _replay(book, with_pnl=False))

    assert abs(err[2]) == pytest.approx(7600, rel=1e-6)  # day 2 is before dropped day 3
    assert abs(err[4]) < 1e-6  # days after it are exact either way


def test_a_two_day_opening_run_reads_the_capital_before_its_first_flow() -> None:
    book = two_day_run_book()
    assert book.dropped_idx[:2] == [0, 1]
    ke = _replay(book)

    assert ke.degrade_reasons == frozenset()
    assert ke.flags["opening_flows_reconciled"] == 2
    for i, day in enumerate(book.days):
        assert float(ke.equity[day]) == pytest.approx(float(book.nav[i]), rel=1e-9), day


# ── 3. genuine missing start capital still blocks, under the honest name ─────


@pytest.mark.parametrize(
    ("c0", "blocks"),
    [
        (Fraction(9), False),  # ~0.47 x the band
        (Fraction(40), True),  # ~2.1 x the band
        # ~0.05% of the book. A larger positive start (e.g. 20000) is no longer a case: with
        # a real base the funding day is MEASURED (D-05), so there is no dropped day to check.
        # D-27 moved the dust floor to 100, so a 900 start is a real base too; 99 is the largest
        # whole start still under it (dust), keeping the funding day dropped.
        (Fraction(99), True),
        (Fraction(-20000), True),  # an overdrawn start is as unreconciled
    ],
)
def test_missing_start_capital_blocks_only_outside_the_band(c0: Fraction, blocks: bool) -> None:
    book = funding_and_dominated_book(c0)
    assert 0 in book.dropped_idx  # the funding day is dropped, so the check is made
    share = book.share()
    assert (share > BAND) is blocks
    assert not (Fraction(8, 10) * BAND < share < Fraction(12, 10) * BAND)  # off the line
    ke = _replay(book)

    if blocks:
        assert ke.degrade_reasons == frozenset({DegradeReason.INCEPTION_UNRECONCILED})
        assert ke.flags["inception_unreconciled_flows"] == 1
        assert ke.is_trustworthy is False
    else:
        assert ke.degrade_reasons == frozenset()
        assert ke.flags["opening_flows_reconciled"] == 1


# ── 4. an old payload without the field behaves exactly as before ────────────


def test_an_absent_or_empty_field_is_todays_behaviour() -> None:
    book = funding_and_dominated_book()
    args = (book.stored_returns, book.flows, book.anchor)
    absent = replay_key_equity(*args, history_reaches_inception=True)
    none = replay_key_equity(*args, history_reaches_inception=True, dropped_day_pnl=None)
    empty = replay_key_equity(*args, history_reaches_inception=True, dropped_day_pnl={})

    for other in (none, empty):
        assert list(other.equity) == list(absent.equity)
        assert other.flags == absent.flags
        assert other.degrade_reasons == absent.degrade_reasons
    # And that behaviour is the D-13 one: the funding day's P&L blocks the key.
    assert absent.degrade_reasons == frozenset({DegradeReason.INCEPTION_UNRECONCILED})
    assert absent.flags == {"inception_unreconciled_flows": 1}


def test_reading_an_old_row_gives_no_dropped_days_and_does_not_crash() -> None:
    old_row = {"flows": [], "anchor_usd": 1.0, "venue": "deribit"}
    assert read_dropped_day_pnl(old_row) == {}
    assert read_dropped_day_pnl({**old_row, "dropped_day_pnl": None}) == {}
    assert read_dropped_day_pnl({**old_row, "dropped_day_pnl": []}) == {}


def test_a_malformed_field_raises_rather_than_being_read_as_a_guess() -> None:
    """The job disposes ValueError/TypeError/KeyError as a corrupt input (permanent),
    exactly as it does for a malformed ``flows`` row."""
    for bad in (
        [{"utc_day_iso": "2026-02-01"}],  # no amount
        [{"utc_day_iso": "not-a-day", "pnl_usd": 1.0}],
        [{"utc_day_iso": "2026-02-01", "pnl_usd": float("nan")}],
        [{"utc_day_iso": "2026-02-01", "pnl_usd": "x"}],
        # WR-02: ``float(True) == 1.0`` would read a JSON boolean as one dollar.
        [{"utc_day_iso": "2026-02-01", "pnl_usd": True}],
        [{"utc_day_iso": "2026-02-01", "pnl_usd": False}],
        # WR-02: the writer emits one row per day; a repeat is corruption, and summing
        # it would move every earlier level by the duplicate.
        [{"utc_day_iso": "2026-02-01", "pnl_usd": 5.0},
         {"utc_day_iso": "2026-02-01", "pnl_usd": 5.0}],
        [{"utc_day_iso": "2026-02-01", "pnl_usd": 5.0},
         {"utc_day_iso": "2026-02-01", "pnl_usd": -5.0}],
    ):
        with pytest.raises((ValueError, TypeError, KeyError)):
            read_dropped_day_pnl({"dropped_day_pnl": bad})


def test_distinct_days_and_integer_amounts_still_read() -> None:
    """The guard is not over-wide: an int amount (JSON has no int/float split) and
    two different days are the normal payload."""
    got = read_dropped_day_pnl({"dropped_day_pnl": [
        {"utc_day_iso": "2026-02-01", "pnl_usd": -683},
        {"utc_day_iso": "2026-02-03", "pnl_usd": 12.5},
    ]})
    assert got == {"2026-02-01": -683.0, "2026-02-03": 12.5}


def test_a_stored_pnl_on_a_day_that_has_a_return_is_ignored_and_counted() -> None:
    """The return row and a P&L cannot both describe a day: a P&L added on top would
    count the day twice. The return wins, and the count is visible."""
    book = funding_and_dominated_book()
    on_a_return_day = _iso(10)
    assert on_a_return_day in book.stored_returns.index
    ke = replay_key_equity(
        book.stored_returns,
        book.flows,
        book.anchor,
        history_reaches_inception=True,
        dropped_day_pnl={**book.dropped_pnl, on_a_return_day: 99_999.0},
    )

    for i, day in enumerate(book.days):
        assert float(ke.equity[day]) == pytest.approx(float(book.nav[i]), rel=1e-9), day
    assert ke.flags["dropped_day_pnl_ignored_days"] == 1
    # M2: it is also a BLOCKING degrade reason under an honest name. A stored P&L on a
    # day that has a return means the row and the returns are from different runs.
    assert ke.degrade_reasons == frozenset({DegradeReason.KEY_INPUTS_MISMATCH})
    assert ke.is_trustworthy is False


def test_a_clean_replay_raises_no_key_inputs_mismatch() -> None:
    """The reason fires on the ignored entry and on nothing else."""
    ke = _replay(funding_and_dominated_book())
    assert DegradeReason.KEY_INPUTS_MISMATCH not in ke.degrade_reasons
    assert "dropped_day_pnl_ignored_days" not in ke.flags


def test_the_compose_surfaces_the_mismatch_and_logs_counts_only(caplog) -> None:
    """The count flag never leaves ``replay_key_equity`` (the compose keeps only the
    ``True`` flags), so the reason has to be the thing that reaches the payload, and
    the WARNING carries the count and no key, day or amount."""
    import logging

    from services.allocator_equity_compose import compose_allocator_equity

    book = funding_and_dominated_book()
    on_a_return_day = _iso(10)
    pnl = {**book.dropped_pnl, on_a_return_day: 99_999.0, _iso(11): 88_888.0}
    with caplog.at_level(logging.WARNING, logger="services.allocator_equity_compose"):
        payload = compose_allocator_equity(
            {"k": book.stored_returns}, {"k": book.flows}, {"k": book.anchor},
            full_history_keys={"k"}, dropped_day_pnl_by_key={"k": pnl},
        )

    assert "key_inputs_mismatch" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    (record,) = [r for r in caplog.records if "stored dropped-day P&L" in r.getMessage()]
    assert record.levelno == logging.WARNING
    text = record.getMessage()
    assert text.startswith("compose: 2 stored dropped-day P&L")
    for leak in ("99999", "88888", on_a_return_day, _iso(11)):
        assert leak not in text


def test_a_clean_compose_logs_no_mismatch_warning(caplog) -> None:
    import logging

    from services.allocator_equity_compose import compose_allocator_equity

    book = funding_and_dominated_book()
    with caplog.at_level(logging.WARNING, logger="services.allocator_equity_compose"):
        payload = compose_allocator_equity(
            {"k": book.stored_returns}, {"k": book.flows}, {"k": book.anchor},
            full_history_keys={"k"}, dropped_day_pnl_by_key={"k": book.dropped_pnl},
        )
    assert payload["degrade_reasons"] == []
    assert not [r for r in caplog.records if "stored dropped-day P&L" in r.getMessage()]


def test_a_non_finite_stored_pnl_is_refused() -> None:
    from services.nav_twr import NavReconstructionError

    book = funding_and_dominated_book()
    with pytest.raises(NavReconstructionError):
        replay_key_equity(
            book.stored_returns,
            book.flows,
            book.anchor,
            history_reaches_inception=True,
            dropped_day_pnl={_iso(0): float("inf")},
        )


# ── 5. both venue shapes, through the real writers ───────────────────────────


def _epoch(i: int) -> int:
    d = D0 + timedelta(days=i)
    return int(datetime(d.year, d.month, d.day, 12, tzinfo=timezone.utc).timestamp())


def _mt5_deals(book: Book) -> list[dict]:
    deals: list[dict] = []
    for i, (p, f) in enumerate(zip(book.pnl, book.flow)):
        if f != 0:
            deals.append(
                {"type": 2, "profit": float(f), "swap": 0.0, "commission": 0.0,
                 "fee": 0.0, "time": _epoch(i)}
            )
        assert p != 0  # a trading deal every day, so the writer adds no gap-filled day
        deals.append(
            {"type": 1, "entry": 1, "profit": float(p), "swap": 0.0, "commission": 0.0,
             "fee": 0.0, "time": _epoch(i)}
        )
    return deals


def _persisted_roundtrip(returns: pd.Series, day_pnl: pd.Series) -> dict[str, float]:
    """What the derive writes into ``key_inputs`` and what the compose job reads back."""
    payload = {"dropped_day_pnl": dropped_day_pnl_payload(returns, day_pnl)}
    return read_dropped_day_pnl(payload)


def _stored(returns: pd.Series) -> pd.Series:
    kept = returns.dropna()
    return pd.Series(
        list(kept), index=[d.date().isoformat() for d in kept.index], name="k"
    )


@pytest.mark.parametrize(
    "book",
    [funding_and_dominated_book(), two_day_run_book(), funding_and_dust_interior_book()],
    ids=["funding+dominated", "two-day-run", "dust-interior"],
)
def test_mt5_deal_ledger_shape_end_to_end(book: Book) -> None:
    """MT5: deals -> the real combine (returns) + ``mt5_day_pnl`` (P&L) -> the stored
    payload -> the compose's replay. The levels are the oracle's navs."""
    deals = _mt5_deals(book)
    returns, meta = combine_mt5_deal_ledger(
        deals, account_equity=book.anchor, account_balance=book.anchor
    )
    day_pnl = mt5_day_pnl(deals)

    stored_pnl = _persisted_roundtrip(returns, day_pnl)
    assert stored_pnl == pytest.approx(book.dropped_pnl)  # exactly the dropped days
    if book.c0 == 0:
        # 164.6.6.2.3 D-01/D-12: the MT5 combiner declares full history, so a funding day with
        # no capital before it is the INCEPTION day. It is still dropped from the returns (the
        # dropped set above is unchanged, and so is its stored P&L), but by the inception rule,
        # not by a negative or dust warning the account would carry for ever.
        assert pd.isna(returns.iloc[0]) and book.dropped_idx[0] == 0
        if book.dropped_idx == [0]:
            # Nothing else is dropped, so no guard key can come from another day: the
            # inception day alone raised no warning. (The other books drop a LATER day as
            # pnl-dominated on purpose (D-27), and that day does warn.)
            assert not any(
                k in meta for k in ("negative_nav_guard", "dust_nav_guard", "pnl_dominated_guard")
            )

    ke = replay_key_equity(
        _stored(returns),
        book.flows,
        book.anchor,
        history_reaches_inception=True,
        dropped_day_pnl=stored_pnl,
    )
    assert ke.degrade_reasons == frozenset()
    for i, day in enumerate(book.days):
        assert float(ke.equity[day]) == pytest.approx(float(book.nav[i]), rel=1e-9), day


def test_mt5_day_pnl_is_empty_without_a_trading_deal() -> None:
    """Like the returns path: a deposit-only ledger has no track record to complete."""
    deal = {"type": 2, "profit": 100.0, "swap": 0.0, "commission": 0.0, "fee": 0.0,
            "time": _epoch(0)}
    assert mt5_day_pnl([deal]).empty


def _usdc_native_ledger(book: Book) -> NativeLedger:
    """A Deribit-shaped ledger in a USD-family currency (mark = 1.0): native P&L per
    day, native flows, and the terminal native equity the §5 inception gate reconciles
    against an expected pre-history balance of 0."""
    pnl = pd.Series(
        [float(p) for p in book.pnl],
        index=pd.DatetimeIndex([pd.Timestamp(d) for d in book.days]),
        name="native_pnl",
    )
    return NativeLedger(
        native_pnl={"USDC": pnl},
        terminal_native_equity={"USDC": book.anchor},
        marks={},
        native_flows=[
            ExternalFlow(_iso(i), float(f), "USDC", float(f))
            for i, f in enumerate(book.flow)
            if f != 0
        ],
        terminal_upnl_native={},
        full_history=True,
    )


@pytest.mark.parametrize(
    "book",
    [funding_and_dominated_book(), two_day_run_book(), funding_and_dust_interior_book()],
    ids=["funding+dominated", "two-day-run", "dust-interior"],
)
def test_deribit_native_ledger_shape_end_to_end(book: Book) -> None:
    ledger = _usdc_native_ledger(book)
    returns, _meta = combine_native_ledger(ledger, frozenset())
    day_pnl = native_ledger_day_pnl(ledger, frozenset())

    stored_pnl = _persisted_roundtrip(returns, day_pnl)
    assert stored_pnl == pytest.approx(book.dropped_pnl)

    ke = replay_key_equity(
        _stored(returns),
        book.flows,
        book.anchor,
        history_reaches_inception=True,
        dropped_day_pnl=stored_pnl,
    )
    assert ke.degrade_reasons == frozenset()
    for i, day in enumerate(book.days):
        assert float(ke.equity[day]) == pytest.approx(float(book.nav[i]), rel=1e-9), day


def test_deribit_coin_margined_pnl_includes_the_revaluation_of_the_balance() -> None:
    """Deribit holds coin. The P&L the compose needs is the change in USD NAV net of
    flows (``NAV_t - NAV_{t-1} - F_t``), which includes the mark move on the balance
    already held; the native P&L times the day's mark alone would miss it, and the
    replay's levels would then not equal the NAV. Built forward in exact arithmetic
    from a zero start in BTC, marks changing every day.

    FLOWTIMING D-05: this used to drop the day of a 9-BTC deposit (flow-dominated), whose
    prior balance was ~4 BTC. That drop is gone, so the dropped day with a prior balance
    to revalue is re-aimed at a guard that remains: day 2 withdraws all but 1/256 BTC
    (about 193 USD, above the emptied band), and the 9-BTC deposit
    lands on day 3, which opens on that small balance.

    167.1.2 D-27 (the dust floor is 100): that balance is now a measured base, no longer dust,
    so day 3 is dropped by ``pnl_dominated_guard`` instead. Its native P&L is raised from 2/64
    to 3/64 BTC so its USD P&L (about 2407) is at least ten times the roughly 193 USD prior NAV,
    while the base stays at or above 100 (under 100 it would be an EMPTIED level, not the
    interior dropped day this test exists to prove). Day 3's P&L still has to include the mark
    move on the 1/256 BTC already held."""
    q_pnl = [Fraction(-1, 64), Fraction(-3, 64), Fraction(5, 64)] + [
        Fraction(k, 64) for k in (3, -3, 4, -1, 5, -2, 3, 1, -4, 2, -1, 3, 2, -2, 1)
    ]
    q_flow = [Fraction(4), Fraction(0), Fraction(-1027, 256), Fraction(9)] + [Fraction(0)] * 14
    marks = [Fraction(m) for m in (
        50000, 50800, 49500, 51200, 50100, 52300, 51700, 50900, 53100, 52400,
        51000, 52800, 53500, 52100, 51300, 54000, 53200, 52600,
    )]
    n = len(q_pnl)
    bal: list[Fraction] = []
    b = Fraction(0)
    for qp, qf in zip(q_pnl, q_flow):
        b = b + qp + qf
        bal.append(b)
    nav = [bal[i] * marks[i] for i in range(n)]
    flow_usd = [q_flow[i] * marks[i] for i in range(n)]
    prev = [Fraction(0)] + nav[:-1]
    pnl_usd = [nav[i] - prev[i] - flow_usd[i] for i in range(n)]
    composed_only = [q_pnl[i] * marks[i] for i in range(n)]
    assert any(pnl_usd[i] != composed_only[i] for i in range(1, n))  # revaluation is real

    def dropped(i: int) -> bool:
        return (
            prev[i] <= 0 or prev[i] < _DUST or abs(pnl_usd[i]) >= _PNL_DOM * prev[i]
        )

    dropped_idx = [i for i in range(n) if dropped(i)]
    assert dropped_idx == [0, 3]  # the funding day and the pnl-dominated day of the 9-BTC deposit
    assert prev[3] >= _DUST  # D-27: a measured base (not dust), and not an emptied level either
    assert abs(pnl_usd[3]) >= _PNL_DOM * prev[3]  # day 3 is dropped by pnl_dominated_guard
    assert abs(q_flow[2]) > bal[1]  # day 2's withdrawal exceeds the BTC held, and the day is MEASURED

    idx = pd.DatetimeIndex([pd.Timestamp(_iso(i)) for i in range(n)])
    ledger = NativeLedger(
        native_pnl={"BTC": pd.Series([float(x) for x in q_pnl], index=idx)},
        terminal_native_equity={"BTC": float(bal[-1])},
        marks={"BTC": pd.Series([float(m) for m in marks], index=idx)},
        native_flows=[
            ExternalFlow(_iso(i), float(flow_usd[i]), "BTC", float(q_flow[i]))
            for i in range(n)
            if q_flow[i] != 0
        ],
        terminal_upnl_native={},
        full_history=True,
    )
    returns, _ = combine_native_ledger(ledger, frozenset({"BTC"}))
    day_pnl = native_ledger_day_pnl(ledger, frozenset({"BTC"}))
    assert [pd.isna(v) for v in returns] == [i in dropped_idx for i in range(n)]

    stored_pnl = _persisted_roundtrip(returns, day_pnl)
    assert stored_pnl == pytest.approx({_iso(i): float(pnl_usd[i]) for i in dropped_idx})

    ke = replay_key_equity(
        _stored(returns),
        [ExternalFlow(_iso(i), float(flow_usd[i])) for i in range(n) if q_flow[i] != 0],
        float(nav[-1]),
        history_reaches_inception=True,
        dropped_day_pnl=stored_pnl,
    )
    assert ke.degrade_reasons == frozenset()
    for i in range(n):
        assert float(ke.equity[_iso(i)]) == pytest.approx(float(nav[i]), rel=1e-9), i


# ── the writer's payload rows ────────────────────────────────────────────────


def test_the_payload_holds_only_the_days_the_writer_left_out() -> None:
    returns = pd.Series(
        [float("nan"), 0.01, float("nan"), -0.02],
        index=pd.DatetimeIndex(["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04"]),
    )
    day_pnl = pd.Series(
        [-683.0, 12.0, -700.0],  # no entry for the last day: it has a return anyway
        index=pd.DatetimeIndex(["2026-02-01", "2026-02-02", "2026-02-03"]),
    )
    assert dropped_day_pnl_payload(returns, day_pnl) == [
        {"utc_day_iso": "2026-02-01", "pnl_usd": -683.0},
        {"utc_day_iso": "2026-02-03", "pnl_usd": -700.0},
    ]


def test_a_dropped_day_with_no_stored_pnl_is_left_out_not_invented() -> None:
    returns = pd.Series([float("nan"), 0.01], index=pd.DatetimeIndex(["2026-02-01", "2026-02-02"]))
    day_pnl = pd.Series([5.0], index=pd.DatetimeIndex(["2026-02-02"]))
    assert dropped_day_pnl_payload(returns, day_pnl) == []


# ── a stitched shared account keeps each dropped day with the member that owns it ─


def test_stitched_dropped_days_follow_the_flow_ownership_rule() -> None:
    older = pd.Series([0.01, 0.02, 0.03], index=["2026-02-02", "2026-02-03", "2026-02-04"])
    newer = pd.Series([0.01, 0.02], index=["2026-02-04", "2026-02-05"])
    out = stitch_dropped_day_pnl(
        [older, newer],
        [
            # the first member keeps its pre-window funding day; its day 02-04 belongs
            # to the newer member, and a crawl reaching back over it must not count twice
            {"2026-02-01": -683.0, "2026-02-04": 111.0},
            {"2026-02-01": 555.0, "2026-02-04": 222.0, "2026-02-06": 7.0},
        ],
    )
    assert out == {"2026-02-01": -683.0, "2026-02-04": 222.0, "2026-02-06": 7.0}


# ── the derive epilogue: what key_inputs carries, per venue ──────────────────


def _key_inputs_payload(capture: dict, key_id: str) -> dict:
    rows = [
        payload
        for name, payload, _oc in capture["upserts"]
        if name == "allocator_equity_derived"
        and isinstance(payload, dict)
        and payload.get("kind") == f"key_inputs:{key_id}"
    ]
    assert len(rows) == 1, capture["upserts"]
    return rows[0]["payload"]


def _csv_returns(capture: dict) -> pd.Series:
    rows: dict[str, float] = {}
    for name, payload, _oc in capture["upserts"]:
        if name == "csv_daily_returns":
            for row in payload:
                rows[row["date"]] = float(row["daily_return"])
    return pd.Series(rows, name="k").sort_index()


@pytest.mark.asyncio
async def test_mt5_key_mode_persists_the_dropped_day_pnl_and_the_compose_reads_it_back(
    monkeypatch,
) -> None:
    """MT5, through the whole key-mode derive job: the deal ledger -> csv_daily_returns
    (the writer drops the funding day and the pnl-dominated interior day, D-27; FLOWTIMING D-05 retired
    the flow-dominated drop this test used to name) AND key_inputs.dropped_day_pnl (their
    real P&L). Feeding both to the compose's replay gives the oracle's navs."""
    import services.mt5_concurrency as mt5_conc
    from unittest.mock import AsyncMock, patch

    from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
    from tests.test_mt5_derive_branch import (
        _apply,
        _build_ctx as _mt5_build_ctx,
        _FakeMt5Transport,
    )

    monkeypatch.setenv("MT5_ENABLED", "true")
    book = funding_and_dust_interior_book()
    assert book.dropped_idx == [0, 3]
    transport = _FakeMt5Transport(
        account={"equity": book.anchor, "balance": book.anchor, "currency": "USD",
                 "login": 123456},
        deals=_mt5_deals(book),
    )
    ctx, capture = _mt5_build_ctx(transport)
    ctx.strategy_row = None  # key-mode: the allocator path has no strategy row
    mt5_conc.reset_terminal_state_for_tests()
    try:
        with _apply([
            patch("services.job_worker._allocator_key_preflight", new=AsyncMock(return_value=ctx)),
            patch("services.job_worker.aclose_exchange", new=AsyncMock()),
            patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
        ]):
            result = await run_derive_broker_dailies_job(
                {"id": "j-mt5-key", "kind": "derive_broker_dailies", "api_key_id": "key-mt5"}
            )
    finally:
        mt5_conc.reset_terminal_state_for_tests()

    assert result.outcome == DispatchOutcome.DONE
    payload = _key_inputs_payload(capture, "key-mt5")
    assert "native_inception" not in payload  # MT5 has no native §5 verdict to state
    stored_pnl = read_dropped_day_pnl(payload)
    assert stored_pnl == pytest.approx(book.dropped_pnl)

    ke = replay_key_equity(
        _csv_returns(capture),
        [ExternalFlow(f["utc_day_iso"], f["usd_signed"]) for f in payload["flows"]],
        payload["anchor_usd"],
        history_reaches_inception=True,
        dropped_day_pnl=stored_pnl,
    )
    assert ke.degrade_reasons == frozenset()
    for i, day in enumerate(book.days):
        assert float(ke.equity[day]) == pytest.approx(float(book.nav[i]), rel=1e-9), day


@pytest.mark.asyncio
async def test_deribit_key_mode_persists_the_dropped_day_pnl_and_the_native_verdict() -> None:
    from unittest.mock import MagicMock, patch

    from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
    from tests.test_mtm_single_key import (
        _apply,
        _base_patches,
        _ctx,
        _ledger_meta,
        _recording_ledger,
        _report,
    )

    idx = pd.DatetimeIndex(["2024-05-01", "2024-05-02", "2024-05-03", "2024-05-04", "2024-05-05"])
    returns = pd.Series([float("nan"), 0.01, float("nan"), -0.02, 0.005], index=idx)
    day_pnl = pd.Series([-683.0, 12.0, -700.0, -30.0, 5.0], index=idx)
    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    ledger_mock, _calls = _recording_ledger([_report(has_option_activity=False)])
    combine = MagicMock(return_value=(returns, _ledger_meta()))
    day_pnl_mock = MagicMock(return_value=day_pnl)

    with _apply(_base_patches(ctx, key_mode=True, ledger_mock=ledger_mock, combine_mock=combine)), patch(
        "services.broker_dailies.native_ledger_day_pnl", new=day_pnl_mock
    ):
        result = await run_derive_broker_dailies_job(
            {"id": "j", "kind": "derive_broker_dailies", "api_key_id": "key-drb"}
        )

    assert result.outcome == DispatchOutcome.DONE
    payload = _key_inputs_payload(capture, "key-drb")
    # Exactly the two days the writer left out, not the days that carry a return.
    assert payload["dropped_day_pnl"] == [
        {"utc_day_iso": "2024-05-01", "pnl_usd": -683.0},
        {"utc_day_iso": "2024-05-03", "pnl_usd": -700.0},
    ]
    # The stub ledger reaches inception, so the §5 gate ran (and passed: a breach raises).
    assert payload["native_inception"] == "reconciled"
    # The P&L is asked of the SAME ledger and indexable set the returns came from.
    (called_ledger, called_indexable), _kw = day_pnl_mock.call_args
    assert called_ledger is combine.call_args.args[0]
    assert called_indexable == combine.call_args.args[1]


@pytest.mark.asyncio
async def test_a_deribit_ledger_that_does_not_reach_inception_states_no_verdict() -> None:
    """The §5 gate is skipped for a retention-capped ledger, so there is no verdict to
    state, and none is invented."""
    from dataclasses import replace
    from unittest.mock import MagicMock, patch

    from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
    from tests.test_mtm_single_key import (
        _apply,
        _base_patches,
        _ctx,
        _ledger_meta,
        _report,
        _stub_native_ledger,
    )

    idx = pd.DatetimeIndex(["2024-05-01", "2024-05-02", "2024-05-03"])
    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    capped = replace(_stub_native_ledger(), full_history=False)

    async def _build(*_a, **_k):
        return capped, _report(has_option_activity=False)

    from unittest.mock import AsyncMock

    with _apply(_base_patches(
        ctx, key_mode=True, ledger_mock=AsyncMock(side_effect=_build),
        combine_mock=MagicMock(return_value=(pd.Series([0.01, -0.02, 0.03], index=idx), _ledger_meta())),
    )), patch(
        "services.broker_dailies.native_ledger_day_pnl",
        new=MagicMock(return_value=pd.Series(dtype="float64")),
    ):
        result = await run_derive_broker_dailies_job(
            {"id": "j", "kind": "derive_broker_dailies", "api_key_id": "key-drb"}
        )

    assert result.outcome == DispatchOutcome.DONE
    payload = _key_inputs_payload(capture, "key-drb")
    assert "native_inception" not in payload
    assert payload["dropped_day_pnl"] == []


@pytest.mark.asyncio
async def test_a_ccxt_key_persists_the_payload_it_always_did() -> None:
    """A venue whose reconstruction builds no per-day NAV here (binance via ccxt) writes
    none of the new fields: its row is exactly the shape every older reader knows."""
    from tests.test_derive_broker_dailies_dualmode import (
        _build_ctx,
        _patches,
        _two_day_returns,
    )
    from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job

    ctx, capture = _build_ctx(
        key_row={"id": "key-b", "exchange": "binance", "user_id": "alloc-b"}, strategy_row=None
    )
    patches = _patches(ctx, key_mode=True, returns=_two_day_returns())
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await run_derive_broker_dailies_job(
            {"id": "j", "kind": "derive_broker_dailies", "api_key_id": "key-b"}
        )

    assert result.outcome == DispatchOutcome.DONE
    payload = _key_inputs_payload(capture, "key-b")
    # NAVMTM plan 15: a Binance derive now makes a mark outcome of its own (L4). This harness's
    # exchange is a bare mock with no readable balance, so the outcome is a refusal token and
    # the payload gains exactly that one additive field; the per-day NAV fields stay absent.
    assert set(payload) == {
        "flows", "anchor_usd", "anchor_null_reason", "anchor_asof", "venue", "nav_mark_refusal",
    }
    assert payload["nav_mark_refusal"] == "balance_error"


# ── the compose job: the stored field reaches the replay ─────────────────────


async def _compose_curve(
    book: Book,
    *,
    with_pnl: bool,
    anchor: float | None = None,
    ki_extra: dict | None = None,
    job_extra: dict | None = None,
) -> dict:
    from unittest.mock import patch

    from services.job_worker import run_derive_allocator_equity_job
    from tests.test_derive_allocator_equity_job import (
        DERIVED_TABLE,
        _extract_payload,
        _FakeSupabase,
        _is_equity_curve_upsert,
    )

    alloc = "alloc-d15"
    ki_payload: dict = {
        "flows": [{"utc_day_iso": f.utc_day_iso, "usd_signed": f.usd_signed} for f in book.flows],
        "anchor_usd": book.anchor if anchor is None else anchor,
        "anchor_null_reason": None,
        "anchor_asof": f"{book.days[-1]}T06:00:00+00:00",
        "venue": "deribit",
        **(ki_extra or {}),
    }
    if with_pnl:
        ki_payload["dropped_day_pnl"] = [
            {"utc_day_iso": d, "pnl_usd": p} for d, p in book.dropped_pnl.items()
        ]
    fake = _FakeSupabase({
        "api_keys": [{
            "id": "key-D", "user_id": alloc, "is_active": True, "sync_status": "connected",
            "disconnected_at": None, "exchange": "deribit",
        }],
        "csv_daily_returns": [
            {"api_key_id": "key-D", "allocator_id": alloc, "date": d, "daily_return": r}
            for d, r in book.stored_returns.items()
        ],
        DERIVED_TABLE: [{"allocator_id": alloc, "kind": "key_inputs:key-D", "payload": ki_payload}],
        "allocator_equity_snapshots": [],
    })
    with patch("services.job_worker.get_supabase", return_value=fake):
        await run_derive_allocator_equity_job(
            {"id": "j-compose", "kind": "derive_allocator_equity", "allocator_id": alloc,
             **(job_extra or {})}
        )
    upserts = [u for u in fake.upserts if u[0] == DERIVED_TABLE and _is_equity_curve_upsert(u[1])]
    assert len(upserts) == 1, fake.upserts
    return _extract_payload(upserts[0][1])


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "book",
    [funding_and_dominated_book(), funding_and_dust_interior_book()],
    ids=["funding+dominated", "dust-interior"],
)
async def test_the_compose_job_uses_the_stored_pnl_and_the_curve_is_trustworthy(book: Book) -> None:
    payload = await _compose_curve(book, with_pnl=True)

    assert payload["degrade_reasons"] == []
    assert payload["is_trustworthy"] is True
    curve = {row["date"]: row["equity_usd"] for row in payload["curve"]}
    for i, day in enumerate(book.days):
        assert curve[day] == pytest.approx(float(book.nav[i]), rel=1e-9), day


@pytest.mark.asyncio
async def test_the_compose_job_composes_an_old_row_exactly_as_before() -> None:
    """A key_inputs row written before D-15 has no field. It composes without a crash
    and under the D-13 verdict it had: the funding day's P&L reads as missing capital."""
    book = funding_and_dominated_book()
    payload = await _compose_curve(book, with_pnl=False)

    assert payload["degrade_reasons"] == ["inception_unreconciled"]
    assert payload["is_trustworthy"] is False


@pytest.mark.asyncio
async def test_a_stitched_account_takes_each_dropped_days_pnl_from_the_key_that_owns_the_day() -> None:
    """The compose job's stitch: the older key H owns 2026-05-10, a day its writer left
    out (no return) and whose real P&L it stored. The newer key M's crawl reaches back
    over the same day and stores a P&L for it too. One account, one P&L: H's is the
    account's, and M's must not be added on top."""
    from services.allocator_equity_derive import replay_key_equity
    from tests.test_derive_allocator_equity_job import (
        _ROTATION_NEW_DAYS,
        _ROTATION_OLD_DAYS,
        DERIVED_TABLE,
        MARKED_ANCHOR,
        _composed_payload,
        _rotation_pair,
        _run_gate,
    )

    alloc = "alloc-stitch-dropped"
    dropped_day = "2026-05-10"
    fake = _rotation_pair(alloc, "duplicate")
    fake.rows["csv_daily_returns"] = [
        r for r in fake.rows["csv_daily_returns"]
        if not (r["api_key_id"] == "key-H" and r["date"] == dropped_day)
    ]
    for row in fake.rows[DERIVED_TABLE]:
        if row["kind"] == "key_inputs:key-H":
            row["payload"]["dropped_day_pnl"] = [{"utc_day_iso": dropped_day, "pnl_usd": 123.0}]
        if row["kind"] == "key_inputs:key-M":
            row["payload"]["dropped_day_pnl"] = [{"utc_day_iso": dropped_day, "pnl_usd": 999.0}]
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)

    days = [d for d in _ROTATION_OLD_DAYS if d < "2026-06-01" and d != dropped_day] + _ROTATION_NEW_DAYS
    returns = pd.Series(
        [0.001 if d < "2026-06-01" else 0.002 for d in days], index=days, dtype="float64"
    )

    def _levels(pnl: float) -> dict[str, float]:
        eq = replay_key_equity(
            returns, [], MARKED_ANCHOR, dropped_day_pnl={dropped_day: pnl}
        ).equity
        return {str(d): float(v) for d, v in eq.items()}

    got = {row["date"]: row["equity_usd"] for row in payload["curve"]}
    want = _levels(123.0)
    assert dropped_day in got  # the dropped day is a day of the curve
    for day, value in want.items():
        assert got[day] == pytest.approx(value, rel=1e-9), day
    # the fixture bites: counting both members' P&L would move the early levels
    assert abs(_levels(123.0 + 999.0)["2026-05-01"] - want["2026-05-01"]) > 500


@pytest.mark.asyncio
async def test_a_departed_keys_dropped_day_pnl_is_read_with_the_rest_of_its_inputs() -> None:
    """A disconnected key's history stays in the book to its end day, replayed from its
    saved anchor. Its saved dropped-day P&L must reach that replay too, or its early
    levels are off by that day's P&L exactly as a live key's were."""
    from services.allocator_equity_derive import replay_key_equity
    from tests.test_allocator_equity_departed import (
        ALLOC,
        DAYS,
        DEP_ANCHOR,
        DEP_R,
        _book,
        _curve,
        _live_and_departed,
        _live_level,
        _run,
    )
    from tests.test_derive_allocator_equity_job import DERIVED_TABLE, _gate_key

    dropped_day = DAYS[3]
    dep_days = DAYS[:10]
    departed = _gate_key(
        "key-D", ALLOC, venue_account_id="acct-departed",
        disconnected_at="2026-06-10T15:30:00+00:00",
    )
    fake = _live_and_departed(departed, dep_days)
    fake.rows["csv_daily_returns"] = [
        r for r in fake.rows["csv_daily_returns"]
        if not (r["api_key_id"] == "key-D" and r["date"] == dropped_day)
    ]
    for row in fake.rows[DERIVED_TABLE]:
        if row["kind"] == "key_inputs:key-D":
            row["payload"]["dropped_day_pnl"] = [{"utc_day_iso": dropped_day, "pnl_usd": 50.0}]
    assert (await _run(fake)).outcome.name == "DONE"
    got = _curve(_book(fake))

    kept = [d for d in dep_days if d != dropped_day]
    dep_levels = replay_key_equity(
        pd.Series([DEP_R] * len(kept), index=kept), [], DEP_ANCHOR,
        dropped_day_pnl={dropped_day: 50.0},
    ).equity
    for day in dep_days:
        assert got[day] == pytest.approx(_live_level(day) + float(dep_levels[day]), rel=1e-12), day
    # the fixture bites: without the P&L the day-1 level would differ by 50/(1+r)^k
    bare = replay_key_equity(
        pd.Series([DEP_R] * len(kept), index=kept), [], DEP_ANCHOR
    ).equity
    assert abs(float(bare[dep_days[0]]) - float(dep_levels[dep_days[0]])) > 40
