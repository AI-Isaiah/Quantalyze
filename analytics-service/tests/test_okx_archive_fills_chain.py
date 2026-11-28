"""Phase 259 OKXARCHIVEFILLS plan 03: the chain from `sync_trades` to the archive-fills read.

WHY THE CHAIN EXISTS. OKX's `fills-history` endpoint reaches back about three months, so a
strategy whose track record starts earlier has no stored fills for its oldest quarters; only the
bills archive can recover them. Left to an operator that read never runs for a future strategy,
so a finished `sync_trades` chains one `okx_archive_rebuild` job (mode `fills_apply`) on the
syncing key, the way it already chains `derive_broker_dailies`.

WHY IT MUST NEVER CHANGE THE SYNC OUTCOME. The chain is a best-effort bonus on a job whose real
work (the daily store, the fills store, the cursor, the follow-on enqueue) is already done. A
raised read or a hung read in the chain must not turn a DONE sync into a retry, which would
re-read OKX for nothing and could re-store rows. The raise and hang arms read the outcome and
`trade_count` back and compare them with a run whose chain does nothing.

WHY A CALIBRATE MUST NOT SUPPRESS THE BACKFILL. `fills_calibrate` is the PROD dry run that
precedes the first apply. If it counted toward the 14-day cooldown, the dry run that proves the
read is safe would be the thing that stops the backfill from ever running.

THE FAKES. `_FakeSupabase.table()` serves `csv_daily_returns`, `trades`, `api_keys`,
`compute_jobs` and `strategy_analytics` with REAL `eq`, `in_`, `gt`, `order` and `limit`
filtering (a `metadata->>mode` column reads `row["metadata"]["mode"]`; `gt` compares parsed
instants), so a query that forgot a filter returns the wrong rows instead of passing on a
MagicMock default. `rpc()` records every call by name and payload in order. Every instant is a
typed literal with its epoch ms hand-typed beside it, never computed by the code under test.

NEUTER (restored from a byte backup, recorded in plan 08): the arms
`test_chain_after_follow_on_enqueue`, `test_chain_exception_leaves_outcome_done`,
`test_cooldown_ignores_calibrate` and `test_seam_skips_failed_fills_read` are the PROOF-01 arms.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
from datetime import datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import services.exchange as exchange_module
import services.okx_archive_fills_chain as chain_module
from services.job_worker import (
    JOB_CHAIN_FOLLOW_ON,
    TIMEOUT_PER_KIND,
    DispatchOutcome,
    run_sync_trades_job,
)
from services.okx_archive_fills_chain import CHAIN_VERDICTS, chain_okx_archive_fills
from tests._binance_fills import RereadBounds

STRATEGY_ID = "strat-259-chain"
KEY_ID = "key-1"
SIBLING_KEY_ID = "key-2"
OTHER_ACCOUNT_KEY_ID = "key-3"
ACCOUNT = "U1"

# Instants, each with its epoch ms hand-typed beside it.
NOW_MS = 1795780800000  # 2026-11-27T12:00:00Z; the write bound is 2026-08-29T12:00:00Z
# A clock inside the daily-chain window. (The plan carried 1795745520000 here, which is
# 2026-11-27T02:12:00Z, outside the window; this is 2026-11-27T00:12:00Z.)
WINDOW_NOW_MS = 1795738320000
EXPECTED_RUN_AT = "2026-11-27T01:50:00+00:00"
ANCHOR_OLD = "2026-02-23"  # 1771804800000, below the write bound
ANCHOR_IN_REACH = "2026-10-01"  # 1790812800000, above the write bound
FILL_1_DAY_AFTER_ANCHOR = "2026-02-24T09:00:00+00:00"
FILL_3_DAYS_AFTER_ANCHOR = "2026-02-26T09:00:00+00:00"

# `created_at` of a compute_jobs row N days before NOW_MS; the cooldown cutoff is 2026-11-13T12:00Z.
CREATED_1_DAY = "2026-11-26T12:00:00+00:00"
CREATED_3_DAYS = "2026-11-24T12:00:00+00:00"
CREATED_15_DAYS = "2026-11-12T12:00:00+00:00"

ARCHIVE_ENQUEUE = {
    "p_strategy_id": None,
    "p_api_key_id": KEY_ID,
    "p_kind": "okx_archive_rebuild",
    "p_metadata": {"mode": "fills_apply"},
}


def _key_row(**extra: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": KEY_ID,
        "exchange": "okx",
        "user_id": "user-1",
        "last_sync_at": "2026-11-13T06:00:00+00:00",
        "last_fetched_trade_timestamp": None,
        "venue_account_id": ACCOUNT,
    }
    row.update(extra)
    return row


def _job_row(
    status: str,
    *,
    api_key_id: str = KEY_ID,
    mode: str = "fills_apply",
    created_at: str = CREATED_3_DAYS,
    last_error: str | None = None,
) -> dict[str, Any]:
    return {
        "kind": "okx_archive_rebuild",
        "api_key_id": api_key_id,
        "status": status,
        "last_error": last_error,
        "created_at": created_at,
        "metadata": {"mode": mode},
    }


def _fill_row(timestamp: str) -> dict[str, Any]:
    return {
        "strategy_id": STRATEGY_ID,
        "is_fill": True,
        "exchange": "okx",
        "timestamp": timestamp,
    }


class _World:
    """Rows by table, plus everything the fake saw."""

    def __init__(
        self,
        *,
        anchor: str | None = ANCHOR_OLD,
        fills: list[dict[str, Any]] | None = None,
        jobs: list[dict[str, Any]] | None = None,
    ) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {
            "csv_daily_returns": (
                [] if anchor is None else [{"strategy_id": STRATEGY_ID, "date": anchor}]
            ),
            "trades": list(fills or []),
            "api_keys": [
                {"id": KEY_ID, "exchange": "okx", "venue_account_id": ACCOUNT},
                {"id": SIBLING_KEY_ID, "exchange": "okx", "venue_account_id": ACCOUNT},
                {"id": OTHER_ACCOUNT_KEY_ID, "exchange": "okx", "venue_account_id": "U2"},
            ],
            "compute_jobs": list(jobs or []),
        }
        self.table_reads: list[str] = []
        self.rpcs: list[tuple[str, dict[str, Any]]] = []
        self.bounds = RereadBounds()

    def archive_enqueues(self) -> list[dict[str, Any]]:
        return [
            payload
            for name, payload in self.rpcs
            if name == "enqueue_compute_job"
            and payload.get("p_kind") == "okx_archive_rebuild"
        ]

    def supabase(self) -> Any:
        return _FakeSupabase(self)


def _value(row: dict[str, Any], col: str) -> Any:
    if "->>" in col:
        head, key = col.split("->>")
        inner = row.get(head)
        return inner.get(key) if isinstance(inner, dict) else None
    return row.get(col)


class _Query:
    def __init__(self, world: _World, name: str) -> None:
        self._world = world
        self._name = name
        self._cols: list[str] | None = None
        self._filters: list[tuple[str, str, Any]] = []
        self._order: tuple[str, bool] | None = None
        self._limit: int | None = None

    def select(self, cols: str = "*", *_a: Any, **_k: Any) -> "_Query":
        names = [c.strip() for c in cols.split(",")]
        self._cols = None if names == ["*"] else names
        return self

    def eq(self, col: str, val: Any) -> "_Query":
        self._filters.append(("eq", col, val))
        return self

    def in_(self, col: str, vals: Any) -> "_Query":
        self._filters.append(("in", col, list(vals)))
        return self

    def gt(self, col: str, val: Any) -> "_Query":
        self._filters.append(("gt", col, val))
        return self

    def order(self, col: str, desc: bool = False) -> "_Query":
        self._order = (col, desc)
        return self

    def limit(self, n: int) -> "_Query":
        self._limit = n
        return self

    def _keep(self, row: dict[str, Any]) -> bool:
        for kind, col, val in self._filters:
            got = _value(row, col)
            if kind == "eq" and got != val:
                return False
            if kind == "in" and got not in val:
                return False
            if kind == "gt":
                if not isinstance(got, str) or not (
                    datetime.fromisoformat(got) > datetime.fromisoformat(val)
                ):
                    return False
        return True

    def execute(self) -> Any:
        self._world.table_reads.append(self._name)
        matched = [r for r in self._world.tables.get(self._name, []) if self._keep(r)]
        if self._order is not None:
            col, desc = self._order
            matched.sort(key=lambda r: str(r[col]), reverse=desc)
        if self._limit is not None:
            matched = matched[: self._limit]
        if self._cols is not None:
            matched = [{c: r.get(c) for c in self._cols} for r in matched]
        return SimpleNamespace(data=[dict(r) for r in matched])

    def upsert(self, *_a: Any, **_k: Any) -> Any:
        return MagicMock(execute=lambda: MagicMock(data=None))


class _FakeAnalytics:
    def select(self, *_a: Any, **_k: Any) -> "_FakeAnalytics":
        return self

    def eq(self, *_a: Any, **_k: Any) -> "_FakeAnalytics":
        return self

    def maybe_single(self) -> "_FakeAnalytics":
        return self

    def execute(self) -> Any:
        return MagicMock(data={"data_quality_flags": {}})

    def upsert(self, *_a: Any, **_k: Any) -> Any:
        return MagicMock(execute=lambda: MagicMock(data=None))


class _FakeSupabase:
    def __init__(self, world: _World) -> None:
        self._world = world

    def table(self, name: str) -> Any:
        if name in self._world.tables:
            return _Query(self._world, name)
        if name == "strategy_analytics":
            return _FakeAnalytics()
        if name == "strategy_fills_reread_bounds":
            return self._world.bounds.table()
        return MagicMock()

    def rpc(self, name: str, payload: dict[str, Any]) -> Any:
        self._world.rpcs.append((name, dict(payload)))
        if name == "set_strategy_fills_reread_bound":
            return self._world.bounds.rpc(payload)
        return MagicMock(
            execute=lambda: MagicMock(data=True if name == "advance_sync_cursor" else 0)
        )


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Pin `services.exchange._now_ms` (the chain reads it at call time)."""

    def _set(now_ms: int) -> None:
        monkeypatch.setattr(exchange_module, "_now_ms", lambda: now_ms)

    _set(NOW_MS)
    return _set


