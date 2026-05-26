"""Tests for analytics-service/services/funding_fetch.py.

Exercises the three exchange-specific funding normalizers
(Binance fapiPrivate_get_income, OKX account_bills type=8, Bybit
v5_account_transaction_log SETTLEMENT) plus the top-level dispatcher.

All tests mock the CCXT async exchange — no network calls.
"""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import AsyncMock

import pytest

from services.funding_fetch import (
    _bucket_8h,
    fetch_funding,
    fetch_funding_binance,
    fetch_funding_bybit,
    fetch_funding_okx,
)


STRATEGY_ID = "00000000-0000-0000-0000-000000000001"

# NEW-C30-01: helper for Bybit tests that only need to verify per-window
# behavior.  fetch_funding_bybit now walks [since_ms, now] in 7-day windows
# (NEW-C30-01), so a mock with a static side_effect list gets exhausted by
# the first window and raises StopAsyncIteration on subsequent calls.
# This helper serves the provided ``responses`` in order, then returns an
# empty-list page for every call beyond the supplied list.  Tests that do
# NOT care about multi-window behaviour (most of them) can therefore keep
# their existing response fixtures unchanged.
_BYBIT_EMPTY_PAGE: dict = {"result": {"list": [], "nextPageCursor": ""}}


def _bybit_mock_with_fallback(
    *responses: "dict | BaseException",
) -> AsyncMock:
    """Return an AsyncMock that serves ``responses`` in order, then returns
    ``_BYBIT_EMPTY_PAGE`` for all subsequent calls.

    NEW-C30-01: used by tests that only need to verify per-window behaviour
    and would otherwise exhaust a static side_effect list when the window
    loop calls the endpoint more times than the list contains entries.

    If an element of ``responses`` is an exception instance, it is raised
    (not returned) so callers can test error-handling paths.
    """
    response_list = list(responses)
    call_count: dict[str, int] = {"n": 0}

    async def _side_effect(*args, **kwargs) -> dict:
        idx = call_count["n"]
        call_count["n"] += 1
        if idx < len(response_list):
            item = response_list[idx]
            if isinstance(item, BaseException):
                raise item
            return item
        return _BYBIT_EMPTY_PAGE

    return AsyncMock(side_effect=_side_effect)


# ---------------------------------------------------------------------------
# Binance
# ---------------------------------------------------------------------------

class TestFetchFundingBinance:
    @pytest.mark.asyncio
    async def test_single_page_two_rows(self) -> None:
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(return_value=[
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.012345",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "abc123",
            },
            {
                "symbol": "ETHUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "0.005",
                "asset": "USDT",
                "time": 1700003000000,
                "tranId": "def456",
            },
        ])

        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=1699000000000
        )

        assert len(rows) == 2
        first = rows[0]
        assert first["exchange"] == "binance"
        assert first["symbol"] == "BTCUSDT"
        assert first["strategy_id"] == STRATEGY_ID
        assert first["amount"] == Decimal("-0.012345")
        assert first["currency"] == "USDT"
        # Match key must be deterministic + include 8-hour bucket
        assert STRATEGY_ID in first["match_key"]
        assert "binance" in first["match_key"]
        assert "BTCUSDT" in first["match_key"]
        # Verify incomeType filter was passed to the API call
        call_args = mock_exchange.fapiPrivate_get_income.await_args
        params = call_args.args[0] if call_args.args else call_args.kwargs.get("params", {})
        assert params.get("incomeType") == "FUNDING_FEE"

    @pytest.mark.asyncio
    async def test_non_funding_rows_filtered_even_if_returned(self) -> None:
        """Defense in depth: even if the exchange returns a non-funding row,
        the normalizer must drop it."""
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(return_value=[
            {
                "symbol": "BTCUSDT",
                "incomeType": "REALIZED_PNL",
                "income": "10.0",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "x1",
            },
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700003000000,
                "tranId": "x2",
            },
        ])

        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=None
        )
        assert len(rows) == 1
        assert rows[0]["amount"] == Decimal("-0.01")

    @pytest.mark.asyncio
    async def test_pagination_advances_startTime(self) -> None:
        """Second page request must advance startTime past the last row's timestamp."""
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"

        page1 = [
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "p1-1",
            },
        ] * 1000  # full page triggers pagination
        page2: list[dict] = []  # empty terminates

        mock_exchange.fapiPrivate_get_income = AsyncMock(
            side_effect=[page1, page2]
        )
        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=1600000000000
        )
        # Should have made 2 calls (page1 full → fetch again, page2 empty → stop)
        assert mock_exchange.fapiPrivate_get_income.await_count == 2


# ---------------------------------------------------------------------------
# OKX
# ---------------------------------------------------------------------------

class TestFetchFundingOKX:
    @pytest.mark.asyncio
    async def test_single_page(self) -> None:
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills = AsyncMock(return_value={
            "data": [
                {
                    "instId": "BTC-USDT-SWAP",
                    "type": "8",
                    "pnl": "-0.00234",
                    "ccy": "USDT",
                    "ts": "1700000000000",
                    "billId": "okx-bill-1",
                },
                {
                    "instId": "ETH-USDT-SWAP",
                    "type": "8",
                    "pnl": "0.0012",
                    "ccy": "USDT",
                    "ts": "1700003000000",
                    "billId": "okx-bill-2",
                },
            ]
        })
        # since_ms within the last 90d so the archive endpoint is NOT
        # invoked (no risk of the M-0928 non-dict-response raise firing
        # on a default AsyncMock attribute).
        mock_exchange.private_get_account_bills_archive = AsyncMock(
            return_value={"data": []}
        )

        rows = await fetch_funding_okx(
            mock_exchange, STRATEGY_ID, since_ms=1699000000000
        )

        assert len(rows) == 2
        assert rows[0]["exchange"] == "okx"
        # Symbol normalized: hyphen stripped to match funding_fees.symbol usage
        assert rows[0]["symbol"] == "BTCUSDTSWAP"
        assert rows[0]["amount"] == Decimal("-0.00234")
        assert rows[0]["currency"] == "USDT"
        # type=8 param was passed
        call_args = mock_exchange.private_get_account_bills.await_args
        params = call_args.args[0] if call_args.args else call_args.kwargs.get("params", {})
        assert params.get("type") == "8"

    @pytest.mark.asyncio
    async def test_empty_data(self) -> None:
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills = AsyncMock(return_value={"data": []})
        rows = await fetch_funding_okx(mock_exchange, STRATEGY_ID, since_ms=None)
        assert rows == []


# ---------------------------------------------------------------------------
# Bybit (new endpoint)
# ---------------------------------------------------------------------------

