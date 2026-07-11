"""Phase 79-01 Task 2 tests for services.native_nav — the per-currency classifier
+ the two refuse-error types (contract §3.1, §3.4, §5.3).

This wave ships ONLY the classifier, the dynamic-set disjointness validator, and
the two leak-safe refuse errors — NOT the core / NativeLedger / tolerances
(79-02 owns those; the module grows in place). These pins:

  * ``classify_currency`` returns exactly three branches with USD_FAMILY winning
    FIRST (mirrors "both converters check linear FIRST", deribit_txn.py:104-110);
    it uppercases its input, is pure, and NEVER raises (§3.1);
  * ``_assert_families_disjoint`` is the SEPARATE validator that raises on a
    USD_FAMILY ∩ indexable overlap, naming only currency CODES (G1, leak-safe);
  * ``UnmarkableCurrencyError`` / ``InceptionReconciliationError`` subclass
    ``NavReconstructionError`` and carry ONLY leak-safe attributes (no raw
    balances/quantities/USD — §3.4/§5.3, nav_twr.py:443-444 leak discipline).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from services.broker_dailies import gap_fill_daily_returns
from services.external_flows import USD_FAMILY, ExternalFlow
from services.nav_twr import NavReconstructionError, reconstruct_nav_and_twr
from services.native_nav import (
    INCEPTION_ABS_TOL_USD,
    INCEPTION_REL_TOL,
    InceptionReconciliationError,
    MarkBranch,
    NativeLedger,
    UnmarkableCurrencyError,
    _assert_families_disjoint,
    classify_currency,
    reconstruct_native_nav_and_twr,
)

_INDEXABLE = frozenset({"BTC", "ETH", "SOL"})


# ---------------------------------------------------------------------------
# classify_currency — three branches, USD_FAMILY-first, pure, never raises.
# ---------------------------------------------------------------------------


def test_three_branches() -> None:
    """USD-family → USD_FAMILY; indexable coin → INDEXED; unknown → UNMARKABLE;
    input is uppercased first."""
    assert classify_currency("USDC", indexable=_INDEXABLE) is MarkBranch.USD_FAMILY
    assert classify_currency("BTC", indexable=_INDEXABLE) is MarkBranch.INDEXED
    assert classify_currency("BUIDL", indexable=_INDEXABLE) is MarkBranch.UNMARKABLE
    # lowercase is uppercased before classification.
    assert classify_currency("btc", indexable=_INDEXABLE) is MarkBranch.INDEXED
    assert classify_currency("usdc", indexable=_INDEXABLE) is MarkBranch.USD_FAMILY


def test_usd_family_wins_first() -> None:
    """The §3.1 priority pin: with a deliberately OVERLAPPING indexable set,
    USD_FAMILY still wins (linear checked FIRST). Swapping branch order → INDEXED
    (mutation reddens this)."""
    overlapping = frozenset({"USDC"})
    assert (
        classify_currency("USDC", indexable=overlapping) is MarkBranch.USD_FAMILY
    )


def test_classify_never_raises() -> None:
    """Junk inputs classify (UNMARKABLE), never raise — pure per §3.1."""
    for junk in ("", "   ", "¥€", "123", "unknown-token"):
        assert classify_currency(junk, indexable=_INDEXABLE) is MarkBranch.UNMARKABLE


def test_markbranch_values_verbatim() -> None:
    """The enum values are the §3.1 verbatim strings (str-Enum)."""
    assert MarkBranch.USD_FAMILY.value == "usd_family"
    assert MarkBranch.INDEXED.value == "indexed"
    assert MarkBranch.UNMARKABLE.value == "unmarkable"


# ---------------------------------------------------------------------------
# _assert_families_disjoint — the SEPARATE dynamic-set validator (G1).
# ---------------------------------------------------------------------------


def test_disjointness_validator_raises_on_overlap() -> None:
    """Overlap raises NavReconstructionError naming the overlapping CODES only
    (leak-safe); classify_currency itself never performs this check."""
    with pytest.raises(NavReconstructionError) as exc:
        _assert_families_disjoint(USD_FAMILY, frozenset({"USDC", "SOL"}))
    assert "USDC" in str(exc.value)  # the overlapping code is named
    assert "SOL" not in str(exc.value)  # non-overlapping code is NOT named


def test_disjointness_validator_passes_on_disjoint() -> None:
    """Disjoint sets pass silently (returns None)."""
    assert _assert_families_disjoint(USD_FAMILY, _INDEXABLE) is None


# ---------------------------------------------------------------------------
# Refuse-error types — leak-safe attributes, NavReconstructionError subclasses.
# ---------------------------------------------------------------------------


def test_unmarkable_currency_error_shape_and_leak_safety() -> None:
    """Carries currency/venue/reason/missing_day_count ONLY; subclasses
    NavReconstructionError; NO raw balance/quantity/USD in the message or attrs."""
    err = UnmarkableCurrencyError(
        currency="BUIDL", venue="deribit",
        reason="missing_daily_marks", missing_day_count=3,
    )
    assert isinstance(err, NavReconstructionError)
    assert err.currency == "BUIDL"
    assert err.venue == "deribit"
    assert err.reason == "missing_daily_marks"
    assert err.missing_day_count == 3
    # Leak scan: a hypothetical raw balance must never appear in the message.
    planted_raw_balance = "987654.32"
    assert planted_raw_balance not in str(err)
    # Attribute surface is EXACTLY the leak-safe whitelist — adding a raw-value
    # attribute (e.g. `balance`) reddens this (mutation-honest leak pin).
    custom = set(vars(err)) - {"args"}
    assert custom == {"currency", "venue", "reason", "missing_day_count"}


def test_unmarkable_reason_domain() -> None:
    """All three §3.4 reason codes construct."""
    for reason in ("no_usd_index", "missing_daily_marks", "flow_quantity_missing"):
        err = UnmarkableCurrencyError(
            currency="X", venue="deribit", reason=reason, missing_day_count=0,
        )
        assert err.reason == reason


def test_inception_reconciliation_error_shape_and_leak_safety() -> None:
    """Carries currencies/venue/breach_ratio ONLY (RELATIVE ratio, never raw
    residual quantities/USD); subclasses NavReconstructionError."""
    err = InceptionReconciliationError(
        currencies=["BTC", "USDC"], venue="deribit", breach_ratio=2.5,
    )
    assert isinstance(err, NavReconstructionError)
    assert err.currencies == ["BTC", "USDC"]
    assert err.venue == "deribit"
    assert err.breach_ratio == pytest.approx(2.5)
    # Leak scan: a hypothetical raw residual USD must never appear.
    planted_raw_residual = "123456.78"
    assert planted_raw_residual not in str(err)
    custom = set(vars(err)) - {"args"}
    assert custom == {"currencies", "venue", "breach_ratio"}


# ===========================================================================
# 79-02 Task 2 — NativeLedger + reconstruct_native_nav_and_twr
# (steps 1, 2, 4, 5, 6). The inception gate (step 3) is Task 3. These fixtures
# use full_history=False so the gate SKIPS — the per-bucket roll / valuation /
# refusal mechanism is what these pin (contract §1.2/§1.3/§3, 79-CONTEXT G2-G4).
# ===========================================================================


def _s(day_value_pairs: list[tuple[str, float]]) -> pd.Series:
    """A native-pnl / mark Series on an ascending tz-naive midnight index."""
    pairs = sorted(day_value_pairs, key=lambda p: p[0])
    idx = pd.DatetimeIndex([pd.Timestamp(d) for d, _ in pairs])
    return pd.Series([float(v) for _, v in pairs], index=idx, name="native_pnl")


def _dense(values: list[float], start: str = "2026-01-01") -> pd.Series:
    idx = pd.DatetimeIndex(pd.date_range(start=start, periods=len(values), freq="D"))
    return pd.Series([float(v) for v in values], index=idx, name="native_pnl")


# ---------------------------------------------------------------------------
# usd_native_single_bucket — the §4 base case; native == legacy over summed floats.
# ---------------------------------------------------------------------------


def test_usd_native_single_bucket_matches_legacy() -> None:
    """An all-USDC/USDT ledger coalesces into ONE 'USD' bucket (mark ≡ 1.0,
    quantities summed per day in producer order) and returns a Series equal
    (check_exact) to the legacy reconstruct_nav_and_twr over the same summed
    floats — the §4.1 identity MECHANISM (the full dual-run matrix is 79-04)."""
    usdc = _dense([100.0, 50.0, -25.0])
    usdt = _dense([10.0, 0.0, 5.0])
    ledger = NativeLedger(
        native_pnl={"USDC": usdc, "USDT": usdt},
        terminal_native_equity={"USDC": 6000.0, "USDT": 4000.0},
        marks={},
        native_flows=[ExternalFlow("2026-01-02", 300.0, "USDC", 300.0)],
        terminal_upnl_native={},
        full_history=False,
    )
    native_ret, native_meta = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"})
    )
    # Legacy over the same summed USD floats: pnl [110, 50, -20], anchor 10000.
    legacy_ret, legacy_meta = reconstruct_nav_and_twr(
        _dense([110.0, 50.0, -20.0]),
        anchor_nav=10_000.0,
        external_flows=[("2026-01-02", 300.0)],
    )
    pd.testing.assert_series_equal(
        native_ret, legacy_ret, check_exact=True, check_freq=False
    )
    assert dict(native_meta) == dict(legacy_meta)


# ---------------------------------------------------------------------------
# mixed_account_composition (§8) — per-bucket roll + carry-forward + translation.
# ---------------------------------------------------------------------------


def test_mixed_account_composition_hand_computed() -> None:
    """Buckets {USDC→USD, BTC}: NAV(d) = B_USD(d)·1.0 + B_BTC(d)·P_BTC(d) over
    the UNION calendar. BTC index is {01-01, 01-03}; on 01-02 (inside BTC's span,
    absent from its index) the carried-forward BTC balance is valued (a mutation
    that drops carry-forward reddens this). A USDC deposit never touches the BTC
    roll (per-bucket F_t isolation)."""
    ledger = NativeLedger(
        native_pnl={"BTC": _s([("2026-01-01", 0.1), ("2026-01-03", 0.0)])},
        terminal_native_equity={"USDC": 5000.0, "BTC": 2.0},
        marks={"BTC": _s([("2026-01-01", 40000.0), ("2026-01-02", 41000.0),
                          ("2026-01-03", 42000.0)])},
        native_flows=[ExternalFlow("2026-01-02", 1000.0, "USDC", 1000.0)],
        terminal_upnl_native={},
        full_history=False,
    )
    returns, meta = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"})
    )
    # NAV = [80000, 87000, 89000]. F-2: prev0 includes ONLY buckets present on
    # day-0 (01-01). BTC IS present (pre-history 1.9 BTC × 40000 = 76000); the USDC
    # bucket starts 01-02 (its 4000-USD pre-history is EXCLUDED — that capital
    # enters via its 01-02 deposit, not the day-0 base). prev0 = 76000 ⇒ r_0 =
    # (80000-76000)/76000 = 4000/76000 (the real BTC +0.1 day-0 gain, no longer
    # masked to 0 by the phantom USDC capital). r_1/r_2 unchanged (their base is the
    # prior day's NAV, not prev0).
    assert list(returns.index) == list(
        pd.date_range("2026-01-01", periods=3, freq="D")
    )
    assert returns.iloc[0] == pytest.approx(4000.0 / 76000.0)
    assert returns.iloc[1] == pytest.approx(6000.0 / 80000.0)
    assert returns.iloc[2] == pytest.approx(2000.0 / 87000.0)
    assert meta["computation_status_hint"] == "complete"


def test_prev0_excludes_later_starting_bucket() -> None:
    """F-2 [MEDIUM]: the day-0 denominator ``prev0`` must include ONLY buckets
    present on ``union_index[0]``. A later-starting bucket (its first day >
    union_index[0]) must NOT fold its pre-history into the day-0 base — its capital
    enters on its OWN first day. USDC present day-0 (pre-history 900 USD); BTC
    starts day-1 (its 0.015-BTC pre-history × 50000 = 750 USD must be EXCLUDED).

    NAV = [10000, 20000]; prev0 = 9000 (USDC only) ⇒ r_0 = (10000-9000)/9000 =
    1000/9000. Neuter (fold BTC's day-1 pre-history 0.15 BTC × 50000 = 7500 into
    prev0) ⇒ prev0 = 9000 + 7500 = 16500 ⇒ r_0 = (10000-16500)/16500 = -6500/16500
    ≈ -0.394 — a phantom day-0 loss from capital not present on day 0. Magnitudes
    are above DUST_NAV_FLOOR ($1000); full_history=False skips the inception gate."""
    ledger = NativeLedger(
        native_pnl={
            "USDC": _s([("2026-01-01", 1000.0)]),   # present on day-0
            "BTC": _s([("2026-01-02", 0.05)]),       # starts day-1
        },
        terminal_native_equity={"USDC": 10000.0, "BTC": 0.2},
        marks={"BTC": _s([("2026-01-02", 50000.0)])},  # BTC needs a mark only on 01-02
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
    )
    returns, _ = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"})
    )
    assert list(returns.index) == list(
        pd.date_range("2026-01-01", periods=2, freq="D")
    )
    assert returns.iloc[0] == pytest.approx(1000.0 / 9000.0)   # NOT -6500/16500
    assert returns.iloc[1] == pytest.approx(1.0)


def test_translation_term_carried() -> None:
    """§0 raison d'être: a BTC-only fixture with ZERO pnl and ZERO flows but a
    MOVING mark produces day returns equal to B·ΔP / prior-NAV ≠ 0 — the USD-space
    legacy core produces 0 here. Asserts the native return equals the
    hand-computed translation term."""
    ledger = NativeLedger(
        native_pnl={"BTC": _dense([0.0, 0.0, 0.0])},
        terminal_native_equity={"BTC": 2.0},
        marks={"BTC": _s([("2026-01-01", 40000.0), ("2026-01-02", 41000.0),
                          ("2026-01-03", 42000.0)])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
    )
    returns, _ = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"})
    )
    # NAV = 2.0*[40000,41000,42000] = [80000,82000,84000]; prev0 = 2.0*40000.
    assert returns.iloc[0] == pytest.approx(0.0)
    # r_1 = B·ΔP/prior-NAV = 2.0*(41000-40000)/(2.0*40000) = 1000/40000 = 0.025.
    assert returns.iloc[1] == pytest.approx(1000.0 / 40000.0)
    assert returns.iloc[1] != 0.0  # the legacy USD-space core would be 0 here
    assert returns.iloc[2] == pytest.approx(2000.0 / 82000.0)


# ---------------------------------------------------------------------------
# outside_span (G3) — before-first contributes 0 (no mark needed); after-last
# carries the terminal balance forward (mark REQUIRED there → missing refuses).
# ---------------------------------------------------------------------------


def _outside_span_ledger(btc_marks: list[tuple[str, float]]) -> NativeLedger:
    # BTC span {01-02, 01-03}; USD events on 01-01 and 01-04 bracket it so the
    # union is {01-01..01-04}: 01-01 is BEFORE BTC's first day, 01-04 is AFTER
    # its last (carried-forward balance).
    return NativeLedger(
        native_pnl={"BTC": _s([("2026-01-02", 0.0), ("2026-01-03", 0.0)])},
        terminal_native_equity={"USDC": 5000.0, "BTC": 1.0},
        marks={"BTC": _s(btc_marks)},
        native_flows=[
            ExternalFlow("2026-01-01", 1000.0, "USDC", 1000.0),
            ExternalFlow("2026-01-04", 1000.0, "USDC", 1000.0),
        ],
        terminal_upnl_native={},
        full_history=False,
    )


def test_outside_span_before_first_needs_no_mark() -> None:
    """01-01 is before BTC's first index day → BTC contributes 0.0 there → NO
    mark is required on 01-01 (G3). Marks provided only on BTC's required days
    {01-02, 01-03, 01-04}; the ledger reconstructs WITHOUT refusing."""
    ledger = _outside_span_ledger(
        [("2026-01-02", 50000.0), ("2026-01-03", 51000.0), ("2026-01-04", 52000.0)]
    )
    returns, meta = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"})
    )
    assert returns.name == "returns"
    assert list(returns.index) == list(
        pd.date_range("2026-01-01", periods=4, freq="D")
    )


def test_outside_span_after_last_missing_mark_refuses() -> None:
    """After BTC's last index day (01-03) its terminal balance (1.0) carries
    forward to 01-04 → a mark is REQUIRED there (nonzero balance ⇒ density). A
    missing 01-04 mark refuses with reason='missing_daily_marks' count=1 —
    NEVER forward-filled from 01-03."""
    ledger = _outside_span_ledger(
        [("2026-01-02", 50000.0), ("2026-01-03", 51000.0)]  # 01-04 omitted
    )
    with pytest.raises(UnmarkableCurrencyError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
        )
    assert exc.value.reason == "missing_daily_marks"
    assert exc.value.currency == "BTC"
    assert exc.value.venue == "deribit"
    assert exc.value.missing_day_count == 1


# ---------------------------------------------------------------------------
# Refusal matrix (§3.3 / §3.4 + G4).
# ---------------------------------------------------------------------------


def test_refusal_nonzero_unmarkable_no_usd_index() -> None:
    """(a) A currency with no resolvable index (BUIDL ∉ USD_FAMILY ∪ indexable)
    carrying nonzero value refuses reason='no_usd_index'."""
    ledger = NativeLedger(
        native_pnl={},
        terminal_native_equity={"BUIDL": 100.0},
        marks={},
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
    )
    with pytest.raises(UnmarkableCurrencyError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
        )
    assert exc.value.reason == "no_usd_index"
    assert exc.value.currency == "BUIDL"


def test_refusal_zero_everywhere_unmarkable_skipped() -> None:
    """(b) A zero-everywhere UNMARKABLE currency (0 pnl/equity/flows) is SKIPPED
    SILENTLY — identical output to the ledger without it (the
    deribit_txn.py:282-283 `if equity == 0.0: continue` precedent)."""
    base = NativeLedger(
        native_pnl={"BTC": _dense([0.0, 0.0, 0.0])},
        terminal_native_equity={"BTC": 2.0},
        marks={"BTC": _s([("2026-01-01", 40000.0), ("2026-01-02", 41000.0),
                          ("2026-01-03", 42000.0)])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
    )
    with_buidl = NativeLedger(
        native_pnl={"BTC": base.native_pnl["BTC"]},
        terminal_native_equity={"BTC": 2.0, "BUIDL": 0.0},
        marks=base.marks,
        native_flows=[ExternalFlow("2026-01-02", 0.0, "BUIDL", 0.0)],
        terminal_upnl_native={"BUIDL": 0.0},
        full_history=False,
    )
    r_base, m_base = reconstruct_native_nav_and_twr(
        base, indexable_currencies=frozenset({"BTC"})
    )
    r_buidl, m_buidl = reconstruct_native_nav_and_twr(
        with_buidl, indexable_currencies=frozenset({"BTC"})
    )
    pd.testing.assert_series_equal(r_base, r_buidl, check_exact=True)
    assert dict(m_base) == dict(m_buidl)


def test_refusal_indexed_missing_mark_counts_days() -> None:
    """(c) An INDEXED currency missing a mark on a day with B_c ≠ 0 refuses
    reason='missing_daily_marks' with the COUNT of missing days — never filled."""
    ledger = NativeLedger(
        native_pnl={"BTC": _dense([0.0, 0.0, 0.0])},
        terminal_native_equity={"BTC": 2.0},
        marks={"BTC": _s([("2026-01-01", 40000.0)])},  # 01-02, 01-03 missing
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
    )
    with pytest.raises(UnmarkableCurrencyError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
        )
    assert exc.value.reason == "missing_daily_marks"
    assert exc.value.missing_day_count == 2


def test_indexed_absent_mark_series_refuses_not_valued_at_one() -> None:
    """F-1 [HIGH]: an INDEXED currency carrying value with NO entry in
    ``ledger.marks`` (the whole mark Series absent, not a per-day gap) must REFUSE
    with reason='missing_daily_marks' at build time — it must NOT be silently
    valued at the literal 1.0/unit. Regression for the ``bucket.mark is None``
    overload (None meant BOTH 'USD-family literal 1.0' AND 'INDEXED but marks.get
    returned None'). Neuter (route a mark=None INDEXED bucket back through the
    ``mark is None`` USD branch in _value_over_calendar) → SOL valued at $1/unit,
    no refusal → red."""
    ledger = NativeLedger(
        native_pnl={"SOL": _dense([1.0, 2.0, 0.0])},
        terminal_native_equity={"SOL": 50.0},
        marks={},  # NO SOL mark series at all (the absent-series case)
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
    )
    with pytest.raises(UnmarkableCurrencyError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC", "SOL"}), venue="deribit"
        )
    assert exc.value.reason == "missing_daily_marks"
    assert exc.value.currency == "SOL"
    assert exc.value.venue == "deribit"


def test_indexed_zero_value_absent_mark_series_skipped() -> None:
    """F-1 corollary: a ZERO-value INDEXED currency with no mark Series stays
    value-gated (skipped, never valued) — the absent-mark refusal fires ONLY when
    the coin actually carries value (§3.1 value-gate). Output is byte-identical to
    the ledger without the zero SOL."""
    base = NativeLedger(
        native_pnl={"BTC": _dense([0.0, 0.0, 0.0])},
        terminal_native_equity={"BTC": 2.0},
        marks={"BTC": _s([("2026-01-01", 40000.0), ("2026-01-02", 41000.0),
                          ("2026-01-03", 42000.0)])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
    )
    with_zero_sol = NativeLedger(
        native_pnl={"BTC": base.native_pnl["BTC"], "SOL": _dense([0.0, 0.0, 0.0])},
        terminal_native_equity={"BTC": 2.0, "SOL": 0.0},
        marks=base.marks,  # SOL absent from marks
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
    )
    r_base, _ = reconstruct_native_nav_and_twr(
        base, indexable_currencies=frozenset({"BTC", "SOL"})
    )
    r_sol, _ = reconstruct_native_nav_and_twr(
        with_zero_sol, indexable_currencies=frozenset({"BTC", "SOL"})
    )
    pd.testing.assert_series_equal(r_base, r_sol, check_exact=True)


def test_refusal_branch2_flow_quantity_missing() -> None:
    """(d) A branch-2 (INDEXED) flow with quantity=None refuses
    reason='flow_quantity_missing' — never back-solved from usd_signed."""
    ledger = NativeLedger(
        native_pnl={"BTC": _dense([0.0, 0.0, 0.0])},
        terminal_native_equity={"BTC": 2.0},
        marks={"BTC": _s([("2026-01-01", 40000.0), ("2026-01-02", 41000.0),
                          ("2026-01-03", 42000.0)])},
        native_flows=[ExternalFlow("2026-01-02", 40000.0, "BTC", None)],
        terminal_upnl_native={},
        full_history=False,
    )
    with pytest.raises(UnmarkableCurrencyError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
        )
    assert exc.value.reason == "flow_quantity_missing"
    assert exc.value.currency == "BTC"


def test_branch1_flow_quantity_none_uses_usd_signed() -> None:
    """(d) A branch-1 (USD-family) flow with quantity=None uses usd_signed
    verbatim as the native quantity (G4 identity, mark ≡ 1.0) — does NOT refuse.
    Byte-identical to the same flow with quantity=usd_signed set explicitly."""
    def _mk(qty: float | None) -> NativeLedger:
        return NativeLedger(
            native_pnl={"USDC": _dense([100.0, 50.0, -25.0])},
            terminal_native_equity={"USDC": 10_000.0},
            marks={},
            native_flows=[ExternalFlow("2026-01-02", 300.0, "USDC", qty)],
            terminal_upnl_native={},
            full_history=False,
        )
    r_none, _ = reconstruct_native_nav_and_twr(
        _mk(None), indexable_currencies=frozenset({"BTC"})
    )
    r_set, _ = reconstruct_native_nav_and_twr(
        _mk(300.0), indexable_currencies=frozenset({"BTC"})
    )
    pd.testing.assert_series_equal(r_none, r_set, check_exact=True)


def test_refusal_nonpositive_mark() -> None:
    """(e) A non-finite or ≤ 0 mark on a needed day refuses (the
    txn_change_to_usd price<=0 rule) — surfaced as missing_daily_marks."""
    for bad in (0.0, -1.0, float("nan")):
        ledger = NativeLedger(
            native_pnl={"BTC": _dense([0.0, 0.0, 0.0])},
            terminal_native_equity={"BTC": 2.0},
            marks={"BTC": _s([("2026-01-01", 40000.0), ("2026-01-02", bad),
                              ("2026-01-03", 42000.0)])},
            native_flows=[],
            terminal_upnl_native={},
            full_history=False,
        )
        with pytest.raises(UnmarkableCurrencyError) as exc:
            reconstruct_native_nav_and_twr(
                ledger, indexable_currencies=frozenset({"BTC"})
            )
        assert exc.value.reason == "missing_daily_marks"


def test_refusal_family_overlap() -> None:
    """(f) A USD_FAMILY ∩ indexable overlap raises via _assert_families_disjoint
    at the top of the core (G1) — before any valuation."""
    ledger = NativeLedger(
        native_pnl={"USDC": _dense([1.0])},
        terminal_native_equity={"USDC": 100.0},
        marks={},
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
    )
    with pytest.raises(NavReconstructionError):
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"USDC"})
        )


# ---------------------------------------------------------------------------
# shape_contract / chain_break_key / leak_scan.
# ---------------------------------------------------------------------------


def test_shape_contract_round_trips_gap_fill() -> None:
    """The returned (returns, meta) is the legacy shape: a 'returns'-named float
    Series on an ascending tz-naive midnight DatetimeIndex + NavTWRMeta, and it
    round-trips through gap_fill_daily_returns (broker_dailies.py:118) unchanged
    in type/name."""
    ledger = NativeLedger(
        native_pnl={"BTC": _dense([0.0, 0.0, 0.0])},
        terminal_native_equity={"BTC": 2.0},
        marks={"BTC": _s([("2026-01-01", 40000.0), ("2026-01-02", 41000.0),
                          ("2026-01-03", 42000.0)])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
    )
    returns, meta = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"})
    )
    assert returns.name == "returns"
    assert returns.dtype == np.float64
    assert isinstance(returns.index, pd.DatetimeIndex)
    assert returns.index.tz is None
    assert returns.index.is_monotonic_increasing
    assert "computation_status_hint" in meta
    filled = gap_fill_daily_returns(returns)
    assert filled.name == "returns"
    assert isinstance(filled.index, pd.DatetimeIndex)


def test_chain_break_key_on_interior_negative_nav() -> None:
    """§1.3 step 6: an interior negative bucket NAV (a negative_nav_guard flanked
    by valid returns) carries twr_chain_broken in meta (via the 79-03 merge) with
    complete_with_warnings — same semantics as the legacy core."""
    # USD-only ledger whose reconstructed NAV = [5000, -100, 6000, 7000]:
    # pnl[t] = nav[t] - nav[t-1] (no flows); pnl[0] arbitrary (0.0).
    ledger = NativeLedger(
        native_pnl={"USDC": _dense([0.0, -5100.0, 6100.0, 1000.0])},
        terminal_native_equity={"USDC": 7000.0},
        marks={},
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
    )
    returns, meta = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"})
    )
    assert bool(np.isnan(returns.iloc[2]))       # interior break (prev NAV = -100)
    assert not bool(np.isnan(returns.iloc[3]))   # valid AFTER the break
    assert meta.get("negative_nav_guard") is True
    assert meta.get("twr_chain_broken") is True
    assert meta["computation_status_hint"] == "complete_with_warnings"


def test_leak_scan_no_raw_values_in_refusal_or_source() -> None:
    """The core emits NO raw balance/quantity/flow/NAV float in a refusal message
    or via logging (§1.1, nav_twr.py:443-444 discipline)."""
    planted = 987654.321  # a distinctive raw BTC-balance-scale value
    ledger = NativeLedger(
        native_pnl={"BTC": _dense([0.0, 0.0])},
        terminal_native_equity={"BTC": planted},
        marks={"BTC": _s([("2026-01-01", 40000.0)])},  # 01-02 missing → refuse
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
    )
    with pytest.raises(UnmarkableCurrencyError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC"})
        )
    assert str(planted) not in str(exc.value)
    assert "987654" not in str(exc.value)
    # Source scan: the module never logs / prints (raw-value leak vector).
    import services.native_nav as native_nav_mod

    src = Path(native_nav_mod.__file__).read_text()
    assert "print(" not in src
    assert "import logging" not in src
    assert "getLogger" not in src
    assert "logger." not in src


# ===========================================================================
# 79-02 Task 3 — §5 inception-reconciliation refuse gate (step 3, before valuation)
# ===========================================================================


def _btc_zero_pnl_ledger(
    *,
    terminal_btc: float,
    mark_first: float,
    mark_last: float,
    full_history: bool,
) -> NativeLedger:
    """A 2-day BTC-only full/partial-history ledger with ZERO pnl/flows, so the
    rolled pre-history residual equals ``terminal_btc`` exactly (nav = [T, T];
    resid = T − 0 − 0). Marks diverge first→last so a gate that values the
    residual at the WRONG (anchor) mark is caught."""
    return NativeLedger(
        native_pnl={"BTC": _dense([0.0, 0.0])},
        terminal_native_equity={"BTC": terminal_btc},
        marks={"BTC": _s([("2026-01-01", mark_first), ("2026-01-02", mark_last)])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=full_history,
    )


def test_inception_constants_verbatim() -> None:
    """The two §5.2 constants exist module-level with the locked values."""
    assert INCEPTION_ABS_TOL_USD == 1.00
    assert INCEPTION_REL_TOL == 1e-4


def test_inception_clean_reconciliation_passes() -> None:
    """A full_history=True mixed ledger whose per-currency rolled pre-history
    residual is ~0 (BTC exact; a sub-$1 USD dust) passes the gate and valuation
    proceeds — anchor NAV ~2010 ⇒ tol = max($1, 1e-4·2010) = $1, resid 0.5 ≤ $1."""
    ledger = NativeLedger(
        native_pnl={
            "BTC": _dense([0.1, -0.05, 0.0]),      # Σ = 0.05 = terminal ⇒ resid 0
            "USDC": _s([("2026-01-01", 10.0)]),    # terminal 10.5 ⇒ resid 0.5 dust
        },
        terminal_native_equity={"BTC": 0.05, "USDC": 10.5},
        marks={"BTC": _dense([40000.0, 40000.0, 40000.0])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )
    returns, meta = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"})
    )
    assert returns.name == "returns"
    assert "computation_status_hint" in meta


def test_inception_breach_refuses_before_valuation_leak_safe() -> None:
    """A full_history=True ledger whose venue-reported equity disagrees with the
    summed ledger (terminal 5.0 BTC vs Σpnl 0.05) refuses via
    InceptionReconciliationError carrying currencies/venue/breach_ratio ONLY — no
    raw residual quantity/USD in the message (nav_twr.py:443-444 discipline)."""
    ledger = NativeLedger(
        native_pnl={"BTC": _dense([0.1, -0.05, 0.0])},  # Σ = 0.05
        terminal_native_equity={"BTC": 5.0},            # resid ≈ 4.95 BTC
        marks={"BTC": _dense([40000.0, 40000.0, 40000.0])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )
    with pytest.raises(InceptionReconciliationError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
        )
    assert exc.value.currencies == ["BTC"]
    assert exc.value.venue == "deribit"
    assert exc.value.breach_ratio > 1.0
    # Leak scan: the raw residual (≈4.95 BTC / ≈198000 USD) never surfaces.
    msg = str(exc.value)
    assert "4.95" not in msg
    assert "198000" not in msg
    assert "198" not in msg or "breach_ratio" in msg  # ratio may contain digits


def test_inception_nonfinite_residual_refuses_not_silent_pass() -> None:
    """F-3 [LOW]: the inception gate must REFUSE on a non-finite residual/anchor,
    never silently pass. A NaN inception-day mark makes ``resid_usd_total`` NaN, and
    ``NaN > tol`` evaluates False — the gate would silently pass. Construct a
    full_history=True BTC bucket whose day-0 balance rolls to EXACTLY 0 (so the NaN
    day-0 mark is NOT required in valuation and cannot be caught downstream there),
    with real day-0 pnl (resid = -2 BTC) and a NaN mark on that inception day:
    pnl [2.0, 3.0], terminal 3.0 ⇒ B[01-01]=0, B[01-02]=3.0. Without the isfinite
    guard the gate passes (NaN > tol is False); with it, refuses."""
    ledger = NativeLedger(
        native_pnl={"BTC": _dense([2.0, 3.0])},  # 01-01, 01-02
        terminal_native_equity={"BTC": 3.0},      # B[01-01] rolls to exactly 0.0
        marks={"BTC": _s([("2026-01-01", float("nan")), ("2026-01-02", 40000.0)])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )
    with pytest.raises(InceptionReconciliationError):
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
        )


def test_inception_tolerance_abs_arm_boundary() -> None:
    """ABS arm: a small account (1e-4·anchor < $1 ⇒ tol = $1). resid valued at the
    INCEPTION-day mark (2.0), NOT the anchor mark (1.0). T=0.49 ⇒ resid_usd 0.98
    ≤ $1 passes; T=0.51 ⇒ 1.02 > $1 breaches. Valuing at the anchor mark (1.0)
    would keep 0.51 < $1 and NOT breach — so this pins the inception-mark rule."""
    ok = _btc_zero_pnl_ledger(
        terminal_btc=0.49, mark_first=2.0, mark_last=1.0, full_history=True
    )
    reconstruct_native_nav_and_twr(ok, indexable_currencies=frozenset({"BTC"}))
    breach = _btc_zero_pnl_ledger(
        terminal_btc=0.51, mark_first=2.0, mark_last=1.0, full_history=True
    )
    with pytest.raises(InceptionReconciliationError):
        reconstruct_native_nav_and_twr(
            breach, indexable_currencies=frozenset({"BTC"})
        )


def test_inception_tolerance_rel_arm_boundary() -> None:
    """REL arm: a large anchor (1e-4·anchor > $1 ⇒ tol = 1e-4·anchor = 2.0 when
    anchor mark = 20000). resid_usd = T·mark_first (T=1.0). mark_first 1.9 ⇒ 1.9
    ≤ 2.0 passes (and 1.9 > $1 proves the ABS floor is NOT what decided); 2.1 >
    2.0 breaches."""
    ok = _btc_zero_pnl_ledger(
        terminal_btc=1.0, mark_first=1.9, mark_last=20000.0, full_history=True
    )
    reconstruct_native_nav_and_twr(ok, indexable_currencies=frozenset({"BTC"}))
    breach = _btc_zero_pnl_ledger(
        terminal_btc=1.0, mark_first=2.1, mark_last=20000.0, full_history=True
    )
    with pytest.raises(InceptionReconciliationError):
        reconstruct_native_nav_and_twr(
            breach, indexable_currencies=frozenset({"BTC"})
        )


def test_inception_multi_currency_sum_hides_nothing() -> None:
    """§8 step 5: a clean USDC book (resid exactly 0) cannot hide a broken BTC
    book — residuals are summed in USD and a breach in ONE bucket refuses, naming
    only the offending currency."""
    ledger = NativeLedger(
        native_pnl={
            "USDC": _s([("2026-01-01", 10.0)]),           # terminal 10 ⇒ resid 0
            "BTC": _dense([0.0, 0.0]),                    # terminal 5 ⇒ resid 5
        },
        terminal_native_equity={"USDC": 10.0, "BTC": 5.0},
        marks={"BTC": _dense([40000.0, 40000.0])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )
    with pytest.raises(InceptionReconciliationError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
        )
    assert exc.value.currencies == ["BTC"]


def test_inception_dust_relative_to_throughput_passes() -> None:
    """80-04 INCEPT-01 (RED without the native-dust floor): the real Deribit
    production shape — BTC rolled 6.48 in and out (≈$570k throughput) landing at a
    0.000012 BTC residual (accumulated float rounding). At ~$88k/coin that residual
    is ~$1.03 USD, which trips the $1 absolute floor and refuses. A residual
    negligible vs the currency's OWN native throughput is rounding, not a missing
    row, so the gate must PASS.

    NEUTER: dropping the INCEPTION_NATIVE_DUST_REL dust exemption makes resid_usd
    ≈ $1.03 > $1 tol → InceptionReconciliationError → this call RAISES (RED)."""
    ledger = NativeLedger(
        native_pnl={"BTC": _dense([3.0, 3.479214])},  # Σpnl 6.479214
        terminal_native_equity={"BTC": 0.000024},     # resid 0.000012 BTC (dust)
        marks={"BTC": _dense([88000.0, 88000.0])},
        native_flows=[ExternalFlow("2026-01-02", -570000.0, "BTC", -6.479202)],
        terminal_upnl_native={},
        full_history=True,
    )
    # Passes (no InceptionReconciliationError): dust vs 12.96 BTC throughput.
    returns, _ = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
    )
    assert returns.name == "returns"


def test_inception_material_residual_above_dust_still_breaches() -> None:
    """The dust floor does NOT blanket-excuse a high-throughput bucket: the SAME
    6.48-BTC-throughput shape with a MATERIAL 0.5 BTC residual (far above the
    1e-4·throughput ≈ 0.0013 BTC dust allowance) still refuses. Pins that the
    exemption is dust-only, never a hole big enough to hide a missing row."""
    ledger = NativeLedger(
        native_pnl={"BTC": _dense([3.0, 3.479214])},  # Σpnl 6.479214
        terminal_native_equity={"BTC": 0.5},          # resid ≈ 0.5 BTC (material)
        marks={"BTC": _dense([88000.0, 88000.0])},
        native_flows=[ExternalFlow("2026-01-02", -570000.0, "BTC", -6.479202)],
        terminal_upnl_native={},
        full_history=True,
    )
    with pytest.raises(InceptionReconciliationError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
        )
    assert exc.value.currencies == ["BTC"]


def test_inception_dust_floor_zero_throughput_orphan_still_breaches() -> None:
    """A zero-throughput bucket (no pnl, no flow) gets NO dust allowance
    (1e-4 × 0 = 0), so a nonzero residual still fails loud — the dust exemption can
    never silence an event-less held balance the ledger cannot explain."""
    breach = _btc_zero_pnl_ledger(
        terminal_btc=0.51, mark_first=2.0, mark_last=1.0, full_history=True
    )
    with pytest.raises(InceptionReconciliationError):
        reconstruct_native_nav_and_twr(
            breach, indexable_currencies=frozenset({"BTC"})
        )


def test_inception_full_history_false_skips_gate() -> None:
    """§5.3: the SAME breaching ledger with full_history=False does NOT raise — a
    truncated (retention-capped) ledger can never reconcile to zero and must not
    be punished; it stays on the existing DQ-02 terminus."""
    breach = _btc_zero_pnl_ledger(
        terminal_btc=5.0, mark_first=40000.0, mark_last=40000.0, full_history=False
    )
    returns, _ = reconstruct_native_nav_and_twr(
        breach, indexable_currencies=frozenset({"BTC"})
    )
    assert returns.name == "returns"  # valuation proceeded, no gate refusal


def test_value_carrying_unrolled_bucket_refuses_not_silent() -> None:
    """HIGH-3: a bucket with nonzero terminal equity (or a terminal-uPnL wedge) but
    ZERO ledger events (no pnl days, no flow days) does NOT roll — it is dropped
    from ``rolled`` and is therefore invisible to the inception gate. For a
    ``full_history=True`` ledger that is an inception failure (a held balance with
    no explaining ledger), and the pre-fix code silently understates NAV by omitting
    it (or, when it is the only bucket, returns an EMPTY Series) with no refusal.
    It must fail loud, mirroring the F-1 build-time refuse.

    Neuter: reverting the un-rolled-value refuse makes ``reconstruct`` return an
    empty Series (BTC alone) instead of raising → this ``pytest.raises`` reddens."""
    # BTC holds 5.0 of real terminal equity, has a mark (so the F-1 build-time
    # missing_daily_marks refuse does NOT pre-empt), but NO pnl/flow days at all.
    ledger = NativeLedger(
        native_pnl={},  # no BTC pnl days
        terminal_native_equity={"BTC": 5.0},
        marks={"BTC": _s([("2026-01-01", 40000.0)])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )
    with pytest.raises(InceptionReconciliationError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
        )
    assert exc.value.currencies == ["BTC"]
    assert exc.value.venue == "deribit"


def test_value_carrying_unrolled_wedge_bucket_refuses() -> None:
    """HIGH-3 (wedge arm): the same refusal fires on a nonzero terminal-uPnL wedge
    with no ledger events (zero terminal equity, all value in the open wedge). The
    held wedge has no explaining ledger for a full_history account → refuse."""
    ledger = NativeLedger(
        native_pnl={},
        terminal_native_equity={},
        marks={"BTC": _s([("2026-01-01", 40000.0)])},
        native_flows=[],
        terminal_upnl_native={"BTC": 2.0},
        full_history=True,
    )
    with pytest.raises(InceptionReconciliationError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
        )
    assert exc.value.currencies == ["BTC"]


def test_value_carrying_unrolled_bucket_omitted_from_nav_refuses() -> None:
    """HIGH-3 (mixed): an event-less value-carrying bucket alongside a healthy
    rolled bucket is silently OMITTED from NAV pre-fix (a real understatement, not
    an empty Series). The refuse must fire even when other buckets roll — a clean
    USDC book cannot mask BTC's unexplained held balance."""
    ledger = NativeLedger(
        native_pnl={"USDC": _s([("2026-01-01", 10.0)])},  # rolls; resid 0
        terminal_native_equity={"USDC": 10.0, "BTC": 5.0},  # BTC has NO pnl/flow
        marks={"BTC": _s([("2026-01-01", 40000.0)])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )
    with pytest.raises(InceptionReconciliationError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
        )
    assert exc.value.currencies == ["BTC"]


def test_value_carrying_unrolled_bucket_full_history_false_skips() -> None:
    """HIGH-3 gating (§5.3): the SAME event-less value-carrying bucket with
    full_history=False does NOT raise — a truncated ledger legitimately holds
    pre-window balances it cannot explain, mirroring the inception gate's own
    full_history skip. Neuter (un-gating the refuse) would redden this."""
    ledger = NativeLedger(
        native_pnl={},
        terminal_native_equity={"BTC": 5.0},
        marks={"BTC": _s([("2026-01-01", 40000.0)])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
    )
    returns, _ = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
    )
    assert returns.name == "returns"  # no refusal for a truncated ledger


def test_genuinely_zero_unrolled_bucket_stays_skipped() -> None:
    """HIGH-3 value-gate: a genuinely ZERO event-less bucket (no equity, no wedge,
    no pnl/flow) stays silently skipped — the refuse is value-gated, never fires on
    a dust-free zero holding. A lone zero BTC bucket yields an empty Series, exactly
    as before the fix."""
    ledger = NativeLedger(
        native_pnl={},
        terminal_native_equity={"BTC": 0.0},
        marks={},
        native_flows=[],
        terminal_upnl_native={"BTC": 0.0},
        full_history=True,
    )
    returns, _ = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
    )
    assert returns.empty  # zero-everywhere bucket adds nothing, no refusal


