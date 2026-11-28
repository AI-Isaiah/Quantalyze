"""Shared fakes for the Phase 259 archive-fills job tests (plans 05, 06 and 07).

A plain helper module: no ``Test*`` class and no ``test_*`` function, so pytest collects nothing
from it. It is a COPY of the fakes in ``test_okx_archive_job.py`` (which stays unedited, and whose
Test classes must not be collected twice) with the additions the fills modes need: a supabase fake
that filters, pages and orders, and an ``upsert`` that emulates the ``trades_dedup_fill`` unique
index with BOTH PostgREST answers (ignore-duplicates returns only the inserted rows; merge returns
every row sent), so a run that loses the ignore flag reads a non-zero ``inserted`` on a rerun.

The fakes record every call by endpoint and instance, so "zero APPLY calls", "zero upserts" and
"the factory was never invoked" are assertions about what was actually called.

All ids and amounts are invented.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace
from typing import Any, Callable, Iterable

import pytest

from services import job_worker, okx_archive_job
from tests._okx_archive_fills_fixtures import FILLS_Q2_PATH, FILLS_Q3_PATH

KEY_ID = "11111111-1111-4111-8111-111111111111"
OTHER_KEY_ID = "22222222-2222-4222-8222-222222222222"
STRATEGY_ID = "33333333-3333-4333-8333-333333333333"
STRATEGY_2_ID = "44444444-4444-4444-8444-444444444444"
LINK_SECRETS = ("SECRET-PATH-3f9a", "SECRET-QUERY-77c1", "2026Q3.zip", "2026Q2.zip", "sig=")

CONFIG = "private_get_account_config"
SUBTYPES = "private_get_account_subtypes"
APPLY = "private_post_account_bills_history_archive"
STATUS = "private_get_account_bills_history_archive"
ARCHIVE_ENDPOINTS = (APPLY, STATUS)

#: OKX's request ``ts`` for the default answers, three hours before the fixtures' clock.
REQUEST_TS_MS = 1795770000000


def link(year: str, quarter: str, version: str = "") -> str:
    """A signed-looking link: its path and query are the bearer secrets the job must never let out
    of memory (only the scheme and host may be described)."""
    return f"https://archive.example.test/dl/SECRET-PATH-3f9a/{year}{quarter}{version}.zip?sig=SECRET-QUERY-77c1"


def finished(year: str, quarter: str, version: str = "", ts: int = REQUEST_TS_MS) -> dict[str, Any]:
    return {"code": "0", "data": [
        {"fileHref": link(year, quarter, version), "state": "finished", "ts": str(ts)}
    ]}


def status(state: str, *, href: str = "", ts: int = REQUEST_TS_MS) -> dict[str, Any]:
    return {"code": "0", "data": [{"fileHref": href, "state": state, "ts": str(ts)}]}


def no_entry() -> dict[str, Any]:
    """OKX has no request for the quarter: a mapping whose ``data`` is an empty list."""
    return {"code": "0", "data": []}


def apply_answer(result: str, ts: int = REQUEST_TS_MS) -> dict[str, Any]:
    return {"code": "0", "data": [{"result": result, "ts": str(ts)}]}


def key(
    key_id: str = KEY_ID,
    *,
    exchange: str = "okx",
    is_active: bool = True,
    disconnected_at: str | None = None,
    sync_status: str = "idle",
    venue_account_id: str | None = "U1",
) -> dict[str, Any]:
    return {
        "id": key_id,
        "exchange": exchange,
        "is_active": is_active,
        "disconnected_at": disconnected_at,
        "sync_status": sync_status,
        "venue_account_id": venue_account_id,
        "last_429_at": None,
        "user_id": "user-1",
        # Encrypted slots exist on the row; the D-02 reads must never ask for them.
        "api_key_encrypted": "enc",
    }


def strategy(strategy_id: str = STRATEGY_ID, api_key_id: str = KEY_ID, *, status: str = "published") -> dict[str, Any]:
    return {"id": strategy_id, "api_key_id": api_key_id, "status": status}


def default_answers() -> dict[str, Any]:
    return {
        CONFIG: {
            "code": "0",
            "data": [{
                "uid": "U1", "perm": "read_only,trade", "acctLv": "2",
                "feeType": "0", "settleCcy": "USDT",
            }],
        },
        SUBTYPES: {"code": "0", "data": []},
        APPLY: apply_answer("true"),
        STATUS: lambda _inst, params: finished(params["year"], params["quarter"]),
    }


class FakeExchange:
    """Records every venue call by endpoint, in order, per instance."""

    def __init__(self, world: "World", index: int) -> None:
        self._world = world
        self.index = index
        self.calls: list[str] = []
        self.params: list[dict[str, str]] = []
        self.closed = False

    def __getattr__(self, name: str) -> Callable[..., Any]:
        if not name.startswith("private_"):
            raise AttributeError(name)

        async def _method(params: dict[str, str] | None = None) -> Any:
            self.calls.append(name)
            self.params.append(dict(params or {}))
            self._world.timeline.append((self.index, name))
            answer = self._world.answers[name]
            if callable(answer):
                answer = answer(self, params or {})
            return answer

        return _method

    async def close(self) -> None:
        self.closed = True


# ---------------------------------------------------------------------------
# The supabase fake
# ---------------------------------------------------------------------------

def _norm(value: Any) -> Any:
    """A comparable form: an ISO instant or date text becomes an aware datetime, everything else
    stays as it is. Only text with a dash and at least a date's length is tried."""
    if isinstance(value, str) and len(value) >= 10 and "-" in value:
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return value
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)
    return value


