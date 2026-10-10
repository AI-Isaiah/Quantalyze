"""Phase 167.1.2.2.1 SC-3 (founder D-01, D-02 as amended by D-04 and D-07) — an emptied account
composes as zero capital instead of refusing the allocator's book.

THE DEFECT (debug note derivecron-compose-refusal). The compose refuses any
non-positive reconstructed level (``non-positive reconstructed equity on N of M``).
An account that withdrew everything, sat empty and later re-deposited reconstructs to
a level of exactly or nearly zero for the whole stretch, and float noise (``+1e-6``
passes, ``0.0`` and ``-1e-6`` refuse) decided whether the allocator's whole book was
refused.

THE RULE UNDER TEST (founder, 2026-10-09). A day whose reconstructed level is below
1% of the PRIOR peak is emptied: its level is exactly ``0.0``, it writes no return
weight into the book, and the key is neither refused nor degraded (D-01). The prior
peak is the maximum over EARLIER non-emptied levels only, never a later one (D-02). A
deposit that ends a stretch restarts the peak at that day's level (D-04), but ONLY a
deposit that lifts the level to at least 1% of the prior peak ends it: a smaller (dust)
deposit leaves the stretch running and the peak untouched (D-07, 2026-10-10, which
amends D-04 after one deposit of about 1e-8 of the peak was measured on PROD restarting
the peak at dust and leaving near-zero days classified live).

THE ORACLE IS INDEPENDENT OF THE CODE UNDER TEST. The book is built FORWARD in exact
``fractions.Fraction`` arithmetic (``level_t = level_{t-1} * (1 + r_t) + F_t + P_t``)
and the expected classification is the founder's 1% restated here as
``Fraction(1, 100)``, applied to the exact forward levels. It is never read from the
module it checks.
"""
from __future__ import annotations

from datetime import date, timedelta
from fractions import Fraction
from typing import Any

import pandas as pd
import pytest

from services.allocator_equity_derive import (
    DegradeReason,
    NavReconstructionError,
    replay_key_equity,
)
from services.external_flows import ExternalFlow

# The founder's number (D-01), restated on purpose: the test must not import it.
EMPTIED = Fraction(1, 100)
# The founder's absolute floor (D-08 / D-09, 2026-10-10), restated on purpose too. A level is
# emptied only below the SMALLER of EMPTIED * peak and this amount.
FLOOR_USD = Fraction(100)

D0 = date(2026, 2, 1)
_N = 36  # days 0..35

# The three flag keys that exist only when a stretch exists (PATTERNS finding 3).
_STRETCH_FLAGS = ("emptied_stretch_days", "emptied_stretches", "emptied_stretch")


def _iso(i: int) -> str:
    return (D0 + timedelta(days=i)).isoformat()


# Exact level on day 9: 100 compounded at +1%/day for nine days.
_PEAK = Fraction(100) * Fraction(101, 100) ** 9


class Stretch:
    """The PATTERNS section C synthetic key, built forward in exact arithmetic.

    Days 0..``withdraw_day``-1 are funded (+1%/day from a 100 deposit on day 0). The
    withdraw day withdraws the whole level and leaves ``stretch_level`` (its stored
    P&L is the stretch level, so the stored day is consistent). The days after it are
    empty (r = 0 rows) until ``redeposit_day`` re-deposits ``redeposit`` (``None``: the
    stretch runs to the last day). Days after the re-deposit carry ``post_r``.
    Defaults are the plan's key: withdraw on day 10, re-deposit 50 on day 30.
    ``dust_day`` / ``dust`` add one more deposit of ``dust`` on ``dust_day`` (the PROD
    shape D-07 names): the writer drops that flow-dominated day from the returns and
    stores a dropped-day P&L of 0 for it. ``dust_day=None`` leaves every key unchanged.
    ``withdraw_day=None`` is a key funded throughout (+1%/day, no withdrawal).
    """

    def __init__(
        self,
        stretch_level: Fraction,
        redeposit: Fraction = Fraction(50),
        *,
        withdraw_day: int | None = 10,
        redeposit_day: int | None = 30,
        post_r: float = 0.0,
        dust_day: int | None = None,
        dust: Fraction = Fraction(0),
    ) -> None:
        self.stretch_level = Fraction(stretch_level)
        self.redeposit = Fraction(redeposit)
        self.withdraw_day = withdraw_day
        self.redeposit_day = redeposit_day
        self.post_r = post_r
        self.dust_day = dust_day
        self.dust = Fraction(dust)
        wd = _N if withdraw_day is None else withdraw_day  # first day not compounding
        self.pre_withdraw = Fraction(100) * Fraction(101, 100) ** (wd - 1)
        # forward oracle
        self.level: list[Fraction] = []
        lvl = Fraction(0)
        for i in range(_N):
            if i == 0:
                lvl = Fraction(100)
            elif i < wd:
                lvl = lvl * Fraction(101, 100)
            elif i == withdraw_day:
                lvl = self.stretch_level  # whole level withdrawn, stretch level left
            elif dust_day is not None and i == dust_day:
                lvl = lvl + self.dust
            elif redeposit_day is not None and i == redeposit_day:
                lvl = lvl + self.redeposit
            elif redeposit_day is not None and i > redeposit_day:
                lvl = lvl * (1 + Fraction(post_r))
            self.level.append(lvl)

    @property
    def returns(self) -> pd.Series:
        rows: dict[str, float] = {}
        for i in range(1, _N):
            if self.withdraw_day is None or i < self.withdraw_day:
                rows[_iso(i)] = 0.01
            elif i in (self.withdraw_day, self.redeposit_day, self.dust_day):
                continue  # the writer drops the withdrawal, re-deposit and dust-deposit days
            elif self.redeposit_day is not None and i > self.redeposit_day:
                rows[_iso(i)] = self.post_r
            else:
                rows[_iso(i)] = 0.0
        return pd.Series(rows, name="k").sort_index()

    @property
    def flows(self) -> list[ExternalFlow]:
        out = [ExternalFlow(_iso(0), 100.0)]
        if self.withdraw_day is not None:
            out.append(ExternalFlow(_iso(self.withdraw_day), -float(self.pre_withdraw)))
        if self.redeposit_day is not None:
            out.append(ExternalFlow(_iso(self.redeposit_day), float(self.redeposit)))
        if self.dust_day is not None:
            out.append(ExternalFlow(_iso(self.dust_day), float(self.dust)))
        return out

    @property
    def dropped_pnl(self) -> dict[str, float]:
        out: dict[str, float] = {}
        if self.withdraw_day is not None:
            out[_iso(self.withdraw_day)] = float(self.stretch_level)
        if self.redeposit_day is not None:
            out[_iso(self.redeposit_day)] = 0.0
        if self.dust_day is not None:
            out[_iso(self.dust_day)] = 0.0
        return out

    @property
    def anchor(self) -> float:
        return float(self.level[-1])

    def oracle_emptied(self) -> list[bool]:
        """The founder's rule on the exact forward levels: below the smaller of 1% of the
        earlier peak and 100 USD (D-09), with the peak restarting on a deposit the day after
        an emptied day (D-04) only when that deposit lifts the day's exact level out of the
        band (D-07). A smaller deposit leaves the stretch running."""
        out: list[bool] = []
        peak: Fraction | None = None
        deposits = {d for d, amt in ((self.redeposit_day, self.redeposit), (self.dust_day, self.dust)) if d is not None and amt > 0}
        for i, lvl in enumerate(self.level):
            ends_stretch = (
                i > 0
                and out[i - 1]
                and i in deposits
                and peak is not None
                and lvl >= min(EMPTIED * peak, FLOOR_USD)
            )
            if peak is not None and lvl < min(EMPTIED * peak, FLOOR_USD) and not ends_stretch:
                out.append(True)
                continue
            out.append(False)
            if lvl > 0:
                peak = lvl if (peak is None or ends_stretch) else max(peak, lvl)
        return out

    def replay(self, **kw: Any):
        return replay_key_equity(
            self.returns,
            self.flows,
            kw.pop("anchor", self.anchor),
            history_reaches_inception=True,
            dropped_day_pnl=self.dropped_pnl,
            **kw,
        )


