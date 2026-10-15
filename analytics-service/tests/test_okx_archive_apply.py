"""Phase 167.1.2.2.2.1 plan 08: calibrate evaluates, apply writes only what was approved.

What these tests protect, in one paragraph (Rule 9): a founder reviews ONE preview (the
calibrate result and its fingerprint) and a later apply must write exactly that and nothing
else. The archive file has no checksum, so the only content authentication it gets is the
reconciliation against the live endpoints to the cent (D-09, D-10); when it disagrees
the job must write NOTHING for ANY target (D-11), because the targets share one ledger. A
stored 0.0 day that the archive shows P&L on is a finding for the founder, never a rewrite
(D-03). Every write goes through ONE atomic RPC per target, and because each call commits on
its own, a failure after the first commit must neither block the rest nor be reported as
"nothing written".

The live side is a set of fakes for the very functions the live derive calls (equity, the
full realized history, OKX funding, ccxt transfers), and the database is a STATEFUL fake that
models ``apply_okx_archive_rebuild`` as its migration defines it, so a resumed run sees the
rows and narrowed gaps the earlier run committed. Oracles are independent literals worked by
hand from the NAV roll (``nav[t-1] = nav[t] - pnl[t] - flow[t]``), not outputs of the code
under test.
"""
from __future__ import annotations

import copy
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, Callable

import httpx
import pytest

from services import job_worker, okx_archive_job
from services.job_worker import DispatchOutcome, dispatch
from tests.test_okx_archive_job import (
    KEY_ID,
    OTHER_KEY_ID,
    STRATEGY_2_ID,
    STRATEGY_ID,
    _install as _install_base,
    _job,
    _World,
)

#: Captured at import (collection), before any test patches the module: the base harness
#: installs a no-op for the evaluation seam, and these tests need the real one back.
REAL_RUN_EVALUATION = okx_archive_job._run_evaluation

SRC = "okx_bills_history_archive"
APPLY_RPC = "apply_okx_archive_rebuild"
PROGRESS = "set_compute_job_progress"
HEX64 = re.compile(r"[0-9a-f]{64}")
NOW = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)

CSV_HEADER = (
    "instType,billId,subType,ts,balChg,posBalChg,bal,posBal,sz,px,ccy,pnl,fee,mgnMode,"
    "instId,ordId,execType,interest,tag,fillTime,tradeId,clOrdId,fillIdxPx,fillMarkPx,"
    "fillPxVol,fillPxUsd,fillMarkVol,fillFwdPx"
)


# ---------------------------------------------------------------------------
# The archive file: built from per-day nets, so the oracle is the dict that built it
# ---------------------------------------------------------------------------

def _noon_ms(day: str) -> int:
    y, m, d = (int(p) for p in day.split("-"))
    return int(datetime(y, m, d, 12, tzinfo=timezone.utc).timestamp() * 1000)


def _fmt(value: str | Decimal | float) -> str:
    return format(Decimal(str(value)), "f")


class _Bills:
    """One archive CSV. ``realized`` rows carry a quarter-dollar fee so a day's net is
    ``pnl + fee`` (the live aggregation), funding rows are subType 173/174, flows 11/12."""

    def __init__(self) -> None:
        self._lines: list[str] = []
        self._n = 800_000_000

    def _row(
        self, inst: str, sub: str, day: str, bal_chg: str, ccy: str, pnl: str, fee: str,
    ) -> "_Bills":
        self._n += 1
        self._lines.append(
            f"{inst},{self._n},{sub},{_noon_ms(day)},{bal_chg},0,5000,0,,,{ccy},{pnl},{fee},"
            "cross,BTC-USDT-SWAP,,,,,,,,,,,,,"
        )
        return self

    def realized(self, day: str, net: str | float, *, inst: str = "SWAP", ccy: str = "USDT") -> "_Bills":
        fee = Decimal("-0.25")
        pnl = Decimal(str(net)) - fee
        return self._row(inst, "2", day, _fmt(net), ccy, _fmt(pnl), _fmt(fee))

    def funding(self, day: str, amount: str | float) -> "_Bills":
        sub = "174" if Decimal(str(amount)) >= 0 else "173"
        return self._row("SWAP", sub, day, _fmt(amount), "USDT", _fmt(amount), "0")

    def flow(self, day: str, amount: str | float) -> "_Bills":
        sub = "11" if Decimal(str(amount)) >= 0 else "12"
        return self._row("", sub, day, _fmt(amount), "USDT", "0", "0")

    def raw(self, line_fn: Callable[[int], str]) -> "_Bills":
        self._n += 1
        self._lines.append(line_fn(self._n))
        return self

    def bytes(self) -> bytes:
        return ("\n".join([CSV_HEADER, *self._lines]) + "\n").encode()


