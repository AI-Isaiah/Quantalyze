"""The relative opening tolerance at 2% of the anchor (Phase 179 OKXBILLSCHAIN, plan 06, D-08).

WHY these tests exist (Rule 9): ``OPENING_TOLERANCE_REL`` decides whether a forced OKX rebuild
anchors a curve that replaces stored history in one write. Founder decision D-08 (Phase 179,
2026-10-28, "Tighten to 2%", against the recommendation to keep 5%) narrowed it to 2% of the
anchor on ONE account's reading (a4, residual -0.0136 of the anchor on a complete walk). So
these tests fail in both directions that matter: if the value drifts back up, an opening 2% to
5% of the anchor away from the one the anchor implies would anchor again; if it tightens past
a4's measured residual, a4 would refuse. Every expected number is the test's own constant,
never a recomputation by the module under test.
"""
from __future__ import annotations

import pytest

from services import okx_opening_balance as obal
from tests.test_okx_anchor_rule import (
    _RESIDUAL_KEY,
    _TOTAL_EQ,
    _bills,
    _forced_window_call,
    _okx_world,
    _refusal_audit,
    _usdt_cash_after,
)


@pytest.mark.asyncio
async def test_a_forced_okx_rebuild_whose_bills_sit_three_percent_above_the_implied_opening_refuses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The whole forced job. The anchor-rule world has ``totalEq`` 70000 and a replay that ends at
    10000, so the opening the anchor implies is 60000. The bills open at 62100: the residual is
    (60000 - 62100) / 70000 = -0.03 of the anchor, 2100 against a 2% allowance of 1400. At the
    old 5% the allowance was 3500, so the job anchored and ended DONE; at 2% it refuses
    ``disagreed`` and writes nothing. RED at the old value."""
    exchange, _archive = await _okx_world(
        _bills(usdt_opening="62100"), usdt_cash=_usdt_cash_after("62100")
    )

    failed = await _refusal_audit(monkeypatch, exchange)

    assert failed["anchor_opening_check"] == "disagreed", failed
    assert failed[_RESIDUAL_KEY] == -0.03, failed


@pytest.mark.asyncio
async def test_a_forced_okx_rebuild_whose_bills_sit_three_percent_below_the_implied_opening_refuses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The other side of the band. The implied opening is 60000; the bills open at 57900, so the
    residual is (60000 - 57900) / 70000 = +0.03 of the anchor, 2100 against the 2% allowance of
    1400. At the old 5% (3500) it anchored; at 2% it refuses ``disagreed``. RED at the old value."""
    exchange, _archive = await _okx_world(
        _bills(usdt_opening="57900"), usdt_cash=_usdt_cash_after("57900")
    )

    failed = await _refusal_audit(monkeypatch, exchange)

    assert failed["anchor_opening_check"] == "disagreed", failed
    assert failed[_RESIDUAL_KEY] == 0.03, failed


@pytest.mark.parametrize("sign", [-1, 1], ids=["below", "above"])
@pytest.mark.parametrize("fraction", [0.021, 0.03, 0.049])
def test_an_opening_two_to_five_percent_of_the_anchor_off_refuses(
    sign: int, fraction: float
) -> None:
    """The band D-08 closes, through the rule itself. Anchor 100000 and a replay that ends at
    10000 imply an opening of 90000; the bills' opening is 90000 plus or minus ``fraction`` of the
    anchor. Every fraction from 2.1% to 4.9% exceeds the 2% allowance (2000) on either side, and
    every one of them was inside the old 5% allowance (5000), so each case is RED at the old
    value."""
    anchor = 100000.0
    implied = 90000.0

    assert obal.opening_agrees(anchor, 10000.0, implied + sign * fraction * anchor) is False


def test_a4s_measured_residual_agrees_at_the_decided_tolerance() -> None:
    """a4's SC-3 shape scaled to an anchor of 100000: the opening the anchor implies is 0.923 of
    it (92340), the bills' opening 0.937 (93700), so the residual is -1360 = -0.0136 of the anchor,
    inside the 2000 allowance. RED if the tolerance tightens below a4's residual, which would
    refuse the one account the value rests on."""
    assert obal.opening_agrees(100000.0, 7660.0, 93700.0) is True


@pytest.mark.asyncio
async def test_a_forced_okx_rebuild_with_a4s_residual_anchors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """a4's residual through the forced path. The implied opening is 60000 and the bills open at
    60952, so the residual is (60000 - 60952) / 70000 = -0.0136 of the anchor, 952 against the
    1400 allowance. The check reads ``agreed`` and the curve anchors on the venue's ``totalEq``.
    RED if the tolerance tightens below -0.0136: the forced call would refuse a4's shape."""
    exchange, _archive = await _okx_world(
        _bills(usdt_opening="60952"), usdt_cash=_usdt_cash_after("60952")
    )

    rows, _complete, telemetry = await _forced_window_call(monkeypatch, exchange)

    assert telemetry["anchor_opening_check"] == "agreed", telemetry
    assert telemetry[_RESIDUAL_KEY] == -0.0136, telemetry
    assert rows[-1]["value_usd"] == pytest.approx(float(_TOTAL_EQ), abs=0.01)
