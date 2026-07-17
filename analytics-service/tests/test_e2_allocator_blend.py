"""Phase 115 (E2) STITCH-01 — canonical allocator blend + coverage segmentation.

These tests pin the pure, I/O-free core in
``services/allocator_equity_derive.py`` against the Phase-36 TS precedent
(``src/lib/queries.ts::liveBaselineMetricsFromPerKeyDailies``):

  * D1 — one strategy per api_key_id, STATIC current-equity-share weights.
  * D2 — AUM stays from holdings (not this module's concern; shape/KPIs only).
  * D3 — all-or-nothing: any eligible key with an EMPTY series degrades the WHOLE
         allocator to the honest empty baseline, never a mixed-basis half-blend.

Landmine L1 (Test 3): concurrent keys compose via the capital-weighted BLEND —
never via ``stitch_composite.assert_windows_disjoint`` (which RAISES on overlap
BY DESIGN). The blend path must never reach that guard.

Fixtures are the frozen wave-1 builders in ``tests/e2_fixtures.py`` (read-only).
"""
from __future__ import annotations

import pandas as pd
import pytest

from services.allocator_equity_derive import (
    blend_concurrent_returns,
    eligible_key_predicate,
)
from tests.e2_fixtures import (
    WINDOW_START,
    concurrent_pair,
)


# ── Task 1: capital-weighted concurrent blend (D1/D2/D3) ─────────────────────

def test_blend_is_capital_weighted_per_day():
    """Test 1 — two concurrent keys blend day-by-day: blended r_t is EXACTLY the
    static capital-weighted sum 0.6*rA_t + 0.4*rB_t for every overlapping day."""
    a, b = concurrent_pair()  # A daily=+0.005, B daily=-0.002, 60 concurrent days
    res = blend_concurrent_returns(
        {a.key_id: a.returns, b.key_id: b.returns},
        {a.key_id: 0.6, b.key_id: 0.4},
    )
    assert res.blended is not None
    assert not res.flags.get("honest_empty")
    expected = 0.6 * 0.005 + 0.4 * (-0.002)  # 0.0022
    assert len(res.blended) == 60
    for day, value in res.blended.items():
        assert value == pytest.approx(expected, abs=1e-15), day
    # raw current-equity weights normalize to the SAME blend (120k / 80k = 0.6/0.4)
    res_raw = blend_concurrent_returns(
        {a.key_id: a.returns, b.key_id: b.returns},
        {a.key_id: 120000.0, b.key_id: 80000.0},
    )
    pd.testing.assert_series_equal(res.blended, res_raw.blended, check_names=False)


def test_d3_all_or_nothing_and_sole_key_passthrough():
    """Test 2 — D3 honesty gate: one eligible key with an EMPTY series degrades the
    WHOLE blend to the honest-empty result (no single-key curve). The sole eligible
    non-empty key passes through as its own series with weight 1.0."""
    a, b = concurrent_pair()
    empty = pd.Series(dtype="float64", name=b.key_id)

    degraded = blend_concurrent_returns(
        {a.key_id: a.returns, b.key_id: empty},
        {a.key_id: 0.6, b.key_id: 0.4},
    )
    assert degraded.blended is None
    assert degraded.flags["honest_empty"] is True
    assert degraded.flags["reason"] == "d3_missing_series"

    sole = blend_concurrent_returns({a.key_id: a.returns}, {a.key_id: 250000.0})
    assert sole.flags.get("sole_key") is True
    assert sole.flags.get("weight") == 1.0
    pd.testing.assert_series_equal(sole.blended, a.returns, check_names=False)


def test_l1_blend_never_touches_disjoint_overlap_guard(monkeypatch):
    """Test 3 (L1 regression) — the concurrent blend never raises
    CompositeOverlapError and never calls ``assert_windows_disjoint``. Monkeypatch
    the guard to explode if reached from the blend path."""
    import services.stitch_composite as sc

    def _boom(*_a, **_k):
        raise AssertionError(
            "assert_windows_disjoint reached from the concurrent blend path (L1 "
            "violation) — overlapping sibling keys must BLEND, never stitch"
        )

    monkeypatch.setattr(sc, "assert_windows_disjoint", _boom)
    a, b = concurrent_pair()  # fully overlapping windows
    res = blend_concurrent_returns(
        {a.key_id: a.returns, b.key_id: b.returns},
        {a.key_id: 0.5, b.key_id: 0.5},
    )
    assert res.blended is not None and len(res.blended) == 60


def test_weights_are_static_not_performance_tracking():
    """Test 4 — D1 weights are STATIC current-equity shares: a mid-window swing in
    relative performance does NOT re-weight earlier days. The weight applied to the
    first day equals the weight applied to the last day."""
    a_returns = pd.Series(
        [0.01] * 30 + [0.02] * 30,
        index=[str(d.date()) for d in pd.date_range(WINDOW_START, periods=60)],
    )
    b_returns = pd.Series(
        [0.0] * 30 + [-0.01] * 30,
        index=[str(d.date()) for d in pd.date_range(WINDOW_START, periods=60)],
    )
    res = blend_concurrent_returns(
        {"key-A": a_returns, "key-B": b_returns},
        {"key-A": 0.6, "key-B": 0.4},
    )
    vals = list(res.blended.items())
    # day 0 and day 59: both are exactly 0.6*A + 0.4*B despite B collapsing late.
    assert vals[0][1] == pytest.approx(0.6 * 0.01 + 0.4 * 0.0)
    assert vals[59][1] == pytest.approx(0.6 * 0.02 + 0.4 * (-0.01))
    for i, (_, v) in enumerate(vals):
        assert v == pytest.approx(0.6 * a_returns.iloc[i] + 0.4 * b_returns.iloc[i])


def test_all_zero_weights_degrade_to_equal_weight_flagged():
    """Test 5 — all-zero (or all-negative, clamped) weights degrade to equal-weight
    with a flag; never a ZeroDivision."""
    a, b = concurrent_pair()
    res = blend_concurrent_returns(
        {a.key_id: a.returns, b.key_id: b.returns},
        {a.key_id: 0.0, b.key_id: 0.0},
    )
    assert res.flags["equal_weight_fallback"] is True
    expected = 0.5 * 0.005 + 0.5 * (-0.002)  # 0.0015
    for _, value in res.blended.items():
        assert value == pytest.approx(expected, abs=1e-15)
    # negative equity clamps to 0 → same equal-weight degrade, no crash
    res_neg = blend_concurrent_returns(
        {a.key_id: a.returns, b.key_id: b.returns},
        {a.key_id: -100.0, b.key_id: -200.0},
    )
    assert res_neg.flags["equal_weight_fallback"] is True


def test_eligible_key_predicate_mirrors_phase35():
    """The eligibility predicate encodes the phase35 backfill filter verbatim:
    is_active AND sync_status IS DISTINCT FROM 'revoked' AND disconnected_at IS
    NULL. A revoked / soft-disconnected allocator key (is_active stays true) is
    NOT eligible."""
    assert eligible_key_predicate(
        {"is_active": True, "sync_status": None, "disconnected_at": None}
    )
    assert eligible_key_predicate(
        {"is_active": True, "sync_status": "ok", "disconnected_at": None}
    )
    assert not eligible_key_predicate(
        {"is_active": False, "sync_status": None, "disconnected_at": None}
    )
    assert not eligible_key_predicate(
        {"is_active": True, "sync_status": "revoked", "disconnected_at": None}
    )
    assert not eligible_key_predicate(
        {"is_active": True, "sync_status": None, "disconnected_at": "2026-05-01"}
    )
