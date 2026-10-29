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
        order_by_type: dict[str, Any] | None = None,
        order_effect: BaseException | None = None,
        fetch_effect: BaseException | None = None,
        hang: bool = False,
    ) -> None:
        self.pages = [list(p) for p in (pages or [])]
        self.page_count = len(self.pages)
        self._order_raw = order_raw
        self._order_by_type = order_by_type or {}  # an answer (or an exception) per instType
        self._order_effect = order_effect
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
        by_type = self._order_by_type.get(params["instType"])
        if isinstance(by_type, BaseException):
            raise by_type
        if by_type is not None:
            return by_type
        if self._order_effect is not None:
            raise self._order_effect
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
    assert (a1["okx_members_with_trades"], a2["okx_members_with_trades"]) == (0, 1)
    assert (a1["bybit_transfers_gate"], a2["bybit_transfers_gate"]) == ("not-applicable",) * 2  # 21-day window
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
        # The OKX stub answers nothing readable, so its one member with trades has no reading.
        "okx_order_readings": 0,
        "okx_members_with_trades": 1,
        "okx_order_gate": "unmeasured",
        # Both accounts hold a 21-day window, so no account is applicable and the roll-up is
        # ``unmeasured``, never a vacuous ``ok``.
        "bybit_accounts_applicable": 0,
        "bybit_transfers_gate": "unmeasured",
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


def _newest_page() -> dict[str, Any]:
    """A raw answer that lists newest first AND starts at the newest fill the stub forced passes
    read (``_ms(_TODAY)``), as an OKX answer to an unbounded range does."""
    newest = _ms(_TODAY)
    return _fills(str(newest), str(newest - 1000), str(newest - 2000))


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


