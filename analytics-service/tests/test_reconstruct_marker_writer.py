"""Phase 167.1.2.1 RECONMARKER, plan 05 (PR 2, the worker half): the per-key
reconstruct marker ``api_keys.history_reconstructed_at``.

WHY these tests exist. Before this phase "has this key been reconstructed?" was
answered from a retained ``done`` compute_jobs row, and that row is deleted by
the 30-day ``done`` retention. The marker is a column on the key, set by the
reconstruct job itself and read by every decider. Three rules matter more than
the rest, and each test below is named for the one it guards:

1. A marker is stamped ONLY on a clean completion ladder exit
   (``reconstruct_complete``, ``reconstruct_partial_unsupported``,
   ``reconstruct_no_data``), BEFORE that exit's completion audit, and a failed
   write FAILS the job. Never on a failed or partial reconstruct, never on the
   short-circuit, never on a D-15 no-op (``reconstruct_unexpected_noop``).
2. ``_api_key_already_reconstructed`` answers from the marker ONLY. A retained
   ``done`` job is not evidence (a D-15 no-op also ends ``done``), so it neither
   short-circuits nor heals the marker (plan-checker B1).
3. A sibling's failure never marks a key: the marker is per key (SC-4).

Every test drives the real handler against the in-memory fake the other
reconstruct tests use, so each assertion is on the persisted ``api_keys`` row.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock

import pytest

from services.equity_reconstruction import run_reconstruct_allocator_history_job
from services.job_worker import DispatchOutcome
from tests._trade_pages import VenueTradeBook
from tests.test_equity_reconstruction import (
    ALLOCATOR_ID,
    API_KEY_ID_1,
    API_KEY_ID_2,
    FakeSupabaseClient,
    _FakeTable,
    _FakeUpdateResult,
    _install_fake_audit,
    _install_fake_preflight,
    _make_ohlcv_row,
    _make_trade,
)

END_DATE = datetime(2026, 4, 15, tzinfo=timezone.utc)
DAY_MS = 24 * 60 * 60 * 1000

COMPLETE = "allocator.equity.reconstruct_complete"
NO_DATA = "allocator.equity.reconstruct_no_data"
PARTIAL = "allocator.equity.reconstruct_partial_unsupported"
NOOP = "allocator.equity.reconstruct_unexpected_noop"
FAILED_ACTION = "allocator.equity.reconstruct_failed"
COMPLETION_ACTIONS = {COMPLETE, NO_DATA, PARTIAL, NOOP}


class _RecordingTable(_FakeTable):
    """A table that records every UPDATE and can be told to refuse one."""

    def __init__(self, name: str, store: dict, client: "_MarkerFake") -> None:
        super().__init__(name, store)
        self._client = client

    _is_head = False

    def select(self, *args: Any, head: bool = False, **kwargs: Any) -> "_RecordingTable":
        # The sibling count is the one HEAD request on api_keys.
        self._is_head = head
        super().select(*args, head=head, **kwargs)
        return self

    def update(self, payload: dict) -> "_RecordingTable":
        self._client.updates.append((self._name, dict(payload)))
        if self._name in self._client.fail_update_tables:
            raise RuntimeError(f"fixture: update of {self._name} refused")
        super().update(payload)
        return self

    def execute(self) -> Any:
        if (
            self._pending_op == "select"
            and self._is_head
            and self._name == "api_keys"
            and self._client.fail_sibling_lookup
        ):
            raise RuntimeError("fixture: sibling lookup failed")
        if self._pending_op == "update" and self._name in self._client.match_no_row_tables:
            # PostgREST answering an UPDATE whose filter matched nothing: 200 and [].
            return _FakeUpdateResult([])
        return super().execute()


class _MarkerFake(FakeSupabaseClient):
    def __init__(self) -> None:
        super().__init__()
        self.updates: list[tuple[str, dict]] = []
        self.fail_update_tables: set[str] = set()
        self.match_no_row_tables: set[str] = set()
        self.fail_sibling_lookup = False

    def table(self, name: str) -> _FakeTable:
        return _RecordingTable(name, self.store, self)

    def api_key_updates(self) -> list[dict]:
        return [p for (t, p) in self.updates if t == "api_keys"]


def _seed_key(
    fake: FakeSupabaseClient,
    key_id: str,
    *,
    marker: str | None = None,
    attempts: int = 1,
    exchange: str = "binance",
) -> None:
    fake.store[("api_keys", (key_id,))] = {
        "id": key_id,
        "user_id": ALLOCATOR_ID,
        "exchange": exchange,
        "is_active": True,
        "sync_status": "ok",
        "disconnected_at": None,
        "history_reconstructed_at": marker,
        "history_reconstruct_attempts": attempts,
    }


def _marker_of(fake: FakeSupabaseClient, key_id: str) -> Any:
    return fake.store[("api_keys", (key_id,))].get("history_reconstructed_at")


def _seed_done_job(fake: FakeSupabaseClient, key_id: str) -> None:
    fake.store[("compute_jobs", (f"done-{key_id}",))] = {
        "id": f"done-{key_id}",
        "api_key_id": key_id,
        "kind": "reconstruct_allocator_history",
        "status": "done",
    }


def _crawl_exchange(*, fail: bool = False) -> AsyncMock:
    """An exchange whose crawl yields priced history: one BTC buy ten days back
    and a flat 50000 close for every day.

    ``fetch_my_trades`` answers like the venue ``exchange.id`` names AT CALL TIME
    (TRADEPAGES), so a test that sets ``id`` to ``bybit`` or ``okx`` gets that
    venue's paging rules; the untyped BTC/USDT trade is served on OKX's spot pass
    only, once."""
    start = END_DATE - timedelta(days=9)
    ts = int(start.timestamp() * 1000)
    trades = [_make_trade(ts, "BTC/USDT", "buy", 50000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + d * DAY_MS, 50000.0) for d in range(10)]
    exchange = AsyncMock()
    exchange.id = "binance"
    if fail:
        exchange.fetch_my_trades = AsyncMock(side_effect=RuntimeError("fixture: fetch failed"))
    else:
        exchange.fetch_my_trades = AsyncMock(side_effect=VenueTradeBook(exchange, trades))
    exchange.fetch_deposits = AsyncMock(return_value=[])
    exchange.fetch_withdrawals = AsyncMock(return_value=[])
    exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    exchange.close = AsyncMock()
    return exchange


def _freeze_now(monkeypatch: pytest.MonkeyPatch) -> None:
    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz: Any = None) -> Any:  # type: ignore[override]
            return END_DATE if tz else END_DATE.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)


def _record_audit_with_marker(
    monkeypatch: pytest.MonkeyPatch, fake: FakeSupabaseClient, key_id: str
) -> list[tuple[str, Any]]:
    """Install the fake audit and record, per call, the action and the key's
    marker AT THE MOMENT OF THAT CALL, so ordering is observed, not inferred."""
    audit = _install_fake_audit(monkeypatch)
    seen: list[tuple[str, Any]] = []

    def _side_effect(*_a: Any, **kw: Any) -> None:
        seen.append((kw["action"], _marker_of(fake, key_id)))

    audit.side_effect = _side_effect
    return seen


def _job(key_id: str = API_KEY_ID_1) -> dict[str, Any]:
    return {"id": "job-1", "kind": "reconstruct_allocator_history", "api_key_id": key_id}


# ---------------------------------------------------------------------------
# Test 1 (tracer)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_completed_reconstruct_sets_marker_before_its_audit_then_short_circuits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A full reconstruct of an unmarked sole key persists rows, ends DONE and
    leaves ``history_reconstructed_at`` non-null, written BEFORE the
    ``reconstruct_complete`` audit. The next run for the same key short-circuits
    on the marker alone, without touching the exchange."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1)
    seen = _record_audit_with_marker(monkeypatch, fake, API_KEY_ID_1)
    exchange = _crawl_exchange()
    _install_fake_preflight(monkeypatch, "binance", fake, exchange)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_job())

    assert result.outcome == DispatchOutcome.DONE, result
    assert fake.rows_for("allocator_equity_snapshots"), "the fixture must persist rows"
    assert _marker_of(fake, API_KEY_ID_1) is not None, (
        "a completed reconstruct left its key's marker NULL: the key would be "
        "re-crawled by the daily fan-out for ever"
    )
    complete = [marker for (action, marker) in seen if action == COMPLETE]
    assert len(complete) == 1, seen
    assert complete[0] is not None, (
        "the completion audit was emitted BEFORE the marker write; a marker "
        "failure would leave a success event for a key still owed"
    )

    fetches_after_first = exchange.fetch_my_trades.await_count
    again = await run_reconstruct_allocator_history_job(_job())
    assert again.outcome == DispatchOutcome.DONE, again
    assert exchange.fetch_my_trades.await_count == fetches_after_first, (
        "a marked key was crawled again instead of short-circuiting"
    )


# ---------------------------------------------------------------------------
# Test 2 / 3b
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_marked_key_short_circuits_with_no_compute_jobs_row_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The reaped case: a marked key whose ``done`` job the 30-day retention
    deleted still short-circuits (RED on a done-row-only check), and the
    short-circuit performs no UPDATE on ``api_keys`` (a short-circuit cannot
    create success evidence)."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker="2026-03-01T00:00:00+00:00")
    audit = _install_fake_audit(monkeypatch)
    exchange = _crawl_exchange()
    _install_fake_preflight(monkeypatch, "binance", fake, exchange)

    result = await run_reconstruct_allocator_history_job(_job())

    assert result.outcome == DispatchOutcome.DONE, result
    assert exchange.fetch_my_trades.await_count == 0
    reasons = [c.kwargs["metadata"].get("reason") for c in audit.call_args_list]
    assert "already_reconstructed_for_api_key" in reasons, audit.call_args_list
    assert fake.api_key_updates() == [], (
        "the short-circuit wrote to api_keys; it must never create marker evidence"
    )
    assert _marker_of(fake, API_KEY_ID_1) == "2026-03-01T00:00:00+00:00"


# ---------------------------------------------------------------------------
# Test 3 (B1, RED-first)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unmarked_key_with_retained_done_job_is_crawled_and_a_noop_stays_unmarked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Plan-checker B1. A key whose last outcome was a sole-key no-op ended
    ``done`` (a done row is retained) but is NOT reconstructed. Retrying it must
    run a REAL crawl, and when that crawl again writes 0 rows from a non-empty
    payload the marker stays NULL. On the done-row check this retry was
    short-circuited without crawling, and the key could never be repaired."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=None, attempts=2)
    _seed_done_job(fake, API_KEY_ID_1)
    audit = _install_fake_audit(monkeypatch)
    exchange = _crawl_exchange()
    _install_fake_preflight(monkeypatch, "binance", fake, exchange)
    _freeze_now(monkeypatch)

    from services import equity_reconstruction as er

    monkeypatch.setattr(er, "replace_equity_snapshots", AsyncMock(return_value=0))

    result = await run_reconstruct_allocator_history_job(_job())

    assert result.outcome == DispatchOutcome.DONE, result
    assert exchange.fetch_my_trades.await_count > 0, (
        "an unmarked key with a retained done job was short-circuited instead "
        "of crawled (the done row is not evidence of a reconstruct)"
    )
    actions = [c.kwargs["action"] for c in audit.call_args_list]
    assert NOOP in actions, actions
    assert COMPLETE not in actions
    assert _marker_of(fake, API_KEY_ID_1) is None, (
        "a D-15 no-op (0 rows written from a non-empty payload) was marked as reconstructed"
    )


# ---------------------------------------------------------------------------
# Test 4
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["update_raises", "update_matches_no_row"])
async def test_a_failed_marker_write_fails_the_job_and_emits_no_completion_audit(
    monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    """A swallowed marker failure would re-open the defect this phase closes: a
    success audit for a key still owed. Either an UPDATE that raises or one that
    touches no row FAILS the job (transient: the persisted rows are idempotent,
    a retry is safe), and no completion audit is emitted."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1)
    if failure == "update_raises":
        fake.fail_update_tables.add("api_keys")
    else:
        fake.match_no_row_tables.add("api_keys")
    audit = _install_fake_audit(monkeypatch)
    exchange = _crawl_exchange()
    _install_fake_preflight(monkeypatch, "binance", fake, exchange)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_job())

    assert result.outcome == DispatchOutcome.FAILED, result
    assert result.error_kind == "transient", result
    actions = [c.kwargs["action"] for c in audit.call_args_list]
    assert not (set(actions) & COMPLETION_ACTIONS), (
        f"a completion audit was emitted although the marker write failed: {actions}"
    )