# ---------------------------------------------------------------------------
# The live side: fakes for exactly the functions the live derive calls
# ---------------------------------------------------------------------------

@dataclass
class _Live:
    equity: float | None = 10000.0
    upl: float = 0.0
    balance_error: bool = False
    upnl_unreadable: bool = False
    realized: dict[str, float] = field(default_factory=dict)
    funding: dict[str, float] = field(default_factory=dict)
    transfers: list[dict[str, Any]] = field(default_factory=list)
    calls: list[tuple[str, Any]] = field(default_factory=list)


def _records(realized: dict[str, float]) -> list[dict[str, Any]]:
    return [
        {
            "exchange": "okx", "symbol": "PORTFOLIO",
            "side": "buy" if amount >= 0 else "sell", "price": abs(amount),
            "quantity": 1, "fee": 0, "fee_currency": "USDT",
            "timestamp": f"{day}T00:00:00+00:00", "order_type": "daily_pnl",
        }
        for day, amount in sorted(realized.items())
    ]


def _funding_rows(funding: dict[str, float]) -> list[dict[str, Any]]:
    out = []
    for day, amount in sorted(funding.items()):
        y, m, d = (int(p) for p in day.split("-"))
        out.append({"timestamp": datetime(y, m, d, 8, tzinfo=timezone.utc), "amount": Decimal(str(amount))})
    return out


# ---------------------------------------------------------------------------
# The database: stateful, and the RPC is a model of the migration's contract
# ---------------------------------------------------------------------------

