"""Phase 164.6.6 (MT5TERMINALISOLATION) criterion 1 — THE HANDOVER RECORD.

⭐ WHAT IS BEING PROTECTED. On 2026-09-21 the shared MT5 terminal was switched
from one account to another in about a second. The displaced account was serving
a live session and got no error, no signal and NO RECORD. The founder's D-01
(``164.6.6-CONTEXT.md``) keeps job-terminal switches between onboarded keys
under the per-call-login model and requires each one to be RECORDED against the
holder it displaced. Every test below pins one property that record needs to be
worth reading:

  * a switch writes exactly ONE row naming the DISPLACED holder (a missing row
    is the 2026-09-21 silence again; a row per hold would bury it);
  * a holder is a UUID ``api_key_id`` or a closed literal, so no account number
    can reach a row on a PUBLIC repo;
  * a login that failed never moves the record, and a recycle makes it
    ``unknown`` rather than guessing;
  * an ABANDONED session's late login is never attributed to the NEXT lease —
    otherwise the next holder's row names the wrong displaced party;
  * a down sink changes nothing a lease caller observes.

⛔ THE HARNESS IS REUSED, NEVER COPIED. ``_FakeCronRuns`` (``tests/test_mt5_relogin.py``)
is subclassed; the MT5 transport doubles come from ``tests/test_mt5_client_contract.py``
and the derive job's harness from ``tests/test_mt5_derive_branch.py``.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Any

import pytest

import services.job_worker as jw
from services import mt5_client, mt5_handover
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from services.mt5_client import (
    Mt5Client,
    Mt5ClientError,
    _mt5_epoch_for,
    mt5_terminal_holder,
    mt5_terminal_key,
)
from services.mt5_concurrency import (
    _mt5_terminal_lock_for,
    Mt5TerminalBusyError,
    mt5_terminal_lease,
    reset_terminal_state_for_tests,
)
from services.mt5_handover import (
    HANDOVER_ATTRIBUTION_LIMIT,
    HOLDER_HOUSE,
    HOLDER_UNATTRIBUTED,
    HOLDER_UNKNOWN,
    HOLDER_VALIDATION,
    MT5_TERMINAL_HANDOVER_CRON_NAME,
    SCHEMA_VERSION,
    SITE_DERIVE,
    SITE_HEAL,
    normalize_mt5_holder,
)
from tests.test_mt5_client_contract import (
    _TERMINAL_HOST,
    _TERMINAL_PORT,
    _install_recycle_double,
    _make,
    _recycle_verdict,
)
from tests.test_mt5_relogin import (
    _FAKE_HOST,
    _FAKE_LOGIN,
    _FAKE_PORT,
    _FakeCronRuns,
    _assert_no_secret_reached_any_row,
)

_HANDOVER_LOGGER = "quantalyze.analytics.mt5_handover"
_CLIENT_LOGGER = "quantalyze.analytics"

#: Two api_key_ids. ⛔ Chosen to contain neither `_FAKE_LOGIN` nor `_FAKE_PORT`
#: as a substring, so `_assert_no_secret_reached_any_row` cannot false-positive.
_KEY_A = "1f0e2d3c-0000-4000-8000-00000000000a"
_KEY_B = "1f0e2d3c-0000-4000-8000-00000000000b"

#: ⛔ THE CLOSED METADATA KEY SET, asserted with `==`. A key added to the row
#: without being added here is a new disclosure surface nobody reviewed.
#: Deliberately NOT `_OPEN_ROW_METADATA_KEYS` (that set is closed for the
#: `mt5_session_episode` name).
_HANDOVER_ROW_METADATA_KEYS = frozenset(
    {
        "schema_version",
        "previous_holder",
        "incoming_holder",
        "site",
        "records_account_number",
        "attribution_limit",
    }
)

#: The terminal the contract-suite doubles build. Taken through the shipped key
#: function so a retyped "host:port" cannot drift from `Mt5Client.terminal_key`.
_KEY = mt5_terminal_key(_TERMINAL_HOST, _TERMINAL_PORT)


class _HandoverSink(_FakeCronRuns):
    """``_FakeCronRuns`` narrowed to the rows this module writes."""

    def handovers(self) -> list[dict]:
        return [
            r for r in self.rows if r.get("cron_name") == MT5_TERMINAL_HANDOVER_CRON_NAME
        ]

    def pairs(self) -> list[tuple[str, str, str]]:
        return [
            (
                self.metadata(r)["previous_holder"],
                self.metadata(r)["incoming_holder"],
                self.metadata(r)["site"],
            )
            for r in self.handovers()
        ]


class _InsertRaisingSink(_HandoverSink):
    """A sink whose INSERT raises — the write fault (the recorder issues no
    read, so the write is the only fault there is to inject)."""

    def table(self, name: str) -> Any:
        query = super().table(name)
        original = query.execute

        def _execute() -> Any:
            if query._op == "insert":
                raise RuntimeError(f"supabase is unreachable ({_FAKE_HOST})")
            return original()

        query.execute = _execute  # type: ignore[method-assign]
        return query


class _SlowSink(_HandoverSink):
    """A sink whose INSERT outlives the recorder's bound."""

    def table(self, name: str) -> Any:
        query = super().table(name)
        original = query.execute

        def _execute() -> Any:
            if query._op == "insert":
                time.sleep(0.5)
            return original()

        query.execute = _execute  # type: ignore[method-assign]
        return query


