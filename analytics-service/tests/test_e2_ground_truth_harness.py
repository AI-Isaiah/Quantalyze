"""Phase 115 (E2) — pure-helper pins for the read-only ground-truth harness
(``scripts/e2_allocator_ground_truth.py``). These cover the I/O-free verdict
helpers only; the network/service-role layer is exercised by the founder run.
"""
from __future__ import annotations

import pytest

from scripts.e2_allocator_ground_truth import (
    GroundTruthSkip,
    compute_anchor_consistency,
)


def test_untrustworthy_curve_within_tolerance_is_not_a_clean_reconcile():
    """C3/LOW-7: the verdict gates on the curve's ``is_trustworthy`` (classified
    degradation), not the blunt ``degraded`` bool. A BENIGN window-truncation
    (trustworthy) within tolerance stays clean — the old ``not degraded`` gate wrongly
    blocked EVERY normal multi-key allocator; a BLOCKING degradation (untrustworthy) is
    not clean. The raw drift-in-band bool is surfaced separately."""
    # Trustworthy + within tolerance -> verdict clean.
    clean = compute_anchor_consistency(100_000.0, 101_000.0, 0.02, trustworthy=True)
    assert clean["drift_within_tol"] is True
    assert clean["trustworthy"] is True
    assert clean["within_same_day_tolerance"] is True

    # Untrustworthy (blocking degradation): same in-band drift, but NOT a clean reconcile.
    untrustworthy = compute_anchor_consistency(
        100_000.0, 101_000.0, 0.02, trustworthy=False
    )
    assert untrustworthy["drift_within_tol"] is True          # drift still in band
    assert untrustworthy["trustworthy"] is False
    assert untrustworthy["within_same_day_tolerance"] is False  # but not clean

    # Default preserves the pure drift-in-band verdict (trustworthy by default).
    default = compute_anchor_consistency(100_000.0, 101_000.0, 0.02)
    assert default["within_same_day_tolerance"] is True


def test_non_positive_derived_terminal_still_fails_loud():
    """Unchanged fail-loud guard: a non-positive derived terminal cannot form a
    drift ratio."""
    with pytest.raises(GroundTruthSkip):
        compute_anchor_consistency(0.0, 100_000.0, 0.02)


# ---------------------------------------------------------------------------
# FLIPRETRY-03 gate fixtures — the anchor PASS/FAIL PAIR (Phase 123).
#
# P115 INDEPENDENCE (RESEARCH Pitfall 4): every expectation below is a number
# derived BY HAND in this test, never produced by re-calling the module under
# test to make its own oracle. A reviewer can grep this block: the ONLY call to
# a compose/derive/analytics function is `compute_anchor_consistency` (the
# subject), and its expected outputs are literal hand-computed values. There is
# no import of `allocator_equity_compose`, `allocator_equity_derive`, or any
# formula the verdict itself uses — the drift figures are pinned to ECONOMICS
# (a hand-calculator subtraction/division), not to the impl.
# ---------------------------------------------------------------------------


def test_e2_gate_pass_fixture_within_band_is_a_clean_reconcile():
    """PASS: derived 10000.0, live 10150.0, tol 2%.

    Hand-derived: drift = (10150 - 10000) / 10000 = +0.015 = +1.5%, which is
    inside the 2% same-trading-day band → the E2 gate PASSES (the founder-run
    exit-0 condition). Trustworthy by default. Numbers computed by hand here;
    the module is not consulted to produce them (P115)."""
    verdict = compute_anchor_consistency(10_000.0, 10_150.0, 0.02)
    assert verdict["drift_pct"] == pytest.approx(0.015)  # hand-derived +1.5%
    assert verdict["drift_within_tol"] is True
    assert verdict["trustworthy"] is True
    assert verdict["within_same_day_tolerance"] is True  # → E2 exit 0


def test_e2_gate_fail_on_drift_beyond_band_is_not_a_clean_reconcile():
    """FAIL-on-drift: derived 10000.0, live 10500.0, tol 2%.

    Hand-derived: drift = (10500 - 10000) / 10000 = +0.05 = +5%, OUTSIDE the 2%
    band → the E2 gate FAILS even though the curve is trustworthy. The two
    signals surface SEPARATELY: `drift_within_tol` is False while `trustworthy`
    stays True — a material live-vs-derived divergence must fail loud and route
    to rollback, NEVER be widened away. This is the gap the pre-123 suite lacked
    (it had no over-tolerance case)."""
    verdict = compute_anchor_consistency(10_000.0, 10_500.0, 0.02)
    assert verdict["drift_pct"] == pytest.approx(0.05)  # hand-derived +5%
    assert verdict["drift_within_tol"] is False  # 5% > 2% band
    assert verdict["trustworthy"] is True  # the curve itself is clean...
    assert verdict["within_same_day_tolerance"] is False  # ...but the anchor drifted


def test_e2_gate_fail_on_blocking_degradation_even_at_zero_drift():
    """FAIL-on-degradation: derived 10000.0, live 10000.0 (ZERO drift), but the
    curve carries a BLOCKING degradation (trustworthy False).

    Hand-derived: drift = 0/10000 = 0.0, perfectly in band — yet a blocking
    degradation can NEVER be outvoted by a clean anchor. `within_same_day_tolerance`
    is the AND of (drift-in-band, trustworthy), so a zero-drift-but-untrustworthy
    curve still fails the gate. Deleting the `trustworthy` conjunct in
    `within_same_day_tolerance` would flip this to True — neuter-proof."""
    verdict = compute_anchor_consistency(10_000.0, 10_000.0, 0.02, trustworthy=False)
    assert verdict["drift_pct"] == pytest.approx(0.0)  # hand-derived zero drift
    assert verdict["drift_within_tol"] is True  # anchor is perfect...
    assert verdict["trustworthy"] is False  # ...but a blocking degradation stands
    assert verdict["within_same_day_tolerance"] is False  # so NOT a clean reconcile
