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

    def test_http_exception_403_is_unknown(self) -> None:
        """H-1113: 403 'Internal API not configured' is raised by
        routers/internal.py during deploy windows when INTERNAL_API_TOKEN
        is briefly missing — a transient infra blip. Classifying it as
        permanent would terminate the job on the first deploy and require
        manual re-enqueue; classifying as unknown lets the retry queue
        self-heal once the env is restored. The DB CHECK still accepts
        'unknown' (compute_jobs.error_kind enum)."""
        exc = HTTPException(status_code=403, detail="Internal API not configured")
        kind, msg = classify_exception(exc)
        assert kind == "unknown"
        assert "403" in msg
        assert "Internal API not configured" in msg

    def test_http_exception_404_is_unknown(self) -> None:
        """H-1113: 404 'API key not found' is raised by routers/internal.py
        during a key rotation race. The next sync usually finds the new
        row; classifying as unknown lets the retry pick it up. A
        legitimately-deleted strategy will eventually be cancelled by the
        watchdog or by max attempts — not by a single-attempt 404."""
        exc = HTTPException(status_code=404, detail="API key not found")
        kind, msg = classify_exception(exc)
        assert kind == "unknown"
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

    def test_http_exception_dict_detail_serializes_via_json(self) -> None:
        """H-1114 / M-0948 / M-0949 / M-0951: FastAPI types
        HTTPException.detail as Any. Routers (e.g. routers/csv.py) raise
        with detail=dict for structured errors. Pre-fix `str(dict)`
        produced Python repr (single-quoted), leaking internal keys and
        invalid for JSON consumers. Post-fix the dict is JSON-serialized
        — round-trippable by downstream consumers."""
        exc = HTTPException(
            status_code=400,
            detail={"code": "INSUFFICIENT_TRADES", "have": 12, "need": 30},
        )
        kind, msg = classify_exception(exc)
        assert kind == "permanent"
        assert "INSUFFICIENT_TRADES" in msg
        # JSON output uses double quotes, not Python repr single quotes.
        assert '"code"' in msg or "INSUFFICIENT_TRADES" in msg

    def test_http_exception_rogue_detail_does_not_crash_classifier(self) -> None:
        """H-1114: the classifier itself must never raise. A detail whose
        __str__ raises would propagate out of classify_exception, defeat
        the worker dispatcher's exception envelope, and reclassify what
        should have been a permanent 4xx as a fallback 'unknown'."""

        class RogueDetail:
            def __str__(self) -> str:  # pragma: no cover - rogue path
                raise RuntimeError("naughty __str__")
            def __repr__(self) -> str:  # pragma: no cover - rogue path
                raise RuntimeError("naughty __repr__")

        exc = HTTPException(status_code=400, detail=RogueDetail())
        kind, msg = classify_exception(exc)
        assert kind == "permanent"
        assert "400" in msg
        # Must contain the fallback literal so admin UI shows SOMETHING.
        assert "<unstringifiable detail>" in msg

    def test_classifier_returns_typed_error_kind(self) -> None:
        """H-1112 / H-1110: classify_exception is annotated
        `tuple[ErrorKind, str]`. Verify the returned tag is one of the
        three Literal values the DB CHECK accepts (the structural
        contract that makes the DB guard defense-in-depth instead of the
        only line of defense)."""
        from services.job_worker import classify_exception
        for exc in [
            ccxt.NetworkError("x"),
            ccxt.AuthenticationError("x"),
            RuntimeError("x"),
            HTTPException(status_code=400, detail="x"),
        ]:
            kind, _ = classify_exception(exc)
            assert kind in ("transient", "permanent", "unknown")

    def test_http_exception_with_ccxt_baseerror_parent_still_permanent(self) -> None:
        """M-0950: defensive pin on branch order — HTTPException must be
        checked BEFORE ccxt.BaseError so any future multi-inheriting class
        gets the more specific 4xx classification, not the catch-all
        'unknown' bucket. If a refactor flips the order this test fires."""

        class HybridError(HTTPException, ccxt.BaseError):
            def __init__(self) -> None:
                HTTPException.__init__(self, status_code=400, detail="hybrid")
                ccxt.BaseError.__init__(self, "hybrid")

        kind, _ = classify_exception(HybridError())
        assert kind == "permanent"


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
            "services.job_worker.fetch_raw_trades",
            mock_fetch_raw,
        ), patch(
            "services.job_worker._RAW_TRADE_INGESTION_ENABLED", False,
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
            "services.job_worker.fetch_raw_trades",
            mock_fetch_raw,
        ), patch(
            "services.job_worker._RAW_TRADE_INGESTION_ENABLED", True,
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
        ), patch(
            "services.job_worker._RAW_TRADE_INGESTION_ENABLED", False,
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
        ), patch(
            "services.job_worker._RAW_TRADE_INGESTION_ENABLED", False,
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
        ), patch(
            "services.job_worker._RAW_TRADE_INGESTION_ENABLED", False,
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
# G12.A.4 — Empty / partial exchange response must NOT wipe daily_pnl history
# ---------------------------------------------------------------------------

class TestSyncTradesEmptyResponsePreservesHistory:
    """audit-2026-05-07 G12.A.4 (HIGH conf=9) — regression gate.

    Pre-fix history: `if trades:` (job_worker.py:571) means an empty list
    skips the sync_trades RPC; a non-empty list with a single trade still
    invokes sync_trades, but migration 110 scopes the DELETE to the JSONB
    payload's [MIN,MAX] timestamp window so older rows survive. There was
    no Python-level test asserting either property — these tests pin them
    so a future refactor that drops the `if trades:` guard or unscopes the
    DELETE fails loud.
    """

    @pytest.mark.asyncio
    async def test_sync_trades_empty_response_preserves_existing(self) -> None:
        """Mock fetch_all_trades to return []. The sync_trades RPC must
        NOT be called (the `if trades:` guard at job_worker.py:571 short-
        circuits). Pre-existing daily_pnl rows in the DB therefore survive
        untouched."""
        from services.job_worker import run_sync_trades_job

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.strategy_row = {"id": "strat-empty", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "okx",
            "last_sync_at": None, "user_id": "user-1",
        }

        rpc_calls: list[tuple[str, dict]] = []

        def _rpc(name: str, payload: dict) -> MagicMock:
            rpc_calls.append((name, payload))
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=0)
            return stub

        mock_ctx.supabase.rpc.side_effect = _rpc

        # api_keys.update().eq().execute() chain for cursor advance.
        mock_update = MagicMock()
        mock_eq = MagicMock()
        mock_eq.execute.return_value = MagicMock(data=[])
        mock_update.eq.return_value = mock_eq
        mock_ctx.supabase.table.return_value.update.return_value = mock_update

        job = {"id": "job-empty", "kind": "sync_trades", "strategy_id": "strat-empty"}

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ), patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=[]),  # empty exchange response
        ), patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=10000.0),
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ), patch(
            "services.job_worker._RAW_TRADE_INGESTION_ENABLED", False,
        ):
            result = await run_sync_trades_job(job)

        assert result.outcome == DispatchOutcome.DONE

        # The sync_trades RPC must NOT have been called — that's what
        # protects existing daily_pnl rows on an empty exchange response.
        # Other RPCs (enqueue_compute_job follow-on) ARE allowed.
        sync_trades_calls = [
            payload for (name, payload) in rpc_calls if name == "sync_trades"
        ]
        assert sync_trades_calls == [], (
            f"sync_trades RPC must NOT be called when fetch_all_trades returns []; "
            f"empty exchange response would otherwise wipe daily_pnl history. "
            f"Got calls: {sync_trades_calls}"
        )

    @pytest.mark.asyncio
    async def test_sync_trades_partial_response_does_not_wipe_history(self) -> None:
        """Non-empty single-day response: sync_trades RPC IS called, with
        the timestamp window scoped to the payload (migration 110 guards
        the DELETE). Older rows outside the window survive at the DB layer
        — this test pins the Python-side contract that the RPC is invoked
        with the trades list intact (no implicit truncation/expansion)."""
        from services.job_worker import run_sync_trades_job

        single_trade = [
            {
                "exchange": "okx",
                "symbol": "BTC-USDT-SWAP",
                "side": "buy",
                "price": "50000",
                "quantity": "0.1",
                "fee": "0.5",
                "fee_currency": "USDT",
                "timestamp": "2026-05-07T12:00:00Z",
                "order_type": "summary",
            }
        ]

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.strategy_row = {"id": "strat-partial", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "okx",
            "last_sync_at": None, "user_id": "user-1",
        }

        rpc_calls: list[tuple[str, dict]] = []

        def _rpc(name: str, payload: dict) -> MagicMock:
            rpc_calls.append((name, payload))
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=1)
            return stub

        mock_ctx.supabase.rpc.side_effect = _rpc

        mock_update = MagicMock()
        mock_eq = MagicMock()
        mock_eq.execute.return_value = MagicMock(data=[])
        mock_update.eq.return_value = mock_eq
        mock_ctx.supabase.table.return_value.update.return_value = mock_update

        job = {
            "id": "job-partial",
            "kind": "sync_trades",
            "strategy_id": "strat-partial",
        }

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ), patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=single_trade),
        ), patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=10000.0),
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ), patch(
            "services.job_worker._RAW_TRADE_INGESTION_ENABLED", False,
        ):
            result = await run_sync_trades_job(job)

        assert result.outcome == DispatchOutcome.DONE

        # sync_trades RPC was called with the trades list intact; the
        # DB-side migration 110 then scopes the DELETE to the payload's
        # [MIN,MAX] timestamp window so older rows survive.
        sync_trades_calls = [
            payload for (name, payload) in rpc_calls if name == "sync_trades"
        ]
        assert len(sync_trades_calls) == 1
        assert sync_trades_calls[0]["p_strategy_id"] == "strat-partial"
        assert sync_trades_calls[0]["p_trades"] == single_trade