def test_dust_value_orphan_folded_into_inception_tolerance_passes() -> None:
    """HIGH-3 (refined, LOW): an event-less value-carrying orphan is FOLDED into the
    §5 inception residual sum (judged under the SAME max($1, 1e-4·NAV) tolerance as a
    rolled dust residual), NOT hard-refused on exact ``!= 0``. A SUB-TOLERANCE dust
    orphan therefore PASSES like rolled dust rather than permanently refusing.

    A healthy USDC book rolls (resid ~0, anchor NAV 150); alongside it a BTC orphan
    holds 0.00002 BTC @ 40000 = $0.80 of terminal equity with NO pnl/flow days. Its
    residual folds to $0.80 ≤ tol $1 → the reconstruction PASSES and returns the
    USDC-driven series (the dust value is omitted from NAV exactly like a rolled dust
    residual).

    Neuter: revert to the unconditional exact ``!= 0`` hard-refuse → the $0.80 dust
    orphan raises InceptionReconciliationError → this reddens."""
    ledger = NativeLedger(
        native_pnl={"USDC": _dense([100.0, 50.0])},  # rolls: B=[100,150], resid 0
        terminal_native_equity={"USDC": 150.0, "BTC": 0.00002},  # BTC: dust, no events
        marks={"BTC": _s([("2026-01-01", 40000.0)])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )
    returns, meta = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
    )
    # No refusal — the dust orphan passed under the inception tolerance.
    assert returns.name == "returns"
    assert not returns.empty  # the rolled USDC book drives a real series
    assert "computation_status_hint" in meta


