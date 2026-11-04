"""Phase 186 DERIVEGAPS plan 02 - tests for ``scripts/derivegaps_probe.py``.

The probe is the SC-1 instrument for Gap 1: for every eligible OKX, Bybit and Binance key it
runs the derive's OWN realized read (``fetch_all_trades(view, since_ms=None)``), drains the same
data-quality buffer the derive drains, and records whether the read was complete, truncated,
failed or timed out, how many pages each endpoint took, how long a page takes, and (for a
truncated key) how many pages the full history needs. D-06 sizes the new caps from those
numbers, so a probe that reads differently from the derive, or prints a figure that is not the
measurement, sizes the caps wrongly. Nothing here touches a venue or a database: the venue is a
fake that answers in the venue's own reply shapes.

Why each group matters (Rule 9):
  * realized state: the verdict is the derive's. A fake that serves full pages until the loop's
    cap must read ``truncated`` through the REAL fetcher, so a probe that re-implemented the
    walk (and so drifted from the derive) would fail here.
  * redaction: the output is pasted into a tracked file in a public repo. A venue message must
    reach no output, and the emitter must refuse any key or value outside the vocabulary.
  * read-only: the probe runs against PROD keys. The view, the database handle and the source
    pin each have to be able to fail, or they prove nothing.
  * fingerprint: plan 186-04 compares the deployed line with the reviewed one; a line that does
    not move when the record changes would pass a stale deploy.
"""
from __future__ import annotations

import asyncio
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import ccxt
import pytest

import scripts.derivegaps_probe as dp
from services.exchange import BYBIT_PNL_PAGE_CAP, get_and_clear_last_dq_flags
from services.okx_bills_chain import CallCeilingReached

_PROBE_SRC = Path(dp.__file__).read_text(encoding="utf-8")

