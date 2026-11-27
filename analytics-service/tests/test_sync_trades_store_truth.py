"""Phase 251 SYNCSTORE plan 01: `run_sync_trades_job` stores every run's daily
P&L before the fills walk, refuses to store a degraded read, and records its
refusal flags truthfully. Every arm drives the REAL `run_sync_trades_job` with a
mocked Supabase, plants flags through the real `services.exchange._record_dq_flag`
buffer (the drain is never patched), and reads what the fakes recorded.

WHY THIS MATTERS (items 1 and 2).
  * Item 1: the Phase-1 daily store (`sync_trades`) used to run AFTER the
    exchange `finally`, behind the balance read and the whole Phase-2 fills walk.
    A run that timed out in that walk (`asyncio.wait_for` cancel) or raised in it
    lost the daily P&L it had already read. The store now runs right after the
    read, the drain and the refusal check, so a cancelled walk keeps the rows.
  * Item 2: `sync_trades` deletes the payload's own [min, max] span before it
    inserts. Storing a degraded read (the Binance income fallback's BTC spot fills,
    a fetch error, OKX non-USD bills, a page-capped or deadline-hit walk) overwrote
    real daily rows with partial or foreign data and advanced `last_sync_at` over
    a span nothing had read. `daily_pnl_read_verdict` is the one shared reader of
    that buffer; a refusal now stores nothing, holds both cursors and reports 0.

Flags are planted through `_record_dq_flag`, so the handler's own
`get_and_clear_last_dq_flags()` drain sees exactly what production's buffer holds.

NEUTER (each recorded in the 251-01 SUMMARY, restored from a byte backup):
  N1  move the store back after the exchange `finally`:
      test_cancelled_fills_walk_keeps_the_daily_store goes RED (no `sync_trades`
      call has happened when the walk is cancelled).
  N2  delete the refusal (reasons) branch so a refused read falls through to the
      store: test_refused_read_stores_nothing[binance_income_fallback] goes RED.
  N8  delete the rate-limit raise:
      test_rate_limited_read_reaches_the_429_arm[RateLimitExceeded] goes RED.
  N13 drop `and not phase1_read_refused` from `advance_fetched_cursor`:
      test_refused_read_holds_the_fills_cursor_with_ingestion_on goes RED.
  N14 drop the refusal from `trade_count`:
      test_refused_read_stores_nothing[non_usd_okx] goes RED on `trade_count`.

WHY THIS MATTERS (items 3 and 4, the write side).
  With `USE_RAW_TRADE_INGESTION` off the handler never read or wrote
  `strategy_analytics.data_quality_flags`, so a refused read's reason flags never
  reached the row. They now land at the handler's one existing upsert. The flag
  block's `write_needed` also only accumulates (a later `else` used to reset it,
  which erased a Phase-1 persist failure's own stamp), and a failed flag read on a
  run where Phase 2 did not run writes nothing: an upsert would replace the whole
  column with a guessed payload.

NEUTER, Task 2:
  N4  drop `phase1_read_ran` from `needs_flag_write`:
      test_refused_non_usd_okx_flag_lands_with_flag_off goes RED.
  N6  restore the trailing `else: write_needed = False` after the Phase-2 arm:
      test_persist_failure_stamps_persist_failed_flag[ingestion_on] goes RED.
  N11 delete the failed-read skip so the upsert runs:
      test_flag_load_failed_with_flag_off_writes_nothing[refused] goes RED.
  N15 set `phase1_read_ran = True` in the MT5 arm:
      test_mt5_run_makes_no_daily_flag_read goes RED.
  N16 change `elif phase2_success:` back to `else:`:
      test_clean_read_flag_off_leaves_stale_phase2_keys goes RED (the recovery arm
      clears stored `phase2_*` keys although Phase 2 never ran).

WHY THIS MATTERS (items 3 and 4, the clear side).
  The handler owns the refusal keys: the verdict's reason keys plus
  `daily_pnl_fetch_error_class` and `daily_pnl_unsupported_venue`. On every run
  where the ccxt read ran, the stored owned keys are REPLACED by this run's drained
  set, so a clean read clears what an earlier refusal wrote and the row cannot say
  "refused" forever. `daily_pnl_malformed_*` is the derive's (D-12) and is merged as
  drained, never popped. The stored class is the sanitized `verdict.error_class`,
  never the raw drained string. A refusal is not a successful Phase 1, so it keeps
  a stale `phase1_daily_pnl_persist_failed`. An AST pin over services/exchange.py
  keeps a NEW `daily_pnl_*` flag from silently escaping the owned set.

NEUTER, Task 3:
  N3  delete the pop loop: test_clean_read_pops_every_owned_key[flag_off] goes RED.
  N9  delete the class sanitize step:
      test_owned_error_class_is_the_sanitized_verdict_class[not_identifier] goes RED.
  N10 drop `and not phase1_read_refused` from the stale persist-failed clear arm:
      test_refused_read_keeps_a_stale_persist_failed_flag goes RED.
  N12 make `_is_sync_owned_daily_pnl_key` return True for any `daily_pnl_` key:
      test_owned_predicate_reuses_the_verdict goes RED, and the pop arm shows
      `daily_pnl_malformed_okx` popped.
  N17 set `write_needed = True` whenever `phase1_read_ran`:
      test_clean_read_with_nothing_owned_stored_writes_nothing goes RED.
  N18 delete the stale persist-failed clear arm:
      test_clean_read_clears_a_stale_persist_failed_flag goes RED.
  N19 (on services/exchange.py) record a new flag `daily_pnl_p251_planted`:
      test_every_daily_pnl_flag_exchange_records_is_owned_or_malformed goes RED.

WHY THIS MATTERS (SC-5, plan 02: the enqueue-failure tail).
  When the follow-on enqueue fails and the publish read says nothing is published,
  the tail makes a conditional failed-row write, and on zero rows it re-reads the
  publish state. The write and the re-read used to share one `try`, so a re-read
  that raised was swallowed and the handler returned FAILED. On the last attempt
  that becomes `failed_final`, and status-bridge branch (b) writes `failed` over a
  row a concurrent job may have published. They now have separate scopes: a re-read
  that raises returns DONE and writes nothing (an unreadable state is not "nothing
  published", T-222-13), a write that raises keeps FAILED, and each log line names
  the call that failed. The publish read is patched BY FUNCTION NAME (see
  `_run_job`), never through a `select` side-effect list.

NEUTER, SC-5 (plan 02):
  N5  in the re-read's `except` arm, delete `_nothing_published = False`:
      test_reread_raising_after_zero_row_write_returns_done goes RED (FAILED).
  N7  in the write's `except` arm, add `_nothing_published = False`:
      test_write_raising_before_reread_stays_failed goes RED (DONE, not FAILED).
  N20 in the re-read's truthy branch, delete `_nothing_published = False`:
      test_reread_finding_a_published_row_returns_done goes RED (FAILED).
"""