async def test_one_raw_order_read_per_inst_type_the_forced_pass_read_and_one_reading_per_member(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    pages = [
        _trade_page("sp", 30, newest_ms=_ms(_TODAY)),
        _trade_page("sw1", 100, newest_ms=_ms(_TODAY)),
        _trade_page("sw2", 40, newest_ms=_ms(_TODAY) - 10**9),
    ]
    descending = _StubVenue(pages, order_raw=_newest_page())
    window = (_TODAY - timedelta(days=20), 21)
    services = _Services(_okx_only_book(), [descending], window=window)
    services.reader = _okx_two_pass_reader(services)
    services.install(monkeypatch)

    assert await hp.run() == 0
    account, summary = _stdout_records(capsys)

    assert descending.raw_calls == [
        {
            "instType": inst_type,  # every type the forced pass read rows on, in the order it met them
            "begin": str(_ms(window[0])),  # spanning the window the rebuild reads
            "end": str(_ms(_TODAY + timedelta(days=1))),
            "limit": "100",
        }
        for inst_type in ("SPOT", "SWAP")
    ]
    # Two types were read, one reading is carried: readings never exceed members with trades.
    assert (account["okx_order_readings"], account["okx_order_violations"]) == (1, 0)
    assert summary["okx_order_violations"] == 0
    assert account["okx_members_with_trades"] == 1
    assert (summary["okx_order_readings"], summary["okx_members_with_trades"]) == (1, 1)
    assert summary["okx_order_gate"] == "ok"

    # An OKX that answers oldest first is counted as a violation, per account and in total.
    ascending = _StubVenue([list(p) for p in pages], order_raw=_fills("100", "200", "300"))
    services = _Services(_okx_only_book(), [ascending], window=window)
    services.reader = _okx_two_pass_reader(services)
    services.install(monkeypatch)
    assert await hp.run() == 0
    account, summary = _stdout_records(capsys)
    assert (account["okx_order_readings"], account["okx_order_violations"]) == (1, 1)
    assert summary["okx_order_violations"] == 1
    assert summary["okx_order_gate"] == "violated"

    # An answer that cannot say is not a reading at all.
    unreadable = _StubVenue([list(p) for p in pages], order_raw=_fills("300"))
    services = _Services(_okx_only_book(), [unreadable], window=window)
    services.reader = _okx_two_pass_reader(services)
    services.install(monkeypatch)
    assert await hp.run() == 0
    account, summary = _stdout_records(capsys)
    assert (account["okx_order_readings"], account["okx_order_violations"]) == (0, 0)
    # The member read trades but its answer could not say: absent evidence, never ``ok``.
    assert account["okx_members_with_trades"] == 1
    assert summary["okx_order_gate"] == "unmeasured"


async def test_a_descending_raw_page_that_does_not_reach_the_newest_fill_is_no_reading(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Review WR-01. The rebuild's walk needs the unbounded page to hold the NEWEST fills. Rows that
    # descend inside a page that stops short of the forced pass's newest fill are what OKX would
    # answer if it returned the OLDEST rows of the range, sorted descending; the walk would then
    # stop on a short page and lose every newer fill. That page must not read as ``True``.
    pages = [
        _trade_page("sp", 30, newest_ms=_ms(_TODAY)),
        _trade_page("sw1", 100, newest_ms=_ms(_TODAY)),
        _trade_page("sw2", 40, newest_ms=_ms(_TODAY) - 10**9),
    ]
    newest = _ms(_TODAY)
    window = (_TODAY - timedelta(days=20), 21)
    for first_ts, readings, gate in ((newest, 1, "ok"), (newest - 1, 0, "unmeasured")):
        okx = _StubVenue(
            [list(p) for p in pages],
            order_raw=_fills(str(first_ts), str(first_ts - 1000), str(first_ts - 2000)),
        )
        services = _Services(_okx_only_book(), [okx], window=window)
        services.reader = _okx_two_pass_reader(services)
        services.install(monkeypatch)

        assert await hp.run() == 0
        account, summary = _stdout_records(capsys)

        assert len(okx.raw_calls) == 2  # both types were read; the stale answers were not accepted
        assert (account["okx_order_readings"], account["okx_order_violations"]) == (readings, 0)
        assert account["okx_members_with_trades"] == 1
        assert summary["okx_order_gate"] == gate, first_ts


async def test_the_members_reading_is_true_only_when_every_inst_type_it_read_answers_newest_first(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Review SFH-2. The rebuild's walk pages every instrument type it meets, and a member trading
    # on two types used to be measured on the busiest one only (SWAP here: 140 rows against 30),
    # so an OKX that answered the other type oldest first still produced ``ok``.
    import ccxt

    pages = [
        _trade_page("sp", 30, newest_ms=_ms(_TODAY)),
        _trade_page("sw1", 100, newest_ms=_ms(_TODAY)),
        _trade_page("sw2", 40, newest_ms=_ms(_TODAY) - 10**9),
    ]
    newest = _ms(_TODAY)
    good = _newest_page()
    stale = _fills(str(newest - 1), str(newest - 1000), str(newest - 2000))  # does not reach the newest
    ascending = _fills("100", "200", "300")
    window = (_TODAY - timedelta(days=20), 21)
    cases = (
        # (answers by type, readings, violations, failure class, gate)
        ({"SPOT": good, "SWAP": good}, 1, 0, "none", "ok"),
        ({"SPOT": ascending, "SWAP": good}, 1, 1, "none", "violated"),  # the NON-busiest type violates
        ({"SPOT": good, "SWAP": stale}, 0, 0, "none", "unmeasured"),
        ({"SPOT": good, "SWAP": _fills("300")}, 0, 0, "none", "unmeasured"),  # one type cannot say
        ({"SPOT": ccxt.NetworkError("fake 4321.5"), "SWAP": good}, 0, 0, "NetworkError", "unmeasured"),
        ({"SPOT": ccxt.NetworkError("fake 4321.5"), "SWAP": ascending}, 1, 1, "NetworkError", "violated"),
    )
    for answers, readings, violations, failure, gate in cases:
        okx = _StubVenue([list(p) for p in pages], order_by_type=answers)
        services = _Services(_okx_only_book(), [okx], window=window)
        services.reader = _okx_two_pass_reader(services)
        services.install(monkeypatch)

        assert await hp.run() == 0
        captured = capsys.readouterr()
        account, summary = (json.loads(line) for line in captured.out.splitlines() if line.strip())

        label = repr(sorted(answers))
        assert [call["instType"] for call in okx.raw_calls] == ["SPOT", "SWAP"], label
        assert (account["members_read"], account["members_failed"]) == (1, 0), label
        # ONE reading per member, however many types were read: readings <= members_with_trades.
        assert (account["okx_order_readings"], account["okx_order_violations"]) == (readings, violations), label
        assert account["okx_members_with_trades"] == 1, label
        assert account["okx_order_failure_class"] == failure, label
        assert summary["okx_order_gate"] == gate, label
        assert "4321.5" not in captured.out + captured.err, label


async def test_an_inst_type_that_cannot_show_an_order_owes_the_member_no_reading(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Round 2 WR-01. SFH-2 made the member read every type the forced pass read rows on, so a
    # SPOT type whose fills share ONE millisecond (a single market order matched against several
    # makers) voided the reading of a member whose busy SWAP type answered newest first. A type
    # that read fewer than two distinct timestamps cannot say, and the walk reads it in full
    # whatever the order, so it must not wipe out the member's reading (CONTEXT discretion bound:
    # each OKX member that read trades past one page carries at least one reading).
    newest = _ms(_TODAY)
    pages = [
        _trade_page("sp", 3, newest_ms=newest, step_ms=0),  # three fills, one millisecond
        _trade_page("sw1", 100, newest_ms=newest),
        _trade_page("sw2", 40, newest_ms=newest - 10**9),
    ]
    window = (_TODAY - timedelta(days=20), 21)
    okx = _StubVenue(pages, order_by_type={"SWAP": _newest_page(), "SPOT": _fills(str(newest), str(newest))})
    services = _Services(_okx_only_book(), [okx], window=window)
    services.reader = _okx_two_pass_reader(services)
    services.install(monkeypatch)

    assert await hp.run() == 0
    account, summary = _stdout_records(capsys)

    assert [call["instType"] for call in okx.raw_calls] == ["SWAP"]  # SPOT cannot say, so it is not read
    assert (account["okx_order_readings"], account["okx_order_violations"]) == (1, 0)
    assert account["okx_members_with_trades"] == 1
    assert summary["okx_order_gate"] == "ok"


async def test_a_multi_page_inst_type_with_no_usable_timestamps_still_voids_the_members_reading(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Round 3 WR-03. Only a type whose rows share ONE millisecond AND fit on one short page may
    # owe the member no reading. A 140-row SPOT pass (100 + 40, two calls) with no timestamp, or
    # with every row at one millisecond, is still a type the walk paged and the probe has no
    # evidence for; skipping it left the member's reading ``True`` from SWAP alone and the gate
    # ``ok``. It must be read and fail shut.
    newest = _ms(_TODAY)
    window = (_TODAY - timedelta(days=20), 21)

    def _without_timestamps(tag: str, count: int) -> list[dict[str, Any]]:
        return [{"id": f"fake-trade-{tag}-{i}"} for i in range(count)]

    cases = (
        # (label, SPOT pages, SPOT's raw answer): a descending answer cannot reach a newest fill the
        # pass never stamped; one millisecond throughout cannot say which way it lists.
        ("no timestamp", [_without_timestamps("sp1", 100), _without_timestamps("sp2", 40)], _newest_page()),
        (
            "one millisecond",
            [_trade_page("sp1", 100, newest_ms=newest, step_ms=0), _trade_page("sp2", 40, newest_ms=newest, step_ms=0)],
            _fills(str(newest), str(newest)),
        ),
    )
    for label, spot_pages, spot_raw in cases:
        okx = _StubVenue(
            [*spot_pages, _trade_page("sw1", 100, newest_ms=newest), _trade_page("sw2", 40, newest_ms=newest - 10**9)],
            order_by_type={"SWAP": _newest_page(), "SPOT": spot_raw},
        )
        services = _Services(_okx_only_book(), [okx], window=window)

        async def _read(
            exchange: _StubVenue, venue: str, supabase: Any, start: date, end: date, **_k: Any
        ) -> Any:
            for kind in ("spot", "spot", "swap", "swap"):
                await exchange.fetch_my_trades(None, _ms(start), 500, {"type": kind})
            return _window_rows(end), False, {}

        services.reader = _read
        services.install(monkeypatch)

        assert await hp.run() == 0
        account, summary = _stdout_records(capsys)

        assert [call["instType"] for call in okx.raw_calls] == ["SPOT", "SWAP"], label  # SPOT is still read
        assert account["okx_order_readings"] == 0, label
        assert summary["okx_order_gate"] == "unmeasured", label


async def test_each_inst_types_page_must_reach_that_types_own_newest_fill(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Round 2 WR-02. The reach check is per instrument type. Every other fixture gives every type
    # the same newest fill, so a check that compared a type's page with ANOTHER type's newest fill
    # (the oldest type's, say) passed them all. Here SPOT's newest fill is a million seconds older
    # than SWAP's, so a page that merely reaches SPOT's newest fill is the OLDEST rows of the SWAP
    # range sorted descending, and must not read as newest first for SWAP.
    swap_newest = _ms(_TODAY)
    spot_newest = swap_newest - 10**9
    pages = [
        _trade_page("sp", 30, newest_ms=spot_newest),
        _trade_page("sw1", 100, newest_ms=swap_newest),
        _trade_page("sw2", 40, newest_ms=swap_newest - 10**9),
    ]

    def _page_from(first_ts: int) -> dict[str, Any]:
        return _fills(str(first_ts), str(first_ts - 1000), str(first_ts - 2000))

    window = (_TODAY - timedelta(days=20), 21)
    cases = (
        # (SPOT page starts at, SWAP page starts at, readings, gate)
        (spot_newest, spot_newest, 0, "unmeasured"),  # SWAP's page stops at SPOT's newest fill
        (swap_newest, swap_newest, 1, "ok"),  # a page above a type's own newest fill is fine
        (spot_newest, swap_newest, 1, "ok"),  # each type reaches its OWN newest fill
        (swap_newest, spot_newest, 0, "unmeasured"),  # SWAP short of its own, SPOT above its own
    )
    for spot_first, swap_first, readings, gate in cases:
        okx = _StubVenue(
            [list(p) for p in pages],
            order_by_type={"SPOT": _page_from(spot_first), "SWAP": _page_from(swap_first)},
        )
        services = _Services(_okx_only_book(), [okx], window=window)
        services.reader = _okx_two_pass_reader(services)
        services.install(monkeypatch)

        assert await hp.run() == 0
        account, summary = _stdout_records(capsys)

        label = (spot_first - spot_newest, swap_first - swap_newest)
        assert [call["instType"] for call in okx.raw_calls] == ["SPOT", "SWAP"], label
        assert (account["okx_order_readings"], account["okx_order_violations"]) == (readings, 0), label
        assert summary["okx_order_gate"] == gate, label


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
    # An OKX member that read nothing is not a member with trades, so nothing is owed a reading
    # and zero members with trades is ``unmeasured``, never ``ok``.
    assert (a1["okx_members_with_trades"], a2["okx_members_with_trades"]) == (0, 0)
    assert (summary["okx_order_readings"], summary["okx_members_with_trades"]) == (0, 0)
    assert summary["okx_order_gate"] == "unmeasured"


async def test_a_raw_order_read_that_raises_after_a_good_read_keeps_the_member_read(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Phase 173 D-01. The ordering read is a side measurement. It used to run inside the
    # member's read, so a raw GET that failed turned a member whose forced read had SUCCEEDED
    # into a failed member and hid its trades; now it is recorded by class and the member
    # stays read.
    import ccxt

    pages = [
        _trade_page("sp", 30, newest_ms=_ms(_TODAY)),
        _trade_page("sw1", 100, newest_ms=_ms(_TODAY)),
        _trade_page("sw2", 40, newest_ms=_ms(_TODAY) - 10**9),
    ]
    okx = _StubVenue(pages, order_effect=ccxt.NetworkError("fake okx 4321.5 signature=abc123"))
    services = _Services(_okx_only_book(), [okx], window=(_TODAY - timedelta(days=20), 21))
    services.reader = _okx_two_pass_reader(services)
    services.install(monkeypatch)

    assert await hp.run() == 0
    captured = capsys.readouterr()
    account, _summary = (json.loads(line) for line in captured.out.splitlines() if line.strip())

    assert (account["members_read"], account["members_failed"]) == (1, 0)
    assert account["failure_class"] == "none"
    assert account["trades_read"] == 170  # the forced read's trades are not lost
    assert len(okx.raw_calls) == 2  # it was attempted on both types
    assert account["okx_order_readings"] == 0
    assert account["okx_order_failure_class"] == "NetworkError"
    for leak in ("4321.5", "signature", "abc123"):
        assert leak not in captured.out + captured.err, leak


async def test_a_truncated_okx_member_carries_an_ordering_reading(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # A read cut short at the OKX page ceiling DID read trades past one page, which is the very
    # case the TRADEPAGES gate is about: it must carry a reading and not drop out of the count
    # of OKX members that read trades.
    okx = _StubVenue(
        [_trade_page("sw1", 100, newest_ms=_ms(_TODAY)), _trade_page("sw2", 40, newest_ms=_ms(_TODAY) - 10**9)],
        order_raw=_newest_page(),
    )
    services = _Services(_okx_only_book(), [okx], window=(_TODAY - timedelta(days=20), 21))

    async def _cut_short(
        exchange: _StubVenue, venue: str, supabase: Any, start: date, end: date, **_k: Any
    ) -> Any:
        for _ in range(2):
            await exchange.fetch_my_trades(None, _ms(start), 100, {"type": "swap"})
        raise er.TruncatedTradeRead(er._TRUNCATED_READ_MESSAGE, site="okx_page_ceiling")

    services.reader = _cut_short
    services.install(monkeypatch)

    assert await hp.run() == 1
    account, _summary = _stdout_records(capsys)
    assert account["failure_class"] == "truncated" and account["truncated_site"] == "okx_page_ceiling"
    assert [call["instType"] for call in okx.raw_calls] == ["SWAP"]
    assert (account["okx_order_readings"], account["okx_order_violations"]) == (1, 0)
    assert account["okx_order_failure_class"] == "none"


async def test_no_raw_order_read_after_another_failure_or_on_a_bybit_member(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    import ccxt

    answer = _fills("100", "200")

    async def _auth_failure(
        exchange: _StubVenue, venue: str, supabase: Any, start: date, end: date, **_k: Any
    ) -> Any:
        await exchange.fetch_my_trades(None, _ms(start), 100, {"type": "swap"})
        raise ccxt.AuthenticationError("fake rejection")

    async def _bybit_truncated(
        exchange: _StubVenue, venue: str, supabase: Any, start: date, end: date, **_k: Any
    ) -> Any:
        for _ in range(2):
            await exchange.fetch_my_trades(None, _ms(start), 100, {"type": "swap"})
        raise er.TruncatedTradeRead(er._TRUNCATED_READ_MESSAGE, site="bybit_segment_ceiling")

    async def _bybit_in_full(
        exchange: _StubVenue, venue: str, supabase: Any, start: date, end: date, **_k: Any
    ) -> Any:
        for _ in range(2):
            await exchange.fetch_my_trades(None, _ms(start), 100, {"type": "swap"})
        return _window_rows(end), False, {}

    pages = [_trade_page("a", 5, newest_ms=_ms(_TODAY)), _trade_page("b", 5, newest_ms=_ms(_TODAY) - 10**9)]
    cases = (
        ("another failure class, OKX", _okx_only_book, _auth_failure, "AuthenticationError"),
        ("Bybit, cut short", _bybit_only_book, _bybit_truncated, "truncated"),
        ("Bybit, read in full", _bybit_only_book, _bybit_in_full, "none"),
    )
    for label, book, reader, failure in cases:
        venue = _StubVenue([list(p) for p in pages], order_raw=answer)
        services = _Services(book(), [venue], window=(_TODAY - timedelta(days=20), 21))
        services.reader = reader
        services.install(monkeypatch)

        await hp.run()
        account, _summary = _stdout_records(capsys)
        assert account["failure_class"] == failure, label
        assert venue.raw_calls == [], label  # no raw call: a failed OKX read is not a read of trades
        assert (account["okx_order_readings"], account["okx_order_failure_class"]) == (0, "none"), label


@pytest.mark.parametrize(
    ("violations", "ended_full", "readings", "members_with_trades", "gate"),
    [
        (0, 0, 1, 1, "ok"),
        (0, 0, 2, 2, "ok"),
        (0, 0, 0, 0, "unmeasured"),  # no OKX member read trades: absent evidence is never ok
        (0, 0, 0, 1, "unmeasured"),  # a member with trades and no reading
        (0, 0, 1, 2, "unmeasured"),  # one of two members measured
        (1, 0, 1, 1, "violated"),
        (0, 1, 1, 1, "violated"),  # a full-page stop outranks a complete set of readings
        (1, 0, 0, 1, "violated"),  # and so does a violation with no reading to match
        (0, 1, 0, 0, "violated"),
    ],
)
def test_the_okx_order_verdict_puts_violated_first_and_absent_evidence_is_unmeasured(
    violations: int, ended_full: int, readings: int, members_with_trades: int, gate: str
) -> None:
    # Phase 173 D-01. The gate used to be worked out by hand from the printed counts; a gate
    # that says ``ok`` on missing evidence would let a rebuild walk OKX's pages in an order
    # nobody measured, so the verdict is code and its precedence is pinned.
    assert hp.okx_order_verdict(violations, ended_full, readings, members_with_trades) == gate
    assert gate in hp._OKX_ORDER_GATES


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
    assert summary["okx_order_gate"] == "violated"  # a full-page stop, with no reading to offset it


class _StubVenueWithTransfers(_StubVenue):
    """A venue that also answers ``fetch_deposits`` / ``fetch_withdrawals`` with fixed rows."""

    def __init__(
        self,
        pages: list[list[dict[str, Any]]],
        *,
        deposits: Any,
        withdrawals: Any,
        order_raw: Any = None,
        order_effect: BaseException | None = None,
    ) -> None:
        super().__init__(pages, order_raw=order_raw, order_effect=order_effect)
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
    # D-02: the same events per kind. d1 is both a deposit and a withdrawal id, and the kind keeps
    # them apart; the pooled field is their sum.
    assert account["deposits_older_365d"] == 2
    assert account["withdrawals_older_365d"] == 1
    assert account["transfers_older_365d"] == account["deposits_older_365d"] + account["withdrawals_older_365d"]
    # The corroboration evidence: in-window totals, closed age buckets and ordering booleans only.
    assert (account["deposits_in_window"], account["withdrawals_in_window"]) == (3, 1)
    assert account["oldest_fill_age_bucket"] == "0-29"
    assert account["oldest_deposit_age_bucket"] == "365-546"  # about 376 days
    assert account["oldest_withdrawal_age_bucket"] == "365-546"  # exactly 365 days
    assert account["oldest_fill_before_oldest_deposit"] is False
    assert account["oldest_fill_before_oldest_withdrawal"] is False
    assert account["bybit_transfers_gate"] == "ok"  # both kinds seen older than a year, on a 730-day window
    assert "fake-transfer" not in captured.out + captured.err


async def test_fills_older_than_the_first_transfer_are_recorded_as_evidence(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # D-02: a 0 deposit count older than a year is not a depth finding when the fills themselves
    # start before the first deposit the transfer read returned. The founder judges that from
    # these fields; they open no gate, and they carry no id and no timestamp.
    deposit_ms = _ms(_TODAY - timedelta(days=100))
    bybit = _StubVenueWithTransfers(
        [_trade_page("by", 5, newest_ms=_ms(_TODAY - timedelta(days=500)))],
        deposits=[{"id": "fake-transfer-e1", "timestamp": deposit_ms}],
        withdrawals=[],
    )
    services = _Services(
        _bybit_only_book(), [bybit], window=(_TODAY - timedelta(days=729), 730)
    )

    async def _read(
        exchange: _StubVenueWithTransfers, venue: str, supabase: Any, start: date, end: date, **_k: Any
    ) -> Any:
        await exchange.fetch_my_trades(None, _ms(start), 500, {})
        await exchange.fetch_deposits(None, 1, 500, {"until": 2})
        await exchange.fetch_withdrawals(None, 1, 500, {"until": 2})
        return _window_rows(end), False, {}

    services.reader = _read
    services.install(monkeypatch)

    assert await hp.run() == 0
    captured = capsys.readouterr()
    account = json.loads(captured.out.splitlines()[0])
    assert account["oldest_fill_age_bucket"] == "365-546"
    assert account["oldest_deposit_age_bucket"] == "90-179"
    assert account["oldest_withdrawal_age_bucket"] == "none"
    assert account["oldest_fill_before_oldest_deposit"] is True
    assert account["oldest_fill_before_oldest_withdrawal"] == hp.FIELD_ABSENT
    assert (account["deposits_in_window"], account["withdrawals_in_window"]) == (1, 0)
    assert account["deposits_older_365d"] == 0
    assert "fake-transfer" not in captured.out + captured.err
    assert str(deposit_ms) not in captured.out + captured.err


def test_the_bybit_transfers_verdict_needs_both_kinds_on_a_full_bybit_window() -> None:
    full = er.BYBIT_TRADE_TERMINUS_DAYS
    assert hp.bybit_transfers_verdict(1, full, 1, 1) == "ok"
    assert hp.bybit_transfers_verdict(2, full, 3, 1) == "ok"
    # D-02: a 0 for either kind keeps the gate shut, a pooled total never opens it.
    assert hp.bybit_transfers_verdict(1, full, 1, 0) == "unmeasured"
    assert hp.bybit_transfers_verdict(1, full, 0, 1) == "unmeasured"
    assert hp.bybit_transfers_verdict(1, full, 0, 0) == "unmeasured"
    # No Bybit member, or a window short of the full Bybit one (any OKX member makes it 90 days).
    assert hp.bybit_transfers_verdict(0, full, 5, 5) == "not-applicable"
    assert hp.bybit_transfers_verdict(1, 90, 5, 5) == "not-applicable"


async def test_one_kind_older_than_a_year_keeps_the_bybit_gate_unmeasured(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # WR-07: one deposit 500 days old and no withdrawal makes the POOLED count 1, which must not
    # open a gate that asks for both kinds.
    bybit = _StubVenueWithTransfers(
        [_trade_page("by", 5, newest_ms=_ms(_TODAY))],
        deposits=[{"id": "fake-transfer-w7", "timestamp": _ms(_TODAY - timedelta(days=500))}],
        withdrawals=[],
    )
    services = _Services(
        _bybit_only_book(), [bybit], window=(_TODAY - timedelta(days=729), 730)
    )

    async def _read(
        exchange: _StubVenueWithTransfers, venue: str, supabase: Any, start: date, end: date, **_k: Any
    ) -> Any:
        await exchange.fetch_my_trades(None, _ms(start), 500, {})
        await exchange.fetch_deposits(None, 1, 500, {"until": 2})
        await exchange.fetch_withdrawals(None, 1, 500, {"until": 2})
        return _window_rows(end), False, {}

    services.reader = _read
    services.install(monkeypatch)

    assert await hp.run() == 0
    captured = capsys.readouterr()
    account = json.loads(captured.out.splitlines()[0])
    assert account["transfers_older_365d"] == 1
    assert (account["deposits_older_365d"], account["withdrawals_older_365d"]) == (1, 0)
    assert account["bybit_transfers_gate"] == "unmeasured"
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
    account = _stdout_records(capsys)[0]
    assert account["transfers_older_365d"] == 0
    assert (account["deposits_older_365d"], account["withdrawals_older_365d"]) == (0, 0)
    assert (account["deposits_in_window"], account["withdrawals_in_window"]) == (0, 0)
    assert account["oldest_deposit_age_bucket"] == account["oldest_withdrawal_age_bucket"] == "none"
    assert account["oldest_fill_before_oldest_deposit"] == hp.FIELD_ABSENT
    assert account["oldest_fill_before_oldest_withdrawal"] == hp.FIELD_ABSENT
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


def test_every_rebuild_name_the_probe_reads_is_declared() -> None:
    """The names the probe reads off the rebuild module are exactly the declared list: a name
    added to the code without the list would let an older deployed rebuild pass the guard."""
    import ast

    read = {
        node.attr
        for node in ast.walk(ast.parse(_PROBE_SRC))
        if isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Name)
        and node.value.id == "er"
    }
    assert read == set(hp.DEPLOYED_ER_NAMES)
    assert list(hp.DEPLOYED_ER_NAMES) == sorted(hp.DEPLOYED_ER_NAMES)
    assert hp.missing_deployed_names() == []  # control: this checkout defines every one of them


async def test_a_rebuild_module_missing_a_declared_name_refuses_before_any_decrypt(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    services = _Services(_two_account_book(), [_StubVenue(), _StubVenue()])
    services.install(monkeypatch)
    monkeypatch.delattr(er, "_BYBIT_WINDOW_PAGE_CEILING")

    assert await hp.run() == hp.EXIT_REFUSED

    captured = capsys.readouterr()
    assert captured.out == ""  # no record: a misrecording is worse than none
    assert captured.err.startswith("refused:") and "1 name(s)" in captured.err
    assert "_BYBIT_WINDOW_PAGE_CEILING" not in captured.err  # a count, not the name
    assert services.decrypt_calls == [] and services.built_for == []
    assert services.supabase.log == []  # refused before the first read, not only before a decrypt


def test_the_probe_never_touches_the_resumable_trade_read() -> None:
    """The reading is counts-only and read-only: it must neither set the resume scope nor name
    the store or its tables. ``TruncatedTradeRead`` is allowed, so the list is not ``TradeRead``."""
    for forbidden in (
        "trade_read_store",
        "trade_read_scope",
        "TradeReadScope",
        "TradeReadDeferred",
        "TradeReadStalled",
        "allocator_trade_read",
    ):
        assert forbidden not in _PROBE_SRC, forbidden


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
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, okx_order_failure_class="BadRequest: 4321.5"))
    # A uuid or an amount-shaped string in a vocabulary slot.
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, selection="123e4567-e89b-12d3-a456-426614174000"))
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, window_days="4321.5"))

    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, okx_members_with_trades=-1))
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, deposits_older_365d=-1))
    with pytest.raises(ValueError):
        hp.emit_record(dict(rec, withdrawals_older_365d=True))

    summary = hp.summarize([rec], "2026-10-23")
    hp.emit_record(summary)  # control
    with pytest.raises(ValueError):
        hp.emit_record(dict(summary, okx_order_gate="maybe"))
    with pytest.raises(ValueError):
        hp.emit_record(dict(summary, okx_order_readings=True))
    with pytest.raises(ValueError):
        hp.emit_record(dict(summary, bybit_transfers_gate="not-applicable"))  # no such summary token
    with pytest.raises(ValueError):
        hp.emit_record(dict(summary, bybit_accounts_applicable=True))
    with pytest.raises(ValueError):
        hp.emit_record(dict(summary, accounts=True))
    with pytest.raises(ValueError):
        hp.emit_record(dict(summary, balance=1.5))

    # The refusal names the key, never the offending value.
    with pytest.raises(ValueError) as exc:
        hp.emit_record(dict(rec, failure_class="boom 4321.5"))
    assert "4321.5" not in str(exc.value)
    assert "failure_class" in str(exc.value)


def test_the_transfer_evidence_keys_refuse_values_outside_their_vocabulary() -> None:
    rec = hp._account_record("a1", "2026-10-23")
    hp.emit_record(rec)  # control: the defaults print
    for key, value in (
        ("oldest_deposit_age_bucket", "400"),
        ("deposits_in_window", -1),
        ("oldest_fill_before_oldest_deposit", "yes"),
        ("bybit_transfers_gate", "open"),
    ):
        with pytest.raises(ValueError) as exc:
            hp.emit_record(dict(rec, **{key: value}))
        assert key in str(exc.value)
        assert str(value) not in str(exc.value).replace(key, "")


def test_the_runbook_names_the_code_derived_okx_gate_token_as_its_only_opening_condition() -> None:
    # Review WR-04. P4 said the entry closes on "readings equal members and violations are 0" and a
    # rebuild runs once the gate "reads measured": the first omits full-page stops, which the probe
    # reads as ``violated``, and ``measured`` is not a token of the gate. An operator following this
    # PROD write runbook could take a ``violated`` run as green. One condition, the token itself.
    runbook = Path(__file__).resolve().parents[2] / "docs" / "runbooks" / "marksource-okx-history-correction.md"
    text = re.sub(r"\s+", " ", runbook.read_text(encoding="utf-8"))
    start = text.index("`167.2.1.1.2.1-OKX-ORDER-UNMEASURED`: ")
    entry = text[start : text.index("`167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE`: ", start)]

    assert re.search(r"closes only when the probe's summary `okx_order_gate` reads `ok`", entry)
    assert re.search(r"a rebuild runs only once `okx_order_gate` reads `ok`", entry)
    assert "measured with" not in entry and "reads measured" not in entry
    # Round 2 WR-03: the opening "Where this stands" paragraph, which every operator reads first,
    # carried the old condition ("reads measured with 0 violations") that a full-page-stop run
    # satisfies. The whole runbook, not only the P4 entry, names the token and never "measured".
    assert "reads measured" not in text and "measured with 0 violations" not in text
    assert "Until the probe's summary `okx_order_gate` reads `ok`, pre-flight P4 is a write STOP" in text
    assert "full-page stop" in entry  # the condition the old sentence left out
    named = set(re.findall(r"`okx_order_gate` reads `([a-z]+)`", entry))
    assert named and named <= set(hp._OKX_ORDER_GATES)  # every token the runbook names exists in code


@pytest.mark.parametrize(
    ("account_gates", "applicable", "gate", "selection_refused"),
    [
        ((), 0, "unmeasured", False),  # no account at all
        (("not-applicable",), 0, "unmeasured", False),  # a 90-day window: never a vacuous ok
        (("not-applicable", "not-applicable"), 0, "unmeasured", False),
        (("ok",), 1, "ok", False),
        (("not-applicable", "ok"), 1, "ok", False),  # a not-applicable account neither opens nor shuts it
        (("ok", "ok"), 2, "ok", False),
        (("unmeasured",), 1, "unmeasured", False),
        (("ok", "unmeasured"), 2, "unmeasured", False),  # one shut account shuts the roll-up
        (("not-applicable", "unmeasured"), 1, "unmeasured", False),
        # Founder D-05: a selection-refused account is never read and the rebuild refuses it at the
        # same selection, so it neither shuts nor opens the roll-up. PROD's shape: four refused
        # accounts (revoked keys) beside one applicable ``ok`` account reads ``ok``; refused
        # accounts alone leave nothing applicable, so ``unmeasured``.
        (("not-applicable", "ok"), 1, "ok", True),
        (("not-applicable", "not-applicable", "not-applicable", "not-applicable", "ok"), 1, "ok", True),
        (("not-applicable", "not-applicable"), 0, "unmeasured", True),
        (("not-applicable", "unmeasured"), 1, "unmeasured", True),  # a refusal never hides a shut gate
    ],
)
def test_the_summary_bybit_gate_is_ok_only_with_an_applicable_account_and_all_applicable_ok(
    account_gates: tuple[str, ...], applicable: int, gate: str, selection_refused: bool
) -> None:
    # Review WR-02 / SFH-1. The operator copies ``bybit-transfers:`` from this token. Deriving it
    # by hand ("ok when none is unmeasured") printed ``ok`` for a Bybit account that was never
    # read: a selection refusal, or an account that gained an OKX key and so has a 90-day window,
    # reads ``not-applicable`` and left nothing to be unmeasured.
    records = [
        hp._account_record(
            f"a{i + 1}",
            "2026-10-23",
            bybit_transfers_gate=g,
            selection=sorted(er.FORCED_REBUILD_REFUSAL_REASONS)[0] if selection_refused and g == "not-applicable" else "ok",
        )
        | {"comparable": False, "days_compared": 0, "days_differing": 0}
        for i, g in enumerate(account_gates)
    ]
    summary = hp.summarize(records, "2026-10-23")
    assert (summary["bybit_accounts_applicable"], summary["bybit_transfers_gate"]) == (applicable, gate)
    hp.emit_record(summary)  # and the token is inside the emitter's vocabulary


def test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens() -> None:
    for token in sorted(er.FORCED_REBUILD_REFUSAL_REASONS):
        hp.emit_record(hp._account_record("a1", "2026-10-23", selection=token))
        hp.emit_record(hp._account_record("a1", "2026-10-23", member_refusal=token))
    assert set(hp.ACCOUNT_RECORD_KEYS) == set(hp._account_record("a1", "2026-10-23"))
    assert hp.sig3(0.123456) == 0.123


def test_the_probe_knows_every_typed_truncation_site() -> None:
    """Phase 171 READCEILING D-01: the rebuild raises a ``TruncatedTradeRead`` carrying one of the
    closed ``er.TRUNCATED_READ_SITES`` tokens, and the probe reports a typed cut-short read by
    that token. A site the rebuild can raise but the probe does not declare would be reported
    ``unknown``, which hides which stop fired in exactly the measurement made to find it.

    2026-10-27 (plan 10): the 16th forced-refusal token, ``account_key_read_stalled``, needed no
    probe edit: the probe's selection and member-refusal vocabularies are derived from
    ``er.FORCED_REBUILD_REFUSAL_REASONS``, and the test above emits every token of that set."""
    assert set(er.TRUNCATED_READ_SITES) <= set(hp._TRUNCATED_SITES), (
        sorted(set(er.TRUNCATED_READ_SITES) - set(hp._TRUNCATED_SITES))
    )


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


async def test_a_revoked_bybit_key_leaves_the_owners_okx_account_readable(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """D-05 (founder 2026-10-28): "If a bybit Ley is Revoked, then that is only relevant for
    that Key. It is Not relevant for OKX and its keys, neither for other bybit keys".

    One owner holds a revoked Bybit key and a working OKX key, two exchange accounts. The
    selection used to refuse the whole owner ``account_key_not_working`` and the probe measured
    nothing for the OKX account. Now the revoked Bybit account is skipped and COUNTED, the OKX
    account is selected, its 90-day window applies and only the OKX key is decrypted."""
    book = {
        "api_keys": [
            _key_row(_KEY_BYBIT, _USER_ONE, "bybit", "2026-01-01T00:00:00Z", sync_status="revoked"),
            _key_row(_KEY_OKX, _USER_ONE, "okx", "2026-02-01T00:00:00Z"),
        ],
        "allocator_equity_snapshots": [],
    }
    services = _Services(book, [_StubVenue([_trade_page("ok", 5, newest_ms=_ms(_TODAY))])])
    services.install(monkeypatch)

    assert await hp.run() == 0
    account, summary = _stdout_records(capsys)
    assert account["selection"] == "ok"
    assert account["non_working_accounts_excluded"] == 1
    assert (account["okx_members"], account["bybit_members"]) == (1, 0)
    assert account["window_days"] == 90
    assert account["members_read"] == 1
    assert services.decrypt_calls == [_KEY_OKX]  # the revoked key is never decrypted
    assert summary["accounts"] == 1


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


def _bybit_only_book() -> dict[str, list[dict[str, Any]]]:
    return {
        "api_keys": [_key_row(_KEY_BYBIT, _USER_ONE, "bybit", "2026-01-01T00:00:00Z")],
        "allocator_equity_snapshots": [],
    }


_WINDOW_SINCE_DAYS_BACK = 400  # a window 400 days before the run date: bucket "365-546"


def _bybit_window_pages(
    calls: int, *, tag: str = "w", full_last: bool = True, cursor_prefix: str = "fake-cursor"
) -> list[list[dict[str, Any]]]:
    """``calls`` pages of ONE Bybit window, each a full page with fresh ids spread over several
    milliseconds; the newest row carries a ``nextPageCursor`` that is new on every page."""
    pages: list[list[dict[str, Any]]] = []
    for k in range(calls):
        page = _trade_page(f"{tag}{k}", 100, newest_ms=_ms(_TODAY) - 10**9 - k * 10_000, step_ms=7)
        page[0]["info"] = {"nextPageCursor": f"{cursor_prefix}-{k}"}
        pages.append(page)
    return pages


def _window_reader(services: "_Services", exc: BaseException) -> Any:
    """A reader that drives ONE window the way the deployed Bybit loop does (the window start as
    ``since`` and the window end as ``until`` on every call, the cursor from the second call on),
    then raises ``exc`` as the deployed loop would."""

    async def _reader(
        exchange: _StubVenue, venue: str, supabase: Any, start: date, end: date, **_kw: Any
    ) -> Any:
        since = _ms(_TODAY - timedelta(days=_WINDOW_SINCE_DAYS_BACK))
        until = since + 7 * 86_400_000 - 1
        cursor: str | None = None
        for _ in range(exchange.page_count):
            params: dict[str, Any] = {"until": until}
            if cursor:
                params["cursor"] = cursor
            page = await exchange.fetch_my_trades(None, since, 100, params)
            cursor = page[0]["info"]["nextPageCursor"]
        raise exc

    return _reader


def _deployed_truncated() -> er.TruncatedTradeRead:
    """A truncation as the worker code deployed before Phase 171 raised it: no ``site``
    attribute, so the probe must derive the site from its call log (D-01). Phase 171 made
    ``site`` a required keyword, so the deployed-era form is built around that constructor."""
    exc = er.TruncatedTradeRead.__new__(er.TruncatedTradeRead)
    Exception.__init__(exc, er._TRUNCATED_READ_MESSAGE)
    return exc


async def test_a_truncated_bybit_read_names_the_window_ceiling_from_the_call_log(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    ceiling = hp.er._BYBIT_WINDOW_PAGE_CEILING
    venue = _StubVenue(_bybit_window_pages(ceiling))
    services = _Services(_bybit_only_book(), [venue])
    services.reader = _window_reader(services, _deployed_truncated())
    services.install(monkeypatch)

    assert await hp.run() == 1

    captured = capsys.readouterr()
    lines = [json.loads(line) for line in captured.out.splitlines() if line.strip()]
    account, summary = lines
    assert account["failure_class"] == "truncated"
    assert account["truncated_site"] == "bybit_window_ceiling"
    assert account["last_window_calls"] == ceiling
    assert account["last_window_age_bucket"] == "365-546"
    assert account["trade_calls"] == ceiling
    assert isinstance(account["read_elapsed_s"], int) and account["read_elapsed_s"] >= 0
    assert set(summary) == set(hp.SUMMARY_RECORD_KEYS)  # the summary schema is unchanged
    for leak in ("fake-trade-", "fake-cursor"):
        assert leak not in captured.out + captured.err, leak


# ---------------------------------------------------------------------------
# D-01: which limit stopped a cut-short read, derived from the call log.
# ---------------------------------------------------------------------------


def _log_call(
    tag: str,
    *,
    since: int = 1_000,
    rows: int = 100,
    step_ms: int = 7,
    cursor_repeated: bool = False,
    reuse_of: "hp._Call | None" = None,
) -> "hp._Call":
    """One recorded call of a window. ``reuse_of`` returns that call's ids again (a page that
    added nothing new)."""
    if reuse_of is not None:
        ids = reuse_of.ids
    else:
        ids = tuple((None, f"fake-trade-{tag}-{i}") for i in range(rows))
    newest = 5_000_000
    return hp._Call(
        since=since,
        params={"until": since + 604_799_999},
        rows=rows,
        ids=ids,
        rows_without_id=0,
        oldest_ts=newest - (rows - 1) * step_ms,
        newest_ts=newest,
        cursor_repeated=cursor_repeated,
    )


def _advancing_window(n: int, *, since: int = 1_000) -> "list[hp._Call]":
    return [_log_call(f"w{since}-{k}", since=since) for k in range(n)]


def test_a_full_page_that_added_nothing_is_a_stalled_page() -> None:
    window = _advancing_window(4)
    repeat = _log_call("again", reuse_of=window[1])
    assert hp.derive_truncated_site("bybit", [*window, repeat]) == "bybit_stalled_page"
    # The same verdict when the page brought new ids but returned the cursor it was sent.
    stuck_cursor = _log_call("fresh", cursor_repeated=True)
    assert hp.derive_truncated_site("bybit", [*window, stuck_cursor]) == "bybit_stalled_page"


def test_a_full_page_at_one_millisecond_is_a_stalled_one_ms_page() -> None:
    window = _advancing_window(3)
    repeat = _log_call("again", reuse_of=window[0], step_ms=0)
    assert repeat.oldest_ts == repeat.newest_ts
    assert hp.derive_truncated_site("bybit", [*window, repeat]) == "bybit_stalled_one_ms"


def test_a_stall_on_the_hundredth_call_is_the_stall_not_the_ceiling() -> None:
    ceiling = hp.er._BYBIT_WINDOW_PAGE_CEILING
    window = _advancing_window(ceiling - 1)
    stalled = _log_call("again", reuse_of=window[-1])
    assert len(window) + 1 == ceiling
    assert hp.derive_truncated_site("bybit", [*window, stalled]) == "bybit_stalled_page"
    # Control: the same hundred calls, every page advancing, is the ceiling.
    assert hp.derive_truncated_site("bybit", _advancing_window(ceiling)) == "bybit_window_ceiling"


def test_a_window_ended_short_of_the_ceiling_without_a_stall_is_unknown() -> None:
    assert hp.derive_truncated_site("bybit", _advancing_window(37)) == "unknown"
    assert hp.derive_truncated_site("okx", _advancing_window(hp.er._BYBIT_WINDOW_PAGE_CEILING)) == "unknown"
    assert hp.derive_truncated_site("bybit", []) == "unknown"
    # A short last page is not a stall: only a FULL page can have stopped with fills unread.
    short = _log_call("short", rows=40)
    assert hp.derive_truncated_site("bybit", [*_advancing_window(3), short]) == "unknown"


def test_the_last_window_is_the_trailing_calls_that_share_one_since() -> None:
    calls = [
        *_advancing_window(5, since=1_000),
        *_advancing_window(7, since=2_000),
        *_advancing_window(4, since=3_000),
    ]
    assert hp.last_window_calls(calls) == 4
    assert hp.last_window_calls(calls[:12]) == 7
    assert hp.last_window_calls([]) == 0


def test_a_typed_site_on_the_exception_wins_over_the_call_log() -> None:
    ceiling_log = _advancing_window(hp.er._BYBIT_WINDOW_PAGE_CEILING)
    assert hp.derive_truncated_site("bybit", ceiling_log) == "bybit_window_ceiling"  # the log alone

    typed = _deployed_truncated()
    typed.site = "bybit_segment_ceiling"
    assert hp.truncated_site_of(typed, "bybit", ceiling_log) == "bybit_segment_ceiling"

    drifted = _deployed_truncated()
    drifted.site = "a_site_nobody_declared"
    assert "a_site_nobody_declared" not in hp._TRUNCATED_SITES
    assert hp.truncated_site_of(drifted, "bybit", ceiling_log) == "unknown"

    untyped = _deployed_truncated()
    assert hp.truncated_site_of(untyped, "bybit", ceiling_log) == "bybit_window_ceiling"


@pytest.mark.parametrize(
    ("days", "bucket"),
    [
        (0, "0-29"),
        (29, "0-29"),
        (30, "30-89"),
        (89, "30-89"),
        (90, "90-179"),
        (179, "90-179"),
        (180, "180-364"),
        (364, "180-364"),
        (365, "365-546"),
        (546, "365-546"),
        (547, "547-729"),
        (729, "547-729"),
        (730, "730+"),
    ],
)
def test_window_age_buckets_have_closed_edges(days: int, bucket: str) -> None:
    assert hp.window_age_bucket(_ms(_TODAY) - days * 86_400_000, _TODAY) == bucket
    assert bucket in hp._WINDOW_AGE_BUCKETS


def test_a_window_with_no_known_start_has_no_age_bucket() -> None:
    assert hp.window_age_bucket(None, _TODAY) == "none"


@pytest.mark.parametrize("kind", ["rejected", "timeout"])
async def test_a_member_that_failed_for_another_reason_records_no_site(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], kind: str
) -> None:
    import ccxt

    if kind == "timeout":
        monkeypatch.setattr("services.equity_reconstruction._RECONSTRUCT_CRAWL_TIMEOUT_S", 0.05)
        venue = _StubVenue([[]], hang=True)
    else:
        venue = _StubVenue([[]], fetch_effect=ccxt.AuthenticationError("fake rejection"))
    services = _Services(_bybit_only_book(), [venue])
    services.install(monkeypatch)

    assert await hp.run() == 1
    account, _summary = _stdout_records(capsys)
    assert account["failure_class"] != "truncated" and account["members_failed"] == 1
    assert (account["truncated_site"], account["last_window_age_bucket"]) == ("none", "none")
    assert account["last_window_calls"] == 0


async def test_read_elapsed_seconds_are_whole_seconds_from_the_monotonic_seam(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    clock = iter([100.0, 112.7])
    services = _Services(_okx_only_book(), [_StubVenue([_trade_page("ok", 5, newest_ms=_ms(_TODAY))])])
    services.install(monkeypatch)
    monkeypatch.setattr(hp, "_monotonic", lambda: next(clock))

    assert await hp.run() == 0
    account, _summary = _stdout_records(capsys)
    assert account["read_elapsed_s"] == 12  # floored, not rounded to 13


def test_the_emitter_refuses_an_out_of_vocabulary_site_or_bucket() -> None:
    rec = hp._account_record("a1", "2026-10-23")
    hp.emit_record(rec)  # control: the defaults print
    for key, value in (
        ("truncated_site", "ceiling"),
        ("last_window_age_bucket", "400"),
        ("last_window_calls", -1),
        ("read_elapsed_s", 1.5),
    ):
        with pytest.raises(ValueError) as exc:
            hp.emit_record(dict(rec, **{key: value}))
        assert key in str(exc.value)
        assert str(value) not in str(exc.value).replace(key, "")


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


# ---------------------------------------------------------------------------
# Phase 172 OKXANCHOR plan 02: the anchor diagnostic (D-01 item 1 and item 2).
#
# A forced OKX rebuild refused ``anchor_skipped_implausible`` says only THAT the replay
# ended far below today's equity, not WHY. The probe measures the cause, read-only and
# inside its redaction contract, so that the decision to anchor (plan 04) rests on a
# reading of the real account and not on a guess. These tests prove the probe can see
# that cause on fakes, that the refusal and the forced pass's counters are unchanged by
# looking, and that nothing but counts, booleans, tokens and 3-figure ratios is printed.
# ---------------------------------------------------------------------------

from services import okx_opening_balance as obal  # noqa: E402
from tests._okx_bills import (  # noqa: E402 - grouped with the section that uses them
    OkxBillsArchive,
    okx_balance_payload,
    okx_bill,
    okx_bill_chain,
    okx_detail,
)

# Distinctive synthetic amounts: a substring search for one of these in the output
# cannot be confused with a count or a ratio's digits.
_ANCHOR_TOTAL_EQ = "70000"
_ANCHOR_OPENING_USDT = "60000"
_OPENING_DAY = _TODAY - timedelta(days=7)
_ANCHOR_WINDOW = (_TODAY - timedelta(days=20), 21)


class _OkxAnchorVenue(_StubVenueWithTransfers):
    """An OKX client that also answers the two raw GETs the diagnostic reads."""

    def __init__(
        self,
        pages: list[list[dict[str, Any]]],
        *,
        balance: Any,
        bills: OkxBillsArchive,
        deposits: list[dict[str, Any]] | None = None,
        order_raw: Any = None,
        order_effect: BaseException | None = None,
    ) -> None:
        super().__init__(
            pages,
            deposits=deposits or [],
            withdrawals=[],
            order_raw=order_raw,
            order_effect=order_effect,
        )
        self._balance = balance
        self.bills = bills
        self.balance_calls = 0

    async def private_get_account_balance(self) -> Any:
        self.balance_calls += 1
        return self._balance

    async def private_get_account_bills_archive(self, params: dict[str, str]) -> Any:
        return await self.bills(params)


def _opening_bills(*, with_transfer: bool = False) -> OkxBillsArchive:
    """One USDT bill before the opening day (so the archive reaches it) and, since 00:00 UTC
    of the opening day, a USDT chain opening at 60000 that ends at 20000 and a BTC chain
    opening at 0 that ends at 1."""
    opening_ms = _ms(_OPENING_DAY)
    before = okx_bill(1, opening_ms - 5 * 86_400_000, "USDT", "60000", "5")
    if with_transfer:
        usdt = [
            okx_bill(10, opening_ms + 3_600_000, "USDT", "62500", "2500", bill_type="1"),
            okx_bill(12, opening_ms + 9_000_000, "USDT", "20000", "-42500"),
        ]
    else:
        usdt = okx_bill_chain(
            "USDT", _ANCHOR_OPENING_USDT, ["-40000"], first_id=10, first_ts=opening_ms + 3_600_000
        )
    btc = okx_bill_chain("BTC", "0", ["1"], first_id=11, first_ts=opening_ms + 7_200_000)
    return OkxBillsArchive([before, *usdt, *btc])


def _anchor_balance(**kw: Any) -> Any:
    return okx_balance_payload(
        _ANCHOR_TOTAL_EQ,
        [
            okx_detail("USDT", "20000", eq_usd="20000"),
            okx_detail("BTC", "1", eq_usd="50000"),
        ],
        **kw,
    )


def _advisory_rows() -> list[dict[str, Any]]:
    """The unanchored replay the advisory pass returns: the opening day, then the end date."""
    return [
        {"asof": _OPENING_DAY.isoformat(), "value_usd": 9000.0, "breakdown": {"USDT": 9000.0}},
        {
            "asof": _TODAY.isoformat(),
            "value_usd": 10000.0,
            "breakdown": {"BTC": 50000.0, "USDT": -40000.0},
        },
    ]


def _refusing_reader(
    *,
    pages_per_pass: int,
    telemetry: dict[str, Any] | None = None,
    rows: list[dict[str, Any]] | None = None,
    fills_per_pass: list[dict[str, Any]] | None = None,
    deposits_per_pass: int = 0,
    advisory_inst_type: str = "swap",
) -> Any:
    """The rebuild's read as the forced pass meets it on an implausible OKX anchor: it drives
    the venue the way the real loop does, then refuses when the anchor is required. Called
    without it (the diagnostic's advisory pass) it returns the unanchored replay."""
    advisory_telemetry = (
        {"anchor_offset_implausible": True, "skipped_symbols": []} if telemetry is None else telemetry
    )

    async def _read(
        exchange: Any,
        venue: str,
        supabase: Any,
        start: date,
        end: date,
        *,
        require_anchor: bool = False,
    ) -> Any:
        # The forced pass is always "swap"; the advisory pass (no ``require_anchor``) may meet
        # another instrument type, to prove the ordering read never takes its type from there.
        inst_type = "swap" if require_anchor else advisory_inst_type
        for i in range(pages_per_pass):
            page = await exchange.fetch_my_trades(None, _ms(start), 500, {"type": inst_type})
            assert isinstance(page, list)
        for _ in range(deposits_per_pass):
            await exchange.fetch_deposits(None, _ms(start), 500, {})
        if require_anchor:
            raise er.ForcedRebuildRefusedError("anchor_skipped_implausible")
        return (_advisory_rows() if rows is None else rows), False, advisory_telemetry

    return _read


async def test_an_implausible_okx_refusal_is_measured_and_still_refused(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # The forced pass reads two pages. The diagnostic's second pass reads two more through
    # the very same wrapped client; the TRADEPAGES counters must still say two.
    pages = [
        _trade_page("fa", 3, newest_ms=_ms(_TODAY)),
        _trade_page("fb", 2, newest_ms=_ms(_TODAY) - 10**9),
        _trade_page("ga", 4, newest_ms=_ms(_TODAY)),
        _trade_page("gb", 5, newest_ms=_ms(_TODAY) - 10**9),
    ]
    okx = _OkxAnchorVenue(pages, balance=_anchor_balance(), bills=_opening_bills())
    services = _Services(_okx_only_book(), [okx], window=_ANCHOR_WINDOW)
    services.reader = _refusing_reader(pages_per_pass=2)
    services.install(monkeypatch)

    assert await hp.run() == 1  # the member stays refused, so the run still fails
    captured = capsys.readouterr()
    account, _summary = (json.loads(line) for line in captured.out.splitlines() if line.strip())

    assert account["member_refusal"] == "anchor_skipped_implausible"
    assert (account["members_read"], account["members_failed"]) == (0, 1)
    assert account["failure_class"] == "none" and account["comparable"] is False

    assert account["anchor_diagnostic"] == "run" and account["diagnostic_members"] == 1
    assert account["diagnostic_failure_class"] == "none"
    assert account["advisory_arm"] == "implausible"  # the second pass repeated the refusal's cause
    assert account["replay_final_sign"] == "positive"
    assert account["anchor_over_replay"] == 7.0  # 70000 / 10000
    assert account["opening_check"] == "measured" and account["opening_unavailable_reason"] == "none"
    assert account["implied_opening_over_anchor"] == 0.857  # (70000 - 10000) / 70000
    assert account["bills_opening_over_anchor"] == 0.857  # 60000 / 70000, from the venue's own bills
    assert account["opening_residual_over_anchor"] == 0.0

    # Pitfall 8: the counters are the forced pass's, not doubled by the second pass.
    assert account["trade_calls"] == 2
    assert account["trades_read"] == 5
    assert account["first_page_rows"] == 3  # one "swap" pass: its first call, the one without ``until``
    assert [a.require_anchor for a in services.read_args] == [True, None]
    assert [a.wrapped for a in services.read_args] == [True, True]
    assert okx.balance_calls == 1
    assert services.supabase.writes == []

    everything = captured.out + captured.err
    for leak in (_ANCHOR_TOTAL_EQ, _ANCHOR_OPENING_USDT, "19987", _KEY_OKX, "fake-trade"):
        assert leak not in everything, leak


def _refusal_pages() -> list[list[dict[str, Any]]]:
    """Two swap pages for the forced pass, then two for the diagnostic's advisory pass."""
    return [
        _trade_page("fa", 3, newest_ms=_ms(_TODAY)),
        _trade_page("fb", 2, newest_ms=_ms(_TODAY) - 10**9),
        _trade_page("ga", 4, newest_ms=_ms(_TODAY)),
        _trade_page("gb", 5, newest_ms=_ms(_TODAY) - 10**9),
    ]


async def test_a_refused_okx_member_carries_an_ordering_reading(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Phase 173 D-01. The raw fills-history read used to sit AFTER the anchored rebuild read, and
    # a refusal raised out of that read first, so a refused member (the only OKX account in PROD)
    # could never be measured: ``okx_order_readings`` stayed 0 and the TRADEPAGES gate stayed
    # ``unmeasured`` for a reason that had nothing to do with ordering.
    window = _ANCHOR_WINDOW
    expected_call = {
        "instType": "SWAP",
        "begin": str(_ms(window[0])),
        "end": str(_ms(_TODAY + timedelta(days=1))),
        "limit": "100",
    }

    for answer, violations in ((_newest_page(), 0), (_fills("100", "200", "300"), 1)):
        okx = _OkxAnchorVenue(
            _refusal_pages(), balance=_anchor_balance(), bills=_opening_bills(), order_raw=answer
        )
        services = _Services(_okx_only_book(), [okx], window=window)
        services.reader = _refusing_reader(pages_per_pass=2)
        services.install(monkeypatch)

        assert await hp.run() == 1  # the member stays refused, so the run still fails
        account, summary = _stdout_records(capsys)

        assert account["member_refusal"] == "anchor_skipped_implausible"
        assert okx.raw_calls == [expected_call]  # one read, on the forced pass's type
        assert (account["okx_order_readings"], account["okx_order_violations"]) == (1, violations)
        assert account["okx_order_failure_class"] == "none"
        assert account["okx_members_with_trades"] == 1
        # A refused OKX member now yields ``ok`` or ``violated``, never ``unmeasured``.
        assert summary["okx_order_gate"] == ("violated" if violations else "ok")
        # The raw read is not a forced-pass call: the counters are unchanged by it.
        assert (account["trade_calls"], account["trades_read"], account["first_page_rows"]) == (2, 5, 3)

    # A refusal whose reason is outside the vocabulary is a failure of class "other", and the
    # member still holds its forced pass's trades, so it carries the reading too.
    async def _undeclared_refusal(
        exchange: Any, venue: str, supabase: Any, start: date, end: date, **_k: Any
    ) -> Any:
        for _ in range(2):
            await exchange.fetch_my_trades(None, _ms(start), 500, {"type": "swap"})
        raise er.ForcedRebuildRefusedError("a token nobody declared 4321.5")

    other = _StubVenue(
        [_trade_page("fa", 3, newest_ms=_ms(_TODAY)), _trade_page("fb", 2, newest_ms=_ms(_TODAY) - 10**9)],
        order_raw=_newest_page(),
    )
    services = _Services(_okx_only_book(), [other], window=window)
    services.reader = _undeclared_refusal
    services.install(monkeypatch)
    assert await hp.run() == 1
    captured = capsys.readouterr()
    account = json.loads(captured.out.splitlines()[0])
    assert account["failure_class"] == "other" and account["member_refusal"] == "none"
    assert other.raw_calls == [expected_call]
    assert (account["okx_order_readings"], account["okx_order_violations"]) == (1, 0)
    assert "4321.5" not in captured.out + captured.err


async def test_the_refused_members_ordering_read_uses_the_forced_pass_instrument_type(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # The diagnostic's advisory pass runs through the same wrapped client and here reads MORE
    # rows on another instrument type. The ordering read must still describe the forced pass:
    # choosing the type from the live recorder, or after the diagnostic, would pick FUTURES.
    pages = [
        _trade_page("fa", 3, newest_ms=_ms(_TODAY)),
        _trade_page("fb", 2, newest_ms=_ms(_TODAY) - 10**9),
        _trade_page("ga", 40, newest_ms=_ms(_TODAY)),
        _trade_page("gb", 50, newest_ms=_ms(_TODAY) - 10**9),
    ]
    okx = _OkxAnchorVenue(
        pages, balance=_anchor_balance(), bills=_opening_bills(), order_raw=_newest_page()
    )
    services = _Services(_okx_only_book(), [okx], window=_ANCHOR_WINDOW)
    services.reader = _refusing_reader(pages_per_pass=2, advisory_inst_type="futures")
    services.install(monkeypatch)

    assert await hp.run() == 1
    account, _summary = _stdout_records(capsys)

    assert account["anchor_diagnostic"] == "run"  # the advisory pass really ran
    assert [call["instType"] for call in okx.raw_calls] == ["SWAP"]
    assert (account["okx_order_readings"], account["okx_order_violations"]) == (1, 0)
    assert (account["trade_calls"], account["trades_read"]) == (2, 5)


async def test_a_raw_order_read_that_raises_leaves_the_refusal_and_names_its_class(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    import ccxt

    hostile = ccxt.BadRequest("fake okx fills-history 4321.5 signature=abc123")
    okx = _OkxAnchorVenue(
        _refusal_pages(), balance=_anchor_balance(), bills=_opening_bills(), order_effect=hostile
    )
    services = _Services(_okx_only_book(), [okx], window=_ANCHOR_WINDOW)
    services.reader = _refusing_reader(pages_per_pass=2)
    services.install(monkeypatch)

    assert await hp.run() == 1  # still refused: the side measurement changed nothing
    captured = capsys.readouterr()
    account, summary = (json.loads(line) for line in captured.out.splitlines() if line.strip())

    assert summary["record"] == "summary"  # nothing was hidden
    assert account["member_refusal"] == "anchor_skipped_implausible"
    assert (account["members_read"], account["members_failed"]) == (0, 1)
    assert account["failure_class"] == "none"
    assert len(okx.raw_calls) == 1  # it was attempted
    assert (account["okx_order_readings"], account["okx_order_violations"]) == (0, 0)
    assert account["okx_order_failure_class"] == "BadRequest"
    assert account["anchor_diagnostic"] == "run"  # the diagnostic is not skipped by it
    for leak in ("4321.5", "signature", "abc123", "fills-history"):
        assert leak not in captured.out + captured.err, leak


def _anchoring_reader(*, agreed: bool, advisory_inst_type: str = "swap") -> Any:
    """The rebuild's read when the forced pass is NOT refused: with ``agreed`` the anchor passed
    the 5x gate only through the bills check (``anchor_opening_agreed``); without it the anchor
    never tripped the gate. The advisory (second) pass is the unanchored replay, and may meet another
    instrument type than the forced pass's ``swap``."""
    forced_telemetry = (
        {"anchor_opening_agreed": True, "anchor_opening_check": "agreed", "skipped_symbols": []}
        if agreed
        else {"anchor_opening_agreed": False, "anchor_opening_check": "not-run", "skipped_symbols": []}
    )

    async def _read(
        exchange: Any,
        venue: str,
        supabase: Any,
        start: date,
        end: date,
        *,
        require_anchor: bool = False,
    ) -> Any:
        inst_type = "swap" if require_anchor else advisory_inst_type
        for _ in range(2):
            await exchange.fetch_my_trades(None, _ms(start), 500, {"type": inst_type})
        if require_anchor:
            return _advisory_rows(), False, forced_telemetry
        return _advisory_rows(), False, {"anchor_offset_implausible": True, "skipped_symbols": []}

    return _read


async def test_the_agreed_anchors_ordering_read_uses_the_forced_pass_instrument_type(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Review WR-03. a4 takes this arm once its bills chain is fixed, and its reading is the one that
    # decides ``okx-order:``. The diagnostic's advisory pass runs through the same wrapped client and
    # here reads MORE rows on another instrument type: an ordering read taken from the live recorder,
    # or after the diagnostic, would be made on FUTURES and describe the advisory pass.
    pages = [
        _trade_page("fa", 3, newest_ms=_ms(_TODAY)),
        _trade_page("fb", 2, newest_ms=_ms(_TODAY) - 10**9),
        _trade_page("ga", 40, newest_ms=_ms(_TODAY)),
        _trade_page("gb", 50, newest_ms=_ms(_TODAY) - 10**9),
    ]
    okx = _OkxAnchorVenue(
        pages, balance=_anchor_balance(), bills=_opening_bills(), order_raw=_newest_page()
    )
    services = _Services(_okx_only_book(), [okx], window=_ANCHOR_WINDOW)
    services.reader = _anchoring_reader(agreed=True, advisory_inst_type="futures")
    services.install(monkeypatch)

    assert await hp.run() == 0
    account, _summary = _stdout_records(capsys)

    assert account["member_refusal"] == "none" and account["members_read"] == 1
    assert account["anchor_diagnostic"] == "run"  # the advisory pass really ran
    assert [call["instType"] for call in okx.raw_calls] == ["SWAP"]
    assert (account["okx_order_readings"], account["okx_order_violations"]) == (1, 0)
    assert account["trade_calls"] == 2  # the forced pass's, not doubled by the advisory pass


async def test_an_okx_anchor_that_passed_through_the_bills_check_prints_the_oracle_reading(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Review WR-02: the OKX tolerance is re-measured from the probe's record, and an anchored
    # member is the very case that re-measures it. Its record must say the oracle ran, not
    # print the default ``not-run`` beside a residual of ``field-absent``.
    pages = [
        _trade_page("fa", 3, newest_ms=_ms(_TODAY)),
        _trade_page("fb", 2, newest_ms=_ms(_TODAY) - 10**9),
        _trade_page("ga", 4, newest_ms=_ms(_TODAY)),
        _trade_page("gb", 5, newest_ms=_ms(_TODAY) - 10**9),
    ]
    okx = _OkxAnchorVenue(pages, balance=_anchor_balance(), bills=_opening_bills())
    services = _Services(_okx_only_book(), [okx], window=_ANCHOR_WINDOW)
    services.reader = _anchoring_reader(agreed=True)
    services.install(monkeypatch)

    await hp.run()
    captured = capsys.readouterr()
    account, _summary = (json.loads(line) for line in captured.out.splitlines() if line.strip())

    assert account["member_refusal"] == "none" and account["members_read"] == 1
    assert account["anchor_diagnostic"] == "run" and account["diagnostic_members"] == 1
    assert account["advisory_arm"] == "implausible"
    assert account["opening_check"] == "measured" and account["opening_unavailable_reason"] == "none"
    assert account["implied_opening_over_anchor"] == 0.857
    assert account["bills_opening_over_anchor"] == 0.857
    assert account["opening_residual_over_anchor"] == 0.0
    assert account["bills_read"] == 2  # the USDT and BTC bills since the opening day
    assert account["bal_over_cashbal"] == 1.0

    # Pitfall 8: the second pass does not double the forced pass's counters.
    assert account["trade_calls"] == 2
    assert account["trades_read"] == 5
    assert [a.require_anchor for a in services.read_args] == [True, None]
    assert services.supabase.writes == []

    everything = captured.out + captured.err
    for leak in (_ANCHOR_TOTAL_EQ, _ANCHOR_OPENING_USDT, "19987", _KEY_OKX, "fake-trade"):
        assert leak not in everything, leak


async def test_an_okx_anchor_that_never_tripped_the_gate_pays_for_no_second_pass(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    okx = _OkxAnchorVenue(
        [_trade_page("fa", 3, newest_ms=_ms(_TODAY)), _trade_page("fb", 2, newest_ms=_ms(_TODAY) - 10**9)],
        balance=_anchor_balance(),
        bills=_opening_bills(),
    )
    services = _Services(_okx_only_book(), [okx], window=_ANCHOR_WINDOW)
    services.reader = _anchoring_reader(agreed=False)
    services.install(monkeypatch)

    await hp.run()
    account, _summary = _stdout_records(capsys)
    assert account["anchor_diagnostic"] == "not-run" and account["opening_check"] == "not-run"
    assert account["diagnostic_members"] == 0
    assert [a.require_anchor for a in services.read_args] == [True]
    assert okx.balance_calls == 0


async def test_no_diagnostic_for_another_refusal_or_another_venue(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # An OKX member refused for another reason, and a Bybit member refused for the same
    # reason, are not measured: the diagnostic exists for OKX's implausible anchor only.
    unreadable = _OkxAnchorVenue([[]], balance=_anchor_balance(), bills=_opening_bills())
    bybit = _OkxAnchorVenue([[]], balance=_anchor_balance(), bills=_opening_bills())
    book = {
        "api_keys": [
            _key_row(_KEY_OKX, _USER_ONE, "okx", "2026-01-01T00:00:00Z"),
            _key_row(_KEY_BYBIT, _USER_TWO, "bybit", "2026-02-01T00:00:00Z"),
        ],
        "allocator_equity_snapshots": [],
    }
    services = _Services(book, [unreadable, bybit], window=_ANCHOR_WINDOW)
    reasons = iter(["anchor_unreadable", "anchor_skipped_implausible"])

    async def _refuse(*_a: Any, **_k: Any) -> Any:
        raise er.ForcedRebuildRefusedError(next(reasons))

    services.reader = _refuse
    services.install(monkeypatch)

    assert await hp.run() == 1
    a1, a2, _summary = _stdout_records(capsys)
    assert (a1["member_refusal"], a2["member_refusal"]) == ("anchor_unreadable", "anchor_skipped_implausible")
    for account in (a1, a2):
        assert account["anchor_diagnostic"] == "not-run"
        assert account["opening_check"] == "not-run"
        assert account["diagnostic_members"] == 0
        assert account["advisory_arm"] == "not-run"
        for ratio in (
            "anchor_over_replay",
            "implied_opening_over_anchor",
            "bills_opening_over_anchor",
            "opening_residual_over_anchor",
        ):
            assert account[ratio] == "field-absent", ratio
        for reading in (
            "non_stable_share",
            "upl_over_anchor",
            "bot_equity_share",
            "bal_over_cashbal",
            "bills_transfer_net_over_anchor",
            "flip_from_flat_closes",
            "hedge_mode_fills",
            "negative_qty_assets",
            "flow_events_in_window",
            "skipped_symbols_count",
            "bills_read",
            "blank_inst_type_bills",
            "negative_stable_cash",
            "breakdown_truncated",
            "opening_day_is_window_start",
        ):
            assert account[reading] == "field-absent", reading  # not measured is never printed as 0
    assert unreadable.balance_calls == 0 and bybit.balance_calls == 0
    assert unreadable.bills.calls == [] and bybit.bills.calls == []


# ---------------------------------------------------------------------------
# The rest of D-01's readings (task 2): what each pure reader says on a hand-built input,
# and that the whole reading reaches the record without costing the refusal.
# ---------------------------------------------------------------------------


def _balance_row(total_eq: str, details: list[dict[str, str]], *, upl: str = "0") -> Any:
    return okx_balance_payload(total_eq, details, upl=upl)["data"][0]


def test_balance_row_readings() -> None:
    # Why: the 5x gate cannot tell a large pre-window balance from a lossy replay. A big
    # non-stable share, a large uPnL share or a bot-held share each say where the replay's
    # blind spot could sit; each must read right on a hand-checkable row.
    row = _balance_row(
        "1000",
        [
            okx_detail("USDT", "600", eq_usd="600"),
            okx_detail("BTC", "0.01", eq_usd="400", stgy_eq="0.002"),
        ],
        upl="-50",
    )
    assert hp.balance_row_readings(row) == {
        "non_stable_share": 0.4,
        "upl_over_anchor": -0.05,
        "bot_equity_share": 0.08,  # 0.002 / 0.01 of BTC's 400 is 80, over 1000
    }

    # A simple-mode account has no account-level uPnL: unread, never 0.
    simple = hp.balance_row_readings(_balance_row("1000", row["details"], upl=""))
    assert simple["upl_over_anchor"] == "field-absent" and simple["non_stable_share"] == 0.4

    # An unreadable eqUsd on a non-stable currency makes the share unknown, not zero.
    broken = [dict(d) for d in row["details"]]
    broken[1]["eqUsd"] = "n/a"
    assert hp.balance_row_readings(_balance_row("1000", broken, upl="-50"))["non_stable_share"] == "field-absent"

    # No row, a non-positive total or a malformed details list: nothing is invented.
    absent = {"non_stable_share": "field-absent", "upl_over_anchor": "field-absent", "bot_equity_share": "field-absent"}
    assert hp.balance_row_readings(None) == absent
    assert hp.balance_row_readings(_balance_row("0", row["details"])) == absent
    assert hp.balance_row_readings({"totalEq": "1000", "upl": "0", "details": "nope"})["non_stable_share"] == "field-absent"


def _fill(
    fill_id: str,
    ts: int,
    side: str,
    amount: float,
    pnl: str | None,
    *,
    symbol: str = "BTC/USDT:USDT",
    pos_side: str | None = None,
) -> dict[str, Any]:
    info: dict[str, Any] = {}
    if pnl is not None:
        info["fillPnl"] = pnl
    if pos_side is not None:
        info["posSide"] = pos_side
    return {"id": fill_id, "timestamp": ts, "symbol": symbol, "side": side, "amount": amount, "info": info}


def test_flip_from_flat_closes_counts_closes_of_positions_opened_before_the_window() -> None:
    # Why: a position opened before the window and closed inside it realises a pnl with no
    # opening fill in the replay, so the replay never held it - one way its level goes
    # missing. A fill that realises pnl while the replay's own position is flat is that
    # signature. It is a LOWER BOUND: a partial close of a pre-window position that follows
    # an in-window open of the same instrument looks like an ordinary close and is missed.
    fills = [
        _fill("1", 1, "sell", 2, "15"),  # the replay is flat, yet this realises pnl: counted
        _fill("2", 2, "buy", 1, "0"),  # opens in-window
        _fill("3", 3, "sell", 1, "3"),  # closes the in-window open: not counted
    ]
    assert hp.flip_from_flat_closes(fills) == 1
    # Arrival order does not matter: fills are read in time order.
    assert hp.flip_from_flat_closes(list(reversed(fills))) == 1
    # The same fill re-read on an overlapping page counts once.
    assert hp.flip_from_flat_closes([*fills, dict(fills[0])]) == 1
    # Another instrument keeps its own running size.
    assert hp.flip_from_flat_closes([*fills, _fill("1", 4, "sell", 1, "4", symbol="ETH/USDT:USDT")]) == 2
    # Nothing carrying a readable realised pnl: the reading is unknown, not zero.
    assert hp.flip_from_flat_closes([_fill("1", 1, "sell", 2, None), _fill("2", 2, "buy", 1, "")]) == "field-absent"
    assert hp.flip_from_flat_closes([]) == "field-absent"


def test_hedge_mode_fills_counts_long_and_short_pos_sides() -> None:
    # Why: hedge-mode legs net against each other in the replay's single running size per
    # instrument, which misstates the level; the count sizes that exposure.
    fills = [
        _fill("1", 1, "buy", 1, None, pos_side="long"),
        _fill("2", 2, "sell", 1, None, pos_side="short"),
        _fill("3", 3, "buy", 1, None, pos_side="net"),
        _fill("4", 4, "buy", 1, None),
    ]
    assert hp.hedge_mode_fills(fills) == 2
    assert hp.hedge_mode_fills([fills[2]]) == 0  # posSide is readable and none is hedged
    assert hp.hedge_mode_fills([fills[3]]) == "field-absent"  # no posSide at all: unknown
    assert hp.hedge_mode_fills([]) == "field-absent"


def test_breakdown_readings() -> None:
    # Why: a negative quantity in the replay's last row (a sale with no recorded purchase)
    # is the replay losing value by construction; negative stable cash is the unfunded buy.
    last = {"BTC": 500.0, "ETH": -20.0, "USDT": -40000.0, "BTC:USDT:PERP": -3.0, "STARTING_BALANCE": 1.0}
    assert hp.breakdown_readings(last) == {
        "negative_qty_assets": 1,  # ETH only: a perp key, a protected key and a stable are not assets
        "negative_stable_cash": True,
        "breakdown_truncated": False,
    }
    assert hp.breakdown_readings({**last, "__truncated__": True})["breakdown_truncated"] is True
    assert hp.breakdown_readings({"BTC": 5.0, "USDT": 3.0}) == {
        "negative_qty_assets": 0,
        "negative_stable_cash": False,
        "breakdown_truncated": False,
    }
    assert hp.breakdown_readings(None) == {
        "negative_qty_assets": "field-absent",
        "negative_stable_cash": "field-absent",
        "breakdown_truncated": "field-absent",
    }


async def test_the_full_reading_reaches_the_record(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    forced = [
        _trade_page("fa", 2, newest_ms=_ms(_TODAY)),
        _trade_page("fb", 1, newest_ms=_ms(_TODAY) - 10**9),
    ]
    advisory = [
        [_fill("g1", _ms(_TODAY) - 3_000, "sell", 2, "15", pos_side="long")],
        [_fill("g2", _ms(_TODAY) - 2_000, "buy", 1, "0", pos_side="short")],
    ]
    deposit = {"id": "fake-transfer-d1", "timestamp": _ms(_TODAY) - 86_400_000}
    okx = _OkxAnchorVenue(
        [*forced, *advisory],
        balance=_anchor_balance(),
        bills=_opening_bills(with_transfer=True),
        deposits=[deposit],
    )
    services = _Services(_okx_only_book(), [okx], window=_ANCHOR_WINDOW)
    services.reader = _refusing_reader(
        pages_per_pass=2,
        telemetry={"anchor_offset_implausible": True, "skipped_symbols": ["FAKE-SKIPPED"]},
        deposits_per_pass=1,
    )
    services.install(monkeypatch)

    assert await hp.run() == 1
    captured = capsys.readouterr()
    account, _summary = (json.loads(line) for line in captured.out.splitlines() if line.strip())

    assert account["member_refusal"] == "anchor_skipped_implausible"
    assert account["anchor_diagnostic"] == "run"
    assert account["non_stable_share"] == 0.714  # 50000 of 70000
    assert account["upl_over_anchor"] == 0.0
    assert account["bot_equity_share"] == 0.0
    assert account["flip_from_flat_closes"] == 1  # the second pass's fills, not the forced pass's
    assert account["hedge_mode_fills"] == 2
    assert account["negative_qty_assets"] == 0
    assert account["negative_stable_cash"] is True
    assert account["breakdown_truncated"] is False
    assert account["flow_events_in_window"] == 1
    assert account["skipped_symbols_count"] == 1
    assert account["opening_day_is_window_start"] is False
    assert account["bills_read"] == 3
    assert account["blank_inst_type_bills"] == 0
    assert account["bal_over_cashbal"] == 1.0  # the newest USDT bill's bal over today's cash balance
    assert account["bills_transfer_net_over_anchor"] == 0.0357  # +2500 of 70000
    # The oracle still agrees with the gate here: the type-1 bill sits inside the curve.
    assert account["opening_check"] == "measured"
    assert account["implied_opening_over_anchor"] == account["bills_opening_over_anchor"] == 0.857
    assert account["opening_residual_over_anchor"] == 0.0
    assert account["trade_calls"] == 2  # still the forced pass only

    everything = captured.out + captured.err
    for leak in ("FAKE-SKIPPED", "fake-transfer", _ANCHOR_TOTAL_EQ, _ANCHOR_OPENING_USDT, "62500", "42500"):
        assert leak not in everything, leak


async def test_a_failed_bills_walk_keeps_the_ratios_already_measured(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Review SFH-04. The bills walk is the LAST thing the diagnostic reads; an error from it
    (here an authentication error, in the field a 429 that outlives the backoff) used to turn
    the whole diagnostic into "failed" and discard every ratio measured before it. The probe's
    purpose is to read an account the founder cannot otherwise inspect, so the oracle's failure
    is recorded as the opening check being unavailable, by exception CLASS, beside the ratios."""
    import ccxt

    bills = _opening_bills()
    bills.effect = ccxt.AuthenticationError(f"okx GET bills-archive 4321.5 {_KEY_OKX} signature=abc123")
    okx = _OkxAnchorVenue([[], [], [], []], balance=_anchor_balance(), bills=bills)
    services = _Services(_okx_only_book(), [okx], window=_ANCHOR_WINDOW)
    services.reader = _refusing_reader(pages_per_pass=2)
    services.install(monkeypatch)

    assert await hp.run() == 1
    captured = capsys.readouterr()
    account, _summary = (json.loads(line) for line in captured.out.splitlines() if line.strip())
    assert account["member_refusal"] == "anchor_skipped_implausible"
    assert (account["members_read"], account["members_failed"]) == (0, 1)
    assert account["anchor_diagnostic"] == "run"
    assert account["diagnostic_failure_class"] == "AuthenticationError"
    assert account["diagnostic_members"] == 1
    assert account["failure_class"] == "none"  # the member's own failure class is the refusal's: none
    # The ratios measured before the walk survive: 70000 of anchor over a 10000 replay.
    assert account["anchor_over_replay"] == 7.0
    assert account["advisory_arm"] == "implausible"
    assert account["opening_check"] == "unavailable"
    assert account["opening_unavailable_reason"] == "none"  # the oracle never answered
    for leak in ("4321.5", _KEY_OKX, "signature", "abc123", "bills-archive"):
        assert leak not in captured.out + captured.err, leak
    assert services.closed == [okx]  # the client is closed on this path too


async def test_a_walk_that_never_completed_reports_its_counters_as_field_absent(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Review SFH-R3-01. The oracle keeps ``bills_read``, ``blank_inst_type_bills`` and the
    stablecoin transfer net at their 0 defaults when the walk itself raises (here an empty
    second page: ``reach_unproven``). Copying them would print an empty archive for a walk
    that never finished, where the record's contract says not measured is ``field-absent``."""
    full = _opening_bills()
    bills = OkxBillsArchive([r for r in full.rows if r["billId"] != "1"], empty_after_cursor=True)
    okx = _OkxAnchorVenue([[], [], [], []], balance=_anchor_balance(), bills=bills)
    services = _Services(_okx_only_book(), [okx], window=_ANCHOR_WINDOW)
    services.reader = _refusing_reader(pages_per_pass=2)
    services.install(monkeypatch)

    assert await hp.run() == 1
    captured = capsys.readouterr()
    account, _summary = (json.loads(line) for line in captured.out.splitlines() if line.strip())
    assert account["opening_check"] == "unavailable"
    assert account["opening_unavailable_reason"] == "reach_unproven"
    assert account["bills_read"] == "field-absent"
    assert account["blank_inst_type_bills"] == "field-absent"
    assert account["bills_transfer_net_over_anchor"] == "field-absent"


async def test_a_completed_walk_keeps_its_counters_when_a_later_step_fails(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """The counterpart of the test above: a ``chain_break`` is raised after the walk finished,
    so the counters are real readings and must survive."""
    opening_ms = _ms(_OPENING_DAY)
    rows = [
        okx_bill(1, opening_ms - 5 * 86_400_000, "USDT", "60000", "5"),
        okx_bill(10, opening_ms + 3_600_000, "USDT", "60000", "0"),
        okx_bill(12, opening_ms + 9_000_000, "USDT", "1", "-40000"),  # 60000 - 40000 != 1
    ]
    okx = _OkxAnchorVenue([[], [], [], []], balance=_anchor_balance(), bills=OkxBillsArchive(rows))
    services = _Services(_okx_only_book(), [okx], window=_ANCHOR_WINDOW)
    services.reader = _refusing_reader(pages_per_pass=2)
    services.install(monkeypatch)

    assert await hp.run() == 1
    captured = capsys.readouterr()
    account, _summary = (json.loads(line) for line in captured.out.splitlines() if line.strip())
    assert account["opening_check"] == "unavailable"
    assert account["opening_unavailable_reason"] == "chain_break"
    assert account["bills_read"] == 2
    assert account["blank_inst_type_bills"] == 0


async def test_a_diagnostic_that_fails_before_the_oracle_never_hides_the_refusal(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A failure outside the oracle (the advisory pass itself) still loses the measurement:
    there is nothing to keep, so the diagnostic is "failed" by class and the refusal stands."""
    import ccxt

    async def _boom(*_args: Any, **_kwargs: Any) -> Any:
        raise ccxt.AuthenticationError(f"okx GET balance 4321.5 {_KEY_OKX} signature=abc123")

    okx = _OkxAnchorVenue([[], [], [], []], balance=_anchor_balance(), bills=_opening_bills())
    services = _Services(_okx_only_book(), [okx], window=_ANCHOR_WINDOW)
    services.reader = _refusing_reader(pages_per_pass=2)
    services.install(monkeypatch)
    monkeypatch.setattr(hp.obal, "read_okx_balance_row", _boom)

    assert await hp.run() == 1
    captured = capsys.readouterr()
    account, _summary = (json.loads(line) for line in captured.out.splitlines() if line.strip())
    assert account["member_refusal"] == "anchor_skipped_implausible"
    assert account["anchor_diagnostic"] == "failed"
    assert account["diagnostic_failure_class"] == "AuthenticationError"
    assert account["anchor_over_replay"] == "field-absent" and account["opening_check"] == "not-run"
    for leak in ("4321.5", _KEY_OKX, "signature", "abc123"):
        assert leak not in captured.out + captured.err, leak
    assert services.closed == [okx]


# ---------------------------------------------------------------------------
# Redaction and read-only pins for the diagnostic's keys (task 3).
# ---------------------------------------------------------------------------


def _diagnostic_control() -> dict[str, Any]:
    """An account record with every diagnostic key set to a valid value."""
    return hp._account_record(
        "a1",
        "2026-10-27",
        anchor_diagnostic="run",
        diagnostic_failure_class="none",
        diagnostic_members=1,
        advisory_arm="implausible",
        replay_final_sign="positive",
        anchor_over_replay=7.0,
        opening_check="measured",
        opening_unavailable_reason="none",
        implied_opening_over_anchor=0.857,
        bills_opening_over_anchor=0.857,
        opening_residual_over_anchor=0.0,
        non_stable_share=0.714,
        upl_over_anchor=-0.05,
        bot_equity_share=0.0,
        bal_over_cashbal=1.0,
        bills_transfer_net_over_anchor=0.0357,
        flip_from_flat_closes=1,
        hedge_mode_fills=2,
        negative_qty_assets=0,
        flow_events_in_window=1,
        skipped_symbols_count=1,
        bills_read=3,
        blank_inst_type_bills=0,
        negative_stable_cash=True,
        breakdown_truncated=False,
        opening_day_is_window_start=False,
    )


def test_the_diagnostic_keys_refuse_values_outside_their_vocabulary() -> None:
    # Why: the line is pasted into a public repo. A key that could carry an unrounded
    # ratio, a bool where a count belongs, a free-text reason or an exception message is a
    # place an amount can leak, and the emitter's refusal is the only thing standing there.
    control = _diagnostic_control()
    assert json.loads(hp.emit_record(control))["anchor_over_replay"] == 7.0  # the honest record prints

    bad: list[tuple[str, Any]] = [
        ("anchor_over_replay", 7.123456),  # not three figures
        ("opening_residual_over_anchor", "non-finite"),
        ("non_stable_share", float("inf")),
        ("bills_read", True),  # True where a count is declared
        ("bills_read", 3.0),
        ("flip_from_flat_closes", -1),
        ("skipped_symbols_count", "3"),
        ("negative_stable_cash", "yes"),
        ("opening_day_is_window_start", 0),
        ("opening_check", "agree"),  # agreement is not the probe's to decide
        ("opening_unavailable_reason", "timeout"),
        ("advisory_arm", "anchored"),
        ("replay_final_sign", "up"),
        ("anchor_diagnostic", "ran"),
        ("diagnostic_failure_class", "ExchangeError: 4321.5"),
        ("diagnostic_members", -1),
    ]
    for key, value in bad:
        with pytest.raises(ValueError) as exc:
            hp.emit_record(dict(control, **{key: value}))
        assert key in str(exc.value), key  # the refusal names the key...
        assert "4321" not in str(exc.value) and "7.12" not in str(exc.value)  # ...never the value

    # An extra key is refused too: nothing outside the whitelist can ride along.
    with pytest.raises(ValueError):
        hp.emit_record(dict(control, anchor_usd=70000.0))

    # The oracle's whole closed set, and "none", are printable; nothing else is.
    for reason in ("none", *sorted(obal.OPENING_UNAVAILABLE_REASONS)):
        hp.emit_record(dict(control, opening_unavailable_reason=reason))
    assert set(hp._OPENING_REASON_TOKENS) == {"none", *obal.OPENING_UNAVAILABLE_REASONS}


def test_ratio_or_absent_never_prints_a_non_finite_or_an_unrounded_value() -> None:
    absent = "field-absent"
    assert hp.ratio_or_absent(5.0, 0.0) == absent  # a zero denominator
    assert hp.ratio_or_absent(None, 5.0) == absent
    assert hp.ratio_or_absent(5.0, None) == absent
    assert hp.ratio_or_absent(float("inf"), 2.0) == absent  # an infinite quotient
    assert hp.ratio_or_absent(float("nan"), 2.0) == absent
    assert hp.ratio_or_absent(1.0, float("nan")) == absent
    assert hp.ratio_or_absent(6.0, 7.0) == 0.857  # three figures, not 0.857142...
    shown = hp.ratio_or_absent(-0.0, 5.0)
    assert shown == 0.0 and str(shown) == "0.0"  # never "-0.0"
    for numerator, denominator in ((1.0, 3.0), (2.0, 3.0), (123456.0, 7.0), (-5.0, 9.0)):
        value = hp.ratio_or_absent(numerator, denominator)
        assert isinstance(value, float) and hp._is_ratio(value)


def test_the_anchor_diagnostic_functions_take_the_read_only_wrapper() -> None:
    # Why: `_measure_anchor` hands its database handle to the rebuild's own read, whose one
    # write is the price cache. A function typed with the bare client could be handed one.
    import ast

    tree = ast.parse(_PROBE_SRC)
    typed = {
        node.name: arg.annotation.id
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name in ("_anchor_diagnostic", "_measure_anchor")
        for arg in node.args.args
        if arg.arg == "supabase" and isinstance(arg.annotation, ast.Name)
    }
    assert typed == {"_anchor_diagnostic": "ReadOnlySupabase", "_measure_anchor": "ReadOnlySupabase"}
    # The oracle is reached through its module attribute, and every call it makes is a GET.
    assert "obal.read_okx_balance_row(" in _PROBE_SRC and "obal.read_okx_opening(" in _PROBE_SRC
    assert "private_get_account_bills_archive" not in _PROBE_SRC  # the oracle owns that call


# ---------------------------------------------------------------------------
# Phase 179 OKXBILLSCHAIN: a chain_break names its arm, currency and kind.
#
# APPENDED at the very end of the file, and nothing above is edited: Phase 173 REBUILDGATES
# edits the fakes above (``_OkxAnchorVenue``, ``_refusing_reader``, ``_anchoring_reader``) in
# parallel, so a subclass and a builder placed after them merge without a conflict.
# ---------------------------------------------------------------------------


from typing import NamedTuple  # noqa: E402 - grouped with the section that uses them

from scripts import okx_chain_record  # noqa: E402
from tests._okx_bills import okx_subtypes_payload  # noqa: E402


class _ChainVenue(_OkxAnchorVenue):
    """An anchor venue whose i-th balance read answers the i-th payload (the last repeats).

    The diagnostic reads the balance once before the bills walk and once after it; the two
    reads differ here, which is what tells a cash balance that MOVED during the walk apart from
    a close that is structurally broken."""

    def __init__(
        self,
        pages: list[list[dict[str, Any]]],
        *,
        balances: list[Any],
        bills: OkxBillsArchive,
        healed: OkxBillsArchive | None = None,
        recent: OkxBillsArchive | None = None,
        subtypes: Any = None,
    ) -> None:
        super().__init__(pages, balance=balances[0], bills=bills)
        self.balances = balances
        self.healed = healed
        self.recent = recent
        self.subtypes = subtypes

    async def private_get_account_balance(self) -> Any:
        payload = self.balances[min(self.balance_calls, len(self.balances) - 1)]
        self.balance_calls += 1
        return payload

    async def private_get_account_bills_archive(self, params: dict[str, str]) -> Any:
        # The second walk reads a FRESH balance row first (the third balance read), so an archive
        # that has healed by then answers it: a break that was transient reads "none" on repeat.
        if self.healed is not None and self.balance_calls >= 3:
            return await self.healed(params)
        return await self.bills(params)

    async def private_get_account_bills(self, params: dict[str, str]) -> Any:
        """The 7-day ``/account/bills`` store."""
        assert self.recent is not None
        return await self.recent(params)

    async def private_get_account_subtypes(self, params: dict[str, str]) -> Any:
        return self.subtypes


class _ChainWorld(NamedTuple):
    archive: OkxBillsArchive
    healed: OkxBillsArchive
    balances: list[Any]
    recent: OkxBillsArchive
    subtypes: Any


def _chain_break_world() -> _ChainWorld:
    """The a4 shape on the test's own constants: USDT is first in walk order and breaks an
    INTERIOR link (61234 - 41237 is 19997, not 20000); BTC breaks the CLOSE against the cash
    balance read before the walk (0.9) and holds against the one read after it (1).

    ``healed`` differs from the archive only in bill 4444444012's change (61234 - 41234 is
    20000: the chain holds), so a second walk that reads it is a transient break. The pre-walk
    balance carries each currency's own clock: USDT's is a minute AFTER its newest bill, BTC's a
    minute BEFORE its newest bill. ``recent`` is the 7-day store: the three walked bills with
    their original values plus one newer USDT bill (4444444013) the walk never saw."""
    opening_ms = _ms(_OPENING_DAY)
    rows = [
        okx_bill(4444444001, opening_ms - 5 * 86_400_000, "USDT", "61234", "5"),
        okx_bill(4444444010, opening_ms + 3_600_000, "USDT", "61234", "0"),
        okx_bill(4444444011, opening_ms + 7_200_000, "BTC", "1", "1"),
        okx_bill(4444444012, opening_ms + 9_000_000, "USDT", "20000", "-41237"),
    ]
    archive = OkxBillsArchive(rows)
    healed = OkxBillsArchive([*rows[:3], {**rows[3], "balChg": "-41234"}])
    recent = OkxBillsArchive([*rows[1:], okx_bill(4444444013, opening_ms + 10_800_000, "USDT", "20007", "7")])

    def _payload(btc_cash: str, *, clocks: bool = False) -> Any:
        usdt_clock = str(opening_ms + 9_000_000 + 60_000) if clocks else None
        btc_clock = str(opening_ms + 7_200_000 - 60_000) if clocks else None
        return okx_balance_payload(
            "70000",
            [
                okx_detail("USDT", "20000", eq_usd="20000", u_time=usdt_clock),
                okx_detail("BTC", btc_cash, eq_usd="50000", u_time=btc_clock),
            ],
        )

    return _ChainWorld(
        archive,
        healed,
        [_payload("0.9", clocks=True), _payload("1"), _payload("1")],
        recent,
        okx_subtypes_payload({"2": ["1"], "8": ["173"]}),
    )


async def test_a_chain_break_is_named_by_arm_and_currency_and_the_refusal_stands(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Why: the oracle's token ``chain_break`` is one string for two conditions and stops at the
    # first failing currency (USDT, first in walk order), so only the diagnostic can see that
    # BTC's CLOSE breaks too. The read after the walk tells a cash balance that moved during
    # the walk apart from a close that is broken for good. Neither may change the verdict.
    world = _chain_break_world()
    venue = _ChainVenue(
        [[], [], [], []],
        balances=world.balances,
        bills=world.archive,
        healed=world.healed,
        recent=world.recent,
        subtypes=world.subtypes,
    )
    services = _Services(_okx_only_book(), [venue], window=_ANCHOR_WINDOW)
    services.reader = _refusing_reader(pages_per_pass=2)
    services.install(monkeypatch)
    # The probe stamps the wall clock just before the oracle's walk and hands it to measure_chain
    # (fix round 1, WR-01/WR-02). Pin that clock between the newest walked bill (+9_000_000 ms) and
    # bill 4444444013 (+10_800_000 ms): the latter is the one "stamped after the walk began". If the
    # probe stopped passing the stamp, measure_chain would fall back to the real clock, long after
    # every bill here, and the 7-day keys below would change.
    monkeypatch.setattr(hp, "time", SimpleNamespace(time=lambda: (_ms(_OPENING_DAY) + 10_000_000) / 1000))

    assert await hp.run() == 1  # the member stays refused
    captured = capsys.readouterr()
    account, _summary = (json.loads(line) for line in captured.out.splitlines() if line.strip())

    # The refusal, the oracle's own token and the forced pass's counters are unchanged.
    assert account["member_refusal"] == "anchor_skipped_implausible"
    assert account["opening_check"] == "unavailable"
    assert account["opening_unavailable_reason"] == "chain_break"
    assert account["bills_read"] == 3
    assert account["trade_calls"] == 2
    assert [a.require_anchor for a in services.read_args] == [True, None]
    assert services.supabase.writes == []

    # EVERY chain key, on values derived by hand from the world's constants. The loop is over the
    # expected dict, whose key set must equal CHAIN_KEYS: a key added later without an expectation
    # fails here instead of going unasserted.
    expected: dict[str, Any] = {
        # The arm, over EVERY currency, and the worst currency's closed class.
        "chain_diagnostic": "run",
        "chain_diagnostic_failure_class": "none",
        "chain_failed_step": "none",
        "chain_arm": "both",
        "chain_ccys_checked": 2,
        "chain_ccys_interior_broken": 1,
        "chain_ccys_close_broken": 1,
        "chain_interior_links": 1,
        "chain_interior_breaks": 1,
        "chain_worst_ccy": "USDT",
        "chain_worst_ccy_is_stable": True,
        # BTC's close broke against the pre-walk cash and holds against the post-walk cash.
        "chain_close_cash_moved": 1,
        "chain_close_matches_after": 1,
        # close 1 + second walk 2 (a balance read and one archive page) + below-stop 1 + 7-day 1
        # + subtypes 1 + the sweep's unfiltered page 1 + two type probes + six instType probes. Plan 179-01 asserted 1 here and 2
        # balance reads; the repeat adds a fresh balance read (three: before the walk, after it,
        # and the second walk's own).
        "chain_calls": 15,
        "chain_break_kinds": "2.x.SPOT:1",
        "chain_break_prev_kinds": "2.x.SPOT:1",
        "chain_break_mgn_modes": "blank:1",
        "chain_break_pos_level": 0,
        "chain_residual_bucket": "lt_1e-3",  # 3 over 61234
        "chain_close_residual_bucket": "ge_1e-1",  # 0.1 over 1
        "chain_sig_bal_unchanged": 0,
        "chain_sig_double_count": 0,
        "chain_sig_reorder": 0,
        "chain_sig_other": 1,
        # Ordering: no tie, no inversion, nothing to re-sort, nothing missing, one break at age 0.
        "chain_billid_ts_inversions": 0,
        "chain_same_ts_links": 0,
        "chain_same_ts_breaks": 0,
        "chain_trail_ccys": 2,
        "chain_closes_by_ts_id": 0,
        "chain_closes_by_ts_id_desc": 0,
        "chain_gap_estimate": 0,
        "chain_first_break_age": "lt_1h",
        "chain_last_break_age": "lt_1h",
        "chain_breaks_in_recent_7d": 1,
        # The balance clock: BTC's newest bill is after its clock, USDT's clock after its bill.
        "chain_close_bill_after_utime": 1,
        "chain_close_utime_after_bill": 1,
        # The second walk heals: transient on repeat, while the first reading stays chain_break.
        "chain_repeat_reason": "none",
        "chain_below_stop": 0,
        "chain_below_stop_ccys": 0,
        "chain_below_stop_complete": True,
        "chain_ceiling_hit": False,
        # The 7-day store: the three walked bills in both, one newer bill after the walk, the
        # store 30 minutes ahead of the walk.
        "chain_recent_read": 4,
        "chain_recent_complete": True,
        "chain_recent_both": 3,
        "chain_recent_only_bills": 0,
        "chain_recent_after_walk": 1,
        "chain_recent_only_archive": 0,
        "chain_recent_field_mismatch": 0,
        "chain_recent_only_bills_kinds": "none",
        "chain_archive_behind": "none",  # bill 4444444013 was stamped after the walk began: not archive lag (WR-02)
        # The sweep: two types (2 and 8) and six instTypes, nothing hidden, no full page.
        "chain_types_probed": 2,
        "chain_types_hidden": 0,
        "chain_inst_types_probed": 6,
        "chain_inst_types_hidden": 0,
        "chain_hidden_kinds": "none",
        "chain_sweep_partial": 0,
        "chain_sweep_complete": True,
        "chain_recent_refused": 0,
        "chain_sweep_refused": 0,
    }
    assert set(expected) == set(okx_chain_record.CHAIN_KEYS)
    for key, value in expected.items():
        assert account[key] == value, key
        assert type(account[key]) is type(value), key  # True is not 1
    assert venue.balance_calls == 3

    everything = captured.out + captured.err
    for leak in ("4444444", "61234", "41237", "19997", "20007", _KEY_OKX, "fake-trade"):
        assert leak not in everything, leak


async def test_a_chain_diagnostic_timeout_keeps_the_first_reading(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Why (SFH-179-06): the chain tail runs inside the probe's one crawl bound. A group that hangs
    # there must end by the chain's own deadline and be recorded as a Timeout at its step, so the
    # first reading's keys (the oracle's token, the counters, the ratios) are not discarded with it.
    world = _chain_break_world()
    venue = _ChainVenue(
        [[], [], [], []],
        balances=world.balances,
        bills=world.archive,
        healed=world.healed,
        recent=world.recent,
        subtypes=world.subtypes,
    )
    services = _Services(_okx_only_book(), [venue], window=_ANCHOR_WINDOW)
    services.reader = _refusing_reader(pages_per_pass=2)
    services.install(monkeypatch)

    async def _hangs(*args: Any, **kwargs: Any) -> Any:
        await asyncio.sleep(5)

    monkeypatch.setattr(okx_chain_record, "CHAIN_TIMEOUT_S", 0.05, raising=False)
    monkeypatch.setattr(okx_chain_record.chain, "read_below_stop", _hangs)

    assert await hp.run() == 1
    account, _summary = (json.loads(line) for line in capsys.readouterr().out.splitlines() if line.strip())

    assert account["anchor_diagnostic"] == "run"
    assert account["opening_check"] == "unavailable"
    assert account["opening_unavailable_reason"] == "chain_break"
    assert account["bills_read"] == 3
    assert account["chain_diagnostic_failure_class"] == "Timeout"
    assert account["chain_failed_step"] == "below_stop"
    assert account["chain_arm"] == "both"  # the analysis and the close group stay
    assert account["chain_close_matches_after"] == 1


async def test_a_chain_diagnostic_never_outlasts_what_is_left_of_the_outer_bound(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Why (review WR-04, SFH-R2-06): the chain's own 300 s deadline starts late in the probe's one
    # crawl bound. When the crawl and the walk have used most of that bound, a group that hangs would
    # be cancelled by the OUTER bound, which discards the whole first reading. The chain's deadline
    # must be what is left of the outer one, so the hang ends as a recorded Timeout and the first
    # reading (the oracle's token, the counters, the ratios) survives.
    world = _chain_break_world()
    venue = _ChainVenue(
        [[], [], [], []],
        balances=world.balances,
        bills=world.archive,
        healed=world.healed,
        recent=world.recent,
        subtypes=world.subtypes,
    )
    services = _Services(_okx_only_book(), [venue], window=_ANCHOR_WINDOW)
    services.reader = _refusing_reader(pages_per_pass=2)
    services.install(monkeypatch)

    async def _hangs(*args: Any, **kwargs: Any) -> Any:
        await asyncio.sleep(5)

    # The outer bound is already inside the chain's margin, and the chain's own deadline stays 300 s.
    monkeypatch.setattr(hp.er, "_RECONSTRUCT_CRAWL_TIMEOUT_S", 0.5)
    monkeypatch.setattr(okx_chain_record.chain, "read_below_stop", _hangs)

    assert await hp.run() == 1
    account, _summary = (json.loads(line) for line in capsys.readouterr().out.splitlines() if line.strip())

    assert account["anchor_diagnostic"] == "run"  # not "failed": the outer bound did not cancel the reading
    assert account["opening_unavailable_reason"] == "chain_break"
    assert account["bills_read"] == 3
    assert account["chain_diagnostic_failure_class"] == "Timeout"
    assert account["chain_failed_step"] == "close"  # no budget was left, so the first group already timed out
