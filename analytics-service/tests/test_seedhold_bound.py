"""Phase 257 SEEDHOLD plan 01: the seed-hold gate, measured on unmodified code.

Two review survivors of Phase 255 NULLANCHOR, both in `run_sync_trades_job`:
`[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` (the next run's fills seed lands past a span the
re-read bound RPC never recorded, because other writers kept storing daily rows) and
`[255-BYBIT-DEADLINE-NO-PROGRESS]` (a Bybit read that hits its deadline keeps nothing, so every
refusal lowers the bound by the overlap and the next run walks the same span again).

SC-1 AS ASSERTED HERE. After run 1's `set_strategy_fills_reread_bound` write failed, run 2's walk
start is at or before run 1's walk start (run 1's seed minus `OVERLAP_WINDOW_MS`, or the venue's
reach anchor on a first sync), whatever daily row a cron-style writer stored in between. That
implies the ROADMAP wording "at or before run 1's seed". Every arm drives the REAL
`run_sync_trades_job` through `tests/test_okxtrades_cursor.py::_run_job`, once per run, carrying
the moved daily row, the column (through `column_after_advance`, the forward-only column RPC), the
one bound store, the flags and the persisted fills from run to run. The outcome is run 2's
`since_ms`, never a stamp or a flag. A failed run's message begins `SEEDHOLD-WALK-START`.

WHY `persistent` AND `once` BOTH EXIST (RESEARCH Pitfall 1). A single failed provisional write is
repaired by the epilogue write that follows it seconds later (the run skips its read, so the
epilogue runs almost at once). So the `once` arms are regression pins and the `persistent` arms
(the RPC down for the whole of run 1, as a missing function after a rollback or a not-yet-applied
migration would be) are the gate.

THE HOME OF THE SPAN. Founder ruling 2026-11-28 (AskUserQuestion), verbatim choice: "Job's private
record (Recommended)". The seed-hold mark is written into the RUNNING job's own
`compute_jobs.metadata` through one claim-token-fenced merge RPC, `set_compute_job_seed_hold`
(params `p_job_id`, `p_claim_token`, `p_floor_ms`, metadata key `seed_hold_ms`), and the next run
reads it at seed time as a further seed term. The fake below (`JobsStore`) models the SQL fence
exactly: the row must be `running` and carry a non-NULL, equal claim token.

HAND-OFF SHAPES (RESEARCH "C4 hand-off measurement"; OKX and Bybit, set column and first sync).
  A  a newer `failed_final` row with no mark lands after run 1.
  B  an intervening run finishes `done` with the bound RPC still down and its `compute_jobs` read
     failing.
  C  the same intervening run, but the seed-hold write ALSO fails: the named double-fault
     residual. On a set column it stays RED after the fix (the intervening `done` row carries no
     mark and a set column takes no anchor), so those two arms carry a permanent strict marker.
     On a first sync the intervening run's Phase 232 bootstrap anchor follows the lowered seed
     into the NULL column, so the arm is predicted GREEN after the fix. The column is carried
     through EVERY run (run 1, the intervening run, run 2), as production carries it.

RETRY ARMS (an addition found at planning). An attempt that wrote its mark and then failed on the
unguarded balance read is re-claimed on the SAME job row (`failed_retry`, the claim merges
metadata and keeps it) after a daily row lands; the walk start must stay at or before attempt 1's.

HOW IT WAS MEASURED. Every arm was run once UNMARKED on the unmodified code, that run was saved,
and it is recorded verbatim in the 257-01 SUMMARY. The arms RED on unmodified code carry a strict
expected-failure marker that accepts only an AssertionError: `RED_AT_HEAD_HOLD` and
`RESIDUAL_DOUBLE_FAULT` (permanent). `RED_AT_HEAD_BYBIT` was removed with the seven Bybit deadline
arms' fix (plan 03), and `RED_AT_HEAD_HOLD` with the seed-hold fix (plan 04, which re-measured the
two first-sync hand-off C arms GREEN: only the two set-column C arms still fail, and keep the
permanent marker). An arm GREEN at HEAD carries no marker and stays as a
regression pin. A strict marker reports an unexpected pass as a failure, so a fix landing without
its marker's removal cannot go unnoticed. The NEUTER block at the end of this docstring is plan 05's.

Every instant is hand-typed with its ISO, never computed by the code under test:

    1784116800000  2026-07-15T12:00:00+00:00  the pinned clock (NOW_MS)
    1778112000000  2026-05-07T00:00:00+00:00  run 1's seed on DAILY_ONLY_TRADES (RUN1_SEED_MS)
    1778108400000  2026-05-06T23:00:00+00:00  run 1's walk start (the seed minus the overlap)
    1781913600000  2026-06-20T00:00:00+00:00  CURSOR_AHEAD_TS, the set column (no stored fill)
    1783987200000  2026-07-14T00:00:00+00:00  the cron-style daily row stored between the runs
    3600000        OVERLAP_WINDOW_MS
    first-sync reach anchors under the pinned clock (run 1's walk start on a first sync):
        Binance 1776772800000 (2026-04-21T12:00:00Z, now minus 85 days)
        OKX     1776081600000 (2026-04-13T12:00:00Z, now minus 93 days)
        Bybit   1752580800000 (2025-07-15T12:00:00Z, now minus 365 days)
        Deribit 0             (1970-01-01T00:00:00Z)

NEUTER (PROOF-01; each recorded verbatim in the 257-05 SUMMARY, restored with cp from a byte backup and checked with cmp).
Test ids are shortened to their parameter: `Matrix[x]` is `TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[x]`,
`HandOff[x]` is `TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[x]`, `Retry[x]` is
`TestSeedHoldRetry::test_a_retried_attempt_keeps_attempt_one_hold[x]`, `Mech::name` is `TestSeedHoldMechanism::name`,
`Bybit[x]` is a `TestBybitDeadlineKeepsWhatItRead` arm with that parameter.
  B1 in `services/exchange.py`, `refusal.completed_fills = _dedup_on_exec_id(completed_rows)` becomes
     `refusal.completed_fills = []` (a deadline refusal carries no fills): Bybit[two-windows] and
     Bybit[stop-after-two-windows-set] go RED.
  B2 in `services/exchange.py`, `completed_through[0] = req.window_end` becomes `completed_through[0] = None`
     (the completed window's end is never recorded): Bybit[two-windows] and Bybit[stop-after-two-windows-set] go RED.
  B3 in `services/exchange.py`, `if not items or not next_cursor:` becomes `if True:` (a window counts complete
     after any page; dropping only the cursor half bites nothing, because each window's empty page 2 still satisfies
     `not items`): Bybit[stop-after-two-windows-set] goes RED (window 3's fills are persisted).
  B4 in `services/job_worker.py`, `elif _bybit_deadline_stop and not _fills_persist_failed:` becomes `elif False:`
     (the bound creeps by the overlap again): Bybit[stop-inside-first-window-set] and
     Bybit[stop-after-two-windows-set] go RED.
  B5 in `services/job_worker.py`, `and (not phase2_failed or _bybit_partial_ok)` becomes `and (not phase2_failed)`
     (no stamp after a deadline stop): Bybit[stop-after-two-windows-set] goes RED.
  B6 in `services/job_worker.py`, `_fills_persist_failed = True` becomes `pass` (a failed persist batch no longer
     holds the bound at the walk start): Bybit[persist-fails-after-stop-set] goes RED.
  B7 in `services/job_worker.py`, `phase2_failed = False` is added after `_bybit_read_through_ms = e.read_through_ms`
     (a deadline stop reads as a clean run): Bybit[stop-after-two-windows-set] and
     Bybit[stop-inside-first-window-set] go RED (on the missing flag upsert, as an IndexError out of `_stamped_flag`).
  B8 in `services/exchange.py`, `BYBIT_SYNC_FILLS_READ_DEADLINE_S: float = 420.0` becomes `840.0`:
     `test_the_bybit_sync_budget_leaves_the_persist_margin` and
     `test_nullanchor_bound.py::TestBybitReadDeadline::test_the_bybit_read_gets_the_handler_budget_remaining[bybit-320.0]`
     go RED.
  H1 in `services/job_worker.py`, `_hold_owned = await db_execute(_write_seed_hold)` becomes `_hold_owned = True`
     (the seed-hold RPC is never called): Matrix[okx-set-persistent], Matrix[bybit-first-persistent],
     Matrix[binance-set-persistent] and Matrix[deribit-first-persistent] go RED.
  H2 in `services/job_worker.py`, `if _hold_terms and min(_hold_terms) < fills_since_ms:` becomes `if False:`
     (the mark never lowers the seed): the same four Matrix arms go RED.
  H3 in `services/trade_resume.py`, `.eq("status", "done")` becomes `.in_("status", ["done", "failed_final"])`
     (research V1: a failed row's mark is read, and a newer failed row hides the done row's): HandOff[okx-set-A]
     and HandOff[bybit-first-A] go RED.
  H4 (the SQL fence predicate in migration 20261128120000) is recorded in the 257-02 SUMMARY, not re-run here.
  H5 in `services/job_worker.py`, `min(_reach_anchor_ms, _provisional_unread_ms)` becomes `_provisional_unread_ms`
     (the fail-safe floor when the hold read failed): HandOff[okx-set-B], HandOff[bybit-set-B],
     Mech::test_a_failed_hold_read_writes_the_reach_anchor[okx] and [bybit] go RED.
  H6 in `services/job_worker.py`, `if isinstance(_own_meta, dict) and SEED_HOLD_KEY in _own_meta:` becomes
     `if False:` (the claimed row's own mark is never read, with no side effect on `_hold_read_failed`):
     Retry[okx-retry-rpc-up] and Retry[bybit-retry-rpc-down] go RED.
  H7 in `services/job_worker.py`, the provisional write's `else:` (the line before `if not _bound_owned:`) gains a
     copy of the seed-hold RPC call (a successful bound write also leaves a mark):
     Mech::test_a_clean_run_writes_no_seed_hold[okx] goes RED.
  P1 (the Phase 232 bootstrap anchor stamp) `elif (phase2_failed or _fills_incomplete) and fills_anchor_iso is not
     None:` becomes `elif False:`, together with H1's edit: Matrix[okx-nullseed-persistent] and
     Matrix[binance-nullseed-persistent] go RED.
  P2 (the epilogue bound write) `if not await db_execute(lambda: _set_bound(_unread_from_ms, _covers_from_iso)):`
     becomes `if not True:`, together with H1's edit: Matrix[okx-set-once], Matrix[bybit-first-once] and
     Matrix[binance-set-once] go RED.
  P3 (the Phase 250 CR-01 Binance reach anchor) `elif ctx.key_row.get("exchange") == "binance":` becomes
     `elif False:`, together with H1's edit: Matrix[binance-first-persistent] goes RED.
  WHY EACH P NEUTER PAIRS WITH H1. After plan 04 the seed-hold mark is a second protection for every pin family, so
  removing a P mechanism alone leaves its arms GREEN by design (measured: P1, P2 and P3 alone all pass). That is
  redundancy, not a missing bite; the pair shows the arm can fail when both protections are gone.
"""
from __future__ import annotations

