"""Fixture-based, I/O-free tests for the Deribit acceptance harness (SC-2).

These pin the pure acceptance-check core of ``scripts.deribit_acceptance`` — the
gate that reconciles a fresh exchange re-crawl against the persisted factsheet
(D-2 anchor: completeness + reconcile + signs; fill counts advisory-only). NO
network, NO Supabase — the live driver is exercised only by a smoke import.

Revert-proof anchors (a mutation to the check's core comparison reddens the test):
  * daily_reconcile — a dropped day AND an injected day each fail loud and NAME
    the offending date; neutering the set-difference guard (``if not dropped and
    not injected`` → ``if True``) passes them wrongly and reddens both tests.
  * inverse_signs — an inverse row that cannot be valued (no event-time index,
    no same-day fallback) fails loud and NAMES the row; a well-formed inverse
    loss AND gain both preserve sign and pass. Since ``txn_change_to_usd``
    multiplies a coin delta by a STRICTLY-POSITIVE index (or passes a linear row
    through), it can never flip a sign — so the failable path is the unconvertible
    row, and neutering the mismatch-collection passes it wrongly.
"""
from __future__ import annotations

from datetime import date

import pytest

from scripts.deribit_acceptance import (
    AccountAcceptance,
    Check,
    check_daily_reconcile,
    check_date_coverage,
    check_factsheet_status,
    check_inverse_signs,
    summarize_fills,
)


# ---------------------------------------------------------------------------
# check_factsheet_status — success states pass; failure states fail loud.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("status", ["complete", "complete_with_warnings"])
def test_status_success_states_pass(status: str) -> None:
    chk = check_factsheet_status(status, {})
    assert chk.passed
    assert status in chk.detail


@pytest.mark.parametrize("status", ["failed", "pending", "computing", ""])
def test_status_non_success_states_fail_loud(status: str) -> None:
    chk = check_factsheet_status(status, {})
    assert not chk.passed
    # Fails LOUD naming the offending status.
    assert repr(status) in chk.detail


def test_status_detail_names_dq_flags() -> None:
    """A success state still passes, but the detail NAMES any present DQ flag so
    a heuristic-capital / balance-error factsheet is surfaced, not hidden."""
    flags = {"csv_source": "deribit_ledger", "heuristic_capital_used": True}
    chk = check_factsheet_status("complete_with_warnings", flags)
    assert chk.passed
    assert "csv_source" in chk.detail
    assert "heuristic_capital_used" in chk.detail


# ---------------------------------------------------------------------------
# check_date_coverage — overlap passes; disjoint (either side) + empty fail.
# ---------------------------------------------------------------------------

_W_START = date(2025, 8, 1)
_W_END = date(2025, 9, 30)


def test_date_coverage_overlap_passes() -> None:
    active = [date(2025, 8, 15), date(2025, 9, 10)]
    chk = check_date_coverage(active, _W_START, _W_END)
    assert chk.passed


def test_date_coverage_partial_overlap_still_passes() -> None:
    """Anchor-to-today: observed edges may drift past the window and still
    OVERLAP it — overlap, not equality, is the honest bound."""
    active = [date(2025, 9, 20), date(2025, 10, 15)]  # extends past window end
    chk = check_date_coverage(active, _W_START, _W_END)
    assert chk.passed


def test_date_coverage_disjoint_before_fails() -> None:
    active = [date(2025, 6, 1), date(2025, 7, 20)]  # entirely before window start
    chk = check_date_coverage(active, _W_START, _W_END)
    assert not chk.passed
    assert "DISJOINT" in chk.detail


def test_date_coverage_disjoint_after_fails() -> None:
    active = [date(2025, 10, 5), date(2025, 11, 1)]  # entirely after window end
    chk = check_date_coverage(active, _W_START, _W_END)
    assert not chk.passed
    assert "DISJOINT" in chk.detail


def test_date_coverage_empty_fails_loud() -> None:
    chk = check_date_coverage([], _W_START, _W_END)
    assert not chk.passed
    assert "no active ledger dates" in chk.detail


# ---------------------------------------------------------------------------
# check_daily_reconcile — NONZERO-P&L day equality (real realized cash) is the
# gate; zero-value days differ harmlessly across crawls → advisory only.
# REVERT-PROOF: dropped + injected each fail loud and name the date.
# ---------------------------------------------------------------------------


def test_daily_reconcile_identical_sets_pass() -> None:
    days = {date(2025, 8, 1), date(2025, 8, 2), date(2025, 8, 3)}
    chk = check_daily_reconcile(days, set(days))
    assert chk.passed
    assert "3 nonzero-P&L day(s) reconcile exactly" in chk.detail


def test_daily_reconcile_zero_day_delta_is_advisory_not_gated() -> None:
    """The real finding from the LTP056 canary: nonzero-P&L days reconcile EXACTLY
    but the two crawls emit a different set of cosmetic zero-value days. That must
    PASS (real cash reconciles) with the zero-day delta reported advisory-only.
    Revert-proof: gating on zero_day_delta (e.g. ``passed = ... and not
    zero_day_delta``) would redden this."""
    days = {date(2025, 6, 1), date(2025, 6, 2)}
    chk = check_daily_reconcile(days, set(days), zero_day_delta=13)
    assert chk.passed
    assert "13 cosmetic zero-value day(s) differ" in chk.detail
    assert "advisory" in chk.detail


