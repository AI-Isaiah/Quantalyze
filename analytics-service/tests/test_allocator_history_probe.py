"""Phase 167.2.1.1.2.1 TRADEPAGES plan 05 - tests for ``scripts/allocator_history_probe.py``.

The probe is the D-03 measurement, run once on the Railway worker after the fixed
trade loop is deployed: for each OKX- or Bybit-backed allocator account it re-reads
the rebuild's own window through the rebuild's own read (``_fetch_and_price_window``),
compares the result with the stored history, and prints counts and sizes only. It
also measures, live, whether OKX answers fills newest first (RESEARCH A1), because
plan 06 will not rebuild anything while that is unproven. These tests prove the probe
can SEE each fact on fakes, can only READ, and can only PRINT labels, counts,
booleans and 3-significant-figure ratios. Nothing here touches a venue or a database:
the venue is a stub, the database a filtering fake, and the rebuild's read is a stub
that drives the venue's ``fetch_my_trades`` the way the real loop does.

Why each group matters (Rule 9):
  * run() end to end (tracer): the probe is a one-shot on a live worker, and its
    output decides whether plan 06 may rebuild PROD histories. A wiring bug (a wrong
    filter, a window that is not the rebuild's, a stored read of another allocator's
    rows, a count taken from the wrong call) is only discovered on the worker, where a
    second attempt costs a founder step.
  * OKX ordering: if OKX answers oldest first, the backward walk plan 02 builds reads
    the wrong end of the window and a rebuild would store a wrong curve as correct.
  * read-only: the keys are live and the database is PROD. The price-cache write
    hidden inside ``_fetch_and_price_window``, the 429 stamp and the preflight breaker
    are all writes the probe must make unreachable, and the pin must be able to fail.
  * redaction: the output is pasted into a tracked file in a public repo. An amount,
    an id or a venue message there is a disclosure.
  * refuse before decrypt and fail loud: one revoked key must be recorded by class
    (never by message) while the other accounts are still measured.
"""
from __future__ import annotations

import asyncio
import json
import re
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

import scripts.allocator_history_probe as hp
from services import equity_reconstruction as er

_PROBE_SRC = Path(hp.__file__).read_text(encoding="utf-8")

_TODAY = date(2026, 10, 23)

# Distinctive values, so a substring search for one in the output cannot be confused
# with a count or a ratio's digits.
_USER_ONE = "fake-user-id-one"
_USER_TWO = "fake-user-id-two"
_KEY_BYBIT = "fake-key-id-bybit"
_KEY_OKX = "fake-key-id-okx"
_KEY_MT5 = "fake-key-id-mt5"
_CIPHER = "planted-cipher-text-zzz"
_BASE_VALUE = 7777.25  # a rebuilt day i is worth _BASE_VALUE + 100.5 * i
_STEP_VALUE = 100.5
_OTHER_USER_VALUE = 3141.5927


def _ms(day: date) -> int:
    from datetime import datetime, timezone

    return int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp() * 1000)


def _key_row(
    key_id: str, user_id: str, exchange: str, created_at: str, **overrides: Any
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": key_id,
        "user_id": user_id,
        "exchange": exchange,
        "is_active": True,
        "sync_status": None,
        "disconnected_at": None,
        "venue_account_id": f"acct-{key_id}",
        "account_share_kind": None,
        "account_shared_with_api_key_id": None,
        "created_at": created_at,
        "api_key_encrypted": _CIPHER,
        "api_secret_encrypted": _CIPHER,
    }
    row.update(overrides)
    return row


def _trade_page(tag: str, count: int, *, newest_ms: int, step_ms: int = 60_000) -> list[dict[str, Any]]:
    """``count`` synthetic trades, newest first, with distinct ids."""
    return [
        {"id": f"fake-trade-{tag}-{i}", "timestamp": newest_ms - i * step_ms} for i in range(count)
    ]


def _window_rows(end_date: date, days: int = 8) -> list[dict[str, Any]]:
    return [
        {
            "asof": (end_date - timedelta(days=i)).isoformat(),
            "value_usd": _BASE_VALUE + _STEP_VALUE * i,
            "breakdown": None,
            "source": "exchange_primary",
            "pre_terminus_balance_unknown": False,
        }
        for i in range(days)
    ]


# ---------------------------------------------------------------------------
# Fakes: a filtering database, a stub venue, and the services run() reaches for.
# ---------------------------------------------------------------------------


class _FakeQuery:
    """Applies the filters it is given, so a wrong filter in the probe is visible."""

    def __init__(self, table: str, data: list[dict[str, Any]], owner: "_FakeSupabase") -> None:
        self._table = table
        self._data = data
        self._owner = owner
        self._filters: list[Any] = []
        self._order: str | None = None
        self._columns: list[str] | None = None

    def select(self, columns: str = "*", **_k: Any) -> "_FakeQuery":
        self._owner.log.append(f"select:{self._table}:{columns}")
        if columns.strip() != "*":
            self._columns = [c.strip() for c in columns.split(",")]
        return self

    def eq(self, column: str, value: Any) -> "_FakeQuery":
        self._owner.log.append(f"eq:{self._table}:{column}")
        self._filters.append(lambda r: r.get(column) == value)
        return self

    def in_(self, column: str, values: list[Any]) -> "_FakeQuery":
        self._owner.log.append(f"in:{self._table}:{column}")
        self._filters.append(lambda r: r.get(column) in values)
        return self

    def gte(self, column: str, value: Any) -> "_FakeQuery":
        self._owner.log.append(f"gte:{self._table}:{column}")
        self._filters.append(lambda r: str(r.get(column)) >= str(value))
        return self

    def order(self, column: str, **_k: Any) -> "_FakeQuery":
        self._order = column
        return self

    def execute(self) -> Any:
        out = [dict(r) for r in self._data if all(f(r) for f in self._filters)]
        if self._order is not None:
            out.sort(key=lambda r: str(r.get(self._order)))
        if self._columns is not None:
            out = [{c: r.get(c) for c in self._columns} for r in out]
        return SimpleNamespace(data=out)

    # Writers: present on the fake so that a probe that reaches one RECORDS it
    # (and the test fails) instead of dying on an AttributeError that hides it.
    def insert(self, *_a: Any, **_k: Any) -> "_FakeQuery":
        self._owner.writes.append(f"insert:{self._table}")
        return self

    def update(self, *_a: Any, **_k: Any) -> "_FakeQuery":
        self._owner.writes.append(f"update:{self._table}")
        return self

    def upsert(self, *_a: Any, **_k: Any) -> "_FakeQuery":
        self._owner.writes.append(f"upsert:{self._table}")
        return self

    def delete(self, *_a: Any, **_k: Any) -> "_FakeQuery":
        self._owner.writes.append(f"delete:{self._table}")
        return self