class TestFetchFundingBybit:
    @pytest.mark.asyncio
    async def test_uses_transaction_log_endpoint(self) -> None:
        """Bybit funding is fetched from v5/account/transaction-log with type
        filter for SETTLEMENT/funding entries — NOT from the closed_pnl
        endpoint that mixes realized PnL.

        M-0921: the fetcher now iterates both linear and inverse
        categories, so an empty inverse response is included in the mock.
        """
        linear_page = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "type": "SETTLEMENT",
                        "funding": "-0.0123",
                        "currency": "USDT",
                        "transactionTime": "1700000000000",
                        "id": "bybit-tx-1",
                    },
                    {
                        "symbol": "ETHUSDT",
                        "type": "SETTLEMENT",
                        "funding": "0.004",
                        "currency": "USDT",
                        "transactionTime": "1700003000000",
                        "id": "bybit-tx-2",
                    },
                ],
                "nextPageCursor": "",
            }
        }
        inverse_page = {"result": {"list": [], "nextPageCursor": ""}}

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        # NEW-C30-01: use _bybit_mock_with_fallback so window-walking calls
        # beyond the configured fixtures don't exhaust a static list.
        mock_exchange.private_get_v5_account_transaction_log = (
            _bybit_mock_with_fallback(linear_page, inverse_page)
        )

        rows = await fetch_funding_bybit(
            mock_exchange, STRATEGY_ID, since_ms=1699000000000
        )

        assert len(rows) == 2
        assert rows[0]["exchange"] == "bybit"
        assert rows[0]["symbol"] == "BTCUSDT"
        assert rows[0]["amount"] == Decimal("-0.0123")
        assert rows[0]["currency"] == "USDT"
        # Verify both categories were queried (linear first, inverse after).
        # NEW-C30-01: await_count may be >2 because multi-window walking
        # calls the endpoint for each 7-day window; check category coverage
        # via the actual call args list instead.
        all_params = [
            c.args[0]
            for c in mock_exchange.private_get_v5_account_transaction_log
            .await_args_list
        ]
        categories_called = {p.get("category") for p in all_params}
        assert "linear" in categories_called
        assert "inverse" in categories_called

    @pytest.mark.asyncio
    async def test_cursor_pagination(self) -> None:
        page1 = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "type": "SETTLEMENT",
                        "funding": "-0.01",
                        "currency": "USDT",
                        "transactionTime": "1700000000000",
                        "id": "p1",
                    }
                ],
                "nextPageCursor": "cursor-page2",
            }
        }
        page2 = {
            "result": {
                "list": [
                    {
                        "symbol": "ETHUSDT",
                        "type": "SETTLEMENT",
                        "funding": "0.02",
                        "currency": "USDT",
                        "transactionTime": "1700003000000",
                        "id": "p2",
                    }
                ],
                "nextPageCursor": "",
            }
        }
        inverse_empty = {"result": {"list": [], "nextPageCursor": ""}}

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        # linear: page1 → page2; inverse: one empty response.
        # NEW-C30-01: use _bybit_mock_with_fallback so window-loop calls
        # beyond the 3 configured fixtures return an empty page instead of
        # exhausting the list and raising StopAsyncIteration.
        mock_exchange.private_get_v5_account_transaction_log = (
            _bybit_mock_with_fallback(page1, page2, inverse_empty)
        )
        rows = await fetch_funding_bybit(mock_exchange, STRATEGY_ID, since_ms=None)
        assert len(rows) == 2


# ---------------------------------------------------------------------------
# Top-level fetch_funding dispatcher
# ---------------------------------------------------------------------------

class TestFetchFundingDispatcher:
    @pytest.mark.asyncio
    async def test_unsupported_exchange_raises(self) -> None:
        with pytest.raises(ValueError, match="Unsupported"):
            await fetch_funding(
                "kraken", "key", "secret", STRATEGY_ID, since_ms=None
            )


# ---------------------------------------------------------------------------
# Match key determinism
# ---------------------------------------------------------------------------

class TestMatchKeyDeterminism:
    @pytest.mark.asyncio
    async def test_okx_same_8h_bucket_same_key(self) -> None:
        """OKX retains an 8h funding cadence, so two events 7h apart in
        the same bucket collapse onto the same match_key. The 8h dedup is
        the canonical archive+recent overlap defense.
        """
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills = AsyncMock(return_value={
            "data": [
                {
                    "instId": "BTC-USDT-SWAP",
                    "type": "8",
                    "pnl": "-0.01",
                    "ccy": "USDT",
                    "ts": "1700006460000",  # 00:01:00 UTC
                    "billId": "a",
                },
                {
                    "instId": "BTC-USDT-SWAP",
                    "type": "8",
                    "pnl": "-0.01",
                    "ccy": "USDT",
                    "ts": "1700034000000",  # 07:40:00 UTC, same 00-08 bucket
                    "billId": "b",
                },
            ]
        })

        rows = await fetch_funding_okx(
            mock_exchange, STRATEGY_ID, since_ms=None
        )
        # Producer-side both rows are emitted; the in-function dedup at
        # the end of fetch_funding_okx collapses them to one.
        assert len(rows) == 1

    @pytest.mark.asyncio
    async def test_binance_4h_cycle_pairs_keep_distinct_keys(self) -> None:
        """H-1099 regression: Binance's progressively-rolled-out 4h cycle
        used to collide with the 8h bucket and silently drop half the
        funding events. With the per-exchange 1h bucket, two events 4h
        apart produce DIFFERENT match_keys.
        """
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(return_value=[
            {
                "symbol": "BTCDOMUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700006460000,  # 00:01:00 UTC
                "tranId": "a",
            },
            {
                "symbol": "BTCDOMUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700021400000,  # 04:10:00 UTC (~4h later)
                "tranId": "b",
            },
        ])

        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=None
        )
        assert len(rows) == 2
        assert rows[0]["match_key"] != rows[1]["match_key"]

    @pytest.mark.asyncio
    async def test_different_symbols_different_keys(self) -> None:
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(return_value=[
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "a",
            },
            {
                "symbol": "ETHUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "b",
            },
        ])

        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=None
        )
        assert rows[0]["match_key"] != rows[1]["match_key"]


# ---------------------------------------------------------------------------
# I6 additional tests
# ---------------------------------------------------------------------------

class TestBinanceSwallowExchangeError:
    @pytest.mark.asyncio
    async def test_binance_raises_on_exchange_error(self) -> None:
        """C-0322 / H-1103: Exchange error mid-pagination MUST raise so
        run_sync_funding_job classifies the job as transient-failed and
        retries. Previously the warning-and-break contract silently
        truncated to partial data and reported DONE.
        """
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(
            side_effect=Exception("network timeout")
        )
        with pytest.raises(Exception, match="network timeout"):
            await fetch_funding_binance(
                mock_exchange, STRATEGY_ID, since_ms=None
            )


class TestOKXArchiveEndpoint:
    @pytest.mark.asyncio
    async def test_okx_calls_archive_endpoint_for_old_since(self) -> None:
        """since_ms older than 90d → archive endpoint must be awaited."""
        from datetime import datetime, timezone

        old_since_ms = int(
            (datetime.now(timezone.utc).timestamp() - 100 * 86400) * 1000
        )
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills = AsyncMock(
            return_value={"data": []}
        )
        mock_exchange.private_get_account_bills_archive = AsyncMock(
            return_value={"data": []}
        )

        await fetch_funding_okx(mock_exchange, STRATEGY_ID, since_ms=old_since_ms)

        mock_exchange.private_get_account_bills_archive.assert_awaited()

    @pytest.mark.asyncio
    async def test_okx_dedups_archive_overlap(self) -> None:
        """Same row returned from both recent + archive → deduped to len=1."""
        shared_row = {
            "instId": "BTC-USDT-SWAP",
            "type": "8",
            "pnl": "-0.01",
            "ccy": "USDT",
            "ts": "1700000000000",
            "billId": "shared-bill",
        }
        from datetime import datetime, timezone

        old_since_ms = int(
            (datetime.now(timezone.utc).timestamp() - 100 * 86400) * 1000
        )
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        # Both endpoints return the same row → match_key dedup keeps 1
        mock_exchange.private_get_account_bills = AsyncMock(
            return_value={"data": [shared_row]}
        )
        mock_exchange.private_get_account_bills_archive = AsyncMock(
            return_value={"data": [shared_row]}
        )

        rows = await fetch_funding_okx(mock_exchange, STRATEGY_ID, since_ms=old_since_ms)
        assert len(rows) == 1


