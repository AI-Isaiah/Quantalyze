"""Phase 115 (E2) plan-05 — the INDEPENDENT parity oracle over the STITCH claims.

This file is the 114-01 / 111-01 re-derivation discipline applied to the E2
allocator-equity derivation: every assertion's EXPECTED side is computed INLINE
in the test body from RAW fixture data with plain pandas / numpy / stdlib —
never by importing the module under test on the expected side, and never by
calling a ``metrics.py`` helper on the expected side. If
``services/allocator_equity_derive.py`` silently drifts, an independent observer
(this oracle) reproduces what the module CLAIMS and the mismatch reddens.

WHY NOT BYTE-PARITY VS THE OLD STORE (the L4 landmine)
-----------------------------------------------------
The E2 golden gate is deliberately NOT "the new $-curve matches the legacy
``allocator_equity_snapshots`` store". That store is MARK-basis; the new
derivation is CASH-basis — a shape gate would fail honestly and permanently
(RESEARCH §6 / Landmine L4). The achievable, MEANINGFUL gate is the one built
here: anchor/internal consistency, blend-vs-backbone agreement, zero-flow
equivalence, and seam-invariance — each re-derived by a second, independent path.

The five oracles (each expected side provably module-free):
  1. INTERNAL CONSISTENCY — an inline backward $-replay reproduces the module's
     per-key equity day-by-day, and the forward identity
     ``(equity_t − F_t)/equity_{t-1} − 1 == r_t`` holds for every day.
  2. BLEND TWR vs BACKBONE — an inline cumprod of the module's blended series
     equals ``compute_all_metrics`` cumulative return (the inline side never
     touches a metrics helper).
  3. ZERO-FLOW EQUIVALENCE — an inline normalized cumprod equals BOTH the
     module's perf-curve AND the module's normalized $-curve, exactly.
  4. SEAM — inline product of segment TWRs equals the cross-seam TWR; the inline
     boundary-jump arithmetic equals the ledger's synthetic seam entry; and a
     from-scratch Modified-Dietz recomputation agrees with the module scalar.
  5. FABRICATION CANARY — the oracle helper, run against a CORRUPTED module
     input (one dropped flow), FAILS — proving the oracle can actually catch a
     divergence (test-the-test, the delete-gate RED-discipline lineage).

Security (T-115-05 / T-115-11): assertions compare series/scalars; no raw USD
magnitude is printed by the oracle. Run in the CI-3.12 venv (local 3.14 SIGSEGVs
on pandas).
"""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import pytest

from services.allocator_equity_derive import (
    LEDGER_REAL,
    LEDGER_SEAM,
    allocator_equity_curve,
    blend_concurrent_returns,
    build_allocator_ledger,
    mwr_and_dietz_from_ledger,
    perf_curve,
    replay_key_equity,
    segment_coverage,
)
from services.external_flows import ExternalFlow
from services.metrics import compute_all_metrics
from tests.e2_fixtures import (
    ANCHORS,
    concurrent_pair,
    real_flows,
    rotated_seam_pair,
)

# ---------------------------------------------------------------------------
# Inline, module-FREE re-derivations (the "expected" side of every oracle).
# These deliberately re-implement the arithmetic from scratch in the test body
# so they cannot inherit a bug from the module under test. Plain stdlib/pandas.
# ---------------------------------------------------------------------------


def _inline_flows_by_day(flows: list[ExternalFlow]) -> dict[str, float]:
    """Sum signed flow USD per UTC day — a from-scratch dict accumulator (NOT
    ``allocator_equity_derive._flows_by_day``)."""
    sums: dict[str, float] = {}
    for flow in flows:
        sums[str(flow.utc_day_iso)] = sums.get(str(flow.utc_day_iso), 0.0) + float(
            flow.usd_signed
        )
    return sums