import contextlib
import copy
import itertools
import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any, NamedTuple
from unittest.mock import MagicMock, patch

import pytest

from services import exchange as ex
from services import job_worker as jw
from services import trade_resume as tr
from services.job_worker import run_sync_trades_job as _real_run_sync_trades_job
from tests._binance_fills import RereadBounds, column_after_advance
from tests.test_binancefills_cursor import _persisted_fills, _two_run_walk_start_ms
from tests.test_okxtrades_cursor import (
    CURSOR_AHEAD_TS,
    DAILY_ONLY_TRADES,
    STRATEGY_ID,
    _make_supabase,
    _Outcome,
    _Recorder,
    _run_job,
    _the_advance,
)

NOW_MS = 1784116800000  # 2026-07-15T12:00:00Z
RUN1_SEED_MS = 1778112000000  # 2026-05-07T00:00:00Z
RUN1_WALK_MS = 1778108400000  # 2026-05-06T23:00:00Z, the seed minus the 1 h overlap
# First-sync reach anchors under the pinned clock (run 1's walk start on a first sync).
REACH_ANCHOR_MS = {
    "binance": 1776772800000,  # 2026-04-21T12:00:00Z, now minus 85 days
    "okx": 1776081600000,  # 2026-04-13T12:00:00Z, now minus 93 days
    "bybit": 1752580800000,  # 2025-07-15T12:00:00Z, now minus 365 days
    "deribit": 0,  # 1970-01-01T00:00:00Z
}
DAILY_MOVED: dict[str, Any] = {
    "strategy_id": STRATEGY_ID,
    "is_fill": False,
    "timestamp": "2026-07-14T00:00:00+00:00",  # 1783987200000
}
# The daily series run 1's Phase 1 would store (makes the `sync_trades` RPC fire when it is not held).
DAILY_TRADES_RUN1: list[dict[str, Any]] = [{"date": "2026-07-14", "daily_pnl": 1.0}]
SEED_HOLD_RPC_NAME = "set_compute_job_seed_hold"
SEED_HOLD_KEY_NAME = "seed_hold_ms"


@pytest.fixture(autouse=True)
def _pinned_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    # tests/test_okxtrades_cursor.py pins no clock, and every reach anchor depends on it.
    monkeypatch.setattr(ex, "_now_ms", lambda: NOW_MS)


# Marker, applied by id (257-04): the one permanent expected failure, classified by measurement.
RESIDUAL_DOUBLE_FAULT = pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason=(
        "named residual [257-SEEDHOLD-DOUBLE-FAULT] (CONTEXT criterion (d); MEDIUM, data-integrity, "
        "booked in TODOS.md at ship per the founder ruling of 2026-11-28): the bound RPC down AND "
        "the seed-hold write failing in one run loses the span on a set column and hides any "
        "earlier mark"
    ),
)


class FlakyBounds(RereadBounds):
    """A bound store whose RPC raises while `fail_next` is positive (decrementing it per call),
    and otherwise behaves exactly like `RereadBounds`. `persistent` is a counter large enough to
    outlast a run; `once` is 1. Every call's payload lands in `calls`, raised or not."""

    def __init__(self, fail_next: int = 0) -> None:
        super().__init__()
        self.fail_next = fail_next

    def rpc(self, payload: dict[str, Any]) -> MagicMock:
        parent = super().rpc(payload)

        def _execute() -> Any:
            if self.fail_next > 0:
                self.fail_next -= 1
                self.calls.append(dict(payload))
                raise RuntimeError("bound rpc unavailable")
            return parent.execute()

        return MagicMock(execute=_execute)


PERSISTENT = 99