# ---------------------------------------------------------------------------
# Test 5 (D-15)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sole_key_noop_ends_done_with_the_marker_still_null(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-15: a sole-key DONE that wrote 0 rows from a non-empty payload ends
    DONE but the key stays owed."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1)
    audit = _install_fake_audit(monkeypatch)
    _install_fake_preflight(monkeypatch, "binance", fake, _crawl_exchange())
    _freeze_now(monkeypatch)

    from services import equity_reconstruction as er

    monkeypatch.setattr(er, "replace_equity_snapshots", AsyncMock(return_value=0))

    result = await run_reconstruct_allocator_history_job(_job())

    assert result.outcome == DispatchOutcome.DONE, result
    assert NOOP in [c.kwargs["action"] for c in audit.call_args_list]
    assert _marker_of(fake, API_KEY_ID_1) is None
    assert fake.api_key_updates() == []


# ---------------------------------------------------------------------------
# Test 6 (SC-4)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_failed_sibling_reconstruct_leaves_only_its_own_marker_null(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SC-4: allocator with keys A and B. A's reconstruct completes, B's fails on
    a fetch error. A is marked and B is not: the marker is per key, so B stays
    owed for the daily fan-out even though the allocator now has history."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1)
    _seed_key(fake, API_KEY_ID_2)
    _install_fake_audit(monkeypatch)
    _freeze_now(monkeypatch)

    _install_fake_preflight(monkeypatch, "binance", fake, _crawl_exchange())
    a = await run_reconstruct_allocator_history_job(_job(API_KEY_ID_1))
    assert a.outcome == DispatchOutcome.DONE, a

    _install_fake_preflight(monkeypatch, "binance", fake, _crawl_exchange(fail=True))
    b = await run_reconstruct_allocator_history_job(_job(API_KEY_ID_2))
    assert b.outcome == DispatchOutcome.FAILED, b

    assert _marker_of(fake, API_KEY_ID_1) is not None
    assert _marker_of(fake, API_KEY_ID_2) is None, (
        "key B's reconstruct failed, yet its marker was set"
    )


