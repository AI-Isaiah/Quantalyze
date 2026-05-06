"""Tests for analytics-service/services/job_worker.py.

This file exercises the worker dispatcher surface without touching real
exchanges, real DB state, or real long-running handlers. Three concerns are
pinned in:

1. classify_exception — the error family → (error_kind, sanitized_message)
   mapping. CCXT network/timeout/rate-limit errors are transient; auth/
   permission/bad-request errors and InvalidToken are permanent; asyncio
   timeouts are transient; everything else is unknown. This table is a
   contract the DB relies on for retry-vs-final decisions.

2. dispatch routing — kind='sync_trades'/'compute_analytics'/'compute_portfolio'
   each route to a dedicated handler. Handlers are mocked at
   services.job_worker.run_* so we verify the dispatcher is the routing
   surface, not the handlers themselves.

3. dispatch timeout + stub paths — handlers that exceed their per-kind
   timeout return DispatchResult(FAILED, transient). poll_positions is
   a stub that returns DispatchResult(FAILED, permanent) until commit 3.

All tests mock at the services.job_worker layer — no Supabase, no ccxt,
no HTTPX, no real workload. Exchanges and DB are the outer boundary.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import ccxt
import pytest
from cryptography.fernet import InvalidToken
from fastapi import HTTPException

from services.job_worker import (
    DispatchOutcome,
    DispatchResult,
    classify_exception,
    dispatch,
)


# ---------------------------------------------------------------------------
# classify_exception
# ---------------------------------------------------------------------------

class TestClassifyException:
    """classify_exception maps exception → (error_kind, sanitized_message).

    The mapping is a load-bearing contract: DB mark_compute_job_failed uses
    error_kind to decide retry vs terminal, and UI uses sanitized_message to
    render admin diagnostics without leaking stack traces.
    """

    def test_network_error_is_transient(self) -> None:
        exc = ccxt.NetworkError("connection reset")
        kind, msg = classify_exception(exc)
        assert kind == "transient"
        assert "connection reset" in msg

    def test_request_timeout_is_transient(self) -> None:
        """RequestTimeout is a CCXT subclass of NetworkError."""
        exc = ccxt.RequestTimeout("exchange did not respond in 30s")
        kind, msg = classify_exception(exc)
        assert kind == "transient"
        assert "timeout" in msg.lower() or "respond" in msg.lower()

    def test_rate_limit_is_transient(self) -> None:
        """RateLimitExceeded is a CCXT subclass of NetworkError."""
        exc = ccxt.RateLimitExceeded("429 too many requests")
        kind, msg = classify_exception(exc)
        assert kind == "transient"
        assert "429" in msg or "too many" in msg.lower()

    def test_authentication_error_is_permanent(self) -> None:
        exc = ccxt.AuthenticationError("invalid api key")
        kind, msg = classify_exception(exc)
        assert kind == "permanent"
        assert "invalid" in msg.lower() or "api" in msg.lower()

    def test_permission_denied_is_permanent(self) -> None:
        exc = ccxt.PermissionDenied("withdrawal not allowed")
        kind, msg = classify_exception(exc)
        assert kind == "permanent"

    def test_bad_request_is_permanent(self) -> None:
        exc = ccxt.BadRequest("unknown symbol XYZABC/USDT")
        kind, msg = classify_exception(exc)
        assert kind == "permanent"

    def test_invalid_token_is_permanent_with_sanitized_message(self) -> None:
        """Fernet InvalidToken → permanent, and the message must NOT include
        the exception detail — the sanitized string is a fixed safe literal."""
        exc = InvalidToken("raw fernet detail that must not leak")
        kind, msg = classify_exception(exc)
        assert kind == "permanent"
        # The canonical message is what ships to the UI. The exception
        # detail (which could leak key material in some fernet versions)
        # must NOT be present.
        assert "raw fernet detail" not in msg
        assert "Credentials could not be decrypted" in msg

    def test_asyncio_timeout_is_transient(self) -> None:
        """asyncio.TimeoutError is the failure mode of asyncio.wait_for.
        Classified as transient so retries kick in."""
        exc = asyncio.TimeoutError("15m elapsed")
        kind, msg = classify_exception(exc)
        assert kind == "transient"
        assert "timeout" in msg.lower() or "exceeded" in msg.lower()

    def test_generic_runtime_error_is_unknown(self) -> None:
        """Anything not in the explicit table → unknown (retry by default)."""
        exc = RuntimeError("unexpected state in computation")
        kind, msg = classify_exception(exc)
        assert kind == "unknown"
        assert "unexpected state" in msg

    def test_ccxt_base_error_fallthrough_is_unknown(self) -> None:
        """CCXT BaseError not caught by a more specific subclass lands in
        unknown — the CCXT hierarchy has many leaf types we don't explicitly
        handle (ExchangeError, InvalidOrder, etc.)."""
        exc = ccxt.BaseError("exchange returned something weird")
        kind, msg = classify_exception(exc)
        assert kind == "unknown"

    def test_http_exception_400_is_permanent(self) -> None:
        """HTTPException with 4xx status (except 408/429) is permanent.
        analytics_runner raises 400 for "Insufficient trade history" — no
        amount of retry produces missing trade data, so go straight to
        failed_final instead of pollluting the retry queue."""
        exc = HTTPException(status_code=400, detail="Insufficient trade history")
        kind, msg = classify_exception(exc)
        assert kind == "permanent"
        assert "400" in msg
        assert "Insufficient trade history" in msg

    def test_http_exception_404_is_permanent(self) -> None:
        exc = HTTPException(status_code=404, detail="Strategy not found")
        kind, msg = classify_exception(exc)
        assert kind == "permanent"
        assert "404" in msg

    def test_http_exception_422_is_permanent(self) -> None:
        exc = HTTPException(status_code=422, detail="Validation failed: missing field")
        kind, msg = classify_exception(exc)
        assert kind == "permanent"

    def test_http_exception_408_is_transient(self) -> None:
        """408 Request Timeout is the one 4xx code that benefits from retry."""
        exc = HTTPException(status_code=408, detail="upstream timed out")
        kind, msg = classify_exception(exc)
        assert kind == "transient"
        assert "408" in msg

    def test_http_exception_429_is_transient(self) -> None:
        """429 Too Many Requests — backoff and retry."""
        exc = HTTPException(status_code=429, detail="rate limited")
        kind, msg = classify_exception(exc)
        assert kind == "transient"
        assert "429" in msg

    def test_http_exception_500_is_unknown_retry(self) -> None:
        """5xx falls through to the unknown branch — retried by default."""
        exc = HTTPException(status_code=500, detail="upstream crashed")
        kind, msg = classify_exception(exc)
        assert kind == "unknown"

    def test_message_is_truncated(self) -> None:
        """Error strings longer than 500 chars must be truncated so admin UI
        rows don't blow up. Uses a generic RuntimeError to test the cap
        without tripping a more specific rule."""
        long_msg = "x" * 5000
        exc = RuntimeError(long_msg)
        _, msg = classify_exception(exc)
        assert len(msg) <= 500


# ---------------------------------------------------------------------------
# dispatch routing
# ---------------------------------------------------------------------------

class TestDispatchRouting:
    """dispatch reads job['kind'] and routes to the matching run_* handler.

    Each handler is mocked at the services.job_worker layer so this file
    verifies dispatch-side routing only — the handler internals live in
    their own test scope.
    """

    @pytest.mark.asyncio
    async def test_dispatch_routes_sync_trades(self) -> None:
        job = {"id": "job-1", "kind": "sync_trades", "strategy_id": "strat-1"}
        with patch(
            "services.job_worker.run_sync_trades_job",
            new=AsyncMock(return_value=DispatchResult(
                outcome=DispatchOutcome.DONE, trade_count=42,
            )),
        ) as mock_handler, patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ):
            result = await dispatch(job)
        mock_handler.assert_awaited_once_with(job)
        assert result.outcome == DispatchOutcome.DONE
        assert result.trade_count == 42

    @pytest.mark.asyncio
    async def test_dispatch_routes_compute_analytics(self) -> None:
        job = {"id": "job-2", "kind": "compute_analytics", "strategy_id": "strat-2"}
        with patch(
            "services.job_worker.run_compute_analytics_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ) as mock_handler, patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ):
            result = await dispatch(job)
        mock_handler.assert_awaited_once_with(job)
        assert result.outcome == DispatchOutcome.DONE

    @pytest.mark.asyncio
    async def test_dispatch_routes_compute_portfolio(self) -> None:
        job = {"id": "job-3", "kind": "compute_portfolio", "portfolio_id": "port-1"}
        with patch(
            "services.job_worker.run_compute_portfolio_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ) as mock_handler:
            result = await dispatch(job)
        mock_handler.assert_awaited_once_with(job)
        assert result.outcome == DispatchOutcome.DONE

    @pytest.mark.asyncio
    async def test_dispatch_routes_poll_positions(self) -> None:
        """Commit 3 wires the real poll_positions handler. Verify dispatch
        routes kind='poll_positions' to run_poll_positions_job."""
        job = {"id": "job-4", "kind": "poll_positions", "strategy_id": "strat-3"}
        with patch(
            "services.job_worker.run_poll_positions_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ) as mock_handler, patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ):
            result = await dispatch(job)
        mock_handler.assert_awaited_once_with(job)
        assert result.outcome == DispatchOutcome.DONE

    @pytest.mark.asyncio
    async def test_dispatch_routes_compute_intro_snapshot(self) -> None:
        """Sprint 5 Task 5.3: kind='compute_intro_snapshot' routes to
        run_compute_intro_snapshot_job. The job carries contact_request_id
        in metadata; the strategy_id arm of kind_target_coherence holds.
        """
        job = {
            "id": "job-intro-1",
            "kind": "compute_intro_snapshot",
            "strategy_id": "strat-intro-1",
            "metadata": {"contact_request_id": "cr-1"},
        }
        with patch(
            "services.job_worker.run_compute_intro_snapshot_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ) as mock_handler, patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ):
            result = await dispatch(job)
        mock_handler.assert_awaited_once_with(job)
        assert result.outcome == DispatchOutcome.DONE

    @pytest.mark.asyncio
    async def test_dispatch_unknown_kind_returns_permanent_failed(self) -> None:
        """Unknown kind → permanent failure. Prevents an infinite retry
        storm if the DB has a row with a kind that the worker doesn't know
        how to handle."""
        job = {"id": "job-5", "kind": "bogus_kind", "strategy_id": "strat-4"}
        with patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ):
            result = await dispatch(job)
        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent"


# ---------------------------------------------------------------------------
# dispatch timeout + exception classification on handler failures
# ---------------------------------------------------------------------------

class TestDispatchExceptionHandling:
    """dispatch wraps handlers in asyncio.wait_for per-kind timeouts and
    classifies any uncaught exception into (error_kind, sanitized message)
    before returning DispatchResult(FAILED, ...).
    """

    @pytest.mark.asyncio
    async def test_handler_timeout_returns_transient_failed(self) -> None:
        """A handler raising asyncio.TimeoutError (from wait_for expiring)
        → transient failure. This is the stuck-forever path; retries are
        the right answer."""
        async def _slow_handler(job: dict) -> DispatchResult:
            # Force a timeout classification rather than actually waiting.
            raise asyncio.TimeoutError("simulated timeout")

        job = {"id": "job-6", "kind": "sync_trades", "strategy_id": "strat-5"}
        with patch(
            "services.job_worker.run_sync_trades_job",
            new=_slow_handler,
        ), patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ):
            result = await dispatch(job)
        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "transient"
        assert "timeout" in (result.error_message or "").lower() or "exceeded" in (result.error_message or "").lower()

    @pytest.mark.asyncio
    async def test_handler_raising_ccxt_network_error_transient(self) -> None:
        async def _fail(job: dict) -> DispatchResult:
            raise ccxt.NetworkError("exchange down")

        job = {"id": "job-7", "kind": "sync_trades", "strategy_id": "strat-6"}
        with patch(
            "services.job_worker.run_sync_trades_job",
            new=_fail,
        ), patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ):
            result = await dispatch(job)
        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "transient"

    @pytest.mark.asyncio
    async def test_handler_raising_auth_error_permanent(self) -> None:
        async def _fail(job: dict) -> DispatchResult:
            raise ccxt.AuthenticationError("bad key")

        job = {"id": "job-8", "kind": "sync_trades", "strategy_id": "strat-7"}
        with patch(
            "services.job_worker.run_sync_trades_job",
            new=_fail,
        ), patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ):
            result = await dispatch(job)
        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent"

    @pytest.mark.asyncio
    async def test_handler_raising_unknown_error(self) -> None:
        async def _fail(job: dict) -> DispatchResult:
            raise RuntimeError("mystery fault")

        job = {"id": "job-9", "kind": "compute_analytics", "strategy_id": "strat-8"}
        with patch(
            "services.job_worker.run_compute_analytics_job",
            new=_fail,
        ), patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ):
            result = await dispatch(job)
        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "unknown"
        assert "mystery fault" in (result.error_message or "")


# ---------------------------------------------------------------------------
# Post-dispatch UI status bridge
# ---------------------------------------------------------------------------

class TestDispatchStatusBridge:
    """After every strategy-scoped job, dispatch must call
    sync_strategy_analytics_status so the UI state reflects the queue.
    Portfolio-scoped jobs skip the call (no strategy_analytics row).
    """

    @pytest.mark.asyncio
    async def test_strategy_job_calls_status_bridge_on_success(self) -> None:
        job = {"id": "job-10", "kind": "sync_trades", "strategy_id": "strat-10"}
        with patch(
            "services.job_worker.run_sync_trades_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ), patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ) as mock_sync:
            await dispatch(job)
        mock_sync.assert_awaited_once_with("strat-10")

    @pytest.mark.asyncio
    async def test_strategy_job_calls_status_bridge_on_failure(self) -> None:
        async def _fail(job: dict) -> DispatchResult:
            raise RuntimeError("boom")

        job = {"id": "job-11", "kind": "compute_analytics", "strategy_id": "strat-11"}
        with patch(
            "services.job_worker.run_compute_analytics_job",
            new=_fail,
        ), patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ) as mock_sync:
            await dispatch(job)
        mock_sync.assert_awaited_once_with("strat-11")

    @pytest.mark.asyncio
    async def test_portfolio_job_does_not_call_status_bridge(self) -> None:
        job = {"id": "job-12", "kind": "compute_portfolio", "portfolio_id": "port-12"}
        with patch(
            "services.job_worker.run_compute_portfolio_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ), patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ) as mock_sync:
            await dispatch(job)
        mock_sync.assert_not_awaited()


# ---------------------------------------------------------------------------
# Feature flag: USE_RAW_TRADE_INGESTION
# ---------------------------------------------------------------------------

class TestSyncTradesFeatureFlag:
    """Tests that the raw fill ingestion Phase 2 in run_sync_trades_job
    is gated by the USE_RAW_TRADE_INGESTION environment variable.

    These tests mock the full exchange preflight chain so only the
    feature-flag path is exercised.
    """

    @pytest.mark.asyncio
    async def test_sync_trades_feature_flag_off(self) -> None:
        """With USE_RAW_TRADE_INGESTION=false (default), verify Phase 2
        (fetch_raw_trades) is never called."""
        from services.job_worker import run_sync_trades_job

        # Build mock exchange context
        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.strategy_row = {"id": "strat-1", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "binance",
            "last_sync_at": None, "user_id": "user-1",
        }

        # Mock the supabase RPC chain
        mock_rpc = MagicMock()
        mock_rpc.execute.return_value = MagicMock(data=5)
        mock_ctx.supabase.rpc.return_value = mock_rpc

        # Mock the table update chain
        mock_update = MagicMock()
        mock_eq = MagicMock()
        mock_eq.execute.return_value = MagicMock(data=[])
        mock_update.eq.return_value = mock_eq
        mock_ctx.supabase.table.return_value.update.return_value = mock_update

        job = {"id": "job-ff-1", "kind": "sync_trades", "strategy_id": "strat-1"}

        mock_fetch_raw = AsyncMock(return_value=[])

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ), patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=[{"test": "trade"}]),
        ), patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=10000.0),
        ), patch(
            "services.job_worker.db_execute",
            side_effect=lambda fn: asyncio.to_thread(fn),
        ), patch(
            "services.exchange.fetch_raw_trades",
            mock_fetch_raw,
        ), patch.dict(
            "os.environ", {"USE_RAW_TRADE_INGESTION": "false"},
        ):
            result = await run_sync_trades_job(job)

        assert result.outcome == DispatchOutcome.DONE
        mock_fetch_raw.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_sync_trades_feature_flag_on(self) -> None:
        """With USE_RAW_TRADE_INGESTION=true, verify fetch_raw_trades IS
        called after fetch_all_trades."""
        from services.job_worker import run_sync_trades_job

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.strategy_row = {"id": "strat-1", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "binance",
            "last_sync_at": None, "user_id": "user-1",
        }

        mock_rpc = MagicMock()
        mock_rpc.execute.return_value = MagicMock(data=5)
        mock_ctx.supabase.rpc.return_value = mock_rpc

        mock_update = MagicMock()
        mock_eq = MagicMock()
        mock_eq.execute.return_value = MagicMock(data=[])
        mock_update.eq.return_value = mock_eq
        mock_ctx.supabase.table.return_value.update.return_value = mock_update

        job = {"id": "job-ff-2", "kind": "sync_trades", "strategy_id": "strat-1"}

        mock_fetch_raw = AsyncMock(return_value=[{"fill": "data"}])

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ), patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=[{"test": "trade"}]),
        ), patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=10000.0),
        ), patch(
            "services.job_worker.db_execute",
            side_effect=lambda fn: asyncio.to_thread(fn),
        ), patch(
            "services.exchange.fetch_raw_trades",
            mock_fetch_raw,
        ), patch.dict(
            "os.environ", {"USE_RAW_TRADE_INGESTION": "true"},
        ):
            result = await run_sync_trades_job(job)

        assert result.outcome == DispatchOutcome.DONE
        mock_fetch_raw.assert_awaited_once()


# ---------------------------------------------------------------------------
# Phase 18 root-cause fix: sync_trades enqueues compute_analytics
# ---------------------------------------------------------------------------

class TestSyncTradesEnqueuesComputeAnalytics:
    """Phase 18 regression: after a successful sync_trades run, the worker
    must enqueue a follow-on `compute_analytics` job for the same strategy.

    Pre-fix history (root cause found 2026-05-05): /api/keys/sync only
    enqueued sync_trades. The chain compute_jobs → sync_trades →
    compute_analytics was documented in migration 032 STEP 11/12 (fan-in
    + child advancement) but the enqueue half was never wired. New-
    strategy onboarding via the wizard polled
    strategy_analytics.computation_status='complete' that never arrived,
    or arrived (post-099) with NULL metric columns. Five customer-facing
    patches in 19 days addressed downstream symptoms without ever fixing
    this enqueue gap.
    """

    @pytest.mark.asyncio
    async def test_sync_trades_enqueues_compute_analytics_on_success(
        self,
    ) -> None:
        """Successful run_sync_trades_job MUST call enqueue_compute_job
        with kind='compute_analytics' for the same strategy. Asserted via
        the supabase.rpc call signature so a future refactor that moves
        the enqueue elsewhere still has to land the same RPC call."""
        from services.job_worker import run_sync_trades_job

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.strategy_row = {"id": "strat-phase-18", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "okx",
            "last_sync_at": None, "user_id": "user-1",
        }

        # Track every supabase.rpc call so we can assert the
        # enqueue_compute_job call was made with the right shape.
        rpc_calls: list[tuple[str, dict]] = []

        def _rpc(name: str, payload: dict) -> MagicMock:
            rpc_calls.append((name, payload))
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=5)
            return stub

        mock_ctx.supabase.rpc.side_effect = _rpc

        mock_update = MagicMock()
        mock_eq = MagicMock()
        mock_eq.execute.return_value = MagicMock(data=[])
        mock_update.eq.return_value = mock_eq
        mock_ctx.supabase.table.return_value.update.return_value = mock_update

        job = {
            "id": "job-phase-18",
            "kind": "sync_trades",
            "strategy_id": "strat-phase-18",
        }

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ), patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=[{"test": "trade"}]),
        ), patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=10000.0),
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ), patch.dict(
            "os.environ", {"USE_RAW_TRADE_INGESTION": "false"},
        ):
            result = await run_sync_trades_job(job)

        assert result.outcome == DispatchOutcome.DONE

        # The follow-on enqueue MUST be present, with the right strategy_id
        # and the right kind. Order doesn't matter — there are several rpc
        # calls during sync_trades (sync_trades data persist + the new
        # enqueue) — but the enqueue MUST exist.
        enqueue_calls = [
            payload
            for (name, payload) in rpc_calls
            if name == "enqueue_compute_job"
        ]
        assert len(enqueue_calls) == 1, (
            f"Expected exactly 1 enqueue_compute_job call after sync_trades; "
            f"got {len(enqueue_calls)}. All RPC calls: {rpc_calls}"
        )
        payload = enqueue_calls[0]
        assert payload["p_strategy_id"] == "strat-phase-18"
        assert payload["p_kind"] == "compute_analytics"

    @pytest.mark.asyncio
    async def test_sync_trades_enqueue_failure_does_not_fail_job(
        self,
    ) -> None:
        """The enqueue is best-effort. If it raises (e.g., RPC unavailable),
        run_sync_trades_job MUST still return DONE so the job doesn't
        retry-loop on a transient infra issue. The cron-driven daily sync
        will re-enqueue cleanly on the next tick."""
        from services.job_worker import run_sync_trades_job

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.strategy_row = {"id": "strat-degraded", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "okx",
            "last_sync_at": None, "user_id": "user-1",
        }

        # First rpc call (sync_trades persist) succeeds. Second
        # (enqueue_compute_job) raises. Job must still complete.
        call_count = {"n": 0}

        def _rpc(name: str, payload: dict) -> MagicMock:
            call_count["n"] += 1
            if name == "enqueue_compute_job":
                raise RuntimeError("simulated transient enqueue failure")
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=5)
            return stub

        mock_ctx.supabase.rpc.side_effect = _rpc

        mock_update = MagicMock()
        mock_eq = MagicMock()
        mock_eq.execute.return_value = MagicMock(data=[])
        mock_update.eq.return_value = mock_eq
        mock_ctx.supabase.table.return_value.update.return_value = mock_update

        job = {
            "id": "job-degraded",
            "kind": "sync_trades",
            "strategy_id": "strat-degraded",
        }

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ), patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=[{"test": "trade"}]),
        ), patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=10000.0),
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ), patch.dict(
            "os.environ", {"USE_RAW_TRADE_INGESTION": "false"},
        ):
            result = await run_sync_trades_job(job)

        # Job must succeed — enqueue is best-effort.
        assert result.outcome == DispatchOutcome.DONE

    @pytest.mark.asyncio
    async def test_enqueue_failure_marks_strategy_analytics_failed(
        self,
    ) -> None:
        """Wizard-hang regression: when the enqueue_compute_job RPC fails,
        run_sync_trades_job MUST upsert strategy_analytics with
        computation_status='failed' + a clear computation_error so the
        wizard's poll loop (SyncPreviewStep.tsx) surfaces a
        GATE_ANALYTICS_FAILED envelope instead of hanging at 'computing'
        for up to 24h until the daily cron re-enqueues.

        Pre-fix history (root cause found 2026-05-05): the previous
        implementation logged at WARNING and silently swallowed the
        enqueue failure with a "best-effort" comment. Daily cron means
        the wizard user stares at the spinner indefinitely. Same wizard-
        hang class as PR #116 was meant to fix.
        """
        from services.job_worker import run_sync_trades_job

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.strategy_row = {"id": "strat-hang", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "okx",
            "last_sync_at": None, "user_id": "user-1",
        }

        # Make enqueue_compute_job raise; other RPCs succeed.
        def _rpc(name: str, payload: dict) -> MagicMock:
            if name == "enqueue_compute_job":
                raise RuntimeError("simulated enqueue infra failure")
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=5)
            return stub

        mock_ctx.supabase.rpc.side_effect = _rpc

        # Track every supabase.table().upsert() call so we can assert the
        # strategy_analytics 'failed' upsert was made with the right
        # shape. The mock returns a chained builder so the production
        # code's `.upsert(...).execute()` chain still works.
        upsert_calls: list[tuple[str, dict, dict]] = []

        def _table(name: str) -> MagicMock:
            mock_t = MagicMock()

            def _upsert(payload: dict, **kwargs):
                upsert_calls.append((name, dict(payload), dict(kwargs)))
                stub = MagicMock()
                stub.execute.return_value = MagicMock(data=[])
                return stub

            mock_t.upsert.side_effect = _upsert

            # Keep the existing update().eq().execute() chain for the
            # api_keys cursor advance — same as the other tests.
            mock_update = MagicMock()
            mock_eq = MagicMock()
            mock_eq.execute.return_value = MagicMock(data=[])
            mock_update.eq.return_value = mock_eq
            mock_t.update.return_value = mock_update

            return mock_t

        mock_ctx.supabase.table.side_effect = _table

        job = {
            "id": "job-hang",
            "kind": "sync_trades",
            "strategy_id": "strat-hang",
        }

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ), patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=[{"test": "trade"}]),
        ), patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=10000.0),
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ), patch.dict(
            "os.environ", {"USE_RAW_TRADE_INGESTION": "false"},
        ):
            result = await run_sync_trades_job(job)

        # Job must still succeed — best-effort for the job, not for the UI.
        assert result.outcome == DispatchOutcome.DONE

        # Find the upsert into strategy_analytics with the failed status.
        failed_upserts = [
            payload
            for (table_name, payload, _kwargs) in upsert_calls
            if table_name == "strategy_analytics"
            and payload.get("computation_status") == "failed"
        ]
        assert len(failed_upserts) == 1, (
            f"Expected exactly 1 strategy_analytics 'failed' upsert "
            f"after enqueue failure; got {len(failed_upserts)}. "
            f"All upsert calls: {upsert_calls}"
        )
        payload = failed_upserts[0]
        assert payload["strategy_id"] == "strat-hang"
        assert payload["computation_status"] == "failed"
        assert payload.get("computation_error"), (
            "computation_error must be a non-empty string so the wizard "
            "renders a meaningful GATE_ANALYTICS_FAILED envelope"
        )
        # The on_conflict kwarg must be present so this is an upsert,
        # not an insert that crashes on PK conflict for re-runs.
        on_conflict = next(
            kwargs.get("on_conflict")
            for (table_name, _payload, kwargs) in upsert_calls
            if table_name == "strategy_analytics"
        )
        assert on_conflict == "strategy_id"


# ---------------------------------------------------------------------------
# compute_intro_snapshot handler
# ---------------------------------------------------------------------------

class TestComputeIntroSnapshot:
    """Sprint 5 Task 5.3 — pure-DB handler that fills in
    contact_requests.portfolio_snapshot when /api/intro's 2s synchronous
    budget expires. Two contracts pinned here:

      1. Missing contact_request_id in metadata → permanent failure
         (otherwise the job would retry forever).
      2. Successful path writes the JSON shape /api/intro and the TS
         snapshot module agree on, then UPDATEs snapshot_status='ready'.
    """

    @pytest.mark.asyncio
    async def test_missing_contact_request_id_is_permanent_failure(self) -> None:
        from services.job_worker import run_compute_intro_snapshot_job

        job = {
            "id": "job-x",
            "kind": "compute_intro_snapshot",
            "strategy_id": "strat-x",
            "metadata": {},
        }
        result = await run_compute_intro_snapshot_job(job)
        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent"
        assert "contact_request_id" in (result.error_message or "")