from __future__ import annotations

import ast
import asyncio
import copy
import logging
from pathlib import Path
from typing import Any, NamedTuple
from unittest.mock import AsyncMock, MagicMock, patch

import ccxt
import pytest

import services.exchange as exchange_mod
from services.exchange import get_and_clear_last_dq_flags
from services.job_worker import (
    DispatchOutcome,
    Mt5Session,
    _is_sync_owned_daily_pnl_key,
    run_sync_trades_job,
)

STRATEGY_ID = "strat-251-store"
BALANCE = 10000.0
LOGGER_NAME = "quantalyze.analytics.job_worker"

DAILY_ROW_1: dict[str, Any] = {
    "exchange": "okx",
    "symbol": "PORTFOLIO",
    "side": "buy",
    "price": 0,
    "quantity": 0,
    "is_fill": False,
    "daily_pnl": 12.5,
    "timestamp": "2026-11-20T00:00:00+00:00",
}
DAILY_ROW_2: dict[str, Any] = {
    **DAILY_ROW_1,
    "daily_pnl": -3.25,
    "timestamp": "2026-11-21T00:00:00+00:00",
}
# The Binance income fallback's BTC spot fill (tests/test_cron_router.py
# TestADegradedFetchIsNeverOk._SPOT_FILL): a foreign row the store must refuse.
SPOT_FILL: dict[str, Any] = {
    "exchange": "binance",
    "symbol": "BTC/USDT",
    "side": "buy",
    "price": 64000.0,
    "quantity": 0.01,
    "order_type": "limit",
    "timestamp": "2026-10-10T12:00:00+00:00",
}

STORED_UNSET: Any = object()


class _UnscriptedPublishRead(BaseException):
    """Raised by the scripted publish read when the handler reads more often than
    the arm scripted. A BaseException so the handler's `except Exception` arms
    cannot turn the surprise into a quiet FAILED or DONE."""


def _fill(fill_id: str, timestamp: str) -> dict[str, Any]:
    """A raw fill shaped like `_make_fill_dict` output."""
    return {
        "exchange": "okx",
        "symbol": "BTC-USDT-SWAP",
        "side": "buy",
        "price": "50000",
        "quantity": "0.1",
        "fee": "0.5",
        "exchange_fill_id": fill_id,
        "is_fill": True,
        "timestamp": timestamp,
    }


class _Recorder:
    """What the fakes saw, in order."""

    def __init__(self) -> None:
        self.events: list[tuple[str, ...]] = []
        self.sync_trades_payloads: list[list[dict[str, Any]]] = []
        self.advance_params: list[dict[str, Any]] = []
        self.analytics_upserts: list[dict[str, Any]] = []
        self.tables_touched: list[str] = []
        self.flag_reads = 0
        self.update_payloads: list[dict[str, Any]] = []
        self.publish_reads = 0
        self.stamp_429: AsyncMock = AsyncMock()

    def rpc_names(self) -> list[str]:
        return [e[1] for e in self.events if e[0] == "rpc"]

    def index(self, event: tuple[str, ...]) -> int:
        return self.events.index(event)