@pytest.fixture(autouse=True)
def _reset_terminal_state():
    reset_terminal_state_for_tests()
    yield
    reset_terminal_state_for_tests()


@pytest.fixture
def sink(monkeypatch: pytest.MonkeyPatch) -> _HandoverSink:
    fake = _HandoverSink()
    monkeypatch.setattr(mt5_handover, "get_supabase", lambda: fake)
    return fake


async def _lease_and_login(holder: str | None, *, site: str | None = SITE_DERIVE) -> None:
    """One lease whose body logs the terminal in — via the REAL stamping door,
    called inside `asyncio.to_thread` exactly as `Mt5Client.login` is, so the
    ContextVar crossing into the thread is exercised rather than assumed."""
    async with mt5_terminal_lease(_KEY, holder=holder, site=site):
        await asyncio.to_thread(mt5_client._note_terminal_holder, _KEY)


# --------------------------------------------------------------------------- #
# The tracer: a switch writes ONE row naming the DISPLACED holder.
# --------------------------------------------------------------------------- #


async def test_TRACER_a_switch_to_another_holder_writes_one_row_naming_the_displaced_holder(
    sink: _HandoverSink,
) -> None:
    """THE 2026-09-21 SHAPE. The terminal held for key A is logged into key B.
    The row must name A as displaced — "no record against A" is the defect."""
    await _lease_and_login(_KEY_A)
    await _lease_and_login(_KEY_B)

    assert sink.pairs() == [
        (HOLDER_UNKNOWN, _KEY_A, SITE_DERIVE),
        (_KEY_A, _KEY_B, SITE_DERIVE),
    ]
    assert mt5_terminal_holder(_KEY) == _KEY_B
    _assert_no_secret_reached_any_row(sink)


async def test_a_lease_that_logs_in_the_SAME_holder_writes_no_row(
    sink: _HandoverSink,
) -> None:
    """A daily batch logs the same key in on every job; a row per hold would be
    noise that buries the one switch that matters."""
    await _lease_and_login(_KEY_A)
    rows_after_first = len(sink.handovers())
    await _lease_and_login(_KEY_A)
    await _lease_and_login(_KEY_A)

    assert rows_after_first == 1
    assert len(sink.handovers()) == 1


async def test_the_first_login_after_boot_records_the_previous_holder_as_unknown(
    sink: _HandoverSink,
) -> None:
    """After a restart the process cannot know who the terminal was held by, so
    it says `unknown` — never a guess, never an omitted field."""
    assert mt5_terminal_holder(_KEY) is None
    await _lease_and_login(_KEY_A)

    [row] = sink.handovers()
    assert sink.metadata(row)["previous_holder"] == HOLDER_UNKNOWN