def _sort_key(value: Any) -> tuple[int, Any]:
    normalised = _norm(value)
    return (1, 0) if normalised is None else (0, normalised)


def _column(row: dict[str, Any], col: str) -> Any:
    """``metadata->>mode`` reads the key of a JSON column as text; anything else is the column."""
    if "->>" in col:
        base, path = col.split("->>", 1)
        holder = row.get(base)
        value = holder.get(path) if isinstance(holder, dict) else None
        return None if value is None else str(value)
    return row.get(col)


class Query:
    def __init__(self, db: "FakeSupabase", table: str) -> None:
        self._db, self._table = db, table
        self._cols = "*"
        self._eqs: list[tuple[str, Any]] = []
        self._in: tuple[str, list[Any]] | None = None
        self._cmp: list[tuple[str, str, Any]] = []
        self._order: list[tuple[str, bool]] = []
        self._limit: int | None = None
        self._range: tuple[int, int] | None = None
        self._single = False
        self._upsert: tuple[list[dict[str, Any]], dict[str, Any]] | None = None

    def select(self, cols: str) -> "Query":
        self._cols = cols
        return self

    def eq(self, col: str, val: Any) -> "Query":
        self._eqs.append((col, val))
        return self

    def in_(self, col: str, vals: Iterable[Any]) -> "Query":
        self._in = (col, list(vals))
        return self

    def gt(self, col: str, val: Any) -> "Query":
        self._cmp.append((col, "gt", val))
        return self

    def gte(self, col: str, val: Any) -> "Query":
        self._cmp.append((col, "gte", val))
        return self

    def lt(self, col: str, val: Any) -> "Query":
        self._cmp.append((col, "lt", val))
        return self

    def order(self, col: str, *, desc: bool = False) -> "Query":
        self._order.append((col, desc))
        return self

    def limit(self, n: int) -> "Query":
        self._limit = n
        return self

    def range(self, start: int, end: int) -> "Query":
        self._range = (start, end)
        return self

    def maybe_single(self) -> "Query":
        self._single = True
        return self

    def upsert(self, rows: list[dict[str, Any]], *, on_conflict: str, ignore_duplicates: bool = False) -> "Query":
        self._upsert = (list(rows), {"on_conflict": on_conflict, "ignore_duplicates": ignore_duplicates})
        return self

    def _project(self, row: dict[str, Any]) -> dict[str, Any]:
        if self._cols.strip() == "*":
            return dict(row)
        names = [c.strip().split("::")[0] for c in self._cols.split(",")]
        return {name: row.get(name) for name in names}

    def execute(self) -> Any:
        if self._upsert is not None:
            return self._db.apply_upsert(self._table, *self._upsert)
        self._db.reads.append((self._table, self._cols))
        found = [dict(r) for r in self._db.tables.get(self._table, [])]
        for col, val in self._eqs:
            found = [r for r in found if _column(r, col) == val]
        if self._in is not None:
            col, vals = self._in
            found = [r for r in found if r.get(col) in vals]
        for col, op, val in self._cmp:
            bound = _norm(val)
            keep = []
            for r in found:
                cell = _norm(_column(r, col))
                if cell is None:
                    continue
                if (op == "gt" and cell > bound) or (op == "gte" and cell >= bound) or (op == "lt" and cell < bound):
                    keep.append(r)
            found = keep
        for col, desc in reversed(self._order):
            found.sort(key=lambda r, c=col: _sort_key(_column(r, c)), reverse=desc)
        if self._range is not None:
            found = found[self._range[0]: self._range[1] + 1]
        if self._limit is not None:
            found = found[: self._limit]
        projected = [self._project(r) for r in found]
        if self._single:
            return SimpleNamespace(data=projected[0] if projected else None)
        return SimpleNamespace(data=projected)