class JobsStore:
    """A stateful stand-in for `compute_jobs` and the seed-hold RPC.

    `seq` stands in for `created_at` (an increasing integer) and `claimed_at` for the claim RPC's
    `now()` stamp (a second increasing integer, re-stamped by every claim, retries included).
    `rpc` models the fence of
    `set_compute_job_progress` exactly: the row with `id == p_job_id` must be `running` and carry a
    non-NULL claim token equal to `p_claim_token`; on a match `{seed_hold_ms: p_floor_ms}` is
    MERGED into that row's metadata and the answer is True, otherwise False and nothing changes."""

    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []
        self._seq = itertools.count(1)
        self._claim_clock = itertools.count(1)
        self.read_error: Exception | None = None
        self.rpc_error: Exception | None = None
        self.reads = 0
        self.rpc_calls: list[dict[str, Any]] = []

    def _add(self, job_id: str, status: str, token: str | None, metadata: dict[str, Any]) -> None:
        self.rows.append(
            {
                "id": job_id,
                "strategy_id": STRATEGY_ID,
                "kind": "sync_trades",
                "status": status,
                "claim_token": token,
                "seq": next(self._seq),
                "claimed_at": next(self._claim_clock),
                "metadata": copy.deepcopy(metadata),
            }
        )

    def row(self, job_id: str) -> dict[str, Any]:
        return next(r for r in self.rows if r["id"] == job_id)

    def start(self, job_id: str, token: str) -> None:
        """What the claim RPC leaves: a running row carrying the claimed token."""
        self._add(job_id, "running", token, {})

    def finish(self, job_id: str, status: str) -> None:
        self.row(job_id)["status"] = status

    def add_row(self, job_id: str, status: str, metadata: dict[str, Any]) -> None:
        self._add(job_id, status, None, metadata)

    def reclaim(self, job_id: str, token: str) -> None:
        """The claim RPC re-claiming a retried row: a new token, the metadata kept (it merges)."""
        row = self.row(job_id)
        row["status"] = "running"
        row["claim_token"] = token
        row["claimed_at"] = next(self._claim_clock)

    def rpc(self, payload: dict[str, Any]) -> MagicMock:
        def _execute() -> MagicMock:
            self.rpc_calls.append(dict(payload))
            if self.rpc_error is not None:
                raise self.rpc_error
            token = payload["p_claim_token"]
            for row in self.rows:
                if (
                    row["id"] == payload["p_job_id"]
                    and row["status"] == "running"
                    and row["claim_token"] is not None
                    and row["claim_token"] == token
                ):
                    row["metadata"] = {**row["metadata"], SEED_HOLD_KEY_NAME: payload["p_floor_ms"]}
                    return MagicMock(data=True)
            return MagicMock(data=False)

        return MagicMock(execute=_execute)

    def table(self) -> "_JobsQuery":
        return _JobsQuery(self)


class _JobsQuery:
    """`select(...).eq(...).in_(...).order(col, desc=...).limit(n).execute()` over `JobsStore.rows`."""

    def __init__(self, store: JobsStore) -> None:
        self._store = store
        self._eq: list[tuple[str, Any]] = []
        self._in: list[tuple[str, list[Any]]] = []
        self._order: tuple[str, bool] | None = None
        self._limit: int | None = None

    def select(self, *_a: Any, **_k: Any) -> "_JobsQuery":
        return self

    def eq(self, col: str, val: Any) -> "_JobsQuery":
        self._eq.append((col, val))
        return self

    def in_(self, col: str, values: list[Any]) -> "_JobsQuery":
        self._in.append((col, list(values)))
        return self

    def order(self, col: str, desc: bool = False) -> "_JobsQuery":
        self._order = ("seq" if col == "created_at" else col, desc)
        return self

    def limit(self, n: int) -> "_JobsQuery":
        self._limit = n
        return self

    def execute(self) -> MagicMock:
        self._store.reads += 1
        if self._store.read_error is not None:
            raise self._store.read_error
        matched = [
            r
            for r in self._store.rows
            if all(r.get(c) == v for c, v in self._eq)
            and all(r.get(c) in vs for c, vs in self._in)
        ]
        if self._order is not None:
            col, desc = self._order
            matched.sort(key=lambda r: r[col], reverse=desc)
        if self._limit is not None:
            matched = matched[: self._limit]
        return MagicMock(data=[copy.deepcopy(r) for r in matched])


def _wire(sb: MagicMock, jobs: JobsStore) -> MagicMock:
    """Route `table("compute_jobs")` and the seed-hold RPC to `jobs`; every other name goes to the
    originals `_make_supabase` installed. Edits no existing helper."""
    orig_table = sb.table.side_effect
    orig_rpc = sb.rpc.side_effect

    def _table(name: str) -> Any:
        if name == "compute_jobs":
            return jobs.table()
        return orig_table(name)

    def _rpc(name: str, payload: dict[str, Any]) -> Any:
        if name == SEED_HOLD_RPC_NAME:
            return jobs.rpc(payload)
        return orig_rpc(name, payload)

    sb.table.side_effect = _table
    sb.rpc.side_effect = _rpc
    return sb


@contextlib.contextmanager
def _as_job(jobs: JobsStore, job_id: str, token: str) -> Iterator[None]:
    """Give the next `_run_job` a distinct job identity and the claimed row's metadata, as the real
    claim RPC's RETURNING row carries (RESEARCH Pitfall 6: one hard-coded id would hide run 1's
    mark from run 2). `_run_job` resolves `run_sync_trades_job` from its own module at call time."""

    async def _wrapper(job: dict[str, Any]) -> Any:
        return await _real_run_sync_trades_job(
            {
                **job,
                "id": job_id,
                "claim_token": token,
                "metadata": copy.deepcopy(jobs.row(job_id)["metadata"]),
            }
        )

    with patch("tests.test_okxtrades_cursor.run_sync_trades_job", new=_wrapper):
        yield


class _Run(NamedTuple):
    out: _Outcome | None
    rec: _Recorder
    sb: MagicMock
    stamp: str | None
    column_after: str | None


async def _run(
    *,
    venue: str,
    jobs: JobsStore,
    bounds: RereadBounds,
    flags: dict[str, Any],
    rows: list[dict[str, Any]],
    column: str | None,
    job_id: str,
    token: str,
    start: bool = True,
    expect_raises: type[BaseException] | None = None,
    **job_kwargs: Any,
) -> _Run:
    """One REAL `run_sync_trades_job`. `start` appends the running row the claim RPC would leave,
    so the fake fence finds it exactly as production does (a retry re-claims instead)."""
    if start:
        jobs.start(job_id, token)
    sb, rec = _make_supabase(trades_rows=rows, bounds=bounds, flags=flags)
    _wire(sb, jobs)
    out: _Outcome | None = None
    with _as_job(jobs, job_id, token):
        if expect_raises is None:
            out = await _run_job(supabase=sb, column=column, exchange=venue, **job_kwargs)
        else:
            with pytest.raises(expect_raises):
                await _run_job(supabase=sb, column=column, exchange=venue, **job_kwargs)
    stamp = rec.advance_params[0]["p_last_fetched_ts"] if rec.advance_params else None
    return _Run(out, rec, sb, stamp, column_after_advance(column, stamp))


def _rpc_names(sb: MagicMock) -> list[str]:
    return [c.args[0] for c in sb.rpc.call_args_list]


def _rows_and_column(state: str) -> tuple[list[dict[str, Any]], str | None]:
    if state == "set":
        return list(DAILY_ONLY_TRADES), CURSOR_AHEAD_TS
    if state == "first":
        return [], None
    if state == "nullseed":
        return list(DAILY_ONLY_TRADES), None
    raise AssertionError(f"unknown state {state!r}")


def _run1_walk_ms(venue: str, state: str) -> int:
    """Run 1's walk start: the seed minus the overlap on a seeded run, the reach anchor on a first sync."""
    return REACH_ANCHOR_MS[venue] if state == "first" else RUN1_WALK_MS


def _premise_run1(r1: _Run, label: str) -> None:
    assert r1.out is not None
    assert r1.out.fetch_raw.call_count == 0, (
        f"SEEDHOLD-PREMISE: {label}: run 1 must have skipped its fills read (the provisional "
        "bound write failed)"
    )
    assert "sync_trades" not in _rpc_names(r1.sb), (
        f"SEEDHOLD-PREMISE: {label}: run 1 must have held its daily store (a stored daily row "
        "would move the seed by itself)"
    )


