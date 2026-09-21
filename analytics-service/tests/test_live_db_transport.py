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
import subprocess
import sys
from pathlib import Path

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
            "details": (
                # The sentinel is "SUPER SECRET" and NOTHING ELSE here is
                # load-bearing: the only assertion over this value is
                # `"SUPER SECRET" not in message`. ⛔ Do NOT make this literal
                # credential-SHAPED (a DSN, a key, a token). This repository is
                # PUBLIC, the secret scanner reads one squash commit on a merge
                # to the default branch, and a credential-shaped fixture literal
                # becomes a latent finding that outlives the test. It was one
                # until the pre-push guardrail refused it.
                "SUPER SECRET body <opaque-upstream-body-placeholder>"
            ),
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

    def insert(self, row):
        self._log.append(f"insert({row!r})")
        return self

    def update(self, row):
        self._log.append(f"update({row!r})")
        return self

    def upsert(self, row):
        self._log.append(f"upsert({row!r})")
        return self

    def delete(self):
        self._log.append("delete()")
        return self

    def rpc(self, name, params):
        self._log.append(f"rpc({name!r}, {params!r})")
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


# ── The idempotency boundary ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    "drive,expected_log",
    [
        pytest.param(
            lambda p: p.table("compute_jobs").insert({"id": 1}).execute(),
            ["table('compute_jobs')", "insert({'id': 1})"],
            id="insert",
        ),
        pytest.param(
            lambda p: p.table("compute_jobs").update({"state": "done"}).execute(),
            ["table('compute_jobs')", "update({'state': 'done'})"],
            id="update",
        ),
        pytest.param(
            lambda p: p.table("compute_jobs").upsert({"id": 1}).execute(),
            ["table('compute_jobs')", "upsert({'id': 1})"],
            id="upsert",
        ),
        pytest.param(
            lambda p: p.table("compute_jobs").delete().eq("id", 1).execute(),
            ["table('compute_jobs')", "delete()", "eq('id', 1)"],
            id="delete",
        ),
        pytest.param(
            lambda p: p.rpc("claim_compute_job", {"p_kind": "k"}).execute(),
            ["rpc('claim_compute_job', {'p_kind': 'k'})"],
            id="rpc",
        ),
    ],
)
def test_non_idempotent_chains_execute_exactly_once_and_do_not_retry(drive, expected_log):
    """WHY this matters, not just what it does: a 504 on a write names a request
    that may ALREADY HAVE COMMITTED. Replaying it double-writes, or raises a
    23505 that is (correctly) non-transient and hard-fails — manufacturing the
    flake the retry exists to absorb. So a chain through insert/update/upsert/
    delete/rpc must call the terminal `.execute()` EXACTLY ONCE and let the
    transport fault out, even though that same fault WOULD be retried on a read.
    """
    log: list[str] = []
    fake_client = _FakeBuilder(log, fail_times=1)
    sleeps: list[float] = []
    proxy = wrap_live_db_client(fake_client, attempts=3, backoff_base=0.01, sleep=sleeps.append)

    with pytest.raises(httpx.ConnectError):
        drive(proxy)

    assert fake_client._execute_calls == 1  # exactly once — never replayed
    assert sleeps == []  # no backoff, because no retry was attempted
    assert log == expected_log  # the chain itself is still passed through verbatim


def test_a_mutating_method_taints_only_the_rest_of_its_own_chain():
    """The taint is positional, not global: the same wrapped client still
    retries a READ issued after a write chain — otherwise one insert would
    silently disable the retry for the whole fixture."""
    log: list[str] = []
    write_client = _FakeBuilder(log, fail_times=1)
    sleeps: list[float] = []
    proxy = wrap_live_db_client(write_client, attempts=3, backoff_base=0.01, sleep=sleeps.append)

    with pytest.raises(httpx.ConnectError):
        proxy.table("compute_jobs").insert({"id": 1}).execute()

    read_client = _FakeBuilder(log, fail_times=1)
    read_proxy = wrap_live_db_client(read_client, attempts=3, backoff_base=0.01, sleep=sleeps.append)
    assert read_proxy.table("compute_jobs").select("*").execute() == {"data": [{"id": 1}]}
    assert read_client._execute_calls == 2  # the read DID retry
    assert len(sleeps) == 1


# ── Operator visibility on a GREEN run ───────────────────────────────────────


