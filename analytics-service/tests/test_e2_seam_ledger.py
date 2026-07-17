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
    # ``series`` doubles as returns_by_key for the Finding-3 forward-identity seam.
    return c, d, seg, per_key_equity, series


# ── Test 1 (STITCH-05): ONE ledger, one construction site ────────────────────

def test_one_ledger_single_construction_site_feeds_both_consumers():
    c, d, seg, per_key_equity, returns = _cd_setup()
    real = {c.key_id: [ExternalFlow("2026-03-10", 10000.0)]}
    ledger = build_allocator_ledger(real, seg.seams, per_key_equity, returns)

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
    assert out.computable is True  # a known-magnitude ledger is computable (C4)

    # Grep-style: the module constructs a LedgerEntry in EXACTLY one place.
    src = Path(aed.__file__).read_text(encoding="utf-8")
    assert src.count("LedgerEntry(") == 1, (
        "the unified ledger must have exactly ONE construction site in the module"
    )


# ── Test 2 (STITCH-06): seam magnitude == the boundary equity jump ───────────

def test_seam_entry_magnitude_is_the_boundary_equity_jump():
    c, d, seg, per_key_equity, returns = _cd_setup()
    ledger = build_allocator_ledger({}, seg.seams, per_key_equity, returns)
    seam_entries = [e for e in ledger if e.provenance == LEDGER_SEAM]
    assert len(seam_entries) == 1
    entry = seam_entries[0]

    c_last = float(per_key_equity[c.key_id].equity.iloc[-1])   # C's last-day equity
    d_first = float(per_key_equity[d.key_id].equity.iloc[0])   # D's first-day equity
    # Finding 3: the seam is the NON-return part of the boundary jump — derive it
    # from the module's forward identity equity_t = equity_{t-1}(1+r_t)+F_t over the
    # concatenated curve: F = d_first - c_last*(1 + r_seam), NOT the naive d_first -
    # c_last (which would fold D's first-day P&L on the redeployed capital into F).
    r_seam = float(d.returns.iloc[0])  # D's return on its (the next block's) first day
    assert entry.known is True
    assert entry.flow.usd_signed == pytest.approx(d_first - c_last * (1.0 + r_seam), abs=1e-6)
    # Dated on the NEXT segment's first day.
    assert entry.flow.utc_day_iso == seg.seams[0].next_first_day


# ── Test 3 (STITCH-06): TWR clean across the seam, $-curve steps by the seam ──

def test_twr_is_clean_across_the_seam_and_dollar_curve_steps():
    c, d, seg, per_key_equity, returns = _cd_setup()
    ledger = build_allocator_ledger({}, seg.seams, per_key_equity, returns)
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

    # The $-curve steps by the forward-identity seam flow at the rotation boundary
    # (Finding 3): F = d_first - c_last*(1 + r_seam), stripping the redeployed
    # capital's first-day return out of the flow.
    c_last = float(per_key_equity[c.key_id].equity.iloc[-1])
    d_first = float(per_key_equity[d.key_id].equity.iloc[0])
    r_seam = float(d.returns.iloc[0])
    assert (d_first - c_last * (1.0 + r_seam)) == pytest.approx(
        entry.flow.usd_signed, abs=1e-6
    )


# ── Test 4 (STITCH-06): unknown seam -> fail loud, never fabricated ──────────

def test_unknown_seam_flags_and_scalars_fail_loud():
    c, d, seg, _, returns = _cd_setup()
    # Prev segment (C) unanchored -> seam magnitude is UNKNOWN.
    per_key_equity = {
        c.key_id: replay_key_equity(c.returns, [], None),      # no anchor
        d.key_id: replay_key_equity(d.returns, [], ANCHORS[d.key_id]),
    }
    ledger = build_allocator_ledger({}, seg.seams, per_key_equity, returns)
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
    # C4: computable=False marks the fail-loud path (distinct from an ordinarily
    # uncomputable scalar), and both scalars are None.
    assert out.computable is False
    assert out.mwr is None and out.dietz is None

    # The $-curve truncates to the anchored (D) side with a degradation flag.
    from services.allocator_equity_derive import allocator_equity_curve

    curve = allocator_equity_curve(per_key_equity)
    assert curve.equity is not None
    assert curve.flags["degraded"] is True
    assert curve.flags["dropped_keys"] == [c.key_id]


# ── Test 5 (STITCH-05): the unified ledger threads Dietz + MWR ────────────────

