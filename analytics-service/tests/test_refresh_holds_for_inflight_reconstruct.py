"""The daily refresh must not write the FIRST legacy snapshot row of a book while
a key of that book still owes its history reconstruct.

Phase 167.1.2 plan 12 (review SFH-R2-01) introduced the hold for a reconstruct
IN FLIGHT. Phase 167.1.2.1 (RECONMARKER, SC-7, plan 05) re-keys it on the
per-key marker ``api_keys.history_reconstructed_at``. The filename is kept: the
167.1.2 threat register cites it.

WHY this matters. The daily fan-out bootstraps a book with ZERO
``allocator_equity_snapshots`` rows: it enqueues one
``reconstruct_allocator_history`` job per qualifying key, and the book's
``refresh_allocator_equity_daily`` job in the SAME run. The refresh is fast and
the reconstruct crawl runs up to 30 minutes. If the refresh wrote today's row
the book would have a snapshot, and a reconstruct that then failed would strand
the key's backfill. The old probe held only while a job was in flight, so a
reconstruct that reached ``failed_final`` BEFORE the refresh was claimed no
longer held the row (the SC-7 race). The hold now depends on the KEY, not on job
timing. While the book has zero snapshots and some key of the allocator either

  (a) is one the fan-out would still retry: marker NULL, 1 <= attempts < 5,
      is_active, sync_status not revoked / sign_in_failed / error, not
      disconnected, not Deribit, and not linked to one of the owner's
      non-archived strategies (``strategies.api_key_id`` or ``strategy_keys``,
      review WR-01); or
  (b) has a reconstruct job genuinely in flight (pending, running,
      done_pending_children, failed_retry) with its marker NULL,

the refresh writes nothing, audits the hold under its own action with reason
``reconstruct_owed``, and ends DONE. A capped, marked, never-attempted, or
no-longer-qualifying key (sign_in_failed, disconnected, inactive, revoked, error,
Deribit, strategy-linked) never holds a book, or the book would be frozen by a key nobody retries. Every
probe read RAISES (a swallowed read would fall through to the write).

Every test drives the real job against the in-memory fake the other refresh
tests use, so the assertion is on the persisted snapshot row, not on a helper.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
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
# 167.2.1.1.1.1 D-01: the refresh labels its one row the UTC day that closed.
CLOSED_DAY = TODAY - timedelta(days=1)
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


MARKED = "2026-09-01T00:00:00+00:00"


def _seed_key(fake: FakeSupabaseClient, key_id: str, **overrides: Any) -> None:
    fake.store[("api_keys", (key_id,))] = {
        "id": key_id,
        "user_id": ALLOCATOR_ID,
        "is_active": True,
        "sync_status": "ok",
        "disconnected_at": None,
        "account_share_kind": None,
        "account_shared_with_api_key_id": None,
        **overrides,
    }


def _seed_strategy(
    fake: FakeSupabaseClient,
    strategy_id: str,
    *,
    api_key_id: str | None = None,
    status: str = "published",
    user_id: str = ALLOCATOR_ID,
) -> None:
    fake.store[("strategies", (strategy_id,))] = {
        "id": strategy_id,
        "user_id": user_id,
        "api_key_id": api_key_id,
        "status": status,
    }


def _seed_strategy_key(fake: FakeSupabaseClient, strategy_id: str, api_key_id: str) -> None:
    fake.store[("strategy_keys", (strategy_id, api_key_id))] = {
        "strategy_id": strategy_id,
        "api_key_id": api_key_id,
    }


def _seed_holding(fake: FakeSupabaseClient, key_id: str, value_usd: float) -> None:
    fake.store[("allocator_holdings", (ALLOCATOR_ID, "okx", "USDT", TODAY.isoformat(), key_id))] = {
        "updated_at": "2026-09-20T04:00:00+00:00",
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


def _seed_polled_no_rows(fake: FakeSupabaseClient, key_id: str) -> None:
    """A key whose holdings poll COMPLETED and wrote no rows. Since 167.1.2.1.1
    D-01 a working key with no row AND no poll record is "never polled" and holds
    the day's write before the reconstruct probe is reached; these tests are
    about the reconstruct hold, so the key without holdings is one that was read
    (D-13: polled_no_rows neither holds nor carries)."""
    event_id = f"audit-{key_id}-polled"
    fake.store[("audit_log", (event_id,))] = {
        "id": event_id,
        "user_id": ALLOCATOR_ID,
        "action": "allocator.holdings.sync_completed",
        "entity_type": "api_key",
        "entity_id": key_id,
        "metadata": {"row_count": 0, "final_status": "complete", "asof": "2026-09-26"},
        "created_at": "2026-09-26T04:03:00+00:00",
    }


def _book(
    *,
    holding_keys: tuple[str, ...] = (API_KEY_ID_1,),
    key_fields: dict[str, dict[str, Any]] | None = None,
) -> _ProbeFakeClient:
    fake = _ProbeFakeClient()
    for key_id in (API_KEY_ID_1, API_KEY_ID_2):
        _seed_key(fake, key_id, **(key_fields or {}).get(key_id, {}))
    for key_id in holding_keys:
        _seed_holding(fake, key_id, 1000.0)
    for key_id in (API_KEY_ID_1, API_KEY_ID_2):
        if key_id not in holding_keys:
            _seed_polled_no_rows(fake, key_id)
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
        if r["asof"] == CLOSED_DAY.isoformat()
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
    assert metadata["reason"] == "reconstruct_owed"
    assert metadata["owed_reconstructs"] == 1
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


# The refreshing key is healthy and marked in every test below; the OTHER key of
# the book (API_KEY_ID_2) is the one under test, so each case differs from its
# control in exactly one attribute.
_REFRESHING_KEY_MARKED = {API_KEY_ID_1: {"history_reconstructed_at": MARKED}}


def _book_with_owed_sibling(**sibling_fields: Any) -> _ProbeFakeClient:
    return _book(
        key_fields={
            **_REFRESHING_KEY_MARKED,
            API_KEY_ID_2: {
                "history_reconstructed_at": None,
                "history_reconstruct_attempts": 1,
                **sibling_fields,
            },
        }
    )


async def _assert_held(monkeypatch: pytest.MonkeyPatch, fake: FakeSupabaseClient, why: str) -> None:
    result, audit = await _run(monkeypatch, fake)
    assert result.outcome == DispatchOutcome.DONE, result
    assert _today_rows(fake) == [], why
    held = [c for c in audit.call_args_list if c.kwargs.get("action") == HELD_ACTION]
    assert len(held) == 1, _actions(audit)
    assert held[0].kwargs["metadata"]["reason"] == "reconstruct_owed"


async def _assert_writes(monkeypatch: pytest.MonkeyPatch, fake: FakeSupabaseClient, why: str) -> None:
    result, audit = await _run(monkeypatch, fake)
    assert result.outcome == DispatchOutcome.DONE, result
    assert len(_today_rows(fake)) == 1, why
    assert HELD_ACTION not in _actions(audit), why


@pytest.mark.asyncio
async def test_failed_final_reconstruct_of_a_qualifying_owed_key_still_holds_the_first_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SC-7, the race. The key's only reconstruct job already reached
    failed_final BEFORE the refresh was claimed; nothing is in flight. The key is
    still owed (marker NULL, attempted once, under the cap, qualifying), so the
    fan-out will retry it tomorrow, and a first row written now would strand it.
    RED on the in-flight-only probe, which counted zero jobs here and wrote."""
    fake = _book_with_owed_sibling()
    _seed_reconstruct(fake, API_KEY_ID_2, "failed_final")

    await _assert_held(
        monkeypatch, fake,
        "the refresh wrote the FIRST row over a key the fan-out will retry "
        "(its reconstruct reached failed_final before the refresh was claimed)",
    )


