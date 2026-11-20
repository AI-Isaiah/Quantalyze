"""Phase 155.2 plan 16 (founder ruling G4-1 (b)) - a key-mode ``derive_broker_dailies`` that runs
ahead of a directly linked strategy's analytics enqueues that strategy's own derive chain.

The gap: the nightly key fan-out derives every eligible key in key mode, which never enqueues
``compute_analytics_from_csv``; the daily strategy re-entry (``cron_sync``) defers any key whose
venue is not in ``EXCHANGE_CLASSES`` and ``DAILY_PNL_VENUES``; and the single-key ledger fan-out
admits a strategy only once it reads stale (a series older than 4 days). A 1 to 4 day lag was
therefore invisible to every refresher, and the per-key series ran ahead of the strategy series.

These tests drive the REAL ``run_derive_broker_dailies_job`` in key mode and assert on the captured
``enqueue_compute_job`` calls.

VENUE SCOPE (review WR-02, orchestrator decision): the helper reads the strategy's last return date
from ``public.ledger_refresh_staleness``, whose final ``WHERE sv.exchanges && lv.venues`` limits it to
the ledger venues ``deribit``, ``sfox`` and ``mt5`` (migration 20261114151700). The ``_Read`` double
honours that filter, so the decision cases run for an mt5 key, and a binance key is pinned to get NO
enqueue: ``cron_sync`` re-derives binance, okx and bybit strategies daily, so the re-entry is not
needed there. The rule is NOT venue-agnostic and no test claims it is.

Each assertion is mutation-falsifiable: removing the helper call at either key-mode exit, widening
the cooldown past 20 hours, dropping the "already has a dated point" guard, or dropping the marker
turns a named test red.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import ExitStack
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from services.mt5_client import Mt5Client, Mt5Session
import services.mt5_concurrency as mt5_conc

_CCXT_VERDICT = "fill_derived_unproven"
_KEY = "key-linked"
_OWNER = "alloc-linked"
_NOW = datetime.now(timezone.utc)

# The last day each venue's per-key series ends on in these drives: the binance double returns the
# two days below, the mt5 double replays the canonical deal fixture (last NAV day 2025-06-05).
_PER_KEY_END = {"binance": date(2024, 5, 2), "mt5": date(2025, 6, 5)}
# The venues the staleness view serves (its `lv.venues`, migration 20261114151700). The decision
# cases below run only for a venue inside it; a venue outside it is pinned in its own test.
_VIEW_VENUES = frozenset({"deribit", "sfox", "mt5"})
_VENUES = ["mt5"]
_ABSENT: Any = object()  # a strategy the staleness view returns no row for
_BEHIND: Any = object()  # the default: a last return date 3 days before the per-key end


# ---------------------------------------------------------------------------
# The venue doubles
# ---------------------------------------------------------------------------
class _NT:
    def __init__(self, d: dict[str, Any]) -> None:
        self._d = dict(d)

    def _asdict(self) -> dict[str, Any]:
        return dict(self._d)


class _FakeRpycConn:
    def __init__(self) -> None:
        self.namespace: dict[str, Any] = {}

    def execute(self, src: str) -> None:
        exec(src, self.namespace)  # noqa: S102 - running the real far-side source is the point

    def eval(self, src: str) -> object:
        return ("answered", 0, 0, 0, -1)

    def close(self) -> None:
        pass


class _FakeMt5Transport:
    def __init__(self, *, account: dict[str, Any], deals: list[dict[str, Any]]) -> None:
        self._account = account
        self._deals = deals
        self._MetaTrader5__conn = _FakeRpycConn()
        self._lock = threading.Lock()

    def initialize(self, **kwargs: Any) -> bool:
        return True

    def login(self, login: Any, password: Any = None, server: Any = None, timeout: Any = None) -> bool:
        return True

    def account_info(self) -> _NT:
        return _NT(self._account)

    def history_deals_get(self, from_ts: Any, to_ts: Any) -> tuple[_NT, ...]:
        return tuple(_NT(d) for d in self._deals)

    def last_error(self) -> tuple[int, str]:
        return (0, "unknown")

    def shutdown(self) -> None:
        pass


def _epoch(y: int, m: int, d: int, h: int = 12) -> int:
    return int(datetime(y, m, d, h, tzinfo=timezone.utc).timestamp())


def _canonical_deals() -> list[dict[str, Any]]:
    return [
        {"type": 0, "entry": 1, "profit": 500.0, "swap": 0.0,
         "commission": -100.0, "fee": 0.0, "time": _epoch(2025, 6, 2)},
        {"type": 2, "profit": 10_000.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 4)},
        {"type": 1, "entry": 1, "profit": 300.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 4)},
        {"type": 1, "entry": 1, "profit": -200.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 5)},
    ]


def _mt5_session() -> Mt5Session:
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        deals=_canonical_deals(),
    )
    client = Mt5Client("h", 1, _connect=lambda *, host, port, timeout: transport)
    return Mt5Session(
        client=client, login=123456, investor_password="pw", server="Broker-Live",
        venue_account_id="123456",
    )


@pytest.fixture(autouse=True)
def _mt5_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MT5_ENABLED", "true")
    mt5_conc.reset_terminal_state_for_tests()
    yield
    mt5_conc.reset_terminal_state_for_tests()


# ---------------------------------------------------------------------------
# The database double: the writes the key-mode derive makes, and the three reads the helper makes
# ---------------------------------------------------------------------------
@dataclass
class _Db:
    """What the helper reads. ``strategies`` rows carry ``api_key_id`` (default: this key);
    ``analytics`` maps strategy id to the ``last_return_date`` ``ledger_refresh_staleness`` reports
    for it: an ISO date, None (the view's NULL: no analytics row, or a series with no dated point),
    or ``_ABSENT`` (no view row at all). The view also returns NO row for a strategy whose venue is
    outside ``_VIEW_VENUES`` (its ``WHERE sv.exchanges && lv.venues``): ``key_venue`` is the venue of
    the key under test, set by ``_build_ctx``, and ``view_exchange`` overrides it for a drive whose
    crawl double is not the venue the view should serve;
    ``stale_reason`` maps strategy id to the view's ``stale_reason`` (default NULL);
    ``flags`` maps strategy id to the ``strategy_analytics.data_quality_flags`` value;
    ``jobs`` is ``(strategy_id, kind, created_at)`` or ``(strategy_id, kind, created_at, status)``
    (status defaults to ``done``) for every compute_jobs row."""

    strategies: list[dict[str, Any]] = field(default_factory=list)
    analytics: dict[str, Any] = field(default_factory=dict)
    jobs: list[tuple[Any, ...]] = field(default_factory=list)
    stale_reason: dict[str, str] = field(default_factory=dict)
    flags: dict[str, Any] = field(default_factory=dict)
    enqueue_raises: set[str] = field(default_factory=set)
    tables_read: list[str] = field(default_factory=list)
    key_venue: str = "mt5"
    view_exchange: str | None = None


class _Read:
    """A chainable read that evaluates its recorded filters against the ``_Db``."""

    def __init__(self, name: str, db: _Db) -> None:
        self.name = name
        self.db = db
        self.f: dict[str, Any] = {}
        self.in_f: dict[str, list[Any]] = {}
        self.gt_f: dict[str, Any] = {}
        self.gte_f: dict[str, Any] = {}

    def select(self, *a: Any, **k: Any) -> "_Read":
        return self

    def eq(self, col: str, val: Any) -> "_Read":
        self.f[col] = val
        return self

    def in_(self, col: str, val: Any) -> "_Read":
        self.in_f[col] = list(val)
        return self

    def gt(self, col: str, val: Any) -> "_Read":
        self.gt_f[col] = val
        return self

    def gte(self, col: str, val: Any) -> "_Read":
        self.gte_f[col] = val
        return self

    def limit(self, n: int) -> "_Read":
        return self

    def maybe_single(self) -> "_Read":
        return self

    def execute(self) -> Any:
        self.db.tables_read.append(self.name)
        if self.name == "strategies":
            return MagicMock(
                data=[
                    {"id": s["id"], "status": s["status"]}
                    for s in self.db.strategies
                    if s.get("api_key_id", _KEY) == self.f.get("api_key_id")
                ]
            )
        if self.name == "ledger_refresh_staleness":
            if (self.db.view_exchange or self.db.key_venue) not in _VIEW_VENUES:
                return None  # the view's `WHERE sv.exchanges && lv.venues` emits no row
            last = self.db.analytics.get(self.f["strategy_id"], _ABSENT)
            if last is _ABSENT:
                return None
            return MagicMock(
                data={
                    "last_return_date": last,
                    "stale_reason": self.db.stale_reason.get(self.f["strategy_id"]),
                }
            )
        if self.name == "strategy_analytics":
            flags = self.db.flags.get(self.f["strategy_id"], _ABSENT)
            return None if flags is _ABSENT else MagicMock(data={"data_quality_flags": flags})
        if self.name == "compute_jobs":
            # Evaluates every recorded filter, so a read that drops one (the in-flight guard's
            # status set, an attempt's kind or age bound) sees different rows and a test goes red.
            matched: list[dict[str, Any]] = []
            for sid, kind, at, *rest in self.db.jobs:
                job = {
                    "strategy_id": sid, "kind": kind, "created_at": at,
                    "status": rest[0] if rest else "done",
                }
                if any(job[c] != v for c, v in self.f.items()):
                    continue
                if any(job[c] not in v for c, v in self.in_f.items()):
                    continue
                if any(not job[c] > datetime.fromisoformat(v) for c, v in self.gt_f.items()):
                    continue
                if any(not job[c] >= datetime.fromisoformat(v) for c, v in self.gte_f.items()):
                    continue
                matched.append({"id": "j", "kind": kind})
            return MagicMock(data=matched)
        return MagicMock(data=[])


_READ_TABLES = {
    "strategies", "ledger_refresh_staleness", "compute_jobs", "strategy_keys", "strategy_analytics",
}


def _build_ctx(venue: str, db: _Db) -> tuple[MagicMock, dict[str, Any]]:
    capture: dict[str, Any] = {"upserts": [], "rpc_calls": [], "ops": []}
    db.key_venue = venue
    ctx = MagicMock()
    ctx.exchange = _mt5_session() if venue == "mt5" else AsyncMock()
    ctx.supabase = MagicMock()
    ctx.strategy_row = None
    ctx.key_row = {"id": _KEY, "exchange": venue, "user_id": _OWNER}

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()

        def _upsert(payload: object, **kw: object) -> MagicMock:
            capture["upserts"].append((name, payload, kw.get("on_conflict")))
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=1)
            return stub

        tbl.upsert.side_effect = _upsert
        if name in _READ_TABLES:
            tbl.select.side_effect = lambda *a, **k: _Read(name, db)
        return tbl

    ctx.supabase.table.side_effect = _table

    def _rpc(name: str, payload: dict[str, Any]) -> MagicMock:
        capture["rpc_calls"].append((name, payload))
        capture["ops"].append(name)
        if (
            name == "enqueue_compute_job"
            and payload.get("p_kind") == "derive_broker_dailies"
            and payload.get("p_strategy_id") in db.enqueue_raises
        ):
            raise RuntimeError("enqueue refused for the test")
        stub = MagicMock()
        stub.execute.return_value = MagicMock(
            data=True if name == "mark_compute_job_kept_figures" else 1
        )
        return stub

    ctx.supabase.rpc.side_effect = _rpc
    return ctx, capture


def _returns(venue: str, *, one_day: bool = False) -> pd.Series:
    """The binance double's combined series. (The mt5 double derives its own from the deals.)"""
    if one_day:
        return pd.Series([0.01], index=pd.DatetimeIndex(["2024-05-01"]), dtype="float64")
    return pd.Series(
        [0.01, -0.02], index=pd.DatetimeIndex(["2024-05-01", "2024-05-02"]), dtype="float64"
    )


async def _derive(
    venue: str,
    db: _Db,
    *,
    one_day: bool = False,
    extra_patches: list[Any] | None = None,
) -> tuple[Any, dict[str, Any]]:
    ctx, capture = _build_ctx(venue, db)
    patches: list[Any] = [
        patch("services.job_worker._allocator_key_preflight", new=AsyncMock(return_value=ctx)),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
    ]
    if venue == "binance":
        patches += [
            patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[])),
            patch(
                "services.exchange.fetch_account_equity_usd",
                new=AsyncMock(return_value=(10000.0, False)),
            ),
            patch(
                "services.funding_fetch.fetch_funding_binance",
                new=AsyncMock(return_value=[]),
            ),
            patch(
                "services.broker_dailies.combine_realized_and_funding",
                new=MagicMock(
                    return_value=(
                        _returns(venue, one_day=one_day),
                        {
                            "used_heuristic_capital": False,
                            "series_completeness": _CCXT_VERDICT,
                        },
                    )
                ),
            ),
        ]
    patches += extra_patches or []
    job = {"id": "j-key", "kind": "derive_broker_dailies", "api_key_id": _KEY}
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await run_derive_broker_dailies_job(job)
    return result, capture