def _verdict(label: str, out2: _Outcome | None, walk_ms: int) -> None:
    assert out2 is not None
    since = out2.fetch_raw.call_args.kwargs["since_ms"]
    assert since is not None, (
        f"SEEDHOLD-PREMISE: {label}: the moved daily row guarantees run 2 a seed; a None would "
        "make the walk-start measure pass vacuously"
    )
    assert _two_run_walk_start_ms(out2) <= walk_ms, (
        f"SEEDHOLD-WALK-START: {label}: run 2 walked from since_ms={since} "
        f"(walk start {_two_run_walk_start_ms(out2)}), after run 1's walk start {walk_ms}"
    )


# ---- SC-1: the 24-arm matrix --------------------------------------------------------------------

_MATRIX_PARAMS = [
    pytest.param("binance", "set", "persistent", id="binance-set-persistent"),
    pytest.param("binance", "first", "persistent", id="binance-first-persistent"),
    pytest.param("binance", "nullseed", "persistent", id="binance-nullseed-persistent"),
    pytest.param("binance", "set", "once", id="binance-set-once"),
    pytest.param("binance", "first", "once", id="binance-first-once"),
    pytest.param("binance", "nullseed", "once", id="binance-nullseed-once"),
    pytest.param("okx", "set", "persistent", id="okx-set-persistent"),
    pytest.param("okx", "first", "persistent", id="okx-first-persistent"),
    pytest.param("okx", "nullseed", "persistent", id="okx-nullseed-persistent"),
    pytest.param("okx", "set", "once", id="okx-set-once"),
    pytest.param("okx", "first", "once", id="okx-first-once"),
    pytest.param("okx", "nullseed", "once", id="okx-nullseed-once"),
    pytest.param("bybit", "set", "persistent", id="bybit-set-persistent"),
    pytest.param("bybit", "first", "persistent", id="bybit-first-persistent"),
    pytest.param("bybit", "nullseed", "persistent", id="bybit-nullseed-persistent"),
    pytest.param("bybit", "set", "once", id="bybit-set-once"),
    pytest.param("bybit", "first", "once", id="bybit-first-once"),
    pytest.param("bybit", "nullseed", "once", id="bybit-nullseed-once"),
    pytest.param("deribit", "set", "persistent", id="deribit-set-persistent"),
    pytest.param("deribit", "first", "persistent", id="deribit-first-persistent"),
    pytest.param("deribit", "nullseed", "persistent", id="deribit-nullseed-persistent"),
    pytest.param("deribit", "set", "once", id="deribit-set-once"),
    pytest.param("deribit", "first", "once", id="deribit-first-once"),
    pytest.param("deribit", "nullseed", "once", id="deribit-nullseed-once"),
]


class TestSeedHoldMatrix:
    @pytest.mark.parametrize("venue,state,mode", _MATRIX_PARAMS)
    async def test_run2_walks_at_or_before_run1_walk_start(
        self, venue: str, state: str, mode: str
    ) -> None:
        rows, column = _rows_and_column(state)
        bounds = FlakyBounds(PERSISTENT if mode == "persistent" else 1)
        jobs, flags = JobsStore(), {}
        label = f"{venue} {state} {mode}"
        r1 = await _run(
            venue=venue, jobs=jobs, bounds=bounds, flags=flags, rows=rows, column=column,
            job_id="job-run1", token="tok-run1", daily_trades=DAILY_TRADES_RUN1,
        )
        _premise_run1(r1, label)
        jobs.finish("job-run1", "done")

        bounds.fail_next = 0  # the RPC recovers
        r2 = await _run(
            venue=venue, jobs=jobs, bounds=bounds, flags=flags,
            rows=[*rows, DAILY_MOVED, *_persisted_fills(r1.rec, STRATEGY_ID)],
            column=r1.column_after, job_id="job-run2", token="tok-run2",
        )
        _verdict(label, r2.out, _run1_walk_ms(venue, state))


# ---- the hand-off arms: an intervening row or run never hides run 1's hold ----------------------

_HANDOFF_PARAMS = [
    pytest.param("okx", "set", "A", id="okx-set-A"),
    pytest.param("okx", "set", "B", id="okx-set-B"),
    pytest.param("okx", "set", "C", marks=RESIDUAL_DOUBLE_FAULT, id="okx-set-C"),
    pytest.param("okx", "set", "D", id="okx-set-D"),
    pytest.param("okx", "first", "A", id="okx-first-A"),
    pytest.param("okx", "first", "B", id="okx-first-B"),
    pytest.param("okx", "first", "C", id="okx-first-C"),
    pytest.param("okx", "first", "D", id="okx-first-D"),
    pytest.param("bybit", "set", "A", id="bybit-set-A"),
    pytest.param("bybit", "set", "B", id="bybit-set-B"),
    pytest.param("bybit", "set", "C", marks=RESIDUAL_DOUBLE_FAULT, id="bybit-set-C"),
    pytest.param("bybit", "set", "D", id="bybit-set-D"),
    pytest.param("bybit", "first", "A", id="bybit-first-A"),
    pytest.param("bybit", "first", "B", id="bybit-first-B"),
    pytest.param("bybit", "first", "C", id="bybit-first-C"),
    pytest.param("bybit", "first", "D", id="bybit-first-D"),
]


class TestSeedHoldHandOff:
    @pytest.mark.parametrize("venue,state,shape", _HANDOFF_PARAMS)
    async def test_an_intervening_row_never_hides_run1_hold(
        self, venue: str, state: str, shape: str
    ) -> None:
        rows, column = _rows_and_column(state)
        bounds = FlakyBounds(PERSISTENT)
        jobs, flags = JobsStore(), {}
        label = f"{venue} {state} {shape}"
        r1 = await _run(
            venue=venue, jobs=jobs, bounds=bounds, flags=flags, rows=rows, column=column,
            job_id="job-run1", token="tok-run1", daily_trades=DAILY_TRADES_RUN1,
        )
        _premise_run1(r1, label)
        jobs.finish("job-run1", "done")

        carried_rows = [*rows, DAILY_MOVED]  # the cron-style writer, right after run 1
        carried_column = r1.column_after
        if shape == "A":
            jobs.add_row("job-mid", "failed_final", {})
        else:
            # An intervening real run. B: the bound RPC still down and its `compute_jobs` read
            # fails. C: the bound RPC still down and its seed-hold write fails (the named double
            # fault). D (review WR-01): the bound RPC has RECOVERED and its `compute_jobs` read
            # fails once, so it writes no mark of its own and its clean epilogue would clear the
            # bound: the seed itself must drop to the reach anchor.
            bounds.fail_next = 0 if shape == "D" else PERSISTENT
            if shape in ("B", "D"):
                jobs.read_error = RuntimeError("compute_jobs read blip")
            else:
                jobs.rpc_error = RuntimeError("seed hold write failed")
            try:
                mid = await _run(
                    venue=venue, jobs=jobs, bounds=bounds, flags=flags, rows=carried_rows,
                    column=carried_column, job_id="job-mid", token="tok-mid",
                )
            finally:
                jobs.read_error = None
                jobs.rpc_error = None
            jobs.finish("job-mid", "done")
            carried_column = mid.column_after

        bounds.fail_next = 0  # the RPC recovers
        r2 = await _run(
            venue=venue, jobs=jobs, bounds=bounds, flags=flags,
            rows=[*carried_rows, *_persisted_fills(r1.rec, STRATEGY_ID)],
            column=carried_column, job_id="job-run2", token="tok-run2",
        )
        if shape == "D":
            # D: the intervening run is itself a full run, so it may read the span and clear the
            # bound honestly; run 2 then rightly walks on. The invariant is that the span gets
            # read by SOME run: the intervening one or run 2. Before the WR-01 fix neither walked back.
            assert mid.out is not None and r2.out is not None
            walk = min(_two_run_walk_start_ms(mid.out), _two_run_walk_start_ms(r2.out))
            assert walk <= _run1_walk_ms(venue, state), (
                f"SEEDHOLD-WALK-START: {label}: neither the intervening run nor run 2 walked "
                f"from at or before run 1's walk start {_run1_walk_ms(venue, state)} "
                f"(earliest walk start {walk}): run 1's unread span is skipped"
            )
        else:
            _verdict(label, r2.out, _run1_walk_ms(venue, state))


