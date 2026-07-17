"""Phase 115 (E2) STITCH-03/04 — the $-equity backward-replay layer.

Pins the pure, I/O-free equity layer in ``services/allocator_equity_derive.py``:

  * STITCH-03 — the perf-curve (cumprod of returns, cashflow-neutral) and the
    $-equity-curve are DIFFERENT outputs. On a ZERO-flow fixture they are
    identical day-by-day; on a one-DEPOSIT fixture they diverge by exactly the
    flow step on the deposit day and stay parallel in return-space afterward. A
    deposit is NEVER a return.
  * STITCH-04 — the $-curve is reconstructed BACKWARD from the terminal venue
    anchor through the return path (``equity_{t-1} = (equity_t - F_t)/(1+r_t)``).
    ``anchor=None`` -> NO $-series (honest degradation, flagged), never invented.

All numbers below are hand-derivable with round intermediates (constant +10% legs
so the backward roll from a round anchor lands on round NAV levels). Local
fixtures only — the frozen shared ``tests/e2_fixtures.py`` is not edited (a
plan-05 tweak must never perturb these pins).
"""
from __future__ import annotations

import pandas as pd
import pytest

from services.allocator_equity_derive import (
    AllocatorEquity,
    KeyEquity,
    allocator_equity_curve,
    perf_curve,
    replay_key_equity,
)
from services.external_flows import ExternalFlow
from services.nav_twr import NavReconstructionError

# ── Local, hand-checkable fixtures (round backward-roll levels) ───────────────

_DAYS = ["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04"]


def _flat_returns() -> pd.Series:
    """Constant +10% every day (day-0 return is absorbed into equity_0)."""
    return pd.Series([0.10, 0.10, 0.10, 0.10], index=_DAYS, name="key-X")


# Zero-flow anchor 133100 -> backward roll [100000, 110000, 121000, 133100].
_ZERO_FLOW_ANCHOR = 133100.0
_ZERO_FLOW_EQUITY = [100000.0, 110000.0, 121000.0, 133100.0]

# One deposit of +10000 on day-1 (2026-05-02); anchor 145200 ->
# forward: 100000 -> *1.1 +10000 = 120000 -> *1.1 = 132000 -> *1.1 = 145200.
_DEPOSIT_DAY = "2026-05-02"
_DEPOSIT_USD = 10000.0
_DEPOSIT_ANCHOR = 145200.0
_DEPOSIT_EQUITY = [100000.0, 120000.0, 132000.0, 145200.0]


# ── Test 1 (STITCH-04): backward replay reproduces hand-computed NAV levels ───

def test_backward_replay_reproduces_round_nav_levels():
    ke = replay_key_equity(_flat_returns(), [], _ZERO_FLOW_ANCHOR)
    assert ke.equity is not None
    assert ke.reason is None
    assert list(ke.equity.index) == _DAYS
    for day, expected in zip(_DAYS, _ZERO_FLOW_EQUITY):
        assert ke.equity[day] == pytest.approx(expected, abs=1e-6), day
    # Forward identity holds for every day t>=1: (equity_t - F_t)/equity_{t-1} - 1 == r_t.
    r = _flat_returns()
    vals = ke.equity.to_numpy()
    for t in range(1, len(_DAYS)):
        implied = vals[t] / vals[t - 1] - 1.0
        assert implied == pytest.approx(float(r.iloc[t]), abs=1e-9), t


# ── Test 2 (STITCH-03 equivalence): zero-flow perf == normalized $-curve ──────

def test_zero_flow_perf_and_dollar_curves_are_identical():
    r = _flat_returns()
    ke = replay_key_equity(r, [], _ZERO_FLOW_ANCHOR)
    assert ke.equity is not None
    perf = perf_curve(r)
    dollar_norm = ke.equity / ke.equity.iloc[0]
    assert list(perf.index) == list(dollar_norm.index)
    for day in _DAYS:
        assert perf[day] == pytest.approx(dollar_norm[day], abs=1e-12), day


# ── Test 3 (STITCH-03 divergence): a deposit steps the $-curve, not the return ─