class _FakeSupabase:
    def __init__(self, tables: dict[str, list[dict[str, Any]]]) -> None:
        self._tables = tables
        self.log: list[str] = []
        self.writes: list[str] = []
        self.tables_touched: list[str] = []

    def table(self, name: str) -> _FakeQuery:
        self.tables_touched.append(name)
        return _FakeQuery(name, self._tables[name], self)

    def rpc(self, name: str, *_a: Any, **_k: Any) -> _FakeQuery:
        self.writes.append(f"rpc:{name}")
        return _FakeQuery("rpc", [], self)


class _StubVenue:
    """A venue client. ``fetch_my_trades`` pops one prepared page per call."""

    def __init__(
        self,
        pages: list[list[dict[str, Any]]] | None = None,
        *,
        order_raw: Any = None,
        fetch_effect: BaseException | None = None,
        hang: bool = False,
    ) -> None:
        self.pages = [list(p) for p in (pages or [])]
        self.page_count = len(self.pages)
        self._order_raw = order_raw
        self._fetch_effect = fetch_effect
        self._hang = hang
        self.raw_calls: list[dict[str, Any]] = []
        self.close_calls = 0

    async def fetch_my_trades(
        self, symbol: Any = None, since: Any = None, limit: Any = None, params: Any = None
    ) -> list[dict[str, Any]]:
        if self._hang:
            await asyncio.Event().wait()
        if self._fetch_effect is not None:
            raise self._fetch_effect
        return self.pages.pop(0) if self.pages else []

    async def private_get_trade_fills_history(self, params: dict[str, Any]) -> Any:
        self.raw_calls.append(dict(params))
        return self._order_raw

    async def close(self) -> None:
        self.close_calls += 1


class _Services:
    """Everything run() reaches for, patched in one place and recorded."""

    def __init__(
        self,
        tables: dict[str, list[dict[str, Any]]],
        clients: list[_StubVenue],
        *,
        window: tuple[date, int] | None = None,
    ) -> None:
        self.supabase = _FakeSupabase(tables)
        self.clients = list(clients)
        self.window = window
        self.decrypt_calls: list[Any] = []
        self.built_for: list[str] = []
        self.closed: list[Any] = []
        self.read_args: list[SimpleNamespace] = []
        self.window_rows_days = 8
        self.reader: Any = self._default_reader

    async def _default_reader(
        self,
        exchange: _StubVenue,
        venue: str,
        supabase: Any,
        start_date: date,
        end_date: date,
        *,
        require_anchor: bool = False,
    ) -> tuple[list[dict[str, Any]], bool, dict[str, Any]]:
        params: dict[str, Any] = {"type": "swap"} if venue == "okx" else {}
        for _ in range(exchange.page_count):
            await exchange.fetch_my_trades(None, _ms(start_date), 500, dict(params))
        return _window_rows(end_date, self.window_rows_days), False, {}

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def _db_execute(fn: Any) -> Any:
            return fn()

        def _decrypt(row: dict[str, Any], _kek: bytes) -> tuple[str, str, None]:
            self.decrypt_calls.append(row.get("id"))
            return ("fake-k", "fake-s", None)

        def _make_client(exchange_name: str, *_a: Any) -> _StubVenue:
            self.built_for.append(exchange_name)
            return self.clients[len(self.built_for) - 1]

        async def _aclose(exchange: Any) -> None:
            self.closed.append(exchange)

        async def _read(
            exchange: Any, venue: str, supabase: Any, start: date, end: date, **kw: Any
        ) -> Any:
            self.read_args.append(
                SimpleNamespace(
                    venue=venue,
                    start=start,
                    end=end,
                    require_anchor=kw.get("require_anchor"),
                    wrapped=isinstance(supabase, hp.ReadOnlySupabase),
                )
            )
            return await self.reader(exchange, venue, supabase, start, end, **kw)

        monkeypatch.setattr(hp, "_utc_today", lambda: _TODAY)
        monkeypatch.setattr("services.db.get_supabase", lambda: self.supabase)
        monkeypatch.setattr("services.db.db_execute", _db_execute)
        monkeypatch.setattr("services.equity_reconstruction.db_execute", _db_execute)
        monkeypatch.setattr("services.encryption.get_kek", lambda: b"fake-kek")
        monkeypatch.setattr("services.encryption.decrypt_credentials", _decrypt)
        monkeypatch.setattr("services.job_worker._make_exchange_client", _make_client)
        monkeypatch.setattr("services.exchange.aclose_exchange", _aclose)
        monkeypatch.setattr("services.equity_reconstruction._fetch_and_price_window", _read)
        if self.window is not None:
            fixed = self.window
            monkeypatch.setattr(
                "services.equity_reconstruction._account_rebuild_window",
                lambda _selected, _end: fixed,
            )


def _stdout_records(capsys: pytest.CaptureFixture[str]) -> list[dict[str, Any]]:
    out = capsys.readouterr().out
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def _two_account_book() -> dict[str, list[dict[str, Any]]]:
    """Account one: a working Bybit key, six stored in-window days (two of them 1.0 away
    from what the read returns), one stored day outside any window, and another
    allocator's rows on the same days. Account two: an OKX key plus an MT5 key."""
    stored: list[dict[str, Any]] = []
    for i in range(6):
        value = _BASE_VALUE + _STEP_VALUE * i + (1.0 if i in (1, 3) else 0.0)
        stored.append(
            {
                "allocator_id": _USER_ONE,
                "asof": (_TODAY - timedelta(days=i)).isoformat(),
                "value_usd": value,
            }
        )
    stored.append({"allocator_id": _USER_ONE, "asof": "2020-01-01", "value_usd": 1.0})
    for i in range(6):
        stored.append(
            {
                "allocator_id": _USER_TWO,
                "asof": (_TODAY - timedelta(days=i)).isoformat(),
                "value_usd": _OTHER_USER_VALUE,
            }
        )
    return {
        "api_keys": [
            _key_row(_KEY_BYBIT, _USER_ONE, "bybit", "2026-01-01T00:00:00Z"),
            _key_row(_KEY_OKX, _USER_TWO, "okx", "2026-02-01T00:00:00Z"),
            _key_row(_KEY_MT5, _USER_TWO, "mt5", "2026-02-02T00:00:00Z"),
        ],
        "allocator_equity_snapshots": stored,
    }


# ---------------------------------------------------------------------------
# Tracer: run() end to end on fakes (D-03, SC-3).
# ---------------------------------------------------------------------------