def _behind(venue: str) -> str:
    """A last return date 3 days before the venue's per-key series end (the FX-AI_V shape)."""
    return (_PER_KEY_END[venue] - timedelta(days=3)).isoformat()


def _strategy_enqueues(capture: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        p
        for n, p in capture["rpc_calls"]
        if n == "enqueue_compute_job" and p.get("p_strategy_id") is not None
    ]


def _compose_enqueues(capture: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        p
        for n, p in capture["rpc_calls"]
        if n == "enqueue_compute_job" and p.get("p_kind") == "derive_allocator_equity"
    ]


def _db_one_strategy(venue: str, *, series: Any = _BEHIND, status: str = "published") -> _Db:
    return _Db(
        strategies=[{"id": "strat-1", "status": status}],
        analytics={"strat-1": _behind(venue) if series is _BEHIND else series},
    )


# ---------------------------------------------------------------------------
# The tracer and the decision table
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
@pytest.mark.parametrize("venue", _VENUES)
async def test_a_key_derive_that_runs_ahead_enqueues_the_linked_strategy_derive_chain_head(
    venue: str,
) -> None:
    db = _db_one_strategy(venue)
    result, capture = await _derive(venue, db)

    assert result.outcome == DispatchOutcome.DONE
    enq = _strategy_enqueues(capture)
    assert len(enq) == 1, f"expected exactly one strategy enqueue for {venue}; got {enq!r}"
    payload = enq[0]
    assert payload["p_strategy_id"] == "strat-1"
    # The chain head, which rewrites the STRATEGY-keyed dailies and chains compute. Compute alone
    # would re-read the same stale strategy rows and close nothing.
    assert payload["p_kind"] == "derive_broker_dailies"
    # The single-key fan-out's marker, so a failed background refresh keeps a published factsheet
    # published (Phase 161.1 D-15). A bare literal on purpose: the test must not read the constant
    # it is checking.
    assert payload["p_metadata"]["source"] == "ledger-refresh"
    assert "enqueued_at" in payload["p_metadata"]
    # No correlation_id: nothing may retract the marker.
    assert "correlation_id" not in payload["p_metadata"]
    # Key mode still enqueues no compute_analytics_from_csv itself and the allocator compose
    # epilogue still runs exactly as before.
    assert not [
        p for n, p in capture["rpc_calls"]
        if n == "enqueue_compute_job" and p.get("p_kind") == "compute_analytics_from_csv"
    ]
    assert len(_compose_enqueues(capture)) == 1
    # The re-entry runs BEFORE the epilogue (so its failure can never skip it).
    ops = capture["ops"]
    assert ops.index("enqueue_compute_job") < len(ops) - 1
    first_strategy = next(
        i for i, (n, p) in enumerate(capture["rpc_calls"]) if p.get("p_strategy_id") == "strat-1"
    )
    compose = next(
        i for i, (n, p) in enumerate(capture["rpc_calls"])
        if p.get("p_kind") == "derive_allocator_equity"
    )
    assert first_strategy < compose


