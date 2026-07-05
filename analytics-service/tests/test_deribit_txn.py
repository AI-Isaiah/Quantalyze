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

from datetime import datetime, timezone

from services.deribit_txn import (
    CASH_BEARING_TYPES,
    INFORMATIONAL_TYPES,
    classify_instrument,
    txn_cashflow_to_usd,
    txn_rows_to_daily_records,
)


def _ms(iso: str) -> int:
    """Epoch-ms for an ISO8601 instant (Deribit txn-log carries epoch-ms)."""
    return int(datetime.fromisoformat(iso).timestamp() * 1000)


_DAY_A = "2026-01-15T12:00:00+00:00"
_DAY_B = "2026-01-16T09:30:00+00:00"


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


# ---------------------------------------------------------------------------
# Type-set partition — pinned EXACTLY to the Wave-0 evidence type universe.
# ---------------------------------------------------------------------------


def test_type_sets_pinned_to_evidence() -> None:
    # EXACTLY the evidence-observed cash-bearing/informational universe — no
    # unobserved type is pre-parked into either set (each must fail loud the
    # first time it appears carrying cashflow, forcing an evidence-grounded call).
    assert CASH_BEARING_TYPES == {"trade", "settlement", "delivery"}
    assert INFORMATIONAL_TYPES == {
        "transfer",
        "deposit",
        "withdrawal",
        "usdc_reward",
    }
    for unobserved in (
        "options_settlement_summary",
        "negative_balance_fee",
        "correction",
        "swap",
    ):
        assert unobserved not in CASH_BEARING_TYPES
        assert unobserved not in INFORMATIONAL_TYPES


def test_type_sets_disjoint() -> None:
    assert CASH_BEARING_TYPES & INFORMATIONAL_TYPES == set()


# ---------------------------------------------------------------------------
# txn_rows_to_daily_records — funding-inclusive single sum, count-once (D-10).
# ---------------------------------------------------------------------------


def test_settlement_sum_includes_funding_once() -> None:
    """A day's realized USD == the settlement conversion ALONE. On Deribit
    funding is booked INSIDE the settlement cash delta (A3), so the trade row
    carries zero cashflow and there is NO separate funding line. Re-adding a
    funding line for the same settlement (the OLD two-stream shape) would double
    the settlement cash and turn this red (DRB-07 count-once)."""
    settlement = {
        "type": "settlement",
        "instrument_name": "BTC-PERPETUAL",
        "currency": "BTC",
        "cashflow": 0.01,  # funding-inclusive session PnL
        "index_price": 50000.0,
        "timestamp": _ms(_DAY_A),
        "id": 11,
    }
    trade = {
        "type": "trade",
        "instrument_name": "BTC-PERPETUAL",
        "currency": "BTC",
        "cashflow": 0.0,  # A3: trade rows carry ZERO cashflow
        "timestamp": _ms(_DAY_A),
        "id": 12,
    }
    records = txn_rows_to_daily_records([settlement, trade])
    assert len(records) == 1
    # 0.01 * 50000 == 500.0 — the funding-inclusive settlement, summed ONCE.
    assert records[0]["price"] == pytest.approx(500.0, abs=1e-9)
    assert records[0]["side"] == "buy"
    assert records[0]["price"] == pytest.approx(
        txn_cashflow_to_usd(settlement), abs=1e-9
    )


def test_informational_types_excluded() -> None:
    """transfer/deposit/withdrawal/usdc_reward are capital flows / rewards, NOT
    trading PnL — they are excluded from the daily return. Including any of them
    would move the day-sum off the settlement-only figure (red)."""
    rows = [
        {
            "type": "settlement",
            "instrument_name": "BTC-PERPETUAL",
            "currency": "BTC",
            "cashflow": 0.01,
            "index_price": 50000.0,
            "timestamp": _ms(_DAY_A),
            "id": 21,
        },
        {"type": "transfer", "currency": "USDC", "cashflow": 999.0,
         "timestamp": _ms(_DAY_A), "id": 22},
        {"type": "deposit", "currency": "USDC", "cashflow": 1000.0,
         "timestamp": _ms(_DAY_A), "id": 23},
        {"type": "withdrawal", "currency": "USDC", "cashflow": -500.0,
         "timestamp": _ms(_DAY_A), "id": 24},
        {"type": "usdc_reward", "currency": "USDC", "cashflow": 12.0,
         "timestamp": _ms(_DAY_A), "id": 25},
    ]
    records = txn_rows_to_daily_records(rows)
    assert len(records) == 1
    assert records[0]["price"] == pytest.approx(500.0, abs=1e-9)


