"""Phase 167.1.2.2 D-12 — the replay's construction self-check must test the roll,
not the conditioning of a 1000-day recomputation.

``replay_key_equity`` rolls a key's $-levels BACKWARD from the terminal anchor
(``equity_{t-1} = (equity_t - F_t) / (1 + r_t)``) and then self-checks that roll
against the forward identity ``equity_t = equity_{t-1} * (1 + r_t) + F_t``.

THE DEFECT (measured on PROD inputs, 2026-10-07 rehearsal): the self-check used to
recompute every level by replaying FORWARD from the stored day-0 level. A relative
error of a few ulp in ``equity_0`` then reaches day ``t`` multiplied by
``equity_0 * prod(1 + r) / equity_t``. After years of strong returns with the gains
withdrawn, followed by a near-total withdrawal, that factor exceeded 1e7, and the
band (scaled to the CURRENT level) refused a correct roll as "a roll-loop-vs-identity
code divergence". An exact rational forward replay from the same stored ``equity_0``
missed by the same order, so no arithmetic could have passed that check.

THE ORACLE IS INDEPENDENT OF THE CODE UNDER TEST: the fixture's true levels are built
FORWARD in exact rational arithmetic (``fractions.Fraction``) from a chosen day-0
level, so the expected series is known exactly and never read off the replay.
"""
from __future__ import annotations

from datetime import date, timedelta
from fractions import Fraction

import pandas as pd
import pytest

from services.allocator_equity_derive import (
    _SELF_CHECK_ABS,
    _SELF_CHECK_REL,
    _assert_forward_agreement,
    replay_key_equity,
)
from services.external_flows import ExternalFlow
from services.nav_twr import NavReconstructionError

_N_DAYS = 1100
_DRAIN_DAY = 1000
_HELD_LEVEL = 1_000_000  # the owner withdraws everything above this every 30 days
_LCG_SEED = 12345


def _drained_account(kept_after_drain: int) -> tuple[list[str], list[float], dict[str, float], list[Fraction]]:
    """An account that compounds ~1%/day (a dollar grows ~1e4x over the window),
    has its gains swept out every 30 days, and on ``_DRAIN_DAY`` is emptied down
    to ``kept_after_drain`` dollars. Every input is a finite float (returns to 6 dp,
    flows to the cent), every level stays positive: a VALID input.

    Returns ``(days, returns, flows_by_day, true_levels)`` where ``true_levels`` is
    the exact rational forward construction (the oracle)."""
    days = [(date(2023, 1, 1) + timedelta(days=i)).isoformat() for i in range(_N_DAYS)]
    x = _LCG_SEED
    returns = [0.0]
    for _ in range(1, _N_DAYS):
        x = (1103515245 * x + 12345) % (2**31)
        returns.append(round(0.01 + 0.04 * (x / 2**31 - 0.5), 6))
    levels = [Fraction(_HELD_LEVEL)]
    flows: dict[str, float] = {}
    for t in range(1, _N_DAYS):
        grown = levels[-1] * (1 + Fraction(returns[t]))
        flow = Fraction(0)
        if t % 30 == 0 and t < _DRAIN_DAY:
            flow = Fraction(_HELD_LEVEL) - grown
        if t == _DRAIN_DAY:
            flow = Fraction(kept_after_drain) - grown
        if flow:
            flow = Fraction(round(float(flow), 2))
            flows[days[t]] = float(flow)
        levels.append(grown + flow)
    return days, returns, flows, levels