def test_unified_ledger_threads_dietz_and_mwr():
    c, d, seg, per_key_equity, returns = _cd_setup()
    real = {c.key_id: [ExternalFlow("2026-03-10", 10000.0)]}
    ledger = build_allocator_ledger(real, seg.seams, per_key_equity, returns)

    begin_value, end_value = 100000.0, 130000.0
    period_start, period_days = "2026-03-01", 60
    scalars = mwr_and_dietz_from_ledger(
        ledger,
        begin_value=begin_value,
        end_value=end_value,
        period_start=period_start,
        period_days=period_days,
    )
    assert scalars.computable is True
    mwr, dietz = scalars.mwr, scalars.dietz
    assert mwr is not None and dietz is not None
    import math

    assert math.isfinite(mwr) and math.isfinite(dietz)

    # The adapter's conversion IS the contract: it maps each ExternalFlow ledger
    # entry into the dict shapes the KEPT portfolio_metrics helpers expect. Rebuild
    # those shapes inline and assert byte-agreement.
    start = date.fromisoformat(period_start)
    end_date = (start + timedelta(days=period_days)).isoformat()
    # WR-03: the MWR IRR sees ONLY real-external flows — a synthetic rotation seam
    # is internal capital, never an investor action, so it is EXCLUDED here too.
    expected_mwr_flows = [{"date": period_start, "amount": -begin_value}]
    expected_mwr_flows += [
        {"date": e.flow.utc_day_iso, "amount": -float(e.flow.usd_signed)}
        for e in ledger
        if e.provenance != LEDGER_SEAM
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


# ── Test 6 (WR-03): a rotation seam is invisible to MWR but moves Dietz ───────

def test_rotation_seam_is_excluded_from_mwr_but_included_in_dietz():
    """A pure (equal-capital) rotation seam is INTERNAL redeployment — it must not
    enter the investor IRR. Build the same ledger WITH and WITHOUT the seam and
    assert MWR is INVARIANT to the seam (the seam is not an investor cash flow),
    while Modified Dietz DOES change (the boundary jump enters the Dietz
    denominator / ΣF numerator by design). Pins the WR-03 exclusion."""
    c, d, seg, per_key_equity, returns = _cd_setup()
    real = {c.key_id: [ExternalFlow("2026-03-10", 10000.0)]}

    ledger_with_seam = build_allocator_ledger(real, seg.seams, per_key_equity, returns)
    ledger_real_only = build_allocator_ledger(real, [], per_key_equity, returns)

    # Sanity: the only difference between the two ledgers is the seam entry.
    assert any(e.provenance == LEDGER_SEAM for e in ledger_with_seam)
    assert all(e.provenance == LEDGER_REAL for e in ledger_real_only)
    assert len(ledger_with_seam) == len(ledger_real_only) + 1

    begin_value, end_value = 100000.0, 130000.0
    period_start, period_days = "2026-03-01", 60
    seam_scalars = mwr_and_dietz_from_ledger(
        ledger_with_seam, begin_value=begin_value, end_value=end_value,
        period_start=period_start, period_days=period_days,
    )
    noseam_scalars = mwr_and_dietz_from_ledger(
        ledger_real_only, begin_value=begin_value, end_value=end_value,
        period_start=period_start, period_days=period_days,
    )
    mwr_seam, dietz_seam = seam_scalars.mwr, seam_scalars.dietz
    mwr_noseam, dietz_noseam = noseam_scalars.mwr, noseam_scalars.dietz
    assert None not in (mwr_seam, dietz_seam, mwr_noseam, dietz_noseam)

    # MWR is INVARIANT to the rotation seam — the seam never entered the IRR flows.
    assert mwr_seam == pytest.approx(mwr_noseam, rel=1e-12)
    # Modified Dietz DOES move — the seam entry is (correctly) in the Dietz flows.
    assert dietz_seam != pytest.approx(dietz_noseam, rel=1e-9)


# ── C4: LedgerScalars.computable distinguishes fail-loud from uncomputable ─────

def test_ledger_scalars_computable_distinguishes_failloud_from_computed():
    """C4: the adapter returns a ``LedgerScalars(mwr, dietz, computable)`` instead of
    a transposable ``(mwr, dietz)`` tuple that aliased the fail-loud unknown-magnitude
    path with an ordinarily-uncomputable scalar. ``computable`` is False ONLY on the
    ``known=False`` ledger; a known ledger is computable with finite scalars."""
    from services.allocator_equity_derive import LedgerScalars

    c, d, seg, per_key_equity, returns = _cd_setup()
    # Unknown magnitude (C unanchored) -> computable False, both scalars None.
    unknown_pke = {
        c.key_id: replay_key_equity(c.returns, [], None),
        d.key_id: per_key_equity[d.key_id],
    }
    unknown = build_allocator_ledger({}, seg.seams, unknown_pke, returns)
    fail = mwr_and_dietz_from_ledger(
        unknown, begin_value=100000.0, end_value=130000.0,
        period_start="2026-03-01", period_days=60,
    )
    assert isinstance(fail, LedgerScalars)
    assert fail.computable is False and fail.mwr is None and fail.dietz is None

    # Known magnitude -> computable True with finite scalars.
    known = build_allocator_ledger({}, seg.seams, per_key_equity, returns)
    ok = mwr_and_dietz_from_ledger(
        known, begin_value=100000.0, end_value=130000.0,
        period_start="2026-03-01", period_days=60,
    )
    assert ok.computable is True and ok.mwr is not None and ok.dietz is not None


# ── MEDIUM-4: an out-of-period ledger day refuses (no silent Dietz clamp) ──────

def test_out_of_period_ledger_entry_refuses_dietz_clamp():
    """MEDIUM-4: a ledger entry dated outside [0, period_days] is a construction bug.
    ``compute_modified_dietz`` would SILENTLY clamp the offset (M-0695), laundering a
    pre-period flow into a full-weight t=0 entry and producing a plausible-wrong
    Dietz. ``mwr_and_dietz_from_ledger`` now refuses it."""
    from services.nav_twr import NavReconstructionError

    # A flow dated 2 months BEFORE period_start -> offset < 0.
    ledger = build_allocator_ledger(
        {"key-X": [ExternalFlow("2026-01-01", 5000.0)]}, [], {}
    )
    with pytest.raises(NavReconstructionError):
        mwr_and_dietz_from_ledger(
            ledger, begin_value=100000.0, end_value=130000.0,
            period_start="2026-03-01", period_days=60,
        )


def test_out_of_period_ledger_entry_post_period_also_refuses():
    """T2: MEDIUM-4 had only the pre-period (offset < 0) branch tested. A POST-period
    entry (offset > period_days) is the symmetric construction bug that
    compute_modified_dietz would clamp to a zero-weight flow — assert the same
    refusal."""
    from services.nav_twr import NavReconstructionError

    # A flow ~2 months AFTER the period end (period 2026-03-01 + 30d = 2026-03-31).
    ledger = build_allocator_ledger(
        {"key-X": [ExternalFlow("2026-06-01", 5000.0)]}, [], {}
    )
    with pytest.raises(NavReconstructionError):
        mwr_and_dietz_from_ledger(
            ledger, begin_value=100000.0, end_value=130000.0,
            period_start="2026-03-01", period_days=30,
        )


# ── F1 (economic invariant): a seam-day real flow is booked EXACTLY once ───────

def test_seam_day_real_flow_booked_exactly_once():
    """F1: ``next_eq`` ALREADY contains a REAL external flow dated the seam day into a
    next-block member, so the forward-identity residual double-books it unless the
    seam subtracts seam-day next-block real flows. Economic pin (NOT the impl formula):
    the $10k deposit appears ONCE in the ledger and Dietz equals the independently
    hand-computed true value 10000/105000, not the doubled 0.0."""
    import pandas as pd

    a = pd.Series([0.0, 0.0, 0.0], index=["2026-03-01", "2026-03-02", "2026-03-03"], name="A")
    b = pd.Series([0.10, 0.0, 0.0], index=["2026-03-04", "2026-03-05", "2026-03-06"], name="B")
    # B: zero-cash redeployment of A's 100k + a genuine 10k deposit on the seam day
    # -> B first-day (end) equity 120000 = 100000*1.1 + 10000.
    pke = {
        "A": replay_key_equity(a, [], 100000.0),
        "B": replay_key_equity(b, [ExternalFlow("2026-03-04", 10000.0)], 120000.0),
    }
    seg = segment_coverage({"A": a, "B": b})
    real = {"B": [ExternalFlow("2026-03-04", 10000.0)]}
    ledger = build_allocator_ledger(real, seg.seams, pke, {"A": a, "B": b})

    real_entries = [e.flow.usd_signed for e in ledger if e.provenance == LEDGER_REAL]
    seam_entry = next(e for e in ledger if e.provenance == LEDGER_SEAM)
    assert real_entries == [10000.0]                       # booked once as LEDGER_REAL
    assert seam_entry.flow.usd_signed == pytest.approx(0.0, abs=1e-6)  # pure redeploy = 0
    assert sum(real_entries) + seam_entry.flow.usd_signed == pytest.approx(10000.0, abs=1e-6)

    # Dietz = the hand-computed truth (deposit at the period midpoint, w=0.5):
    #   (120000 - 100000 - 10000) / (100000 + 0.5*10000) = 10000/105000.
    scalars = mwr_and_dietz_from_ledger(
        ledger, begin_value=100000.0, end_value=120000.0,
        period_start="2026-03-01", period_days=6,
    )
    assert scalars.dietz == pytest.approx(10000.0 / 105000.0, abs=1e-6)


# ── T4/T5: partial + asymmetric multi-key block boundaries ────────────────────

_B1 = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"]
_B2 = ["2026-06-06", "2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10"]


def test_partial_block_boundary_whole_block_refuses():
    """T4: ``_boundary_equity_block`` returns None (seam ``known=False``) if ANY member
    of a concurrent block is unanchored — NEVER a partial sum. Only the all-anchored
    and single-key-unanchored shapes were tested; pin a 2-key next block with ONE
    unanchored member."""
    import pandas as pd

    p = pd.Series([0.01] * 5, index=_B1, name="key-P")
    q = pd.Series([0.02] * 5, index=_B1, name="key-Q")
    r = pd.Series([-0.01] * 5, index=_B2, name="key-R")
    s = pd.Series([0.005] * 5, index=_B2, name="key-S")
    returns = {"key-P": p, "key-Q": q, "key-R": r, "key-S": s}
    seg = segment_coverage(returns)
    assert len(seg.seams) == 1
    # R (a member of the NEXT block {R,S}) is unanchored -> whole-block magnitude UNKNOWN.
    pke = {
        "key-P": replay_key_equity(p, [], 50000.0),
        "key-Q": replay_key_equity(q, [], 30000.0),
        "key-R": replay_key_equity(r, [], None),
        "key-S": replay_key_equity(s, [], 20000.0),
    }
    ledger = build_allocator_ledger({}, seg.seams, pke, returns)
    seam_entry = next(e for e in ledger if e.provenance == LEDGER_SEAM)
    assert seam_entry.known is False  # never a partial P+Q vs S-only sum


def test_asymmetric_rotations_resolve_forward_identity():
    """T5: only symmetric single→single and block→block were covered. Pin a 1-key→2-key
    and a 2-key→1-key handoff (exercises _key_label, _seam_next_first_return capital-
    weighting, and _boundary_equity_block in a MIXED shape)."""
    import pandas as pd

    c = pd.Series([0.003] * 5, index=_B1, name="key-C")
    r = pd.Series([-0.01] * 5, index=_B2, name="key-R")
    s = pd.Series([0.005] * 5, index=_B2, name="key-S")

    # 1-key -> 2-key: C hands off to the {R,S} block.
    seg = segment_coverage({"key-C": c, "key-R": r, "key-S": s})
    assert len(seg.seams) == 1
    seam = seg.seams[0]
    assert seam.prev_keys == ("key-C",) and seam.next_keys == ("key-R", "key-S")
    assert seam.prev_key == "key-C" and seam.next_key == "key-R+key-S"
    pke = {
        "key-C": replay_key_equity(c, [], 50000.0),
        "key-R": replay_key_equity(r, [], 40000.0),
        "key-S": replay_key_equity(s, [], 20000.0),
    }
    ledger = build_allocator_ledger(
        {}, seg.seams, pke, {"key-C": c, "key-R": r, "key-S": s}
    )
    entry = next(e for e in ledger if e.provenance == LEDGER_SEAM)
    assert entry.known is True
    c_last = float(pke["key-C"].equity.iloc[-1])
    r_first = float(pke["key-R"].equity.iloc[0])
    s_first = float(pke["key-S"].equity.iloc[0])
    seam_day = seam.next_first_day
    r_blend = (
        r_first * float(r.loc[seam_day]) + s_first * float(s.loc[seam_day])
    ) / (r_first + s_first)
    assert entry.flow.usd_signed == pytest.approx(
        (r_first + s_first) - c_last * (1.0 + r_blend), abs=1e-6
    )

    # 2-key -> 1-key: the {P,Q} block hands off to single D.
    p = pd.Series([0.01] * 5, index=_B1, name="key-P")
    q = pd.Series([0.02] * 5, index=_B1, name="key-Q")
    dd = pd.Series([-0.001] * 5, index=_B2, name="key-D")
    seg2 = segment_coverage({"key-P": p, "key-Q": q, "key-D": dd})
    assert len(seg2.seams) == 1
    seam2 = seg2.seams[0]
    assert seam2.prev_keys == ("key-P", "key-Q") and seam2.next_keys == ("key-D",)
    assert seam2.prev_key == "key-P+key-Q" and seam2.next_key == "key-D"
    pke2 = {
        "key-P": replay_key_equity(p, [], 50000.0),
        "key-Q": replay_key_equity(q, [], 30000.0),
        "key-D": replay_key_equity(dd, [], 60000.0),
    }
    ledger2 = build_allocator_ledger(
        {}, seg2.seams, pke2, {"key-P": p, "key-Q": q, "key-D": dd}
    )
    entry2 = next(e for e in ledger2 if e.provenance == LEDGER_SEAM)
    assert entry2.known is True
    p_last = float(pke2["key-P"].equity.iloc[-1])
    q_last = float(pke2["key-Q"].equity.iloc[-1])
    d_first = float(pke2["key-D"].equity.iloc[0])
    r_d = float(dd.loc[seam2.next_first_day])
    assert entry2.flow.usd_signed == pytest.approx(
        d_first - (p_last + q_last) * (1.0 + r_d), abs=1e-6
    )


# ── Test 6b (Finding 2): MWR must respond to end_value (terminal never dropped) ─

def test_mwr_responds_to_end_value_on_withdrawal_dominant_ledger():
    """Finding 2: a withdrawal-heavy ledger (cumulative withdrawals >= begin +
    deposits) has net cash flow >= 0, so ``compute_mwr``'s own ``final_value`` append
    heuristic (`final_value>0 AND net_cf<0`) MISFIRES and the terminal wealth is
    dropped from the IRR entirely -> MWR identical for every ``end_value``. The
    adapter must append the terminal EXPLICITLY. Withdrawing more than the original
    stake after gains is a normal allocator action."""
    import math

    ledger = build_allocator_ledger(
        {"key-X": [ExternalFlow("2026-03-15", -150000.0)]}, [], {}
    )
    results = {}
    for ev in (1.0, 30000.0, 300000.0):
        mwr = mwr_and_dietz_from_ledger(
            ledger, begin_value=100000.0, end_value=ev,
            period_start="2026-03-01", period_days=60,
        ).mwr
        assert mwr is not None and math.isfinite(mwr)
        results[ev] = mwr

    # Three DISTINCT IRRs — the ending wealth is now visible to the solve.
    assert len({round(v, 6) for v in results.values()}) == 3
    # Monotone: more ending wealth -> higher IRR.
    assert results[1.0] < results[30000.0] < results[300000.0]


# ── Test 7 (WR-04): a block→block rotation seam resolves to a summed magnitude ─

def _block_rotation_setup():
    """Concurrent block {P,Q} rotates into a DISJOINT concurrent block {R,S} — an
    adjacent half-open handoff (P,Q window ends the day before R,S begins). All
    four keys anchored, so the block-to-block seam magnitude is KNOWABLE (the sum
    of each block's member equities at the boundary)."""
    import pandas as pd

    days1 = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"]
    days2 = ["2026-06-06", "2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10"]
    p = pd.Series([0.01] * 5, index=days1, name="key-P")
    q = pd.Series([0.02] * 5, index=days1, name="key-Q")
    r = pd.Series([-0.01] * 5, index=days2, name="key-R")
    s = pd.Series([0.005] * 5, index=days2, name="key-S")
    series = {"key-P": p, "key-Q": q, "key-R": r, "key-S": s}
    seg = segment_coverage(series)
    per_key_equity = {
        "key-P": replay_key_equity(p, [], 50000.0),
        "key-Q": replay_key_equity(q, [], 30000.0),
        "key-R": replay_key_equity(r, [], 40000.0),
        "key-S": replay_key_equity(s, [], 20000.0),
    }
    return series, seg, per_key_equity


def test_block_to_block_seam_resolves_known_with_summed_magnitude():
    """A concurrent-block → concurrent-block rotation seam resolves ``known=True``
    with magnitude == the SUMMED-block equity jump (WR-04). The OLD code looked up
    the '+'-joined ``"key-P+key-Q"`` label (never a real key) -> None -> the seam
    was stranded to ``known=False`` despite a knowable magnitude."""
    series, seg, per_key_equity = _block_rotation_setup()
    assert len(seg.seams) == 1, "block rotation must produce exactly one seam"
    seam = seg.seams[0]
    assert seam.prev_keys == ("key-P", "key-Q")
    assert seam.next_keys == ("key-R", "key-S")

    ledger = build_allocator_ledger({}, seg.seams, per_key_equity, series)
    seam_entry = next(e for e in ledger if e.provenance == LEDGER_SEAM)

    # The magnitude is now KNOWN (not stranded to False by the joined-label lookup).
    assert seam_entry.known is True

    p_last = float(per_key_equity["key-P"].equity.iloc[-1])
    q_last = float(per_key_equity["key-Q"].equity.iloc[-1])
    r_first = float(per_key_equity["key-R"].equity.iloc[0])
    s_first = float(per_key_equity["key-S"].equity.iloc[0])
    prev_block = p_last + q_last   # {P,Q} equity at the boundary (their last day)
    next_block = r_first + s_first  # {R,S} equity at the boundary (their first day)
    # Finding 3 (block form): the incoming block's first-day return is the
    # equity-weighted blend of R and S on the seam day; F strips it off prev_block.
    seam_day = seam.next_first_day
    r_next = float(series["key-R"].loc[seam_day])
    s_next = float(series["key-S"].loc[seam_day])
    r_blend = (r_first * r_next + s_first * s_next) / next_block
    assert seam_entry.flow.usd_signed == pytest.approx(
        next_block - prev_block * (1.0 + r_blend), abs=1e-6
    )


# ── Test 8 (Finding 3): seam flow satisfies the forward identity, not the jump ─

def test_seam_flow_satisfies_forward_identity_not_naive_jump():
    """Finding 3: derive the seam flow INDEPENDENTLY from the module's own forward
    identity ``equity_t = equity_{t-1}·(1 + r_t) + F_t`` over the concatenated C||D
    curve and assert the ledger's seam entry equals it. ``next_eq`` (D's END-of-first-
    day level) already contains D's first-day return on the redeployed capital, so the
    naive ``next_eq − prev_eq`` over-books the flow by ``prev_eq·r_seam`` (dropping
    that first-day P&L from performance). Proven gap on the C->D fixture: −$50."""
    c, d, seg, per_key_equity, returns = _cd_setup()
    ledger = build_allocator_ledger({}, seg.seams, per_key_equity, returns)
    seam_entry = next(e for e in ledger if e.provenance == LEDGER_SEAM)

    c_last = float(per_key_equity[c.key_id].equity.iloc[-1])   # equity_{prev_last}
    d_first = float(per_key_equity[d.key_id].equity.iloc[0])   # equity_{next_first}
    r_seam = float(d.returns.iloc[0])                          # r on next_first_day

    # Independent forward-identity solve for F (NOT the naive next_eq - prev_eq).
    forward_identity_F = d_first - c_last * (1.0 + r_seam)
    assert seam_entry.flow.usd_signed == pytest.approx(forward_identity_F, abs=1e-9)

    # The naive jump would over-book the flow by exactly prev_eq * r_seam.
    naive_F = d_first - c_last
    assert seam_entry.flow.usd_signed != pytest.approx(naive_F, abs=1e-3)
    assert (naive_F - forward_identity_F) == pytest.approx(c_last * r_seam, abs=1e-9)


def test_seam_without_next_side_return_is_magnitude_unknown():
    """Finding 3 fail-loud: the forward-identity seam needs the incoming block's
    first-day return. When ``returns_by_key`` is absent, a next-side key is missing
    from it, or its series lacks the seam-day return, the magnitude is UNKNOWN ->
    ``known=False`` (never fabricated)."""
    c, d, seg, per_key_equity, returns = _cd_setup()
    seam_day = seg.seams[0].next_first_day

    def _seam_known(returns_by_key):
        ledger = build_allocator_ledger({}, seg.seams, per_key_equity, returns_by_key)
        return next(e for e in ledger if e.provenance == LEDGER_SEAM).known

    # (a) no returns_by_key at all.
    assert _seam_known(None) is False
    # (b) the next key (D) is absent from returns_by_key.
    assert _seam_known({c.key_id: c.returns}) is False
    # (c) returns present but D's series lacks the seam-day return.
    assert _seam_known({c.key_id: c.returns, d.key_id: d.returns.drop(seam_day)}) is False
    # Control: the full returns resolve a KNOWN seam.
    assert _seam_known(returns) is True