def _make_supabase(
    *,
    stored_flags: Any = STORED_UNSET,
    flag_read_error: Exception | None = None,
    sync_trades_error: Exception | None = None,
    enqueue_error: Exception | None = None,
    update_result: list[dict[str, Any]] | Exception | None = None,
) -> tuple[MagicMock, _Recorder]:
    """`stored_flags` is the strategy's `data_quality_flags`; `None` means the
    strategy has NO `strategy_analytics` row yet (`maybe_single` yields data None).
    The fake REPLACES the stored dict from an upserted payload, as the real
    PostgREST upsert replaces the whole jsonb column. `flag_read_error` makes the
    flag read raise.

    SC-5 (plan 02): `enqueue_error` makes the `enqueue_compute_job` RPC raise.
    `update_result` scripts the tail's conditional failed-row UPDATE: a list is the
    rows the update matched (`[]` is zero rows), an Exception is raised by the
    update's `execute`. The update payload is recorded on `rec.update_payloads`."""
    rec = _Recorder()
    stored: dict[str, Any] = (
        {} if stored_flags is STORED_UNSET or stored_flags is None else stored_flags
    )
    no_row = stored_flags is None

    class _FakeTrades:
        def select(self, *_a: Any, **_k: Any) -> "_FakeTrades":
            return self

        def eq(self, *_a: Any, **_k: Any) -> "_FakeTrades":
            return self

        def in_(self, *_a: Any, **_k: Any) -> "_FakeTrades":
            return self

        def execute(self) -> Any:
            return MagicMock(data=[])

        def upsert(self, payload: list[dict[str, Any]], **_k: Any) -> Any:
            return MagicMock(execute=lambda: MagicMock(data=None))

    class _FakeUpdateChain:
        """The conditional failed-row UPDATE's filter chain; every filter returns
        itself (`not_` is an attribute, as in postgrest-py) and `execute` is scripted."""

        @property
        def not_(self) -> "_FakeUpdateChain":
            return self

        def eq(self, *_a: Any, **_k: Any) -> "_FakeUpdateChain":
            return self

        def in_(self, *_a: Any, **_k: Any) -> "_FakeUpdateChain":
            return self

        def or_(self, *_a: Any, **_k: Any) -> "_FakeUpdateChain":
            return self

        def execute(self) -> Any:
            if isinstance(update_result, Exception):
                raise update_result
            return MagicMock(data=list(update_result or []))

    class _FakeAnalytics:
        def update(self, payload: dict[str, Any], **_k: Any) -> _FakeUpdateChain:
            rec.update_payloads.append(copy.deepcopy(payload))
            return _FakeUpdateChain()

        def select(self, *_a: Any, **_k: Any) -> "_FakeAnalytics":
            return self

        def eq(self, *_a: Any, **_k: Any) -> "_FakeAnalytics":
            return self

        def maybe_single(self) -> "_FakeAnalytics":
            return self

        def execute(self) -> Any:
            rec.flag_reads += 1
            if flag_read_error is not None:
                raise flag_read_error
            if no_row:
                return MagicMock(data=None)
            return MagicMock(data={"data_quality_flags": copy.deepcopy(stored)})

        def upsert(self, payload: dict[str, Any], **_k: Any) -> Any:
            def _execute() -> Any:
                rec.analytics_upserts.append(copy.deepcopy(payload))
                stored.clear()
                stored.update(copy.deepcopy(payload["data_quality_flags"]))
                return MagicMock(data=None)

            return MagicMock(execute=_execute)

    supabase = MagicMock()

    def _rpc(name: str, payload: dict[str, Any]) -> MagicMock:
        rec.events.append(("rpc", name))
        if name == "advance_sync_cursor":
            rec.advance_params.append(dict(payload))
        if name == "sync_trades":
            rec.sync_trades_payloads.append(list(payload["p_trades"]))
        stub = MagicMock()
        if name == "sync_trades" and sync_trades_error is not None:
            stub.execute.side_effect = sync_trades_error
        elif name == "enqueue_compute_job" and enqueue_error is not None:
            stub.execute.side_effect = enqueue_error
        else:
            # Phase 255: the bound RPC now runs on OKX, Bybit and Deribit, and a falsy answer reads as an
            # orphan claim token and skips the read.
            stub.execute.return_value = MagicMock(
                data=True if name in ("advance_sync_cursor", "set_strategy_fills_reread_bound") else 0
            )
        return stub

    supabase.rpc.side_effect = _rpc

    def _table(name: str) -> Any:
        rec.tables_touched.append(name)
        if name == "trades":
            return _FakeTrades()
        if name == "strategy_analytics":
            return _FakeAnalytics()
        return MagicMock()

    supabase.table.side_effect = _table
    return supabase, rec


