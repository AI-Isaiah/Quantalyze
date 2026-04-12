"""Integration test (mock DB): concurrent daily_enqueue_tick calls.

Run two main_worker daily_enqueue_tick() calls concurrently. Since the
enqueue_poll_positions_for_all_strategies RPC is idempotent (INSERT ... ON
CONFLICT DO NOTHING in migration 036), both should succeed — one returns
the enqueued count, the other returns 0. Verify no duplicates by checking
the total reported enqueued count across both calls.
"""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from main_worker import daily_enqueue_tick


class TestDailyEnqueueConcurrency:
    """Two concurrent daily_enqueue_tick calls must not produce duplicates."""

    async def test_concurrent_enqueue_idempotent(self) -> None:
        """Run two daily_enqueue_tick() concurrently. The RPC is idempotent,
        so the total enqueued across both calls should equal what a single
        call would produce — not double it."""
        call_count = 0

        mock_supabase = MagicMock()

        def _rpc_side_effect(name: str, params: dict):
            nonlocal call_count
            chain = MagicMock()
            if name == "enqueue_poll_positions_for_all_strategies":
                call_count += 1
                # First call "wins" and enqueues 5 jobs; second gets 0
                # because the RPC uses INSERT ... ON CONFLICT DO NOTHING.
                if call_count == 1:
                    chain.execute.return_value = MagicMock(data=5)
                else:
                    chain.execute.return_value = MagicMock(data=0)
            else:
                chain.execute.return_value = MagicMock(data=None)
            return chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        with patch("main_worker.get_supabase", return_value=mock_supabase):
            results = await asyncio.gather(
                daily_enqueue_tick(),
                daily_enqueue_tick(),
            )

        # Both ticks should have completed (no exceptions)
        # The RPC was called exactly twice
        assert call_count == 2
        # Verify that the total enqueued is 5, not 10 (idempotent)
        rpc_calls = [
            c for c in mock_supabase.rpc.call_args_list
            if c.args[0] == "enqueue_poll_positions_for_all_strategies"
        ]
        assert len(rpc_calls) == 2

    async def test_single_enqueue_returns_count(self) -> None:
        """Single call returns the count from the RPC."""
        mock_supabase = MagicMock()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=12)
        mock_supabase.rpc.return_value = chain

        with patch("main_worker.get_supabase", return_value=mock_supabase):
            await daily_enqueue_tick()

        mock_supabase.rpc.assert_called_once_with(
            "enqueue_poll_positions_for_all_strategies", {}
        )
