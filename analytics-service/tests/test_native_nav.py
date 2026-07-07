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

import pytest

from services.external_flows import USD_FAMILY
from services.nav_twr import NavReconstructionError
from services.native_nav import (
    InceptionReconciliationError,
    MarkBranch,
    UnmarkableCurrencyError,
    _assert_families_disjoint,
    classify_currency,
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