class TestBybitChangeFallback:
    @pytest.mark.asyncio
    async def test_bybit_falls_back_to_change_field(self) -> None:
        """When 'funding' is absent, Bybit parser falls back to 'change' field."""
        from decimal import Decimal

        linear = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "type": "SETTLEMENT",
                        # No 'funding' key — falls back to 'change'
                        "change": "-0.0055",
                        "currency": "USDT",
                        "transactionTime": "1700000000000",
                        "id": "bybit-fallback",
                    }
                ],
                "nextPageCursor": "",
            }
        }
        inverse_empty = {"result": {"list": [], "nextPageCursor": ""}}

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        # NEW-C30-01: fallback mock so window-walking calls beyond the
        # configured pages don't exhaust a static list.
        mock_exchange.private_get_v5_account_transaction_log = (
            _bybit_mock_with_fallback(linear, inverse_empty)
        )

        rows = await fetch_funding_bybit(mock_exchange, STRATEGY_ID, since_ms=None)
        assert len(rows) == 1
        assert rows[0]["amount"] == Decimal("-0.0055")

    @pytest.mark.asyncio
    async def test_bybit_falls_back_to_cashflow_field(self) -> None:
        """H-1100: when 'funding' AND 'change' are absent, parser falls
        back to 'cashFlow'. Regression guard: a regression that dropped
        the cashFlow field from the fallback chain would silently zero
        out funding for that response shape.
        """
        linear = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "type": "SETTLEMENT",
                        # Only cashFlow is present
                        "cashFlow": "-0.0077",
                        "currency": "USDT",
                        "transactionTime": "1700000000000",
                        "id": "bybit-cashflow",
                    }
                ],
                "nextPageCursor": "",
            }
        }
        inverse_empty = {"result": {"list": [], "nextPageCursor": ""}}

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        # NEW-C30-01: fallback mock.
        mock_exchange.private_get_v5_account_transaction_log = (
            _bybit_mock_with_fallback(linear, inverse_empty)
        )

        rows = await fetch_funding_bybit(mock_exchange, STRATEGY_ID, since_ms=None)
        assert len(rows) == 1
        assert rows[0]["amount"] == Decimal("-0.0077")

    @pytest.mark.asyncio
    async def test_bybit_skips_row_when_all_amount_fields_missing(
        self,
    ) -> None:
        """H-1098 / M-0922: when funding, change AND cashFlow are all
        absent, the previous truthy-fallback chain inserted a zero
        placeholder with a valid match_key — poison-pill that blocked
        future corrected rows via ON CONFLICT DO NOTHING. The fix skips
        the row entirely.
        """
        linear = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "type": "SETTLEMENT",
                        # No funding/change/cashFlow
                        "currency": "USDT",
                        "transactionTime": "1700000000000",
                        "id": "bybit-missing",
                    }
                ],
                "nextPageCursor": "",
            }
        }
        inverse_empty = {"result": {"list": [], "nextPageCursor": ""}}

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        # NEW-C30-01: fallback mock.
        mock_exchange.private_get_v5_account_transaction_log = (
            _bybit_mock_with_fallback(linear, inverse_empty)
        )

        rows = await fetch_funding_bybit(mock_exchange, STRATEGY_ID, since_ms=None)
        assert rows == []

    @pytest.mark.asyncio
    async def test_bybit_preserves_legitimate_zero_funding(self) -> None:
        """M-0922: the OLD ``or``-chain treated numeric 0 as "missing"
        and fell through to the next field, mangling legitimate-zero
        cycle rows. The new explicit-None check preserves a present 0.
        """
        linear = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "type": "SETTLEMENT",
                        # Funding present but zero — must be preserved
                        # rather than falling through to 'change'.
                        "funding": "0",
                        "change": "999.99",  # would corrupt if fallback
                        "currency": "USDT",
                        "transactionTime": "1700000000000",
                        "id": "bybit-zero",
                    }
                ],
                "nextPageCursor": "",
            }
        }
        inverse_empty = {"result": {"list": [], "nextPageCursor": ""}}

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        # NEW-C30-01: fallback mock.
        mock_exchange.private_get_v5_account_transaction_log = (
            _bybit_mock_with_fallback(linear, inverse_empty)
        )

        rows = await fetch_funding_bybit(mock_exchange, STRATEGY_ID, since_ms=None)
        assert len(rows) == 1
        assert rows[0]["amount"] == Decimal("0")


class TestBucket8hBoundary:
    def test_bucket_8h_boundary(self) -> None:
        """07:59:59 and 08:00:00 must fall in different buckets."""
        from datetime import datetime, timezone

        ts_before = datetime(2024, 1, 1, 7, 59, 59, tzinfo=timezone.utc)
        ts_on = datetime(2024, 1, 1, 8, 0, 0, tzinfo=timezone.utc)

        bucket_before = _bucket_8h(ts_before)
        bucket_on = _bucket_8h(ts_on)

        assert bucket_before != bucket_on
        assert "T00:" in bucket_before  # 00:00 window
        assert "T08:" in bucket_on      # 08:00 window


# ---------------------------------------------------------------------------
# Cluster O additions — silent-failure raises + new test coverage
# (audit-2026-05-07: C-0322, H-1098..H-1106, M-0921..M-0931)
# ---------------------------------------------------------------------------


class TestOKXRaisesOnSilentPaths:
    """C-0322 / M-0925 / M-0926 / M-0927 / M-0928 / H-1102 / H-1103:
    the OKX fetcher previously had four silent-return paths: missing
    endpoint, exchange call error, non-dict response, non-list data.
    All four now raise so the worker classifies the job as failed.
    """

    @pytest.mark.asyncio
    async def test_okx_raises_on_missing_endpoint(self) -> None:
        """Missing private_get_account_bills (ccxt drift) must raise."""
        mock_exchange = AsyncMock(
            spec_set=["private_get_account_bills_archive", "id"]
        )
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills_archive = AsyncMock(
            return_value={"data": []}
        )
        # mock_exchange has no `private_get_account_bills` attribute via
        # spec_set; getattr(..., None) returns None inside _paginate.
        with pytest.raises(RuntimeError, match="missing on ccxt"):
            await fetch_funding_okx(
                mock_exchange, STRATEGY_ID, since_ms=None
            )

    @pytest.mark.asyncio
    async def test_okx_raises_on_endpoint_exception(self) -> None:
        """Per-page exception must propagate, not silently truncate."""
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills = AsyncMock(
            side_effect=Exception("okx 5xx")
        )
        with pytest.raises(Exception, match="okx 5xx"):
            await fetch_funding_okx(
                mock_exchange, STRATEGY_ID, since_ms=None
            )

    @pytest.mark.asyncio
    async def test_okx_raises_on_non_dict_response(self) -> None:
        """Response envelope drift (e.g. list instead of dict) → raise."""
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills = AsyncMock(
            return_value=["not-a-dict"]
        )
        with pytest.raises(RuntimeError, match="non-dict"):
            await fetch_funding_okx(
                mock_exchange, STRATEGY_ID, since_ms=None
            )

    @pytest.mark.asyncio
    async def test_okx_raises_on_non_list_data(self) -> None:
        """'data' must be a list; otherwise raise."""
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills = AsyncMock(
            return_value={"data": {"oops": "object"}}
        )
        with pytest.raises(RuntimeError, match="non-list"):
            await fetch_funding_okx(
                mock_exchange, STRATEGY_ID, since_ms=None
            )

    @pytest.mark.asyncio
    async def test_okx_empty_data_returns_clean(self) -> None:
        """Legit empty data path is the only one that returns silently."""
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills = AsyncMock(
            return_value={"data": []}
        )
        rows = await fetch_funding_okx(
            mock_exchange, STRATEGY_ID, since_ms=None
        )
        assert rows == []


