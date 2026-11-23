"""Phase 227 plan 09 (HEAL-03): the reader that pages a human from plan 04's durable
exhaustion rows, and its place in the worker's watchdog loop.

WHY THIS FILE EXISTS. Plan 04's SQL detector writes one durable row when a strategy's
reconcile readmit hits its ceiling. A row nobody reads is the same silence the ceiling
caused in the first place, so `page_readmit_exhaustions` turns each unpaged row into an
`ops_alert` page and stamps `paged_at` only once a channel really has the page. Every
test names the business rule it protects.

The Supabase client and `ops_alert` are faked; nothing here reaches Sentry, the founder
email route or a database. The live detector is proven by plan 04's SQL gate.
"""

from __future__ import annotations

import asyncio
import logging
import re
import types
from typing import Any

import pytest

from services import ops_alert, readmit_ceiling_alert

_STRATEGY_A = "0a1b2c3d-1111-4222-8333-444455556666"
_STRATEGY_B = "9f8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff"
_GEN_A = "11111111-2222-4333-8444-555555555555"
_GEN_B = "66666666-7777-4888-8999-aaaaaaaaaaaa"


class _PostgrestError(Exception):
    """Shape of supabase-py's APIError: a structured `.code`."""

    def __init__(self, code: str) -> None:
        super().__init__(f"fixture error {code}")
        self.code = code


def _row(row_id: str, strategy_id: str, generation_key: str) -> dict[str, Any]:
    return {
        "id": row_id,
        "strategy_id": strategy_id,
        "generation_key": generation_key,
        "marker_count": 3,
        "detected_at": "2026-11-23T10:00:00+00:00",
    }


class _Query:
    """One chained PostgREST call; records the filters and resolves on `execute`."""

    def __init__(self, db: "_FakeSupabase", kind: str, name: str) -> None:
        self.db = db
        self.kind = kind
        self.name = name
        self.filters: list[tuple[str, str, Any]] = []
        self.payload: Any = None
        self.limit_n: int | None = None

    def select(self, columns: str) -> "_Query":
        self.payload = columns
        return self

    def update(self, values: dict[str, Any]) -> "_Query":
        self.kind = "update"
        self.payload = values
        return self

    def eq(self, column: str, value: Any) -> "_Query":
        self.filters.append(("eq", column, value))
        return self

    def is_(self, column: str, value: Any) -> "_Query":
        self.filters.append(("is", column, value))
        return self

    def order(self, column: str, **_kwargs: Any) -> "_Query":
        self.filters.append(("order", column, None))
        return self

    def limit(self, n: int) -> "_Query":
        self.limit_n = n
        return self

    def execute(self) -> Any:
        self.db.calls.append(self)
        error = self.db.errors.get(self.kind)
        if error is not None:
            raise error
        if self.kind == "select":
            return types.SimpleNamespace(data=list(self.db.rows[: self.limit_n]))
        return types.SimpleNamespace(data=[{"id": "stamped"}])


class _FakeSupabase:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.calls: list[_Query] = []
        # kind ("rpc" | "select" | "update") -> exception to raise on execute
        self.errors: dict[str, Exception] = {}

    def rpc(self, name: str, params: dict[str, Any] | None = None) -> _Query:
        query = _Query(self, "rpc", name)
        query.payload = params
        return query

    def table(self, name: str) -> "_FakeTable":
        return _FakeTable(self, name)

    def of_kind(self, kind: str) -> list[_Query]:
        return [call for call in self.calls if call.kind == kind]


class _FakeTable:
    def __init__(self, db: _FakeSupabase, name: str) -> None:
        self.db = db
        self.name = name

    def select(self, columns: str) -> _Query:
        return _Query(self.db, "select", self.name).select(columns)

    def update(self, values: dict[str, Any]) -> _Query:
        return _Query(self.db, "update", self.name).update(values)


class _Pager:
    """A recording `ops_alert` double. `delivers` decides the delivery outcome."""

    def __init__(self) -> None:
        self.pages: list[types.SimpleNamespace] = []
        self.delivers = True

    async def page(
        self,
        source: str,
        cause: str,
        *,
        event: str = "outage",
        since: Any = None,
        detail: str = "",
        extra_tags: dict[str, str] | None = None,
    ) -> "asyncio.Future[bool]":
        self.pages.append(
            types.SimpleNamespace(source=source, cause=cause, event=event, detail=detail)
        )
        outcome: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
        outcome.set_result(self.delivers)
        return outcome

    async def await_delivery(self, delivery: object) -> bool:
        return await ops_alert.await_delivery(delivery)


@pytest.fixture
def pager(monkeypatch: pytest.MonkeyPatch) -> _Pager:
    fake = _Pager()
    monkeypatch.setattr(
        readmit_ceiling_alert,
        "ops_alert",
        types.SimpleNamespace(
            page=fake.page,
            await_delivery=fake.await_delivery,
        ),
    )
    return fake