# ── SC-3: the synthetic withdraw-100% / sit-at-zero / re-deposit key ──────────


@pytest.mark.parametrize("stretch", [Fraction(0), Fraction(-1, 10**6)], ids=["zero", "minus-1e-6"])
def test_a_stretch_at_or_below_zero_composes_instead_of_refusing(stretch: Fraction) -> None:
    key = Stretch(stretch)
    ke = key.replay()

    assert ke.equity is not None
    assert len(ke.equity) == _N
    # Days 10-29 are exactly zero capital, not merely small.
    for i in range(10, 30):
        assert float(ke.equity.loc[_iso(i)]) == 0.0, i
    # The funded days before and after are the exact forward levels.
    for i in list(range(0, 10)) + list(range(30, _N)):
        assert float(ke.equity.loc[_iso(i)]) == pytest.approx(float(key.level[i]), rel=1e-9), i
    assert ke.degrade_reasons == frozenset()
    assert ke.is_trustworthy is True


def test_a_stretch_at_plus_1e_6_is_exactly_zero_not_float_noise() -> None:
    """Passed on the old code by float luck with a day-15 level of ~1e-6."""
    key = Stretch(Fraction(1, 10**6))
    ke = key.replay()

    assert ke.equity is not None
    assert float(ke.equity.loc[_iso(15)]) == 0.0
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in range(10, 30))


@pytest.mark.parametrize(
    "stretch", [Fraction(0), Fraction(-1, 10**6), Fraction(1, 10**6)], ids=["zero", "minus-1e-6", "plus-1e-6"]
)
def test_the_stretch_flags_are_counts_and_a_bool_beside_the_existing_ones(stretch: Fraction) -> None:
    ke = Stretch(stretch).replay()

    assert ke.flags["emptied_stretch_days"] == 20
    assert ke.flags["emptied_stretches"] == 1
    assert ke.flags["emptied_stretch"] is True
    # The pre-existing flags are still there (subset assertion on exactly these keys).
    assert ke.flags["dropped_day_pnl_days"] == 2
    assert ke.flags["opening_flows_reconciled"] == 1
    assert ke.degrade_reasons == frozenset()


def test_the_oracle_agrees_with_the_replay_day_by_day() -> None:
    """The exact forward classification (the founder's 1%) matches the zeroed days."""
    key = Stretch(Fraction(-1, 10**6))
    ke = key.replay()
    assert ke.equity is not None
    expected = key.oracle_emptied()
    assert sum(expected) == 20
    for i, empty in enumerate(expected):
        assert (float(ke.equity.loc[_iso(i)]) == 0.0) is empty, i


# ── the 1% boundary, restated and never imported ─────────────────────────────


def test_a_level_at_0_99_percent_of_the_prior_peak_is_emptied() -> None:
    key = Stretch(Fraction(99, 10_000) * _PEAK)
    assert key.stretch_level < EMPTIED * _PEAK  # fixture guard
    ke = key.replay()

    assert ke.equity is not None
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in range(10, 30))
    assert ke.flags["emptied_stretch_days"] == 20


