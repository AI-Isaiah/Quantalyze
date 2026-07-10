"""Pure, credentials-free unit tests for the composite stitch core
(``services/stitch_composite.py``) — Phase 86 Plan 02, Wave 0 (86-VALIDATION.md).

Covers COMP-02 (half-open clip + fail-loud overlap guard + explicit coverage
mask) and COMP-04 (the MTM honesty gate), plus the COMP-03 convention pin proving
the stitched series rides the EXISTING ``compute_all_metrics(simple/active/365)``
path (arithmetic Σr cumulative + inception-seeded maxDD), never a fork.

The overlap tests are TABLE-DRIVEN from the ONE shared convention fixture
``tests/fixtures/window_overlap_convention.json`` — the same file the Phase 88
wizard zod validator must consume (v1.5 lesson: same inputs, one spec).
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from services.broker_dailies import gap_fill_daily_returns
from services.metrics import compute_all_metrics
from services.stitch_composite import (
    CompositeOverlapError,
    MemberBasisSignal,
    MemberWindow,
    assert_windows_disjoint,
    clip_to_window,
    coverage_mask,
    mark_to_market_available,
    stitch_clipped_series,
    windows_overlap,
)

_FIXTURE = (
    Path(__file__).parent / "fixtures" / "window_overlap_convention.json"
)


def _series(pairs: list[tuple[str, float]]) -> pd.Series:
    idx = pd.DatetimeIndex(
        [pd.Timestamp(d) for d, _ in pairs]
    ).as_unit("us")
    return pd.Series([v for _, v in pairs], index=idx, dtype="float64")


# --------------------------------------------------------------------------- #
# clip_to_window — half-open [start, end) byte-consistent with capital_on_date
# --------------------------------------------------------------------------- #
def test_clip_is_half_open_start_kept_end_excluded() -> None:
    """d == window_start is KEPT; d == window_end is EXCLUDED; values untouched."""
    s = _series([
        ("2024-12-31", -1.0),  # before start → dropped
        ("2025-01-01", 10.0),  # == start → kept
        ("2025-01-02", 20.0),
        ("2025-01-03", 30.0),
        ("2025-01-04", 99.0),  # == end → EXCLUDED (half-open)
    ])
    clipped = clip_to_window(s, "2025-01-01", "2025-01-04")
    assert [str(ts.date()) for ts in clipped.index] == [
        "2025-01-01", "2025-01-02", "2025-01-03",
    ]
    # Values preserved byte-identically (no re-derivation).
    assert clipped.loc[pd.Timestamp("2025-01-01")] == 10.0
    assert clipped.loc[pd.Timestamp("2025-01-03")] == 30.0
    # Falsifiable: an inclusive `<= end` comparator would keep 2025-01-04.
    assert pd.Timestamp("2025-01-04") not in clipped.index


def test_clip_window_end_none_keeps_all_from_start() -> None:
    s = _series([
        ("2024-12-31", -1.0),  # before start → dropped
        ("2025-01-01", 1.0),
        ("2025-06-30", 2.0),
        ("2030-01-01", 3.0),
    ])
    clipped = clip_to_window(s, "2025-01-01", None)
    assert [str(ts.date()) for ts in clipped.index] == [
        "2025-01-01", "2025-06-30", "2030-01-01",
    ]


# --------------------------------------------------------------------------- #
# windows_overlap — the canonical predicate, table-driven from the shared spec
# --------------------------------------------------------------------------- #
def _load_cases() -> list[dict]:
    doc = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    return doc["cases"]


def test_fixture_documents_convention_and_phase88_consumer() -> None:
    doc = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    assert "half-open" in doc["convention"]
    assert any("Phase 88" in c for c in doc["consumers"])
    # >= 7 table cases including the adjacent-handoff non-overlap case.
    assert len(doc["cases"]) >= 7
    names = {c["name"] for c in doc["cases"]}
    assert "adjacent_handoff_not_overlapping" in names


@pytest.mark.parametrize("case", _load_cases(), ids=lambda c: c["name"])
def test_windows_overlap_matches_shared_convention(case: dict) -> None:
    a = MemberWindow(seq=1, window_start=case["a_start"], window_end=case["a_end"])
    b = MemberWindow(seq=2, window_start=case["b_start"], window_end=case["b_end"])
    assert windows_overlap(a, b) is case["overlaps"]
    # The predicate is symmetric.
    assert windows_overlap(b, a) is case["overlaps"]


# --------------------------------------------------------------------------- #
# assert_windows_disjoint — fail-loud guard, leak-disciplined message
# --------------------------------------------------------------------------- #
def test_assert_windows_disjoint_passes_on_sequential_handoff() -> None:
    windows = [
        MemberWindow(1, "2025-01-01", "2025-01-04"),
        MemberWindow(2, "2025-01-04", "2025-01-07"),  # adjacent handoff, no overlap
        MemberWindow(3, "2025-01-07", None),
    ]
    assert_windows_disjoint(windows) is None


def test_assert_windows_disjoint_raises_naming_seqs_and_dates_no_usd() -> None:
    windows = [
        MemberWindow(1, "2025-01-01", "2025-01-10"),
        MemberWindow(2, "2025-01-05", "2025-01-20"),  # overlaps seq 1
    ]
    with pytest.raises(CompositeOverlapError) as ei:
        assert_windows_disjoint(windows)
    msg = str(ei.value)
    # Names both offending seqs.
    assert "1" in msg and "2" in msg
    # Carries ISO overlap dates.
    assert "2025-01-05" in msg
    # Leak discipline (T-86-05): no USD magnitude / dollar sign in the message.
    assert "$" not in msg


# --------------------------------------------------------------------------- #
# stitch_clipped_series — disjoint union; a day collision RAISES (never LWW)
# --------------------------------------------------------------------------- #
def test_stitch_unions_disjoint_series_ascending_preserving_values() -> None:
    k1 = _series([("2025-01-02", 2.0), ("2025-01-01", 1.0)])  # unsorted on input
    k2 = _series([("2025-01-04", 4.0), ("2025-01-03", 3.0)])
    out = stitch_clipped_series([(1, k1), (2, k2)])
    assert [str(ts.date()) for ts in out.index] == [
        "2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04",
    ]
    assert list(out.to_numpy()) == [1.0, 2.0, 3.0, 4.0]


def test_stitch_raises_on_post_clip_day_collision_not_last_write_wins() -> None:
    """A day present in >1 clipped series FAILS LOUD (mutation-honest: neuter the
    guard to overwrite → this test RED)."""
    k1 = _series([("2025-01-01", 1.0), ("2025-01-02", 2.0)])
    k2 = _series([("2025-01-02", 9.0), ("2025-01-03", 3.0)])  # 01-02 collides
    with pytest.raises(CompositeOverlapError) as ei:
        stitch_clipped_series([(1, k1), (2, k2)])
    msg = str(ei.value)
    assert "2025-01-02" in msg
    assert "$" not in msg


# --------------------------------------------------------------------------- #
# coverage_mask — gaps MARKED, never zero-filled as performance
# --------------------------------------------------------------------------- #
def test_coverage_mask_marks_gap_days_without_zero_filling() -> None:
    k1 = _series([("2025-01-01", 1.0), ("2025-01-02", 2.0)])
    k2 = _series([("2025-01-05", 5.0), ("2025-01-06", 6.0)])  # gap 03, 04
    mask = coverage_mask([(1, k1), (2, k2)])
    assert mask["per_key"] == [
        {"seq": 1, "first_day": "2025-01-01", "last_day": "2025-01-02", "n_days": 2},
        {"seq": 2, "first_day": "2025-01-05", "last_day": "2025-01-06", "n_days": 2},
    ]
    # Falsifiable: gap-filling the series before counting → gap_day_count 0 (RED).
    assert mask["gap_day_count"] == 2
    assert mask["gap_spans"] == [{"start": "2025-01-03", "end": "2025-01-04"}]
    assert mask["overlap_days"] == []
    # JSON-serializable primitives only (data_quality_flags destination).
    json.dumps(mask)


def test_coverage_mask_contiguous_has_no_gaps() -> None:
    k1 = _series([("2025-01-01", 1.0), ("2025-01-02", 2.0)])
    k2 = _series([("2025-01-03", 3.0)])
    mask = coverage_mask([(1, k1), (2, k2)])
    assert mask["gap_day_count"] == 0
    assert mask["gap_spans"] == []


# --------------------------------------------------------------------------- #
# mark_to_market_available — the OQ-1 single-owner MTM honesty gate
# --------------------------------------------------------------------------- #
def test_mtm_gate_perp_only_deribit_is_available() -> None:
    members = [
        MemberBasisSignal(1, "deribit", has_option_activity=False),
        MemberBasisSignal(2, "deribit", has_option_activity=False),
    ]
    assert mark_to_market_available(members) == (True, None)


def test_mtm_gate_options_active_deribit_gates_off() -> None:
    members = [MemberBasisSignal(1, "deribit", has_option_activity=True)]
    assert mark_to_market_available(members) == (False, "unsmoothed_options_book")


@pytest.mark.parametrize("venue", ["binance", "okx", "bybit"])
def test_mtm_gate_ccxt_venue_unavailable(venue: str) -> None:
    members = [MemberBasisSignal(1, venue, has_option_activity=False)]
    assert mark_to_market_available(members) == (
        False,
        "mtm_basis_unavailable_for_venue",
    )


def test_mtm_gate_options_activity_takes_precedence_over_ccxt_venue() -> None:
    """A composite with BOTH a ccxt member and an options-active Deribit member
    gates OFF with the options reason (the more specific ±94%/day-spike signal)."""
    members = [
        MemberBasisSignal(1, "binance", has_option_activity=False),
        MemberBasisSignal(2, "deribit", has_option_activity=True),
    ]
    assert mark_to_market_available(members) == (False, "unsmoothed_options_book")


# --------------------------------------------------------------------------- #
# COMP-03 convention pin — stitched series reproduces hand-computed arithmetic
# Σr cumulative + inception-seeded maxDD via the EXISTING simple/active path
# --------------------------------------------------------------------------- #
def test_stitched_series_reproduces_arithmetic_cumulative_and_inception_maxdd() -> None:
    """3 sequential keys → clip → stitch → gap_fill → compute_all_metrics(simple,
    active, 365). Hand daily r: +.10 −.05 +.02 | −.03 −.04 +.06 | +.01 −.02.
    Σr = +0.05; inception-seeded cumsum peaks at 0.10 (day 1), deepest underwater
    at day 5 (cum 0.00) → maxDD = −0.10. Proves REUSE of the simple/active path."""
    k1 = _series([("2025-01-01", 0.10), ("2025-01-02", -0.05), ("2025-01-03", 0.02),
                  ("2025-01-04", 999.0)])  # 01-04 must be clipped OUT of key1
    k2 = _series([("2025-01-04", -0.03), ("2025-01-05", -0.04), ("2025-01-06", 0.06)])
    k3 = _series([("2025-01-07", 0.01), ("2025-01-08", -0.02)])

    c1 = clip_to_window(k1, "2025-01-01", "2025-01-04")
    c2 = clip_to_window(k2, "2025-01-04", "2025-01-07")
    c3 = clip_to_window(k3, "2025-01-07", None)

    assert_windows_disjoint([
        MemberWindow(1, "2025-01-01", "2025-01-04"),
        MemberWindow(2, "2025-01-04", "2025-01-07"),
        MemberWindow(3, "2025-01-07", None),
    ])
    stitched = stitch_clipped_series([(1, c1), (2, c2), (3, c3)])
    dense = gap_fill_daily_returns(stitched)
    result = compute_all_metrics(
        dense, None, periods_per_year=365,
        cumulative_method="simple", day_basis="active",
    )
    assert result.metrics_json["cumulative_return"] == pytest.approx(0.05)
    assert result.metrics_json["max_drawdown"] == pytest.approx(-0.10)