async def test_run_end_to_end_prints_one_record_per_account_and_a_summary(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    bybit = _StubVenue(
        [
            _trade_page("by", 100, newest_ms=_ms(_TODAY)),
            _trade_page("by2", 100, newest_ms=_ms(_TODAY) - 10**9),
            _trade_page("by3", 37, newest_ms=_ms(_TODAY) - 2 * 10**9),
        ]
    )
    okx = _StubVenue(
        [
            _trade_page("ok", 100, newest_ms=_ms(_TODAY)),
            _trade_page("ok2", 20, newest_ms=_ms(_TODAY) - 10**9),
        ]
    )
    window = (_TODAY - timedelta(days=20), 21)
    services = _Services(_two_account_book(), [bybit, okx], window=window)
    services.install(monkeypatch)

    code = await hp.run()

    captured = capsys.readouterr()
    lines = [line for line in captured.out.splitlines() if line.strip()]
    assert code == 0
    assert len(lines) == 3 and all(line.startswith('{"') for line in lines)
    a1, a2, summary = (json.loads(line) for line in lines)

    assert a1["record"] == "account" and a1["account"] == "a1"  # the earliest key first
    assert a1["selection"] == "ok"
    assert (a1["bybit_members"], a1["okx_members"], a1["other_members"]) == (1, 0, 0)
    assert a1["zero_contribution_members"] == 0
    assert a1["window_days"] == 21  # the rebuild's own window, not one the probe invented
    assert (a1["members_read"], a1["members_failed"]) == (1, 0)
    assert a1["failure_class"] == "none" and a1["member_refusal"] == "none"
    assert a1["trade_calls"] == 3
    assert a1["trades_read"] == 237
    assert a1["first_page_rows"] == 100  # what the old loop kept: one page
    assert a1["comparable"] is True
    assert a1["stored_days"] == 6  # the 2020 row and the other allocator's rows are not counted
    assert a1["rebuilt_days"] == 8
    assert a1["days_compared"] == 6
    assert a1["days_differing"] == 2
    assert a1["max_rel_diff"] == pytest.approx(0.000127)  # 1.0 / 7878.75, to 3 figures
    assert a1["days_incomplete"] == 0

    assert a2["account"] == "a2" and a2["selection"] == "ok"
    assert (a2["okx_members"], a2["bybit_members"], a2["other_members"]) == (1, 0, 1)
    assert a2["comparable"] is False  # an MT5 member is not read
    assert (a2["members_read"], a2["members_failed"]) == (1, 0)
    assert a2["trade_calls"] == 2 and a2["trades_read"] == 120 and a2["first_page_rows"] == 100
    assert (a2["days_compared"], a2["days_differing"]) == (0, 0)
    assert a2["max_rel_diff"] == "field-absent"

    assert summary == {
        "record": "summary",
        "run_date": "2026-10-23",
        "accounts": 2,
        "accounts_read": 2,
        "accounts_comparable": 1,
        "accounts_trades_beyond_first_page": 2,
        "accounts_differing": 1,
        # The totals that tell "no difference" from "compared nothing" or "read nothing".
        "trades_read": 357,
        "days_compared": 6,
        "okx_order_violations": 0,
        "okx_passes_ended_full": 0,
    }

    # The read is the rebuild's own: every member through the wrapper, anchored, over the
    # window the rebuild would use, ending today.
    assert [(a.venue, a.start, a.end, a.require_anchor, a.wrapped) for a in services.read_args] == [
        ("bybit", window[0], _TODAY, True, True),
        ("okx", window[0], _TODAY, True, True),
    ]
    # Only the two OKX / Bybit members were decrypted and built; the MT5 member never was.
    assert services.decrypt_calls == [_KEY_BYBIT, _KEY_OKX]
    assert services.built_for == ["bybit", "okx"]
    assert services.closed == [bybit, okx]
    # One compared read of the stored history, for the one comparable account only.
    assert [e for e in services.supabase.log if e.startswith("select:allocator_equity_snapshots")] == [
        "select:allocator_equity_snapshots:asof, value_usd"
    ]
    assert services.supabase.writes == []

    # Nothing identifying or amount-bearing reached stdout or stderr.
    everything = captured.out + captured.err
    for leak in (
        _USER_ONE,
        _USER_TWO,
        _KEY_BYBIT,
        _KEY_OKX,
        _KEY_MT5,
        _CIPHER,
        "fake-k",
        "fake-s",
        "fake-trade",
        "7777",
        "7878",
        "3141",
    ):
        assert leak not in everything, leak
    assert not re.search(r"\d{2}:\d{2}:\d{2}", everything)


# ---------------------------------------------------------------------------
# OKX ordering and the full-page stop (RESEARCH A1, Task 2).
# ---------------------------------------------------------------------------


def _fills(*stamps: Any) -> dict[str, Any]:
    """A raw OKX fills-history answer carrying these ``ts`` values, in this order."""
    return {"code": "0", "msg": "", "data": [{"ts": s, "tradeId": f"fake-fill-{i}"} for i, s in enumerate(stamps)]}


def test_okx_order_reads_newest_first_from_the_raw_fills() -> None:
    # The backward walk plan 02 builds is only right if OKX answers newest first.
    assert hp.okx_newest_first(_fills("300", "200", "100")) is True
    assert hp.okx_newest_first(_fills("300", "300", "100")) is True  # ties never rise
    assert hp.okx_newest_first(_fills("100", "200", "300")) is False  # oldest first
    assert hp.okx_newest_first(_fills("300", "100", "200")) is False  # rises anywhere
    assert hp.okx_newest_first(_fills(300, 200)) is True  # a numeric ts is read too
    # The answer cannot say: never a guess, never False.
    absent = "field-absent"
    assert hp.okx_newest_first(_fills("300")) == absent  # fewer than two rows
    assert hp.okx_newest_first(_fills()) == absent
    assert hp.okx_newest_first(_fills("200", "200", "200")) == absent  # equal throughout
    assert hp.okx_newest_first(_fills("300", "soon")) == absent  # a non-numeric ts
    assert hp.okx_newest_first(_fills("300", None)) == absent
    assert hp.okx_newest_first(["not", "a", "mapping"]) == absent
    assert hp.okx_newest_first(None) == absent
    assert hp.okx_newest_first({"code": "0", "data": "nope"}) == absent


def _okx_two_pass_reader(services: _Services) -> Any:
    """An OKX read with a spot pass (one short page) and a swap pass (a full page, then a
    short one): the swap pass returned the most rows."""

    async def _read(
        exchange: _StubVenue, venue: str, supabase: Any, start: date, end: date, **_k: Any
    ) -> Any:
        since = _ms(start)
        for kind in ("spot", "swap", "swap"):
            await exchange.fetch_my_trades(None, since, 500, {"type": kind})
        return _window_rows(end), False, {}

    return _read


def _okx_only_book() -> dict[str, list[dict[str, Any]]]:
    return {
        "api_keys": [_key_row(_KEY_OKX, _USER_ONE, "okx", "2026-02-01T00:00:00Z")],
        "allocator_equity_snapshots": [],
    }


async def test_one_raw_order_read_per_okx_member_on_its_busiest_inst_type(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    pages = [
        _trade_page("sp", 30, newest_ms=_ms(_TODAY)),
        _trade_page("sw1", 100, newest_ms=_ms(_TODAY)),
        _trade_page("sw2", 40, newest_ms=_ms(_TODAY) - 10**9),
    ]
    descending = _StubVenue(pages, order_raw=_fills("300", "200", "100"))
    window = (_TODAY - timedelta(days=20), 21)
    services = _Services(_okx_only_book(), [descending], window=window)
    services.reader = _okx_two_pass_reader(services)
    services.install(monkeypatch)

    assert await hp.run() == 0
    account, summary = _stdout_records(capsys)

    assert descending.raw_calls == [
        {
            "instType": "SWAP",  # the pass that returned the most rows, not the first pass
            "begin": str(_ms(window[0])),  # spanning the window the rebuild reads
            "end": str(_ms(_TODAY + timedelta(days=1))),
            "limit": "100",
        }
    ]
    assert (account["okx_order_readings"], account["okx_order_violations"]) == (1, 0)
    assert summary["okx_order_violations"] == 0

    # An OKX that answers oldest first is counted as a violation, per account and in total.
    ascending = _StubVenue([list(p) for p in pages], order_raw=_fills("100", "200", "300"))
    services = _Services(_okx_only_book(), [ascending], window=window)
    services.reader = _okx_two_pass_reader(services)
    services.install(monkeypatch)
    assert await hp.run() == 0
    account, summary = _stdout_records(capsys)
    assert (account["okx_order_readings"], account["okx_order_violations"]) == (1, 1)
    assert summary["okx_order_violations"] == 1

    # An answer that cannot say is not a reading at all.
    unreadable = _StubVenue([list(p) for p in pages], order_raw=_fills("300"))
    services = _Services(_okx_only_book(), [unreadable], window=window)
    services.reader = _okx_two_pass_reader(services)
    services.install(monkeypatch)
    assert await hp.run() == 0
    account, summary = _stdout_records(capsys)
    assert (account["okx_order_readings"], account["okx_order_violations"]) == (0, 0)


async def test_no_raw_order_read_for_a_bybit_member_or_an_okx_member_that_read_nothing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    bybit = _StubVenue([_trade_page("by", 5, newest_ms=_ms(_TODAY))], order_raw=_fills("100", "200"))
    quiet_okx = _StubVenue([], order_raw=_fills("100", "200"))
    book = {
        "api_keys": [
            _key_row(_KEY_BYBIT, _USER_ONE, "bybit", "2026-01-01T00:00:00Z"),
            _key_row(_KEY_OKX, _USER_TWO, "okx", "2026-02-01T00:00:00Z"),
        ],
        "allocator_equity_snapshots": [],
    }
    services = _Services(book, [bybit, quiet_okx])
    services.install(monkeypatch)

    assert await hp.run() == 0
    a1, a2, summary = _stdout_records(capsys)
    assert bybit.raw_calls == [] and quiet_okx.raw_calls == []
    assert (a1["okx_order_readings"], a2["okx_order_readings"]) == (0, 0)
    assert summary["okx_order_violations"] == 0


def _call(rows: int, oldest_ts: int | None, since: int | None, kind: str = "swap") -> Any:
    return hp._Call(
        since=since,
        params={"type": kind},
        rows=rows,
        ids=tuple((f"FAKE-{kind}", f"fake-id-{kind}-{i}") for i in range(rows)),
        rows_without_id=0,
        oldest_ts=oldest_ts,
    )


def test_an_okx_pass_that_ends_on_a_full_page_is_counted() -> None:
    # A full last page whose oldest row is newer than the call's since: older rows unread.
    assert hp.okx_passes_ended_full([_call(100, oldest_ts=5_000, since=1_000)]) == 1
    # A full page that reaches its since, a short page, an empty page: the pass finished.
    assert hp.okx_passes_ended_full([_call(100, oldest_ts=1_000, since=1_000)]) == 0
    assert hp.okx_passes_ended_full([_call(100, oldest_ts=900, since=1_000)]) == 0
    assert hp.okx_passes_ended_full([_call(99, oldest_ts=5_000, since=1_000)]) == 0
    assert hp.okx_passes_ended_full([_call(0, oldest_ts=None, since=1_000)]) == 0
    # Only a pass's LAST call decides; an earlier full page that was followed on is fine.
    followed = [_call(100, oldest_ts=5_000, since=1_000), _call(12, oldest_ts=2_000, since=1_000)]
    assert hp.okx_passes_ended_full(followed) == 0
    # Passes are counted one by one.
    both = [
        _call(100, oldest_ts=5_000, since=1_000, kind="spot"),
        _call(100, oldest_ts=6_000, since=1_000, kind="swap"),
        _call(3, oldest_ts=2_000, since=1_000, kind="option"),
    ]
    assert hp.okx_passes_ended_full(both) == 2
    # Nothing to compare against is not a stop that was proven.
    assert hp.okx_passes_ended_full([_call(100, oldest_ts=None, since=1_000)]) == 0
    assert hp.okx_passes_ended_full([_call(100, oldest_ts=5_000, since=None)]) == 0


async def test_a_full_okx_page_reaches_the_account_record_and_the_summary(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    okx = _StubVenue([_trade_page("ok", 100, newest_ms=_ms(_TODAY))])
    services = _Services(_okx_only_book(), [okx], window=(_TODAY - timedelta(days=20), 21))
    services.install(monkeypatch)
    assert await hp.run() == 0
    account, summary = _stdout_records(capsys)
    assert account["okx_passes_ended_full"] == 1
    assert summary["okx_passes_ended_full"] == 1


class _StubVenueWithTransfers(_StubVenue):
    """A venue that also answers ``fetch_deposits`` / ``fetch_withdrawals`` with fixed rows."""

    def __init__(self, pages: list[list[dict[str, Any]]], *, deposits: Any, withdrawals: Any) -> None:
        super().__init__(pages)
        self.deposits = deposits
        self.withdrawals = withdrawals

    async def fetch_deposits(
        self, code: Any = None, since: Any = None, limit: Any = None, params: Any = None
    ) -> list[dict[str, Any]]:
        return list(self.deposits)

    async def fetch_withdrawals(
        self, code: Any = None, since: Any = None, limit: Any = None, params: Any = None
    ) -> list[dict[str, Any]]:
        return list(self.withdrawals)


async def test_transfer_events_older_than_365_days_are_counted_per_account(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # WR-03: the 729-day Bybit window reaches a transfer read whose depth past 365 days is
    # unmeasured. The re-read's own transfer calls are recorded, and the probe prints how
    # many events it saw stamped before the run date minus 365 days, as a count.
    cutoff = _ms(_TODAY) - 365 * 24 * 60 * 60 * 1000
    deposits = [
        {"id": "fake-transfer-d1", "timestamp": cutoff - 1},
        {"id": "fake-transfer-d2", "timestamp": cutoff},  # exactly 365 days: not older
        {"id": "fake-transfer-d3", "timestamp": cutoff - 10**9},
    ]
    withdrawals = [{"id": "fake-transfer-d1", "timestamp": cutoff - 5}]  # same id, other kind
    bybit = _StubVenueWithTransfers(
        [_trade_page("by", 5, newest_ms=_ms(_TODAY))], deposits=deposits, withdrawals=withdrawals
    )
    book = {
        "api_keys": [_key_row(_KEY_BYBIT, _USER_ONE, "bybit", "2026-01-01T00:00:00Z")],
        "allocator_equity_snapshots": [],
    }
    services = _Services(book, [bybit], window=(_TODAY - timedelta(days=729), 730))

    async def _read(
        exchange: _StubVenueWithTransfers, venue: str, supabase: Any, start: date, end: date, **_k: Any
    ) -> Any:
        await exchange.fetch_my_trades(None, _ms(start), 500, {})
        for _ in range(2):  # two overlapping windows return the boundary rows again
            assert await exchange.fetch_deposits(None, 1, 500, {"until": 2}) == deposits
            assert await exchange.fetch_withdrawals(None, 1, 500, {"until": 2}) == withdrawals
        return _window_rows(end), False, {}

    services.reader = _read
    services.install(monkeypatch)

    assert await hp.run() == 0
    captured = capsys.readouterr()
    account = json.loads(captured.out.splitlines()[0])
    assert account["transfers_older_365d"] == 3  # d1 and d3 deposits, d1 withdrawal; d2 is not older
    assert "fake-transfer" not in captured.out + captured.err


async def test_the_rebuilds_own_transfer_read_is_what_the_recorder_sees() -> None:
    # The recorder must catch the calls ``fetch_ccxt_transfers`` really makes (it looks the
    # fetcher up on the client at call time), not only calls a test makes by hand.
    cutoff = _ms(_TODAY) - 365 * 24 * 60 * 60 * 1000
    venue = _StubVenueWithTransfers(
        [],
        deposits=[{"id": "fake-transfer-d1", "timestamp": cutoff - 1}],
        withdrawals=[{"id": "fake-transfer-w1", "timestamp": cutoff + 1}],
    )
    recorder = hp._TradeRecorder(venue)
    from services.ccxt_flow_fetch import fetch_ccxt_transfers

    await fetch_ccxt_transfers(venue, "deposits", cutoff - 10**9, cutoff + 10**9)
    await fetch_ccxt_transfers(venue, "withdrawals", cutoff - 10**9, cutoff + 10**9)
    assert hp.transfers_older_than(recorder.transfers, cutoff) == 1


async def test_a_venue_without_transfer_fetchers_reads_zero_old_transfers(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    bybit = _StubVenue([_trade_page("by", 5, newest_ms=_ms(_TODAY))])
    book = {
        "api_keys": [_key_row(_KEY_BYBIT, _USER_ONE, "bybit", "2026-01-01T00:00:00Z")],
        "allocator_equity_snapshots": [],
    }
    services = _Services(book, [bybit])
    services.install(monkeypatch)
    assert await hp.run() == 0
    assert _stdout_records(capsys)[0]["transfers_older_365d"] == 0
    assert not hasattr(bybit, "fetch_deposits")  # the probe adds no method the venue lacks


# ---------------------------------------------------------------------------
# Read-only wrapper and source-level safety (T-167.2.1.1.2.1-11).
# ---------------------------------------------------------------------------


def test_read_only_wrapper_exposes_select_and_nothing_else() -> None:
    fake = _FakeSupabase({"api_keys": [{"id": "fake-row"}]})
    wrapper = hp.ReadOnlySupabase(fake)

    # select is the one thing a table handle does, and it reaches the real table.
    assert wrapper.table("api_keys").select("*").execute().data == [{"id": "fake-row"}]

    for name in ("rpc", "auth", "storage", "from_", "postgrest", "functions"):
        with pytest.raises(AttributeError):
            getattr(wrapper, name)
    table = wrapper.table("api_keys")
    for name in ("insert", "update", "upsert", "delete", "rpc"):
        with pytest.raises(AttributeError):
            getattr(table, name)
    assert fake.writes == []


async def test_read_only_wrapper_turns_the_hidden_price_cache_write_into_a_caught_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``_fetch_and_price_window`` upserts into ``token_price_history`` on a BadSymbol
    fallback and swallows any failure of that write. Through the wrapper the write cannot
    happen, and the rebuild's own read still completes."""

    async def _db_execute(fn: Any) -> Any:
        return fn()

    monkeypatch.setattr("services.equity_reconstruction.db_execute", _db_execute)
    fake = _FakeSupabase({"token_price_history": []})

    await er._cache_coingecko_prices(hp.ReadOnlySupabase(fake), "XYZ", [("2026-01-01", 1.0)])
    assert fake.writes == []

    # Control: the same call on the bare client DOES write, so the assertion above can fail.
    await er._cache_coingecko_prices(fake, "XYZ", [("2026-01-01", 1.0)])
    assert fake.writes == ["upsert:token_price_history"]


_FORBIDDEN_NAMES = (
    "_allocator_key_preflight",
    "_crawl_account_key",
    "_crawl_whole_account",
    "_stamp_429",
    "replace_equity_snapshots",
    "replace_equity_snapshots_window",
    "persist_equity_snapshots",
)


def _code_names(source: str) -> set[str]:
    """Every name the probe's CODE uses (docstrings and comments excluded)."""
    import ast

    names: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Name):
            names.add(node.id)
        elif isinstance(node, ast.Attribute):
            names.add(node.attr)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            names.update(alias.name.split(".")[-1] for alias in node.names)
    return names


def test_the_probe_source_calls_no_writer() -> None:
    for write in (".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "enqueue"):
        assert write not in _PROBE_SRC, write
    for name in _FORBIDDEN_NAMES:
        assert f"{name}(" not in _PROBE_SRC, name
    # A reference that is not a call (an alias, a callback) is as good as a call.
    assert not set(_FORBIDDEN_NAMES) & _code_names(_PROBE_SRC)


def test_the_probe_source_calls_no_venue_write() -> None:
    assert not re.search(r"\b(create_order|cancel_order|withdraw|transfer)\(", _PROBE_SRC)
    # The one venue call outside the rebuild's own read is a raw GET.
    assert "private_get_trade_fills_history(" in _PROBE_SRC
    assert not re.search(r"\bprivate_(post|put|delete)_", _PROBE_SRC)


def test_the_probe_names_only_the_two_tables_it_reads() -> None:
    literal = re.findall(r'\.table\(\s*"([a-z_]+)"\s*\)', _PROBE_SRC)
    assert sorted(literal) == ["allocator_equity_snapshots", "api_keys"]
    # The only other .table( is the wrapper's own delegation.
    assert _PROBE_SRC.count(".table(") == len(literal) + 1


def test_every_database_handle_the_probe_passes_on_is_the_wrapper() -> None:
    import ast

    tree = ast.parse(_PROBE_SRC)
    # The one real client is wrapped at its birth, and nowhere else is it obtained.
    assert _PROBE_SRC.count("get_supabase(") == 1
    assert "ReadOnlySupabase(get_supabase())" in _PROBE_SRC
    # Every function that takes a database handle types it as the wrapper.
    holders = [
        arg
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        for arg in node.args.args
        if arg.arg == "supabase"
    ]
    assert len(holders) >= 3
    for arg in holders:
        assert isinstance(arg.annotation, ast.Name) and arg.annotation.id == "ReadOnlySupabase"


# ---------------------------------------------------------------------------
# The emitter and redaction.
# ---------------------------------------------------------------------------


def test_the_emitter_refuses_a_key_or_a_value_outside_the_vocabulary() -> None:
    rec = hp._account_record("a1", "2026-10-23", trades_read=12, window_days=90)
    assert json.loads(hp.emit_record(rec))["trades_read"] == 12  # control: the honest record prints

    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, wallet_usd=9137.45))  # an extra key: a leaked amount
    missing = dict(rec)
    del missing["trades_read"]
    with pytest.raises(ValueError):
        hp.emit_record(missing)
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, max_rel_diff=0.123456))  # a float not rounded to 3 figures
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, comparable="true"))
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, trades_read=True))  # True where a count is declared
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, trades_read=1.0))
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, trades_read=-1))
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, account="user-1"))
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, account="a123"))
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, run_date="2026-10-23T10:30:15Z"))  # finer than the run date
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, record="other"))
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, failure_class="AuthenticationError: 4321.5"))
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, selection="not_a_token"))
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, member_refusal="anchor_unreadable_extra"))
    # A uuid or an amount-shaped string in a vocabulary slot.
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, selection="123e4567-e89b-12d3-a456-426614174000"))
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, window_days="4321.5"))

    summary = hp.summarize([rec], "2026-10-23")
    hp.emit_record(summary)  # control
    with pytest.raises(ValueError):
        hp.emit_record(dict(summary, accounts=True))
    with pytest.raises(ValueError):
        hp.emit_record(dict(summary, balance=1.5))

    # The refusal names the key, never the offending value.
    with pytest.raises(ValueError) as exc:
        hp.emit_record(dict(rec, failure_class="boom 4321.5"))
    assert "4321.5" not in str(exc.value)
    assert "failure_class" in str(exc.value)