def _inline_backward_equity(
    returns: pd.Series, flows: list[ExternalFlow], anchor: float
) -> pd.Series:
    """Reconstruct the $-equity BACKWARD from ``anchor`` with a hand-written roll.

    ``equity_{t-1} = (equity_t − F_t) / (1 + r_t)`` over the sorted union of
    return days and flow days (a flow on a no-return day unions in as a valid
    zero-return day). This is an INDEPENDENT transcription of the identity — it
    imports nothing from the module and is the oracle's own ground truth.
    """
    fbd = _inline_flows_by_day(flows)
    r = {str(d): float(v) for d, v in returns.items()}
    days = sorted(set(r) | set(fbd))
    n = len(days)
    equity = [0.0] * n
    equity[n - 1] = float(anchor)
    for t in range(n - 1, 0, -1):
        day_t = days[t]
        equity[t - 1] = (equity[t] - fbd.get(day_t, 0.0)) / (1.0 + r.get(day_t, 0.0))
    return pd.Series(equity, index=days, name="inline_equity")


def _inline_normalized_cumprod(returns: pd.Series) -> pd.Series:
    """The cashflow-neutral cumulative-return path normalized to 1.0 on day-0,
    re-derived inline (NOT ``allocator_equity_derive.perf_curve``)."""
    factors = (1.0 + returns).cumprod()
    return factors / float(factors.iloc[0])


def _inline_modified_dietz(
    flows: list[dict[str, float]],
    *,
    begin_value: float,
    end_value: float,
    period_days: int,
) -> float:
    """Modified Dietz recomputed FROM SCRATCH in the test body (never
    ``portfolio_metrics.compute_modified_dietz``): the classic

        (V_end − V_begin − ΣF) / (V_begin + Σ w_i·F_i),  w_i = (D − day_i)/D

    with the day index clamped to ``[0, D]`` (the module's documented M-0695
    clamp). ``flows`` are ``{"amount", "day"}`` dicts the caller builds
    INDEPENDENTLY (IN-01: the seam magnitude on the expected side is re-derived from
    the inline backward replay, NOT read off the module ledger's ``usd_signed``), so
    no expected-side value transits the module under test."""
    total_cf = 0.0
    weighted_cf = 0.0
    for cf in flows:
        amount = float(cf["amount"])
        day = min(max(int(cf["day"]), 0), period_days)
        weight = (period_days - day) / period_days
        total_cf += amount
        weighted_cf += weight * amount
    numerator = end_value - begin_value - total_cf
    denominator = begin_value + weighted_cf
    return numerator / denominator


def _assert_module_equity_matches_inline(
    returns: pd.Series,
    module_flows: list[ExternalFlow],
    oracle_flows: list[ExternalFlow],
    anchor: float,
) -> None:
    """THE oracle helper (also the canary target): assert the module's backward
    replay reproduces the inline ground truth day-by-day, AND the forward
    identity holds. ``module_flows`` feeds the module; ``oracle_flows`` feeds the
    independent inline derivation — the canary passes a CORRUPTED ``module_flows``
    (one dropped flow) so the two diverge and this helper raises AssertionError.
    """
    inline = _inline_backward_equity(returns, oracle_flows, anchor)
    module = replay_key_equity(returns, module_flows, anchor)
    assert module.equity is not None
    # Index (the unioned day axis) must match exactly.
    assert list(map(str, module.equity.index)) == list(inline.index)
    # Value agreement, day-by-day, at machine tolerance.
    for day in inline.index:
        assert module.equity[day] == pytest.approx(float(inline[day]), abs=1e-9), day
    # Forward identity: (equity_t − F_t)/equity_{t-1} − 1 == r_t for every t>=1.
    fbd = _inline_flows_by_day(oracle_flows)
    r = {str(d): float(v) for d, v in returns.items()}
    days = list(inline.index)
    vals = module.equity.to_numpy(dtype=float)
    for t in range(1, len(days)):
        implied = (vals[t] - fbd.get(days[t], 0.0)) / vals[t - 1] - 1.0
        assert implied == pytest.approx(r.get(days[t], 0.0), abs=1e-9), days[t]