async def _run_job(
    *,
    supabase: MagicMock,
    rec: _Recorder,
    daily_rows: list[dict[str, Any]] | None = None,
    daily_flags: dict[str, Any] | None = None,
    ingestion: bool = False,
    raw_fills: list[dict[str, Any]] | None = None,
    raw_mode: str = "return",
    timeout_s: float | None = None,
    exchange: Any = None,
    publish_script: list[Any] | None = None,
) -> Any:
    """Drive the REAL `run_sync_trades_job`. The daily read plants `daily_flags`
    through the real `_record_dq_flag` and returns `daily_rows`; the drain is
    never patched. `raw_mode` is `return` (the fills), `raise` or `hang`.
    Returns the DispatchResult, or lets the exception propagate.

    `publish_script` (SC-5) patches `services.job_worker.db_read_with_retry` BY
    FUNCTION NAME: a call whose `fn.__name__` is `_strategy_has_published_numbers`
    is served the next scripted value (a bool, or an Exception to raise) and counted
    on `rec.publish_reads`; any other read just calls `fn()`. It is keyed on the name
    and never on a `select` side-effect list, because the flag read is also a
    `select` on `strategy_analytics` and would consume such a list out of order."""
    get_and_clear_last_dq_flags()  # residue from a previous test on this task

    async def _fake_fetch_all_trades(_exchange: Any, since_ms: Any = None) -> Any:
        for key, value in (daily_flags or {}).items():
            exchange_mod._record_dq_flag(key, value)
        return list(daily_rows if daily_rows is not None else [])

    async def _fake_balance(_exchange: Any) -> float:
        rec.events.append(("balance",))
        return BALANCE

    async def _fake_fetch_raw(*_a: Any, **_k: Any) -> Any:
        rec.events.append(("fetch_raw",))
        if raw_mode == "raise":
            raise RuntimeError("simulated fills walk failure")
        if raw_mode == "hang":
            await asyncio.sleep(3600)
        return list(raw_fills or [])

    mock_exchange = AsyncMock() if exchange is None else exchange
    mock_ctx = MagicMock()
    mock_ctx.exchange = mock_exchange
    mock_ctx.supabase = supabase
    mock_ctx.strategy_row = {"id": STRATEGY_ID, "user_id": "user-1"}
    mock_ctx.key_row = {
        "id": "key-1",
        "exchange": "okx",
        "user_id": "user-1",
        "last_sync_at": "2026-11-13T06:00:00+00:00",
        "last_fetched_trade_timestamp": None,
    }
    job = {"id": "job-251", "kind": "sync_trades", "strategy_id": STRATEGY_ID}

    patches = [
        patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ),
        patch("services.job_worker.fetch_all_trades", new=_fake_fetch_all_trades),
        patch("services.job_worker.fetch_usdt_balance", new=_fake_balance),
        patch("services.job_worker.fetch_raw_trades", new=_fake_fetch_raw),
        patch(
            "services.job_worker.load_strategy_high_waters",
            new=MagicMock(return_value=({}, None)),
        ),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
        patch("services.job_worker._stamp_429", new=rec.stamp_429),
        patch("services.job_worker._RAW_TRADE_INGESTION_ENABLED", ingestion),
    ]
    if publish_script is not None:
        script = list(publish_script)

        async def _scripted_read(fn: Any, **_k: Any) -> Any:
            if getattr(fn, "__name__", "") != "_strategy_has_published_numbers":
                return fn()
            rec.publish_reads += 1
            if rec.publish_reads > len(script):
                # An unscripted extra read must be loud, but the handler's own
                # `except Exception` would swallow an AssertionError, so raise a
                # BaseException-derived one the handler cannot absorb.
                raise _UnscriptedPublishRead(
                    f"publish read #{rec.publish_reads} is beyond the script {script}"
                )
            item = script[rec.publish_reads - 1]
            if isinstance(item, Exception):
                raise item
            return item

        patches.append(
            patch("services.job_worker.db_read_with_retry", new=_scripted_read)
        )
    for p in patches:
        p.start()
    try:
        if timeout_s is not None:
            return await asyncio.wait_for(run_sync_trades_job(job), timeout=timeout_s)
        return await run_sync_trades_job(job)
    finally:
        for p in reversed(patches):
            p.stop()


def _the_advance(rec: _Recorder) -> dict[str, Any]:
    assert len(rec.advance_params) == 1, (
        f"expected exactly one advance_sync_cursor call, got {rec.advance_params}"
    )
    return rec.advance_params[0]


# ---------------------------------------------------------------------------
# Item 1: the store runs before the balance read and the fills walk
# ---------------------------------------------------------------------------


class TestStoreOrder:
    @pytest.mark.asyncio
    async def test_store_before_balance_and_fills_walk(self) -> None:
        supabase, rec = _make_supabase()
        result = await _run_job(
            supabase=supabase,
            rec=rec,
            daily_rows=[DAILY_ROW_1, DAILY_ROW_2],
            ingestion=True,
        )
        assert result.outcome == DispatchOutcome.DONE
        store = rec.index(("rpc", "sync_trades"))
        balance = rec.index(("balance",))
        fills = rec.index(("fetch_raw",))
        assert store < balance < fills, (
            f"the daily store must precede the balance read and the fills walk: {rec.events}"
        )

    @pytest.mark.asyncio
    async def test_cancelled_fills_walk_keeps_the_daily_store(self) -> None:
        """A run whose fills walk is cancelled by `asyncio.wait_for` has already
        stored its daily rows. The 2.0s budget is generous so a loaded machine
        cannot cancel before the store."""
        supabase, rec = _make_supabase()
        with pytest.raises(asyncio.TimeoutError):
            await _run_job(
                supabase=supabase,
                rec=rec,
                daily_rows=[DAILY_ROW_1, DAILY_ROW_2],
                ingestion=True,
                raw_mode="hang",
                timeout_s=2.0,
            )
        assert rec.sync_trades_payloads == [[DAILY_ROW_1, DAILY_ROW_2]], (
            "the cancelled run must have stored its daily rows"
        )
        assert rec.index(("rpc", "sync_trades")) < rec.index(("balance",))

    @pytest.mark.asyncio
    async def test_cancelled_fills_walk_raising_keeps_the_daily_store(self) -> None:
        supabase, rec = _make_supabase()
        result = await _run_job(
            supabase=supabase,
            rec=rec,
            daily_rows=[DAILY_ROW_1],
            ingestion=True,
            raw_mode="raise",
        )
        assert result.outcome == DispatchOutcome.DONE
        assert rec.sync_trades_payloads == [[DAILY_ROW_1]]
        assert rec.index(("rpc", "sync_trades")) < rec.index(("fetch_raw",))


# ---------------------------------------------------------------------------
# Item 2: a refused read stores nothing
# ---------------------------------------------------------------------------

REFUSED_CASES = [
    pytest.param(
        {"daily_pnl_binance_income_fallback": True},
        [SPOT_FILL],
        id="binance_income_fallback",
    ),
    pytest.param(
        {"daily_pnl_fetch_error": True, "daily_pnl_fetch_error_class": "NetworkError"},
        [DAILY_ROW_1],
        id="fetch_error",
    ),
    pytest.param({"daily_pnl_non_usd_okx": True}, [DAILY_ROW_1], id="non_usd_okx"),
    pytest.param({"daily_pnl_truncated_okx": True}, [DAILY_ROW_1], id="truncated_okx"),
    pytest.param({"daily_pnl_deadline_okx": True}, [DAILY_ROW_1], id="deadline_okx"),
    pytest.param(
        {"daily_pnl_fetch_error": True, "daily_pnl_unsupported_venue": True},
        [DAILY_ROW_1],
        id="deribit_unsupported_venue",
    ),
]


