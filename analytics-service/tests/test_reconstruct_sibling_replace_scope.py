"""SC-3 / D-07: a sole-key replace never deletes another key's allocator history.

``allocator_equity_snapshots`` rows are allocator TOTALS, not per key (D-07).
``run_reconstruct_allocator_history_job`` calls ``replace_equity_snapshots``
(the ``replace_allocator_equity_snapshots`` RPC, which DELETEs every snapshot
row of the allocator) only when ``_allocator_has_other_api_keys`` reports no
sibling; otherwise it calls ``persist_equity_snapshots`` (ON CONFLICT DO
NOTHING, first writer wins).

Before D-07 the sibling test counted only CONNECTED siblings (is_active,
not revoked, not disconnected), so a reconstruct for key B wiped the rows a
disconnected key A had contributed (R-13-1). D-07 counts EVERY other api_keys
row of the owner: this schema has no soft delete (a delete is a hard DELETE),
so any surviving row is a non-deleted sibling, whatever its ``is_active``,
``sync_status`` (revoked and NULL included) or ``disconnected_at``.

These tests drive the whole job end to end. The sibling lookup is not called
directly, so a test fails only when the BEHAVIOUR (replace vs persist, rows
kept vs deleted) changes, not when the helper is refactored.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock

import pytest

from services.equity_reconstruction import run_reconstruct_allocator_history_job
from services.job_worker import DispatchOutcome
from tests.test_equity_reconstruction import (
    ALLOCATOR_ID,
    API_KEY_ID_1,
    API_KEY_ID_2,
    FakeSupabaseClient,
    _FakeSelectResult,
    _FakeTable,
    _install_fake_audit,
    _install_fake_preflight,
    _make_ohlcv_row,
    _make_trade,
)

REPLACE_RPC = "replace_allocator_equity_snapshots"
# A value the replayed curve never produces, so a surviving row is provably the
# pre-existing one and a wiped row provably gone.
EXISTING_SENTINEL = 424_242.0


class _PostgrestNullTable(_FakeTable):
    """``_FakeTable`` with PostgREST's NULL semantics for ``neq``.

    In PostgREST ``col <> 'x'`` is NULL, not true, when ``col`` is NULL, so
    ``.neq("sync_status", "revoked")`` silently EXCLUDES a row whose
    ``sync_status`` is NULL. The shared fake treats NULL as "not equal" and
    includes the row, which hides exactly the quirk the pre-D-07 predicate had.
    Without this, the NULL-status arm could not fail on the old predicate.
    """

    def execute(self) -> Any:
        result = super().execute()
        if self._pending_op != "select":
            return result
        kept = [
            row for row in result.data
            if all(row.get(col) is not None for col, _ in self._select_neq_filters)
        ]
        if self._select_count_mode == "exact":
            return _FakeSelectResult(data=kept, count=len(kept))
        return _FakeSelectResult(data=kept)


class _PostgrestNullClient(FakeSupabaseClient):
    def table(self, name: str) -> _FakeTable:
        return _PostgrestNullTable(name, self.store)


def _key_row(key_id: str, exchange: str, **overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": key_id,
        "user_id": ALLOCATOR_ID,
        "exchange": exchange,
        "is_active": True,
        "sync_status": "ok",
        "disconnected_at": None,
    }
    row.update(overrides)
    return row


async def _reconstruct_key_b(
    monkeypatch: pytest.MonkeyPatch,
    sibling: dict[str, Any] | None,
) -> tuple[_PostgrestNullClient, Any]:
    """Reconstruct key B (``API_KEY_ID_1``) for an allocator that already holds
    ten snapshot rows, optionally beside ``sibling`` (an ``API_KEY_ID_2`` row).
    Returns the fake database and the audit mock."""
    fake = _PostgrestNullClient()
    audit_mock = _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=9)

    for offset in range(10):
        asof = (start_date + timedelta(days=offset)).date().isoformat()
        fake.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID,
            "asof": asof,
            "value_usd": EXISTING_SENTINEL,
            "breakdown": {"EXISTING": EXISTING_SENTINEL},
            "source": "exchange_primary",
            "history_depth_months": 24,
            "reconstructed_at": "2026-04-01T00:00:00+00:00",
        }

    fake.store[("api_keys", (API_KEY_ID_1,))] = _key_row(API_KEY_ID_1, "binance")
    if sibling is not None:
        fake.store[("api_keys", (API_KEY_ID_2,))] = sibling

    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000
    trades = [_make_trade(ts, "BTC/USDT", "buy", 50_000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + d * day_ms, 50_000.0) for d in range(10)]

    exchange = AsyncMock()
    exchange.id = "binance"
    exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    exchange.fetch_deposits = AsyncMock(return_value=[])
    exchange.fetch_withdrawals = AsyncMock(return_value=[])
    exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake, exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz: Any = None) -> datetime:
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    result = await run_reconstruct_allocator_history_job({
        "id": "job-sibling-replace-scope",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    })
    assert result.outcome == DispatchOutcome.DONE, result
    return fake, audit_mock


def _replace_calls(fake: FakeSupabaseClient) -> list[tuple[str, dict]]:
    return [call for call in fake.rpc_calls if call[0] == REPLACE_RPC]


def _surviving_existing_rows(fake: FakeSupabaseClient) -> list[dict]:
    return [
        row for row in fake.rows_for("allocator_equity_snapshots")
        if row.get("value_usd") == EXISTING_SENTINEL
    ]


def _complete_meta(audit_mock: Any) -> dict[str, Any]:
    calls = [
        c for c in audit_mock.call_args_list
        if c.kwargs.get("action") == "allocator.equity.reconstruct_complete"
    ]
    assert calls, audit_mock.call_args_list
    return calls[-1].kwargs.get("metadata") or {}


async def _assert_sibling_blocks_replace(
    monkeypatch: pytest.MonkeyPatch, sibling: dict[str, Any], why: str,
) -> None:
    fake, audit_mock = await _reconstruct_key_b(monkeypatch, sibling)

    assert not _replace_calls(fake), (
        f"D-07: {why} is a non-deleted sibling, so the allocator-wide "
        f"{REPLACE_RPC} DELETE must not run. rpc_calls={fake.rpc_calls!r}"
    )
    survivors = _surviving_existing_rows(fake)
    assert len(survivors) == 10, (
        f"D-07: {why} contributed history; all 10 existing allocator snapshot "
        f"rows must survive a reconstruct for the other key. "
        f"Got {len(survivors)}: {fake.rows_for('allocator_equity_snapshots')!r}"
    )
    meta = _complete_meta(audit_mock)
    assert meta.get("atomic_replace") is False, meta
    assert meta.get("stale_snapshots_purged") == 0, meta


# ---------------------------------------------------------------------------
# Test 1 (tracer) and Test 2 (positive control)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_disconnected_sibling_blocks_replace_and_keeps_allocator_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SC-3 / D-07 (R-13-1): key A is soft-disconnected (``disconnected_at``
    set, still ``is_active`` and ``idle``/``ok``); key B is the only CONNECTED
    key. A reconstruct for B must persist with first-writer-wins and leave the
    rows A contributed in place. The pre-D-07 predicate counted connected
    siblings only, saw none, and replaced (DELETEd) the allocator's history."""
    await _assert_sibling_blocks_replace(
        monkeypatch,
        _key_row(
            API_KEY_ID_2, "okx",
            disconnected_at="2026-04-20T12:00:00+00:00",
        ),
        "a disconnected key",
    )


