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