class TestRefusal:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("daily_flags,daily_rows", REFUSED_CASES)
    async def test_refused_read_stores_nothing(
        self, daily_flags: dict[str, Any], daily_rows: list[dict[str, Any]]
    ) -> None:
        supabase, rec = _make_supabase()
        result = await _run_job(
            supabase=supabase,
            rec=rec,
            daily_rows=daily_rows,
            daily_flags=daily_flags,
            ingestion=False,
        )
        assert "sync_trades" not in rec.rpc_names(), (
            "a refused read must never reach the sync_trades RPC"
        )
        assert result.outcome == DispatchOutcome.DONE
        assert result.trade_count == 0
        advance = _the_advance(rec)
        assert advance["p_last_sync_at"] is None
        assert advance["p_last_fetched_ts"] is None
        assert advance["p_account_balance"] == BALANCE
        assert "enqueue_compute_job" in rec.rpc_names()
        assert not any(
            "phase1_daily_pnl_persist_failed" in (u.get("data_quality_flags") or {})
            for u in rec.analytics_upserts
        )

    @pytest.mark.asyncio
    async def test_refused_read_holds_the_fills_cursor_with_ingestion_on(self) -> None:
        """Only the refusal can hold the cursor here: two parsable fills are
        persisted by Phase 2 and no other gate input is set."""
        supabase, rec = _make_supabase()
        result = await _run_job(
            supabase=supabase,
            rec=rec,
            daily_rows=[DAILY_ROW_1],
            daily_flags={"daily_pnl_truncated_okx": True},
            ingestion=True,
            raw_fills=[
                _fill("f1", "2026-11-20T10:00:00+00:00"),
                _fill("f2", "2026-11-21T10:00:00+00:00"),
            ],
        )
        assert result.outcome == DispatchOutcome.DONE
        advance = _the_advance(rec)
        assert advance["p_last_fetched_ts"] is None
        assert advance["p_last_sync_at"] is None

    @pytest.mark.asyncio
    async def test_malformed_alone_is_not_a_refusal(self) -> None:
        """Control (founder decision D-12): a malformed row is flagged, never a
        reason, so the read is stored and `last_sync_at` advances."""
        supabase, rec = _make_supabase()
        result = await _run_job(
            supabase=supabase,
            rec=rec,
            daily_rows=[DAILY_ROW_1, DAILY_ROW_2],
            daily_flags={"daily_pnl_malformed_okx": True},
            ingestion=False,
        )
        assert result.outcome == DispatchOutcome.DONE
        assert "sync_trades" in rec.rpc_names()
        assert _the_advance(rec)["p_last_sync_at"] is not None
        assert result.trade_count == 2

    @pytest.mark.asyncio
    @pytest.mark.parametrize("error_class", ["RateLimitExceeded", "DDoSProtection"])
    async def test_rate_limited_read_reaches_the_429_arm(self, error_class: str) -> None:
        supabase, rec = _make_supabase()
        with pytest.raises(ccxt.RateLimitExceeded):
            await _run_job(
                supabase=supabase,
                rec=rec,
                daily_rows=[],
                daily_flags={
                    "daily_pnl_fetch_error": True,
                    "daily_pnl_fetch_error_class": error_class,
                },
                ingestion=False,
            )
        rec.stamp_429.assert_awaited_once()
        assert "sync_trades" not in rec.rpc_names()
        assert "advance_sync_cursor" not in rec.rpc_names()
        assert get_and_clear_last_dq_flags() == {}


# ---------------------------------------------------------------------------
# Items 3 and 4, write side: the flag block
# ---------------------------------------------------------------------------

STALE_PHASE2_FLAGS: dict[str, Any] = {
    "phase2_fill_ingestion_failed": True,
    "phase2_error": "simulated earlier failure",
    "phase2_failed_at": "2026-11-20T00:00:00+00:00",
}


