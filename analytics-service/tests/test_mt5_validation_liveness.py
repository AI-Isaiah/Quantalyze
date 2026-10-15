"""Tests for services/mt5_validation_liveness.py (Phase 164.6.8 plan 06, D-09).

WHY these properties matter (Rule 9: a test that cannot fail when the business
logic changes is wrong):

* a wedged or logged-out VALIDATION terminal was noticed only when a client's key
  failed to validate -- the tracer proves the monitor tick now pages the founder
  for it at the existing threshold, through the shared tracker;
* the probe runs on a cadence against a terminal that holds CLIENT accounts between
  scrubs, so it must never log in, never change the account, never delay a real
  validation (busy is a skip) and never write a handover row;
* a terminal held through EVERY tick, or a gateway nobody configured, is not proven
  alive -- both extend the run and page, they do not read as healthy;
* the probe and the reader run inside the monitor loop; a raise there reaches
  ``_crash_handler`` and stops the dispatch, watchdog and enqueue loops behind a
  green ``/health``;
* the reader exists because ``_alert_scrub_failed`` captures at WRITE time and
  nothing read the ROW back: a skipped scrub leaves a client's saved login on the
  terminal.

Each reader below was neutered, observed RED by name, and restored byte-identical.
See the plan 06 SUMMARY.
"""

from __future__ import annotations

import ast
import asyncio
import inspect
import logging
import textwrap
import threading
import types
from collections.abc import Iterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

import pytest

from services import (
    mt5_concurrency,
    mt5_outage_alert,
    mt5_session_episodes,
    mt5_session_monitor,
    mt5_validation_liveness,
    ops_alert,
)
from services.mt5_client import (
    HOLDER_HOUSE,
    HOLDER_VALIDATION,
    Mt5Client,
    _note_terminal_holder,
    mt5_terminal_key,
    mt5_terminal_holder,
)
from services.mt5_handover import SITE_VALIDATION_LIVENESS
from tests.budget_rendezvous import expire_budget_when_reached
from tests.test_mt5_relogin import (  # noqa: F401 - _reset_state is an autouse fixture
    _FakeMt5,
    _heal_guard_defects,
    _reset_state,
)

_CADENCE_S = 600.0
_THRESHOLD = mt5_session_episodes.blind_run_escalation_threshold(_CADENCE_S)
assert _THRESHOLD == 6, "the tracer arithmetic below is ceil(3600 / 600)"

_VALIDATION_SOURCE = "mt5_validation_terminal"
_JOBS_SOURCE = "mt5_jobs_terminal"

# Values that must never appear in a log line. The host is a private IP literal so
# `is_private_gateway_host` admits it.
_HOST = "10.77.66.55"
_PORT = "19183"
_LOGIN = "5551234"
_SERVER = "Hostile-Server-9"

_DARK = {"initialize": False, "last_error": (-6, "no authorized account")}
_IPC_FAULT = {"initialize": False, "last_error": (-10005, "IPC timeout")}
_AUTHORIZED = {"initialize": True}


@pytest.fixture(autouse=True)
def _validation_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")
    monkeypatch.setenv("MT5_VALIDATION_GATEWAY_HOST", _HOST)
    monkeypatch.setenv("MT5_VALIDATION_GATEWAY_PORT", _PORT)
    monkeypatch.setenv("MT5_LOGIN", _LOGIN)
    monkeypatch.setenv("MT5_SERVER", _SERVER)