def test_deposit_diverges_dollar_curve_but_never_appears_as_a_return():
    r = _flat_returns()
    flows = [ExternalFlow(_DEPOSIT_DAY, _DEPOSIT_USD)]
    ke = replay_key_equity(r, flows, _DEPOSIT_ANCHOR)
    assert ke.equity is not None
    for day, expected in zip(_DAYS, _DEPOSIT_EQUITY):
        assert ke.equity[day] == pytest.approx(expected, abs=1e-6), day

    perf = perf_curve(r)  # pure cashflow-neutral return path
    dollar_norm = ke.equity / ke.equity.iloc[0]
    ratio = dollar_norm / perf

    # Before the deposit day the two curves are identical.
    assert ratio[_DAYS[0]] == pytest.approx(1.0, abs=1e-12)
    # On and after the deposit day they diverge by a CONSTANT factor (parallel in
    # return-space) — the deposit shifts the level once, never the growth rate.
    post = [ratio[d] for d in _DAYS[1:]]
    assert post[0] != pytest.approx(1.0, abs=1e-6)  # genuine divergence
    for value in post[1:]:
        assert value == pytest.approx(post[0], abs=1e-12)

    # The deposit NEVER leaks into the return path: the perf-curve's implied
    # day-over-day return equals the fixture return on the deposit day.
    perf_impl = perf[_DEPOSIT_DAY] / perf[_DAYS[0]] - 1.0
    assert perf_impl == pytest.approx(float(r.loc[_DEPOSIT_DAY]), abs=1e-12)


# ── Test 4 (STITCH-04 honest degradation): anchor=None -> no $-curve ──────────

def test_anchor_none_yields_no_dollar_curve_but_perf_survives():
    r = _flat_returns()
    ke = replay_key_equity(r, [], None)
    assert ke.equity is None
    assert ke.reason is not None  # machine token, no USD
    # The perf-curve is UNAFFECTED by the missing anchor.
    assert perf_curve(r) is not None


def test_allocator_curve_over_common_anchored_window_flags_degradation():
    r = _flat_returns()
    anchored = replay_key_equity(r, [], _ZERO_FLOW_ANCHOR)
    dropped = replay_key_equity(r, [], None)
    # One anchored key + one anchor=None key -> curve over the anchored key only,
    # degraded flag set.
    out = allocator_equity_curve({"key-A": anchored, "key-B": dropped})
    assert isinstance(out, AllocatorEquity)
    assert out.equity is not None
    assert out.flags["degraded"] is True
    assert out.flags["dropped_keys"] == ["key-B"]
    for day, expected in zip(_DAYS, _ZERO_FLOW_EQUITY):
        assert out.equity[day] == pytest.approx(expected, abs=1e-6), day

    # Every key unanchored -> $-curve None + honest-empty flag.
    none_out = allocator_equity_curve({"key-A": dropped, "key-B": dropped})
    assert none_out.equity is None
    assert none_out.flags.get("honest_empty") is True


# ── Test 5 (HIGH-1 mirror): a flow on a no-return day is a valid zero-r day ────

def test_flow_on_a_no_return_day_becomes_a_valid_union_day():
    # Returns only on days 1..3; a deposit lands on day 0 which is ABSENT from the
    # return index — it must union in as a zero-return equity day, never dropped.
    returns = pd.Series([0.10, 0.10, 0.10], index=_DAYS[1:], name="key-X")
    flows = [ExternalFlow(_DAYS[0], 5000.0)]  # day absent from the return index
    ke = replay_key_equity(returns, flows, _ZERO_FLOW_ANCHOR)
    assert ke.equity is not None
    assert list(ke.equity.index) == _DAYS  # the no-return day unioned in
    assert ke.reason is None


# ── Test 6 (aggregation): allocator $-curve == sum of per-key $-curves ─────────

def test_allocator_curve_is_the_daily_sum_of_anchored_keys():
    r = _flat_returns()
    a = replay_key_equity(r, [], _ZERO_FLOW_ANCHOR)          # [100k,110k,121k,133.1k]
    b = replay_key_equity(r, [], 2.0 * _ZERO_FLOW_ANCHOR)    # double, same path
    out = allocator_equity_curve({"key-A": a, "key-B": b})
    assert out.equity is not None
    assert out.flags["degraded"] is False
    for day in _DAYS:
        assert out.equity[day] == pytest.approx(
            float(a.equity[day]) + float(b.equity[day]), abs=1e-6
        ), day


# ── Test 7 (WR-01): unequal anchored windows span the UNION, not the ∩ ────────