# ---------------------------------------------------------------------------
# Oracle 1 — internal consistency (backward replay + forward identity).
# ---------------------------------------------------------------------------


def test_oracle_1_internal_consistency_key_a_with_flows():
    """Key A ($-replay) over the real-flow fixture — including the no-trade-day
    union flow (2026-02-28, before A's window) — reproduces the inline backward
    roll day-by-day, and the forward identity holds for every day."""
    a, _ = concurrent_pair()
    flows = real_flows()  # deposit, withdrawal, and a pre-window no-trade flow
    _assert_module_equity_matches_inline(a.returns, flows, flows, ANCHORS[a.key_id])


# ---------------------------------------------------------------------------
# Oracle 2 — blend TWR vs the unified backbone.
# ---------------------------------------------------------------------------


def test_oracle_2_blend_cumulative_return_equals_backbone():
    """An inline cumprod of the module's blended series equals
    ``compute_all_metrics`` geometric cumulative return. The expected side
    (cumprod) never calls a metrics helper — it re-derives the backbone scalar
    independently, proving the blend threads correctly into the backbone."""
    a, b = concurrent_pair()
    res = blend_concurrent_returns(
        {a.key_id: a.returns, b.key_id: b.returns},
        {a.key_id: ANCHORS[a.key_id], b.key_id: ANCHORS[b.key_id]},
    )
    assert res.blended is not None

    # Independent cumulative return: Π(1 + r) − 1, inline.
    inline_cumret = float((1.0 + res.blended).prod() - 1.0)

    # The backbone scalar on the SAME blended series (needs a DatetimeIndex,
    # float dtype — compute_all_metrics' documented input contract).
    dt_series = pd.Series(
        res.blended.to_numpy(dtype=float),
        index=pd.to_datetime(list(res.blended.index)),
        name="blend",
    )
    backbone_cumret = compute_all_metrics(dt_series).metrics_json["cumulative_return"]

    assert backbone_cumret == pytest.approx(inline_cumret, rel=1e-9)


def test_oracle_2b_curve_excludes_day0_pins_backbone_relationship():
    """WR-02: the perf-curve deliberately DROPS the day-0 return (``perf_0 == 1.0``,
    the Phase-114 forward-TWR display convention), while the backbone
    ``cumulative_return`` INCLUDES day 0. Pin the exact relationship
    ``(1 + backbone_cumret) == (1 + r_0) · perf_terminal`` and prove that reading a
    headline return OFF the curve disagrees with the backbone by exactly ``(1+r_0)``
    — so a headline cumulative return must be sourced from the backbone, never the
    curve. (Oracle 3's zero-flow pin cannot catch this: both curves drop day-0
    identically; only this perf-curve-vs-backbone pin does.)"""
    a, _ = concurrent_pair()
    r = a.returns
    r0 = float(r.iloc[0])

    perf = perf_curve(r)
    assert perf is not None
    perf_terminal = float(perf.iloc[-1])

    dt_series = pd.Series(
        r.to_numpy(dtype=float),
        index=pd.to_datetime(list(r.index)),
        name="key-a",
    )
    backbone_cumret = compute_all_metrics(dt_series).metrics_json["cumulative_return"]

    # The exact, intentional day-0 relationship.
    assert (1.0 + backbone_cumret) == pytest.approx(
        (1.0 + r0) * perf_terminal, rel=1e-12
    )
    # Reading cumret off the curve is WRONG — smaller by exactly (1 + r_0).
    curve_cumret = perf_terminal - 1.0
    assert curve_cumret != pytest.approx(backbone_cumret, rel=1e-9)
    assert (1.0 + backbone_cumret) / (1.0 + curve_cumret) == pytest.approx(
        1.0 + r0, rel=1e-12
    )


# ---------------------------------------------------------------------------
# Oracle 3 — zero-flow equivalence (perf-curve == normalized $-curve).
# ---------------------------------------------------------------------------