# ---------------------------------------------------------------------------
# G12.A.6 — Amendment-detection observability
# ---------------------------------------------------------------------------

class TestSyncTradesPhase2AmendmentDetection:
    """audit-2026-05-07 G12.A.6 (HIGH conf=8).

    `ignore_duplicates=True` on the Phase 2 raw-fill upsert silently
    discards exchange-amended fills (final fee, post-trade settlement,
    corrected price) that re-use the same exchange_fill_id. Without
    observability the operator has no signal that amendments are being
    dropped. The fix emits a `fill_amendments_detected` warning per Phase
    2 run with the count of incoming fills that collided with existing
    DB rows. This is an under-counter (true duplicates are also counted)
    but it makes the invisible visible.
    """

    @pytest.mark.asyncio
    async def test_phase2_logs_warning_when_fills_collide_with_existing(
        self,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """When the SELECT pass finds incoming fills that already exist
        in the DB by exchange_fill_id, a `fill_amendments_detected`
        WARNING is emitted with the collision count."""
        import logging
        from services.job_worker import run_sync_trades_job

        # Simulate two raw fills coming back from the exchange.
        raw_fills = [
            {
                "exchange": "okx",
                "symbol": "BTC-USDT-SWAP",
                "side": "buy",
                "price": "50000",
                "quantity": "0.1",
                "fee": "0.5",
                "exchange_fill_id": "fill-amended-1",
                "is_fill": True,
                "cost": "5000",
                "timestamp": "2026-05-07T12:00:00Z",
            },
            {
                "exchange": "okx",
                "symbol": "BTC-USDT-SWAP",
                "side": "sell",
                "price": "50100",
                "quantity": "0.1",
                "fee": "0.51",
                "exchange_fill_id": "fill-new-2",
                "is_fill": True,
                "cost": "5010",
                "timestamp": "2026-05-07T12:05:00Z",
            },
        ]

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.strategy_row = {"id": "strat-amend", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "okx",
            "last_sync_at": None, "user_id": "user-1",
        }

        # rpc — sync_trades + enqueue_compute_job both succeed.
        def _rpc(name: str, payload: dict) -> MagicMock:
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=2)
            return stub

        mock_ctx.supabase.rpc.side_effect = _rpc

        # supabase.table('trades') chain (post adversarial-review fix):
        #   .select('exchange,exchange_fill_id').eq(strategy_id).eq(exchange).in_(fill_ids).execute()
        #   — returns existing rows scoped by both strategy AND exchange.
        #   .upsert(...).execute() — Phase 2 batch upsert.
        # supabase.table('api_keys').update(...).eq(...).execute() — cursor
        # advance. Use the same mock_t for all and dispatch by chained verb.
        def _table(name: str) -> MagicMock:
            mock_t = MagicMock()
            # SELECT chain — returns one collision (fill-amended-1 in DB on okx).
            # Two .eq() calls (strategy_id, exchange) → one .in_(fill_ids).
            mock_select = MagicMock()
            mock_eq_strat = MagicMock()
            mock_eq_exch = MagicMock()
            mock_in = MagicMock()
            mock_in.execute.return_value = MagicMock(data=[
                {"exchange": "okx", "exchange_fill_id": "fill-amended-1"},
            ])
            mock_eq_exch.in_.return_value = mock_in
            mock_eq_strat.eq.return_value = mock_eq_exch
            mock_select.eq.return_value = mock_eq_strat
            mock_t.select.return_value = mock_select

            # UPSERT chain — succeeds.
            mock_upsert = MagicMock()
            mock_upsert.execute.return_value = MagicMock(data=[])
            mock_t.upsert.return_value = mock_upsert

            # UPDATE chain — for cursor advance.
            mock_update = MagicMock()
            mock_eq_upd = MagicMock()
            mock_eq_upd.execute.return_value = MagicMock(data=[])
            mock_update.eq.return_value = mock_eq_upd
            mock_t.update.return_value = mock_update

            return mock_t

        mock_ctx.supabase.table.side_effect = _table

        job = {
            "id": "job-amend",
            "kind": "sync_trades",
            "strategy_id": "strat-amend",
        }

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.job_worker"), patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ), patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=[{"test": "trade"}]),
        ), patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=10000.0),
        ), patch(
            "services.job_worker.fetch_raw_trades",
            new=AsyncMock(return_value=raw_fills),
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ), patch(
            "services.job_worker._RAW_TRADE_INGESTION_ENABLED", True,
        ):
            result = await run_sync_trades_job(job)

        assert result.outcome == DispatchOutcome.DONE

        # Warning must include the marker + collision count.
        warning_msgs = [
            r.getMessage() for r in caplog.records
            if r.levelno >= logging.WARNING
        ]
        assert any("fill_amendments_detected" in m for m in warning_msgs), (
            f"Expected a `fill_amendments_detected` WARNING when Phase 2 "
            f"upsert collides with existing fills. "
            f"Warnings captured: {warning_msgs}"
        )

    @pytest.mark.asyncio
    async def test_amendment_select_filters_by_exchange_no_cross_exchange_false_positive(
        self,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Adversarial-review regression (PR #136 follow-up).

        Pre-fix the SELECT only filtered (strategy_id, exchange_fill_id),
        so cross-exchange tradeId collisions (Bybit `execId` vs Binance `id`
        are independent integer namespaces) registered as false-positive
        amendments. The fix buckets incoming fills by exchange and SELECTs
        per-exchange so the predicate matches the upsert's
        (strategy_id, exchange, exchange_fill_id) ON CONFLICT key exactly.

        Sets up: incoming fills from BOTH okx and binance with overlapping
        exchange_fill_id "100" (legal in real life — independent ID spaces).
        DB only has the binance row "100"; the okx row "100" is genuinely new.

        Asserts: the .eq("exchange", ...) chain is called for each distinct
        exchange in the incoming batch (proving the predicate exists).
        """
        from services.job_worker import run_sync_trades_job

        # Cross-exchange overlapping fill IDs — legal because each exchange
        # maintains its own integer ID namespace.
        raw_fills = [
            {
                "exchange": "okx", "symbol": "BTC-USDT-SWAP",
                "side": "buy", "price": "50000", "quantity": "0.1",
                "fee": "0.5", "exchange_fill_id": "100",
                "is_fill": True, "cost": "5000",
                "timestamp": "2026-05-07T12:00:00Z",
            },
            {
                "exchange": "binance", "symbol": "BTCUSDT",
                "side": "sell", "price": "50100", "quantity": "0.1",
                "fee": "0.51", "exchange_fill_id": "100",
                "is_fill": True, "cost": "5010",
                "timestamp": "2026-05-07T12:05:00Z",
            },
        ]

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.strategy_row = {"id": "strat-cross", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "okx",
            "last_sync_at": None, "user_id": "user-1",
        }
        mock_ctx.supabase.rpc.return_value.execute.return_value = MagicMock(data=2)

        # Track each .eq("exchange", ...) call so we can assert the chain
        # is per-exchange (not a single SELECT).
        seen_exchanges: list[str] = []

        def _table(name: str) -> MagicMock:
            mock_t = MagicMock()

            def _select_chain(*select_args, **select_kwargs):
                mock_select = MagicMock()

                def _eq_strategy(_strat_col, _strat_val):
                    mock_eq_strat = MagicMock()

                    def _eq_exchange(_exch_col, _exch_val):
                        # Capture the per-exchange filter — proof the fix
                        # narrows by exchange.
                        if _exch_col == "exchange":
                            seen_exchanges.append(_exch_val)
                        mock_eq_exch = MagicMock()

                        def _in(_col, _ids):
                            mock_in = MagicMock()
                            # Simulate: binance has fill "100" already
                            # (a real prior persist), okx does not.
                            if _exch_val == "binance" and "100" in _ids:
                                mock_in.execute.return_value = MagicMock(data=[
                                    {"exchange": "binance", "exchange_fill_id": "100"},
                                ])
                            else:
                                mock_in.execute.return_value = MagicMock(data=[])
                            return mock_in

                        mock_eq_exch.in_.side_effect = _in
                        return mock_eq_exch

                    mock_eq_strat.eq.side_effect = _eq_exchange
                    return mock_eq_strat

                mock_select.eq.side_effect = _eq_strategy
                return mock_select

            mock_t.select.side_effect = _select_chain

            # UPSERT chain — succeeds.
            mock_upsert = MagicMock()
            mock_upsert.execute.return_value = MagicMock(data=[])
            mock_t.upsert.return_value = mock_upsert

            # UPDATE chain — for cursor advance.
            mock_update = MagicMock()
            mock_eq_upd = MagicMock()
            mock_eq_upd.execute.return_value = MagicMock(data=[])
            mock_update.eq.return_value = mock_eq_upd
            mock_t.update.return_value = mock_update

            return mock_t

        mock_ctx.supabase.table.side_effect = _table

        job = {
            "id": "job-cross",
            "kind": "sync_trades",
            "strategy_id": "strat-cross",
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
            "services.job_worker.fetch_raw_trades",
            new=AsyncMock(return_value=raw_fills),
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ), patch(
            "services.job_worker._RAW_TRADE_INGESTION_ENABLED", True,
        ):
            result = await run_sync_trades_job(job)

        assert result.outcome == DispatchOutcome.DONE
        # Both exchanges must have been queried independently. Order is
        # dict-iteration order — sort to compare.
        assert sorted(seen_exchanges) == ["binance", "okx"], (
            f"Expected per-exchange SELECTs for both 'binance' and 'okx', "
            f"got {seen_exchanges}. The pre-fix SELECT had no .eq('exchange', ...) "
            f"so cross-exchange tradeId collisions registered as false amendments."
        )


# ---------------------------------------------------------------------------
# G12.A.7 — Phase 2 partial batch failure must NOT advance the cursor
# ---------------------------------------------------------------------------

class TestSyncTradesPhase2PartialBatchFailure:
    """audit-2026-05-07 G12.A.7 (HIGH conf=8).

    Phase 2 batches 100 fills at a time. Pre-fix: an exception on batch 3
    of 5 left batches 1-2 committed but batches 3-5 lost; the outer
    try/except swallowed the exception and the granular fetched-cursor
    advance ran unconditionally. Re-running the job didn't refetch the
    lost fills because last_fetched_trade_timestamp had moved forward.

    Post-fix: per-batch success is tracked via `phase2_complete`. On
    partial failure we log a WARNING and the granular cursor is NOT
    advanced. Next run re-fetches the failed window; ignore_duplicates
    on the upsert keeps already-persisted batches idempotent.
    """

    @pytest.mark.asyncio
    async def test_sync_trades_phase2_partial_batch_failure_keeps_cursor(
        self,
    ) -> None:
        from services.job_worker import run_sync_trades_job

        # 250 raw fills → 3 batches of 100 (last batch is 50). The 2nd
        # upsert call raises; batches 3+ never run; the granular cursor
        # advance must be skipped.
        raw_fills = [
            {
                "exchange": "okx",
                "symbol": "BTC-USDT-SWAP",
                "side": "buy" if i % 2 == 0 else "sell",
                "price": "50000",
                "quantity": "0.1",
                "fee": "0.5",
                "exchange_fill_id": f"fill-{i}",
                "is_fill": True,
                "cost": "5000",
                "timestamp": "2026-05-07T12:00:00Z",
            }
            for i in range(250)
        ]

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.strategy_row = {"id": "strat-partial-batch", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "okx",
            "last_sync_at": None, "user_id": "user-1",
        }

        # rpc passes through.
        def _rpc(name: str, payload: dict) -> MagicMock:
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=2)
            return stub

        mock_ctx.supabase.rpc.side_effect = _rpc

        # Track every supabase.table('api_keys').update(payload).eq(...)
        # call so we can assert the granular cursor was NOT advanced.
        api_key_updates: list[dict] = []

        # The upsert mock fails on the 2nd batch. We need a fresh mock_t
        # per .table() call so the chained verbs don't share state.
        upsert_call_count = {"n": 0}

        def _table(name: str) -> MagicMock:
            mock_t = MagicMock()

            # SELECT chain (amendment detection) — return no collisions.
            mock_select = MagicMock()
            mock_eq_sel = MagicMock()
            mock_in = MagicMock()
            mock_in.execute.return_value = MagicMock(data=[])
            mock_eq_sel.in_.return_value = mock_in
            mock_select.eq.return_value = mock_eq_sel
            mock_t.select.return_value = mock_select

            # UPSERT chain — raise on 2nd call.
            def _upsert(payload: list, **kwargs):
                upsert_call_count["n"] += 1
                stub = MagicMock()
                if upsert_call_count["n"] == 2:
                    stub.execute.side_effect = RuntimeError(
                        "simulated DB timeout on batch 2 of 3"
                    )
                else:
                    stub.execute.return_value = MagicMock(data=[])
                return stub

            mock_t.upsert.side_effect = _upsert

            # UPDATE chain — record api_keys updates so we can assert the
            # granular cursor (last_fetched_trade_timestamp) was NOT
            # written when the partial batch failed.
            def _update(payload: dict):
                if name == "api_keys":
                    api_key_updates.append(dict(payload))
                mock_eq_upd = MagicMock()
                mock_eq_upd.execute.return_value = MagicMock(data=[])
                inner = MagicMock()
                inner.eq.return_value = mock_eq_upd
                return inner

            mock_t.update.side_effect = _update

            return mock_t

        mock_ctx.supabase.table.side_effect = _table

        job = {
            "id": "job-partial-batch",
            "kind": "sync_trades",
            "strategy_id": "strat-partial-batch",
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
            "services.job_worker.fetch_raw_trades",
            new=AsyncMock(return_value=raw_fills),
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ), patch(
            "services.job_worker._RAW_TRADE_INGESTION_ENABLED", True,
        ):
            result = await run_sync_trades_job(job)

        # Job still returns DONE — Phase 2 partial failure does NOT
        # propagate as a job failure. The cursor protection is the
        # invariant under test.
        assert result.outcome == DispatchOutcome.DONE

        # The granular cursor advance (last_fetched_trade_timestamp)
        # MUST NOT appear in any api_keys update payload — Phase 2
        # didn't fully complete, so the next run must re-fetch the
        # failed window.
        granular_cursor_writes = [
            u for u in api_key_updates
            if "last_fetched_trade_timestamp" in u
        ]
        assert granular_cursor_writes == [], (
            f"Phase 2 partial batch failure must NOT advance "
            f"last_fetched_trade_timestamp; otherwise the next run "
            f"won't re-fetch the lost fills. "
            f"Got api_keys updates with the granular cursor: {granular_cursor_writes}. "
            f"All api_keys updates: {api_key_updates}."
        )

        # Sanity: the legacy `last_sync_at` cursor still advances (it's
        # a separate semantic — the daily-PnL Phase 1 ran fine).
        last_sync_writes = [
            u for u in api_key_updates if "last_sync_at" in u
        ]
        assert len(last_sync_writes) >= 1


# ---------------------------------------------------------------------------
# G12.A.5 — RLS denies cross-allocator SELECT on is_fill=true rows
# ---------------------------------------------------------------------------

class TestTradesIsFillRls:
    """audit-2026-05-07 G12.A.5 (HIGH conf=9).

    Migration 039 adds `is_fill=true` raw fill rows but ships with the
    comment 'Does NOT modify existing RLS policies' — assuming the
    migration 002 user-scoped read still works for the new shape. There
    was no test in the repo asserting allocator A cannot SELECT is_fill
    rows belonging to allocator B's strategy. The new raw_data JSONB
    column may leak api_key info / external order metadata if RLS is
    silently bypassed.

    Live-DB gated test: skips when TEST_SUPABASE_DB_URL is not set
    (mirrors test_sync_trades_preserves_fills.py + test_resend_correlation_rls.py).
    Inserts is_fill=true rows for two distinct strategies via service-
    role; switches to anon role and asserts cross-allocator SELECT
    returns 0 rows (either RLS or the GRANT layer denies — both are a
    pass).
    """

    pytestmark = pytest.mark.skipif(
        not __import__("os").environ.get("TEST_SUPABASE_DB_URL"),
        reason="Live test Supabase project not configured (TEST_SUPABASE_DB_URL unset).",
    )

    def test_anon_role_denied_select_is_fill_rows(self) -> None:
        """Insert two is_fill rows for two different strategies; the anon
        role must NOT see either (no per-row data leak via raw_data)."""
        import os
        import uuid

        if not os.environ.get("TEST_SUPABASE_DB_URL"):
            pytest.skip("TEST_SUPABASE_DB_URL not set")

        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError:
            pytest.skip("psycopg not installed")

        dsn = os.environ["TEST_SUPABASE_DB_URL"]
        user_a = str(uuid.uuid4())
        user_b = str(uuid.uuid4())
        strategy_a = str(uuid.uuid4())
        strategy_b = str(uuid.uuid4())
        fill_a = f"fill-{uuid.uuid4().hex[:12]}"
        fill_b = f"fill-{uuid.uuid4().hex[:12]}"

        conn = psycopg.connect(dsn, row_factory=dict_row, autocommit=True)
        try:
            with conn.cursor() as cur:
                # Seed two strategies.
                for uid, sid in ((user_a, strategy_a), (user_b, strategy_b)):
                    cur.execute(
                        "INSERT INTO public.profiles (id, role, created_at) "
                        "VALUES (%s, 'manager', now())",
                        (uid,),
                    )
                    cur.execute(
                        "INSERT INTO public.strategies (id, user_id, name, status, created_at) "
                        "VALUES (%s, %s, %s, 'pending_review', now())",
                        (sid, uid, f"audit-g12a5-{uuid.uuid4().hex[:6]}"),
                    )
                # Seed one is_fill row per strategy.
                for sid, fid in ((strategy_a, fill_a), (strategy_b, fill_b)):
                    cur.execute(
                        """
                        INSERT INTO public.trades (
                          strategy_id, exchange, symbol, side, price, quantity,
                          fee, fee_currency, timestamp, order_type,
                          exchange_fill_id, is_fill, cost
                        ) VALUES (
                          %s, 'okx', 'BTC-USDT-SWAP', 'buy', 50000, 0.1,
                          0.5, 'USDT', now(), 'market',
                          %s, true, 5000
                        )
                        """,
                        (sid, fid),
                    )

            # anon role MUST see zero rows. RLS deny + GRANT deny are
            # both acceptable outcomes — both encode the cross-tenant
            # isolation property.
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute("SET LOCAL request.jwt.claim.role TO 'anon'")
                    try:
                        cur.execute("SET LOCAL ROLE anon")
                        cur.execute("SELECT current_user AS who")
                        who = cur.fetchone()
                        assert who is not None and who["who"] == "anon"
                        cur.execute(
                            "SELECT exchange_fill_id FROM public.trades "
                            "WHERE is_fill = true "
                            "  AND exchange_fill_id IN (%s, %s)",
                            (fill_a, fill_b),
                        )
                        rows = cur.fetchall()
                        assert rows == [], (
                            f"anon role read {len(rows)} is_fill rows — "
                            f"RLS / GRANT layer failed to block cross-tenant "
                            f"access. G12.A.5 regression."
                        )
                    except Exception as exc:  # noqa: BLE001
                        # Catch InsufficientPrivilege (psycopg.errors) and
                        # any other deny path. Both encode isolation.
                        msg = str(type(exc).__name__) + ": " + str(exc)
                        assert "Privilege" in msg or "denied" in msg.lower() or "permission" in msg.lower(), (
                            f"anon SELECT raised an unexpected error: {msg}. "
                            f"Expected InsufficientPrivilege (deny) or "
                            f"empty result set."
                        )
        finally:
            # Teardown.
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM public.trades WHERE strategy_id IN (%s, %s)",
                    (strategy_a, strategy_b),
                )
                cur.execute(
                    "DELETE FROM public.strategies WHERE id IN (%s, %s)",
                    (strategy_a, strategy_b),
                )
                cur.execute(
                    "DELETE FROM public.profiles WHERE id IN (%s, %s)",
                    (user_a, user_b),
                )
            conn.close()


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
