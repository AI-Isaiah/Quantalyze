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


def test_degraded_curve_within_tolerance_is_not_a_clean_reconcile():
    """LOW-7: the derived $-curve's ``degraded`` flag (dropped/unanchored key,
    truncated window, stale-mark carry) was IGNORED by the verdict — a
    within-tolerance-but-degraded reconcile was stamped clean. The verdict now
    requires ``within_tol AND not degraded`` while still surfacing the raw
    drift-in-band bool separately."""
    # Clean: within tolerance and NOT degraded -> verdict clean.
    clean = compute_anchor_consistency(100_000.0, 101_000.0, 0.02, degraded=False)
    assert clean["drift_within_tol"] is True
    assert clean["degraded"] is False
    assert clean["within_same_day_tolerance"] is True

    # Degraded: same in-band drift, but a degraded curve is NOT a clean reconcile.
    degraded = compute_anchor_consistency(100_000.0, 101_000.0, 0.02, degraded=True)
    assert degraded["drift_within_tol"] is True          # drift still in band
    assert degraded["degraded"] is True
    assert degraded["within_same_day_tolerance"] is False  # but no longer clean

    # Default (no degraded arg) preserves the pure drift-in-band verdict.
    default = compute_anchor_consistency(100_000.0, 101_000.0, 0.02)
    assert default["within_same_day_tolerance"] is True


def test_non_positive_derived_terminal_still_fails_loud():
    """Unchanged fail-loud guard: a non-positive derived terminal cannot form a
    drift ratio."""
    with pytest.raises(GroundTruthSkip):
        compute_anchor_consistency(0.0, 100_000.0, 0.02)