class TestFlagWrite:
    @pytest.mark.asyncio
    async def test_refused_non_usd_okx_flag_lands_with_flag_off(self) -> None:
        supabase, rec = _make_supabase(stored_flags={"last_success_snapshot": {"k": 1}})
        result = await _run_job(
            supabase=supabase,
            rec=rec,
            daily_rows=[DAILY_ROW_1],
            daily_flags={"daily_pnl_non_usd_okx": True},
            ingestion=False,
        )
        assert result.outcome == DispatchOutcome.DONE
        assert len(rec.analytics_upserts) == 1, rec.analytics_upserts
        payload = rec.analytics_upserts[0]
        assert set(payload) == {"strategy_id", "data_quality_flags"}
        assert payload["data_quality_flags"] == {
            "last_success_snapshot": {"k": 1},
            "daily_pnl_non_usd_okx": True,
        }
        assert _the_advance(rec)["p_last_sync_at"] is None

    @pytest.mark.asyncio
    async def test_first_sync_refusal_no_row_writes_only_owned_keys(self) -> None:
        supabase, rec = _make_supabase(stored_flags=None)
        result = await _run_job(
            supabase=supabase,
            rec=rec,
            daily_rows=[DAILY_ROW_1],
            daily_flags={"daily_pnl_non_usd_okx": True},
            ingestion=False,
        )
        assert result.outcome == DispatchOutcome.DONE
        assert len(rec.analytics_upserts) == 1, rec.analytics_upserts
        assert rec.analytics_upserts[0]["data_quality_flags"] == {
            "daily_pnl_non_usd_okx": True
        }

    @pytest.mark.asyncio
    @pytest.mark.parametrize("scenario", ["refused", "persist_failed"])
    async def test_flag_load_failed_with_flag_off_writes_nothing(
        self, scenario: str, caplog: pytest.LogCaptureFixture
    ) -> None:
        """A failed flag read on a run where Phase 2 did not run must not upsert:
        the upsert replaces the whole column with a payload guessed from `{}`."""
        supabase, rec = _make_supabase(
            flag_read_error=RuntimeError("read boom"),
            sync_trades_error=(
                RuntimeError("persist boom") if scenario == "persist_failed" else None
            ),
        )
        kwargs: dict[str, Any] = (
            {"daily_flags": {"daily_pnl_non_usd_okx": True}}
            if scenario == "refused"
            else {}
        )
        with caplog.at_level(logging.WARNING, logger=LOGGER_NAME):
            result = await _run_job(
                supabase=supabase,
                rec=rec,
                daily_rows=[DAILY_ROW_1],
                ingestion=False,
                **kwargs,
            )
        assert result.outcome == DispatchOutcome.DONE
        assert rec.analytics_upserts == []
        skip_records = [
            r
            for r in caplog.records
            if r.levelno == logging.WARNING
            and "skipping the flag write" in r.getMessage()
            and STRATEGY_ID in r.getMessage()
        ]
        assert skip_records, [r.getMessage() for r in caplog.records]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("ingestion", [True, False], ids=["ingestion_on", "flag_off"])
    async def test_persist_failure_stamps_persist_failed_flag(
        self, ingestion: bool
    ) -> None:
        supabase, rec = _make_supabase(
            stored_flags={}, sync_trades_error=RuntimeError("persist boom")
        )
        result = await _run_job(
            supabase=supabase,
            rec=rec,
            daily_rows=[DAILY_ROW_1],
            ingestion=ingestion,
        )
        assert result.outcome == DispatchOutcome.DONE
        assert len(rec.analytics_upserts) == 1, rec.analytics_upserts
        flags = rec.analytics_upserts[0]["data_quality_flags"]
        assert flags["phase1_daily_pnl_persist_failed"] is True
        assert isinstance(flags["phase1_failed_at"], str)

    @pytest.mark.asyncio
    async def test_clean_read_flag_off_leaves_stale_phase2_keys(self) -> None:
        """With ingestion off Phase 2 never ran, so it says nothing about its own
        stored failure keys: a clean daily read must not clear them."""
        supabase, rec = _make_supabase(stored_flags=dict(STALE_PHASE2_FLAGS))
        result = await _run_job(
            supabase=supabase, rec=rec, daily_rows=[DAILY_ROW_1], ingestion=False
        )
        assert result.outcome == DispatchOutcome.DONE
        assert rec.analytics_upserts == []

    @pytest.mark.asyncio
    async def test_clean_read_flag_off_malformed_only_writes_nothing(self) -> None:
        """Today's off-path behaviour kept (CONTEXT): a malformed-only drain with
        nothing owned stored changes no owned key, so there is no upsert."""
        supabase, rec = _make_supabase(stored_flags={})
        result = await _run_job(
            supabase=supabase,
            rec=rec,
            daily_rows=[DAILY_ROW_1],
            daily_flags={"daily_pnl_malformed_okx": True},
            ingestion=False,
        )
        assert result.outcome == DispatchOutcome.DONE
        assert rec.analytics_upserts == []

    @pytest.mark.asyncio
    async def test_mt5_run_makes_no_daily_flag_read(self) -> None:
        """MT5 fetches no ccxt daily P&L, so it has no daily flags to record or
        clear: with ingestion off it never touches strategy_analytics."""
        supabase, rec = _make_supabase(stored_flags={})
        with patch(
            "services.job_worker._fetch_mt5_account_balance",
            new=AsyncMock(return_value=BALANCE),
        ):
            result = await _run_job(
                supabase=supabase,
                rec=rec,
                ingestion=False,
                exchange=object.__new__(Mt5Session),
            )
        assert result.outcome == DispatchOutcome.DONE
        assert "strategy_analytics" not in rec.tables_touched


# ---------------------------------------------------------------------------
# Items 3 and 4, clear side: owned keys are replaced by this run's drained set
# ---------------------------------------------------------------------------

STALE_OWNED_FLAGS: dict[str, Any] = {
    "daily_pnl_fetch_error": True,
    "daily_pnl_fetch_error_class": "NetworkError",
    "daily_pnl_unsupported_venue": True,
    "daily_pnl_binance_income_fallback": True,
    "daily_pnl_non_usd_okx": True,
    "daily_pnl_truncated_okx": True,
    "daily_pnl_deadline_bybit": True,
}
STALE_PERSIST_FAILED: dict[str, Any] = {
    "phase1_daily_pnl_persist_failed": True,
    "phase1_failed_at": "2026-11-20T00:00:00+00:00",
}