@pytest.mark.asyncio
async def test_a_binance_strategy_is_outside_the_staleness_view_and_gets_no_re_entry() -> None:
    # WR-02: ``ledger_refresh_staleness`` serves only deribit, sfox and mt5 (its
    # `WHERE sv.exchanges && lv.venues`). A binance strategy that is 3 days behind its per-key series
    # gets no view row, so the helper skips it, by design: cron_sync's daily strategy derive serves
    # binance, okx and bybit. The test pins the real behaviour; it must not be read as a promise
    # that the re-entry is venue-agnostic.
    db = _db_one_strategy("binance")
    result, capture = await _derive("binance", db)
    assert result.outcome == DispatchOutcome.DONE
    assert "ledger_refresh_staleness" in db.tables_read, "the skip must come from the view's scope"
    assert _strategy_enqueues(capture) == []
    # The allocator compose epilogue is untouched by the skip.
    assert len(_compose_enqueues(capture)) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", _VENUES)
async def test_analytics_that_already_reach_the_per_key_end_are_not_re_enqueued(venue: str) -> None:
    db = _db_one_strategy(venue, series=_PER_KEY_END[venue].isoformat())
    result, capture = await _derive(venue, db)
    assert result.outcome == DispatchOutcome.DONE
    assert _strategy_enqueues(capture) == []

    # Analytics AHEAD of the per-key end (a later sync) are not behind either.
    db = _db_one_strategy(venue, series=(_PER_KEY_END[venue] + timedelta(days=2)).isoformat())
    _result, capture = await _derive(venue, db)
    assert _strategy_enqueues(capture) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", _VENUES)
