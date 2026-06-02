"""Tests for analytics-service/services/job_worker.py::run_sync_funding_job.

Audit C-0317 / M-0955 (batch G14) flagged that the per-strategy funding
handler had ZERO direct tests. The five branches that needed coverage:

  (a) Unsupported exchange (kraken/etc.) -> FAILED permanent, no upsert.
  (b) ccxt.RateLimitExceeded -> _stamp_429 is called and the exception
      re-raises so the dispatch loop classifies and retries.
  (c) Empty fetch result -> DONE with no upsert.
  (d) Happy path with rows -> upsert_funding_rows is called, DONE.
  (e) H-1115 — upsert_funding_rows returns errors -> FAILED transient
      (the queue retries instead of silently DONE-ing with partial inserts).
  (f) ctx.exchange.close() is awaited in finally even on raise.

All tests mock _exchange_preflight, the funding_fetch helpers, and
_stamp_429 — no Supabase, no ccxt network I/O, no real key decryption.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import ccxt
import pytest

from services.job_worker import (
    DispatchOutcome,
    DispatchResult,
    run_sync_funding_job,
)


def _build_mock_ctx(exchange_name: str = "binance") -> MagicMock:
    """Return a mock _ExchangeContext with the bits run_sync_funding_job reads."""
    mock_exchange = AsyncMock()
    mock_exchange.close = AsyncMock()

    ctx = MagicMock()
    ctx.exchange = mock_exchange
    ctx.supabase = MagicMock()
    ctx.strategy_row = {"id": "strat-1", "user_id": "user-1"}
    ctx.key_row = {
        "id": "key-1",
        "exchange": exchange_name,
        "last_sync_at": None,
        "user_id": "user-1",
    }
    return ctx


class TestRunSyncFundingJob:
    """run_sync_funding_job — per-strategy funding sync handler.

    The handler is the per-strategy entrypoint invoked by the
    cron-enqueued sync_funding compute jobs. Five branches matter:
    unsupported-exchange route to FAILED+permanent; 429 stamps the
    circuit breaker; empty rows route to DONE; happy path persists; and
    H-1115 the upsert-errors branch surfaces transient failure instead
    of silently DONE-ing with partial inserts.
    """

    @pytest.mark.asyncio
    async def test_unsupported_exchange_returns_failed_permanent(self) -> None:
        """C-0317 (a): kraken/anything-not-binance/okx/bybit returns
        FAILED permanent and never calls upsert."""
        ctx = _build_mock_ctx(exchange_name="kraken")
        mock_upsert = AsyncMock(return_value={"inserted": 0, "skipped": 0, "errors": []})

        job = {"id": "job-funding-kraken", "kind": "sync_funding", "strategy_id": "strat-1"}

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=ctx),
        ), patch(
            "services.funding_fetch.upsert_funding_rows",
            new=mock_upsert,
        ):
            result = await run_sync_funding_job(job)

        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent"
        assert "kraken" in (result.error_message or "")
        mock_upsert.assert_not_awaited()
        ctx.exchange.close.assert_awaited()  # (f) cleanup still runs

    @pytest.mark.asyncio
    async def test_rate_limit_exceeded_stamps_429_and_reraises(self) -> None:
        """C-0317 (b) / M-0955: when fetch_funding_binance raises
        ccxt.RateLimitExceeded, _stamp_429 must be awaited BEFORE the
        exception re-raises so the per-key circuit breaker stops the
        next cron tick from re-enqueuing immediately."""
        ctx = _build_mock_ctx(exchange_name="binance")
        mock_stamp_429 = AsyncMock()
        rate_limit_exc = ccxt.RateLimitExceeded("429")
        mock_fetch = AsyncMock(side_effect=rate_limit_exc)

        job = {"id": "job-funding-429", "kind": "sync_funding", "strategy_id": "strat-1"}

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=ctx),
        ), patch(
            "services.job_worker._stamp_429",
            new=mock_stamp_429,
        ), patch(
            "services.funding_fetch.fetch_funding_binance",
            new=mock_fetch,
        ):
            with pytest.raises(ccxt.RateLimitExceeded):
                await run_sync_funding_job(job)

        # _stamp_429 must run before the re-raise, and the raising exception
        # must be threaded through (it drives the geo-block skip in _stamp_429).
        mock_stamp_429.assert_awaited_once_with(ctx.supabase, ctx.key_row, rate_limit_exc)
        ctx.exchange.close.assert_awaited()  # (f) finally still closes

    @pytest.mark.asyncio
    async def test_empty_rows_returns_done_with_no_upsert(self) -> None:
        """C-0317 (c): when the exchange has no funding rows in the
        window, return DONE and never call upsert_funding_rows."""
        ctx = _build_mock_ctx(exchange_name="okx")
        mock_upsert = AsyncMock(
            return_value={"inserted": 0, "skipped": 0, "errors": []}
        )
        mock_fetch = AsyncMock(return_value=[])

        job = {"id": "job-funding-empty", "kind": "sync_funding", "strategy_id": "strat-1"}

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=ctx),
        ), patch(
            "services.funding_fetch.fetch_funding_okx",
            new=mock_fetch,
        ), patch(
            "services.funding_fetch.upsert_funding_rows",
            new=mock_upsert,
        ):
            result = await run_sync_funding_job(job)

        assert result.outcome == DispatchOutcome.DONE
        assert result.error_kind is None
        mock_upsert.assert_not_awaited()
        ctx.exchange.close.assert_awaited()

    @pytest.mark.asyncio
    async def test_happy_path_calls_upsert_with_rows(self) -> None:
        """C-0317 (d): non-empty fetch -> upsert_funding_rows is called
        with the rows and the result is DONE."""
        ctx = _build_mock_ctx(exchange_name="bybit")
        funding_rows = [
            {"strategy_id": "strat-1", "match_key": "k1", "amount": "0.01"},
            {"strategy_id": "strat-1", "match_key": "k2", "amount": "0.02"},
        ]
        mock_fetch = AsyncMock(return_value=funding_rows)
        mock_upsert = AsyncMock(
            return_value={"inserted": len(funding_rows), "skipped": 0, "errors": []}
        )

        job = {"id": "job-funding-ok", "kind": "sync_funding", "strategy_id": "strat-1"}

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=ctx),
        ), patch(
            "services.funding_fetch.fetch_funding_bybit",
            new=mock_fetch,
        ), patch(
            "services.funding_fetch.upsert_funding_rows",
            new=mock_upsert,
        ):
            result = await run_sync_funding_job(job)

        assert result.outcome == DispatchOutcome.DONE
        assert result.error_kind is None
        mock_upsert.assert_awaited_once()
        # Verify the second positional arg to upsert_funding_rows is the rows list.
        call_args = mock_upsert.await_args
        assert call_args.args[1] == funding_rows
        ctx.exchange.close.assert_awaited()

    @pytest.mark.asyncio
    async def test_upsert_errors_routes_to_failed_transient(self) -> None:
        """H-1115: upsert_funding_rows catches per-batch failures into a
        `errors` list and returns it alongside `inserted`. Pre-fix the
        worker dropped the list and returned DONE with the partial
        insert count — 9-of-10 batch failures silently lost 900 rows
        with no observability. Post-fix: errors -> FAILED transient so
        the queue retries."""
        ctx = _build_mock_ctx(exchange_name="binance")
        funding_rows = [
            {"strategy_id": "strat-1", "match_key": "k1"},
            {"strategy_id": "strat-1", "match_key": "k2"},
        ]
        mock_fetch = AsyncMock(return_value=funding_rows)
        # upsert reports partial success + 2 batch errors.
        mock_upsert = AsyncMock(
            return_value={
                "inserted": 1,
                "skipped": 0,
                "errors": [
                    "connection reset by peer",
                    "504 gateway timeout",
                ],
            }
        )

        job = {"id": "job-funding-errs", "kind": "sync_funding", "strategy_id": "strat-1"}

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=ctx),
        ), patch(
            "services.funding_fetch.fetch_funding_binance",
            new=mock_fetch,
        ), patch(
            "services.funding_fetch.upsert_funding_rows",
            new=mock_upsert,
        ):
            result = await run_sync_funding_job(job)

        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "transient", (
            "H-1115 contract: upsert batch errors must trigger transient "
            "retry, not silent DONE with partial inserts"
        )
        assert result.error_message is not None
        assert "upsert" in result.error_message.lower()
        ctx.exchange.close.assert_awaited()

    @pytest.mark.asyncio
    async def test_preflight_failure_short_circuits(self) -> None:
        """When preflight returns DispatchResult (missing key, circuit
        breaker tripped), run_sync_funding_job must return that result
        verbatim — no fetch, no upsert."""
        defer = DispatchResult(outcome=DispatchOutcome.DEFERRED)
        mock_fetch = AsyncMock(return_value=[])

        job = {"id": "job-funding-defer", "kind": "sync_funding", "strategy_id": "strat-1"}

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=defer),
        ), patch(
            "services.funding_fetch.fetch_funding_binance",
            new=mock_fetch,
        ):
            result = await run_sync_funding_job(job)

        assert result.outcome == DispatchOutcome.DEFERRED
        mock_fetch.assert_not_awaited()
