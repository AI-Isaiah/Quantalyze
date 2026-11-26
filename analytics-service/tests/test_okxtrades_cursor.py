"""Phase 232 OKXTRADES plan 01 (VREAD-08): `api_keys.last_fetched_trade_timestamp`
never reads ahead of the newest stored trade, and a key found ahead has its
skipped days re-read. Every arm drives the REAL `run_sync_trades_job` and reads
the params of its `advance_sync_cursor` RPC call.

WHY THIS MATTERS. The epilogue of `run_sync_trades_job` used to stamp the fills
cursor with wall-clock now whenever the fills list was empty: a raised fetch, an
empty read, the MT5 arm and every run with `USE_RAW_TRADE_INGESTION` off. The
read side trusted that cursor, so the days between the newest stored fill and
that stamp were never fetched again (PROD 2026-11-24: 5 active keys ahead of
their newest stored fill). Now the writer stamps a stored-through mark (the
newest fill this run persisted, or nothing), holds on any refused, partial or
truncated read, and the reader clamps the cursor to the stored fills high-water.

THE FAKES. `_make_supabase` applies every `.eq`, `.order` and `.limit` on the
`trades` table, so a failed fills high-water read is distinguishable from a real
seed (a bare MagicMock would fail open and hide both). Its `trades` upserts and
the `strategy_analytics` flag row are recorded, so the refuse-then-clean
sequences can read what each run wrote. Every instant is a typed literal with
its epoch ms hand-typed beside it, never computed by the code under test.

NEUTER (each recorded in the 232-01 SUMMARY, restored from a byte backup):
  N1 let the stamp gate pass on an empty fill list and stamp wall-clock now:
     test_a_refused_fills_read_holds_the_cursor,
     test_the_cursor_stamps_the_newest_stored_fill_not_now and the MT5 assertion
     in test_mt5_sync_path.py go RED.
  N2 drop only the `not phase2_failed` conjunct of the gate:
     test_a_failed_phase_two_holds_the_cursor_even_with_fills_in_hand goes RED
     (a fetch that returned fills and then raised leaves fills in hand under a
     failed flag; the plain refused arm cannot see this conjunct because an
     empty fill list already fails the gate).
  N3 stamp wall-clock now under the new gate: the stored-through arm goes RED.
  N4 seed the fills read from the parsed column alone: the ahead arm
     (test_an_ahead_cursor_reads_from_the_newest_stored_fill) goes RED.
  N5 drop the `sync_truncated_` conjunct of the gate: the truncated arm goes RED.
  N6 drop the bootstrap anchor assignment: the anchor arms go RED.
  N7 let a column with no stored fill fall back to the daily seed alone: the
     bootstrap sequence arm goes RED.
  N8 drop the `binance_partial_symbols` disjunct of the gate (review 232 CR-02 /
     SFH-01): the partial-symbol refuse-then-clean arm goes RED.
  N9 drop the `or _fills_incomplete` of the bootstrap anchor (review 232 CR-01):
     the truncated-bootstrap refuse-then-clean arm goes RED.
"""

from __future__ import annotations

import copy
import itertools
import logging
from typing import Any, NamedTuple
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.job_worker import DispatchOutcome, run_sync_trades_job
from tests._binance_fills import RereadBounds

STRATEGY_ID = "strat-232-cursor"

# Stored rows. Two DAILY rows and one FILL newer than both.
DAILY_OLD_TS = "2026-04-20T00:00:00+00:00"
DAILY_NEWEST_TS = "2026-05-07T05:17:00+00:00"
DAILY_LATER_TS = "2026-05-20T05:17:00+00:00"
FILL_STORED_TS = "2026-06-01T09:00:00+00:00"
# Hand-typed epoch ms.
DAILY_NEWEST_DAY_START_MS = 1778112000000  # 2026-05-07T00:00:00Z
DAILY_LATER_DAY_START_MS = 1779235200000  # 2026-05-20T00:00:00Z
FILL_STORED_MS = 1780304400000  # 2026-06-01T09:00:00Z, NOT floored
# The ISO form of the daily seed: what a bootstrap refusal anchors the column at.
DAILY_NEWEST_DAY_START_ISO = "2026-05-07T00:00:00+00:00"

