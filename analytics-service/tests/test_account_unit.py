"""Phase 164.6.6.2 BTCNATIVE plan 01 — the account-unit classifier and its floor table.

ORACLE DISCIPLINE: every expected number below is a literal written from the decisions
(D-01, D-04, D-06, D-07, D-20), never read back from the module under test. The BTC row is
the USD row scaled by D-20's own ratio, 0.001 / 1000 = 1e-6, and each product is shown on
paper in the test that pins it.

This module imports only ``services.account_unit`` and ``services.nav_twr`` (both pure), so
it stays importable on a pandera-less local environment.

Run: cd analytics-service && .venv/bin/pytest tests/test_account_unit.py -x
"""
from __future__ import annotations

import pytest

from services import nav_twr
from services.account_unit import (
    USD_FLOORS,
    AccountCurrencyBlank,
    AccountCurrencyMalformed,
    AccountCurrencyUnsupported,
    AccountUnit,
    UnitFloors,
    classify_account_currency,
)


# ---------------------------------------------------------------------------
# D-01: a blank or non-string currency is a distinct, retryable condition
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("raw", ["", "   ", "\t\n", None, 5, 1.5, b"USD", ["USD"]])
def test_blank_or_non_string_is_blank(raw: object) -> None:
    """A terminal that has not yet reported a currency must never be guessed at.
    Blank, whitespace-only and non-str inputs are ONE class, distinct from a malformed
    code, because the caller treats blank as transient and malformed as permanent."""
    with pytest.raises(AccountCurrencyBlank):
        classify_account_currency(raw)


# ---------------------------------------------------------------------------
# D-04 / T-164.6.6.2-02: a non-code is malformed, and the message never echoes it
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw", ["b!tc", "B", "U$D", "12", "USD1", "abcdefghijk", "BT C", "x!y-secret_9"]
)
def test_non_code_is_malformed_and_never_echoed(raw: str) -> None:
    """Fails ``[A-Za-z]{2,10}`` (1 letter, a digit, a symbol, an interior space, or 11
    letters). The exception text is a fixed sentence: terminal-supplied text must not
    reach logs or ``sync_error`` through it (T-164.6.6.2-02)."""
    with pytest.raises(AccountCurrencyMalformed) as info:
        classify_account_currency(raw)
    message = str(info.value)
    assert raw not in message
    assert raw.strip() not in message
    assert message  # a fixed, non-empty sentence


# ---------------------------------------------------------------------------
# D-01 / D-06: the USD family is non-native and keeps the USD floors
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "code"),
    [("USD", "USD"), ("usd", "USD"), (" Usdc ", "USDC"), ("USDT", "USDT"),
     ("EURR", "EURR"), ("DAI", "DAI")],
)
def test_usd_family_is_not_native_and_uses_usd_floors(raw: str, code: str) -> None:
    unit = classify_account_currency(raw)
    assert unit == AccountUnit(code=code, native=False, floors=USD_FLOORS)
    assert unit.floors is USD_FLOORS


def test_btc_with_whitespace_is_native_btc() -> None:
    """``"btc "`` strips, upper-cases and matches the one native row (D-04)."""
    unit = classify_account_currency("btc ")
    assert unit.code == "BTC"
    assert unit.native is True
    assert unit.floors.dust_nav == 0.001
    assert unit.floors is not USD_FLOORS


@pytest.mark.parametrize("raw", ["EUR", "ETH", "gbp", "XAU"])
def test_well_formed_unknown_code_is_unsupported_with_its_code(raw: str) -> None:
    """A real currency we have no floors for is its own condition, carrying the
    already-validated upper-cased code so the caller can name it."""
    with pytest.raises(AccountCurrencyUnsupported) as info:
        classify_account_currency(raw)
    assert info.value.code == raw.upper()


# ---------------------------------------------------------------------------
# D-07 / D-20: the table is the only place a unit-sized threshold is written
# ---------------------------------------------------------------------------


def test_usd_floors_are_todays_constants() -> None:
    """The USD row is the three constants that were hidden in nav_twr / job_worker:
    $1000 dust NAV, $100 material equity, $1.00 residual tolerance."""
    assert USD_FLOORS == UnitFloors(
        dust_nav=1000.0, material_equity=100.0, residual_abs_tol=1.00
    )


def test_btc_floor_is_0_001() -> None:
    """D-20: the BTC dust floor is 0.001 BTC (supersedes D-05's 0.01). The other two
    thresholds are the USD row scaled by D-20's own ratio 0.001 / 1000 = 1e-6:
      material_equity  100  * 1e-6 = 0.0001 BTC
      residual_abs_tol 1.00 * 1e-6 = 0.000001 BTC
    """
    btc = classify_account_currency("BTC").floors
    assert btc == UnitFloors(
        dust_nav=0.001, material_equity=0.0001, residual_abs_tol=1e-6
    )
    # The ratio the BTC row is derived by, pinned as an invariant so a hand-edited
    # row that breaks the scaling shows up here rather than in a PROD factsheet.
    ratio = btc.dust_nav / USD_FLOORS.dust_nav
    assert ratio == pytest.approx(1e-6, rel=1e-12)
    assert btc.material_equity == pytest.approx(USD_FLOORS.material_equity * ratio)
    assert btc.residual_abs_tol == pytest.approx(USD_FLOORS.residual_abs_tol * ratio)


def test_dust_nav_floor_name_is_an_alias_of_the_usd_row() -> None:
    """Non-MT5 importers (scripts/mt5_soak.py, job_worker, tests) keep importing
    ``DUST_NAV_FLOOR``; it must be the USD row, never a second copy of the number."""
    assert nav_twr.DUST_NAV_FLOOR == 1000.0
    assert nav_twr.DUST_NAV_FLOOR == USD_FLOORS.dust_nav


def test_floors_are_immutable() -> None:
    """A mutable floor row would let one job's unit leak into a concurrent job's
    judgement (T-164.6.6.2-01). Frozen dataclasses refuse the write."""
    with pytest.raises(AttributeError):
        USD_FLOORS.dust_nav = 1.0  # type: ignore[misc]
    unit = classify_account_currency("USD")
    with pytest.raises(AttributeError):
        unit.native = True  # type: ignore[misc]


def test_native_unit_is_not_a_warning() -> None:
    """D-08: the account's unit is a property, not a data-quality flag. It must not ride
    the guard registry (which promotes a status to complete_with_warnings) nor the meta."""
    assert "native_unit" not in nav_twr.NAV_TWR_GUARD_KEYS
    assert "native_unit" not in nav_twr.NavTWRMeta.__annotations__
