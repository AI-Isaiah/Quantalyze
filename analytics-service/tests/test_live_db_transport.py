"""Tests for the bounded transport retry (Phase 164.9 plan 05,
`[164.9-SHARED-TEST-TRANSPORT-FLAKE]`, Python half). See `live_db_transport.py`'s
module docstring for the measured census this module is written against.

Uses fakes exclusively: constructs no real client, reads no credential, and drives
no network call. The six behaviours below are the falsifiable contract; Task 2's
derived factory-coverage pin lives at the bottom of this file.
"""
from __future__ import annotations

import logging
import re

import httpx
import pytest
from postgrest.exceptions import APIError

from tests.live_db_transport import (
    RETRY_ATTEMPTS,
    TransportRetryExhausted,
    is_transient_transport_fault,
    retry_transport,
    wrap_live_db_client,
)


def _postgrest_gateway_error(status_code: int) -> APIError:
    """Build an APIError the way `generate_default_error_message` does for a
    non-JSON gateway response: `.code` is the raw int status_code, not a
    Postgres SQLSTATE string."""
    return APIError(
        {
            "message": "JSON could not be generated",
            "code": status_code,
            "hint": "Refer to full message for details",
            "details": "SUPER SECRET body postgres://user:pw@host:5432/db",
        }
    )


def _postgrest_sqlstate_error(sqlstate: str) -> APIError:
    """Build an APIError the way a real Postgres rejection arrives: `.code` is a
    SQLSTATE string, e.g. unique_violation."""
    return APIError(
        {
            "message": "duplicate key value violates unique constraint",
            "code": sqlstate,
            "hint": None,
            "details": None,
        }
    )


# ── Behaviour 1: recovery ────────────────────────────────────────────────────


def test_recovery_returns_underlying_result_with_correct_attempt_count(caplog):
    """A fake that raises a transient fault on its first attempts and then
    succeeds returns the underlying result, and the recorded attempt count
    equals the number of failures plus one."""
    calls: list[int] = []

    def flaky():
        calls.append(len(calls) + 1)
        if len(calls) <= 2:
            raise httpx.ConnectError("boom")
        return "underlying-result"

    sleeps: list[float] = []
    with caplog.at_level(logging.WARNING, logger="tests.live_db_transport"):
        result = retry_transport(flaky, attempts=5, backoff_base=0.1, sleep=sleeps.append)

    assert result == "underlying-result"
    assert len(calls) == 3  # 2 failures + 1 success
    # T-164.9-05-05: a retried run must be DISTINGUISHABLE, never silent.
    assert any("retry attempt" in rec.message for rec in caplog.records)


# ── Behaviour 2: exhaustion ──────────────────────────────────────────────────


def test_exhaustion_raises_named_error_with_exact_attempt_count():
    """A fake that always raises a transient fault raises the named exhaustion
    error, and the recorded attempt count equals the configured budget EXACTLY
    — not "at least"."""
    calls: list[int] = []

    def always_fails():
        calls.append(len(calls) + 1)
        raise httpx.ConnectError("[Errno 104] Connection reset by peer")

    sleeps: list[float] = []
    with pytest.raises(TransportRetryExhausted) as excinfo:
        retry_transport(always_fails, attempts=3, backoff_base=0.1, sleep=sleeps.append)

    assert len(calls) == 3  # exactly the budget — an off-by-one budget is a real defect
    assert excinfo.value.attempts == 3
    assert excinfo.value.last_exc_type is httpx.ConnectError


# ── Behaviour 3: discrimination ──────────────────────────────────────────────


@pytest.mark.parametrize(
    "make_exc",
    [
        pytest.param(lambda: _postgrest_sqlstate_error("23505"), id="constraint-violation"),
        pytest.param(lambda: AssertionError("business logic failed"), id="assertion-error"),
    ],
)
def test_discrimination_propagates_non_transport_on_first_attempt(make_exc):
    """A fake that raises a non-transport error — a constraint violation shape
    and an assertion error — propagates on the FIRST attempt, unretried, with
    the attempt count equal to one."""
    calls: list[int] = []
    exc_to_raise = make_exc()

    def raiser():
        calls.append(len(calls) + 1)
        raise exc_to_raise

    sleeps: list[float] = []
    with pytest.raises(type(exc_to_raise)) as excinfo:
        retry_transport(raiser, attempts=5, backoff_base=0.1, sleep=sleeps.append)

    assert excinfo.value is exc_to_raise  # propagated unwrapped, not re-raised as exhaustion
    assert len(calls) == 1
    assert sleeps == []


# ── Behaviour 4: transparency ────────────────────────────────────────────────


def test_transparency_first_attempt_success_returns_unchanged_and_does_not_sleep():
    """On a first-attempt success the wrapper returns the underlying result
    object unchanged and does not sleep."""
    sentinel = object()
    calls: list[int] = []

    def succeeds():
        calls.append(len(calls) + 1)
        return sentinel

    sleeps: list[float] = []
    result = retry_transport(succeeds, attempts=RETRY_ATTEMPTS, backoff_base=0.1, sleep=sleeps.append)

    assert result is sentinel  # unchanged object identity, not a copy or wrapper
    assert len(calls) == 1
    assert sleeps == []


