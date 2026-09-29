"""Phase 167.1.2 plan 12, review SFH-R2-01: the daily refresh must not write the
FIRST legacy snapshot row of a book while that book's history reconstruct is
still in flight.

WHY this matters. The daily fan-out (migration 20260927120000) bootstraps a
book with ZERO ``allocator_equity_snapshots`` rows: it enqueues one
``reconstruct_allocator_history`` job per qualifying key, and the book's
``refresh_allocator_equity_daily`` job in the SAME run. The refresh is fast and
the reconstruct crawl runs up to 30 minutes, so the refresh usually runs first.
If it wrote today's row, the book would have a snapshot, and when the
reconstruct then ended ``failed_final`` the fan-out would never bootstrap the
book again (it only bootstraps zero-snapshot books, D-17 (c)): the key's
backfill would be lost for good. So while the book has zero snapshots and any
of its keys has a reconstruct in flight (pending, running,
done_pending_children, failed_retry), the refresh writes nothing, audits the
hold under its own action, and ends DONE. A failed reconstruct then leaves the
book at zero, and the next fan-out run retries it.

Every test drives the real job against the in-memory fake the other refresh
tests use, so the assertion is on the persisted snapshot row, not on a helper.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any
from unittest.mock import AsyncMock

import pytest

from services.equity_reconstruction import run_refresh_allocator_equity_daily_job
from services.job_worker import DispatchOutcome
from tests.test_equity_reconstruction import (
    ALLOCATOR_ID,
    API_KEY_ID_1,
    API_KEY_ID_2,
    FakeSupabaseClient,
    _FakeTable,
    _install_fake_audit,
    _install_fake_preflight,
)

TODAY = date(2026, 9, 27)
HELD_ACTION = "allocator.equity.refresh_held_for_reconstruct"
IN_FLIGHT_STATUSES = ("pending", "running", "done_pending_children", "failed_retry")


class _FailingTable(_FakeTable):
    """A table whose SELECT raises when the test names it, to prove a failed
    probe read fails the job instead of falling through to the write."""

    def __init__(self, name: str, store: dict, fail_tables: set[str]):
        super().__init__(name, store)
        self._fail_tables = fail_tables

    def execute(self) -> Any:
        if self._pending_op == "select" and self._name in self._fail_tables:
            raise RuntimeError(f"fixture: read of {self._name} failed")
        return super().execute()


class _ProbeFakeClient(FakeSupabaseClient):
    def __init__(self) -> None:
        super().__init__()
        self.fail_tables: set[str] = set()

    def table(self, name: str) -> _FakeTable:
        return _FailingTable(name, self.store, self.fail_tables)


def _seed_key(fake: FakeSupabaseClient, key_id: str) -> None:
    fake.store[("api_keys", (key_id,))] = {
        "id": key_id,
        "user_id": ALLOCATOR_ID,
        "is_active": True,
        "sync_status": "ok",
        "disconnected_at": None,
        "account_share_kind": None,
        "account_shared_with_api_key_id": None,
    }


def _seed_holding(fake: FakeSupabaseClient, key_id: str, value_usd: float) -> None:
    fake.store[("allocator_holdings", (ALLOCATOR_ID, "okx", "USDT", TODAY.isoformat(), key_id))] = {
        "allocator_id": ALLOCATOR_ID,
        "api_key_id": key_id,
        "venue": "okx",
        "symbol": "USDT",
        "asof": TODAY.isoformat(),
        "quantity": value_usd,
        "mark_price": 1.0,
        "value_usd": value_usd,
        "unrealized_pnl_usd": None,
        "holding_type": "spot",
    }


def _seed_reconstruct(fake: FakeSupabaseClient, key_id: str, status: str) -> None:
    fake.store[("compute_jobs", (f"recon-{key_id}-{status}",))] = {
        "id": f"recon-{key_id}-{status}",
        "kind": "reconstruct_allocator_history",
        "api_key_id": key_id,
        "status": status,
    }


def _seed_snapshot(fake: FakeSupabaseClient, asof: date) -> None:
    fake.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof.isoformat()))] = {
        "allocator_id": ALLOCATOR_ID,
        "asof": asof.isoformat(),
        "value_usd": 1.0,
        "source": "exchange_primary",
    }


def _book(*, holding_keys: tuple[str, ...] = (API_KEY_ID_1,)) -> _ProbeFakeClient:
    fake = _ProbeFakeClient()
    for key_id in (API_KEY_ID_1, API_KEY_ID_2):
        _seed_key(fake, key_id)
    for key_id in holding_keys:
        _seed_holding(fake, key_id, 1000.0)
    return fake


async def _run(monkeypatch: pytest.MonkeyPatch, fake: FakeSupabaseClient) -> tuple[Any, Any]:
    audit = _install_fake_audit(monkeypatch)
    exchange = AsyncMock()
    exchange.id = "okx"
    exchange.close = AsyncMock()
    _install_fake_preflight(monkeypatch, "okx", fake, exchange)

    from services import equity_reconstruction as er

    now = datetime(TODAY.year, TODAY.month, TODAY.day, 5, 0, tzinfo=timezone.utc)

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz: Any = None) -> Any:  # type: ignore[override]
            return now if tz else now.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)
    result = await run_refresh_allocator_equity_daily_job(
        {"id": "refresh-1", "kind": "refresh_allocator_equity_daily", "api_key_id": API_KEY_ID_1}
    )
    return result, audit


def _today_rows(fake: FakeSupabaseClient) -> list[dict[str, Any]]:
    return [
        r for r in fake.rows_for("allocator_equity_snapshots")
        if r["asof"] == TODAY.isoformat()
    ]


def _actions(audit: Any) -> list[str]:
    return [c.kwargs.get("action") for c in audit.call_args_list]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", IN_FLIGHT_STATUSES)
@pytest.mark.parametrize("reconstructing_key", [API_KEY_ID_1, API_KEY_ID_2])
async def test_zero_snapshot_book_with_inflight_reconstruct_is_held(
    monkeypatch: pytest.MonkeyPatch, status: str, reconstructing_key: str
) -> None:
    """A zero-snapshot book with holdings, and a reconstruct in flight for the
    refreshing key or for a SIBLING key of the same book: no row is written,
    the hold is audited under its own action with counts only, and the job ends
    DONE. Before the fix the refresh wrote today's row, which closed the
    fan-out's zero-snapshot gate before the reconstruct had succeeded."""
    fake = _book()
    _seed_reconstruct(fake, reconstructing_key, status)

    result, audit = await _run(monkeypatch, fake)

    assert result.outcome == DispatchOutcome.DONE, result
    assert _today_rows(fake) == [], (
        "the refresh wrote the book's FIRST snapshot row while a reconstruct "
        f"({status}) was in flight; a later failed_final would strand the key"
    )
    held = [c for c in audit.call_args_list if c.kwargs.get("action") == HELD_ACTION]
    assert len(held) == 1, _actions(audit)
    metadata = held[0].kwargs["metadata"]
    assert metadata["reason"] == "reconstruct_in_flight"
    assert metadata["inflight_reconstructs"] == 1
    # Counts and the venue only: no USD figure, no key id in the metadata.
    assert "value_usd" not in metadata and "total" not in metadata
    assert all(str(v) not in (API_KEY_ID_1, API_KEY_ID_2) for v in metadata.values())
    assert "allocator.equity.refresh_complete" not in _actions(audit)