@pytest.mark.asyncio
async def test_a_capped_owed_key_does_not_hold_the_book(monkeypatch: pytest.MonkeyPatch) -> None:
    """Attempts at the cap (5): the fan-out has given up and the D-09 event and
    the Overview note carry it. A hold that never lifts would freeze the book."""
    fake = _book_with_owed_sibling(history_reconstruct_attempts=5)
    _seed_reconstruct(fake, API_KEY_ID_2, "failed_final")

    await _assert_writes(monkeypatch, fake, "a capped key held the book's first row")


@pytest.mark.asyncio
async def test_an_attempt_short_of_the_cap_still_holds(monkeypatch: pytest.MonkeyPatch) -> None:
    """Control for the cap: attempts 4 is under the cap of 5 and still holds."""
    fake = _book_with_owed_sibling(history_reconstruct_attempts=4)

    await _assert_held(monkeypatch, fake, "a key at attempts 4 (under the cap) did not hold")


@pytest.mark.asyncio
async def test_a_marked_key_does_not_hold_the_book(monkeypatch: pytest.MonkeyPatch) -> None:
    """The key's reconstruct completed (marker set): nothing is owed."""
    fake = _book_with_owed_sibling(history_reconstructed_at=MARKED)

    await _assert_writes(monkeypatch, fake, "a marked key held the book's first row")