@pytest.fixture(autouse=True)
def _fresh_reader_state(monkeypatch: pytest.MonkeyPatch) -> None:
    """Throttle and once-per-process latch are process state; every test starts clean."""
    monkeypatch.setattr(readmit_ceiling_alert, "_last_run", None)
    monkeypatch.setattr(readmit_ceiling_alert, "_objects_missing_logged", False)


def _install_db(monkeypatch: pytest.MonkeyPatch, rows: list[dict[str, Any]]) -> _FakeSupabase:
    db = _FakeSupabase(rows)
    monkeypatch.setattr(readmit_ceiling_alert, "get_supabase", lambda: db)
    return db


# ---------------------------------------------------------------- the page and the stamp


async def test_a_delivered_page_stamps_exactly_that_row(
    monkeypatch: pytest.MonkeyPatch, pager: _Pager
) -> None:
    """HEAL-03: a strategy the sweep gave up on reaches a human, and the durable row records
    that a channel has it. The stamp is guarded with `paged_at IS NULL`, so two processes that
    both page cannot both stamp, and it targets only the row that was paged."""
    db = _install_db(monkeypatch, [_row("row-1", _STRATEGY_A, _GEN_A)])

    paged = await readmit_ceiling_alert.page_readmit_exhaustions()

    assert paged == 1
    assert [p.source for p in pager.pages] == ["reconcile_readmit_ceiling"]
    assert pager.pages[0].event == "outage"
    assert pager.pages[0].cause == f"readmit_ceiling:{_STRATEGY_A}"
    # The detector runs before the read: SQL decides and writes, Python only pages.
    assert [q.name for q in db.of_kind("rpc")] == ["record_reconcile_readmit_exhaustions"]
    (update,) = db.of_kind("update")
    assert update.name == "reconcile_readmit_exhaustions"
    assert set(update.payload) == {"paged_at"}
    assert ("eq", "id", "row-1") in update.filters
    assert ("is", "paged_at", "null") in update.filters


async def test_an_undelivered_page_leaves_the_row_unpaged(
    monkeypatch: pytest.MonkeyPatch, pager: _Pager
) -> None:
    """T-227-28: a page that reached no channel must not read as sent. With no stamp the next
    pass reads the row again and pages again (at least once beats a stranded strategy)."""
    pager.delivers = False
    db = _install_db(monkeypatch, [_row("row-1", _STRATEGY_A, _GEN_A)])

    paged = await readmit_ceiling_alert.page_readmit_exhaustions()

    assert paged == 0
    assert len(pager.pages) == 1
    assert db.of_kind("update") == []


async def test_two_strategies_page_under_two_distinct_causes(
    monkeypatch: pytest.MonkeyPatch, pager: _Pager
) -> None:
    """DEC-09-A: ops_alert windows a page per (source, cause, event) for an hour. One shared
    cause would collapse two strategies exhausting within the hour into one page and lose the
    second, so the cause carries the strategy id."""
    db = _install_db(
        monkeypatch,
        [_row("row-1", _STRATEGY_A, _GEN_A), _row("row-2", _STRATEGY_B, _GEN_B)],
    )

    paged = await readmit_ceiling_alert.page_readmit_exhaustions()

    assert paged == 2
    causes = [p.cause for p in pager.pages]
    assert causes == [f"readmit_ceiling:{_STRATEGY_A}", f"readmit_ceiling:{_STRATEGY_B}"]
    assert len(set(causes)) == 2
    assert {("eq", "id", "row-1"), ("eq", "id", "row-2")} == {
        f for q in db.of_kind("update") for f in q.filters if f[0] == "eq"
    }


async def test_the_detail_carries_only_our_own_tokens(
    monkeypatch: pytest.MonkeyPatch, pager: _Pager
) -> None:
    """T-227-26: the page leaves the system, so its detail is the marker count, the generation
    key and the detection time and nothing read from an error message or a user record."""
    _install_db(monkeypatch, [_row("row-1", _STRATEGY_A, _GEN_A)])

    await readmit_ceiling_alert.page_readmit_exhaustions()

    detail = pager.pages[0].detail
    assert "marker_count=3" in detail
    assert f"generation_key={_GEN_A}" in detail
    assert "detected_at=2026-11-23T10:00:00+00:00" in detail


async def test_the_select_is_bounded_and_reads_only_unpaged_rows(
    monkeypatch: pytest.MonkeyPatch, pager: _Pager
) -> None:
    """T-227-27: one pass handles at most 25 rows, oldest first, and a paged row is never read
    again, so an alert storm is bounded and a delivered page is not repeated."""
    db = _install_db(monkeypatch, [])

    await readmit_ceiling_alert.page_readmit_exhaustions()

    (select,) = db.of_kind("select")
    assert select.name == "reconcile_readmit_exhaustions"
    assert select.limit_n == 25
    assert ("is", "paged_at", "null") in select.filters
    assert ("order", "detected_at", None) in select.filters