# Fills cursors: one behind the stored fill, one ahead of it.
CURSOR_BEHIND_TS = "2026-05-10T12:00:00+00:00"
CURSOR_BEHIND_MS = 1778414400000  # 2026-05-10T12:00:00Z
CURSOR_AHEAD_TS = "2026-06-20T00:00:00+00:00"

# Fill timestamps persisted by a run (ISO, as `_make_fill_dict` writes them).
NEWEST_FILL_TS = "2026-06-01T09:00:00+00:00"
EARLIER_FILL_TS = "2026-05-31T23:59:59+00:00"

DEFAULT_TRADES: list[dict[str, Any]] = [
    {"strategy_id": STRATEGY_ID, "is_fill": False, "timestamp": DAILY_OLD_TS},
    {"strategy_id": STRATEGY_ID, "is_fill": False, "timestamp": DAILY_NEWEST_TS},
    {"strategy_id": STRATEGY_ID, "is_fill": True, "timestamp": FILL_STORED_TS},
]
DAILY_ONLY_TRADES: list[dict[str, Any]] = [
    row for row in DEFAULT_TRADES if row["is_fill"] is False
]


def _fill(fill_id: str, timestamp: Any) -> dict[str, Any]:
    """A fill dict shaped like `_make_fill_dict` output."""
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
    """What the fake Supabase saw."""

    def __init__(self) -> None:
        self.trades_queries: list[dict[str, Any]] = []
        self.upserted_batches: list[list[dict[str, Any]]] = []
        self.advance_params: list[dict[str, Any]] = []
        self.analytics_upserts: list[dict[str, Any]] = []
        self.upsert_calls = 0


def _make_supabase(
    *,
    trades_rows: list[dict[str, Any]],
    trades_select_error: Exception | None = None,
    fills_select_error: Exception | None = None,
    upsert_fails_on_call: int | None = None,
    sync_trades_error: Exception | None = None,
    flags: dict[str, Any] | None = None,
    bounds: RereadBounds | None = None,
) -> tuple[MagicMock, _Recorder]:
    """`flags` is the strategy's `data_quality_flags`; the fake reads it on the
    flag read and REPLACES it from the upserted payload, so passing the same dict
    to two runs lets the second read what the first wrote.

    `bounds` (Phase 253) is the stateful `strategy_fills_reread_bounds` table and its RPC
    `set_strategy_fills_reread_bound`; passing one store to two runs lets the second read
    what the first wrote. None gives a fresh store, so a Binance run that is not about the
    bound (the e2e suite) still meets a real branch rather than MagicMock defaults."""
    rec = _Recorder()
    bound_store = bounds if bounds is not None else RereadBounds()
    table_rows = list(trades_rows)
    stored_flags: dict[str, Any] = flags if flags is not None else {}

    class _FakeTradesQuery:
        """Applies every `.eq`, `.order` and `.limit`."""

        def __init__(self) -> None:
            self._eq: list[tuple[str, Any]] = []
            self._order: tuple[str, bool] | None = None
            self._limit: int | None = None
            self._in = False

        def select(self, *_a: Any, **_k: Any) -> "_FakeTradesQuery":
            return self

        def eq(self, col: str, val: Any) -> "_FakeTradesQuery":
            self._eq.append((col, val))
            return self

        def in_(self, *_a: Any, **_k: Any) -> "_FakeTradesQuery":
            self._in = True
            return self

        def order(self, col: str, desc: bool = False) -> "_FakeTradesQuery":
            self._order = (col, desc)
            return self

        def limit(self, n: int) -> "_FakeTradesQuery":
            self._limit = n
            return self

        def execute(self) -> Any:
            rec.trades_queries.append(
                {"eq": list(self._eq), "order": self._order, "limit": self._limit}
            )
            if self._in:
                # The amendment-detection probe: no collisions.
                return MagicMock(data=[])
            if trades_select_error is not None:
                raise trades_select_error
            if fills_select_error is not None and ("is_fill", True) in self._eq:
                raise fills_select_error
            matched = [
                r for r in table_rows if all(r.get(c) == v for c, v in self._eq)
            ]
            if self._order is not None:
                col, desc = self._order
                matched.sort(key=lambda r: r[col], reverse=desc)
            if self._limit is not None:
                matched = matched[: self._limit]
            return MagicMock(data=[{"timestamp": r["timestamp"]} for r in matched])

        def upsert(self, payload: list[dict[str, Any]], **_k: Any) -> Any:
            def _execute() -> Any:
                rec.upsert_calls += 1
                if upsert_fails_on_call == rec.upsert_calls:
                    raise RuntimeError(f"batch {rec.upsert_calls} simulated failure")
                rec.upserted_batches.append(list(payload))
                return MagicMock(data=None)

            return MagicMock(execute=_execute)

    class _FakeAnalytics:
        def select(self, *_a: Any, **_k: Any) -> "_FakeAnalytics":
            return self

        def eq(self, *_a: Any, **_k: Any) -> "_FakeAnalytics":
            return self

        def maybe_single(self) -> "_FakeAnalytics":
            return self

        def execute(self) -> Any:
            return MagicMock(data={"data_quality_flags": copy.deepcopy(stored_flags)})

        def upsert(self, payload: dict[str, Any], **_k: Any) -> Any:
            def _execute() -> Any:
                rec.analytics_upserts.append(copy.deepcopy(payload))
                stored_flags.clear()
                stored_flags.update(copy.deepcopy(payload["data_quality_flags"]))
                return MagicMock(data=None)

            return MagicMock(execute=_execute)

    supabase = MagicMock()

    def _rpc(name: str, payload: dict[str, Any]) -> MagicMock:
        if name == "advance_sync_cursor":
            rec.advance_params.append(dict(payload))
        if name == "set_strategy_fills_reread_bound":
            return bound_store.rpc(payload)
        stub = MagicMock()
        if name == "sync_trades" and sync_trades_error is not None:
            stub.execute.side_effect = sync_trades_error
        else:
            stub.execute.return_value = MagicMock(
                data=True if name == "advance_sync_cursor" else 0
            )
        return stub

    supabase.rpc.side_effect = _rpc

    def _table(name: str) -> Any:
        if name == "trades":
            return _FakeTradesQuery()
        if name == "strategy_analytics":
            return _FakeAnalytics()
        if name == "strategy_fills_reread_bounds":
            return bound_store.table()
        return MagicMock()

    supabase.table.side_effect = _table
    return supabase, rec