def test_material_value_orphan_still_refuses_after_fold() -> None:
    """HIGH-3 (refined) material arm: the fold PRESERVES the material-orphan
    protection. A BTC orphan holding 5.0 BTC @ 40000 = $200k of unexplained terminal
    equity (no pnl/flow days) alongside a clean rolled USDC book folds to a residual
    that BREACHES the §5.2 tolerance → still refuses LOUD, naming BTC only.

    Neuter: fold the orphan but DROP it from the residual sum (judge only rolled
    residuals) → the $200k held balance sails past → this ``pytest.raises`` reddens."""
    ledger = NativeLedger(
        native_pnl={"USDC": _dense([100.0, 50.0])},  # rolls clean, resid 0
        terminal_native_equity={"USDC": 150.0, "BTC": 5.0},  # BTC: material orphan
        marks={"BTC": _s([("2026-01-01", 40000.0)])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )
    with pytest.raises(InceptionReconciliationError) as exc:
        reconstruct_native_nav_and_twr(
            ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
        )
    assert exc.value.currencies == ["BTC"]
    assert exc.value.venue == "deribit"


# ---------------------------------------------------------------------------
# Phase 92 HARD-01 — inverse-perpetual P&L-dominated near-zero-equity blow-up.
#
# A pure, offline repro on the REAL reconstruct_native_nav_and_twr (research §a
# root cause, §f fixture design). A single INDEXED "BTC" bucket over 7 UTC days
# whose day-3 native P&L (0.52 BTC ≈ $45,760) dwarfs a small-but-ABOVE-dust prev
# NAV (0.030 BTC × $88,000 ≈ $2,640) → an un-guarded per-day return r ≈ 17.3/day
# (the ~1,700%/day live blow-up class). None of the three existing denominator
# guards (negative / dust<$1000 / flow-dominated) fires (research §a A3), because
# there is NO P&L-magnitude guard — the defect under test. Plan 92-02 adds the
# guard and flips the strict-xfail below to enforced.
#
# All quantities are SYNTHETIC (0.025 BTC deposit / $88k mark) — never a real
# account balance (T-92-01). No network / no shared Supabase test DB (Pitfall 6).
# ---------------------------------------------------------------------------

_BLOWUP_MARK = 88000.0  # constant USD mark for BTC across all 7 days
_BLOWUP_DEPOSIT_BTC = 0.025  # inception deposit on day 1 (seeds pre-history ≈ 0)
# Per-day native BTC P&L. Day 3 is the P&L-DOMINATED day (0.52 BTC on a ~0.030
# BTC book). Days 4–7 are small POSITIVE gains so the post-fix retained suffix
# (after the guarded d3 break) is a rising ≥4-day window (Plan 92-02 asserts
# CAGR > 0 on it while the curve rises).
_BLOWUP_PNL_BTC = [0.002, 0.003, 0.52, 0.005, 0.004, 0.006, 0.002]


def _pnl_dominated_blowup_ledger() -> NativeLedger:
    """A full_history=True single-BTC ledger reproducing the HARD-01 blow-up.

    Backward roll (B(d-1) = B(d) − pnl(d) − flow(d)), terminal = deposit + Σpnl:

        Σpnl        = 0.002+0.003+0.52+0.005+0.004+0.006+0.002 = 0.542 BTC
        terminal    = 0.025 (deposit) + 0.542                  = 0.567 BTC
        B(d7)=0.567 B(d6)=0.565 B(d5)=0.559 B(d4)=0.555
        B(d3)=0.550 B(d2)=0.030 B(d1)=0.027 B(pre)=0.000  ✓ inception ≈ 0

    Pre-history balance rolls to EXACTLY 0 (0.027 − pnl_d1 0.002 − deposit 0.025),
    so the §5 inception gate reconciles under full_history=True and valuation
    proceeds to the divide. prev0 = 0 ⇒ day 1 is guarded NaN (negative_nav_guard,
    a leading terminus — NOT the bug). The blow-up is day 3:

        prev(d3) = B(d2)×mark = 0.030 × 88000 = $2,640  (> DUST_NAV_FLOOR $1000)
        cur(d3)  = B(d3)×mark = 0.550 × 88000 = $48,400
        r(d3)    = (48400 − 2640 − 0) / 2640  = 45760/2640 ≈ 17.33   (UN-GUARDED)
    """
    days = pd.date_range(start="2024-01-01", periods=7, freq="D")
    pnl = pd.Series([float(v) for v in _BLOWUP_PNL_BTC], index=days, name="native_pnl")
    marks = pd.Series([_BLOWUP_MARK] * 7, index=days, name="native_pnl")
    terminal = _BLOWUP_DEPOSIT_BTC + sum(_BLOWUP_PNL_BTC)  # 0.567 BTC (exact float)
    return NativeLedger(
        native_pnl={"BTC": pnl},
        terminal_native_equity={"BTC": terminal},
        marks={"BTC": marks},
        # ONE inception deposit on day 1 in NATIVE BTC units. The core reads
        # (utc_day_iso, currency, quantity) and re-values at its own mark; the
        # usd_signed slot (0.025 × 88000) is ignored for a branch-2 coin but kept
        # honest and finite (validate_flow_shape).
        native_flows=[
            ExternalFlow(
                "2024-01-01", _BLOWUP_DEPOSIT_BTC * _BLOWUP_MARK, "BTC",
                _BLOWUP_DEPOSIT_BTC,
            )
        ],
        terminal_upnl_native={},
        full_history=True,
    )


@pytest.mark.xfail(
    strict=True,
    reason="Phase 92 HARD-01 pre-fix: a P&L-dominated day on a small-but-above-"
    "dust NAV emits an un-guarded ~17x/day return; Plan 92-02 adds the magnitude "
    "guard and removes this marker",
)
def test_inverse_perpetual_pnl_dominated_day_is_guarded() -> None:
    """DESIRED post-fix behavior: every emitted per-day return is bounded — a
    P&L-dominated day must break the chain (NaN), never emit an un-interpretable
    ~17x/day return. Pre-fix this FAILS on day 3 (r ≈ 17.3), so the strict xfail
    pins the bug as RED evidence while keeping the suite green. Day 1 is NaN
    (negative_nav_guard, prev0 ≈ 0 from the deposit-seeded inception) — a leading
    terminus, not the bug. Run with --runxfail to capture the exploded r value."""
    ledger = _pnl_dominated_blowup_ledger()
    returns, _meta = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
    )
    emitted = returns.dropna()
    assert not emitted.empty  # the series reached the divide (not all-guarded)
    # The bug: an un-guarded P&L-dominated day. Post-fix, every retained return
    # is bounded; pre-fix, day 3's r ≈ 17.3 blows past this and reddens the assert.
    exploded = emitted[emitted.abs() >= 5.0]
    assert exploded.empty, (
        "un-guarded P&L-dominated return(s) emitted (HARD-01 blow-up): "
        f"{exploded.to_dict()}"
    )