@pytest.mark.parametrize(
    "unknown_type",
    ["mystery_new_type", "options_settlement_summary", "negative_balance_fee"],
)
def test_unknown_cashflow_type_fails_loud(unknown_type: str) -> None:
    """An UNOBSERVED type carrying nonzero cashflow must raise naming the type —
    silently dropping it misstates returns, and pre-parking an overlapping
    summary type would double-count (BYB-02 class). A zero-cashflow unknown type
    is ignored with no raise."""
    row = {
        "type": unknown_type,
        "instrument_name": "BTC-PERPETUAL",
        "currency": "USDC",  # USD-family: isolates the type guard from conversion
        "cashflow": 42.0,
        "timestamp": _ms(_DAY_A),
        "id": 31,
    }
    with pytest.raises(ValueError) as exc:
        txn_rows_to_daily_records([row])
    assert unknown_type in str(exc.value)

    zero = dict(row, cashflow=0.0)
    assert txn_rows_to_daily_records([zero]) == []


def test_option_enters_via_cash_delta_not_perp() -> None:
    """An option delivery/settlement row becomes a realized daily_pnl record via
    its cash delta (converted at event-time index_price) — never through perp
    fill math. Structurally, this module imports NOTHING from services.exchange
    / ccxt / pandas, so an option can never reach perp-fill code through it."""
    option_delivery = {
        "type": "delivery",
        "instrument_name": "BTC-24JUL26-57000-P",
        "currency": "BTC",
        "cashflow": 0.1,
        "index_price": 60000.0,
        "timestamp": _ms(_DAY_A),
        "id": 41,
    }
    records = txn_rows_to_daily_records([option_delivery])
    assert len(records) == 1
    # 0.1 * 60000 == 6000.0
    assert records[0]["price"] == pytest.approx(6000.0, abs=1e-9)
    assert records[0]["order_type"] == "daily_pnl"
    assert records[0]["side"] == "buy"

    import services.deribit_txn as mod

    source = open(mod.__file__).read()
    assert "services.exchange" not in source
    assert "import ccxt" not in source
    assert "pandas" not in source


def test_daily_record_shape_and_single_sum() -> None:
    """One daily_pnl record per UTC day; side encodes the signed day-sum, price
    is the absolute USD, timestamp is ISO8601 UTC at 00:00:00."""
    rows = [
        {
            "type": "settlement",
            "instrument_name": "BTC-PERPETUAL",
            "currency": "BTC",
            "cashflow": 0.01,  # +500 on day A
            "index_price": 50000.0,
            "timestamp": _ms(_DAY_A),
            "id": 51,
        },
        {
            "type": "settlement",
            "instrument_name": "BTC-PERPETUAL",
            "currency": "BTC",
            "cashflow": -0.02,  # -1000 on day B
            "index_price": 50000.0,
            "timestamp": _ms(_DAY_B),
            "id": 52,
        },
    ]
    records = txn_rows_to_daily_records(rows)
    assert len(records) == 2
    expected_keys = {
        "exchange",
        "symbol",
        "side",
        "price",
        "quantity",
        "fee",
        "fee_currency",
        "timestamp",
        "order_type",
    }
    for rec in records:
        assert set(rec.keys()) == expected_keys
        assert rec["order_type"] == "daily_pnl"

    by_day = {rec["timestamp"]: rec for rec in records}
    day_a = by_day["2026-01-15T00:00:00+00:00"]
    day_b = by_day["2026-01-16T00:00:00+00:00"]
    assert day_a["side"] == "buy"
    assert day_a["price"] == pytest.approx(500.0, abs=1e-9)
    assert day_b["side"] == "sell"
    assert day_b["price"] == pytest.approx(1000.0, abs=1e-9)