class _Outcome(NamedTuple):
    result: Any
    fetch_raw: AsyncMock


async def _run_job(
    *,
    supabase: MagicMock,
    column: str | None,
    raw_fills: list[dict[str, Any]] | None = None,
    raw_error: Exception | None = None,
    ingestion: bool = True,
    daily_trades: list[dict[str, Any]] | None = None,
    fills_flags: dict[str, Any] | None = None,
    fills_drain_error: Exception | None = None,
    balance_error: BaseException | None = None,
    exchange: str = "okx",
    strategy_id: str = STRATEGY_ID,
) -> _Outcome:
    """Drive the REAL `run_sync_trades_job`. `fills_flags` is what the fills
    read's DQ drain returns (the daily drain returns nothing);
    `fills_drain_error` makes that drain raise AFTER `fetch_raw_trades` has
    returned its fills, the one path where fills are in hand and Phase 2 is
    nonetheless marked failed. `balance_error` (Phase 253 round 4) makes the
    balance read raise: the one exchange call after the Phase-1 daily store and
    before the fills walk."""
    mock_exchange = AsyncMock()
    mock_exchange.close = AsyncMock()

    mock_ctx = MagicMock()
    mock_ctx.exchange = mock_exchange  # ccxt shape, NOT Mt5Session
    mock_ctx.supabase = supabase
    mock_ctx.strategy_row = {"id": strategy_id, "user_id": "user-1"}
    mock_ctx.key_row = {
        "id": "key-1",
        "exchange": exchange,
        "user_id": "user-1",
        "last_sync_at": "2026-11-13T06:00:00+00:00",
        "last_fetched_trade_timestamp": column,
    }

    fetch_all = AsyncMock(return_value=daily_trades if daily_trades else [])
    if raw_error is not None:
        fetch_raw = AsyncMock(side_effect=raw_error)
    else:
        fetch_raw = AsyncMock(return_value=raw_fills if raw_fills else [])
    job = {"id": "job-232", "kind": "sync_trades", "strategy_id": strategy_id}

    patches = [
        patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ),
        patch("services.job_worker.fetch_all_trades", new=fetch_all),
        patch(
            "services.job_worker.fetch_usdt_balance",
            new=(
                AsyncMock(side_effect=balance_error)
                if balance_error is not None
                else AsyncMock(return_value=10000.0)
            ),
        ),
        patch("services.job_worker.fetch_raw_trades", new=fetch_raw),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
        patch("services.job_worker._RAW_TRADE_INGESTION_ENABLED", ingestion),
    ]
    if fills_flags is not None or fills_drain_error is not None:
        # call 1 = the daily drain, call 2 = the fills drain.
        second: Any = fills_drain_error if fills_drain_error is not None else fills_flags
        patches.append(
            patch(
                "services.job_worker.get_and_clear_last_dq_flags",
                side_effect=itertools.chain([{}, second], itertools.repeat({})),
            )
        )
    for p in patches:
        p.start()
    try:
        result = await run_sync_trades_job(job)
    finally:
        for p in reversed(patches):
            p.stop()

    assert result.outcome == DispatchOutcome.DONE
    return _Outcome(result, fetch_raw)