async def test_a_lease_whose_body_logs_nobody_in_writes_no_row(
    sink: _HandoverSink,
) -> None:
    """A read-only hold (the heal finding the session healthy) moved nothing."""
    await _lease_and_login(_KEY_A)
    async with mt5_terminal_lease(_KEY, holder=_KEY_B, site=SITE_DERIVE):
        pass

    assert sink.pairs() == [(HOLDER_UNKNOWN, _KEY_A, SITE_DERIVE)]
    assert mt5_terminal_holder(_KEY) == _KEY_A


# --------------------------------------------------------------------------- #
# The REAL login: only a successful one moves the record.
# --------------------------------------------------------------------------- #


async def test_a_successful_REAL_login_stamps_the_lease_holder(sink: _HandoverSink) -> None:
    """Positive control for the failure cases below, through the shipped
    `Mt5Client.login` rather than the door directly."""
    connect, _fake, _rec = _make({})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    async with mt5_terminal_lease(client.terminal_key, holder=_KEY_A, site=SITE_DERIVE):
        await asyncio.to_thread(client.login, int(_FAKE_LOGIN), "pw", "srv")

    assert mt5_terminal_holder(_KEY) == _KEY_A
    assert sink.pairs() == [(HOLDER_UNKNOWN, _KEY_A, SITE_DERIVE)]
    _assert_no_secret_reached_any_row(sink)


@pytest.mark.parametrize(
    "scenario",
    [
        pytest.param({"login": False, "last_error": (-2, "invalid account")}, id="falsy"),
        pytest.param({"login_raises": RuntimeError("transport died")}, id="raises"),
        pytest.param(
            {"initialize": False, "last_error": (-10004, "No IPC connection")},
            id="initialize-falsy",
        ),
    ],
)
async def test_a_login_that_FAILS_never_changes_the_recorded_holder(
    sink: _HandoverSink, scenario: dict
) -> None:
    """A refused login did not switch the terminal; recording it as a switch
    would blame a holder change on a key that never got in."""
    await _lease_and_login(_KEY_A)
    connect, _fake, _rec = _make(scenario)
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    async with mt5_terminal_lease(client.terminal_key, holder=_KEY_B, site=SITE_DERIVE):
        with pytest.raises(Mt5ClientError):
            await asyncio.to_thread(client.login, int(_FAKE_LOGIN), "pw", "srv")

    assert mt5_terminal_holder(_KEY) == _KEY_A
    assert sink.pairs() == [(HOLDER_UNKNOWN, _KEY_A, SITE_DERIVE)]


async def test_a_successful_recycle_sets_the_holder_to_UNKNOWN(sink: _HandoverSink) -> None:
    """The relaunch auto-logs into whatever account was saved last, which this
    process cannot see. `unknown` is the honest answer; keeping the old holder
    would let the NEXT switch name the wrong displaced party."""
    await _lease_and_login(_KEY_A)
    connect, fake, _rec = _make({})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    _install_recycle_double(fake._MetaTrader5__conn, returns=_recycle_verdict(1, 1, 1))

    async with mt5_terminal_lease(client.terminal_key, holder=HOLDER_HOUSE, site=SITE_HEAL):
        verdict = await asyncio.to_thread(client.recycle_terminal_process)

    assert verdict["terminated"] == 1
    assert mt5_terminal_holder(_KEY) == HOLDER_UNKNOWN
    assert sink.pairs() == [
        (HOLDER_UNKNOWN, _KEY_A, SITE_DERIVE),
        (_KEY_A, HOLDER_UNKNOWN, SITE_HEAL),
    ]


# --------------------------------------------------------------------------- #
# The abandoned session (D-36/D-43): a late login stamps NOTHING.
# --------------------------------------------------------------------------- #


