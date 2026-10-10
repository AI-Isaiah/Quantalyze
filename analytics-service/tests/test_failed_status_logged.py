"""Phase 164.6.6.3.3 plan 07 (D-08, RESEARCH A5): every failed-status write is
stored AND logged.

The owner page tells the account holder "Analytics couldn't be computed from
this data. We've logged the error." That sentence is a claim about THIS
service: that the failure left a log record an operator can find, and that the
reason is on the ``strategy_analytics`` row. A path that stamps
``computation_status: 'failed'`` without either half makes the sentence false.

The census below is one row per ``"computation_status": "failed"`` literal in
``analytics-service/services`` (``git grep -n '"computation_status": "failed"'
-- analytics-service/services`` prints exactly the eight sites listed in
``_CENSUS``). Each row is DRIVEN, not read: the path is run to failure against
a recording Supabase fake, and the test asserts

  (a) an upsert carrying ``computation_status == 'failed'`` and a non-empty
      string ``computation_error``;
  (b) a log record from that module's logger that names the strategy (so a
      line about some other strategy cannot satisfy it), at the level the
      module's own idiom uses for that path (see ``_Outcome.min_level``).

The level is ERROR on every path in ``analytics_runner.py`` and on the
sync_trades enqueue failure, which all log at ERROR already. It is WARNING on
the two terminal-stamp closures in ``job_worker.py``: those reserve ERROR for a
stamp that needs a person (one that un-publishes a live row, or whose own I/O
failed), and ``tests/test_stamp_io_exhaustive.py`` pins "exactly one ERROR
line" per such case. An unconditional ERROR there turned nine of its cases RED
(measured 2026-10-09), so the closures log the stamped cause at WARNING and the
record also has to carry the stored ``computation_error`` text.

``test_census_matches_source`` pins the row count to the source, so a ninth
failed-status site added later has no row here and turns that test RED instead
of silently escaping the claim.

Two of the rows (the derive and composite terminal stamps) are CHOKE POINTS:
one closure reached from many call sites. Each is driven through two different
callers, because the logging lives in the closure and the callers differ in
whether they log anything of their own.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Awaitable, Callable
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

from services.analytics_runner import PaginatedSelectTruncated
from services.job_worker import (
    DispatchOutcome,
    run_derive_broker_dailies_job,
    run_stitch_composite_job,
)
from services.nav_twr import NavReconstructionError
from tests.test_csv_analytics_runner import (
    _ALLOC_CFG_SIMPLE_ACTIVE,
    _daily_rows_15,
    _make_broker_supabase_mock,
    _make_supabase_mock,
)
from tests.test_derive_broker_dailies_dualmode import (
    _build_ctx,
    _patches,
    _patches_with_combine,
)
from tests.test_stitch_composite_job import (
    _STRATEGY_ID as _COMPOSITE_STRATEGY_ID,
    _FakeSupabase,
    _apply,
    _deribit_patches,
    _member,
)

_RUNNER_LOGGER = "quantalyze.analytics.runner"
_WORKER_LOGGER = "quantalyze.analytics.job_worker"

_SERVICES = Path(__file__).resolve().parent.parent / "services"

# One row per failed-status literal in services/. Keep in step with the
# `test_census_matches_source` count; every id below has a driver in _DRIVERS.
_CENSUS = [
    "runner.insufficient_history",
    "runner.pagination_truncated",
    "runner.malformed_denominator_config",
    "runner.unrecoverable",
    "runner.unrecoverable_schema_cache_reissue",
    "worker.sync_trades_enqueue_failed",
    "worker.derive_terminal_stamp",
    "worker.composite_terminal_stamp",
]


class _Outcome:
    """What a driven failure path left behind."""

    def __init__(
        self,
        *,
        failed_payloads: list[dict[str, Any]],
        logger_name: str,
        strategy_id: str,
        min_level: int = logging.ERROR,
        record_carries_stored_error: bool = False,
    ) -> None:
        self.failed_payloads = failed_payloads
        self.logger_name = logger_name
        self.strategy_id = strategy_id
        self.min_level = min_level
        # True when the record must repeat the stored computation_error, so the
        # log and the row cannot name different causes.
        self.record_carries_stored_error = record_carries_stored_error


def _failed(payloads: list[Any]) -> list[dict[str, Any]]:
    return [
        p for p in payloads
        if isinstance(p, dict) and p.get("computation_status") == "failed"
    ]


def _mock_upserts(sb: MagicMock, table: str = "strategy_analytics") -> list[Any]:
    return [c.args[0] for c in sb.table(table).upsert.call_args_list]


# ---------------------------------------------------------------------------
# Drivers: run one census row's path to failure.
# ---------------------------------------------------------------------------

async def _drive_insufficient_history() -> _Outcome:
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_supabase_mock([{"date": "2024-01-01", "daily_return": 0.005}])
    with patch("services.analytics_runner.get_supabase", return_value=sb):
        with pytest.raises(HTTPException) as exc:
            await run_csv_strategy_analytics("strat-insufficient")
    assert exc.value.status_code == 400
    return _Outcome(
        failed_payloads=_failed(_mock_upserts(sb)),
        logger_name=_RUNNER_LOGGER,
        strategy_id="strat-insufficient",
    )


async def _drive_pagination_truncated() -> _Outcome:
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_supabase_mock([])
    trunc = PaginatedSelectTruncated(page_count=1000, page_size=1000, hint="h")

    async def _db_execute(fn: Callable[[], Any]) -> Any:
        if getattr(fn, "__name__", "") == "_load_series":
            raise trunc
        return fn()

    with patch("services.analytics_runner.get_supabase", return_value=sb), patch(
        "services.analytics_runner.db_execute", side_effect=_db_execute
    ):
        with pytest.raises(PaginatedSelectTruncated):
            await run_csv_strategy_analytics("strat-truncated")
    return _Outcome(
        failed_payloads=_failed(_mock_upserts(sb)),
        logger_name=_RUNNER_LOGGER,
        strategy_id="strat-truncated",
    )


async def _drive_malformed_config() -> _Outcome:
    from services.analytics_runner import run_csv_strategy_analytics

    bad_cfg = {**_ALLOC_CFG_SIMPLE_ACTIVE, "metrics_basis": "not_a_basis"}
    sb = _make_broker_supabase_mock(
        _daily_rows_15(), api_key_id="key-1", returns_denominator_config=bad_cfg
    )
    with patch("services.analytics_runner.get_supabase", return_value=sb), patch(
        "services.analytics_runner.get_benchmark_returns",
        new=AsyncMock(return_value=(None, True)),
    ):
        with pytest.raises(HTTPException) as exc:
            await run_csv_strategy_analytics("strat-config")
    assert exc.value.status_code == 422
    return _Outcome(
        failed_payloads=_failed(_mock_upserts(sb)),
        logger_name=_RUNNER_LOGGER,
        strategy_id="strat-config",
    )


def _unrecoverable_rows() -> list[dict[str, Any]]:
    return [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
    ] * 5


async def _drive_unrecoverable() -> _Outcome:
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_supabase_mock(_unrecoverable_rows())
    with patch("services.analytics_runner.get_supabase", return_value=sb), patch(
        "services.analytics_runner.get_benchmark_returns",
        new=AsyncMock(return_value=(None, True)),
    ), patch(
        "services.basis_series.compute_all_metrics",
        side_effect=RuntimeError("compute_all_metrics blew up"),
    ):
        with pytest.raises(HTTPException) as exc:
            await run_csv_strategy_analytics("strat-unrecoverable")
    assert exc.value.status_code == 500
    return _Outcome(
        failed_payloads=_failed(_mock_upserts(sb)),
        logger_name=_RUNNER_LOGGER,
        strategy_id="strat-unrecoverable",
    )


async def _drive_unrecoverable_reissue() -> _Outcome:
    """The catch-all's first stamp is refused with PGRST204 (the deploy window
    in which PostgREST does not know ``computing_started_at``), so the
    re-issued payload is the one that lands."""
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_supabase_mock(_unrecoverable_rows())
    table = sb.table.return_value
    landed: list[dict[str, Any]] = []

    def _upsert(payload: dict[str, Any], **_kw: Any) -> MagicMock:
        stub = MagicMock()
        if (
            payload.get("computation_status") == "failed"
            and "computing_started_at" in payload
        ):
            stub.execute.side_effect = APIError(
                {"code": "PGRST204", "message": "schema cache", "details": None,
                 "hint": None}
            )
        else:
            if payload.get("computation_status") == "failed":
                landed.append(dict(payload))
        return stub

    table.upsert.side_effect = _upsert
    with patch("services.analytics_runner.get_supabase", return_value=sb), patch(
        "services.analytics_runner.get_benchmark_returns",
        new=AsyncMock(return_value=(None, True)),
    ), patch(
        "services.basis_series.compute_all_metrics",
        side_effect=RuntimeError("compute_all_metrics blew up"),
    ):
        with pytest.raises(HTTPException) as exc:
            await run_csv_strategy_analytics("strat-reissue")
    assert exc.value.status_code == 500
    # The re-issue is the only failed stamp that landed; it carries no marker
    # columns by design (see the key-set note in analytics_runner.py).
    assert len(landed) == 1 and "computing_started_at" not in landed[0]
    return _Outcome(
        failed_payloads=landed,
        logger_name=_RUNNER_LOGGER,
        strategy_id="strat-reissue",
    )


async def _drive_sync_trades_enqueue_failed() -> _Outcome:
    from services.job_worker import run_sync_trades_job

    ctx = MagicMock()
    ctx.exchange = AsyncMock()
    ctx.supabase = MagicMock()
    ctx.strategy_row = {"id": "strat-sync", "user_id": "user-1"}
    ctx.key_row = {
        "id": "key-1", "exchange": "okx", "last_sync_at": None, "user_id": "user-1",
    }

    def _rpc(name: str, _payload: dict[str, Any]) -> MagicMock:
        if name == "enqueue_compute_job":
            raise RuntimeError("simulated enqueue infra failure")
        stub = MagicMock()
        stub.execute.return_value = MagicMock(data=5)
        return stub

    ctx.supabase.rpc.side_effect = _rpc
    upserts: list[dict[str, Any]] = []

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()

        def _upsert(payload: dict[str, Any], **_kw: Any) -> MagicMock:
            if name == "strategy_analytics":
                upserts.append(dict(payload))
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=[])
            return stub

        tbl.upsert.side_effect = _upsert
        tbl.update.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[]
        )
        return tbl

    ctx.supabase.table.side_effect = _table
    job = {"id": "job-sync", "kind": "sync_trades", "strategy_id": "strat-sync"}
    with patch(
        "services.job_worker._exchange_preflight", new=AsyncMock(return_value=ctx)
    ), patch(
        "services.job_worker.fetch_all_trades",
        new=AsyncMock(return_value=[{"test": "trade"}]),
    ), patch(
        "services.job_worker.fetch_usdt_balance", new=AsyncMock(return_value=10000.0)
    ), patch(
        "services.job_worker.db_execute",
        new=AsyncMock(side_effect=lambda fn: fn()),
    ), patch("services.job_worker._RAW_TRADE_INGESTION_ENABLED", False):
        result = await run_sync_trades_job(job)
    assert result.outcome == DispatchOutcome.DONE
    return _Outcome(
        failed_payloads=_failed(upserts),
        logger_name=_WORKER_LOGGER,
        strategy_id="strat-sync",
    )


async def _drive_derive(variant: str) -> _Outcome:
    strategy_id = f"strat-derive-{variant}"
    ctx, capture = _build_ctx(
        key_row={"id": "key-d", "exchange": "binance", "user_id": "user-1"},
        strategy_row={"id": strategy_id, "user_id": "user-1"},
    )
    job = {"id": f"j-{variant}", "kind": "derive_broker_dailies", "strategy_id": strategy_id}
    if variant == "one_day":
        one_day = pd.Series(
            [0.01], index=pd.DatetimeIndex(["2024-05-01"]), dtype="float64"
        )
        patches = _patches(ctx, key_mode=False, returns=one_day)
    else:
        combine = MagicMock(
            side_effect=NavReconstructionError("nav_twr non-finite pnl=42.0")
        )
        patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await run_derive_broker_dailies_job(job)
    assert result.outcome == DispatchOutcome.FAILED
    return _Outcome(
        failed_payloads=_failed(
            [p for (t, p, _oc) in capture["upserts"] if t == "strategy_analytics"]
        ),
        logger_name=_WORKER_LOGGER,
        strategy_id=strategy_id,
        min_level=logging.WARNING,
        record_carries_stored_error=True,
    )


async def _drive_composite(variant: str) -> _Outcome:
    if variant == "zero_members":
        fake = _FakeSupabase(members=[])
    else:
        fake = _FakeSupabase(members=[
            _member(1, "2024-01-01", "2024-02-15"),
            _member(2, "2024-02-01", None),  # declared windows overlap
        ])
    with _apply(_deribit_patches(fake, combine_returns=[], has_option_activity=False)):
        result = await run_stitch_composite_job({"strategy_id": _COMPOSITE_STRATEGY_ID})
    assert result.outcome == DispatchOutcome.FAILED
    return _Outcome(
        failed_payloads=_failed([p for (t, p, _oc) in fake.upserts if t == "strategy_analytics"]),
        logger_name=_WORKER_LOGGER,
        strategy_id=_COMPOSITE_STRATEGY_ID,
        min_level=logging.WARNING,
        record_carries_stored_error=True,
    )


# census row -> the drivers that reach it (a choke point lists several callers)
_DRIVERS: dict[str, list[Callable[[], Awaitable[_Outcome]]]] = {
    "runner.insufficient_history": [_drive_insufficient_history],
    "runner.pagination_truncated": [_drive_pagination_truncated],
    "runner.malformed_denominator_config": [_drive_malformed_config],
    "runner.unrecoverable": [_drive_unrecoverable],
    "runner.unrecoverable_schema_cache_reissue": [_drive_unrecoverable_reissue],
    "worker.sync_trades_enqueue_failed": [_drive_sync_trades_enqueue_failed],
    "worker.derive_terminal_stamp": [
        lambda: _drive_derive("one_day"),
        lambda: _drive_derive("nav_error"),
    ],
    "worker.composite_terminal_stamp": [
        lambda: _drive_composite("zero_members"),
        lambda: _drive_composite("window_overlap"),
    ],
}


def _cases() -> list[Any]:
    out: list[Any] = []
    for row, drivers in _DRIVERS.items():
        for i, driver in enumerate(drivers):
            out.append(pytest.param(driver, id=f"{row}[{i}]"))
    return out


@pytest.mark.asyncio
@pytest.mark.parametrize("driver", _cases())
async def test_every_failed_stamp_stores_the_error_and_logs_it(
    driver: Callable[[], Awaitable[_Outcome]], caplog: pytest.LogCaptureFixture
) -> None:
    """The owner line promises a logged error. Each failure path must leave
    (a) a non-empty ``computation_error`` on its failed row and (b) a record
    from its module's logger that names the strategy, at the module's level."""
    caplog.set_level(logging.DEBUG)
    outcome = await driver()

    assert outcome.failed_payloads, "the path never stored computation_status='failed'"
    for payload in outcome.failed_payloads:
        error = payload.get("computation_error")
        assert isinstance(error, str) and error.strip(), (
            f"failed row carries no computation_error: {payload!r}"
        )

    records = [
        r for r in caplog.records
        if r.name == outcome.logger_name
        and r.levelno >= outcome.min_level
        and outcome.strategy_id in r.getMessage()
    ]
    if outcome.record_carries_stored_error:
        stored = {p["computation_error"] for p in outcome.failed_payloads}
        records = [
            r for r in records if any(text in r.getMessage() for text in stored)
        ]
    assert records, (
        f"no {logging.getLevelName(outcome.min_level)}+ record from "
        f"{outcome.logger_name} names {outcome.strategy_id}"
        f"{' and carries the stored computation_error' if outcome.record_carries_stored_error else ''}; "
        f"records: {[(r.name, r.levelname, r.getMessage()) for r in caplog.records]}"
    )


def test_census_matches_source() -> None:
    """The census cannot go stale: its row count is the source's match count
    (what the plan's census grep prints), and every row has a driver."""
    literal = re.compile(r'"computation_status":\s*"failed"')
    sites = sum(
        len(literal.findall(path.read_text(encoding="utf-8")))
        for path in (_SERVICES / "analytics_runner.py", _SERVICES / "job_worker.py")
    )
    assert sites == len(_CENSUS), (
        f"services/ carries {sites} failed-status writes but the census lists "
        f"{len(_CENSUS)}; a new site needs a row and a driver here"
    )
    assert set(_CENSUS) == set(_DRIVERS)
