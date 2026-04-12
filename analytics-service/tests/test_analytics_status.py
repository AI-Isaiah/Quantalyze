"""Tests for analytics-service/services/analytics_status.py.

The Python side of the UI status bridge is thin — all the derivation logic
lives in the 038 SQL RPC sync_strategy_analytics_status(p_strategy_id UUID).
Python's job is to (a) guard against missing strategy_id, (b) call the
RPC via db_execute so the supabase client's sync API is wrapped for the
event loop.

These tests lock in the thin wrapper's contract:
  - empty/missing strategy_id → no-op (no RPC call)
  - valid strategy_id → supabase.rpc('sync_strategy_analytics_status', ...)
  - execute() is called on the RPC response

The actual mapping semantics (a/b/c/d from the plan — computing / failed /
complete / preserve-existing) are enforced by the SQL RPC and verified
manually in Supabase Studio before shipping migration 038, not here.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.analytics_status import sync_strategy_analytics_status


@pytest.mark.asyncio
async def test_empty_strategy_id_is_noop() -> None:
    """If the caller passes an empty string (or None-coerced), the bridge
    must not touch the Supabase client. This is a guardrail — dispatch()
    already checks job.get('strategy_id') before calling the bridge, but
    the defense-in-depth here catches regressions."""
    with patch("services.analytics_status.get_supabase") as mock_get:
        await sync_strategy_analytics_status("")
    mock_get.assert_not_called()


@pytest.mark.asyncio
async def test_calls_rpc_with_correct_args() -> None:
    """Valid strategy_id → supabase.rpc is called with the RPC name and
    p_strategy_id kwarg matching the 038 migration signature."""
    mock_supabase = MagicMock()
    mock_rpc_chain = MagicMock()
    mock_supabase.rpc.return_value = mock_rpc_chain
    mock_rpc_chain.execute.return_value = MagicMock(data=None)

    with patch(
        "services.analytics_status.get_supabase", return_value=mock_supabase
    ):
        await sync_strategy_analytics_status("strat-abc-123")

    mock_supabase.rpc.assert_called_once_with(
        "sync_strategy_analytics_status",
        {"p_strategy_id": "strat-abc-123"},
    )
    mock_rpc_chain.execute.assert_called_once_with()


@pytest.mark.asyncio
async def test_rpc_error_propagates() -> None:
    """If the RPC raises (e.g. DB connection drop), the bridge must let it
    bubble up so the caller (services.job_worker.dispatch) can log it as a
    bridge failure. Bridge failures are best-effort — they don't change the
    job outcome — but they MUST be visible."""
    mock_supabase = MagicMock()
    mock_rpc_chain = MagicMock()
    mock_supabase.rpc.return_value = mock_rpc_chain
    mock_rpc_chain.execute.side_effect = RuntimeError("db connection dropped")

    with patch(
        "services.analytics_status.get_supabase", return_value=mock_supabase
    ):
        with pytest.raises(RuntimeError, match="db connection dropped"):
            await sync_strategy_analytics_status("strat-xyz")


@pytest.mark.asyncio
async def test_multiple_strategy_ids_routed_separately() -> None:
    """Two sequential calls with different ids → two separate RPC calls
    with the matching arg. This is a smoke test against a latent
    "memoize the first id" regression."""
    mock_supabase = MagicMock()
    mock_rpc_chain = MagicMock()
    mock_supabase.rpc.return_value = mock_rpc_chain
    mock_rpc_chain.execute.return_value = MagicMock(data=None)

    with patch(
        "services.analytics_status.get_supabase", return_value=mock_supabase
    ):
        await sync_strategy_analytics_status("strat-1")
        await sync_strategy_analytics_status("strat-2")

    assert mock_supabase.rpc.call_count == 2
    args_list = [call.args[1] for call in mock_supabase.rpc.call_args_list]
    assert args_list[0] == {"p_strategy_id": "strat-1"}
    assert args_list[1] == {"p_strategy_id": "strat-2"}