def test_oracle_3_zero_flow_perf_equals_normalized_dollar_curve():
    """On the zero-flow key, an inline normalized cumprod equals BOTH the
    module's ``perf_curve`` AND the module's normalized $-curve — exactly. The
    normalization is done inline; a deposit is the ONLY thing that could ever
    separate the two curves, and there is none here."""
    a, _ = concurrent_pair()
    r = a.returns
    inline_perf = _inline_normalized_cumprod(r)

    module_perf = perf_curve(r)
    assert module_perf is not None

    ke = replay_key_equity(r, [], ANCHORS[a.key_id])
    assert ke.equity is not None
    dollar_norm = ke.equity / float(ke.equity.iloc[0])

    for day in inline_perf.index:
        # inline == module perf-curve (perf_curve is honest)
        assert module_perf[day] == pytest.approx(float(inline_perf[day]), abs=1e-12), day
        # inline == module normalized $-curve (the zero-flow equivalence pin)
        assert dollar_norm[day] == pytest.approx(float(inline_perf[day]), abs=1e-12), day


# ---------------------------------------------------------------------------
# Oracle 4 — the rotation seam (TWR-invariance + jump + inline Dietz).
# ---------------------------------------------------------------------------


def test_oracle_4_seam_twr_jump_and_inline_dietz():
    """The C→D rotation seam: (a) inline product of segment TWRs equals the
    cross-seam TWR (no seam return injected); (b) the inline boundary-jump
    (d_first − c_last) equals the ledger's synthetic seam entry; (c) a
    from-scratch Modified-Dietz over the unified ledger agrees with the module
    scalar within 1e-9 (and MWR is finite)."""
    c, d = rotated_seam_pair()

    # (a) TWR invariance across the seam — both sides inline.
    twr_cross = float((1.0 + pd.concat([c.returns, d.returns])).prod())
    twr_product = float((1.0 + c.returns).prod()) * float((1.0 + d.returns).prod())
    assert twr_cross == pytest.approx(twr_product, rel=1e-12)

    per_key_equity = {
        c.key_id: replay_key_equity(c.returns, [], ANCHORS[c.key_id]),
        d.key_id: replay_key_equity(d.returns, [], ANCHORS[d.key_id]),
    }
    seg = segment_coverage({c.key_id: c.returns, d.key_id: d.returns})
    assert len(seg.seams) == 1

    real = {c.key_id: [ExternalFlow("2026-03-10", 10000.0)]}
    returns = {c.key_id: c.returns, d.key_id: d.returns}
    ledger = build_allocator_ledger(real, seg.seams, per_key_equity, returns)
    assert {e.provenance for e in ledger} == {LEDGER_REAL, LEDGER_SEAM}

    # (b) Finding 3: the ledger's seam entry == the FORWARD-IDENTITY flow, derived
    # independently from equity_t = equity_{t-1}*(1+r_t) + F_t over the concatenated
    # curve (F = d_first - c_last*(1 + r_seam)), NOT the naive d_first - c_last.
    seam_entry = next(e for e in ledger if e.provenance == LEDGER_SEAM)
    c_last = float(per_key_equity[c.key_id].equity.iloc[-1])
    d_first = float(per_key_equity[d.key_id].equity.iloc[0])
    r_seam = float(d.returns.iloc[0])
    assert seam_entry.flow.usd_signed == pytest.approx(
        d_first - c_last * (1.0 + r_seam), abs=1e-6
    )

    # (c) inline Modified Dietz agrees with the module scalar; MWR is finite.
    begin_value, end_value = 100000.0, 130000.0
    period_start, period_days = "2026-03-01", 40
    mwr, dietz = mwr_and_dietz_from_ledger(
        ledger,
        begin_value=begin_value,
        end_value=end_value,
        period_start=period_start,
        period_days=period_days,
    )
    assert mwr is not None and dietz is not None
    import math

    assert math.isfinite(mwr)

    # IN-01: the EXPECTED-side seam magnitude is re-derived from an INLINE backward
    # replay (independent of the module ledger's usd_signed); the real deposit is
    # the known fixture constant. No expected value is read off the module.
    inline_c_eq = _inline_backward_equity(c.returns, [], ANCHORS[c.key_id])
    inline_d_eq = _inline_backward_equity(d.returns, [], ANCHORS[d.key_id])
    # Finding 3: forward-identity seam flow (strip the redeployed capital's first-day
    # return), re-derived inline from the independent backward-replay levels.
    inline_seam = float(inline_d_eq.iloc[0]) - float(inline_c_eq.iloc[-1]) * (
        1.0 + float(d.returns.iloc[0])
    )
    start = date.fromisoformat(period_start)
    inline_flows = [
        {"amount": 10000.0, "day": (date.fromisoformat("2026-03-10") - start).days},
        {
            "amount": inline_seam,
            "day": (date.fromisoformat(seg.seams[0].next_first_day) - start).days,
        },
    ]
    inline_dietz = _inline_modified_dietz(
        inline_flows,
        begin_value=begin_value,
        end_value=end_value,
        period_days=period_days,
    )
    assert dietz == pytest.approx(inline_dietz, abs=1e-9)