class FakeSupabase:
    def __init__(self, tables: dict[str, list[dict[str, Any]]], world: "World") -> None:
        self.tables = tables
        self.reads: list[tuple[str, str]] = []
        self.rpcs: list[tuple[str, dict[str, Any]]] = []
        #: Every executed upsert: ``{"table", "rows", "on_conflict", "ignore_duplicates", "returned"}``.
        self.upserts: list[dict[str, Any]] = []
        self._world = world
        self.progress_returns: bool = True
        #: rpc name -> exception raised when it is executed (the call is still recorded).
        self.rpc_errors: dict[str, Exception] = {}
        #: Raised by the n-th upsert execute (1-based), once, to model a write that fails midway.
        self.upsert_errors: dict[int, Exception] = {}

    def table(self, name: str) -> Query:
        return Query(self, name)

    def rpc(self, name: str, params: dict[str, Any]) -> Any:
        self.rpcs.append((name, params))
        self._world.timeline.append(("rpc", name))
        data: Any = self.progress_returns if name == "set_compute_job_progress" else None

        def _execute() -> Any:
            if name in self.rpc_errors:
                raise self.rpc_errors[name]
            return SimpleNamespace(data=data)

        return SimpleNamespace(execute=_execute)

    def apply_upsert(
        self, table: str, rows: list[dict[str, Any]], options: dict[str, Any]
    ) -> Any:
        """Emulate ``trades_dedup_fill`` on (strategy_id, exchange, exchange_fill_id)."""
        call_no = len(self.upserts) + 1
        if call_no in self.upsert_errors:
            raise self.upsert_errors.pop(call_no)
        stored = self.tables.setdefault(table, [])
        ignore = bool(options["ignore_duplicates"])
        returned: list[dict[str, Any]] = []

        def _key_of(row: dict[str, Any]) -> tuple[Any, ...]:
            return (row.get("strategy_id"), row.get("exchange"), row.get("exchange_fill_id"))

        for row in rows:
            existing = next((r for r in stored if _key_of(r) == _key_of(row)), None)
            if existing is None:
                stored.append(dict(row))
                returned.append(dict(row))
            elif ignore:
                continue
            else:
                existing.update(row)
                returned.append(dict(row))
        self.upserts.append({"table": table, "rows": [dict(r) for r in rows], **options, "returned": returned})
        return SimpleNamespace(data=returned)

    def upserts_to(self, table: str) -> list[dict[str, Any]]:
        return [u for u in self.upserts if u["table"] == table]


# ---------------------------------------------------------------------------
# The world
# ---------------------------------------------------------------------------