# ── Behaviour 5: the sleep seam is real ──────────────────────────────────────


def test_sleep_seam_called_once_per_retry_with_non_decreasing_delay():
    """The injected sleep is called exactly once per retry, with a
    non-decreasing delay, so a wrapper that silently never backs off cannot
    pass."""
    calls: list[int] = []

    def flaky():
        calls.append(len(calls) + 1)
        if len(calls) <= 2:
            raise httpx.ConnectError("boom")
        return "ok"

    sleeps: list[float] = []
    retry_transport(flaky, attempts=5, backoff_base=0.5, sleep=sleeps.append)

    assert len(sleeps) == 2  # one sleep per retry: attempt1->2 and attempt2->3
    assert sleeps == sorted(sleeps)  # non-decreasing
    assert all(s > 0 for s in sleeps)


# ── Behaviour 6: redaction ────────────────────────────────────────────────────


def test_redaction_exhaustion_message_names_type_and_count_only():
    """The exhaustion error's string form contains the exception TYPE name and
    the attempt count, and contains neither the original exception's message
    body nor anything matching a connection-string shape."""

    def always_fails():
        raise _postgrest_gateway_error(504)

    sleeps: list[float] = []
    with pytest.raises(TransportRetryExhausted) as excinfo:
        retry_transport(always_fails, attempts=2, backoff_base=0.01, sleep=sleeps.append)

    message = str(excinfo.value)
    assert "APIError" in message  # exception TYPE name
    assert "2" in message  # attempt count
    assert "SUPER SECRET" not in message  # original message/details body
    assert "postgres://" not in message  # nothing connection-string shaped
    assert not re.search(r"postgres(ql)?://", message)


# ── Classifier unit coverage (supports the six behaviours above) ────────────


@pytest.mark.parametrize(
    "make_exc,expected",
    [
        pytest.param(lambda: httpx.ConnectError("[Errno 104] Connection reset by peer"), True, id="httpx-connect-error"),
        pytest.param(lambda: httpx.ReadTimeout("timed out"), True, id="httpx-read-timeout"),
        pytest.param(lambda: httpx.RemoteProtocolError("ConnectionTerminated error_code:1"), True, id="httpx-remote-protocol-error"),
        pytest.param(lambda: _postgrest_gateway_error(504), True, id="postgrest-504"),
        pytest.param(lambda: _postgrest_gateway_error(502), True, id="postgrest-502"),
        pytest.param(lambda: _postgrest_gateway_error(503), True, id="postgrest-503"),
        pytest.param(lambda: _postgrest_sqlstate_error("23505"), False, id="postgrest-unique-violation"),
        pytest.param(lambda: _postgrest_sqlstate_error("42501"), False, id="postgrest-insufficient-privilege"),
        pytest.param(lambda: _postgrest_sqlstate_error("P0001"), False, id="postgrest-raise-exception-nonnumeric"),
        pytest.param(lambda: AssertionError("nope"), False, id="assertion-error"),
        pytest.param(lambda: ValueError("unrelated"), False, id="unrecognized-exception"),
    ],
)
def test_is_transient_transport_fault_classifier(make_exc, expected):
    assert is_transient_transport_fault(make_exc()) is expected


# ── Proxy transparency (supports Task 2's factory wiring) ───────────────────


class _FakeBuilder:
    """Minimal stand-in for a supabase-py chained query builder."""

    def __init__(self, log: list[str], fail_times: int = 0):
        self._log = log
        self._fail_times = fail_times
        self._execute_calls = 0

    def table(self, name):
        self._log.append(f"table({name!r})")
        return self

    def select(self, cols):
        self._log.append(f"select({cols!r})")
        return self

    def eq(self, col, val):
        self._log.append(f"eq({col!r}, {val!r})")
        return self

    def execute(self):
        self._execute_calls += 1
        if self._execute_calls <= self._fail_times:
            raise httpx.ConnectError("boom")
        return {"data": [{"id": 1}]}


def test_proxy_passes_chained_builders_through_and_retries_only_execute():
    log: list[str] = []
    fake_client = _FakeBuilder(log, fail_times=1)
    sleeps: list[float] = []
    proxy = wrap_live_db_client(fake_client, attempts=3, backoff_base=0.01, sleep=sleeps.append)

    result = proxy.table("strategy_analytics").select("*").eq("id", 1).execute()

    assert result == {"data": [{"id": 1}]}
    assert log == ["table('strategy_analytics')", "select('*')", "eq('id', 1)"]
    assert len(sleeps) == 1  # exactly one retry happened, transparently

# gsd:task2-derived-pin-goes-here — Task 2 appends the derived factory-coverage
# pin below this line once the four factories are wired to the retrying proxy.