class _PgError(Exception):
    """What postgrest-py raises for a refused RPC: the SQLSTATE rides on ``.code``."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _daterange(first: str, last: str) -> list[str]:
    a, b = date.fromisoformat(first), date.fromisoformat(last)
    return [(a + timedelta(days=i)).isoformat() for i in range((b - a).days + 1)]


def _islands(days: list[str]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for d in sorted(days):
        if out and date.fromisoformat(d) - date.fromisoformat(out[-1][1]) == timedelta(days=1):
            out[-1] = (out[-1][0], d)
        else:
            out.append((d, d))
    return out


def _norm(gaps: list[dict[str, Any]]) -> list[dict[str, str]]:
    return sorted(({"from": g["from"], "to": g["to"]} for g in gaps), key=lambda g: (g["from"], g["to"]))


class _Q:
    """A PostgREST-shaped read: the filters the module uses, a write spy for the rest."""

    def __init__(self, db: "_Db", table: str) -> None:
        self._db, self._table = db, table
        self._cols = "*"
        self._preds: list[Callable[[dict[str, Any]], bool]] = []
        self._order: tuple[str, bool] | None = None
        self._limit: int | None = None
        self._single = False

    def select(self, cols: str) -> "_Q":
        self._cols = cols
        return self

    def eq(self, col: str, val: Any) -> "_Q":
        self._preds.append(lambda r: r.get(col) == val)
        return self

    def in_(self, col: str, vals: list[Any]) -> "_Q":
        wanted = list(vals)
        self._preds.append(lambda r: r.get(col) in wanted)
        return self

    def gte(self, col: str, val: Any) -> "_Q":
        self._preds.append(lambda r: r.get(col) is not None and str(r[col]) >= str(val))
        return self

    def lte(self, col: str, val: Any) -> "_Q":
        self._preds.append(lambda r: r.get(col) is not None and str(r[col]) <= str(val))
        return self

    def gt(self, col: str, val: Any) -> "_Q":
        self._preds.append(lambda r: r.get(col) is not None and str(r[col]) > str(val))
        return self

    def order(self, col: str, desc: bool = False) -> "_Q":
        self._order = (col, desc)
        return self

    def limit(self, n: int) -> "_Q":
        self._limit = n
        return self

    def maybe_single(self) -> "_Q":
        self._single = True
        return self

    def _write(self, op: str) -> "_Q":
        self._db.table_writes.append((self._table, op))
        return self

    def insert(self, *_a: Any, **_k: Any) -> "_Q":
        return self._write("insert")

    def update(self, *_a: Any, **_k: Any) -> "_Q":
        return self._write("update")

    def upsert(self, *_a: Any, **_k: Any) -> "_Q":
        return self._write("upsert")

    def delete(self, *_a: Any, **_k: Any) -> "_Q":
        return self._write("delete")

    def execute(self) -> Any:
        self._db.reads.append((self._table, self._cols))
        found = [r for r in self._db.tables.get(self._table, []) if all(p(r) for p in self._preds)]
        if self._order is not None:
            col, desc = self._order
            found.sort(key=lambda r: str(r.get(col)), reverse=desc)
        if self._limit is not None:
            found = found[: self._limit]
        found = copy.deepcopy(found)
        if self._single:
            return SimpleNamespace(data=found[0] if found else None)
        return SimpleNamespace(data=found)


class _Db:
    """Persists ``csv_daily_returns`` and ``strategy_analytics`` across runs (a new ``_Db``
    per test, the SAME one across the runs of a resume test)."""

    def __init__(self) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {
            "api_keys": [], "strategies": [], "csv_daily_returns": [], "strategy_analytics": [],
        }
        self.reset_recorders()
        self.progress_returns = True
        # self.apply_faults: n-th apply call (1-based) -> ("before" | "after", exception).
        # "before": raised with nothing committed. "after": the call COMMITTED and the
        # response was lost. self.apply_answers: n-th apply call -> a canned answer instead
        # of the model (e.g. a race). Both are set in reset_recorders().
        self.world: _World | None = None

    def reset_recorders(self) -> None:
        self.rpcs: list[tuple[str, dict[str, Any]]] = []
        self.reads: list[tuple[str, str]] = []
        self.table_writes: list[tuple[str, str]] = []
        self.apply_calls = 0
        self.rpc_errors: dict[str, Exception] = {}
        #: Faults and canned answers belong to ONE run: a resume test sets them after
        #: `_install`, and the next run must start without them.
        self.apply_faults: dict[int, tuple[str, Exception]] = {}
        self.apply_answers: dict[int, dict[str, Any]] = {}

    # -- the supabase surface the module uses ------------------------------------------
    def table(self, name: str) -> _Q:
        return _Q(self, name)

    def rpc(self, name: str, params: dict[str, Any]) -> Any:
        self.rpcs.append((name, params))
        assert self.world is not None
        self.world.timeline.append(("rpc", name))

        def _execute() -> Any:
            if name in self.rpc_errors:
                raise self.rpc_errors[name]
            if name == APPLY_RPC:
                return SimpleNamespace(data=self._apply(params))
            return SimpleNamespace(data=self.progress_returns if name == PROGRESS else None)

        return SimpleNamespace(execute=_execute)

    # -- state helpers -----------------------------------------------------------------
    def csv_days(self, strategy_id: str) -> dict[str, float]:
        return {r["date"]: r["daily_return"] for r in self.tables["csv_daily_returns"]
                if r["strategy_id"] == strategy_id}

    def provenance(self, strategy_id: str) -> dict[str, Any]:
        row = next(r for r in self.tables["strategy_analytics"] if r["strategy_id"] == strategy_id)
        return copy.deepcopy(row["series_provenance"])

    def snapshot(self) -> tuple[Any, Any]:
        return copy.deepcopy(self.tables["csv_daily_returns"]), copy.deepcopy(self.tables["strategy_analytics"])

    # -- apply_okx_archive_rebuild, as the migration defines it -------------------------
    def _apply(self, p: dict[str, Any]) -> dict[str, Any]:
        self.apply_calls += 1
        fault = self.apply_faults.get(self.apply_calls)
        if fault is not None and fault[0] == "before":
            raise fault[1]
        if self.apply_calls in self.apply_answers:
            return self.apply_answers[self.apply_calls]
        answer = self._model(p)
        if fault is not None and fault[0] == "after":
            raise fault[1]
        return answer

    def _model(self, p: dict[str, Any]) -> dict[str, Any]:
        sid, rows_in = p["p_strategy_id"], p["p_rows"]
        if not rows_in:
            raise _PgError("22023", "apply_okx_archive_rebuild: p_rows must carry 1..1000 rows (got 0)")
        sa = next((r for r in self.tables["strategy_analytics"] if r["strategy_id"] == sid), None)
        if sa is None:
            raise _PgError("22023", "apply_okx_archive_rebuild: no strategy_analytics row exists")
        sp = sa.get("series_provenance") or {}
        stored_raw = list(sp.get("unrecovered_gaps") or [])
        stored = _norm(stored_raw)
        ranges = list(sp.get("reconstructed_ranges") or [])
        have = set(self.csv_days(sid))

        def in_ranges(d: str) -> bool:
            return any(r.get("source") == SRC and r["from"] <= d <= r["to"] for r in ranges)

        if all(r["date"] in have and in_ranges(r["date"]) for r in rows_in):
            return {"status": "already_applied", "inserted": 0, "ranges_added": 0,
                    "gaps_before": stored, "gaps_after": stored}
        if stored != _norm(p["p_expected_gaps"]):
            raise _PgError("P0001", "apply_okx_archive_rebuild: gaps_changed")
        for r in rows_in:
            if not any(g["from"] <= r["date"] <= g["to"] for g in stored):
                raise _PgError("22023", "apply_okx_archive_rebuild: row_outside_gap")
        inserted = sorted(r["date"] for r in rows_in if r["date"] not in have)
        have_after = have | set(inserted)
        new_raw: list[dict[str, Any]] = []
        for g in stored_raw:
            left = [d for d in _daterange(g["from"], g["to"]) if d not in have_after]
            for f, t in _islands(left):
                new_raw.append({"from": f, "to": t, "recorded_at": g.get("recorded_at")})
        if _norm(new_raw) != _norm(p["p_expected_gaps_after"]):
            raise _PgError("P0001", "apply_okx_archive_rebuild: gaps_after_mismatch")
        for r in rows_in:
            if r["date"] in inserted:
                self.tables["csv_daily_returns"].append(
                    {"strategy_id": sid, "date": r["date"], "daily_return": r["daily_return"]}
                )
        added = [{"from": f, "to": t, "source": SRC, "recorded_at": "2026-10-15T00:00:00Z"}
                 for f, t in _islands(inserted)]
        sp2 = dict(sp)
        sp2["unrecovered_gaps"] = new_raw
        if added:
            sp2["reconstructed_ranges"] = ranges + added
        sa["series_provenance"] = sp2
        return {"status": "applied", "inserted": len(inserted), "ranges_added": len(added),
                "gaps_before": stored, "gaps_after": _norm(new_raw)}


# ---------------------------------------------------------------------------
# The world
# ---------------------------------------------------------------------------

GAP_A = [{"from": "2026-07-10", "to": "2026-08-01", "recorded_at": "2026-10-10T00:00:00Z"}]
GAP_B = [{"from": "2026-07-12", "to": "2026-07-25", "recorded_at": "2026-10-10T00:00:00Z"}]


def _db_with(*targets: tuple[str, list[dict[str, Any]] | None], csv: list[dict[str, Any]] | None = None) -> _Db:
    db = _Db()
    for strategy_id, gaps in targets:
        provenance: dict[str, Any] = {"legacy_ranges": [{"from": "2026-02-23", "to": "2026-05-06"}]}
        if gaps is not None:
            provenance["unrecovered_gaps"] = copy.deepcopy(gaps)
        db.tables["strategy_analytics"].append({"strategy_id": strategy_id, "series_provenance": provenance})
    db.tables["csv_daily_returns"].extend(csv or [])
    return db


def _csv_row(strategy_id: str, day: str, value: float) -> dict[str, Any]:
    return {"strategy_id": strategy_id, "date": day, "daily_return": value}


def _install(
    monkeypatch: pytest.MonkeyPatch,
    db: _Db,
    live: _Live,
    *,
    q3: bytes | None = None,
    q2: bytes | None = None,
    targets: tuple[str, ...] = (STRATEGY_ID,),
) -> _World:
    world = _install_base(monkeypatch, targets=[(sid, _key_for_targets()) for sid in targets])
    base = world.supabase
    assert base is not None
    db.reset_recorders()
    db.tables["api_keys"] = base.tables["api_keys"]
    db.tables["strategies"] = base.tables["strategies"]
    db.world = world
    world.supabase = db  # type: ignore[assignment]
    for module in (job_worker, okx_archive_job):
        monkeypatch.setattr(module, "get_supabase", lambda: db)
    monkeypatch.setattr(okx_archive_job, "_run_evaluation", REAL_RUN_EVALUATION)
    monkeypatch.setattr(okx_archive_job, "_utc_now", lambda: NOW)

    async def _download(url: str) -> tuple[bytes, str, int]:
        world.downloads.append(url)
        blob = q2 if "2026Q2" in url else q3
        assert blob is not None, f"no file was prepared for {url}"
        return blob, "zip", 1234

    async def _equity(exchange: Any, venue: str) -> tuple[float | None, bool, float, bool]:
        live.calls.append(("equity", venue))
        return live.equity, live.balance_error, live.upl, live.upnl_unreadable

    async def _trades(exchange: Any, symbol: Any = None, since_ms: Any = None) -> list[dict[str, Any]]:
        live.calls.append(("trades", since_ms))
        return _records(live.realized)

    async def _funding(exchange: Any, label: str, since_ms: Any) -> list[dict[str, Any]]:
        live.calls.append(("funding", since_ms))
        return _funding_rows(live.funding)

    async def _transfers(exchange: Any, kind: str, since_ms: int, now_ms: int) -> list[dict[str, Any]]:
        live.calls.append((kind, since_ms))
        return [t for t in live.transfers if t["type"] == kind[:-1]]

    async def _price_index(exchange: Any, venue: str, supabase: Any, rows: Any) -> dict[Any, float]:
        return {}

    monkeypatch.setattr(okx_archive_job, "download_archive_csv", _download)
    monkeypatch.setattr(okx_archive_job, "fetch_account_equity_and_upnl_usd", _equity)
    monkeypatch.setattr(okx_archive_job, "fetch_all_trades", _trades)
    monkeypatch.setattr(okx_archive_job, "fetch_funding_okx", _funding)
    monkeypatch.setattr(okx_archive_job, "fetch_ccxt_transfers", _transfers)
    monkeypatch.setattr(okx_archive_job, "_resolve_ccxt_flow_price_index", _price_index)
    return world


def _key_for_targets() -> dict[str, Any]:
    from tests.test_okx_archive_job import _key

    return _key(OTHER_KEY_ID)


def _meta(mode: str, rebuild: list[str], **extra: Any) -> dict[str, Any]:
    return {"mode": mode, "rebuild_strategy_ids": rebuild, **extra}


async def _run(metadata: dict[str, Any]) -> job_worker.DispatchResult:
    return await dispatch(_job(metadata))


def _no_writes_but_progress(world: _World, db: _Db) -> None:
    """The write spy: not one table write, and no RPC other than the one result write."""
    assert db.table_writes == [], f"a table was written: {db.table_writes}"
    names = [n for n, _ in db.rpcs]
    assert set(names) <= {PROGRESS}, f"an RPC other than the progress write was called: {names}"


def _apply_calls(db: _Db) -> list[dict[str, Any]]:
    return [p for n, p in db.rpcs if n == APPLY_RPC]


# ---------------------------------------------------------------------------
# The standard scenario: a Q3 file that agrees with the live side to the cent
# ---------------------------------------------------------------------------
#
# Live: 08-02 +100 (the reach boundary day), 08-03 -50, 09-15 +20 and funding +1.5 that day.
# Equity 10000, no open uPnL, no flows. Archive (Q3, all 92 days covered):
#   gap period: 07-10 +10, 07-20 funding -2, 08-01 +200 (the rest are real quiet zeros)
#   08-02 +97.5 (differs from live 100 on purpose: the boundary day is partial and is NOT
#   compared), and 08-03 / 09-15 equal to live.
#
# NAV roll worked by hand, nav_end(t-1) = nav_end(t) - pnl(t):
#   nav_end(09-15) = 10000;  nav_end(09-14) = 10000 - 21.5 = 9978.5   (= nav_end(08-03))
#   nav_end(08-02) = 9978.5 + 50  = 10028.5;  nav_end(08-01) = 10028.5 - 100 = 9928.5
#   nav_end(07-31) = 9928.5 - 200 = 9728.5     (= nav_end(07-20))
#   nav_end(07-19) = 9728.5 + 2   = 9730.5     (= nav_end(07-10))
#   nav_end(07-09) = 9730.5 - 10  = 9720.5
# so the rebuilt returns are 07-10: 10/9720.5, 07-20: -2/9730.5, 08-01: 200/9728.5, and 0.0
# on the other twenty covered days.

LIVE_REALIZED = {"2026-08-02": 100.0, "2026-08-03": -50.0, "2026-09-15": 20.0}
LIVE_FUNDING = {"2026-09-15": 1.5}
GAP_DAY_COUNT = 23  # 2026-07-10 .. 2026-08-01 inclusive: 22 July days + 1 August day
ORACLE = {
    "2026-07-10": 10 / 9720.5,
    "2026-07-20": -2 / 9730.5,
    "2026-08-01": 200 / 9728.5,
}


def _standard_live() -> _Live:
    return _Live(realized=dict(LIVE_REALIZED), funding=dict(LIVE_FUNDING))


def _standard_q3(**overrides: Any) -> bytes:
    realized = {"2026-07-10": "10", "2026-08-01": "200", "2026-08-02": "97.5",
                "2026-08-03": "-50", "2026-09-15": "20"}
    realized.update(overrides.get("realized", {}))
    funding = {"2026-07-20": "-2", "2026-09-15": "1.5"}
    funding.update(overrides.get("funding", {}))
    bills = _Bills()
    for day, net in sorted(realized.items()):
        bills.realized(day, net)
    for day, amount in sorted(funding.items()):
        bills.funding(day, amount)
    for day, amount in sorted(overrides.get("flows", {}).items()):
        bills.flow(day, amount)
    return bills.bytes()


def _standard(monkeypatch: pytest.MonkeyPatch) -> tuple[_World, _Db, _Live]:
    db = _db_with((STRATEGY_ID, GAP_A))
    live = _standard_live()
    world = _install(monkeypatch, db, live, q3=_standard_q3())
    return world, db, live


async def _calibrate_fingerprint(
    monkeypatch: pytest.MonkeyPatch, q3: bytes | None = None, live: _Live | None = None,
    db: _Db | None = None,
) -> str:
    """One clean calibrate over the standard scenario (optionally edited), its fingerprint."""
    db = db if db is not None else _db_with((STRATEGY_ID, GAP_A))
    world = _install(monkeypatch, db, live or _standard_live(), q3=q3 or _standard_q3())
    outcome = await _run(_meta("calibrate", [STRATEGY_ID]))
    assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
    fingerprint: str = world.result()["fingerprint"]
    return fingerprint


# ---------------------------------------------------------------------------
# Task 1: the tracer
# ---------------------------------------------------------------------------

class TestTracerCalibrate:
    @pytest.mark.asyncio
    async def test_calibrate_evaluates_a_quarter_end_to_end_and_writes_nothing_but_its_result(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The founder reviews the calibrate preview and approves a fingerprint; the preview
        must come from the real code path (live crawl, reconciliation, rebuild) and must
        itself write NOTHING: one table write or one RPC besides the result write would mean
        the review step changes what it is reviewing."""
        world, db, live = _standard(monkeypatch)
        db.tables["csv_daily_returns"].extend([
            _csv_row(STRATEGY_ID, "2026-08-03", -50 / 10028.5),
            _csv_row(STRATEGY_ID, "2026-09-15", 21.5 / 9978.5),
        ])

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE and outcome.error_message is None
        # The write spy first: calibrate calls no RPC but the result write, writes no table.
        assert db.apply_calls == 0, "calibrate reached apply_okx_archive_rebuild"
        _no_writes_but_progress(world, db)
        result = world.result()
        assert result["stop_class"] is None and result["mode"] == "calibrate"
        reconcile = result["reconcile"]
        # Q3 ended 09-30; today (the seam) is 10-15; the live realized reach starts 08-02, a
        # partial day, so the first full day is 08-03: 29 August days + 30 September days.
        assert reconcile["window"] == {"from": "2026-08-03", "to": "2026-09-30"}
        assert reconcile["excluded_boundary_day"] == "2026-08-02"
        for leg in ("realized", "funding"):
            assert reconcile[leg]["ok"] is True
            assert reconcile[leg]["days_compared"] == 59
            assert reconcile[leg]["days_over_cent"] == 0
            assert reconcile[leg]["first_offending"] == [] and reconcile[leg]["misses"] == []
        assert reconcile["realized"]["window_total_diff"] == "0"
        (strategy,) = result["strategies"]
        assert strategy["position"] == 0 and "strategy_id" not in strategy
        assert strategy["insert_days"] == GAP_DAY_COUNT
        assert strategy["insert_ranges"] == [{"from": "2026-07-10", "to": "2026-08-01"}]
        assert strategy["gaps_before"] == [{"from": "2026-07-10", "to": "2026-08-01"}]
        assert strategy["gaps_after"] == []
        assert strategy["rpc"] is None
        assert HEX64.fullmatch(result["fingerprint"])
        # The live side is crawled FRESH and over the FULL history, like the derive.
        assert ("trades", None) in live.calls and ("funding", None) in live.calls

    @pytest.mark.asyncio
    async def test_the_same_inputs_give_the_same_fingerprint_and_one_cent_on_one_day_changes_it(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The fingerprint is what the founder approves. It must be stable across two runs
        over the same file (or apply could never match a calibrate), and it must move when a
        single archive day moves by one cent, or an edited file could ride an old approval.
        The edited day (07-10) is outside the overlap window, so reconciliation stays clean
        and the only thing that can notice is the fingerprint."""
        first = await _calibrate_fingerprint(monkeypatch)
        second = await _calibrate_fingerprint(monkeypatch)
        edited = await _calibrate_fingerprint(
            monkeypatch, q3=_standard_q3(realized={"2026-07-10": "10.01"})
        )

        assert first == second
        assert edited != first
        assert HEX64.fullmatch(edited)