# ---- the retry arms: a re-claimed attempt keeps attempt 1's hold --------------------------------

_RETRY_PARAMS = [
    pytest.param("okx", "rpc-up", id="okx-retry-rpc-up"),
    pytest.param("okx", "rpc-down", id="okx-retry-rpc-down"),
    pytest.param("bybit", "rpc-up", id="bybit-retry-rpc-up"),
    pytest.param("bybit", "rpc-down", id="bybit-retry-rpc-down"),
]


class TestSeedHoldRetry:
    @pytest.mark.parametrize("venue,recovery", _RETRY_PARAMS)
    async def test_a_retried_attempt_keeps_attempt_one_hold(
        self, venue: str, recovery: str
    ) -> None:
        rows, column = _rows_and_column("set")
        bounds = FlakyBounds(PERSISTENT)
        jobs, flags = JobsStore(), {}
        label = f"{venue} retry {recovery}"
        # Attempt 1: the bound RPC is down, then the unguarded balance read raises.
        a1 = await _run(
            venue=venue, jobs=jobs, bounds=bounds, flags=flags, rows=rows, column=column,
            job_id="job-r1", token="tok-1", daily_trades=DAILY_TRADES_RUN1,
            balance_error=RuntimeError("balance read failed"), expect_raises=RuntimeError,
        )
        assert "sync_trades" not in _rpc_names(a1.sb), (
            f"SEEDHOLD-PREMISE: {label}: attempt 1 must have held its daily store"
        )
        jobs.finish("job-r1", "failed_retry")
        moved_rows = [*rows, DAILY_MOVED]  # a daily row lands before the retry
        jobs.reclaim("job-r1", "tok-2")

        if recovery == "rpc-up":
            bounds.fail_next = 0
            a2 = await _run(
                venue=venue, jobs=jobs, bounds=bounds, flags=flags, rows=moved_rows,
                column=column, job_id="job-r1", token="tok-2", start=False,
            )
            _verdict(label, a2.out, RUN1_WALK_MS)
        else:
            bounds.fail_next = PERSISTENT
            a2 = await _run(
                venue=venue, jobs=jobs, bounds=bounds, flags=flags, rows=moved_rows,
                column=column, job_id="job-r1", token="tok-2", start=False,
            )
            jobs.finish("job-r1", "done")
            bounds.fail_next = 0
            r2 = await _run(
                venue=venue, jobs=jobs, bounds=bounds, flags=flags, rows=moved_rows,
                column=a2.column_after, job_id="job-r2", token="tok-r2",
            )
            _verdict(label, r2.out, RUN1_WALK_MS)

    @pytest.mark.parametrize("venue", ["okx", "bybit"])
    async def test_an_older_rows_retry_mark_outranks_a_newer_done_row(self, venue: str) -> None:
        # Review WR-02: the schema allows a second `sync_trades` row while the older one waits in
        # `failed_retry` (the in-flight unique index excludes it), so row B is created AFTER row A,
        # runs and ends `done` with no mark, and A's retry is claimed last. A's retry writes the
        # mark and ends `done`. The latest row by CLAIM is A; by creation it is B, which hides the
        # mark. Run 2 must read it.
        rows, column = _rows_and_column("set")
        bounds = FlakyBounds(PERSISTENT)
        jobs, flags = JobsStore(), {}
        label = f"{venue} two-row retry"
        jobs.add_row("job-A", "failed_retry", {})  # created and first claimed before B
        jobs.add_row("job-B", "done", {})  # created later, finished with no mark
        jobs.reclaim("job-A", "tok-A2")  # A's retry is claimed after B
        a = await _run(
            venue=venue, jobs=jobs, bounds=bounds, flags=flags, rows=rows, column=column,
            job_id="job-A", token="tok-A2", start=False, daily_trades=DAILY_TRADES_RUN1,
        )
        _premise_run1(a, label)
        jobs.finish("job-A", "done")
        assert jobs.row("job-A")["seq"] < jobs.row("job-B")["seq"], (
            f"SEEDHOLD-PREMISE: {label}: the marked row must be the OLDER one by creation"
        )
        assert SEED_HOLD_KEY_NAME in jobs.row("job-A")["metadata"], (
            f"SEEDHOLD-PREMISE: {label}: the older row's retry must have written the mark"
        )

        bounds.fail_next = 0  # the RPC recovers
        r2 = await _run(
            venue=venue, jobs=jobs, bounds=bounds, flags=flags,
            rows=[*rows, DAILY_MOVED, *_persisted_fills(a.rec, STRATEGY_ID)],
            column=a.column_after, job_id="job-run2", token="tok-run2",
        )
        _verdict(label, r2.out, RUN1_WALK_MS)


# ---- the mechanism pins (plan 04): when a mark is written, what it carries, what is ignored ----

SNAPSHOT_PATH = (
    Path(__file__).resolve().parents[2]
    / "supabase" / "schema" / "functions" / "set_compute_job_seed_hold.sql"
)
HOLD_LOGGER = "quantalyze.analytics.job_worker"
SET_SEED_MS = 1778112000000  # 2026-05-07T00:00:00Z, the seed on a set column (the daily seed)
OKX_FIRST_SEED_MS = 1776081600000  # 2026-04-13T12:00:00Z, the OKX reach anchor under the pinned clock


def _seed_hold_errors(caplog: pytest.LogCaptureFixture) -> list[Any]:
    return [
        r for r in caplog.records
        if r.levelname == "ERROR"
        and r.getMessage().startswith("sync_trades: could not write the seed-hold mark for strategy")
    ]


_PARITY_NAMES = [jw.SEED_HOLD_RPC, tr.SEED_HOLD_KEY, "p_job_id", "p_claim_token", "p_floor_ms"]


def _names_missing_from(sql: str, names: list[str]) -> list[str]:
    return [n for n in names if n not in sql]