def test_unequal_windows_span_union_and_terminal_is_sum_of_anchors():
    """Two ANCHORED keys with DIFFERENT windows: the allocator curve must span the
    UNION (each key's last-known mark carried forward past its own last day), so the
    terminal == Σ of each key's OWN anchor — NOT the rolled-back intersection level
    the old ∩-only sum produced. The truncation is flagged, never silent (WR-01)."""
    # key-A: +10% over the full 4-day window, anchor 133100 -> [100k,110k,121k,133.1k].
    a = replay_key_equity(_flat_returns(), [], _ZERO_FLOW_ANCHOR)
    # key-B: +10% over only the FIRST TWO days, anchor 121000 -> [110k,121k]. B's
    # window ends 2026-05-02, two days BEFORE A's — the WR-01 unequal-window case.
    b_returns = pd.Series([0.10, 0.10], index=_DAYS[:2], name="key-B")
    b = replay_key_equity(b_returns, [], 121000.0)
    assert list(b.equity.index) == _DAYS[:2]
    assert b.equity.iloc[-1] == pytest.approx(121000.0, abs=1e-6)  # B's own anchor

    out = allocator_equity_curve({"key-A": a, "key-B": b})
    assert out.equity is not None
    # Curve spans the UNION (all four days), not the 2-day intersection.
    assert list(out.equity.index) == _DAYS

    # Terminal == Σ of each key's OWN anchor (A's 133100 + B's carried-forward 121000).
    assert out.equity.iloc[-1] == pytest.approx(133100.0 + 121000.0, abs=1e-6)
    # It is NOT the old rolled-back intersection terminal (A@day1 + B@day1 = 231000).
    assert out.equity.iloc[-1] != pytest.approx(231000.0, abs=1.0)

    # Per-day: A summed with B's actual level (days 0-1) then B carried forward.
    expected = [210000.0, 231000.0, 242000.0, 254100.0]
    for day, exp in zip(_DAYS, expected):
        assert out.equity[day] == pytest.approx(exp, abs=1e-6), day

    # The truncation/staleness is FLAGGED, never silent.
    assert out.flags["degraded"] is True
    assert out.flags["window_truncated"] is True
    assert out.flags["dropped_keys"] == []
    assert out.flags["n_tail_days_carried"] == 2  # B stale on the last two union days


# ── MEDIUM-2: a non-finite return value refuses (never a silent NaN curve) ────

def test_non_finite_return_value_refuses_in_perf_curve_and_blend():
    """MEDIUM-2: a PRESENT-but-NaN return (a csv gap) propagated through
    ``(1+r).cumprod()`` / the weighted blend into a silent NaN curve with no flag.
    Both perf_curve and blend (including the sole-key passthrough) now refuse a
    non-finite return VALUE at ingestion."""
    from services.allocator_equity_derive import blend_concurrent_returns

    rn = pd.Series([0.10, float("nan"), 0.10], index=_DAYS[:3], name="k")
    with pytest.raises(NavReconstructionError):
        perf_curve(rn)
    with pytest.raises(NavReconstructionError):
        blend_concurrent_returns({"a": rn, "b": rn}, {"a": 1.0, "b": 1.0})
    # The sole-key passthrough is guarded too (would otherwise copy the NaN series).
    with pytest.raises(NavReconstructionError):
        blend_concurrent_returns({"a": rn}, {"a": 1.0})


# ── MEDIUM-3: day-0 total loss is distinguishable from an empty series ────────

def test_perf_curve_day0_total_loss_is_distinct_from_empty():
    """MEDIUM-3: ``perf_curve`` returned ``None`` for BOTH an empty series and a
    day-0 −100% (``1 + r_0 == 0``), conflating no-data with a total wipeout. An
    interior −100% still normalizes to 0; only day-0 breaks the divisor. Now day-0
    total loss fails loud, distinct from the empty-series ``None``."""
    assert perf_curve(pd.Series([], dtype=float)) is None  # no-data still None
    with pytest.raises(NavReconstructionError):
        perf_curve(pd.Series([-1.0, 0.10], index=_DAYS[:2]))
    # An INTERIOR −100% still normalizes (steps to 0), never raised.
    interior = perf_curve(pd.Series([0.10, -1.0, 0.10], index=_DAYS[:3]))
    assert interior is not None
    assert float(interior.iloc[1]) == pytest.approx(0.0, abs=1e-12)