def test_blowup_fixture_nav_valuation_matches_hand_model() -> None:
    """Branch-selector diagnostic (research §b / §h Q1) — is the small denominator
    ECONOMICALLY REAL (fix branch b1: add a magnitude guard) or a VALUATION ARTIFACT
    (fix branch b2: fix native_nav._value_over_calendar / equity sourcing)?

    Under CORRECT valuation NAV(d) = Σ_c B_c(d)×mark_c(d); with a single BTC bucket
    and a CONSTANT mark ($88,000) the mark cancels in the ratio, so each emitted
    per-day return equals pnl_t / B_{t-1} (flow-free days). Hand-computed backward
    roll (see _pnl_dominated_blowup_ledger docstring): B(d1)=0.027, B(d2)=0.030,
    B(d3)=0.550, B(d4)=0.555, B(d5)=0.559, B(d6)=0.565.

        r(d2 2024-01-02) = pnl_d2 / B_d1 = 0.003 / 0.027  ≈ 0.111111
        r(d4 2024-01-04) = pnl_d4 / B_d3 = 0.005 / 0.550  ≈ 0.009091
        r(d5 2024-01-05) = pnl_d5 / B_d4 = 0.004 / 0.555  ≈ 0.007207
        r(d6 2024-01-06) = pnl_d6 / B_d5 = 0.006 / 0.559  ≈ 0.010734
        r(d7 2024-01-07) = pnl_d7 / B_d6 = 0.002 / 0.565  ≈ 0.003540

    We assert ONLY the non-dominated days (d2, d4..d7 — they survive both pre- and
    post-fix). d3 is deliberately NOT asserted: post-fix it becomes a guarded NaN,
    and its pre-fix magnitude (r ≈ 17.33) is already captured by Task 1's --runxfail
    RED evidence. If these match → the reconstruction VALUES the equity correctly
    and the tiny denominator is real → SELECT BRANCH b1. If they diverge → the NAV
    is mis-valued → SELECT BRANCH b2. The assertion outcome IS the selector."""
    ledger = _pnl_dominated_blowup_ledger()
    returns, _meta = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit"
    )

    d1, d2, d3, d4, d5, d6, d7 = (
        pd.Timestamp(f"2024-01-0{n}") for n in range(1, 8)
    )
    # Day 1 is a leading terminus (prev0 ≈ 0 → negative_nav_guard).
    assert pd.isna(returns.loc[d1])

    p = _BLOWUP_PNL_BTC
    # Hand-model per-day returns on the CORRECT valuation (mark cancels).
    expected = {
        d2: p[1] / 0.027,   # 0.003 / B_d1
        d4: p[3] / 0.550,   # 0.005 / B_d3
        d5: p[4] / 0.555,   # 0.004 / B_d4
        d6: p[5] / 0.559,   # 0.006 / B_d5
        d7: p[6] / 0.565,   # 0.002 / B_d6
    }
    for day, want in expected.items():
        assert returns.loc[day] == pytest.approx(want, rel=1e-9), (
            f"NAV valuation diverges from the hand model on {day.date()} "
            f"(emitted {returns.loc[day]} vs hand {want}) → selects fix branch b2"
        )
    # d3 (the P&L-dominated day) is intentionally NOT asserted here.
    assert d3 in returns.index  # present, magnitude captured by the xfail repro