class TestSeedHoldMechanism:
    @pytest.mark.parametrize("venue", ["binance", "okx", "bybit", "deribit"])
    async def test_a_clean_run_writes_no_seed_hold(self, venue: str) -> None:
        # SC-3: the mark exists only when the bound could not be recorded.
        rows, column = _rows_and_column("set")
        jobs = JobsStore()
        r1 = await _run(
            venue=venue, jobs=jobs, bounds=FlakyBounds(0), flags={}, rows=rows, column=column,
            job_id="job-clean", token="tok-clean", daily_trades=DAILY_TRADES_RUN1,
        )
        assert r1.out is not None and r1.out.fetch_raw.call_count == 1, (
            f"SEEDHOLD-MECHANISM: {venue}: the premise is a run whose bound write succeeded and "
            "whose fills read ran"
        )
        assert jobs.rpc_calls == [], (
            f"SEEDHOLD-MECHANISM: {venue}: a run whose bound write succeeded wrote a seed-hold "
            f"mark: {jobs.rpc_calls}"
        )

    async def test_an_orphan_answer_writes_no_seed_hold(self) -> None:
        rows, column = _rows_and_column("set")
        bounds, jobs = FlakyBounds(0), JobsStore()
        bounds.owned = False
        r1 = await _run(
            venue="okx", jobs=jobs, bounds=bounds, flags={}, rows=rows, column=column,
            job_id="job-orphan", token="tok-orphan", daily_trades=DAILY_TRADES_RUN1,
        )
        assert r1.out is not None and r1.out.fetch_raw.call_count == 0, (
            "SEEDHOLD-MECHANISM: the premise is an orphan answer that skipped the fills read"
        )
        assert jobs.rpc_calls == [], (
            "SEEDHOLD-MECHANISM: an orphan answer means the re-claiming worker owns the strategy; "
            f"this run must write no mark: {jobs.rpc_calls}"
        )

    async def test_a_failed_seed_hold_write_is_logged_and_the_run_finishes(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        rows, column = _rows_and_column("set")
        jobs, flags = JobsStore(), {}
        jobs.rpc_error = RuntimeError("secret-detail-from-the-database")
        with caplog.at_level(logging.WARNING, logger=HOLD_LOGGER):
            r1 = await _run(
                venue="okx", jobs=jobs, bounds=FlakyBounds(PERSISTENT), flags=flags, rows=rows,
                column=column, job_id="job-df", token="tok-df", daily_trades=DAILY_TRADES_RUN1,
            )
        # `_run_job` asserts DispatchOutcome.DONE, so the run finished.
        assert r1.out is not None
        assert flags.get("phase2_fill_ingestion_failed") is True
        errors = _seed_hold_errors(caplog)
        assert len(errors) == 1, (
            f"SEEDHOLD-MECHANISM: want exactly one seed-hold write ERROR, got {len(errors)}"
        )
        text = errors[0].getMessage()
        assert "RuntimeError" in text and STRATEGY_ID in text
        assert "secret-detail-from-the-database" not in text, (
            "SEEDHOLD-MECHANISM: the log names the exception class only, never its text"
        )

    async def test_a_false_answer_is_logged_as_an_orphan_and_the_run_finishes(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # The fake fence answers False when the running row's token is not the one the run carries.
        rows, column = _rows_and_column("set")
        jobs, flags = JobsStore(), {}
        jobs.start("job-fence", "tok-other")  # the row's token differs from the run's `tok-run`
        with caplog.at_level(logging.WARNING, logger=HOLD_LOGGER):
            r1 = await _run(
                venue="okx", jobs=jobs, bounds=FlakyBounds(PERSISTENT), flags=flags, rows=rows,
                column=column, job_id="job-fence", token="tok-run", start=False,
                daily_trades=DAILY_TRADES_RUN1,
            )
        assert r1.out is not None and len(jobs.rpc_calls) == 1
        assert not _seed_hold_errors(caplog)
        orphan = [
            r for r in caplog.records
            if r.levelname == "WARNING"
            and r.getMessage().startswith("worker_orphan_write_blocked: set_compute_job_seed_hold")
        ]
        assert len(orphan) == 1 and "job-fence" in orphan[0].getMessage()
        assert SEED_HOLD_KEY_NAME not in jobs.row("job-fence")["metadata"]

    @pytest.mark.parametrize("venue", ["okx", "bybit"])
    async def test_a_failed_hold_read_writes_the_reach_anchor(self, venue: str) -> None:
        # The read failed, so an earlier mark may be hidden: the write carries min(reach, seed).
        rows, column = _rows_and_column("set")
        jobs = JobsStore()
        jobs.read_error = RuntimeError("compute_jobs read blip")
        await _run(
            venue=venue, jobs=jobs, bounds=FlakyBounds(PERSISTENT), flags={}, rows=rows,
            column=column, job_id="job-fr", token="tok-fr", daily_trades=DAILY_TRADES_RUN1,
        )
        assert len(jobs.rpc_calls) == 1
        call = jobs.rpc_calls[0]
        assert call["p_floor_ms"] == REACH_ANCHOR_MS[venue], (
            f"SEEDHOLD-MECHANISM: {venue}: a failed hold read must write the reach anchor "
            f"{REACH_ANCHOR_MS[venue]}, wrote {call['p_floor_ms']}"
        )
        assert call["p_job_id"] == "job-fr" and call["p_claim_token"] == "tok-fr"

    @pytest.mark.parametrize(
        "state,want_ms",
        [
            pytest.param("set", SET_SEED_MS, id="okx-set"),
            pytest.param("first", OKX_FIRST_SEED_MS, id="okx-first"),
        ],
    )
    async def test_a_seed_hold_write_carries_the_seed(self, state: str, want_ms: int) -> None:
        rows, column = _rows_and_column(state)
        jobs = JobsStore()
        await _run(
            venue="okx", jobs=jobs, bounds=FlakyBounds(PERSISTENT), flags={}, rows=rows,
            column=column, job_id="job-seed", token="tok-seed", daily_trades=DAILY_TRADES_RUN1,
        )
        assert [c["p_floor_ms"] for c in jobs.rpc_calls] == [want_ms], (
            f"SEEDHOLD-MECHANISM: okx {state}: the mark must carry the run's seed {want_ms}"
        )

    @pytest.mark.parametrize(
        "bad", [pytest.param("abc", id="string"), pytest.param(True, id="bool"), pytest.param(-5, id="negative")]
    )
    async def test_a_malformed_stored_hold_is_ignored(self, bad: Any) -> None:
        rows, column = _rows_and_column("set")

        def _store() -> JobsStore:
            jobs = JobsStore()
            jobs.add_row("job-old", "done", {SEED_HOLD_KEY_NAME: bad})
            return jobs

        # (1) bound RPC working: the malformed mark is a failed read, so the seed is lowered to
        # the reach anchor (a hidden earlier mark must not be buried by this run's clean bound
        # clear).
        # INTENT CHANGE 2026-11-28 (Phase 257 review WR-01): this arm used to assert
        # `since_ms == SET_SEED_MS` ("a malformed stored mark must lower no seed"). That was the
        # fail-open the review measured: with the RPC up, a run that could not read the mark kept
        # the seed past the hidden span, cleared the bound, and ended `done` without the mark.
        # The seed now drops to the reach anchor whenever the hold read failed, over-fetching and
        # never skipping a span.
        ok = await _run(
            venue="okx", jobs=_store(), bounds=FlakyBounds(0), flags={}, rows=rows, column=column,
            job_id="job-m1", token="tok-m1", daily_trades=DAILY_TRADES_RUN1,
        )
        assert ok.out is not None
        assert ok.out.fetch_raw.call_args.kwargs["since_ms"] == REACH_ANCHOR_MS["okx"], (
            "SEEDHOLD-MECHANISM: a malformed stored mark is a failed read; the seed must drop to "
            "the OKX reach anchor"
        )
        # (2) bound RPC down: the malformed mark counts as a failed read, so the write is the reach.
        jobs2 = _store()
        await _run(
            venue="okx", jobs=jobs2, bounds=FlakyBounds(PERSISTENT), flags={}, rows=rows,
            column=column, job_id="job-m2", token="tok-m2", daily_trades=DAILY_TRADES_RUN1,
        )
        assert [c["p_floor_ms"] for c in jobs2.rpc_calls] == [REACH_ANCHOR_MS["okx"]], (
            "SEEDHOLD-MECHANISM: a malformed stored mark is a failed read; the write must carry "
            "the OKX reach anchor"
        )

    def test_parity_with_the_generated_snapshot(self) -> None:
        missing = _names_missing_from(SNAPSHOT_PATH.read_text(), _PARITY_NAMES)
        assert missing == [], (
            f"SEEDHOLD-MECHANISM: {missing} are not in {SNAPSHOT_PATH.name}: the Python and SQL "
            "names have diverged"
        )

    def test_parity_detects_a_misspelled_copy(self) -> None:
        # The pin can fail: a copy with one letter altered is reported missing, for every name.
        sql = SNAPSHOT_PATH.read_text()
        misspelled = [n[:-1] + "x" for n in _PARITY_NAMES]
        assert _names_missing_from(sql, misspelled) == misspelled, (
            "SEEDHOLD-MECHANISM: a misspelled name satisfied the parity check, so the pin cannot go red"
        )


# ---- SC-2: a Bybit read that hits its deadline keeps what it completed --------------------------
#
# The real `fetch_raw_trades` (so the worker's entry point is what re-raises) over a windowed fake
# exchange and a fake clock. Each 7-day window costs two requests (page 1: one fill near the
# window's end and the cursor "c"; page 2: an empty list and an empty cursor), each request costs
# 1 s of the fake clock. A 4.5 s budget completes two windows and refuses on window 3's second page
# (five requests); a 0.5 s budget refuses inside the first window (one request). Hand-typed:
#
#   1778108400000  2026-05-06T23:00:00+00:00        effective_since (the seed minus the overlap)
#   1778713200000  2026-05-13T23:00:00+00:00        window 1 end
#   1779318000001  2026-05-20T23:00:00.001+00:00    window 2 end, the MARK ("+1 ms" boundary)
#   1778711400000  2026-05-13T22:30:00+00:00        window 1's fill (its end minus 30 min)
#   1779316200001  2026-05-20T22:30:00.001+00:00    window 2's fill, the newest persisted fill
#   1779312600001  2026-05-20T21:30:00.001+00:00    run 2's walk start after the window-2 stop
MARK_MS = 1779318000001
MARK_ISO = "2026-05-20T23:00:00.001000+00:00"
NEWEST_COMPLETED_FILL_ISO = "2026-05-20T22:30:00.001000+00:00"
RUN2_WALK_AFTER_STOP_MS = 1779312600001
RUN1_SEED_ISO = "2026-05-07T00:00:00+00:00"
RUN1_WALK_MINUS_1MS_ISO = "2026-05-06T22:59:59.999000+00:00"  # HEAD's creeping bound
TWO_WINDOWS_S = 4.5
FIRST_WINDOW_S = 0.5


def _windowed_bybit(clock: list[float]) -> Any:
    """A fake Bybit execution list. `exchange.calls` counts requests, `exchange.windows` counts the
    cursor-less (page 1) requests."""

    async def _execution_list(params: dict[str, str]) -> dict[str, Any]:
        exchange.calls += 1
        clock[0] += 1.0
        if "cursor" in params:
            return {"result": {"list": [], "nextPageCursor": ""}}
        exchange.windows += 1
        n = exchange.windows
        return {
            "result": {
                "list": [
                    {
                        "execTime": str(int(params["endTime"]) - 1_800_000),
                        "execId": f"w{n}",
                        "execType": "Trade",
                        "execPrice": "50000",
                        "execQty": "0.1",
                        "execFee": "0.5",
                        "feeCurrency": "USDT",
                        "symbol": "BTCUSDT",
                        "side": "Buy",
                        "orderId": f"o{n}",
                    }
                ],
                "nextPageCursor": "c",
            }
        }

    exchange = MagicMock()
    exchange.id = "bybit"
    exchange.calls = 0
    exchange.windows = 0
    exchange.private_get_v5_execution_list = _execution_list
    return exchange


async def _bybit_refusal(
    monkeypatch: pytest.MonkeyPatch, read_deadline_s: float
) -> tuple[ex.BybitTradeWindowIncomplete, int]:
    """The deadline refusal of the REAL `fetch_raw_trades` on a fake clock, and the request count."""
    clock = [0.0]
    monkeypatch.setattr(ex, "_monotonic", lambda: clock[0])
    real_reader = ex._fetch_raw_trades_bybit

    async def _fixed_clock_reader(exchange: Any, since_ms: int | None, **kwargs: Any) -> Any:
        # A fixed `now_ms`: the wall clock would make RUN1_SEED older than the venue's 730-day
        # history one day.
        return await real_reader(exchange, since_ms, now_ms=NOW_MS, **kwargs)

    monkeypatch.setattr(ex, "_fetch_raw_trades_bybit", _fixed_clock_reader)
    exchange = _windowed_bybit(clock)
    with pytest.raises(ex.BybitTradeWindowIncomplete) as raised:
        await ex.fetch_raw_trades(
            exchange, STRATEGY_ID, MagicMock(), since_ms=RUN1_SEED_MS, read_deadline_s=read_deadline_s
        )
    want_calls = 5 if read_deadline_s == TWO_WINDOWS_S else 1
    assert exchange.calls == want_calls, (
        f"SEEDHOLD-PREMISE: a {read_deadline_s} s budget must refuse after {want_calls} "
        f"request(s), got {exchange.calls}"
    )
    assert raised.value.reason == "deadline", f"SEEDHOLD-PREMISE: reason {raised.value.reason!r}"
    return raised.value, exchange.calls


def _persisted_ids(rec: _Recorder) -> set[str]:
    return {row["exchange_fill_id"] for batch in rec.upserted_batches for row in batch}


def _bound_iso(bounds: RereadBounds) -> str | None:
    row = bounds.rows.get(STRATEGY_ID)
    return None if row is None else row[1]


def _stamped_flag(rec: _Recorder) -> Any:
    return rec.analytics_upserts[-1]["data_quality_flags"].get("phase2_fill_ingestion_failed")


class TestBybitDeadlineKeepsWhatItRead:
    """SC-2 (CONTEXT [Bybit read-through shape], [Bybit stall stays visible]). A window counts as
    complete only when its page loop ended naturally, so the in-flight window's fills are never
    persisted (Bybit answers newest first inside a window: a partial window holds its newest fills
    and misses its oldest). Assertions are equalities: an inequality is trivially GREEN at HEAD for
    the first-window arm (RESEARCH). The refusal's attributes are read through `getattr`, so HEAD
    fails on an AssertionError and never on an AttributeError."""

    @pytest.mark.parametrize(
        "case",
        [
            pytest.param("two-windows", id="two-windows"),
            pytest.param("first-window", id="first-window"),
        ],
    )
    async def test_the_refusal_carries_what_the_read_completed(
        self, monkeypatch: pytest.MonkeyPatch, case: str
    ) -> None:
        deadline = TWO_WINDOWS_S if case == "two-windows" else FIRST_WINDOW_S
        refusal, _calls = await _bybit_refusal(monkeypatch, deadline)
        completed = getattr(refusal, "completed_fills", None)
        through = getattr(refusal, "read_through_ms", "absent")
        if case == "two-windows":
            ids = {f["exchange_fill_id"] for f in (completed or [])}
            assert ids == {"w1", "w2"} and through == MARK_MS, (
                f"SEEDHOLD-BYBIT: reader two-windows: completed fill ids {sorted(ids)}, "
                f"read_through_ms {through!r}; want ['w1', 'w2'] and {MARK_MS}"
            )
        else:
            assert completed == [] and through is None, (
                f"SEEDHOLD-BYBIT: reader first-window: completed_fills {completed!r}, "
                f"read_through_ms {through!r}; want [] and None"
            )

    @pytest.mark.parametrize(
        "column",
        [
            pytest.param(CURSOR_AHEAD_TS, id="stop-after-two-windows-set"),
            pytest.param(None, id="stop-after-two-windows-null"),
        ],
    )
    async def test_a_stop_after_two_windows_persists_them_and_advances(
        self, monkeypatch: pytest.MonkeyPatch, column: str | None
    ) -> None:
        refusal, _calls = await _bybit_refusal(monkeypatch, TWO_WINDOWS_S)
        bounds, flags = RereadBounds(), {}
        sb1, rec1 = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds, flags=flags)
        await _run_job(
            supabase=sb1, column=column, exchange="bybit", daily_trades=DAILY_TRADES_RUN1,
            raw_error=refusal,
        )
        persisted = _persisted_ids(rec1)
        assert persisted == {"w1", "w2"}, (
            f"SEEDHOLD-BYBIT: persisted fill ids {sorted(persisted)}; want the two completed "
            "windows' fills and never the in-flight window's (w3)"
        )
        assert _bound_iso(bounds) == MARK_ISO, (
            f"SEEDHOLD-BYBIT: bound {_bound_iso(bounds)!r}; want the mark {MARK_ISO}"
        )
        stamp = _the_advance(rec1)["p_last_fetched_ts"]
        assert stamp == NEWEST_COMPLETED_FILL_ISO, (
            f"SEEDHOLD-BYBIT: stamp {stamp!r}; want the newest persisted fill {NEWEST_COMPLETED_FILL_ISO}"
        )
        assert _stamped_flag(rec1) is True, (
            "SEEDHOLD-BYBIT: a deadline stop must stay flagged phase2_fill_ingestion_failed"
        )
        sb2, _rec2 = _make_supabase(
            trades_rows=[*DAILY_ONLY_TRADES, *_persisted_fills(rec1, STRATEGY_ID)],
            bounds=bounds, flags=flags,
        )
        out2 = await _run_job(
            supabase=sb2, column=column_after_advance(column, stamp), exchange="bybit"
        )
        walk = _two_run_walk_start_ms(out2)
        assert walk == RUN2_WALK_AFTER_STOP_MS and walk > RUN1_WALK_MS, (
            f"SEEDHOLD-BYBIT: run 2 walk start {walk}; want {RUN2_WALK_AFTER_STOP_MS} "
            f"(the newest completed-window fill minus the overlap), later than run 1's {RUN1_WALK_MS}"
        )

    @pytest.mark.parametrize(
        "column",
        [
            pytest.param(CURSOR_AHEAD_TS, id="stop-inside-first-window-set"),
            pytest.param(None, id="stop-inside-first-window-null"),
        ],
    )
    async def test_a_stop_inside_the_first_window_holds_the_bound_at_the_seed(
        self, monkeypatch: pytest.MonkeyPatch, column: str | None
    ) -> None:
        refusal, _calls = await _bybit_refusal(monkeypatch, FIRST_WINDOW_S)
        bounds, flags = RereadBounds(), {}
        sb1, rec1 = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds, flags=flags)
        await _run_job(
            supabase=sb1, column=column, exchange="bybit", daily_trades=DAILY_TRADES_RUN1,
            raw_error=refusal,
        )
        persisted = _persisted_ids(rec1)
        assert persisted == set(), f"SEEDHOLD-BYBIT: persisted {sorted(persisted)}; want nothing"
        assert _bound_iso(bounds) == RUN1_SEED_ISO, (
            f"SEEDHOLD-BYBIT: bound {_bound_iso(bounds)!r}; want the seed {RUN1_SEED_ISO} exactly "
            f"(HEAD creeps to {RUN1_WALK_MINUS_1MS_ISO})"
        )
        assert _stamped_flag(rec1) is True, (
            "SEEDHOLD-BYBIT: a deadline stop must stay flagged phase2_fill_ingestion_failed"
        )
        stamp = _the_advance(rec1)["p_last_fetched_ts"]
        sb2, _rec2 = _make_supabase(
            trades_rows=[*DAILY_ONLY_TRADES, *_persisted_fills(rec1, STRATEGY_ID)],
            bounds=bounds, flags=flags,
        )
        out2 = await _run_job(
            supabase=sb2, column=column_after_advance(column, stamp), exchange="bybit"
        )
        walk = _two_run_walk_start_ms(out2)
        assert walk == RUN1_WALK_MS, (
            f"SEEDHOLD-BYBIT: run 2 walk start {walk}; want run 1's {RUN1_WALK_MS} exactly"
        )

    @pytest.mark.parametrize(
        "column",
        [pytest.param(CURSOR_AHEAD_TS, id="persist-fails-after-stop-set")],
    )
    async def test_a_persist_failure_after_a_stop_keeps_the_walk_start_bound(
        self, monkeypatch: pytest.MonkeyPatch, column: str | None
    ) -> None:
        # CONTEXT [Bybit read-through shape]: a persist failure still falls back to the walk start
        # minus 1 ms, because the completed windows' fills did not all land.
        refusal, _calls = await _bybit_refusal(monkeypatch, TWO_WINDOWS_S)
        bounds = RereadBounds()
        sb1, rec1 = _make_supabase(
            trades_rows=DAILY_ONLY_TRADES, bounds=bounds, flags={}, upsert_fails_on_call=1
        )
        await _run_job(
            supabase=sb1, column=column, exchange="bybit", daily_trades=DAILY_TRADES_RUN1,
            raw_error=refusal,
        )
        assert rec1.upsert_calls >= 1, (
            "SEEDHOLD-BYBIT: the completed windows' fills were never sent to the upsert"
        )
        assert _persisted_ids(rec1) == set(), "SEEDHOLD-BYBIT: the failed upsert persisted a fill"
        assert _bound_iso(bounds) == RUN1_WALK_MINUS_1MS_ISO, (
            f"SEEDHOLD-BYBIT: bound {_bound_iso(bounds)!r}; want the walk start minus 1 ms "
            f"{RUN1_WALK_MINUS_1MS_ISO}"
        )
        stamp = _the_advance(rec1)["p_last_fetched_ts"]
        assert stamp is None, f"SEEDHOLD-BYBIT: stamp {stamp!r}; want None after a failed persist"
        assert _stamped_flag(rec1) is True, (
            "SEEDHOLD-BYBIT: a failed persist must stay flagged phase2_fill_ingestion_failed"
        )