_RUN_DAY = date(2026, 11, 3)
_RUN_AT = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
_HOUR_MS = 3_600_000
_NEWEST_MS = int(datetime(2026, 10, 31, 23, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)

# Distinctive synthetic values, so a substring search for one in the output cannot be confused
# with a count's digits.
_USER_ONE = "fake-user-id-one"
_KEY_ONE = "fake-key-id-one"
_CIPHER = "planted-cipher-text-zzz"
_VENUE_MESSAGE = "venue-said-boom-secret-123"

_INST_BASE = {"SWAP": 1_000_000, "FUTURES": 2_000_000, "SPOT": 3_000_000, "MARGIN": 4_000_000}


@pytest.fixture(autouse=True)
def _clean_dq_buffer() -> None:
    """The DQ buffer is per asyncio task; start every test with it empty."""
    get_and_clear_last_dq_flags()


# ---------------------------------------------------------------------------
# Fakes: OKX and Bybit and Binance clients in the venues' own reply shapes.
# ---------------------------------------------------------------------------


def _okx_rows(inst_type: str, count: int) -> list[dict[str, str]]:
    """``count`` bills, newest first, one hour apart, with ids that fall as the list goes on."""
    base = _INST_BASE[inst_type]
    return [
        {
            "billId": str(base + count - k),
            "ts": str(_NEWEST_MS - k * _HOUR_MS),
            "ccy": "USDT",
            "type": "2",
            "instType": inst_type,
            "pnl": "1.5",
            "fee": "-0.5",
        }
        for k in range(count)
    ]


class _FakeOkx:
    """An OKX client: bills and bills-archive per instType (newest first, ``after`` honoured),
    and the raw account balance."""

    id = "okx"
    rateLimit = 0

    def __init__(
        self,
        bills: dict[str, int] | None = None,
        archive: dict[str, int] | None = None,
        *,
        fail_bills: BaseException | None = None,
        delay_s: float = 0.0,
    ) -> None:
        self._bills = {t: _okx_rows(t, n) for t, n in (bills or {}).items()}
        self._archive = {t: _okx_rows(t, n) for t, n in (archive or {}).items()}
        self._fail = fail_bills
        self._delay = delay_s
        self.calls: list[tuple[str, dict[str, str]]] = []
        self.bills_rows: list[dict[str, str]] = [r for rows in self._bills.values() for r in rows]

    async def _serve(
        self, name: str, table: dict[str, list[dict[str, str]]], params: dict[str, str]
    ) -> dict[str, Any]:
        self.calls.append((name, dict(params)))
        if self._delay:
            await asyncio.sleep(self._delay)
        if self._fail is not None:
            raise self._fail
        rows = table.get(params.get("instType", ""), [])  # the funding read sends no instType
        after = params.get("after")
        if after:
            rows = [r for r in rows if int(r["billId"]) < int(after)]
        return {"code": "0", "data": [dict(r) for r in rows[: int(params["limit"])]]}

    async def private_get_account_bills(self, params: dict[str, str]) -> dict[str, Any]:
        return await self._serve("bills", self._bills, params)

    async def private_get_account_bills_archive(self, params: dict[str, str]) -> dict[str, Any]:
        return await self._serve("archive", self._archive, params)

    async def private_get_account_balance(self, *_a: Any, **_k: Any) -> dict[str, Any]:
        return {"code": "0", "data": [{"totalEq": "1000.0", "upl": "0"}]}


class _FakeBinance:
    id = "binance"
    rateLimit = 0

    def __init__(self, *, income_error: BaseException | None = None) -> None:
        self._income_error = income_error
        self.calls: list[str] = []

    async def fapiPrivate_get_income(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        self.calls.append("income")
        if self._income_error is not None:
            raise self._income_error
        return [
            {
                "incomeType": "REALIZED_PNL",
                "income": "2.5",
                "symbol": "BTCUSDT",
                "time": str(_NEWEST_MS),
                "asset": "USDT",
            }
        ]

    async def fetch_my_trades(self, *_a: Any, **_k: Any) -> list[dict[str, Any]]:
        self.calls.append("trades")
        return []

    async def fetch_balance(self, *_a: Any, **_k: Any) -> dict[str, Any]:
        return {"total": {"USDT": 500.0}}


def _view(client: Any, ceiling: int = 3000) -> dp.ReadOnlyRecordingExchange:
    return dp.ReadOnlyRecordingExchange(client, ceiling)


def _distinct_days(rows: list[dict[str, str]]) -> int:
    return len(
        {datetime.fromtimestamp(int(r["ts"]) / 1000, tz=timezone.utc).date() for r in rows}
    )


# ---------------------------------------------------------------------------
# Behavior 1-3: the realized read through the real fetcher.
# ---------------------------------------------------------------------------


async def test_complete_okx_read_counts_pages_rows_and_days() -> None:
    client = _FakeOkx(bills={"SWAP": 250})
    view = _view(client)

    values = await dp.measure_realized(view, "okx", _RUN_DAY)

    assert values["realized_state"] == "complete"
    assert values["flag_truncated_okx"] is False
    assert values["flag_truncated_bybit"] is False
    assert values["flag_fetch_error"] is False
    assert values["flag_binance_income_fallback"] is False
    assert values["fetch_error_class"] == "none"
    # 100 + 100 + 50 rows: three pages, the last one short. The other three instTypes each answer
    # one empty page, so three is the maximum.
    assert values["okx_bills_pages_max"] == 3
    # The archive walk runs (since_ms is None) and every instType answers one empty page.
    assert values["okx_archive_pages_max"] == 1
    assert values["okx_inst_types_at_cap"] == 0
    expected_days = _distinct_days(client.bills_rows)
    assert values["realized_rows"] == expected_days
    assert values["realized_days"] == expected_days
    assert values["realized_oldest_age"] == "0-29"  # the oldest bill is 250 h before 2026-10-31
    # The Bybit-only readings are not measured on an OKX key: absent, never 0.
    assert values["bybit_windows"] == dp.FIELD_ABSENT
    assert values["bybit_pages_max_in_window"] == dp.FIELD_ABSENT
    assert values["bybit_windows_at_cap"] == dp.FIELD_ABSENT


async def test_full_pages_to_the_loop_cap_read_truncated_through_the_real_fetcher() -> None:
    # 10,050 bills on one instType: the 100th page (rows 9,901-10,000 from the top) is full, so
    # the derive's own loop hits its cap and stamps the flag. The probe must report the DERIVE's
    # verdict, which only the real fetcher can give.
    client = _FakeOkx(bills={"SWAP": 10_050})
    view = _view(client)

    values = await dp.measure_realized(view, "okx", _RUN_DAY)

    assert values["realized_state"] == "truncated"
    assert values["flag_truncated_okx"] is True
    assert values["flag_fetch_error"] is False
    assert values["okx_bills_pages_max"] == 100
    assert values["okx_inst_types_at_cap"] == 1
    assert values["realized_oldest_age"] == "365-546"


async def test_network_error_reads_fetch_error_with_a_closed_class_and_no_message() -> None:
    client = _FakeOkx(fail_bills=ccxt.NetworkError(_VENUE_MESSAGE))
    view = _view(client)

    values = await dp.measure_realized(view, "okx", _RUN_DAY)

    assert values["realized_state"] == "fetch_error"
    assert values["flag_fetch_error"] is True
    assert values["fetch_error_class"] == "NetworkError"
    assert values["fetch_error_class"] in dp.FAILURE_CLASSES
    assert _VENUE_MESSAGE not in json.dumps(values)
    # A failed read returns no usable series: the row and day counts are not measured.
    assert values["realized_rows"] == dp.FIELD_ABSENT
    assert values["realized_days"] == dp.FIELD_ABSENT


class _FakeOkxArchiveDies(_FakeOkx):
    """Bills answer in full; the archive endpoint then fails or hangs."""

    def __init__(self, bills: dict[str, int], *, hang: bool = False) -> None:
        super().__init__(bills=bills)
        self._hang = hang

    async def private_get_account_bills_archive(self, params: dict[str, str]) -> dict[str, Any]:
        if self._hang:
            await asyncio.sleep(5.0)
        raise ccxt.NetworkError(_VENUE_MESSAGE)


@pytest.mark.parametrize("hang", [False, True], ids=["fetch_error", "timeout"])
async def test_the_at_cap_count_of_a_failed_or_timed_out_read_is_field_absent(
    monkeypatch: pytest.MonkeyPatch, hang: bool
) -> None:
    # 150 bills pages walk past today's 100-page cap before the archive endpoint dies. The cap WAS
    # hit, but the read stopped part-way, so the count of capped walks is a partial figure; printing
    # 0 or 1 from it would read as "not capped" / "capped once" for a walk set that is incomplete.
    monkeypatch.setattr(dp, "KEY_READ_TIMEOUT_S", 0.3)
    client = _FakeOkxArchiveDies({"SWAP": 15_000}, hang=hang)

    values = await dp.measure_realized(_view(client), "okx", _RUN_DAY)

    assert values["realized_state"] == ("timeout" if hang else "fetch_error")
    assert values["okx_inst_types_at_cap"] == dp.FIELD_ABSENT
    assert values["bybit_windows_at_cap"] == dp.FIELD_ABSENT


async def test_a_read_that_outlasts_the_bound_reads_timeout_and_leaves_the_buffer_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dp, "KEY_READ_TIMEOUT_S", 0.05)
    client = _FakeOkx(bills={"SWAP": 10}, delay_s=5.0)
    view = _view(client)

    values = await dp.measure_realized(view, "okx", _RUN_DAY)

    assert values["realized_state"] == "timeout"
    assert values["flag_truncated_okx"] == dp.FIELD_ABSENT  # the buffer was never drained
    assert values["flag_fetch_error"] == dp.FIELD_ABSENT
    assert get_and_clear_last_dq_flags() == {}  # and the probe leaves nothing behind


async def test_binance_income_failure_stamps_the_fallback_flag_and_reads_complete() -> None:
    client = _FakeBinance(income_error=ccxt.ExchangeError(_VENUE_MESSAGE))
    view = _view(client)

    values = await dp.measure_realized(view, "binance", _RUN_DAY)

    assert values["flag_binance_income_fallback"] is True
    assert values["realized_state"] == "complete"  # the derive's rule: only error/truncated bite
    assert client.calls == ["income", "trades"]
    assert values["okx_bills_pages_max"] == dp.FIELD_ABSENT
    assert values["bybit_windows"] == dp.FIELD_ABSENT


async def test_the_call_ceiling_is_a_refusal_not_a_fetch_error() -> None:
    client = _FakeOkx(bills={"SWAP": 10_050})
    view = _view(client, ceiling=5)

    with pytest.raises(CallCeilingReached):
        await dp.measure_realized(view, "okx", _RUN_DAY)

    assert view.ceiling_reached is True
    assert len(client.calls) == 5  # the venue never saw the call past the budget


# ---------------------------------------------------------------------------
# Behavior 4: the emitter refuses anything outside the vocabulary.
# ---------------------------------------------------------------------------


def test_a_default_key_record_is_valid_and_prints_one_compact_line() -> None:
    record = dp._key_record("k1", "okx", "2026-11-03")

    line = dp.emit_record(record)

    assert json.loads(line) == record
    assert "\n" not in line
    assert record["measured"] is False
    assert record["realized_state"] == dp.FIELD_ABSENT  # not measured is a word, never 0


def test_emit_record_refuses_an_undeclared_key_by_path_and_not_by_value() -> None:
    record = dp._key_record("k1", "okx", "2026-11-03")
    record["extra_venue_text"] = _VENUE_MESSAGE

    with pytest.raises(ValueError) as caught:
        dp.emit_record(record)

    assert "extra_venue_text" in str(caught.value)
    assert _VENUE_MESSAGE not in str(caught.value)


def test_emit_record_refuses_an_int_where_a_bool_is_declared() -> None:
    record = dp._key_record("k1", "okx", "2026-11-03")
    record["flag_fetch_error"] = 1  # an int is not a bool; 1 would read as a measured "true"

    with pytest.raises(ValueError, match="flag_fetch_error"):
        dp.emit_record(record)


def test_emit_record_refuses_a_raw_string_where_a_closed_token_is_declared() -> None:
    record = dp._key_record("k1", "okx", "2026-11-03")
    record["fetch_error_class"] = _VENUE_MESSAGE

    with pytest.raises(ValueError) as caught:
        dp.emit_record(record)

    assert "fetch_error_class" in str(caught.value)
    assert _VENUE_MESSAGE not in str(caught.value)


def test_emit_record_refuses_a_count_that_is_a_float_or_negative() -> None:
    for bad in (1.5, -1, True):
        record = dp._key_record("k1", "okx", "2026-11-03")
        record["okx_bills_pages_max"] = bad
        with pytest.raises(ValueError, match="okx_bills_pages_max"):
            dp.emit_record(record)


def test_emit_record_refuses_an_unrounded_seconds_figure() -> None:
    record = dp._key_record("k1", "okx", "2026-11-03")
    record["realized_elapsed_s"] = 12.3456789  # three significant figures only

    with pytest.raises(ValueError, match="realized_elapsed_s"):
        dp.emit_record(record)


def test_the_summary_record_validates_and_refuses_an_extra_key() -> None:
    summary = dp.summarize([], "2026-11-03")

    assert json.loads(dp.emit_record(summary))["record"] == "summary"
    assert summary["keys"] == 0
    summary["leak"] = "x"
    with pytest.raises(ValueError, match="leak"):
        dp.emit_record(summary)


# ---------------------------------------------------------------------------
# Behavior 5-6: read-only by construction.
# ---------------------------------------------------------------------------


class _Inner:
    id = "okx"
    rateLimit = 0

    def __init__(self) -> None:
        self.hits: list[str] = []

    async def private_get_account_bills(self, params: dict[str, str]) -> dict[str, Any]:
        self.hits.append("get")
        return {"data": []}

    async def private_post_account_bills(self, params: dict[str, str]) -> dict[str, Any]:
        self.hits.append("post")
        return {}

    async def create_order(self, *_a: Any) -> dict[str, Any]:
        self.hits.append("order")
        return {}

    async def withdraw(self, *_a: Any) -> dict[str, Any]:
        self.hits.append("withdraw")
        return {}

    async def transfer(self, *_a: Any) -> dict[str, Any]:
        self.hits.append("transfer")
        return {}

    async def fapiPrivate_get_income(self, *_a: Any) -> list[Any]:
        return []

    async def public_get_public_time(self, *_a: Any) -> dict[str, Any]:
        return {}

    async def fetch_balance(self, *_a: Any) -> dict[str, Any]:
        return {"total": {}}


@pytest.mark.parametrize(
    "name", ["private_post_account_bills", "create_order", "withdraw", "transfer", "cancel_order"]
)
def test_the_view_resolves_no_write_method(name: str) -> None:
    inner = _Inner()
    view = _view(inner)

    with pytest.raises(AttributeError):
        getattr(view, name)

    assert inner.hits == []


async def test_the_view_forwards_plain_attributes_and_counts_each_get_call() -> None:
    inner = _Inner()
    view = _view(inner)

    assert view.id == "okx"
    assert view.rateLimit == 0
    await view.private_get_account_bills({"instType": "SWAP"})
    await view.fapiPrivate_get_income({})
    await view.public_get_public_time()
    await view.fetch_balance()

    assert view.calls == 4
    assert view.replies["private_get_account_bills"] == [{"data": []}]
    assert view.requests["private_get_account_bills"] == [{"instType": "SWAP"}]
    assert inner.hits == ["get"]


async def test_the_view_refuses_the_call_that_would_exceed_its_ceiling() -> None:
    inner = _Inner()
    view = _view(inner, ceiling=2)

    await view.private_get_account_bills({})
    await view.private_get_account_bills({})
    with pytest.raises(CallCeilingReached):
        await view.private_get_account_bills({})

    assert inner.hits == ["get", "get"]  # the venue never saw the third
    assert view.calls == 2
    assert view.ceiling_reached is True


_WRITE_NAMES = (
    r"private_post_|create_order|cancel_order|withdraw\(|transfer\(|\.insert\(|\.upsert\(|"
    r"\.delete\(|\.rpc\(|enqueue"
)


def test_the_probe_source_names_no_write_method() -> None:
    assert re.search(_WRITE_NAMES, _PROBE_SRC) is None


def test_the_write_name_pin_can_fail() -> None:
    # The pin is only worth something if it fires on a string that does contain a write name.
    assert re.search(_WRITE_NAMES, "await exchange.private_post_trade_order(params)") is not None
    assert re.search(_WRITE_NAMES, "client.table('x').insert(row)") is not None


# ---------------------------------------------------------------------------
# Behavior 7: the fingerprint.
# ---------------------------------------------------------------------------


def test_the_fingerprint_is_one_line_that_starts_with_derivegaps() -> None:
    line = dp.deploy_fingerprint()

    assert line.startswith("derivegaps ")
    assert "\n" not in line


def test_the_fingerprint_moves_when_a_record_key_is_added(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before = dp.deploy_fingerprint()

    monkeypatch.setattr(dp, "KEY_RECORD_KEYS", (*dp.KEY_RECORD_KEYS, "a_new_key"))

    assert dp.deploy_fingerprint() != before


# ---------------------------------------------------------------------------
# The tracer: run() end to end on one key, with a database and a venue that are fakes.
# ---------------------------------------------------------------------------


class _FakeQuery:
    def __init__(self, data: list[dict[str, Any]], owner: "_FakeSupabase") -> None:
        self._data = data
        self._owner = owner
        self._filters: list[Any] = []

    def select(self, columns: str = "*", **_k: Any) -> "_FakeQuery":
        return self

    def in_(self, column: str, values: list[Any]) -> "_FakeQuery":
        self._filters.append(lambda r: r.get(column) in values)
        return self

    def order(self, column: str, desc: bool = False, **_k: Any) -> "_FakeQuery":
        self._data = sorted(self._data, key=lambda r: str(r.get(column)), reverse=desc)
        return self

    def execute(self) -> Any:
        return SimpleNamespace(
            data=[dict(r) for r in self._data if all(f(r) for f in self._filters)]
        )

    def insert(self, *_a: Any, **_k: Any) -> "_FakeQuery":
        self._owner.writes.append("insert")
        return self

    def update(self, *_a: Any, **_k: Any) -> "_FakeQuery":
        self._owner.writes.append("update")
        return self

    def upsert(self, *_a: Any, **_k: Any) -> "_FakeQuery":
        self._owner.writes.append("upsert")
        return self

    def delete(self, *_a: Any, **_k: Any) -> "_FakeQuery":
        self._owner.writes.append("delete")
        return self


class _FakeSupabase:
    def __init__(self, key_rows: list[dict[str, Any]]) -> None:
        self._key_rows = key_rows
        self.tables_touched: list[str] = []
        self.writes: list[str] = []

    def table(self, name: str) -> _FakeQuery:
        self.tables_touched.append(name)
        return _FakeQuery(self._key_rows, self)

    def rpc(self, name: str, *_a: Any, **_k: Any) -> _FakeQuery:
        self.writes.append(f"rpc:{name}")
        return _FakeQuery([], self)


def _key_row(
    key_id: str = _KEY_ONE, exchange: str = "okx", created: str = "2026-01-01T00:00:00+00:00", **o: Any
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
    }
    row.update(o)
    return row


class _Harness:
    """Everything run() reaches for, patched in one place and recorded."""

    def __init__(self, key_rows: list[dict[str, Any]], clients: list[Any]) -> None:
        self.supabase = _FakeSupabase(key_rows)
        self.clients = list(clients)
        self.decrypted: list[Any] = []
        self.built_for: list[str] = []
        self.closed: list[Any] = []

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def _db_execute(fn: Any) -> Any:
            return fn()

        def _decrypt(row: dict[str, Any], _kek: bytes) -> tuple[str, str, None]:
            self.decrypted.append(row.get("id"))
            return ("fake-k", "fake-s", None)

        def _make_client(exchange_name: str, *_a: Any) -> Any:
            self.built_for.append(exchange_name)
            return self.clients[len(self.built_for) - 1]

        async def _aclose(exchange: Any) -> None:
            self.closed.append(exchange)

        monkeypatch.setattr(dp, "_utc_now", lambda: _RUN_AT)
        monkeypatch.setattr("services.db.get_supabase", lambda: self.supabase)
        monkeypatch.setattr("services.db.db_execute", _db_execute)
        monkeypatch.setattr("services.encryption.get_kek", lambda: b"fake-kek")
        monkeypatch.setattr("services.encryption.decrypt_credentials", _decrypt)
        monkeypatch.setattr("services.job_worker._make_exchange_client", _make_client)
        monkeypatch.setattr("services.exchange.aclose_exchange", _aclose)


def _lines(capsys: pytest.CaptureFixture[str]) -> tuple[list[dict[str, Any]], str]:
    captured = capsys.readouterr()
    return [json.loads(line) for line in captured.out.splitlines() if line.strip()], captured.err


async def test_tracer_one_okx_key_end_to_end(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    client = _FakeOkx(bills={"SWAP": 250})
    harness = _Harness([_key_row()], [client])
    harness.install(monkeypatch)

    exit_code = await dp.run()

    records, err = _lines(capsys)
    assert exit_code == dp.EXIT_OK
    assert [r["record"] for r in records] == ["key", "summary"]
    key, summary = records
    assert key["key"] == "k1"
    assert key["venue"] == "okx"
    assert key["measured"] is True
    assert key["unmeasurable_reason"] == "none"
    assert key["realized_state"] == "complete"
    assert key["okx_bills_pages_max"] == 3
    assert isinstance(key["realized_elapsed_s"], float)
    assert isinstance(key["equity_elapsed_s"], float)
    assert summary["keys"] == 1
    assert summary["keys_measured"] == 1
    assert summary["keys_unmeasurable"] == 0
    assert summary["okx_keys"] == 1
    assert summary["okx_realized_complete"] == 1
    assert summary["okx_realized_truncated"] == 0
    # The credentials were decrypted once, the client closed, and nothing was written.
    assert harness.decrypted == [_KEY_ONE]
    assert harness.closed == [client]
    assert harness.supabase.writes == []
    assert harness.supabase.tables_touched == ["api_keys"]
    # Redaction: no id, cipher text or venue text reaches stdout or stderr.
    blob = json.dumps(records) + err
    for needle in (_KEY_ONE, _USER_ONE, _CIPHER, "fake-k", "fake-s"):
        assert needle not in blob


async def test_a_key_the_backfill_does_not_derive_is_recorded_and_never_decrypted(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    harness = _Harness([_key_row(sync_status="revoked")], [])
    harness.install(monkeypatch)

    exit_code = await dp.run()

    records, _err = _lines(capsys)
    key, summary = records
    assert key["measured"] is False
    assert key["unmeasurable_reason"] == "key_not_eligible"
    assert key["realized_state"] == dp.FIELD_ABSENT
    assert harness.decrypted == []
    assert harness.built_for == []
    # A key nobody derives is not a key the probe failed to measure.
    assert exit_code == dp.EXIT_OK
    assert summary["keys_not_eligible"] == 1
    assert summary["keys_unmeasurable"] == 0


async def test_a_key_that_hits_the_call_ceiling_is_unmeasurable_and_fails_the_run(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(dp, "KEY_CALL_CEILING", 3)
    client = _FakeOkx(bills={"SWAP": 10_050})
    harness = _Harness([_key_row()], [client])
    harness.install(monkeypatch)

    exit_code = await dp.run()

    records, _err = _lines(capsys)
    key, summary = records
    assert exit_code == dp.EXIT_FAILED
    assert key["measured"] is False
    assert key["unmeasurable_reason"] == "call_ceiling"
    assert key["realized_state"] == dp.FIELD_ABSENT
    assert summary["keys_unmeasurable"] == 1
    assert harness.closed == [client]  # the client is closed on the failure path too


async def test_a_venue_error_outside_the_fetcher_prints_its_class_only(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    harness = _Harness([_key_row()], [object()])
    harness.install(monkeypatch)

    def _boom(*_a: Any) -> Any:
        raise ccxt.AuthenticationError(_VENUE_MESSAGE)

    monkeypatch.setattr("services.encryption.decrypt_credentials", _boom)

    exit_code = await dp.run()

    records, err = _lines(capsys)
    key = records[0]
    assert exit_code == dp.EXIT_FAILED
    assert key["unmeasurable_reason"] == "failure"
    assert key["failure_class"] == "AuthenticationError"
    assert _VENUE_MESSAGE not in json.dumps(records) + err


@pytest.fixture
def _logging_restored() -> Any:
    """main() switches logging off for the whole process; give it back."""
    import logging

    yield
    logging.disable(logging.NOTSET)


def test_main_prints_the_exception_type_only_on_a_run_level_failure(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    _logging_restored: Any,
) -> None:
    async def _boom() -> int:
        raise RuntimeError(_VENUE_MESSAGE)

    monkeypatch.setattr(dp, "run", _boom)

    assert dp.main([]) == dp.EXIT_FAILED

    captured = capsys.readouterr()
    assert captured.err.strip() == "failed: RuntimeError"
    assert _VENUE_MESSAGE not in captured.out + captured.err


def test_summarize_counts_each_realized_state_per_venue() -> None:
    def _rec(venue: str, state: str, spp: float | str = 0.5, secs: float | str = 10.0) -> dict[str, Any]:
        return dp._key_record(
            "k1",
            venue,
            "2026-11-03",
            measured=True,
            realized_state=state,
            realized_s_per_page=spp,
            realized_elapsed_s=secs,
        )

    records = [
        _rec("okx", "complete", 0.25, 5.0),
        _rec("okx", "truncated", 0.5, 120.0),
        _rec("okx", "fetch_error"),
        _rec("bybit", "timeout", dp.FIELD_ABSENT, 1200.0),
        dp._key_record("k5", "binance", "2026-11-03", unmeasurable_reason="timeout"),
    ]

    summary = dp.summarize(records, "2026-11-03")

    assert summary["keys"] == 5
    assert summary["keys_measured"] == 4
    assert summary["keys_unmeasurable"] == 1
    assert summary["okx_keys"] == 3
    assert (
        summary["okx_realized_complete"],
        summary["okx_realized_truncated"],
        summary["okx_realized_fetch_error"],
        summary["okx_realized_timeout"],
    ) == (1, 1, 1, 0)
    assert summary["bybit_realized_timeout"] == 1
    assert summary["okx_max_s_per_page"] == 0.5
    assert summary["okx_max_realized_s"] == 120.0
    assert summary["bybit_max_s_per_page"] == dp.FIELD_ABSENT
    assert summary["binance_keys"] == 1
    assert summary["binance_max_realized_s"] == dp.FIELD_ABSENT
    dp.emit_record(summary)  # the summary this builds is inside its own vocabulary


# ---------------------------------------------------------------------------
# Task 2: the continuation past today's caps (D-06 sizing) and the Bybit limit probe.
# ---------------------------------------------------------------------------


class _FakeBybit:
    """A Bybit client whose FIRST window holds ``hot_pages`` pages and every other window is
    empty. Pages walk by ``nextPageCursor`` (the next page's index; empty on the last)."""

    id = "bybit"
    rateLimit = 0

    def __init__(self, hot_pages: int, rows_per_page: int = 3) -> None:
        self._hot_pages = hot_pages
        self._rows_per_page = rows_per_page
        self._windows: list[str] = []
        self.requests: list[dict[str, Any]] = []

    async def private_get_v5_position_closed_pnl(self, params: dict[str, Any]) -> dict[str, Any]:
        self.requests.append(dict(params))
        start = params["startTime"]
        if start not in self._windows:
            self._windows.append(start)
        pages = self._hot_pages if self._windows.index(start) == 0 else 0
        page = int(params.get("cursor") or 0)
        if page >= pages:
            return {"result": {"list": [], "nextPageCursor": ""}}
        rows = [
            {
                "symbol": "BTCUSDT",
                "createdTime": str(int(start) + 1000 * (page * self._rows_per_page + i)),
                "cumEntryValue": "100",
                "cumExitValue": "101",
                "openFee": "0.01",
                "closeFee": "0.01",
                "side": "Sell",
            }
            for i in range(self._rows_per_page)
        ]
        nxt = str(page + 1) if page + 1 < pages else ""
        return {"result": {"list": rows, "nextPageCursor": nxt}}

    async def fetch_balance(self, *_a: Any, **_k: Any) -> dict[str, Any]:
        return {"total": {"USDT": 500.0}}


class _FakeBybitLimit:
    """A Bybit client that answers the limit probe: it clamps every reply to ``clamp`` rows, and
    can raise on one limit value."""

    id = "bybit"
    rateLimit = 0

    def __init__(
        self,
        clamp: int = 100,
        fail_on_limit: int | None = None,
        fail_with: BaseException | None = None,
    ) -> None:
        self._clamp = clamp
        self._fail_on = fail_on_limit
        self._fail_with = fail_with or ccxt.BadRequest(_VENUE_MESSAGE)
        self.requests: list[dict[str, Any]] = []

    async def private_get_v5_position_closed_pnl(self, params: dict[str, Any]) -> dict[str, Any]:
        self.requests.append(dict(params))
        if self._fail_on is not None and params["limit"] == self._fail_on:
            raise self._fail_with
        rows = [{"symbol": "BTCUSDT", "createdTime": str(i)} for i in range(min(params["limit"], self._clamp))]
        return {"result": {"list": rows, "nextPageCursor": ""}}


async def test_continuation_sizes_the_full_okx_history_past_the_cap() -> None:
    # 150 full pages and one short last page: 15,050 bills on one instType.
    client = _FakeOkx(bills={"SWAP": 15_050})
    view = _view(client)
    realized = await dp.measure_realized(view, "okx", _RUN_DAY)
    assert realized["realized_state"] == "truncated"

    values = await dp.measure_past_cap(view, "okx", view.realized_walks, _RUN_DAY)

    assert values["pages_needed_okx_bills"] == 151  # 150 full pages plus the short last one
    assert values["pages_needed_okx_archive"] == 1  # the archive walk was never at the cap
    assert values["past_cap_reached_end"] is True
    assert values["past_cap_oldest_age"] == "547-729"
    assert values["pages_needed_bybit_window"] == dp.FIELD_ABSENT
    # The continuation used the SAME endpoint and params with the `after` cursor from the last
    # recorded bill, so the venue was walked once, not restarted.
    swap_calls = [p for name, p in client.calls if name == "bills" and p["instType"] == "SWAP"]
    assert len(swap_calls) == 151
    assert swap_calls[100]["after"] == str(_INST_BASE["SWAP"] + 15_050 - 9_999)  # last bill of page 100
    assert all(p["limit"] == "100" for p in swap_calls)


async def test_continuation_stops_at_its_ceiling_and_reports_a_lower_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dp, "CONTINUATION_PAGE_CEILING", 5)
    client = _FakeOkx(bills={"SWAP": 15_050})
    view = _view(client)
    await dp.measure_realized(view, "okx", _RUN_DAY)

    values = await dp.measure_past_cap(view, "okx", view.realized_walks, _RUN_DAY)

    assert values["pages_needed_okx_bills"] == 105  # the cap plus five more: pages READ, a lower bound
    assert values["past_cap_reached_end"] is False


async def test_a_spent_call_budget_in_the_continuation_is_a_lower_bound_not_a_refusal() -> None:
    # 107 realized pages and one equity call fit under 110; the continuation then gets two pages.
    client = _FakeOkx(bills={"SWAP": 15_050})
    view = _view(client, ceiling=110)
    await dp.measure_realized(view, "okx", _RUN_DAY)

    values = await dp.measure_past_cap(view, "okx", view.realized_walks, _RUN_DAY)

    assert values["pages_needed_okx_bills"] == 102
    assert values["past_cap_reached_end"] is False
    assert view.ceiling_reached is True


async def test_a_complete_key_prints_field_absent_for_every_continuation_reading() -> None:
    client = _FakeOkx(bills={"SWAP": 250})
    view = _view(client)
    await dp.measure_realized(view, "okx", _RUN_DAY)

    direct = await dp.measure_past_cap(view, "okx", view.realized_walks, _RUN_DAY)
    through_the_key_path = await dp._measure_key(_view(_FakeOkx(bills={"SWAP": 250})), "okx", _RUN_DAY)

    for values in (direct, through_the_key_path):
        for name in (
            "pages_needed_okx_bills",
            "pages_needed_okx_archive",
            "pages_needed_bybit_window",
            "past_cap_reached_end",
            "past_cap_oldest_age",
        ):
            assert values[name] == dp.FIELD_ABSENT, name  # never 0: nothing was continued


async def test_continuation_sizes_a_bybit_window_past_its_page_cap() -> None:
    cap = BYBIT_PNL_PAGE_CAP  # the derive's own cap, read off the module (review WR-05 raised it)
    client = _FakeBybit(hot_pages=cap + 1)
    view = _view(client)
    realized = await dp.measure_realized(view, "bybit", _RUN_DAY)
    assert realized["realized_state"] == "truncated"
    assert realized["flag_truncated_bybit"] is True
    assert realized["bybit_pages_max_in_window"] == cap
    assert realized["bybit_windows_at_cap"] == 1

    values = await dp.measure_past_cap(view, "bybit", view.realized_walks, _RUN_DAY)

    assert values["pages_needed_bybit_window"] == cap + 1
    assert values["past_cap_reached_end"] is True
    assert values["past_cap_oldest_age"] in dp.AGE_BUCKETS
    assert values["pages_needed_okx_bills"] == dp.FIELD_ABSENT
    # The 51st page continued the hot window's own cursor, in the same window.
    hot = client._windows[0]
    hot_requests = [r for r in client.requests if r["startTime"] == hot]
    assert len(hot_requests) == cap + 1
    assert hot_requests[cap]["cursor"] == str(cap)
    # The continuation replays the walk's own recorded request, so it carries the page size
    # the derive sends (Phase 186 D-10: the documented maximum of 100, no longer 200).
    from services.exchange import BYBIT_CLOSED_PNL_LIMIT

    assert hot_requests[cap]["limit"] == BYBIT_CLOSED_PNL_LIMIT


async def test_a_bybit_that_clamps_every_reply_to_100_rows_reads_the_same_at_both_limits() -> None:
    client = _FakeBybitLimit(clamp=100)
    view = _view(client)

    values = await dp.measure_bybit_limit(view)

    assert values["bybit_limit200_rows"] == 100
    assert values["bybit_limit100_rows"] == 100
    assert values["bybit_limit200_error"] is False
    assert values["bybit_limit100_error"] is False
    # Same window and params as the derive's, differing only in the limit.
    first, second = client.requests
    assert (first["limit"], second["limit"]) == (200, 100)
    assert first["category"] == second["category"] == "linear"
    assert first["startTime"] == second["startTime"]
    assert first["endTime"] == second["endTime"]
    window_ms = int(first["endTime"]) - int(first["startTime"])
    assert window_ms == 7 * 24 * _HOUR_MS


async def test_a_bybit_that_refuses_limit_200_reports_the_error_and_no_row_count() -> None:
    client = _FakeBybitLimit(clamp=100, fail_on_limit=200)
    view = _view(client)

    values = await dp.measure_bybit_limit(view)

    assert values["bybit_limit200_error"] is True
    assert values["bybit_limit200_rows"] == dp.FIELD_ABSENT
    assert values["bybit_limit100_error"] is False
    assert values["bybit_limit100_rows"] == 100
    assert values["bybit_limit200_error_class"] == "BadRequest"
    assert values["bybit_limit_probe_informative"] is True  # the venue rejected 200
    assert _VENUE_MESSAGE not in json.dumps(values)


async def test_a_rate_limited_limit_200_read_is_recorded_by_class_and_is_not_informative() -> None:
    # A 429 or a network failure on the 200 read says nothing about whether the venue honours 200.
    client = _FakeBybitLimit(clamp=100, fail_on_limit=200, fail_with=ccxt.RateLimitExceeded(_VENUE_MESSAGE))

    values = await dp.measure_bybit_limit(_view(client))

    assert values["bybit_limit200_error"] is True
    assert values["bybit_limit200_error_class"] == "RateLimitExceeded"
    assert values["bybit_limit_probe_informative"] is False
    assert _VENUE_MESSAGE not in json.dumps(values)


async def test_equal_row_counts_on_a_quiet_window_are_not_informative_but_more_than_100_is() -> None:
    quiet = await dp.measure_bybit_limit(_view(_FakeBybitLimit(clamp=40)))
    assert (quiet["bybit_limit200_rows"], quiet["bybit_limit100_rows"]) == (40, 40)
    assert quiet["bybit_limit_probe_informative"] is False
    honoured = await dp.measure_bybit_limit(_view(_FakeBybitLimit(clamp=200)))
    assert (honoured["bybit_limit200_rows"], honoured["bybit_limit100_rows"]) == (200, 100)
    assert honoured["bybit_limit_probe_informative"] is True
    assert honoured["bybit_limit200_error_class"] == "none"


async def test_seconds_per_page_is_the_elapsed_time_over_the_pages_the_fake_served(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ticks = iter([0.0, 7.0, 7.0, 7.4])  # realized start and end, equity start and end
    monkeypatch.setattr(dp, "_monotonic", lambda: next(ticks))
    client = _FakeOkx(bills={"SWAP": 250})
    view = _view(client)

    values = await dp.measure_realized(view, "okx", _RUN_DAY)

    pages_served = len(client.calls)  # the fake's own count: 3 bills + 3 empty + 4 empty archive
    assert pages_served == 10
    assert values["realized_elapsed_s"] == 7.0
    assert values["realized_s_per_page"] == float(f"{7.0 / pages_served:.3g}")  # 0.7
    assert values["equity_elapsed_s"] == 0.4


def test_the_summary_sizes_the_caps_from_the_keys_that_were_continued() -> None:
    def _rec(venue: str, **v: Any) -> dict[str, Any]:
        return dp._key_record("k1", venue, "2026-11-03", measured=True, realized_state="truncated", **v)

    records = [
        _rec("okx", pages_needed_okx_bills=151, pages_needed_okx_archive=90, past_cap_reached_end=True),
        _rec("okx", pages_needed_okx_bills=500, pages_needed_okx_archive=1, past_cap_reached_end=False),
        _rec("bybit", pages_needed_bybit_window=51, past_cap_reached_end=True),
    ]

    summary = dp.summarize(records, "2026-11-03")

    assert summary["okx_max_pages_needed"] == 500
    assert summary["okx_keys_still_short_after_ceiling"] == 1
    assert summary["bybit_max_pages_needed"] == 51
    assert summary["bybit_keys_still_short_after_ceiling"] == 0
    assert summary["binance_max_pages_needed"] == dp.FIELD_ABSENT
    dp.emit_record(summary)
    for record in records:
        dp.emit_record(record)


def test_the_fingerprint_changes_with_the_record_size() -> None:
    # The record grew in this task; a line that ignored the size would pass a stale deploy.
    assert dp.deploy_fingerprint().split()[3] == str(len(dp.KEY_RECORD_KEYS))
    assert len(dp.KEY_RECORD_KEYS) == 68


# ---------------------------------------------------------------------------
# Plan 186-03 Task 1: the Bybit flow section. The venue is a REAL ccxt Bybit whose raw record
# endpoints answer in the venue's shapes, so ccxt's own parse_transactions runs on them (the
# derive's reader depends on it) and the probe's overlap count comes from the service's rule.
# ---------------------------------------------------------------------------

import ccxt.async_support as ccxt_async  # noqa: E402

from tests._trade_pages import UnifiedLogBook, unified_flow  # noqa: E402

_DAY_MS = 86_400_000
_RUN_NOW_MS = int(_RUN_AT.timestamp() * 1000)
_FLOW_T = _RUN_NOW_MS - 40 * _DAY_MS


class _FakeBybitFlows(ccxt_async.bybit):  # type: ignore[misc]
    """A real ccxt Bybit with the raw deposit / withdraw record endpoints, the Unified transaction
    log and the key-info endpoint replaced by recorders. ``deposits`` and ``withdrawals`` are
    ``(id, ms, amount, coin)``; ``unified`` is a list of ``unified_flow`` entries."""

    def __init__(
        self,
        deposits: list[tuple[str, int, float, str]] | None = None,
        withdrawals: list[tuple[str, int, float, str]] | None = None,
        unified: list[dict[str, Any]] | None = None,
        *,
        uta: Any = 1,
        master: Any = True,
        unified_error: BaseException | None = None,
        unified_malformed: bool = False,
        onchain_error: BaseException | None = None,
        balance_total: float = 10_000.0,
    ) -> None:
        super().__init__()
        self.rateLimit = 0
        self.markets = {}
        self._deposits = deposits or []
        self._withdrawals = withdrawals or []
        self._onchain_error = onchain_error
        self._balance_total = balance_total
        self.privateGetV5AssetDepositQueryRecord = self._deposit_record
        self.privateGetV5AssetWithdrawQueryRecord = self._withdraw_record
        book = UnifiedLogBook(unified or [])

        async def _log(params: dict[str, Any]) -> dict[str, Any]:
            if unified_error is not None:
                raise unified_error
            if unified_malformed:
                return {"retCode": 0, "result": "not-an-object"}
            return await book(params)

        async def _key_info(*_a: Any, **_k: Any) -> dict[str, Any]:
            return {"result": {"isMaster": master, "uta": uta}}

        async def _closed_pnl(*_a: Any, **_k: Any) -> dict[str, Any]:
            return {"result": {"list": [], "nextPageCursor": ""}}

        self.private_get_v5_account_transaction_log = _log
        self.private_get_v5_user_query_api = _key_info
        self.private_get_v5_position_closed_pnl = _closed_pnl

    async def fetch_balance(self, *_a: Any, **_k: Any) -> dict[str, Any]:
        return {"total": {"USDT": self._balance_total}}

    async def _deposit_record(self, request: dict[str, Any]) -> dict[str, Any]:
        if self._onchain_error is not None:
            raise self._onchain_error
        rows = [
            {"id": i, "coin": c, "amount": str(a), "status": 3, "depositFee": "", "successAt": str(ms)}
            for i, ms, a, c in self._deposits
            if request["startTime"] <= ms <= request["endTime"]
        ]
        return {"retCode": 0, "result": {"rows": rows, "nextPageCursor": ""}}

    async def _withdraw_record(self, request: dict[str, Any]) -> dict[str, Any]:
        rows = [
            {"withdrawId": i, "coin": c, "amount": str(a), "status": "success", "withdrawFee": "0",
             "createTime": str(ms)}
            for i, ms, a, c in self._withdrawals
            if request["startTime"] <= ms <= request["endTime"]
        ]
        return {"retCode": 0, "result": {"rows": rows, "nextPageCursor": ""}}


def _flow_view(client: Any, monkeypatch: pytest.MonkeyPatch, ceiling: int = 3000) -> dp.ReadOnlyRecordingExchange:
    monkeypatch.setattr(dp, "_utc_now", lambda: _RUN_AT)
    return _view(client, ceiling)


async def test_the_bybit_flow_section_counts_a_paired_and_an_unpaired_deposit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeBybitFlows(
        deposits=[("c1", _FLOW_T, 1000.0, "USDT"), ("c2", _FLOW_T + 5 * _DAY_MS, 250.0, "USDT")],
        withdrawals=[("w1", _FLOW_T + 9 * _DAY_MS, 400.0, "USDT")],
        unified=[
            unified_flow("u1", "TRANSFER_IN", _FLOW_T + 2 * _DAY_MS, change="1000"),
            unified_flow("u2", "TRANSFER_OUT", _FLOW_T + 7 * _DAY_MS, change="-400"),
        ],
    )
    view = _flow_view(client, monkeypatch)

    values = await dp.measure_bybit_flows(view, _RUN_DAY)

    assert values["onchain_deposits"] == 2
    assert values["onchain_withdrawals"] == 1
    assert values["unified_in"] == 1
    assert values["unified_out"] == 1
    # c1 (1000) pairs with u1; c2 (250) has no Unified twin; w1 (400) pairs with u2.
    assert values["paired_deposits"] == 1
    assert values["unpaired_onchain_deposits"] == 1
    assert values["paired_withdrawals"] == 1
    assert values["unpaired_onchain_withdrawals"] == 0


async def test_the_probe_takes_its_pair_counts_from_the_services_rule_not_its_own(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A probe that carried its own rule would ignore a replaced service function.
    from services.bybit_unified_flows import FlowPairing

    calls: list[int] = []

    def _spy(*args: Any, **_kw: Any) -> FlowPairing:
        calls.append(len(args))
        return FlowPairing(7, 8, 9, 10, frozenset(), frozenset(), 11, 12)

    client = _FakeBybitFlows(deposits=[("c1", _FLOW_T, 1000.0, "USDT")])
    view = _flow_view(client, monkeypatch)
    monkeypatch.setattr(dp, "pair_onchain_with_unified", _spy)

    values = await dp.measure_bybit_flows(view, _RUN_DAY)

    assert calls == [4]
    assert (
        values["paired_deposits"], values["paired_withdrawals"],
        values["unpaired_onchain_deposits"], values["unpaired_onchain_withdrawals"],
    ) == (7, 8, 9, 10)
    assert (values["pairing_unreadable_rows"], values["pairing_near_miss_rows"]) == (11, 12)


async def test_zero_pairs_are_told_apart_from_a_near_miss_the_rule_could_not_see(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The on-chain deposit of 1000 and the Unified credit of 999 are plausibly the same money
    # moved net of a fee. paired=0 alone reads as "no overlap"; the near-miss count says the rule,
    # not the account, is why.
    client = _FakeBybitFlows(
        deposits=[("c1", _FLOW_T, 1000.0, "USDT")],
        unified=[unified_flow("u1", "TRANSFER_IN", _FLOW_T + 2 * _DAY_MS, change="999")],
    )
    values = await dp.measure_bybit_flows(_flow_view(client, monkeypatch), _RUN_DAY)
    assert values["paired_deposits"] == 0
    assert values["unpaired_onchain_deposits"] == 1
    assert values["pairing_near_miss_rows"] == 1
    assert values["pairing_unreadable_rows"] == 0


async def test_a_bybit_read_window_is_the_derives_own_retention_floor_to_now(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A deposit 400 days back is past Bybit's 365-day retention: the derive never reads it, so
    # the probe must not count it either.
    client = _FakeBybitFlows(
        deposits=[
            ("old", _RUN_NOW_MS - 400 * _DAY_MS, 5.0, "USDT"),
            ("new", _RUN_NOW_MS - 100 * _DAY_MS, 6.0, "USDT"),
        ],
    )
    view = _flow_view(client, monkeypatch)

    values = await dp.measure_bybit_flows(view, _RUN_DAY)

    assert values["onchain_deposits"] == 1


def test_the_flow_keys_are_in_the_record_vocabulary() -> None:
    for name in (
        "onchain_deposits", "onchain_withdrawals", "unified_in", "unified_out",
        "paired_deposits", "paired_withdrawals", "unpaired_onchain_deposits",
        "unpaired_onchain_withdrawals",
    ):
        assert name in dp.KEY_RECORD_KEYS


async def test_a_bybit_key_record_carries_the_flow_counts_and_an_okx_key_prints_field_absent(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(dp, "_utc_now", lambda: _RUN_AT)
    bybit = _FakeBybitFlows(
        deposits=[("c1", _FLOW_T, 1000.0, "USDT")],
        unified=[unified_flow("u1", "TRANSFER_IN", _FLOW_T + _DAY_MS, change="1000")],
    )
    bybit_values = await dp._measure_key(_view(bybit), "bybit", _RUN_DAY)
    okx_values = await dp._measure_key(_view(_FakeOkx(bills={"SWAP": 5})), "okx", _RUN_DAY)

    record = dp._key_record("k1", "bybit", "2026-11-03", measured=True, **bybit_values)
    okx_record = dp._key_record("k2", "okx", "2026-11-03", measured=True, **okx_values)

    assert record["paired_deposits"] == 1
    assert okx_record["paired_deposits"] == dp.FIELD_ABSENT
    assert okx_record["onchain_deposits"] == dp.FIELD_ABSENT
    json.loads(dp.emit_record(record))
    json.loads(dp.emit_record(okx_record))


class _CamelInner:
    id = "bybit"
    rateLimit = 0

    def __init__(self) -> None:
        self.hits: list[str] = []

    async def privateGetV5AssetDepositQueryRecord(self, request: dict[str, Any]) -> dict[str, Any]:
        self.hits.append("get")
        return {"result": {"rows": []}}

    async def privatePostV5OrderCreate(self, request: dict[str, Any]) -> dict[str, Any]:
        self.hits.append("post")
        return {}

    def parse_transactions(self, rows: list[Any], *_a: Any) -> list[Any]:
        return list(rows)

    def add_pagination_cursor_to_result(self, response: Any) -> list[Any]:
        return []


async def test_the_view_resolves_camel_case_gets_and_the_pure_parsers_but_not_a_camel_case_post() -> None:
    inner = _CamelInner()
    view = _view(inner)

    await view.privateGetV5AssetDepositQueryRecord({"startTime": 1})
    assert view.parse_transactions([1]) == [1]
    assert view.add_pagination_cursor_to_result({}) == []
    with pytest.raises(AttributeError):
        view.privatePostV5OrderCreate
    with pytest.raises(AttributeError):
        view.private_post_v5_order_create

    assert inner.hits == ["get"]
    assert view.calls == 1  # the parsers do no I/O and are not counted as venue calls


# ---------------------------------------------------------------------------
# Plan 186-03 Task 2: account type, Unified read state, net-flow ratios, flow timings.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("uta", "master", "want_uta", "want_master"),
    [
        (1, True, True, True),
        (0, False, False, False),
        ("yes", "no", dp.FIELD_ABSENT, dp.FIELD_ABSENT),  # a flag is never guessed
        (None, None, dp.FIELD_ABSENT, dp.FIELD_ABSENT),
    ],
)
async def test_the_account_type_comes_from_the_key_info_answer_and_is_never_guessed(
    monkeypatch: pytest.MonkeyPatch, uta: Any, master: Any, want_uta: Any, want_master: Any
) -> None:
    client = _FakeBybitFlows(uta=uta, master=master)
    view = _flow_view(client, monkeypatch)

    values = await dp.measure_bybit_flows(view, _RUN_DAY)

    assert values["bybit_is_uta"] == want_uta
    assert values["bybit_is_master"] == want_master


async def test_a_clean_unified_read_is_complete(monkeypatch: pytest.MonkeyPatch) -> None:
    view = _flow_view(_FakeBybitFlows(), monkeypatch)

    values = await dp.measure_bybit_flows(view, _RUN_DAY)

    assert values["unified_read_state"] == "complete"
    assert values["onchain_read_state"] == "complete"
    assert values["unified_in"] == 0  # an empty book is a measured zero, not absent


async def test_a_reader_refusal_is_reader_error_and_leaves_the_unified_and_pair_counts_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeBybitFlows(
        deposits=[("c1", _FLOW_T, 1000.0, "USDT")], unified_malformed=True
    )
    view = _flow_view(client, monkeypatch)

    values = await dp.measure_bybit_flows(view, _RUN_DAY)

    assert values["unified_read_state"] == "reader_error"
    for name in (
        "unified_in", "unified_out", "paired_deposits", "paired_withdrawals",
        "unpaired_onchain_deposits", "unpaired_onchain_withdrawals",
        "unified_net_over_anchor", "unpaired_onchain_net_over_anchor",
    ):
        assert values[name] == dp.FIELD_ABSENT, name
    # The on-chain read the derive does today is unaffected.
    assert values["onchain_deposits"] == 1


async def test_a_venue_exception_in_the_unified_read_is_venue_error_with_no_class_or_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeBybitFlows(unified_error=ccxt.NetworkError(_VENUE_MESSAGE))
    view = _flow_view(client, monkeypatch)

    values = await dp.measure_bybit_flows(view, _RUN_DAY)

    assert values["unified_read_state"] == "venue_error"
    blob = json.dumps(values)
    assert _VENUE_MESSAGE not in blob
    assert "NetworkError" not in blob


async def test_a_failed_onchain_read_is_a_state_and_does_not_lose_the_unified_counts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeBybitFlows(
        unified=[unified_flow("u1", "TRANSFER_IN", _FLOW_T, change="5")],
        onchain_error=ccxt.NetworkError(_VENUE_MESSAGE),
    )
    view = _flow_view(client, monkeypatch)

    values = await dp.measure_bybit_flows(view, _RUN_DAY)

    assert values["onchain_read_state"] == "failed"
    assert values["onchain_deposits"] == dp.FIELD_ABSENT
    assert values["paired_deposits"] == dp.FIELD_ABSENT
    assert values["unified_in"] == 1
    assert _VENUE_MESSAGE not in json.dumps(values)


async def test_a_spent_call_budget_in_the_flow_reads_is_a_refusal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeBybitFlows(deposits=[("c1", _FLOW_T, 1000.0, "USDT")])
    view = _flow_view(client, monkeypatch, ceiling=3)

    with pytest.raises(CallCeilingReached):
        await dp.measure_bybit_flows(view, _RUN_DAY)


def _ratio_client() -> _FakeBybitFlows:
    # Distinctive amounts: 1234.5 must never reach an output line.
    return _FakeBybitFlows(
        deposits=[
            ("c1", _FLOW_T, 1234.5, "USDT"),  # pairs with u1
            ("c2", _FLOW_T + 5 * _DAY_MS, 250.0, "USDC"),  # stable, unpaired
            ("c3", _FLOW_T + 6 * _DAY_MS, 0.5, "BTC"),  # not a stable coin, unpaired
        ],
        withdrawals=[("w1", _FLOW_T + 9 * _DAY_MS, 90.0, "USDT")],  # unpaired stable out
        unified=[
            unified_flow("u1", "TRANSFER_IN", _FLOW_T + 2 * _DAY_MS, change="1234.5"),
            unified_flow("u2", "TRANSFER_OUT", _FLOW_T + 7 * _DAY_MS, change="-400"),
            unified_flow("u3", "TRANSFER_IN", _FLOW_T + 8 * _DAY_MS, currency="ETH", change="2"),
        ],
    )


async def test_the_net_flow_ratios_are_stable_coin_net_over_the_anchor_and_leave_other_coins_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    view = _flow_view(_ratio_client(), monkeypatch)
    view.equity_reading = (8_000.0, False, 0.0, False)

    values = await dp.measure_bybit_flows(view, _RUN_DAY)

    # Unified stable net: +1234.5 in, -400 out = 834.5; ETH is left out. 834.5 / 8000 = 0.1043 -> 0.104.
    assert values["unified_net_over_anchor"] == 0.104
    # Unpaired on-chain stable net: +250 (c2) - 90 (w1) = 160; BTC left out. 160 / 8000 = 0.02.
    assert values["unpaired_onchain_net_over_anchor"] == 0.02
    # Non-stable rows read in total: c3 (BTC on chain) and u3 (ETH Unified).
    assert values["nonstable_flow_rows"] == 2
    blob = json.dumps(values)
    for needle in ("1234.5", "USDT", "USDC", "BTC", "ETH"):
        assert needle not in blob


@pytest.mark.parametrize(
    "reading",
    [None, (0.0, False, 0.0, False), (None, True, 0.0, False), (-5.0, False, 0.0, False)],
    ids=["unread", "zero", "balance-error", "negative"],
)
async def test_an_anchor_that_is_zero_or_unreadable_gives_field_absent_ratios(
    monkeypatch: pytest.MonkeyPatch, reading: Any
) -> None:
    view = _flow_view(_ratio_client(), monkeypatch)
    view.equity_reading = reading

    values = await dp.measure_bybit_flows(view, _RUN_DAY)

    assert values["unified_net_over_anchor"] == dp.FIELD_ABSENT
    assert values["unpaired_onchain_net_over_anchor"] == dp.FIELD_ABSENT
    assert values["nonstable_flow_rows"] == 2  # the count does not need the anchor
    # And the record says WHY the ratios are absent, so an unreadable anchor is not a quiet account.
    assert values["anchor_unreadable"] is True


async def test_a_readable_anchor_is_not_marked_unreadable(monkeypatch: pytest.MonkeyPatch) -> None:
    view = _flow_view(_ratio_client(), monkeypatch)
    view.equity_reading = (8_000.0, False, 0.0, False)
    values = await dp.measure_bybit_flows(view, _RUN_DAY)
    assert values["anchor_unreadable"] is False


async def test_the_flow_timings_are_three_significant_figure_seconds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ticks = iter([10.0, 11.2345, 11.2345, 11.9])  # on-chain start/end, Unified start/end
    view = _flow_view(_FakeBybitFlows(), monkeypatch)
    monkeypatch.setattr(dp, "_monotonic", lambda: next(ticks))

    values = await dp.measure_bybit_flows(view, _RUN_DAY)

    assert values["flows_elapsed_s"] == 1.23
    assert values["unified_elapsed_s"] == 0.665


async def test_the_gap_2_record_with_every_new_field_validates_and_prints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    view = _flow_view(_ratio_client(), monkeypatch)
    view.equity_reading = (10_000.0, False, 0.0, False)
    values = await dp.measure_bybit_flows(view, _RUN_DAY)

    line = dp.emit_record(dp._key_record("k1", "bybit", "2026-11-03", measured=True, **values))

    assert "unified_net_over_anchor" in line


def test_a_net_ratio_may_be_negative_but_not_an_unrounded_float_or_text() -> None:
    record = dp._key_record("k1", "bybit", "2026-11-03", unified_net_over_anchor=-0.0123)
    dp.emit_record(record)
    for bad in (-0.012345, "USDT", True):
        record = dp._key_record("k1", "bybit", "2026-11-03")
        record["unified_net_over_anchor"] = bad
        with pytest.raises(ValueError, match="unified_net_over_anchor"):
            dp.emit_record(record)
    record = dp._key_record("k1", "bybit", "2026-11-03")
    record["unified_read_state"] = _VENUE_MESSAGE
    with pytest.raises(ValueError, match="unified_read_state"):
        dp.emit_record(record)


def _bybit_flow_record(label: str, **values: Any) -> dict[str, Any]:
    return dp._key_record(label, "bybit", "2026-11-03", measured=True, **values)


def test_the_summary_carries_the_nine_bybit_flow_aggregates() -> None:
    records = [
        _bybit_flow_record(
            "k1", bybit_is_uta=True, onchain_deposits=3, onchain_withdrawals=1, unified_in=2,
            unified_out=1, paired_deposits=2, paired_withdrawals=1, unpaired_onchain_deposits=1,
            unpaired_onchain_withdrawals=0, onchain_read_state="complete", unified_read_state="complete",
            flows_elapsed_s=1.5, unified_elapsed_s=0.5,
        ),
        _bybit_flow_record(
            "k2", bybit_is_uta=False, onchain_deposits=4, onchain_withdrawals=0,
            onchain_read_state="complete", unified_read_state="complete",
            flows_elapsed_s=3.0, unified_elapsed_s=2.0,
        ),
        # key info unreadable: UTA unknown
        _bybit_flow_record("k3", onchain_read_state="complete", unified_read_state="complete"),
        dp._key_record("k4", "okx", "2026-11-03", measured=True),
    ]

    summary = dp.summarize(records, "2026-11-03")

    assert summary["bybit_uta"] == 1
    assert summary["bybit_non_uta"] == 1
    assert summary["bybit_uta_unknown"] == 1
    assert summary["bybit_onchain_rows"] == 8  # 3 + 1 + 4 + 0
    assert summary["bybit_unified_rows"] == 3  # k2's are absent, not counted as 0
    assert summary["bybit_paired_rows"] == 3
    assert summary["bybit_unpaired_onchain_rows"] == 1
    assert summary["bybit_unified_reader_errors"] == 0
    assert summary["bybit_max_flows_s"] == 5.0  # k2: 3.0 + 2.0
    dp.emit_record(summary)
    # An OKX key carries none of it, and the summary has no OKX flow aggregate.
    assert "okx_onchain_rows" not in summary


_FLOW_SUM_NAMES = tuple(dp._BYBIT_FLOW_SUM_FIELDS)


def _complete_bybit(label: str, **values: Any) -> dict[str, Any]:
    return _bybit_flow_record(
        label, onchain_read_state="complete", unified_read_state="complete", onchain_deposits=2,
        onchain_withdrawals=1, unified_in=1, unified_out=1, paired_deposits=1, paired_withdrawals=1,
        unpaired_onchain_deposits=1, unpaired_onchain_withdrawals=0, pairing_unreadable_rows=0,
        pairing_near_miss_rows=0, **values,
    )


@pytest.mark.parametrize(
    "broken",
    [
        {"onchain_read_state": "failed"},
        {"unified_read_state": "venue_error"},
        {"unified_read_state": "reader_error"},
        {"onchain_read_state": dp.FIELD_ABSENT, "unified_read_state": dp.FIELD_ABSENT},
    ],
)
def test_a_bybit_flow_read_that_did_not_complete_makes_every_flow_sum_field_absent(
    broken: dict[str, Any],
) -> None:
    # CR-02: a failed or unread flow read adds nothing to a sum, so the other key's 3 on-chain rows
    # would print as the total and plan 186-04 would decide Gap 2 on rows that were never read.
    records = [_complete_bybit("k1"), _bybit_flow_record("k2", **broken)]

    summary = dp.summarize(records, "2026-11-03")

    for name in _FLOW_SUM_NAMES:
        assert summary[name] == dp.FIELD_ABSENT, name
    dp.emit_record(summary)


def test_the_bybit_flow_sums_are_absent_with_no_measured_key_or_an_unmeasurable_one_and_printed_otherwise() -> None:
    none_measured = dp.summarize(
        [dp._key_record("k1", "bybit", "2026-11-03", unmeasurable_reason="timeout")], "2026-11-03"
    )
    unmeasured = dp.summarize(
        [_complete_bybit("k1"), dp._key_record("k2", "bybit", "2026-11-03", unmeasurable_reason="timeout")],
        "2026-11-03",
    )
    ineligible = dp.summarize(
        [_complete_bybit("k1"),
         dp._key_record("k2", "bybit", "2026-11-03", unmeasurable_reason="key_not_eligible")],
        "2026-11-03",
    )

    for name in _FLOW_SUM_NAMES:
        assert none_measured[name] == dp.FIELD_ABSENT, name
        assert unmeasured[name] == dp.FIELD_ABSENT, name
    assert ineligible["bybit_onchain_rows"] == 3
    assert ineligible["bybit_pairing_unreadable_rows"] == 0  # a read zero, printed as 0
    dp.emit_record(unmeasured)


# ---------------------------------------------------------------------------
# Plan 186-03 Task 3: Gap 4 - same-hour funding legs, overlap duplicates, malformed rows. The
# funding fetchers are the REAL ones; the venue is a fake in the venues' own reply shapes.
# ---------------------------------------------------------------------------

import time as _time  # noqa: E402

_HOUR = 3_600_000
# A UTC hour boundary about ten days back: the Bybit funding fetcher reads the real clock for its
# window, so its rows have to sit in the last year of real time.
_FUND_HOUR = (int(_time.time() * 1000) - 10 * _DAY_MS) // _HOUR * _HOUR


def test_two_distinct_bill_ids_in_one_instrument_hour_are_one_real_pair() -> None:
    rows = [("BTC-USDT-SWAP", _FUND_HOUR + 1_000, "b1"), ("BTC-USDT-SWAP", _FUND_HOUR + 60_000, "b2")]

    assert dp.same_hour_pairs(rows) == (1, 0)


def test_the_same_bill_id_twice_is_overlap_not_a_pair() -> None:
    rows = [("BTC-USDT-SWAP", _FUND_HOUR + 1_000, "b1"), ("BTC-USDT-SWAP", _FUND_HOUR + 1_000, "b1")]

    assert dp.same_hour_pairs(rows) == (0, 1)


def test_other_hours_and_other_instruments_do_not_group() -> None:
    rows = [
        ("BTC-USDT-SWAP", _FUND_HOUR + 1_000, "b1"),
        ("BTC-USDT-SWAP", _FUND_HOUR + _HOUR + 1_000, "b2"),  # next hour
        ("ETH-USDT-SWAP", _FUND_HOUR + 1_000, "b3"),  # other instrument
    ]

    assert dp.same_hour_pairs(rows) == (0, 0)


def test_a_group_can_hold_a_real_pair_and_an_overlap_duplicate_at_once() -> None:
    rows = [
        ("X", _FUND_HOUR, "b1"), ("X", _FUND_HOUR, "b1"), ("X", _FUND_HOUR + 5, "b2"),
    ]

    assert dp.same_hour_pairs(rows) == (1, 1)


class _FakeOkxFunding:
    """OKX funding: ``type`` 8 bills on the recent and the archive endpoint, newest first, with
    ``after`` honoured. Anything but type 8 answers empty."""

    id = "okx"
    rateLimit = 0

    def __init__(
        self,
        recent: list[dict[str, str]] | None = None,
        archive: list[dict[str, str]] | None = None,
        *,
        error: BaseException | None = None,
    ) -> None:
        self._recent = recent or []
        self._archive = archive or []
        self._error = error

    async def _serve(self, rows: list[dict[str, str]], params: dict[str, str]) -> dict[str, Any]:
        if self._error is not None:
            raise self._error
        if params.get("type") != "8":
            return {"code": "0", "data": []}
        after = params.get("after")
        keep = [r for r in rows if not after or int(r["billId"]) < int(after)]
        return {"code": "0", "data": [dict(r) for r in keep[: int(params["limit"])]]}

    async def private_get_account_bills(self, params: dict[str, str]) -> dict[str, Any]:
        return await self._serve(self._recent, params)

    async def private_get_account_bills_archive(self, params: dict[str, str]) -> dict[str, Any]:
        return await self._serve(self._archive, params)


def _bill(bill_id: int, ts: int, inst: str = "BTC-USDT-SWAP", pnl: str = "0.5") -> dict[str, str]:
    return {"billId": str(bill_id), "ts": str(ts), "instId": inst, "pnl": pnl, "ccy": "USDT", "type": "8"}


async def test_okx_two_distinct_bills_in_one_hour_keep_one_row_and_count_one_pair() -> None:
    client = _FakeOkxFunding(recent=[_bill(2, _FUND_HOUR + 60_000), _bill(1, _FUND_HOUR + 1_000)])
    view = _view(client)

    values = await dp.measure_funding_pairs(view, "okx", "k1")

    assert values["funding_state"] == "complete"
    assert values["funding_raw_rows"] == 2
    assert values["funding_kept_rows"] == 1  # today's dedup on the hour bucket drops the second leg
    assert values["funding_same_hour_distinct_pairs"] == 1
    assert values["funding_same_hour_same_id"] == 0
    assert values["funding_malformed_rows"] == 0


async def test_okx_recent_and_archive_overlap_is_the_same_id_twice_and_no_pair() -> None:
    leg = _bill(7, _FUND_HOUR + 1_000)
    client = _FakeOkxFunding(recent=[leg], archive=[leg])
    view = _view(client)

    values = await dp.measure_funding_pairs(view, "okx", "k1")

    assert values["funding_raw_rows"] == 2
    assert values["funding_kept_rows"] == 1
    assert values["funding_same_hour_distinct_pairs"] == 0
    assert values["funding_same_hour_same_id"] == 1


async def test_okx_replies_recorded_before_the_funding_read_are_not_counted_as_funding() -> None:
    # The realized read used the same endpoint on the same view earlier; here that earlier reply
    # carries a row, so counting it would read two raw rows instead of one.
    client = _FakeOkxFunding(recent=[_bill(1, _FUND_HOUR)])
    view = _view(client)
    await view.private_get_account_bills({"type": "8", "limit": "100"})

    values = await dp.measure_funding_pairs(view, "okx", "k1")

    assert values["funding_raw_rows"] == 1


async def test_okx_a_row_with_a_blank_instrument_is_counted_malformed() -> None:
    client = _FakeOkxFunding(recent=[_bill(2, _FUND_HOUR + 1_000, inst=""), _bill(1, _FUND_HOUR + 2_000)])
    view = _view(client)

    values = await dp.measure_funding_pairs(view, "okx", "k1")

    assert values["funding_raw_rows"] == 2
    assert values["funding_malformed_rows"] == 1
    assert values["funding_kept_rows"] == 1


class _FakeBybitFunding:
    """Bybit funding: SETTLEMENT rows on the transaction log, ``linear`` category only (the
    inverse category answers empty), inside the requested window, with no cursor."""

    id = "bybit"
    rateLimit = 0

    def __init__(self, rows: list[dict[str, str]] | None = None, *, error: BaseException | None = None) -> None:
        self._rows = rows or []
        self._error = error

    async def private_get_v5_account_transaction_log(self, params: dict[str, str]) -> dict[str, Any]:
        if self._error is not None:
            raise self._error
        if params.get("type") != "SETTLEMENT" or params.get("category") != "linear":
            return {"result": {"list": [], "nextPageCursor": ""}}
        start, end = int(params["startTime"]), int(params["endTime"])
        inside = [r for r in self._rows if start <= int(r["transactionTime"]) <= end]
        return {"result": {"list": [dict(r) for r in inside], "nextPageCursor": ""}}


def _settle(row_id: str, ts: int, symbol: str = "BTCUSDT", funding: str | None = "0.25") -> dict[str, str]:
    row = {"id": row_id, "symbol": symbol, "transactionTime": str(ts), "currency": "USDT"}
    if funding is not None:
        row["funding"] = funding
    return row


async def test_bybit_two_distinct_settlements_in_one_hour_are_both_kept_and_count_one_pair() -> None:
    client = _FakeBybitFunding([_settle("s1", _FUND_HOUR + 1_000), _settle("s2", _FUND_HOUR + 60_000)])
    view = _view(client)

    values = await dp.measure_funding_pairs(view, "bybit", "k1")

    assert values["funding_state"] == "complete"
    assert values["funding_raw_rows"] == 2
    assert values["funding_kept_rows"] == 2  # Bybit has no dedup, so nothing is dropped
    assert values["funding_same_hour_distinct_pairs"] == 1
    assert values["funding_malformed_rows"] == 0


async def test_bybit_log_replies_recorded_before_the_funding_read_are_not_counted_as_funding() -> None:
    client = _FakeBybitFunding([_settle("s1", _FUND_HOUR + 1_000)])
    view = _view(client)
    await view.private_get_v5_account_transaction_log(
        {"type": "SETTLEMENT", "category": "linear",
         "startTime": str(_FUND_HOUR), "endTime": str(_FUND_HOUR + _HOUR)}
    )

    values = await dp.measure_funding_pairs(view, "bybit", "k1")

    assert values["funding_raw_rows"] == 1


async def test_bybit_a_blank_symbol_and_a_row_with_no_amount_field_are_malformed() -> None:
    client = _FakeBybitFunding(
        [
            _settle("s1", _FUND_HOUR + 1_000, symbol=""),
            _settle("s2", _FUND_HOUR + 2_000, funding=None),
            _settle("s3", _FUND_HOUR + 3_000),
        ]
    )
    view = _view(client)

    values = await dp.measure_funding_pairs(view, "bybit", "k1")

    assert values["funding_raw_rows"] == 3
    assert values["funding_malformed_rows"] == 2
    assert values["funding_kept_rows"] == 1


async def test_a_funding_fetch_that_hits_its_page_ceiling_reads_truncated_with_counts_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("services.funding_fetch.MAX_PAGES", 2)
    client = _FakeOkxFunding(recent=[_bill(1000 - i, _FUND_HOUR - i * _HOUR) for i in range(250)])
    view = _view(client)

    values = await dp.measure_funding_pairs(view, "okx", "k1")

    assert values["funding_state"] == "truncated"
    assert values["funding_kept_rows"] == dp.FIELD_ABSENT
    assert values["funding_same_hour_distinct_pairs"] == dp.FIELD_ABSENT


async def test_any_other_funding_exception_reads_fetch_error_and_prints_no_text() -> None:
    client = _FakeOkxFunding(error=ccxt.NetworkError(_VENUE_MESSAGE))
    view = _view(client)

    values = await dp.measure_funding_pairs(view, "okx", "k1")

    assert values["funding_state"] == "fetch_error"
    assert values["funding_raw_rows"] == dp.FIELD_ABSENT
    blob = json.dumps(values)
    assert _VENUE_MESSAGE not in blob
    assert "NetworkError" not in blob


async def test_a_spent_call_budget_in_the_funding_read_is_a_refusal_not_fetch_error() -> None:
    client = _FakeOkxFunding(recent=[_bill(1, _FUND_HOUR)])
    view = _view(client, ceiling=0)

    with pytest.raises(CallCeilingReached):
        await dp.measure_funding_pairs(view, "okx", "k1")


async def test_binance_funding_is_field_absent_and_reads_nothing() -> None:
    client = _FakeBinance()
    view = _view(client)

    values = await dp.measure_funding_pairs(view, "binance", "k1")

    assert set(values.values()) == {dp.FIELD_ABSENT}
    assert client.calls == []
    assert view.calls == 0


async def test_the_funding_seconds_are_three_significant_figures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ticks = iter([5.0, 6.2345])
    client = _FakeOkxFunding(recent=[_bill(1, _FUND_HOUR)])
    view = _view(client)
    monkeypatch.setattr(dp, "_monotonic", lambda: next(ticks))

    values = await dp.measure_funding_pairs(view, "okx", "k1")

    assert values["funding_elapsed_s"] == 1.23


async def test_the_funding_record_validates_and_the_key_record_carries_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeOkxFunding(recent=[_bill(2, _FUND_HOUR + 60_000), _bill(1, _FUND_HOUR + 1_000)])
    values = await dp.measure_funding_pairs(_view(client), "okx", "k1")

    line = json.loads(dp.emit_record(dp._key_record("k1", "okx", "2026-11-03", measured=True, **values)))

    assert line["funding_same_hour_distinct_pairs"] == 1
    assert "billId" not in json.dumps(line)


async def test_measure_key_runs_the_funding_section_for_okx_and_bybit_but_not_binance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dp, "_utc_now", lambda: _RUN_AT)
    okx = await dp._measure_key(_view(_FakeOkx(bills={"SWAP": 5})), "okx", _RUN_DAY)
    bybit = await dp._measure_key(_view(_FakeBybitFlows()), "bybit", _RUN_DAY)
    binance = await dp._measure_key(_view(_FakeBinance()), "binance", _RUN_DAY)

    assert okx["funding_state"] != dp.FIELD_ABSENT
    assert bybit["funding_state"] != dp.FIELD_ABSENT
    assert binance["funding_state"] == dp.FIELD_ABSENT


def test_the_summary_carries_the_funding_aggregates_and_the_nonrealized_maximum() -> None:
    def _rec(venue: str, **values: Any) -> dict[str, Any]:
        return dp._key_record("k1", venue, "2026-11-03", measured=True, **values)

    records = [
        _rec("okx", funding_state="complete", funding_same_hour_distinct_pairs=2, funding_malformed_rows=1,
             funding_elapsed_s=4.0, equity_elapsed_s=0.5),
        _rec("okx", funding_state="complete", funding_same_hour_distinct_pairs=3, funding_malformed_rows=0,
             funding_elapsed_s=2.0, equity_elapsed_s=0.25),
        _rec("bybit", funding_state="complete", funding_same_hour_distinct_pairs=0, funding_malformed_rows=2,
             funding_elapsed_s=1.0, equity_elapsed_s=0.5, flows_elapsed_s=3.0, unified_elapsed_s=2.0),
        _rec("binance", equity_elapsed_s=0.75),
    ]

    summary = dp.summarize(records, "2026-11-03")

    assert summary["okx_funding_pairs"] == 5
    assert summary["okx_funding_malformed"] == 1
    assert summary["okx_max_funding_s"] == 4.0
    assert summary["okx_max_nonrealized_s"] == 4.5  # 4.0 + 0.5
    assert summary["bybit_funding_pairs"] == 0
    assert summary["bybit_funding_malformed"] == 2
    assert summary["bybit_max_nonrealized_s"] == 6.5  # 0.5 + 1.0 + 3.0 + 2.0
    assert summary["binance_max_nonrealized_s"] == 0.75  # equity only
    assert "binance_funding_pairs" not in summary
    dp.emit_record(summary)


@pytest.mark.parametrize("state", ["truncated", "fetch_error", dp.FIELD_ABSENT])
def test_a_funding_read_that_did_not_complete_makes_the_pair_counts_field_absent(state: str) -> None:
    # A truncated or failed funding read adds nothing to a sum, so a total of 5 pairs from the two
    # keys that were read would hide the third key's unread history: "no pairs" is not "not read".
    def _rec(venue: str, **values: Any) -> dict[str, Any]:
        return dp._key_record("k1", venue, "2026-11-03", measured=True, **values)

    records = [
        _rec("okx", funding_state="complete", funding_same_hour_distinct_pairs=5, funding_malformed_rows=1),
        _rec("okx", funding_state=state),
        _rec("bybit", funding_state="complete", funding_same_hour_distinct_pairs=0, funding_malformed_rows=0),
    ]

    summary = dp.summarize(records, "2026-11-03")

    assert summary["okx_funding_pairs"] == dp.FIELD_ABSENT
    assert summary["okx_funding_malformed"] == dp.FIELD_ABSENT
    assert summary["okx_funding_complete"] == 1
    assert summary["okx_funding_truncated"] == (1 if state == "truncated" else 0)
    assert summary["okx_funding_fetch_error"] == (1 if state == "fetch_error" else 0)
    assert summary["bybit_funding_pairs"] == 0  # every bybit key was read in full: a real zero
    dp.emit_record(summary)


def test_a_failed_bybit_read_has_a_summary_count_and_does_not_read_as_zero_rows() -> None:
    # A key whose on-chain read failed, one whose Unified read raised a venue error and one whose
    # equity anchor was unreadable all print field-absent counts, which the sums skip. Without a
    # count of their own the summary reads as 0 rows / 0 overlap and the founder gate is fed an
    # empty account instead of an unread one.
    records = [
        _bybit_flow_record("k1", onchain_read_state="failed", unified_read_state="complete", anchor_unreadable=False),
        _bybit_flow_record("k2", onchain_read_state="complete", unified_read_state="venue_error",
                           anchor_unreadable=True),
        _bybit_flow_record("k3", onchain_read_state="complete", unified_read_state="reader_error",
                           anchor_unreadable=True),
        _bybit_flow_record("k4", onchain_read_state="complete", unified_read_state="complete",
                           anchor_unreadable=False),
    ]

    summary = dp.summarize(records, "2026-11-03")

    assert summary["bybit_onchain_failed"] == 1
    assert summary["bybit_unified_venue_error"] == 1
    assert summary["bybit_unified_reader_errors"] == 1
    assert summary["bybit_anchor_unreadable"] == 2
    dp.emit_record(summary)


def _as_record(values: dict[str, Any]) -> dict[str, Any]:
    """A key's measured values as the record the run prints: what was not measured is field-absent."""
    return dp._key_record("k1", "okx", "2026-11-03", measured=True, **values)


async def test_measure_key_keeps_the_truncated_sizing_when_the_budget_runs_out_after_the_realized_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 15,050 SWAP bills on a ceiling of 110 (plus the calls held back for funding): the realized
    # read (101 pages) and the equity read fit, the continuation gets 8 more pages and stops at the
    # ceiling, and funding then runs on the held-back calls. The whole key used to come out as
    # ('call_ceiling', 'none') with nothing measured, discarding the heaviest data point D-06 sizes
    # the caps from.
    monkeypatch.setattr(dp, "_utc_now", lambda: _RUN_AT)
    view = _view(_FakeOkx(bills={"SWAP": 15_050}), ceiling=110 + dp.FLOWS_FUNDING_CALL_BUDGET)

    values = _as_record(await dp._measure_key(view, "okx", _RUN_DAY))

    assert values["realized_state"] == "truncated"
    assert values["okx_inst_types_at_cap"] == 1
    assert values["past_cap_reached_end"] is False  # a lower bound, said so
    assert isinstance(values["pages_needed_okx_bills"], int) and values["pages_needed_okx_bills"] > 100
    # The continuation stopped at its own ceiling; funding was not starved by it.
    assert values["past_cap_skip"] == "none"  # the walk ended early and says so in the line above
    assert values["funding_skip"] == "none"
    assert values["funding_state"] != dp.FIELD_ABSENT  # read (the fake answers it with an error state)
    assert view.calls > 110
    dp.emit_record(values)


async def test_a_later_section_that_runs_out_of_time_or_errors_leaves_its_fields_absent_not_the_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dp, "_utc_now", lambda: _RUN_AT)
    monkeypatch.setattr(dp, "KEY_TOTAL_TIMEOUT_S", 0.3)

    async def _hangs(*_a: Any, **_k: Any) -> dict[str, Any]:
        await asyncio.sleep(5.0)
        return {"funding_state": "complete"}

    monkeypatch.setattr(dp, "measure_funding_pairs", _hangs)
    timed_out = _as_record(await dp._measure_key(_view(_FakeOkx(bills={"SWAP": 15_050})), "okx", _RUN_DAY))
    assert timed_out["realized_state"] == "truncated"
    assert timed_out["funding_state"] == dp.FIELD_ABSENT
    assert timed_out["funding_skip"] == "timeout"

    async def _venue_error(*_a: Any, **_k: Any) -> dict[str, Any]:
        raise ccxt.NetworkError(_VENUE_MESSAGE)

    monkeypatch.setattr(dp, "KEY_TOTAL_TIMEOUT_S", 3600.0)
    monkeypatch.setattr(dp, "measure_past_cap", _venue_error)
    errored = _as_record(await dp._measure_key(_view(_FakeOkx(bills={"SWAP": 15_050})), "okx", _RUN_DAY))
    assert errored["realized_state"] == "truncated"
    assert errored["past_cap_reached_end"] == dp.FIELD_ABSENT
    assert errored["past_cap_skip"] == "NetworkError"  # the closed class, never the message
    assert errored["funding_state"] != dp.FIELD_ABSENT  # the later section still ran
    assert _VENUE_MESSAGE not in json.dumps(errored)


def test_a_truncated_key_whose_continuation_was_not_measured_counts_as_unsized() -> None:
    def _rec(**values: Any) -> dict[str, Any]:
        return dp._key_record("k1", "okx", "2026-11-03", measured=True, **values)

    records = [
        _rec(realized_state="truncated", past_cap_reached_end=True),
        _rec(realized_state="truncated", past_cap_reached_end=False),
        _rec(realized_state="truncated"),  # continuation field-absent
        _rec(realized_state="complete"),  # nothing to size
    ]

    assert dp.summarize(records, "2026-11-03")["okx_keys_still_short_after_ceiling"] == 2


# ---------------------------------------------------------------------------
# Round 2 (CR-01, WR-04, WR-05, F3): a skipped section leaves a trace, and the trace is counted.
# ---------------------------------------------------------------------------


async def test_a_skipped_flows_section_names_its_reason_keeps_what_it_read_and_fails_the_run(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # The Unified read of a Bybit key ran out of calls after the on-chain read had succeeded. The
    # section was dropped silently: the key read as measured, every Bybit flow sum took 0 from it,
    # the exit was 0, and plan 186-04 decided Gap 2 on data that was never read.
    async def _flows_stop(
        _view: Any, _day: Any = None, values: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        assert values is not None
        values["onchain_read_state"] = "complete"
        values["onchain_deposits"] = 3
        values["onchain_withdrawals"] = 1
        values["flows_elapsed_s"] = 1.5
        raise CallCeilingReached(1)

    monkeypatch.setattr(dp, "measure_bybit_flows", _flows_stop)
    harness = _Harness([_key_row(exchange="bybit")], [_FakeBybitFlows()])
    harness.install(monkeypatch)

    exit_code = await dp.run()

    (key, summary) = _lines(capsys)[0]
    assert key["measured"] is True
    assert key["bybit_flows_skip"] == "call_ceiling"
    assert key["onchain_deposits"] == 3  # read before the stop: kept
    assert key["flows_elapsed_s"] == 1.5
    assert key["bybit_limit_skip"] == "none"
    assert key["funding_skip"] == "none"
    assert key["past_cap_skip"] == dp.FIELD_ABSENT  # not truncated: not run
    assert summary["bybit_sections_skipped"] == 1
    assert summary["okx_sections_skipped"] == 0
    assert exit_code == dp.EXIT_FAILED


async def test_a_clean_run_skips_nothing_and_exits_ok(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    harness = _Harness([_key_row()], [_FakeOkx(bills={"SWAP": 250})])
    harness.install(monkeypatch)

    exit_code = await dp.run()

    (key, summary) = _lines(capsys)[0]
    assert key["funding_skip"] == "none"
    assert summary["okx_sections_skipped"] == 0
    assert exit_code == dp.EXIT_OK


class _FakeOkxFundingDies(_FakeOkx):
    """The realized read answers; the funding read (a bills call with no instType) fails."""

    async def _serve(
        self, name: str, table: dict[str, list[dict[str, str]]], params: dict[str, str]
    ) -> dict[str, Any]:
        if "instType" not in params:
            raise ccxt.NetworkError(_VENUE_MESSAGE)
        return await super()._serve(name, table, params)


async def _funding_complete(*_a: Any, values: dict[str, Any] | None = None, **_k: Any) -> dict[str, Any]:
    """The Bybit fixture answers only the Unified log, so its funding read would fail by itself and
    exit 1 for a reason these tests are not about: stub the funding read as complete."""
    assert values is not None
    values["funding_state"] = "complete"
    return values


@pytest.mark.parametrize(
    ("exchange", "client", "state_key", "state", "count_key"),
    [
        ("bybit", _FakeBybitFlows(onchain_error=ccxt.PermissionDenied(_VENUE_MESSAGE)),
         "onchain_read_state", "failed", "bybit_onchain_failed"),
        ("bybit", _FakeBybitFlows(unified_error=ccxt.NetworkError(_VENUE_MESSAGE)),
         "unified_read_state", "venue_error", "bybit_unified_venue_error"),
        ("okx", _FakeOkxFundingDies(bills={"SWAP": 250}),
         "funding_state", "fetch_error", "okx_funding_fetch_error"),
    ],
    ids=["onchain_failed", "unified_venue_error", "funding_fetch_error"],
)
async def test_a_flow_or_funding_read_that_ended_in_a_venue_error_fails_the_run(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    exchange: str,
    client: Any,
    state_key: str,
    state: str,
    count_key: str,
) -> None:
    # The same transient or permission error one frame out (a section skip) exits 1. Inside these
    # three reads it became a measured state, the section read `none` and the run exited 0.
    if exchange == "bybit":
        monkeypatch.setattr(dp, "measure_funding_pairs", _funding_complete)
    harness = _Harness([_key_row(exchange=exchange)], [client])
    harness.install(monkeypatch)

    exit_code = await dp.run()

    (key, summary) = _lines(capsys)[0]
    assert key[state_key] == state
    assert summary[count_key] == 1
    assert summary["keys_unmeasurable"] == 0
    assert summary[f"{exchange}_sections_skipped"] == 0
    assert exit_code == dp.EXIT_FAILED
    if exchange == "bybit":
        for name in _FLOW_SUM_NAMES:
            assert summary[name] == dp.FIELD_ABSENT, name


async def test_a_unified_reader_error_stays_a_finding_and_exits_ok(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    async def _reader_error(
        _view: Any, _day: Any = None, values: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        assert values is not None
        values["onchain_read_state"] = "complete"
        values["unified_read_state"] = "reader_error"
        return values

    monkeypatch.setattr(dp, "measure_bybit_flows", _reader_error)
    monkeypatch.setattr(dp, "measure_funding_pairs", _funding_complete)
    harness = _Harness([_key_row(exchange="bybit")], [_FakeBybitFlows()])
    harness.install(monkeypatch)

    exit_code = await dp.run()

    (key, summary) = _lines(capsys)[0]
    assert key["unified_read_state"] == "reader_error"
    assert summary["bybit_unified_reader_errors"] == 1
    assert summary["bybit_onchain_rows"] == dp.FIELD_ABSENT  # a reader error is not a full read
    assert exit_code == dp.EXIT_OK


async def test_a_funding_read_stopped_by_the_key_deadline_records_its_elapsed_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A section that ran until the deadline is the slowest one, so leaving its time out makes
    # <venue>_max_nonrealized_s, and with it plan 186-04's budget split, too generous.
    monkeypatch.setattr(dp, "_utc_now", lambda: _RUN_AT)
    monkeypatch.setattr(dp, "KEY_TOTAL_TIMEOUT_S", 0.3)

    async def _hangs(*_a: Any, **_k: Any) -> list[Any]:
        await asyncio.sleep(5.0)
        return []

    monkeypatch.setattr(dp, "fetch_funding_okx", _hangs)

    values = _as_record(await dp._measure_key(_view(_FakeOkx(bills={"SWAP": 250})), "okx", _RUN_DAY))

    assert values["funding_skip"] == "timeout"
    assert isinstance(values["funding_elapsed_s"], float) and values["funding_elapsed_s"] > 0.0


async def test_the_bybit_limit_probe_runs_before_the_continuation_and_the_flows_keep_their_own_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The continuation spends whatever budget is left, and the keys that need it are the busiest
    # Bybit accounts: a limit probe that ran after it was skipped on exactly those keys.
    monkeypatch.setattr(dp, "_utc_now", lambda: _RUN_AT)
    client = _FakeBybit(hot_pages=BYBIT_PNL_PAGE_CAP + 1)
    first = _view(_FakeBybit(hot_pages=BYBIT_PNL_PAGE_CAP + 1))
    await dp.measure_realized(first, "bybit", _RUN_DAY)
    realized_calls = first.calls
    # The realized read fits and the limit probe takes two calls; the continuation then has one
    # page, so it ends at the ceiling, and funding and flows run on the calls held back for them.
    view = _view(client, ceiling=realized_calls + 2 + 1 + dp.FLOWS_FUNDING_CALL_BUDGET)

    values = _as_record(await dp._measure_key(view, "bybit", _RUN_DAY))

    limit_100 = next(i for i, r in enumerate(client.requests) if r["limit"] == 100)
    continued = next(i for i, r in enumerate(client.requests) if r.get("cursor") == str(BYBIT_PNL_PAGE_CAP))
    assert limit_100 < continued
    assert values["bybit_limit_skip"] == "none"
    assert values["bybit_limit100_rows"] != dp.FIELD_ABSENT
    assert values["past_cap_skip"] in ("none", "call_ceiling")
    # Flows and funding were attempted with their held-back calls rather than refused outright.
    assert values["bybit_flows_skip"] != "call_ceiling"
    assert values["funding_skip"] != "call_ceiling"


@pytest.mark.parametrize(
    ("limit_200_error", "limit_100_error", "informative"),
    [
        (ccxt.BadRequest(_VENUE_MESSAGE), None, True),  # the venue rejected the parameter
        (ccxt.ExchangeError(_VENUE_MESSAGE), None, False),  # Bybit's "try again later" and every unmapped code
        (ccxt.BadRequest(_VENUE_MESSAGE), ccxt.BadRequest(_VENUE_MESSAGE), False),  # nothing separates 200 from 100
        (ccxt.NetworkError(_VENUE_MESSAGE), None, False),
    ],
)
async def test_a_limit_probe_is_informative_only_when_the_venue_rejected_200_and_served_100(
    limit_200_error: BaseException, limit_100_error: BaseException | None, informative: bool
) -> None:
    class _Client(_FakeBybitLimit):
        async def private_get_v5_position_closed_pnl(self, params: dict[str, Any]) -> dict[str, Any]:
            error = limit_200_error if params["limit"] == 200 else limit_100_error
            if error is not None:
                raise error
            return {"result": {"list": [{"createdTime": "1"}], "nextPageCursor": ""}}

    values = await dp.measure_bybit_limit(_view(_Client()))

    assert values["bybit_limit_probe_informative"] is informative
    assert _VENUE_MESSAGE not in json.dumps(values)


def test_the_funding_pair_counts_are_absent_for_a_venue_with_no_measured_key_or_an_unmeasurable_one() -> None:
    def _rec(venue: str, **values: Any) -> dict[str, Any]:
        return dp._key_record("k1", venue, "2026-11-03", **values)

    no_okx_key = dp.summarize([_rec("bybit", measured=True, funding_state="complete")], "2026-11-03")
    assert no_okx_key["okx_funding_pairs"] == dp.FIELD_ABSENT  # nothing was measured: not "0 pairs"
    assert no_okx_key["okx_funding_malformed"] == dp.FIELD_ABSENT

    only_unmeasurable = dp.summarize(
        [_rec("okx", unmeasurable_reason="call_ceiling")], "2026-11-03"
    )
    assert only_unmeasurable["okx_funding_pairs"] == dp.FIELD_ABSENT  # not a zero from an empty all()
    assert only_unmeasurable["okx_funding_malformed"] == dp.FIELD_ABSENT

    one_of_each = dp.summarize(
        [
            _rec("okx", measured=True, funding_state="complete", funding_same_hour_distinct_pairs=4,
                 funding_malformed_rows=1),
            _rec("okx", unmeasurable_reason="timeout"),  # its funding was never read
            _rec("okx", unmeasurable_reason="key_not_eligible"),  # the derive does not read it either
        ],
        "2026-11-03",
    )
    assert one_of_each["okx_funding_pairs"] == dp.FIELD_ABSENT  # 4 would be a partial sum
    assert one_of_each["okx_funding_malformed"] == dp.FIELD_ABSENT

    only_not_eligible = dp.summarize(
        [
            _rec("okx", measured=True, funding_state="complete", funding_same_hour_distinct_pairs=4,
                 funding_malformed_rows=1),
            _rec("okx", unmeasurable_reason="key_not_eligible"),
        ],
        "2026-11-03",
    )
    assert only_not_eligible["okx_funding_pairs"] == 4
    dp.emit_record(one_of_each)


def test_the_per_state_counts_add_up_to_the_measured_keys_of_the_venue() -> None:
    # A skipped section is in no state of its own, so the counts fell short of the measured keys
    # and no line said why. A consumer that checks the sum would have caught CR-01.
    def _rec(venue: str, **values: Any) -> dict[str, Any]:
        return dp._key_record("k1", venue, "2026-11-03", measured=True, **values)

    records = [
        _rec("okx", funding_state="complete"),
        _rec("okx", funding_state="truncated"),
        _rec("okx", funding_state="fetch_error"),
        _rec("okx", funding_skip="call_ceiling"),  # skipped: funding_state stays field-absent
        _rec("bybit", funding_state="complete", onchain_read_state="complete", unified_read_state="complete"),
        _rec("bybit", onchain_read_state="failed", unified_read_state="venue_error"),
        _rec("bybit", onchain_read_state="complete", unified_read_state="reader_error"),
        _rec("bybit", bybit_flows_skip="timeout"),  # dropped before either read
    ]

    summary = dp.summarize(records, "2026-11-03")

    for venue in ("okx", "bybit"):
        measured = summary[f"{venue}_keys"]
        assert (
            sum(summary[f"{venue}_funding_{state}"] for state in (*dp.FUNDING_STATES, "not_read"))
            == measured
        )
    assert summary["okx_funding_not_read"] == 1
    assert summary["bybit_funding_not_read"] == 3
    bybit = summary["bybit_keys"]
    assert (
        summary["bybit_onchain_complete"] + summary["bybit_onchain_failed"] + summary["bybit_onchain_not_read"]
        == bybit
    )
    assert (
        summary["bybit_unified_complete"]
        + summary["bybit_unified_reader_errors"]
        + summary["bybit_unified_venue_error"]
        + summary["bybit_unified_not_read"]
        == bybit
    )
    assert summary["bybit_onchain_not_read"] == 1
    assert summary["bybit_unified_not_read"] == 1
    assert summary["okx_sections_skipped"] == 1
    assert summary["bybit_sections_skipped"] == 1
    dp.emit_record(summary)