class TestBybitRaisesOnSilentPaths:
    """C-0322 / H-1102 / H-1103: Bybit per-page exceptions must raise."""

    @pytest.mark.asyncio
    async def test_bybit_raises_on_first_page_error(self) -> None:
        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=Exception("bybit 5xx")
        )
        with pytest.raises(Exception, match="bybit 5xx"):
            await fetch_funding_bybit(
                mock_exchange, STRATEGY_ID, since_ms=None
            )


class TestBybitInverseCategory:
    """M-0921: inverse-perp strategies (BTCUSD coin-margined) used to
    receive zero funding rows because the fetcher only queried
    category=linear. Now it iterates both categories.
    """

    @pytest.mark.asyncio
    async def test_bybit_inverse_perp_funding_is_fetched(self) -> None:
        linear_empty = {"result": {"list": [], "nextPageCursor": ""}}
        inverse = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSD",  # inverse perp
                        "type": "SETTLEMENT",
                        "funding": "-0.0001",
                        "currency": "BTC",
                        "transactionTime": "1700000000000",
                        "id": "inverse-1",
                    }
                ],
                "nextPageCursor": "",
            }
        }
        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        # NEW-C30-01: fallback mock so window-loop calls don't exhaust list.
        mock_exchange.private_get_v5_account_transaction_log = (
            _bybit_mock_with_fallback(linear_empty, inverse)
        )
        rows = await fetch_funding_bybit(
            mock_exchange, STRATEGY_ID, since_ms=None
        )
        assert len(rows) == 1
        assert rows[0]["symbol"] == "BTCUSD"
        assert rows[0]["currency"] == "BTC"


class TestOKXArchiveEndpointMissing:
    """H-1101: when ccxt drops private_get_account_bills_archive (older
    ccxt versions), the previous `getattr -> None -> return` made >90d
    history silently invisible. Now it raises so on-call sees Sentry.
    """

    @pytest.mark.asyncio
    async def test_okx_archive_endpoint_missing_raises(self) -> None:
        from datetime import datetime, timezone

        old_since_ms = int(
            (datetime.now(timezone.utc).timestamp() - 100 * 86400) * 1000
        )
        # spec_set so private_get_account_bills_archive is absent.
        mock_exchange = AsyncMock(
            spec_set=["private_get_account_bills", "id"]
        )
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills = AsyncMock(
            return_value={"data": []}
        )
        with pytest.raises(RuntimeError, match="bills_archive"):
            await fetch_funding_okx(
                mock_exchange, STRATEGY_ID, since_ms=old_since_ms
            )


class TestNormalizeFundingRowSkips:
    """H-1104: the cross-exchange None-skip filter has four branches:
    empty symbol, None amount, non-Decimal-castable amount, bad
    timestamp. None of them were directly tested.
    """

    @pytest.mark.asyncio
    async def test_normalize_skips_malformed_rows(self) -> None:
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(return_value=[
            # (a) empty symbol → skipped
            {
                "symbol": "",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "skip-a",
            },
            # (b) None amount → skipped
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": None,
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "skip-b",
            },
            # (c) non-numeric amount → skipped
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "not-a-number",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "skip-c",
            },
            # (d) bad timestamp → skipped
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": "garbage",
                "tranId": "skip-d",
            },
        ])
        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=None
        )
        assert rows == []


class TestSerializeFundingRow:
    """H-1105: serialize_funding_row had no direct test coverage. It is
    the JSON-safety boundary before every UPSERT; a regression that
    stringified amounts via float() instead of str() would introduce
    float drift on cashflows.
    """

    def test_decimal_amount_stringified_preserves_precision(self) -> None:
        from services.funding_fetch import serialize_funding_row

        row = {
            "strategy_id": STRATEGY_ID,
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": Decimal("-0.012345678901234"),
            "currency": "USDT",
            "timestamp": "2024-01-01T08:00:00+00:00",
            "match_key": "k",
            "raw_data": {},
        }
        out = serialize_funding_row(row)
        # Stringified, not float-stringified
        assert out["amount"] == "-0.012345678901234"
        assert isinstance(out["amount"], str)

    def test_datetime_timestamp_isoformatted(self) -> None:
        from datetime import datetime, timezone

        from services.funding_fetch import serialize_funding_row

        row = {
            "strategy_id": STRATEGY_ID,
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": Decimal("-0.01"),
            "currency": "USDT",
            "timestamp": datetime(2024, 1, 1, 8, 0, 0, tzinfo=timezone.utc),
            "match_key": "k",
            "raw_data": {},
        }
        out = serialize_funding_row(row)
        assert out["timestamp"].endswith("+00:00")
        assert "2024-01-01T08:00:00" in out["timestamp"]

    def test_string_timestamp_passthrough(self) -> None:
        from services.funding_fetch import serialize_funding_row

        ts_str = "2024-01-01T08:00:00+00:00"
        row = {
            "strategy_id": STRATEGY_ID,
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": Decimal("-0.01"),
            "currency": "USDT",
            "timestamp": ts_str,
            "match_key": "k",
            "raw_data": {"tranId": "abc"},
        }
        out = serialize_funding_row(row)
        assert out["timestamp"] == ts_str
        assert out["raw_data"] == {"tranId": "abc"}