# ── MEDIUM-5: an out-of-window flow is flagged, not silently unioned ──────────

def test_out_of_window_flow_is_flagged_not_silently_unioned():
    """MEDIUM-5: a flow dated OUTSIDE the return window [first, last] (typo year /
    out-of-window transfer) silently extended the reconstructed curve with a
    fabricated point and no signal. It still unions in (the HIGH-1 pre-window shape
    is legitimate) but is now COUNTED so the extension is never invisible."""
    r = pd.Series([0.10, 0.10, 0.10], index=_DAYS[:3], name="k")
    ke = replay_key_equity(r, [ExternalFlow("2020-01-01", 100.0)], 1000.0)
    assert "2020-01-01" in [str(x) for x in ke.equity.index]  # behavior preserved
    assert ke.flags.get("out_of_window_flows") == 1           # but now flagged
    # An in-window-only flow set carries no out-of-window flag.
    ke2 = replay_key_equity(r, [ExternalFlow(_DAYS[1], 50.0)], 1000.0)
    assert ke2.flags.get("out_of_window_flows", 0) == 0


# ── Test 8 (Finding 1): a rotated-out key stops contributing, no double-count ─

def test_rotation_seam_prev_key_stops_contributing_no_double_count():
    """Finding 1: a key on the PREV side of a rotation seam hands its capital to the
    next block (``build_allocator_ledger`` books the jump as internal redeployment).
    It must STOP contributing after its own last day — carrying its stale mark
    forward (the benign concurrent WR-01 case) would DOUBLE-COUNT the redeployed
    capital: it would appear both as the prev key's carried level AND inside the next
    block. Uses the frozen C->D rotation fixture (C 50k Mar1-20 -> D 60k Mar21-Apr9)."""
    from services.allocator_equity_derive import segment_coverage
    from tests.e2_fixtures import ANCHORS, rotated_seam_pair

    c, d = rotated_seam_pair()
    pke = {
        c.key_id: replay_key_equity(c.returns, [], ANCHORS[c.key_id]),
        d.key_id: replay_key_equity(d.returns, [], ANCHORS[d.key_id]),
    }
    seg = segment_coverage({c.key_id: c.returns, d.key_id: d.returns})
    seam_day = seg.seams[0].next_first_day
    d_first = float(pke[d.key_id].equity.iloc[0])

    # Default path: the curve derives the seam classification internally.
    out = allocator_equity_curve(pke)
    # On the seam day C has rotated out -> curve == D's first level alone, NOT
    # C_last(50000) + D_first (the old ~111151 double-count).
    assert out.equity[seam_day] == pytest.approx(d_first, abs=1e-6)
    assert out.equity[seam_day] != pytest.approx(50000.0 + d_first, abs=1.0)
    # Terminal == D's anchor alone (C's capital BECAME D; it is not still held).
    assert out.equity.iloc[-1] == pytest.approx(60000.0, abs=1e-6)
    assert out.equity.iloc[-1] != pytest.approx(110000.0, abs=1.0)
    assert out.flags["rotated_out_keys"] == [c.key_id]

    # Explicit-seams path yields the identical curve (caller may pass the same seam
    # list build_allocator_ledger uses, for guaranteed ledger/curve agreement).
    out2 = allocator_equity_curve(pke, seams=seg.seams)
    assert list(out2.equity) == pytest.approx(list(out.equity), abs=1e-9)


# ── Guard: a withdrawal that drives equity non-positive refuses structurally ──

def test_non_positive_intermediate_equity_refuses_without_leaking_usd():
    # A deposit dwarfing prior capital forces a non-positive reconstructed equity
    # on the backward roll (equity_{t-1} = (equity_t - F_t)/(1+r_t) goes <= 0).
    r = _flat_returns()
    flows = [ExternalFlow(_DEPOSIT_DAY, 1_000_000.0)]
    with pytest.raises(NavReconstructionError) as exc:
        replay_key_equity(r, flows, _ZERO_FLOW_ANCHOR)
    msg = str(exc.value)
    # No raw USD magnitude may appear in the refusal (T-115-05 / T-73-02).
    for token in ("1000000", "1_000_000", "133100", "100000"):
        assert token not in msg
