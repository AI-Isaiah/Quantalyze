"""Tests for analytics-service/scripts/phase12_kill_switch.py.

Covers the P2024 cutover retarget: `cutover_strategy` delegates the entire
read+strip to migration 129's atomic RPC `cutover_strategy_metrics_keys_atomic`.
The Python side must not SELECT metrics_json or project a sibling payload —
that race was the very thing migration 129 closes.
"""

from unittest.mock import MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_cutover_calls_atomic_rpc_with_strategy_id_only() -> None:
    """P2024: the atomic RPC takes ONLY p_strategy_id. The function body
    reads metrics_json itself under SELECT ... FOR UPDATE. Python must not
    pass a client-side payload."""
    from scripts import phase12_kill_switch  # noqa: WPS433 — local import per test isolation

    mock_supabase = MagicMock()
    mock_rpc_chain = MagicMock()
    mock_supabase.rpc.return_value = mock_rpc_chain
    mock_rpc_chain.execute.return_value = MagicMock(data={"moved": 3})

    with patch(
        "scripts.phase12_kill_switch.get_supabase",
        return_value=mock_supabase,
    ):
        moved = await phase12_kill_switch.cutover_strategy("strat-abc-123")

    # Exactly one RPC call, with the new name + single-arg signature.
    assert mock_supabase.rpc.call_count == 1, "expected exactly one RPC call"
    args, _kwargs = mock_supabase.rpc.call_args
    assert args[0] == "cutover_strategy_metrics_keys_atomic", (
        "must call the migration 129 RPC name, not the migration 088 predecessor"
    )
    # Defensive: structural guard — no client-side sibling payload.
    assert args[1] == {"p_strategy_id": "strat-abc-123"}, (
        "must pass ONLY p_strategy_id; never a p_kinds / sibling payload"
    )
    # Python side must NOT SELECT metrics_json (the whole point of P2024).
    mock_supabase.table.assert_not_called()
    # Return value comes from the RPC's `{"moved": N}` envelope.
    assert moved == 3


@pytest.mark.asyncio
async def test_cutover_returns_zero_when_rpc_returns_none_data() -> None:
    """Defensive: if the RPC envelope is missing for any reason, the
    helper returns 0 — the kill-switch caller treats 0 as "nothing to
    do" and continues. Never raise on a missing envelope key."""
    from scripts import phase12_kill_switch

    mock_supabase = MagicMock()
    mock_rpc_chain = MagicMock()
    mock_supabase.rpc.return_value = mock_rpc_chain
    mock_rpc_chain.execute.return_value = MagicMock(data=None)

    with patch(
        "scripts.phase12_kill_switch.get_supabase",
        return_value=mock_supabase,
    ):
        moved = await phase12_kill_switch.cutover_strategy("strat-empty")

    assert moved == 0


@pytest.mark.asyncio
async def test_cutover_returns_zero_when_rpc_returns_moved_zero() -> None:
    """The atomic RPC returns `{"moved": 0}` when no allowlist keys are
    present in metrics_json. The Python helper surfaces that value."""
    from scripts import phase12_kill_switch

    mock_supabase = MagicMock()
    mock_rpc_chain = MagicMock()
    mock_supabase.rpc.return_value = mock_rpc_chain
    mock_rpc_chain.execute.return_value = MagicMock(data={"moved": 0})

    with patch(
        "scripts.phase12_kill_switch.get_supabase",
        return_value=mock_supabase,
    ):
        moved = await phase12_kill_switch.cutover_strategy("strat-noop")

    assert moved == 0


def test_no_python_heavy_kinds_constant() -> None:
    """Drift guard: after P2024 the v_allowlist lives in the SQL function
    body alone. A Python HEAVY_KINDS list would invite the two to drift.
    This test fails the moment someone re-adds it."""
    from scripts import phase12_kill_switch

    assert not hasattr(phase12_kill_switch, "HEAVY_KINDS"), (
        "P2024: HEAVY_KINDS must NOT be defined in Python — single "
        "source of truth lives in supabase/migrations/129_*.sql v_allowlist."
    )