class TestOwnedKeyReplacement:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("ingestion", [False, True], ids=["flag_off", "ingestion_on"])
    async def test_clean_read_pops_every_owned_key(self, ingestion: bool) -> None:
        stored = {
            **STALE_OWNED_FLAGS,
            "daily_pnl_malformed_okx": True,
            "last_success_snapshot": {"k": 1},
        }
        supabase, rec = _make_supabase(stored_flags=stored)
        result = await _run_job(
            supabase=supabase, rec=rec, daily_rows=[DAILY_ROW_1], ingestion=ingestion
        )
        assert result.outcome == DispatchOutcome.DONE
        assert len(rec.analytics_upserts) == 1, rec.analytics_upserts
        assert rec.analytics_upserts[0]["data_quality_flags"] == {
            "daily_pnl_malformed_okx": True,
            "last_success_snapshot": {"k": 1},
        }

    @pytest.mark.asyncio
    async def test_refused_read_replaces_stored_owned_keys(self) -> None:
        supabase, rec = _make_supabase(stored_flags={"daily_pnl_truncated_okx": True})
        result = await _run_job(
            supabase=supabase,
            rec=rec,
            daily_rows=[DAILY_ROW_1],
            daily_flags={
                "daily_pnl_fetch_error": True,
                "daily_pnl_fetch_error_class": "NetworkError",
            },
            ingestion=False,
        )
        assert result.outcome == DispatchOutcome.DONE
        assert len(rec.analytics_upserts) == 1, rec.analytics_upserts
        assert rec.analytics_upserts[0]["data_quality_flags"] == {
            "daily_pnl_fetch_error": True,
            "daily_pnl_fetch_error_class": "NetworkError",
        }

    @pytest.mark.asyncio
    async def test_clean_read_with_nothing_owned_stored_writes_nothing(self) -> None:
        supabase, rec = _make_supabase(stored_flags={"last_success_snapshot": {"k": 1}})
        result = await _run_job(
            supabase=supabase, rec=rec, daily_rows=[DAILY_ROW_1], ingestion=False
        )
        assert result.outcome == DispatchOutcome.DONE
        assert rec.analytics_upserts == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "error_class,expect_class",
        [
            pytest.param("NetworkError", "NetworkError", id="identifier"),
            pytest.param("Bad Class!", None, id="not_identifier"),
        ],
    )
    async def test_owned_error_class_is_the_sanitized_verdict_class(
        self, error_class: str, expect_class: str | None
    ) -> None:
        """The stored class is `verdict.error_class` (a plain identifier), never
        the raw drained string: a venue string must not reach the stored flags."""
        supabase, rec = _make_supabase(stored_flags={})
        await _run_job(
            supabase=supabase,
            rec=rec,
            daily_rows=[DAILY_ROW_1],
            daily_flags={
                "daily_pnl_fetch_error": True,
                "daily_pnl_fetch_error_class": error_class,
            },
            ingestion=False,
        )
        assert len(rec.analytics_upserts) == 1, rec.analytics_upserts
        flags = rec.analytics_upserts[0]["data_quality_flags"]
        assert flags["daily_pnl_fetch_error"] is True
        if expect_class is None:
            assert "daily_pnl_fetch_error_class" not in flags
        else:
            assert flags["daily_pnl_fetch_error_class"] == expect_class

    @pytest.mark.asyncio
    async def test_refused_read_keeps_a_stale_persist_failed_flag(self) -> None:
        """A refusal is not a successful Phase 1, so it must not assert a
        recovery that did not happen."""
        supabase, rec = _make_supabase(stored_flags=dict(STALE_PERSIST_FAILED))
        await _run_job(
            supabase=supabase,
            rec=rec,
            daily_rows=[DAILY_ROW_1],
            daily_flags={"daily_pnl_non_usd_okx": True},
            ingestion=False,
        )
        assert len(rec.analytics_upserts) == 1, rec.analytics_upserts
        assert rec.analytics_upserts[0]["data_quality_flags"] == {
            **STALE_PERSIST_FAILED,
            "daily_pnl_non_usd_okx": True,
        }

    @pytest.mark.asyncio
    async def test_clean_read_clears_a_stale_persist_failed_flag(self) -> None:
        """Control: a clean read that stored its rows is a successful Phase 1."""
        supabase, rec = _make_supabase(stored_flags=dict(STALE_PERSIST_FAILED))
        await _run_job(
            supabase=supabase, rec=rec, daily_rows=[DAILY_ROW_1], ingestion=False
        )
        assert len(rec.analytics_upserts) == 1, rec.analytics_upserts
        assert rec.analytics_upserts[0]["data_quality_flags"] == {}


class TestOwnedKeySet:
    def test_owned_predicate_reuses_the_verdict(self) -> None:
        owned = [
            "daily_pnl_fetch_error",
            "daily_pnl_binance_income_fallback",
            "daily_pnl_non_usd_okx",
            "daily_pnl_truncated_okx",
            "daily_pnl_truncated_bybit",
            "daily_pnl_deadline_okx",
            "daily_pnl_deadline_bybit",
            "daily_pnl_fetch_error_class",
            "daily_pnl_unsupported_venue",
        ]
        not_owned = [
            "daily_pnl_malformed_okx",
            "daily_pnl_malformed_bybit",
            "daily_pnl_malformed_binance",
            "sync_truncated_okx",
            "binance_partial_symbols",
            "last_success_snapshot",
        ]
        assert [k for k in owned if not _is_sync_owned_daily_pnl_key(k)] == []
        assert [k for k in not_owned if _is_sync_owned_daily_pnl_key(k)] == []

    def test_every_daily_pnl_flag_exchange_records_is_owned_or_malformed(self) -> None:
        """A new `daily_pnl_*` flag in services/exchange.py that is neither owned
        by the sync nor a derive-owned malformed key would be neither replaced nor
        cleared by a clean read, and would sit on the row forever. The scan is
        over the source, so adding a flag literal fails here at author time."""
        source = Path(exchange_mod.__file__).read_text(encoding="utf-8")
        names: set[str] = set()
        for node in ast.walk(ast.parse(source)):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "_record_dq_flag"
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
                and node.args[0].value.startswith("daily_pnl_")
            ):
                names.add(node.args[0].value)
        assert len(names) >= 12, sorted(names)
        for name in sorted(names):
            if name.startswith("daily_pnl_malformed_"):
                assert not _is_sync_owned_daily_pnl_key(name), name
            else:
                assert _is_sync_owned_daily_pnl_key(name), (
                    f"{name} is recorded by services/exchange.py but is neither "
                    "owned by the queued sync nor a daily_pnl_malformed_* key"
                )


