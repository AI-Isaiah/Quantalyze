"""Phase 11 / Plan 03 / D-13 — first_sync_success marker stamping.

After the worker's run_poll_allocator_positions_job successfully persists
allocator holdings, it MUST attempt to stamp `auth.users.raw_user_meta_data
.first_sync_success_at` via the SECURITY DEFINER RPC `stamp_first_sync_success`
(migration 084, shipped by Plan 01).

Asserted invariants:
  1. Happy path: ctx.supabase.rpc("stamp_first_sync_success", {"p_user_id": <id>})
     is called exactly once with the allocator_id of the just-completed sync.
  2. Non-blocking: if the RPC raises, the worker still returns DONE — analytics
     stamping must never roll back the compute path.

Mocks the supabase client + ctx fully — no live Supabase / no live exchange.
Mirrors the test_run_poll_allocator_positions_job_emits_sync_completed_audit_on_done
pattern from test_allocator_positions.py (which patches the preflight + persist
helpers and asserts the post-success hook side effect).
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest


ALLOCATOR_ID = "00000000-0000-0000-0000-0000000000aa"
API_KEY_ID = "00000000-0000-0000-0000-000000000001"


def _build_supabase_mock() -> MagicMock:
    """Build a mock supabase client whose `.rpc(...).execute()` and
    `.table(...).update(...).eq(...).execute()` chains both no-op cleanly."""
    supabase = MagicMock()

    # rpc(...).execute() — used by the new first_sync_success stamp call.
    rpc_execute = MagicMock(return_value=MagicMock(data=None, error=None))
    rpc_chain = MagicMock(execute=rpc_execute)
    supabase.rpc = MagicMock(return_value=rpc_chain)

    # table(...).update(...).eq(...).execute() — used by the existing
    # _update_ok block. Make it a no-op chain.
    update_eq_execute = MagicMock(return_value=MagicMock(data=[], error=None))
    update_eq = MagicMock(execute=update_eq_execute)
    update_chain = MagicMock(eq=MagicMock(return_value=update_eq))
    table_chain = MagicMock(update=MagicMock(return_value=update_chain))
    supabase.table = MagicMock(return_value=table_chain)

    return supabase


async def _run_worker_happy_path(monkeypatch, mock_supabase, api_key_row_factory):
    """Drive run_poll_allocator_positions_job with all external collaborators
    stubbed: preflight returns a ready ctx, fetch returns 2 rows, persist
    returns 2, audit is a no-op. Returns the DispatchResult so callers can
    assert on outcome."""
    from services import job_worker as jw
    from services import audit as audit_module
    from services import allocator_positions as ap_mod

    key_row = api_key_row_factory(
        id=API_KEY_ID, user_id=ALLOCATOR_ID, exchange="binance"
    )

    mock_exchange = MagicMock()
    mock_exchange.close = AsyncMock()

    fake_ctx = jw._ExchangeContext(
        supabase=mock_supabase,
        strategy_row=None,
        key_row=key_row,
        exchange=mock_exchange,
    )

    async def _fake_preflight(_job, _name):
        return fake_ctx

    monkeypatch.setattr(jw, "_allocator_key_preflight", _fake_preflight)

    spot_row = {
        "venue": "binance", "symbol": "BTC", "holding_type": "spot",
        "side": "flat", "quantity": 0.5, "value_usd": 30000.0,
        "entry_price": None, "mark_price": 60000.0,
        "unrealized_pnl_usd": None, "cost_basis_usd": None,
        "raw_payload": {"asset": "BTC"},
    }
    deriv_row = {
        "venue": "binance", "symbol": "BTCUSDT", "holding_type": "derivative",
        "side": "long", "quantity": 0.1, "value_usd": 6000.0,
        "entry_price": 59000.0, "mark_price": 61000.0,
        "unrealized_pnl_usd": 200.0, "cost_basis_usd": 5900.0,
        "raw_payload": {"symbol": "BTCUSDT"},
    }

    async def _fake_fetch(_venue, _exchange):
        return ([spot_row, deriv_row], None)

    async def _fake_persist(_supa, rows, _allocator_id, _api_key_id, _asof):
        return len(rows)

    monkeypatch.setattr(ap_mod, "fetch_allocator_holdings", _fake_fetch)
    monkeypatch.setattr(ap_mod, "persist_allocator_holdings", _fake_persist)

    # Audit emission is unrelated to the marker stamp — mock to no-op so we
    # don't depend on services.audit configuration.
    monkeypatch.setattr(audit_module, "log_audit_event", MagicMock())

    job = {
        "id": "job-1",
        "kind": "poll_allocator_positions",
        "api_key_id": API_KEY_ID,
    }

    return await jw.run_poll_allocator_positions_job(job)


# ---------------------------------------------------------------------------
# Test 1 — happy path stamps first_sync_success
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_first_sync_success_marker_stamped_on_success(
    monkeypatch, api_key_row_factory
):
    """When run_poll_allocator_positions_job returns DONE, the worker MUST
    have called ctx.supabase.rpc("stamp_first_sync_success", {"p_user_id": <id>})
    exactly once with the allocator's user_id."""
    from services import job_worker as jw

    mock_supabase = _build_supabase_mock()

    result = await _run_worker_happy_path(monkeypatch, mock_supabase, api_key_row_factory)

    assert result.outcome == jw.DispatchOutcome.DONE

    # Find the stamp_first_sync_success RPC call among ctx.supabase.rpc calls.
    rpc_calls = mock_supabase.rpc.call_args_list
    stamp_calls = [
        c for c in rpc_calls
        if c.args and c.args[0] == "stamp_first_sync_success"
    ]
    assert len(stamp_calls) == 1, (
        f"expected exactly 1 stamp_first_sync_success rpc call; got {rpc_calls}"
    )

    # Args shape: ("stamp_first_sync_success", {"p_user_id": ALLOCATOR_ID})
    call = stamp_calls[0]
    assert call.args[0] == "stamp_first_sync_success"
    assert call.args[1] == {"p_user_id": ALLOCATOR_ID}


# ---------------------------------------------------------------------------
# Test 2 — RPC failure is non-blocking (worker still returns DONE)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_first_sync_success_marker_stamp_failure_is_non_blocking(
    monkeypatch, api_key_row_factory, caplog
):
    """If the stamp_first_sync_success RPC raises (e.g. transient network
    error or RPC missing), run_poll_allocator_positions_job MUST still return
    DONE. The compute path is independent of analytics stamping."""
    from services import job_worker as jw

    mock_supabase = _build_supabase_mock()

    # Replace the rpc() return value with one whose .execute() raises.
    failing_chain = MagicMock()
    failing_chain.execute = MagicMock(
        side_effect=RuntimeError("simulated stamp failure")
    )

    def _route_rpc(name, _params):
        if name == "stamp_first_sync_success":
            return failing_chain
        # Other RPCs (none in this path) — return a no-op chain.
        return MagicMock(execute=MagicMock(return_value=MagicMock(data=None, error=None)))

    mock_supabase.rpc = MagicMock(side_effect=_route_rpc)

    import logging
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.job_worker"):
        result = await _run_worker_happy_path(
            monkeypatch, mock_supabase, api_key_row_factory
        )

    assert result.outcome == jw.DispatchOutcome.DONE

    # Worker should have logged the warning — proves the failure was caught.
    matched = [
        rec for rec in caplog.records
        if "first_sync_success_at" in rec.getMessage()
    ]
    assert matched, (
        "expected a warning log mentioning first_sync_success_at; "
        f"got: {[r.getMessage() for r in caplog.records]}"
    )
