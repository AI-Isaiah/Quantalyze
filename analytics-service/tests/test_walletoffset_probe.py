"""Phase 184 WALLETOFFSET plan 01 - tests for ``scripts/walletoffset_probe.py``.

The probe measures, for each key on a wallet-base venue that has a stored first mark, the
amount the first mark's wallet holds that the realized chain does not yet hold at the UTC
day boundary: the chain's own realized P&L plus the chain's own flows in the window between
UTC midnight of the read day and the instant the worker read the equity (CONTEXT D-01). It is
read-only, prints labels, counts, closed tokens and 3-significant-figure ratios, and is run
once on the Railway worker. Nothing here touches a venue or a database: the venue is a stub
that answers like OKX's bills archive, the database a filtering fake.

Why each group matters (Rule 9):
  * run() end to end (tracer): the probe is a one-shot on a live worker and its output decides
    whether a wallet-base venue moves to a writer-chain base. A wiring bug (a window that is
    not the applier's, a mark read of another key, a bill sum that drops the fee) is only
    discovered on the worker, where a second attempt costs a founder step.
  * OKX reader: the window is rebuilt from the bills archive. Reading the 7-day endpoint, a
    ``begin``-bounded query, or stopping on an empty page would print a clean-looking number
    for a window that was never fully read.
  * arithmetic: the ratios are the deliverable. Each is checked against a literal worked out
    by hand, never against a second call of the code under test.
  * flows: the chain's own flow valuation and the applier's own window rule decide which
    flows count; a flow one millisecond outside the window must not.
  * unmeasurable tokens: a window that cannot be rebuilt must print a closed reason and no
    ratio, never a zero.

Plan 02 adds:
  * unmeasurable refusals: a key the probe will not read must say why BEFORE its credentials
    are decrypted, and every key the backfill derives (its own dispatch filter, not a stricter
    "working" guess) must be read, because its published numbers carry the offset. A venue
    error prints its exception class only.
  * shares_account: two keys on one exchange account measure the same wallet; a reader of the
    output must be able to count that account once.
  * read-only: the probe runs against PROD with real credentials. A write to the database or
    the venue would change a published number, so the wrapper, the source pins and the bare
    client control each have to be able to fail, or they prove nothing.
  * redaction: the output is pasted into a tracked file in a public repo. A planted id, amount
    or venue message must never reach stdout or stderr, and the leak check itself must find
    the needles in a deliberately leaky string, or "found none" means nothing.
  * emit and main: the emitter is the one path to stdout; an out-of-contract record is refused
    by path, never by value, and a run-level failure prints the exception type only.
"""
from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import ccxt
import pytest

import scripts.walletoffset_probe as wp
from services import okx_opening_balance as obal
from services.okx_bills_chain import CallCeilingReached
from tests._okx_bills import OkxBillsArchive, okx_bill

_PROBE_SRC = Path(wp.__file__).read_text(encoding="utf-8")

# Distinctive synthetic values, so a substring search for one in the output cannot be confused
# with a count or a ratio's digits.
_USER_ONE = "fake-user-id-one"
_KEY_OKX = "fake-key-id-okx"
_CIPHER = "planted-cipher-text-zzz"

_RUN_AT = datetime(2026, 11, 1, 12, 0, 0, tzinfo=timezone.utc)
# The tracer's mark: read 6 h into 2026-10-27 (UTC), so the mark day is 2026-10-26.
_MARKED_AT = datetime(2026, 10, 27, 6, 0, 0, tzinfo=timezone.utc)
_MARK_DAY = "2026-10-26"
_NAV = 20000.0
_HOUR_MS = 3_600_000


def _epoch_ms(moment: datetime) -> int:
    return (moment - datetime(1970, 1, 1, tzinfo=timezone.utc)) // timedelta(milliseconds=1)


_R_MS = _epoch_ms(_MARKED_AT)
_B_MS = _epoch_ms(_MARKED_AT.replace(hour=0, minute=0, second=0, microsecond=0))


# ---------------------------------------------------------------------------
# Fakes: a filtering database, a stub OKX venue, and the services run() reaches for.
# ---------------------------------------------------------------------------


class _FakeQuery:
    """Applies the filters it is given, so a wrong filter in the probe is visible."""

    def __init__(self, table: str, data: list[dict[str, Any]], owner: "_FakeSupabase") -> None:
        self._table = table
        self._data = data
        self._owner = owner
        self._filters: list[Any] = []
        self._order: tuple[str, bool] | None = None
        self._columns: list[str] | None = None
        self._limit: int | None = None

    def select(self, columns: str = "*", **_k: Any) -> "_FakeQuery":
        self._owner.log.append(f"select:{self._table}")
        if columns.strip() != "*":
            self._columns = [c.strip() for c in columns.split(",")]
        return self

    def eq(self, column: str, value: Any) -> "_FakeQuery":
        self._filters.append(lambda r: r.get(column) == value)
        return self

    def in_(self, column: str, values: list[Any]) -> "_FakeQuery":
        self._filters.append(lambda r: r.get(column) in values)
        return self

    def gt(self, column: str, value: Any) -> "_FakeQuery":
        self._filters.append(lambda r: str(r.get(column)) > str(value))
        return self

    def order(self, column: str, desc: bool = False, **_k: Any) -> "_FakeQuery":
        self._order = (column, desc)
        return self

    def limit(self, count: int) -> "_FakeQuery":
        self._limit = count
        return self

    def execute(self) -> Any:
        out = [dict(r) for r in self._data if all(f(r) for f in self._filters)]
        if self._order is not None:
            column, desc = self._order
            out.sort(key=lambda r: str(r.get(column)), reverse=desc)
        if self._limit is not None:
            out = out[: self._limit]
        if self._columns is not None:
            out = [{c: r.get(c) for c in self._columns} for r in out]
        return SimpleNamespace(data=out)

    # Writers: present on the fake so that a probe that reaches one RECORDS it (and the test
    # fails) instead of dying on an AttributeError that hides it.
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


class _OkxVenue:
    """An OKX client: the bills archive, and ccxt-shaped deposit and withdrawal history.

    ``honour_window=False`` makes the transfer fetchers ignore ``since`` and ``until``, which
    models a venue page that spills rows past the requested window, so the probe's OWN window
    filter is what keeps them out."""

    id = "okx"
    rateLimit = 0

    def __init__(
        self,
        bills: list[dict[str, str]] | None = None,
        *,
        deposits: list[dict[str, Any]] | None = None,
        withdrawals: list[dict[str, Any]] | None = None,
        honour_window: bool = True,
        **archive_switches: Any,
    ) -> None:
        self.private_get_account_bills_archive = OkxBillsArchive(bills or [], **archive_switches)
        self._deposits = list(deposits or [])
        self._withdrawals = list(withdrawals or [])
        self._honour_window = honour_window
        self.transfer_calls: list[tuple[str, Any, Any]] = []

    def _serve(self, rows: list[dict[str, Any]], since: Any, params: Any) -> list[dict[str, Any]]:
        until = (params or {}).get("until")
        if not self._honour_window:
            return [dict(r) for r in rows]
        return [
            dict(r)
            for r in rows
            if r.get("timestamp") is None
            or (since is None or r["timestamp"] >= since)
            and (until is None or r["timestamp"] <= until)
        ]

    async def fetch_deposits(
        self, code: Any = None, since: Any = None, limit: Any = None, params: Any = None
    ) -> list[dict[str, Any]]:
        self.transfer_calls.append(("deposits", since, (params or {}).get("until")))
        return self._serve(self._deposits, since, params)

    async def fetch_withdrawals(
        self, code: Any = None, since: Any = None, limit: Any = None, params: Any = None
    ) -> list[dict[str, Any]]:
        self.transfer_calls.append(("withdrawals", since, (params or {}).get("until")))
        return self._serve(self._withdrawals, since, params)


class _Services:
    """Everything run() reaches for, patched in one place and recorded."""

    def __init__(
        self,
        tables: dict[str, list[dict[str, Any]]],
        clients: list[Any],
        *,
        run_at: datetime = _RUN_AT,
    ) -> None:
        self.supabase = _FakeSupabase(tables)
        self.clients = list(clients)
        self.run_at = run_at
        self.decrypt_calls: list[Any] = []
        self.built_for: list[str] = []
        self.closed: list[Any] = []

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def _db_execute(fn: Any) -> Any:
            return fn()

        def _decrypt(row: dict[str, Any], _kek: bytes) -> tuple[str, str, None]:
            self.decrypt_calls.append(row.get("id"))
            return ("fake-k", "fake-s", None)

        def _make_client(exchange_name: str, *_a: Any) -> Any:
            self.built_for.append(exchange_name)
            return self.clients[len(self.built_for) - 1]

        async def _aclose(exchange: Any) -> None:
            self.closed.append(exchange)

        monkeypatch.setattr(wp, "_utc_now", lambda: self.run_at)
        monkeypatch.setattr("services.db.get_supabase", lambda: self.supabase)
        monkeypatch.setattr("services.db.db_execute", _db_execute)
        monkeypatch.setattr("services.encryption.get_kek", lambda: b"fake-kek")
        monkeypatch.setattr("services.encryption.decrypt_credentials", _decrypt)
        monkeypatch.setattr("services.job_worker._make_exchange_client", _make_client)
        monkeypatch.setattr("services.exchange.aclose_exchange", _aclose)


def _key_row(
    key_id: str = _KEY_OKX,
    exchange: str = "okx",
    created: str = "2026-01-01T00:00:00+00:00",
    **overrides: Any,
) -> dict[str, Any]:
    row = {
        "id": key_id,
        "user_id": _USER_ONE,
        "exchange": exchange,
        "is_active": True,
        "disconnected_at": None,
        "sync_status": "complete",
        "created_at": created,
        "api_key_encrypted": _CIPHER,
        "account_share_kind": None,
        "account_shared_with_api_key_id": None,
    }
    row.update(overrides)
    return row


def _mark_row(
    key_id: str = _KEY_OKX,
    *,
    marked_at: datetime = _MARKED_AT,
    nav: float = _NAV,
    open_pnl: float = 0.0,
    venue: str = "okx",
) -> dict[str, Any]:
    mark_day = (marked_at.astimezone(timezone.utc).date() - timedelta(days=1)).isoformat()
    return {
        "api_key_id": key_id,
        "mark_day": mark_day,
        "marked_at": marked_at.isoformat(),
        "venue": venue,
        "nav_usd": nav,
        "open_pnl_usd": open_pnl,
        "nav_native": None,
        "native_unit": None,
        "open_pnl_native": None,
    }


def _bill(
    bill_id: int,
    ts: int,
    *,
    pnl: str = "0",
    fee: str = "0",
    ccy: str = "USDT",
    bill_type: str = "2",
    inst_type: str = "SWAP",
) -> dict[str, str]:
    """One synthetic OKX bill; ``bal`` and ``balChg`` are irrelevant to the probe."""
    return okx_bill(
        bill_id, ts, ccy, "0", "0", bill_type=bill_type, inst_type=inst_type, pnl=pnl, fee=fee
    )


async def _run_one_okx_key(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    venue: _OkxVenue,
    *,
    mark: dict[str, Any] | None = None,
) -> tuple[int, list[dict[str, Any]], _Services]:
    """Run the probe on one OKX key and return (exit code, parsed output lines, harness)."""
    services = _Services(
        {"api_keys": [_key_row()], "api_key_nav_marks": [mark or _mark_row()]}, [venue]
    )
    services.install(monkeypatch)
    code = await wp.run()
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    return code, lines, services


# ---------------------------------------------------------------------------
# The tracer: one marked OKX key, from its stored mark to one whitelisted record.
# ---------------------------------------------------------------------------


