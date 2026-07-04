"""BYB-01 FIX A — funding sync derives its cursor from the FUNDING table.

Root cause: ``run_sync_funding_job`` derived ``since_ms`` from
``api_keys.last_sync_at`` — the TRADES cursor advanced daily by cron sync. That
(1) never fired the 365-day first-sync backfill for a key that already had a
trades cursor set (its pre-adoption funding history was silently never
captured — the ***61a0 / Momentum Sphinx case) and (2) permanently skipped any
bucket that settled between the trade tick and the funding cron.

These tests pin both the pure cursor arithmetic AND the call-site wiring: the
``since`` handed to ``fetch_funding_bybit`` must come from
``max(funding_fees.timestamp) - overlap``, NOT from ``last_sync_at``. Neutering
the cursor lookup (reverting to ``last_sync_at``) fails
``test_since_derived_from_funding_cursor_not_last_sync_at`` because the two
timestamps are set to deliberately different values.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.exchange import parse_since_ms
from services.job_worker import (
    FUNDING_CURSOR_OVERLAP_DAYS,
    DispatchOutcome,
    _funding_since_from_cursor,
    run_sync_funding_job,
)

_OVERLAP_MS = FUNDING_CURSOR_OVERLAP_DAYS * 24 * 60 * 60 * 1000


class TestFundingSinceFromCursor:
    """Pure cursor arithmetic — no I/O, no pandas."""

    def test_empty_table_returns_none_for_backfill_path(self) -> None:
        """No stored funding (None) -> None -> the funding_fetch 365-day
        first-sync backfill fires. This is what recovers pre-adoption history."""
        assert _funding_since_from_cursor(None) is None
        assert _funding_since_from_cursor("") is None

    def test_non_string_is_treated_as_empty(self) -> None:
        """A non-string cursor value (e.g. a MagicMock from a stubbed DB row)
        must degrade to the backfill path, never crash."""
        assert _funding_since_from_cursor(object()) is None

    def test_overlap_window_subtracted_from_stored_max(self) -> None:
        """Cursor = max stored timestamp MINUS the overlap window, so buckets
        settling just after the previous run are re-fetched (dedup makes the
        overlap a free no-op)."""
        max_ts = "2026-06-01T00:00:00+00:00"
        expected = parse_since_ms(max_ts) - _OVERLAP_MS
        assert _funding_since_from_cursor(max_ts) == expected

    def test_custom_overlap_days_honoured(self) -> None:
        max_ts = "2026-06-01T00:00:00+00:00"
        got = _funding_since_from_cursor(max_ts, overlap_days=5)
        assert got == parse_since_ms(max_ts) - 5 * 24 * 60 * 60 * 1000


def _ctx_with_funding_cursor(max_ts: str | None, last_sync_at: str | None) -> MagicMock:
    """Mock ctx whose funding_fees cursor query returns ``max_ts`` and whose
    api_keys row carries a DIFFERENT ``last_sync_at`` (the trap the old code
    fell into)."""
    ctx = MagicMock()
    ctx.exchange = AsyncMock()
    ctx.exchange.close = AsyncMock()
    ctx.strategy_row = {"id": "strat-1"}
    ctx.key_row = {"id": "key-1", "exchange": "bybit", "last_sync_at": last_sync_at}

    data = [{"timestamp": max_ts}] if max_ts is not None else []
    ctx.supabase.table.return_value.select.return_value.eq.return_value.order.\
        return_value.limit.return_value.execute.return_value = MagicMock(data=data)
    return ctx


class TestRunSyncFundingJobCursorWiring:
    @pytest.mark.asyncio
    async def test_since_derived_from_funding_cursor_not_last_sync_at(self) -> None:
        """The since handed to fetch_funding_bybit must come from the funding
        cursor (older) minus overlap — NOT last_sync_at (deliberately newer)."""
        max_ts = "2026-06-01T00:00:00+00:00"
        newer_last_sync = "2026-07-01T00:00:00+00:00"
        ctx = _ctx_with_funding_cursor(max_ts, newer_last_sync)
        expected_since = parse_since_ms(max_ts) - _OVERLAP_MS

        mock_fetch = AsyncMock(return_value=[])
        job = {"id": "j1", "kind": "sync_funding", "strategy_id": "strat-1"}

        with patch(
            "services.job_worker._exchange_preflight", new=AsyncMock(return_value=ctx)
        ), patch(
            "services.funding_fetch.fetch_funding_bybit", new=mock_fetch
        ):
            result = await run_sync_funding_job(job)

        assert result.outcome == DispatchOutcome.DONE
        mock_fetch.assert_awaited_once()
        # fetch_funding_bybit(exchange, strategy_id, since_ms)
        assert mock_fetch.await_args.args[2] == expected_since
        # And that value is NOT what last_sync_at would have produced.
        assert mock_fetch.await_args.args[2] != parse_since_ms(newer_last_sync)

    @pytest.mark.asyncio
    async def test_empty_funding_table_passes_none_for_backfill(self) -> None:
        """No stored funding rows -> since_ms None -> fetch_funding_bybit gets
        None (the 365-day backfill path), regardless of last_sync_at being set."""
        ctx = _ctx_with_funding_cursor(max_ts=None, last_sync_at="2026-07-01T00:00:00+00:00")
        mock_fetch = AsyncMock(return_value=[])
        job = {"id": "j2", "kind": "sync_funding", "strategy_id": "strat-1"}

        with patch(
            "services.job_worker._exchange_preflight", new=AsyncMock(return_value=ctx)
        ), patch(
            "services.funding_fetch.fetch_funding_bybit", new=mock_fetch
        ):
            await run_sync_funding_job(job)

        mock_fetch.assert_awaited_once()
        assert mock_fetch.await_args.args[2] is None