def test_the_bybit_sync_budget_leaves_the_persist_margin() -> None:
    """CONTEXT [Timing]. A deadline stop now persists the completed windows' fills before the
    epilogue, so the Bybit read budget C must leave the 900 s handler room for that persist. The
    worst case is no time elapsed before the read: (1 + 4r) x C + in-flight + tail <= handler.
    Every input is hand-typed here; r is UNMEASURED, so 0.2 s is the pessimistic end of the
    assumed 0.05 to 0.2 s range. Only the two constants being judged and the handler cap are read
    from the code under test."""
    ROUND_TRIP_S = 0.2  # r: one PostgREST round trip from the worker (assumed, unmeasured)
    FULL_PAGE_S = 0.5  # one full 100-fill page of the read (255-REVIEW-R2 R2-WR-02 (b))
    IN_FLIGHT_S = 10.0  # the one ccxt request past the deadline check, bounded by ccxt's 10 s
    TAIL_S = 15.0  # flag, bound, cursor and follow-on enqueue after the persist
    RHO = 2 * ROUND_TRIP_S / FULL_PAGE_S  # persist seconds per read second: 2 round trips a page
    assert RHO == pytest.approx(0.8)
    budget = ex.BYBIT_SYNC_FILLS_READ_DEADLINE_S
    handler = jw.TIMEOUT_PER_KIND["sync_trades"]
    worst_case = (1 + RHO) * budget + IN_FLIGHT_S + TAIL_S
    assert worst_case <= handler, (
        f"SEEDHOLD-MARGIN: worst case {worst_case:.1f} s exceeds the {handler} s handler: the "
        f"persist after a deadline stop would no longer fit (margin {handler - worst_case:.1f} s)"
    )
    assert budget == 420.0, f"SEEDHOLD-MARGIN: the Bybit budget is {budget}, the ruled value is 420.0"
    assert budget < ex.BINANCE_SYNC_FILLS_READ_DEADLINE_S, (
        "SEEDHOLD-MARGIN: Bybit's budget must stay below Binance's founder-ruled 840 s"
    )