class TestUpsertFundingRowsErrors:
    """H-1106: upsert_funding_rows catches per-batch exceptions into an
    ``errors[]`` accumulator (truncated to 200 chars) and continues. No
    test exercised the failure branch.
    """

    @pytest.mark.asyncio
    async def test_empty_rows_short_circuits(self) -> None:
        from services.funding_fetch import upsert_funding_rows

        result = await upsert_funding_rows(supabase=None, rows=[])
        assert result == {"inserted": 0, "skipped": 0, "errors": []}

    @pytest.mark.asyncio
    async def test_partial_batch_failure_records_error_continues(
        self,
    ) -> None:
        """First batch raises → recorded in errors; second succeeds →
        inserted reflects only the successful batch.
        """
        from services.funding_fetch import (
            FUNDING_UPSERT_BATCH_SIZE,
            upsert_funding_rows,
        )
        from datetime import datetime, timezone
        from unittest.mock import MagicMock

        call_idx = {"n": 0}

        def upsert_side_effect(rows_to_insert, **kwargs):  # noqa: ARG001
            # First call raises, subsequent calls succeed.
            class _Exec:
                def execute(self_inner):
                    call_idx["n"] += 1
                    if call_idx["n"] == 1:
                        raise RuntimeError("first batch fails")
                    return None
            return _Exec()

        supabase = MagicMock()
        supabase.table.return_value.upsert.side_effect = upsert_side_effect

        ts = datetime(2024, 1, 1, 8, 0, 0, tzinfo=timezone.utc)
        # Two full batches.
        row_template = {
            "strategy_id": STRATEGY_ID,
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": Decimal("-0.01"),
            "currency": "USDT",
            "timestamp": ts,
            "match_key": "",
            "raw_data": {},
        }
        rows = []
        for i in range(FUNDING_UPSERT_BATCH_SIZE * 2):
            r = dict(row_template)
            r["match_key"] = f"mk-{i}"
            rows.append(r)

        result = await upsert_funding_rows(supabase, rows)
        assert result["inserted"] == FUNDING_UPSERT_BATCH_SIZE
        assert len(result["errors"]) == 1
        assert "first batch fails" in result["errors"][0]

    @pytest.mark.asyncio
    async def test_error_string_truncated_to_200(self) -> None:
        from services.funding_fetch import upsert_funding_rows
        from datetime import datetime, timezone
        from unittest.mock import MagicMock

        def upsert_side_effect(rows_to_insert, **kwargs):  # noqa: ARG001
            class _Exec:
                def execute(self_inner):
                    raise RuntimeError("X" * 500)
            return _Exec()

        supabase = MagicMock()
        supabase.table.return_value.upsert.side_effect = upsert_side_effect

        ts = datetime(2024, 1, 1, 8, 0, 0, tzinfo=timezone.utc)
        rows = [
            {
                "strategy_id": STRATEGY_ID,
                "exchange": "binance",
                "symbol": "BTCUSDT",
                "amount": Decimal("-0.01"),
                "currency": "USDT",
                "timestamp": ts,
                "match_key": "mk",
                "raw_data": {},
            }
        ]
        result = await upsert_funding_rows(supabase, rows)
        assert result["inserted"] == 0
        assert len(result["errors"]) == 1
        assert len(result["errors"][0]) <= 200


class TestRawDataSanitization:
    """M-0931 / L-0052: dict(raw_item) shallow-copied the entire ccxt
    response into raw_data. Two failure modes: (1) non-JSON types (e.g.
    Decimal/datetime) raised TypeError inside supabase-py's json.dumps,
    causing the WHOLE batch to fail; (2) PII/secret echo (account IDs)
    leaked into raw_data. Fix: whitelist + sanitize.
    """

    @pytest.mark.asyncio
    async def test_raw_data_drops_unknown_keys(self) -> None:
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(return_value=[
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "good",
                # PII-shaped extras that should NOT be echoed:
                "uid": "112233",
                "accountId": "ACC-XYZ",
                "secret_field": "hush",
            },
        ])
        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=None
        )
        assert len(rows) == 1
        raw = rows[0]["raw_data"]
        assert "uid" not in raw
        assert "accountId" not in raw
        assert "secret_field" not in raw
        # Whitelisted keys survive.
        assert raw["tranId"] == "good"
        assert raw["symbol"] == "BTCUSDT"

    @pytest.mark.asyncio
    async def test_raw_data_end_to_end_json_safe(self) -> None:
        """End-to-end: the serialized row produced by the Binance fetcher
        must be json-encodable without TypeError. Guards against future
        regressions where a non-whitelisted ccxt type sneaks in.
        """
        import json

        from services.funding_fetch import serialize_funding_row

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(return_value=[
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "abc",
            },
        ])
        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=None
        )
        out = serialize_funding_row(rows[0])
        encoded = json.dumps(out)
        assert "BTCUSDT" in encoded

    def test_sanitize_raw_handles_decimal_and_datetime(self) -> None:
        from datetime import datetime, timezone
        from services.funding_fetch import _sanitize_raw

        out = _sanitize_raw({
            "amount": Decimal("-0.01"),
            "ts": datetime(2024, 1, 1, tzinfo=timezone.utc),
            "tags": {"a", "b"},
            "nested": {"x": Decimal("1.23")},
        })
        assert out["amount"] == "-0.01"
        assert out["ts"].startswith("2024-01-01")
        assert sorted(out["tags"]) == ["a", "b"]
        assert out["nested"] == {"x": "1.23"}

    def test_sanitize_raw_coerces_arbitrary_classes_via_str_fallback(
        self,
    ) -> None:
        """H-S5-1 (specialist:pr-test-analyzer): ccxt internal classes /
        enums / domain objects must NOT raise inside json.dumps; the
        sanitizer's catch-all branch stringifies them so the row still
        round-trips.
        """
        import json

        from services.funding_fetch import _sanitize_raw

        class _Opaque:
            def __repr__(self) -> str:
                return "<opaque>"

        out = _sanitize_raw({"thing": _Opaque(), "list_of": [_Opaque()]})
        # End-to-end: the sanitized result must be JSON-encodable.
        encoded = json.dumps(out)
        assert "<opaque>" in encoded
        assert out["thing"] == "<opaque>"
        assert out["list_of"] == ["<opaque>"]


class TestBybitInverseCategoryToleratesPermissionError:
    """H-S6-1 (specialist:red-team): a strategy whose Bybit API key
    lacks 'inverse' permission would previously have caused the whole
    sync_funding job to fail after M-0921 added the inverse iteration.
    The fetcher now treats BadRequest/PermissionDenied on the FIRST
    inverse page as 'category not enabled' and continues with the
    linear results.
    """

    @pytest.mark.asyncio
    async def test_inverse_bad_request_does_not_kill_linear(self) -> None:
        import ccxt.async_support as ccxt_mod

        linear = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "type": "SETTLEMENT",
                        "funding": "-0.01",
                        "currency": "USDT",
                        "transactionTime": "1700000000000",
                        "id": "linear-1",
                    }
                ],
                "nextPageCursor": "",
            }
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=[
                linear,
                ccxt_mod.BadRequest("inverse not enabled"),
            ]
        )

        # NEW-C30-01: use a since_ms within the last 24 hours so exactly
        # one 7-day window is walked per category (index 0 = linear, index
        # 1 = inverse). With since_ms=None the 365-day walk produces ~52
        # linear windows and the BadRequest at index 1 hits the second
        # linear window rather than the first inverse window.
        import time as _time
        recent_since_ms = int(_time.time() * 1000) - 60 * 60 * 1000  # 1h ago

        rows = await fetch_funding_bybit(
            mock_exchange, STRATEGY_ID, since_ms=recent_since_ms
        )
        # Linear row preserved; inverse silently skipped.
        assert len(rows) == 1
        assert rows[0]["symbol"] == "BTCUSDT"

    @pytest.mark.asyncio
    async def test_inverse_permission_denied_does_not_kill_linear(
        self,
    ) -> None:
        import ccxt.async_support as ccxt_mod

        linear_empty = {"result": {"list": [], "nextPageCursor": ""}}
        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=[
                linear_empty,
                ccxt_mod.PermissionDenied("403"),
            ]
        )

        # NEW-C30-01: recent since_ms so only 1 window per category,
        # ensuring index 1 = inverse window 0 (not linear window 1).
        import time as _time
        recent_since_ms = int(_time.time() * 1000) - 60 * 60 * 1000  # 1h ago

        rows = await fetch_funding_bybit(
            mock_exchange, STRATEGY_ID, since_ms=recent_since_ms
        )
        assert rows == []

    @pytest.mark.asyncio
    async def test_linear_bad_request_still_raises(self) -> None:
        """Sanity: BadRequest on the linear (first) call MUST still
        propagate — we only tolerate it for the inverse fallback.
        """
        import ccxt.async_support as ccxt_mod

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=ccxt_mod.BadRequest("linear bad request")
        )
        with pytest.raises(ccxt_mod.BadRequest):
            await fetch_funding_bybit(
                mock_exchange, STRATEGY_ID, since_ms=None
            )