@pytest.mark.asyncio
@pytest.mark.parametrize("exchange", ["deribit", "okx"])
async def test_a_never_attempted_key_with_nothing_in_flight_does_not_hold(
    monkeypatch: pytest.MonkeyPatch, exchange: str
) -> None:
    """Attempts 0 and no job in flight: no job has ever touched this key, so
    there is nothing for the refresh to wait on and it does not hold the book.
    This is the one asymmetry with the fan-out's owed predicate, which treats
    attempts 0 as owed (see ``_fanout_would_still_retry``). It is NOT a stand-in
    for the strategy-link filter any more: that filter is applied for real (the
    tests below)."""
    fake = _book_with_owed_sibling(exchange=exchange, history_reconstruct_attempts=0)

    await _assert_writes(
        monkeypatch, fake, f"a never-attempted {exchange} key held the book's first row"
    )


@pytest.mark.asyncio
async def test_a_never_attempted_key_with_a_pending_reconstruct_holds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The user-RPC path: attempts are still 0 but a reconstruct is pending, so
    it is in flight and holds."""
    fake = _book_with_owed_sibling(history_reconstruct_attempts=0)
    _seed_reconstruct(fake, API_KEY_ID_2, "pending")

    await _assert_held(monkeypatch, fake, "an in-flight reconstruct (attempts 0) did not hold")


@pytest.mark.asyncio
async def test_a_marked_key_with_a_recrawl_in_flight_does_not_hold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """In-flight holds only while the marker is NULL: a marked key whose
    reconstruct is running again owes nothing."""
    fake = _book_with_owed_sibling(history_reconstructed_at=MARKED)
    _seed_reconstruct(fake, API_KEY_ID_2, "running")

    await _assert_writes(monkeypatch, fake, "a marked key with a re-crawl in flight held the book")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "changes",
    [
        {"sync_status": "sign_in_failed"},
        {"sync_status": "error"},
        {"sync_status": "revoked"},
        {"disconnected_at": "2026-09-10T00:00:00+00:00"},
        {"is_active": False},
    ],
    ids=["sign_in_failed", "error", "revoked", "disconnected", "inactive"],
)
async def test_a_key_the_fanout_no_longer_retries_never_holds_the_book(
    monkeypatch: pytest.MonkeyPatch, changes: dict[str, Any]
) -> None:
    """B2, matched set. The control below (the same key, qualifying) holds. Each
    case here changes exactly one attribute that makes the fan-out stop retrying
    the key after an attempt, and the refresh must then write: a key nobody will
    retry must not freeze the book."""
    fake = _book_with_owed_sibling(**changes)
    _seed_reconstruct(fake, API_KEY_ID_2, "failed_final")

    await _assert_writes(monkeypatch, fake, f"a key that stopped qualifying held the book: {changes}")


@pytest.mark.asyncio
async def test_the_qualifying_control_of_the_matched_set_holds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The control for the matched set above: same key, same failed_final job,
    still qualifying (active, sync_status ok, connected). It holds."""
    fake = _book_with_owed_sibling()
    _seed_reconstruct(fake, API_KEY_ID_2, "failed_final")

    await _assert_held(monkeypatch, fake, "the qualifying control did not hold")


# Review WR-01. M2's per-key owed query excludes a key linked to one of its
# owner's non-archived strategies (strategies.api_key_id, or strategy_keys joined
# to a non-archived strategy of the same owner). The fan-out therefore never
# retries such a key and its attempts never reach the cap. The Python hold must
# apply the same filter, or a key that failed once and was then linked holds its
# book's refresh for ever while the SQL refresh arm keeps enqueueing it.