def test_daily_reconcile_dropped_day_fails_and_names_it() -> None:
    """A day the FRESH ledger has but the factsheet did NOT persist (a dropped
    settlement day) fails loud and names the date. Neutering the set-difference
    guard (``if not dropped and not injected`` → ``if True``) passes this wrongly.
    """
    ledger = {date(2025, 8, 1), date(2025, 8, 2), date(2025, 8, 3)}
    persisted = {date(2025, 8, 1), date(2025, 8, 2)}  # 2025-08-03 dropped
    chk = check_daily_reconcile(ledger, persisted)
    assert not chk.passed
    assert "2025-08-03" in chk.detail
    assert "dropped" in chk.detail


def test_daily_reconcile_injected_day_fails_and_names_it() -> None:
    """A day persisted but ABSENT from the fresh ledger (a fabricated/injected
    day) fails loud and names the date."""
    ledger = {date(2025, 8, 1), date(2025, 8, 2)}
    persisted = {date(2025, 8, 1), date(2025, 8, 2), date(2025, 8, 9)}  # injected
    chk = check_daily_reconcile(ledger, persisted)
    assert not chk.passed
    assert "2025-08-09" in chk.detail
    assert "injected" in chk.detail


# ---------------------------------------------------------------------------
# check_inverse_signs — D-07/D-08 sign invariant against real txn_change_to_usd.
# REVERT-PROOF: an unconvertible inverse row fails loud and names the row.
# ---------------------------------------------------------------------------


def test_inverse_signs_loss_and_gain_both_preserve_sign_pass() -> None:
    """A BTC loss (negative change) and an ETH gain (positive change) both convert
    at their OWN event-time index_price with the sign trusted verbatim → pass."""
    rows = [
        {
            "type": "settlement",
            "instrument_name": "BTC-PERPETUAL",
            "currency": "BTC",
            "change": -0.02,  # loss → -1000 USD @ 50000
            "index_price": 50000.0,
            "id": 1,
        },
        {
            "type": "settlement",
            "instrument_name": "ETH-PERPETUAL",
            "currency": "ETH",
            "change": 0.05,  # gain → +100 USD @ 2000
            "index_price": 2000.0,
            "id": 2,
        },
    ]
    chk = check_inverse_signs(rows)
    assert chk.passed
    assert "2 inverse row(s)" in chk.detail


def test_inverse_signs_unconvertible_row_fails_and_names_it() -> None:
    """An inverse (BTC) row with NO event-time index_price and NO same-day
    fallback cannot be valued by ``txn_change_to_usd`` (it raises D-07). An
    unverifiable sign is not a trusted one → fail loud naming the row id.

    This is the failable path: ``txn_change_to_usd`` multiplies by a strictly-
    positive index (or passes a linear row through), so it can NEVER flip a sign
    — the only way this check fails on real code is an unconvertible inverse row.
    Neutering the mismatch-collection (the ``except ValueError`` append →
    ``continue``) passes this wrongly and reddens the test.
    """
    rows = [
        {
            "type": "negative_balance_fee",
            "currency": "BTC",
            "change": -0.001,  # coin delta with no index anywhere
            "id": 73,
        },
    ]
    chk = check_inverse_signs(rows)
    assert not chk.passed
    assert "73" in chk.detail
    assert "unconvertible" in chk.detail


def test_inverse_signs_no_inverse_rows_pass() -> None:
    """Only linear (USD-family) rows present → nothing to sign-check → pass."""
    rows = [
        {
            "type": "settlement",
            "instrument_name": "BTC_USDC-PERPETUAL",
            "currency": "USDC",
            "change": 12.5,
            "id": 5,
        },
    ]
    chk = check_inverse_signs(rows)
    assert chk.passed
    assert chk.detail == "no inverse rows"


# ---------------------------------------------------------------------------
# summarize_fills — advisory only, never a gate.
# ---------------------------------------------------------------------------


def test_summarize_fills_is_advisory_return_row_count() -> None:
    assert summarize_fills(18_778) == {"return_rows": 18_778}


# ---------------------------------------------------------------------------
# AccountAcceptance.passed — one failing gate check fails the whole account.
# ---------------------------------------------------------------------------


def test_account_passed_false_when_any_check_fails() -> None:
    acc = AccountAcceptance(
        strategy_id="sid-1",
        label="LTP056",
        checks=[
            Check("a", True, "ok"),
            Check("b", False, "boom"),  # one failing gate check
            Check("c", True, "ok"),
        ],
    )
    assert acc.passed is False


def test_account_passed_true_when_all_checks_pass() -> None:
    acc = AccountAcceptance(
        strategy_id="sid-2",
        label="LTP072",
        checks=[Check("a", True, "ok"), Check("b", True, "ok")],
    )
    assert acc.passed is True


# ---------------------------------------------------------------------------
# Smoke import — the live driver's pure surface imports cleanly (no I/O run).
# ---------------------------------------------------------------------------


def test_live_driver_pure_surface_imports() -> None:
    from scripts.deribit_acceptance import (  # noqa: F401
        AccountSpec,
        _parse_account_spec,
        verify_account,
    )

    spec = _parse_account_spec("abc-uuid:2:LTP072:2025-08-01:2025-09-30")
    assert spec.key_index == 2
    assert spec.window_start == date(2025, 8, 1)
    assert spec.window_end == date(2025, 9, 30)
    assert spec.label == "LTP072"