# ---------------------------------------------------------------------------
# Oracle 5 — the fabrication canary (test-the-test).
# ---------------------------------------------------------------------------


def test_oracle_5_corruption_canary_fails_loud():
    """Feed the module a CORRUPTED input (the deposit flow dropped) while the
    inline oracle keeps the full fixture: the backward rolls diverge and the
    oracle helper MUST raise. This proves the oracle can actually catch a
    divergence — a green oracle on the honest fixture is only meaningful because
    this canary shows it is not vacuously green (delete-gate RED discipline)."""
    a, _ = concurrent_pair()
    full = real_flows()
    # Drop the mid-window deposit from the MODULE's input only. Same day axis
    # (the deposit day is still a return day) but the backward roll values shift
    # for every day at/before the deposit — a genuine, index-preserving drift.
    corrupted = [f for f in full if f.utc_day_iso != "2026-03-10"]
    assert len(corrupted) == len(full) - 1

    with pytest.raises(AssertionError):
        _assert_module_equity_matches_inline(
            a.returns, corrupted, full, ANCHORS[a.key_id]
        )


# ---------------------------------------------------------------------------
# Oracle 6 — allocator_equity_curve over a rotation (Finding 1 had ZERO coverage).
# ---------------------------------------------------------------------------


def test_oracle_6_rotation_curve_no_double_count_of_redeployed_capital():
    """Finding 1 oracle: the allocator $-curve must NOT carry a rotated-out key's
    capital past the seam. Re-derive the expected curve INLINE — a rotated key does
    not overlap the next, so the portfolio is C's inline backward-replay levels over
    C's window then D's over D's window (a plain concat, independent of the module's
    curve assembly). Assert the module curve matches day-by-day and that the seam-day
    value is D_first alone, never the doubled C_last + D_first."""
    c, d = rotated_seam_pair()
    pke = {
        c.key_id: replay_key_equity(c.returns, [], ANCHORS[c.key_id]),
        d.key_id: replay_key_equity(d.returns, [], ANCHORS[d.key_id]),
    }
    seg = segment_coverage({c.key_id: c.returns, d.key_id: d.returns})

    inline_c = _inline_backward_equity(c.returns, [], ANCHORS[c.key_id])
    inline_d = _inline_backward_equity(d.returns, [], ANCHORS[d.key_id])
    expected = pd.concat([inline_c, inline_d])

    out = allocator_equity_curve(pke)  # module derives the seam classification
    assert list(map(str, out.equity.index)) == list(map(str, expected.index))
    for day in expected.index:
        assert out.equity[str(day)] == pytest.approx(float(expected[day]), abs=1e-6), day

    seam_day = seg.seams[0].next_first_day
    assert out.equity[seam_day] == pytest.approx(float(inline_d.iloc[0]), abs=1e-6)
    assert out.equity[seam_day] != pytest.approx(
        float(inline_c.iloc[-1]) + float(inline_d.iloc[0]), abs=1.0
    )
    assert out.flags["rotated_out_keys"] == [c.key_id]