def test_a_level_at_1_01_percent_of_the_prior_peak_is_not_emptied() -> None:
    key = Stretch(Fraction(101, 10_000) * _PEAK)
    assert key.stretch_level > EMPTIED * _PEAK  # fixture guard
    ke = key.replay()

    assert ke.equity is not None
    for i in range(10, 30):
        assert float(ke.equity.loc[_iso(i)]) == pytest.approx(float(key.stretch_level), rel=1e-9), i
    # No stretch: none of the three flags exist, and the rest are exactly as before (C3).
    assert not any(k in ke.flags for k in _STRETCH_FLAGS)
    assert ke.flags == {"dropped_day_pnl_days": 2, "opening_flows_reconciled": 1}


# ── D-02: the peak is EARLIER levels only ────────────────────────────────────


def test_a_later_larger_deposit_does_not_reclassify_the_past() -> None:
    """A huge re-deposit on day 30 must not make days 10-29 'less than 1% of a later
    peak' (they were already emptied) nor un-empty them, and the days after it are
    compared with the restarted peak, not the old one."""
    key = Stretch(Fraction(0), redeposit=Fraction(1_000_000))
    ke = key.replay()

    assert ke.equity is not None
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in range(10, 30))
    for i in range(30, _N):
        assert float(ke.equity.loc[_iso(i)]) == pytest.approx(float(key.level[i]), rel=1e-9), i
    assert ke.flags["emptied_stretch_days"] == 20
    assert ke.flags["emptied_stretches"] == 1


# ── Pitfall 6 / non-positive without a peak ──────────────────────────────────


def test_a_non_positive_level_with_no_prior_peak_still_refuses() -> None:
    """Level zero from the first day: nothing was ever positive, so nothing is 'emptied'."""
    r = pd.Series([0.0, 0.0, 0.0], index=[_iso(0), _iso(1), _iso(2)], name="k")
    with pytest.raises(NavReconstructionError, match="non-positive reconstructed equity"):
        replay_key_equity(r, [], 0.0)


def test_degrade_reason_set_gains_no_emptied_member() -> None:
    """D-01: an emptied stretch is neither refused nor degraded, so the rule adds no
    DegradeReason member (C4 is a plan-level statement; no test pins the whole enum)."""
    assert not any("EMPTIED" in m.name for m in DegradeReason)


# ═══ Task 2: edge variants, data-fault hardening, the last-day anchor, the payload ═══


# ── Pitfall 5 / CR-01: a stored return explains a stretch's first day ────────


def _loss_collapse() -> tuple[pd.Series, list[ExternalFlow], float, Fraction]:
    """+1%/day for nine days, then a -99.5% return on day 10 with NO withdrawal and NO
    stored day P&L, then flat. The level falls to 0.5% of the peak, and the ledger
    explains it: the writer's own stored return IS the account's loss that day (a loss
    is never dropped from the TWR unless it is P&L-dominated, and a -99.5% day is not).
    That is an account that lost its way to dust, which composes as zero capital (D-01),
    exactly as it did before the Pitfall 5 hardening (CR-01, review round 1)."""
    rows = {_iso(i): 0.01 for i in range(1, 10)}
    rows[_iso(10)] = -0.995
    rows |= {_iso(i): 0.0 for i in range(11, _N)}
    final = _PEAK * Fraction(5, 1000)
    return pd.Series(rows, name="k"), [ExternalFlow(_iso(0), 100.0)], float(final), final


def test_a_loss_driven_collapse_with_a_stored_return_composes_as_zero_capital() -> None:
    """CR-01. Was ``test_a_collapse_with_no_withdrawal_and_no_day_pnl_still_refuses``,
    which pinned the wrong rule (a stored return read as a data fault)."""
    r, flows, anchor, _ = _loss_collapse()
    ke = replay_key_equity(r, flows, anchor, history_reaches_inception=True)

    assert ke.equity is not None
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in range(10, _N))
    assert float(ke.equity.loc[_iso(9)]) == pytest.approx(float(_PEAK), rel=1e-9)
    assert ke.flags["emptied_stretch_days"] == _N - 10
    assert ke.flags["emptied_stretches"] == 1
    assert ke.degrade_reasons == frozenset()
    assert ke.is_trustworthy is True


def test_the_same_collapse_with_a_stored_day_pnl_is_zero_capital() -> None:
    """The writer-dropped variant of the case above: the same fall, explained by a
    stored dropped-day P&L instead of a stored return."""
    r, flows, anchor, _ = _loss_collapse()
    r = r.drop(_iso(10))  # a dropped day has no return row
    r = pd.concat([r])  # keep the name
    # day 10 level after a stored P&L: the fall is the P&L (-99.5% of the peak)
    pnl = {_iso(10): float(-_PEAK * Fraction(995, 1000))}
    ke = replay_key_equity(r, flows, anchor, history_reaches_inception=True, dropped_day_pnl=pnl)
    assert ke.equity is not None
    assert float(ke.equity.loc[_iso(20)]) == 0.0
    assert ke.flags["emptied_stretches"] == 1


def test_a_loss_after_a_restart_peak_also_composes() -> None:
    """Was ``test_a_data_fault_after_a_restart_peak_also_refuses`` (CR-01: the same
    wrong rule). A stretch that begins later in the history, after a re-deposit
    restarted the peak, is explained by its stored return the same way."""
    # funded 0..9, withdraw day 10, re-deposit 50 on day 30 (stretch 10-29), then a
    # -99.5% return on day 33 with no flow: a second stretch, explained by the loss.
    key = Stretch(Fraction(0))
    rows = key.returns.to_dict()
    rows[_iso(33)] = -0.995
    level33 = (Fraction(50)) * Fraction(5, 1000)
    ke = replay_key_equity(
        pd.Series(rows, name="k").sort_index(),
        key.flows,
        float(level33),
        history_reaches_inception=True,
        dropped_day_pnl=key.dropped_pnl,
    )
    assert ke.equity is not None
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in list(range(10, 30)) + [33, 34, 35])
    assert float(ke.equity.loc[_iso(32)]) == pytest.approx(50.0, rel=1e-9)
    assert ke.flags["emptied_stretches"] == 2
    assert ke.degrade_reasons == frozenset()