def test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens() -> None:
    for token in sorted(er.FORCED_REBUILD_REFUSAL_REASONS):
        hp.emit_record(hp._account_record("a1", "2026-10-23", selection=token))
        hp.emit_record(hp._account_record("a1", "2026-10-23", member_refusal=token))
    assert set(hp.ACCOUNT_RECORD_KEYS) == set(hp._account_record("a1", "2026-10-23"))
    assert hp.sig3(0.123456) == 0.123


# ---------------------------------------------------------------------------
# Pure measurements.
# ---------------------------------------------------------------------------


def test_trades_read_counts_distinct_ids_and_each_row_without_one() -> None:
    first = hp._Call(
        since=1, params={}, rows=3, ids=((None, "a"), (None, "b"), (None, "c")), rows_without_id=0, oldest_ts=1
    )
    again = hp._Call(
        since=2, params={}, rows=3, ids=((None, "c"), (None, "d")), rows_without_id=1, oldest_ts=2
    )
    assert hp.trades_read([first, again]) == 4 + 1  # a, b, c, d and the one row with no id
    assert hp.trades_read([]) == 0


def test_trades_read_keys_a_fill_on_symbol_and_id_not_on_the_id_alone() -> None:
    # OKX numbers ``tradeId`` per instrument, so two different fills on two instruments
    # can carry the same id. The probe is the D-03 measurement: if it collapses them it
    # reports fewer trades than the venue holds and cannot see the loss it exists to find.
    page = [
        {"id": "00001", "symbol": "BTC-USDT-SWAP", "timestamp": 3},
        {"id": "00001", "symbol": "ETH-USDT-SWAP", "timestamp": 2},
        {"id": "00002", "symbol": "BTC-USDT-SWAP", "timestamp": 1},
    ]
    call = hp._describe_call((None, 1, 100, {}), {}, page)
    assert hp.trades_read([call]) == 3
    # The same fill re-read on an overlapping page is still one fill.
    again = hp._describe_call((None, 1, 100, {}), {}, page[:2])
    assert hp.trades_read([call, again]) == 3


