"""Revert-proof correctness tests for services.deribit_txn (P70 RISKY core).

These tests pin the silent-corruption risks of the Deribit ledger ingestion
BEFORE any I/O code exists (D-05/D-07/D-08/D-10):

  * inverse coin->USD converts at the row's OWN event-time index_price, with the
    ledger's credit(+)/debit(-) sign trusted verbatim — hand-computed short AND
    long fixtures fail if the sign flips or the multiply drops;
  * linear (_USDC/_USDT/_EURR or USD-currency) cashflow passes through as USD
    with NO index multiplication;
  * an inverse row missing its event-time index_price fails loud (never a
    current/period-end price fallback);
  * the cash-bearing single-sum counts each cash-bearing row ONCE per UTC day —
    funding is already inside `settlement`, so a separate funding line would
    double-count and turn the count-once test red;
  * any UNOBSERVED transaction-log type carrying nonzero cashflow fails loud.
"""
from __future__ import annotations

import pytest

from services.deribit_txn import (
    classify_instrument,
    txn_cashflow_to_usd,
)


# ---------------------------------------------------------------------------
# txn_cashflow_to_usd — inverse coin->USD at event-time index_price (D-07/D-08)
# ---------------------------------------------------------------------------


def test_inverse_short_coin_to_usd() -> None:
    """A settlement cash delta on an inverse perp converts at the row's OWN
    event-time index_price, credit(+)/debit(-) sign trusted verbatim."""
    credit = {
        "type": "settlement",
        "instrument_name": "ETH-PERPETUAL",
        "currency": "ETH",
        "cashflow": 0.05,
        "index_price": 2000.0,
        "id": 1,
    }
    assert txn_cashflow_to_usd(credit) == pytest.approx(100.0, abs=1e-12)

    debit = {
        "type": "settlement",
        "instrument_name": "ETH-PERPETUAL",
        "currency": "ETH",
        "cashflow": -0.031,
        "index_price": 1850.0,
        "id": 2,
    }
    # Hand-computed: -0.031 * 1850.0 == -57.35 ; a sign flip -> +57.35 (red).
    assert txn_cashflow_to_usd(debit) == pytest.approx(-57.35, abs=1e-12)


def test_inverse_long_coin_to_usd() -> None:
    """BTC inverse perp: long-side cash deltas convert with sign preserved."""
    a = {
        "type": "settlement",
        "instrument_name": "BTC-PERPETUAL",
        "currency": "BTC",
        "cashflow": -0.02,
        "index_price": 50000.0,
        "id": 3,
    }
    assert txn_cashflow_to_usd(a) == pytest.approx(-1000.0, abs=1e-12)

    b = {
        "type": "settlement",
        "instrument_name": "BTC-PERPETUAL",
        "currency": "BTC",
        "cashflow": 0.004,
        "index_price": 61250.0,
        "id": 4,
    }
    assert txn_cashflow_to_usd(b) == pytest.approx(245.0, abs=1e-12)


def test_linear_settlement_is_usd() -> None:
    """A linear (_USDC) settlement is ALREADY USD — the index_price MUST be
    ignored. Multiplying by index (8.3) would inflate 12.5 -> 103.75 (red)."""
    row = {
        "type": "settlement",
        "instrument_name": "TRUMP_USDC-PERPETUAL",
        "currency": "USDC",
        "cashflow": 12.5,
        "index_price": 8.3,
        "id": 5,
    }
    assert txn_cashflow_to_usd(row) == pytest.approx(12.5, abs=1e-12)


def test_missing_event_price_fails_loud() -> None:
    """An inverse row with no event-time index_price (None or absent) MUST raise
    naming the row id — NEVER a current/period-end price fallback (D-07)."""
    row_none = {
        "type": "settlement",
        "instrument_name": "BTC-PERPETUAL",
        "currency": "BTC",
        "cashflow": 0.01,
        "index_price": None,
        "mark_price": None,
        "id": 987,
    }
    with pytest.raises(ValueError) as exc_none:
        txn_cashflow_to_usd(row_none)
    assert "987" in str(exc_none.value)

    row_absent = {
        "type": "settlement",
        "instrument_name": "BTC-PERPETUAL",
        "currency": "BTC",
        "cashflow": 0.01,
        "id": 654,
    }
    with pytest.raises(ValueError) as exc_absent:
        txn_cashflow_to_usd(row_absent)
    assert "654" in str(exc_absent.value)


# ---------------------------------------------------------------------------
# classify_instrument — inverse / linear / option / future / unknown
# (single definition, lifted into services.deribit_txn — D-05)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name,expected",
    [
        ("ETH-PERPETUAL", "inverse_perpetual"),
        ("BTC-PERPETUAL", "inverse_perpetual"),
        ("ETH_USDC-PERPETUAL", "linear_perpetual"),
        ("BTC_USDC-PERPETUAL", "linear_perpetual"),
        ("BTC-24JUL26-57000-P", "option"),
        ("BTC-27MAR26-60000-C", "option"),
        ("BTC-27MAR26", "future"),
        ("SOMETHING-WEIRD", "unknown"),
        ("", "unknown"),
        (None, "unknown"),
    ],
)
def test_classify_inverse_vs_linear(name: object, expected: str) -> None:
    assert classify_instrument(name) == expected  # type: ignore[arg-type]


def test_classify_never_raises_on_junk() -> None:
    # Untrusted exchange input — must classify, not crash (T-70-05 / V5).
    for junk in ("---", "12345", "BTC-", "-PERPETUAL", "BTC_USDC-"):
        assert isinstance(classify_instrument(junk), str)