@pytest.fixture(autouse=True)
def _jobs_heal_is_a_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    """The jobs heal is not the subject: the tick runs it first, and an
    unconfigured jobs terminal would otherwise feed the JOBS role."""

    async def _noop(**_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(mt5_session_monitor, "heal_mt5_terminal_session", _noop)


def _install_probe_client(
    monkeypatch: pytest.MonkeyPatch, scenario: dict[str, Any]
) -> tuple[_FakeMt5, list[tuple[str, int, int]]]:
    """Point the probe's `Mt5Client` at the REAL client wired to an in-memory wire.

    Returns ``(fake, constructions)``; ``constructions`` records
    ``(host, port, thread_ident)``, which makes "built INSIDE the thread" a
    measurement rather than a reading of the source."""
    fake = _FakeMt5(scenario)
    constructions: list[tuple[str, int, int]] = []

    def _connect(*, host: str, port: int, timeout: float) -> _FakeMt5:
        return fake

    def _factory(host: str, port: int, **kwargs: Any) -> Mt5Client:
        constructions.append((host, port, threading.get_ident()))
        return Mt5Client(host, port, _connect=_connect, **kwargs)

    monkeypatch.setattr(mt5_validation_liveness, "Mt5Client", _factory)
    return fake, constructions


def _validation_pages(pages: list[Any]) -> list[Any]:
    return [p for p in pages if p.source == _VALIDATION_SOURCE]


async def _ticks(n: int) -> None:
    for _ in range(n):
        await mt5_session_monitor.run_mt5_session_monitor_tick()


# --------------------------------------------------------------------------- #
# TRACER (Task 1)
# --------------------------------------------------------------------------- #


async def test_TRACER_a_validation_terminal_reading_dark_for_the_threshold_pages_through_the_tick(
    monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list[Any]
) -> None:
    """The whole slice: tick -> probe -> lease -> credential-free probe -> classify
    -> tracker -> ``ops_alert.page``. One page, source ``mt5_validation_terminal``,
    cause ``dark``, after exactly ``ceil(3600 / 600)`` ticks and not before."""
    _install_probe_client(monkeypatch, _DARK)

    await _ticks(_THRESHOLD - 1)
    assert _validation_pages(mt5_outage_pages) == [], (
        "paged before the threshold -- a terminal that blips once must not page"
    )

    await _ticks(1)
    [page] = _validation_pages(mt5_outage_pages)
    assert page.cause == "dark"
    assert page.event == "outage"
    assert [p for p in mt5_outage_pages if p.source == _JOBS_SOURCE] == [], (
        "the validation terminal's outage must not be filed under the jobs role"
    )


async def test_the_probe_takes_the_VALIDATION_key_with_a_short_bounded_wait_for_the_validation_holder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Which terminal is leased, how long it waits, and who it claims to be are the
    whole safety argument (T-164.6.8-26): a long or unbounded wait would queue the
    probe ahead of a human's validation."""
    _install_probe_client(monkeypatch, _AUTHORIZED)
    acquisitions: list[tuple[Any, ...]] = []
    real = mt5_validation_liveness.mt5_terminal_lease

    @asynccontextmanager
    async def _counting(terminal_key: str, *, wait_s=None, holder=None, site=None):
        acquisitions.append((terminal_key, wait_s, holder, site))
        async with real(terminal_key, wait_s=wait_s, holder=holder, site=site):
            yield

    monkeypatch.setattr(mt5_validation_liveness, "mt5_terminal_lease", _counting)

    await mt5_validation_liveness.probe_validation_terminal(poll_interval_s=_CADENCE_S)

    assert acquisitions == [
        (
            mt5_terminal_key(_HOST, int(_PORT)),
            mt5_validation_liveness._MT5_RELOGIN_LEASE_WAIT_DEFAULT_S,
            HOLDER_VALIDATION,
            SITE_VALIDATION_LIVENESS,
        )
    ]
    assert 0 < acquisitions[0][1] <= 5.0, "the acquire must stay SHORT and bounded"


async def test_the_client_is_built_inside_the_thread_not_on_the_event_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`rpyc.classic.connect` has no timeout of its own; only the caller's
    `wait_for` bounds it, and only if the construction is off the loop."""
    _, constructions = _install_probe_client(monkeypatch, _AUTHORIZED)

    await mt5_validation_liveness.probe_validation_terminal(poll_interval_s=_CADENCE_S)

    [(host, port, thread_id)] = constructions
    assert (host, port) == (_HOST, int(_PORT))
    assert thread_id != threading.get_ident()


async def test_a_read_only_probe_records_NO_handover_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The lease records a handover only when the terminal's holder CHANGED across
    the hold. The probe logs nothing in, so a terminal last held by the house
    account is still held by it afterwards. Pre-stamping the registry makes this
    non-vacuous: an empty registry would also record nothing."""
    _install_probe_client(monkeypatch, _AUTHORIZED)
    recorded: list[dict[str, Any]] = []

    async def _spy(**kwargs: Any) -> None:
        recorded.append(kwargs)

    monkeypatch.setattr(mt5_concurrency, "record_mt5_terminal_handover", _spy)
    key = mt5_terminal_key(_HOST, int(_PORT))
    async with mt5_concurrency.mt5_terminal_lease(
        key, holder=HOLDER_HOUSE, site="session_heal"
    ):
        _note_terminal_holder(key, holder=HOLDER_HOUSE, stage="login")
    assert len(recorded) == 1, "the pre-stamp must itself be seen as a handover"
    recorded.clear()

    await mt5_validation_liveness.probe_validation_terminal(poll_interval_s=_CADENCE_S)

    assert recorded == []
    assert mt5_terminal_holder(key) == HOLDER_HOUSE


# --------------------------------------------------------------------------- #
# Task 2 -- edge cases
# --------------------------------------------------------------------------- #


async def test_a_lease_busy_for_every_tick_extends_the_run_and_pages_as_busy_skip(
    monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list[Any]
) -> None:
    """A terminal held through every tick is not proven alive. If a busy probe read
    as healthy, a validation terminal stuck inside a hung validation would never
    page."""
    fake, constructions = _install_probe_client(monkeypatch, _AUTHORIZED)
    key = mt5_terminal_key(_HOST, int(_PORT))
    monkeypatch.setattr(
        mt5_validation_liveness, "_MT5_RELOGIN_LEASE_WAIT_DEFAULT_S", 0.01
    )

    async with mt5_concurrency.mt5_terminal_lease(key, holder=HOLDER_VALIDATION):
        # A probe that queued instead of skipping would hang here forever; the
        # outer bound turns that into a failure, not a stuck suite.
        await asyncio.wait_for(_ticks(_THRESHOLD), timeout=10.0)

    [page] = _validation_pages(mt5_outage_pages)
    assert page.cause == "busy_skip"
    assert constructions == [], "a busy terminal must not be touched"
    assert fake.round_trips == []


async def test_an_unconfigured_validation_gateway_is_counted_and_pages_at_the_threshold(
    monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list[Any]
) -> None:
    """Never a silent skip: a validation gateway nobody configured is the exact
    state in which the terminal is unwatched."""
    monkeypatch.delenv("MT5_VALIDATION_GATEWAY_HOST")
    _, constructions = _install_probe_client(monkeypatch, _AUTHORIZED)

    await _ticks(_THRESHOLD - 1)
    assert _validation_pages(mt5_outage_pages) == []
    await _ticks(1)

    [page] = _validation_pages(mt5_outage_pages)
    assert page.cause == "gateway_not_configured"
    assert constructions == []


async def test_dark_for_the_threshold_then_authorized_pages_once_then_recovers_once_and_leaves_the_jobs_role_alone(
    monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list[Any]
) -> None:
    """D-04 / D-06 for the validation role: one outage page, then exactly one
    recovered notice on the first MEASURED authorized reading. The jobs role is
    keyed separately and must not be touched by either."""
    _install_probe_client(monkeypatch, _DARK)
    await _ticks(_THRESHOLD)
    assert [p.event for p in _validation_pages(mt5_outage_pages)] == ["outage"]

    _install_probe_client(monkeypatch, _AUTHORIZED)
    await _ticks(3)

    pages = _validation_pages(mt5_outage_pages)
    assert [p.event for p in pages] == ["outage", "recovered"]
    assert pages[1].cause == "recovered_from_dark"
    assert [p for p in mt5_outage_pages if p.source == _JOBS_SOURCE] == []


async def test_an_ipc_fault_pages_with_its_own_cause(
    monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list[Any]
) -> None:
    """`-10005` means the bridge answered and the terminal did not: a different
    remedy from `-6`, so a different cause."""
    _install_probe_client(monkeypatch, _IPC_FAULT)
    await _ticks(_THRESHOLD)
    [page] = _validation_pages(mt5_outage_pages)
    assert page.cause == "ipc_fault"
    assert "-10,005" in page.detail, "the code must survive the digit scrub"


async def test_a_probe_that_raises_is_a_counted_not_measured_reading_and_nothing_raises(
    monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list[Any]
) -> None:
    """A gateway that refuses the connection is an outage on that terminal, not an
    excuse to skip the reading; and a raise here would stop the worker loops."""

    def _boom(*_a: Any, **_k: Any) -> Any:
        raise ConnectionRefusedError("refused")

    monkeypatch.setattr(mt5_validation_liveness, "Mt5Client", _boom)

    await _ticks(_THRESHOLD)  # must not raise

    [page] = _validation_pages(mt5_outage_pages)
    assert page.cause == mt5_validation_liveness.KIND_PROBE_FAILED


async def test_a_probe_that_hangs_past_its_bound_is_counted_as_budget_abandoned(
    monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list[Any]
) -> None:
    """The thread is not cancelled by `wait_for`; the lease release fences it. The
    reading is `budget_abandoned`: unknowable, so it extends the run."""
    release = threading.Event()

    def _hang(host: str, port: int) -> tuple[str, int | None]:
        release.wait(5.0)
        return ("already_authorized", None)

    monkeypatch.setattr(mt5_validation_liveness, "_probe_blocking", _hang)
    monkeypatch.setattr(mt5_validation_liveness, "_PROBE_THREAD_BOUND_S", 0.05)
    try:
        await _ticks(_THRESHOLD)
    finally:
        release.set()

    [page] = _validation_pages(mt5_outage_pages)
    assert page.cause == "budget_abandoned"


@pytest.mark.parametrize(
    "scenario", [_DARK, _IPC_FAULT, _AUTHORIZED], ids=["dark", "ipc_fault", "authorized"]
)
async def test_the_probe_never_logs_in_never_sends_a_credential_and_never_clears_the_scrub_mark(
    monkeypatch: pytest.MonkeyPatch, scenario: dict[str, Any]
) -> None:
    """T-164.6.8-25. Asserted on the mocked wire, not on the source: every
    `initialize` the terminal saw was the bare, credential-free form, and the
    scrub-owed mark the 164.6.6.1 scrub owns is exactly as it was."""
    from services.mt5_client import mt5_scrub_owed, note_mt5_scrub_owed

    fake, _ = _install_probe_client(monkeypatch, scenario)
    key = mt5_terminal_key(_HOST, int(_PORT))
    note_mt5_scrub_owed(key)

    await _ticks(2)

    assert fake.initialize_kwargs, "the probe must have reached the terminal"
    for kwargs in fake.initialize_kwargs:
        assert not ({"login", "password", "server"} & set(kwargs)), kwargs
    assert fake.credentialed_accepted is False
    assert "login" not in fake.call_order
    assert mt5_scrub_owed(key) is True, "the probe cleared the scrub-owed mark"


async def test_no_log_line_carries_the_host_port_login_or_server(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """T-164.6.8-27: kinds and codes only, on the happy path, the dark path and the
    raising path alike."""
    caplog.set_level(logging.DEBUG)
    _install_probe_client(monkeypatch, _DARK)
    await _ticks(2)

    def _boom(*_a: Any, **_k: Any) -> Any:
        raise ConnectionRefusedError(f"{_HOST}:{_PORT} {_LOGIN} {_SERVER}")

    monkeypatch.setattr(mt5_validation_liveness, "Mt5Client", _boom)
    await _ticks(1)

    own = [
        r
        for r in caplog.records
        if r.name == "quantalyze.analytics.mt5_validation_liveness"
    ]
    assert own, "the module logged nothing, so this test measured nothing"
    for record in own:
        text = record.getMessage()
        for secret in (_HOST, _PORT, _LOGIN, _SERVER):
            assert secret not in text, text


# --------------------------------------------------------------------------- #
# The never-raises shape (T-164.6.8-28), by the ONE shared predicate
# --------------------------------------------------------------------------- #

_GUARDED = (
    mt5_validation_liveness.probe_validation_terminal,
    mt5_validation_liveness.read_unscrubbed_validation_terminal,
)


@pytest.mark.parametrize("symbol", _GUARDED, ids=lambda s: s.__name__)
def test_the_public_coroutines_satisfy_the_SHARED_never_raises_predicate(
    symbol: Any,
) -> None:
    source = textwrap.dedent(inspect.getsource(symbol))
    assert _heal_guard_defects(source, required_names=()) == [], symbol.__name__


async def test_the_tick_survives_a_probe_that_raises_past_its_own_guard(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Belt and braces: even if the probe's own guard were narrowed one day, the
    tick's outer guard contains it and the loop continues."""

    async def _escapes(**_kwargs: Any) -> None:
        raise RuntimeError("escaped")

    monkeypatch.setattr(mt5_session_monitor, "probe_validation_terminal", _escapes)
    await mt5_session_monitor.run_mt5_session_monitor_tick()  # must not raise


async def test_the_tick_bounds_the_probe_with_its_own_wait_for(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A probe that hangs INSIDE its own guard (the lease, the tracker's page) must
    cost the tick at most its bound, and be said aloud."""

    async def _hangs(**_kwargs: Any) -> None:
        await asyncio.sleep(30)

    monkeypatch.setattr(mt5_session_monitor, "probe_validation_terminal", _hangs)
    monkeypatch.setattr(mt5_session_monitor, "PROBE_TICK_BOUND_S", 0.05)
    caplog.set_level(logging.WARNING)

    await mt5_session_monitor.run_mt5_session_monitor_tick()

    assert any(
        "validation terminal probe did not complete" in r.getMessage()
        for r in caplog.records
    )


def test_the_probe_runs_after_the_jobs_heal_in_the_tick_source() -> None:
    """Order is part of the design: the cadence argument (the call cannot pre-empt
    the heal's own abandon arm) only holds if the probe comes AFTER the heal."""
    source = inspect.getsource(mt5_session_monitor.run_mt5_session_monitor_tick)
    heal = source.index("heal_mt5_terminal_session(")
    probe = source.index("probe_validation_terminal(")
    assert heal < probe


# --------------------------------------------------------------------------- #
# Task 3 -- the reader of non-scrubbed mt5_terminal_scrub rows (D-09 (b))
# --------------------------------------------------------------------------- #

_SCRUB_SOURCE = "mt5_terminal_scrub"
_T0 = "2026-10-13T12:00:00+00:00"
_T1 = "2026-10-13T13:00:00+00:00"


class _Resp:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self.data = data


class _ScrubSink:
    """A fake `cron_runs` that answers the reader's one query with the newest row
    and records exactly what was asked."""

    def __init__(self) -> None:
        self.newest: dict[str, Any] | None = None
        self.selected: list[str] = []
        self.filters: list[tuple[str, Any]] = []
        self.raises: Exception | None = None

    def table(self, name: str) -> "_ScrubSink":
        assert name == "cron_runs"
        return self

    def select(self, columns: str) -> "_ScrubSink":
        self.selected.append(columns)
        return self

    def eq(self, column: str, value: Any) -> "_ScrubSink":
        self.filters.append((column, value))
        return self

    def order(self, *_a: Any, **_k: Any) -> "_ScrubSink":
        return self

    def limit(self, *_a: Any, **_k: Any) -> "_ScrubSink":
        return self

    def execute(self) -> _Resp:
        if self.raises is not None:
            raise self.raises
        return _Resp([self.newest] if self.newest is not None else [])


def _row(row_id: str, kind: str, completed_at: str = _T0, **extra: Any) -> dict[str, Any]:
    metadata = {
        "schema_version": 1,
        "kind": kind,
        "terminal_role": "validation",
        "site": "terminal_scrub",
        "refused": 0,
        "accounts_deleted": 1,
        "accounts_missing": 0,
        "accounts_errors": 0,
        "trades_deleted": 2,
        "trades_errors": 0,
        "profile_accounts_found": 0,
        "profile_errors": 0,
        "relaunch_status": "verified",
        "records_account_number": False,
    }
    metadata.update(extra)
    return {"id": row_id, "completed_at": completed_at, "metadata": metadata}


@pytest.fixture
def scrub_sink(monkeypatch: pytest.MonkeyPatch) -> _ScrubSink:
    sink = _ScrubSink()
    monkeypatch.setattr(mt5_validation_liveness, "get_supabase", lambda: sink)
    return sink


def _scrub_pages(pages: list[Any]) -> list[Any]:
    return [p for p in pages if p.source == _SCRUB_SOURCE]


async def _read() -> None:
    await mt5_validation_liveness.read_unscrubbed_validation_terminal()


async def test_a_refused_row_pages_once_with_its_kind_as_the_cause_and_its_completion_time(
    scrub_sink: _ScrubSink, mt5_outage_pages: list[Any]
) -> None:
    """The write-time alert reaches nobody if nothing reads the row: a refused
    scrub leaves a client's saved login on the terminal."""
    scrub_sink.newest = _row("r1", "refused")
    await _read()

    [page] = _scrub_pages(mt5_outage_pages)
    assert (page.cause, page.event) == ("refused", "outage")
    assert page.since is not None and page.since.isoformat() == _T0
    assert "kind=refused" in page.detail


async def test_the_reader_selects_only_the_three_columns_it_needs_for_the_scrub_cron(
    scrub_sink: _ScrubSink,
) -> None:
    """A wider select would pull a row's whole metadata into memory for nothing, and
    the cron_name filter is what keeps it off the heartbeat and episode rows."""
    scrub_sink.newest = _row("r1", "refused")
    await _read()
    assert scrub_sink.selected == ["id,completed_at,metadata"]
    assert scrub_sink.filters == [("cron_name", "mt5_terminal_scrub")]


async def test_the_same_row_read_on_the_next_tick_does_not_page_again(
    scrub_sink: _ScrubSink, mt5_outage_pages: list[Any]
) -> None:
    scrub_sink.newest = _row("r1", "refused")
    await _read()
    await _read()
    await _read()
    assert len(_scrub_pages(mt5_outage_pages)) == 1


async def test_a_newer_failed_row_pages_again_with_its_own_cause(
    scrub_sink: _ScrubSink, mt5_outage_pages: list[Any]
) -> None:
    scrub_sink.newest = _row("r1", "refused")
    await _read()
    scrub_sink.newest = _row("r2", "failed", _T1)
    await _read()
    assert [p.cause for p in _scrub_pages(mt5_outage_pages)] == ["refused", "failed"]


async def test_a_newer_scrubbed_row_after_a_page_sends_exactly_one_recovered_notice(
    scrub_sink: _ScrubSink, mt5_outage_pages: list[Any]
) -> None:
    scrub_sink.newest = _row("r1", "relaunch_unverified")
    await _read()
    scrub_sink.newest = _row("r2", "scrubbed", _T1)
    await _read()
    await _read()

    pages = _scrub_pages(mt5_outage_pages)
    assert [(p.event, p.cause) for p in pages] == [
        ("outage", "relaunch_unverified"),
        ("recovered", "recovered_from_relaunch_unverified"),
    ]
    assert pages[1].since is not None and pages[1].since.isoformat() == _T0


async def test_a_scrubbed_newest_row_with_nothing_paged_sends_nothing(
    scrub_sink: _ScrubSink, mt5_outage_pages: list[Any]
) -> None:
    """A recovered notice with no outage page before it tells the founder about an
    outage they never heard of."""
    scrub_sink.newest = _row("r1", "scrubbed")
    await _read()
    assert _scrub_pages(mt5_outage_pages) == []


# -- Review WR-01: the scrub reader's open page survives a restart ---------------- #


def _seed_scrub_page(store: Any, cause: str = "relaunch_unverified") -> None:
    """A scrub page the PREVIOUS process sent and never recovered."""
    from services.ops_alert_open import OpenPage

    store.pages[_SCRUB_SOURCE] = OpenPage(
        source=_SCRUB_SOURCE,
        cause=cause,
        since=datetime.fromisoformat(_T0),
    )


async def test_a_scrub_page_that_goes_out_leaves_a_durable_open_record_once(
    scrub_sink: _ScrubSink, ops_alert_open_store: Any
) -> None:
    scrub_sink.newest = _row("r1", "refused")
    await _read()
    await _read()
    await _read()

    record = ops_alert_open_store.pages[_SCRUB_SOURCE]
    assert record.cause == "refused"
    assert record.since is not None and record.since.isoformat() == _T0
    assert ops_alert_open_store.record_calls == 1


async def test_a_failed_scrub_record_is_retried_on_the_next_tick_while_the_page_is_open(
    scrub_sink: _ScrubSink, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    """The row is paged ONCE (by id), so the retry cannot ride on a new page: it
    rides on the tick, for as long as the page is open and unrecorded."""
    ops_alert_open_store.record_fails = True
    scrub_sink.newest = _row("r1", "refused")
    await _read()
    assert ops_alert_open_store.pages == {}

    ops_alert_open_store.record_fails = False
    await _read()
    assert ops_alert_open_store.pages[_SCRUB_SOURCE].cause == "refused"
    assert len(_scrub_pages(mt5_outage_pages)) == 1, "the retry must not re-page"

    calls = ops_alert_open_store.record_calls
    await _read()
    assert ops_alert_open_store.record_calls == calls


async def test_a_scrub_recovery_in_this_process_closes_the_record(
    scrub_sink: _ScrubSink, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    scrub_sink.newest = _row("r1", "relaunch_unverified")
    await _read()
    scrub_sink.newest = _row("r2", "scrubbed", _T1)
    await _read()

    assert [p.event for p in _scrub_pages(mt5_outage_pages)] == ["outage", "recovered"]
    assert ops_alert_open_store.pages == {}


async def test_a_scrub_recovered_notice_that_reached_no_channel_keeps_the_record_and_is_sent_again(
    scrub_sink: _ScrubSink, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    """Review WR-R2-01 / SFH-N1. The recovered notice is one-shot: this process
    forgets the page the moment it recovers. If no channel took the notice and the
    reader closed the record anyway, the founder's last message stays 'terminal not
    scrubbed' for good. The record stays open and the next tick sends it again."""
    scrub_sink.newest = _row("r1", "relaunch_unverified")
    await _read()
    mt5_outage_alert.ops_alert.page.delivers = False
    scrub_sink.newest = _row("r2", "scrubbed", _T1)

    await _read()

    assert [p.event for p in _scrub_pages(mt5_outage_pages)] == ["outage", "recovered"]
    assert _SCRUB_SOURCE in ops_alert_open_store.pages, "closed over an undelivered notice"
    assert ops_alert_open_store.close_calls == 0
    # Kept on purpose for the re-send: a new incident must replace it, not inherit it.
    assert ops_alert_open_store.stale == {_SCRUB_SOURCE}

    mt5_outage_alert.ops_alert.page.delivers = True
    await _read()

    assert [p.event for p in _scrub_pages(mt5_outage_pages)] == [
        "outage",
        "recovered",
        "recovered",
    ]
    assert ops_alert_open_store.pages == {}
    await _read()
    assert len(_scrub_pages(mt5_outage_pages)) == 3, "a delivered notice is not repeated"


async def test_d16_a_scrub_recovered_notice_with_a_sentry_event_id_closes_the_record_while_email_fails(
    scrub_sink: _ScrubSink,
    ops_alert_open_store: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-16, under D-15, through the REAL channel and the scrub reader: the
    production state while the founder email is unconfigured. CONTEXT D-15: "Sentry is
    the only live paging channel for now." CONTEXT D-16: a RECOVERED notice counts as
    delivered once its Sentry capture succeeds. So the read that sees the scrub
    succeed closes the open-page record, and the reads after it send nothing, even
    though every email POST fails. Lineage: review WR-R3-01 had pinned a re-send on
    every read until a 2xx email. Expectations are typed by hand."""
    from unittest.mock import MagicMock

    spy = MagicMock()
    spy.capture_message.return_value = "synthetic-event-id"
    emails: list[str] = []

    async def _post(payload: dict[str, Any]) -> bool:
        emails.append(payload["event"])
        return False

    monkeypatch.setattr(ops_alert, "sentry_sdk", spy)
    monkeypatch.setattr(ops_alert, "_post_founder_email", _post)
    monkeypatch.setattr(mt5_validation_liveness, "ops_alert", ops_alert)
    ops_alert._reset_ops_alert_for_tests()
    try:
        scrub_sink.newest = _row("r1", "relaunch_unverified")
        await _read()
        scrub_sink.newest = _row("r2", "scrubbed", _T1)
        await _read()
        await ops_alert._drain_ops_alert_tasks_for_tests()

        assert emails == ["outage", "recovered"]
        assert ops_alert_open_store.pages == {}, "the credited recovery left its record open"
        assert ops_alert_open_store.close_calls == 1
        assert spy.capture_message.call_count == 2

        for _ in range(2):
            await _read()
            await ops_alert._drain_ops_alert_tasks_for_tests()

        assert emails == ["outage", "recovered"]
        assert spy.capture_message.call_count == 2
        assert ops_alert_open_store.close_calls == 1
    finally:
        ops_alert._reset_ops_alert_for_tests()


async def test_a_reader_cancelled_while_waiting_on_the_recovered_notice_marks_the_row_stale(
    scrub_sink: _ScrubSink,
    ops_alert_open_store: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review WR-R3-03. The tick bound can cancel the reader inside the wait for the
    recovered notice's outcome. The row stays open (the restart check is left to run
    again) but, unmarked, the next scrub that fails would find an open row that is not
    stale and keep it, so the NEW incident would inherit the old cause and `since`."""
    scrub_sink.newest = _row("r1", "relaunch_unverified")
    await _read()
    pending: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
    reached = asyncio.Event()

    async def _unsettled(*_a: Any, **_k: Any) -> Any:
        reached.set()
        return pending

    monkeypatch.setattr(mt5_outage_alert.ops_alert, "page", _unsettled)
    scrub_sink.newest = _row("r2", "scrubbed", _T1)

    # ⛔ RENDEZVOUS, NOT A STOPWATCH. This used `wait_for(_read(), timeout=0.05)`,
    # but before the reader reaches the notice it makes a thread-pool read of the
    # newest row, and on a loaded box that hop alone could outlast 50 ms: the
    # cancellation then landed BEFORE `_close_after_recovered` and the row was
    # never marked stale, which is a failure of the harness, not of the reader.
    # The budget now expires only once the notice's outcome is being awaited.
    await expire_budget_when_reached(_read(), reached)

    assert _SCRUB_SOURCE in ops_alert_open_store.pages
    assert ops_alert_open_store.stale == {_SCRUB_SOURCE}
    assert mt5_validation_liveness._SCRUB_STATE.restart_checked is False


def test_the_tick_bounds_cover_the_recovery_work_they_wrap() -> None:
    """Review R3-SFH-01 / WR-R3-03. The scrub reader's recovery is inline work: the
    newest-row read, the open-record read, the wait for the notice's outcome and the
    close. The probe's tracker call is one open-record read or write. A bound smaller
    than that sum cancels the very work it wraps, mid-notice."""
    from services import ops_alert, ops_alert_open

    open_s = ops_alert_open._OPEN_PAGE_TIMEOUT_S
    assert mt5_validation_liveness.READ_TICK_BOUND_S >= (
        mt5_validation_liveness._READ_TIMEOUT_S
        + open_s
        + ops_alert._DELIVERY_WAIT_S
        + open_s
    )
    assert mt5_validation_liveness.PROBE_TICK_BOUND_S >= (
        mt5_validation_liveness._MT5_RELOGIN_LEASE_WAIT_DEFAULT_S
        + mt5_validation_liveness._PROBE_THREAD_BOUND_S
        + open_s
    )


async def test_a_failed_scrub_close_is_retried_by_the_next_tick(
    scrub_sink: _ScrubSink, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    """Review WR-R2-02. A recovery whose close fails must not leave the reader
    believing the record is settled: the `running` row would outlive the incident
    until the next deploy, which would then send a spurious RECOVERED. The restart
    check runs again on the next tick (the real `page` suppresses the repeat notice
    inside the hour; this stub does not, so it shows as a second recovered)."""
    scrub_sink.newest = _row("r1", "relaunch_unverified")
    await _read()
    ops_alert_open_store.close_fails = True
    scrub_sink.newest = _row("r2", "scrubbed", _T1)
    await _read()
    assert _SCRUB_SOURCE in ops_alert_open_store.pages

    ops_alert_open_store.close_fails = False
    await _read()

    assert ops_alert_open_store.pages == {}
    reads = ops_alert_open_store.read_calls
    await _read()
    assert ops_alert_open_store.read_calls == reads, "closed: the sink is not read again"


async def test_a_restart_with_an_open_scrub_page_still_sends_the_recovered_notice(
    scrub_sink: _ScrubSink, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    """THE WR-01 SCENARIO for the reader. The previous process paged a non-scrubbed
    row; a redeploy forgot it; the newest row is now ``scrubbed``. With no memory the
    reader sent nothing and the founder's last message stayed 'terminal not scrubbed'.
    """
    _seed_scrub_page(ops_alert_open_store, "relaunch_unverified")
    scrub_sink.newest = _row("r9", "scrubbed", _T1)

    await _read()
    await _read()
    await _read()

    [page] = _scrub_pages(mt5_outage_pages)
    assert (page.event, page.cause) == (
        "recovered",
        "recovered_from_relaunch_unverified",
    )
    assert page.since is not None and page.since.isoformat() == _T0
    assert ops_alert_open_store.pages == {}
    assert ops_alert_open_store.read_calls == 1


async def test_a_restart_check_waits_for_a_scrubbed_row_and_reads_the_sink_for_nothing_else(
    scrub_sink: _ScrubSink, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    """A non-scrubbed newest row is not a recovery, and no row at all is not either:
    neither may consult the record, or an open page would be closed while the
    terminal is still unscrubbed."""
    _seed_scrub_page(ops_alert_open_store)

    scrub_sink.newest = None
    await _read()
    scrub_sink.newest = _row("r1", "refused")
    await _read()

    assert [p.event for p in _scrub_pages(mt5_outage_pages)] == ["outage"]
    assert ops_alert_open_store.read_calls == 0
    assert _SCRUB_SOURCE in ops_alert_open_store.pages


async def test_an_unreadable_record_does_not_mark_the_scrub_restart_check_done(
    scrub_sink: _ScrubSink, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    _seed_scrub_page(ops_alert_open_store)
    ops_alert_open_store.read_fails = True
    scrub_sink.newest = _row("r9", "scrubbed", _T1)

    await _read()
    assert _scrub_pages(mt5_outage_pages) == []

    ops_alert_open_store.read_fails = False
    await _read()
    assert [p.event for p in _scrub_pages(mt5_outage_pages)] == ["recovered"]


async def test_no_row_at_all_sends_nothing(
    scrub_sink: _ScrubSink, mt5_outage_pages: list[Any]
) -> None:
    """No validation has run since 164.6.6.1 shipped: that is not an outage."""
    scrub_sink.newest = None
    await _read()
    assert _scrub_pages(mt5_outage_pages) == []


async def test_an_unrecognised_kind_pages_as_unrecognised_and_is_never_dropped(
    scrub_sink: _ScrubSink, mt5_outage_pages: list[Any]
) -> None:
    """A row the reader cannot read is still a row that did not say "scrubbed"."""
    scrub_sink.newest = _row("r1", "something_new_from_a_future_phase")
    await _read()
    [page] = _scrub_pages(mt5_outage_pages)
    assert page.cause == "unrecognised"
    assert "something_new" not in page.detail

    # And a row with no metadata at all.
    scrub_sink.newest = {"id": "r2", "completed_at": _T1, "metadata": None}
    await _read()
    assert [p.cause for p in _scrub_pages(mt5_outage_pages)] == [
        "unrecognised",
        "unrecognised",
    ]


async def test_a_read_that_raises_is_logged_at_WARNING_and_nothing_raises(
    scrub_sink: _ScrubSink,
    mt5_outage_pages: list[Any],
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.WARNING)
    scrub_sink.raises = RuntimeError("sink down")
    await _read()  # must not raise
    assert _scrub_pages(mt5_outage_pages) == []
    assert any(
        r.levelno == logging.WARNING and "scrub-row reader" in r.getMessage()
        for r in caplog.records
    )


async def test_a_read_that_times_out_is_logged_and_nothing_raises(
    monkeypatch: pytest.MonkeyPatch,
    mt5_outage_pages: list[Any],
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def _hangs() -> None:
        await asyncio.sleep(30)

    caplog.set_level(logging.WARNING)
    monkeypatch.setattr(mt5_validation_liveness, "_read_newest_scrub_row", _hangs)
    monkeypatch.setattr(mt5_validation_liveness, "_READ_TIMEOUT_S", 0.05)
    await _read()
    assert _scrub_pages(mt5_outage_pages) == []
    assert any("scrub-row reader" in r.getMessage() for r in caplog.records)


async def test_the_page_detail_carries_closed_fields_only_even_for_a_hostile_row(
    scrub_sink: _ScrubSink, mt5_outage_pages: list[Any]
) -> None:
    """T-164.6.8-27. The row's metadata is a closed key set, but the page is the
    last line of defence: a string in an open slot (`site`, `relaunch_status`) or an
    extra key must not reach an email."""
    scrub_sink.newest = _row(
        "r1",
        "failed",
        site=f"{_HOST}:{_PORT}",
        relaunch_status=f"login {_LOGIN} on {_SERVER}",
        login=_LOGIN,
        server=_SERVER,
        host=_HOST,
        accounts_errors=_LOGIN,
    )
    await _read()
    [page] = _scrub_pages(mt5_outage_pages)
    for secret in (_HOST, _PORT, _LOGIN, _SERVER):
        assert secret not in page.detail, page.detail
    assert "accounts_errors=unknown" in page.detail


async def test_the_reader_is_called_by_the_tick_after_the_probe_and_a_raising_reader_cannot_stop_the_tick(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    order: list[str] = []

    async def _probe(**_k: Any) -> None:
        order.append("probe")

    async def _escapes() -> None:
        order.append("reader")
        raise RuntimeError("escaped")

    monkeypatch.setattr(mt5_session_monitor, "probe_validation_terminal", _probe)
    monkeypatch.setattr(mt5_session_monitor, "read_unscrubbed_validation_terminal", _escapes)

    await mt5_session_monitor.run_mt5_session_monitor_tick()  # must not raise

    assert order == ["probe", "reader"]


async def test_the_tick_bounds_the_reader_with_its_own_wait_for(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    async def _hangs() -> None:
        await asyncio.sleep(30)

    monkeypatch.setattr(mt5_session_monitor, "read_unscrubbed_validation_terminal", _hangs)
    monkeypatch.setattr(mt5_session_monitor, "READ_TICK_BOUND_S", 0.05)
    caplog.set_level(logging.WARNING)

    await mt5_session_monitor.run_mt5_session_monitor_tick()

    assert any(
        "scrub-row reader did not complete" in r.getMessage() for r in caplog.records
    )