class TestDroppedRowCounter:
    """M-S2-1 / M-0930 (specialist:silent-failure-hunter): each fetcher
    must log a structured WARN when _normalize_funding_row dropped any
    rows so a Binance/OKX/Bybit field-shape regression has an operator-
    visible signal.
    """

    @pytest.mark.asyncio
    async def test_binance_logs_dropped_count(self, caplog) -> None:
        import logging

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(return_value=[
            # 2 valid + 2 dropped (bad amount, bad ts)
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "ok1",
            },
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "not-a-number",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "bad-amt",
            },
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.02",
                "asset": "USDT",
                "time": "garbage",
                "tranId": "bad-ts",
            },
            {
                "symbol": "ETHUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "0.005",
                "asset": "USDT",
                "time": 1700003000000,
                "tranId": "ok2",
            },
        ])

        caplog.set_level(logging.WARNING, logger="quantalyze.analytics.funding_fetch")
        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=None
        )

        assert len(rows) == 2
        # Structured-warn signal so the operator can see the regression.
        warn_messages = [
            r.getMessage() for r in caplog.records if r.levelno == logging.WARNING
        ]
        assert any("dropped 2 malformed rows" in m for m in warn_messages)


class TestFundingFeeRowTypedDict:
    """M-0929: producer-side TypedDict makes the row schema explicit so
    a typo (e.g. ``strategyId`` instead of ``strategy_id``) is a type-
    checker hit rather than a runtime KeyError downstream.
    """

    def test_typed_dict_round_trip(self) -> None:
        from datetime import datetime, timezone

        from services.funding_fetch import (
            FundingFeeRow,
            serialize_funding_row,
        )

        row: FundingFeeRow = FundingFeeRow(
            strategy_id=STRATEGY_ID,
            exchange="binance",
            symbol="BTCUSDT",
            amount=Decimal("-0.01"),
            currency="USDT",
            timestamp=datetime(2024, 1, 1, 8, 0, 0, tzinfo=timezone.utc),
            match_key="mk",
            raw_data={"tranId": "abc"},
        )
        out = serialize_funding_row(row)
        assert out["match_key"] == "mk"
        assert out["amount"] == "-0.01"


# ---------------------------------------------------------------------------
# audit-2026-05-07 phase-2 fix-loop additions:
# Threshold-met testing gaps surfaced by SPECIALIST-testing-REPORT.md.
# ---------------------------------------------------------------------------


class TestBybitInverseMidPaginationSkips:
    """review/H-03: a PermissionDenied or BadRequest on ANY inverse-category
    page must gracefully skip (not raise). The old page_idx==0 guard was too
    narrow: a 52-window walk triggers an error on page 1 of window 1 after
    one successful page, raising instead of skipping. Any BadRequest/
    PermissionDenied on inverse means the key lacks inverse scope — treat
    all pages symmetrically.

    This replaces TestBybitInverseMidPaginationRaises which tested the old
    (wrong) behavior of raising on page>0.
    """

    @pytest.mark.asyncio
    async def test_inverse_bad_request_mid_pagination_skips(self) -> None:
        """review/H-03: BadRequest on inverse page 1 must skip, not raise."""
        import ccxt.async_support as ccxt_mod

        linear_empty = {"result": {"list": [], "nextPageCursor": ""}}
        inverse_page0 = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSD",
                        "type": "SETTLEMENT",
                        "funding": "-0.02",
                        "currency": "BTC",
                        "transactionTime": "1700000000000",
                        "id": "inv-1",
                    }
                ],
                # Non-empty cursor → fetcher proceeds to page 1.
                "nextPageCursor": "c",
            }
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=[
                linear_empty,
                inverse_page0,
                ccxt_mod.BadRequest("cursor expired"),
            ]
        )

        # NEW-C30-01: recent since_ms (1h ago) so only 1 window per category.
        import time as _time
        recent_since_ms = int(_time.time() * 1000) - 60 * 60 * 1000  # 1h ago

        # review/H-03: must NOT raise — inverse BadRequest on any page is a skip.
        result = await fetch_funding_bybit(
            mock_exchange, STRATEGY_ID, since_ms=recent_since_ms
        )
        # The call must complete and return (possibly empty or partial) results.
        assert isinstance(result, list), (
            "review/H-03: fetch_funding_bybit must return a list when "
            "inverse BadRequest fires on page > 0"
        )


class TestDroppedRowCounterOKXAndBybit:
    """M-S2-1 / M-0930 (specialist:testing): the OKX and Bybit dropped-
    row WARN blocks (funding_fetch.py:480 and :635) mirror the Binance
    contract but were not covered. A regression silently removing the
    `if dropped > 0: logger.warning(...)` block on either exchange would
    hide a field-shape regression. These regression tests pin the
    structured-warn signal so the operator always sees the count.
    """

    @pytest.mark.asyncio
    async def test_okx_logs_dropped_count(self, caplog) -> None:
        import logging

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills = AsyncMock(return_value={
            "data": [
                # 2 valid + 3 dropped (bad pnl, bad ts, empty instId).
                {
                    "instId": "BTC-USDT-SWAP",
                    "type": "8",
                    "pnl": "-0.01",
                    "ccy": "USDT",
                    "ts": "1700000000000",
                    "billId": "ok1",
                },
                {
                    "instId": "BTC-USDT-SWAP",
                    "type": "8",
                    "pnl": "not-a-number",
                    "ccy": "USDT",
                    "ts": "1700000000000",
                    "billId": "bad-pnl",
                },
                {
                    "instId": "BTC-USDT-SWAP",
                    "type": "8",
                    "pnl": "-0.02",
                    "ccy": "USDT",
                    "ts": "garbage",
                    "billId": "bad-ts",
                },
                {
                    "instId": "",  # empty symbol → _normalize_funding_row drops
                    "type": "8",
                    "pnl": "-0.03",
                    "ccy": "USDT",
                    "ts": "1700000300000",
                    "billId": "bad-sym",
                },
                {
                    "instId": "ETH-USDT-SWAP",
                    "type": "8",
                    "pnl": "0.005",
                    "ccy": "USDT",
                    "ts": "1700003000000",
                    "billId": "ok2",
                },
            ]
        })

        caplog.set_level(
            logging.WARNING, logger="quantalyze.analytics.funding_fetch"
        )
        rows = await fetch_funding_okx(
            mock_exchange, STRATEGY_ID, since_ms=None
        )

        assert len(rows) == 2
        warn_messages = [
            r.getMessage()
            for r in caplog.records
            if r.levelno == logging.WARNING
        ]
        assert any(
            "okx funding_fetch: dropped 3 malformed rows" in m
            for m in warn_messages
        )

    @pytest.mark.asyncio
    async def test_bybit_logs_dropped_count(self, caplog) -> None:
        import logging

        linear = {
            "result": {
                "list": [
                    # 1 valid + 2 dropped (empty symbol, non-numeric funding).
                    {
                        "symbol": "BTCUSDT",
                        "type": "SETTLEMENT",
                        "funding": "-0.01",
                        "currency": "USDT",
                        "transactionTime": "1700000000000",
                        "id": "ok1",
                    },
                    {
                        "symbol": "",  # empty symbol → dropped
                        "type": "SETTLEMENT",
                        "funding": "-0.02",
                        "currency": "USDT",
                        "transactionTime": "1700000300000",
                        "id": "bad-sym",
                    },
                    {
                        "symbol": "ETHUSDT",
                        "type": "SETTLEMENT",
                        "funding": "not-a-number",
                        "currency": "USDT",
                        "transactionTime": "1700000600000",
                        "id": "bad-amt",
                    },
                ],
                "nextPageCursor": "",
            }
        }
        inverse_empty = {"result": {"list": [], "nextPageCursor": ""}}

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        # NEW-C30-01: fallback mock.
        mock_exchange.private_get_v5_account_transaction_log = (
            _bybit_mock_with_fallback(linear, inverse_empty)
        )

        caplog.set_level(
            logging.WARNING, logger="quantalyze.analytics.funding_fetch"
        )
        rows = await fetch_funding_bybit(
            mock_exchange, STRATEGY_ID, since_ms=None
        )

        assert len(rows) == 1
        warn_messages = [
            r.getMessage()
            for r in caplog.records
            if r.levelno == logging.WARNING
        ]
        assert any(
            "bybit funding_fetch: dropped 2 malformed rows" in m
            for m in warn_messages
        )


