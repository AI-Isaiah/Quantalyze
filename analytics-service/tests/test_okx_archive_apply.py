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

import asyncio
import copy
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

import httpx
import pytest

from services import exchange as exchange_module
from services import job_worker, okx_archive_job
from services.job_worker import DispatchOutcome, dispatch
from tests.test_okx_archive_job import (
    KEY_ID,
    LINK_SECRETS,
    OTHER_KEY_ID,
    STRATEGY_2_ID,
    STRATEGY_ID,
    _install as _install_base,
    _job,
    _link,
    _World,
)

#: Captured at import (collection), before any test patches the module: the base harness
#: installs a no-op for the evaluation seam, and these tests need the real one back.
REAL_RUN_EVALUATION = okx_archive_job._run_evaluation

SRC = "okx_bills_history_archive"
APPLY_RPC = "apply_okx_archive_rebuild"
PROGRESS = "set_compute_job_progress"
HEX64 = re.compile(r"[0-9a-f]{64}")
#: The job's clock. The live bills-archive reach is ASSUMED to be ``LIVE_REACH_ASSUMED_DAYS`` (88)
#: days: 2026-10-29 minus 88 days is 2026-08-02, so 08-02 is the reach BOUNDARY day (partial by
#: construction, owned by the archive) and 08-03 is the first full live day. The standard
#: scenario below is built around exactly that shape.
NOW = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)

CSV_HEADER = (
    "instType,billId,subType,ts,balChg,posBalChg,bal,posBal,sz,px,ccy,pnl,fee,mgnMode,"
    "instId,ordId,execType,interest,tag,fillTime,tradeId,clOrdId,fillIdxPx,fillMarkPx,"
    "fillPxVol,fillPxUsd,fillMarkVol,fillFwdPx"
)


# ---------------------------------------------------------------------------
# The archive file: built from per-day nets, so the oracle is the dict that built it
# ---------------------------------------------------------------------------

def _ms_at(day: str, hour: int) -> int:
    """The epoch milliseconds of ``hour`` o'clock UTC on ``day``."""
    y, m, d = (int(p) for p in day.split("-"))
    return int(datetime(y, m, d, hour, tzinfo=timezone.utc).timestamp() * 1000)


def _noon_ms(day: str) -> int:
    return _ms_at(day, 12)


def _fmt(value: str | Decimal | float) -> str:
    return format(Decimal(str(value)), "f")


class _Bills:
    """One archive CSV. ``realized`` rows carry a quarter-dollar fee so a day's net is
    ``pnl + fee`` (the live aggregation), funding rows are subType 173/174, flows 11/12."""

    def __init__(self, *, opening: str | Decimal = "5000", first_id: int = 800_000_000) -> None:
        self._lines: list[str] = []
        self._n = first_id
        self._opening = Decimal(str(opening))
        #: The running balance per ccy, in billId (= insertion) order. OKX's ``bal`` is the
        #: balance AFTER each bill, so a file built here chains (``bal == previous bal +
        #: balChg``) exactly as a complete real file does; ``without()`` then removes a row to
        #: model an incomplete one.
        self._bal: dict[str, Decimal] = {}

    def _row(
        self, inst: str, sub: str, day: str, bal_chg: str, ccy: str, pnl: str, fee: str,
        *, hour: int = 12,
    ) -> "_Bills":
        self._n += 1
        bal = self._bal.get(ccy, self._opening) + Decimal(bal_chg)
        self._bal[ccy] = bal
        self._lines.append(
            f"{inst},{self._n},{sub},{_ms_at(day, hour)},{bal_chg},0,{_fmt(bal)},0,,,{ccy},{pnl},{fee},"
            "cross,BTC-USDT-SWAP,,,,,,,,,,,,,"
        )
        return self

    def without(self, position: int) -> "_Bills":
        """A copy of this file with the ``position``-th data row (0-based) removed."""
        out = _Bills(opening=self._opening)
        out._lines = [ln for i, ln in enumerate(self._lines) if i != position]
        out._n, out._bal = self._n, dict(self._bal)
        return out

    def closing(self, ccy: str = "USDT") -> Decimal:
        """The balance after this file's last bill: the next quarter's opening."""
        return self._bal.get(ccy, self._opening)

    def realized(
        self, day: str, net: str | float, *, inst: str = "SWAP", ccy: str = "USDT", hour: int = 12,
    ) -> "_Bills":
        fee = Decimal("-0.25")
        pnl = Decimal(str(net)) - fee
        return self._row(inst, "2", day, _fmt(net), ccy, _fmt(pnl), _fmt(fee), hour=hour)

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
    #: What ``fetch_daily_pnl`` leaves in the per-task DQ buffer when the crawl swallowed an
    #: error or hit a page cap: ``{"daily_pnl_fetch_error": True, ...}``.
    dq_flags: dict[str, Any] = field(default_factory=dict)


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
        # The real fetch_daily_pnl resets the buffer at entry and records its flags here, on the
        # asyncio task the job later reads them on.
        exchange_module._LAST_DQ_FLAGS.set({})
        for key, value in live.dq_flags.items():
            exchange_module._record_dq_flag(key, value)
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
# Live: 08-02 +100 (the reach BOUNDARY day, partial: the crawl caught only part of it),
# 08-03 -50, 09-15 +20 and funding +1.5 that day. Equity 10000, no open uPnL, no flows.
# Archive (Q3 alone: the 91 whole UTC days 07-01..09-29; 06-30 and 09-30 are quarter-edge days with
# no daily total without Q2 and Q4, D-15):
#   gap period: 07-10 +10, 07-20 funding -2, 08-01 +200 (the rest are real quiet zeros)
#   08-02 +97.5: the WHOLE day. It differs from the live partial 100 on purpose. The boundary
#   day is not compared, and (CR-01) the archive owns it: the NAV roll must use 97.5, not 100.
#   08-03 / 09-15 equal to live.
#
# NAV roll worked by hand, nav_end(t-1) = nav_end(t) - pnl(t), the archive's 97.5 on 08-02:
#   nav_end(09-15) = 10000;  nav_end(09-14) = 10000 - 21.5 = 9978.5   (= nav_end(08-03))
#   nav_end(08-02) = 9978.5 + 50  = 10028.5;  nav_end(08-01) = 10028.5 - 97.5 = 9931.0
#   nav_end(07-31) = 9931.0 - 200 = 9731.0     (= nav_end(07-20))
#   nav_end(07-19) = 9731.0 + 2   = 9733.0     (= nav_end(07-10))
#   nav_end(07-09) = 9733.0 - 10  = 9723.0
# so the rebuilt returns are 07-10: 10/9723.0, 07-20: -2/9733.0, 08-01: 200/9731.0, and 0.0
# on the other twenty covered days. (Rolling through the live PARTIAL 100 instead of 97.5
# would give 9720.5 / 9730.5 / 9728.5: the old, skewed oracle.)

#: Four small days that net to ZERO (+0.02 -0.02 +0.03 -0.03), the same on both sides. They exist
#: because the reconciliation needs evidence (F3: at least ``MIN_ACTIVE_DAYS`` days on which
#: either side carries a value), and they do not move the hand roll above: a backward roll
#: only sees the SUM of the P&L after a day, and these cancel.
FILLER = {"2026-08-05": "0.02", "2026-08-06": "-0.02", "2026-08-07": "0.03", "2026-08-08": "-0.03"}
LIVE_REALIZED = {
    "2026-08-02": 100.0, "2026-08-03": -50.0, "2026-09-15": 20.0,
    **{day: float(net) for day, net in FILLER.items()},
}
LIVE_FUNDING = {"2026-09-15": 1.5}
GAP_DAY_COUNT = 23  # 2026-07-10 .. 2026-08-01 inclusive: 22 July days + 1 August day
ORACLE = {
    "2026-07-10": 10 / 9723.0,
    "2026-07-20": -2 / 9733.0,
    "2026-08-01": 200 / 9731.0,
}


def _standard_live() -> _Live:
    return _Live(realized=dict(LIVE_REALIZED), funding=dict(LIVE_FUNDING))


def _standard_q3(**overrides: Any) -> bytes:
    realized = {"2026-07-10": "10", "2026-08-01": "200", "2026-08-02": "97.5",
                "2026-08-03": "-50", "2026-09-15": "20", **FILLER}
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
        # Q3 alone covers 07-01..09-29 whole (09-30 is a quarter-edge day only Q4 could make
        # whole, D-15); the live realized reach starts 08-02, a partial day, so the first full
        # day is 08-03: 29 August days + 29 September days.
        assert reconcile["window"] == {"from": "2026-08-03", "to": "2026-09-29"}
        assert reconcile["excluded_boundary_day"] == "2026-08-02"
        for leg in ("realized", "funding"):
            assert reconcile[leg]["ok"] is True
            assert reconcile[leg]["days_compared"] == 58
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


# ---------------------------------------------------------------------------
# Task 2
# ---------------------------------------------------------------------------

class TestAbortOnReconcileMiss:
    @pytest.mark.parametrize("mode", ["calibrate", "apply"])
    @pytest.mark.asyncio
    async def test_T_ABORT_1_a_realized_day_off_by_0_011_aborts_every_target_and_writes_nothing(
        self, monkeypatch: pytest.MonkeyPatch, mode: str
    ) -> None:
        """D-11. Both targets share one ledger, so a day on which the archive and the live
        side disagree by MORE than a cent (0.011 here) means the archive cannot be trusted
        for either of them. Nothing may be written for ANY target, no RPC may be called,
        and the stop must name the dates and counts but never an amount (an account-size
        leak into last_error)."""
        both = (STRATEGY_ID, STRATEGY_2_ID)
        # A VALID approval, taken on a clean world: the archive aggregate does not depend on
        # the live side, so it matches here too. With a fake one the apply would stop at the
        # fingerprint and this test could not tell whether the reconciliation guard bites.
        approved = await _calibrate_fingerprint_for(
            monkeypatch, db_factory=lambda: _db_with((STRATEGY_ID, GAP_A), (STRATEGY_2_ID, GAP_B)),
            targets=both,
        )
        db = _db_with((STRATEGY_ID, GAP_A), (STRATEGY_2_ID, GAP_B))
        live = _standard_live()
        live.realized["2026-09-15"] = 20.011  # archive says 20
        world = _install(monkeypatch, db, live, q3=_standard_q3(), targets=both)
        extra = {"approved_fingerprint": approved} if mode == "apply" else {}

        outcome = await _run(_meta(mode, [STRATEGY_ID, STRATEGY_2_ID], **extra))

        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "permanent"
        assert outcome.error_message == (
            "okx_archive_rebuild: reconcile_miss window=2026-08-03..2026-09-29 "
            "realized_days_over_cent=1 funding_days_over_cent=0 offending=2026-09-15..2026-09-15"
        )
        for amount in ("20.011", "0.011"):
            assert amount not in (outcome.error_message or "")
        assert re.search(r"\d+\.\d+", outcome.error_message or "") is None, "no decimal amount"
        result = world.result()
        assert result["stop_class"] == "reconcile_miss"
        assert result["reconcile"]["realized"]["ok"] is False
        assert result["reconcile"]["realized"]["misses"] == [
            {"date": "2026-09-15", "archive": "20", "live": "20.011"}
        ]
        assert db.apply_calls == 0
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_a_miss_on_the_window_total_alone_is_still_a_miss(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The founder's bound is a cent per day AND the same bound on the window total.
        Two days each off by exactly a cent pass the per-day test and fail the total."""
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _standard_live()
        live.realized["2026-08-10"] = 0.01
        live.realized["2026-08-11"] = 0.01
        world = _install(monkeypatch, db, live, q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message is not None
        assert outcome.error_message.endswith("cause=window_total")
        assert world.result()["reconcile"]["realized"]["window_total_diff"] == "-0.02"

    @pytest.mark.asyncio
    async def test_no_overlap_window_means_calibration_cannot_be_taken(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """RESEARCH Pitfall 9: once the live reach no longer touches the verified quarter
        there is nothing to authenticate the file against. That is a stop with a null
        window, not a silent skip of the reconciliation. The reach boundary comes from the
        clock (CR-01): three months on, the live reach starts after Q3 ended."""
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())
        # 2027-01-15 minus 88 days is 2026-10-19: the first full live day is 10-20, after Q3.
        monkeypatch.setattr(
            okx_archive_job, "_utc_now", lambda: datetime(2027, 1, 15, 12, 0, tzinfo=timezone.utc)
        )

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message == "okx_archive_rebuild: reconcile_miss window=none"
        result = world.result()
        assert result["reconcile"]["window"] is None
        assert result["reconcile"]["excluded_boundary_day"] == "2026-10-19"
        assert result["reconcile"]["realized"] is None and result["fingerprint"] is None
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_an_archive_only_day_in_the_live_reach_is_a_miss_and_is_named_as_the_truncation_signal(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If the live crawl was truncated, the archive shows P&L on a day inside the live
        reach that the live side lacks. Compared against zero it is a miss, and the info
        block names the date (information for the founder, on top of the gate)."""
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _standard_live()
        world = _install(
            monkeypatch, db, live, q3=_standard_q3(realized={"2026-08-20": "5"})
        )

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message is not None and "offending=2026-08-20..2026-08-20" in outcome.error_message
        assert world.result()["reconcile"]["realized"]["misses"] == [
            {"date": "2026-08-20", "archive": "5", "live": "0"}
        ]


class TestReachBoundaryComesFromTheFetchWindow:
    """CR-01. The job used ``min(realized_by_day)``, the first RECORD the crawl returned, as
    the live reach boundary. A quiet stretch (or a crawl cut by the page cap) moves the first
    record, not the reach: the window and the truncation detector then both started after the
    days they exist to check, and the NAV roll was anchored on whatever partial day came first.
    The boundary is now the clock's: the assumed reach is ``LIVE_REACH_ASSUMED_DAYS`` back."""

    @pytest.mark.asyncio
    async def test_a_quiet_stretch_at_the_start_of_the_live_reach_is_still_inside_the_window(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Live has its first record on 08-20 (08-03..08-19 are quiet or, in the bad case, were
        silently dropped by a truncated crawl). The archive shows P&L on 08-10. Under the old
        code the window started the day after the FIRST RECORD (08-21), so 08-10 was never
        compared and the run reported DONE; now the window opens on the first full day of the
        assumed reach (08-03) and 08-10 is an archive-only day, a miss."""
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _Live(realized={"2026-08-20": 20.0, "2026-09-15": 20.0})
        q3 = _Bills().realized("2026-07-10", "10").realized("2026-08-10", "5").realized(
            "2026-08-20", "20").realized("2026-09-15", "20").bytes()
        world = _install(monkeypatch, db, live, q3=q3)

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message is not None
        assert outcome.error_message.startswith(
            "okx_archive_rebuild: reconcile_miss window=2026-08-03..2026-09-29"
        )
        assert "offending=2026-08-10..2026-08-10" in outcome.error_message
        result = world.result()
        assert result["reconcile"]["excluded_boundary_day"] == "2026-08-02"
        assert result["reconcile"]["realized"]["misses"] == [
            {"date": "2026-08-10", "archive": "5", "live": "0"}
        ]
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_the_rebuilt_returns_do_not_depend_on_the_value_of_the_partial_boundary_day(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The live record for the boundary day (08-02) is a PARTIAL day. Whatever it holds,
        every rebuilt return must be the one the archive's WHOLE day gives. Here the live
        crawl caught only +40 of a day the archive says was +97.5; the oracle is the hand roll
        in the standard-scenario comment (nav_end(08-01) = 9931.0), which uses 97.5."""
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _standard_live()
        live.realized["2026-08-02"] = 40.0
        world = _install(monkeypatch, db, live, q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))
        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        fingerprint = world.result()["fingerprint"]
        _install(monkeypatch, db, live, q3=_standard_q3())
        applied = await _run(_meta("apply", [STRATEGY_ID], approved_fingerprint=fingerprint))

        assert applied.outcome == DispatchOutcome.DONE, applied.error_message
        (call,) = _apply_calls(db)
        for row in call["p_rows"]:
            assert row["daily_return"] == pytest.approx(ORACLE.get(row["date"], 0.0), abs=1e-12), row["date"]

    @pytest.mark.asyncio
    async def test_the_boundary_day_is_never_compared_but_is_reported(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())

        await _run(_meta("calibrate", [STRATEGY_ID]))

        reconcile = world.result()["reconcile"]
        assert reconcile["excluded_boundary_day"] == "2026-08-02"
        assert reconcile["window"]["from"] == "2026-08-03"
        assert world.result()["info"]["live_from"] == {"pnl": "2026-08-03", "flows": "2026-07-31"}


class TestInsertReturnsPreview:
    """F4: the fingerprint deliberately excludes every live-anchored return value, so the
    founder needs another way to see what the rows say before approving. The preview carries
    their min, max and compounded total."""

    @pytest.mark.asyncio
    async def test_the_preview_carries_min_max_and_the_compounded_return_of_the_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        (strategy,) = world.result()["strategies"]
        # The 23 rows are ORACLE's three nonzero days and twenty zeros (hand roll above).
        summary = strategy["insert_returns"]
        assert set(summary) == {"min", "max", "cumulative"}
        assert summary["min"] == pytest.approx(-2 / 9733.0, abs=1e-12)
        assert summary["max"] == pytest.approx(200 / 9731.0, abs=1e-12)
        compounded = (1 + 10 / 9723.0) * (1 - 2 / 9733.0) * (1 + 200 / 9731.0) - 1
        assert summary["cumulative"] == pytest.approx(compounded, abs=1e-12)

    @pytest.mark.asyncio
    async def test_a_target_with_no_rows_has_no_summary_and_is_not_invented(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A), (STRATEGY_2_ID, None))
        world = _install(
            monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=(STRATEGY_ID, STRATEGY_2_ID)
        )
        await _run(_meta("calibrate", [STRATEGY_ID, STRATEGY_2_ID]))
        assert world.result()["strategies"][1]["insert_returns"] is None

    def test_a_return_at_or_below_minus_one_makes_the_compounded_total_null(self) -> None:
        summary = okx_archive_job._returns_summary(
            [{"date": "2026-07-10", "daily_return": -1.0}, {"date": "2026-07-11", "daily_return": 0.5}]
        )
        assert summary is not None and summary["cumulative"] is None
        assert summary["min"] == -1.0 and summary["max"] == 0.5