def _partial_withdrawal_then_a_loss(loss: float, anchor: float):
    rows = {_iso(i): 0.0 for i in range(1, 16) if i != 5}  # day 5 is the dropped withdrawal day
    rows[_iso(10)] = loss
    flows = [ExternalFlow(_iso(0), 500_000.0), ExternalFlow(_iso(5), -490_000.0)]
    return replay_key_equity(
        pd.Series(rows, name="k").sort_index(), flows, anchor, history_reaches_inception=True
    )


def test_a_partial_withdrawal_then_a_loss_into_the_band_composes() -> None:
    """CR-01, the reviewer's reproduction, moved into the D-09 band. Peak 500k, a 490k
    withdrawal (level 10k, NOT emptied), then a -99.5% return day that leaves 50 USD (under the
    100 USD floor, so emptied). origin/main composes this key; the hardening refused it. (At the
    reviewer's -60% the day leaves 4k, which D-09 reads as live capital: the next test.)"""
    ke = _partial_withdrawal_then_a_loss(-0.995, 50.0)

    assert ke.equity is not None
    assert float(ke.equity.loc[_iso(9)]) == pytest.approx(10_000.0, rel=1e-9)
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in range(10, 16))
    assert float(ke.equity.loc[_iso(5)]) == pytest.approx(10_000.0, rel=1e-9)
    assert ke.flags["emptied_stretch_days"] == 6
    assert ke.flags["emptied_stretches"] == 1
    assert ke.degrade_reasons == frozenset()
    assert ke.is_trustworthy is True


def test_the_reviewers_minus_60_percent_day_leaves_live_capital_and_still_composes() -> None:
    """CR-01's original -60% key: 10k falls to 4k, 0.8% of the 500k peak but over the 100 USD
    floor (D-09), so it is live capital on every day and the key composes as it does on main."""
    ke = _partial_withdrawal_then_a_loss(-0.6, 4_000.0)

    assert ke.equity is not None
    assert all(float(ke.equity.loc[_iso(i)]) == pytest.approx(4_000.0, rel=1e-9) for i in range(10, 16))
    assert not any(k in ke.flags for k in _STRETCH_FLAGS)
    assert ke.degrade_reasons == frozenset()


def test_a_pure_drawdown_with_no_withdrawal_at_all_composes() -> None:
    """CR-01, the second reproduction: 100k, then -50% a day for twelve days. No flow
    after the deposit, nothing but stored returns. origin/main composes it."""
    rows = {_iso(i): -0.5 for i in range(1, 13)}
    ke = replay_key_equity(
        pd.Series(rows, name="k"),
        [ExternalFlow(_iso(0), 100_000.0)],
        100_000.0 * 0.5**12,
        history_reaches_inception=True,
    )

    assert ke.equity is not None
    # 100k * 0.5**9 = 195.3 USD is live; 0.5**10 = 97.7 is under the 100 USD floor (emptied).
    assert float(ke.equity.loc[_iso(9)]) == pytest.approx(100_000.0 * 0.5**9, rel=1e-9)
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in (10, 11, 12))
    assert ke.flags["emptied_stretch_days"] == 3
    assert ke.degrade_reasons == frozenset()


# ── CR-02 / SFH-01: only a near-zero level is emptied; a materially negative one refuses ──


def _phantom_deposit_replay():
    """CR-02, the reviewer's reproduction. A 10M account, a full withdrawal on day 10, a
    phantom +500k deposit row on day 12 (a duplicated or mis-dated row) and a terminal of
    1 USD, on a venue whose history does not reach inception. The backward roll pushes
    every level before day 12 down by the phantom: the stretch's level is about -5% of
    the peak. origin/main refuses it (``non-positive reconstructed equity``)."""
    rows = {_iso(i): 0.0 for i in range(0, 19) if i not in (10, 12)}
    flows = [ExternalFlow(_iso(10), -10_000_000.0), ExternalFlow(_iso(12), 500_000.0)]
    return replay_key_equity(
        pd.Series(rows, name="k"), flows, 1.0, history_reaches_inception=False
    )


def test_a_phantom_deposit_that_drives_the_level_materially_negative_still_refuses() -> None:
    with pytest.raises(NavReconstructionError, match="non-positive reconstructed equity on"):
        _phantom_deposit_replay()


@pytest.mark.parametrize(
    "fraction_of_peak",
    [Fraction(-2, 10_000), Fraction(-1, 100), Fraction(-5, 100)],
    ids=["minus-2e-4", "minus-1pct", "minus-5pct"],
)
def test_a_level_below_the_negative_band_refuses(fraction_of_peak: Fraction) -> None:
    key = Stretch(fraction_of_peak * _PEAK)
    with pytest.raises(NavReconstructionError, match="non-positive reconstructed equity on"):
        key.replay()


@pytest.mark.parametrize(
    "fraction_of_peak",
    [Fraction(-5, 100_000), Fraction(-1, 10**6), Fraction(0)],
    ids=["minus-5e-5", "minus-1e-6", "zero"],
)
def test_a_level_inside_the_negative_band_is_emptied(fraction_of_peak: Fraction) -> None:
    """Float-noise-sized negatives (the drained account's residue) stay zero capital."""
    ke = Stretch(fraction_of_peak * _PEAK).replay()
    assert ke.equity is not None
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in range(10, 30))
    assert ke.flags["emptied_stretch_days"] == 20
    assert ke.degrade_reasons == frozenset()


# ── Pitfall 4 / D-04 as amended by D-07: only a deposit into the band ends the stretch ──