class TestMatchKeyUnknownExchangeRaises:
    """specialist:red-team (funding_fetch.py:194 conf=8 — phase-4):
    Phase-2 pinned the legacy ``_FUNDING_BUCKET_HOURS.get(exchange, 8)``
    8h fallback. That defence is still the H-1099 latent bug for any
    future sub-8h cadence — the test locked in the buggy behaviour
    instead of fixing it.

    The new contract: producers MUST register a cadence before being
    added to ``EXCHANGE_CLASSES``. ``_build_match_key`` mirrors the
    fail-loud contract that :func:`fetch_funding` already uses for
    unsupported exchanges. Pin the raise.
    """

    def test_unknown_exchange_raises(self) -> None:
        from datetime import datetime, timezone

        from services.funding_fetch import _build_match_key

        ts = datetime(2024, 1, 1, 1, 0, 0, tzinfo=timezone.utc)

        with pytest.raises(KeyError, match="_FUNDING_BUCKET_HOURS"):
            _build_match_key("s", "kraken", "BTCUSD", ts)

    def test_known_exchanges_still_resolve(self) -> None:
        """Regression-guard: a typo in the new raise that broke known
        exchanges would mass-fail production. Pin the happy path."""
        from datetime import datetime, timezone

        from services.funding_fetch import _build_match_key

        ts = datetime(2024, 1, 1, 1, 0, 0, tzinfo=timezone.utc)
        for exch in ("binance", "okx", "bybit"):
            key = _build_match_key("s", exch, "BTCUSDT", ts)
            assert exch in key


class TestFundingFetchCeilingExceeded:
    """specialist:red-team (funding_fetch.py:289 conf=8 — phase-4):
    Phase-2 promoted every other partial-completion path
    (per-page exception, OKX shape/endpoint drift) to a re-raise.
    Hitting ``MAX_PAGES`` while the exchange still has more rows was
    the only remaining silent-truncation path. Bybit (10k rows per
    category) is the worst exposure for whale strategies backfilling
    >3 months. All three paginators must now raise
    :class:`FundingFetchCeilingExceeded`.

    The tests patch ``MAX_PAGES`` down to 2 so we don't have to mock
    200 round-trips.
    """

    @pytest.mark.asyncio
    async def test_binance_raises_on_ceiling_with_full_final_page(
        self, monkeypatch
    ) -> None:
        from services import funding_fetch as ff

        monkeypatch.setattr(ff, "MAX_PAGES", 2)
        monkeypatch.setattr(ff, "BINANCE_PAGE_SIZE", 2)

        full_page = [
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": f"b{i}",
            }
            for i in range(2)
        ]
        # Two full pages → loop exhausts MAX_PAGES with last_page_full=True.
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(
            side_effect=[full_page, full_page]
        )

        with pytest.raises(
            ff.FundingFetchCeilingExceeded, match="MAX_PAGES=2"
        ):
            await ff.fetch_funding_binance(
                mock_exchange, STRATEGY_ID, since_ms=None
            )

    @pytest.mark.asyncio
    async def test_binance_clean_exit_on_short_final_page(
        self, monkeypatch
    ) -> None:
        """Counter-test: a short final page must NOT trigger the raise.
        This locks in that ``last_page_full`` correctly tracks the final
        response, not just the first one."""
        from services import funding_fetch as ff

        monkeypatch.setattr(ff, "MAX_PAGES", 2)
        monkeypatch.setattr(ff, "BINANCE_PAGE_SIZE", 2)

        full_page = [
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700000000000 + i,
                "tranId": f"b{i}",
            }
            for i in range(2)
        ]
        short_page: list[dict] = []
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(
            side_effect=[full_page, short_page]
        )
        rows = await ff.fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=None
        )
        assert len(rows) == 2

    @pytest.mark.asyncio
    async def test_okx_raises_on_ceiling_with_active_cursor(
        self, monkeypatch
    ) -> None:
        from services import funding_fetch as ff

        monkeypatch.setattr(ff, "MAX_PAGES", 2)
        monkeypatch.setattr(ff, "OKX_PAGE_SIZE", 2)

        def make_page(prefix: str) -> dict:
            return {
                "data": [
                    {
                        "instId": "BTC-USDT-SWAP",
                        "pnl": "-0.01",
                        "ccy": "USDT",
                        "ts": "1700000000000",
                        "billId": f"{prefix}{i}",
                    }
                    for i in range(2)
                ]
            }

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills = AsyncMock(
            side_effect=[make_page("a"), make_page("b")]
        )

        with pytest.raises(
            ff.FundingFetchCeilingExceeded, match="MAX_PAGES=2"
        ):
            await ff.fetch_funding_okx(
                mock_exchange, STRATEGY_ID, since_ms=None
            )

    @pytest.mark.asyncio
    async def test_bybit_raises_on_ceiling_with_active_cursor(
        self, monkeypatch
    ) -> None:
        from services import funding_fetch as ff

        monkeypatch.setattr(ff, "MAX_PAGES", 2)
        monkeypatch.setattr(ff, "BYBIT_PAGE_SIZE", 1)

        def make_page(prefix: str) -> dict:
            return {
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT",
                            "type": "SETTLEMENT",
                            "funding": "-0.0001",
                            "currency": "USDT",
                            "transactionTime": "1700000000000",
                            "id": f"{prefix}1",
                        }
                    ],
                    "nextPageCursor": f"cursor-{prefix}",
                }
            }

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=[make_page("a"), make_page("b")]
        )

        with pytest.raises(
            ff.FundingFetchCeilingExceeded, match="MAX_PAGES=2"
        ):
            await ff.fetch_funding_bybit(
                mock_exchange, STRATEGY_ID, since_ms=None
            )