# ---------------------------------------------------------------------------
# Test 7 (review CR-01): a transient lookup failure is not a completion
# ---------------------------------------------------------------------------
#
# PR 1's backfill (migration 20261014120000, SFH-2) treats an audit row carrying
# ``sibling_check_failed`` or ``snapshot_lookup_failed`` as a TRANSIENT FAILURE:
# it does not say the key's history was rebuilt, so the backfill withholds the
# marker. The live writer must agree, or one phase holds two definitions of
# "reconstructed" and a stale curve becomes permanent (the marker has no expiry).


@pytest.mark.asyncio
async def test_a_failed_sibling_lookup_leaves_the_marker_null(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The sibling count raises, so the worker falls back to the multi-key
    ON CONFLICT DO NOTHING path and cannot know whether the key is the sole one.
    Whatever it persisted may have been dropped by a collision with existing
    rows; the key's history was not demonstrably rebuilt. The job still ends DONE
    (the fail-safe is unchanged) but the key stays owed for the next fan-out.
    RED on the gate that stamps every audit kind except the D-15 no-op."""
    fake = _MarkerFake()
    fake.fail_sibling_lookup = True
    _seed_key(fake, API_KEY_ID_1)
    audit = _install_fake_audit(monkeypatch)
    _install_fake_preflight(monkeypatch, "binance", fake, _crawl_exchange())
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_job())

    assert result.outcome == DispatchOutcome.DONE, result
    metadata = [
        c.kwargs["metadata"]
        for c in audit.call_args_list
        if c.kwargs["action"] in COMPLETION_ACTIONS
    ]
    assert metadata and metadata[0].get("sibling_check_failed") is True, (
        "the fixture must reach the completion ladder through the failed sibling lookup"
    )
    assert _marker_of(fake, API_KEY_ID_1) is None, (
        "a reconstruct whose sibling lookup failed was stamped as reconstructed; "
        "the PR 1 backfill refuses to mark exactly this outcome"
    )
    assert fake.api_key_updates() == []


@pytest.mark.asyncio
async def test_a_failed_snapshot_lookup_leaves_the_marker_null(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty sole-key replace is refused because the snapshot-presence lookup
    itself failed (``snapshot_lookup_failed``). That outcome is
    ``reconstruct_no_data`` and says nothing about the key's history, so the
    marker stays NULL. RED on the same gate."""
    from tests.test_equity_reconstruction import (
        _fail_snapshot_head_count,
        _install_item7b_empty_replay,
        _seed_item7b_history,
    )

    fake = _MarkerFake()
    _seed_item7b_history(fake)
    audit = _install_item7b_empty_replay(monkeypatch, fake)
    _fail_snapshot_head_count(fake)

    result = await run_reconstruct_allocator_history_job(_job())

    assert result.outcome == DispatchOutcome.DONE, result
    no_data = [
        c.kwargs["metadata"]
        for c in audit.call_args_list
        if c.kwargs["action"] == NO_DATA
    ]
    assert no_data and no_data[0].get("snapshot_lookup_failed") is True, (
        "the fixture must reach reconstruct_no_data through the failed snapshot lookup"
    )
    assert _marker_of(fake, API_KEY_ID_1) is None, (
        "a reconstruct whose snapshot lookup failed was stamped as reconstructed; "
        "the PR 1 backfill refuses to mark exactly this outcome"
    )


@pytest.mark.asyncio
async def test_a_confirmed_existing_history_refusal_is_still_marked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Control for the pair above, differing in one attribute: the snapshot
    lookup SUCCEEDED and confirmed existing history, so the empty replace was
    refused for a real reason (``purge_refused`` with ``existing_history``). That
    is a settled ``reconstruct_no_data`` outcome and stays marked."""
    from tests.test_equity_reconstruction import (
        _install_item7b_empty_replay,
        _seed_item7b_history,
    )

    fake = _MarkerFake()
    _seed_item7b_history(fake)
    audit = _install_item7b_empty_replay(monkeypatch, fake)

    result = await run_reconstruct_allocator_history_job(_job())

    assert result.outcome == DispatchOutcome.DONE, result
    no_data = [
        c.kwargs["metadata"]
        for c in audit.call_args_list
        if c.kwargs["action"] == NO_DATA
    ]
    assert no_data and no_data[0].get("snapshot_lookup_failed") is False
    assert _marker_of(fake, API_KEY_ID_1) is not None