def _the_advance(rec: _Recorder) -> dict[str, Any]:
    assert len(rec.advance_params) == 1, (
        f"expected exactly one advance_sync_cursor call, got {rec.advance_params}"
    )
    return rec.advance_params[0]


class TestFillsCursorNeverRunsAhead:
    """VREAD-08: the stamp, the gate, the seed clamp and the bootstrap anchor.

    Neuters N1 to N7 are listed in the module docstring and recorded in the
    232-01 SUMMARY.
    """

    async def test_a_refused_fills_read_holds_the_cursor(self) -> None:
        # A raised fetch persisted nothing. The old rule stamped wall-clock now
        # on the empty list, putting the column ahead of every stored fill (the
        # 231 `dependency-232` record, WR-03). The column must be left alone.
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            raw_error=RuntimeError("venue refused the fills read"),
        )

        assert _the_advance(rec)["p_last_fetched_ts"] is None, (
            "a refused fills read must hold the fills cursor (VREAD-08); the old "
            "rule stamped wall-clock now"
        )

    async def test_the_cursor_stamps_the_newest_stored_fill_not_now(self) -> None:
        # Two fills persisted, the newest listed FIRST: the stamp is the maximum
        # over every fill, never the last one in the list and never the clock.
        supabase, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES)
        await _run_job(
            supabase=supabase,
            column=None,
            raw_fills=[
                _fill("fill-newest", NEWEST_FILL_TS),
                _fill("fill-earlier", EARLIER_FILL_TS),
            ],
        )

        assert len(rec.upserted_batches) == 1 and len(rec.upserted_batches[0]) == 2
        assert _the_advance(rec)["p_last_fetched_ts"] == "2026-06-01T09:00:00+00:00"

    # ---- the seed: min(column, stored fills high-water) -------------------

    async def test_an_ahead_cursor_reads_from_the_newest_stored_fill(self) -> None:
        # SC-3: the column (2026-06-20) is ahead of the newest stored fill
        # (2026-06-01T09:00Z). The read starts at that fill's EXACT timestamp,
        # unfloored, so the skipped days are re-read; the over-fetch is absorbed
        # by the (strategy_id, exchange, exchange_fill_id) unique index.
        supabase, _rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        out = await _run_job(supabase=supabase, column=CURSOR_AHEAD_TS)

        assert out.fetch_raw.call_args.kwargs["since_ms"] == FILL_STORED_MS

    async def test_a_cursor_behind_the_stored_fill_is_kept(self) -> None:
        # A column earlier than the newest stored fill is the partial-success
        # checkpoint and stays the seed (the LASTSYNC-SEED decision 4 case).
        supabase, _rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        out = await _run_job(supabase=supabase, column=CURSOR_BEHIND_TS)

        assert out.fetch_raw.call_args.kwargs["since_ms"] == CURSOR_BEHIND_MS

    async def test_an_ahead_cursor_with_no_stored_fill_reads_from_the_daily_seed(
        self,
    ) -> None:
        # Ruling Q1: a column whose stored-fill high-water is absent is bounded
        # by the daily seed (00:00 UTC of the newest stored daily row), never
        # used alone.
        supabase, _rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES)
        out = await _run_job(supabase=supabase, column=CURSOR_AHEAD_TS)

        assert out.fetch_raw.call_args.kwargs["since_ms"] == DAILY_NEWEST_DAY_START_MS

    async def test_a_failed_fill_high_water_read_takes_the_earlier_of_cursor_and_daily_seed(
        self,
    ) -> None:
        # Only the `is_fill = true` query raises; the daily read still works. A
        # failed fills read is "no stored fill known", so the ahead column is
        # clamped by the daily seed and never trusted unclamped.
        supabase, rec = _make_supabase(
            trades_rows=DEFAULT_TRADES,
            fills_select_error=RuntimeError("PostgREST 503 simulated"),
        )
        out = await _run_job(supabase=supabase, column=CURSOR_AHEAD_TS)

        assert any(("is_fill", True) in q["eq"] for q in rec.trades_queries), (
            "the fills high-water read was never issued"
        )
        assert out.fetch_raw.call_args.kwargs["since_ms"] == DAILY_NEWEST_DAY_START_MS

    async def test_a_null_cursor_keeps_the_daily_seed_and_issues_no_fill_read(
        self,
    ) -> None:
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        out = await _run_job(supabase=supabase, column=None)

        assert out.fetch_raw.call_args.kwargs["since_ms"] == DAILY_NEWEST_DAY_START_MS
        assert rec.trades_queries, "the stored daily high-water was never read"
        assert not any(("is_fill", True) in q["eq"] for q in rec.trades_queries), (
            "a NULL column must not issue a fills high-water read"
        )

    # ---- the gate: stamp only what was stored in full ----------------------

    async def test_a_truncated_fills_read_holds_the_cursor(self) -> None:
        # Ruling Q7: a truncated read stored an incomplete window, so its newest
        # fill is not a stored-through mark. The control run without the flag
        # stamps, so the hold is the flag's doing and not the fixture's. The
        # column is SET here: a hold on a NULL column protects nothing, and that
        # bootstrap case is the anchor arm
        # (test_truncated_bootstrap_then_clean_rereads_the_truncated_span).
        supabase, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            raw_fills=[_fill("fill-1", NEWEST_FILL_TS)],
            fills_flags={"sync_truncated_okx": True},
        )
        assert len(rec.upserted_batches) == 1, "the truncated read's fills persist"
        assert _the_advance(rec)["p_last_fetched_ts"] is None, (
            "a truncated fills read must hold the fills cursor (ruling Q7)"
        )

        control, control_rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES)
        await _run_job(
            supabase=control,
            column=CURSOR_BEHIND_TS,
            raw_fills=[_fill("fill-1", NEWEST_FILL_TS)],
            fills_flags={"sync_truncated_okx": False},
        )
        assert _the_advance(control_rec)["p_last_fetched_ts"] == NEWEST_FILL_TS

    async def test_a_failed_phase_two_holds_the_cursor_even_with_fills_in_hand(
        self,
    ) -> None:
        # `fetch_raw_trades` returned fills, then its DQ drain raised inside the
        # same try, so Phase 2 is marked failed (flag stamped) while the fills
        # persist. The cursor must follow the flag: a run flagged
        # phase2_fill_ingestion_failed never stamps, so the next run re-reads.
        supabase, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES)
        await _run_job(
            supabase=supabase,
            column=None,
            raw_fills=[_fill("fill-1", NEWEST_FILL_TS)],
            fills_drain_error=RuntimeError("dq drain failed after the fetch"),
        )

        assert len(rec.upserted_batches) == 1, "the returned fills persist"
        assert rec.analytics_upserts[-1]["data_quality_flags"][
            "phase2_fill_ingestion_failed"
        ] is True
        assert _the_advance(rec)["p_last_fetched_ts"] == DAILY_NEWEST_DAY_START_ISO, (
            "a Phase-2-failed run holds the stored-through stamp; the only "
            "write is the bootstrap anchor at the read start"
        )

    @pytest.mark.parametrize(
        "ingestion, raw_fills",
        [(False, None), (True, [])],
        ids=["ingestion-off", "clean-empty-read"],
    )
    async def test_a_run_with_no_fills_leaves_the_column_untouched(
        self, ingestion: bool, raw_fills: list[dict[str, Any]] | None
    ) -> None:
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            raw_fills=raw_fills,
            ingestion=ingestion,
        )

        advance = _the_advance(rec)
        assert advance["p_last_fetched_ts"] is None, (
            "a run that persisted no fill must leave the fills cursor untouched"
        )
        # last_sync_at and the balance keep their existing rules.
        assert advance["p_last_sync_at"] is not None
        assert advance["p_account_balance"] == 10000.0

    @pytest.mark.parametrize(
        "bad_fill, exc_class",
        [
            (_fill("fill-bad", "not-a-time"), "ValueError"),
            ({k: v for k, v in _fill("fill-bad", "x").items() if k != "timestamp"}, "KeyError"),
        ],
        ids=["unparsable", "missing"],
    )
    async def test_an_unparsable_fill_timestamp_holds_the_cursor(
        self,
        bad_fill: dict[str, Any],
        exc_class: str,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        # A fill that cannot be dated holds the cursor; never a partial maximum
        # over the fills that could be. The WARNING names the strategy and the
        # exception class and carries no fill content (T-232-03).
        supabase, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES)
        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.job_worker"):
            await _run_job(
                supabase=supabase,
                column=None,
                raw_fills=[_fill("fill-good", NEWEST_FILL_TS), bad_fill],
            )

        assert len(rec.upserted_batches[0]) == 2
        assert _the_advance(rec)["p_last_fetched_ts"] is None
        held = [r.getMessage() for r in caplog.records if "no usable timestamp" in r.getMessage()]
        assert len(held) == 1
        assert STRATEGY_ID in held[0] and exc_class in held[0]
        assert "not-a-time" not in held[0] and "fill-bad" not in held[0]

    # ---- the bootstrap anchor ----------------------------------------------

    async def test_a_bootstrap_refusal_anchors_at_the_read_start(self) -> None:
        # Ruling Q1: column NULL at read time, the fetch raised, the run had a
        # non-NULL seed. The cursor is anchored at the read start (never ahead of
        # where the read began), so the next clean run covers the refused span
        # before the self-heal clears the flag.
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        await _run_job(
            supabase=supabase,
            column=None,
            raw_error=RuntimeError("venue refused the fills read"),
        )

        assert _the_advance(rec)["p_last_fetched_ts"] == DAILY_NEWEST_DAY_START_ISO

    async def test_a_bootstrap_refusal_with_no_seed_writes_nothing(self) -> None:
        # A first sync whose seed is NULL (full reach) has nothing to anchor.
        supabase, rec = _make_supabase(trades_rows=[])
        await _run_job(
            supabase=supabase,
            column=None,
            raw_error=RuntimeError("venue refused the fills read"),
        )

        assert _the_advance(rec)["p_last_fetched_ts"] is None

    async def test_a_partial_persist_at_bootstrap_anchors_at_the_read_start(
        self,
    ) -> None:
        # Planner refinement: a persist batch failure leaves the same unstored
        # span under the same phase2_fill_ingestion_failed flag as a raised
        # fetch, so it anchors the same way. 150 fills = 2 batches; the second
        # raises.
        supabase, rec = _make_supabase(
            trades_rows=DEFAULT_TRADES, upsert_fails_on_call=2
        )
        await _run_job(
            supabase=supabase,
            column=None,
            raw_fills=[_fill(f"fill-{i}", NEWEST_FILL_TS) for i in range(150)],
        )

        assert len(rec.upserted_batches) == 1, "only the first batch persisted"
        assert _the_advance(rec)["p_last_fetched_ts"] == DAILY_NEWEST_DAY_START_ISO

    # ---- refuse-then-clean: the refusal survives until covered -------------

    async def test_refusal_then_clean_rereads_the_refused_span_before_the_flag_clears(
        self,
    ) -> None:
        shared_flags: dict[str, Any] = {}

        # Run 1: column set, the fills read is refused.
        supabase1, rec1 = _make_supabase(
            trades_rows=DEFAULT_TRADES, flags=shared_flags
        )
        out1 = await _run_job(
            supabase=supabase1,
            column=CURSOR_BEHIND_TS,
            raw_error=RuntimeError("venue refused the fills read"),
        )
        assert _the_advance(rec1)["p_last_fetched_ts"] is None, "the cursor holds"
        assert rec1.analytics_upserts[-1]["data_quality_flags"][
            "phase2_fill_ingestion_failed"
        ] is True

        # Run 2: the same column (held), a newer daily row, a clean read.
        supabase2, rec2 = _make_supabase(
            trades_rows=[
                *DEFAULT_TRADES,
                {"strategy_id": STRATEGY_ID, "is_fill": False, "timestamp": DAILY_LATER_TS},
            ],
            flags=shared_flags,
        )
        out2 = await _run_job(
            supabase=supabase2,
            column=CURSOR_BEHIND_TS,
            raw_fills=[_fill("fill-after", NEWEST_FILL_TS)],
        )

        since1 = out1.fetch_raw.call_args.kwargs["since_ms"]
        since2 = out2.fetch_raw.call_args.kwargs["since_ms"]
        assert since2 is None or since2 <= since1, (
            "the clean run must read from at or before the refused run's seed"
        )
        healed = rec2.analytics_upserts[-1]["data_quality_flags"]
        assert "phase2_fill_ingestion_failed" not in healed
        assert "phase2_recovered_at" in healed

    async def test_bootstrap_refusal_then_clean_rereads_the_refused_span_before_the_flag_clears(
        self,
    ) -> None:
        shared_flags: dict[str, Any] = {}

        # Run 1: column NULL, daily seed 2026-05-07, the fills read is refused.
        supabase1, rec1 = _make_supabase(
            trades_rows=DEFAULT_TRADES, flags=shared_flags
        )
        out1 = await _run_job(
            supabase=supabase1,
            column=None,
            raw_error=RuntimeError("venue refused the fills read"),
        )
        anchor = _the_advance(rec1)["p_last_fetched_ts"]
        assert anchor == DAILY_NEWEST_DAY_START_ISO, "the anchor is written"
        assert out1.fetch_raw.call_args.kwargs["since_ms"] == DAILY_NEWEST_DAY_START_MS

        # Run 2: the column is the anchor, the newest daily day has moved on to
        # 2026-05-20, no fill is stored. Under "no stored fill, ignore the
        # column" this would read from 1779235200000 and lose the refused span.
        supabase2, rec2 = _make_supabase(
            trades_rows=[
                *DAILY_ONLY_TRADES,
                {"strategy_id": STRATEGY_ID, "is_fill": False, "timestamp": DAILY_LATER_TS},
            ],
            flags=shared_flags,
        )
        out2 = await _run_job(
            supabase=supabase2,
            column=anchor,
            raw_fills=[_fill("fill-after", NEWEST_FILL_TS)],
        )

        assert out2.fetch_raw.call_args.kwargs["since_ms"] == DAILY_NEWEST_DAY_START_MS
        assert DAILY_LATER_DAY_START_MS > DAILY_NEWEST_DAY_START_MS
        healed = rec2.analytics_upserts[-1]["data_quality_flags"]
        assert "phase2_fill_ingestion_failed" not in healed
        assert "phase2_recovered_at" in healed

    async def test_partial_symbols_then_clean_rereads_the_failed_symbols_span(
        self,
    ) -> None:
        # Review 232 CR-02 / SFH-01. Binance returns the fills of the symbols that
        # succeeded and records `binance_partial_symbols` for the ones that
        # failed, without raising. Stamping the newest returned fill would put the
        # cursor ahead of the failed symbols' unread fills, and the next seed
        # (min(cursor, newest stored fill)) is that same instant: their span would
        # never be fetched. The column must hold, so the clean run re-reads it.
        shared_flags: dict[str, Any] = {}

        # Run 1: the column is set, ETHUSDT failed, BTCUSDT's fill came back.
        supabase1, rec1 = _make_supabase(
            trades_rows=DEFAULT_TRADES, flags=shared_flags
        )
        out1 = await _run_job(
            supabase=supabase1,
            column=CURSOR_BEHIND_TS,
            raw_fills=[_fill("fill-btc", NEWEST_FILL_TS)],
            fills_flags={"binance_partial_symbols": ["ETHUSDT"]},
        )
        assert len(rec1.upserted_batches) == 1, "the surviving symbols' fills persist"
        stamped = _the_advance(rec1)["p_last_fetched_ts"]
        assert stamped is None, (
            "a partial-symbol fills read must hold the fills cursor (CR-02)"
        )

        # Run 2: the column is whatever run 1 left it (the RPC writes a NULL
        # param as "untouched"), the read is clean.
        supabase2, rec2 = _make_supabase(
            trades_rows=DEFAULT_TRADES, flags=shared_flags
        )
        out2 = await _run_job(
            supabase=supabase2,
            column=stamped or CURSOR_BEHIND_TS,
            raw_fills=[_fill("fill-eth", NEWEST_FILL_TS)],
        )

        assert out1.fetch_raw.call_args.kwargs["since_ms"] == CURSOR_BEHIND_MS
        assert out2.fetch_raw.call_args.kwargs["since_ms"] == CURSOR_BEHIND_MS, (
            "the clean run must re-read from the held cursor, covering the span "
            "the failed symbol never returned"
        )
        # The control: a clean read does stamp, so the hold above is the flag's.
        assert _the_advance(rec2)["p_last_fetched_ts"] == NEWEST_FILL_TS

    async def test_truncated_bootstrap_then_clean_rereads_the_truncated_span(
        self,
    ) -> None:
        # Review 232 CR-01. The column is NULL, so the Q7 hold protects nothing:
        # a truncated OKX read returns fills (it does not raise), phase2_failed
        # stays False, and without an anchor the next run seeds from the daily
        # high-water, which has moved on, so the span the cap dropped is never
        # read again. The truncated bootstrap read must anchor at its read start.
        shared_flags: dict[str, Any] = {}

        # Run 1: column NULL, daily seed 2026-05-07, the read is truncated.
        supabase1, rec1 = _make_supabase(
            trades_rows=DAILY_ONLY_TRADES, flags=shared_flags
        )
        out1 = await _run_job(
            supabase=supabase1,
            column=None,
            raw_fills=[_fill("fill-1", NEWEST_FILL_TS)],
            fills_flags={"sync_truncated_okx": True},
        )
        assert len(rec1.upserted_batches) == 1, "the truncated read's fills persist"
        anchor = _the_advance(rec1)["p_last_fetched_ts"]
        assert anchor == DAILY_NEWEST_DAY_START_ISO, (
            "a truncated bootstrap read must anchor the NULL column at its read "
            "start (CR-01), never at the newest fill it returned"
        )
        assert out1.fetch_raw.call_args.kwargs["since_ms"] == DAILY_NEWEST_DAY_START_MS

        # Run 2: the column is what run 1 wrote (the RPC writes a NULL param as
        # "untouched"), the daily high-water moved on to 2026-05-20, clean read.
        supabase2, rec2 = _make_supabase(
            trades_rows=[
                *DAILY_ONLY_TRADES,
                {"strategy_id": STRATEGY_ID, "is_fill": False, "timestamp": DAILY_LATER_TS},
            ],
            flags=shared_flags,
        )
        out2 = await _run_job(
            supabase=supabase2,
            column=anchor,
            raw_fills=[_fill("fill-2", NEWEST_FILL_TS)],
        )

        assert out2.fetch_raw.call_args.kwargs["since_ms"] == DAILY_NEWEST_DAY_START_MS, (
            "the clean run must re-read the truncated span from the anchor"
        )
        assert DAILY_LATER_DAY_START_MS > DAILY_NEWEST_DAY_START_MS
        assert _the_advance(rec2)["p_last_fetched_ts"] == NEWEST_FILL_TS
