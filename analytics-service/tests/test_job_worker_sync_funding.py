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
  (g) FLOWK-02 (Phase 223): a malformed funding row is dropped, not refused,
      for binance, okx and bybit (TestSyncFundingMalformedRowDecision).

All tests mock _exchange_preflight, the funding_fetch helpers, and
_stamp_429 — no Supabase, no ccxt network I/O, no real key decryption.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import ccxt
import pytest

from services import job_worker
from services.job_worker import (
    FUNDING_CURSOR_OVERLAP_DAYS,
    DispatchOutcome,
    DispatchResult,
    dispatch,
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
        with the rows and the result is DONE.

        Phase 223 (C27) updated this test deliberately, intent kept. Old: a
        bare MagicMock cursor, unsorted rows with no timestamp, one Bybit
        fetch, the upsert received that list. New: the Bybit arm walks 7-day
        windows and sorts each by timestamp, so the cursor is recent (one
        window) and the rows carry datetimes; the upsert still receives
        exactly those rows (now in ascending order) and the result is DONE.
        """
        ctx = _build_mock_ctx(exchange_name="bybit")
        recent = datetime.now(timezone.utc) - timedelta(hours=1)
        ctx.supabase.table.return_value.select.return_value.eq.return_value.order.\
            return_value.limit.return_value.execute.return_value = MagicMock(
                data=[{"timestamp": recent.isoformat()}]
            )
        funding_rows = [
            {"strategy_id": "strat-1", "match_key": "k1", "amount": "0.01",
             "timestamp": recent},
            {"strategy_id": "strat-1", "match_key": "k2", "amount": "0.02",
             "timestamp": recent + timedelta(minutes=1)},
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


def _bybit_ctx_with_cursor(cursor_iso: str | None) -> MagicMock:
    """Bybit ctx whose funding_fees cursor query returns ``cursor_iso`` (the
    same mock chain the cursor-wiring tests use); None means an empty table."""
    ctx = _build_mock_ctx(exchange_name="bybit")
    data = [{"timestamp": cursor_iso}] if cursor_iso is not None else []
    ctx.supabase.table.return_value.select.return_value.eq.return_value.order.\
        return_value.limit.return_value.execute.return_value = MagicMock(data=data)
    return ctx


def _iso_days_ago(days: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _hanging_third_window_endpoint(
    ctx: MagicMock, timeline: list[tuple[Any, ...]], seen_starts: list[str]
) -> Any:
    """Fake Bybit transaction-log endpoint. Windows are numbered by the order
    of the distinct ``startTime`` values seen. Linear answers windows 1 and 2
    with three SETTLEMENT rows each (newest first), inverse answers empty, and
    the first request of window 3 hangs so the handler budget cuts the walk."""

    async def _endpoint(params: dict[str, str]) -> dict[str, Any]:
        start = params["startTime"]
        if start not in seen_starts:
            seen_starts.append(start)
        win = seen_starts.index(start) + 1
        category = params["category"]
        timeline.append(("req", category, win, ctx.exchange.close.await_count))
        if win == 3:
            await asyncio.sleep(30)  # the walk hangs here; the budget cuts it
        items: list[dict[str, str]] = []
        if category == "linear" and win in (1, 2):
            t0 = int(start)
            items = [  # newest first, like the venue
                {
                    "id": f"w{win}-{i}",
                    "symbol": "BTCUSDT",
                    "funding": "-0.01",
                    "currency": "USDT",
                    "transactionTime": str(t0 + (2 - i) * 60_000 + 1_000),
                }
                for i in range(3)
            ]
        return {"retCode": 0, "result": {"list": items, "nextPageCursor": ""}}

    return _endpoint


def _row(key: str, ts: datetime) -> dict[str, Any]:
    return {"strategy_id": "strat-1", "match_key": key, "timestamp": ts, "amount": "0.01"}


def _ok_upsert(calls: list[list[Any]]) -> AsyncMock:
    """Upsert mock that records each call's rows and reports success."""

    async def _upsert(supabase: Any, rows: Any) -> dict[str, Any]:
        calls.append(list(rows))
        return {"inserted": len(rows), "skipped": 0, "errors": []}

    return AsyncMock(side_effect=_upsert)


async def _run_handler(ctx: MagicMock, mock_fetch: AsyncMock, mock_upsert: AsyncMock) -> DispatchResult:
    job = {"id": "job-c27", "kind": "sync_funding", "strategy_id": "strat-1"}
    with patch(
        "services.job_worker._exchange_preflight", new=AsyncMock(return_value=ctx)
    ), patch(
        "services.funding_fetch.fetch_funding_bybit", new=mock_fetch
    ), patch(
        "services.funding_fetch.upsert_funding_rows", new=mock_upsert
    ):
        return await run_sync_funding_job(job)


class TestC27WindowedBybitWalk:
    """Phase 223 C27 (founder ruling 3, "Yes, 223 fixes it"): the Bybit walk
    stores each 7-day window before it reads the next, so the handler budget
    stops a walk without losing it."""

    @pytest.mark.asyncio
    async def test_c27_a_cancelled_walk_keeps_the_windows_it_finished_and_fails_transient(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Why: the cursor IS the newest stored funding row, so a walk that
        stores nothing until it ends loses every attempt to the budget (census
        C27: 379 s measured against 180 s, 0 rows ever stored). Each finished
        window must persist, and the budget must still FAIL the job (ruling 3,
        "without hiding a timeout"). Runs the real dispatch, the real
        asyncio.wait_for, the real fetcher and the real store helper; only the
        venue endpoint and the database upsert are faked."""
        monkeypatch.setitem(job_worker.TIMEOUT_PER_KIND, "sync_funding", 1.5)
        ctx = _bybit_ctx_with_cursor(_iso_days_ago(15))  # since = now - 17 d: 3 windows
        timeline: list[tuple[Any, ...]] = []
        seen_starts: list[str] = []
        stored: list[list[Any]] = []

        ctx.exchange.private_get_v5_account_transaction_log = _hanging_third_window_endpoint(
            ctx, timeline, seen_starts
        )

        async def _upsert(supabase: Any, rows: Any) -> dict[str, Any]:
            timeline.append(("upsert", len(rows)))
            stored.append(list(rows))
            return {"inserted": len(rows), "skipped": 0, "errors": []}

        job = {"id": "job-c27", "kind": "sync_funding", "strategy_id": "strat-1"}
        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=ctx),
        ), patch(
            "services.funding_fetch.upsert_funding_rows",
            new=AsyncMock(side_effect=_upsert),
        ) as mock_upsert:
            result = await dispatch(job)

        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "transient"
        assert (result.error_message or "").startswith("Handler exceeded timeout")
        assert timeline == [
            ("req", "linear", 1, 0),
            ("req", "inverse", 1, 0),
            ("upsert", 3),
            ("req", "linear", 2, 0),
            ("req", "inverse", 2, 0),
            ("upsert", 3),
            ("req", "linear", 3, 0),
        ]
        assert mock_upsert.await_count == 2
        for window_rows in stored:
            stamps = [r["timestamp"] for r in window_rows]
            assert stamps == sorted(stamps)
        assert max(r["timestamp"] for r in stored[0]) < min(
            r["timestamp"] for r in stored[1]
        )
        ctx.exchange.close.assert_awaited()  # closed once, after the cancel

    @pytest.mark.asyncio
    async def test_c27_the_next_attempt_resumes_at_or_before_the_first_unstored_window(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Why: the cursor is the newest stored row minus 2 days. After a cut
        walk the next attempt must start at or before the first unstored
        window, or the rows between are skipped for good."""
        monkeypatch.setitem(job_worker.TIMEOUT_PER_KIND, "sync_funding", 1.5)
        ctx = _bybit_ctx_with_cursor(_iso_days_ago(15))
        seen_starts: list[str] = []
        stored: list[list[Any]] = []
        ctx.exchange.private_get_v5_account_transaction_log = _hanging_third_window_endpoint(
            ctx, [], seen_starts
        )
        with patch(
            "services.job_worker._exchange_preflight", new=AsyncMock(return_value=ctx)
        ), patch(
            "services.funding_fetch.upsert_funding_rows", new=_ok_upsert(stored)
        ):
            cut = await dispatch({"id": "j", "kind": "sync_funding", "strategy_id": "strat-1"})
        assert cut.outcome == DispatchOutcome.FAILED
        window3_start = int(seen_starts[2])
        newest = max(r["timestamp"] for batch in stored for r in batch)

        second_ctx = _bybit_ctx_with_cursor(newest.isoformat())
        mock_fetch = AsyncMock(return_value=[])
        before_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        result = await _run_handler(second_ctx, mock_fetch, _ok_upsert([]))
        calls = mock_fetch.await_args_list
        first_since = calls[0].args[2]
        overlap_ms = FUNDING_CURSOR_OVERLAP_DAYS * 24 * 60 * 60 * 1000
        assert abs(first_since - (int(newest.timestamp() * 1000) - overlap_ms)) <= 1
        assert first_since <= window3_start
        for prev, nxt in zip(calls, calls[1:]):
            assert nxt.args[2] == prev.kwargs["until_ms"] + 1
        assert abs(calls[-1].kwargs["until_ms"] - before_ms) <= 5_000
        assert result.outcome == DispatchOutcome.DONE

    @pytest.mark.asyncio
    async def test_c27_windows_are_contiguous_int_ms_and_at_most_seven_days(self) -> None:
        """Why: a gap between windows is a settlement never read, an overlap
        is a duplicate request; every bound must be an int epoch-ms in UTC."""
        ctx = _bybit_ctx_with_cursor(_iso_days_ago(18))
        seen: list[tuple[Any, Any, int]] = []

        async def _fetch(exchange: Any, strategy_id: str, since_ms: Any, *, until_ms: Any = None) -> list[Any]:
            seen.append((since_ms, until_ms, ctx.exchange.close.await_count))
            return []

        before_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        result = await _run_handler(ctx, AsyncMock(side_effect=_fetch), _ok_upsert([]))
        assert result.outcome == DispatchOutcome.DONE
        assert len(seen) == 3
        overlap_ms = FUNDING_CURSOR_OVERLAP_DAYS * 24 * 60 * 60 * 1000
        cursor_ms = int(
            (datetime.now(timezone.utc) - timedelta(days=18)).timestamp() * 1000
        )
        assert abs(seen[0][0] - (cursor_ms - overlap_ms)) <= 5_000
        for since, until, close_count in seen:
            assert type(since) is int and type(until) is int
            assert until - since <= 7 * 86_400_000
            assert close_count == 0  # the exchange stays open for every window
        for prev, nxt in zip(seen, seen[1:]):
            assert nxt[0] == prev[1] + 1
        assert abs(seen[-1][1] - before_ms) <= 5_000

    @pytest.mark.asyncio
    async def test_c27_each_window_is_stored_oldest_row_first_and_ties_keep_fetch_order(self) -> None:
        """Why: a newer row stored ahead of an older unstored one is a
        permanent hole behind the cursor. The sort only reorders: equal
        timestamps keep fetch order and no row object is rebuilt."""
        ctx = _bybit_ctx_with_cursor(_iso_days_ago(0.04))
        t = datetime.now(timezone.utc) - timedelta(hours=1)
        fetched = [
            _row("new", t + timedelta(minutes=5)),
            _row("tie-linear", t + timedelta(minutes=2)),
            _row("old", t + timedelta(minutes=1)),
            _row("tie-inverse", t + timedelta(minutes=2)),
        ]
        calls: list[list[Any]] = []
        result = await _run_handler(ctx, AsyncMock(return_value=fetched), _ok_upsert(calls))
        assert result.outcome == DispatchOutcome.DONE
        assert len(calls) == 1
        assert [r["match_key"] for r in calls[0]] == ["old", "tie-linear", "tie-inverse", "new"]
        by_key = {r["match_key"]: r for r in fetched}
        for received in calls[0]:
            assert received is by_key[received["match_key"]]

    @pytest.mark.asyncio
    async def test_c27_a_window_is_stored_in_500_row_slices(self) -> None:
        """Why: a cancel between slices must leave a stored prefix, so a
        1,001-row window goes out as 500, 500 and 1, oldest first."""
        ctx = _bybit_ctx_with_cursor(_iso_days_ago(0.04))
        t = datetime.now(timezone.utc) - timedelta(days=2)
        fetched = [_row(f"k{i}", t + timedelta(minutes=i)) for i in range(1001)][::-1]
        calls: list[list[Any]] = []
        result = await _run_handler(ctx, AsyncMock(return_value=fetched), _ok_upsert(calls))
        assert result.outcome == DispatchOutcome.DONE
        assert [len(c) for c in calls] == [500, 500, 1]
        stamps = [r["timestamp"] for c in calls for r in c]
        assert stamps == sorted(stamps)

    @pytest.mark.asyncio
    async def test_c27_the_walk_stops_at_the_first_failing_slice(self) -> None:
        """Why: continuing past a failed slice would store newer rows ahead
        of the unstored older ones. The walk returns the H-1115 transient
        failure at once and never reads window 2."""
        ctx = _bybit_ctx_with_cursor(_iso_days_ago(10))  # two windows
        t = datetime.now(timezone.utc) - timedelta(days=11)
        window1 = [_row(f"k{i}", t + timedelta(minutes=i)) for i in range(1001)]
        mock_fetch = AsyncMock(side_effect=[window1, [_row("later", t + timedelta(days=8))]])
        n_calls = 0

        async def _upsert(supabase: Any, rows: Any) -> dict[str, Any]:
            nonlocal n_calls
            n_calls += 1  # only the second slice fails; a walk that goes on would see more calls
            errors = ["boom"] if n_calls == 2 else []
            return {"inserted": len(rows) - len(errors), "skipped": 0, "errors": errors}

        mock_upsert = AsyncMock(side_effect=_upsert)
        result = await _run_handler(ctx, mock_fetch, mock_upsert)
        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "transient"
        assert "1 upsert batch(es) failed" in (result.error_message or "")
        assert mock_upsert.await_count == 2
        assert mock_fetch.await_count == 1
        ctx.exchange.close.assert_awaited()

    @pytest.mark.asyncio
    async def test_c27_an_empty_window_is_skipped_without_an_upsert_and_the_walk_goes_on(self) -> None:
        """Why: a window with no settlement is normal; it must not stop the
        walk or cost an upsert round trip."""
        ctx = _bybit_ctx_with_cursor(_iso_days_ago(18))  # three windows
        t = datetime.now(timezone.utc) - timedelta(days=19)
        mock_fetch = AsyncMock(
            side_effect=[[_row("a", t)], [], [_row("c", t + timedelta(days=15))]]
        )
        calls: list[list[Any]] = []
        result = await _run_handler(ctx, mock_fetch, _ok_upsert(calls))
        assert result.outcome == DispatchOutcome.DONE
        assert mock_fetch.await_count == 3
        assert len(calls) == 2

    @pytest.mark.asyncio
    async def test_c27_no_window_left_is_done_without_a_fetch(self) -> None:
        """Why: a cursor in the future (clock skew) leaves no range to read;
        the job is DONE, not an error, and reads nothing."""
        ctx = _bybit_ctx_with_cursor(
            (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
        )
        mock_fetch = AsyncMock(return_value=[])
        mock_upsert = _ok_upsert([])
        result = await _run_handler(ctx, mock_fetch, mock_upsert)
        assert result.outcome == DispatchOutcome.DONE
        mock_fetch.assert_not_awaited()
        mock_upsert.assert_not_awaited()
        ctx.exchange.close.assert_awaited()

    @pytest.mark.asyncio
    async def test_c27_a_rate_limit_mid_walk_stamps_429_keeps_earlier_windows_and_reraises(self) -> None:
        """Why: a 429 in window 2 must still trip the per-key breaker and
        re-raise, and must not cost the window already stored."""
        ctx = _bybit_ctx_with_cursor(_iso_days_ago(10))  # two windows
        t = datetime.now(timezone.utc) - timedelta(days=11)
        exc = ccxt.RateLimitExceeded("429")
        mock_fetch = AsyncMock(side_effect=[[_row("a", t)], exc])
        calls: list[list[Any]] = []
        mock_stamp_429 = AsyncMock()
        with patch("services.job_worker._stamp_429", new=mock_stamp_429):
            with pytest.raises(ccxt.RateLimitExceeded):
                await _run_handler(ctx, mock_fetch, _ok_upsert(calls))
        mock_stamp_429.assert_awaited_once_with(ctx.supabase, ctx.key_row, exc)
        assert len(calls) == 1
        ctx.exchange.close.assert_awaited()


def _recent_ms(days: float) -> str:
    return str(int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp() * 1000))


class TestSyncFundingMalformedRowDecision:
    """FLOWK-02 (Phase 223): ``run_sync_funding_job`` keeps the default
    ``on_malformed="drop"`` for every venue. A walk whose venue page holds one
    well-formed and one malformed funding row ends DONE, stores exactly the
    well-formed row and logs the fetcher's WARNING.

    Why a drop and not a refusal: no published number reads ``funding_fees``
    (readers at HEAD on 2026-11-24: ``reconstruct_positions`` with no non-test
    caller, the GDPR export, ``sanitize_user``, ``scripts/bybit_reconcile.py``),
    and a refusal would starve the table, because a refused walk stores nothing,
    the cursor never moves and the job would refuse daily. Revisit when a
    published reader of ``funding_fees`` appears.

    The real fetchers run against a fake venue endpoint; only the upsert is
    patched, so the test fails if the caller starts raising or stops dropping.
    """

    @staticmethod
    def _binance(blank: bool) -> AsyncMock:
        good = {
            "symbol": "BTCUSDT", "incomeType": "FUNDING_FEE", "income": "-0.01",
            "asset": "USDT", "time": int(_recent_ms(2)), "tranId": "ok1",
        }
        bad = {**good, "symbol": "", "tranId": "bad1"}
        ex = AsyncMock()
        ex.id = "binance"
        ex.fapiPrivate_get_income = AsyncMock(
            return_value=[good, bad] if blank else [good]
        )
        ex.close = AsyncMock()
        return ex

    @staticmethod
    def _okx(blank: bool) -> AsyncMock:
        good = {
            "instId": "BTC-USDT-SWAP", "type": "8", "pnl": "-0.01",
            "ccy": "USDT", "ts": _recent_ms(2), "billId": "ok1",
        }
        bad = {**good, "instId": "", "billId": "bad1"}
        ex = AsyncMock()
        ex.id = "okx"
        ex.private_get_account_bills = AsyncMock(
            return_value={"data": [good, bad] if blank else [good]}
        )
        ex.private_get_account_bills_archive = AsyncMock(return_value={"data": []})
        ex.close = AsyncMock()
        return ex

    @staticmethod
    def _bybit(blank: bool) -> AsyncMock:
        from tests.test_funding_fetch import _bybit_mock_with_fallback

        good = {
            "symbol": "BTCUSDT", "type": "SETTLEMENT", "funding": "-0.01",
            "currency": "USDT", "transactionTime": _recent_ms(2), "id": "ok1",
        }
        bad = {**good, "symbol": "", "id": "bad1"}
        page = {
            "result": {
                "list": [good, bad] if blank else [good],
                "nextPageCursor": "",
            }
        }
        ex = AsyncMock()
        ex.id = "bybit"
        ex.private_get_v5_account_transaction_log = _bybit_mock_with_fallback(page)
        ex.close = AsyncMock()
        return ex

    @pytest.mark.asyncio
    @pytest.mark.parametrize("venue", ["binance", "okx", "bybit"])
    async def test_a_malformed_funding_row_is_dropped_and_the_good_row_is_still_stored(
        self, venue: str, caplog: pytest.LogCaptureFixture
    ) -> None:
        from decimal import Decimal

        from services import funding_fetch

        builder = getattr(self, f"_{venue}")
        fetcher = getattr(funding_fetch, f"fetch_funding_{venue}")
        since_ms = int(_recent_ms(3))

        # The key the real fetcher computes for the good row, from a page with
        # no malformed row in it.
        kwargs = {"until_ms": int(_recent_ms(0))} if venue == "bybit" else {}
        expected_rows = await fetcher(builder(False), "strat-1", since_ms, **kwargs)
        assert len(expected_rows) == 1
        expected_key = expected_rows[0]["match_key"]

        # Cursor of now minus 1 day: since_ms is now minus 3 days, one Bybit
        # window, and the OKX arm stays off its archive endpoint.
        ctx = _bybit_ctx_with_cursor(_iso_days_ago(1))
        ctx.key_row["exchange"] = venue
        ctx.exchange = builder(True)
        mock_upsert = AsyncMock(
            return_value={"inserted": 1, "skipped": 0, "errors": []}
        )
        job = {"id": "job-flowk02", "kind": "sync_funding", "strategy_id": "strat-1"}
        with caplog.at_level("WARNING", logger="quantalyze.analytics.funding_fetch"), patch(
            "services.job_worker._exchange_preflight", new=AsyncMock(return_value=ctx)
        ), patch("services.funding_fetch.upsert_funding_rows", new=mock_upsert):
            result = await run_sync_funding_job(job)

        assert result.outcome == DispatchOutcome.DONE
        mock_upsert.assert_awaited_once()
        stored = mock_upsert.await_args.args[1]
        assert len(stored) == 1
        assert stored[0]["symbol"] == expected_rows[0]["symbol"]
        assert stored[0]["amount"] == Decimal("-0.01")
        assert stored[0]["match_key"] == expected_key
        assert any(
            f"{venue} funding_fetch: dropped 1 malformed rows" in r.getMessage()
            for r in caplog.records
        )
        ctx.exchange.close.assert_awaited()
