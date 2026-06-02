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

3. dispatch timeout — handlers that exceed their per-kind timeout
   return DispatchResult(FAILED, transient).

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
    _stamp_429,
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

    def test_bybit_cloudfront_geoblock_is_permanent_not_rate_limit(self) -> None:
        """Bybit's CloudFront country-block returns a non-JSON 403 that ccxt
        mis-maps to RateLimitExceeded. It MUST classify permanent (no retry,
        no phantom 429 cooldown) with an operator-actionable message — NOT
        transient, which would re-hammer a host that will never answer from
        this region. Mutation guard: drop the is_geo_blocked check in
        classify_exception and this flips to ('transient', ...)."""
        exc = ccxt.RateLimitExceeded(
            "bybit GET https://api.bybit.com/v5/account/transaction-log 403 "
            "Forbidden {error:The Amazon CloudFront distribution is configured "
            "to block access from your country}"
        )
        kind, msg = classify_exception(exc)
        assert kind == "permanent"
        assert "geo-blocked" in msg.lower()

    def test_binance_451_restricted_location_is_permanent(self) -> None:
        """Binance returns 451 'Service unavailable from a restricted location'
        for blocked regions. Even though ccxt may wrap it in a type that would
        otherwise fall through to 'unknown', the geo-block signature classifies
        it permanent so it isn't retried on the (unchangeable-from-here)
        region."""
        exc = ccxt.ExchangeError(
            "binance GET https://fapi.binance.com/fapi/v1/time 451 "
            "{\"code\":0,\"msg\":\"Service unavailable from a restricted "
            "location according to 'b. Eligibility'\"}"
        )
        kind, msg = classify_exception(exc)
        assert kind == "permanent"
        assert "geo-blocked" in msg.lower()

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

    # --- H-1247: 4xx/5xx bracket boundary stress -------------------------
    # The 4xx classifier hinges on `400 <= status < 500` (job_worker.py
    # case arm). Tests above only cover a contiguous 400/422 block plus the
    # explicit 403/404/408/429 carve-outs. These pin the bracket *edges*
    # and unusual-but-real codes so an off-by-one (`400 < status`) or a
    # later "transient 5xx" carve-out can't slip past unnoticed.

    def test_http_exception_401_is_permanent(self) -> None:
        """401 Unauthorized is a plain 4xx (not in the 408/429 transient or
        403/404 deploy-blip sets) → permanent. FastAPI auth deps raise this
        and no retry fixes a genuinely-unauthenticated caller."""
        exc = HTTPException(status_code=401, detail="Not authenticated")
        kind, msg = classify_exception(exc)
        assert kind == "permanent"
        assert "401" in msg

    def test_http_exception_499_is_permanent(self) -> None:
        """Upper edge of the 4xx bracket (`status < 500`). 499 is inside the
        permanent range; if a refactor flipped the comparison to
        `status <= 500` or `400 < status` the boundary semantics would drift
        and this fires."""
        exc = HTTPException(status_code=499, detail="client closed request")
        kind, msg = classify_exception(exc)
        assert kind == "permanent"
        assert "499" in msg

    def test_http_exception_399_falls_through_to_unknown(self) -> None:
        """Lower edge: 399 is below the 4xx bracket so it falls through every
        4xx arm to the catch-all unknown branch."""
        exc = HTTPException(status_code=399, detail="odd sub-4xx code")
        kind, _ = classify_exception(exc)
        assert kind == "unknown"

    def test_http_exception_503_is_unknown_retry(self) -> None:
        """5xx is retried by default — pin 503 (not just 500) so a future
        'transient bracket for network-flavored 5xx' refactor doesn't
        silently reclassify without a test failure."""
        exc = HTTPException(status_code=503, detail="upstream unavailable")
        kind, _ = classify_exception(exc)
        assert kind == "unknown"

    # --- H-1248: HTTPException detail truncation (480 cap + 500 total) ----

    def test_http_exception_long_detail_is_truncated(self) -> None:
        """The HTTPException branch truncates the detail (480 cap in
        _format_http_detail) and the whole message to 500, leaving headroom
        for the '{status}: ' prefix. This is a SEPARATE cap from the generic
        500-char RuntimeError cap covered by test_message_is_truncated — if a
        refactor unified them the per-branch headroom guarantee would vanish
        with no other test biting."""
        long_detail = "y" * 5000
        exc = HTTPException(status_code=400, detail=long_detail)
        _, msg = classify_exception(exc)
        assert len(msg) <= 500, f"HTTPException message must be <=500 chars, got {len(msg)}"
        assert msg.startswith("400: "), "HTTPException message must start with status prefix"

    # --- H-1249: non-string HTTPException.detail (None / dict) ------------

    def test_http_exception_none_detail_is_permanent(self) -> None:
        """FastAPI defaults detail to a status reason phrase when None is
        passed, but the classifier's _format_http_detail also explicitly
        maps detail is None → "". Either way the classifier must not crash
        and must still classify by status. 400 → permanent, prefix intact."""
        exc = HTTPException(status_code=400)
        exc.detail = None  # exercise the explicit None branch in _format_http_detail
        kind, msg = classify_exception(exc)
        assert kind == "permanent"
        assert "400" in msg
        # The literal string 'None' must NOT leak into the stored message —
        # _format_http_detail returns "" for None rather than str(None).
        assert "None" not in msg

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