@pytest.mark.asyncio
async def test_done_reconstruct_on_zero_snapshot_book_still_writes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Control: a reconstruct that finished (done) does not hold the refresh. A
    zero-snapshot book whose reconstruct wrote no rows is exactly the book the
    daily refresh must start, or the hold would keep it at zero forever."""
    fake = _book()
    _seed_reconstruct(fake, API_KEY_ID_1, "done")

    result, audit = await _run(monkeypatch, fake)

    assert result.outcome == DispatchOutcome.DONE, result
    assert len(_today_rows(fake)) == 1
    assert HELD_ACTION not in _actions(audit)
    assert "allocator.equity.refresh_complete" in _actions(audit)


@pytest.mark.asyncio
async def test_book_with_snapshots_writes_despite_inflight_reconstruct(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Control: the hold is for a book's FIRST row only. A book that already has
    history keeps its daily row while a key's reconstruct runs (a user's
    re-sync of an established book must not cost it a day)."""
    fake = _book()
    _seed_snapshot(fake, date(2026, 9, 20))
    _seed_reconstruct(fake, API_KEY_ID_2, "running")

    result, audit = await _run(monkeypatch, fake)

    assert result.outcome == DispatchOutcome.DONE, result
    assert len(_today_rows(fake)) == 1
    assert HELD_ACTION not in _actions(audit)


@pytest.mark.asyncio
async def test_no_holdings_path_is_unchanged_by_the_hold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A zero-snapshot book with NO holdings keeps its existing outcome
    (refresh_complete, reason no_holdings_today) even with a reconstruct in
    flight: the hold sits after that early return, so it never reads."""
    fake = _book(holding_keys=())
    _seed_reconstruct(fake, API_KEY_ID_1, "pending")
    fake.fail_tables.add("compute_jobs")

    result, audit = await _run(monkeypatch, fake)

    assert result.outcome == DispatchOutcome.DONE, result
    assert _today_rows(fake) == []
    complete = [
        c for c in audit.call_args_list
        if c.kwargs.get("action") == "allocator.equity.refresh_complete"
    ]
    assert len(complete) == 1 and complete[0].kwargs["metadata"]["reason"] == "no_holdings_today"
    assert HELD_ACTION not in _actions(audit)


@pytest.mark.asyncio
@pytest.mark.parametrize("failing_table", ["allocator_equity_snapshots", "api_keys_probe", "compute_jobs"])
async def test_a_failed_probe_read_fails_the_job_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch, failing_table: str
) -> None:
    """A read failure inside the hold's probe must fail the job LOUDLY (FAILED,
    refresh_failed audit) and must never fall through to writing the row: a
    swallowed probe would re-open the loss this hold closes."""
    fake = _book()
    _seed_reconstruct(fake, API_KEY_ID_1, "pending")
    if failing_table == "api_keys_probe":
        # api_keys is also read by the holdings fetch, before the probe, so a
        # blanket failure there would fail the job for another reason. Fail it
        # only once the holdings have been read: on the probe's own read.
        from services import equity_reconstruction as er

        original = er._fetch_latest_holdings_per_eligible_key

        async def _then_fail(*args: Any, **kwargs: Any) -> Any:
            latest = await original(*args, **kwargs)
            fake.fail_tables.add("api_keys")
            return latest

        monkeypatch.setattr(er, "_fetch_latest_holdings_per_eligible_key", _then_fail)
    else:
        fake.fail_tables.add(failing_table)

    result, audit = await _run(monkeypatch, fake)

    assert result.outcome == DispatchOutcome.FAILED, result
    assert _today_rows(fake) == []
    assert "allocator.equity.refresh_failed" in _actions(audit)
    assert HELD_ACTION not in _actions(audit)