async def test_abandoned_session_late_login_stamps_nothing(
    sink: _HandoverSink, caplog: pytest.LogCaptureFixture
) -> None:
    """A login running in `to_thread` outlives its lease's bound. While it is
    still parked, the NEXT lease (holder B) takes the terminal and logs in. The
    zombie then completes. Stamped, it would make B's diff read `house -> A`
    and leave the registry on A: B's switch recorded against the wrong pair and
    the next switch's displaced holder wrong too. The epoch guard refuses it.

    ⭐ The zombie is released INSIDE B's hold and the test waits for it there,
    so with the guard neutered its stamp lands before B reads `after` and the
    ROW assertion goes red, not only the registry one.
    """
    release = threading.Event()
    done = threading.Event()

    def _zombie_login() -> None:
        try:
            release.wait(timeout=5)
            mt5_client._note_terminal_holder(_KEY, stage="login")
        finally:
            done.set()

    await _lease_and_login(HOLDER_HOUSE, site=SITE_HEAL)

    epoch_at_a = _mt5_epoch_for(_KEY)
    async with mt5_terminal_lease(_KEY, holder=_KEY_A, site=SITE_DERIVE):
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.to_thread(_zombie_login), timeout=0.05)

    caplog.set_level(logging.WARNING, logger=_CLIENT_LOGGER)
    async with mt5_terminal_lease(_KEY, holder=_KEY_B, site=SITE_DERIVE):
        await asyncio.to_thread(mt5_client._note_terminal_holder, _KEY)
        release.set()
        assert await asyncio.to_thread(done.wait, 5), "the zombie thread never finished"

    assert mt5_terminal_holder(_KEY) == _KEY_B, (
        f"the abandoned session's late login was stamped: registry holds "
        f"{mt5_terminal_holder(_KEY)!r}"
    )
    assert sink.pairs() == [
        (HOLDER_UNKNOWN, HOLDER_HOUSE, SITE_HEAL),
        (HOLDER_HOUSE, _KEY_B, SITE_DERIVE),
    ]
    assert all(_KEY_A not in pair for pair in sink.pairs())

    refusals = [
        r
        for r in caplog.records
        if r.name == _CLIENT_LOGGER and "not recording the terminal holder" in r.getMessage()
    ]
    assert len(refusals) == 1
    # Stage and the two generation integers ONLY — no host, port or key.
    assert refusals[0].args == ("login", epoch_at_a, epoch_at_a + 1)
    rendered = refusals[0].getMessage()
    assert _TERMINAL_HOST not in rendered and str(_TERMINAL_PORT) not in rendered


# --------------------------------------------------------------------------- #
# Row hygiene: closed holders, closed keys, a point event.
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "value",
    [
        _FAKE_LOGIN,
        "123456789012",
        "1" * 32,
        "Broker-Demo-2",
        f"{_FAKE_HOST}:{_FAKE_PORT}",
        "",
        None,
        "HOUSE",
    ],
)
def test_a_holder_outside_the_closed_set_is_written_as_unattributed(value: object) -> None:
    """⛔ A digit-only string is the shape of an account number. `uuid.UUID`
    would accept 32 bare digits, which is why the canonical hyphenated shape is
    required."""
    assert normalize_mt5_holder(value) == HOLDER_UNATTRIBUTED


@pytest.mark.parametrize(
    "value,expected",
    [
        (HOLDER_HOUSE, HOLDER_HOUSE),
        (HOLDER_VALIDATION, HOLDER_VALIDATION),
        (HOLDER_UNKNOWN, HOLDER_UNKNOWN),
        (HOLDER_UNATTRIBUTED, HOLDER_UNATTRIBUTED),
        (_KEY_A, _KEY_A),
        (_KEY_A.upper(), _KEY_A),
    ],
)
def test_a_holder_inside_the_closed_set_passes(value: str, expected: str) -> None:
    assert normalize_mt5_holder(value) == expected