def test_a_dust_redeposit_below_the_band_leaves_the_stretch_running() -> None:
    """D-07 reverses what D-04 pinned here: a re-deposit of 0.5% of the old peak is
    below the 1% band, so it does not end the stretch and does not restart the peak."""
    redeposit = Fraction(1, 200) * _PEAK  # 0.5% of the old peak, below the 1% band
    key = Stretch(Fraction(0), redeposit=redeposit, post_r=0.02)
    assert redeposit < EMPTIED * _PEAK  # fixture guard
    ke = key.replay()

    assert ke.equity is not None
    # The stretch runs from the withdrawal to the last day: 26 days of exact zero.
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in range(10, _N))
    assert ke.flags["emptied_stretch_days"] == 26
    assert ke.flags["emptied_stretches"] == 1
    assert key.oracle_emptied()[10:] == [True] * 26


def test_a_dust_deposit_inside_a_stretch_does_not_restart_the_peak() -> None:
    """The PROD shape: one deposit of about 1e-8 of the peak lands on an emptied day
    in the middle of a stretch, and a real re-deposit follows later. The stretch is ONE
    stretch up to the real re-deposit, and the near-zero days after the dust are not
    read as live capital against a peak restarted at dust."""
    dust = Fraction(1, 10**8) * _PEAK
    key = Stretch(Fraction(0), dust_day=20, dust=dust)
    assert dust < EMPTIED * _PEAK  # fixture guard
    ke = key.replay()

    assert ke.equity is not None
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in range(10, 30)), "dust day must stay in the stretch"
    for i in range(30, _N):
        assert float(ke.equity.loc[_iso(i)]) == pytest.approx(float(key.level[i]), rel=1e-9), i
    assert ke.flags["emptied_stretch_days"] == 20
    assert ke.flags["emptied_stretches"] == 1
    assert key.oracle_emptied() == [False] * 10 + [True] * 20 + [False] * 6


def test_a_redeposit_at_the_band_ends_the_stretch() -> None:
    """Control (green before and after D-07): a re-deposit that lifts the level to just
    above 1% of the prior peak is real capital again. Exact equality with the band is
    left out because the rolled float level can sit one ulp either side of it."""
    redeposit = Fraction(101, 10_000) * _PEAK
    key = Stretch(Fraction(0), redeposit=redeposit)
    assert redeposit > EMPTIED * _PEAK  # fixture guard
    ke = key.replay()

    assert ke.equity is not None
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in range(10, 30))
    for i in range(30, _N):
        assert float(ke.equity.loc[_iso(i)]) == pytest.approx(float(key.level[i]), rel=1e-9), i
        assert float(ke.equity.loc[_iso(i)]) > 0.0
    assert ke.flags["emptied_stretch_days"] == 20
    assert key.oracle_emptied()[30:] == [False] * 6


# ── D-08 / D-09: a level of 100 USD or more is live capital, deposit or not ──

# The founder's number (D-08, 2026-10-10), restated on purpose: the test must not import it.
RESTART_FLOOR_USD = float(FLOOR_USD)


def _small_restart(redeposit: float, *, cents_on_day_7: float = 0.0):
    """A 1M account that withdraws everything on day 5 (emptied days 5-9, a stretch), takes
    ``cents_on_day_7`` as a dust deposit on day 7 (0.0: none) and re-deposits ``redeposit`` on
    day 10, flat after. The old peak never decays, so 1% of it is 10k: a 5k restart is under
    that, and it is live because it is not under the 100 USD floor (D-09)."""
    flow_days = {0: 1_000_000.0, 5: -1_000_000.0, 10: redeposit}
    if cents_on_day_7:
        flow_days[7] = cents_on_day_7
    rows = {_iso(i): 0.0 for i in range(1, 16) if i not in flow_days}
    flows = [ExternalFlow(_iso(d), amt) for d, amt in sorted(flow_days.items())]
    return replay_key_equity(
        pd.Series(rows, name="k").sort_index(),
        flows,
        redeposit + cents_on_day_7,
        history_reaches_inception=True,
    )


def test_a_real_small_restart_above_the_floor_is_live_capital() -> None:
    """D-08: 5k after a 1M peak is 0.5% of the peak (under the 1% band) but a real restart.
    Without the floor it composes as zero capital indefinitely."""
    ke = _small_restart(5_000.0)

    assert ke.equity is not None
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in range(5, 10))
    for i in range(10, 16):
        assert float(ke.equity.loc[_iso(i)]) == pytest.approx(5_000.0, rel=1e-9), i
    assert ke.flags["emptied_stretch_days"] == 5
    assert ke.flags["emptied_stretches"] == 1
    assert ke.degrade_reasons == frozenset()


def test_a_cents_sized_deposit_inside_a_stretch_does_not_end_it() -> None:
    """The PROD shape (the dust flow was cents): a deposit far under the floor and under the
    band leaves the stretch running, and the real restart after it still ends it."""
    ke = _small_restart(5_000.0, cents_on_day_7=0.05)

    assert ke.equity is not None
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in range(5, 10)), "cents must stay in the stretch"
    for i in range(10, 16):
        assert float(ke.equity.loc[_iso(i)]) == pytest.approx(5_000.05, rel=1e-9), i
    assert ke.flags["emptied_stretch_days"] == 5
    assert ke.flags["emptied_stretches"] == 1


@pytest.mark.parametrize("redeposit, ends", [(50.0, False), (150.0, True)], ids=["under-the-floor", "over-the-floor"])
def test_the_floor_is_a_hundred_dollars(redeposit: float, ends: bool) -> None:
    """Either side of the floor, on a peak where 1% (10k) is far above both."""
    assert 0.01 * 1_000_000 > redeposit  # fixture guard: both are under the 1% band
    assert (redeposit >= RESTART_FLOOR_USD) is ends  # fixture guard: the floor decides
    ke = _small_restart(redeposit)

    assert ke.equity is not None
    last = float(ke.equity.loc[_iso(15)])
    if ends:
        assert last == pytest.approx(redeposit, rel=1e-9)
        assert ke.flags["emptied_stretch_days"] == 5
    else:
        assert last == 0.0
        assert ke.flags["emptied_stretch_days"] == 11