@pytest.mark.asyncio
async def test_a_key_linked_to_a_strategy_after_an_attempt_does_not_hold_the_book(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The scenario from the review. Key B (attempts 1, failed_final, otherwise
    qualifying) is then linked to an active strategy through
    ``strategies.api_key_id``. The fan-out will never retry it, so it must not
    hold the book's first row. RED on the hold that counts it as owed."""
    fake = _book_with_owed_sibling()
    _seed_reconstruct(fake, API_KEY_ID_2, "failed_final")
    _seed_strategy(fake, "strategy-1", api_key_id=API_KEY_ID_2)

    await _assert_writes(
        monkeypatch, fake,
        "a key linked to a strategy after one attempt held its book's refresh",
    )


@pytest.mark.asyncio
async def test_a_key_linked_through_strategy_keys_does_not_hold_the_book(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Same, through the composite link: ``strategy_keys`` joined to a
    non-archived strategy of the same owner. RED on the unfiltered hold."""
    fake = _book_with_owed_sibling()
    _seed_reconstruct(fake, API_KEY_ID_2, "failed_final")
    _seed_strategy(fake, "composite-1", api_key_id=None)
    _seed_strategy_key(fake, "composite-1", API_KEY_ID_2)

    await _assert_writes(
        monkeypatch, fake,
        "a key linked through strategy_keys held its book's refresh",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "link",
    ["archived_direct", "archived_composite", "other_owner_direct", "other_owner_composite"],
)
async def test_a_link_the_fanout_ignores_still_holds_the_book(
    monkeypatch: pytest.MonkeyPatch, link: str
) -> None:
    """Controls for the pair above, each differing in exactly one attribute: the
    strategy is ARCHIVED, or owned by someone else. M2 ignores both (``status <>
    'archived'`` and ``strategies.user_id = key.user_id``), so the key still
    qualifies, the fan-out will retry it, and it must still hold. Without these
    a hold that dropped every key with any strategy row would pass."""
    fake = _book_with_owed_sibling()
    _seed_reconstruct(fake, API_KEY_ID_2, "failed_final")
    archived = link.startswith("archived")
    owner = ALLOCATOR_ID if archived else "00000000-0000-0000-0000-0000000000ee"
    status = "archived" if archived else "published"
    if link.endswith("_direct"):
        _seed_strategy(fake, "s-ctl", api_key_id=API_KEY_ID_2, status=status, user_id=owner)
    else:
        _seed_strategy(fake, "s-ctl", api_key_id=None, status=status, user_id=owner)
        _seed_strategy_key(fake, "s-ctl", API_KEY_ID_2)

    await _assert_held(monkeypatch, fake, f"a key with an ignored link ({link}) did not hold")


@pytest.mark.asyncio
async def test_a_linked_key_with_a_reconstruct_in_flight_still_holds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The link filter belongs to the fan-out-retry half only. A reconstruct job
    genuinely in flight (the user-RPC path) is waited on whatever the key is
    linked to: the job will write rows, and the refresh must not pre-empt it."""
    fake = _book_with_owed_sibling(history_reconstruct_attempts=0)
    _seed_reconstruct(fake, API_KEY_ID_2, "running")
    _seed_strategy(fake, "strategy-1", api_key_id=API_KEY_ID_2)

    await _assert_held(monkeypatch, fake, "an in-flight reconstruct of a linked key did not hold")


@pytest.mark.asyncio
@pytest.mark.parametrize("failing_table", ["strategies", "strategy_keys"])
async def test_a_failed_strategy_link_read_fails_the_job_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch, failing_table: str
) -> None:
    """The link read is part of the probe, so it RAISES like the others: a
    swallowed read would treat every key as unlinked or linked at random and fall
    through to the write the hold exists to prevent."""
    fake = _book_with_owed_sibling()
    _seed_reconstruct(fake, API_KEY_ID_2, "failed_final")
    _seed_strategy(fake, "composite-1", api_key_id=None)
    _seed_strategy_key(fake, "composite-1", API_KEY_ID_1)
    fake.fail_tables.add(failing_table)

    result, audit = await _run(monkeypatch, fake)

    assert result.outcome == DispatchOutcome.FAILED, result
    assert _today_rows(fake) == []
    assert "allocator.equity.refresh_failed" in _actions(audit)
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