async def test_the_throttle_skips_a_second_call_inside_the_interval(
    monkeypatch: pytest.MonkeyPatch, pager: _Pager
) -> None:
    """The reader runs from the 60 s watchdog loop but is meant to run once per
    _READMIT_PAGE_INTERVAL_S, so a tick inside the interval does no database work."""
    now = [1000.0]
    monkeypatch.setattr(readmit_ceiling_alert, "_clock", lambda: now[0])
    db = _install_db(monkeypatch, [])

    await readmit_ceiling_alert.page_readmit_exhaustions()
    first = len(db.calls)
    now[0] += readmit_ceiling_alert._READMIT_PAGE_INTERVAL_S - 1
    await readmit_ceiling_alert.page_readmit_exhaustions()
    assert len(db.calls) == first, "a call inside the interval did database work"

    now[0] += 2
    await readmit_ceiling_alert.page_readmit_exhaustions()
    assert len(db.calls) > first, "the interval passed and the reader did not run again"


# ------------------------------------------------------------------------- never raises


async def test_a_missing_detector_function_reads_as_zero_and_logs_once(
    monkeypatch: pytest.MonkeyPatch, pager: _Pager, caplog: pytest.LogCaptureFixture
) -> None:
    """A worker deployed ahead of the migration finds no detector (42883). The reader must not
    raise into the watchdog loop, and it must not repeat the line every pass."""
    db = _install_db(monkeypatch, [_row("row-1", _STRATEGY_A, _GEN_A)])
    db.errors["rpc"] = _PostgrestError("42883")
    caplog.set_level(logging.WARNING)

    assert await readmit_ceiling_alert.page_readmit_exhaustions() == 0
    monkeypatch.setattr(readmit_ceiling_alert, "_last_run", None)
    assert await readmit_ceiling_alert.page_readmit_exhaustions() == 0

    assert pager.pages == []
    missing = [
        r for r in caplog.records if getattr(r, "event_type", None) == "readmit_ceiling_objects_missing"
    ]
    assert len(missing) == 1


@pytest.mark.parametrize("code", ["PGRST202", "42P01", "PGRST205"])
async def test_every_missing_object_code_reads_as_zero(
    monkeypatch: pytest.MonkeyPatch, pager: _Pager, code: str
) -> None:
    """PostgREST reports a missing function as PGRST202 and a missing table as PGRST205 where
    Postgres says 42883 and 42P01. Both spellings mean 'not deployed yet', never a fault."""
    db = _install_db(monkeypatch, [])
    kind = "rpc" if code == "PGRST202" else "select"
    db.errors[kind] = _PostgrestError(code)

    assert await readmit_ceiling_alert.page_readmit_exhaustions() == 0


async def test_a_missing_table_on_the_select_reads_as_zero(
    monkeypatch: pytest.MonkeyPatch, pager: _Pager
) -> None:
    """The select half of the same rollout window: PGRST205 on the table read."""
    db = _install_db(monkeypatch, [])
    db.errors["select"] = _PostgrestError("PGRST205")

    assert await readmit_ceiling_alert.page_readmit_exhaustions() == 0
    assert pager.pages == []