@pytest.mark.asyncio
async def test_sole_key_still_replaces_stale_allocator_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Positive control: with no other api_keys row the sole-key replace runs
    and rewrites the allocator's rows. Proves the arms above observe the
    replace path at all, so their 'RPC not called' reading is not vacuous."""
    fake, audit_mock = await _reconstruct_key_b(monkeypatch, None)

    assert len(_replace_calls(fake)) == 1, fake.rpc_calls
    assert not _surviving_existing_rows(fake), (
        "a truly sole key owns the series outright: stale rows are replaced"
    )
    assert fake.rows_for("allocator_equity_snapshots"), (
        "the replace must write the fresh rows, not only delete the old ones"
    )
    assert _complete_meta(audit_mock).get("atomic_replace") is True


# ---------------------------------------------------------------------------
# Tests 3-5: matched pairs. Each sibling differs from a plain connected sibling
# in exactly one attribute, so each arm names the attribute that must count.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoked_sibling_blocks_replace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A sibling with ``sync_status = 'revoked'`` (otherwise connected) blocks
    the replace: its rows are history, whatever its credentials do today."""
    await _assert_sibling_blocks_replace(
        monkeypatch,
        _key_row(API_KEY_ID_2, "okx", sync_status="revoked"),
        "a revoked key",
    )


@pytest.mark.asyncio
async def test_inactive_sibling_blocks_replace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A sibling with ``is_active = false`` (otherwise connected) blocks the
    replace."""
    await _assert_sibling_blocks_replace(
        monkeypatch,
        _key_row(API_KEY_ID_2, "okx", is_active=False),
        "an inactive key",
    )


@pytest.mark.asyncio
async def test_null_sync_status_sibling_blocks_replace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A sibling whose ``sync_status`` is NULL blocks the replace. The removed
    ``.neq("sync_status", "revoked")`` filter silently EXCLUDED such a row
    (PostgREST ``neq`` on NULL is not true), so a key with no status yet looked
    like no sibling at all. ``_PostgrestNullTable`` reproduces that semantic."""
    await _assert_sibling_blocks_replace(
        monkeypatch,
        _key_row(API_KEY_ID_2, "okx", sync_status=None),
        "a key with a NULL sync_status",
    )
