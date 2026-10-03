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
from datetime import UTC, datetime, timedelta
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

    def maybe_single(self) -> _Query:
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


def _created_days_ago(days: float) -> str:
    """``api_keys.created_at`` as PostgREST returns it: ISO 8601 with offset."""
    return (datetime.now(UTC) - timedelta(days=days)).isoformat()


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
        # A key connected just now: below the SF2-M2 escalation threshold, so
        # every WARNING case in this file also pins the un-escalated side.
        "created_at": _created_days_ago(0),
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


@pytest.mark.parametrize("venue", ["sfox"])
async def test_non_ccxt_venues_are_skipped(venue: str) -> None:
    # sFOX has no known account id (D-10), so it is never read or written here.
    # MT5 used to be listed too; since debug session unstamped-venue-account-id
    # (founder Option B) the poll stamps an MT5 key from its login, pinned in
    # the MT5 section at the end of this file.
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


async def test_collision_with_a_live_sibling_marks_the_key_and_never_acts_on_it(
    audit_mock: MagicMock,
) -> None:
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
    (look,) = [c for c in sb.calls if c.table == "api_keys" and c.op == "select"]
    assert ("eq", "user_id", OWNER_ID) in look.filters
    assert ("eq", "exchange", "okx") in look.filters
    assert ("eq", "venue_account_id", ACCOUNT_ID) in look.filters
    assert ("is", "disconnected_at", "null") in look.filters
    assert ("neq", "id", KEY_ID) in look.filters


async def test_the_account_id_value_never_reaches_the_log(
    caplog: pytest.LogCaptureFixture, audit_mock: MagicMock
) -> None:
    caplog.set_level("DEBUG")
    sb = FakeSupabase(_collision_responder())

    await _stamp(sb, _key_row(), _okx_exchange())

    assert KEY_ID in caplog.text
    assert ACCOUNT_ID not in caplog.text


# ---------------------------------------------------------------------------
# Task 1 — the poll carries the stamp end to end
# ---------------------------------------------------------------------------