class TestFlowSeamsReachTheJob:
    """F4, job side: archive transfer bills before the live deposit window, live from it on."""

    @pytest.mark.asyncio
    async def test_a_movement_in_both_sources_inside_the_live_window_counts_once(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A +300 movement sits in the archive (a transfer bill) and in the live ccxt deposits
        on 07-31, the first day of the live window (midnight(10-29) - 90 d). It must lower the
        NAV of every day BEFORE it by 300, ONCE. Against the standard roll (nav_end(07-19) =
        9733.0, nav_end(07-09) = 9723.0) the rebuilt returns are 10 over 9423.0 and -2 over
        9433.0. Counting it twice would put 600 under them. (The live deposit makes 07-31 the
        first live day, so the gap days from 07-31 on are live-owned and not rows.)"""
        live = _standard_live()
        live.transfers = [{"type": "deposit", "currency": "USDT", "amount": 300, "id": "d1",
                           "timestamp": _noon_ms("2026-07-31")}]
        both = _standard_bills().flow("2026-07-31", "300").bytes()
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, live, q3=both)
        preview = await _run(_meta("calibrate", [STRATEGY_ID]))
        assert preview.outcome == DispatchOutcome.DONE, preview.error_message
        fingerprint = world.result()["fingerprint"]
        _install(monkeypatch, db, live, q3=both)

        applied = await _run(_meta("apply", [STRATEGY_ID], approved_fingerprint=fingerprint))

        assert applied.outcome == DispatchOutcome.DONE, applied.error_message
        (call,) = _apply_calls(db)
        values = {r["date"]: r["daily_return"] for r in call["p_rows"]}
        # One 300 deposit on 07-31 lowers every NAV BEFORE it by 300.
        assert values["2026-07-10"] == pytest.approx(10 / (9723.0 - 300.0), abs=1e-12)
        assert values["2026-07-20"] == pytest.approx(-2 / (9733.0 - 300.0), abs=1e-12)

    @pytest.mark.asyncio
    async def test_an_archive_transfer_before_the_live_window_is_used_once(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        live = _standard_live()
        both = _standard_bills().flow("2026-07-15", "500").bytes()
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, live, q3=both)
        await _run(_meta("calibrate", [STRATEGY_ID]))
        fingerprint = world.result()["fingerprint"]
        _install(monkeypatch, db, live, q3=both)
        await _run(_meta("apply", [STRATEGY_ID], approved_fingerprint=fingerprint))
        (call,) = _apply_calls(db)
        values = {r["date"]: r["daily_return"] for r in call["p_rows"]}
        assert values["2026-07-10"] == pytest.approx(10 / (9723.0 - 500.0), abs=1e-12)

    @pytest.mark.asyncio
    async def test_an_archive_transfer_inside_the_live_window_is_reported_not_added(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A transfer bill the live deposit endpoints do not list (an internal move) inside
        the live window is NOT added to the roll; ``flow_totals_overlap`` shows the founder
        both sources' totals over the reconciliation window so the disagreement is visible."""
        both = _standard_bills().flow("2026-09-01", "250").bytes()
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=both)
        preview = await _run(_meta("calibrate", [STRATEGY_ID]))
        assert preview.outcome == DispatchOutcome.DONE, preview.error_message
        assert world.result()["info"]["flow_totals_overlap"] == {"archive": "250", "live": "0"}
        fingerprint = world.result()["fingerprint"]
        _install(monkeypatch, db, _standard_live(), q3=both)
        await _run(_meta("apply", [STRATEGY_ID], approved_fingerprint=fingerprint))
        (call,) = _apply_calls(db)
        values = {r["date"]: r["daily_return"] for r in call["p_rows"]}
        assert values["2026-07-10"] == pytest.approx(ORACLE["2026-07-10"], abs=1e-12)


class TestFlowSeamReading:
    """WR-03 / N-flow. The archive's transfer bills are used before ``live_flows_from_day`` (the
    start of the live deposit window, midnight(run) - 90 d = 2026-07-31 in these scenarios) and
    the live flows from it. A movement can straddle that seam in either direction, and the only
    flow reading was summed over the RECONCILE window (opens run-87 d = 08-03), so it never
    looked at the seam at all. The reading below is measured around the real seam. It is a
    reading, not a gate: whether to bound it is a founder decision."""

    SEAM = "2026-07-31"

    @pytest.mark.asyncio
    async def test_a_deposit_that_predates_the_live_window_but_whose_transfer_lands_after_the_seam_shows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """On-chain deposit 07-29 (outside the live window, so no live flow) whose
        funding-to-trading transfer bill is on 08-02 (after the seam, so the rebuild discards
        the archive bill): the +400 is in NEITHER source the roll reads, and every rebuilt NAV
        before 08-02 is 400 too high. The reading must make that visible."""
        both = _standard_bills().flow("2026-08-02", "400").bytes()
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=both)

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        info = world.result()["info"]
        # Window: 7 days before the seam (07-24) to 6 days after it (08-06).
        assert info["flow_seam"] == {
            "seam_day": self.SEAM,
            "margin_days": 7,
            "window": {"from": "2026-07-24", "to": "2026-08-06"},
            "archive_before_seam_used": "0",
            "archive_from_seam_discarded": "400",
            "live_from_seam_used": "0",
            "diff": "400",
        }
        # The overlap totals open at the seam, so the 08-02 transfer is inside them (the
        # reconcile window opens 08-03 and never saw it).
        assert info["flow_totals_overlap"] == {"archive": "400", "live": "0"}

    @pytest.mark.asyncio
    async def test_a_withdrawal_counted_by_both_sources_across_the_seam_shows_both_sides(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Trading-to-funding transfer on 07-30 (before the seam, so the archive bill is
        used) followed by the on-chain withdrawal on 07-31 (the live window's first day, so the
        live flow is used): the same 200 leaves the roll twice. Both halves must be readable."""
        live = _standard_live()
        live.transfers = [{"type": "withdrawal", "currency": "USDT", "amount": 200, "id": "w1",
                           "timestamp": _noon_ms("2026-07-31")}]
        both = _standard_bills().flow("2026-07-30", "-200").bytes()
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, live, q3=both)

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        info = world.result()["info"]
        seam = info["flow_seam"]
        assert seam["archive_before_seam_used"] == "-200"
        assert seam["live_from_seam_used"] == "-200"
        assert seam["archive_from_seam_discarded"] == "0"
        assert seam["diff"] == "200"
        # WR-02. The totals open AT the seam, so they compare only days both sources can
        # carry: the archive's 07-30 bill is before it, the live 07-31 flow is on it. The
        # double-counted 200 must read as the disagreement it is, never as "-200 == -200".
        assert info["flow_totals_overlap"] == {"archive": "0", "live": "-200"}

    @pytest.mark.asyncio
    async def test_an_archive_transfer_before_the_seam_is_not_in_the_overlap_totals(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """WR-02. The live side cannot carry a day before the seam (its flows start there), so
        an archive transfer on 07-27 would read as a one-sided "disagreement" the runbook then
        explains wrongly. It belongs to ``flow_seam.archive_before_seam_used`` and nowhere in
        the totals."""
        both = _standard_bills().flow("2026-07-27", "300").bytes()
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=both)

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        info = world.result()["info"]
        assert info["flow_seam"]["archive_before_seam_used"] == "300"
        assert info["flow_totals_overlap"] == {"archive": "0", "live": "0"}

    @pytest.mark.asyncio
    async def test_a_quiet_seam_reads_all_zero(self, monkeypatch: pytest.MonkeyPatch) -> None:
        world = _install(monkeypatch, _db_with((STRATEGY_ID, GAP_A)), _standard_live(), q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        seam = world.result()["info"]["flow_seam"]
        assert (seam["archive_before_seam_used"], seam["archive_from_seam_discarded"],
                seam["live_from_seam_used"], seam["diff"]) == ("0", "0", "0", "0")

    @pytest.mark.asyncio
    async def test_the_seam_reading_is_a_reading_and_never_a_gate(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A large straddle must not stop the run: the gate is a founder decision (D-10 binds
        only the P&L legs)."""
        both = _standard_bills().flow("2026-08-02", "400000").bytes()
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=both)

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        assert world.result()["info"]["flow_seam"]["diff"] == "400000"


def _seam_inputs(
    *, seam: str, covered_through: str, covered_from: str = "2026-07-01",
    archive: dict[str, str] | None = None, live: dict[str, str] | None = None,
) -> tuple[Any, Any]:
    """``_flow_readings``' two inputs, reduced to the fields it reads: the archive's per-day
    flows and covered days, and the live flows with their seam."""
    first, last = date.fromisoformat(covered_from), date.fromisoformat(covered_through)
    days = frozenset(
        (first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)
    )
    aggregate = SimpleNamespace(
        flows_by_day={d: Decimal(v) for d, v in (archive or {}).items()}, covered_days=days
    )
    live_ref = SimpleNamespace(
        flow_window_first_day=seam,
        flows=[SimpleNamespace(utc_day_iso=d, usd_signed=float(v)) for d, v in (live or {}).items()],
    )
    return aggregate, live_ref