async def test_a_recent_attempt_holds_the_re_entry_back_and_an_old_one_does_not(
    venue: str,
) -> None:
    # Either chain hop, any status, inside the 20-hour window: no enqueue.
    for kind in ("derive_broker_dailies", "compute_analytics_from_csv"):
        db = _db_one_strategy(venue)
        db.jobs = [("strat-1", kind, datetime.now(timezone.utc) - timedelta(hours=3))]
        _result, capture = await _derive(venue, db)
        assert _strategy_enqueues(capture) == [], f"a recent {kind} attempt must hold it back"

    # An attempt older than the window does not.
    db = _db_one_strategy(venue)
    db.jobs = [("strat-1", "derive_broker_dailies", datetime.now(timezone.utc) - timedelta(hours=30))]
    _result, capture = await _derive(venue, db)
    assert len(_strategy_enqueues(capture)) == 1

    # A recent job of an unrelated kind, or for another strategy, is not an attempt.
    db = _db_one_strategy(venue)
    db.jobs = [
        ("strat-1", "sync_trades", datetime.now(timezone.utc) - timedelta(hours=1)),
        ("strat-other", "derive_broker_dailies", datetime.now(timezone.utc) - timedelta(hours=1)),
    ]
    _result, capture = await _derive(venue, db)
    assert len(_strategy_enqueues(capture)) == 1


