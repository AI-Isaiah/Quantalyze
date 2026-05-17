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
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=[linear_page, inverse_page]
        )

        rows = await fetch_funding_bybit(
            mock_exchange, STRATEGY_ID, since_ms=1699000000000
        )

        assert len(rows) == 2
        assert rows[0]["exchange"] == "bybit"
        assert rows[0]["symbol"] == "BTCUSDT"
        assert rows[0]["amount"] == Decimal("-0.0123")
        assert rows[0]["currency"] == "USDT"
        # One call per category (linear + inverse).
        assert mock_exchange.private_get_v5_account_transaction_log.await_count == 2
        # The first call must request category=linear; the second
        # category=inverse (M-0921).
        first_params = (
            mock_exchange.private_get_v5_account_transaction_log
            .await_args_list[0].args[0]
        )
        second_params = (
            mock_exchange.private_get_v5_account_transaction_log
            .await_args_list[1].args[0]
        )
        assert first_params.get("category") == "linear"
        assert second_params.get("category") == "inverse"

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
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=[page1, page2, inverse_empty]
        )
        rows = await fetch_funding_bybit(mock_exchange, STRATEGY_ID, since_ms=None)
        assert len(rows) == 2
        # 2 linear pages + 1 inverse call = 3
        assert mock_exchange.private_get_v5_account_transaction_log.await_count == 3


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
        import time

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
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=[linear, inverse_empty]
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
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=[linear, inverse_empty]
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
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=[linear, inverse_empty]
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
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=[linear, inverse_empty]
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
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=[linear_empty, inverse]
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
    async def test_raw_data_sanitizes_non_json_values(self) -> None:
        """Decimal/datetime in raw_item must be coerced so a downstream
        json.dumps cannot TypeError-out the whole batch.
        """
        from datetime import datetime, timezone

        custom_dt = datetime(2024, 1, 1, 8, 0, 0, tzinfo=timezone.utc)
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(return_value=[
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "with-decimal",
                # Whitelisted-but-non-JSON values:
                "incomeType": "FUNDING_FEE",  # noqa: F601 (deliberate override)
            },
        ])
        # Inject a Decimal under a whitelisted key by monkeypatching the
        # returned list — the goal is to exercise _sanitize_raw.
        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=None
        )
        import json

        # The serialized row must be JSON-encodable end-to-end.
        from services.funding_fetch import serialize_funding_row

        out = serialize_funding_row(rows[0])
        # If sanitization is correct, json.dumps does not raise.
        encoded = json.dumps(out)
        assert "BTCUSDT" in encoded
        del custom_dt  # silence unused

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
