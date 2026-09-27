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
        # sFOX and MT5 are never stamped here (skipped_no_budget is decided
        # before the venue check), so there is no check to be missing.
        pytest.param({"exchange": "sfox"}, id="not-ccxt"),
        pytest.param({"exchange": "mt5"}, id="mt5"),
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