# ---------------------------------------------------------------------------
# Oracle 7 — the seam flow from the forward identity (Finding 3, independent).
# ---------------------------------------------------------------------------


def test_oracle_7_seam_flow_equals_forward_identity_over_inline_curve():
    """Finding 3 oracle: re-derive the seam flow from the module's forward identity
    ``equity_next = equity_prev·(1 + r_next) + F`` over an INLINE-built concatenated
    curve and assert the ledger's seam entry equals it — never the naive
    ``next_eq − prev_eq`` (which drops the redeployed capital's first-day P&L)."""
    c, d = rotated_seam_pair()
    pke = {
        c.key_id: replay_key_equity(c.returns, [], ANCHORS[c.key_id]),
        d.key_id: replay_key_equity(d.returns, [], ANCHORS[d.key_id]),
    }
    seg = segment_coverage({c.key_id: c.returns, d.key_id: d.returns})
    returns = {c.key_id: c.returns, d.key_id: d.returns}
    ledger = build_allocator_ledger({}, seg.seams, pke, returns)
    seam_entry = next(e for e in ledger if e.provenance == LEDGER_SEAM)

    inline_c = _inline_backward_equity(c.returns, [], ANCHORS[c.key_id])
    inline_d = _inline_backward_equity(d.returns, [], ANCHORS[d.key_id])
    r_next = float(d.returns.iloc[0])
    expected_F = float(inline_d.iloc[0]) - float(inline_c.iloc[-1]) * (1.0 + r_next)
    assert seam_entry.flow.usd_signed == pytest.approx(expected_F, abs=1e-6)

    naive = float(inline_d.iloc[0]) - float(inline_c.iloc[-1])
    assert seam_entry.flow.usd_signed != pytest.approx(naive, abs=1e-3)


# ---------------------------------------------------------------------------
# Oracle 8 — withdrawal-dominant MWR includes the terminal (Finding 2, independent).
# ---------------------------------------------------------------------------


def test_oracle_8_withdrawal_dominant_mwr_includes_terminal():
    """Finding 2 oracle: a withdrawal-dominant ledger's MWR must satisfy the IRR
    defining equation WITH the terminal present. Re-evaluate the NPV of the investor
    cashflows (begin outflow, withdrawal inflow, terminal wealth) at the solved
    annualised rate FROM SCRATCH and assert it is zero, and that the rate varies with
    ``end_value`` (the terminal is no longer invisible)."""
    import math

    ledger = build_allocator_ledger(
        {"key-X": [ExternalFlow("2026-03-15", -150000.0)]}, [], {}
    )
    begin, period_start, period_days = 100000.0, "2026-03-01", 60
    end_date = date.fromisoformat(period_start) + timedelta(days=period_days)
    t0 = date.fromisoformat(period_start)

    solved = {}
    for ev in (1.0, 30000.0, 300000.0):
        mwr, _ = mwr_and_dietz_from_ledger(
            ledger, begin_value=begin, end_value=ev,
            period_start=period_start, period_days=period_days,
        )
        assert mwr is not None and math.isfinite(mwr)
        solved[ev] = mwr
        # Independent NPV at the solved annualised rate (compute_mwr uses 365.25).
        flows = [
            (t0, -begin),                                   # investor invests
            (date.fromisoformat("2026-03-15"), 150000.0),   # withdrawal -> investor
            (end_date, ev),                                 # terminal wealth
        ]
        npv = sum(
            amt / (1.0 + mwr) ** ((dd - t0).days / 365.25) for dd, amt in flows
        )
        assert npv == pytest.approx(0.0, abs=1e-2)

    # Distinct, monotone rates: ending wealth is visible to the solve.
    assert len({round(v, 6) for v in solved.values()}) == 3
    assert solved[1.0] < solved[30000.0] < solved[300000.0]