def _drive_poll(
    monkeypatch: pytest.MonkeyPatch,
    key_row: dict[str, Any],
    sb: FakeSupabase,
    exchange: Any,
    *,
    fetch: Callable[..., Any] | None = None,
    persist: Callable[..., Any] | None = None,
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
    monkeypatch.setattr(ap_mod, "fetch_allocator_holdings", fetch or _fake_fetch)
    monkeypatch.setattr(ap_mod, "persist_allocator_holdings", persist or _fake_persist)
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


# ---------------------------------------------------------------------------
# Task 2 — D-04 composite exemption
# ---------------------------------------------------------------------------
#
# A composite strategy stitches member keys over disjoint declared windows. Two
# members on one exchange account with disjoint windows is a key rotation inside
# a composite (D-04, measured in code), a legitimate pair and NOT a duplicate:
# the stamp must say so by name, and must not audit it as a duplicate.

STRATEGY_A = "00000000-0000-4000-8000-0000000000c1"
STRATEGY_B = "00000000-0000-4000-8000-0000000000c2"


def _member(api_key_id: str, strategy_id: str, start: str, end: str | None, seq: int) -> dict[str, Any]:
    return {
        "strategy_id": strategy_id,
        "api_key_id": api_key_id,
        "window_start": start,
        "window_end": end,
        "seq": seq,
    }


def _composite_responder(members: list[dict[str, Any]]) -> Callable[[_Call], Any]:
    base = _collision_responder()

    def _r(call: _Call) -> Any:
        if call.table == "strategy_keys" and call.op == "select":
            return MagicMock(data=members)
        return base(call)

    return _r


@pytest.fixture
def audit_mock(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    from services import audit as audit_module

    m = MagicMock()
    monkeypatch.setattr(audit_module, "log_audit_event", m)
    return m


async def test_composite_rotation_on_one_account_is_marked_composite_member(
    audit_mock: MagicMock,
) -> None:
    # The holder ran [2026-01-01, 2026-06-01), this key runs from 2026-06-01:
    # adjacent half-open windows do not overlap (stitch_composite.windows_overlap).
    sb = FakeSupabase(_composite_responder([
        _member(HOLDER_ID, STRATEGY_A, "2026-01-01", "2026-06-01", 0),
        _member(KEY_ID, STRATEGY_A, "2026-06-01", None, 1),
    ]))

    outcome = await _stamp(sb, _key_row(), _okx_exchange())

    assert outcome == "marked_composite_member"
    assert sb.updates()[-1] == {
        "account_shared_with_api_key_id": HOLDER_ID,
        "account_share_kind": "composite_member",
    }
    # Both keys' memberships are read in one query, filtered to the pair.
    (sk,) = [c for c in sb.calls if c.table == "strategy_keys"]
    assert ("in", "api_key_id", [KEY_ID, HOLDER_ID]) in sk.filters
    # A legitimate pair is not a duplicate: no duplicate audit event.
    audit_mock.assert_not_called()
    _assert_write_set_is_identity_only(sb)


@pytest.mark.parametrize(
    "members",
    [
        pytest.param(
            [
                _member(HOLDER_ID, STRATEGY_A, "2026-01-01", "2026-07-01", 0),
                _member(KEY_ID, STRATEGY_A, "2026-06-01", None, 1),
            ],
            id="overlapping-windows",
        ),
        pytest.param(
            [
                _member(HOLDER_ID, STRATEGY_A, "2026-01-01", "2026-06-01", 0),
                _member(KEY_ID, STRATEGY_B, "2026-06-01", None, 0),
            ],
            id="different-strategies",
        ),
        pytest.param(
            [_member(KEY_ID, STRATEGY_A, "2026-06-01", None, 1)],
            id="holder-not-a-member",
        ),
        pytest.param([], id="neither-a-member"),
    ],
)
async def test_anything_but_a_disjoint_pair_in_one_composite_is_a_duplicate(
    members: list[dict[str, Any]], audit_mock: MagicMock
) -> None:
    sb = FakeSupabase(_composite_responder(members))

    outcome = await _stamp(sb, _key_row(), _okx_exchange())

    assert outcome == "marked_duplicate"
    assert sb.updates()[-1]["account_share_kind"] == "duplicate"


# ---------------------------------------------------------------------------
# Task 2 — the audit event, once per transition
# ---------------------------------------------------------------------------


async def test_a_new_duplicate_emits_exactly_one_audit_event(audit_mock: MagicMock) -> None:
    sb = FakeSupabase(_composite_responder([]))

    await _stamp(sb, _key_row(), _okx_exchange())

    audit_mock.assert_called_once()
    _args, kwargs = audit_mock.call_args
    assert kwargs["action"] == "api_key.account_duplicate_detected"
    assert kwargs["entity_type"] == "api_key"
    assert kwargs["entity_id"] == KEY_ID
    assert kwargs["user_id"] == OWNER_ID
    # Venue and holder only: never the uid, never the account id (T-167.1.2-17).
    assert kwargs["metadata"] == {"venue": "okx", "holder_api_key_id": HOLDER_ID}


async def test_an_unchanged_duplicate_is_not_re_audited_or_re_written(audit_mock: MagicMock) -> None:
    # The daily poll meets the same duplicate every day. One event marks the
    # transition; a daily repeat would bury it.
    sb = FakeSupabase(_composite_responder([]))
    row = _key_row(account_shared_with_api_key_id=HOLDER_ID, account_share_kind="duplicate")

    outcome = await _stamp(sb, row, _okx_exchange())

    assert outcome == "marked_duplicate"
    audit_mock.assert_not_called()
    # Only the refused stamp attempt; no marker re-write.
    assert len(sb.updates()) == 1


async def test_a_duplicate_with_a_new_holder_is_a_new_transition(audit_mock: MagicMock) -> None:
    sb = FakeSupabase(_composite_responder([]))
    other = "00000000-0000-4000-8000-00000000000c"
    row = _key_row(account_shared_with_api_key_id=other, account_share_kind="duplicate")

    await _stamp(sb, row, _okx_exchange())

    audit_mock.assert_called_once()
    assert sb.updates()[-1]["account_shared_with_api_key_id"] == HOLDER_ID


async def test_a_failed_audit_emit_does_not_fail_the_stamp(monkeypatch: pytest.MonkeyPatch) -> None:
    from services import audit as audit_module

    def _boom(**_k: Any) -> None:
        raise RuntimeError("audit down")

    monkeypatch.setattr(audit_module, "log_audit_event", _boom)
    sb = FakeSupabase(_composite_responder([]))

    outcome = await _stamp(sb, _key_row(), _okx_exchange())

    # The marker landed; the lost audit row is logged, not raised.
    assert outcome == "marked_duplicate"


async def test_a_dropped_audit_is_an_error_with_a_scrubbed_message(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    # Review round 1 (SF-M5). log_audit_event re-raises only what it judges
    # serious: a permission failure or an error it does not recognise. Logging
    # that drop at WARNING kept it out of Sentry, which events at ERROR. The
    # line names the class, the SQLSTATE and the error's MESSAGE; the DETAIL,
    # which can echo row values, is never read (it carries the synthetic
    # account id here so a leak would show).
    from services import audit as audit_module

    def _denied(**_k: Any) -> None:
        raise APIError({
            "code": "42501",
            "message": "permission denied for function log_audit_event_service",
            "details": f"account {ACCOUNT_ID}",
            "hint": None,
        })

    monkeypatch.setattr(audit_module, "log_audit_event", _denied)
    caplog.set_level("DEBUG")

    outcome = await _stamp(FakeSupabase(_composite_responder([])), _key_row(), _okx_exchange())

    assert outcome == "marked_duplicate"
    (drop,) = [r for r in caplog.records if "dropped" in r.getMessage()]
    assert drop.levelname == "ERROR"
    line = drop.getMessage()
    assert "class=APIError" in line and "code=42501" in line
    assert "permission denied for function log_audit_event_service" in line
    assert ACCOUNT_ID not in caplog.text


# ---------------------------------------------------------------------------
# Review round 1 (SF-M2 / IN-04) — the marker and its audit cannot be split
# ---------------------------------------------------------------------------
#
# The marker UPDATE runs in a worker thread. ``asyncio.wait_for`` cancels the
# coroutine awaiting it, but the thread runs on and the UPDATE commits. When
# the audit was a separate step after that await, a budget that ran out
# between the two left the table saying 'duplicate' and the audit log saying
# nothing. The next poll then met an unchanged marker and skipped the audit,
# so the transition into 'duplicate' was never recorded. These pin that the
# write and its audit are one unit, and that a write which landed nowhere is
# never announced.


def _slow_marker_responder(delay_s: float) -> Callable[[_Call], Any]:
    """The marker UPDATE sleeps past the budget, then lands (row returned)."""
    import time

    base = _composite_responder([])

    def _r(call: _Call) -> Any:
        if call.op == "update" and (call.payload or {}).get("account_share_kind") is not None:
            time.sleep(delay_s)
            return MagicMock(data=[{"id": KEY_ID}])
        return base(call)

    return _r


async def test_a_marker_write_that_outlives_the_budget_is_still_audited_exactly_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import asyncio
    import threading

    from services import audit as audit_module

    audited = threading.Event()
    audit_mock = MagicMock(side_effect=lambda **_k: audited.set())
    monkeypatch.setattr(audit_module, "log_audit_event", audit_mock)
    # The margins leave the three reads before the marker ample time under
    # load, so the budget always runs out inside the marker write, never before.
    sb = FakeSupabase(_slow_marker_responder(1.5))

    # First poll: the budget runs out while the marker UPDATE is in flight.
    first = await ai.stamp_account_identity(sb, _key_row(), _okx_exchange(), timeout_s=0.5)
    assert first == "error"
    # Bounded wait for the thread to finish, never an open-ended one.
    await asyncio.to_thread(audited.wait, 3.0)
    # The UPDATE still committed in its thread (the fake records it).
    assert {"account_shared_with_api_key_id": HOLDER_ID,
            "account_share_kind": "duplicate"} in sb.updates()

    # Second poll: the row now carries the marker the first poll wrote.
    marked = _key_row(account_shared_with_api_key_id=HOLDER_ID, account_share_kind="duplicate")
    second = await _stamp(FakeSupabase(_composite_responder([])), marked, _okx_exchange())
    assert second == "marked_duplicate"

    # One transition, one audit event, across both polls.
    assert audit_mock.call_count == 1
    assert audit_mock.call_args.kwargs["metadata"] == {
        "venue": "okx", "holder_api_key_id": HOLDER_ID,
    }


async def test_a_marker_update_that_matched_no_row_is_not_audited(
    audit_mock: MagicMock,
) -> None:
    # The key row was deleted between the refused stamp and the marker write.
    # Nothing was marked, so nothing is announced, and the step does not claim
    # a marker it did not write.
    base = _composite_responder([])

    def _r(call: _Call) -> Any:
        if call.op == "update" and (call.payload or {}).get("account_share_kind") is not None:
            return MagicMock(data=[])
        return base(call)

    outcome = await _stamp(FakeSupabase(_r), _key_row(), _okx_exchange())

    assert outcome == "error"
    audit_mock.assert_not_called()


# ---------------------------------------------------------------------------
# Task 2 — Pitfall 4: the stamp can never harm a poll
# ---------------------------------------------------------------------------


def _ccxt_network_error() -> BaseException:
    import ccxt

    return ccxt.NetworkError("okx GET account/config timed out")


def _ccxt_rate_limit() -> BaseException:
    import ccxt

    return ccxt.RateLimitExceeded("okx 429")


def _trigger_refusal(code: str, name: str) -> BaseException:
    return APIError({"code": code, "message": name, "details": None, "hint": None})


_READ_FAILURES = [
    pytest.param(_ccxt_network_error, id="read-NetworkError"),
    pytest.param(_ccxt_rate_limit, id="read-RateLimitExceeded"),
    pytest.param(lambda: KeyError("data"), id="read-KeyError"),
]

# The same-owner trigger refuses a marker write with its own SQLSTATE per case
# (migration 20260925120000). Every one of them is the outcome token 'error'.
# Only the log LEVEL reads the message, and only for the two holder-race tokens
# (review round 2 WR-01, pinned in test_a_database_failure_the_next_poll_can_
# clear_is_a_warning); the outcome never depends on it.
_MARKER_REFUSALS = [
    pytest.param("23503", "ACCOUNT_SHARE_HOLDER_NOT_FOUND", id="marker-23503"),
    pytest.param("42501", "ACCOUNT_SHARE_HOLDER_NOT_SAME_OWNER", id="marker-42501"),
    pytest.param("55000", "ACCOUNT_SHARE_HOLDER_NOT_LIVE", id="marker-55000"),
    pytest.param("23000", "ACCOUNT_SHARE_HOLDER_IS_MARKED", id="marker-23000-marked"),
    pytest.param("23000", "ACCOUNT_SHARE_KEY_IS_A_HOLDER", id="marker-23000-holder"),
]


async def _baseline_poll(monkeypatch: pytest.MonkeyPatch) -> tuple[Any, list[dict[str, Any]]]:
    """The poll with the stamp step replaced by a no-op: what it returns and writes."""
    sb = FakeSupabase()

    async def _no_stamp(*_a: Any, **_k: Any) -> str:
        return "skipped_not_ccxt"

    with monkeypatch.context() as m:
        m.setattr(ai, "stamp_account_identity", _no_stamp)
        result = await _drive_poll(m, _key_row(), sb, _okx_exchange())
    return result, sb.updates()


def _status_writes(updates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [u for u in updates if not set(u) <= ALLOWED_WRITE_COLUMNS]


def _without_timestamps(updates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: v for k, v in u.items() if k != "last_sync_at"} for u in updates]


@pytest.mark.parametrize("make_exc", _READ_FAILURES)
async def test_a_failing_venue_read_leaves_the_poll_exactly_as_without_the_stamp(
    monkeypatch: pytest.MonkeyPatch, make_exc: Callable[[], BaseException]
) -> None:
    base_result, base_updates = await _baseline_poll(monkeypatch)

    async def _raise(_ex: Any, _venue: str) -> str | None:
        raise make_exc()

    monkeypatch.setattr(ai, "read_venue_account_id", _raise)
    sb = FakeSupabase()
    result = await _drive_poll(monkeypatch, _key_row(), sb, _okx_exchange())

    assert result == base_result
    assert _without_timestamps(sb.updates()) == _without_timestamps(base_updates)


async def test_a_failing_stamp_write_leaves_the_poll_exactly_as_without_the_stamp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    base_result, base_updates = await _baseline_poll(monkeypatch)

    def _r(call: _Call) -> Any:
        if call.op == "update" and (call.payload or {}).get("venue_account_id"):
            return APIError({"code": "08006", "message": "connection failure",
                             "details": None, "hint": None})
        return None

    sb = FakeSupabase(_r)
    result = await _drive_poll(monkeypatch, _key_row(), sb, _okx_exchange())

    assert result == base_result
    # The only extra write is the refused identity attempt itself.
    assert _without_timestamps(_status_writes(sb.updates())) == _without_timestamps(base_updates)


@pytest.mark.parametrize(("code", "name"), _MARKER_REFUSALS)
async def test_a_trigger_refusal_of_the_marker_is_an_error_token(
    code: str, name: str, audit_mock: MagicMock
) -> None:
    base = _composite_responder([])

    def _r(call: _Call) -> Any:
        if call.op == "update" and "account_share_kind" in (call.payload or {}) and (
            call.payload or {}
        ).get("account_share_kind") is not None:
            return _trigger_refusal(code, name)
        return base(call)

    sb = FakeSupabase(_r)

    outcome = await _stamp(sb, _key_row(), _okx_exchange())

    assert outcome == "error"
    # No marker landed, so no duplicate is announced.
    audit_mock.assert_not_called()


async def test_a_hanging_venue_is_cut_off_by_the_budget() -> None:
    import asyncio

    ex = MagicMock()

    async def _hang() -> dict[str, Any]:
        await asyncio.sleep(30)
        return {}

    ex.private_get_account_config = _hang
    sb = FakeSupabase()

    outcome = await ai.stamp_account_identity(sb, _key_row(), ex, timeout_s=0.05)

    assert outcome == "error"
    assert sb.calls == []


async def test_no_budget_left_skips_the_step_without_a_venue_call() -> None:
    ex = _okx_exchange()

    outcome = await ai.stamp_account_identity(FakeSupabase(), _key_row(), ex, timeout_s=0.0)

    assert outcome == "skipped_no_budget"
    ex.private_get_account_config.assert_not_awaited()


async def test_a_poll_near_its_timeout_skips_the_stamp(monkeypatch: pytest.MonkeyPatch) -> None:
    # The handler's own wait_for would kill a poll whose stamp ran past the
    # ceiling, after the holdings and the success status had landed. The
    # budget is what is left of the ceiling, so a late poll skips the step.
    from services import job_worker as jw

    monkeypatch.setitem(jw.TIMEOUT_PER_KIND, "poll_allocator_positions", 5.0)
    ex = _okx_exchange()
    sb = FakeSupabase()

    result = await _drive_poll(monkeypatch, _key_row(), sb, ex)

    assert result.outcome == jw.DispatchOutcome.DONE
    ex.private_get_account_config.assert_not_awaited()


# ---------------------------------------------------------------------------
# Task 2 — self-heal and the reader rule's revoked-holder case
# ---------------------------------------------------------------------------


async def test_a_marked_key_self_heals_once_its_holder_is_disconnected(audit_mock: MagicMock) -> None:
    # K was marked while H was live. H is now disconnected, so the index (which
    # excludes disconnected rows) no longer refuses K's stamp.
    sb = FakeSupabase()  # no collision any more
    row = _key_row(account_shared_with_api_key_id=HOLDER_ID, account_share_kind="duplicate")

    outcome = await _stamp(sb, row, _okx_exchange())

    assert outcome == "stamped"
    assert sb.updates() == [{
        "venue_account_id": ACCOUNT_ID,
        "account_shared_with_api_key_id": None,
        "account_share_kind": None,
    }]
    audit_mock.assert_not_called()


async def test_a_revoked_holder_does_not_self_heal_its_duplicate(audit_mock: MagicMock) -> None:
    # A revoked key is still LIVE for api_keys_user_exchange_venue_account_uniq
    # (disconnected_at IS NULL), so K's stamp keeps hitting the index and K
    # stays marked. What keeps that account counted is the READER rule in the
    # account_share_kind COMMENT (count through the holder only while it is
    # working), not the stamper. Pinned so nobody "fixes" it here by
    # un-marking K behind the owner's back.
    sb = FakeSupabase(_composite_responder([]))
    row = _key_row(account_shared_with_api_key_id=HOLDER_ID, account_share_kind="duplicate")

    outcome = await _stamp(sb, row, _okx_exchange())

    assert outcome == "marked_duplicate"
    assert len(sb.updates()) == 1  # the refused stamp; the marker is unchanged
    audit_mock.assert_not_called()


# ---------------------------------------------------------------------------
# Review round 1 (SF-M3 / SF-M4) — the log level says whether anyone must act
# ---------------------------------------------------------------------------
#
# Sentry's logging integration turns ERROR into an event and leaves WARNING as
# a breadcrumb. A stamp failure that the next poll cannot outgrow (a ccxt
# method rename, a trigger refusal other than the two holder-race tokens, a
# schema-cache miss) repeats every day, and
# at WARNING the duplicate it hides is never found. So the level is chosen by
# class: what a retry can clear stays WARNING, everything else is ERROR with
# the class, the SQLSTATE and the error's scrubbed MESSAGE. The DETAIL echoes
# row values, the account id included, so it is never logged; every fake below
# that carries a DETAIL puts the synthetic account id in it so a leak shows.


def _stamp_failure_record(caplog: pytest.LogCaptureFixture) -> Any:
    (rec,) = [r for r in caplog.records if "stamp failed" in r.getMessage()]
    return rec


def _api_error(code: str, message: str) -> APIError:
    return APIError({
        "code": code,
        "message": message,
        "details": f"Failing row contains ({KEY_ID}, okx, {ACCOUNT_ID}).",
        "hint": None,
    })


def _write_raises(exc: BaseException) -> Callable[[_Call], Any]:
    def _r(call: _Call) -> Any:
        if call.op == "update" and (call.payload or {}).get("venue_account_id"):
            return exc
        return None

    return _r


def _marker_raises(exc: BaseException) -> Callable[[_Call], Any]:
    base = _composite_responder([])

    def _r(call: _Call) -> Any:
        if call.op == "update" and (call.payload or {}).get("account_share_kind") is not None:
            return exc
        return base(call)

    return _r


def _marker_matches_no_row() -> Callable[[_Call], Any]:
    base = _composite_responder([])

    def _r(call: _Call) -> Any:
        if call.op == "update" and (call.payload or {}).get("account_share_kind") is not None:
            return MagicMock(data=[])
        return base(call)

    return _r


def _read_raises(exc: BaseException) -> MagicMock:
    ex = MagicMock()
    ex.private_get_account_config = AsyncMock(side_effect=exc)
    return ex


def _transient_cases() -> list[Any]:
    import ccxt
    import httpx

    return [
        pytest.param(FakeSupabase(), _read_raises(ccxt.NetworkError("okx timed out")),
                     "NetworkError", id="venue-NetworkError"),
        pytest.param(FakeSupabase(), _read_raises(ccxt.RateLimitExceeded("okx 429")),
                     "RateLimitExceeded", id="venue-RateLimitExceeded"),
        pytest.param(FakeSupabase(_write_raises(httpx.ConnectError("db unreachable"))),
                     _okx_exchange(), "ConnectError", id="db-ConnectError"),
        pytest.param(FakeSupabase(_collision_responder(holder_id=None)),
                     _okx_exchange(), "_HolderVanished", id="holder-vanished"),
        pytest.param(FakeSupabase(_marker_matches_no_row()),
                     _okx_exchange(), "_MarkerNotWritten", id="marker-no-row"),
    ]


@pytest.mark.parametrize(("sb", "ex", "cls"), _transient_cases())
async def test_a_failure_the_next_poll_can_clear_is_a_warning(
    sb: FakeSupabase, ex: Any, cls: str,
    caplog: pytest.LogCaptureFixture, audit_mock: MagicMock,
) -> None:
    caplog.set_level("DEBUG")

    outcome = await _stamp(sb, _key_row(), ex)

    assert outcome == "error"
    rec = _stamp_failure_record(caplog)
    assert rec.levelname == "WARNING"
    assert f"class={cls}" in rec.getMessage()
    assert ACCOUNT_ID not in caplog.text


async def test_a_stamp_that_runs_out_of_budget_is_a_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    import asyncio

    caplog.set_level("DEBUG")
    ex = MagicMock()

    async def _hang() -> dict[str, Any]:
        await asyncio.sleep(30)
        return {}

    ex.private_get_account_config = _hang

    outcome = await ai.stamp_account_identity(FakeSupabase(), _key_row(), ex, timeout_s=0.05)

    assert outcome == "error"
    rec = _stamp_failure_record(caplog)
    assert rec.levelname == "WARNING"
    assert "class=TimeoutError" in rec.getMessage()


def _retryable_database_cases() -> list[Any]:
    """Review round 2 WR-01 / SF2-L3: database failures the next poll clears.

    The holder can leave between ``_find_live_holder`` and the marker UPDATE,
    and the same-owner trigger then refuses with one of two tokens; the next
    poll stamps instead (the self-heal). A gateway 504, a statement timeout, a
    serialization failure and a deadlock are transient by nature. Each reaches
    the client as an ``APIError``, and each used to land at ERROR claiming
    "a retry will not clear this".
    """
    return [
        pytest.param(
            FakeSupabase(_marker_raises(_api_error("55000", "ACCOUNT_SHARE_HOLDER_NOT_LIVE"))),
            "55000", id="marker-holder-not-live",
        ),
        pytest.param(
            FakeSupabase(_marker_raises(_api_error("23503", "ACCOUNT_SHARE_HOLDER_NOT_FOUND"))),
            "23503", id="marker-holder-not-found",
        ),
        # The gateway's code arrives as an int (services.db._is_gateway_timeout
        # checks both types); it must still be logged, as its string.
        pytest.param(
            FakeSupabase(_write_raises(APIError({
                "code": 504, "message": "upstream request timeout",
                "details": f"Failing row contains ({ACCOUNT_ID}).", "hint": None,
            }))),
            "504", id="gateway-504-int",
        ),
        pytest.param(
            FakeSupabase(_write_raises(_api_error(
                "57014", "canceling statement due to statement timeout"))),
            "57014", id="statement-timeout",
        ),
        pytest.param(
            FakeSupabase(_write_raises(_api_error(
                "40001", "could not serialize access due to concurrent update"))),
            "40001", id="serialization-failure",
        ),
        pytest.param(
            FakeSupabase(_write_raises(_api_error("40P01", "deadlock detected"))),
            "40P01", id="deadlock",
        ),
    ]


@pytest.mark.parametrize(("sb", "code"), _retryable_database_cases())
async def test_a_database_failure_the_next_poll_can_clear_is_a_warning(
    sb: FakeSupabase, code: str,
    caplog: pytest.LogCaptureFixture, audit_mock: MagicMock,
) -> None:
    caplog.set_level("DEBUG")

    outcome = await _stamp(sb, _key_row(), _okx_exchange())

    assert outcome == "error"
    rec = _stamp_failure_record(caplog)
    assert rec.levelname == "WARNING"
    line = rec.getMessage()
    assert "class=APIError" in line
    assert f"code={code}" in line
    assert ACCOUNT_ID not in caplog.text
    assert "Failing row contains" not in caplog.text
    audit_mock.assert_not_called()


async def test_a_foreign_key_failure_without_the_trigger_token_stays_an_error(
    caplog: pytest.LogCaptureFixture, audit_mock: MagicMock,
) -> None:
    # The retryable set is the two trigger TOKENS, not the bare SQLSTATEs
    # 23503 and 55000: another foreign-key failure is not the holder race,
    # and a retry does not clear it.
    caplog.set_level("DEBUG")
    sb = FakeSupabase(_marker_raises(_api_error(
        "23503", 'insert or update on table "api_keys" violates foreign key constraint')))

    outcome = await _stamp(sb, _key_row(), _okx_exchange())

    assert outcome == "error"
    rec = _stamp_failure_record(caplog)
    assert rec.levelname == "ERROR"
    assert "code=23503" in rec.getMessage()


def _persistent_cases() -> list[Any]:
    return [
        pytest.param(FakeSupabase(), _read_raises(AttributeError("private_get_account_config")),
                     "AttributeError", None, None, id="venue-method-renamed"),
        pytest.param(FakeSupabase(), _read_raises(KeyError("data")),
                     "KeyError", None, None, id="venue-shape-KeyError"),
        pytest.param(
            FakeSupabase(_marker_raises(_api_error("42501", "ACCOUNT_SHARE_HOLDER_NOT_SAME_OWNER"))),
            _okx_exchange(), "APIError", "42501", "ACCOUNT_SHARE_HOLDER_NOT_SAME_OWNER",
            id="trigger-refusal",
        ),
        pytest.param(
            FakeSupabase(_write_raises(_api_error(
                "PGRST204", "Could not find the 'venue_account_id' column of 'api_keys' "
                "in the schema cache"))),
            _okx_exchange(), "APIError", "PGRST204", "schema cache",
            id="schema-cache-miss",
        ),
        pytest.param(
            FakeSupabase(_write_raises(_api_error(
                "23514", 'new row for relation "api_keys" violates check constraint '
                '"api_keys_venue_account_id_nonblank"'))),
            _okx_exchange(), "APIError", "23514", "api_keys_venue_account_id_nonblank",
            id="check-violation",
        ),
    ]


@pytest.mark.parametrize(("sb", "ex", "cls", "code", "fragment"), _persistent_cases())
async def test_a_failure_a_retry_cannot_clear_is_an_error_without_the_detail(
    sb: FakeSupabase, ex: Any, cls: str, code: str | None, fragment: str | None,
    caplog: pytest.LogCaptureFixture, audit_mock: MagicMock,
) -> None:
    caplog.set_level("DEBUG")

    outcome = await _stamp(sb, _key_row(), ex)

    assert outcome == "error"
    rec = _stamp_failure_record(caplog)
    assert rec.levelname == "ERROR"
    line = rec.getMessage()
    assert f"class={cls}" in line
    assert f"code={code}" in line
    # Review round 2 WR-01: the line classifies, it does not promise
    # permanence. An unrecognised failure is not proof a retry cannot clear it.
    assert "a retry will not clear" not in line
    if fragment is not None:
        # The MESSAGE names the constraint or the refusal token: it is logged.
        assert fragment in line
    # The DETAIL is never read, so the account id it echoes never reaches a log.
    assert ACCOUNT_ID not in caplog.text
    assert "Failing row contains" not in caplog.text


class _ForeignErrorWithMessage(Exception):
    """Not a PostgREST ``APIError``, yet it carries a ``.message`` attribute.

    Some venue SDKs and HTTP clients set ``.message`` to text that echoes a
    request or a response body, which can carry a key or an account id.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


_FOREIGN_MESSAGE_SENTINEL = "SENTINEL-FOREIGN-MESSAGE-apiKey=abc123"


async def test_only_a_postgrest_api_error_message_is_ever_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # Review round 2 SF2-L4: `_safe_message` promised "only the message of a
    # PostgREST APIError" and read `.message` off ANY exception. A foreign
    # class with a `.message` would have put its text on an ERROR line.
    caplog.set_level("DEBUG")
    ex = _read_raises(_ForeignErrorWithMessage(_FOREIGN_MESSAGE_SENTINEL))

    outcome = await _stamp(FakeSupabase(), _key_row(), ex)

    assert outcome == "error"
    rec = _stamp_failure_record(caplog)
    assert rec.levelname == "ERROR"
    assert "class=_ForeignErrorWithMessage" in rec.getMessage()
    assert "message=None" in rec.getMessage()
    assert "SENTINEL-FOREIGN-MESSAGE" not in caplog.text


async def test_a_venue_answer_without_an_id_is_a_warning_naming_the_venue(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # Every venue in VENUES_WITH_ACCOUNT_ID answers an id; a validated key
    # whose venue answers none is venue schema drift, the same case the
    # validator logs at WARNING. At INFO it never surfaced.
    caplog.set_level("DEBUG")

    outcome = await _stamp(FakeSupabase(), _key_row(), _okx_exchange(uid="  "))

    assert outcome == "no_id"
    (rec,) = [r for r in caplog.records if "outcome=no_id" in r.getMessage()]
    assert rec.levelname == "WARNING"
    assert "venue okx" in rec.getMessage()


async def test_a_skipped_stamp_for_want_of_budget_is_a_warning_with_the_budget(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # A poll that leaves the stamp no time never stamps its key, so a key
    # whose polls always run long is never checked for a duplicate. That has
    # to be visible, with the budget that was left.
    caplog.set_level("DEBUG")

    outcome = await ai.stamp_account_identity(
        FakeSupabase(), _key_row(), _okx_exchange(), timeout_s=-3.25
    )

    assert outcome == "skipped_no_budget"
    (rec,) = [r for r in caplog.records if "outcome=skipped_no_budget" in r.getMessage()]
    assert rec.levelname == "WARNING"
    assert "budget_s=-3.2" in rec.getMessage()


@pytest.mark.parametrize(
    ("row", "responder", "expected"),
    [
        pytest.param({}, None, "stamped", id="stamped"),
        pytest.param({"venue_account_id": "70000002"}, None,
                     "skipped_already_stamped", id="already-stamped"),
        pytest.param({"exchange": "sfox"}, None, "skipped_not_ccxt", id="not-ccxt"),
    ],
)
async def test_routine_outcomes_stay_at_info(
    row: dict[str, Any], responder: Callable[[_Call], Any] | None, expected: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("DEBUG")

    outcome = await _stamp(FakeSupabase(responder), _key_row(**row), _okx_exchange())

    assert outcome == expected
    (rec,) = [r for r in caplog.records if f"outcome={expected}" in r.getMessage()]
    assert rec.levelname == "INFO"


# ---------------------------------------------------------------------------
# Review round 2 SF2-M2 — a key that stays unstamped escalates to ERROR
# ---------------------------------------------------------------------------
#
# A retryable failure or a skipped_no_budget is WARNING because the next poll
# may clear it. When it recurs every day, the key is never stamped, so its
# duplicate check never runs, and a WARNING never reaches Sentry. After
# UNSTAMPED_ESCALATION_DAYS (3) since the key was created, the same line is an
# ERROR saying so. Both sides of the threshold are pinned for both outcomes.

_ESCALATION = "key unstamped for >3 days; duplicate check not running"


def _escalation_records(caplog: pytest.LogCaptureFixture) -> list[Any]:
    return [r for r in caplog.records if _ESCALATION in r.getMessage()]


def test_the_escalation_threshold_is_three_days() -> None:
    assert ai.UNSTAMPED_ESCALATION_DAYS == 3


@pytest.mark.parametrize(
    ("days", "level"),
    [pytest.param(2, "WARNING", id="2-days-below"), pytest.param(4, "ERROR", id="4-days-above")],
)
async def test_a_retryable_failure_on_an_aged_unstamped_key_escalates(
    days: int, level: str, caplog: pytest.LogCaptureFixture,
) -> None:
    import ccxt

    caplog.set_level("DEBUG")
    ex = _read_raises(ccxt.NetworkError("okx timed out"))

    outcome = await _stamp(FakeSupabase(), _key_row(created_at=_created_days_ago(days)), ex)

    assert outcome == "error"
    rec = _stamp_failure_record(caplog)
    assert rec.levelname == level
    assert "class=NetworkError" in rec.getMessage()
    assert (_ESCALATION in rec.getMessage()) is (level == "ERROR")
    assert ACCOUNT_ID not in caplog.text


@pytest.mark.parametrize(
    ("days", "level"),
    [pytest.param(2, "WARNING", id="2-days-below"), pytest.param(4, "ERROR", id="4-days-above")],
)
async def test_a_skipped_no_budget_on_an_aged_unstamped_key_escalates(
    days: int, level: str, caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("DEBUG")

    outcome = await ai.stamp_account_identity(
        FakeSupabase(), _key_row(created_at=_created_days_ago(days)), _okx_exchange(),
        timeout_s=0.0,
    )

    assert outcome == "skipped_no_budget"
    (rec,) = [r for r in caplog.records if "outcome=skipped_no_budget" in r.getMessage()]
    assert rec.levelname == level
    assert (_ESCALATION in rec.getMessage()) is (level == "ERROR")


async def test_a_zulu_timestamp_is_read_as_utc(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("DEBUG")
    aged = (datetime.now(UTC) - timedelta(days=4)).strftime("%Y-%m-%dT%H:%M:%SZ")

    await ai.stamp_account_identity(
        FakeSupabase(), _key_row(created_at=aged), _okx_exchange(), timeout_s=0.0
    )

    assert len(_escalation_records(caplog)) == 1


@pytest.mark.parametrize(
    "row",
    [
        # sFOX is never stamped here (skipped_no_budget is decided before the
        # venue check), so there is no check to be missing. MT5 is stamped now
        # and escalates like a ccxt key (MT5 section, end of file).
        pytest.param({"exchange": "sfox"}, id="not-ccxt"),
        # A stamped key's duplicate check has run; nothing is missing.
        pytest.param({"venue_account_id": "70000002"}, id="already-stamped"),
        # The column is NOT NULL and the poll loads select("*"), so an absent
        # or unreadable value is a fixture artefact: no claim is made.
        pytest.param({"created_at": None}, id="no-created-at"),
        pytest.param({"created_at": "not a timestamp"}, id="unparseable"),
    ],
)
async def test_no_escalation_where_no_duplicate_check_is_missing(
    row: dict[str, Any], caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("DEBUG")
    base = {"created_at": _created_days_ago(30)}
    base.update(row)

    await ai.stamp_account_identity(
        FakeSupabase(), _key_row(**base), _okx_exchange(), timeout_s=0.0
    )

    assert _escalation_records(caplog) == []
    assert not [r for r in caplog.records if r.levelname == "ERROR"]


# ---------------------------------------------------------------------------
# MT5 — the poll stamps an MT5 key from its login (debug session
# unstamped-venue-account-id, founder Option B, 2026-10-03)
# ---------------------------------------------------------------------------
#
# Why. An MT5 key connected before migration 20260812083206 (the column) has a
# NULL venue_account_id, and until this change nothing ever wrote one: the poll
# stamper skipped MT5 and the connect/rotate routes only stamp on connect or on
# a password correction. With a NULL id the unique index cannot see two live
# MT5 keys on one broker account, so the allocator book sums that account
# twice. MEASURED on PROD 2026-10-03: two such keys behave as one account.
#
# The identity is the login exactly as the connect route stores it
# (validate-and-encrypt: ``api_key.trim()``) and as rotate returns it
# (routers/internal.py: ``(login or "").strip() or None``): the stripped TEXT
# of the login slot, never ``str(int(login))``. ``int()`` accepts ``"007"``;
# ``str(int)`` would write ``"7"`` and a poll-stamped key would never collide
# with a connect-stamped key on the same account. The collision path is the
# ccxt one, unchanged: index refusal -> holder look-up -> 'duplicate' marker ->
# one api_key.account_duplicate_detected audit.
#
# ⛔ The broker server is NOT part of the identity (TODOS.md A-3), on purpose:
# connect stores the login alone, so a server-qualified poll value would never
# collide with a connect-stamped key. The poll's collision set is exactly
# connect's, no wider.

# Synthetic login. Never logged, so tests assert its absence.
MT5_LOGIN = "80000017"
MT5_SERVER = "Synthetic-Server"


def _mt5_session(monkeypatch: pytest.MonkeyPatch, login_slot: str) -> Any:
    """An Mt5Session built by the REAL preflight constructor, so a test fails if
    the constructor stops carrying the login text. The RPyC client is a fake
    (``Mt5Client.__init__`` opens a transport), and it must see no call."""
    from services import job_worker as jw
    from services import mt5_client as mt5_client_module

    monkeypatch.setenv("MT5_GATEWAY_HOST", "gateway.invalid")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")
    monkeypatch.setattr(
        mt5_client_module, "Mt5Client", MagicMock(return_value=MagicMock(name="client"))
    )
    return jw._make_mt5_session(login_slot, "synthetic-investor-pw", MT5_SERVER)


def _mt5_row(**overrides: Any) -> dict[str, Any]:
    return _key_row(exchange="mt5", **overrides)


def _mt5_unique_violation() -> APIError:
    return APIError({
        "code": "23505",
        "message": (
            "duplicate key value violates unique constraint "
            '"api_keys_user_exchange_venue_account_uniq"'
        ),
        "details": f"Key (user_id, exchange, venue_account_id)=(x, mt5, {MT5_LOGIN}) already exists.",
        "hint": None,
    })


def _mt5_collision_responder() -> Callable[[_Call], Any]:
    def _r(call: _Call) -> Any:
        if call.table == "api_keys" and call.op == "update" and (
            call.payload or {}
        ).get("venue_account_id") is not None:
            return _mt5_unique_violation()
        if call.table == "api_keys" and call.op == "select":
            return MagicMock(data=[{"id": HOLDER_ID}])
        return None

    return _r


async def test_mt5_null_identity_key_is_stamped_from_its_login_without_touching_the_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sb = FakeSupabase()
    session = _mt5_session(monkeypatch, MT5_LOGIN)

    outcome = await _stamp(sb, _mt5_row(), session)

    assert outcome == "stamped"
    assert sb.updates() == [{
        "venue_account_id": MT5_LOGIN,
        "account_shared_with_api_key_id": None,
        "account_share_kind": None,
    }]
    _assert_write_set_is_identity_only(sb)
    # The login is already in the decrypted session: no login, no account_info,
    # no terminal lease. A stamp that drove the terminal would contend with the
    # one shared MT5 terminal for nothing.
    assert session.client.mock_calls == []


@pytest.mark.parametrize(
    ("login_slot", "expected"),
    [
        pytest.param(MT5_LOGIN, MT5_LOGIN, id="bare"),
        # connect's api_key.trim() and rotate's .strip(): surrounding whitespace
        # goes, nothing else changes.
        pytest.param(f"  {MT5_LOGIN}\t", MT5_LOGIN, id="padded"),
        # int() accepts both; connect stores them verbatim. str(int(...)) would
        # write "80000017" for each, and never collide with the connect value.
        pytest.param("0080000017", "0080000017", id="leading-zeros"),
        pytest.param(" 8000_0017 ", "8000_0017", id="underscore"),
    ],
)
async def test_mt5_identity_is_the_login_text_connect_stores_never_its_int_form(
    monkeypatch: pytest.MonkeyPatch, login_slot: str, expected: str,
) -> None:
    sb = FakeSupabase()

    await _stamp(sb, _mt5_row(), _mt5_session(monkeypatch, login_slot))

    stamped = [u["venue_account_id"] for u in sb.updates() if u.get("venue_account_id")]
    assert stamped == [expected]


async def test_mt5_identity_form_is_the_one_rotate_returns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Poll and rotate must agree byte for byte, so both go through ONE helper.
    from services import mt5_validation

    session = _mt5_session(monkeypatch, f" 0{MT5_LOGIN}\t")

    assert mt5_validation.mt5_venue_account_id(f" 0{MT5_LOGIN}\t") == f"0{MT5_LOGIN}"
    assert mt5_validation.mt5_venue_account_id("   ") is None
    assert mt5_validation.mt5_venue_account_id(None) is None
    assert session.venue_account_id == f"0{MT5_LOGIN}"


async def test_mt5_collision_marks_the_key_duplicate_and_audits_once(
    monkeypatch: pytest.MonkeyPatch, audit_mock: MagicMock,
) -> None:
    sb = FakeSupabase(_mt5_collision_responder())

    outcome = await _stamp(sb, _mt5_row(), _mt5_session(monkeypatch, MT5_LOGIN))

    assert outcome == "marked_duplicate"
    assert sb.updates()[-1] == {
        "account_shared_with_api_key_id": HOLDER_ID,
        "account_share_kind": "duplicate",
    }
    _assert_write_set_is_identity_only(sb)
    (look,) = [c for c in sb.calls if c.table == "api_keys" and c.op == "select"]
    assert ("eq", "user_id", OWNER_ID) in look.filters
    assert ("eq", "exchange", "mt5") in look.filters
    assert ("eq", "venue_account_id", MT5_LOGIN) in look.filters
    assert ("is", "disconnected_at", "null") in look.filters
    assert ("neq", "id", KEY_ID) in look.filters
    audit_mock.assert_called_once()
    kwargs = audit_mock.call_args.kwargs
    assert kwargs["action"] == ai.DUPLICATE_DETECTED_AUDIT_ACTION
    assert kwargs["metadata"] == {"venue": "mt5", "holder_api_key_id": HOLDER_ID}


async def test_an_already_stamped_mt5_key_is_left_alone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sb = FakeSupabase()

    outcome = await _stamp(
        sb, _mt5_row(venue_account_id=MT5_LOGIN), _mt5_session(monkeypatch, MT5_LOGIN)
    )

    assert outcome == "skipped_already_stamped"
    assert sb.calls == []


async def test_the_mt5_login_never_reaches_the_log(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, audit_mock: MagicMock,
) -> None:
    caplog.set_level("DEBUG")
    sb = FakeSupabase(_mt5_collision_responder())

    outcome = await _stamp(sb, _mt5_row(), _mt5_session(monkeypatch, MT5_LOGIN))

    assert outcome == "marked_duplicate"
    assert KEY_ID in caplog.text
    assert MT5_LOGIN not in caplog.text


async def test_an_mt5_key_unstamped_for_days_escalates_like_a_ccxt_key(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    # An MT5 key now HAS a duplicate check, so a poll that never leaves time
    # for it is the same silent gap SF2-M2 escalates for a ccxt key.
    caplog.set_level("DEBUG")

    await ai.stamp_account_identity(
        FakeSupabase(),
        _mt5_row(created_at=_created_days_ago(30)),
        _mt5_session(monkeypatch, MT5_LOGIN),
        timeout_s=0.0,
    )

    assert len(_escalation_records(caplog)) == 1


async def test_poll_stamps_an_mt5_key_on_its_done_path(monkeypatch: pytest.MonkeyPatch) -> None:
    from services import job_worker as jw

    sb = FakeSupabase()
    session = _mt5_session(monkeypatch, MT5_LOGIN)

    result = await _drive_poll(monkeypatch, _mt5_row(), sb, session)

    assert result.outcome == jw.DispatchOutcome.DONE
    assert {"venue_account_id": MT5_LOGIN, "account_shared_with_api_key_id": None,
            "account_share_kind": None} in sb.updates()


# ---------------------------------------------------------------------------
# 167.1.2-08 review, SFH H-1 — a poll that does not reach DONE still runs the
# duplicate check (MT5) or says it did not (every stamped venue)
# ---------------------------------------------------------------------------
#
# Why. The stamp ran only on the DONE path, after persist. The MT5 gateway is
# the least reliable venue this service talks to, so a pre-column MT5 key whose
# polls keep failing (a -10005 wedge, sign_in_failed, a 429, a persist error)
# was never stamped, and its last-good holdings kept counting twice in the book.
# The escalation that says "duplicate check not running" lived inside the stamp,
# so it never fired either: the gap was silent. The MT5 stamp needs no terminal
# call (it reads the login text the session was built with), so it runs before
# the fetch, whatever the fetch then does. A ccxt stamp needs the venue, so a
# failed ccxt poll cannot stamp; it must at least escalate an aged key.


def _raises(exc: BaseException) -> Callable[..., Any]:
    async def _fetch(*_a: Any, **_k: Any) -> Any:
        raise exc

    return _fetch


def _failing_persist() -> Callable[..., Any]:
    async def _persist(*_a: Any, **_k: Any) -> int:
        raise RuntimeError("persist failed")

    return _persist


def _poll_failure_cases() -> list[Any]:
    import ccxt

    from services.allocator_positions import (
        AllocatorHoldingsSignInFailedError,
        AllocatorHoldingsSyncTransientError,
    )

    return [
        pytest.param({"fetch": _raises(AllocatorHoldingsSyncTransientError("terminal busy"))},
                     id="transient-gateway-wedge"),
        pytest.param({"fetch": _raises(AllocatorHoldingsSignInFailedError("sign-in refused"))},
                     id="sign-in-failed"),
        pytest.param({"fetch": _raises(ccxt.RateLimitExceeded("429"))}, id="rate-limited"),
        pytest.param({"fetch": _raises(ValueError("unexpected"))}, id="generic-failure"),
        pytest.param({"persist": _failing_persist()}, id="persist-failure"),
    ]


_MT5_STAMP = {"venue_account_id": MT5_LOGIN, "account_shared_with_api_key_id": None,
              "account_share_kind": None}


@pytest.mark.parametrize("overrides", _poll_failure_cases())
async def test_an_mt5_poll_that_fails_still_stamps_its_key_and_returns_what_it_would_without(
    monkeypatch: pytest.MonkeyPatch, overrides: dict[str, Any],
) -> None:
    from services import job_worker as jw

    # The no-stamp baseline for the same failure: the stamp must not change
    # the poll's outcome (Pitfall 4).
    base_sb = FakeSupabase()

    async def _no_stamp(*_a: Any, **_k: Any) -> str:
        return "skipped_not_ccxt"

    with monkeypatch.context() as m:
        m.setattr(ai, "stamp_account_identity", _no_stamp)
        base_result = await _drive_poll(
            m, _mt5_row(), base_sb, _mt5_session(m, MT5_LOGIN), **overrides
        )

    sb = FakeSupabase()
    session = _mt5_session(monkeypatch, MT5_LOGIN)
    result = await _drive_poll(monkeypatch, _mt5_row(), sb, session, **overrides)

    assert result.outcome == jw.DispatchOutcome.FAILED
    assert result == base_result
    assert _MT5_STAMP in sb.updates()
    assert _without_timestamps(_status_writes(sb.updates())) == _without_timestamps(
        _status_writes(base_sb.updates())
    )


async def test_an_mt5_done_poll_on_a_held_account_audits_the_duplicate_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The stamp runs ONCE per poll. A second call on the DONE path would
    # compare against the key row loaded before the first marked it, rewrite
    # the marker and announce the same duplicate twice.
    from services import job_worker as jw

    sb = FakeSupabase(_mt5_collision_responder())

    result = await _drive_poll(monkeypatch, _mt5_row(), sb, _mt5_session(monkeypatch, MT5_LOGIN))

    assert result.outcome == jw.DispatchOutcome.DONE
    assert [u for u in sb.updates() if "venue_account_id" in u] == [_MT5_STAMP]
    assert sb.updates().count(
        {"account_shared_with_api_key_id": HOLDER_ID, "account_share_kind": "duplicate"}
    ) == 1
    # _drive_poll installs its own audit double; the stamper reads it lazily.
    from services import audit as audit_module

    duplicate_audits = [
        c for c in audit_module.log_audit_event.call_args_list  # type: ignore[attr-defined]
        if c.kwargs.get("action") == ai.DUPLICATE_DETECTED_AUDIT_ACTION
    ]
    assert len(duplicate_audits) == 1


@pytest.mark.parametrize(
    ("days", "escalations"),
    [pytest.param(0, 0, id="fresh-key"), pytest.param(4, 1, id="aged-key")],
)
@pytest.mark.parametrize("overrides", _poll_failure_cases())
async def test_a_failed_ccxt_poll_escalates_an_aged_unstamped_key(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
    overrides: dict[str, Any], days: int, escalations: int,
) -> None:
    caplog.set_level("DEBUG")
    ex = _okx_exchange()

    await _drive_poll(
        monkeypatch, _key_row(created_at=_created_days_ago(days)), FakeSupabase(), ex,
        **overrides,
    )

    records = _escalation_records(caplog)
    assert len(records) == escalations
    assert all(r.levelname == "ERROR" for r in records)
    assert all(KEY_ID in r.getMessage() and "venue okx" in r.getMessage() for r in records)
    assert ACCOUNT_ID not in caplog.text


async def test_a_done_ccxt_poll_logs_no_poll_level_escalation(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    # The stamp ran and stamped: the duplicate check is running, nothing to say.
    caplog.set_level("DEBUG")

    await _drive_poll(
        monkeypatch, _key_row(created_at=_created_days_ago(30)), FakeSupabase(), _okx_exchange()
    )

    assert _escalation_records(caplog) == []


def _drive_real_preflight(
    monkeypatch: pytest.MonkeyPatch, key_row: dict[str, Any], build_exc: BaseException
) -> Any:
    """The REAL ``_allocator_key_preflight``, with the key load faked and the
    credential decrypt raising ``build_exc``."""
    from services import job_worker as jw

    def _r(call: _Call) -> Any:
        if call.table == "api_keys" and call.op == "select":
            return MagicMock(data=key_row)
        return None

    sb = FakeSupabase(_r)

    async def _no_breaker(*_a: Any, **_k: Any) -> None:
        return None

    def _decrypt(*_a: Any, **_k: Any) -> Any:
        raise build_exc

    monkeypatch.setattr(jw, "get_kek", lambda: b"k")
    monkeypatch.setattr(jw, "get_supabase", lambda: sb)
    monkeypatch.setattr(jw, "_check_circuit_breaker", _no_breaker)
    monkeypatch.setattr(jw, "decrypt_credentials", _decrypt)
    job = {"id": "job-h1", "kind": "poll_allocator_positions", "api_key_id": key_row["id"]}
    return jw.run_poll_allocator_positions_job(job)


_BUILD_FAILED = "outcome=not_attempted cause=session_build_failed"


@pytest.mark.parametrize("days", [pytest.param(0, id="fresh-key"), pytest.param(4, id="aged-key")])
@pytest.mark.parametrize("venue", ["mt5", "okx"])
async def test_a_poll_whose_session_cannot_be_built_escalates_and_re_raises(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, venue: str, days: int,
) -> None:
    # Not age-gated, unlike a failed fetch: the dispatcher turns the re-raised
    # exception into a FAILED result that main_worker logs at WARNING only, so
    # without this ERROR even a fresh key's build failure would never reach
    # Sentry. A key whose session cannot be built cannot be checked at all.
    caplog.set_level("DEBUG")
    boom = RuntimeError("decrypt failed SENTINEL-EXC-TEXT")

    with pytest.raises(RuntimeError) as raised:
        await _drive_real_preflight(
            monkeypatch, _key_row(exchange=venue, created_at=_created_days_ago(days)), boom
        )

    # The poll's own failure is unchanged: the same exception, not a wrapper.
    assert raised.value is boom
    (rec,) = [r for r in caplog.records if _BUILD_FAILED in r.getMessage()]
    assert rec.levelname == "ERROR"
    assert f"venue {venue}" in rec.getMessage() and KEY_ID in rec.getMessage()
    assert "class=RuntimeError" in rec.getMessage()
    assert (_ESCALATION in rec.getMessage()) is (days > 3)
    # The exception text can carry credential material; only its class is logged.
    assert "SENTINEL-EXC-TEXT" not in caplog.text


@pytest.mark.parametrize(
    "row",
    [
        pytest.param({"exchange": "sfox"}, id="never-stamped-venue"),
        pytest.param({"venue_account_id": ACCOUNT_ID}, id="already-stamped"),
    ],
)
async def test_a_build_failure_where_no_duplicate_check_is_missing_logs_no_identity_line(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, row: dict[str, Any],
) -> None:
    caplog.set_level("DEBUG")

    with pytest.raises(RuntimeError):
        await _drive_real_preflight(monkeypatch, _key_row(**row), RuntimeError("boom"))

    assert not [r for r in caplog.records if "account_identity:" in r.getMessage()]


# ---------------------------------------------------------------------------
# 167.1.2-08 review round 2, SFH R2-L1 — a DEFERRED poll still escalates
# ---------------------------------------------------------------------------
#
# Why. A circuit-breaker DEFERRED returns from the preflight before the poll's
# try, so neither the stamp nor the finally escalation runs. A venue whose
# breaker keeps re-tripping across every daily window would leave an
# unstamped key silent until a human reads census (a). The deferral runs the
# same age-gated check, so a fresh key adds no noise.


async def _drive_deferred_preflight(
    monkeypatch: pytest.MonkeyPatch, key_row: dict[str, Any], handler_name: str
) -> tuple[Any, Any]:
    """The REAL ``_allocator_key_preflight``, with the breaker deferring."""
    from services import job_worker as jw

    def _r(call: _Call) -> Any:
        if call.table == "api_keys" and call.op == "select":
            return MagicMock(data=key_row)
        return None

    deferred = jw.DispatchResult(outcome=jw.DispatchOutcome.DEFERRED)

    async def _breaker(*_a: Any, **_k: Any) -> Any:
        return deferred

    monkeypatch.setattr(jw, "get_kek", lambda: b"k")
    monkeypatch.setattr(jw, "get_supabase", lambda: FakeSupabase(_r))
    monkeypatch.setattr(jw, "_check_circuit_breaker", _breaker)
    job = {"id": "job-l1", "kind": "poll_allocator_positions", "api_key_id": key_row["id"]}
    return await jw._allocator_key_preflight(job, handler_name), deferred


_DEFERRED = "outcome=not_attempted cause=poll_deferred"


@pytest.mark.parametrize(
    ("days", "handler", "escalations"),
    [
        pytest.param(0, "run_poll_allocator_positions_job", 0, id="fresh-key"),
        pytest.param(4, "run_poll_allocator_positions_job", 1, id="aged-key"),
        pytest.param(4, "run_some_other_allocator_job", 0, id="other-handler"),
    ],
)
async def test_a_deferred_poll_runs_the_age_gated_escalation_and_returns_the_deferral(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
    days: int, handler: str, escalations: int,
) -> None:
    caplog.set_level("DEBUG")

    result, deferred = await _drive_deferred_preflight(
        monkeypatch, _key_row(created_at=_created_days_ago(days)), handler
    )

    assert result is deferred
    records = [r for r in caplog.records if _DEFERRED in r.getMessage()]
    assert len(records) == escalations
    assert all(r.levelname == "ERROR" and _ESCALATION in r.getMessage() for r in records)


# ---------------------------------------------------------------------------
# 167.1.2-08 review round 2, SFH R2-L4 — a marked key's check DID run
# ---------------------------------------------------------------------------
#
# Why. A key the stamper marked as sharing an account keeps venue_account_id
# NULL by design (the identity index refuses its id). That is most of the NULL
# keys on PROD. Treating it as "duplicate check not running" fires a false
# ERROR whenever such a key's polls fail for a few days, and a false alarm
# erodes trust in the real ones. The census counts a key marked against a live
# same-owner holder as RESOLVED; the key row alone cannot see the holder, so a
# marked key counts as resolved here (the conservative half of that rule).

_MARKED = {"account_shared_with_api_key_id": HOLDER_ID, "account_share_kind": "duplicate"}


@pytest.mark.parametrize(
    ("marker", "escalations"),
    [pytest.param({}, 1, id="unmarked-control"), pytest.param(_MARKED, 0, id="marked")],
)
@pytest.mark.parametrize("overrides", _poll_failure_cases())
async def test_a_failed_poll_on_an_aged_marked_key_does_not_claim_the_check_is_missing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
    overrides: dict[str, Any], marker: dict[str, Any], escalations: int,
) -> None:
    caplog.set_level("DEBUG")

    await _drive_poll(
        monkeypatch, _key_row(created_at=_created_days_ago(30), **marker), FakeSupabase(),
        _okx_exchange(), **overrides,
    )

    assert len(_escalation_records(caplog)) == escalations


@pytest.mark.parametrize(
    ("marker", "level"),
    [pytest.param({}, "ERROR", id="unmarked-control"), pytest.param(_MARKED, "WARNING", id="marked")],
)
async def test_a_retryable_stamp_failure_on_an_aged_marked_key_stays_a_warning(
    caplog: pytest.LogCaptureFixture, marker: dict[str, Any], level: str,
) -> None:
    import ccxt

    caplog.set_level("DEBUG")
    ex = _read_raises(ccxt.NetworkError("okx timed out"))

    outcome = await _stamp(
        FakeSupabase(), _key_row(created_at=_created_days_ago(30), **marker), ex
    )

    assert outcome == "error"
    assert _stamp_failure_record(caplog).levelname == level


@pytest.mark.parametrize("days", [pytest.param(0, id="fresh-key"), pytest.param(30, id="aged-key")])
async def test_a_build_failure_on_a_marked_key_is_still_an_error_but_names_the_marker(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, days: int,
) -> None:
    # The build-failure ERROR stays for a marked key: the dispatcher records the
    # failure at WARNING only, so this line is the one Sentry sees for a
    # credential that no longer decrypts. Its text no longer claims the
    # duplicate check is not running; it says the marker is not re-checked.
    caplog.set_level("DEBUG")

    with pytest.raises(RuntimeError):
        await _drive_real_preflight(
            monkeypatch, _key_row(created_at=_created_days_ago(days), **_MARKED),
            RuntimeError("boom"),
        )

    (rec,) = [r for r in caplog.records if _BUILD_FAILED in r.getMessage()]
    assert rec.levelname == "ERROR"
    assert "duplicate check not running" not in rec.getMessage()
    assert "marker is not re-checked" in rec.getMessage()


# ---------------------------------------------------------------------------
# 167.1.2-08 review, SFH M-1 — an MT5 no_id is a construction defect, said so
# ---------------------------------------------------------------------------
#
# Why. ``parse_mt5_credentials`` refuses a blank login, so an MT5 session
# without ``venue_account_id`` can only come from a constructor that omitted
# it. That used to be a WARNING saying "the venue answered without an account
# id (schema drift?)": wrong cause, never in Sentry, every day, while the key's
# duplicate check never ran. The field is now required at construction, and a
# no_id on MT5 is an ERROR naming the real cause. A ccxt no_id that recurs past
# the escalation threshold is the same "duplicate check not running" state as a
# retryable failure, so it escalates too.


def test_an_mt5_session_cannot_be_built_without_its_venue_account_id() -> None:
    from services.mt5_client import Mt5Session

    with pytest.raises(TypeError, match="venue_account_id"):
        Mt5Session(  # type: ignore[call-arg]
            client=MagicMock(), login=1, investor_password="pw", server="s"
        )


async def test_an_mt5_session_without_a_login_is_no_id_at_error_naming_the_cause(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    import dataclasses

    caplog.set_level("DEBUG")
    session = dataclasses.replace(_mt5_session(monkeypatch, MT5_LOGIN), venue_account_id=None)
    sb = FakeSupabase()

    outcome = await _stamp(sb, _mt5_row(), session)

    assert outcome == "no_id"
    assert sb.calls == []
    (rec,) = [r for r in caplog.records if "outcome=no_id" in r.getMessage()]
    assert rec.levelname == "ERROR"
    assert "venue mt5" in rec.getMessage()
    assert "construction defect" in rec.getMessage()
    assert "schema drift" not in rec.getMessage()


@pytest.mark.parametrize(
    ("days", "level"),
    [pytest.param(2, "WARNING", id="2-days-below"), pytest.param(4, "ERROR", id="4-days-above")],
)
async def test_a_ccxt_no_id_on_an_aged_unstamped_key_escalates(
    days: int, level: str, caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("DEBUG")

    outcome = await _stamp(
        FakeSupabase(), _key_row(created_at=_created_days_ago(days)), _okx_exchange(uid=None)
    )

    assert outcome == "no_id"
    (rec,) = [r for r in caplog.records if "outcome=no_id" in r.getMessage()]
    assert rec.levelname == level
    assert (_ESCALATION in rec.getMessage()) is (level == "ERROR")


# ---------------------------------------------------------------------------
# 167.1.2-08 review, IN-01 / SFH L-3 — the MT5 value obeys the same 128 cap
# ---------------------------------------------------------------------------
#
# Why. The connect seam's zod schema refuses a venue_account_id over 128
# characters, and the ccxt path enforces the same cap (_normalise). int()
# accepts a digit string of any length, so without the cap an absurd login
# would be stamped where connect would have refused it.


@pytest.mark.parametrize(
    ("length", "expected"),
    [pytest.param(128, "stamped", id="at-cap"), pytest.param(129, "no_id", id="over-cap")],
)
async def test_an_mt5_login_obeys_the_ccxt_length_cap(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
    length: int, expected: str,
) -> None:
    caplog.set_level("DEBUG")
    login = "8" * length
    sb = FakeSupabase()

    outcome = await _stamp(sb, _mt5_row(), _mt5_session(monkeypatch, login))

    assert outcome == expected
    stamped = [u for u in sb.updates() if u.get("venue_account_id")]
    assert stamped == ([{"venue_account_id": login, "account_shared_with_api_key_id": None,
                         "account_share_kind": None}] if expected == "stamped" else [])
    if expected == "no_id":
        assert any(
            "over 128" in r.getMessage() and "venue mt5" in r.getMessage()
            and r.levelname == "WARNING"
            for r in caplog.records
        )
    assert login not in caplog.text


# ---------------------------------------------------------------------------
# 167.1.2-08 review, IN-04 — a slow MT5 poll cannot starve the MT5 stamp
# ---------------------------------------------------------------------------
#
# Why. The stamp's budget is what is left of the handler's timeout. MT5 polls
# hold the one shared terminal and can use most of it, and the MT5 stamp needs
# no terminal time at all, so a stamp placed after the fetch could be skipped
# (and escalate daily) for want of time it never needed. It runs before the
# fetch, so the terminal's time is not yet spent. A ccxt stamp needs the venue
# and stays after it (test_a_poll_near_its_timeout_skips_the_stamp).


async def test_a_slow_mt5_poll_still_stamps_its_key(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    from services import job_worker as jw

    # 2 s of budget beyond the margin (wide enough that a loaded runner's
    # thread hop cannot time the stamp out); the fetch then takes 2.5 s, so a
    # stamp measured after the fetch would see a budget below zero.
    monkeypatch.setitem(
        jw.TIMEOUT_PER_KIND, "poll_allocator_positions", jw._IDENTITY_STAMP_MARGIN_S + 2.0
    )

    async def _slow_fetch(*_a: Any, **_k: Any) -> Any:
        await asyncio.sleep(2.5)
        return ([], None)

    sb = FakeSupabase()
    result = await _drive_poll(
        monkeypatch, _mt5_row(), sb, _mt5_session(monkeypatch, MT5_LOGIN), fetch=_slow_fetch
    )

    assert result.outcome == jw.DispatchOutcome.DONE
    assert _MT5_STAMP in sb.updates()