def test_first_page_rows_is_what_the_old_loop_kept() -> None:
    def call(rows: int, kind: str | None, **extra: Any) -> Any:
        params: dict[str, Any] = {} if kind is None else {"type": kind}
        params.update(extra)
        return hp._Call(since=1, params=params, rows=rows, ids=(), rows_without_id=0, oldest_ts=None)

    # Bybit: the first call only.
    assert hp.first_page_rows("bybit", [call(100, None), call(100, None), call(7, None)]) == 100
    assert hp.first_page_rows("bybit", []) == 0
    # OKX: each pass's call without ``until``, summed.
    okx = [
        call(30, "spot"),
        call(100, "swap"),
        call(100, "swap", until=5),
        call(0, "option"),
    ]
    assert hp.first_page_rows("okx", okx) == 130
    # A pass that only has calls carrying ``until`` falls back to its first call.
    assert hp.first_page_rows("okx", [call(40, "swap", until=5), call(9, "swap", until=4)]) == 40


def test_days_are_compared_by_the_rebuild_convention_and_zero_is_not_a_divisor() -> None:
    stored = {"d1": 0.0, "d2": 10.0, "d3": 5.0, "only-stored": 1.0}
    rebuilt = {"d1": 0.005, "d2": 10.006, "d3": 5.0, "only-rebuilt": 1.0}
    compared, differing, largest = hp.compare_days(stored, rebuilt)
    assert compared == 3
    assert differing == 1  # 0.005 is not above the 0.005 line; 0.006 is
    assert largest == 0.0006  # 0.006 / 10, never 0.005 / 0
    assert hp.compare_days({"d1": 0.0}, {"d1": 0.0}) == (1, 0, "field-absent")
    assert hp.compare_days({}, {"d1": 1.0}) == (0, 0, "field-absent")