def _ago(**kw: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(**kw)


def _day_ago(days: int) -> str:
    return (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", _VENUES)
@pytest.mark.parametrize("kind", ["sync_trades", "derive_broker_dailies"])
@pytest.mark.parametrize("status", ["pending", "running", "done_pending_children", "failed_retry"])
async def test_a_strategy_with_any_in_flight_job_is_never_given_a_second_derive(
    venue: str, kind: str, status: str
) -> None:
    # WR-03: the fan-out's `cj2` guard. ANY kind, the four statuses (failed_retry included), no age
    # bound. The job is 30 days old, far outside both cooldown windows, so only the in-flight guard
    # can hold the re-entry back here.
    db = _db_one_strategy(venue)
    db.jobs = [("strat-1", kind, _ago(days=30), status)]
    _result, capture = await _derive(venue, db)
    assert _strategy_enqueues(capture) == [], f"a {status} {kind} job must hold the re-entry back"


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", _VENUES)
async def test_finished_or_foreign_jobs_are_not_in_flight(venue: str) -> None:
    # The in-flight guard's control: terminal statuses and another strategy's pending job do not hold.
    db = _db_one_strategy(venue)
    db.jobs = [
        ("strat-1", "sync_trades", _ago(days=2), "done"),
        ("strat-1", "sync_trades", _ago(days=2), "failed"),
        ("strat-other", "sync_trades", _ago(hours=1), "pending"),
    ]
    _result, capture = await _derive(venue, db)
    assert len(_strategy_enqueues(capture)) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", _VENUES)
async def test_a_strategy_whose_marks_are_paused_three_days_gets_the_weekly_window(
    venue: str,
) -> None:
    # WR-03, Phase 174 D-04: marks_trailing_since 3 or more days old moves the attempt cooldown from
    # 20 hours to 7 days. An attempt 30 hours old holds it; an 8-day-old one does not.
    for age_hours, held in ((30, True), (6 * 24, True), (8 * 24, False)):
        db = _db_one_strategy(venue)
        db.flags = {"strat-1": {"marks_trailing_since": _day_ago(3)}}
        db.jobs = [("strat-1", "derive_broker_dailies", _ago(hours=age_hours))]
        _result, capture = await _derive(venue, db)
        assert (_strategy_enqueues(capture) == []) is held, f"attempt {age_hours}h old, held={held}"

    # A younger pause, a malformed value, a non-object flags column and a missing key keep the 20 hours.
    for flags in (
        {"marks_trailing_since": _day_ago(2)},
        {"marks_trailing_since": "not-a-date"},
        {"other": "x"},
        None,
    ):
        db = _db_one_strategy(venue)
        db.flags = {"strat-1": flags}
        db.jobs = [("strat-1", "derive_broker_dailies", _ago(hours=30))]
        _result, capture = await _derive(venue, db)
        assert len(_strategy_enqueues(capture)) == 1, f"flags {flags!r} must keep the 20-hour window"


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", _VENUES)
async def test_a_completed_refresh_that_cannot_move_the_series_gets_the_weekly_window(
    venue: str,
) -> None:
    # WR-03, Phase 214 FRESHTRUTH (founder Q1 = A, weekly cap, never exclude): the view reads the
    # strategy series_behind, its last return date is 8 or more days old, and BOTH a compute job and
    # a derive job reached done on or after last_return_date + 5 days. _behind(mt5) is 2025-06-02, so
    # the floor is 2025-06-07 and any recent done job clears it.
    async def run(db: _Db) -> list[dict[str, Any]]:
        _result, capture = await _derive(venue, db)
        return _strategy_enqueues(capture)

    both_done = [
        ("strat-1", "compute_analytics_from_csv", _ago(hours=30), "done"),
        ("strat-1", "derive_broker_dailies", _ago(hours=30), "done"),
    ]
    for age_hours, is_held in ((30, True), (6 * 24, True), (8 * 24, False)):
        db = _db_one_strategy(venue)
        db.stale_reason = {"strat-1": "series_behind"}
        db.jobs = [(sid, kind, _ago(hours=age_hours), st) for sid, kind, _at, st in both_done]
        assert (await run(db) == []) is is_held, f"completed refresh {age_hours}h old"

    # Only the derive reached done (the compute failed or never ran): the signal needs both.
    db = _db_one_strategy(venue)
    db.stale_reason = {"strat-1": "series_behind"}
    db.jobs = [both_done[1]]
    assert len(await run(db)) == 1

    # Done jobs from BEFORE last_return_date + 5 days did not try to move this series gap.
    db = _db_one_strategy(venue)
    db.stale_reason = {"strat-1": "series_behind"}
    db.jobs = [
        ("strat-1", "compute_analytics_from_csv", datetime(2025, 6, 6, tzinfo=timezone.utc), "done"),
        ("strat-1", "derive_broker_dailies", datetime(2025, 6, 6, tzinfo=timezone.utc), "done"),
        ("strat-1", "derive_broker_dailies", _ago(hours=30), "failed"),
    ]
    assert len(await run(db)) == 1

    # The view must read series_behind: any other reason keeps the 20 hours.
    db = _db_one_strategy(venue)
    db.stale_reason = {}
    db.jobs = [(sid, kind, _ago(hours=30), st) for sid, kind, _at, st in both_done]
    assert len(await run(db)) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", _VENUES)
async def test_an_in_week_series_that_is_not_yet_8_days_old_keeps_the_ordinary_window(
    venue: str,
) -> None:
    # The no-advance arm needs a last return date 8 or more days old. Five days behind today reads
    # stale in the view yet is inside the ordinary 20-hour window, so a 30-hour-old attempt does not hold.
    db = _db_one_strategy(venue, series=_day_ago(5))
    db.stale_reason = {"strat-1": "series_behind"}
    db.jobs = [
        ("strat-1", "compute_analytics_from_csv", _ago(hours=30), "done"),
        ("strat-1", "derive_broker_dailies", _ago(hours=30), "done"),
    ]
    # The mt5 per-key end (2025-06-05) is older than a series 5 days behind today, so drive the helper
    # directly with a per-key day of yesterday.
    from services.job_worker import _enqueue_linked_strategy_recompute

    ctx, capture = _build_ctx(venue, db)
    with patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())):
        enqueued = await _enqueue_linked_strategy_recompute(
            ctx.supabase, api_key_id=_KEY, per_key_last_day=_day_ago(1)
        )
    assert enqueued == ["strat-1"], capture["rpc_calls"]


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", _VENUES)
async def test_an_allocator_only_key_enqueues_no_strategy_and_the_compose_still_runs(
    venue: str,
) -> None:
    db = _Db()  # the key backs no strategy
    result, capture = await _derive(venue, db)
    assert result.outcome == DispatchOutcome.DONE
    assert _strategy_enqueues(capture) == []
    assert len(_compose_enqueues(capture)) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", _VENUES)