class TestFlowSeamAfterWindowIsClamped:
    """WR-04 (review round 3, IN-02). The after-window ran ``seam + 6`` whatever the archive
    covered. On a late re-run (Q3 the last quarter, run date after about 12-23) it outran the
    archive: the live side counted days the archive CANNOT carry, so ``diff`` came out nonzero
    for an account with no discrepancy at all. A reading that is wrong without a defect behind
    it sends the founder looking for one."""

    def test_the_after_window_ends_at_the_last_covered_archive_day(self) -> None:
        aggregate, live = _seam_inputs(
            seam="2026-09-27", covered_through="2026-09-30", live={"2026-10-02": "250"}
        )
        _, seam = okx_archive_job._flow_readings(aggregate, live, set())
        assert seam is not None
        # 10-02 is past the archive's last day: no archive bill could ever be there, so a
        # live flow on it is not a disagreement and must not enter the comparison.
        assert seam["window"]["to"] == "2026-09-30"
        assert seam["live_from_seam_used"] == "0"
        assert seam["diff"] == "0"

    def test_a_full_week_after_the_seam_is_unchanged_when_the_archive_covers_it(self) -> None:
        aggregate, live = _seam_inputs(
            seam="2026-07-31", covered_through="2026-09-30",
            archive={"2026-08-02": "400"}, live={},
        )
        _, seam = okx_archive_job._flow_readings(aggregate, live, set())
        assert seam is not None
        assert seam["window"] == {"from": "2026-07-24", "to": "2026-08-06"}
        assert seam["diff"] == "400"

    def test_an_archive_that_ends_before_the_seam_is_unmeasurable_not_zero(self) -> None:
        aggregate, live = _seam_inputs(
            seam="2026-08-15", covered_through="2026-06-30", covered_from="2026-04-01",
            live={"2026-08-16": "75"},
        )
        _, seam = okx_archive_job._flow_readings(aggregate, live, set())
        assert seam is not None
        assert seam["diff"] is None, "no archive day on or after the seam: nothing to compare"
        assert seam["unmeasurable"] == "archive_ends_before_the_seam"
        assert seam["archive_from_seam_discarded"] is None and seam["live_from_seam_used"] is None


class TestRunbookFlowSeamSignal:
    """WR-03 (review round 3, IN-02). The runbook's no-go was "``archive_before_seam_used`` and
    ``live_from_seam_used`` both nonzero". That is true of any account with an ordinary deposit
    in the week before the seam and another in the week after, so it manufactured no-gos with no
    defect behind them. ``diff`` is the one number that says the two sources disagree after the
    seam; the founder judges it against the movements he knows, and no limit is written down
    (D-13)."""

    RUNBOOK = Path(__file__).resolve().parents[2] / "docs" / "runbooks" / "okxhistory-go-live.md"

    def _item(self) -> str:
        text = self.RUNBOOK.read_text(encoding="utf-8")
        start = text.index("- `info.flow_seam` and `info.flow_totals_overlap`")
        return text[start : text.index("- `info.live_from`", start)]

    def test_both_nonzero_is_no_longer_a_no_go(self) -> None:
        text = self.RUNBOOK.read_text(encoding="utf-8")
        assert "both nonzero" not in text and "both sides nonzero" not in text

    def test_diff_is_the_signal_and_no_limit_is_written(self) -> None:
        item = self._item()
        assert "`diff` the founder cannot match to one movement" in item
        assert not re.search(r"(?i)\b(limit|threshold|tolerance)\s*(of|is|:)?\s*\$?\d", item)

    def test_the_totals_window_is_described_as_starting_at_the_seam(self) -> None:
        item = self._item()
        assert "from the seam to the end of the archive" in item
        assert "a week before the seam" not in item

    def test_an_unmeasurable_seam_reading_is_explained(self) -> None:
        assert "archive_ends_before_the_seam" in self._item()