async def test_an_account_number_passed_as_holder_never_reaches_a_row(
    sink: _HandoverSink,
) -> None:
    """End to end: a caller that wrongly passes the account number as the holder
    still writes nothing account-shaped."""
    await _lease_and_login(_FAKE_LOGIN)

    assert sink.pairs() == [(HOLDER_UNKNOWN, HOLDER_UNATTRIBUTED, SITE_DERIVE)]
    _assert_no_secret_reached_any_row(sink)


async def test_the_row_is_a_CLOSED_point_event_with_a_CLOSED_metadata_key_set(
    sink: _HandoverSink,
) -> None:
    await _lease_and_login(_KEY_A)

    [row] = sink.handovers()
    assert row["status"] == "ok"
    assert row["started_at"] and row["completed_at"] == row["started_at"]
    assert row["error"] is None
    assert sink.open_rows() == [], "a handover must never leave a `running` row"
    meta = sink.metadata(row)
    assert set(meta) == _HANDOVER_ROW_METADATA_KEYS
    assert meta["schema_version"] == SCHEMA_VERSION
    assert meta["records_account_number"] is False
    assert meta["attribution_limit"] == HANDOVER_ATTRIBUTION_LIMIT


def test_the_handover_site_set_is_closed_and_names_the_scrub() -> None:
    """⭐ Phase 164.6.6.1 plan 05. The site set is pinned by EQUALITY, as eight
    literals, so a site added without updating this test (or a production lease
    whose `SITE_*` constant was left out of `_SITES`, and so silently written
    as `unattributed`) goes red here. PATTERNS recorded that no equality pin
    existed before. ⛔ Literals, not the constants: comparing the set with
    itself would pass whatever it held."""
    assert mt5_handover._SITES == frozenset(
        {
            "derive_broker_dailies",
            "sync_trades_balance",
            "allocator_holdings",
            "equity_backfill",
            "validate_wizard",
            "validate_worker",
            "session_heal",
            "terminal_scrub",
        }
    )
    assert mt5_handover.SITE_TERMINAL_SCRUB == "terminal_scrub"
    assert "SITE_TERMINAL_SCRUB" in mt5_handover.__all__


async def test_a_site_outside_the_closed_set_is_written_as_unattributed(
    sink: _HandoverSink,
) -> None:
    await _lease_and_login(_KEY_A, site=f"{_FAKE_HOST}:{_FAKE_PORT}")
    assert sink.pairs() == [(HOLDER_UNKNOWN, _KEY_A, HOLDER_UNATTRIBUTED)]
    _assert_no_secret_reached_any_row(sink)


async def test_a_caller_refused_as_BUSY_records_nothing(sink: _HandoverSink) -> None:
    """The busy raise sits above the lease's `try`: a caller that never held the
    terminal cannot have moved it."""
    lock = _mt5_terminal_lock_for(_KEY)
    await lock.acquire()
    try:
        with pytest.raises(Mt5TerminalBusyError):
            async with mt5_terminal_lease(
                _KEY, wait_s=0.01, holder=_KEY_A, site=SITE_DERIVE
            ):
                pass  # pragma: no cover — never entered
    finally:
        lock.release()
    assert sink.handovers() == []
    assert mt5_terminal_holder(_KEY) is None


# --------------------------------------------------------------------------- #
# A down sink changes nothing a lease caller observes.
# --------------------------------------------------------------------------- #