@pytest.mark.parametrize(
    "series",
    [
        pytest.param(_ABSENT, id="no-view-row"),
        pytest.param(None, id="null-last-return-date"),
    ],
)
async def test_a_strategy_that_never_computed_is_left_to_the_wizard_and_sync_paths(
    venue: str, series: Any
) -> None:
    # T-155.2-41: the nightly fan-out must never pull a never-computed strategy in.
    db = _db_one_strategy(venue, series=series)
    result, capture = await _derive(venue, db)
    assert result.outcome == DispatchOutcome.DONE
    assert _strategy_enqueues(capture) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", _VENUES)
async def test_only_statuses_the_cron_re_entry_admits_are_enqueued(venue: str) -> None:
    db = _Db(
        strategies=[
            {"id": "strat-pub", "status": "published"},
            {"id": "strat-draft", "status": "draft"},
            {"id": "strat-gone", "status": "archived"},
        ],
        analytics={
            "strat-pub": _behind(venue),
            "strat-draft": _behind(venue),
            "strat-gone": _behind(venue),
        },
    )
    _result, capture = await _derive(venue, db)
    assert sorted(p["p_strategy_id"] for p in _strategy_enqueues(capture)) == [
        "strat-draft",
        "strat-pub",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", _VENUES)
async def test_a_strategy_on_another_key_is_never_selected(venue: str) -> None:
    # T-155.2-42: the strategy comes from strategies.api_key_id = this key, never from a payload.
    db = _Db(
        strategies=[{"id": "strat-foreign", "status": "published", "api_key_id": "key-other"}],
        analytics={"strat-foreign": _behind(venue)},
    )
    _result, capture = await _derive(venue, db)
    assert _strategy_enqueues(capture) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", _VENUES)
async def test_a_composite_member_key_enqueues_no_stitch_and_no_derive(venue: str) -> None:
    # A composite's recompute is stitch_composite, which re-crawls every member itself, and the
    # composite fan-out refuses MT5-member composites. A key that is ONLY a composite member backs
    # no strategy directly (its strategies read is empty), so this path adds nothing for it.
    db = _Db()
    _result, capture = await _derive(venue, db)
    kinds = [p.get("p_kind") for n, p in capture["rpc_calls"] if n == "enqueue_compute_job"]
    assert "stitch_composite" not in kinds
    assert _strategy_enqueues(capture) == []
    # And the helper never reads strategy_keys to widen the set.
    assert "strategy_keys" not in db.tables_read


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", _VENUES)
async def test_one_failed_enqueue_never_starves_the_next_strategy_or_fails_the_derive(
    venue: str, caplog: pytest.LogCaptureFixture
) -> None:
    db = _Db(
        strategies=[
            {"id": "strat-A", "status": "published"},
            {"id": "strat-B", "status": "published"},
        ],
        analytics={"strat-A": _behind(venue), "strat-B": _behind(venue)},
        enqueue_raises={"strat-A"},
    )
    with caplog.at_level(logging.ERROR, logger="services.job_worker"):
        result, capture = await _derive(venue, db)

    assert result.outcome == DispatchOutcome.DONE
    # A's RPC raised, B's went through: the capture holds both attempts, B's did not raise.
    attempted = [p["p_strategy_id"] for p in _strategy_enqueues(capture)]
    assert attempted == ["strat-A", "strat-B"]
    named = [
        r for r in caplog.records
        if r.levelno == logging.ERROR and r.exc_info is not None and "strat-A" in r.getMessage()
    ]
    assert len(named) == 1, [r.getMessage() for r in caplog.records]
    assert _KEY in named[0].getMessage()
    assert not [r for r in caplog.records if "strat-B" in r.getMessage() and r.levelno >= logging.ERROR]
    # The epilogue still ran.
    assert len(_compose_enqueues(capture)) == 1


# ---------------------------------------------------------------------------
# Both key-mode exits, through one helper, with the outer isolation
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
@pytest.mark.parametrize("one_day", [False, True], ids=["two-day-exit", "under-two-day-exit"])
async def test_a_helper_that_raises_skips_neither_the_epilogue_nor_changes_the_outcome(
    one_day: bool, caplog: pytest.LogCaptureFixture
) -> None:
    helper = AsyncMock(side_effect=RuntimeError("boom"))
    with caplog.at_level(logging.ERROR, logger="services.job_worker"):
        result, capture = await _derive(
            "binance", _Db(),
            one_day=one_day,
            extra_patches=[patch("services.job_worker._enqueue_linked_strategy_recompute", new=helper)],
        )
    assert result.outcome == DispatchOutcome.DONE
    helper.assert_awaited_once()
    assert helper.await_args.kwargs["api_key_id"] == _KEY
    # The under-2-day exit with no marks writes no per-key row, so it names no per-key day.
    if one_day:
        assert helper.await_args.kwargs["per_key_last_day"] is None
    else:
        assert helper.await_args.kwargs["per_key_last_day"] == "2024-05-02"
    assert len(_compose_enqueues(capture)) == 1, "the compose epilogue must still run"
    assert any(
        r.exc_info is not None and _KEY in r.getMessage() for r in caplog.records
    ), "the failure must be logged with logger.exception, naming the key"


@pytest.mark.asyncio
@pytest.mark.parametrize("one_day", [False, True], ids=["two-day-exit", "under-two-day-exit"])
async def test_a_helper_that_hangs_is_cut_off_and_the_epilogue_still_runs(
    one_day: bool, caplog: pytest.LogCaptureFixture
) -> None:
    # SF-01: a stalled read inside the helper must never spend the job budget and skip the compose
    # epilogue. The helper here never returns; the bound is shrunk so the test is fast, and an
    # outer guard turns an UNBOUNDED call into a red test instead of a hung run.
    async def _hangs(*_a: Any, **_k: Any) -> list[str]:
        await asyncio.Event().wait()
        return []

    with caplog.at_level(logging.ERROR, logger="services.job_worker"):
        result, capture = await asyncio.wait_for(
            _derive(
                "binance", _Db(),
                one_day=one_day,
                extra_patches=[
                    patch("services.job_worker._enqueue_linked_strategy_recompute", new=_hangs),
                    patch("services.job_worker._LINKED_RECOMPUTE_TIMEOUT_S", 0.05),
                ],
            ),
            timeout=30,
        )
    assert result.outcome == DispatchOutcome.DONE
    assert len(_compose_enqueues(capture)) == 1, "the compose epilogue must still run"
    assert any(
        r.levelno == logging.ERROR and "timed out" in r.getMessage() and _KEY in r.getMessage()
        for r in caplog.records
    ), "the timeout must be logged, naming the api key"


@pytest.mark.asyncio
async def test_the_under_two_day_exit_with_no_per_key_day_enqueues_nothing() -> None:
    db = _db_one_strategy("binance")
    result, capture = await _derive("binance", db, one_day=True)
    assert result.outcome == DispatchOutcome.DONE
    assert _strategy_enqueues(capture) == []
    assert len(_compose_enqueues(capture)) == 1


# ---------------------------------------------------------------------------
# The under-2-day exit WITH a per-key row (a mark day this exit measured)
# ---------------------------------------------------------------------------
def _marked_one_day_patches(measured_day: str) -> list[Any]:
    """Force the key-mode under-2-day exit to write one measured per-key row, the way a stored
    mark does. ``apply_marks`` is replaced by a stand-in that returns the marked series; the
    marks arithmetic is covered in test_nav_marks_derive_apply.py and is not under test here."""
    from services.nav_marks import StoredMark
    from services.nav_marks_apply import MarkedSeries

    marked = MarkedSeries(
        returns=pd.Series([0.01], index=pd.DatetimeIndex([measured_day]), dtype="float64"),
        marks_since=measured_day,
        mark_gap_days=(),
        flow_moves={},
        held_out_flow_days=(),
        marked_levels={},
        writer_day_pnl={},
        terminal=(measured_day, 10_000.0),
        covered_from=measured_day,
        covered_days=(measured_day,),
        flow_moves_out={},
    )
    mark = StoredMark(
        mark_day=measured_day, marked_at=f"{measured_day}T00:10:00+00:00", venue="binance",
        nav_usd=10_000.0, open_pnl_usd=0.0, nav_native=10_000.0, native_unit="USD",
    )
    return [
        patch("services.job_worker.read_key_marks", new=MagicMock(return_value=[mark])),
        patch("services.job_worker.apply_marks", new=MagicMock(return_value=marked)),
    ]


@pytest.mark.asyncio
async def test_the_under_two_day_exit_with_a_later_per_key_day_enqueues_through_the_same_helper() -> None:
    # The strategy's analytics end 2024-04-28; this exit wrote a per-key row for 2024-05-04.
    # The binance double is only the convenient crawl for the under-2-day exit; the staleness view
    # serves only ledger venues, so the strategy is modelled as one it serves (view_exchange).
    db = _Db(
        strategies=[{"id": "strat-1", "status": "published"}],
        analytics={"strat-1": "2024-04-28"},
        view_exchange="mt5",
    )
    result, capture = await _derive(
        "binance", db, one_day=True, extra_patches=_marked_one_day_patches("2024-05-04")
    )
    assert result.outcome == DispatchOutcome.DONE
    # The exit really wrote its per-key row (otherwise this test would not be about this exit).
    assert [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
    enq = _strategy_enqueues(capture)
    assert [p["p_strategy_id"] for p in enq] == ["strat-1"]
    assert enq[0]["p_kind"] == "derive_broker_dailies"
    assert enq[0]["p_metadata"]["source"] == "ledger-refresh"
    assert len(_compose_enqueues(capture)) == 1

    # The same exit with analytics that already reach that per-key day enqueues nothing.
    db = _Db(
        strategies=[{"id": "strat-1", "status": "published"}],
        analytics={"strat-1": "2024-05-04"},
        view_exchange="mt5",
    )
    _result, capture = await _derive(
        "binance", db, one_day=True, extra_patches=_marked_one_day_patches("2024-05-04")
    )
    assert _strategy_enqueues(capture) == []