async def _run_handler(
    world: _World,
    *,
    key_extra: dict[str, Any] | None = None,
    exchange: str = "okx",
    ingestion: bool = True,
    raw_error: Exception | None = None,
    fills_flags: dict[str, Any] | None = None,
    daily_flags: dict[str, Any] | None = None,
    daily_trades: list[dict[str, Any]] | None = None,
) -> Any:
    """Drive the REAL `run_sync_trades_job` against `world`. Mirrors
    `tests/test_okxtrades_cursor.py::_run_job`'s patch list; `ctx.key_row` carries
    `venue_account_id`, which that driver's does not."""
    mock_exchange = AsyncMock()
    mock_exchange.close = AsyncMock()
    mock_ctx = MagicMock()
    mock_ctx.exchange = mock_exchange
    mock_ctx.supabase = world.supabase()
    mock_ctx.strategy_row = {"id": STRATEGY_ID, "user_id": "user-1"}
    mock_ctx.key_row = _key_row(exchange=exchange, **(key_extra or {}))

    fetch_raw = (
        AsyncMock(side_effect=raw_error)
        if raw_error is not None
        else AsyncMock(return_value=[])
    )
    job = {"id": "job-259-03", "kind": "sync_trades", "strategy_id": STRATEGY_ID}
    patches = [
        patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ),
        patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=daily_trades or []),
        ),
        patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=10000.0),
        ),
        patch("services.job_worker.fetch_raw_trades", new=fetch_raw),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
        patch("services.job_worker._RAW_TRADE_INGESTION_ENABLED", ingestion),
    ]
    if fills_flags is not None or daily_flags is not None:
        # call 1 = the daily drain, call 2 = the fills drain.
        patches.append(
            patch(
                "services.job_worker.get_and_clear_last_dq_flags",
                side_effect=itertools.chain(
                    [daily_flags or {}, fills_flags or {}], itertools.repeat({})
                ),
            )
        )
    for p in patches:
        p.start()
    try:
        result = await run_sync_trades_job(job)
    finally:
        for p in reversed(patches):
            p.stop()
    return result