async def test_a_page_that_raises_is_logged_and_never_escapes(
    monkeypatch: pytest.MonkeyPatch, pager: _Pager, caplog: pytest.LogCaptureFixture
) -> None:
    """The ops_alert contract is that a page never raises, but this reader runs inside the
    watchdog loop and must hold even if that contract breaks: log the class only, return 0."""
    _install_db(monkeypatch, [_row("row-1", _STRATEGY_A, _GEN_A)])

    async def _boom(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("secret detail that must not be logged")

    monkeypatch.setattr(
        readmit_ceiling_alert,
        "ops_alert",
        types.SimpleNamespace(page=_boom, await_delivery=pager.await_delivery),
    )
    caplog.set_level(logging.ERROR)

    assert await readmit_ceiling_alert.page_readmit_exhaustions() == 0

    failed = [
        r for r in caplog.records if getattr(r, "event_type", None) == "readmit_ceiling_page_failed"
    ]
    assert len(failed) == 1
    assert "RuntimeError" in failed[0].getMessage()
    assert "secret detail" not in failed[0].getMessage()


async def test_a_stamp_failure_is_logged_and_never_escapes(
    monkeypatch: pytest.MonkeyPatch, pager: _Pager
) -> None:
    """A failed stamp leaves the row unpaged, so the next pass pages again. It must not raise."""
    db = _install_db(monkeypatch, [_row("row-1", _STRATEGY_A, _GEN_A)])
    db.errors["update"] = RuntimeError("write blip")

    assert await readmit_ceiling_alert.page_readmit_exhaustions() == 0


async def test_cancellation_is_not_swallowed(
    monkeypatch: pytest.MonkeyPatch, pager: _Pager
) -> None:
    """Shutdown cancels the watchdog task; the reader must let that through."""
    _install_db(monkeypatch, [_row("row-1", _STRATEGY_A, _GEN_A)])

    async def _cancelled(*_args: Any, **_kwargs: Any) -> Any:
        raise asyncio.CancelledError

    monkeypatch.setattr(
        readmit_ceiling_alert,
        "ops_alert",
        types.SimpleNamespace(page=_cancelled, await_delivery=pager.await_delivery),
    )

    with pytest.raises(asyncio.CancelledError):
        await readmit_ceiling_alert.page_readmit_exhaustions()


# --------------------------------------------------------------------------- the contract


def test_the_cause_for_a_real_uuid_satisfies_the_ops_alert_cause_pattern() -> None:
    """An out-of-pattern cause is normalised to 'unrecognised' by ops_alert, which would merge
    every strategy back into one window. A lowercase uuid keeps the cause inside the pattern."""
    cause = readmit_ceiling_alert._cause_for(_STRATEGY_A)
    assert re.fullmatch(ops_alert.OPS_ALERT_CAUSE_RE, cause)
    assert cause == f"readmit_ceiling:{_STRATEGY_A}"


def test_the_source_is_a_member_of_ops_alert_sources() -> None:
    """A source outside the set is paged as 'unrecognised', and the cron route would answer
    400 to its email, so the founder would not be told about the strategy."""
    assert readmit_ceiling_alert._SOURCE in ops_alert.OPS_ALERT_SOURCES


# ---------------------------------------------------------------- the watchdog loop wiring


async def test_watchdog_loop_calls_readmit_reader(monkeypatch: pytest.MonkeyPatch) -> None:
    """HEAL-03: the reader only protects anyone if the worker's existing recurring loop calls it."""
    import main_worker

    shutdown = asyncio.Event()
    monkeypatch.setattr(main_worker, "SHUTDOWN", shutdown)
    calls = 0

    async def _noop() -> None:
        return None

    async def _reader() -> int:
        nonlocal calls
        calls += 1
        shutdown.set()
        return 0

    monkeypatch.setattr(main_worker, "watchdog_tick", _noop)
    monkeypatch.setattr(main_worker, "report_orphaned_capped_reconstructs", _noop)
    monkeypatch.setattr(main_worker, "sweep_expired_trade_reads", _noop)
    monkeypatch.setattr(main_worker, "page_readmit_exhaustions", _reader)

    task = asyncio.create_task(main_worker.watchdog_loop(interval=0.01))
    done, pending = await asyncio.wait({task}, timeout=3.0)
    for p in pending:
        p.cancel()

    assert task in done, "watchdog_loop hung"
    assert calls == 1
    assert task.exception() is None


async def test_watchdog_loop_survives_readmit_reader_error(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """One task cannot end the others: a reader that raises (a contract break) must not stop
    the loop, and the next pass still runs the reader and the trade-read sweep."""
    import main_worker

    shutdown = asyncio.Event()
    monkeypatch.setattr(main_worker, "SHUTDOWN", shutdown)
    reader_calls = 0
    sweep_calls = 0

    async def _noop() -> None:
        return None

    async def _sweep() -> None:
        nonlocal sweep_calls
        sweep_calls += 1

    async def _reader() -> int:
        nonlocal reader_calls
        reader_calls += 1
        if reader_calls == 1:
            raise RuntimeError("fixture: reader blew up")
        shutdown.set()
        return 0

    monkeypatch.setattr(main_worker, "watchdog_tick", _noop)
    monkeypatch.setattr(main_worker, "report_orphaned_capped_reconstructs", _noop)
    monkeypatch.setattr(main_worker, "sweep_expired_trade_reads", _sweep)
    monkeypatch.setattr(main_worker, "page_readmit_exhaustions", _reader)
    caplog.set_level(logging.ERROR)

    task = asyncio.create_task(main_worker.watchdog_loop(interval=0.01))
    done, pending = await asyncio.wait({task}, timeout=3.0)
    for p in pending:
        p.cancel()

    assert task in done, "watchdog_loop hung"
    assert reader_calls >= 2, f"the reader ran {reader_calls} time(s); its failure stopped the loop"
    assert sweep_calls >= 2
    assert task.exception() is None
    guard = [
        r for r in caplog.records if getattr(r, "event_type", None) == "readmit_ceiling_loop_guard"
    ]
    assert len(guard) >= 1
