"""Tests for services/scheduled_tasks.py.

These ticks are the ex-Vercel crons (sync-funding, reconcile-strategies,
cleanup-ack-tokens) that moved off vercel.json when the project breached
the Hobby-plan 2-cron cap. Tests mirror the same mocking style used in
tests/test_main_worker.py — no real Supabase, no sleep, no infinite loop.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services.scheduled_tasks import (
    PERP_EXCHANGES,
    cleanup_ack_tokens_tick,
    enqueue_reconcile_strategies_tick,
    enqueue_sync_funding_tick,
)


def _make_fetch_chain(data: list[dict]) -> MagicMock:
    """Build a Supabase chainable mock whose .execute() returns ``data``."""
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.in_.return_value = chain
    chain.gt.return_value = chain
    chain.lt.return_value = chain
    chain.delete.return_value = chain
    chain.execute.return_value = MagicMock(data=data)
    return chain


def _make_rpc_chain(returned_id: str | None = "job-123") -> MagicMock:
    chain = MagicMock()
    chain.execute.return_value = MagicMock(data=returned_id)
    return chain


class TestEnqueueSyncFundingTick:
    @pytest.mark.asyncio
    async def test_zero_candidates_no_rpc_calls(self) -> None:
        mock_supabase = MagicMock()
        mock_supabase.from_.return_value = _make_fetch_chain([])

        with patch("services.scheduled_tasks.get_supabase", return_value=mock_supabase):
            result = await enqueue_sync_funding_tick()

        assert result == {"enqueued": 0, "failed": 0, "total_candidates": 0}
        mock_supabase.rpc.assert_not_called()

    @pytest.mark.asyncio
    async def test_happy_path_enqueues_each(self) -> None:
        rows = [{"id": "s-1"}, {"id": "s-2"}, {"id": "s-3"}]
        mock_supabase = MagicMock()
        mock_supabase.from_.return_value = _make_fetch_chain(rows)
        mock_supabase.rpc.return_value = _make_rpc_chain("job-x")

        with patch("services.scheduled_tasks.get_supabase", return_value=mock_supabase):
            result = await enqueue_sync_funding_tick()

        assert result == {"enqueued": 3, "failed": 0, "total_candidates": 3}
        assert mock_supabase.rpc.call_count == 3
        for call in mock_supabase.rpc.call_args_list:
            assert call.args[0] == "enqueue_compute_job"
            assert call.args[1]["p_kind"] == "sync_funding"

    @pytest.mark.asyncio
    async def test_per_row_error_isolated(self) -> None:
        rows = [{"id": "s-1"}, {"id": "s-2"}]
        mock_supabase = MagicMock()
        mock_supabase.from_.return_value = _make_fetch_chain(rows)

        ok_chain = _make_rpc_chain("job-x")
        bad_chain = MagicMock()
        bad_chain.execute.side_effect = RuntimeError("PG boom")
        mock_supabase.rpc.side_effect = [ok_chain, bad_chain]

        with patch("services.scheduled_tasks.get_supabase", return_value=mock_supabase):
            result = await enqueue_sync_funding_tick()

        assert result == {"enqueued": 1, "failed": 1, "total_candidates": 2}

    @pytest.mark.asyncio
    async def test_filter_uses_supported_exchanges(self) -> None:
        mock_supabase = MagicMock()
        chain = _make_fetch_chain([])
        mock_supabase.from_.return_value = chain

        with patch("services.scheduled_tasks.get_supabase", return_value=mock_supabase):
            await enqueue_sync_funding_tick()

        chain.in_.assert_called_once_with(
            "api_keys.exchange", list(PERP_EXCHANGES)
        )


class TestEnqueueReconcileStrategiesTick:
    @pytest.mark.asyncio
    async def test_zero_candidates(self) -> None:
        mock_supabase = MagicMock()
        mock_supabase.from_.return_value = _make_fetch_chain([])

        with patch("services.scheduled_tasks.get_supabase", return_value=mock_supabase):
            result = await enqueue_reconcile_strategies_tick()

        assert result == {"enqueued": 0, "failed": 0, "total_candidates": 0}

    @pytest.mark.asyncio
    async def test_happy_path_uses_reconcile_kind(self) -> None:
        rows = [{"id": "s-a"}, {"id": "s-b"}]
        mock_supabase = MagicMock()
        mock_supabase.from_.return_value = _make_fetch_chain(rows)
        mock_supabase.rpc.return_value = _make_rpc_chain("job-y")

        with patch("services.scheduled_tasks.get_supabase", return_value=mock_supabase):
            result = await enqueue_reconcile_strategies_tick()

        assert result == {"enqueued": 2, "failed": 0, "total_candidates": 2}
        kinds = [c.args[1]["p_kind"] for c in mock_supabase.rpc.call_args_list]
        assert kinds == ["reconcile_strategy", "reconcile_strategy"]

    @pytest.mark.asyncio
    async def test_applies_24h_cutoff_filter(self) -> None:
        """The reconcile fetcher must filter on api_keys.last_sync_at > 24h ago."""
        mock_supabase = MagicMock()
        chain = _make_fetch_chain([])
        mock_supabase.from_.return_value = chain

        with patch("services.scheduled_tasks.get_supabase", return_value=mock_supabase):
            await enqueue_reconcile_strategies_tick()

        chain.gt.assert_called_once()
        gt_args = chain.gt.call_args
        assert gt_args.args[0] == "api_keys.last_sync_at"


class TestCleanupAckTokensTick:
    @pytest.mark.asyncio
    async def test_returns_deleted_count(self) -> None:
        deleted_rows = [{"token_hash": f"h-{i}"} for i in range(5)]
        mock_supabase = MagicMock()
        mock_supabase.from_.return_value = _make_fetch_chain(deleted_rows)

        with patch("services.scheduled_tasks.get_supabase", return_value=mock_supabase):
            result = await cleanup_ack_tokens_tick()

        assert result == {"deleted": 5}

    @pytest.mark.asyncio
    async def test_zero_deleted(self) -> None:
        mock_supabase = MagicMock()
        mock_supabase.from_.return_value = _make_fetch_chain([])

        with patch("services.scheduled_tasks.get_supabase", return_value=mock_supabase):
            result = await cleanup_ack_tokens_tick()

        assert result == {"deleted": 0}

    @pytest.mark.asyncio
    async def test_applies_30_day_cutoff(self) -> None:
        mock_supabase = MagicMock()
        chain = _make_fetch_chain([])
        mock_supabase.from_.return_value = chain

        with patch("services.scheduled_tasks.get_supabase", return_value=mock_supabase):
            await cleanup_ack_tokens_tick()

        chain.lt.assert_called_once()
        assert chain.lt.call_args.args[0] == "used_at"