def _big_account(
    residual: float,
    *,
    credit_on_day_7: float = 0.0,
    anchor: float | None = None,
    realized_terminal: tuple[str, float] | None = None,
):
    """D-09 (a), the reviewer's example. A 1.01M account (peak 1.01M, so 1% is 10,100 and the
    100 USD floor is the binding bound) withdraws everything but ``residual`` on day 3 and trades
    flat to day 8, with an optional ``credit_on_day_7`` deposit (a cents-sized credit in the
    reviewer's B case). The writer drops the flow days from the returns."""
    flow_days = {0: 1_010_000.0, 3: -(1_010_000.0 - residual)}
    if credit_on_day_7:
        flow_days[7] = credit_on_day_7
    rows = {_iso(i): 0.0 for i in range(1, 9) if i not in flow_days}
    flows = [ExternalFlow(_iso(d), amt) for d, amt in sorted(flow_days.items())]
    return replay_key_equity(
        pd.Series(rows, name="k").sort_index(),
        flows,
        residual + credit_on_day_7 if anchor is None else anchor,
        history_reaches_inception=True,
        realized_terminal=realized_terminal,
    )


@pytest.mark.parametrize("credit", [0.0, 0.05], ids=["no-later-deposit", "cents-credit-on-day-7"])
def test_a_residual_above_the_floor_is_live_capital_with_or_without_a_later_deposit(credit: float) -> None:
    """D-09 (a), R2-WR-02's A/B pair. Peak 1.01M, a withdrawal leaves 3,000 USD of real capital
    (0.3% of the peak, so under 1% of it). It is live capital because it is over 100 USD: the
    cents credit on day 7 decides nothing, and A (no deposit) is not hidden as zero forever."""
    ke = _big_account(3_000.0, credit_on_day_7=credit)

    assert ke.equity is not None
    for i in range(3, 7):
        assert float(ke.equity.loc[_iso(i)]) == pytest.approx(3_000.0, rel=1e-9), i
    for i in (7, 8):
        assert float(ke.equity.loc[_iso(i)]) == pytest.approx(3_000.0 + credit, rel=1e-9), i
    assert not any(k in ke.flags for k in _STRETCH_FLAGS)
    assert "emptied_last_day_anchor_in_band" not in ke.flags
    assert ke.degrade_reasons == frozenset()


@pytest.mark.parametrize("residual, live", [(99.99, False), (100.0, True), (150.0, True)])
def test_a_replayed_level_is_emptied_only_below_the_hundred_dollar_floor(residual: float, live: bool) -> None:
    """The boundary of the new classification, on a peak where 1% (10,100) is far above it. No
    deposit follows, so the floor alone decides."""
    ke = _big_account(residual)

    assert ke.equity is not None
    assert (float(ke.equity.loc[_iso(5)]) != 0.0) is live
    assert ("emptied_stretch" in ke.flags) is (not live)


def test_the_floor_binds_below_the_percent_band_only_on_a_peak_above_ten_thousand() -> None:
    """On a 5,000 USD peak 1% is 50 USD, under the floor, so the percent band still decides: a
    level of 60 USD (1.2% of the peak) is live and one of 40 (0.8%) is emptied. The floor is
    min(), not a replacement for the percent rule (D-01 is unchanged on small accounts)."""
    def run(residual: float):
        flows = [ExternalFlow(_iso(0), 5_000.0), ExternalFlow(_iso(3), -(5_000.0 - residual))]
        rows = {_iso(i): 0.0 for i in (1, 2, 4, 5, 6)}
        return replay_key_equity(
            pd.Series(rows, name="k").sort_index(), flows, residual, history_reaches_inception=True
        )

    live, empty = run(60.0), run(40.0)
    assert live.equity is not None and empty.equity is not None
    assert float(live.equity.loc[_iso(5)]) == pytest.approx(60.0, rel=1e-9)
    assert "emptied_stretch" not in live.flags
    assert float(empty.equity.loc[_iso(5)]) == 0.0


@pytest.mark.parametrize("anchor, live", [(99.99, False), (100.0, True), (3_000.0, True)])
def test_a_last_day_live_anchor_is_emptied_only_below_the_floor(anchor: float, live: bool) -> None:
    """D-09 (a) on the last-day live anchor, on the same terms as a replayed level: a stretch
    runs to the last day (the writer's terminal is 0.0), and the live anchor decides. 3,000 USD
    on a 1.01M peak was in the band before (3,000 < 10,100) and hid real capital as 0.0."""
    ke = _big_account(0.0, anchor=anchor, realized_terminal=(_iso(8), 0.0))

    assert ke.equity is not None
    if live:
        assert float(ke.equity.iloc[-1]) == anchor
        assert ke.flags["emptied_last_day_live_anchor"] == 1
        assert "emptied_last_day_anchor_in_band" not in ke.flags
    else:
        assert float(ke.equity.iloc[-1]) == 0.0
        assert ke.flags["emptied_last_day_anchor_in_band"] == 1
        assert "emptied_last_day_live_anchor" not in ke.flags


# ── a stretch that runs to the last day, and the live anchor ─────────────────


def _runs_to_end(stretch: Fraction = Fraction(0)) -> Stretch:
    return Stretch(stretch, redeposit_day=None)