# ---------------------------------------------------------------------------
# SC-5 (plan 02): the enqueue-failure tail's re-read, and which call failed
# ---------------------------------------------------------------------------

OLD_HANG_PHRASE = "may still hang"
FAILED_ENQUEUE_SENTENCE = (
    "sync_trades: the follow-on analytics enqueue failed and the strategy has "
    "nothing published"
)
ONE_ROW = [{"strategy_id": STRATEGY_ID}]


def _error_messages(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR]


async def _run_failed_enqueue(
    caplog: pytest.LogCaptureFixture,
    *,
    publish_script: list[Any],
    update_result: list[dict[str, Any]] | Exception,
) -> tuple[Any, _Recorder]:
    """A clean one-row ccxt run, ingestion off, whose follow-on enqueue raises.
    The publish read is scripted by name (see `_run_job`)."""
    supabase, rec = _make_supabase(
        stored_flags={},
        enqueue_error=RuntimeError("simulated enqueue infra failure"),
        update_result=update_result,
    )
    with caplog.at_level(logging.ERROR, logger=LOGGER_NAME):
        result = await _run_job(
            supabase=supabase,
            rec=rec,
            daily_rows=[DAILY_ROW_1],
            ingestion=False,
            publish_script=publish_script,
        )
    return result, rec


def _assert_no_hang_sentence(caplog: pytest.LogCaptureFixture) -> None:
    """Each arm calls this LAST, so its own outcome assertion is the first thing
    that fails on pre-fix code and the failure names the real defect."""
    assert not any(OLD_HANG_PHRASE in m for m in _error_messages(caplog)), (
        _error_messages(caplog)
    )


class TestRereadAfterZeroRowWrite:
    @pytest.mark.asyncio
    async def test_reread_raising_after_zero_row_write_returns_done(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """The publish read says nothing is published, the conditional write
        matches zero rows, and the re-read then raises. An unreadable state is not
        'nothing published' (T-222-13): DONE and nothing more written. Before the
        fix the shared `try` swallowed the raise and the handler returned FAILED,
        which on the last attempt becomes `failed_final` and lets bridge branch (b)
        write `failed` over a row a concurrent job may have published."""
        result, rec = await _run_failed_enqueue(
            caplog,
            publish_script=[False, RuntimeError("simulated re-read failure")],
            update_result=[],
        )
        assert result.outcome == DispatchOutcome.DONE
        assert result.trade_count == 1
        assert len(rec.update_payloads) == 1, rec.update_payloads
        assert rec.publish_reads == 2
        assert any(
            "the re-read of the publish state then raised" in m
            and "nothing was written, returning DONE" in m
            for m in _error_messages(caplog)
        ), _error_messages(caplog)
        _assert_no_hang_sentence(caplog)

    @pytest.mark.asyncio
    async def test_reread_finding_a_published_row_returns_done(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Control (R2-WR-01): zero rows, and the re-read finds a published row."""
        result, rec = await _run_failed_enqueue(
            caplog, publish_script=[False, True], update_result=[]
        )
        assert result.outcome == DispatchOutcome.DONE
        assert rec.publish_reads == 2
        assert any(
            "was published between the publish read and the write" in m
            for m in _error_messages(caplog)
        ), _error_messages(caplog)
        _assert_no_hang_sentence(caplog)

    @pytest.mark.asyncio
    async def test_reread_finding_nothing_stays_failed(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Control: zero rows and the re-read finds nothing published, so the row
        does not exist yet and the status bridge must create it: FAILED."""
        result, rec = await _run_failed_enqueue(
            caplog, publish_script=[False, False], update_result=[]
        )
        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "transient"
        assert result.error_message == FAILED_ENQUEUE_SENTENCE
        assert rec.publish_reads == 2
        _assert_no_hang_sentence(caplog)

    @pytest.mark.asyncio
    async def test_write_raising_before_reread_stays_failed(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """The failed-row write itself raising keeps FAILED and makes no re-read:
        the first read said nothing is published, so FAILED cannot unpublish a
        figure. The write and the re-read sit in separate `try` scopes, and the log
        names the write."""
        result, rec = await _run_failed_enqueue(
            caplog,
            publish_script=[False],
            update_result=RuntimeError("simulated write failure"),
        )
        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "transient"
        assert result.error_message == FAILED_ENQUEUE_SENTENCE
        assert rec.publish_reads == 1, "a write that raised must not be followed by a re-read"
        assert any(
            "the conditional failed-row write raised" in m
            for m in _error_messages(caplog)
        ), _error_messages(caplog)
        _assert_no_hang_sentence(caplog)

    def test_reread_old_hang_sentence_is_gone(self) -> None:
        """Source pin: the shared `except` arm's sentence claimed the wizard may
        still hang whichever call failed. It is replaced by lines that name the
        call. Scoped to `run_sync_trades_job`, whose count was 1 before plan 02."""
        import inspect

        import services.job_worker as job_worker

        source = inspect.getsource(job_worker.run_sync_trades_job)
        assert OLD_HANG_PHRASE not in source