def test_the_job_key_is_the_earliest_working_bybit_key_else_okx_else_the_earliest() -> None:
    def key(key_id: str, exchange: str, **over: Any) -> dict[str, Any]:
        return _key_row(key_id, _USER_ONE, exchange, "2026-01-01T00:00:00Z", **over)

    okx_early = key("okx-early", "okx")
    bybit_revoked = key("bybit-revoked", "bybit", sync_status="revoked")
    bybit_late = key("bybit-late", "bybit")
    okx_revoked = key("okx-revoked", "okx", sync_status="sign_in_failed")
    assert hp.choose_job_key([okx_early, bybit_revoked, bybit_late]) == "bybit-late"
    assert hp.choose_job_key([bybit_revoked, okx_early]) == "okx-early"
    assert hp.choose_job_key([okx_revoked, bybit_revoked]) == "okx-revoked"  # nothing works


# ---------------------------------------------------------------------------
# Selection, labels, comparability.
# ---------------------------------------------------------------------------


async def test_the_account_is_read_with_the_job_key_a_forced_rebuild_is_queued_on(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    book = {
        "api_keys": [
            _key_row(_KEY_OKX, _USER_ONE, "okx", "2026-01-01T00:00:00Z"),  # earlier, but OKX
            _key_row(_KEY_BYBIT, _USER_ONE, "bybit", "2026-03-01T00:00:00Z"),
        ],
        "allocator_equity_snapshots": [],
    }
    services = _Services(book, [_StubVenue(), _StubVenue()])
    services.install(monkeypatch)
    seen: list[tuple[str, str]] = []
    real = er._read_account_keys

    async def _spy(supabase: Any, allocator_id: str, job_key_id: str) -> Any:
        seen.append((allocator_id, job_key_id))
        return await real(supabase, allocator_id, job_key_id)

    monkeypatch.setattr("services.equity_reconstruction._read_account_keys", _spy)

    assert await hp.run() == 0
    assert seen == [(_USER_ONE, _KEY_BYBIT)]
    (account, _summary) = _stdout_records(capsys)
    assert (account["okx_members"], account["bybit_members"], account["members_read"]) == (1, 1, 2)


async def test_accounts_are_labelled_by_their_earliest_key_not_by_their_id(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    book = {
        "api_keys": [
            _key_row(_KEY_BYBIT, "zzz-user", "bybit", "2026-05-01T00:00:00Z"),
            _key_row(_KEY_OKX, "aaa-user", "okx", "2026-06-01T00:00:00Z"),
        ],
        "allocator_equity_snapshots": [],
    }
    services = _Services(book, [_StubVenue(), _StubVenue()])
    services.install(monkeypatch)
    assert await hp.run() == 0
    a1, a2, _summary = _stdout_records(capsys)
    assert (a1["bybit_members"], a1["okx_members"]) == (1, 0)  # the May Bybit key is a1
    assert (a2["bybit_members"], a2["okx_members"]) == (0, 1)
    assert services.decrypt_calls == [_KEY_BYBIT, _KEY_OKX]


async def test_a_deribit_exchange_account_counts_as_zero_and_does_not_block_the_comparison(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    stored = [
        {
            "allocator_id": _USER_ONE,
            "asof": (_TODAY - timedelta(days=i)).isoformat(),
            "value_usd": _BASE_VALUE + _STEP_VALUE * i,
        }
        for i in range(4)
    ]
    book = {
        "api_keys": [
            _key_row(_KEY_BYBIT, _USER_ONE, "bybit", "2026-01-01T00:00:00Z"),
            _key_row("fake-key-id-deribit", _USER_ONE, "deribit", "2026-01-02T00:00:00Z"),
        ],
        "allocator_equity_snapshots": stored,
    }
    services = _Services(book, [_StubVenue([_trade_page("by", 3, newest_ms=_ms(_TODAY))])])
    services.install(monkeypatch)
    assert await hp.run() == 0
    account, _summary = _stdout_records(capsys)
    assert account["zero_contribution_members"] == 1
    assert account["other_members"] == 0
    assert account["comparable"] is True
    assert (account["days_compared"], account["days_differing"]) == (4, 0)
    assert account["max_rel_diff"] == 0.0
    assert services.decrypt_calls == [_KEY_BYBIT]  # the Deribit key is never decrypted


# ---------------------------------------------------------------------------
# Refusal before any decrypt.
# ---------------------------------------------------------------------------


async def test_no_active_okx_or_bybit_key_refuses_before_any_decrypt(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    services = _Services({"api_keys": [], "allocator_equity_snapshots": []}, [])
    services.install(monkeypatch)
    assert await hp.run() == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.startswith("refused:")
    assert services.decrypt_calls == [] and services.built_for == []


async def test_more_accounts_than_the_label_carries_refuses_before_any_decrypt(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    keys = [
        _key_row(f"fake-key-{i:03d}", f"fake-user-{i:03d}", "bybit", f"2026-01-01T00:00:{i % 60:02d}Z")
        for i in range(100)
    ]
    services = _Services({"api_keys": keys, "allocator_equity_snapshots": []}, [])
    services.install(monkeypatch)
    assert await hp.run() == 2
    captured = capsys.readouterr()
    assert captured.out == "" and captured.err.startswith("refused:")
    assert services.decrypt_calls == []


async def test_a_selection_refusal_is_a_token_and_that_accounts_keys_are_never_decrypted(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    book = {
        "api_keys": [
            _key_row(_KEY_BYBIT, _USER_ONE, "bybit", "2026-01-01T00:00:00Z", sync_status="revoked"),
            _key_row(_KEY_OKX, _USER_TWO, "okx", "2026-02-01T00:00:00Z"),
        ],
        "allocator_equity_snapshots": [],
    }
    services = _Services(book, [_StubVenue([_trade_page("ok", 5, newest_ms=_ms(_TODAY))])])
    services.install(monkeypatch)

    assert await hp.run() == 0  # a refusal is a measurement, not a failure
    a1, a2, summary = _stdout_records(capsys)
    assert a1["selection"] == "account_key_not_working"
    assert (a1["members_read"], a1["trade_calls"], a1["window_days"]) == (0, 0, "field-absent")
    assert a2["selection"] == "ok" and a2["members_read"] == 1
    assert services.decrypt_calls == [_KEY_OKX]  # the revoked account was refused first
    assert summary["accounts"] == 2 and summary["accounts_read"] == 1


# ---------------------------------------------------------------------------
# Fail loud: one failed member does not hide the others, and nothing leaks.
# ---------------------------------------------------------------------------


def _two_user_book() -> dict[str, list[dict[str, Any]]]:
    return {
        "api_keys": [
            _key_row(_KEY_BYBIT, _USER_ONE, "bybit", "2026-01-01T00:00:00Z"),
            _key_row(_KEY_OKX, _USER_TWO, "okx", "2026-02-01T00:00:00Z"),
        ],
        "allocator_equity_snapshots": [],
    }


async def test_a_failed_member_is_recorded_by_class_the_other_account_is_measured_and_the_run_fails(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    import ccxt

    hostile = ccxt.AuthenticationError(
        f"bybit GET /v5/execution/list 4321.5 {_KEY_BYBIT} signature=abc123"
    )
    broken = _StubVenue([[]], fetch_effect=hostile)
    healthy = _StubVenue([_trade_page("ok", 7, newest_ms=_ms(_TODAY))])
    services = _Services(_two_user_book(), [broken, healthy])
    services.install(monkeypatch)

    code = await hp.run()

    captured = capsys.readouterr()
    lines = [line for line in captured.out.splitlines() if line.strip()]
    assert code == 1
    assert len(lines) == 3  # both accounts and the summary: nothing was hidden
    a1, a2, summary = (json.loads(line) for line in lines)
    assert a1["failure_class"] == "AuthenticationError"
    assert (a1["members_read"], a1["members_failed"], a1["comparable"]) == (0, 1, False)
    assert a2["failure_class"] == "none" and a2["members_read"] == 1 and a2["trades_read"] == 7
    assert summary["accounts"] == 2 and summary["accounts_read"] == 1
    assert services.closed == [broken, healthy]  # the failed member's client is closed too
    # Only the account that was read in full is compared against the stored history.
    assert len([e for e in services.supabase.log if e.startswith("select:allocator_equity_snapshots")]) == 1
    for leak in ("4321.5", _KEY_BYBIT, "signature", "abc123", "execution/list"):
        assert leak not in captured.out, leak
        assert leak not in captured.err, leak


@pytest.mark.parametrize(
    ("effect", "expected"),
    [
        (lambda ccxt: er.TruncatedTradeRead(er._TRUNCATED_READ_MESSAGE, site="generic_no_advance"), "truncated"),
        (lambda ccxt: ccxt.BadRequest("bybit trade window starts before the venue's two-year limit"), "BadRequest"),
    ],
    ids=["truncated-read", "two-year-guard"],
)
async def test_a_truncated_read_is_told_apart_from_a_venue_rejection(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    effect: Any,
    expected: str,
) -> None:
    import ccxt

    broken = _StubVenue([[]], fetch_effect=effect(ccxt))
    services = _Services(_okx_only_book(), [broken])
    services.install(monkeypatch)

    assert await hp.run() == 1
    account, _summary = _stdout_records(capsys)
    assert account["failure_class"] == expected
    assert (account["members_read"], account["members_failed"]) == (0, 1)


async def test_a_read_past_the_crawl_bound_is_recorded_as_a_timeout(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("services.equity_reconstruction._RECONSTRUCT_CRAWL_TIMEOUT_S", 0.05)
    hung = _StubVenue([[]], hang=True)
    services = _Services(_okx_only_book(), [hung])
    services.install(monkeypatch)

    assert await hp.run() == 1
    account, _summary = _stdout_records(capsys)
    assert account["failure_class"] == "Timeout" and account["members_failed"] == 1
    assert services.closed == [hung]


async def test_an_anchor_refusal_is_a_member_refusal_token_and_fails_the_run(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    services = _Services(_okx_only_book(), [_StubVenue([[]])])

    async def _refuse(*_a: Any, **_k: Any) -> Any:
        raise er.ForcedRebuildRefusedError("anchor_unreadable")

    services.reader = _refuse
    services.install(monkeypatch)

    assert await hp.run() == 1
    account, _summary = _stdout_records(capsys)
    assert account["member_refusal"] == "anchor_unreadable"
    assert account["failure_class"] == "none"
    assert (account["members_read"], account["members_failed"], account["comparable"]) == (0, 1, False)


async def test_a_refusal_outside_the_vocabulary_is_a_failure_of_class_other(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    services = _Services(_okx_only_book(), [_StubVenue([[]])])

    async def _refuse(*_a: Any, **_k: Any) -> Any:
        raise er.ForcedRebuildRefusedError("a token nobody declared 4321.5")

    services.reader = _refuse
    services.install(monkeypatch)

    assert await hp.run() == 1
    captured = capsys.readouterr()
    account = json.loads(captured.out.splitlines()[0])
    assert account["failure_class"] == "other" and account["member_refusal"] == "none"
    assert "4321.5" not in captured.out + captured.err


async def test_a_decrypt_failure_is_recorded_for_that_account_and_the_next_is_measured(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    healthy = _StubVenue([_trade_page("ok", 4, newest_ms=_ms(_TODAY))])
    services = _Services(_two_user_book(), [healthy])
    services.install(monkeypatch)

    def _decrypt(row: dict[str, Any], _kek: bytes) -> tuple[str, str, None]:
        services.decrypt_calls.append(row["id"])
        if row["id"] == _KEY_BYBIT:
            raise ValueError(f"malformed credential row {_KEY_BYBIT} {_CIPHER}")
        return ("fake-k", "fake-s", None)

    monkeypatch.setattr("services.encryption.decrypt_credentials", _decrypt)
    assert await hp.run() == 1
    captured = capsys.readouterr()
    a1, a2, _summary = (json.loads(line) for line in captured.out.splitlines() if line.strip())
    assert a1["failure_class"] == "other" and a1["members_failed"] == 1
    assert a2["members_read"] == 1 and a2["trades_read"] == 4
    assert _KEY_BYBIT not in captured.out + captured.err
    assert _CIPHER not in captured.out + captured.err


# ---------------------------------------------------------------------------
# Exit codes and main.
# ---------------------------------------------------------------------------


@pytest.fixture
def _logging_restored() -> Any:
    """main() switches logging off for the whole process; give it back."""
    import logging

    yield
    logging.disable(logging.NOTSET)


def test_the_exit_codes_are_the_documented_ones() -> None:
    assert (hp.EXIT_OK, hp.EXIT_FAILED, hp.EXIT_REFUSED) == (0, 1, 2)
    assert asyncio.iscoroutinefunction(hp.run)


def test_main_takes_no_options_and_rejects_any_argument() -> None:
    for argv in (["--anything"], ["a1"]):
        with pytest.raises(SystemExit) as exc:
            hp.main(argv)
        assert exc.value.code != 0


def test_main_switches_logging_off_while_run_executes(
    monkeypatch: pytest.MonkeyPatch, _logging_restored: Any
) -> None:
    import logging

    seen: list[int] = []

    async def _run() -> int:
        seen.append(logging.root.manager.disable)
        return hp.EXIT_REFUSED

    monkeypatch.setattr(hp, "run", _run)
    assert hp.main([]) == 2
    assert seen == [logging.CRITICAL]


def test_main_prints_the_exception_type_only_on_a_run_level_failure(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    _logging_restored: Any,
) -> None:
    async def _boom() -> int:
        raise RuntimeError(f"db password 4321.5 {_KEY_BYBIT}")

    monkeypatch.setattr(hp, "run", _boom)
    assert hp.main([]) == 1
    captured = capsys.readouterr()
    assert captured.err.strip() == "failed: RuntimeError"
    assert "4321.5" not in captured.err and _KEY_BYBIT not in captured.err
    assert captured.out == ""
