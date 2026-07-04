"""Tests for analytics-service/scripts/bybit_reconcile.py (BYB-01).

Pure-function coverage for the reconciliation comparison layer. The
functions are deliberately I/O-free (no network, no DB, no ccxt), so no
mocking is needed — each test constructs fixtures and asserts on the
returned dict.

Regression gates (each docstring encodes WHY, Rule 9):
  - compare_dailies: 1e-9 IS the BYB-01 reconciliation definition. A
    recomputed realized+funding series that drifts from stored
    csv_daily_returns by >= 1e-9 on any OVERLAPPING historical day is a
    real ingestion bug; a 1e-6 perturbation MUST be rejected. Dates
    present on only one side (windows differ / anchor-to-today most-recent
    day moves) are EXCLUDED from the tolerance check — never a false bug.
  - funding_bucket_summary: Bybit ROTATES funding transaction ids across
    responses (funding_fetch.py module docstring), so funding MUST
    reconcile by match_key bucket / per-day sum, NEVER native-id equality.
    A bucket present fresh-from-exchange but absent in the DB is the #563
    dropped-funding signal.
  - fills wiring: the script's DB-row -> fill-dict projection must match
    the shape services.reconciliation.diff_strategy_fills expects, so an
    identical fresh/DB set reconciles clean (no false missing_in_db).
  - build_report: #563 discipline — a fills count_delta is RECORDED even
    when zero; verdict is one of three enumerated strings; the report is
    sanitized-by-construction (no secret material, api_key_id masked to
    ***last4, ccxt &signature= scrubbed).

NOTE (local venv): pandas OPERATIONS segfault on this Python 3.14 venv
(numpy/pandas ABI drift), so ``compare_dailies`` is duck-typed to accept
any ``.items()``-able mapping (a plain dict here; the real ``pd.Series``
in production). No pandas object is constructed in these tests.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from scripts.bybit_reconcile import (
    build_report,
    compare_dailies,
    db_trade_to_fill,
    funding_bucket_summary,
)
from services.funding_fetch import _build_match_key
from services.reconciliation import diff_strategy_fills

STRATEGY_ID = "00000000-0000-0000-0000-000000000001"
API_KEY_ID = "11111111-2222-3333-4444-555555556666"
NOW = datetime(2026, 4, 16, 12, 0, 0, tzinfo=timezone.utc)
WINDOW = (NOW - timedelta(days=180), NOW)


# ---------------------------------------------------------------------------
# compare_dailies — the 1e-9 BYB-01 reconciliation definition
# ---------------------------------------------------------------------------

class TestCompareDailies:
    def _stored(self, values: dict[str, float]) -> list[dict[str, object]]:
        return [{"date": d, "daily_return": v} for d, v in values.items()]

    def test_identical_overlap_is_clean(self) -> None:
        recomputed = {"2026-01-01": 0.01, "2026-01-02": -0.02, "2026-01-03": 0.005}
        stored = self._stored(dict(recomputed))
        out = compare_dailies(recomputed, stored, tol=1e-9)
        assert out["clean"] is True
        assert out["max_abs_delta"] < 1e-9
        assert out["dates_beyond_tol"] == []
        assert out["overlap_days"] == 3
        assert out["only_in_recomputed"] == []
        assert out["only_in_stored"] == []

    def test_single_1e6_perturbation_is_dirty_and_lists_the_date(self) -> None:
        recomputed = {"2026-01-01": 0.01, "2026-01-02": -0.02, "2026-01-03": 0.005}
        stored = self._stored({"2026-01-01": 0.01, "2026-01-02": -0.02 + 1e-6, "2026-01-03": 0.005})
        out = compare_dailies(recomputed, stored, tol=1e-9)
        assert out["clean"] is False
        assert out["dates_beyond_tol"] == ["2026-01-02"]
        assert out["max_abs_delta"] >= 1e-9

    def test_only_on_one_side_excluded_from_tolerance_but_counted(self) -> None:
        # 2026-01-04 exists only in recomputed (e.g. anchor-to-today tail);
        # 2025-12-31 exists only in stored. Neither is a tolerance failure.
        recomputed = {"2026-01-01": 0.01, "2026-01-02": -0.02, "2026-01-04": 0.9}
        stored = self._stored({"2025-12-31": -0.5, "2026-01-01": 0.01, "2026-01-02": -0.02})
        out = compare_dailies(recomputed, stored, tol=1e-9)
        assert out["clean"] is True
        assert out["overlap_days"] == 2
        assert out["only_in_recomputed"] == ["2026-01-04"]
        assert out["only_in_stored"] == ["2025-12-31"]

    def test_accepts_datetime_keys_via_items(self) -> None:
        # Production passes a pd.Series with Timestamp keys; a datetime key
        # must normalize to the same ISO calendar day as a string key.
        recomputed = {
            datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc): 0.01,
            datetime(2026, 1, 2, 0, 0, tzinfo=timezone.utc): -0.02,
        }
        stored = [{"date": "2026-01-01", "daily_return": 0.01},
                  {"date": "2026-01-02", "daily_return": -0.02}]
        out = compare_dailies(recomputed, stored, tol=1e-9)
        assert out["clean"] is True
        assert out["overlap_days"] == 2


# ---------------------------------------------------------------------------
# funding_bucket_summary — bucket set, never native id
# ---------------------------------------------------------------------------

class TestFundingBucketSummary:
    def _f(self, symbol: str, ts: datetime, amount: float, txid: str) -> dict[str, object]:
        return {
            "strategy_id": STRATEGY_ID,
            "exchange": "bybit",
            "symbol": symbol,
            "amount": amount,
            "currency": "USDT",
            "timestamp": ts,
            # native transaction id — Bybit ROTATES these; must be ignored.
            "id": txid,
        }

    def test_equal_buckets_are_clean_even_with_rotated_ids(self) -> None:
        ts = datetime(2026, 4, 1, 9, 0, tzinfo=timezone.utc)
        fresh = [self._f("BTCUSDT", ts, 1.5, "fresh-abc")]
        db = [self._f("BTCUSDT", ts, 1.5, "db-xyz")]  # SAME bucket, different id
        out = funding_bucket_summary(fresh, db)
        assert out["clean"] is True
        assert out["missing_in_db"] == []
        expected_key = _build_match_key(STRATEGY_ID, "bybit", "BTCUSDT", ts)
        assert out["fresh_bucket_count"] == 1
        assert expected_key in out["bucket_keys"]

    def test_missing_bucket_on_db_side_is_listed(self) -> None:
        ts1 = datetime(2026, 4, 1, 9, 0, tzinfo=timezone.utc)
        ts2 = datetime(2026, 4, 2, 9, 0, tzinfo=timezone.utc)
        fresh = [self._f("BTCUSDT", ts1, 1.5, "a"), self._f("BTCUSDT", ts2, 2.0, "b")]
        db = [self._f("BTCUSDT", ts1, 1.5, "c")]  # ts2 bucket dropped by DB
        out = funding_bucket_summary(fresh, db)
        assert out["clean"] is False
        missing_key = _build_match_key(STRATEGY_ID, "bybit", "BTCUSDT", ts2)
        assert out["missing_in_db"] == [missing_key]

    def test_per_day_sum_delta_reported(self) -> None:
        ts = datetime(2026, 4, 1, 9, 0, tzinfo=timezone.utc)
        fresh = [self._f("BTCUSDT", ts, 3.0, "a")]
        db = [self._f("BTCUSDT", ts, 2.0, "b")]  # same bucket, disagreeing amount
        out = funding_bucket_summary(fresh, db)
        assert out["per_day_delta"]["2026-04-01"] == pytest.approx(1.0)
        assert out["days_beyond_tol"] == ["2026-04-01"]
        assert out["clean"] is False


# ---------------------------------------------------------------------------
# fills wiring — db_trade_to_fill feeds diff_strategy_fills cleanly
# ---------------------------------------------------------------------------

class TestFillsWiring:
    def _db_row(self, fill_id: str) -> dict[str, object]:
        # Shape of a SELECT from the trades table.
        return {
            "exchange": "bybit",
            "exchange_fill_id": fill_id,
            "symbol": "BTCUSDT",
            "side": "buy",
            "price": 50_000.0,
            "quantity": 0.1,
            "timestamp": "2026-04-16T10:00:00+00:00",
        }

    def test_identical_projected_sets_reconcile_clean(self) -> None:
        db_rows = [self._db_row("f1"), self._db_row("f2")]
        exchange_fills = [db_trade_to_fill(r) for r in db_rows]
        db_fills = [db_trade_to_fill(r) for r in db_rows]
        report = diff_strategy_fills(STRATEGY_ID, WINDOW, exchange_fills, db_fills)
        assert report.status == "clean"
        assert report.discrepancy_count == 0

    def test_projection_carries_the_matcher_key_fields(self) -> None:
        fill = db_trade_to_fill(self._db_row("f1"))
        for key in ("exchange", "exchange_fill_id", "symbol", "side", "price",
                    "quantity", "timestamp"):
            assert key in fill


# ---------------------------------------------------------------------------
# build_report — verdict, count-delta discipline, sanitization
# ---------------------------------------------------------------------------

class TestBuildReport:
    def _clean_fills(self) -> dict[str, object]:
        return {"exchange_count": 10, "db_count": 10, "count_delta": 0,
                "status": "clean", "id_drift_count": 0, "true_discrepancy_count": 0}

    def _clean_funding(self) -> dict[str, object]:
        return funding_bucket_summary([], [])

    def _clean_dailies(self) -> dict[str, object]:
        return compare_dailies({"2026-01-01": 0.01}, [{"date": "2026-01-01", "daily_return": 0.01}])

    def test_verdict_clean_and_count_delta_present_when_zero(self) -> None:
        report = build_report(
            api_key_id=API_KEY_ID, exchange="bybit", window=WINDOW,
            fills=self._clean_fills(), funding=self._clean_funding(),
            dailies=self._clean_dailies(),
        )
        assert report["verdict"] == "clean"
        assert report["exit_code"] == 0
        # #563 discipline: the literal count_delta field is present even at zero.
        assert report["fills"]["count_delta"] == 0

    def test_verdict_id_drift_only_maps_to_exit_zero(self) -> None:
        fills = self._clean_fills()
        fills["id_drift_count"] = 3
        report = build_report(
            api_key_id=API_KEY_ID, exchange="bybit", window=WINDOW,
            fills=fills, funding=self._clean_funding(), dailies=self._clean_dailies(),
        )
        assert report["verdict"] == "id_drift_only"
        assert report["exit_code"] == 0

    def test_verdict_discrepancy_on_dailies_breach_maps_to_exit_one(self) -> None:
        dirty_dailies = compare_dailies(
            {"2026-01-01": 0.01}, [{"date": "2026-01-01", "daily_return": 0.02}]
        )
        report = build_report(
            api_key_id=API_KEY_ID, exchange="bybit", window=WINDOW,
            fills=self._clean_fills(), funding=self._clean_funding(), dailies=dirty_dailies,
        )
        assert report["verdict"] == "discrepancy"
        assert report["exit_code"] == 1

    def test_verdict_is_always_one_of_three_strings(self) -> None:
        report = build_report(
            api_key_id=API_KEY_ID, exchange="bybit", window=WINDOW,
            fills=self._clean_fills(), funding=self._clean_funding(),
            dailies=self._clean_dailies(),
        )
        assert report["verdict"] in {"clean", "id_drift_only", "discrepancy"}

    def test_report_is_sanitized(self) -> None:
        fills = self._clean_fills()
        # An injected ccxt-style error URL with an HMAC signature must be scrubbed.
        fills["error"] = "ccxt failure https://api.bybit.com/v5?api_key=AKID9&signature=deadbeefcafe"
        report = build_report(
            api_key_id=API_KEY_ID, exchange="bybit", window=WINDOW,
            fills=fills, funding=self._clean_funding(), dailies=self._clean_dailies(),
        )
        blob = json.dumps(report)
        # No raw signature/secret material survives.
        assert "deadbeefcafe" not in blob
        assert "AKID9" not in blob
        # api_key_id masked to ***last4 — raw UUID absent.
        assert API_KEY_ID not in blob
        assert report["api_key_id"] == "***6666"