def test_retry_is_visible_in_the_terminal_summary_of_a_PASSING_run():
    """The claim under test is OPERATOR-VISIBLE, not record-created.

    Behaviour 1 above asserts through `caplog`, which proves only that the
    WARNING record exists. pytest CAPTURES log records and renders them in the
    report of a FAILING test, so on the one run that matters — a transport fault
    absorbed by a retry, suite GREEN — the warning printed nothing. This drives a
    REAL pytest subprocess over a test that genuinely retries, asserts it PASSED,
    and asserts the count reached stdout anyway.

    The `"retry attempt" not in stdout` assertion is not decoration: it pins the
    PREMISE. If a future pytest.ini switches `log_cli` on, that line starts
    appearing and this test says so rather than silently duplicating the signal.
    """
    analytics_service_dir = Path(__file__).resolve().parents[1]
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "tests/test_live_db_transport.py::test_recovery_returns_underlying_result_with_correct_attempt_count",
            "-q",
            "-p",
            "no:xdist",
            "-p",
            "no:cacheprovider",
        ],
        cwd=analytics_service_dir,
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 0, proc.stdout + proc.stderr  # the run was GREEN
    assert "1 passed" in proc.stdout
    assert re.search(
        r"live-db transport: [1-9]\d* retry/retries across [1-9]\d* call\(s\)",
        proc.stdout,
    ), f"no non-zero retry summary on a passing run; stdout was:\n{proc.stdout}"
    assert "retry attempt" not in proc.stdout  # the WARNING itself is still captured


# ── Proxy special-method delegation ──────────────────────────────────────────


def test_wrapped_empty_container_is_falsy_not_silently_truthy():
    """The QUIET failure mode of a `__getattr__`-only proxy: special-method
    lookup bypasses `__getattr__`, and a class with neither `__bool__` nor
    `__len__` is ALWAYS TRUTHY. A wrapped EMPTY result would then satisfy
    `if rows:` and fail `if not rows:` — a wrong answer with no exception, which
    is worse than the loud `TypeError` the other dunders give.
    """
    empty = wrap_live_db_client([], attempts=2, backoff_base=0.01, sleep=lambda _: None)
    nonempty = wrap_live_db_client([1, 2], attempts=2, backoff_base=0.01, sleep=lambda _: None)

    assert not empty
    assert bool(empty) is False
    assert bool(nonempty) is True
    assert len(empty) == 0
    assert len(nonempty) == 2


def test_wrapped_container_delegates_iteration_membership_and_indexing():
    proxy = wrap_live_db_client(
        [{"id": 1}, {"id": 2}], attempts=2, backoff_base=0.01, sleep=lambda _: None
    )

    assert list(proxy) == [{"id": 1}, {"id": 2}]
    assert proxy[0] == {"id": 1}
    assert {"id": 2} in proxy


def test_wrapped_objects_compare_and_repr_by_target():
    a = wrap_live_db_client({"k": 1}, attempts=2, backoff_base=0.01, sleep=lambda _: None)
    b = wrap_live_db_client({"k": 1}, attempts=2, backoff_base=0.01, sleep=lambda _: None)

    assert a == b  # proxy vs proxy compares the two TARGETS
    assert a == {"k": 1}  # proxy vs raw
    assert not (a != {"k": 1})
    assert repr(a) == repr({"k": 1})  # not "<_RetryingClientProxy object at 0x...>"


def test_attribute_assignment_through_the_proxy_reaches_the_target():
    """`__slots__` + no `__setattr__` makes assignment through the proxy an
    AttributeError. A live-DB fixture that rebuilds a transport session AFTER
    wrapping — the ordering `test_compute_jobs_fencing.py` happens to avoid
    today — would hit exactly that."""

    class _Client:
        def __init__(self):
            self.session = "original"

    target = _Client()
    proxy = wrap_live_db_client(target, attempts=2, backoff_base=0.01, sleep=lambda _: None)

    proxy.session = "rebuilt"

    assert target.session == "rebuilt"  # the assignment landed on the TARGET
    assert proxy.session == "rebuilt"

    del proxy.session
    assert not hasattr(target, "session")


# ── Task 2's derived factory-coverage pin ────────────────────────────────────


def test_all_live_db_client_factories_go_through_retrying_proxy():
    """Derived pin: the number of tests/*.py modules defining a live-DB client
    factory (`_need_supabase`) must equal the number of tests/*.py modules
    (excluding this file and the helper itself) that reference the retry
    helper. A fifth factory added later without wrapping it fails this — the
    count is NEVER hard-coded."""
    tests_dir = Path(__file__).parent
    factory_modules: set[str] = set()
    wrapped_modules: set[str] = set()

    for path in sorted(tests_dir.glob("*.py")):
        if path.name in {"test_live_db_transport.py", "conftest.py", "live_db_transport.py"}:
            continue
        try:
            source = path.read_text(encoding="utf-8")
        except OSError:
            continue
        if re.search(r"^def _need_supabase\b", source, re.MULTILINE):
            factory_modules.add(path.name)
        if "live_db_transport" in source:
            wrapped_modules.add(path.name)

    assert factory_modules, "expected at least one live-DB client factory module"
    assert factory_modules == wrapped_modules, (
        f"factory modules {sorted(factory_modules)} != modules importing "
        f"live_db_transport {sorted(wrapped_modules)} — every live-DB client "
        f"factory must return through wrap_live_db_client"
    )