@pytest.mark.parametrize(
    "anchor",
    [0.0, -1e-6, 0.5],
    ids=["anchor-zero", "anchor-minus-1e-6", "anchor-0.5-of-peak-109"],
)
def test_a_stretch_to_the_last_day_with_an_in_band_live_anchor_stays_zero(anchor: float) -> None:
    key = _runs_to_end()
    assert anchor < float(EMPTIED * _PEAK)  # fixture guard
    ke = key.replay(anchor=anchor, realized_terminal=(_iso(_N - 1), 0.0))

    assert ke.equity is not None
    assert float(ke.equity.iloc[-1]) == 0.0
    assert all(float(ke.equity.loc[_iso(i)]) == 0.0 for i in range(10, _N))
    assert ke.flags["emptied_last_day_anchor_in_band"] == 1
    assert "emptied_last_day_live_anchor" not in ke.flags
    assert ke.flags["emptied_stretch_days"] == _N - 10
    assert ke.degrade_reasons == frozenset()


# ── D-09 (b): a materially negative (or non-finite) last-day anchor refuses, as on main ──


@pytest.mark.parametrize("anchor", [-250_000.0, -150.0], ids=["minus-250k", "minus-150"])
def test_a_materially_negative_last_day_anchor_refuses(anchor: float) -> None:
    """R2-WR-01 / SFH-R2-F2, the reviewer's reproduction: peak 1.01M, an emptied stretch to the
    last day and a live anchor of -250k (a sign or conversion fault, not a drained account). It
    composed as 0.0 with no reason; origin/main refuses it. -150 is just past the 1e-4 band
    (101 USD on this peak)."""
    with pytest.raises(NavReconstructionError, match="non-positive reconstructed equity on 1 of 9"):
        _big_account(0.0, anchor=anchor, realized_terminal=(_iso(8), 0.0))


@pytest.mark.parametrize("anchor", [float("nan"), float("inf"), float("-inf")], ids=["nan", "+inf", "-inf"])
def test_a_non_finite_last_day_anchor_refuses_on_an_emptied_last_day_too(anchor: float) -> None:
    """D-09 (b), the non-finite half: refused by the anchor's own finiteness guard before the
    emptied band is consulted, so no lower bound can ever let one through."""
    with pytest.raises(NavReconstructionError, match="non-finite anchor"):
        _big_account(0.0, anchor=anchor, realized_terminal=(_iso(8), 0.0))


@pytest.mark.parametrize("anchor", [-50.0, -1e-6, 0.0], ids=["minus-50", "minus-1e-6", "zero"])
def test_a_float_noise_sized_negative_last_day_anchor_stays_zero_capital(anchor: float) -> None:
    """The refusal above has a lower bound, not a blanket one: an anchor inside the same 1e-4
    negative band the replayed levels use (101 USD on this peak) is the drained account's
    residue and stays exactly 0.0."""
    ke = _big_account(0.0, anchor=anchor, realized_terminal=(_iso(8), 0.0))

    assert ke.equity is not None
    assert float(ke.equity.iloc[-1]) == 0.0
    assert ke.flags["emptied_last_day_anchor_in_band"] == 1
    assert ke.degrade_reasons == frozenset()


def test_a_stretch_to_the_last_day_with_a_live_anchor_at_the_band_keeps_the_anchor() -> None:
    """Today's behaviour is kept: the live anchor wins on the last day, and the flag
    says the last day was classified emptied but the account holds real equity now."""
    key = _runs_to_end()
    live = float(Fraction(2, 100) * _PEAK)  # 2% of the peak, above the 1% band
    ke = key.replay(anchor=live, realized_terminal=(_iso(_N - 1), 0.0))

    assert ke.equity is not None
    assert float(ke.equity.iloc[-1]) == live
    assert float(ke.equity.loc[_iso(_N - 2)]) == 0.0
    assert ke.flags["emptied_last_day_live_anchor"] == 1
    assert "emptied_last_day_anchor_in_band" not in ke.flags


def test_a_stretch_whose_last_day_is_not_emptied_writes_neither_last_day_flag() -> None:
    ke = Stretch(Fraction(0)).replay()
    assert ke.equity is not None
    assert "emptied_last_day_anchor_in_band" not in ke.flags
    assert "emptied_last_day_live_anchor" not in ke.flags


def test_a_non_positive_live_anchor_with_a_funded_last_day_still_refuses() -> None:
    """Not an emptied last day: the unchanged live-anchor refusal."""
    key = Stretch(Fraction(0))
    with pytest.raises(NavReconstructionError, match="non-positive reconstructed equity on 1 of 36"):
        key.replay(anchor=-5.0, realized_terminal=(_iso(_N - 1), key.anchor))


# ── compose level: the payload an emptied key produces, through the reader's checks ──

_DAY_RE = __import__("re").compile(r"^\d{4}-\d{2}-\d{2}$")


def _reader_accepts(payload: dict) -> None:
    """The shape checks of ``extractTrustworthyDerivedSeries`` / ``trustworthyDerivedCurve``
    (src/lib/queries.ts), restated: version 2, trustworthy, a curve of finite levels
    (0 allowed), a non-empty strictly-ascending returns array of finite ``r``."""
    import math

    assert payload["version"] == 2
    assert payload["is_trustworthy"] is True
    assert payload["curve"], "an empty curve is not a renderable series"
    for pt in payload["curve"]:
        assert _DAY_RE.match(pt["date"])
        assert isinstance(pt["equity_usd"], float | int) and math.isfinite(pt["equity_usd"])
    rets = payload["returns"]
    assert rets, "returns must be non-empty"
    prev = ""
    for pt in rets:
        assert _DAY_RE.match(pt["date"])
        assert pt["date"] > prev
        assert isinstance(pt["r"], float | int) and math.isfinite(pt["r"])
        prev = pt["date"]