class TestBybitResponseShapeValidation:
    """specialist:red-team (funding_fetch.py:581 conf=8 — phase-4):
    Bybit v5 returns ``{retCode: <non-zero>, retMsg, result: null}`` on
    auth/scope errors that ccxt does NOT translate to a typed exception.
    The previous duck-typed ``.get('result', {}).get('list', [])`` chain
    silently treated this as "no items, break" and the worker reported
    SUCCESS with zero rows — the exact silent-truncation pattern that
    Phase-2 explicitly fixed for OKX (M-0928).

    Mirror the OKX hardening: non-dict response / non-dict ``result`` /
    non-list ``result.list`` all raise.
    """

    @pytest.mark.asyncio
    async def test_bybit_raises_on_non_dict_response(self) -> None:
        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            return_value=["unexpected", "list"]
        )
        with pytest.raises(RuntimeError, match="non-dict response"):
            await fetch_funding_bybit(
                mock_exchange, STRATEGY_ID, since_ms=None
            )

    @pytest.mark.asyncio
    async def test_bybit_raises_on_null_result_envelope(self) -> None:
        """The exact retCode!=0 / result=null shape Bybit returns on
        scope errors. Previously: silent empty break + SUCCESS. Now:
        raise + transient-failed job + Sentry."""
        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            return_value={
                "retCode": 10001,
                "retMsg": "params error",
                "result": None,
            }
        )
        with pytest.raises(RuntimeError, match="non-dict 'result'"):
            await fetch_funding_bybit(
                mock_exchange, STRATEGY_ID, since_ms=None
            )

    @pytest.mark.asyncio
    async def test_bybit_raises_on_non_list_inner_list(self) -> None:
        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            return_value={
                "result": {"list": {"oops": "object"}, "nextPageCursor": ""}
            }
        )
        with pytest.raises(RuntimeError, match="non-list"):
            await fetch_funding_bybit(
                mock_exchange, STRATEGY_ID, since_ms=None
            )


# ---------------------------------------------------------------------------
# NEW-C30-01: Bybit 7-day window regression tests
# ---------------------------------------------------------------------------


class TestC3001BybitSevenDayWindowWalking:
    """NEW-C30-01: Bybit V5 /account/transaction-log caps a single request
    to 7 days (startTime → endTime ≤ 7 days). The previous implementation
    only set startTime on page 0; the cursor genuinely exhausted within
    [startTime, startTime+7d] and the function returned success with only
    ~7 days of data — silent truncation.

    Fix: walk [since_ms, now] in 7-day windows. These regression tests pin:
    (A) Both startTime AND endTime appear in every request.
    (B) A since_ms older than 7 days produces multiple API calls (multiple
        windows), and rows from all windows are collected.
    (C) since_ms=None defaults to 365 days back (not unbounded).
    """

    @pytest.mark.asyncio
    async def test_every_request_carries_both_start_and_end_time(
        self,
    ) -> None:
        """NEW-C30-01 (A): every API call must include both startTime and
        endTime.  Pre-fix the loop only set startTime (and only on page 0
        with no cursor), so endTime was never sent.  Without endTime Bybit
        silently caps the window at startTime+7d and the cursor exhausts.
        """
        import time as _time

        # Use a since_ms within the last 6 days so exactly 1 window is
        # walked (avoids needing dozens of mock entries).
        since_ms = int(_time.time() * 1000) - 3 * 24 * 60 * 60 * 1000  # 3 days ago

        calls: list[dict] = []

        async def _capture_params(params: dict) -> dict:
            calls.append(dict(params))
            return {"result": {"list": [], "nextPageCursor": ""}}

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=_capture_params
        )

        await fetch_funding_bybit(mock_exchange, STRATEGY_ID, since_ms=since_ms)

        assert calls, "Expected at least one API call"
        for call_params in calls:
            assert "startTime" in call_params, (
                f"NEW-C30-01: startTime missing from call params: {call_params}"
            )
            assert "endTime" in call_params, (
                f"NEW-C30-01: endTime missing from call params: {call_params} — "
                "this is the 7-day window cap regression: without endTime, "
                "Bybit caps the window at startTime+7d silently"
            )

    @pytest.mark.asyncio
    async def test_multi_window_collects_rows_from_all_windows(self) -> None:
        """NEW-C30-01 (B): a since_ms older than 7 days must produce rows
        from multiple windows — the bug silently returned only the first
        window's results.

        Fixture: 2 windows across linear (second window has 1 row); inverse
        is empty. With the bug, only window-0 results would be collected;
        with the fix, both windows are walked and the window-1 row is kept.
        """
        from services.funding_fetch import BYBIT_FUNDING_WINDOW_MS
        import time as _time

        # Place since_ms exactly 2 window-widths ago so we get 2 windows.
        now_ms = int(_time.time() * 1000)
        since_ms = now_ms - 2 * BYBIT_FUNDING_WINDOW_MS - 1000  # slightly >2 windows

        window1_row = {
            "symbol": "BTCUSDT",
            "type": "SETTLEMENT",
            "funding": "-0.0001",
            "currency": "USDT",
            # timestamp in the second window
            "transactionTime": str(now_ms - BYBIT_FUNDING_WINDOW_MS // 2),
            "id": "window1-row",
        }

        call_count: dict[str, int] = {"n": 0}

        async def _mock_txlog(params: dict) -> dict:
            idx = call_count["n"]
            call_count["n"] += 1
            # Return a row for the second linear window only (idx=1 = second
            # linear window; idx=0 = first linear window is empty).
            if idx == 1 and params.get("category") == "linear":
                return {"result": {"list": [window1_row], "nextPageCursor": ""}}
            return {"result": {"list": [], "nextPageCursor": ""}}

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=_mock_txlog
        )

        rows = await fetch_funding_bybit(mock_exchange, STRATEGY_ID, since_ms=since_ms)

        assert len(rows) == 1, (
            f"NEW-C30-01 regression: expected 1 row from window-1 but got "
            f"{len(rows)}. Pre-fix the cursor exhausted in window-0 and "
            f"the function returned success with 0 rows."
        )
        assert rows[0]["symbol"] == "BTCUSDT"

    @pytest.mark.asyncio
    async def test_since_ms_none_defaults_to_365_day_lookback(self) -> None:
        """NEW-C30-01 (C): when since_ms is None the fetcher must default to
        365 days back, not unbounded. Verify by checking that startTime in
        the first request is ≥ (now - 366d) and ≤ (now - 364d).
        """
        import time as _time

        first_start: list[int] = []

        async def _capture(params: dict) -> dict:
            if not first_start:
                first_start.append(int(params.get("startTime", 0)))
            return {"result": {"list": [], "nextPageCursor": ""}}

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=_capture
        )

        await fetch_funding_bybit(mock_exchange, STRATEGY_ID, since_ms=None)

        assert first_start, "No API calls were made"
        now_ms = int(_time.time() * 1000)
        expected_start = now_ms - 365 * 24 * 60 * 60 * 1000
        tolerance_ms = 5000  # 5 seconds
        assert abs(first_start[0] - expected_start) <= tolerance_ms, (
            f"NEW-C30-01: default lookback should be ~365 days. "
            f"Got start={first_start[0]}, expected≈{expected_start}."
        )