async def test_a_raising_sink_still_releases_the_lock_and_keeps_the_body_exception(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The recorder is awaited in the lease's `finally`. If it raised, the
    caller would see a Supabase error INSTEAD of its own failure, and a
    `lifespan` caller would stop the worker loops. It must swallow, log the
    exception CLASS only, and leave the lock released."""
    fake = _InsertRaisingSink()
    monkeypatch.setattr(mt5_handover, "get_supabase", lambda: fake)
    caplog.set_level(logging.WARNING, logger=_HANDOVER_LOGGER)
    body_error = ValueError("the body's own failure")

    with pytest.raises(ValueError) as excinfo:
        async with mt5_terminal_lease(_KEY, holder=_KEY_A, site=SITE_DERIVE):
            await asyncio.to_thread(mt5_client._note_terminal_holder, _KEY)
            raise body_error

    assert excinfo.value is body_error
    assert not _mt5_terminal_lock_for(_KEY).locked()
    warnings = [r for r in caplog.records if r.name == _HANDOVER_LOGGER]
    assert len(warnings) == 1
    assert warnings[0].args == ("RuntimeError",)
    assert _FAKE_HOST not in warnings[0].getMessage()
    assert fake.handovers() == []


async def test_a_down_sink_on_a_CLEAN_exit_raises_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _InsertRaisingSink()
    monkeypatch.setattr(mt5_handover, "get_supabase", lambda: fake)

    await _lease_and_login(_KEY_A)

    assert not _mt5_terminal_lock_for(_KEY).locked()
    assert mt5_terminal_holder(_KEY) == _KEY_A


async def test_a_slow_sink_is_cut_off_at_the_bound(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The bound is what keeps a degraded Supabase from parking every lease
    caller on its `finally`."""
    fake = _SlowSink()
    monkeypatch.setattr(mt5_handover, "get_supabase", lambda: fake)
    monkeypatch.setattr(mt5_handover, "_HANDOVER_RECORD_TIMEOUT_S", 0.05)
    caplog.set_level(logging.WARNING, logger=_HANDOVER_LOGGER)

    started = time.monotonic()
    await _lease_and_login(_KEY_A)

    assert time.monotonic() - started < 0.4
    warnings = [r for r in caplog.records if r.name == _HANDOVER_LOGGER]
    assert [w.args for w in warnings] == [("TimeoutError",)]


# --------------------------------------------------------------------------- #
# The one real site in the tracer: the derive job.
# --------------------------------------------------------------------------- #


async def test_the_derive_job_records_its_switch_against_its_api_key_id(
    sink: _HandoverSink, monkeypatch: pytest.MonkeyPatch
) -> None:
    """End to end through `run_derive_broker_dailies_job`: the lease is taken for
    the job's `api_key_id`, the shipped login stamps it, and the row names the
    key the terminal was held for before."""
    from tests.test_mt5_derive_branch import (
        _FakeMt5Transport,
        _apply,
        _build_ctx,
        _canonical_deals,
        _job,
        _patches,
    )

    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        deals=_canonical_deals(),
    )
    ctx, _capture = _build_ctx(transport)
    ctx.key_row["id"] = _KEY_B
    key = ctx.exchange.client.terminal_key
    mt5_client._note_terminal_holder(key, holder=_KEY_A)

    seen: list[dict] = []
    real_lease = jw.mt5_terminal_lease

    def _spy(terminal_key: str, **kwargs: Any) -> Any:
        seen.append(kwargs)
        return real_lease(terminal_key, **kwargs)

    monkeypatch.setattr(jw, "mt5_terminal_lease", _spy)

    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert seen == [{"holder": _KEY_B, "site": SITE_DERIVE}]
    assert sink.pairs() == [(_KEY_A, _KEY_B, SITE_DERIVE)]
    assert mt5_terminal_holder(key) == _KEY_B


# --------------------------------------------------------------------------- #
# Task 2 — the remaining job sites and the heal.
#
# Each job site is driven through its REAL function over a REAL `Mt5Client`
# (the derive suite's transport double), with the REAL lease wrapped by a spy
# that records its keywords. The spy proves the kwargs; the row proves the
# shipped login stamped them.
# --------------------------------------------------------------------------- #


def _derive_session() -> Any:
    from tests.test_mt5_derive_branch import _FakeMt5Transport, _canonical_deals, _session

    transport = _FakeMt5Transport(
        account={
            "equity": 110_500.0,
            "balance": 110_500.0,
            "login": 123456,
            "currency": "USD",
        },
        deals=_canonical_deals(),
    )
    return _session(transport)