class TestLiveCrawlFlags:
    """F2 / WR-03. ``fetch_daily_pnl`` swallows every error and returns whatever it has,
    recording ``daily_pnl_fetch_error`` (with the exception CLASS) or
    ``daily_pnl_truncated_okx`` in a per-task buffer. The job never read the buffer, so a
    crawl that died on a 502 read as an empty live series: ``reconcile_miss window=...`` (or,
    on a quiet account, a pass), and a venue 429 could never reach the handler's deferral."""

    @pytest.mark.asyncio
    async def test_a_swallowed_fetch_error_is_a_transient_stop_not_an_empty_series(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _Live(realized={})
        live.dq_flags = {"daily_pnl_fetch_error": True, "daily_pnl_fetch_error_class": "ExchangeNotAvailable"}
        world = _install(monkeypatch, db, live, q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "transient"
        assert outcome.error_message == "okx_archive_rebuild: live_fetch_failed class=ExchangeNotAvailable"
        result = world.result()
        assert result["stop_class"] == "live_fetch_failed"
        assert result["reconcile"] is None, "the reconciliation must not run on a failed crawl"
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_a_swallowed_rate_limit_is_deferred_not_failed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A 429 that outlasted the helper's retries ends in the same buffer. It is a reason
        to wait (never stamped on the key), exactly like a 429 raised anywhere else."""
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _standard_live()
        live.dq_flags = {"daily_pnl_fetch_error": True, "daily_pnl_fetch_error_class": "RateLimitExceeded"}
        world = _install(monkeypatch, db, live, q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DEFERRED
        (defer,) = [p for n, p in db.rpcs if n == "defer_compute_job"]
        assert defer["p_reason"] == "okx_archive_rebuild: waiting rate_limited"
        assert defer["p_defer_seconds"] == okx_archive_job.RATE_LIMIT_DEFER_S
        assert [n for n, _ in db.rpcs if n == PROGRESS] == []
        assert db.table_writes == []

    @pytest.mark.asyncio
    async def test_a_page_cap_truncation_is_a_named_stop_never_a_partial_series(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The OKX walk pages newest-first, so a capped walk drops the OLDEST days: the days
        the reconciliation and the NAV roll lean on. The records that came back look fine."""
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _standard_live()
        live.dq_flags = {"daily_pnl_truncated_okx": True}
        world = _install(monkeypatch, db, live, q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "permanent"
        assert outcome.error_message == "okx_archive_rebuild: live_anchor_unusable live_realized=truncated"
        assert world.result()["reconcile"] is None
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_a_clean_crawl_leaves_no_flag_behind_for_the_next_read(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        assert exchange_module.get_and_clear_last_dq_flags() == {}


class TestInsufficientOverlap:
    """F3. ``days_compared`` counted calendar days, so two empty series compared equal and a
    window of three days or of nothing but zeros authenticated a file. Agreement only means
    something when the window could have disagreed."""

    def _at(self, monkeypatch: pytest.MonkeyPatch, now: datetime) -> None:
        monkeypatch.setattr(okx_archive_job, "_utc_now", lambda: now)

    @pytest.mark.asyncio
    async def test_a_window_shorter_than_two_weeks_is_insufficient_overlap_not_a_pass(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """2026-12-15 minus 88 days is 09-18, so the first full day is 09-19 and the Q3 window
        is 09-19..09-29: eleven days, and the live reach ended its activity on 09-15. Both
        sides are empty there, so they agree to the cent, and the old code reported DONE."""
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())
        self._at(monkeypatch, datetime(2026, 12, 15, 12, 0, tzinfo=timezone.utc))

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "permanent"
        assert outcome.error_message == (
            "okx_archive_rebuild: reconcile_miss cause=insufficient_overlap "
            "window=2026-09-19..2026-09-29 days=11 active=0 need_days=14 need_active=5"
        )
        result = world.result()
        assert result["stop_class"] == "reconcile_miss"
        assert result["reconcile"]["realized"]["ok"] is True, "the numbers agree; that is the trap"
        assert result["reconcile"]["realized"]["active_days"] == 0
        assert result["fingerprint"] is None
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_a_long_window_with_too_few_active_days_is_insufficient_overlap(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Fourteen days (09-16..09-29), the floor exactly, and still nothing on either side: long enough, empty."""
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())
        self._at(monkeypatch, datetime(2026, 12, 12, 12, 0, tzinfo=timezone.utc))

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message == (
            "okx_archive_rebuild: reconcile_miss cause=insufficient_overlap "
            "window=2026-09-16..2026-09-29 days=14 active=0 need_days=14 need_active=5"
        )
        assert db.apply_calls == 0

    @pytest.mark.asyncio
    async def test_the_standard_window_has_the_evidence_and_reports_its_active_days(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        # 58 days (08-03..09-29). Realized is active on 08-03, 08-05..08-08 and 09-15; funding
        # on 09-15 only. A day counts when either side carries >= half a cent.
        assert world.result()["reconcile"]["realized"]["active_days"] == 6
        assert world.result()["reconcile"]["funding"]["active_days"] == 1

    @pytest.mark.asyncio
    async def test_a_miss_is_still_reported_as_a_miss_when_the_window_is_also_short(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Disagreement outranks thin evidence: the founder needs the dates of the miss."""
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _standard_live()
        live.realized["2026-09-15"] = 20.011
        world = _install(monkeypatch, db, live, q3=_standard_q3())
        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))
        assert outcome.error_message is not None and "offending=2026-09-15" in outcome.error_message
        assert "insufficient_overlap" not in outcome.error_message


class TestClaimBudget:
    """WR-06. One claim of a calibrate or an apply does everything: two apply POSTs paced at
    11 s, status reads, up to two downloads of 300 s each, parsing, SIX sequential live crawls
    of up to 810 s each, the rebuild and the RPCs, all under ONE 900 s handler timeout. On a
    heavy account the handler timeout cancelled it from outside every time, each retry burnt an
    attempt after a fresh archive POST and download, and the failure was a generic timeout
    with no class. A claim now has a single budget derived from the handler timeout; each step
    is bounded by what is left of it, and running out is the named transient
    ``claim_budget_exceeded`` naming the step."""

    def test_the_budget_fits_inside_the_handler_timeout_with_room_for_the_result_write(self) -> None:
        handler = job_worker.TIMEOUT_PER_KIND["okx_archive_rebuild"]
        assert 0 < okx_archive_job.CLAIM_BUDGET_S <= handler - 30
        assert okx_archive_job.CLAIM_BUDGET_S == handler - okx_archive_job.CLAIM_RESERVE_S

    @pytest.mark.asyncio
    async def test_a_live_crawl_that_outlasts_the_budget_is_a_named_transient_not_a_generic_timeout(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _standard_live()
        world = _install(monkeypatch, db, live, q3=_standard_q3())
        monkeypatch.setattr(okx_archive_job, "CLAIM_BUDGET_S", 0.3)

        async def _slow_equity(exchange: Any, venue: str) -> tuple[float | None, bool, float, bool]:
            await asyncio.sleep(30)  # far past the budget; cancelled at 0.3 s
            return live.equity, False, 0.0, False

        monkeypatch.setattr(okx_archive_job, "fetch_account_equity_and_upnl_usd", _slow_equity)

        outcome = await asyncio.wait_for(_run(_meta("calibrate", [STRATEGY_ID])), timeout=10)

        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "transient"
        assert outcome.error_message == "okx_archive_rebuild: claim_budget_exceeded step=live_equity"
        assert world.result()["stop_class"] == "claim_budget_exceeded"
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_the_budget_is_shared_by_the_steps_not_granted_to_each(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Each fake crawl takes 0.2 s: individually inside the budget, together past it."""
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _standard_live()
        world = _install(monkeypatch, db, live, q3=_standard_q3())
        monkeypatch.setattr(okx_archive_job, "CLAIM_BUDGET_S", 0.5)

        async def _equity(exchange: Any, venue: str) -> tuple[float | None, bool, float, bool]:
            await asyncio.sleep(0.2)
            return live.equity, False, 0.0, False

        async def _funding(exchange: Any, label: str, since_ms: Any) -> list[dict[str, Any]]:
            await asyncio.sleep(0.2)
            return _funding_rows(live.funding)

        async def _transfers(exchange: Any, kind: str, since_ms: int, now_ms: int) -> list[dict[str, Any]]:
            await asyncio.sleep(0.2)
            return []

        monkeypatch.setattr(okx_archive_job, "fetch_account_equity_and_upnl_usd", _equity)
        monkeypatch.setattr(okx_archive_job, "fetch_funding_okx", _funding)
        monkeypatch.setattr(okx_archive_job, "fetch_ccxt_transfers", _transfers)

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message is not None
        assert outcome.error_message.startswith("okx_archive_rebuild: claim_budget_exceeded step=live_")
        assert outcome.error_kind == "transient"

    @pytest.mark.asyncio
    async def test_a_claim_with_nothing_left_does_not_start_the_next_crawl(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _standard_live()
        world = _install(monkeypatch, db, live, q3=_standard_q3())
        monkeypatch.setattr(okx_archive_job, "CLAIM_BUDGET_S", 0.0)

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message is not None
        assert outcome.error_message.startswith("okx_archive_rebuild: claim_budget_exceeded")
        assert live.calls == [], "no live crawl was started on an exhausted budget"

    @pytest.mark.asyncio
    async def test_a_download_is_bounded_by_the_budget_too(self, monkeypatch: pytest.MonkeyPatch) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())
        monkeypatch.setattr(okx_archive_job, "CLAIM_BUDGET_S", 0.3)

        async def _slow(url: str) -> tuple[bytes, str, int]:
            await asyncio.sleep(30)
            return b"", "zip", 1

        monkeypatch.setattr(okx_archive_job, "download_archive_csv", _slow)

        outcome = await asyncio.wait_for(_run(_meta("calibrate", [STRATEGY_ID])), timeout=10)

        assert outcome.error_message == "okx_archive_rebuild: claim_budget_exceeded step=download"
        assert outcome.error_kind == "transient"

    @pytest.mark.asyncio
    async def test_a_timeout_raised_by_the_work_itself_is_not_mislabelled_a_budget_stop(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Only the budget's own expiry is ``claim_budget_exceeded``: a TimeoutError the crawl
        raised on its own account keeps the dispatcher's transient disposition."""
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())

        async def _own_timeout(exchange: Any, venue: str) -> tuple[float | None, bool, float, bool]:
            raise TimeoutError("the venue socket timed out")

        monkeypatch.setattr(okx_archive_job, "fetch_account_equity_and_upnl_usd", _own_timeout)

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message is not None
        assert "claim_budget_exceeded" not in outcome.error_message


class TestWindows:
    """The overlap windows are where the archive is authenticated, so their arithmetic is
    pinned with independent calendar literals. They are built over the archive's covered days,
    the whole UTC days plan 18's aggregate has a daily total for (D-15)."""

    def test_adjacent_quarter_windows_merge_into_one_comparison(self) -> None:
        """Covered days 04-01..09-29 (Q2 and Q3 with the 06-30 edge joined; 09-30 is missing)
        and a live reach starting 06-28: one contiguous run, so the window-total bound is
        applied to the run, not to a seam."""
        windows = okx_archive_job._windows(
            frozenset(_daterange("2026-04-01", "2026-09-29")), date(2026, 6, 29), date(2026, 10, 15)
        )
        assert windows == [("2026-06-29", "2026-09-29")]

    def test_non_adjacent_quarters_stay_separate_windows(self) -> None:
        covered = frozenset(_daterange("2026-01-01", "2026-03-30") + _daterange("2026-07-01", "2026-09-29"))
        windows = okx_archive_job._windows(covered, date(2026, 2, 1), date(2026, 10, 15))
        assert windows == [("2026-02-01", "2026-03-30"), ("2026-07-01", "2026-09-29")]

    def test_a_quarter_the_live_reach_never_touches_has_no_window(self) -> None:
        covered = frozenset(_daterange("2026-04-01", "2026-06-29"))
        assert okx_archive_job._windows(covered, date(2026, 7, 2), date(2026, 10, 15)) == []

    def test_today_is_excluded_because_its_live_day_is_still_open(self) -> None:
        covered = frozenset(_daterange("2026-07-01", "2026-09-29"))
        assert okx_archive_job._windows(covered, date(2026, 8, 3), date(2026, 9, 10)) == [
            ("2026-08-03", "2026-09-09")
        ]


class TestLiveFlows:
    @pytest.mark.asyncio
    async def test_a_live_deposit_is_valued_by_the_derives_flow_valuer_and_reported_not_gated(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The live side is crawled with the SAME flow functions the derive uses. A 300 USDT
        deposit on 08-10 shows up in the live flow total of the window (information), the
        archive has no such flow, and that disagreement does not stop the run (D-09)."""
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _standard_live()
        live.transfers = [{"type": "deposit", "currency": "USDT", "amount": 300, "id": "d1",
                           "timestamp": _noon_ms("2026-08-10")}]
        world = _install(monkeypatch, db, live, q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        assert world.result()["info"]["flow_totals_overlap"] == {"archive": "0", "live": "300"}
        # OKX keeps 90 days of deposit history: the crawl starts at midnight(2026-10-29) - 90 d.
        floor_ms = int(datetime(2026, 7, 31, tzinfo=timezone.utc).timestamp() * 1000)
        assert ("deposits", floor_ms) in live.calls and ("withdrawals", floor_ms) in live.calls

    @pytest.mark.asyncio
    async def test_a_coin_flow_with_no_price_makes_the_live_anchor_unusable_not_a_guess(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A BTC deposit with no same-day price cannot be valued; the live derive fails loud
        on it and so does this job. The error text of the valuer can carry a raw amount, so
        only the class and a fixed reason reach last_error."""
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _standard_live()
        live.transfers = [{"type": "deposit", "currency": "BTC", "amount": 1.2345, "id": "d9",
                           "timestamp": _noon_ms("2026-08-10")}]
        world = _install(monkeypatch, db, live, q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message == "okx_archive_rebuild: live_anchor_unusable live_flows=unvaluable"
        assert "1.2345" not in json.dumps(world.progress_writes()) + (outcome.error_message or "")
        _no_writes_but_progress(world, db)


class TestD03:
    def _scenario(
        self, monkeypatch: pytest.MonkeyPatch, archive_on_0715: str | None, *, funding: str | None = None
    ) -> tuple[_World, _Db]:
        db = _db_with(
            (STRATEGY_ID, GAP_A), (STRATEGY_2_ID, None),
            csv=[
                _csv_row(STRATEGY_2_ID, "2026-07-14", 0.0007),
                _csv_row(STRATEGY_2_ID, "2026-07-15", 0.0),
                _csv_row(STRATEGY_2_ID, "2026-06-15", 0.0),  # Q2: no file was ingested
            ],
        )
        realized = {} if archive_on_0715 is None else {"2026-07-15": archive_on_0715}
        world = _install(
            monkeypatch, db, _standard_live(),
            q3=_standard_q3(realized=realized, funding={"2026-07-15": funding} if funding else {}),
            targets=(STRATEGY_ID, STRATEGY_2_ID),
        )
        return world, db

    @pytest.mark.asyncio
    async def test_T_D03_1_a_stored_zero_day_with_archive_pnl_fails_loud_with_both_figures_and_writes_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-03. Strategy 4's stored 0.0 days are checked against the archive, read-only.
        If the archive shows realized P&L on a day stored as 0.0, the stored series is
        wrong (or the day was misclassified) and the founder must see the date and BOTH
        figures. Nothing is rewritten: any fix is a separate founder decision."""
        world, db = self._scenario(monkeypatch, "2.5")

        outcome = await _run(_meta(
            "calibrate", [STRATEGY_ID], zero_check_strategy_ids=[STRATEGY_2_ID]
        ))

        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "permanent"
        assert outcome.error_message == (
            "okx_archive_rebuild: d03_zero_day_has_archive_pnl hits=1 first=2026-07-15 last=2026-07-15"
        )
        assert "2.5" not in (outcome.error_message or "")
        result = world.result()
        assert result["stop_class"] == "d03_zero_day_has_archive_pnl"
        assert result["d03"] == {
            "checked_days": 1,
            "hits": [{"date": "2026-07-15", "stored_return": 0.0,
                      "archive_realized": "2.5", "archive_funding": "0"}],
        }
        assert result["fingerprint"] is None, "a failed calibrate offers nothing to approve"
        _no_writes_but_progress(world, db)

    @pytest.mark.parametrize(
        ("archive_sum", "funding", "hit"),
        [("0.004", None, False), ("0.005", None, True), ("-0.005", None, True),
         (None, "0.004", False), (None, "0.006", True), (None, "-3", True)],
        ids=["realized-rounds-to-zero", "realized-half-cent", "realized-negative-half-cent",
             "funding-rounds-to-zero", "funding-over-half-cent", "funding-only"],
    )
    @pytest.mark.asyncio
    async def test_the_threshold_is_the_cent_on_realized_and_on_funding(
        self, monkeypatch: pytest.MonkeyPatch, archive_sum: str | None, funding: str | None, hit: bool
    ) -> None:
        """A stored 0.0 is a hit when the archive's realized OR funding sum for that day,
        rounded to the cent (half up), is not zero. Sub-half-cent dust is not a finding;
        anything a cent of rounding could show is."""
        world, db = self._scenario(monkeypatch, archive_sum, funding=funding)
        # The edited day sits outside the overlap window, so reconciliation stays clean.
        outcome = await _run(_meta(
            "calibrate", [STRATEGY_ID], zero_check_strategy_ids=[STRATEGY_2_ID]
        ))

        assert (outcome.outcome == DispatchOutcome.FAILED) is hit, outcome.error_message
        assert (world.result()["stop_class"] == "d03_zero_day_has_archive_pnl") is hit

    @pytest.mark.asyncio
    async def test_a_clean_check_counts_only_zero_days_inside_a_verified_quarter(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`checked_days` is the evidence the check looked: the stored 0.0 day inside Q3
        counts; the 0.0 day in a quarter that was not ingested (no archive to compare) and
        the non-zero day do not."""
        world, db = self._scenario(monkeypatch, None)

        outcome = await _run(_meta(
            "calibrate", [STRATEGY_ID], zero_check_strategy_ids=[STRATEGY_2_ID]
        ))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        assert world.result()["d03"] == {"checked_days": 1, "hits": []}

    @pytest.mark.asyncio
    async def test_apply_refuses_zero_check_strategy_ids_as_invalid_input(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-03 is a calibrate check. An apply carrying the key (even an empty list) means
        the operator mixed up the modes, and an apply must never carry a read-only strategy
        into a write path. Refused before any OKX call."""
        for ids in ([STRATEGY_2_ID], []):
            world, db = self._scenario(monkeypatch, None)
            outcome = await _run(_meta(
                "apply", [STRATEGY_ID], zero_check_strategy_ids=ids, approved_fingerprint="b" * 64
            ))
            assert outcome.error_message == "okx_archive_rebuild: invalid_input"
            assert world.all_calls == [] and db.apply_calls == 0
            assert world.result()["d03"] is None


class TestFingerprint:
    @pytest.mark.asyncio
    async def test_apply_without_a_fingerprint_is_fingerprint_missing_before_any_okx_call(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Nothing is written that the founder has not approved, and an apply that cannot
        say WHAT was approved must not even wait hours for a file."""
        world, db, _ = _standard(monkeypatch)

        outcome = await _run(_meta("apply", [STRATEGY_ID]))

        assert outcome.error_message == "okx_archive_rebuild: fingerprint_missing"
        assert outcome.error_kind == "permanent"
        assert world.result()["stop_class"] == "fingerprint_missing"
        assert world.all_calls == [] and db.apply_calls == 0
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_apply_with_a_different_fingerprint_is_fingerprint_mismatch_and_writes_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The approval is of THIS file and THESE days. If the archive or the planned days
        moved since the calibrate, the old approval must not be honoured."""
        approved = await _calibrate_fingerprint(monkeypatch)
        world, db, _ = _standard(monkeypatch)
        # The file changed after the approval, on a day outside the overlap window.
        world = _install(
            monkeypatch, db, _standard_live(),
            q3=_standard_q3(realized={"2026-07-10": "10.01"}),
        )

        outcome = await _run(_meta("apply", [STRATEGY_ID], approved_fingerprint=approved))

        assert outcome.error_message == "okx_archive_rebuild: fingerprint_mismatch"
        assert outcome.error_kind == "permanent"
        assert world.result()["stop_class"] == "fingerprint_mismatch"
        assert db.apply_calls == 0
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_the_fingerprint_does_not_depend_on_the_live_anchor(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Rebuilt returns are anchored to today's equity, which moves between a calibrate
        and an apply. The fingerprint hashes the archive and the days, never those returns,
        so a legitimate equity move cannot invalidate an approval."""
        first = await _calibrate_fingerprint(monkeypatch)
        richer = _standard_live()
        richer.equity = 12345.67
        second = await _calibrate_fingerprint(monkeypatch, live=richer)

        assert first == second

    @pytest.mark.asyncio
    async def test_the_fingerprint_covers_the_planned_dates(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A different stored gap (so a different planned date set) is a different review."""
        first = await _calibrate_fingerprint(monkeypatch)
        narrower = _db_with((STRATEGY_ID, [{"from": "2026-07-12", "to": "2026-08-01"}]))
        second = await _calibrate_fingerprint(monkeypatch, db=narrower)

        assert first != second


class TestApplyRpcContract:
    @pytest.mark.asyncio
    async def test_apply_sends_exactly_the_preview_to_the_rpc_once_per_target_and_records_the_status(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """SC-2 / D-05. The rows the RPC receives are the days the founder approved (and
        their values are the NAV-rolled returns worked by hand above), the gaps it is told to
        expect are the stored ones it must compare-and-set against, and the narrowed gaps
        are the Python computation the RPC will check against its own."""
        fingerprint = await _calibrate_fingerprint(monkeypatch)
        world, db, _ = _standard(monkeypatch)

        outcome = await _run(_meta("apply", [STRATEGY_ID], approved_fingerprint=fingerprint))

        assert outcome.outcome == DispatchOutcome.DONE and outcome.error_message is None
        (call,) = _apply_calls(db)
        assert call["p_strategy_id"] == STRATEGY_ID
        assert [r["date"] for r in call["p_rows"]] == _daterange("2026-07-10", "2026-08-01")
        for row in call["p_rows"]:
            assert row["daily_return"] == pytest.approx(ORACLE.get(row["date"], 0.0), abs=1e-12)
        assert call["p_expected_gaps"] == [{"from": "2026-07-10", "to": "2026-08-01"}]
        assert call["p_expected_gaps_after"] == []
        result = world.result()
        assert result["stop_class"] is None and result["mode"] == "apply"
        assert result["strategies"][0]["rpc"] == {"status": "applied", "error_class": None}
        assert result["strategies"][0]["insert_days"] == GAP_DAY_COUNT
        assert result["fingerprint"] == fingerprint
        assert result["d03"] is None
        # The model database now holds the rows, the narrowed gaps and the reconstructed range.
        assert set(db.csv_days(STRATEGY_ID)) == set(_daterange("2026-07-10", "2026-08-01"))
        provenance = db.provenance(STRATEGY_ID)
        assert provenance["unrecovered_gaps"] == []
        assert [(r["from"], r["to"], r["source"]) for r in provenance["reconstructed_ranges"]] == [
            ("2026-07-10", "2026-08-01", SRC)
        ]

    @pytest.mark.asyncio
    async def test_a_day_a_quarter_does_not_cover_stays_named_and_is_never_a_row(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """SC-4 / TRADESYNC D-02. A stored gap that reaches into a quarter that was not
        ingested keeps its uncovered days in `gaps_after` and never gets a zero row."""
        wide = [{"from": "2026-06-20", "to": "2026-08-01", "recorded_at": "2026-10-10T00:00:00Z"}]
        db = _db_with((STRATEGY_ID, wide))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        (strategy,) = world.result()["strategies"]
        # The Q3 file covers 07-01 onwards: 31 July days + 1 August day. 06-20..06-30 is Q2.
        assert strategy["insert_days"] == 32
        assert strategy["insert_ranges"] == [{"from": "2026-07-01", "to": "2026-08-01"}]
        assert strategy["gaps_after"] == [{"from": "2026-06-20", "to": "2026-06-30"}]
        assert strategy["gaps_before"] == [{"from": "2026-06-20", "to": "2026-08-01"}]

    @pytest.mark.asyncio
    async def test_an_archive_flow_inside_the_gap_moves_the_nav_the_returns_are_rolled_from(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-08: beyond OKX's 90-day deposit retention a transfer bill is an EXTERNAL FLOW,
        never P&L. A +500 deposit on 07-15 must lift every NAV before it by 500, so the
        07-10 return is 10 over 9220.5 and not over 9720.5. By hand: nav_end(07-15) = 9730.5,
        nav_end(07-14) = 9730.5 - 500 = 9230.5, nav_end(07-09) = 9230.5 - 10 = 9220.5. The
        deposit day itself carries no P&L, so its return is zero (flow is not performance)."""
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(flows={"2026-07-15": "500"}))
        preview = await _run(_meta("calibrate", [STRATEGY_ID]))
        assert preview.outcome == DispatchOutcome.DONE, preview.error_message
        fingerprint = world.result()["fingerprint"]
        _install(monkeypatch, db, _standard_live(), q3=_standard_q3(flows={"2026-07-15": "500"}))

        outcome = await _run(_meta("apply", [STRATEGY_ID], approved_fingerprint=fingerprint))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        (call,) = _apply_calls(db)
        values = {r["date"]: r["daily_return"] for r in call["p_rows"]}
        assert values["2026-07-10"] == pytest.approx(10 / 9223.0, abs=1e-12)
        assert values["2026-07-15"] == pytest.approx(0.0, abs=1e-12)
        assert values["2026-08-01"] == pytest.approx(200 / 9731.0, abs=1e-12)

    @pytest.mark.asyncio
    async def test_a_live_row_inside_the_gap_is_never_rewritten_and_splits_the_reconstructed_range(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-12: live-derived days always win. A live row already sitting on 07-15 is not in
        `p_rows`, keeps its stored value byte for byte, and the reconstructed ranges name
        only the days the archive really supplied (two islands, not one claim over a day it
        did not write)."""
        db = _db_with((STRATEGY_ID, GAP_A), csv=[_csv_row(STRATEGY_ID, "2026-07-15", 0.02468)])
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())
        preview = await _run(_meta("calibrate", [STRATEGY_ID]))
        assert preview.outcome == DispatchOutcome.DONE, preview.error_message
        fingerprint = world.result()["fingerprint"]
        assert world.result()["strategies"][0]["insert_days"] == GAP_DAY_COUNT - 1
        _install(monkeypatch, db, _standard_live(), q3=_standard_q3())

        outcome = await _run(_meta("apply", [STRATEGY_ID], approved_fingerprint=fingerprint))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        (call,) = _apply_calls(db)
        assert "2026-07-15" not in [r["date"] for r in call["p_rows"]]
        assert db.csv_days(STRATEGY_ID)["2026-07-15"] == 0.02468
        provenance = db.provenance(STRATEGY_ID)
        assert provenance["unrecovered_gaps"] == []
        assert [(r["from"], r["to"]) for r in provenance["reconstructed_ranges"]] == [
            ("2026-07-10", "2026-07-14"), ("2026-07-16", "2026-08-01"),
        ]

    @pytest.mark.asyncio
    async def test_an_rpc_refusal_is_rpc_refused_naming_the_position_and_later_targets_are_not_called(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-11. The RPC rolls its own call back on any refusal. The job must say WHICH
        target was refused (by input position, never a strategy id) and must not carry on
        to the next target as if nothing happened."""
        for code in ("P0001", "22023"):
            db = _db_with((STRATEGY_ID, GAP_A), (STRATEGY_2_ID, GAP_B))
            both = (STRATEGY_ID, STRATEGY_2_ID)
            fingerprint = await _calibrate_fingerprint_for(monkeypatch, db_factory=lambda: _db_with(
                (STRATEGY_ID, GAP_A), (STRATEGY_2_ID, GAP_B)), targets=both)
            world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=both)
            db.apply_faults[1] = ("before", _PgError(code, "apply_okx_archive_rebuild: gaps_changed"))

            outcome = await _run(_meta("apply", list(both), approved_fingerprint=fingerprint))

            assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "permanent"
            assert outcome.error_message == "okx_archive_rebuild: rpc_refused position=0 applied=0"
            assert db.apply_calls == 1, "the second target must not be called after a refusal"
            result = world.result()
            assert result["strategies"][0]["rpc"] == {"status": None, "error_class": "rpc_refused"}
            assert result["strategies"][1]["rpc"] is None

    @pytest.mark.asyncio
    async def test_a_refusal_after_a_committed_target_reports_the_committed_one_as_applied(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The honest record when target 0 committed and target 1 was refused: position 0 is
        `applied` in the block and the stop says how many were written, so nobody reads
        "failed" as "nothing was written"."""
        both = (STRATEGY_ID, STRATEGY_2_ID)
        fingerprint = await _calibrate_fingerprint_for(monkeypatch, db_factory=lambda: _db_with(
            (STRATEGY_ID, GAP_A), (STRATEGY_2_ID, GAP_B)), targets=both)
        db = _db_with((STRATEGY_ID, GAP_A), (STRATEGY_2_ID, GAP_B))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=both)
        db.apply_faults[2] = ("before", _PgError("P0001", "apply_okx_archive_rebuild: gaps_changed"))

        outcome = await _run(_meta("apply", list(both), approved_fingerprint=fingerprint))

        assert outcome.error_message == "okx_archive_rebuild: rpc_refused position=1 applied=1"
        result = world.result()
        assert result["strategies"][0]["rpc"] == {"status": "applied", "error_class": None}
        assert result["strategies"][1]["rpc"] == {"status": None, "error_class": "rpc_refused"}
        assert set(db.csv_days(STRATEGY_ID)) == set(_daterange("2026-07-10", "2026-08-01"))
        assert db.csv_days(STRATEGY_2_ID) == {}

    @pytest.mark.asyncio
    async def test_an_already_applied_answer_is_a_no_op_never_a_miss(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A retry of a lost response is answered `already_applied` by the RPC. That is
        success with nothing written, and it is recorded as that, distinct from `applied`."""
        fingerprint = await _calibrate_fingerprint(monkeypatch)
        world, db, _ = _standard(monkeypatch)
        db.apply_answers[1] = {"status": "already_applied", "inserted": 0, "ranges_added": 0,
                               "gaps_before": [], "gaps_after": []}

        outcome = await _run(_meta("apply", [STRATEGY_ID], approved_fingerprint=fingerprint))

        assert outcome.outcome == DispatchOutcome.DONE
        entry = world.result()["strategies"][0]
        assert entry["rpc"] == {"status": "already_applied", "error_class": None}
        assert entry["insert_days"] == 0


async def _calibrate_fingerprint_for(
    monkeypatch: pytest.MonkeyPatch, *, db_factory: Callable[[], _Db], targets: tuple[str, ...],
) -> str:
    db = db_factory()
    world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=targets)
    outcome = await _run(_meta("calibrate", list(targets)))
    assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
    fingerprint: str = world.result()["fingerprint"]
    return fingerprint


class TestApplyResume:
    """Per-target RPCs commit independently, so a failure after the first commit must neither
    block the remaining target nor be reported as "nothing written" (D-11 / D-12)."""

    BOTH = (STRATEGY_ID, STRATEGY_2_ID)

    def _state(self) -> _Db:
        return _db_with((STRATEGY_ID, GAP_A), (STRATEGY_2_ID, GAP_B))

    async def _preview(self, monkeypatch: pytest.MonkeyPatch, db: _Db) -> dict[str, Any]:
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=self.BOTH)
        outcome = await _run(_meta("calibrate", list(self.BOTH)))
        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        result: dict[str, Any] = world.result()
        return result

    @pytest.mark.asyncio
    async def test_a_failure_after_the_first_commit_is_resumed_by_the_same_fingerprint(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = self._state()
        preview = await self._preview(monkeypatch, db)
        fingerprint = preview["fingerprint"]
        assert [s["insert_days"] for s in preview["strategies"]] == [23, 14]
        metadata = _meta("apply", list(self.BOTH), approved_fingerprint=fingerprint)

        # Run 1: target 0 commits; target 1's call fails with a timeout, nothing committed.
        world1 = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=self.BOTH)
        db.apply_faults[2] = ("before", httpx.ReadTimeout("timed out"))
        with pytest.raises(httpx.ReadTimeout):
            await okx_archive_job.run_okx_archive_rebuild_job(_job(metadata))
        block = world1.result()
        assert block["strategies"][0]["rpc"] == {"status": "applied", "error_class": None}
        assert block["strategies"][1]["rpc"] == {"status": None, "error_class": "rpc_transport"}
        assert block["stop_class"] is None, "a transport failure is not a stop class"
        run1_rows = [c["p_rows"] for c in _apply_calls(db)]
        assert len(run1_rows) == 2
        assert set(db.csv_days(STRATEGY_ID)) == set(_daterange("2026-07-10", "2026-08-01"))
        assert db.csv_days(STRATEGY_2_ID) == {}

        # Run 2: same metadata, same fingerprint, fresh fakes over the persisted state.
        world2 = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=self.BOTH)
        outcome = await _run(metadata)

        assert outcome.outcome == DispatchOutcome.DONE and outcome.error_message is None
        result2 = world2.result()
        assert result2["fingerprint"] == fingerprint, "the planned set is stable across the commit"
        assert result2["strategies"][0]["rpc"] == {"status": "already_applied", "error_class": None}
        assert result2["strategies"][0]["insert_days"] == 0
        assert result2["strategies"][1]["rpc"] == {"status": "applied", "error_class": None}
        calls = _apply_calls(db)
        assert [c["p_strategy_id"] for c in calls] == [STRATEGY_2_ID], "target 0 makes NO RPC call"
        assert calls[0]["p_rows"] == run1_rows[1], "the resumed rows equal the preview's (dates and values)"
        assert set(db.csv_days(STRATEGY_2_ID)) == set(_daterange("2026-07-12", "2026-07-25"))

        # Run 3 over the completed state: zero RPC calls, DONE.
        world3 = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=self.BOTH)
        outcome3 = await _run(metadata)
        assert outcome3.outcome == DispatchOutcome.DONE
        assert _apply_calls(db) == []
        statuses = [s["rpc"]["status"] for s in world3.result()["strategies"]]
        assert statuses == ["already_applied", "already_applied"]

    @pytest.mark.asyncio
    async def test_the_dispatcher_classifies_a_transport_failure_as_retryable_never_permanent(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The re-raise is what makes the worker retry the job (the re-claim then resumes).
        A permanent classification would strand the second target for good."""
        db = self._state()
        fingerprint = (await self._preview(monkeypatch, db))["fingerprint"]
        _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=self.BOTH)
        db.apply_faults[2] = ("before", httpx.ReadTimeout("timed out"))

        outcome = await _run(_meta("apply", list(self.BOTH), approved_fingerprint=fingerprint))

        assert outcome.outcome == DispatchOutcome.FAILED
        assert outcome.error_kind in ("transient", "unknown")

    @pytest.mark.asyncio
    async def test_a_calibrate_over_the_partially_applied_state_has_the_same_fingerprint(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The planned date set is the same before and after a target commits, which is what
        lets a re-run after a partial apply match the approval."""
        db = self._state()
        original = (await self._preview(monkeypatch, db))["fingerprint"]
        _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=self.BOTH)
        db.apply_faults[2] = ("before", httpx.ReadTimeout("timed out"))
        with pytest.raises(httpx.ReadTimeout):
            await okx_archive_job.run_okx_archive_rebuild_job(
                _job(_meta("apply", list(self.BOTH), approved_fingerprint=original))
            )
        assert db.csv_days(STRATEGY_ID) != {}

        again = await self._preview(monkeypatch, db)

        assert again["fingerprint"] == original
        assert [s["insert_days"] for s in again["strategies"]] == [0, 14]

    @pytest.mark.asyncio
    async def test_a_commit_whose_response_was_lost_is_resumed_without_a_second_write(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The nastiest case: the RPC COMMITTED and the response never arrived (a 5xx or a
        reset after the commit). The failed call is recorded as a transport failure, and the
        re-run must find that target already complete instead of sending it again."""
        db = self._state()
        fingerprint = (await self._preview(monkeypatch, db))["fingerprint"]
        metadata = _meta("apply", list(self.BOTH), approved_fingerprint=fingerprint)
        world1 = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=self.BOTH)
        db.apply_faults[1] = ("after", httpx.ReadTimeout("response lost"))
        with pytest.raises(httpx.ReadTimeout):
            await okx_archive_job.run_okx_archive_rebuild_job(_job(metadata))
        assert world1.result()["strategies"][0]["rpc"] == {"status": None, "error_class": "rpc_transport"}
        assert db.csv_days(STRATEGY_ID) != {}, "the commit happened"

        world2 = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=self.BOTH)
        outcome = await _run(metadata)

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        statuses = [s["rpc"]["status"] for s in world2.result()["strategies"]]
        assert statuses == ["already_applied", "applied"]
        assert [c["p_strategy_id"] for c in _apply_calls(db)] == [STRATEGY_2_ID]

    @pytest.mark.asyncio
    async def test_empty_rows_with_a_changed_gap_delta_stops_rpc_refused_before_any_call(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Target 1's stored gap lies in a quarter that was not ingested (so its fresh row
        set is empty) and a LIVE row already sits inside it: its narrowed gaps differ from
        the stored ones. The RPC refuses an empty `p_rows` by contract, so this cannot be
        expressed through it. It is decided before the FIRST call and stops the whole apply
        naming the position, even though target 0 could have been written (D-11)."""
        q2_gap = [{"from": "2026-06-20", "to": "2026-06-30", "recorded_at": "2026-10-10T00:00:00Z"}]
        db = _db_with(
            (STRATEGY_ID, GAP_A), (STRATEGY_2_ID, q2_gap), csv=[_csv_row(STRATEGY_2_ID, "2026-06-25", 0.001)]
        )
        preview_world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=self.BOTH)
        calibrate = await _run(_meta("calibrate", list(self.BOTH)))
        assert calibrate.outcome == DispatchOutcome.DONE, calibrate.error_message
        preview = preview_world.result()
        assert preview["strategies"][1]["insert_days"] == 0
        assert preview["strategies"][1]["gaps_after"] != preview["strategies"][1]["gaps_before"]
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=self.BOTH)

        outcome = await _run(_meta(
            "apply", list(self.BOTH), approved_fingerprint=preview["fingerprint"]
        ))

        assert outcome.error_message == "okx_archive_rebuild: rpc_refused position=1 reason=empty_rows_gap_delta"
        assert db.apply_calls == 0, "not even target 0 is written"
        assert db.table_writes == []
        assert world.result()["strategies"][0]["rpc"] is None

    @pytest.mark.asyncio
    async def test_a_target_with_nothing_to_write_is_a_named_stop_not_an_already_applied_success(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """WR-05 / F6. A target with no stored gap has nothing to write and nothing to narrow.
        That used to be recorded `already_applied` and the job ended DONE, so a wrong strategy
        id, a strategy TRADESYNC never measured, or a gap lying wholly outside the ingested
        quarters read as a successful re-run. It is its own status, and an apply that meets
        one stops BEFORE the first RPC (the other target is not written either: the operator
        listed a target that cannot be applied, and fixes the list)."""
        db = _db_with((STRATEGY_ID, GAP_A), (STRATEGY_2_ID, None))
        preview_world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=self.BOTH)
        await _run(_meta("calibrate", list(self.BOTH)))
        preview = preview_world.result()
        assert [s["apply_state"] for s in preview["strategies"]] == ["insert", "nothing_to_apply"]
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=self.BOTH)

        outcome = await _run(_meta("apply", list(self.BOTH), approved_fingerprint=preview["fingerprint"]))

        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "permanent"
        assert outcome.error_message == "okx_archive_rebuild: nothing_to_apply position=1"
        assert db.apply_calls == 0, "not even the target that could be written is sent"
        result = world.result()
        assert result["stop_class"] == "nothing_to_apply"
        assert result["strategies"][0]["rpc"] is None
        assert result["strategies"][1]["rpc"] == {"status": "nothing_to_apply", "error_class": None}
        assert db.table_writes == []

    @pytest.mark.asyncio
    async def test_a_gap_wholly_outside_the_ingested_quarters_is_nothing_to_apply(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        q2_gap = [{"from": "2026-06-20", "to": "2026-06-30", "recorded_at": "2026-10-10T00:00:00Z"}]
        db = _db_with((STRATEGY_ID, q2_gap))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())
        calibrate = await _run(_meta("calibrate", [STRATEGY_ID]))
        assert calibrate.outcome == DispatchOutcome.DONE, calibrate.error_message
        fingerprint = world.result()["fingerprint"]
        assert world.result()["strategies"][0]["apply_state"] == "nothing_to_apply"
        _install(monkeypatch, db, _standard_live(), q3=_standard_q3())

        outcome = await _run(_meta("apply", [STRATEGY_ID], approved_fingerprint=fingerprint))

        assert outcome.error_message == "okx_archive_rebuild: nothing_to_apply position=0"
        assert db.apply_calls == 0

    def test_the_four_states_of_a_target_are_decided_by_what_it_has_and_what_is_recorded(self) -> None:
        plan = okx_archive_job._TargetPlan
        gap = [{"from": "2026-07-10", "to": "2026-07-12"}]
        row = {"date": "2026-07-10", "daily_return": 0.001}
        state = okx_archive_job._target_state
        # rows to write
        assert state(plan(0, "s", gap, [row], [], ["2026-07-10"], False)) == "insert"
        # nothing to write, planned days already inside the stored archive ranges
        assert state(plan(0, "s", [], [], [], ["2026-07-10"], True)) == "already_applied"
        # every gap day NaN-guarded: nothing planned, gaps unchanged
        assert state(plan(0, "s", gap, [], gap, [], False)) == "nothing_to_apply"
        # no stored gap and nothing recorded (a wrong strategy id)
        assert state(plan(0, "s", [], [], [], [], False)) == "nothing_to_apply"
        # nothing to write but the gaps WOULD change (a live row appeared): the RPC cannot say it
        assert state(plan(0, "s", gap, [], [{"from": "2026-07-11", "to": "2026-07-12"}], [], False)) == "gap_delta"


def _standard_bills(*, opening: str | Decimal = "5000", first_id: int = 800_000_000) -> _Bills:
    """The standard Q3 file as a ``_Bills`` object (so a test can drop a row from it)."""
    bills = _Bills(opening=opening, first_id=first_id)
    for day, net in sorted({"2026-07-10": "10", "2026-08-01": "200", "2026-08-02": "97.5",
                            "2026-08-03": "-50", "2026-09-15": "20", **FILLER}.items()):
        bills.realized(day, net)
    for day, amount in sorted({"2026-07-20": "-2", "2026-09-15": "1.5"}.items()):
        bills.funding(day, amount)
    return bills


class TestArchiveCompleteness:
    """F1 (silent-failure-hunter, HIGH). A quarter file is read as the COMPLETE ledger of its
    quarter, so every covered day without a bill becomes an explicit 0.0 return that the RPC
    then removes from ``unrecovered_gaps``. A file with rows missing (a truncated export)
    passed every gate: Q2 has no live overlap and Q3's July is never compared. The running
    ``bal`` is the one thing inside the file that proves it is whole."""

    def test_the_helper_file_chains_before_a_row_is_dropped(self) -> None:
        # Guard the guard: the file the tests below mutilate is itself a valid chaining file.
        from services.okx_archive_classify import aggregate_archive, verify_bal_chain
        from services.okx_archive_files import parse_archive_csv

        files = [parse_archive_csv(_standard_bills().bytes(), year=2026, quarter="Q3")]
        verify_bal_chain(files, aggregate_archive(files, None).summed_ccys)

    @pytest.mark.parametrize("mode", ["calibrate", "apply"])
    @pytest.mark.asyncio
    async def test_an_interior_row_missing_from_the_file_is_archive_incomplete_and_writes_nothing(
        self, monkeypatch: pytest.MonkeyPatch, mode: str
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        # Position 1 is the 08-01 +200 realized bill: with it gone the file still parses, still
        # reconciles (08-01 is before the live window) and would publish 08-01 as a quiet 0.0.
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_bills().without(1).bytes())
        extra = {"approved_fingerprint": "d" * 64} if mode == "apply" else {}

        outcome = await _run(_meta(mode, [STRATEGY_ID], **extra))

        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "permanent"
        assert outcome.error_message == (
            "okx_archive_rebuild: archive_incomplete parse=archive_incomplete cause=bal_chain_break"
        )
        result = world.result()
        assert result["stop_class"] == "archive_incomplete"
        # The founder can read where the chain broke: counts and a date, never an amount. The
        # file has 11 bills (9 realized, 2 funding); with one removed, 10 bills make 9 pairs.
        assert result["info"] == {
            "bal_chain": {
                "reason": "bal_chain_break",
                "ccys": {"USDT": {
                    "pairs_checked": 9, "first_day": "2026-07-10", "last_day": "2026-09-15",
                    "breaks": 1, "first_break_day": "2026-08-02", "seam_breaks": 0,
                }},
                "total_pairs": 9,
                "starved": [],
                "files": [{"ts_min_day": "2026-07-10", "ts_max_day": "2026-09-15"}],
                "floor": 2,
            }
        }
        assert result["fingerprint"] is None
        assert db.apply_calls == 0
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_a_passing_calibrate_records_the_chain_it_proved(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """N1. ``result["info"]`` is rebuilt wholesale by the evaluation, so a chain proof that
        only a stop carried left a clean calibrate with nothing to read: a chain that checked
        0 or 3 pairs looked like a chain that checked 3000. The positive reading is the
        evidence the founder's go/no-go needs."""
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        # 9 realized + 2 funding bills in one USDT chain: 11 bills, 10 pairs, 07-10 .. 09-15.
        assert world.result()["info"]["bal_chain"] == {
            "ccys": {"USDT": {"pairs_checked": 10, "first_day": "2026-07-10", "last_day": "2026-09-15"}},
            "total_pairs": 10,
            "floor": 2,
        }

    @pytest.mark.parametrize("mode", ["calibrate", "apply"])
    @pytest.mark.asyncio
    async def test_a_currency_with_money_on_it_and_too_few_pairs_is_archive_incomplete(
        self, monkeypatch: pytest.MonkeyPatch, mode: str
    ) -> None:
        """N1. One lone USDC bill with P&L chains zero pairs: its completeness cannot be
        proven, and USDC is summed as dollars, so it stops instead of passing unexamined."""
        db = _db_with((STRATEGY_ID, GAP_A))
        bills = _standard_bills().realized("2026-09-20", "5", ccy="USDC")
        world = _install(monkeypatch, db, _standard_live(), q3=bills.bytes())
        extra = {"approved_fingerprint": "d" * 64} if mode == "apply" else {}

        outcome = await _run(_meta(mode, [STRATEGY_ID], **extra))

        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "permanent"
        assert outcome.error_message == (
            "okx_archive_rebuild: archive_incomplete parse=archive_incomplete cause=too_few_pairs"
        )
        info = world.result()["info"]["bal_chain"]
        assert info["reason"] == "too_few_pairs" and info["starved"] == ["USDC"]
        assert info["ccys"]["USDC"]["pairs_checked"] == 0
        assert info["floor"] == 2
        assert db.apply_calls == 0
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_a_lone_coin_margined_option_bill_does_not_stop_the_floor(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """WR-01 (review round 3). A BTC-margined OPTION bill settles in the coin, which is
        ordinary on OKX, and a currency touched once in six months has no pairs. The aggregate
        never sums it (``excluded_non_usd_rows``), so its completeness is not something the
        published figures rest on, and stopping the whole job ``too_few_pairs`` on it would be a
        permanent false stop that only a code change clears. The floor is for currencies whose
        money the rebuild SUMS; the break check still runs on every currency."""
        db = _db_with((STRATEGY_ID, GAP_A))
        bills = _standard_bills().realized("2026-09-20", "5", inst="OPTION", ccy="BTC")
        world = _install(monkeypatch, db, _standard_live(), q3=bills.bytes())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        chain = world.result()["info"]["bal_chain"]
        assert chain["ccys"]["BTC"] == {"pairs_checked": 0, "first_day": "2026-09-20", "last_day": "2026-09-20"}
        assert chain["ccys"]["USDT"]["pairs_checked"] == 10

    QUARTERS_Q2_Q3 = [{"year": 2026, "quarter": "Q2"}, {"year": 2026, "quarter": "Q3"}]

    @staticmethod
    def _no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
        """Two quarters are two OKX applies, MIN_APPLY_GAP_S apart; the gap is not under test."""

        async def _skip(_seconds: float) -> None:
            return None

        monkeypatch.setattr(okx_archive_job, "_sleep", _skip)

    def _q2(self) -> _Bills:
        bills = _Bills(first_id=700_000_000)
        for day, net in (("2026-04-02", "10"), ("2026-05-10", "20"), ("2026-06-20", "5"), ("2026-06-29", "7")):
            bills.realized(day, net)
        return bills

    @pytest.mark.parametrize("mode", ["calibrate", "apply"])
    @pytest.mark.parametrize(
        ("label", "q2_drop", "q3_drop"),
        [("q2-tail-missing", (3,), ()), ("q3-head-missing", (), (0,))],
    )
    @pytest.mark.asyncio
    async def test_a_truncation_at_the_q2_q3_seam_is_archive_incomplete_and_writes_nothing(
        self, monkeypatch: pytest.MonkeyPatch, mode: str, label: str,
        q2_drop: tuple[int, ...], q3_drop: tuple[int, ...],
    ) -> None:
        """WR-01 / N2. Each file chains on its own, so a Q2 file missing its last weeks or a Q3
        file missing its first weeks passed, and the missing days were published as 0.0 inside
        the gaps, outside the reconcile window and outside D-03. The seam is checked now."""
        db = _db_with((STRATEGY_ID, GAP_A))
        q2_full = self._q2()
        q3_full = _standard_bills(opening=q2_full.closing(), first_id=800_000_000)
        q2, q3 = q2_full, q3_full
        for position in q2_drop:
            q2 = q2.without(position)
        for position in q3_drop:
            q3 = q3.without(position)
        world = _install(monkeypatch, db, _standard_live(), q2=q2.bytes(), q3=q3.bytes())
        self._no_sleep(monkeypatch)
        extra = {"approved_fingerprint": "d" * 64} if mode == "apply" else {}

        outcome = await _run(_meta(mode, [STRATEGY_ID], quarters=self.QUARTERS_Q2_Q3, **extra))

        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "permanent", label
        result = world.result()
        assert result["stop_class"] == "archive_incomplete"
        usdt = result["info"]["bal_chain"]["ccys"]["USDT"]
        assert (usdt["breaks"], usdt["seam_breaks"]) == (1, 1)
        assert result["fingerprint"] is None and db.apply_calls == 0
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_two_chaining_quarters_pass_and_the_proof_spans_both(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        q2 = self._q2()
        q3 = _standard_bills(opening=q2.closing(), first_id=800_000_000)
        world = _install(monkeypatch, db, _standard_live(), q2=q2.bytes(), q3=q3.bytes())
        self._no_sleep(monkeypatch)

        outcome = await _run(_meta("calibrate", [STRATEGY_ID], quarters=self.QUARTERS_Q2_Q3))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        # 4 Q2 bills + 11 Q3 bills = 15 bills in one chain = 14 pairs, 04-02 .. 09-15.
        assert world.result()["info"]["bal_chain"] == {
            "ccys": {"USDT": {"pairs_checked": 14, "first_day": "2026-04-02", "last_day": "2026-09-15"}},
            "total_pairs": 14,
            "floor": 2,
        }

    @pytest.mark.asyncio
    async def test_each_quarter_reports_ts_range_and_its_longest_bill_less_run(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        (quarter,) = world.result()["quarters"]
        assert (quarter["ts_min_day"], quarter["ts_max_day"]) == ("2026-07-10", "2026-09-15")
        # Bills fall on 07-10, 07-20, 08-01, 08-02, 08-03, 08-05..08-08 and 09-15. The quarter
        # is 07-01..09-30, so the longest quiet stretch is 08-09..09-14 = 23 + 14 = 37 days
        # (07-01..07-09 is 9, 07-21..07-31 is 11, 09-16..09-29 is 14).
        assert quarter["longest_billless_run"] == {"days": 37, "from": "2026-08-09", "to": "2026-09-14"}


class TestQuarterEdgeDaysEndToEnd:
    """D-15, end to end through ``dispatch()`` and the stateful RPC fake. OKX cuts a quarter
    file at 00:00 UTC+8, i.e. 16:00 UTC the day before, so a quarter-edge UTC day (06-30) is
    split between two files, and the last day of the newest quarter (09-30) is reached only
    until 16:00 UTC. A day counts only when the files on both sides were read; the founder
    approves a fingerprint on the days named here, so a partial day must be neither compared
    nor written."""

    GAP_EDGE = [{"from": "2026-06-25", "to": "2026-07-15", "recorded_at": "2026-10-10T00:00:00Z"}]

    @staticmethod
    def _files() -> tuple[bytes, bytes]:
        """A Q2 file and a Q3 file cut at 00:00 UTC+8. Q2 opens at 03-31 20:00Z and holds the
        first 10 hours of 06-30; Q3 holds the last 8 hours of 06-30 and the first 10 hours of 09-30."""
        q2 = _Bills(first_id=700_000_000)
        q2.realized("2026-03-31", "3", hour=20)
        for day, net in (("2026-04-02", "10"), ("2026-05-10", "20"), ("2026-06-20", "5")):
            q2.realized(day, net)
        q2.realized("2026-06-30", "5", hour=10)
        q3 = _standard_bills(opening=q2.closing(), first_id=800_000_000)
        q3.realized("2026-06-30", "7", hour=20)
        q3.realized("2026-09-30", "4", hour=10)
        return q2.bytes(), q3.bytes()

    @pytest.mark.asyncio
    async def test_a_utc_plus_8_q2_q3_pair_writes_06_30_whole_and_never_compares_or_writes_a_missing_edge_day(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-15. OKX cuts at 00:00 UTC+8, so 06-30 is split between the two files and is whole
        only with both; 09-30 reaches only until 16:00 UTC in Q3 and must never be compared
        against the live day (D-10), which sees all 24 hours, or written. A run that compared
        it would stop on a false reconcile_miss, and one that wrote a one-file day would
        publish a partial return."""
        q2, q3 = self._files()
        db = _db_with((STRATEGY_ID, self.GAP_EDGE))
        live = _standard_live()
        live.realized["2026-09-30"] = 10.0
        world = _install(monkeypatch, db, live, q2=q2, q3=q3)
        TestArchiveCompleteness._no_sleep(monkeypatch)
        quarters = TestArchiveCompleteness.QUARTERS_Q2_Q3

        outcome = await _run(_meta("calibrate", [STRATEGY_ID], quarters=quarters))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        result = world.result()
        assert [(q["ts_min_day"], q["ts_max_day"]) for q in result["quarters"]] == [
            ("2026-03-31", "2026-06-30"), ("2026-06-30", "2026-09-30"),
        ]
        assert result["census"]["edge_days"] == {
            "whole": ["2026-06-30"], "missing": ["2026-03-31", "2026-09-30"],
        }
        reconcile = result["reconcile"]
        assert reconcile["window"] == {"from": "2026-08-03", "to": "2026-09-29"}
        for leg in ("realized", "funding"):
            assert reconcile[leg]["ok"] is True
        assert reconcile["realized"]["days_compared"] == 58
        (strategy,) = result["strategies"]
        assert strategy["insert_days"] == 21
        assert strategy["insert_ranges"] == [{"from": "2026-06-25", "to": "2026-07-15"}]
        assert strategy["gaps_after"] == []
        _no_writes_but_progress(world, db)

        fingerprint = result["fingerprint"]
        _install(monkeypatch, db, live, q2=q2, q3=q3)
        applied = await _run(
            _meta("apply", [STRATEGY_ID], quarters=quarters, approved_fingerprint=fingerprint)
        )

        assert applied.outcome == DispatchOutcome.DONE, applied.error_message
        (call,) = _apply_calls(db)
        assert [r["date"] for r in call["p_rows"]] == _daterange("2026-06-25", "2026-07-15")
        assert call["p_expected_gaps_after"] == []
        assert "2026-06-30" in db.csv_days(STRATEGY_ID)

    @pytest.mark.asyncio
    async def test_an_edge_day_only_one_file_reaches_is_never_written_and_stays_in_the_gap(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-15 and TRADESYNC D-02. The Q3 file holds only the 8 hours of 06-30 after OKX's cut.
        Writing a return from them would publish a partial day as a whole one and silently drop
        the day from the gap the factsheet names. It must stay missing and named: out of
        ``p_rows``, out of ``csv_daily_returns`` and ``reconstructed_ranges``, and inside the
        stored ``unrecovered_gaps``. The file carries no 09-30 bill on purpose, so a wrongly
        covered 09-30 cannot stop the run first and hide this test's own assertions."""
        bills = _standard_bills()
        bills.realized("2026-06-30", "7", hour=20)
        db = _db_with((STRATEGY_ID, self.GAP_EDGE))
        live = _standard_live()
        world = _install(monkeypatch, db, live, q3=bills.bytes())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        result = world.result()
        assert result["census"]["edge_days"] == {"whole": [], "missing": ["2026-06-30", "2026-09-30"]}
        (strategy,) = result["strategies"]
        assert strategy["insert_days"] == 15
        assert strategy["insert_ranges"] == [{"from": "2026-07-01", "to": "2026-07-15"}]
        assert strategy["gaps_after"] == [{"from": "2026-06-25", "to": "2026-06-30"}]

        fingerprint = result["fingerprint"]
        _install(monkeypatch, db, live, q3=bills.bytes())
        applied = await _run(_meta("apply", [STRATEGY_ID], approved_fingerprint=fingerprint))

        assert applied.outcome == DispatchOutcome.DONE, applied.error_message
        (call,) = _apply_calls(db)
        assert [r["date"] for r in call["p_rows"]] == _daterange("2026-07-01", "2026-07-15")
        assert call["p_expected_gaps_after"] == [{"from": "2026-06-25", "to": "2026-06-30"}]
        assert "2026-06-30" not in db.csv_days(STRATEGY_ID)
        provenance = db.provenance(STRATEGY_ID)
        assert _norm(provenance["unrecovered_gaps"]) == [{"from": "2026-06-25", "to": "2026-06-30"}]
        assert [(r["from"], r["to"]) for r in provenance["reconstructed_ranges"]] == [
            ("2026-07-01", "2026-07-15")
        ]


def _nondigit_row(day: str) -> Callable[[int], str]:
    """A ``_Bills.raw`` line function: a SWAP subType-2 bill on ``day`` whose billId is the
    counter prefixed with ``x``, so it is not all digits. USDT, no effect at all, bal 5000."""

    def line(n: int) -> str:
        return (
            f"SWAP,x{n},2,{_ms_at(day, 12)},0,0,5000,0,,,USDT,0,0,"
            "cross,BTC-USDT-SWAP,,,,,,,,,,,,,"
        )

    return line


class TestUnchainableRowDiagnostic:
    """D-16. Calibrate run 3 stopped ``archive_incomplete cause=unchainable_row`` and the stop
    dropped which bills and how many, so the founder read an empty reading."""

    @pytest.mark.parametrize("mode", ["calibrate", "apply"])
    @pytest.mark.asyncio
    async def test_an_unchainable_stop_names_the_cause_split_the_rows_per_quarter_and_the_days(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, mode: str
    ) -> None:
        """D-16. Calibrate run 3 stopped here, and the stop dropped which bills and how many,
        so the founder could not tell a harmless blank line from a missing ccy on money or an
        id the chain cannot order. The OPTION row reaches the chain because OPTION is outside
        the live instTypes (``excluded_non_usd_rows``), while in a SWAP row a blank ccy with
        money stops ``non_usd_ccy`` first."""
        caplog.set_level(logging.DEBUG)
        db = _db_with((STRATEGY_ID, GAP_A))
        bills = _standard_bills().realized("2026-07-20", "1.5", inst="OPTION", ccy="")
        bills.raw(_nondigit_row("2026-09-01"))
        world = _install(monkeypatch, db, _standard_live(), q3=bills.bytes())
        extra = {"approved_fingerprint": "d" * 64} if mode == "apply" else {}

        outcome = await _run(_meta(mode, [STRATEGY_ID], **extra))

        assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "permanent"
        assert outcome.error_message == (
            "okx_archive_rebuild: archive_incomplete parse=archive_incomplete cause=unchainable_row "
            "rows=2 blank_ccy=1 nondigit_bill_id=1 first_day=2026-07-20 last_day=2026-09-01 "
            "rows_by_quarter=2026-Q3:2"
        )
        result = world.result()
        assert result["stop_class"] == "archive_incomplete"
        assert result["info"] == {
            "bal_chain": {
                "reason": "unchainable_row", "ccys": {}, "total_pairs": None,
                "rows": 2, "blank_ccy": 1, "nondigit_bill_id": 1,
                "first_day": "2026-07-20", "last_day": "2026-09-01",
                "files": [{
                    "ts_min_day": "2026-07-10", "ts_max_day": "2026-09-15", "rows": 2,
                    "blank_ccy": 1, "nondigit_bill_id": 1,
                    "first_day": "2026-07-20", "last_day": "2026-09-01",
                }],
                "floor": 2,
            }
        }
        everything = (outcome.error_message or "") + json.dumps(result) + caplog.text
        for forbidden in ("800000012", "x800000013", "5001.5", "1.75", *LINK_SECRETS):
            assert forbidden not in everything, f"leaked: {forbidden!r}"
        assert result["fingerprint"] is None
        assert db.apply_calls == 0
        _no_writes_but_progress(world, db)


class TestNonExternalPnlIsInTheLiveNumber:
    """WR-01. A liquidation transfer or forced repayment is not external capital (D-08), but a
    ``pnl`` and ``fee`` on it are inside the live aggregator's day total. The archive leg must
    include them or the two ledgers disagree by exactly that amount, and on gap days, where
    nothing reconciles, the rebuilt P&L silently differs from the method D-07 promises."""

    @pytest.mark.asyncio
    async def test_a_forced_repayment_with_pnl_and_fee_reconciles_against_the_live_day_that_includes_it(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _standard_live()
        live.realized["2026-09-15"] = 16.5  # 20 from the trade plus (-3.00 pnl, -0.50 fee)
        bills = _standard_bills()._row("SWAP", "114", "2026-09-15", "-3.5", "USDT", "-3", "-0.5")
        world = _install(monkeypatch, db, live, q3=bills.bytes())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        realized = world.result()["reconcile"]["realized"]
        assert realized["ok"] is True and realized["days_over_cent"] == 0
        assert realized["window_total_diff"] == "0"

    @pytest.mark.asyncio
    async def test_a_coin_denominated_forced_repayment_in_the_live_set_is_a_non_usd_stop(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        bills = _standard_bills()._row("SWAP", "114", "2026-07-11", "-0.001", "BTC", "-0.001", "0")
        world = _install(monkeypatch, db, _standard_live(), q3=bills.bytes())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message == "okx_archive_rebuild: non_usd_ccy parse=non_usd_ccy"
        assert world.result()["census"]["by_ccy"] == {"BTC": 1, "USDT": 11}
        _no_writes_but_progress(world, db)


class TestEvaluationStops:
    @pytest.mark.parametrize(
        ("mutate", "stop_class"),
        [
            (lambda live: setattr(live, "equity", None), "live_anchor_unusable"),
            (lambda live: setattr(live, "balance_error", True), "live_anchor_unusable"),
            (lambda live: setattr(live, "equity", 0.0), "live_anchor_unusable"),
            (lambda live: setattr(live, "upnl_unreadable", True), "live_anchor_unusable"),
        ],
        ids=["no-equity", "balance-error", "dust-equity", "unreadable-upnl"],
    )
    @pytest.mark.asyncio
    async def test_an_unusable_live_anchor_ends_failed_with_zero_writes(
        self, monkeypatch: pytest.MonkeyPatch, mutate: Callable[[_Live], None], stop_class: str
    ) -> None:
        """A rebuild rolls the NAV BACKWARD from today's equity. A heuristic base (a failed
        balance read, dust, a garbled uPnL) would put a wrong level under every rebuilt
        day, and the day would look fine. Refused, not guessed."""
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _standard_live()
        mutate(live)
        world = _install(monkeypatch, db, live, q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message is not None and outcome.error_message.startswith(
            f"okx_archive_rebuild: {stop_class}"
        )
        assert world.result()["stop_class"] == stop_class
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_an_identity_violation_from_the_rebuild_ends_failed_with_zero_writes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-12: prepending archive days must not move a live day. If the core ever
        disagrees the job stops; here the module's refusal is injected at the seam."""
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())

        def _violate(**_kwargs: Any) -> Any:
            raise okx_archive_job.RebuildRefused("identity_violation")

        monkeypatch.setattr(okx_archive_job, "rebuild_union", _violate)

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message == "okx_archive_rebuild: identity_violation"
        assert world.result()["stop_class"] == "identity_violation"
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_a_non_usd_ccy_stop_carries_the_per_ccy_census_and_writes_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Founder must-settle: a currency the live path would sum as dollars. The stop must
        hand the founder the per-currency counts in the result (the runbook reads
        `census.by_ccy`), never the amount."""
        db = _db_with((STRATEGY_ID, GAP_A))
        bills = _Bills().realized("2026-07-10", "10").realized("2026-07-11", "3", ccy="BTC")
        world = _install(monkeypatch, db, _standard_live(), q3=bills.bytes())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message == "okx_archive_rebuild: non_usd_ccy parse=non_usd_ccy"
        census = world.result()["census"]
        assert census is not None
        assert census["by_ccy"] == {"BTC": 1, "USDT": 1}
        assert census["by_sub_type"] == {"2": 2}
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_an_unknown_subtype_stop_carries_the_per_subtype_census(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        bills = _Bills().realized("2026-07-10", "10").raw(
            lambda n: f"SWAP,{n},9999,{_noon_ms('2026-07-11')},4,0,5000,0,,,USDT,4,0,cross,BTC-USDT-SWAP,,,,,,,,,,,,,"
        )
        world = _install(monkeypatch, db, _standard_live(), q3=bills.bytes())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message == "okx_archive_rebuild: unknown_subtype_nonzero parse=unknown_subtype_nonzero"
        census = world.result()["census"]
        assert census["by_sub_type"] == {"2": 1, "9999": 1}
        assert census["by_ccy"] == {"USDT": 2}
        _no_writes_but_progress(world, db)

    @pytest.mark.asyncio
    async def test_a_target_with_no_analytics_row_is_refused_before_anything_is_written(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(
            monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=(STRATEGY_ID, STRATEGY_2_ID)
        )
        fingerprint = "c" * 64

        outcome = await _run(_meta("apply", [STRATEGY_ID, STRATEGY_2_ID], approved_fingerprint=fingerprint))

        assert outcome.error_message == "okx_archive_rebuild: rpc_refused position=1 reason=no_analytics_row"
        assert db.apply_calls == 0

    @pytest.mark.asyncio
    async def test_a_malformed_stored_provenance_is_refused_not_guessed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        db.tables["strategy_analytics"][0]["series_provenance"]["unrecovered_gaps"] = [
            {"from": "2026-07-10", "to": "not-a-date"}
        ]
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.error_message == (
            "okx_archive_rebuild: rpc_refused position=0 reason=unrecovered_gaps_malformed"
        )
        _no_writes_but_progress(world, db)

    @pytest.mark.parametrize(
        "metadata",
        [
            {"rebuild_strategy_ids": [STRATEGY_ID, STRATEGY_ID]},
            {"zero_check_strategy_ids": [STRATEGY_ID]},
        ],
        ids=["duplicate-rebuild-target", "target-also-zero-checked"],
    )
    @pytest.mark.asyncio
    async def test_contradictory_target_lists_are_invalid_input(
        self, monkeypatch: pytest.MonkeyPatch, metadata: dict[str, Any]
    ) -> None:
        """A strategy listed twice would be rebuilt twice, and one that is both rebuilt and
        zero-checked contradicts D-03 (read-only on a strategy that is NOT rebuilt)."""
        world, db, _ = _standard(monkeypatch)
        outcome = await _run({"mode": "calibrate", "rebuild_strategy_ids": [STRATEGY_ID], **metadata})
        assert outcome.error_message == "okx_archive_rebuild: invalid_input"
        assert world.all_calls == []


class TestInformationNeverGates:
    @pytest.mark.asyncio
    async def test_stored_vs_core_disagreement_is_reported_and_changes_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`info.stored_vs_core` tells the founder whether the stored live series still
        matches what the derive would write today. A disagreement is information: the
        outcome, the rows and the fingerprint must be identical to a run with no disagreement."""
        agreeing = _db_with((STRATEGY_ID, GAP_A), csv=[
            _csv_row(STRATEGY_ID, "2026-08-02", 0.5),  # the first live day is never compared
            _csv_row(STRATEGY_ID, "2026-08-03", -50 / 10028.5),
            _csv_row(STRATEGY_ID, "2026-09-15", 21.5 / 9978.5),
        ])
        disagreeing = _db_with((STRATEGY_ID, GAP_A), csv=[
            _csv_row(STRATEGY_ID, "2026-08-03", -50 / 10028.5),
            _csv_row(STRATEGY_ID, "2026-09-15", 0.0301),  # 0.0021545... expected
        ])
        out: list[dict[str, Any]] = []
        for db in (agreeing, disagreeing):
            world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())
            outcome = await _run(_meta("calibrate", [STRATEGY_ID]))
            assert outcome.outcome == DispatchOutcome.DONE
            out.append(world.result())

        assert out[0]["info"]["stored_vs_core"] == {"days_compared": 2, "days_over_cent": 0, "first_offending": []}
        assert out[1]["info"]["stored_vs_core"] == {
            "days_compared": 2, "days_over_cent": 1, "first_offending": ["2026-09-15"]
        }
        assert out[0]["fingerprint"] == out[1]["fingerprint"]
        assert out[0]["strategies"] == out[1]["strategies"]

    @pytest.mark.asyncio
    async def test_excluded_classes_flows_and_bal_chain_are_reported_never_gated(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-09: excluded-class totals, archive-vs-live flow totals and `bal` continuity are
        information. An OPTION row's P&L and a flow the live side does not have must not stop
        the run, and must be visible. (The ``bal`` chain WAS information here; F1 made a break
        a gate, ``TestArchiveCompleteness``, and the gated chain's reading is the only one in
        ``info``.)"""
        db = _db_with((STRATEGY_ID, GAP_A))
        bills = (
            _Bills()
            .realized("2026-07-10", "10").realized("2026-08-01", "200").realized("2026-08-02", "97.5")
            .realized("2026-08-03", "-50").realized("2026-09-15", "20")
            .realized("2026-08-05", "0.02").realized("2026-08-06", "-0.02")
            .realized("2026-08-07", "0.03").realized("2026-08-08", "-0.03")
            .realized("2026-07-21", "7", inst="OPTION")
            .funding("2026-07-20", "-2").funding("2026-09-15", "1.5")
            .flow("2026-07-05", "1000").flow("2026-09-01", "250")
        )
        world = _install(monkeypatch, db, _standard_live(), q3=bills.bytes())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE, outcome.error_message
        result = world.result()
        assert result["excluded"] == {"excluded_by_month": {"2026-07": {"OPTION": "7"}}}
        info = result["info"]
        # One archive flow (09-01, +250) lies in the window; the live side has none.
        assert info["flow_totals_overlap"] == {"archive": "250", "live": "0"}
        assert set(info["bal_chain"]["ccys"]) == {"USDT"}
        assert info["bal_chain"]["ccys"]["USDT"]["pairs_checked"] > 0
        # Gap days with archive activity: 07-10 (realized), 07-20 (funding), 08-01 (realized).
        # The 07-05 flow is before the gap and the OPTION row is an excluded class, so of the
        # 23 gap days 3 are active and 20 are real quiet zeros.
        assert info["gap_days_active"] == 3 and info["gap_days_quiet"] == 20
        assert info["archive_only_in_live_reach"] == []

    @pytest.mark.asyncio
    async def test_archive_realized_balance_vs_rolled_nav_is_reported_with_a_diff(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A))
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        assert outcome.outcome == DispatchOutcome.DONE
        info = world.result()["info"]
        assert info["first_live_day_differs"] in (True, False)
        # The archive supplies the 23 gap days and the reach boundary day (08-02, owned by it).
        assert info["archive_days_prepended"] == GAP_DAY_COUNT + 1
        nav = info["realized_balance_vs_rolled_nav"]
        # The reading sits at the end of the reach boundary day, 08-02, the last archive-owned
        # day. nav_end(08-02) by the hand roll above is 10028.5 (10000 less the live days 08-03
        # -50, 09-15 +20 and funding +1.5). The archive balance is the file's running ``bal``
        # after its last bill on or before 08-02: 5000 + 10 (07-10) + 200 (08-01) + 97.5 (08-02)
        # = 5307.5, the 08-02 bill being the latest by ts. The two differ by exactly 4721.0.
        assert nav["day"] == "2026-08-02"
        assert nav["rolled_nav"] == "10028.5"
        assert nav["archive_balance_usd_family"] == "5307.5"
        assert nav["diff"] == "-4721"


class TestResultShape:
    """Result shape v1 paths plans 12, 14 and 15 and the runbook read. A rename is a contract
    change in all of them, so each path and type is pinned here."""

    LEG_KEYS = {"ok", "days_compared", "active_days", "max_abs_diff", "window_total_diff",
                "days_over_half_cent", "days_over_cent", "first_offending", "misses"}

    def _check_evaluation_keys(self, result: dict[str, Any], *, mode: str) -> None:
        assert set(result) == {
            "result_version", "mode", "stop_class", "account", "subtypes", "quarters", "census",
            "reconcile", "excluded", "info", "d03", "strategies", "fingerprint",
        }
        assert result["result_version"] == 1 and result["mode"] == mode
        reconcile = result["reconcile"]
        assert set(reconcile) == {"window", "excluded_boundary_day", "realized", "funding"}
        assert set(reconcile["window"]) == {"from", "to"}
        for leg in ("realized", "funding"):
            assert set(reconcile[leg]) == self.LEG_KEYS
            assert isinstance(reconcile[leg]["ok"], bool)
            assert isinstance(reconcile[leg]["days_compared"], int)
            assert isinstance(reconcile[leg]["days_over_half_cent"], int)
            assert isinstance(reconcile[leg]["days_over_cent"], int)
            assert isinstance(reconcile[leg]["max_abs_diff"], str)
            assert isinstance(reconcile[leg]["window_total_diff"], str)
            assert isinstance(reconcile[leg]["first_offending"], list)
        info = result["info"]
        assert set(info) == {
            "bal_chain", "flow_totals_overlap", "flow_seam", "realized_balance_vs_rolled_nav", "live_from",
            "first_live_day_differs", "archive_days_prepended", "gap_days_active",
            "gap_days_quiet", "archive_only_in_live_reach", "stored_vs_core",
        }
        assert isinstance(info["gap_days_active"], int) and isinstance(info["gap_days_quiet"], int)
        assert isinstance(info["archive_only_in_live_reach"], list)
        assert set(info["stored_vs_core"]) == {"days_compared", "days_over_cent", "first_offending"}
        assert set(info["flow_totals_overlap"]) == {"archive", "live"}
        assert isinstance(info["first_live_day_differs"], bool)
        assert set(result["excluded"]) == {"excluded_by_month"}
        for entry in result["strategies"]:
            assert set(entry) == {"position", "insert_days", "insert_ranges", "insert_returns",
                                  "gaps_before", "gaps_after", "apply_state", "rpc"}
            assert entry["apply_state"] in ("insert", "already_applied", "nothing_to_apply", "gap_delta")
            assert isinstance(entry["position"], int) and isinstance(entry["insert_days"], int)
            assert all(set(r) == {"from", "to"} for r in entry["insert_ranges"])
        assert isinstance(result["fingerprint"], str) and HEX64.fullmatch(result["fingerprint"])
        json.dumps(result)  # plain JSON: no Decimal, no datetime

    @pytest.mark.asyncio
    async def test_a_clean_calibrate_result_carries_every_evaluation_path_with_its_type(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = _db_with((STRATEGY_ID, GAP_A), (STRATEGY_2_ID, None), csv=[_csv_row(STRATEGY_2_ID, "2026-07-15", 0.0)])
        world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3(), targets=(STRATEGY_ID, STRATEGY_2_ID))

        outcome = await _run(_meta("calibrate", [STRATEGY_ID], zero_check_strategy_ids=[STRATEGY_2_ID]))

        assert outcome.outcome == DispatchOutcome.DONE
        result = world.result()
        self._check_evaluation_keys(result, mode="calibrate")
        assert result["d03"] == {"checked_days": 1, "hits": []}
        assert all(s["rpc"] is None for s in result["strategies"])

    @pytest.mark.asyncio
    async def test_a_clean_apply_result_carries_every_path_and_a_status_per_target(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fingerprint = await _calibrate_fingerprint(monkeypatch)
        world, db, _ = _standard(monkeypatch)

        outcome = await _run(_meta("apply", [STRATEGY_ID], approved_fingerprint=fingerprint))

        assert outcome.outcome == DispatchOutcome.DONE
        result = world.result()
        self._check_evaluation_keys(result, mode="apply")
        assert result["d03"] is None
        assert [s["rpc"]["status"] for s in result["strategies"]] in (["applied"], ["already_applied"])
        assert all(set(s["rpc"]) == {"status", "error_class"} for s in result["strategies"])

    @pytest.mark.asyncio
    async def test_a_d03_hit_carries_the_hit_shape(self, monkeypatch: pytest.MonkeyPatch) -> None:
        db = _db_with((STRATEGY_ID, GAP_A), (STRATEGY_2_ID, None), csv=[_csv_row(STRATEGY_2_ID, "2026-07-15", 0.0)])
        world = _install(
            monkeypatch, db, _standard_live(), q3=_standard_q3(realized={"2026-07-15": "2.5"}),
            targets=(STRATEGY_ID, STRATEGY_2_ID),
        )
        await _run(_meta("calibrate", [STRATEGY_ID], zero_check_strategy_ids=[STRATEGY_2_ID]))
        (hit,) = world.result()["d03"]["hits"]
        assert set(hit) == {"date", "stored_return", "archive_realized", "archive_funding"}
        assert isinstance(hit["stored_return"], float) and isinstance(hit["archive_realized"], str)


class TestNeverEnqueuesAndNeverLeaks:
    def test_the_job_never_calls_enqueue_compute_job(self) -> None:
        """D-07: the rebuilt rows join the next derive-then-compute chain or the Wave 5
        consolidated recompute. A worker that enqueued analytics itself would publish a
        changed headline at a moment the founder did not choose."""
        with open(okx_archive_job.__file__, encoding="utf-8") as handle:
            code = [ln for ln in handle.read().splitlines() if not ln.lstrip().startswith("#")]
        assert [ln for ln in code if "enqueue_compute_job" in ln] == []

    @pytest.mark.asyncio
    async def test_a_whole_calibrate_and_apply_never_enqueue_anything(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Behavioural twin of the source check: across a calibrate and an apply the only
        RPCs ever called are the progress write and the one apply RPC."""
        fingerprint = await _calibrate_fingerprint(monkeypatch)
        world, db, _ = _standard(monkeypatch)
        await _run(_meta("apply", [STRATEGY_ID], approved_fingerprint=fingerprint))
        assert {n for n, _ in db.rpcs} == {PROGRESS, APPLY_RPC}

    @pytest.mark.asyncio
    async def test_no_amount_reaches_a_log_or_last_error_on_any_path(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """T-167.1.2.2.2.1-22: amounts live only in the database result object. Run the
        miss path (which knows exactly which amounts disagree) and read everything that
        left the job."""
        caplog.set_level(logging.DEBUG)
        db = _db_with((STRATEGY_ID, GAP_A))
        live = _standard_live()
        live.realized["2026-09-15"] = 20.011
        world = _install(monkeypatch, db, live, q3=_standard_q3())

        outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

        leaked = caplog.text + (outcome.error_message or "")
        for amount in ("20.011", "0.011", "97.5", "9728.5", "10000"):
            assert amount not in leaked, f"{amount} leaked"
        assert world.result()["stop_class"] == "reconcile_miss"
