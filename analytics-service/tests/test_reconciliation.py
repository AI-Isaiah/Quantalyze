"""Tests for analytics-service/services/reconciliation.py.

Pure-function coverage for `diff_strategy_fills`. The service is
deliberately I/O-free, so no mocking is needed — each test constructs
two lists of fill dicts and asserts on the returned report.

Regression gates (from eng review P0 findings):
  - Bybit ladder: 3 fills at same price/qty/ts with different fill_ids
    must classify as id_drift x3, NOT missing_in_db. A naive ID-only
    matcher would flag these as false positives every night.
  - N:M tuple match: 2 exchange rows vs 1 DB row at the same tuple
    must escalate to needs_manual_review, never silently collapse.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from services.reconciliation import (
    ReconciliationReport,
    diff_strategy_fills,
)


STRATEGY_ID = "00000000-0000-0000-0000-000000000001"
NOW = datetime(2026, 4, 16, 12, 0, 0, tzinfo=timezone.utc)
WINDOW = (NOW - timedelta(hours=24), NOW)


def _fill(
    fill_id: str = "f1",
    exchange: str = "bybit",
    symbol: str = "BTCUSDT",
    side: str = "buy",
    price: float = 50_000.0,
    quantity: float = 0.1,
    timestamp: str | None = None,
    fee: float = 0.5,
    fee_currency: str = "USDT",
    cost: float | None = None,
) -> dict:
    """Matches the shape produced by exchange._normalize_fill."""
    return {
        "exchange": exchange,
        "symbol": symbol,
        "side": side,
        "price": price,
        "quantity": quantity,
        "fee": fee,
        "fee_currency": fee_currency,
        "timestamp": timestamp or "2026-04-16T10:00:00+00:00",
        "cost": cost if cost is not None else price * quantity,
        "exchange_fill_id": fill_id,
        "exchange_order_id": f"order_{fill_id}",
        "is_fill": True,
        "is_maker": False,
    }


# ---------------------------------------------------------------------------
# (a) all primary matches clean
# ---------------------------------------------------------------------------

class TestCleanPath:
    def test_all_fills_match_by_id_returns_clean(self) -> None:
        exchange_fills = [
            _fill("f1", symbol="BTCUSDT"),
            _fill("f2", symbol="ETHUSDT", price=3_000.0, quantity=1.0),
            _fill("f3", symbol="SOLUSDT", price=150.0, quantity=10.0),
        ]
        # DB side is an identical copy (primary match on fill_id + exchange).
        db_fills = [dict(f) for f in exchange_fills]

        report = diff_strategy_fills(STRATEGY_ID, WINDOW, exchange_fills, db_fills)

        assert isinstance(report, ReconciliationReport)
        assert report.strategy_id == STRATEGY_ID
        assert report.report_date == NOW.strftime("%Y-%m-%d")
        assert report.status == "clean"
        assert report.discrepancy_count == 0
        assert report.discrepancies == []

    def test_empty_inputs_are_clean(self) -> None:
        report = diff_strategy_fills(STRATEGY_ID, WINDOW, [], [])
        assert report.status == "clean"
        assert report.discrepancy_count == 0


# ---------------------------------------------------------------------------
# (b) one missing DB fill -> missing_in_db
# ---------------------------------------------------------------------------

class TestMissingInDb:
    def test_exchange_has_fill_db_does_not(self) -> None:
        exchange_fills = [
            _fill("f1"),
            _fill("f2", symbol="ETHUSDT", price=3_000.0, quantity=1.0),
        ]
        db_fills = [exchange_fills[0].copy()]  # missing f2

        report = diff_strategy_fills(STRATEGY_ID, WINDOW, exchange_fills, db_fills)

        assert report.status == "discrepancies"
        assert report.discrepancy_count == 1

        d = report.discrepancies[0]
        assert d["kind"] == "missing_in_db"
        assert d["exchange_fill_id"] == "f2"
        assert d["details"]["exchange"]["symbol"] == "ETHUSDT"

    def test_db_has_fill_exchange_does_not_is_unknown_in_exchange(self) -> None:
        exchange_fills: list[dict] = []
        db_fills = [_fill("orphan")]

        report = diff_strategy_fills(STRATEGY_ID, WINDOW, exchange_fills, db_fills)
        assert report.status == "discrepancies"
        assert report.discrepancy_count == 1
        assert report.discrepancies[0]["kind"] == "unknown_in_exchange"
        assert report.discrepancies[0]["exchange_fill_id"] == "orphan"


# ---------------------------------------------------------------------------
# (c) Bybit ladder — P0 regression gate
# ---------------------------------------------------------------------------

class TestBybitLadderIdDrift:
    """Three fills with identical (symbol, ts, price, qty, side) but
    different fill_ids on each side. A naive ID-only matcher flags all
    three as missing_in_db — this test locks in the id_drift behavior.
    """

    def test_three_ladder_fills_classify_as_id_drift_not_missing(self) -> None:
        base_kwargs = dict(
            exchange="bybit",
            symbol="BTCUSDT",
            side="buy",
            price=50_000.0,
            quantity=0.1,
            timestamp="2026-04-16T10:00:00+00:00",
        )
        # Exchange side has one set of ids; DB side was captured from an
        # earlier sync and the exchange rotated the ids since.
        exchange_fills = [
            {**_fill(f"ex_{i}", **base_kwargs), "exchange_fill_id": f"ex_{i}"}
            for i in range(3)
        ]
        db_fills = [
            {**_fill(f"db_{i}", **base_kwargs), "exchange_fill_id": f"db_{i}"}
            for i in range(3)
        ]

        report = diff_strategy_fills(STRATEGY_ID, WINDOW, exchange_fills, db_fills)

        # Exactly 3 id_drift rows, zero false positives.
        kinds = [d["kind"] for d in report.discrepancies]
        assert kinds == ["id_drift", "id_drift", "id_drift"], (
            f"Expected 3 id_drift, got {kinds}"
        )
        assert report.discrepancy_count == 3
        # id_drift is informational — status should NOT be needs_manual_review.
        assert report.status == "discrepancies"

        # No ambiguity escalation.
        assert all(d["kind"] != "needs_manual_review" for d in report.discrepancies)
        # No missing_in_db false positives.
        assert all(d["kind"] != "missing_in_db" for d in report.discrepancies)
        assert all(d["kind"] != "unknown_in_exchange" for d in report.discrepancies)

    def test_ladder_with_1bp_price_drift_still_matches(self) -> None:
        """Exchange reports price 50000.05, DB has 50000.00 — 1bp is 5 USD
        on a 50k price, so 0.05 drift is within tolerance.
        """
        base_kwargs = dict(
            exchange="bybit",
            symbol="BTCUSDT",
            side="buy",
            quantity=0.1,
            timestamp="2026-04-16T10:00:00+00:00",
        )
        exchange_fills = [
            {**_fill(f"ex_{i}", price=50_000.05, **base_kwargs),
             "exchange_fill_id": f"ex_{i}"}
            for i in range(2)
        ]
        db_fills = [
            {**_fill(f"db_{i}", price=50_000.00, **base_kwargs),
             "exchange_fill_id": f"db_{i}"}
            for i in range(2)
        ]

        report = diff_strategy_fills(STRATEGY_ID, WINDOW, exchange_fills, db_fills)
        kinds = [d["kind"] for d in report.discrepancies]
        assert kinds == ["id_drift", "id_drift"]


# ---------------------------------------------------------------------------
# (d) N:M tuple match -> needs_manual_review
# ---------------------------------------------------------------------------

class TestNeedsManualReview:
    def test_2_exchange_rows_vs_1_db_row_same_tuple_escalates(self) -> None:
        base_kwargs = dict(
            exchange="bybit",
            symbol="BTCUSDT",
            side="buy",
            price=50_000.0,
            quantity=0.1,
            timestamp="2026-04-16T10:00:00+00:00",
        )
        exchange_fills = [
            {**_fill(f"ex_{i}", **base_kwargs), "exchange_fill_id": f"ex_{i}"}
            for i in range(2)
        ]
        db_fills = [
            {**_fill("db_only", **base_kwargs), "exchange_fill_id": "db_only"}
        ]

        report = diff_strategy_fills(STRATEGY_ID, WINDOW, exchange_fills, db_fills)

        assert report.status == "needs_manual_review"
        # Exactly one escalation row (the ambiguity), not three individual ones.
        nmr = [d for d in report.discrepancies if d["kind"] == "needs_manual_review"]
        assert len(nmr) == 1
        details = nmr[0]["details"]
        assert len(details["exchange_rows"]) == 2
        assert len(details["db_rows"]) == 1


# ---------------------------------------------------------------------------
# Bonus: primary-stage id match but mismatched numbers
# ---------------------------------------------------------------------------

class TestIdMatchWithDisagreement:
    def test_same_id_different_qty_emits_mismatch_quantity(self) -> None:
        ex = _fill("f1", quantity=0.1)
        db = _fill("f1", quantity=0.2)  # same fill_id, different qty

        report = diff_strategy_fills(STRATEGY_ID, WINDOW, [ex], [db])
        assert report.status == "discrepancies"
        assert report.discrepancy_count == 1
        assert report.discrepancies[0]["kind"] == "mismatch_quantity"

    def test_same_id_different_price_emits_mismatch_price(self) -> None:
        ex = _fill("f1", price=50_000.0)
        db = _fill("f1", price=51_000.0)  # 2% drift — way outside 1bp

        report = diff_strategy_fills(STRATEGY_ID, WINDOW, [ex], [db])
        assert report.status == "discrepancies"
        assert report.discrepancy_count == 1
        assert report.discrepancies[0]["kind"] == "mismatch_price"