@pytest.mark.parametrize("kept_after_drain", [300, 150, 10])
def test_near_total_withdrawal_after_strong_growth_is_replayed_not_refused(
    kept_after_drain: int,
) -> None:
    """A correct roll over a valid drained account must replay, and every level
    must equal the exact rational truth inside the repo's own self-check band.

    Before the D-12 fix this raised "forward/backward self-check diverged at
    day-index 1000" for each case: the cumulative forward replay amplified
    day-0 rounding past a band scaled to the post-withdrawal level."""
    days, returns, flows, truth = _drained_account(kept_after_drain)
    # Sanity on the fixture itself: the drain really is near-total and the
    # growth-of-a-dollar really dwarfs the post-drain level ratio.
    assert truth[_DRAIN_DAY] / truth[_DRAIN_DAY - 1] < Fraction(1, 1000)
    assert all(level > 0 for level in truth)

    ke = replay_key_equity(
        pd.Series(returns, index=days),
        [ExternalFlow(d, usd) for d, usd in flows.items()],
        float(truth[-1]),
    )

    assert ke.equity is not None
    assert list(ke.equity.index) == days
    # 167.1.2.2.1 SC-3 / D-01, D-09: a day whose level is below the smaller of 1% of the prior
    # peak and 100 USD is zero capital. Both are restated here (a Fraction, never imported) and
    # applied to the exact rational truth. The kept levels 300 and 150 are far below 1% of the
    # ~1e6 held level but over the 100 USD floor, so they are live capital; the kept 10 is under
    # it, so the drained tail is exactly 0.0. (The boundary value 100 is left out: the cent-rounded
    # flow lands the level either side of it.) The D-12 point of this test (the self-check on the
    # RAW levels does not refuse a correct roll) is unchanged.
    peak = truth[0]
    emptied_days = 0
    for t, day in enumerate(days):
        if t > 0 and truth[t] < min(Fraction(1, 100) * peak, Fraction(100)):
            expected = 0.0
            emptied_days += 1
        else:
            expected = float(truth[t])
            peak = max(peak, truth[t])
        tol = _SELF_CHECK_ABS + _SELF_CHECK_REL * abs(expected)
        assert abs(float(ke.equity[day]) - expected) <= tol, (
            f"day-index {t}: replayed level is outside the self-check band "
            "around the exact rational truth"
        )
    assert emptied_days == (_N_DAYS - _DRAIN_DAY if kept_after_drain < 100 else 0)


# ── Teeth: the self-check must still refuse a roll that disagrees with the identity ──

_SHORT_DAYS = ["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05"]
_SHORT_R = {d: v for d, v in zip(_SHORT_DAYS, [0.0, 0.02, -0.01, 0.03, 0.01])}
_SHORT_F = {"2026-05-03": -5_000.0}
_SHORT_ANCHOR = 120_000.0


def _roll(flow_day_shift: int = 0, flow_sign: float = 1.0) -> pd.Series:
    """A backward roll with an injectable code defect: the flow applied on the
    wrong day (``flow_day_shift``) or with the wrong sign (``flow_sign``)."""
    n = len(_SHORT_DAYS)
    eq = [0.0] * n
    eq[-1] = _SHORT_ANCHOR
    for t in range(n - 1, 0, -1):
        flow_day = _SHORT_DAYS[min(n - 1, max(0, t + flow_day_shift))]
        flow = flow_sign * _SHORT_F.get(flow_day, 0.0)
        eq[t - 1] = (eq[t] - flow) / (1.0 + _SHORT_R[_SHORT_DAYS[t]])
    return pd.Series(eq, index=_SHORT_DAYS)


def test_self_check_accepts_the_correct_roll() -> None:
    _assert_forward_agreement(_roll(), _SHORT_R, _SHORT_F, _SHORT_DAYS)


@pytest.mark.parametrize(
    ("label", "series"),
    [
        ("flow applied one day late", _roll(flow_day_shift=1)),
        ("flow applied one day early", _roll(flow_day_shift=-1)),
        ("flow sign inverted", _roll(flow_sign=-1.0)),
    ],
)
def test_self_check_refuses_a_roll_that_disagrees_with_the_identity(
    label: str, series: pd.Series
) -> None:
    with pytest.raises(NavReconstructionError, match="self-check diverged"):
        _assert_forward_agreement(series, _SHORT_R, _SHORT_F, _SHORT_DAYS)


def test_self_check_refuses_one_level_just_outside_the_band() -> None:
    """A single stored level off by twice the band is refused, at the step where
    it breaks the identity: the per-step check is no looser than the band."""
    series = _roll()
    t = 2
    level = float(series.iloc[t])
    series.iloc[t] = level + 2 * (_SELF_CHECK_ABS + _SELF_CHECK_REL * abs(level))
    with pytest.raises(NavReconstructionError, match=f"day-index {t} of"):
        _assert_forward_agreement(series, _SHORT_R, _SHORT_F, _SHORT_DAYS)
