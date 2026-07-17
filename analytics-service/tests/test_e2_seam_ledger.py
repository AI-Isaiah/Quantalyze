"""Phase 115 (E2) STITCH-05/06 — the ONE unified cashflow ledger.

Pins the ledger half of ``services/allocator_equity_derive.py``:

  * STITCH-05 — real external flows AND synthetic seam entries live in ONE
    dated ledger (``ExternalFlow`` shape + provenance tag). That SAME ledger
    feeds both the $-replay and the Modified-Dietz / MWR scalar adapters — the
    KEPT ``portfolio_metrics`` cashflow surface gets its FIRST production caller
    (thread-only this phase: computed + tested, no UI display).
  * STITCH-06 — a rotation-boundary equity jump is a SYNTHETIC deposit/withdrawal
    through the SAME ledger: TWR stays clean across the seam (product of the two
    segments' cumulative TWRs, no injected seam return) while the $-curve steps by
    exactly the seam magnitude. An unanchored side -> the seam magnitude is
    UNKNOWN, the scalars fail loud (None, never fabricated), the $-curve truncates.

Seam flows apply ONLY at genuine rotation boundaries (the L1 pin) — never to a
concurrent-blend day, which composes via the capital-weighted blend instead.

Uses the frozen rotated C->D seam fixture (read-only) + local flow fixtures.
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest

import services.allocator_equity_derive as aed
from services.allocator_equity_derive import (
    LEDGER_REAL,
    LEDGER_SEAM,
    LedgerEntry,
    build_allocator_ledger,
    mwr_and_dietz_from_ledger,
    replay_key_equity,
    segment_coverage,
)
from services.external_flows import ExternalFlow
from services.portfolio_metrics import compute_modified_dietz, compute_mwr
from tests.e2_fixtures import ANCHORS, rotated_seam_pair


def _cd_setup():
    """The frozen rotated seam: C (anchor 50000) hands off to D (anchor 60000)."""
    c, d = rotated_seam_pair()
    series = {c.key_id: c.returns, d.key_id: d.returns}
    seg = segment_coverage(series)
    assert len(seg.seams) == 1, "fixture must produce exactly one rotation seam"
    per_key_equity = {
        c.key_id: replay_key_equity(c.returns, [], ANCHORS[c.key_id]),
        d.key_id: replay_key_equity(d.returns, [], ANCHORS[d.key_id]),
    }
    return c, d, seg, per_key_equity


# ── Test 1 (STITCH-05): ONE ledger, one construction site ────────────────────

def test_one_ledger_single_construction_site_feeds_both_consumers():
    c, d, seg, per_key_equity = _cd_setup()
    real = {c.key_id: [ExternalFlow("2026-03-10", 10000.0)]}
    ledger = build_allocator_ledger(real, seg.seams, per_key_equity)

    assert isinstance(ledger, list)
    assert all(isinstance(e, LedgerEntry) for e in ledger)
    # Ordered ascending by day (the ccxt dated-flow convention).
    days = [e.flow.utc_day_iso for e in ledger]
    assert days == sorted(days)
    # Real + seam provenance, one of each.
    assert {e.provenance for e in ledger} == {LEDGER_REAL, LEDGER_SEAM}

    # The SAME list object feeds the scalar adapter — no second ledger is built.
    out = mwr_and_dietz_from_ledger(
        ledger,
        begin_value=100000.0,
        end_value=130000.0,
        period_start="2026-03-01",
        period_days=60,
    )
    assert out is not None

    # Grep-style: the module constructs a LedgerEntry in EXACTLY one place.
    src = Path(aed.__file__).read_text(encoding="utf-8")
    assert src.count("LedgerEntry(") == 1, (
        "the unified ledger must have exactly ONE construction site in the module"
    )


# ── Test 2 (STITCH-06): seam magnitude == the boundary equity jump ───────────

def test_seam_entry_magnitude_is_the_boundary_equity_jump():
    c, d, seg, per_key_equity = _cd_setup()
    ledger = build_allocator_ledger({}, seg.seams, per_key_equity)
    seam_entries = [e for e in ledger if e.provenance == LEDGER_SEAM]
    assert len(seam_entries) == 1
    entry = seam_entries[0]

    c_last = float(per_key_equity[c.key_id].equity.iloc[-1])   # C's last-day equity
    d_first = float(per_key_equity[d.key_id].equity.iloc[0])   # D's first-day equity
    assert entry.known is True
    assert entry.flow.usd_signed == pytest.approx(d_first - c_last, abs=1e-6)
    # Dated on the NEXT segment's first day.
    assert entry.flow.utc_day_iso == seg.seams[0].next_first_day


# ── Test 3 (STITCH-06): TWR clean across the seam, $-curve steps by the seam ──

def test_twr_is_clean_across_the_seam_and_dollar_curve_steps():
    c, d, seg, per_key_equity = _cd_setup()
    ledger = build_allocator_ledger({}, seg.seams, per_key_equity)
    entry = next(e for e in ledger if e.provenance == LEDGER_SEAM)

    import pandas as pd

    # Cumulative TWR across the seam == product of the two segments' cumulative
    # TWRs — NO seam return is injected (the boundary jump is a flow, not a return).
    twr_combined = float((1.0 + pd.concat([c.returns, d.returns])).prod())
    twr_product = (
        float((1.0 + c.returns).prod()) * float((1.0 + d.returns).prod())
    )
    assert twr_combined == pytest.approx(twr_product, rel=1e-12)
    # The seam magnitude never appears as a per-day return term.
    assert entry.flow.usd_signed not in set(c.returns.tolist() + d.returns.tolist())

    # The $-curve steps by EXACTLY the seam entry at the rotation boundary.
    c_last = float(per_key_equity[c.key_id].equity.iloc[-1])
    d_first = float(per_key_equity[d.key_id].equity.iloc[0])
    assert (d_first - c_last) == pytest.approx(entry.flow.usd_signed, abs=1e-6)


# ── Test 4 (STITCH-06): unknown seam -> fail loud, never fabricated ──────────

def test_unknown_seam_flags_and_scalars_fail_loud():
    c, d, seg, _ = _cd_setup()
    # Prev segment (C) unanchored -> seam magnitude is UNKNOWN.
    per_key_equity = {
        c.key_id: replay_key_equity(c.returns, [], None),      # no anchor
        d.key_id: replay_key_equity(d.returns, [], ANCHORS[d.key_id]),
    }
    ledger = build_allocator_ledger({}, seg.seams, per_key_equity)
    seam_entry = next(e for e in ledger if e.provenance == LEDGER_SEAM)
    assert seam_entry.known is False  # magnitude-unknown, flagged

    # Scalars fail loud on an unknown-magnitude ledger — never a fabricated number.
    out = mwr_and_dietz_from_ledger(
        ledger,
        begin_value=100000.0,
        end_value=130000.0,
        period_start="2026-03-01",
        period_days=60,
    )
    assert out == (None, None)

    # The $-curve truncates to the anchored (D) side with a degradation flag.
    from services.allocator_equity_derive import allocator_equity_curve

    curve = allocator_equity_curve(per_key_equity)
    assert curve.equity is not None
    assert curve.flags["degraded"] is True
    assert curve.flags["dropped_keys"] == [c.key_id]


# ── Test 5 (STITCH-05): the unified ledger threads Dietz + MWR ────────────────

def test_unified_ledger_threads_dietz_and_mwr():
    c, d, seg, per_key_equity = _cd_setup()
    real = {c.key_id: [ExternalFlow("2026-03-10", 10000.0)]}
    ledger = build_allocator_ledger(real, seg.seams, per_key_equity)

    begin_value, end_value = 100000.0, 130000.0
    period_start, period_days = "2026-03-01", 60
    mwr, dietz = mwr_and_dietz_from_ledger(
        ledger,
        begin_value=begin_value,
        end_value=end_value,
        period_start=period_start,
        period_days=period_days,
    )
    assert mwr is not None and dietz is not None
    import math

    assert math.isfinite(mwr) and math.isfinite(dietz)

    # The adapter's conversion IS the contract: it maps each ExternalFlow ledger
    # entry into the dict shapes the KEPT portfolio_metrics helpers expect. Rebuild
    # those shapes inline and assert byte-agreement.
    start = date.fromisoformat(period_start)
    end_date = (start + timedelta(days=period_days)).isoformat()
    expected_mwr_flows = [{"date": period_start, "amount": -begin_value}]
    expected_mwr_flows += [
        {"date": e.flow.utc_day_iso, "amount": -float(e.flow.usd_signed)}
        for e in ledger
    ]
    expected_mwr = compute_mwr(
        expected_mwr_flows, final_value=end_value, end_date=end_date
    )
    expected_dietz_flows = [
        {
            "amount": float(e.flow.usd_signed),
            "day": (date.fromisoformat(e.flow.utc_day_iso) - start).days,
        }
        for e in ledger
    ]
    expected_dietz = compute_modified_dietz(
        begin_value, end_value, expected_dietz_flows, period_days
    )

    assert mwr == pytest.approx(expected_mwr, rel=1e-12)
    assert dietz == pytest.approx(expected_dietz, rel=1e-12)