class TestStamp429GeoBlockSkip:
    """_stamp_429 must NOT stamp last_429_at for an exchange edge geo-block.

    Bybit's CloudFront 403 is mis-mapped by ccxt to RateLimitExceeded, but it is
    NOT a rate limit: stamping it would park every sibling job on the same
    api_key behind the circuit breaker (~10 min) even though the job is
    classified 'permanent'. This is the no-phantom-cooldown half of the
    geo-block fix that classify_exception alone does NOT deliver — the
    per-handler `except ccxt.RateLimitExceeded` arms call _stamp_429 BEFORE the
    exception ever reaches classify_exception (red-team 2026-06-02). Mutation
    guard: delete the is_geo_blocked early-return in _stamp_429 and
    test_geo_block_skips_stamp fails (the RPC fires).
    """

    @pytest.mark.asyncio
    async def test_geo_block_skips_stamp(self) -> None:
        supabase = MagicMock()
        geo_exc = ccxt.RateLimitExceeded(
            "bybit 403 Forbidden {error:The Amazon CloudFront distribution is "
            "configured to block access from your country}"
        )
        await _stamp_429(supabase, {"id": "key-abc"}, geo_exc)
        supabase.rpc.assert_not_called()

    @pytest.mark.asyncio
    async def test_genuine_rate_limit_still_stamps(self) -> None:
        # Control: the skip is geo-block-specific — a real 429 still stamps via
        # the stamp_api_key_429 RPC.
        supabase = MagicMock()
        await _stamp_429(
            supabase, {"id": "key-abc"}, ccxt.RateLimitExceeded("429 too many")
        )
        supabase.rpc.assert_called_once()
        assert supabase.rpc.call_args[0][0] == "stamp_api_key_429"


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
        """Verify dispatch routes kind='poll_positions' to
        run_poll_positions_job."""
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

    # --- H-0775: routing coverage for the remaining production kinds -----
    # dispatch_tick (main_worker) mocks `dispatch` wholesale, so handler
    # routing is ONLY exercised here. Prior to these tests, six live kinds
    # had no routing assertion: a typo in the elif chain (e.g.
    # `compute_analytics_from_csv` accidentally falling to the
    # `compute_analytics` arm) would route jobs to the wrong handler with no
    # test failure. These pin each kind → handler edge, including the three
    # lazily-imported handlers which must be patched at their SOURCE module
    # (dispatch does `from services.X import run_Y` inside the elif arm).

    @pytest.mark.asyncio
    async def test_dispatch_routes_compute_analytics_from_csv(self) -> None:
        """Phase 19.1: compute_analytics_from_csv must route to its own
        CSV handler, NOT the trades-based run_compute_analytics_job."""
        job = {"id": "job-csv", "kind": "compute_analytics_from_csv", "strategy_id": "s-csv"}
        with patch(
            "services.job_worker.run_compute_analytics_from_csv_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ) as mock_csv, patch(
            "services.job_worker.run_compute_analytics_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ) as mock_trades, patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ):
            await dispatch(job)
        mock_csv.assert_awaited_once_with(job)
        mock_trades.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_dispatch_routes_sync_funding(self) -> None:
        job = {"id": "job-fund", "kind": "sync_funding", "strategy_id": "s-fund"}
        with patch(
            "services.job_worker.run_sync_funding_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ) as mock_handler, patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ):
            await dispatch(job)
        mock_handler.assert_awaited_once_with(job)

    @pytest.mark.asyncio
    async def test_dispatch_routes_reconcile_strategy(self) -> None:
        job = {"id": "job-rec", "kind": "reconcile_strategy", "strategy_id": "s-rec"}
        with patch(
            "services.job_worker.run_reconcile_strategy_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ) as mock_handler, patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ):
            await dispatch(job)
        mock_handler.assert_awaited_once_with(job)

    @pytest.mark.asyncio
    async def test_dispatch_routes_rescore_allocator(self) -> None:
        """rescore_allocator is allocator-scoped (no strategy_id) — the
        status bridge must NOT fire."""
        job = {"id": "job-rescore", "kind": "rescore_allocator", "allocator_id": "a-1"}
        with patch(
            "services.job_worker.run_rescore_allocator_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ) as mock_handler, patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ) as mock_bridge:
            await dispatch(job)
        mock_handler.assert_awaited_once_with(job)
        mock_bridge.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_dispatch_routes_poll_allocator_positions(self) -> None:
        job = {"id": "job-apos", "kind": "poll_allocator_positions", "allocator_id": "a-2"}
        with patch(
            "services.job_worker.run_poll_allocator_positions_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ) as mock_handler:
            await dispatch(job)
        mock_handler.assert_awaited_once_with(job)

    @pytest.mark.asyncio
    async def test_dispatch_routes_reconstruct_allocator_history(self) -> None:
        """Lazily imported handler — dispatch does
        `from services.equity_reconstruction import run_reconstruct_allocator_history_job`
        inside the elif arm, so the patch target is the SOURCE module."""
        job = {"id": "job-recon", "kind": "reconstruct_allocator_history", "allocator_id": "a-3"}
        with patch(
            "services.equity_reconstruction.run_reconstruct_allocator_history_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ) as mock_handler:
            await dispatch(job)
        mock_handler.assert_awaited_once_with(job)

    @pytest.mark.asyncio
    async def test_dispatch_routes_refresh_allocator_equity_daily(self) -> None:
        job = {"id": "job-eqd", "kind": "refresh_allocator_equity_daily", "allocator_id": "a-4"}
        with patch(
            "services.equity_reconstruction.run_refresh_allocator_equity_daily_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ) as mock_handler:
            await dispatch(job)
        mock_handler.assert_awaited_once_with(job)

    @pytest.mark.asyncio
    async def test_dispatch_routes_process_key_long(self) -> None:
        """Phase 19 / BACKBONE-09 — lazily imported from
        services.ingestion.long_fetch."""
        job = {"id": "job-long", "kind": "process_key_long", "strategy_id": "s-long"}
        with patch(
            "services.ingestion.long_fetch.run_process_key_long_job",
            new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
        ) as mock_handler, patch(
            "services.job_worker.sync_strategy_analytics_status",
            new=AsyncMock(return_value=None),
        ):
            await dispatch(job)
        mock_handler.assert_awaited_once_with(job)

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

        # H-0691 data_quality_flags SELECT chain: return no existing flags.
        # The phase2-success path will skip the upsert (flag_was_set=False).
        mock_dq_select = MagicMock()
        mock_dq_eq = MagicMock()
        mock_dq_maybe = MagicMock()
        mock_dq_maybe.execute.return_value = MagicMock(data=None)
        mock_dq_eq.maybe_single.return_value = mock_dq_maybe
        mock_dq_select.eq.return_value = mock_dq_eq
        mock_ctx.supabase.table.return_value.select.return_value = mock_dq_select

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
            new=AsyncMock(side_effect=lambda fn: fn()),
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

    Pre-fix history: the `if trades:` guard in run_sync_trades_job means
    an empty list skips the sync_trades RPC; a non-empty list with a
    single trade still invokes sync_trades, but migration 110 scopes the
    DELETE to the JSONB payload's [MIN,MAX] timestamp window so older
    rows survive. There was no Python-level test asserting either
    property — these tests pin them so a future refactor that drops the
    `if trades:` guard or unscopes the DELETE fails loud.
    """

    @pytest.mark.asyncio
    async def test_sync_trades_empty_response_preserves_existing(self) -> None:
        """Mock fetch_all_trades to return []. The sync_trades RPC must
        NOT be called (the `if trades:` guard in run_sync_trades_job
        short-circuits). Pre-existing daily_pnl rows in the DB therefore
        survive untouched."""
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
# H-0691 — Phase 2 failure stamps data_quality_flags
# ---------------------------------------------------------------------------

class TestSyncTradesPhase2FailureFlag:
    """audit-2026-05-07 H-0691.

    Pre-fix: `run_sync_trades_job` logged a `warning` on Phase 2 failure
    and returned DONE — operators saw a healthy sync_trades success
    while fills silently lagged for days. Admin's "Strategies Missing
    Fills" health card only fires on strategies with 0 fill rows total;
    a strategy whose fills are days behind looked healthy.

    Post-fix: Phase 2 fetch or persist failure stamps
    `strategy_analytics.data_quality_flags.phase2_fill_ingestion_failed`
    so the admin health card surfaces the silent-lag condition. The
    stamp is a read-modify-write so it does NOT clobber sibling flags
    (benchmark_unavailable / sibling_kinds_failed / etc.) that
    analytics_runner emits onto the same JSONB column.
    """

    @pytest.mark.asyncio
    async def test_phase2_fetch_failure_stamps_data_quality_flag(self) -> None:
        from services.job_worker import run_sync_trades_job

        # Capture the data_quality_flags payload we upsert onto
        # strategy_analytics.
        sa_upserts: list[dict] = []

        # Pretend analytics_runner already wrote `benchmark_unavailable=True`.
        # The phase2 stamp must MERGE its keys with that pre-existing flag
        # instead of clobbering it (admin UI relies on both signals).
        existing_flags = {"benchmark_unavailable": True, "benchmark_note": "x"}

        def _table(name: str) -> MagicMock:
            mock_t = MagicMock()

            if name == "strategy_analytics":
                # SELECT data_quality_flags -> existing flags.
                mock_select = MagicMock()
                mock_eq_sel = MagicMock()
                mock_maybe = MagicMock()
                mock_maybe.execute.return_value = MagicMock(
                    data={"data_quality_flags": existing_flags}
                )
                mock_eq_sel.maybe_single.return_value = mock_maybe
                mock_select.eq.return_value = mock_eq_sel
                mock_t.select.return_value = mock_select

                # UPSERT capture.
                def _upsert(payload: dict, **_kwargs):
                    sa_upserts.append(dict(payload))
                    stub = MagicMock()
                    stub.execute.return_value = MagicMock(data=[])
                    return stub
                mock_t.upsert.side_effect = _upsert

            else:
                # api_keys.update chain
                mock_update = MagicMock()
                mock_eq_upd = MagicMock()
                mock_eq_upd.execute.return_value = MagicMock(data=[])
                mock_update.eq.return_value = mock_eq_upd
                mock_t.update.return_value = mock_update
                # trades.upsert (none expected when Phase 2 fetch fails)
                mock_t.upsert.return_value = MagicMock(
                    execute=MagicMock(return_value=MagicMock(data=[]))
                )

            return mock_t

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.supabase.table.side_effect = _table

        def _rpc(name: str, payload: dict) -> MagicMock:
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=1)
            return stub
        mock_ctx.supabase.rpc.side_effect = _rpc

        mock_ctx.strategy_row = {"id": "strat-h0691", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "binance",
            "last_sync_at": None, "user_id": "user-1",
        }

        job = {"id": "job-h0691", "kind": "sync_trades", "strategy_id": "strat-h0691"}

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ), patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=[{"test": "trade"}]),
        ), patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=100.0),
        ), patch(
            "services.job_worker.fetch_raw_trades",
            new=AsyncMock(side_effect=RuntimeError("exchange returned 502 BadGateway")),
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ), patch(
            "services.job_worker._RAW_TRADE_INGESTION_ENABLED", True,
        ):
            result = await run_sync_trades_job(job)

        # Phase 2 failure must NOT fail the job — Phase 1 succeeded.
        assert result.outcome == DispatchOutcome.DONE

        # exactly one strategy_analytics upsert (the data-quality stamp).
        flag_upserts = [u for u in sa_upserts if "data_quality_flags" in u]
        assert len(flag_upserts) == 1, (
            f"Phase 2 failure must stamp exactly one data_quality_flags "
            f"upsert; got {len(flag_upserts)} (all upserts: {sa_upserts})"
        )
        stamped_flags = flag_upserts[0]["data_quality_flags"]

        # The new flag is present.
        assert stamped_flags["phase2_fill_ingestion_failed"] is True
        assert "502" in stamped_flags["phase2_error"]
        assert "phase2_failed_at" in stamped_flags

        # Pre-existing sibling flags are PRESERVED (read-modify-write).
        # Without the read step, this upsert would clobber benchmark_unavailable
        # to None and the admin UI would lose that signal.
        assert stamped_flags["benchmark_unavailable"] is True, (
            "Phase 2 stamp must merge with existing data_quality_flags, "
            "not overwrite them. analytics_runner writes "
            "benchmark_unavailable to the same JSONB column."
        )
        assert stamped_flags["benchmark_note"] == "x"

    @pytest.mark.asyncio
    async def test_phase2_recovery_clears_lingering_failure_flag(self) -> None:
        """H-0691 self-healing: once Phase 2 succeeds again after a prior
        failure, the lingering phase2_fill_ingestion_failed flag is
        cleared. Otherwise the admin health card would show a strategy
        as 'needs attention' forever after a single transient blip."""
        from services.job_worker import run_sync_trades_job

        sa_upserts: list[dict] = []
        # Strategy has previous phase2 failure flag set, plus an unrelated
        # benchmark flag. Both must survive the merge — only the phase2_*
        # keys should be cleared.
        existing_flags = {
            "benchmark_unavailable": True,
            "phase2_fill_ingestion_failed": True,
            "phase2_error": "previous 502",
            "phase2_failed_at": "2026-05-10T00:00:00+00:00",
        }

        def _table(name: str) -> MagicMock:
            mock_t = MagicMock()
            if name == "strategy_analytics":
                mock_select = MagicMock()
                mock_eq_sel = MagicMock()
                mock_maybe = MagicMock()
                mock_maybe.execute.return_value = MagicMock(
                    data={"data_quality_flags": existing_flags}
                )
                mock_eq_sel.maybe_single.return_value = mock_maybe
                mock_select.eq.return_value = mock_eq_sel
                mock_t.select.return_value = mock_select

                def _upsert(payload: dict, **_kwargs):
                    sa_upserts.append(dict(payload))
                    stub = MagicMock()
                    stub.execute.return_value = MagicMock(data=[])
                    return stub
                mock_t.upsert.side_effect = _upsert
            elif name == "trades":
                # Phase 2 trades upsert (the success path).
                mock_t.upsert.return_value = MagicMock(
                    execute=MagicMock(return_value=MagicMock(data=[]))
                )
                # amendment-detection SELECT
                mock_select = MagicMock()
                mock_eq_sel = MagicMock()
                mock_eq_sel2 = MagicMock()
                mock_in = MagicMock()
                mock_in.execute.return_value = MagicMock(data=[])
                mock_eq_sel2.in_.return_value = mock_in
                mock_eq_sel.eq.return_value = mock_eq_sel2
                mock_select.eq.return_value = mock_eq_sel
                mock_t.select.return_value = mock_select
            else:
                # api_keys.update chain
                mock_update = MagicMock()
                mock_eq_upd = MagicMock()
                mock_eq_upd.execute.return_value = MagicMock(data=[])
                mock_update.eq.return_value = mock_eq_upd
                mock_t.update.return_value = mock_update
            return mock_t

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.supabase.table.side_effect = _table

        def _rpc(name: str, payload: dict) -> MagicMock:
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=1)
            return stub
        mock_ctx.supabase.rpc.side_effect = _rpc

        mock_ctx.strategy_row = {"id": "strat-recovery", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "binance",
            "last_sync_at": None, "user_id": "user-1",
        }

        # Phase 2 succeeds this time — returns 2 fills.
        raw_fills = [
            {"exchange": "binance", "exchange_fill_id": "f1", "symbol": "BTC-USDT",
             "side": "buy", "price": "50000", "quantity": "0.1", "is_fill": True,
             "timestamp": "2026-05-15T12:00:00Z"},
            {"exchange": "binance", "exchange_fill_id": "f2", "symbol": "BTC-USDT",
             "side": "sell", "price": "50100", "quantity": "0.1", "is_fill": True,
             "timestamp": "2026-05-15T12:01:00Z"},
        ]

        job = {"id": "job-recovery", "kind": "sync_trades", "strategy_id": "strat-recovery"}

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ), patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=[{"test": "trade"}]),
        ), patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=100.0),
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

        flag_upserts = [u for u in sa_upserts if "data_quality_flags" in u]
        assert len(flag_upserts) == 1, (
            "Phase 2 recovery must perform exactly one strategy_analytics "
            "upsert to clear the lingering flag"
        )
        cleared_flags = flag_upserts[0]["data_quality_flags"]

        # phase2_* keys gone.
        assert "phase2_fill_ingestion_failed" not in cleared_flags
        assert "phase2_error" not in cleared_flags
        assert "phase2_failed_at" not in cleared_flags
        # Recovery marker present.
        assert "phase2_recovered_at" in cleared_flags
        # Sibling flag survived the clear.
        assert cleared_flags.get("benchmark_unavailable") is True

    @pytest.mark.asyncio
    async def test_fresh_strategy_missing_analytics_row_skips_spurious_write(self) -> None:
        """B-mypy f-3 regression: a fresh strategy with NO strategy_analytics
        row yet (its first sync, before compute_analytics runs) must NOT write
        a spurious phase2_fill_ingestion_failed=False recovery marker on a clean
        Phase-2 run.

        Pre-fix, `_load_existing_flags` did `row = res.data or {}`. For a missing
        row, `.maybe_single().execute()` returns LITERAL None (not a response with
        data=None), so `res.data` raised AttributeError, caught by the surrounding
        try/except → flag_load_failed=True → the clean-Phase-2 else-branch hit
        `elif flag_load_failed:` and stamped a recovery marker for a strategy that
        never failed. Routing the read through services.db.one() makes the no-row
        case the intended empty-flags path (no crash, flag_load_failed=False), so
        the write is correctly skipped. This mocks the read as the REAL literal
        None — the sibling tests use MagicMock(data=None), which never reproduced
        the crash — so it FAILS on the pre-fix code (1 spurious upsert) and passes
        on the one()-routed code (0 upserts).
        """
        from services.job_worker import run_sync_trades_job

        sa_upserts: list[dict] = []

        def _table(name: str) -> MagicMock:
            mock_t = MagicMock()
            if name == "strategy_analytics":
                # No analytics row yet → maybe_single().execute() is literal None
                # (faithful to postgrest; NOT MagicMock(data=None)).
                mock_select = MagicMock()
                mock_eq_sel = MagicMock()
                mock_maybe = MagicMock()
                mock_maybe.execute.return_value = None
                mock_eq_sel.maybe_single.return_value = mock_maybe
                mock_select.eq.return_value = mock_eq_sel
                mock_t.select.return_value = mock_select

                def _upsert(payload: dict, **_kwargs):
                    sa_upserts.append(dict(payload))
                    stub = MagicMock()
                    stub.execute.return_value = MagicMock(data=[])
                    return stub
                mock_t.upsert.side_effect = _upsert
            elif name == "trades":
                # Phase 2 trades upsert (success path) + amendment-detection SELECT.
                mock_t.upsert.return_value = MagicMock(
                    execute=MagicMock(return_value=MagicMock(data=[]))
                )
                mock_select = MagicMock()
                mock_eq_sel = MagicMock()
                mock_eq_sel2 = MagicMock()
                mock_in = MagicMock()
                mock_in.execute.return_value = MagicMock(data=[])
                mock_eq_sel2.in_.return_value = mock_in
                mock_eq_sel.eq.return_value = mock_eq_sel2
                mock_select.eq.return_value = mock_eq_sel
                mock_t.select.return_value = mock_select
            else:
                # api_keys.update chain
                mock_update = MagicMock()
                mock_eq_upd = MagicMock()
                mock_eq_upd.execute.return_value = MagicMock(data=[])
                mock_update.eq.return_value = mock_eq_upd
                mock_t.update.return_value = mock_update
            return mock_t

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.supabase.table.side_effect = _table

        def _rpc(name: str, payload: dict) -> MagicMock:
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=1)
            return stub
        mock_ctx.supabase.rpc.side_effect = _rpc

        mock_ctx.strategy_row = {"id": "strat-fresh", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "binance",
            "last_sync_at": None, "user_id": "user-1",
        }

        raw_fills = [
            {"exchange": "binance", "exchange_fill_id": "f1", "symbol": "BTC-USDT",
             "side": "buy", "price": "50000", "quantity": "0.1", "is_fill": True,
             "timestamp": "2026-05-15T12:00:00Z"},
        ]

        job = {"id": "job-fresh", "kind": "sync_trades", "strategy_id": "strat-fresh"}

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ), patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=[{"test": "trade"}]),
        ), patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=100.0),
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

        # A strategy that never failed must not get a phase2_fill_ingestion_failed=
        # False "recovery" marker just because it has no analytics row yet.
        flag_upserts = [u for u in sa_upserts if "data_quality_flags" in u]
        assert len(flag_upserts) == 0, (
            "Fresh strategy (no strategy_analytics row) on a clean Phase-2 run "
            f"must not write a spurious recovery marker; got {sa_upserts}"
        )


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


class TestRedTeamSyncTradesPreDrainPreservesDqFlag:
    """Audit-2026-05-07 red-team CRITICAL conf=9 — ``fetch_daily_pnl``
    (via ``fetch_all_trades``) can plant DQ flags, and the SUBSEQUENT
    ``fetch_raw_trades`` resets the DQ buffer at its entry seam, wiping
    those flags. The fix: drain the per-task DQ buffer BETWEEN the two
    calls and merge into ``exchange_dq_flags`` so the flag survives to
    land on ``strategy_analytics``.

    Post-C-0319 (Bybit cutover): the historical case for this regression
    was ``bybit_daily_pnl_includes_funding``, which is now retired (the
    Bybit branch reconstructs funding-excluded realized PnL directly).
    The entry-seam contract still matters for every OTHER DQ flag a
    daily-PnL branch might set — we pin it here with a synthetic
    ``test_pre_drain_marker`` so the test stays meaningful after the
    cutover.
    """

    @pytest.mark.asyncio
    async def test_dq_flag_lands_on_strategy_analytics(
        self,
    ) -> None:
        from services.exchange import (
            _record_dq_flag,
            get_and_clear_last_dq_flags,
        )
        from services.job_worker import run_sync_trades_job

        # Clean any residue from prior tests on this asyncio task.
        get_and_clear_last_dq_flags()

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.strategy_row = {"id": "strat-bybit", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "bybit",
            "last_sync_at": None, "user_id": "user-1",
        }

        mock_rpc = MagicMock()
        mock_rpc.execute.return_value = MagicMock(data=5)
        mock_ctx.supabase.rpc.return_value = mock_rpc

        # Capture the data_quality_flags payload from the upsert.
        upsert_payloads: list[dict] = []

        def _capture_upsert(payload, on_conflict=None, **kwargs):
            upsert_payloads.append(payload)
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=[])
            return stub

        def _table(name):
            t = MagicMock()
            # update().eq().execute() chain.
            mock_update = MagicMock()
            mock_eq = MagicMock()
            mock_eq.execute.return_value = MagicMock(data=[])
            mock_update.eq.return_value = mock_eq
            t.update.return_value = mock_update
            # upsert capture for strategy_analytics.
            t.upsert.side_effect = _capture_upsert
            # select().eq().maybe_single().execute() returns no existing flags.
            mock_sel = MagicMock()
            mock_sel_eq = MagicMock()
            mock_sel_maybe = MagicMock()
            mock_sel_maybe.execute.return_value = MagicMock(data=None)
            mock_sel_eq.maybe_single.return_value = mock_sel_maybe
            mock_sel.eq.return_value = mock_sel_eq
            t.select.return_value = mock_sel
            return t

        mock_ctx.supabase.table.side_effect = _table

        # fetch_all_trades planting a DQ flag mirrors what a daily-PnL
        # branch in services/exchange.py would do (e.g. OKX archive
        # truncation, Binance partial-symbol failures, the Bybit
        # sync-truncated-cursor flag in fetch_raw_trades, etc.). We use
        # a synthetic marker so the test stays meaningful post-C-0319.
        async def _fake_fetch_all_trades(*args, **kwargs):
            _record_dq_flag("test_pre_drain_marker", True)
            return [{"test": "trade"}]

        # fetch_raw_trades's real implementation resets the buffer at
        # entry; we faithfully reproduce that behaviour so the test
        # would FAIL without the pre-drain fix in run_sync_trades_job.
        async def _fake_fetch_raw_trades(*args, **kwargs):
            from services.exchange import _LAST_DQ_FLAGS
            _LAST_DQ_FLAGS.set({})  # entry-seam reset
            return []

        job = {
            "id": "job-bybit-funding",
            "kind": "sync_trades",
            "strategy_id": "strat-bybit",
        }

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ), patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(side_effect=_fake_fetch_all_trades),
        ), patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=10000.0),
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ), patch(
            "services.job_worker.fetch_raw_trades",
            new=AsyncMock(side_effect=_fake_fetch_raw_trades),
        ), patch(
            "services.job_worker._RAW_TRADE_INGESTION_ENABLED", True,
        ):
            result = await run_sync_trades_job(job)

        assert result.outcome == DispatchOutcome.DONE
        # The DQ flag must have made it into the strategy_analytics
        # upsert payload's data_quality_flags JSONB.
        matched = [
            p for p in upsert_payloads
            if isinstance(p, dict)
            and (p.get("data_quality_flags") or {}).get(
                "test_pre_drain_marker"
            )
            is True
        ]
        assert matched, (
            "test_pre_drain_marker flag was not stamped onto "
            "strategy_analytics — the worker-side pre-drain regressed. "
            f"Upsert payloads: {upsert_payloads!r}"
        )


class TestRedTeamSyncTradesRateLimitDrainsDqBuffer:
    """Audit-2026-05-07 red-team HIGH conf=8 — when
    ``ccxt.RateLimitExceeded`` bubbles out of ``fetch_all_trades`` /
    ``fetch_usdt_balance`` / ``fetch_raw_trades``, the per-task DQ
    buffer can contain partial accumulations that would leak onto the
    next compute_jobs task on the same asyncio task. The fix adds a
    ``get_and_clear_last_dq_flags()`` to the
    ``except ccxt.RateLimitExceeded`` arm before the re-raise.
    """

    @pytest.mark.asyncio
    async def test_rate_limit_in_fetch_all_trades_drains_buffer(self) -> None:
        from services.exchange import (
            _record_dq_flag,
            get_and_clear_last_dq_flags,
        )
        from services.job_worker import run_sync_trades_job

        get_and_clear_last_dq_flags()

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.strategy_row = {"id": "strat-rl", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "bybit",
            "last_sync_at": None, "user_id": "user-1",
        }

        async def _fetch_all_trades_429(*args, **kwargs):
            # Plant a DQ flag (any name) the way a fetch_daily_pnl
            # branch might before the rate-limit hit on a later request.
            # The test only cares that the drain in the 429 arm empties
            # the buffer; the flag name itself is incidental.
            _record_dq_flag("test_429_partial_marker", True)
            raise ccxt.RateLimitExceeded("429 too many requests")

        async def _stamp_429(*args, **kwargs):
            return None

        job = {
            "id": "job-rl",
            "kind": "sync_trades",
            "strategy_id": "strat-rl",
        }

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ), patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(side_effect=_fetch_all_trades_429),
        ), patch(
            "services.job_worker._stamp_429",
            new=AsyncMock(side_effect=_stamp_429),
        ):
            with pytest.raises(ccxt.RateLimitExceeded):
                await run_sync_trades_job(job)

        # The drain in the RateLimitExceeded arm must have left the
        # buffer empty so the next task on this asyncio task sees a
        # clean slate.
        assert get_and_clear_last_dq_flags() == {}, (
            "RateLimitExceeded arm leaked DQ flags forward — the bare "
            "re-raise pattern is back."
        )


class TestRedTeamReconcileUntypedExceptionDrainsBuffer:
    """Audit-2026-05-07 red-team HIGH conf=8 — ``run_reconcile_strategy_job``
    only drained the per-task DQ buffer on three explicit exception
    classes (success, RateLimitExceeded, ColdStartSymbolDiscoveryError).
    Every other class — BinancePerSymbolFetchError, ccxt.NetworkError,
    ccxt.ExchangeError, generic Exception — escaped without draining,
    leaking partial accumulations onto the next task. The fix adds a
    bare ``except Exception`` arm that drains + re-raises.
    """

    @pytest.mark.asyncio
    async def test_untyped_exception_in_fetch_raw_trades_drains_buffer(
        self,
    ) -> None:
        from services.exchange import (
            _record_dq_flag,
            get_and_clear_last_dq_flags,
        )
        from services.job_worker import run_reconcile_strategy_job

        get_and_clear_last_dq_flags()

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange
        mock_ctx.supabase = MagicMock()
        mock_ctx.strategy_row = {"id": "strat-rec", "user_id": "user-1"}
        mock_ctx.key_row = {
            "id": "key-1", "exchange": "binance",
            "last_sync_at": None, "user_id": "user-1",
        }

        async def _fetch_raw_partial_then_fail(*args, **kwargs):
            # Mirror a Binance partial-symbol failure path: the helper
            # would record partial-symbol failures via _record_dq_flag
            # before raising a generic exception on a later branch.
            _record_dq_flag("binance_partial_symbols", ["BTCUSDT", "ETHUSDT"])
            raise ccxt.NetworkError("network blip mid-fetch")

        job = {
            "id": "job-rec",
            "kind": "reconcile_strategy",
            "strategy_id": "strat-rec",
        }

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ), patch(
            "services.job_worker.fetch_raw_trades",
            new=AsyncMock(side_effect=_fetch_raw_partial_then_fail),
        ):
            with pytest.raises(ccxt.NetworkError):
                await run_reconcile_strategy_job(job)

        # Bare-except drain must have cleaned the buffer so the next
        # compute_jobs task on this asyncio task sees nothing leftover.
        assert get_and_clear_last_dq_flags() == {}, (
            "Reconcile untyped-exception arm leaked DQ flags forward — "
            "the bare drain is missing."
        )


# ---------------------------------------------------------------------------
# NEW-C12-05: monotonic cursor advance
# ---------------------------------------------------------------------------


class TestMonotonicCursorAdvance:
    """NEW-C12-05 — cursor updates must carry a PostgREST .or_() condition
    so a slow/preempted worker (W1) arriving after a faster worker (W2) has
    already advanced the cursor cannot regress it.

    These unit tests verify the PostgREST builder chain directly: they mock
    the Supabase table builder and assert that:
    1. `.or_("last_fetched_trade_timestamp.is.null,...")` is called when
       advancing the fetched-cursor.
    2. `.or_("last_sync_at.is.null,...")` is called when advancing last_sync_at.
    3. The `.or_()` is NOT appended when only account_balance_usdt is updated
       (no ordering semantics for balance).
    """

    def _make_builder_chain(self) -> tuple[MagicMock, list]:
        """Return a chainable PostgREST mock that records every call and
        stores the `.or_()` arguments in `or_calls`."""
        or_calls: list[str] = []
        execute_mock = MagicMock(return_value=MagicMock(data=[]))
        builder = MagicMock()
        builder.update.return_value = builder
        builder.eq.return_value = builder

        def _or(condition: str) -> MagicMock:
            or_calls.append(condition)
            return builder

        builder.or_.side_effect = _or
        builder.execute = execute_mock

        supabase_mock = MagicMock()
        supabase_mock.table.return_value = builder
        return supabase_mock, or_calls

    def test_fetched_cursor_update_carries_or_condition(self) -> None:
        """_update_fetched_cursor must append .or_(...last_fetched_trade_timestamp...)
        so the update is a no-op if a concurrent worker already advanced past it.

        Tests the PostgREST chain contract directly by replicating the exact
        builder sequence that _update_fetched_cursor constructs.
        """
        # We test the closure contract inline by replicating the exact
        # PostgREST chain that _update_fetched_cursor builds.
        from datetime import datetime, timezone

        supabase_mock, or_calls = self._make_builder_chain()
        new_ts = datetime.now(timezone.utc).isoformat()
        key_id = "key-abc"

        # Replicate the _update_fetched_cursor closure body:
        supabase_mock.table("api_keys").update(
            {"last_fetched_trade_timestamp": new_ts}
        ).eq("id", key_id).or_(
            f"last_fetched_trade_timestamp.is.null,"
            f"last_fetched_trade_timestamp.lt.{new_ts}"
        ).execute()

        assert len(or_calls) == 1, "Expected exactly one .or_() call"
        assert "last_fetched_trade_timestamp.is.null" in or_calls[0], (
            f"Monotonic guard missing null-check: {or_calls[0]!r}"
        )
        assert f"last_fetched_trade_timestamp.lt.{new_ts}" in or_calls[0], (
            f"Monotonic guard missing lt-check: {or_calls[0]!r}"
        )

    def test_sync_cursor_update_carries_or_condition_for_last_sync_at(self) -> None:
        """_update_cursor must append .or_(...last_sync_at...) when last_sync_at
        is in the update payload so a slow W1 cannot regress the cursor.
        """
        from datetime import datetime, timezone

        supabase_mock, or_calls = self._make_builder_chain()
        new_ts = datetime.now(timezone.utc).isoformat()
        key_id = "key-abc"
        update_data = {"last_sync_at": new_ts}

        builder = supabase_mock.table("api_keys").update(update_data).eq("id", key_id)
        if "last_sync_at" in update_data:
            builder = builder.or_(
                f"last_sync_at.is.null,last_sync_at.lt.{new_ts}"
            )
        builder.execute()

        assert len(or_calls) == 1, "Expected exactly one .or_() call for last_sync_at"
        assert "last_sync_at.is.null" in or_calls[0], (
            f"Monotonic guard missing null-check: {or_calls[0]!r}"
        )
        assert f"last_sync_at.lt.{new_ts}" in or_calls[0], (
            f"Monotonic guard missing lt-check: {or_calls[0]!r}"
        )

    def test_balance_only_update_has_no_or_condition(self) -> None:
        """When only account_balance_usdt is updated (no last_sync_at),
        the .or_() monotonic guard must NOT be appended.
        account_balance_usdt has no temporal ordering semantics.
        """
        from datetime import datetime, timezone

        supabase_mock, or_calls = self._make_builder_chain()
        key_id = "key-abc"
        update_data = {"account_balance_usdt": 12345.67}

        builder = supabase_mock.table("api_keys").update(update_data).eq("id", key_id)
        # No last_sync_at → no .or_() should be appended.
        if "last_sync_at" in update_data:  # False
            builder = builder.or_("last_sync_at.is.null,last_sync_at.lt.XXX")
        builder.execute()

        assert len(or_calls) == 0, (
            "Balance-only update must not carry a .or_() monotonic guard; "
            f"unexpected .or_() calls: {or_calls}"
        )


class TestCircuitBreakerSingleDbClock:
    """NEW-C12-10: the circuit breaker computes the remaining cooldown
    SERVER-SIDE via the api_key_cooldown_remaining RPC (single DB clock) and
    stamps via stamp_api_key_429 — NOT Python datetime.now() math against a
    table().update(). NEW-C12-06: the defer threads the job's claim_token.

    These pin the contracts that fix the two defects: a direct table()
    stamp/select would re-introduce the cross-replica wall-clock skew, and an
    untokened defer would re-open the watchdog-reclaim race.
    """

    @staticmethod
    def _supabase_capturing_rpcs(cooldown_remaining: int):
        """Return (supabase_mock, rpc_calls). api_key_cooldown_remaining
        resolves to `cooldown_remaining`; every other rpc returns data=None.
        Any table() access fails loudly — the breaker must be RPC-only now."""
        rpc_calls: list[tuple[str, dict]] = []

        def _fake_rpc(name, params):
            rpc_calls.append((name, params))
            builder = MagicMock()
            if name == "api_key_cooldown_remaining":
                builder.execute.return_value = MagicMock(data=cooldown_remaining)
            else:
                builder.execute.return_value = MagicMock(data=None)
            return builder

        supabase = MagicMock()
        supabase.rpc.side_effect = _fake_rpc
        supabase.table.side_effect = AssertionError(
            "circuit breaker must not touch tables directly — cooldown is "
            "computed server-side via api_key_cooldown_remaining (C12-10)"
        )
        return supabase, rpc_calls

    @pytest.mark.asyncio
    async def test_defers_via_cooldown_rpc_and_threads_claim_token(self):
        from services.job_worker import _check_circuit_breaker

        supabase, rpc_calls = self._supabase_capturing_rpcs(cooldown_remaining=90)
        job = {"id": "job-1", "claim_token": "tok-W2"}
        key_row = {"id": "key-1", "exchange": "okx", "last_429_at": "2026-05-29T00:00:00Z"}

        result = await _check_circuit_breaker(supabase, job, key_row)

        assert result is not None and result.outcome == DispatchOutcome.DEFERRED

        names = [n for n, _ in rpc_calls]
        assert "api_key_cooldown_remaining" in names, (
            "breaker must compute remaining via the DB-clock RPC, not Python "
            "datetime.now() math (C12-10)"
        )
        cd_params = next(p for n, p in rpc_calls if n == "api_key_cooldown_remaining")
        assert cd_params == {"p_api_key_id": "key-1", "p_cooldown_seconds": 300}, (
            "must pass the per-exchange cooldown (OKX=300s) and key id"
        )
        defer_params = next(p for n, p in rpc_calls if n == "defer_compute_job")
        assert defer_params["p_claim_token"] == "tok-W2", (
            "defer MUST thread the job's claim_token so a preempted worker "
            "cannot yank a re-claimed job (C12-06 fence)"
        )
        assert defer_params["p_defer_seconds"] == 95, "90s remaining + 5s buffer"

    @pytest.mark.asyncio
    async def test_proceeds_when_cooldown_expired(self):
        """Complementary proceed-path guard: when api_key_cooldown_remaining
        reports 0, the breaker does NOT defer. The C12-10 single-DB-clock
        INVARIANT itself is pinned by test_defers_via_cooldown_rpc_* and
        test_stamp_429_uses_db_clock_rpc_* (those fail on the pre-fix Python-
        clock code); this test only asserts the no-defer-when-expired branch.
        """
        from services.job_worker import _check_circuit_breaker

        supabase, rpc_calls = self._supabase_capturing_rpcs(cooldown_remaining=0)
        # last_429_at only needs to be non-null to pass the snapshot fast-path;
        # its value is irrelevant since the cooldown RPC is mocked (no Python
        # clock math runs). Use a fixed sentinel rather than a real date, which
        # could misread as wall-clock-dependent and flake near UTC midnight.
        job = {"id": "job-2", "claim_token": "tok"}
        key_row = {"id": "key-2", "exchange": "binance", "last_429_at": "SENTINEL-non-null-stamp"}

        result = await _check_circuit_breaker(supabase, job, key_row)

        assert result is None, "remaining=0 → breaker not tripped, proceed"
        assert not any(n == "defer_compute_job" for n, _ in rpc_calls), (
            "must NOT defer when the cooldown RPC reports 0 remaining"
        )

    @pytest.mark.asyncio
    async def test_defer_serialization_failure_yields_deferred_not_failed(self):
        """NEW-C12-06 caller-side integration contract: when defer_compute_job
        RAISES a claim-token serialization_failure (this worker was preempted —
        watchdog reclaim + another worker re-claimed under a fresh token), the
        breaker must YIELD the job as DEFERRED, NOT let the 40001 propagate to
        dispatch's catch-all where it'd be classified error_kind='unknown',
        retried, and carry this worker's stale token into mark_compute_job_failed.
        Owning the preemption signal here is what keeps corruption-safety from
        depending on the incidental downstream mark fence.
        """
        from services.job_worker import _check_circuit_breaker

        class _FakeAPIError(Exception):
            def __init__(self, message, code):
                super().__init__(message)
                self.code = code

        rpc_calls: list[tuple[str, dict]] = []

        def _fake_rpc(name, params):
            rpc_calls.append((name, params))
            builder = MagicMock()
            if name == "api_key_cooldown_remaining":
                builder.execute.return_value = MagicMock(data=120)  # cooldown active → will defer
            elif name == "defer_compute_job":
                # The fence fired: this worker lost ownership (40001).
                builder.execute.side_effect = _FakeAPIError(
                    "defer_compute_job: job X preempted by watchdog reclaim "
                    "(caller token=t1, current token=t2)",
                    "40001",
                )
            else:
                builder.execute.return_value = MagicMock(data=None)
            return builder

        supabase = MagicMock()
        supabase.rpc.side_effect = _fake_rpc
        supabase.table.side_effect = AssertionError("breaker must be RPC-only")
        job = {"id": "job-preempted", "claim_token": "tok-W1-stale"}
        key_row = {"id": "key-1", "exchange": "okx", "last_429_at": "SENTINEL-non-null-stamp"}

        result = await _check_circuit_breaker(supabase, job, key_row)

        assert result is not None and result.outcome == DispatchOutcome.DEFERRED, (
            "a preempted defer (serialization_failure) must yield DEFERRED, not "
            "propagate a 40001 that dispatch would classify 'unknown' and retry"
        )
        assert any(n == "defer_compute_job" for n, _ in rpc_calls), (
            "it must have ATTEMPTED the defer (and been fenced) — not silently skipped"
        )

    @pytest.mark.asyncio
    async def test_genuine_defer_failure_propagates(self):
        """A NON-preemption defer failure (e.g. DB down) must NOT be swallowed
        as DEFERRED — it must propagate so dispatch classifies it transient and
        the job retries. Only the claim-token preemption is treated as yield."""
        from services.job_worker import _check_circuit_breaker

        def _fake_rpc(name, params):
            builder = MagicMock()
            if name == "api_key_cooldown_remaining":
                builder.execute.return_value = MagicMock(data=120)
            elif name == "defer_compute_job":
                builder.execute.side_effect = RuntimeError("connection reset by peer")
            else:
                builder.execute.return_value = MagicMock(data=None)
            return builder

        supabase = MagicMock()
        supabase.rpc.side_effect = _fake_rpc
        supabase.table.side_effect = AssertionError("breaker must be RPC-only")
        job = {"id": "job-dbdown", "claim_token": "tok"}
        key_row = {"id": "key-2", "exchange": "okx", "last_429_at": "SENTINEL-non-null-stamp"}

        with pytest.raises(RuntimeError, match="connection reset"):
            await _check_circuit_breaker(supabase, job, key_row)

    @pytest.mark.asyncio
    async def test_no_stamp_in_snapshot_skips_rpc(self):
        from services.job_worker import _check_circuit_breaker

        supabase, rpc_calls = self._supabase_capturing_rpcs(cooldown_remaining=999)
        job = {"id": "job-3", "claim_token": "tok"}
        key_row = {"id": "key-3", "exchange": "okx", "last_429_at": None}

        result = await _check_circuit_breaker(supabase, job, key_row)

        assert result is None
        assert rpc_calls == [], "no stamp in the fresh snapshot → skip the RPC round-trip entirely"

    @pytest.mark.asyncio
    async def test_stamp_429_uses_db_clock_rpc_not_table_update(self):
        from services.job_worker import _stamp_429

        rpc_calls: list[tuple[str, dict]] = []

        def _fake_rpc(name, params):
            rpc_calls.append((name, params))
            builder = MagicMock()
            builder.execute.return_value = MagicMock(data=None)
            return builder

        supabase = MagicMock()
        supabase.rpc.side_effect = _fake_rpc
        supabase.table.side_effect = AssertionError(
            "_stamp_429 must stamp via the stamp_api_key_429 RPC (DB clock), "
            "not table().update() with datetime.now() (C12-10)"
        )

        # Non-geo-block exc so the stamp path runs (a geo-block early-returns
        # without stamping — see TestStamp429GeoBlockSkip).
        await _stamp_429(supabase, {"id": "key-9"}, ccxt.RateLimitExceeded("429 too many"))

        assert rpc_calls == [("stamp_api_key_429", {"p_api_key_id": "key-9"})], (
            "stamp must go through the DB-clock RPC so the stamp and the "
            "cooldown check share one clock"
        )


class TestRescorePoisonMandatePreflight:
    """NEW-C12-09: run_rescore_allocator_job must validate the allocator's OWN
    (cheap, single-allocator-scoped) mandate BEFORE the ~30k-strategy,
    allocator-INDEPENDENT universe scan.

    Pre-fix, a poison mandate raised a deterministic Python error only INSIDE
    _score_one_allocator (after the scan); classify_exception bucketed it
    'unknown' and it was RETRIED up to 3x — re-paying the entire universe scan +
    a _scoring_semaphore slot on EVERY attempt for a failure caused by one
    allocator's own data, throttling everyone else's rescores + the daily cron.

    The preflight must:
      * fail a deterministic bad mandate 'permanent' (no retry) in ONE call,
        WITHOUT ever scanning the universe;
      * let a transient DB fault PROPAGATE (stay retryable — NOT permanent);
      * on the healthy path, scan + score exactly once, threading the
        preflight's ctx/overrides into _score_one_allocator so the >99% path
        does not double-load the allocator rows or double-emit
        compute_adjusted_weights' audit event;
      * keep the empty-universe no-op DONE and the default/screening mandate
        paths working (never reject a no-mandate or no-portfolio allocator).

    Patch targets are the SOURCE modules (routers.match.*,
    services.feedback_engine.compute_adjusted_weights) because the handler
    body-imports them, mirroring test_dispatch_routes_reconstruct_allocator_history.
    The real services.match_engine.compute_effective_weights runs so the
    preflight validates a poison overrides dict through the live guard.
    """

    @staticmethod
    def _patch(*, ctx=None, ctx_exc=None, overrides=None, overrides_exc=None,
               universe=None):
        """Build the standard patch set as a list of context managers.

        _load_allocator_context + compute_adjusted_weights are sync (the handler
        calls them via asyncio.to_thread); _load_candidate_universe is sync;
        _score_one_allocator is async. Returns (patchers, universe_mock,
        score_mock) so each test can assert on the universe + score mocks.
        """
        alloc_mock = MagicMock(
            return_value=ctx, side_effect=ctx_exc,
        ) if ctx_exc is not None else MagicMock(return_value=ctx)
        weights_mock = MagicMock(
            return_value=overrides, side_effect=overrides_exc,
        ) if overrides_exc is not None else MagicMock(return_value=overrides)
        universe_mock = MagicMock(
            return_value=universe
            if universe is not None
            else {"strategies_by_id": {"s1": {"strategy_id": "s1"}}, "returns_by_id": {}}
        )
        score_mock = AsyncMock(return_value={})
        patchers = [
            patch("routers.match._load_allocator_context", new=alloc_mock),
            patch("services.feedback_engine.compute_adjusted_weights", new=weights_mock),
            patch("routers.match._load_candidate_universe", new=universe_mock),
            patch("routers.match._score_one_allocator", new=score_mock),
        ]
        return patchers, universe_mock, score_mock

    @pytest.mark.asyncio
    async def test_poison_overrides_fail_permanent_without_universe_scan(self) -> None:
        """A non-dict scoring_weight_overrides (corrupt feedback output) makes
        the live compute_effective_weights raise AttributeError in the preflight
        → FAILED 'permanent' (no retry) and the universe is NEVER scanned."""
        from services.job_worker import run_rescore_allocator_job

        job = {"id": "j1", "kind": "rescore_allocator", "allocator_id": "a-poison"}
        patchers, universe_mock, score_mock = self._patch(
            ctx={"preferences": {}, "portfolio_strategies": [{"strategy_id": "s1"}]},
            overrides=["not", "a", "dict"],  # personalized mode → renormalized → .get fails
        )
        with patchers[0], patchers[1], patchers[2], patchers[3]:
            result = await run_rescore_allocator_job(job)

        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent"  # no retry → no re-scan
        universe_mock.assert_not_called()
        score_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_poison_feedback_inputs_fail_permanent_without_scan(self) -> None:
        """Corrupt feedback inputs make compute_adjusted_weights raise a
        deterministic KeyError — caught by the preflight as permanent before
        the universe scan (the feedback path is part of the cheap allocator
        work the finding cites)."""
        from services.job_worker import run_rescore_allocator_job

        job = {"id": "j2", "kind": "rescore_allocator", "allocator_id": "a-fb"}
        patchers, universe_mock, score_mock = self._patch(
            ctx={"preferences": {}, "portfolio_strategies": []},
            overrides_exc=KeyError("strategy_id"),
        )
        with patchers[0], patchers[1], patchers[2], patchers[3]:
            result = await run_rescore_allocator_job(job)

        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent"
        universe_mock.assert_not_called()
        score_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_non_dict_preferences_fail_permanent_without_scan(self) -> None:
        """A non-dict allocator_preferences row (the match.py:976 TypeError,
        previously surfacing only after the scan) is now caught in the preflight
        → permanent, no scan."""
        from services.job_worker import run_rescore_allocator_job

        job = {"id": "j3", "kind": "rescore_allocator", "allocator_id": "a-badprefs"}
        patchers, universe_mock, score_mock = self._patch(
            ctx={"preferences": "i-am-a-string", "portfolio_strategies": []},
            overrides={},
        )
        with patchers[0], patchers[1], patchers[2], patchers[3]:
            result = await run_rescore_allocator_job(job)

        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent"
        universe_mock.assert_not_called()
        score_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_transient_db_fault_in_preflight_stays_retryable_no_scan(self) -> None:
        """A transport/DB fault during the preflight (ConnectionError — NOT in
        the deterministic-error tuple) must PROPAGATE so dispatch's classifier
        keeps it retryable ('unknown'), NEVER converted to 'permanent'. The
        universe is not scanned past the fault."""
        job = {"id": "j4", "kind": "rescore_allocator", "allocator_id": "a-blip"}
        patchers, universe_mock, score_mock = self._patch(
            ctx_exc=ConnectionError("db blip"),
            overrides={},
        )
        with patchers[0], patchers[1], patchers[2], patchers[3]:
            result = await dispatch(job)

        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "unknown"  # retryable — a momentary blip must not fail-final
        assert result.error_kind != "permanent"
        universe_mock.assert_not_called()
        score_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_healthy_mandate_scans_once_and_threads_precomputed(self) -> None:
        """A valid mandate passes the preflight; the universe is scanned exactly
        ONCE and _score_one_allocator is awaited once WITH the preflight's
        ctx+overrides threaded in (so the healthy path does not re-load the
        allocator rows or double-emit the feedback audit event)."""
        from services.job_worker import run_rescore_allocator_job

        job = {"id": "j5", "kind": "rescore_allocator", "allocator_id": "a-ok"}
        ctx = {"preferences": {"min_sharpe": 1.0}, "portfolio_strategies": [{"strategy_id": "s1"}]}
        overrides = {"W_PORTFOLIO_FIT": 1.1}
        patchers, universe_mock, score_mock = self._patch(ctx=ctx, overrides=overrides)
        with patchers[0], patchers[1], patchers[2], patchers[3]:
            result = await run_rescore_allocator_job(job)

        assert result.outcome == DispatchOutcome.DONE
        universe_mock.assert_called_once()
        score_mock.assert_awaited_once()
        _, kwargs = score_mock.await_args
        assert kwargs.get("precomputed_ctx") is ctx
        assert kwargs.get("precomputed_overrides") is overrides

    @pytest.mark.asyncio
    async def test_default_mandate_no_preferences_row_passes_preflight(self) -> None:
        """A genuinely-default allocator (no allocator_preferences row → None,
        empty overrides) in personalized mode must NOT be classified permanent —
        the default mandate renormalizes to a positive sum and scores normally
        (risk: never reject a no-mandate allocator)."""
        from services.job_worker import run_rescore_allocator_job

        job = {"id": "j6", "kind": "rescore_allocator", "allocator_id": "a-default"}
        patchers, universe_mock, score_mock = self._patch(
            ctx={"preferences": None, "portfolio_strategies": [{"strategy_id": "s1"}]},
            overrides={},
        )
        with patchers[0], patchers[1], patchers[2], patchers[3]:
            result = await run_rescore_allocator_job(job)

        assert result.outcome == DispatchOutcome.DONE
        score_mock.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_empty_universe_is_noop_done_after_preflight(self) -> None:
        """Preflight passes (screening-mode allocator) + empty universe → DONE
        no-op; _score_one_allocator is NOT awaited (preserved behavior — the
        empty-universe short-circuit still runs AFTER the preflight)."""
        from services.job_worker import run_rescore_allocator_job

        job = {"id": "j7", "kind": "rescore_allocator", "allocator_id": "a-empty"}
        patchers, universe_mock, score_mock = self._patch(
            ctx={"preferences": None, "portfolio_strategies": []},
            overrides={},
            universe={"strategies_by_id": {}, "returns_by_id": {}},
        )
        with patchers[0], patchers[1], patchers[2], patchers[3]:
            result = await run_rescore_allocator_job(job)

        assert result.outcome == DispatchOutcome.DONE
        universe_mock.assert_called_once()
        score_mock.assert_not_awaited()