def _spy(monkeypatch: pytest.MonkeyPatch, **kwargs: Any) -> AsyncMock:
    """Replace the chain with a recorder. The seam imports it at call time, so the patch on the
    module attribute is what the handler sees."""
    spy = AsyncMock(**kwargs)
    monkeypatch.setattr(chain_module, "chain_okx_archive_fills", spy)
    return spy


class TestTracer:
    async def test_chain_after_follow_on_enqueue(
        self, clock: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        daily = [{"timestamp": "2026-11-26T00:00:00+00:00", "symbol": "BTC-USDT-SWAP"}] * 2

        # Baseline: the same sync with the chain doing nothing.
        baseline_world = _World()
        with monkeypatch.context() as patched:
            patched.setattr(chain_module, "chain_okx_archive_fills", AsyncMock())
            baseline = await _run_handler(baseline_world, daily_trades=daily)
        assert baseline.outcome == DispatchOutcome.DONE

        world = _World()
        result = await _run_handler(world, daily_trades=daily)

        assert result.outcome == DispatchOutcome.DONE
        assert result.trade_count == baseline.trade_count == 2
        enqueues = [p for n, p in world.rpcs if n == "enqueue_compute_job"]
        kinds = [p["p_kind"] for p in enqueues]
        assert kinds.count("derive_broker_dailies") == 1
        assert kinds.count("okx_archive_rebuild") == 1
        assert kinds.index("derive_broker_dailies") < kinds.index("okx_archive_rebuild")
        assert world.archive_enqueues() == [ARCHIVE_ENQUEUE]


async def _call(world: _World, key_row: dict[str, Any] | None = None) -> str:
    return await chain_okx_archive_fills(
        world.supabase(), key_row if key_row is not None else _key_row(), STRATEGY_ID
    )


# (verdict, world builder, key row builder). One table drives both the per-verdict arm and the
# arm that asserts every verdict in CHAIN_VERDICTS is produced by at least one case.
VERDICT_CASES: list[tuple[str, Any, Any]] = [
    ("not_okx", lambda: _World(), lambda: _key_row(exchange="bybit")),
    ("no_account", lambda: _World(), lambda: _key_row(venue_account_id="")),
    ("no_anchor", lambda: _World(anchor=None), _key_row),
    ("unreadable", lambda: _World(anchor="garbage"), _key_row),
    ("anchor_in_reach", lambda: _World(anchor=ANCHOR_IN_REACH), _key_row),
    (
        "fills_reach_anchor",
        lambda: _World(fills=[_fill_row(FILL_1_DAY_AFTER_ANCHOR)]),
        _key_row,
    ),
    (
        "cooldown",
        lambda: _World(
            fills=[_fill_row(FILL_3_DAYS_AFTER_ANCHOR)], jobs=[_job_row("done")]
        ),
        _key_row,
    ),
    (
        "enqueued",
        lambda: _World(fills=[_fill_row(FILL_3_DAYS_AFTER_ANCHOR)]),
        _key_row,
    ),
]


class TestVerdicts:
    @pytest.mark.parametrize(
        ("verdict", "build_world", "build_key"),
        VERDICT_CASES,
        ids=[case[0] for case in VERDICT_CASES],
    )
    async def test_chain_verdicts(
        self, clock: Any, verdict: str, build_world: Any, build_key: Any
    ) -> None:
        world = build_world()
        assert await _call(world, build_key()) == verdict
        # Only the enqueued verdict writes; every other verdict leaves the queue alone.
        assert len(world.archive_enqueues()) == (1 if verdict == "enqueued" else 0)
        if verdict in ("not_okx", "no_account"):
            assert world.table_reads == []

    async def test_every_verdict_is_produced(self, clock: Any) -> None:
        produced = {
            await _call(build_world(), build_key())
            for _verdict, build_world, build_key in VERDICT_CASES
        }
        assert produced == CHAIN_VERDICTS

    async def test_an_unparseable_stored_fill_instant_is_unreadable(
        self, clock: Any
    ) -> None:
        world = _World(fills=[_fill_row("not-an-instant")])
        assert await _call(world) == "unreadable"
        assert world.archive_enqueues() == []

    async def test_enqueued_payload_is_exactly_the_account_free_literal(
        self, clock: Any
    ) -> None:
        # No strategy list and no quarter list ride in the metadata: the per-api_key in-flight
        # dedupe drops new metadata, so the job derives both in-claim.
        world = _World(fills=[_fill_row(FILL_3_DAYS_AFTER_ANCHOR)])
        assert await _call(world) == "enqueued"
        assert world.archive_enqueues() == [ARCHIVE_ENQUEUE]


class TestCooldown:
    async def test_cooldown_counts_sibling_key_apply(self, clock: Any) -> None:
        # The read is scoped per OKX ACCOUNT and one job serves every strategy of it, so a
        # recent apply on a sibling key of the same account answers this key's sync.
        world = _World(
            fills=[_fill_row(FILL_3_DAYS_AFTER_ANCHOR)],
            jobs=[_job_row("done", api_key_id=SIBLING_KEY_ID, created_at=CREATED_3_DAYS)],
        )
        assert await _call(world) == "cooldown"
        assert world.archive_enqueues() == []

    async def test_cooldown_ignores_calibrate(self, clock: Any) -> None:
        # The PROD dry run must not suppress the backfill it precedes.
        world = _World(
            fills=[_fill_row(FILL_3_DAYS_AFTER_ANCHOR)],
            jobs=[_job_row("done", mode="fills_calibrate", created_at=CREATED_1_DAY)],
        )
        assert await _call(world) == "enqueued"
        assert world.archive_enqueues() == [ARCHIVE_ENQUEUE]

    @pytest.mark.parametrize(
        ("job", "expected"),
        [
            pytest.param(
                _job_row("failed_final", last_error="okx_archive_rebuild: invalid_input"),
                "enqueued",
                id="old_worker_invalid_input_rechains",
            ),
            pytest.param(
                _job_row(
                    "failed_final",
                    last_error="okx_archive_rebuild: archive_incomplete cause=bal_chain_break",
                ),
                "cooldown",
                id="named_stop_cools_down",
            ),
            pytest.param(
                _job_row("failed_final", last_error=None),
                "enqueued",
                id="unnamed_failure_rechains",
            ),
            pytest.param(
                _job_row("failed_final", last_error="some other worker: archive_incomplete"),
                "enqueued",
                id="error_outside_the_rebuild_prefix_rechains",
            ),
            pytest.param(
                _job_row("failed_final", last_error="okx_archive_rebuild: "),
                "enqueued",
                id="prefix_without_a_class_rechains",
            ),
            *(
                pytest.param(
                    _job_row(
                        "failed_final", last_error=f"okx_archive_rebuild: {stop} step=write"
                    ),
                    "enqueued",
                    id=f"exhausted_transient_{stop}_rechains",
                )
                for stop in (
                    "claim_budget_exceeded",
                    "link_expired",
                    "live_fetch_failed",
                    "fills_write_failed",
                    "fills_count_not_persisted",
                )
            ),
            pytest.param(
                _job_row(
                    "failed_final",
                    last_error="okx_archive_rebuild: fills_legacy_mismatch position=0 unequal=1",
                ),
                "cooldown",
                id="permanent_fills_stop_cools_down",
            ),
            pytest.param(_job_row("pending"), "cooldown", id="in_flight_cools_down"),
            pytest.param(
                _job_row("done", created_at=CREATED_15_DAYS),
                "enqueued",
                id="done_15_days_ago_is_outside_the_window",
            ),
            pytest.param(
                _job_row("done", api_key_id=OTHER_ACCOUNT_KEY_ID),
                "enqueued",
                id="another_account_does_not_count",
            ),
        ],
    )
    async def test_cooldown_rules(
        self, clock: Any, job: dict[str, Any], expected: str
    ) -> None:
        world = _World(fills=[_fill_row(FILL_3_DAYS_AFTER_ANCHOR)], jobs=[job])
        assert await _call(world) == expected


class TestCooldownClassBinding:
    def test_cooldown_unanswered_classes_bind_the_job_sets(self) -> None:
        """Why this matters: the chain cannot import the job modules (a cycle), so its list of
        classes that do not answer the read is a copy. If a transient class is added to the job
        without being added here, an exhausted transient stop would start a 14-day cooldown and a
        partial write would never be completed. ``invalid_input`` is the one non-transient member."""
        from services import okx_archive_fills, okx_archive_job

        transient = (
            okx_archive_job.TRANSIENT_STOP_CLASSES | okx_archive_fills.FILLS_TRANSIENT_STOP_CLASSES
        )
        assert chain_module._UNANSWERED_STOP_CLASSES == transient | {"invalid_input"}


class TestWindowDeferral:
    async def test_chain_window_run_at(self, clock: Any) -> None:
        clock(WINDOW_NOW_MS)
        deferred = _World(fills=[_fill_row(FILL_3_DAYS_AFTER_ANCHOR)])
        assert await _call(deferred) == "enqueued"
        assert deferred.archive_enqueues() == [{**ARCHIVE_ENQUEUE, "p_run_at": EXPECTED_RUN_AT}]

        clock(NOW_MS)
        immediate = _World(fills=[_fill_row(FILL_3_DAYS_AFTER_ANCHOR)])
        assert await _call(immediate) == "enqueued"
        assert "p_run_at" not in immediate.archive_enqueues()[0]


class TestSeamGating:
    async def test_seam_runs_on_empty_clean_read(
        self, clock: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Control for the skip arms below: the plain clean run, whose fills read is EMPTY, does
        # reach the chain and enqueue, so a skip arm cannot pass by never reaching the seam.
        spy = _spy(monkeypatch, wraps=chain_okx_archive_fills)
        world = _World()
        await _run_handler(world)
        spy.assert_awaited_once()
        assert world.archive_enqueues() == [ARCHIVE_ENQUEUE]

    async def test_seam_skips_non_okx(
        self, clock: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        spy = _spy(monkeypatch)
        await _run_handler(_World(), exchange="bybit")
        spy.assert_not_awaited()

    async def test_seam_skips_ingestion_off(
        self, clock: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        spy = _spy(monkeypatch)
        await _run_handler(_World(), ingestion=False)
        spy.assert_not_awaited()

    async def test_seam_skips_failed_fills_read(
        self, clock: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A raised fills fetch sets `phase2_failed`: the stored fills are not a clean answer, so
        # the archive reconcile must not run against them.
        spy = _spy(monkeypatch)
        result = await _run_handler(_World(), raw_error=RuntimeError("fills fetch down"))
        assert result.outcome == DispatchOutcome.DONE
        spy.assert_not_awaited()

    async def test_seam_skips_truncated_fills_read(
        self, clock: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        spy = _spy(monkeypatch)
        await _run_handler(_World(), fills_flags={"sync_truncated_okx": True})
        spy.assert_not_awaited()

    async def test_seam_runs_on_refused_daily_read(
        self, clock: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The three PROD OKX strategies' daily read is refused on every sync today
        # (`daily_pnl_non_usd_okx`) while their fills read is clean. The archive reconcile depends
        # on the stored fills, not the daily rows, so the refusal must not block the chain.
        spy = _spy(monkeypatch, wraps=chain_okx_archive_fills)
        world = _World()
        daily = [{"timestamp": "2026-11-26T00:00:00+00:00", "symbol": "BTC-USDT-SWAP"}] * 2
        await _run_handler(
            world, daily_flags={"daily_pnl_non_usd_okx": True}, daily_trades=daily
        )
        # Premise: the daily store really was refused (a store would have called sync_trades).
        assert [n for n, _p in world.rpcs if n == "sync_trades"] == []
        spy.assert_awaited_once()
        assert world.archive_enqueues() == [ARCHIVE_ENQUEUE]


class TestSeamIsolation:
    async def test_chain_exception_leaves_outcome_done(
        self,
        clock: Any,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        daily = [{"timestamp": "2026-11-26T00:00:00+00:00", "symbol": "BTC-USDT-SWAP"}] * 2
        with monkeypatch.context() as patched:
            patched.setattr(chain_module, "chain_okx_archive_fills", AsyncMock())
            baseline = await _run_handler(_World(), daily_trades=daily)

        spy = _spy(monkeypatch, side_effect=RuntimeError("chain read down"))
        with caplog.at_level(logging.ERROR):
            result = await _run_handler(_World(), daily_trades=daily)

        spy.assert_awaited_once()  # the seam was reached, so the DONE below is the isolation
        assert result.outcome == DispatchOutcome.DONE
        assert result.trade_count == baseline.trade_count == 2
        assert any(
            STRATEGY_ID in r.getMessage() and "chain failed" in r.getMessage()
            for r in caplog.records
        )

    async def test_chain_timeout_leaves_outcome_done(
        self, clock: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _hang(_fn: Any) -> Any:
            await asyncio.sleep(30)

        monkeypatch.setattr(chain_module, "CHAIN_TIMEOUT_S", 0.05)
        monkeypatch.setattr(chain_module, "db_read_with_retry", _hang)
        daily = [{"timestamp": "2026-11-26T00:00:00+00:00", "symbol": "BTC-USDT-SWAP"}] * 2
        world = _World()
        result = await _run_handler(world, daily_trades=daily)
        assert result.outcome == DispatchOutcome.DONE
        assert result.trade_count == 2
        assert world.archive_enqueues() == []


class TestTopology:
    def test_topology_pins_unchanged(self) -> None:
        # The chain is a cross-target re-entry, not a parented follow-on: the reaper ceiling
        # and the follow-on topology must not learn the kind.
        assert "okx_archive_rebuild" not in JOB_CHAIN_FOLLOW_ON
        assert all("okx_archive_rebuild" not in tail for tail in JOB_CHAIN_FOLLOW_ON.values())
        assert len(TIMEOUT_PER_KIND) == 14