async def test_tracer_one_okx_key_first_mark_offset_end_to_end(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _OkxVenue(
        [
            # The reach bill: older than the window start, proof the walk read the whole window.
            _bill(101, _B_MS - _HOUR_MS, pnl="7"),
            # In the window: pnl + fee = 15.5 + (-0.5) = 15.
            _bill(102, _B_MS + _HOUR_MS, pnl="15.5", fee="-0.5"),
            # After the read: excluded.
            _bill(103, _R_MS + _HOUR_MS, pnl="99"),
        ]
    )
    code, lines, services = await _run_one_okx_key(monkeypatch, capsys, venue)

    assert code == wp.EXIT_OK
    assert len(lines) == 2
    key_record, summary = lines
    # 0.00075 is the hand-computed (15.5 - 0.5) / 20000, never recomputed by the code under test.
    assert key_record == {
        "record": "key",
        "key": "k1",
        "venue": "okx",
        "run_date": "2026-11-01",
        "first_mark_day": _MARK_DAY,
        "read_delay_hours": 6.0,
        "measured": True,
        "unmeasurable_reason": "none",
        "failure_class": "none",
        "partial": False,
        "shares_account": False,
        "pnl_trading_ratio": 0.00075,
        "pnl_funding_ratio": 0.0,
        "pnl_ratio": 0.00075,
        "flow_ratio": 0.0,
        "offset_ratio": 0.00075,
        "offset_over_wallet_ratio": 0.00075,
        "bills_in_window": 1,
        "transfer_bills_in_window": 0,
        "spot_bills_in_window": 0,
        "other_inst_bills_in_window": 0,
        "closed_pnl_rows_in_window": "field-absent",
        "income_rows_in_window": "field-absent",
        "funding_rows_in_window": 0,
        "flow_rows_in_window": 0,
        "unified_edge_rows_in_window": "field-absent",
        "non_stable_rows": 0,
    }
    assert summary["record"] == "summary"
    assert summary["keys"] == 1
    assert summary["keys_marked"] == 1
    assert summary["keys_measured"] == 1
    assert summary["keys_unmeasurable"] == 0
    assert summary["okx_state"] == "measured"
    assert summary["okx_max_abs_pnl_ratio"] == 0.00075
    assert summary["okx_max_abs_offset_ratio"] == 0.00075
    for venue_name in ("bybit", "binance", "sfox"):
        assert summary[f"{venue_name}_state"] == "no_keys"

    calls = venue.private_get_account_bills_archive.calls
    assert calls, "the bills archive was never read"
    for call in calls:
        assert "limit" in call
        for forbidden in ("begin", "end", "instType", "ccy"):
            assert forbidden not in call, forbidden
    assert "after" not in calls[0]
    assert services.decrypt_calls == [_KEY_OKX]
    assert services.closed == [venue]
    assert services.supabase.writes == []


# ---------------------------------------------------------------------------
# Helpers for the groups below.
# ---------------------------------------------------------------------------

_REACH = 1  # bill id of the reach bill: older than the window start, proof the walk read it all
_RATIO_READINGS = (
    "pnl_trading_ratio",
    "pnl_funding_ratio",
    "pnl_ratio",
    "flow_ratio",
    "offset_ratio",
    "offset_over_wallet_ratio",
)
_COUNT_READINGS = (
    "bills_in_window",
    "transfer_bills_in_window",
    "spot_bills_in_window",
    "other_inst_bills_in_window",
    "closed_pnl_rows_in_window",
    "income_rows_in_window",
    "funding_rows_in_window",
    "flow_rows_in_window",
    "unified_edge_rows_in_window",
    "non_stable_rows",
)


def _reach_bill() -> dict[str, str]:
    return _bill(_REACH, _B_MS - _HOUR_MS)


def _in_window(bill_id: int, **kwargs: Any) -> dict[str, str]:
    """A bill one hour into the window."""
    return _bill(bill_id, _B_MS + _HOUR_MS, **kwargs)


def _assert_unmeasured(record: dict[str, Any], reason: str, failure_class: str = "none") -> None:
    """A key that could not be measured prints its closed reason and NO reading: never a 0."""
    assert record["measured"] is False
    assert record["unmeasurable_reason"] == reason
    assert record["failure_class"] == failure_class
    assert record["partial"] == "field-absent"
    for key in (*_RATIO_READINGS, *_COUNT_READINGS):
        assert record[key] == "field-absent", key


async def _key_record_of(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    venue: _OkxVenue,
    *,
    mark: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _code, lines, _services = await _run_one_okx_key(monkeypatch, capsys, venue, mark=mark)
    return lines[0]  # type: ignore[no-any-return]


# ---------------------------------------------------------------------------
# Window: B and R from marked_at, inclusive at both edges (the applier's own rule).
# ---------------------------------------------------------------------------

# 2026-10-27T00:00:00Z and 2026-10-27T05:30:00Z as epoch milliseconds, worked out by hand.
_B_0527 = 1_793_059_200_000
_R_0527 = 1_793_079_000_000


def test_window_ms_gives_utc_midnight_and_the_read_instant() -> None:
    marked_at = datetime(2026, 10, 27, 5, 30, 0, tzinfo=timezone.utc)
    assert wp.window_ms(marked_at) == (_B_0527, _R_0527)


def test_window_ms_of_a_non_utc_marked_at_gives_the_same_instants() -> None:
    plus_two = timezone(timedelta(hours=2))
    assert wp.window_ms(datetime(2026, 10, 27, 7, 30, 0, tzinfo=plus_two)) == (_B_0527, _R_0527)


def test_window_start_edge_is_inside() -> None:
    assert wp.in_window(_B_0527, _B_0527, _R_0527) is True


def test_window_read_edge_is_inside() -> None:
    assert wp.in_window(_R_0527, _B_0527, _R_0527) is True


def test_window_one_ms_before_the_start_is_outside() -> None:
    assert wp.in_window(_B_0527 - 1, _B_0527, _R_0527) is False


def test_window_one_ms_after_the_read_is_outside() -> None:
    assert wp.in_window(_R_0527 + 1, _B_0527, _R_0527) is False


# ---------------------------------------------------------------------------
# Offset arithmetic, each against a literal worked out by hand.
# ---------------------------------------------------------------------------


def test_offset_terms_match_the_hand_computed_case() -> None:
    got = wp.offset_terms(15.0, -3.0, 91.0, 20000.0, 5000.0)
    assert got["pnl_trading_ratio"] == 0.00075  # 15 / 20000
    assert got["pnl_funding_ratio"] == -0.00015  # -3 / 20000
    assert got["pnl_ratio"] == 0.0006  # 12 / 20000
    assert got["flow_ratio"] == 0.00455  # 91 / 20000
    assert got["offset_ratio"] == 0.00515  # 103 / 20000
    # 103 / 15000 = 0.006867 (wallet = 20000 - 5000), three significant figures.
    assert got["offset_over_wallet_ratio"] == 0.00687


def test_offset_a_negative_pnl_gives_a_negative_ratio() -> None:
    got = wp.offset_terms(-20.0, 0.0, 0.0, 20000.0, 0.0)
    assert got["pnl_ratio"] == -0.001  # -20 / 20000
    assert got["offset_ratio"] == -0.001


@pytest.mark.parametrize("nav", [0.0, -1.0])
def test_offset_a_nav_not_above_zero_is_unmeasurable(nav: float) -> None:
    with pytest.raises(wp.Unmeasurable) as caught:
        wp.offset_terms(15.0, 0.0, 0.0, nav, 0.0)
    assert caught.value.reason == "nav_nonpositive"


def test_offset_open_pnl_equal_to_nav_leaves_the_wallet_ratio_absent() -> None:
    got = wp.offset_terms(15.0, 0.0, 0.0, 20000.0, 20000.0)
    assert got["offset_over_wallet_ratio"] == "field-absent"
    assert got["offset_ratio"] == 0.00075


# ---------------------------------------------------------------------------
# OKX sums: the chain's own rule over the window's bills.
# ---------------------------------------------------------------------------


def _terms(*bills: dict[str, str]) -> wp.OkxWindowTerms:
    return wp.okx_window_terms(list(bills), _B_MS, _R_MS)


def test_okx_a_trade_bill_adds_pnl_plus_fee_to_trading() -> None:
    terms = _terms(_in_window(2, pnl="15.5", fee="-0.5"))
    assert terms.trading_usd == 15.0
    assert terms.funding_usd == 0.0
    assert terms.bills_in_window == 1


def _funding_bill(bill_id: int, pnl: str, inst_id: str, *, fee: str = "0") -> dict[str, str]:
    """A type-8 (funding) bill one hour into the window, on ``inst_id`` (``fetch_funding_okx``
    drops a funding bill with a blank one)."""
    return {**_in_window(bill_id, pnl=pnl, fee=fee, bill_type="8"), "instId": inst_id}


def test_okx_a_type_8_usdt_bill_adds_its_pnl_to_funding_only() -> None:
    terms = _terms(_funding_bill(2, "-3", "BTC-USDT-SWAP", fee="-1"))
    assert terms.funding_usd == -3.0  # the fee of a funding bill is not added
    assert terms.trading_usd == 0.0
    assert terms.funding_rows_in_window == 1


def test_okx_a_type_8_btc_bill_is_counted_and_summed_nowhere() -> None:
    terms = _terms(_in_window(2, pnl="0.001", bill_type="8", ccy="BTC"))
    assert terms.funding_usd == 0.0
    assert terms.trading_usd == 0.0
    assert terms.funding_rows_in_window == 1
    assert terms.non_stable_rows == 1


def test_okx_a_transfer_bill_is_counted_and_summed_nowhere() -> None:
    # A transfer has a blank instType; a pnl of 500 would show if it were summed.
    terms = _terms(_in_window(2, pnl="500", bill_type="1", inst_type=""))
    assert terms.transfer_bills_in_window == 1
    assert terms.other_inst_bills_in_window == 1
    assert (terms.trading_usd, terms.funding_usd) == (0.0, 0.0)


def test_okx_a_spot_usdt_bill_is_summed_and_counted_as_spot() -> None:
    terms = _terms(_in_window(2, pnl="2", fee="-0.5", inst_type="SPOT"))
    assert terms.trading_usd == 1.5
    assert terms.spot_bills_in_window == 1
    assert terms.other_inst_bills_in_window == 0


def test_okx_an_option_bill_is_counted_as_other_and_summed_nowhere() -> None:
    terms = _terms(_in_window(2, pnl="40", fee="-1", inst_type="OPTION"))
    assert terms.other_inst_bills_in_window == 1
    assert terms.trading_usd == 0.0


def test_okx_bills_at_the_window_edges_count_and_one_ms_outside_do_not() -> None:
    terms = _terms(
        _bill(2, _B_MS, pnl="1"),
        _bill(3, _R_MS, pnl="2"),
        _bill(4, _B_MS - 1, pnl="100"),
        _bill(5, _R_MS + 1, pnl="1000"),
    )
    assert terms.bills_in_window == 2
    assert terms.trading_usd == 3.0


async def test_okx_a_btc_bill_is_excluded_and_the_key_prints_partial(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _OkxVenue(
        [_reach_bill(), _in_window(2, pnl="15", fee="0"), _in_window(3, pnl="3", ccy="BTC")]
    )
    record = await _key_record_of(monkeypatch, capsys, venue)
    assert record["measured"] is True
    assert record["partial"] is True
    assert record["non_stable_rows"] == 1
    assert record["bills_in_window"] == 2
    assert record["pnl_ratio"] == 0.00075  # 15 / 20000; the BTC pnl of 3 is in neither sum


@pytest.mark.parametrize("bad", ["nan", "abc", "inf"])
async def test_okx_a_pnl_that_is_not_a_finite_number_makes_the_key_malformed(
    bad: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _OkxVenue([_reach_bill(), _in_window(2, pnl=bad)])
    _assert_unmeasured(await _key_record_of(monkeypatch, capsys, venue), "malformed")


@pytest.mark.parametrize("blank_inst_id", [""])
async def test_okx_a_funding_bill_with_a_blank_inst_id_makes_the_key_malformed(
    blank_inst_id: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """``fetch_funding_okx`` drops a funding bill with a blank ``instId``, so a sum that adds it
    is a quantity the chain never books: the key is refused, not printed."""
    venue = _OkxVenue([_reach_bill(), _funding_bill(2, "-3", blank_inst_id)])
    _assert_unmeasured(await _key_record_of(monkeypatch, capsys, venue), "malformed")


async def test_okx_two_funding_bills_on_one_instrument_in_one_hour_make_the_key_malformed(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """``fetch_funding_okx`` keeps one row per instrument and UTC hour, so a sum that adds both
    bills is a quantity the chain never books: the key is refused, not printed."""
    venue = _OkxVenue(
        [
            _reach_bill(),
            _funding_bill(2, "-3", "BTC-USDT-SWAP"),
            _funding_bill(3, "-2", "BTC-USDT-SWAP"),
        ]
    )
    _assert_unmeasured(await _key_record_of(monkeypatch, capsys, venue), "malformed")


async def test_okx_a_funding_bill_read_from_the_archive_keeps_its_instrument_so_the_key_is_measured(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A funding bill read from the bills archive must keep its instrument, because the
    chain-parity funding check in ``okx_window_terms`` reads ``instId``: the blank-instrument
    refusal and the one-row-per-instrument-and-hour rule both mirror ``fetch_funding_okx``. A
    parser that drops ``instId`` refuses every OKX key that held a perpetual through a funding
    settlement in its window, which is what the first PROD run printed for all 5 marked OKX
    keys (184-04, G-01). The older funding tests built bills that already carried ``instId`` and
    handed them to ``okx_window_terms`` directly, past the parser, so they could not see it.
    This one drives the bill from the archive fake through run(), the walk and the parser."""
    venue = _OkxVenue([_reach_bill(), _funding_bill(2, "-3", "BTC-USDT-SWAP")])
    code, lines, _ = await _run_one_okx_key(monkeypatch, capsys, venue)

    record = lines[0]
    assert record["record"] == "key"
    assert record["measured"] is True
    assert record["unmeasurable_reason"] == "none"
    assert record["failure_class"] == "none"
    assert record["partial"] is False
    assert record["bills_in_window"] == 1
    assert record["funding_rows_in_window"] == 1
    # -0.00015 is the hand-computed -3 / 20000 (NAV 20000), never recomputed by the code under test.
    assert record["pnl_trading_ratio"] == 0.0
    assert record["pnl_funding_ratio"] == -0.00015
    assert record["pnl_ratio"] == -0.00015
    assert record["offset_ratio"] == -0.00015
    assert code == wp.EXIT_OK


async def test_okx_a_fee_that_is_not_a_finite_number_makes_the_key_malformed(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _OkxVenue([_reach_bill(), _in_window(2, pnl="1", fee="nan")])
    _assert_unmeasured(await _key_record_of(monkeypatch, capsys, venue), "malformed")


async def test_okx_the_first_mark_is_the_one_with_the_smallest_mark_day(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    later = _mark_row(marked_at=_MARKED_AT + timedelta(days=1), nav=99999.0)
    services = _Services(
        {"api_keys": [_key_row()], "api_key_nav_marks": [later, _mark_row()]},
        [_OkxVenue([_reach_bill(), _in_window(2, pnl="15")])],
    )
    services.install(monkeypatch)
    assert await wp.run() == wp.EXIT_OK
    record = json.loads(capsys.readouterr().out.splitlines()[0])
    assert record["first_mark_day"] == _MARK_DAY
    assert record["pnl_ratio"] == 0.00075  # 15 / 20000, the first mark's NAV, not 15 / 99999


async def test_okx_keys_are_labelled_by_created_at_and_read_their_own_marks(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    first = _key_row("fake-key-id-first", created="2026-01-01T00:00:00+00:00")
    second = _key_row("fake-key-id-second", created="2026-02-01T00:00:00+00:00")
    marks = [_mark_row("fake-key-id-second", nav=10000.0), _mark_row("fake-key-id-first")]
    services = _Services(
        {"api_keys": [second, first], "api_key_nav_marks": marks},
        [
            _OkxVenue([_reach_bill(), _in_window(2, pnl="15")]),
            _OkxVenue([_reach_bill(), _in_window(2, pnl="30")]),
        ],
    )
    services.install(monkeypatch)
    assert await wp.run() == wp.EXIT_OK
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [lines[0]["key"], lines[1]["key"]] == ["k1", "k2"]
    assert services.decrypt_calls == ["fake-key-id-first", "fake-key-id-second"]
    assert lines[0]["pnl_ratio"] == 0.00075  # 15 / 20000
    assert lines[1]["pnl_ratio"] == 0.003  # 30 / 10000
    assert lines[2]["okx_max_abs_pnl_ratio"] == 0.003


# ---------------------------------------------------------------------------
# OKX walk: complete or a closed token, never a partial list.
# ---------------------------------------------------------------------------


def _exchange(archive: Any) -> SimpleNamespace:
    return SimpleNamespace(private_get_account_bills_archive=archive)


async def test_okx_walk_pages_by_after_and_never_sends_begin_end_insttype_or_ccy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(obal, "BILLS_ARCHIVE_PAGE_ROWS", 2)
    archive = OkxBillsArchive([_reach_bill(), *[_in_window(i, pnl="1") for i in (2, 3, 4, 5)]])
    bills = await wp.walk_okx_window_bills(_exchange(archive), _B_MS)
    assert sorted(int(b["billId"]) for b in bills) == [2, 3, 4, 5]
    assert [c.get("after") for c in archive.calls] == [None, "4", "2"]
    for call in archive.calls:
        assert call["limit"] == "2"
        for forbidden in ("begin", "end", "instType", "ccy"):
            assert forbidden not in call, forbidden


async def test_okx_walk_an_empty_page_before_an_older_bill_is_reach_unproven() -> None:
    archive = OkxBillsArchive([_in_window(2, pnl="1"), _in_window(3, pnl="1")])
    with pytest.raises(wp.Unmeasurable) as caught:
        await wp.walk_okx_window_bills(_exchange(archive), _B_MS)
    assert caught.value.reason == "reach_unproven"


async def test_okx_walk_a_lowered_page_ceiling_is_page_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(obal, "BILLS_ARCHIVE_PAGE_ROWS", 2)
    monkeypatch.setattr(obal, "BILLS_ARCHIVE_PAGE_CEILING", 1)
    archive = OkxBillsArchive([_in_window(i, pnl="1") for i in (2, 3, 4, 5)])
    with pytest.raises(wp.Unmeasurable) as caught:
        await wp.walk_okx_window_bills(_exchange(archive), _B_MS)
    assert caught.value.reason == "page_ceiling"


async def test_okx_walk_an_archive_that_ignores_after_is_malformed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(obal, "BILLS_ARCHIVE_PAGE_ROWS", 2)
    archive = OkxBillsArchive([_in_window(i, pnl="1") for i in (2, 3, 4, 5)], ignore_after=True)
    with pytest.raises(wp.Unmeasurable) as caught:
        await wp.walk_okx_window_bills(_exchange(archive), _B_MS)
    assert caught.value.reason == "malformed"


async def test_okx_walk_oldest_first_with_begin_does_not_hide_the_newest_bills() -> None:
    # The venue answers oldest first only when ``begin`` is sent; the walk sends none.
    newest = _bill(9, _R_MS - 1000, pnl="5")
    archive = OkxBillsArchive(
        [_reach_bill(), _in_window(2, pnl="1"), newest], oldest_first_with_begin=True
    )
    bills = await wp.walk_okx_window_bills(_exchange(archive), _B_MS)
    assert "9" in {b["billId"] for b in bills}


class _ScriptedArchive:
    """Answers each call with the next prepared reply."""

    def __init__(self, replies: list[Any]) -> None:
        self._replies = list(replies)
        self.calls: list[dict[str, str]] = []

    async def __call__(self, params: dict[str, str]) -> Any:
        self.calls.append(dict(params))
        return self._replies.pop(0)


async def test_okx_walk_a_bill_repeated_on_two_pages_counts_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(obal, "BILLS_ARCHIVE_PAGE_ROWS", 2)
    older = _bill(3, _B_MS - _HOUR_MS)
    archive = _ScriptedArchive(
        [
            {"code": "0", "data": [_in_window(5, pnl="1"), _in_window(4, pnl="2")]},
            {"code": "0", "data": [_in_window(4, pnl="2"), older]},
        ]
    )
    bills = await wp.walk_okx_window_bills(_exchange(archive), _B_MS)
    terms = wp.okx_window_terms(bills, _B_MS, _R_MS)
    assert sorted(int(b["billId"]) for b in bills) == [4, 5]
    assert terms.bills_in_window == 2
    assert terms.trading_usd == 3.0  # the repeated bill's pnl of 2 is summed once


@pytest.mark.parametrize(
    "reply",
    [
        {"code": "0", "data": ["not-a-bill"]},
        {"code": "0", "data": [{"billId": "x1", "ts": "1", "ccy": "USDT"}]},
        {"code": "0", "data": [{"billId": "1", "ts": "1", "ccy": ""}]},
        {"code": "0"},
        "not-a-mapping",
    ],
)
async def test_okx_walk_a_malformed_page_is_malformed(reply: Any) -> None:
    with pytest.raises(wp.Unmeasurable) as caught:
        await wp.walk_okx_window_bills(_exchange(_ScriptedArchive([reply])), _B_MS)
    assert caught.value.reason == "malformed"


@pytest.mark.parametrize(
    ("switches", "reason"),
    [({}, "reach_unproven"), ({"ignore_after": True}, "malformed")],
)
async def test_okx_each_refusal_token_prints_through_run_with_no_reading(
    switches: dict[str, Any],
    reason: str,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(obal, "BILLS_ARCHIVE_PAGE_ROWS", 2)
    venue = _OkxVenue([_in_window(i, pnl="1") for i in (2, 3, 4, 5)], **switches)
    _assert_unmeasured(await _key_record_of(monkeypatch, capsys, venue), reason)


async def test_okx_a_lowered_page_ceiling_prints_page_ceiling_through_run(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(obal, "BILLS_ARCHIVE_PAGE_ROWS", 2)
    monkeypatch.setattr(obal, "BILLS_ARCHIVE_PAGE_CEILING", 1)
    venue = _OkxVenue([_in_window(i, pnl="1") for i in (2, 3, 4, 5)])
    _assert_unmeasured(await _key_record_of(monkeypatch, capsys, venue), "page_ceiling")


async def test_okx_the_call_ceiling_is_turned_into_a_token_not_a_crash(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(obal, "BILLS_ARCHIVE_PAGE_ROWS", 2)
    monkeypatch.setattr(wp, "KEY_CALL_CEILING", 1)
    venue = _OkxVenue([_reach_bill(), *[_in_window(i, pnl="1") for i in (2, 3, 4)]])
    code, lines, services = await _run_one_okx_key(monkeypatch, capsys, venue)
    _assert_unmeasured(lines[0], "call_ceiling")
    assert code == wp.EXIT_FAILED
    assert len(venue.private_get_account_bills_archive.calls) == 1  # refused BEFORE the call
    assert services.closed == [venue]


async def test_okx_a_nav_not_above_zero_prints_nav_nonpositive_and_reads_no_bill(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _OkxVenue([_reach_bill(), _in_window(2, pnl="1")])
    record = await _key_record_of(monkeypatch, capsys, venue, mark=_mark_row(nav=0.0))
    _assert_unmeasured(record, "nav_nonpositive")
    assert venue.private_get_account_bills_archive.calls == []


async def test_okx_a_key_with_no_mark_is_not_decrypted_and_does_not_fail_the_run(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    other_keys_mark = _mark_row("fake-key-id-other")
    services = _Services(
        {"api_keys": [_key_row()], "api_key_nav_marks": [other_keys_mark]}, [_OkxVenue()]
    )
    services.install(monkeypatch)
    assert await wp.run() == wp.EXIT_OK
    record, summary = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    _assert_unmeasured(record, "no_mark")
    assert record["first_mark_day"] == "field-absent"
    assert services.decrypt_calls == [] and services.built_for == []
    assert summary["okx_state"] == "no_marked_keys"
    assert summary["keys_marked"] == 0 and summary["keys_unmeasurable"] == 0


async def test_sfox_marked_key_is_reader_not_built_before_any_decrypt(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # sFOX is the venue that has no reader (its chain books no realized P&L), so this protection
    # stays true after the Bybit and Binance readers landed in plan 03.
    services = _Services(
        {
            "api_keys": [_key_row(exchange="sfox")],
            "api_key_nav_marks": [_mark_row(venue="sfox")],
        },
        [],
    )
    services.install(monkeypatch)
    assert await wp.run() == wp.EXIT_FAILED
    record, summary = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    _assert_unmeasured(record, "reader_not_built")
    assert record["venue"] == "sfox"
    assert services.decrypt_calls == [] and services.built_for == []
    assert summary["sfox_state"] == "unmeasured"
    assert summary["keys_unmeasurable"] == 1


# ---------------------------------------------------------------------------
# Exception mapping: the one place a reader's exception becomes a closed token.
# ---------------------------------------------------------------------------


def test_okx_failure_token_of_an_unmeasurable_is_its_own_reason() -> None:
    assert wp.failure_token(wp.Unmeasurable("page_ceiling")) == ("page_ceiling", "none")


def test_okx_failure_token_keeps_the_class_an_unmeasurable_carries() -> None:
    got = wp.failure_token(wp.Unmeasurable("read_failed", "AuthenticationError"))
    assert got == ("read_failed", "AuthenticationError")


def test_okx_failure_token_of_the_call_ceiling_is_call_ceiling() -> None:
    assert wp.failure_token(CallCeilingReached(600)) == ("call_ceiling", "none")


def test_okx_unmeasurable_refuses_a_reason_outside_the_vocabulary() -> None:
    with pytest.raises(ValueError):
        wp.Unmeasurable("a-reason-nobody-declared")


# ---------------------------------------------------------------------------
# Flow term: the chain's own flows, placed by the applier's own window rule.
# ---------------------------------------------------------------------------


def _transfer(
    row_id: str,
    kind: str,
    timestamp: int | None,
    *,
    amount: float,
    fee: float = 0.0,
    currency: str = "USDT",
) -> dict[str, Any]:
    """A ccxt-shaped deposit or withdrawal row, every value synthetic."""
    row: dict[str, Any] = {
        "id": row_id,
        "type": kind,
        "currency": currency,
        "amount": amount,
        "fee": {"cost": fee, "currency": currency},
    }
    if timestamp is not None:
        row["timestamp"] = timestamp
    return row


async def test_flows_a_usdt_deposit_in_the_window_adds_amount_minus_fee(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _OkxVenue(
        [_reach_bill()],
        deposits=[_transfer("fake-dep-1", "deposit", _B_MS + 2 * _HOUR_MS, amount=100.0, fee=2.0)],
    )
    record = await _key_record_of(monkeypatch, capsys, venue)
    assert record["flow_rows_in_window"] == 1
    assert record["flow_ratio"] == 0.0049  # (100 - 2) / 20000
    assert record["offset_ratio"] == 0.0049
    assert record["pnl_ratio"] == 0.0


async def test_flows_a_withdrawal_in_the_window_subtracts_amount_plus_fee(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _OkxVenue(
        [_reach_bill()],
        withdrawals=[
            _transfer("fake-wd-1", "withdrawal", _B_MS + 3 * _HOUR_MS, amount=50.0, fee=1.0)
        ],
    )
    record = await _key_record_of(monkeypatch, capsys, venue)
    assert record["flow_rows_in_window"] == 1
    assert record["flow_ratio"] == -0.00255  # -(50 + 1) / 20000


async def test_flows_a_deposit_and_a_withdrawal_sum_into_the_offset_with_the_pnl(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _OkxVenue(
        [_reach_bill(), _in_window(2, pnl="15")],
        deposits=[_transfer("fake-dep-1", "deposit", _B_MS + 2 * _HOUR_MS, amount=100.0, fee=2.0)],
        withdrawals=[
            _transfer("fake-wd-1", "withdrawal", _B_MS + 3 * _HOUR_MS, amount=50.0, fee=1.0)
        ],
    )
    record = await _key_record_of(monkeypatch, capsys, venue)
    assert record["flow_rows_in_window"] == 2
    assert record["pnl_ratio"] == 0.00075  # 15 / 20000
    assert record["flow_ratio"] == 0.00235  # (98 - 51) / 20000
    assert record["offset_ratio"] == 0.0031  # (15 + 47) / 20000


async def test_flows_rows_one_second_outside_the_window_add_nothing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # honour_window=False: the venue serves both rows anyway, so the probe's own filter decides.
    venue = _OkxVenue(
        [_reach_bill()],
        deposits=[
            _transfer("fake-dep-late", "deposit", _R_MS + 1000, amount=500.0),
            _transfer("fake-dep-early", "deposit", _B_MS - 1000, amount=700.0),
        ],
        honour_window=False,
    )
    record = await _key_record_of(monkeypatch, capsys, venue)
    assert record["measured"] is True
    assert record["flow_rows_in_window"] == 0
    assert record["flow_ratio"] == 0.0


async def test_flows_a_non_stable_deposit_without_a_price_makes_the_key_flow_unvalued(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    async def _no_prices(*_a: Any, **_k: Any) -> dict[tuple[str, str], float]:
        return {}

    venue = _OkxVenue(
        [_reach_bill()],
        deposits=[
            _transfer("fake-dep-btc", "deposit", _B_MS + 2 * _HOUR_MS, amount=0.5, currency="BTC")
        ],
    )
    monkeypatch.setattr("services.job_worker._resolve_ccxt_flow_price_index", _no_prices)
    _assert_unmeasured(await _key_record_of(monkeypatch, capsys, venue), "flow_unvalued")


async def test_flows_an_unpriced_non_stable_deposit_after_the_read_cannot_fail_the_window(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # The prefilter keeps a flow made after R from being valued at all: a later, not-yet-closed
    # day's non-stable flow has no price yet and would otherwise turn a readable window into
    # flow_unvalued. The placement rule alone would drop it only AFTER valuation has failed.
    async def _no_prices(*_a: Any, **_k: Any) -> dict[tuple[str, str], float]:
        return {}

    venue = _OkxVenue(
        [_reach_bill()],
        deposits=[
            _transfer("fake-dep-btc", "deposit", _R_MS + 1000, amount=0.5, currency="BTC")
        ],
        honour_window=False,
    )
    monkeypatch.setattr("services.job_worker._resolve_ccxt_flow_price_index", _no_prices)
    record = await _key_record_of(monkeypatch, capsys, venue)
    assert record["measured"] is True
    assert record["flow_rows_in_window"] == 0
    assert record["flow_ratio"] == 0.0


async def test_flows_a_deposit_row_without_a_timestamp_makes_the_key_malformed(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _OkxVenue(
        [_reach_bill()], deposits=[_transfer("fake-dep-9", "deposit", None, amount=10.0)]
    )
    _assert_unmeasured(await _key_record_of(monkeypatch, capsys, venue), "malformed")


async def test_flows_are_read_for_the_windows_own_bounds(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _OkxVenue([_reach_bill()])
    await _key_record_of(monkeypatch, capsys, venue)
    assert sorted(venue.transfer_calls) == [
        ("deposits", _B_MS, _R_MS),
        ("withdrawals", _B_MS, _R_MS),
    ]


# ---------------------------------------------------------------------------
# Plan 02: a key that cannot be measured names why BEFORE any decrypt, and every key the
# backfill derives is read rather than guessed away.
# ---------------------------------------------------------------------------

_KEY_OTHER = "fake-key-id-other"
_KEY_DEAD = "fake-key-id-dead"
_PLANTED_MESSAGE = "fake-venue-message-secret 4321.5"


def _healthy_okx(pnl: str = "15") -> _OkxVenue:
    return _OkxVenue([_reach_bill(), _in_window(2, pnl=pnl)])


async def _run_world(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    keys: list[dict[str, Any]],
    marks: list[dict[str, Any]],
    clients: list[Any],
    *,
    run_at: datetime = _RUN_AT,
) -> tuple[int, list[dict[str, Any]], _Services]:
    """Run the probe on any world; the output lines are parsed, the harness is returned."""
    services = _Services({"api_keys": keys, "api_key_nav_marks": marks}, clients, run_at=run_at)
    services.install(monkeypatch)
    code = await wp.run()
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    return code, lines, services


def _assert_no_decrypt_no_client(services: _Services) -> None:
    """The refusals that need no venue are decided before a credential is touched."""
    assert services.decrypt_calls == []
    assert services.built_for == []
    assert services.closed == []


async def test_unmeasurable_no_mark_is_named_before_any_decrypt(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    code, lines, services = await _run_world(
        monkeypatch, capsys, [_key_row()], [_mark_row(_KEY_OTHER)], [_healthy_okx()]
    )
    record, summary = lines
    _assert_unmeasured(record, "no_mark")
    assert record["first_mark_day"] == "field-absent"
    _assert_no_decrypt_no_client(services)
    # A key with no mark is counted nowhere in keys_unmeasurable: there was nothing to measure.
    assert (summary["keys"], summary["keys_marked"], summary["keys_unmeasurable"]) == (1, 0, 0)
    assert code == wp.EXIT_OK


def _venue_differs(mark: dict[str, Any]) -> dict[str, Any]:
    return {**mark, "venue": "bybit"}


def _marked_at_unparseable(mark: dict[str, Any]) -> dict[str, Any]:
    return {**mark, "marked_at": "not-a-timestamp"}


def _marked_at_naive(mark: dict[str, Any]) -> dict[str, Any]:
    return {**mark, "marked_at": "2026-10-27T06:00:00"}


def _mark_day_not_the_day_before(mark: dict[str, Any]) -> dict[str, Any]:
    return {**mark, "mark_day": "2026-10-20"}


@pytest.mark.parametrize(
    "corrupt",
    [_venue_differs, _marked_at_unparseable, _marked_at_naive, _mark_day_not_the_day_before],
)
async def test_unmeasurable_malformed_mark_is_refused_with_no_decrypt(
    corrupt: Any, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # The table's CHECK should make each of these impossible; if one fires it is a fact to see.
    code, lines, services = await _run_world(
        monkeypatch, capsys, [_key_row()], [corrupt(_mark_row())], [_healthy_okx()]
    )
    record, summary = lines
    _assert_unmeasured(record, "malformed")
    _assert_no_decrypt_no_client(services)
    assert summary["keys_unmeasurable"] == 1
    assert code == wp.EXIT_FAILED


@pytest.mark.parametrize(
    "overrides",
    [
        {"is_active": False},
        {"disconnected_at": "2026-10-30T00:00:00+00:00"},
        {"sync_status": "revoked"},
    ],
)
async def test_unmeasurable_key_not_eligible_is_refused_with_no_decrypt(
    overrides: dict[str, Any], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    code, lines, services = await _run_world(
        monkeypatch, capsys, [_key_row(**overrides)], [_mark_row()], [_healthy_okx()]
    )
    record, summary = lines
    _assert_unmeasured(record, "key_not_eligible")
    assert record["first_mark_day"] == _MARK_DAY  # what the database holds is still printed
    _assert_no_decrypt_no_client(services)
    assert summary["okx_state"] == "unmeasured"
    assert code == wp.EXIT_FAILED


async def test_unmeasurable_error_status_key_is_read_not_refused(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """The backfill derives a series for an ``error`` key, so its published numbers carry the
    offset. The worker also stamps ``error`` for transient causes, so refusing on it would make
    a readable key unmeasurable. It is read."""
    venue = _OkxVenue([_reach_bill(), _in_window(2, pnl="15.5", fee="-0.5")])
    code, lines, services = await _run_world(
        monkeypatch, capsys, [_key_row(sync_status="error")], [_mark_row()], [venue]
    )
    record, _summary = lines
    assert record["measured"] is True
    assert record["unmeasurable_reason"] == "none"
    assert record["pnl_ratio"] == 0.00075  # (15.5 - 0.5) / 20000
    assert services.decrypt_calls == [_KEY_OKX]
    assert services.closed == [venue]
    assert code == wp.EXIT_OK


async def test_unmeasurable_sign_in_failed_key_fails_by_class(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A key that cannot sign in is read like any other and fails with the venue's class."""
    venue = _healthy_okx()
    venue.private_get_account_bills_archive.effect = ccxt.AuthenticationError(_PLANTED_MESSAGE)
    code, lines, services = await _run_world(
        monkeypatch, capsys, [_key_row(sync_status="sign_in_failed")], [_mark_row()], [venue]
    )
    record, _summary = lines
    _assert_unmeasured(record, "read_failed", "AuthenticationError")
    assert services.decrypt_calls == [_KEY_OKX]
    assert services.closed == [venue]
    assert code == wp.EXIT_FAILED


async def test_unmeasurable_a_revoked_key_added_last_changes_no_other_record(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Founder rule: a dead key affects only itself. Added LAST in created_at order, it keeps
    every other key's label, so the other records must be byte-identical."""
    first = _key_row("fake-key-id-first", created="2026-01-01T00:00:00+00:00")
    second = _key_row("fake-key-id-second", created="2026-02-01T00:00:00+00:00")
    dead = _key_row(
        _KEY_DEAD, created="2026-03-01T00:00:00+00:00", sync_status="revoked", is_active=False
    )
    live_marks = [
        _mark_row("fake-key-id-first"),
        _mark_row("fake-key-id-second", nav=10000.0),
    ]

    await _run_world(
        monkeypatch, capsys, [first, second], live_marks, [_healthy_okx("15"), _healthy_okx("30")]
    )
    # capsys was drained by the helper's parse; run the same worlds again and keep the raw text.
    services = _Services(
        {"api_keys": [first, second], "api_key_nav_marks": live_marks},
        [_healthy_okx("15"), _healthy_okx("30")],
    )
    services.install(monkeypatch)
    await wp.run()
    without = capsys.readouterr().out.splitlines()

    services = _Services(
        {
            "api_keys": [first, second, dead],
            "api_key_nav_marks": [*live_marks, _mark_row(_KEY_DEAD, nav=5000.0)],
        },
        [_healthy_okx("15"), _healthy_okx("30")],
    )
    services.install(monkeypatch)
    assert await wp.run() == wp.EXIT_FAILED
    with_dead = capsys.readouterr().out.splitlines()

    assert with_dead[:2] == without[:2]  # byte-identical records for the two live keys
    dead_record = json.loads(with_dead[2])
    assert dead_record["key"] == "k3"
    _assert_unmeasured(dead_record, "key_not_eligible")
    assert _KEY_DEAD not in services.decrypt_calls


async def test_unmeasurable_eligibility_is_decided_before_the_reader_and_the_window(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # An sFOX key that is also revoked prints key_not_eligible, not reader_not_built.
    code, lines, services = await _run_world(
        monkeypatch,
        capsys,
        [_key_row(exchange="sfox", sync_status="revoked")],
        [_mark_row(venue="sfox")],
        [],
    )
    _assert_unmeasured(lines[0], "key_not_eligible")
    _assert_no_decrypt_no_client(services)
    assert code == wp.EXIT_FAILED


async def test_unmeasurable_sfox_key_has_no_reader_and_is_never_decrypted(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # sFOX is the venue that never gets a reader in this phase, so this stays true when the
    # Bybit and Binance readers land.
    code, lines, services = await _run_world(
        monkeypatch, capsys, [_key_row(exchange="sfox")], [_mark_row(venue="sfox")], []
    )
    record, summary = lines
    _assert_unmeasured(record, "reader_not_built")
    assert record["venue"] == "sfox"
    _assert_no_decrypt_no_client(services)
    assert summary["sfox_state"] == "unmeasured"
    assert code == wp.EXIT_FAILED


def _mark_read_on(day_of_month_in_august: int) -> dict[str, Any]:
    """A mark read 06:00Z on the given August 2026 day; the run date is 2026-11-01."""
    return _mark_row(marked_at=datetime(2026, 8, day_of_month_in_august, 6, 0, tzinfo=timezone.utc))


async def test_unmeasurable_window_exactly_at_the_retention_edge_is_read(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # B = 2026-08-03 is 90 days before the run date 2026-11-01: inside OKX's 90 days.
    code, lines, services = await _run_world(
        monkeypatch, capsys, [_key_row()], [_mark_read_on(3)], [_OkxVenue()]
    )
    assert lines[0]["unmeasurable_reason"] != "window_outside_retention"
    assert services.decrypt_calls == [_KEY_OKX]  # it was attempted (the empty archive fails it)
    assert code == wp.EXIT_FAILED


async def test_unmeasurable_window_one_day_past_the_retention_edge_is_refused_with_no_decrypt(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # B = 2026-08-02 is 91 days before the run date.
    code, lines, services = await _run_world(
        monkeypatch, capsys, [_key_row()], [_mark_read_on(2)], [_OkxVenue()]
    )
    _assert_unmeasured(lines[0], "window_outside_retention")
    _assert_no_decrypt_no_client(services)
    assert code == wp.EXIT_FAILED


async def test_unmeasurable_window_read_exactly_24_hours_ago_is_read(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    code, lines, services = await _run_world(
        monkeypatch,
        capsys,
        [_key_row()],
        [_mark_row()],
        [_healthy_okx()],
        run_at=_MARKED_AT + timedelta(seconds=wp.OKX_MIN_WINDOW_AGE_S),
    )
    assert lines[0]["measured"] is True
    assert services.decrypt_calls == [_KEY_OKX]
    assert code == wp.EXIT_OK


async def test_unmeasurable_window_read_one_second_under_24_hours_ago_is_too_recent(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    code, lines, services = await _run_world(
        monkeypatch,
        capsys,
        [_key_row()],
        [_mark_row()],
        [_healthy_okx()],
        run_at=_MARKED_AT + timedelta(seconds=wp.OKX_MIN_WINDOW_AGE_S - 1),
    )
    _assert_unmeasured(lines[0], "window_too_recent")
    _assert_no_decrypt_no_client(services)
    assert code == wp.EXIT_FAILED


@pytest.mark.parametrize(
    ("effect", "failure_class"),
    [
        (lambda: ccxt.AuthenticationError(_PLANTED_MESSAGE), "AuthenticationError"),
        (lambda: ccxt.PermissionDenied(_PLANTED_MESSAGE), "PermissionDenied"),
        (lambda: ccxt.RateLimitExceeded(_PLANTED_MESSAGE), "RateLimitExceeded"),
    ],
)
async def test_unmeasurable_a_venue_error_prints_its_class_and_closes_the_client(
    effect: Any,
    failure_class: str,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    async def _no_sleep(_delay: float) -> None:
        return None

    # RateLimitExceeded goes through the backoff's retries; never sleep for real.
    monkeypatch.setattr("services.exchange.asyncio.sleep", _no_sleep)
    venue = _healthy_okx()
    venue.private_get_account_bills_archive.effect = effect()
    code, lines, services = await _run_world(
        monkeypatch, capsys, [_key_row()], [_mark_row()], [venue]
    )
    _assert_unmeasured(lines[0], "read_failed", failure_class)
    assert services.closed == [venue]
    assert code == wp.EXIT_FAILED


class _HangingArchive:
    """A bills archive that never answers."""

    calls: list[dict[str, str]]

    def __init__(self) -> None:
        self.calls = []

    async def __call__(self, params: dict[str, str]) -> Any:
        self.calls.append(dict(params))
        await asyncio.sleep(3600)


async def test_unmeasurable_a_reader_that_never_answers_is_a_timeout(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(wp, "KEY_READ_TIMEOUT_S", 0.05)
    venue = _healthy_okx()
    venue.private_get_account_bills_archive = _HangingArchive()  # type: ignore[assignment]
    code, lines, services = await _run_world(
        monkeypatch, capsys, [_key_row()], [_mark_row()], [venue]
    )
    _assert_unmeasured(lines[0], "timeout", "Timeout")
    assert services.closed == [venue]
    assert code == wp.EXIT_FAILED


async def test_unmeasurable_a_marks_read_failure_is_read_failed_by_class_and_decrypts_nothing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def _broken(_supabase: Any, _key_id: str) -> Any:
        raise ccxt.NetworkError(_PLANTED_MESSAGE)

    monkeypatch.setattr(wp, "read_key_marks", _broken)
    services = _Services({"api_keys": [_key_row()], "api_key_nav_marks": []}, [_healthy_okx()])
    services.install(monkeypatch)
    code = await wp.run()
    record, summary = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    _assert_unmeasured(record, "read_failed", "NetworkError")
    _assert_no_decrypt_no_client(services)
    assert summary["keys_unmeasurable"] == 1
    assert code == wp.EXIT_FAILED


async def test_unmeasurable_a_stored_mark_that_cannot_be_parsed_is_read_failed_other(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    broken = {k: v for k, v in _mark_row().items() if k != "nav_usd"}
    code, lines, services = await _run_world(
        monkeypatch, capsys, [_key_row()], [broken], [_healthy_okx()]
    )
    _assert_unmeasured(lines[0], "read_failed", "other")
    _assert_no_decrypt_no_client(services)
    assert code == wp.EXIT_FAILED


async def test_unmeasurable_one_failed_key_does_not_change_the_next_keys_record(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    failing = _healthy_okx()
    failing.private_get_account_bills_archive.effect = ccxt.AuthenticationError(_PLANTED_MESSAGE)
    keys = [_key_row("fake-key-id-first"), _key_row("fake-key-id-second", created="2026-02-01")]
    marks = [_mark_row("fake-key-id-first"), _mark_row("fake-key-id-second")]
    code, lines, services = await _run_world(
        monkeypatch, capsys, keys, marks, [failing, _healthy_okx("15")]
    )
    first, second, summary = lines
    _assert_unmeasured(first, "read_failed", "AuthenticationError")
    assert second["measured"] is True and second["pnl_ratio"] == 0.00075
    assert services.closed == [failing, services.clients[1]]
    assert (summary["keys_marked"], summary["keys_measured"], summary["keys_unmeasurable"]) == (
        2,
        1,
        1,
    )
    assert summary["okx_state"] == "partly_measured"
    assert code == wp.EXIT_FAILED


def test_unmeasurable_failure_token_maps_every_venue_error_by_class_and_never_the_message() -> None:
    cases: list[tuple[BaseException, tuple[str, str]]] = [
        (ccxt.AuthenticationError(_PLANTED_MESSAGE), ("read_failed", "AuthenticationError")),
        (ccxt.PermissionDenied(_PLANTED_MESSAGE), ("read_failed", "PermissionDenied")),
        (ccxt.RateLimitExceeded(_PLANTED_MESSAGE), ("read_failed", "RateLimitExceeded")),
        (ccxt.RequestTimeout(_PLANTED_MESSAGE), ("read_failed", "RequestTimeout")),
        (ccxt.NetworkError(_PLANTED_MESSAGE), ("read_failed", "NetworkError")),
        (ccxt.BadRequest(_PLANTED_MESSAGE), ("read_failed", "BadRequest")),
        (ccxt.ExchangeError(_PLANTED_MESSAGE), ("read_failed", "ExchangeError")),
        (ValueError(_PLANTED_MESSAGE), ("read_failed", "other")),
        (TimeoutError(), ("timeout", "Timeout")),
        (asyncio.TimeoutError(), ("timeout", "Timeout")),
    ]
    for exc, want in cases:
        got = wp.failure_token(exc)
        assert got == want, type(exc).__name__
        assert _PLANTED_MESSAGE not in "".join(got)


def test_unmeasurable_failure_token_of_a_named_exception_is_unchanged_by_the_catch_all() -> None:
    assert wp.failure_token(wp.Unmeasurable("flow_unvalued")) == ("flow_unvalued", "none")
    assert wp.failure_token(CallCeilingReached(600)) == ("call_ceiling", "none")


async def test_unmeasurable_the_summary_counts_a_refused_marked_key_and_not_a_markless_one(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    keys = [
        _key_row("fake-key-id-good", created="2026-01-01"),
        _key_row("fake-key-id-refused", created="2026-02-01", is_active=False),
        _key_row("fake-key-id-markless", created="2026-03-01"),
    ]
    marks = [_mark_row("fake-key-id-good"), _mark_row("fake-key-id-refused")]
    code, lines, _services = await _run_world(monkeypatch, capsys, keys, marks, [_healthy_okx()])
    summary = lines[3]
    assert summary["keys"] == 3
    assert summary["keys_marked"] == 2  # the key with no mark is in neither count below
    assert summary["keys_measured"] == 1
    assert summary["keys_unmeasurable"] == 1
    assert summary["okx_state"] == "partly_measured"
    assert code == wp.EXIT_FAILED


async def test_shares_account_is_true_for_a_marked_key_and_for_the_key_it_names(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    holder = _key_row("fake-key-id-holder", created="2026-01-01")
    duplicate = _key_row(
        "fake-key-id-dup",
        created="2026-02-01",
        account_share_kind="duplicate",
        account_shared_with_api_key_id="fake-key-id-holder",
    )
    member = _key_row(
        "fake-key-id-member",
        created="2026-03-01",
        account_share_kind="composite_member",
        account_shared_with_api_key_id="fake-key-id-holder",
    )
    alone = _key_row("fake-key-id-alone", created="2026-04-01")
    _code, lines, _services = await _run_world(
        monkeypatch, capsys, [holder, duplicate, member, alone], [], []
    )
    flags = {line["key"]: line["shares_account"] for line in lines[:4]}
    assert flags == {"k1": True, "k2": True, "k3": True, "k4": False}


async def test_shares_account_is_false_for_every_key_when_no_key_names_another(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    keys = [_key_row("fake-key-id-a", created="2026-01-01"), _key_row("fake-key-id-b", created="2026-02-01")]
    _code, lines, _services = await _run_world(monkeypatch, capsys, keys, [], [])
    assert [line["shares_account"] for line in lines[:2]] == [False, False]


# ---------------------------------------------------------------------------
# Plan 02, Task 2: read-only proof (SC-3) - copied from the allocator probe's "Read-only wrapper
# and source-level safety" section and pointed at THIS probe's source.
# ---------------------------------------------------------------------------


def test_read_only_wrapper_exposes_select_and_nothing_else() -> None:
    fake = _FakeSupabase({"api_keys": [{"id": "fake-row"}]})
    wrapper = wp.ReadOnlySupabase(fake)

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
    """``_cache_coingecko_prices`` upserts into ``token_price_history`` and the flow price
    resolver swallows a failure of that write. Through the wrapper the write cannot happen."""
    from services import equity_reconstruction as er

    async def _db_execute(fn: Any) -> Any:
        return fn()

    monkeypatch.setattr("services.equity_reconstruction.db_execute", _db_execute)
    fake = _FakeSupabase({"token_price_history": []})

    await er._cache_coingecko_prices(wp.ReadOnlySupabase(fake), "XYZ", [("2026-01-01", 1.0)])
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


def test_source_calls_no_writer() -> None:
    for write in (".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "enqueue"):
        assert write not in _PROBE_SRC, write
    for name in _FORBIDDEN_NAMES:
        assert f"{name}(" not in _PROBE_SRC, name
    # A reference that is not a call (an alias, a callback) is as good as a call.
    assert not set(_FORBIDDEN_NAMES) & _code_names(_PROBE_SRC)


def test_source_calls_no_venue_write() -> None:
    assert not re.search(r"\b(create_order|cancel_order|withdraw|transfer)\(", _PROBE_SRC)
    assert not re.search(r"\bprivate_(post|put|delete)_", _PROBE_SRC)
    # ccxt's camel-style implicit write names too (``privatePostX``).
    assert not re.search(r"private_?(post|put|delete)", _PROBE_SRC, re.IGNORECASE)


def test_source_pins_can_fail_on_a_planted_write() -> None:
    """The three source pins above are regexes and a substring scan; prove each fires on a
    planted write so "found none" in the real source means something."""
    planted = _PROBE_SRC + "\nsupabase.table('api_keys').update({})\nclient.privatePostTrade()\n"
    assert ".update(" in planted
    assert re.search(r"private_?(post|put|delete)", planted, re.IGNORECASE)
    assert re.search(r"\bwithdraw\(", planted + "\nclient.withdraw(1)\n")
    assert set(_FORBIDDEN_NAMES) & _code_names(planted + "\nreplace_equity_snapshots\n")


def test_every_venue_method_the_probe_names_exists_on_real_ccxt() -> None:
    """The venue fakes in this file define whatever method the probe calls, so a misspelt name
    (CR-01: ``fapiPrivate_get_income``, which ccxt does not generate) passes every fake and fails
    on the first real Binance key. Check the names against the real async classes, class
    attributes only, so no session or network is created."""
    import ccxt.async_support as cx

    named = set(re.findall(r"\.(fapiPrivate\w+|private_get_\w+)\(", _PROBE_SRC))
    assert any(n.startswith("fapi") for n in named)  # the scan sees the Binance read
    for venue, name in (
        ("okx", "private_get_account_bills_archive"),
        ("bybit", "private_get_v5_position_closed_pnl"),
        ("bybit", "private_get_v5_account_transaction_log"),
        *(("binance", n) for n in sorted(named) if n.startswith("fapi")),
        *(("bybit", n) for n in sorted(named) if n.startswith("private_get_v5")),
    ):
        assert hasattr(getattr(cx, venue), name), (venue, name)


def test_source_calls_the_chains_own_readers() -> None:
    # A positive pin: the probe measures with the chain's own functions, not copies of them.
    for name in ("read_key_marks(", "placed_flow_instants(", "eligible_key_predicate("):
        assert name in _PROBE_SRC, name


def test_source_names_only_the_one_table_it_reads() -> None:
    literal = re.findall(r'\.table\(\s*"([a-z_]+)"\s*\)', _PROBE_SRC)
    assert literal == ["api_keys"]
    # The wrapper is carried in the source, so its own ``self._inner.table(name)`` is the one
    # other ``.table(``; no second table is read.
    assert _PROBE_SRC.count(".table(") == 2


def test_source_every_database_handle_the_probe_passes_on_is_the_wrapper() -> None:
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


async def test_read_only_the_handle_the_marks_read_and_the_price_resolver_get_is_the_wrapper(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    seen: list[tuple[str, type]] = []
    real_read_key_marks = wp.read_key_marks

    def _spy_marks(supabase: Any, key_id: str) -> Any:
        seen.append(("marks", type(supabase)))
        return real_read_key_marks(supabase, key_id)

    async def _spy_prices(_client: Any, _venue: str, supabase: Any, _rows: Any) -> Any:
        seen.append(("prices", type(supabase)))
        return {}

    monkeypatch.setattr(wp, "read_key_marks", _spy_marks)
    monkeypatch.setattr("services.job_worker._resolve_ccxt_flow_price_index", _spy_prices)
    venue = _OkxVenue(
        [_reach_bill()],
        deposits=[_transfer("fake-dep-1", "deposit", _B_MS + _HOUR_MS, amount=10.0)],
    )
    await _run_one_okx_key(monkeypatch, capsys, venue)
    assert seen == [("marks", wp.ReadOnlySupabase), ("prices", wp.ReadOnlySupabase)]


async def test_read_only_a_full_run_leaves_the_fake_databases_writes_empty(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _OkxVenue(
        [_reach_bill(), _in_window(2, pnl="15")],
        deposits=[_transfer("fake-dep-1", "deposit", _B_MS + _HOUR_MS, amount=10.0)],
        withdrawals=[_transfer("fake-wd-1", "withdrawal", _B_MS + 2 * _HOUR_MS, amount=4.0)],
    )
    keys = [_key_row(), _key_row("fake-key-id-dead", created="2026-02-01", is_active=False)]
    marks = [_mark_row(), _mark_row("fake-key-id-dead")]
    code, lines, services = await _run_world(monkeypatch, capsys, keys, marks, [venue])
    assert code == wp.EXIT_FAILED  # the dead key is unmeasurable; the run still completed
    assert lines[0]["measured"] is True and lines[0]["flow_rows_in_window"] == 2
    assert services.supabase.writes == []
    assert set(services.supabase.tables_touched) <= {"api_keys", "api_key_nav_marks"}


def test_read_only_the_bare_fake_records_a_write_so_the_empty_assertion_can_fail() -> None:
    fake = _FakeSupabase({"api_keys": [], "api_key_nav_marks": []})
    fake.table("api_keys").insert({"id": "fake-row"})
    fake.table("api_key_nav_marks").upsert({"id": "fake-row"})
    fake.rpc("some_writer")
    assert fake.writes == ["insert:api_keys", "upsert:api_key_nav_marks", "rpc:some_writer"]


# ---------------------------------------------------------------------------
# Redaction (SC-3 / public repo): planted needles never reach stdout or stderr, and the leak
# check can find them in a leaky string.
# ---------------------------------------------------------------------------

_KEY_TWO = "fake-key-id-two"
_NAV_NEEDLE = 7777.25
_PNL_NEEDLE = "4321.5"
_FLOW_NEEDLE = 8888.125
_BILL_IDS = (1234567800, 1234567801, 1234567802)
_TRANSFER_ID = "fake-transfer-id-77"
_NAV_TWO_NEEDLE = 3141.5927
_VENUE_MESSAGE = "fake-venue-message-secret 1234567899"
_NEEDLES = (
    _KEY_OKX,
    _KEY_TWO,
    _USER_ONE,
    _CIPHER,
    "7777.25",
    _PNL_NEEDLE,
    "8888.125",
    "3141.5927",
    *(str(i) for i in _BILL_IDS),
    _TRANSFER_ID,
    _VENUE_MESSAGE,
    "fake-venue-message-secret",
)


def _leaks(text: str, needles: tuple[str, ...] | list[str]) -> list[str]:
    """The needles found in ``text``; empty means nothing leaked."""
    return [needle for needle in needles if needle in text]


def _redaction_world() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[Any]]:
    """Two keys: k1 measured from planted ten-digit bill ids, a P&L amount, a NAV and a flow;
    k2 failing with a venue message that carries an id."""
    keys = [
        _key_row(_KEY_OKX, created="2026-01-01"),
        _key_row(_KEY_TWO, created="2026-02-01"),
    ]
    marks = [_mark_row(_KEY_OKX, nav=_NAV_NEEDLE), _mark_row(_KEY_TWO, nav=_NAV_TWO_NEEDLE)]
    measured = _OkxVenue(
        [
            _bill(_BILL_IDS[0], _B_MS - _HOUR_MS),
            _bill(_BILL_IDS[1], _B_MS + _HOUR_MS, pnl=_PNL_NEEDLE),
        ],
        deposits=[
            _transfer(_TRANSFER_ID, "deposit", _B_MS + 2 * _HOUR_MS, amount=_FLOW_NEEDLE)
        ],
    )
    failing = _OkxVenue([_bill(_BILL_IDS[2], _B_MS + _HOUR_MS, pnl=_PNL_NEEDLE)])
    failing.private_get_account_bills_archive.effect = ccxt.AuthenticationError(_VENUE_MESSAGE)
    return keys, marks, [measured, failing]


@pytest.fixture
def _logging_restored() -> Any:
    """main() switches logging off for the whole process; give it back."""
    import logging

    yield
    logging.disable(logging.NOTSET)


def test_redaction_a_full_run_leaves_no_planted_needle_in_stdout_or_stderr(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    _logging_restored: Any,
) -> None:
    keys, marks, clients = _redaction_world()
    services = _Services({"api_keys": keys, "api_key_nav_marks": marks}, clients)
    services.install(monkeypatch)

    assert wp.main([]) == wp.EXIT_FAILED  # k2 is unmeasurable
    captured = capsys.readouterr()
    first, second, summary = [json.loads(line) for line in captured.out.splitlines()]

    # The record is populated with the planted figures, so a leak had every chance to show.
    # 4321.5 / 7777.25 = 0.556, 8888.125 / 7777.25 = 1.14, (4321.5 + 8888.125) / 7777.25 = 1.7
    assert first["measured"] is True
    assert (first["pnl_ratio"], first["flow_ratio"], first["offset_ratio"]) == (0.556, 1.14, 1.7)
    assert first["bills_in_window"] == 1 and first["flow_rows_in_window"] == 1
    _assert_unmeasured(second, "read_failed", "AuthenticationError")
    assert summary["keys_unmeasurable"] == 1

    assert _leaks(captured.out + captured.err, _NEEDLES) == []
    assert services.decrypt_calls == [_KEY_OKX, _KEY_TWO]  # both keys really went through the read


def test_leaks_the_check_finds_the_needles_in_a_deliberately_leaky_string() -> None:
    keys, marks, _clients = _redaction_world()
    leaky = json.dumps([keys, marks])
    found = _leaks(leaky, _NEEDLES)
    assert _KEY_OKX in found and _USER_ONE in found and _CIPHER in found
    assert "7777.25" in found and "3141.5927" in found
    assert _leaks("k1 measured 0.556", _NEEDLES) == []  # control: a clean line reports nothing


async def test_leaks_the_check_fails_a_run_whose_emitter_prints_the_raw_rows(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """End to end: replace the emitter with one that appends the raw key and mark rows, and the
    same check reports the needles. The clean run above therefore proves something."""
    keys, marks, clients = _redaction_world()

    def _leaky_emit(record: Any) -> str:
        return json.dumps({"record": record, "debug": [keys, marks]})

    monkeypatch.setattr(wp, "emit_record", _leaky_emit)
    services = _Services({"api_keys": keys, "api_key_nav_marks": marks}, clients)
    services.install(monkeypatch)
    await wp.run()
    captured = capsys.readouterr()
    assert _KEY_OKX in _leaks(captured.out + captured.err, _NEEDLES)


# ---------------------------------------------------------------------------
# The emitter: the one path to stdout.
# ---------------------------------------------------------------------------


def _blank_key_record() -> dict[str, Any]:
    return wp._key_record("k1", "okx", "2026-11-01")


def test_emit_the_honest_blank_record_and_the_summary_print() -> None:
    record = _blank_key_record()
    assert json.loads(wp.emit_record(record))["unmeasurable_reason"] == "none"
    summary = wp.summarize([record], "2026-11-01")
    assert json.loads(wp.emit_record(summary))["record"] == "summary"


def test_emit_rejects_every_out_of_contract_record() -> None:
    rec = _blank_key_record()
    bad: list[dict[str, Any]] = [
        {**rec, "wallet_usd": 9137.45},  # an extra key: a leaked amount
        {k: v for k, v in rec.items() if k != "offset_ratio"},  # a missing key
        {**rec, "unmeasurable_reason": "a-reason-nobody-declared"},
        {**rec, "failure_class": "AuthenticationError: 4321.5"},
        {**rec, "offset_ratio": 0.123456},  # an unrounded float
        {**rec, "offset_ratio": float("nan")},
        {**rec, "pnl_ratio": 4321},  # an int where a ratio is declared
        {**rec, "key": "k1234567890"},  # a ten-digit string in the label
        {**rec, "key": "user-1"},
        {**rec, "run_date": "2026-11-01T10:30:15Z"},  # finer than the run date
        {**rec, "first_mark_day": "2026-10-26T06:00:00Z"},
        {**rec, "venue": "deribit"},
        {**rec, "record": "other"},
        {**rec, "measured": "true"},
        {**rec, "shares_account": 1},
        {**rec, "partial": "maybe"},
        {**rec, "bills_in_window": True},  # True where a count is declared
        {**rec, "bills_in_window": 1.0},
        {**rec, "bills_in_window": -1},
        {**rec, "bills_in_window": "4321.5"},
    ]
    for record in bad:
        with pytest.raises(ValueError):
            wp.emit_record(record)
    summary = wp.summarize([rec], "2026-11-01")
    for record in (
        {**summary, "okx_state": "maybe"},
        {**summary, "keys": True},
        {**summary, "balance": 1.5},
        {**summary, "okx_max_abs_pnl_ratio": 0.123456},
    ):
        with pytest.raises(ValueError):
            wp.emit_record(record)


def test_emit_rejection_names_the_path_and_never_the_value() -> None:
    rec = _blank_key_record()
    with pytest.raises(ValueError) as value_error:
        wp.emit_record({**rec, "failure_class": "boom 4321.5"})
    assert "failure_class" in str(value_error.value)
    assert "4321.5" not in str(value_error.value)
    with pytest.raises(ValueError) as key_error:
        wp.emit_record({**rec, "wallet_usd": 9137.45})
    assert "wallet_usd" in str(key_error.value)
    assert "9137.45" not in str(key_error.value)


# ---------------------------------------------------------------------------
# main: no arguments, logging off, the exception TYPE only.
# ---------------------------------------------------------------------------


def test_main_the_exit_codes_are_the_documented_ones() -> None:
    assert (wp.EXIT_OK, wp.EXIT_FAILED) == (0, 1)
    assert asyncio.iscoroutinefunction(wp.run)


def test_main_takes_no_options_and_rejects_any_argument() -> None:
    for argv in (["--anything"], ["anything"]):
        with pytest.raises(SystemExit) as exc:
            wp.main(argv)
        assert exc.value.code != 0


def test_main_switches_logging_off_while_run_executes(
    monkeypatch: pytest.MonkeyPatch, _logging_restored: Any
) -> None:
    import logging

    seen: list[int] = []

    async def _run() -> int:
        seen.append(logging.root.manager.disable)
        return wp.EXIT_FAILED

    monkeypatch.setattr(wp, "run", _run)
    assert wp.main([]) == wp.EXIT_FAILED
    assert seen == [logging.CRITICAL]


def test_main_prints_the_exception_type_only_on_a_run_level_failure(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    _logging_restored: Any,
) -> None:
    async def _boom() -> int:
        raise RuntimeError(f"db password {_PNL_NEEDLE} {_KEY_OKX}")

    monkeypatch.setattr(wp, "run", _boom)
    assert wp.main([]) == wp.EXIT_FAILED
    captured = capsys.readouterr()
    assert captured.err.strip() == "failed: RuntimeError"
    assert _leaks(captured.err, _NEEDLES) == []
    assert captured.out == ""


# ---------------------------------------------------------------------------
# Plan 03: the Bybit reader. Closed P&L ex-funding by the chain's own formula, SETTLEMENT funding,
# the Unified-edge count as a diagnostic, and the shared flow term. The venue is a local fake
# that enforces the vendor rules the production loops rely on (strings for the times, at most
# 7 days between them, newest first, an opaque cursor), hard-coded here on purpose rather than
# imported from the code under test.
# ---------------------------------------------------------------------------

_SEVEN_DAYS_MS = 7 * 24 * _HOUR_MS
_KEY_BYBIT = "fake-key-id-bybit"
# Read 5.5 h into 2026-10-27 UTC: B is the same instant as the tracer's, R is 5.5 h after it.
_MARKED_AT_BYBIT = datetime(2026, 10, 27, 5, 30, 0, tzinfo=timezone.utc)
_R_BYBIT_MS = _epoch_ms(_MARKED_AT_BYBIT)


def _closed_row(
    symbol: str,
    side: str,
    entry: str,
    exit_: str,
    open_fee: str,
    close_fee: str,
    created_ms: int,
) -> dict[str, str]:
    """One Bybit closed-pnl row: only the fields the chain's formula reads, all strings."""
    return {
        "symbol": symbol,
        "side": side,
        "cumEntryValue": entry,
        "cumExitValue": exit_,
        "openFee": open_fee,
        "closeFee": close_fee,
        "createdTime": str(created_ms),
    }


def _settlement(category: str, symbol: str, currency: str, funding: str, ts_ms: int) -> dict[str, Any]:
    return {
        "category": category,
        "id": f"fake-settle-{symbol}-{ts_ms}",
        "symbol": symbol,
        "type": "SETTLEMENT",
        "currency": currency,
        "funding": funding,
        "transactionTime": str(ts_ms),
    }


def _unified_transfer(row_id: str, log_type: str, change: str, ts_ms: int) -> dict[str, Any]:
    return {
        "id": row_id,
        "type": log_type,
        "currency": "USDT",
        "change": change,
        "cashFlow": change,
        "funding": "",
        "transactionTime": str(ts_ms),
    }


class _BybitVenue:
    """A Bybit V5 client: closed P&L, and the transaction log in its two shapes.

    The SETTLEMENT half is read without ``accountType`` (what ``fetch_funding_bybit`` sends);
    the Unified half carries ``accountType`` UNIFIED and a ``TRANSFER_IN`` / ``TRANSFER_OUT``
    type. ``honour_window=False`` makes closed P&L ignore the requested times, which models a
    venue page that spills rows past the window, so the probe's OWN window filter decides.
    ``repeat_cursor`` answers a cursor that never advances. ``closed_reply`` replaces the
    closed-pnl answer outright (a malformed shape). ``log_effects`` maps ``"SETTLEMENT"`` or
    ``"UNIFIED"`` to an exception raised for that half."""

    id = "bybit"
    rateLimit = 0

    def __init__(
        self,
        closed: list[dict[str, str]] | None = None,
        *,
        settlements: list[dict[str, Any]] | None = None,
        transfers: list[dict[str, Any]] | None = None,
        closed_page_size: int = 100,
        honour_window: bool = True,
        repeat_cursor: bool = False,
        closed_reply: Any = None,
        log_effects: dict[str, BaseException] | None = None,
        inverse_bad_request: bool = False,
    ) -> None:
        self._closed = [dict(r) for r in closed or []]
        self._settlements = [dict(r) for r in settlements or []]
        self._transfers = [dict(r) for r in transfers or []]
        self._closed_page_size = closed_page_size
        self._honour_window = honour_window
        self._repeat_cursor = repeat_cursor
        self._closed_reply = closed_reply
        self._log_effects = dict(log_effects or {})
        self._inverse_bad_request = inverse_bad_request
        self.closed_calls: list[dict[str, Any]] = []
        self.log_calls: list[dict[str, Any]] = []

    @staticmethod
    def _stamp(row: dict[str, Any], field: str) -> int:
        try:
            return int(row[field])
        except (TypeError, ValueError):
            return 0

    async def private_get_v5_position_closed_pnl(self, params: dict[str, Any]) -> Any:
        self.closed_calls.append(dict(params))
        if self._closed_reply is not None:
            return self._closed_reply
        start, end = int(params["startTime"]), int(params["endTime"])
        if end - start > _SEVEN_DAYS_MS:
            raise ccxt.BadRequest("fake-bybit: the interval between startTime and endTime exceeds 7 days")
        rows = [
            r
            for r in self._closed
            if not self._honour_window or start <= self._stamp(r, "createdTime") <= end
        ]
        rows.sort(key=lambda r: -self._stamp(r, "createdTime"))
        size = min(int(params["limit"]), self._closed_page_size)
        cursor = params.get("cursor") or ""
        if self._repeat_cursor:
            offset = size if cursor else 0
            return {
                "retCode": 0,
                "result": {"list": rows[offset : offset + size], "nextPageCursor": "c-stuck"},
            }
        offset = int(cursor[1:]) if cursor else 0
        more = offset + size < len(rows)
        return {
            "retCode": 0,
            "result": {
                "list": rows[offset : offset + size],
                "nextPageCursor": f"c{offset + size}" if more else "",
            },
        }

    async def private_get_v5_account_transaction_log(self, params: dict[str, Any]) -> Any:
        self.log_calls.append(dict(params))
        unified = params.get("accountType") == "UNIFIED"
        effect = self._log_effects.get("UNIFIED" if unified else "SETTLEMENT")
        if effect is not None:
            raise effect
        if self._inverse_bad_request and params.get("category") == "inverse":
            raise ccxt.BadRequest("fake-bybit: no inverse scope")
        start, end = int(params["startTime"]), int(params["endTime"])
        if end - start > _SEVEN_DAYS_MS:
            raise ccxt.BadRequest("fake-bybit: the interval between startTime and endTime exceeds 7 days")
        if unified:
            pool = [r for r in self._transfers if r["type"] == params["type"]]
        else:
            assert params.get("type") == "SETTLEMENT", params
            pool = [r for r in self._settlements if r["category"] == params.get("category")]
        inside = [r for r in pool if start <= self._stamp(r, "transactionTime") <= end]
        inside.sort(key=lambda r: -self._stamp(r, "transactionTime"))
        cursor = params.get("cursor") or ""
        offset = int(cursor[1:]) if cursor else 0
        size = min(int(params["limit"]), 50)
        more = offset + size < len(inside)
        chunk = [
            {k: v for k, v in r.items() if k != "category"} for r in inside[offset : offset + size]
        ]
        return {
            "retCode": 0,
            "result": {"list": chunk, "nextPageCursor": f"c{offset + size}" if more else ""},
        }


def _install_bybit_flows(
    monkeypatch: pytest.MonkeyPatch, rows: dict[str, list[dict[str, Any]]] | None = None
) -> list[tuple[str, int, int]]:
    """Serve the chain's deposit and withdrawal rows for a Bybit client from ``rows`` (by kind),
    recording the arguments. Any other venue's client keeps the real fetcher."""
    from services import ccxt_flow_fetch

    real = ccxt_flow_fetch.fetch_ccxt_transfers
    served = rows or {}
    calls: list[tuple[str, int, int]] = []

    async def _fake(exchange: Any, kind: str, since_ms: int, now_ms: int) -> list[dict[str, Any]]:
        if getattr(exchange, "id", "") != "bybit":
            return await real(exchange, kind, since_ms, now_ms)
        calls.append((kind, since_ms, now_ms))
        return [dict(r) for r in served.get(kind, [])]

    monkeypatch.setattr("services.ccxt_flow_fetch.fetch_ccxt_transfers", _fake)
    return calls


def _bybit_mark(*, nav: float = 10000.0, open_pnl: float = 1000.0) -> dict[str, Any]:
    return _mark_row(
        _KEY_BYBIT, marked_at=_MARKED_AT_BYBIT, nav=nav, open_pnl=open_pnl, venue="bybit"
    )


async def _run_bybit_key(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    venue: _BybitVenue,
    *,
    flows: dict[str, list[dict[str, Any]]] | None = None,
    mark: dict[str, Any] | None = None,
) -> tuple[int, list[dict[str, Any]], _Services, list[tuple[str, int, int]]]:
    flow_calls = _install_bybit_flows(monkeypatch, flows)
    services = _Services(
        {
            "api_keys": [_key_row(_KEY_BYBIT, "bybit")],
            "api_key_nav_marks": [mark or _bybit_mark()],
        },
        [venue],
    )
    services.install(monkeypatch)
    code = await wp.run()
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    return code, lines, services, flow_calls


def _bybit_world() -> _BybitVenue:
    """The hand-worked world: two in-window closed rows (+10.8 and -5.5), one row a second after
    R and one a second before B (both outside), three in-window SETTLEMENT rows (USDT -0.3, USDC
    0.1, and BTC which is not a stablecoin) and two Unified TRANSFER_IN rows."""
    return _BybitVenue(
        [
            _closed_row("BTCUSDT", "Sell", "1000", "1012", "0.6", "0.6", _B_MS + _HOUR_MS),
            _closed_row("ETHUSDT", "Buy", "500", "505", "0.3", "0.2", _B_MS + 2 * _HOUR_MS),
            _closed_row("SOLUSDT", "Sell", "9999", "99999", "1", "1", _R_BYBIT_MS + 1000),
            _closed_row("XRPUSDT", "Sell", "9999", "99999", "1", "1", _B_MS - 1000),
        ],
        settlements=[
            _settlement("linear", "BTCUSDT", "USDT", "-0.3", _B_MS + _HOUR_MS),
            _settlement("linear", "ETHPERP", "USDC", "0.1", _B_MS + 2 * _HOUR_MS),
            _settlement("inverse", "BTCUSD", "BTC", "0.00001", _B_MS + 3 * _HOUR_MS),
        ],
        transfers=[
            _unified_transfer("fake-uni-1", "TRANSFER_IN", "100", _B_MS + _HOUR_MS),
            _unified_transfer("fake-uni-2", "TRANSFER_IN", "50", _B_MS + 2 * _HOUR_MS),
        ],
    )


async def test_bybit_first_mark_offset_end_to_end(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _bybit_world()
    code, lines, services, flow_calls = await _run_bybit_key(monkeypatch, capsys, venue)

    assert code == wp.EXIT_OK
    record, summary = lines
    # Every value below is worked out by hand: trading 10.8 - 5.5 = 5.3 over NAV 10000, funding
    # -0.3 + 0.1 = -0.2 (the BTC row is excluded), P&L 5.1, wallet 10000 - 1000 = 9000.
    assert record == {
        "record": "key",
        "key": "k1",
        "venue": "bybit",
        "run_date": "2026-11-01",
        "first_mark_day": "2026-10-26",
        "read_delay_hours": 5.5,
        "measured": True,
        "unmeasurable_reason": "none",
        "failure_class": "none",
        "partial": True,
        "shares_account": False,
        "pnl_trading_ratio": 0.00053,
        "pnl_funding_ratio": -0.00002,
        "pnl_ratio": 0.00051,
        "flow_ratio": 0.0,
        "offset_ratio": 0.00051,
        "offset_over_wallet_ratio": 0.000567,
        "bills_in_window": "field-absent",
        "transfer_bills_in_window": "field-absent",
        "spot_bills_in_window": "field-absent",
        "other_inst_bills_in_window": "field-absent",
        "closed_pnl_rows_in_window": 2,
        "income_rows_in_window": "field-absent",
        "funding_rows_in_window": 3,
        "flow_rows_in_window": 0,
        "unified_edge_rows_in_window": 2,
        "non_stable_rows": 1,
    }
    assert summary["bybit_state"] == "measured"
    assert summary["bybit_max_abs_pnl_ratio"] == 0.00051
    assert summary["keys_measured"] == 1 and summary["keys_unmeasurable"] == 0
    # The chain's flows are read for the window's own bounds, once per kind.
    assert sorted(flow_calls) == [
        ("deposits", _B_MS, _R_BYBIT_MS),
        ("withdrawals", _B_MS, _R_BYBIT_MS),
    ]
    assert services.decrypt_calls == [_KEY_BYBIT]
    assert services.closed == [venue]
    assert services.supabase.writes == []


async def test_bybit_every_closed_pnl_call_is_linear_100_rows_and_inside_seven_days(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _bybit_world()
    await _run_bybit_key(monkeypatch, capsys, venue)
    assert venue.closed_calls, "closed P&L was never read"
    for call in venue.closed_calls:
        assert call["category"] == "linear"
        assert call["limit"] == "100"
        assert isinstance(call["startTime"], str) and isinstance(call["endTime"], str)
        assert int(call["endTime"]) - int(call["startTime"]) <= _SEVEN_DAYS_MS
    first = venue.closed_calls[0]
    assert (first["startTime"], first["endTime"]) == (str(_B_MS), str(_R_BYBIT_MS))


async def test_bybit_rows_outside_the_window_add_nothing_even_when_the_venue_serves_them(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _BybitVenue(
        [
            _closed_row("BTCUSDT", "Sell", "1000", "1012", "0.6", "0.6", _B_MS + _HOUR_MS),
            _closed_row("SOLUSDT", "Sell", "9999", "99999", "1", "1", _R_BYBIT_MS + 1000),
            _closed_row("XRPUSDT", "Sell", "9999", "99999", "1", "1", _B_MS - 1000),
        ],
        honour_window=False,
    )
    _code, lines, _services, _calls = await _run_bybit_key(monkeypatch, capsys, venue)
    assert lines[0]["closed_pnl_rows_in_window"] == 1
    assert lines[0]["pnl_trading_ratio"] == 0.00108  # 10.8 / 10000


async def test_bybit_rows_exactly_on_the_window_edges_are_inside(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _BybitVenue(
        [
            _closed_row("BTCUSDT", "Sell", "1000", "1010", "0", "0", _B_MS),
            _closed_row("ETHUSDT", "Sell", "1000", "1020", "0", "0", _R_BYBIT_MS),
        ],
        honour_window=False,
    )
    _code, lines, _services, _calls = await _run_bybit_key(monkeypatch, capsys, venue)
    assert lines[0]["closed_pnl_rows_in_window"] == 2
    assert lines[0]["pnl_trading_ratio"] == 0.003  # (10 + 20) / 10000


async def test_bybit_a_row_listed_twice_counts_once(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    row = _closed_row("BTCUSDT", "Sell", "1000", "1012", "0.6", "0.6", _B_MS + _HOUR_MS)
    venue = _BybitVenue([row, dict(row)])
    _code, lines, _services, _calls = await _run_bybit_key(monkeypatch, capsys, venue)
    assert lines[0]["closed_pnl_rows_in_window"] == 1
    assert lines[0]["pnl_trading_ratio"] == 0.00108


async def test_bybit_a_cursor_is_followed_to_the_next_page(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    rows = [
        _closed_row("BTCUSDT", "Sell", "1000", "1010", "0", "0", _B_MS + _HOUR_MS),
        _closed_row("ETHUSDT", "Sell", "1000", "1020", "0", "0", _B_MS + 2 * _HOUR_MS),
        _closed_row("SOLUSDT", "Sell", "1000", "1030", "0", "0", _B_MS + 3 * _HOUR_MS),
    ]
    venue = _BybitVenue(rows, closed_page_size=1)
    _code, lines, _services, _calls = await _run_bybit_key(monkeypatch, capsys, venue)
    assert lines[0]["closed_pnl_rows_in_window"] == 3
    assert lines[0]["pnl_trading_ratio"] == 0.006  # (10 + 20 + 30) / 10000
    assert len(venue.closed_calls) == 3
    assert [c.get("cursor", "") for c in venue.closed_calls] == ["", "c1", "c2"]


async def test_bybit_a_repeated_cursor_stops_the_read_as_the_chains_own_loop_does(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    rows = [
        _closed_row("BTCUSDT", "Sell", "1000", "1010", "0", "0", _B_MS + 3 * _HOUR_MS),
        _closed_row("ETHUSDT", "Sell", "1000", "1020", "0", "0", _B_MS + 2 * _HOUR_MS),
        _closed_row("SOLUSDT", "Sell", "1000", "1030", "0", "0", _B_MS + _HOUR_MS),
    ]
    venue = _BybitVenue(rows, closed_page_size=1, repeat_cursor=True)
    _code, lines, _services, _calls = await _run_bybit_key(monkeypatch, capsys, venue)
    # The cursor the venue answers on page two is the one it was sent: the read stops there, with
    # no third call, exactly where fetch_daily_pnl stops (``next_cursor == cursor``).
    assert len(venue.closed_calls) == 2
    assert lines[0]["measured"] is True
    assert lines[0]["closed_pnl_rows_in_window"] == 2


async def test_bybit_the_page_ceiling_with_a_cursor_still_pending_is_page_ceiling(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(wp, "BYBIT_CLOSED_PNL_PAGE_CEILING", 2)
    rows = [
        _closed_row("BTCUSDT", "Sell", "1000", "1010", "0", "0", _B_MS + _HOUR_MS),
        _closed_row("ETHUSDT", "Sell", "1000", "1020", "0", "0", _B_MS + 2 * _HOUR_MS),
        _closed_row("SOLUSDT", "Sell", "1000", "1030", "0", "0", _B_MS + 3 * _HOUR_MS),
    ]
    venue = _BybitVenue(rows, closed_page_size=1)
    code, lines, _services, _calls = await _run_bybit_key(monkeypatch, capsys, venue)
    _assert_unmeasured(lines[0], "page_ceiling")
    assert len(venue.closed_calls) == 2
    assert code == wp.EXIT_FAILED


async def test_bybit_a_last_page_that_ends_exactly_at_the_ceiling_is_not_a_ceiling_hit(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(wp, "BYBIT_CLOSED_PNL_PAGE_CEILING", 2)
    rows = [
        _closed_row("BTCUSDT", "Sell", "1000", "1010", "0", "0", _B_MS + _HOUR_MS),
        _closed_row("ETHUSDT", "Sell", "1000", "1020", "0", "0", _B_MS + 2 * _HOUR_MS),
    ]
    venue = _BybitVenue(rows, closed_page_size=1)
    _code, lines, _services, _calls = await _run_bybit_key(monkeypatch, capsys, venue)
    assert lines[0]["measured"] is True
    assert lines[0]["closed_pnl_rows_in_window"] == 2


@pytest.mark.parametrize("field", ["cumEntryValue", "cumExitValue", "openFee", "closeFee"])
@pytest.mark.parametrize("bad", ["nan", "inf", "abc"])
async def test_bybit_a_closed_pnl_field_that_is_not_a_finite_number_is_malformed(
    field: str,
    bad: str,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    row = _closed_row("BTCUSDT", "Sell", "1000", "1012", "0.6", "0.6", _B_MS + _HOUR_MS)
    row[field] = bad
    _code, lines, _services, _calls = await _run_bybit_key(
        monkeypatch, capsys, _BybitVenue([row])
    )
    _assert_unmeasured(lines[0], "malformed")


@pytest.mark.parametrize("bad", ["abc", "", "12.5"])
async def test_bybit_an_unparsable_created_time_is_malformed(
    bad: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    row = _closed_row("BTCUSDT", "Sell", "1000", "1012", "0.6", "0.6", _B_MS + _HOUR_MS)
    row["createdTime"] = bad
    venue = _BybitVenue([row], honour_window=False)
    _code, lines, _services, _calls = await _run_bybit_key(monkeypatch, capsys, venue)
    _assert_unmeasured(lines[0], "malformed")


@pytest.mark.parametrize(
    "reply",
    [
        "not-a-dict",
        {"result": None},
        {"result": {}},
        {"result": {"list": "not-a-list"}},
        {"result": {"list": [], "nextPageCursor": 7}},
        {"result": {"list": ["not-a-row"], "nextPageCursor": ""}},
    ],
)
async def test_bybit_a_reply_without_a_readable_result_list_is_malformed(
    reply: Any, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _BybitVenue(closed_reply=reply)
    code, lines, _services, _calls = await _run_bybit_key(monkeypatch, capsys, venue)
    _assert_unmeasured(lines[0], "malformed")
    assert code == wp.EXIT_FAILED


async def test_bybit_a_failed_settlement_read_is_read_failed_with_its_class_only(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _BybitVenue(
        [_closed_row("BTCUSDT", "Sell", "1000", "1012", "0.6", "0.6", _B_MS + _HOUR_MS)],
        log_effects={"SETTLEMENT": ccxt.AuthenticationError(_PLANTED_MESSAGE)},
    )
    code, lines, _services, _calls = await _run_bybit_key(monkeypatch, capsys, venue)
    _assert_unmeasured(lines[0], "read_failed", "AuthenticationError")
    assert _PLANTED_MESSAGE not in json.dumps(lines)
    assert code == wp.EXIT_FAILED


@pytest.mark.parametrize("damage", ["blank_symbol", "no_amount_field"])
async def test_bybit_a_settlement_row_the_chain_drops_makes_the_key_malformed_never_a_clean_sum(
    damage: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """``fetch_funding_bybit`` drops a SETTLEMENT row it cannot read with only a log line (and the
    probe runs with logging off). Summing what is left would print ``measured`` and not ``partial``
    for a key whose funding sum is missing a row, so the probe compares the rows the venue sent
    with the rows the chain function returned and refuses the key when they differ."""
    bad = _settlement("linear", "ETHUSDT", "USDT", "-0.2", _B_MS + 2 * _HOUR_MS)
    if damage == "blank_symbol":
        bad["symbol"] = ""
    else:
        del bad["funding"]
    venue = _BybitVenue(
        [_closed_row("BTCUSDT", "Sell", "1000", "1012", "0.6", "0.6", _B_MS + _HOUR_MS)],
        settlements=[_settlement("linear", "BTCUSDT", "USDT", "-0.3", _B_MS + _HOUR_MS), bad],
    )
    code, lines, _services, _calls = await _run_bybit_key(monkeypatch, capsys, venue)
    _assert_unmeasured(lines[0], "malformed")
    assert code == wp.EXIT_FAILED


async def test_bybit_a_failed_unified_edge_read_is_read_failed_never_a_key_with_a_count_missing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _BybitVenue(
        [_closed_row("BTCUSDT", "Sell", "1000", "1012", "0.6", "0.6", _B_MS + _HOUR_MS)],
        log_effects={"UNIFIED": ccxt.PermissionDenied(_PLANTED_MESSAGE)},
    )
    code, lines, services, _calls = await _run_bybit_key(monkeypatch, capsys, venue)
    _assert_unmeasured(lines[0], "read_failed", "PermissionDenied")
    assert _PLANTED_MESSAGE not in json.dumps(lines)
    assert services.closed == [venue]
    assert code == wp.EXIT_FAILED


async def test_bybit_an_inverse_category_the_key_cannot_read_is_skipped_like_the_chain_does(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _BybitVenue(
        [_closed_row("BTCUSDT", "Sell", "1000", "1012", "0.6", "0.6", _B_MS + _HOUR_MS)],
        settlements=[_settlement("linear", "BTCUSDT", "USDT", "-0.3", _B_MS + _HOUR_MS)],
        inverse_bad_request=True,
    )
    _code, lines, _services, _calls = await _run_bybit_key(monkeypatch, capsys, venue)
    assert lines[0]["measured"] is True
    assert lines[0]["funding_rows_in_window"] == 1
    assert lines[0]["pnl_funding_ratio"] == -0.00003  # -0.3 / 10000


async def test_bybit_the_chains_flows_are_added_and_the_unified_edge_rows_are_not(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _BybitVenue(
        [],
        transfers=[_unified_transfer("fake-uni-1", "TRANSFER_IN", "700", _B_MS + _HOUR_MS)],
    )
    flows = {
        "deposits": [_transfer("fake-dep-1", "deposit", _B_MS + 2 * _HOUR_MS, amount=100.0, fee=2.0)]
    }
    _code, lines, _services, _calls = await _run_bybit_key(
        monkeypatch, capsys, venue, flows=flows
    )
    record = lines[0]
    assert record["flow_rows_in_window"] == 1
    assert record["flow_ratio"] == 0.0098  # (100 - 2) / 10000
    assert record["offset_ratio"] == 0.0098
    # The Unified-edge row (700) is counted as a diagnostic and moves no ratio.
    assert record["unified_edge_rows_in_window"] == 1


async def test_bybit_a_nav_not_above_zero_is_nav_nonpositive_and_reads_nothing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _bybit_world()
    _code, lines, _services, flow_calls = await _run_bybit_key(
        monkeypatch, capsys, venue, mark=_bybit_mark(nav=0.0)
    )
    _assert_unmeasured(lines[0], "nav_nonpositive")
    assert venue.closed_calls == [] and venue.log_calls == [] and flow_calls == []


async def test_bybit_every_private_get_goes_through_the_per_key_call_budget(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(wp, "KEY_CALL_CEILING", 1)
    venue = _bybit_world()
    code, lines, _services, _calls = await _run_bybit_key(monkeypatch, capsys, venue)
    # One closed-pnl call spends the budget; the SETTLEMENT read is refused before the venue sees it.
    _assert_unmeasured(lines[0], "call_ceiling")
    assert len(venue.closed_calls) == 1 and venue.log_calls == []
    assert code == wp.EXIT_FAILED


def test_bybit_closed_pnl_terms_apply_the_chains_side_rule_by_hand() -> None:
    sell = _closed_row("BTCUSDT", "Sell", "1000", "1012", "0.6", "0.6", _B_MS)
    buy = _closed_row("ETHUSDT", "Buy", "500", "505", "0.3", "0.2", _B_MS)
    assert wp.bybit_closed_pnl_terms([sell]) == (pytest.approx(10.8, abs=1e-9), 1)
    assert wp.bybit_closed_pnl_terms([buy]) == (pytest.approx(-5.5, abs=1e-9), 1)
    assert wp.bybit_closed_pnl_terms([]) == (0.0, 0)


def test_bybit_closed_pnl_terms_read_the_side_case_and_blank_insensitively() -> None:
    row = _closed_row("ETHUSDT", "  BUY ", "500", "505", "0.3", "0.2", _B_MS)
    assert wp.bybit_closed_pnl_terms([row])[0] == pytest.approx(-5.5, abs=1e-9)


async def test_bybit_parity_with_fetch_daily_pnl(monkeypatch: pytest.MonkeyPatch) -> None:
    """The probe's per-row formula must equal the chain's own, which is inline in
    ``fetch_daily_pnl`` and cannot be called for a window: the same rows go through the real
    function on a fake exchange and through ``bybit_closed_pnl_terms``, and their day totals agree."""
    from services.exchange import fetch_daily_pnl

    rows = [
        _closed_row("BTCUSDT", "Sell", "1000", "1012", "0.6", "0.6", _B_MS + _HOUR_MS),
        _closed_row("ETHUSDT", "Buy", "500", "505", "0.3", "0.2", _B_MS + 2 * _HOUR_MS),
        _closed_row("BTCUSDT", "Buy", "2000", "1980", "1.2", "1.1", _B_MS + 3 * _HOUR_MS),
        _closed_row("SOLUSDT", "Sell", "300", "290", "0.1", "0.1", _B_MS + 4 * _HOUR_MS),
    ]
    venue = _BybitVenue(rows)
    chain_rows = await fetch_daily_pnl(venue, since_ms=_B_MS)  # type: ignore[arg-type]
    assert len(chain_rows) == 1, "all four rows fall on one UTC day"
    chain_day_total = sum(
        row["price"] * (1.0 if row["side"] == "buy" else -1.0) for row in chain_rows
    )
    probe_total, probe_count = wp.bybit_closed_pnl_terms(rows)
    assert probe_count == 4
    assert probe_total == pytest.approx(chain_day_total, rel=1e-9)
    # Hand-worked: 10.8 - 5.5 + 17.7 - 10.2.
    assert probe_total == pytest.approx(12.8, abs=1e-9)


async def test_okx_parity_with_fetch_daily_pnl_and_fetch_funding_okx() -> None:
    """The probe's OKX sum must equal the chain's own: the same bills go through the real
    ``fetch_daily_pnl`` (trading, per-instType query filters, type 8 dropped) and the real
    ``fetch_funding_okx`` (type 8, ``pnl``), and through ``okx_window_terms``; the read day's totals
    agree. Without it the probe is pinned only to hand-written literals, so a later edit to the
    chain's instType loop or funding type leaves the probe printing a stale quantity."""
    from services.exchange import fetch_daily_pnl
    from services.funding_fetch import fetch_funding_okx

    def funding(bill_id: int, hour: int, pnl: str, inst_id: str) -> dict[str, str]:
        return {
            **_bill(bill_id, _B_MS + hour * _HOUR_MS, pnl=pnl, fee="-0.1", bill_type="8"),
            "instId": inst_id,
        }

    bills = [
        # The four instTypes the chain queries: pnl + fee each.
        _bill(10, _B_MS + 1 * _HOUR_MS, pnl="15", fee="-0.5", inst_type="SWAP"),
        _bill(11, _B_MS + 2 * _HOUR_MS, pnl="-4", fee="-0.2", inst_type="FUTURES"),
        _bill(12, _B_MS + 3 * _HOUR_MS, pnl="2", fee="-0.5", inst_type="SPOT"),
        _bill(13, _B_MS + 4 * _HOUR_MS, pnl="1", fee="-0.1", inst_type="MARGIN"),
        # Funding (type 8): its pnl is funding, its fee is added nowhere, and it is not trading.
        funding(14, 2, "-3", "BTC-USDT-SWAP"),
        funding(15, 3, "1.25", "ETH-USDT-SWAP"),
        # Not in the chain's sum: an instType it never queries, and a transfer (blank instType).
        _bill(16, _B_MS + 5 * _HOUR_MS, pnl="40", fee="-1", inst_type="OPTION"),
        _bill(17, _B_MS + 5 * _HOUR_MS, pnl="500", bill_type="1", inst_type=""),
        # The day before: the chain books it on its own day; the probe's window excludes it.
        _bill(9, _B_MS - _HOUR_MS, pnl="1000", fee="0", inst_type="SWAP"),
    ]
    venue = SimpleNamespace(
        id="okx",
        rateLimit=0,
        private_get_account_bills=OkxBillsArchive(bills),
        private_get_account_bills_archive=OkxBillsArchive(bills),
    )
    read_day = _MARKED_AT.strftime("%Y-%m-%d")

    chain_trading = sum(
        row["price"] * (1.0 if row["side"] == "buy" else -1.0)
        for row in await fetch_daily_pnl(venue, since_ms=None)  # type: ignore[arg-type]
        if str(row["timestamp"]).startswith(read_day)
    )
    chain_funding = sum(
        float(row["amount"])
        for row in await fetch_funding_okx(venue, "k1", None)  # type: ignore[arg-type]
        if row["timestamp"].strftime("%Y-%m-%d") == read_day
    )

    terms = wp.okx_window_terms([wp._parse_window_bill(b) for b in bills], _B_MS, _R_MS)
    assert terms.trading_usd == pytest.approx(chain_trading, abs=1e-9)
    assert terms.funding_usd == pytest.approx(chain_funding, abs=1e-9)
    # Hand-worked: 14.5 - 4.2 + 1.5 + 0.9, and -3 + 1.25.
    assert terms.trading_usd == pytest.approx(12.7, abs=1e-9)
    assert terms.funding_usd == pytest.approx(-1.75, abs=1e-9)


# ---------------------------------------------------------------------------
# Plan 03: the Binance reader. One futures-income read for [B, R] with the chain's split
# (REALIZED_PNL and COMMISSION as trading, FUNDING_FEE as funding). A full reply cannot prove the
# window complete, so it is page_ceiling.
# ---------------------------------------------------------------------------

_KEY_BINANCE = "fake-key-id-binance"
_BINANCE_NAV = 5000.0


def _income(
    income_type: str,
    income: str,
    ts_ms: Any,
    *,
    asset: str | None = "USDT",
    symbol: str = "BTCUSDT",
) -> dict[str, Any]:
    """A Binance futures-income row; ``time`` is an integer in epoch milliseconds."""
    row: dict[str, Any] = {
        "symbol": symbol,
        "incomeType": income_type,
        "income": income,
        "time": ts_ms,
        "tranId": "fake-tran-id",
    }
    if asset is not None:
        row["asset"] = asset
    return row


class _BinanceVenue:
    """A Binance futures client: the income history and ccxt-shaped transfer history.

    ``honour_window=False`` serves every row whatever the times asked for, so the probe's OWN
    window filter decides; ``reply`` replaces the answer outright; ``effect`` is raised."""

    id = "binance"
    rateLimit = 0

    def __init__(
        self,
        income: list[dict[str, Any]] | None = None,
        *,
        honour_window: bool = True,
        reply: Any = None,
        effect: BaseException | None = None,
        deposits: list[dict[str, Any]] | None = None,
    ) -> None:
        self._income = [dict(r) for r in income or []]
        self._honour_window = honour_window
        self._reply = reply
        self._effect = effect
        self._deposits = list(deposits or [])
        self.income_calls: list[dict[str, Any]] = []

    async def fapiPrivateGetIncome(self, params: dict[str, Any]) -> Any:  # noqa: N802
        self.income_calls.append(dict(params))
        if self._effect is not None:
            raise self._effect
        if self._reply is not None:
            return self._reply
        start, end = params["startTime"], params["endTime"]
        rows = [
            dict(r)
            for r in self._income
            if not self._honour_window or start <= r["time"] <= end
        ]
        return rows[: int(params["limit"])]

    async def fetch_deposits(
        self, code: Any = None, since: Any = None, limit: Any = None, params: Any = None
    ) -> list[dict[str, Any]]:
        until = (params or {}).get("until")
        return [
            dict(r)
            for r in self._deposits
            if (since is None or r["timestamp"] >= since) and (until is None or r["timestamp"] <= until)
        ]

    async def fetch_withdrawals(
        self, code: Any = None, since: Any = None, limit: Any = None, params: Any = None
    ) -> list[dict[str, Any]]:
        return []


def _binance_mark(*, nav: float = _BINANCE_NAV) -> dict[str, Any]:
    return _mark_row(_KEY_BINANCE, marked_at=_MARKED_AT, nav=nav, venue="binance")


async def _run_binance_key(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    venue: _BinanceVenue,
    *,
    mark: dict[str, Any] | None = None,
) -> tuple[int, list[dict[str, Any]], _Services]:
    services = _Services(
        {
            "api_keys": [_key_row(_KEY_BINANCE, "binance")],
            "api_key_nav_marks": [mark or _binance_mark()],
        },
        [venue],
    )
    services.install(monkeypatch)
    code = await wp.run()
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    return code, lines, services


def _binance_world(**switches: Any) -> _BinanceVenue:
    return _BinanceVenue(
        [
            _income("REALIZED_PNL", "12.5", _B_MS + _HOUR_MS),
            _income("COMMISSION", "-0.5", _B_MS + 2 * _HOUR_MS),
            _income("FUNDING_FEE", "-1.0", _B_MS + 3 * _HOUR_MS),
            _income("TRANSFER", "1000", _B_MS + 4 * _HOUR_MS),
            _income("COMMISSION", "-0.01", _B_MS + 5 * _HOUR_MS, asset="BNB"),
            _income("REALIZED_PNL", "99", _R_MS + 1000),
        ],
        **switches,
    )


async def test_binance_first_mark_offset_end_to_end(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _binance_world()
    code, lines, services = await _run_binance_key(monkeypatch, capsys, venue)

    assert code == wp.EXIT_OK
    record, summary = lines
    # Hand-worked over NAV 5000: trading 12.5 - 0.5 = 12.0, funding -1.0, P&L 11.0. The TRANSFER
    # row is counted and summed nowhere; the BNB commission is excluded and counted.
    assert record == {
        "record": "key",
        "key": "k1",
        "venue": "binance",
        "run_date": "2026-11-01",
        "first_mark_day": _MARK_DAY,
        "read_delay_hours": 6.0,
        "measured": True,
        "unmeasurable_reason": "none",
        "failure_class": "none",
        "partial": True,
        "shares_account": False,
        "pnl_trading_ratio": 0.0024,
        "pnl_funding_ratio": -0.0002,
        "pnl_ratio": 0.0022,
        "flow_ratio": 0.0,
        "offset_ratio": 0.0022,
        "offset_over_wallet_ratio": 0.0022,
        "bills_in_window": "field-absent",
        "transfer_bills_in_window": "field-absent",
        "spot_bills_in_window": "field-absent",
        "other_inst_bills_in_window": "field-absent",
        "closed_pnl_rows_in_window": "field-absent",
        "income_rows_in_window": 5,
        "funding_rows_in_window": 1,
        "flow_rows_in_window": 0,
        "unified_edge_rows_in_window": "field-absent",
        "non_stable_rows": 1,
    }
    assert summary["binance_state"] == "measured"
    assert summary["binance_max_abs_pnl_ratio"] == 0.0022
    # The one income call asks for the window's own bounds and the venue's maximum page.
    assert venue.income_calls == [{"startTime": _B_MS, "endTime": _R_MS, "limit": 1000}]
    assert services.decrypt_calls == [_KEY_BINANCE]
    assert services.closed == [venue]
    assert services.supabase.writes == []


async def test_binance_rows_outside_the_window_add_nothing_even_when_the_venue_serves_them(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _binance_world(honour_window=False)
    venue._income.append(_income("REALIZED_PNL", "77", _B_MS - 1000))
    _code, lines, _services = await _run_binance_key(monkeypatch, capsys, venue)
    assert lines[0]["income_rows_in_window"] == 5
    assert lines[0]["pnl_trading_ratio"] == 0.0024


async def test_binance_rows_exactly_on_the_window_edges_are_inside(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _BinanceVenue(
        [_income("REALIZED_PNL", "10", _B_MS), _income("REALIZED_PNL", "15", _R_MS)],
        honour_window=False,
    )
    _code, lines, _services = await _run_binance_key(monkeypatch, capsys, venue)
    assert lines[0]["income_rows_in_window"] == 2
    assert lines[0]["pnl_trading_ratio"] == 0.005  # 25 / 5000


async def test_binance_a_reply_of_the_one_thousand_row_maximum_is_page_ceiling_never_a_partial_sum(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    rows = [_income("REALIZED_PNL", "1", _B_MS + i) for i in range(1000)]
    code, lines, _services = await _run_binance_key(monkeypatch, capsys, _BinanceVenue(rows))
    _assert_unmeasured(lines[0], "page_ceiling")
    assert code == wp.EXIT_FAILED


async def test_binance_a_reply_one_row_under_the_maximum_is_read(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    rows = [_income("REALIZED_PNL", "1", _B_MS + i) for i in range(999)]
    _code, lines, _services = await _run_binance_key(monkeypatch, capsys, _BinanceVenue(rows))
    assert lines[0]["measured"] is True
    assert lines[0]["income_rows_in_window"] == 999
    assert lines[0]["pnl_trading_ratio"] == 0.2  # 999 / 5000


@pytest.mark.parametrize("reply", [{"code": -2015, "msg": "x"}, "not-a-list", ["not-a-row"]])
async def test_binance_a_reply_that_is_not_a_list_of_rows_is_malformed(
    reply: Any, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    code, lines, _services = await _run_binance_key(
        monkeypatch, capsys, _BinanceVenue(reply=reply)
    )
    _assert_unmeasured(lines[0], "malformed")
    assert code == wp.EXIT_FAILED


@pytest.mark.parametrize(
    "row",
    [
        _income("REALIZED_PNL", "abc", _B_MS + _HOUR_MS),
        _income("COMMISSION", "nan", _B_MS + _HOUR_MS),
        _income("FUNDING_FEE", "inf", _B_MS + _HOUR_MS),
        _income("REALIZED_PNL", "1", "not-a-time"),
        _income("TRANSFER", "1", None),
        _income("REALIZED_PNL", "1", True),
    ],
)
async def test_binance_a_row_that_cannot_be_read_makes_the_key_malformed(
    row: dict[str, Any], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _BinanceVenue([row], honour_window=False)
    _code, lines, _services = await _run_binance_key(monkeypatch, capsys, venue)
    _assert_unmeasured(lines[0], "malformed")


async def test_binance_an_unreadable_income_on_a_type_the_probe_does_not_sum_is_only_counted(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _BinanceVenue(
        [_income("TRANSFER", "abc", _B_MS + _HOUR_MS), _income("REALIZED_PNL", "5", _B_MS + _HOUR_MS)]
    )
    _code, lines, _services = await _run_binance_key(monkeypatch, capsys, venue)
    assert lines[0]["measured"] is True
    assert lines[0]["income_rows_in_window"] == 2
    assert lines[0]["pnl_trading_ratio"] == 0.001


async def test_binance_a_non_stable_funding_row_is_counted_excluded_and_marks_the_key_partial(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _BinanceVenue(
        [
            _income("FUNDING_FEE", "-2.5", _B_MS + _HOUR_MS),
            _income("FUNDING_FEE", "-9", _B_MS + 2 * _HOUR_MS, asset="BNB"),
            _income("FUNDING_FEE", "-9", _B_MS + 3 * _HOUR_MS, asset=None),
        ]
    )
    _code, lines, _services = await _run_binance_key(monkeypatch, capsys, venue)
    record = lines[0]
    assert record["partial"] is True
    assert record["funding_rows_in_window"] == 3
    assert record["non_stable_rows"] == 2
    assert record["pnl_funding_ratio"] == -0.0005  # -2.5 / 5000


async def test_binance_the_chains_flows_are_added_to_the_offset(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _BinanceVenue(
        [_income("REALIZED_PNL", "10", _B_MS + _HOUR_MS)],
        deposits=[_transfer("fake-dep-1", "deposit", _B_MS + 2 * _HOUR_MS, amount=100.0, fee=0.0)],
    )
    _code, lines, _services = await _run_binance_key(monkeypatch, capsys, venue)
    record = lines[0]
    assert record["flow_rows_in_window"] == 1
    assert record["flow_ratio"] == 0.02  # 100 / 5000
    assert record["pnl_ratio"] == 0.002
    assert record["offset_ratio"] == 0.022


async def test_binance_a_failed_income_read_is_read_failed_with_its_class_only(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _BinanceVenue(effect=ccxt.PermissionDenied(_PLANTED_MESSAGE))
    code, lines, services = await _run_binance_key(monkeypatch, capsys, venue)
    _assert_unmeasured(lines[0], "read_failed", "PermissionDenied")
    assert _PLANTED_MESSAGE not in json.dumps(lines)
    assert services.closed == [venue]
    assert code == wp.EXIT_FAILED


async def test_binance_a_nav_not_above_zero_is_nav_nonpositive_and_reads_nothing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    venue = _binance_world()
    _code, lines, _services = await _run_binance_key(
        monkeypatch, capsys, venue, mark=_binance_mark(nav=0.0)
    )
    _assert_unmeasured(lines[0], "nav_nonpositive")
    assert venue.income_calls == []


async def test_binance_a_window_older_than_the_retention_is_refused_before_any_decrypt(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    mark = _mark_row(
        _KEY_BINANCE,
        marked_at=datetime(2026, 8, 2, 6, 0, tzinfo=timezone.utc),  # B is 91 days before the run
        nav=_BINANCE_NAV,
        venue="binance",
    )
    venue = _binance_world()
    _code, lines, services = await _run_binance_key(monkeypatch, capsys, venue, mark=mark)
    _assert_unmeasured(lines[0], "window_outside_retention")
    _assert_no_decrypt_no_client(services)


def test_binance_income_terms_split_the_types_the_way_the_chain_does() -> None:
    rows = [
        _income("REALIZED_PNL", "12.5", _B_MS),
        _income("COMMISSION", "-0.5", _B_MS),
        _income("FUNDING_FEE", "-1.0", _B_MS),
        _income("INSURANCE_CLEAR", "3", _B_MS),
    ]
    terms = wp.binance_income_terms(rows, _B_MS, _R_MS)
    assert terms.trading_usd == pytest.approx(12.0, abs=1e-9)
    assert terms.funding_usd == pytest.approx(-1.0, abs=1e-9)
    assert terms.income_rows_in_window == 4
    assert terms.funding_rows_in_window == 1
    assert terms.non_stable_rows == 0


# ---------------------------------------------------------------------------
# Plan 03: sFOX has no realized-P&L chain, so a marked sFOX key refuses by name (the retargeted
# test above), and the summary reads each venue.
# ---------------------------------------------------------------------------


async def test_summary_a_mixed_world_states_each_venue_and_fails_on_the_unmeasurable_sfox_key(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _install_bybit_flows(monkeypatch)
    keys = [
        _key_row(_KEY_OKX, "okx", "2026-01-01"),
        _key_row(_KEY_OTHER, "okx", "2026-01-02"),
        _key_row(_KEY_BYBIT, "bybit", "2026-01-03"),
        _key_row("fake-key-id-sfox", "sfox", "2026-01-04"),
    ]
    marks = [
        _mark_row(_KEY_OKX),
        _mark_row(_KEY_OTHER),
        _bybit_mark(),
        _mark_row("fake-key-id-sfox", venue="sfox"),
    ]
    clients = [_healthy_okx("15"), _healthy_okx("30"), _bybit_world()]
    code, lines, services = await _run_world(monkeypatch, capsys, keys, marks, clients)

    assert code == wp.EXIT_FAILED
    *key_records, summary = lines
    assert [r["venue"] for r in key_records] == ["okx", "okx", "bybit", "sfox"]
    _assert_unmeasured(key_records[3], "reader_not_built")
    assert services.decrypt_calls == [_KEY_OKX, _KEY_OTHER, _KEY_BYBIT]
    assert summary["keys"] == 4
    assert summary["keys_marked"] == 4
    assert summary["keys_measured"] == 3
    assert summary["keys_unmeasurable"] == 1
    assert summary["okx_keys"] == 2 and summary["okx_keys_measured"] == 2
    assert summary["okx_state"] == "measured"
    # 15 / 20000 = 0.00075 and 30 / 20000 = 0.0015: the larger is printed.
    assert summary["okx_max_abs_pnl_ratio"] == 0.0015
    assert summary["okx_max_abs_offset_ratio"] == 0.0015
    assert summary["bybit_state"] == "measured"
    assert summary["bybit_max_abs_pnl_ratio"] == 0.00051
    assert summary["binance_state"] == "no_keys"
    assert summary["binance_max_abs_pnl_ratio"] == "field-absent"
    assert summary["sfox_keys"] == 1 and summary["sfox_keys_marked"] == 1
    assert summary["sfox_keys_measured"] == 0
    assert summary["sfox_state"] == "unmeasured"


async def test_summary_a_venue_whose_only_key_has_no_mark_is_no_marked_keys_and_is_not_a_failure(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    keys = [_key_row(_KEY_OKX, "okx", "2026-01-01"), _key_row(_KEY_BYBIT, "bybit", "2026-01-02")]
    marks = [_mark_row(_KEY_OKX)]  # the Bybit key has no mark
    code, lines, services = await _run_world(monkeypatch, capsys, keys, marks, [_healthy_okx()])
    *key_records, summary = lines
    _assert_unmeasured(key_records[1], "no_mark")
    assert summary["bybit_keys"] == 1
    assert summary["bybit_keys_marked"] == 0
    assert summary["bybit_state"] == "no_marked_keys"
    assert summary["okx_state"] == "measured"
    assert summary["keys_marked"] == 1 and summary["keys_unmeasurable"] == 0
    assert services.decrypt_calls == [_KEY_OKX]
    assert code == wp.EXIT_OK


async def test_summary_a_partly_measured_venue_is_named_partly_measured(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    keys = [_key_row(_KEY_OKX, "okx", "2026-01-01"), _key_row(_KEY_OTHER, "okx", "2026-01-02")]
    marks = [_mark_row(_KEY_OKX), _mark_row(_KEY_OTHER)]
    broken = _OkxVenue()  # an empty archive proves nothing: reach_unproven
    code, lines, _services = await _run_world(
        monkeypatch, capsys, keys, marks, [_healthy_okx(), broken]
    )
    summary = lines[-1]
    assert summary["okx_keys_measured"] == 1
    assert summary["okx_state"] == "partly_measured"
    assert code == wp.EXIT_FAILED


# ---------------------------------------------------------------------------
# Plan 03: the deploy fingerprint plan 184-04 compares against the worker's own print.
# ---------------------------------------------------------------------------


def test_deploy_fingerprint_names_the_shipped_shape() -> None:
    # exit codes, KEY_RECORD_KEYS, SUMMARY_RECORD_KEYS and UNMEASURABLE_REASONS sizes, then the
    # sorted venues that have a reader. sFOX has none.
    assert wp.deploy_fingerprint() == "walletoffset 0 1 27 30 14 binance,bybit,okx"


def test_deploy_fingerprint_follows_the_live_constants_it_names(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    base = wp.deploy_fingerprint()
    monkeypatch.setitem(wp._VENUE_READERS, "sfox", wp._measure_okx)
    assert wp.deploy_fingerprint() == "walletoffset 0 1 27 30 14 binance,bybit,okx,sfox"
    monkeypatch.delitem(wp._VENUE_READERS, "sfox")
    monkeypatch.setattr(wp, "UNMEASURABLE_REASONS", (*wp.UNMEASURABLE_REASONS, "a-new-reason"))
    assert wp.deploy_fingerprint() == "walletoffset 0 1 27 30 15 binance,bybit,okx"
    monkeypatch.undo()
    assert wp.deploy_fingerprint() == base