def _spy_lease(monkeypatch: pytest.MonkeyPatch, module: Any) -> list[dict]:
    seen: list[dict] = []
    real_lease = module.mt5_terminal_lease

    def _spy(terminal_key: str, **kwargs: Any) -> Any:
        seen.append(kwargs)
        return real_lease(terminal_key, **kwargs)

    monkeypatch.setattr(module, "mt5_terminal_lease", _spy)
    return seen


async def test_the_BALANCE_site_records_its_switch_against_its_api_key_id(
    sink: _HandoverSink, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = _derive_session()
    key = session.client.terminal_key
    mt5_client._note_terminal_holder(key, holder=_KEY_A)
    seen = _spy_lease(monkeypatch, jw)

    await jw._fetch_mt5_account_balance(session, api_key_id=_KEY_B)

    assert seen == [{"holder": _KEY_B, "site": mt5_handover.SITE_BALANCE}]
    assert sink.pairs() == [(_KEY_A, _KEY_B, mt5_handover.SITE_BALANCE)]


async def test_the_sync_job_passes_its_api_key_id_to_the_BALANCE_site(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The one caller: a sync job whose balance read is never attributed is the
    2026-09-21 silence on a different path."""
    import inspect
    import textwrap

    source = textwrap.dedent(inspect.getsource(jw.run_sync_trades_job))
    assert "_fetch_mt5_account_balance(" in source
    call = source[source.index("_fetch_mt5_account_balance(") :]
    call = call[: call.index(")") + 1]
    assert 'api_key_id=ctx.key_row.get("id")' in call, call


async def test_the_HOLDINGS_site_records_its_switch_against_its_api_key_id(
    sink: _HandoverSink, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services import allocator_positions

    monkeypatch.setenv("MT5_ENABLED", "true")
    session = _derive_session()
    key = session.client.terminal_key
    mt5_client._note_terminal_holder(key, holder=_KEY_A)
    seen = _spy_lease(monkeypatch, allocator_positions)

    await allocator_positions._fetch_mt5_account_rows("mt5", session, _KEY_B)

    assert seen == [{"holder": _KEY_B, "site": mt5_handover.SITE_HOLDINGS}]
    assert sink.pairs() == [(_KEY_A, _KEY_B, mt5_handover.SITE_HOLDINGS)]


async def test_the_BACKFILL_site_records_its_switch_against_its_api_key_id(
    sink: _HandoverSink, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`_mt5_fetch_window` imports the lease LAZILY from `mt5_concurrency`, so
    that is where the spy goes."""
    from datetime import date

    from services import equity_reconstruction
    from services import mt5_concurrency

    monkeypatch.setenv("MT5_ENABLED", "true")
    session = _derive_session()
    key = session.client.terminal_key
    mt5_client._note_terminal_holder(key, holder=_KEY_A)
    seen = _spy_lease(monkeypatch, mt5_concurrency)

    await equity_reconstruction._mt5_fetch_window(
        session,
        allocator_id="1f0e2d3c-0000-4000-8000-0000000000aa",
        api_key_id=_KEY_B,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 6, 6),
    )

    assert seen == [{"holder": _KEY_B, "site": mt5_handover.SITE_BACKFILL}]
    assert sink.pairs() == [(_KEY_A, _KEY_B, mt5_handover.SITE_BACKFILL)]


@pytest.fixture
def heal_env(monkeypatch: pytest.MonkeyPatch) -> Any:
    """The heal's own harness pieces from `tests/test_mt5_relogin.py` — its
    client double, its env and its fake clock — plus the heal's episode sink
    replaced by a list so no Supabase client is reached for THAT name."""
    from services import mt5_relogin, mt5_session_episodes
    from tests.test_mt5_relogin import _FakeClock, _FakeMt5, _set_full_env

    clock = _FakeClock()
    monkeypatch.setattr(mt5_relogin, "_clock", clock.monotonic)
    monkeypatch.setattr(mt5_relogin, "_sleep", clock.sleep)
    _FakeMt5.clock = clock
    mt5_relogin._reset_relogin_log_throttle_for_tests()
    mt5_session_episodes._reset_session_episode_state_for_tests()
    _set_full_env(monkeypatch)
    outcomes: list = []

    async def _record(outcome: Any, *, source: str, poll_interval_s: Any) -> None:
        outcomes.append(outcome)

    monkeypatch.setattr(mt5_relogin, "record_mt5_heal_outcome", _record)
    yield outcomes
    _FakeMt5.clock = None
    mt5_relogin._reset_relogin_log_throttle_for_tests()
    mt5_session_episodes._reset_session_episode_state_for_tests()


def _heal_key() -> str:
    return mt5_terminal_key(_FAKE_HOST, int(_FAKE_PORT))


async def test_a_minus_six_HEAL_records_a_handover_to_HOUSE(
    sink: _HandoverSink, monkeypatch: pytest.MonkeyPatch, heal_env: list
) -> None:
    """The heal re-logs the house account over whoever held the terminal: that
    is a switch like any other, and the displaced key gets its record."""
    from services import mt5_relogin
    from tests.test_mt5_relogin import _install_client

    mt5_client._note_terminal_holder(_heal_key(), holder=_KEY_A)
    _install_client(
        monkeypatch,
        {
            "initialize": False,
            "last_error": (-6, "Terminal: Authorization failed"),
            "initialize_credentialed": True,
        },
    )

    assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert sink.pairs() == [(_KEY_A, HOLDER_HOUSE, SITE_HEAL)]
    assert mt5_terminal_holder(_heal_key()) == HOLDER_HOUSE
    _assert_no_secret_reached_any_row(sink)


async def test_a_HEAL_tick_that_only_reads_records_nothing(
    sink: _HandoverSink, monkeypatch: pytest.MonkeyPatch, heal_env: list
) -> None:
    """A healthy session is the common tick (every ten minutes); it moved
    nothing and must write nothing."""
    from services import mt5_relogin
    from tests.test_mt5_relogin import _install_client

    mt5_client._note_terminal_holder(_heal_key(), holder=_KEY_A)
    _install_client(monkeypatch, {"initialize": True})

    assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert sink.handovers() == []
    assert mt5_terminal_holder(_heal_key()) == _KEY_A


async def test_a_HEAL_that_escalates_to_a_RECYCLE_records_a_handover_to_UNKNOWN(
    sink: _HandoverSink, monkeypatch: pytest.MonkeyPatch, heal_env: list
) -> None:
    """A recycle relaunches the terminal into whatever account was saved; the
    record says `unknown` rather than claiming `house`.

    ⭐ 164.6.6.1 plan 03 — the escalation's verb is the SCRUB, which ends the
    terminal and stamps `unknown` the same way. Its relaunch is credentialed
    with the house triple; here that relaunch does not answer, so nothing has
    logged the terminal in and the record stays `unknown`."""
    from services import mt5_relogin
    from tests.test_mt5_relogin import _install_client, _recycle_count

    mt5_client._note_terminal_holder(_heal_key(), holder=_KEY_A)
    fake, _c = _install_client(
        monkeypatch,
        {
            "initialize": False,
            "last_error": (-10005, "IPC timeout"),
            "relaunch_credentialed": False,
        },
    )

    assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert len(fake._MetaTrader5__conn.scrub_calls) == 1
    assert _recycle_count(fake) == 1
    assert sink.pairs() == [(_KEY_A, HOLDER_UNKNOWN, SITE_HEAL)]
    assert mt5_terminal_holder(_heal_key()) == HOLDER_UNKNOWN


def test_the_suite_default_sink_REFUSES_so_no_unit_test_writes_a_real_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⛔ With `SUPABASE_URL` set (as `main.py`'s `load_dotenv` does on a local
    run), an unpatched recorder would insert into a real project from every test
    that drives the real lease over a succeeding fake login. `tests/conftest.py`
    makes the default sink refuse; this pins that it does, with the variables
    set."""
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "not-a-real-key")
    with pytest.raises(RuntimeError, match="never write a handover row"):
        mt5_handover.get_supabase()
