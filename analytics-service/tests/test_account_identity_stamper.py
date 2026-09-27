"""Phase 167.1.2 plan 04 — the account identity stamper in the daily poll.

Why these tests exist (D-01, D-11, RESEARCH Pattern 4 and Pitfall 4). Keys
connected before plan 02 carry a NULL ``venue_account_id``, so the unique index
``api_keys_user_exchange_venue_account_uniq`` cannot see that two of them read
one exchange account, and every consumer that sums keys counts that account
twice. The daily poll stamps the id. When a live sibling already holds it, the
key is MARKED, never disconnected or deleted, because the founder's rule is
"nothing is silently deleted" and the owner decides from the key card.

The write set is the load-bearing contract: the stamp may write ONLY
``venue_account_id``, ``account_shared_with_api_key_id`` and
``account_share_kind``. A stamp that wrote ``sync_status`` or ``sync_error``
would blame the user's key for our own bookkeeping.

Fakes only. No venue call, no database, no uvicorn.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from postgrest.exceptions import APIError

from services import account_identity as ai

KEY_ID = "00000000-0000-4000-8000-00000000000a"
HOLDER_ID = "00000000-0000-4000-8000-00000000000b"
OWNER_ID = "00000000-0000-4000-8000-0000000000aa"
# Synthetic account id. The value is never logged, so tests assert its absence.
ACCOUNT_ID = "70000001"

# Columns the stamper may write (T-167.1.2-16). Anything else is a defect.
ALLOWED_WRITE_COLUMNS = frozenset(
    {"venue_account_id", "account_shared_with_api_key_id", "account_share_kind"}
)
STATUS_COLUMNS = frozenset(
    {"sync_status", "sync_error", "disconnected_at", "is_active", "last_sync_at"}
)


# ---------------------------------------------------------------------------
# A recording Supabase double
# ---------------------------------------------------------------------------


@dataclass
class _Call:
    table: str
    op: str  # "select" | "update"
    payload: dict[str, Any] | None
    filters: list[tuple[str, str, Any]] = field(default_factory=list)


class _Query:
    def __init__(self, sb: FakeSupabase, table: str) -> None:
        self._sb = sb
        self._call = _Call(table=table, op="select", payload=None)

    def select(self, _cols: str) -> _Query:
        self._call.op = "select"
        return self

    def update(self, payload: dict[str, Any]) -> _Query:
        self._call.op = "update"
        self._call.payload = dict(payload)
        return self

    def _f(self, kind: str, col: str, val: Any) -> _Query:
        self._call.filters.append((kind, col, val))
        return self

    def eq(self, col: str, val: Any) -> _Query:
        return self._f("eq", col, val)

    def neq(self, col: str, val: Any) -> _Query:
        return self._f("neq", col, val)

    def is_(self, col: str, val: Any) -> _Query:
        return self._f("is", col, val)

    def in_(self, col: str, val: Any) -> _Query:
        return self._f("in", col, list(val))

    def limit(self, _n: int) -> _Query:
        return self

    def order(self, *_a: Any, **_k: Any) -> _Query:
        return self

    def execute(self) -> Any:
        self._sb.calls.append(self._call)
        return self._sb.respond(self._call)


class FakeSupabase:
    """Records every call; ``responder`` decides what each one returns or raises."""

    def __init__(self, responder: Callable[[_Call], Any] | None = None) -> None:
        self.calls: list[_Call] = []
        self._responder = responder

    def table(self, name: str) -> _Query:
        return _Query(self, name)

    def respond(self, call: _Call) -> Any:
        if self._responder is not None:
            out = self._responder(call)
            if isinstance(out, BaseException):
                raise out
            if out is not None:
                return out
        if call.op == "update":
            return MagicMock(data=[{"id": KEY_ID}])
        return MagicMock(data=[])

    def updates(self, table: str = "api_keys") -> list[dict[str, Any]]:
        return [c.payload or {} for c in self.calls if c.table == table and c.op == "update"]


def _unique_violation() -> APIError:
    return APIError({
        "code": "23505",
        "message": (
            "duplicate key value violates unique constraint "
            '"api_keys_user_exchange_venue_account_uniq"'
        ),
        "details": f"Key (user_id, exchange, venue_account_id)=(x, okx, {ACCOUNT_ID}) already exists.",
        "hint": None,
    })


def _okx_exchange(uid: str | None = ACCOUNT_ID) -> MagicMock:
    ex = MagicMock()
    ex.private_get_account_config = AsyncMock(
        return_value={"code": "0", "data": [{"uid": uid, "mainUid": "1"}]}
    )
    return ex


def _key_row(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": KEY_ID,
        "user_id": OWNER_ID,
        "exchange": "okx",
        "is_active": True,
        "sync_status": "complete",
        "disconnected_at": None,
        "venue_account_id": None,
        "account_shared_with_api_key_id": None,
        "account_share_kind": None,
    }
    row.update(overrides)
    return row


def _collision_responder(holder_id: str | None = HOLDER_ID) -> Callable[[_Call], Any]:
    """The stamp UPDATE hits the index; the holder look-up finds ``holder_id``."""

    def _r(call: _Call) -> Any:
        if call.table == "api_keys" and call.op == "update" and (
            call.payload or {}
        ).get("venue_account_id") is not None:
            return _unique_violation()
        if call.table == "api_keys" and call.op == "select":
            return MagicMock(data=[{"id": holder_id}] if holder_id else [])
        return None

    return _r


def _assert_write_set_is_identity_only(sb: FakeSupabase) -> None:
    for payload in sb.updates():
        assert set(payload) <= ALLOWED_WRITE_COLUMNS, payload
        assert not (set(payload) & STATUS_COLUMNS), payload


async def _stamp(sb: FakeSupabase, row: dict[str, Any], ex: Any) -> str:
    return await ai.stamp_account_identity(sb, row, ex, timeout_s=5.0)


# ---------------------------------------------------------------------------
# Task 1 — stamp, skip, mark
# ---------------------------------------------------------------------------


async def test_null_identity_key_is_stamped_from_its_venue() -> None:
    sb = FakeSupabase()
    ex = _okx_exchange()

    outcome = await _stamp(sb, _key_row(), ex)

    assert outcome == "stamped"
    ex.private_get_account_config.assert_awaited_once()
    assert sb.updates() == [{
        "venue_account_id": ACCOUNT_ID,
        "account_shared_with_api_key_id": None,
        "account_share_kind": None,
    }]
    # Only a key that is still unstamped is written, so a concurrent stamp
    # (or a stamp by the connect route) is never overwritten.
    (upd,) = [c for c in sb.calls if c.op == "update"]
    assert ("is", "venue_account_id", "null") in upd.filters
    assert ("eq", "id", KEY_ID) in upd.filters
    _assert_write_set_is_identity_only(sb)


async def test_already_stamped_key_makes_no_venue_call_and_no_write() -> None:
    sb = FakeSupabase()
    ex = _okx_exchange()

    outcome = await _stamp(sb, _key_row(venue_account_id="70000002"), ex)

    assert outcome == "skipped_already_stamped"
    ex.private_get_account_config.assert_not_awaited()
    assert sb.calls == []


@pytest.mark.parametrize("venue", ["mt5", "sfox"])
async def test_non_ccxt_venues_are_skipped(venue: str) -> None:
    # MT5's identity is its login (stamped at connect); sFOX has no known
    # account id (D-10). Neither is ever read or written here.
    sb = FakeSupabase()
    ex = MagicMock()

    outcome = await _stamp(sb, _key_row(exchange=venue), ex)

    assert outcome == "skipped_not_ccxt"
    assert ex.mock_calls == []
    assert sb.calls == []


async def test_a_venue_answer_without_an_id_writes_nothing() -> None:
    sb = FakeSupabase()

    outcome = await _stamp(sb, _key_row(), _okx_exchange(uid="  "))

    assert outcome == "no_id"
    assert sb.calls == []


async def test_collision_with_a_live_sibling_marks_the_key_and_never_acts_on_it() -> None:
    sb = FakeSupabase(_collision_responder())

    outcome = await _stamp(sb, _key_row(), _okx_exchange())

    assert outcome == "marked_duplicate"
    updates = sb.updates()
    # The refused stamp, then the marker naming the holder. No third write.
    assert updates[-1] == {
        "account_shared_with_api_key_id": HOLDER_ID,
        "account_share_kind": "duplicate",
    }
    assert len(updates) == 2
    # D-01: never disconnected, never deleted, never deactivated, never a
    # status change. The marker is the whole of the action.
    _assert_write_set_is_identity_only(sb)
    # The holder look-up is scoped to the same owner, venue and account, and to
    # live keys other than this one (T-167.1.2-18).
    (look,) = [c for c in sb.calls if c.op == "select"]
    assert ("eq", "user_id", OWNER_ID) in look.filters
    assert ("eq", "exchange", "okx") in look.filters
    assert ("eq", "venue_account_id", ACCOUNT_ID) in look.filters
    assert ("is", "disconnected_at", "null") in look.filters
    assert ("neq", "id", KEY_ID) in look.filters


async def test_the_account_id_value_never_reaches_the_log(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("DEBUG")
    sb = FakeSupabase(_collision_responder())

    await _stamp(sb, _key_row(), _okx_exchange())

    assert KEY_ID in caplog.text
    assert ACCOUNT_ID not in caplog.text


# ---------------------------------------------------------------------------
# Task 1 — the poll carries the stamp end to end
# ---------------------------------------------------------------------------


def _drive_poll(
    monkeypatch: pytest.MonkeyPatch, key_row: dict[str, Any], sb: FakeSupabase, exchange: Any
) -> Any:
    from services import allocator_positions as ap_mod
    from services import audit as audit_module
    from services import job_worker as jw

    fake_ctx = jw._ExchangeContext(
        supabase=sb,  # type: ignore[arg-type]
        strategy_row=None,
        key_row=key_row,
        exchange=exchange,
    )

    async def _fake_preflight(job: dict[str, Any], name: str) -> Any:
        return fake_ctx

    async def _fake_fetch(venue: str, ex: Any, api_key_id: str | None = None) -> Any:
        return ([], None)

    async def _fake_persist(supa: Any, rows: Any, allocator_id: str, api_key_id: str, asof: str) -> int:
        return len(rows)

    async def _fake_close(ex: Any) -> None:
        ex.closed = True

    monkeypatch.setattr(jw, "_allocator_key_preflight", _fake_preflight)
    monkeypatch.setattr(jw, "aclose_exchange", _fake_close)
    monkeypatch.setattr(ap_mod, "fetch_allocator_holdings", _fake_fetch)
    monkeypatch.setattr(ap_mod, "persist_allocator_holdings", _fake_persist)
    monkeypatch.setattr(audit_module, "log_audit_event", MagicMock())
    sb.rpc = MagicMock()  # type: ignore[attr-defined]

    job = {"id": "job-167-1-2-04", "kind": "poll_allocator_positions", "api_key_id": key_row["id"]}
    return jw.run_poll_allocator_positions_job(job)


async def test_poll_stamps_a_null_identity_key_while_its_session_is_open(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from services import job_worker as jw

    sb = FakeSupabase()
    ex = _okx_exchange()
    ex.closed = False
    seen_open: list[bool] = []

    async def _config() -> dict[str, Any]:
        seen_open.append(not ex.closed)
        return {"code": "0", "data": [{"uid": ACCOUNT_ID}]}

    ex.private_get_account_config = _config

    result = await _drive_poll(monkeypatch, _key_row(), sb, ex)

    assert result.outcome == jw.DispatchOutcome.DONE
    # The one venue call ran on the open session, and the session was closed.
    assert seen_open == [True]
    assert ex.closed is True
    assert {"venue_account_id": ACCOUNT_ID, "account_shared_with_api_key_id": None,
            "account_share_kind": None} in sb.updates()


async def test_poll_marks_a_sibling_on_a_held_account(monkeypatch: pytest.MonkeyPatch) -> None:
    from services import job_worker as jw

    sb = FakeSupabase(_collision_responder())

    result = await _drive_poll(monkeypatch, _key_row(), sb, _okx_exchange())

    assert result.outcome == jw.DispatchOutcome.DONE
    assert {"account_shared_with_api_key_id": HOLDER_ID,
            "account_share_kind": "duplicate"} in sb.updates()
    # The poll's own success write is the only status write, and it is the
    # poll's, not the stamp's.
    status_writes = [u for u in sb.updates() if set(u) & STATUS_COLUMNS]
    assert [set(u) for u in status_writes] == [{"sync_status", "sync_error", "last_sync_at"}]
    assert status_writes[0]["sync_status"] == "complete"