class World:
    def __init__(self) -> None:
        self.answers: dict[str, Any] = default_answers()
        self.instances: list[FakeExchange] = []
        self.timeline: list[tuple[Any, str]] = []
        self.sleeps: list[float] = []
        self.decrypts = 0
        self.constructions = 0
        self.supabase: FakeSupabase | None = None
        #: Every link handed to the downloader, in order.
        self.downloads: list[str] = []
        #: Queue of exceptions the downloader raises (consumed one per call), then it serves.
        self.download_errors: list[Exception] = []
        #: ``"2026Q2"`` -> bytes served for the quarter the link names, instead of the fixture.
        self.csv_by_quarter: dict[str, bytes] = {}

    async def download(self, url: str) -> tuple[bytes, str, int]:
        """Stands in for ``okx_archive_download.download_archive_csv``: serves the fills fixture of
        the quarter the link names (or a per-quarter override), with fixed compressed sizes."""
        self.downloads.append(url)
        if self.download_errors:
            raise self.download_errors.pop(0)
        for tag, data in self.csv_by_quarter.items():
            if tag in url:
                return data, "zip", 1234
        if "2026Q2" in url:
            return FILLS_Q2_PATH.read_bytes(), "zip", 987
        if "2026Q3" in url:
            return FILLS_Q3_PATH.read_bytes(), "zip", 1234
        raise AssertionError("no fixture for the quarter this link names")

    def make(self, exchange_name: str, api_key: str, api_secret: str, passphrase: Any) -> FakeExchange:
        self.constructions += 1
        instance = FakeExchange(self, len(self.instances))
        self.instances.append(instance)
        return instance

    def decrypt(self, key_row: Any, kek: Any) -> tuple[str, str, str]:
        self.decrypts += 1
        return ("api-key", "api-secret", "passphrase")

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)

    @property
    def all_calls(self) -> list[str]:
        return [name for inst in self.instances for name in inst.calls]

    def calls_of(self, name: str) -> int:
        return self.all_calls.count(name)

    def progress_writes(self) -> list[dict[str, Any]]:
        assert self.supabase is not None
        return [p for n, p in self.supabase.rpcs if n == "set_compute_job_progress"]

    def result(self) -> dict[str, Any]:
        """The one result write of a run, with the claim fence on it."""
        writes = self.progress_writes()
        assert len(writes) == 1, f"expected exactly one result write, got {len(writes)}"
        assert writes[0]["p_claim_token"] == "tok-1", "the write must carry the claim token"
        assert writes[0]["p_job_id"] == "job-1"
        result: dict[str, Any] = writes[0]["p_progress"]
        return result

    def last_result(self) -> dict[str, Any]:
        writes = self.progress_writes()
        assert writes, "no result was written"
        result: dict[str, Any] = writes[-1]["p_progress"]
        return result

    def reclaim(self, job: dict[str, Any]) -> dict[str, Any]:
        """The job as the NEXT claim sees it: ``metadata.member_progress`` is the last progress
        write, which is what the claim row carries."""
        progress = self.last_result()
        metadata = {**job["metadata"], "member_progress": progress}
        return {**job, "metadata": metadata}


def install(
    monkeypatch: pytest.MonkeyPatch,
    *,
    keys: list[dict[str, Any]],
    strategies: list[dict[str, Any]],
    daily_returns: list[dict[str, Any]],
    trades: list[dict[str, Any]],
    compute_jobs: Iterable[dict[str, Any]] = (),
    now_ms: int,
    today: date,
) -> World:
    """Patch every seam in BOTH modules: ``_allocator_key_preflight`` lives in job_worker and reads
    its module globals; the fills module reads ``get_supabase``, ``_wall_ms`` and ``_utc_today`` as
    attributes of ``okx_archive_job`` at call time, so one patch reaches both. The same recorders sit
    behind every path, so "never invoked" covers either."""
    world = World()
    supabase = FakeSupabase(
        {
            "api_keys": [dict(k) for k in keys],
            "strategies": [dict(s) for s in strategies],
            "csv_daily_returns": [dict(r) for r in daily_returns],
            "trades": [dict(t) for t in trades],
            "compute_jobs": [dict(j) for j in compute_jobs],
        },
        world,
    )
    world.supabase = supabase
    for module in (job_worker, okx_archive_job):
        monkeypatch.setattr(module, "get_supabase", lambda: supabase)
        monkeypatch.setattr(module, "get_kek", lambda: b"kek")
        monkeypatch.setattr(module, "decrypt_credentials", world.decrypt)
        monkeypatch.setattr(module, "_make_exchange_client", world.make)
    monkeypatch.setattr(okx_archive_job, "_utc_today", lambda: today)
    monkeypatch.setattr(okx_archive_job, "_wall_ms", lambda: now_ms)
    monkeypatch.setattr(okx_archive_job, "download_archive_csv", world.download)
    monkeypatch.setattr(okx_archive_job, "_sleep", world.sleep)
    return world


def created_at(ms: int) -> str:
    """The ISO string PostgREST returns for ``compute_jobs.created_at``."""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def job(
    metadata: dict[str, Any] | None = None,
    *,
    api_key_id: str | None = KEY_ID,
    created_at_ms: int = REQUEST_TS_MS,
) -> dict[str, Any]:
    """A claimed row. ``metadata`` is exactly what the caller passes (the fills modes derive
    targets and quarters in-claim), so a test names the mode itself."""
    return {
        "id": "job-1",
        "kind": "okx_archive_rebuild",
        "api_key_id": api_key_id,
        "strategy_id": None,
        "claim_token": "tok-1",
        "metadata": dict(metadata or {}),
        "attempts": 1,
        "max_attempts": 3,
        "created_at": created_at(created_at_ms),
    }