async def _compose(keys: dict[str, Stretch]) -> dict:
    from unittest.mock import patch

    from services.job_worker import run_derive_allocator_equity_job
    from tests.test_derive_allocator_equity_job import (
        DERIVED_TABLE,
        _extract_payload,
        _FakeSupabase,
        _is_equity_curve_upsert,
    )

    alloc = "alloc-emptied"
    api_keys, csv_rows, derived = [], [], []
    for key_id, st in keys.items():
        api_keys.append({
            "id": key_id, "user_id": alloc, "is_active": True, "sync_status": "connected",
            "disconnected_at": None, "exchange": "deribit",
        })
        csv_rows += [
            {"api_key_id": key_id, "allocator_id": alloc, "date": d, "daily_return": r}
            for d, r in st.returns.items()
        ]
        derived.append({
            "allocator_id": alloc,
            "kind": f"key_inputs:{key_id}",
            "payload": {
                "flows": [{"utc_day_iso": f.utc_day_iso, "usd_signed": f.usd_signed} for f in st.flows],
                "anchor_usd": st.anchor,
                "anchor_null_reason": None,
                "anchor_asof": f"{_iso(_N - 1)}T06:00:00+00:00",
                "venue": "deribit",
                "dropped_day_pnl": [
                    {"utc_day_iso": d, "pnl_usd": p} for d, p in st.dropped_pnl.items()
                ],
            },
        })
    fake = _FakeSupabase({
        "api_keys": api_keys,
        "csv_daily_returns": csv_rows,
        DERIVED_TABLE: derived,
        "allocator_equity_snapshots": [],
    })
    with patch("services.job_worker.get_supabase", return_value=fake):
        await run_derive_allocator_equity_job(
            {"id": "j-compose", "kind": "derive_allocator_equity", "allocator_id": alloc}
        )
    upserts = [u for u in fake.upserts if u[0] == DERIVED_TABLE and _is_equity_curve_upsert(u[1])]
    assert len(upserts) == 1, fake.upserts
    return _extract_payload(upserts[0][1])


@pytest.mark.asyncio
async def test_an_emptied_key_beside_a_funded_one_composes_and_passes_the_readers_checks() -> None:
    empty = Stretch(Fraction(0))
    # A key funded throughout: +1%/day on 100, no flow after the opening deposit.
    funded = Stretch(Fraction(0), withdraw_day=None, redeposit_day=None)
    payload = await _compose({"key-E": empty, "key-F": funded})

    _reader_accepts(payload)
    assert payload["degrade_reasons"] == []
    curve = {p["date"]: p["equity_usd"] for p in payload["curve"]}
    # The emptied key contributes exactly 0: the book level is the funded key's alone.
    for i in range(11, 30):
        assert curve[_iso(i)] == pytest.approx(float(funded.level[i]), rel=1e-9), i
    # The funded key's own return passes through unchanged on the emptied days: the
    # emptied key's previous-day level is 0, so its weight is 0 and the book return is the
    # funded key's +1% exactly. On a day both are funded it is +1% too.
    rets = {p["date"]: p["r"] for p in payload["returns"]}
    for i in list(range(11, 30)) + [5]:
        assert rets[_iso(i)] == pytest.approx(0.01, rel=1e-9), i


@pytest.mark.asyncio
async def test_a_day_both_keys_are_empty_is_omitted_counted_and_benign() -> None:
    """W5: key B is empty (withdrawn, zero capital, no return) over A's stretch, then
    funded. The days on which both are empty have no book return and are omitted and
    counted through the compose's existing benign skip, never a degrade reason."""
    a = Stretch(Fraction(0))  # empty days 10-29
    b = Stretch(Fraction(0), withdraw_day=5, redeposit_day=34)  # empty days 5-33
    payload = await _compose({"key-A": a, "key-B": b})

    _reader_accepts(payload)
    assert payload["is_trustworthy"] is True
    assert payload["degrade_reasons"] == []
    assert "skipped_nonpositive_denominator" in payload["flags"]
    days = {p["date"] for p in payload["returns"]}
    # Both keys are at zero capital on days 11-29 (prev level 0 for both): no book return.
    for i in range(11, 30):
        assert _iso(i) not in days, i
    # A alone is funded on days 5-9 (B emptied) and 31-33: its return still reaches the book.
    assert _iso(7) in days
    assert _iso(32) in days

    # The count, through the pure function the compose calls (one skipped day per
    # both-empty day with a defined prior level of 0: days 11-29).
    from services.allocator_equity_compose import portfolio_returns

    per_key = {"A": a.replay(), "B": b.replay()}
    dropped = {
        "A": {d for d in a.dropped_pnl},
        "B": {d for d in b.dropped_pnl},
    }
    book = portfolio_returns(
        per_key, {"A": a.returns, "B": b.returns}, dropped_days_by_key=dropped
    )
    assert book.skipped_nonpositive_days == 19
    assert book.nonfinite_days == 0


def test_the_refusal_for_a_non_positive_anchor_leaks_no_fixture_amount() -> None:
    """Leak scan (T-115-05): the refusal states a day count, never an amount. (Was the
    leak scan over the Pitfall 5 collapse, which composes now: CR-01.)"""
    key = Stretch(Fraction(0))
    with pytest.raises(NavReconstructionError) as exc:
        key.replay(anchor=-5.0, realized_terminal=(_iso(_N - 1), key.anchor))
    msg = str(exc.value)
    for token in (str(int(float(_PEAK))), f"{float(_PEAK):.2f}", "-5.0", "100.0", "109"):
        assert token not in msg


def test_the_refusal_for_a_materially_negative_level_leaks_no_fixture_amount() -> None:
    """Leak scan (T-115-05) over the CR-02 refusal: a day count, never an amount."""
    with pytest.raises(NavReconstructionError) as exc:
        _phantom_deposit_replay()
    msg = str(exc.value)
    for token in ("10000000", "500000", "499999", "9500001", "10,000,000", "500,000"):
        assert token not in msg
