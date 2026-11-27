"""Phase 250 BINANCEFILLS plan 02 (SC-2, SC-3, SC-5): the fills-cursor gate of
`run_sync_trades_job` never stamps past a stopped Binance symbol's unread fills
and never holds on a venue-unlisted symbol. Every arm drives the REAL
`run_sync_trades_job` and reads the params of its `advance_sync_cursor` RPC call.

WHY THIS MATTERS. A Binance fills read that stops early with a bound (a symbol
hit the page cap, a full page whose last row has no timestamp, the read deadline)
still returns every fill it read, including healthy symbols' fills NEWER than the
stopped symbol's unread span. The plain maximum over those fills would stamp the
cursor past that span, and the next run's seed (min(cursor, newest stored fill),
minus the overlap) would skip it for good. The gate therefore takes the
read-through bound `binance_read_through_ms` from the drained flags and stamps
only the newest PERSISTED fill at or before it. A stop record whose bound was lost
(`_record_dq_flag` swallows its own exceptions) holds the cursor, because a lost
bound must never read as "no stop". Holds (`binance_partial_symbols`,
`sync_truncated_*`) still win over any stop.

THE FAKES come from `tests/test_okxtrades_cursor.py` (`_make_supabase`,
`_run_job`, `_the_advance`): a Supabase fake that applies every `.eq`, `.order`
and `.limit`, and a `_run_job` whose `fills_flags` is the fills drain the gate
reads. Every instant below is hand-typed with its ISO, never computed by the code
under test:

    1778414400000  2026-05-10T12:00:00+00:00  CURSOR_BEHIND (a set column)
    (no ms needed) 2026-05-07T00:00:00+00:00  the daily seed, the NULL-column anchor
    1780304400000  2026-06-01T09:00:00+00:00  B, the capped symbol's newest read fill
    1780304400123  2026-06-01T09:00:00.123000+00:00  B + 123 ms
    1780390800000  2026-06-02T09:00:00+00:00  a second stopped symbol's bound
    1780477200000  2026-06-03T09:00:00+00:00  a healthy symbol's newer fill
    1780563600000  2026-06-04T09:00:00+00:00  a later healthy fill

NEUTER (PROOF-01; each recorded in the 250-02 SUMMARY, restored with `cp` from a
byte backup outside the worktree and checked with `cmp`):
  N7  add `binance_unlisted_symbols` (then `binance_fills_reach_clamped`) to the
      holding predicate of `_fills_incomplete`:
      test_a_non_holding_flag_alone_stamps_the_newest_fill goes RED.
  N8  drop the `binance_partial_symbols` disjunct of `_fills_incomplete`:
      test_a_transiently_failed_symbol_holds_then_is_reread_clean goes RED.
  N10 drop the bound filter so the stamp is the plain maximum:
      test_tracer_a_stopped_read_stamps_the_newest_fill_at_or_before_its_bound and
      test_the_bound_is_inclusive_to_the_millisecond go RED.
  N11 apply the bound filter outside `if advance_fetched_cursor`:
      test_a_hold_beats_a_stop goes RED.
  N12 delete the trailing stop-anchor statement:
      test_a_stop_with_nothing_stampable_anchors_a_null_column goes RED.
  N20 delete the unusable-stop disjunct of `_fills_incomplete`:
      test_a_stop_record_without_a_usable_bound_holds goes RED.
  R2-N2 drop the `exchange_dq_flags["binance_stop_below_cursor"] = True` write:
      test_a_stop_below_a_column_set_by_another_strategy_is_flagged_and_warned goes RED.

NEUTER, Phase 253 plan 02 (PROOF-01; each recorded verbatim in the 253-02 SUMMARY, restored with
`cp` from a byte backup under the session scratchpad and checked with `cmp`):
  P0  run the pre-fix `job_worker.py` (no bound read, no bound write):
      test_sc1_a_stop_below_a_column_set_by_another_strategy_is_reread_by_the_next_run and
      test_d02_three_step_interleave_b_rereads_from_its_bound_after_a_advances_the_column go RED.
  P1  delete the seed assignment `fills_since_ms = _reread_bound_ms`: the same two arms and
      test_sc1_a_failed_symbol_on_a_column_ahead_is_reread_from_the_reach go RED.
  P2  drop the `binance_partial_symbols` term of the throughs condition:
      test_stop_plus_partial_is_flagged_by_name_and_bounds_the_walk_start goes RED.
  P3  drop the `phase2_failed` term of it:
      test_a_raised_binance_read_on_a_column_ahead_is_flagged_and_bounded goes RED.
  P4  drop the Binance gate (`_binance_read` becomes true for every venue):
      test_a_raised_okx_read_never_sets_a_binance_flag goes RED.
  P5  (superseded by the round-1 CR-01 fix: the `_p_last_fetched = None` hold it neutered is
      gone, and that hold lost the NULL-column anchor; see R1-P4 below)
  P6  send `-infinity` as covers_from on every run:
      test_a_failed_bound_read_adds_no_term_and_the_rpc_keeps_the_stored_bound goes RED.
  P7  drop `- _exchange.OVERLAP_WINDOW_MS` from the flag predicate:
      test_the_overlap_hour_below_the_newest_stored_fill_is_not_flagged[inside-the-overlap-hour]
      and [edge-minus-1ms] go RED.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from unittest.mock import MagicMock

import ccxt
import pytest

from services import exchange as ex
from tests._binance_fills import RereadBounds, bound_after_set, column_after_advance
from tests.test_okxtrades_cursor import (
    CURSOR_AHEAD_TS,
    CURSOR_BEHIND_MS,
    CURSOR_BEHIND_TS,
    DAILY_NEWEST_DAY_START_ISO,
    DAILY_ONLY_TRADES,
    DEFAULT_TRADES,
    FILL_STORED_MS,
    FILL_STORED_TS,
    STRATEGY_ID,
    _make_supabase,
    _run_job,
    _the_advance,
)

# Hand-typed instants (see the module docstring for the epoch ms of each).
B_MS = 1780304400000
B_TS = "2026-06-01T09:00:00+00:00"
B_PLUS_123_MS = 1780304400123
B_PLUS_123_TS = "2026-06-01T09:00:00.123000+00:00"
B_PLUS_124_TS = "2026-06-01T09:00:00.124000+00:00"
SECOND_STOP_MS = 1780390800000
HEALTHY_NEWER_TS = "2026-06-03T09:00:00+00:00"
HEALTHY_NEWER_MS = 1780477200000
HEALTHY_LATER_TS = "2026-06-04T09:00:00+00:00"
HEALTHY_LATER_MS = 1780563600000


def _bfill(fill_id: str, timestamp_iso: str, symbol: str) -> dict[str, Any]:
    """A fill dict shaped like `_make_fill_dict` output, for Binance."""
    return {
        "exchange": "binance",
        "symbol": symbol,
        "side": "buy",
        "price": "50000",
        "quantity": "0.1",
        "fee": "0.5",
        "exchange_fill_id": fill_id,
        "is_fill": True,
        "timestamp": timestamp_iso,
    }


_CAP_AT_B: dict[str, Any] = {
    "binance_page_cap_symbols": ["BTCUSDT"],
    "binance_read_through_ms": B_MS,
}
_WARNING_LOGGER = "quantalyze.analytics.job_worker"

# The pinned clock every arm runs under (Phase 253). `_reach_anchor_ms` is this minus
# BINANCE_FILLS_REACH_DAYS (85) days, hand-typed. It must land EARLIER than every May-June
# fixture instant: `tests._binance_fills.NOW_MS` (2026-11-20) would put the reach after them,
# the predicate would stop flagging and every seed would read as clamped.
NOW_253_MS = 1784116800000  # 2026-07-15T12:00:00Z
REACH_253_MS = 1776772800000  # 2026-04-21T12:00:00Z


@pytest.fixture(autouse=True)
def _pinned_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ex, "_now_ms", lambda: NOW_253_MS)


class TestBinanceFillsCursorGate:
    async def test_tracer_a_stopped_read_stamps_the_newest_fill_at_or_before_its_bound(
        self,
    ) -> None:
        # BTCUSDT hit the page cap and its newest read fill is B; ETHUSDT is
        # healthy and returned a fill two days later. The stamp is B, never the
        # healthy symbol's newer fill, so the next run resumes past the cap
        # without skipping BTCUSDT's unread span.
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            raw_fills=[
                _bfill("fill-btc", B_TS, "BTCUSDT"),
                _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
            ],
            fills_flags=dict(_CAP_AT_B),
        )

        assert len(rec.upserted_batches) == 1 and len(rec.upserted_batches[0]) == 2
        assert _the_advance(rec)["p_last_fetched_ts"] == B_TS, (
            "a stopped read must stamp the newest persisted fill at or before "
            "its read-through bound, not the newest fill of every symbol"
        )

    async def test_the_bound_is_inclusive_to_the_millisecond(self) -> None:
        # A fill stamped exactly at B is stampable; one 1 ms later is not. The
        # bound is the UTC epoch plus timedelta(milliseconds=B), never a float
        # division, so no sub-second fill rounds to the wrong side.
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            raw_fills=[
                _bfill("fill-at", B_PLUS_123_TS, "BTCUSDT"),
                _bfill("fill-after", B_PLUS_124_TS, "BTCUSDT"),
                _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
            ],
            fills_flags={
                "binance_page_cap_symbols": ["BTCUSDT"],
                "binance_read_through_ms": B_PLUS_123_MS,
            },
        )

        assert _the_advance(rec)["p_last_fetched_ts"] == B_PLUS_123_TS

    # ---- holds win, nothing stampable, a lost bound ------------------------

    @pytest.mark.parametrize(
        "hold",
        [
            {"binance_partial_symbols": ["ETHUSDT"]},
            {"sync_truncated_okx": True},
        ],
        ids=["partial-symbols", "sync-truncated"],
    )
    async def test_a_hold_beats_a_stop(self, hold: dict[str, Any]) -> None:
        # A transient failure or a truncated read leaves an unread span behind
        # the newest fill, so the cursor holds even when a usable bound would
        # have selected a stampable fill. The control without the hold stamps B,
        # so the hold is the flag's doing and not the fixture's.
        raw_fills = [
            _bfill("fill-btc", B_TS, "BTCUSDT"),
            _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
        ]
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            raw_fills=raw_fills,
            fills_flags={**hold, **_CAP_AT_B},
        )
        assert _the_advance(rec)["p_last_fetched_ts"] is None, (
            "a hold flag must win over a stop's bound"
        )

        control, control_rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        await _run_job(
            supabase=control,
            column=CURSOR_BEHIND_TS,
            raw_fills=raw_fills,
            fills_flags=dict(_CAP_AT_B),
        )
        assert _the_advance(control_rec)["p_last_fetched_ts"] == B_TS

    @pytest.mark.parametrize(
        "raw_fills, flags",
        [
            (
                [
                    _bfill("fill-btc", B_TS, "BTCUSDT"),
                    _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
                ],
                {
                    "binance_page_cap_symbols": ["BTCUSDT"],
                    "binance_read_through_ms": CURSOR_BEHIND_MS,
                },
            ),
            (
                [],
                {
                    "binance_deadline_symbols": ["BTCUSDT"],
                    "binance_read_through_ms": CURSOR_BEHIND_MS,
                },
            ),
        ],
        ids=["every-fill-after-the-bound", "empty-fill-list"],
    )
    async def test_a_stop_with_nothing_stampable_anchors_a_null_column(
        self, raw_fills: list[dict[str, Any]], flags: dict[str, Any]
    ) -> None:
        # The column is NULL and the stopped read stored nothing at or before
        # its bound: without an anchor the next run seeds from the daily
        # high-water, which moves on, and the stopped span is never read again
        # (RESEARCH Pitfall 5, the 232 CR-01 class). Anchor at the read start.
        supabase, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES)
        await _run_job(
            supabase=supabase,
            column=None,
            raw_fills=raw_fills,
            fills_flags=flags,
        )
        assert _the_advance(rec)["p_last_fetched_ts"] == DAILY_NEWEST_DAY_START_ISO

    async def test_a_stop_with_nothing_stampable_leaves_a_set_column(self) -> None:
        # On a set column the cursor is already the resume point: writing
        # nothing keeps it exactly where it was.
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            raw_fills=[
                _bfill("fill-btc", B_TS, "BTCUSDT"),
                _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
            ],
            fills_flags={
                "binance_page_cap_symbols": ["BTCUSDT"],
                "binance_read_through_ms": CURSOR_BEHIND_MS,
            },
        )
        assert _the_advance(rec)["p_last_fetched_ts"] is None

    async def test_sc1_a_stop_below_a_column_set_by_another_strategy_is_reread_by_the_next_run(
        self,
    ) -> None:
        # SC-1, the gap Phase 250 recorded at `_RAW_TRADE_INGESTION_ENABLED` and Phase 253 closes:
        # the column (2026-06-20) is ahead of the strategy's newest stored fill (2026-06-01), as
        # one key backing two strategies makes it. Run 1 stops BTCUSDT at 2026-06-02T09:00Z and
        # stamps the bounded newest persisted fill, but `advance_sync_cursor` only moves the column
        # forward, so the stamp is dropped. Run 2's column is what the RPC left (the same column),
        # its stored fills are what run 1 persisted (a healthy ETHUSDT fill on 2026-06-03), so
        # without a per-strategy bound its seed is that fill and the stopped span is never read.
        # The bound run 1 wrote makes run 2 read from the stop.
        bounds = RereadBounds()
        supabase1, rec1 = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds)
        await _run_job(
            supabase=supabase1,
            column=CURSOR_AHEAD_TS,
            exchange="binance",
            raw_fills=[
                _bfill("fill-btc", "2026-06-02T09:00:00+00:00", "BTCUSDT"),
                _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
            ],
            fills_flags={
                "binance_page_cap_symbols": ["BTCUSDT"],
                "binance_read_through_ms": SECOND_STOP_MS,
            },
        )
        stamp = _the_advance(rec1)["p_last_fetched_ts"]
        assert stamp == "2026-06-02T09:00:00+00:00"
        assert column_after_advance(CURSOR_AHEAD_TS, stamp) == CURSOR_AHEAD_TS, (
            "the premise: the forward-only RPC drops the stamp, the column stays ahead"
        )
        # Two writes: the provisional one BEFORE the read (round-2 CR-02/CR-03: the seed, here the
        # newest stored fill 2026-06-01T09:00Z, covers NULL so it never advances) and the epilogue
        # one with the run's real covers and the stop (it advances the row, RPC R4).
        assert len(bounds.calls) == 2
        assert bounds.calls[0]["p_covers_from"] is None
        assert [c["p_unread_from"] for c in bounds.calls] == [
            "2026-06-01T09:00:00+00:00",
            "2026-06-02T09:00:00+00:00",
        ]

        persisted = [
            {"strategy_id": STRATEGY_ID, "is_fill": True, "timestamp": row["timestamp"]}
            for batch in rec1.upserted_batches
            for row in batch
        ]
        assert len(persisted) == 2
        supabase2, _rec2 = _make_supabase(
            trades_rows=DEFAULT_TRADES + persisted, bounds=bounds
        )
        out2 = await _run_job(
            supabase=supabase2,
            column=column_after_advance(CURSOR_AHEAD_TS, stamp),
            exchange="binance",
        )
        assert out2.fetch_raw.call_args.kwargs["since_ms"] == SECOND_STOP_MS, (
            "run 2 must read from the stopped symbol's bound; the pre-fix seed is the newest "
            f"stored fill ({HEALTHY_NEWER_MS})"
        )

    async def test_an_okx_run_makes_one_bound_read_and_two_bound_writes(self) -> None:
        # Phase 255 NULLANCHOR (intent change, 2026-11-27): the bound now covers OKX, Bybit and
        # Deribit, superseding Phase 253 D-04's "Binance-only". An OKX key's run, even one that
        # records a stop, reads the bound once and writes it twice (the provisional row and the
        # epilogue write), and `advance_sync_cursor` is called as before.
        bounds = RereadBounds()
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds)
        await _run_job(
            supabase=supabase,
            column=CURSOR_AHEAD_TS,
            raw_fills=[_bfill("fill-btc", "2026-06-02T09:00:00+00:00", "BTCUSDT")],
            fills_flags={
                "binance_page_cap_symbols": ["BTCUSDT"],
                "binance_read_through_ms": SECOND_STOP_MS,
            },
        )
        assert bounds.reads == 1
        assert len(bounds.calls) == 2
        assert _the_advance(rec)["p_last_fetched_ts"] == "2026-06-02T09:00:00+00:00"

    async def test_a_stop_below_a_column_set_by_another_strategy_is_flagged_and_warned(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # Round-2 review WR-01, the likeliest entry into the gap: the first sync of a second
        # strategy on a key shared with another strategy. The column (2026-06-20) was set by the
        # other strategy; this strategy has no stored fill and no daily row, so the read has no
        # seed and walks from the reach. It stops at 2026-06-02T09:00Z. The forward-only
        # `advance_sync_cursor` drops the stamp, so the run must NAME the span (the
        # `binance_stop_below_cursor` flag on `strategy_analytics`, one WARNING naming the
        # strategy, the column and the instant) AND, since Phase 253, record it as this
        # strategy's re-read bound so the next run reads it.
        bounds = RereadBounds()
        supabase, rec = _make_supabase(trades_rows=[], bounds=bounds)
        with caplog.at_level(logging.WARNING, logger=_WARNING_LOGGER):
            await _run_job(
                supabase=supabase,
                column=CURSOR_AHEAD_TS,
                exchange="binance",
                raw_fills=[
                    _bfill("fill-btc", B_TS, "BTCUSDT"),
                    _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
                ],
                fills_flags={
                    "binance_page_cap_symbols": ["BTCUSDT"],
                    "binance_read_through_ms": SECOND_STOP_MS,
                },
            )
        assert _the_advance(rec)["p_last_fetched_ts"] == B_TS
        assert rec.analytics_upserts[-1]["data_quality_flags"]["binance_stop_below_cursor"] is True
        warnings = [
            r.getMessage()
            for r in caplog.records
            if r.levelno == logging.WARNING and "binance_stop_below_cursor" in r.getMessage()
        ]
        assert len(warnings) == 1, f"expected one WARNING, got {warnings}"
        assert STRATEGY_ID in warnings[0]
        assert CURSOR_AHEAD_TS in warnings[0]
        assert str(SECOND_STOP_MS) in warnings[0]
        assert "strategy_fills_reread_bounds" in warnings[0]
        assert bounds.rows[STRATEGY_ID] == ("key-1", "2026-06-02T09:00:00+00:00")

    async def test_stop_plus_partial_is_flagged_by_name_and_bounds_the_walk_start(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # Round-3 WR-01 probe shape: ADAUSDT stopped at 2026-06-21 (ABOVE the column
        # 2026-06-20) while BTCUSDT failed. The failed symbol is complete through nothing the
        # run read, so the run's earliest complete-through instant is the walk start minus
        # 1 ms (no seed: the reach), not the stop bound. The pre-253 predicate looked only at
        # the stop and stayed silent.
        bounds = RereadBounds()
        supabase, rec = _make_supabase(trades_rows=[], bounds=bounds)
        with caplog.at_level(logging.WARNING, logger=_WARNING_LOGGER):
            await _run_job(
                supabase=supabase,
                column="2026-06-20T00:00:00+00:00",
                exchange="binance",
                raw_fills=[],
                fills_flags={
                    "binance_partial_symbols": ["BTCUSDT"],
                    "binance_deadline_symbols": ["ADAUSDT"],
                    "binance_read_through_ms": 1782000000000,  # 2026-06-21T00:00:00Z
                },
            )
        assert rec.analytics_upserts[-1]["data_quality_flags"]["binance_stop_below_cursor"] is True
        warnings = [
            r.getMessage()
            for r in caplog.records
            if r.levelno == logging.WARNING and "binance_stop_below_cursor" in r.getMessage()
        ]
        assert len(warnings) == 1, f"expected one WARNING, got {warnings}"
        assert STRATEGY_ID in warnings[0]
        assert "2026-06-20T00:00:00+00:00" in warnings[0]
        assert str(REACH_253_MS - 1) in warnings[0]
        assert [c["p_unread_from"] for c in bounds.calls] == [
            "2026-04-21T12:00:00+00:00",
            "2026-04-21T11:59:59.999000+00:00",
        ], "the provisional write names the reach (no seed); the epilogue names the walk start minus 1 ms"

    async def test_a_partial_only_read_from_the_reach_is_flagged_and_bounded(self) -> None:
        # No seed (no stored rows), column ahead, ETHUSDT failed, BTCUSDT healthy: the walk
        # began at the reach, so the failed symbol's unread span starts there. The pre-253
        # predicate called that "the reach" and carried None; the bound needs a number.
        bounds = RereadBounds()
        supabase, rec = _make_supabase(trades_rows=[], bounds=bounds)
        await _run_job(
            supabase=supabase,
            column=CURSOR_AHEAD_TS,
            exchange="binance",
            raw_fills=[_bfill("fill-btc", HEALTHY_NEWER_TS, "BTCUSDT")],
            fills_flags={"binance_partial_symbols": ["ETHUSDT"]},
        )
        assert rec.analytics_upserts[-1]["data_quality_flags"]["binance_stop_below_cursor"] is True
        assert bounds.calls[-1]["p_unread_from"] == "2026-04-21T11:59:59.999000+00:00"
        assert bounds.calls[-1]["p_covers_from"] == "-infinity"

    async def test_a_raised_binance_read_on_a_column_ahead_is_flagged_and_bounded(self) -> None:
        # D-07: a raised read leaves the whole walk unread. The column (2026-06-20) is ahead of
        # the newest stored fill (2026-06-01T09:00Z), seed = that fill, walk start = 08:00, so
        # the run is complete through 07:59:59.999 and the stored fills do not cover it.
        bounds = RereadBounds()
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds)
        await _run_job(
            supabase=supabase,
            column=CURSOR_AHEAD_TS,
            exchange="binance",
            raw_error=RuntimeError("venue refused the fills read"),
        )
        flags = rec.analytics_upserts[-1]["data_quality_flags"]
        assert flags["binance_stop_below_cursor"] is True
        assert flags["phase2_fill_ingestion_failed"] is True
        assert [c["p_unread_from"] for c in bounds.calls] == [
            "2026-06-01T09:00:00+00:00",  # the provisional write: the seed
            "2026-06-01T07:59:59.999000+00:00",  # the epilogue: the walk start minus 1 ms
        ]

    async def test_a_raised_okx_read_never_sets_a_binance_flag(self) -> None:
        # D-07: the flag is Binance's. The same raised read on an OKX key sets
        # phase2_fill_ingestion_failed and nothing named binance_*. Phase 255 NULLANCHOR (intent
        # change, 2026-11-27): the bound itself now covers OKX, so the run also reads it once and
        # writes it twice, superseding Phase 253 D-04's "Binance-only".
        bounds = RereadBounds()
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds)
        await _run_job(
            supabase=supabase,
            column=CURSOR_AHEAD_TS,
            raw_error=RuntimeError("venue refused the fills read"),
        )
        flags = rec.analytics_upserts[-1]["data_quality_flags"]
        assert flags["phase2_fill_ingestion_failed"] is True
        assert not [k for k in flags if k.startswith("binance_")]
        assert bounds.reads == 1
        assert len(bounds.calls) == 2

    @pytest.mark.parametrize(
        "bound_ms, flagged",
        [
            (1780302600000, False),  # 2026-06-01T08:30:00Z, inside [C - 1 h, C)
            (1780300799999, False),  # 07:59:59.999, one ms under C - 1 h: +1 == column - overlap
            (1780300799998, True),  # 07:59:59.998, the first instant that is below the overlap
        ],
        ids=["inside-the-overlap-hour", "edge-minus-1ms", "below-the-overlap-edge"],
    )
    async def test_the_overlap_hour_below_the_newest_stored_fill_is_not_flagged(
        self, bound_ms: int, flagged: bool
    ) -> None:
        # Round-3 WR-04: the column equals the newest stored fill C (2026-06-01T09:00Z), so the
        # next seed is C and the walk starts at C - 1 h anyway. A stop whose bound sits inside
        # [C - 1 h, C) is re-read by the overlap alone and must NOT be flagged; the predicate
        # compares the earliest complete-through instant with the column minus the overlap.
        # The last id is the control: one ms lower the same stop is flagged.
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        await _run_job(
            supabase=supabase,
            column=B_TS,
            exchange="binance",
            raw_fills=[],
            fills_flags={
                "binance_deadline_symbols": ["BTCUSDT"],
                "binance_read_through_ms": bound_ms,
            },
        )
        flags = rec.analytics_upserts[-1]["data_quality_flags"]
        assert ("binance_stop_below_cursor" in flags) is flagged

    async def test_a_failed_bound_write_on_an_incomplete_read_is_loud_and_holds_the_stamp(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # D-05 / T-253-07: a lost write of a real unread span. ERROR names the strategy and the
        # exception class and the flag is raised. Round-1 CR-01 / round-2: the run neither reads
        # nor persists fills when its PROVISIONAL bound write (before the read) fails (the stored
        # high-water would move past a span no bound names), and no stamp is written on a set
        # column. Two ERRORs: the provisional write's, and the epilogue write's (the RPC is down
        # for both). The outcome (the next run re-reads the span) is pinned by
        # TestFailedBoundWriteStillRereadsTheSpan.
        bounds = RereadBounds()
        bounds.rpc_error = RuntimeError("rpc down")
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds)
        with caplog.at_level(logging.ERROR, logger=_WARNING_LOGGER):
            out = await _run_job(
                supabase=supabase,
                column=CURSOR_AHEAD_TS,
                exchange="binance",
                raw_fills=[
                    _bfill("fill-btc", "2026-06-02T09:00:00+00:00", "BTCUSDT"),
                    _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
                ],
                fills_flags={
                    "binance_page_cap_symbols": ["BTCUSDT"],
                    "binance_read_through_ms": SECOND_STOP_MS,
                },
            )
        errors = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
        assert len(errors) == 2, f"expected two ERRORs (provisional, epilogue), got {errors}"
        for message in errors:
            assert STRATEGY_ID in message and "RuntimeError" in message
        assert "before the read" in errors[0]
        assert rec.analytics_upserts[-1]["data_quality_flags"]["binance_stop_below_cursor"] is True
        assert rec.analytics_upserts[-1]["data_quality_flags"]["phase2_fill_ingestion_failed"] is True
        assert _the_advance(rec)["p_last_fetched_ts"] is None
        assert out.fetch_raw.call_count == 0, "an unrecorded span is never read"
        assert rec.upserted_batches == [], "an unrecorded stop persists none of its fills"

    async def test_an_orphan_bound_write_is_logged_and_the_cursor_rpc_still_runs(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # T-253-06 / round-2 SFH-R2-M2, IN-11: the RPC answers FALSE for a reclaimed (orphan)
        # claim token. Logged under the same greppable prefix as `advance_sync_cursor`'s fence,
        # once (the epilogue write is not attempted). No fill is read or stored (the unfenced
        # `trades` upsert would still move the stored high-water), the run is NOT a failed
        # Phase 2 (no `phase2_*` stamp), and the cursor RPC still runs, as the epilogue's does.
        bounds = RereadBounds()
        bounds.owned = False
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds)
        with caplog.at_level(logging.WARNING, logger=_WARNING_LOGGER):
            out = await _run_job(
                supabase=supabase,
                column=CURSOR_AHEAD_TS,
                exchange="binance",
                raw_fills=[_bfill("fill-btc", "2026-06-02T09:00:00+00:00", "BTCUSDT")],
                fills_flags={
                    "binance_page_cap_symbols": ["BTCUSDT"],
                    "binance_read_through_ms": SECOND_STOP_MS,
                },
            )
        orphan = [
            r.getMessage()
            for r in caplog.records
            if r.getMessage().startswith(
                "worker_orphan_write_blocked: set_strategy_fills_reread_bound"
            )
        ]
        assert len(orphan) == 1, f"expected one orphan WARNING, got {orphan}"
        assert bounds.rows == {}
        assert len(bounds.calls) == 1, "the epilogue write is not attempted by an orphaned run"
        assert out.fetch_raw.call_count == 0 and rec.upserted_batches == []
        assert not any(
            "phase2_fill_ingestion_failed" in u["data_quality_flags"]
            for u in rec.analytics_upserts
        ), "an orphaned run stamps no Phase 2 outcome either way"
        assert _the_advance(rec)["p_last_fetched_ts"] is None

    async def test_a_stop_at_or_above_the_column_is_not_flagged(self) -> None:
        # The control: with the column below the stop's bound the next seed is the column, which
        # is below the unread span, so the span is re-read and nothing is skipped. The flag fires
        # only when the column is ahead of where the unread span starts.
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            exchange="binance",
            raw_fills=[
                _bfill("fill-btc", B_TS, "BTCUSDT"),
                _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
            ],
            fills_flags={
                "binance_page_cap_symbols": ["BTCUSDT"],
                "binance_read_through_ms": B_MS,
            },
        )
        flags = (
            rec.analytics_upserts[-1]["data_quality_flags"] if rec.analytics_upserts else {}
        )
        assert "binance_stop_below_cursor" not in flags

    async def test_two_stopped_symbols_stamp_at_or_before_the_smaller_bound(
        self,
    ) -> None:
        # The producer delivers the minimum over stopped symbols: BTCUSDT capped
        # at B, ETHUSDT stopped at 2026-06-02T09:00Z, SOLUSDT healthy. The stamp
        # is B: neither stopped symbol's unread span is skipped.
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            raw_fills=[
                _bfill("fill-btc", B_TS, "BTCUSDT"),
                _bfill("fill-eth", "2026-06-02T09:00:00+00:00", "ETHUSDT"),
                _bfill("fill-sol-1", HEALTHY_NEWER_TS, "SOLUSDT"),
                _bfill("fill-sol-2", HEALTHY_LATER_TS, "SOLUSDT"),
            ],
            fills_flags={
                "binance_page_cap_symbols": ["BTCUSDT"],
                "binance_untimed_page_symbols": ["ETHUSDT"],
                "binance_read_through_ms": min(B_MS, SECOND_STOP_MS),
            },
        )
        assert _the_advance(rec)["p_last_fetched_ts"] == B_TS

    @pytest.mark.parametrize(
        "flags, bad_type",
        [
            ({"binance_page_cap_symbols": ["BTCUSDT"]}, None),
            ({"binance_untimed_page_symbols": ["BTCUSDT"]}, None),
            ({"binance_deadline_symbols": ["BTCUSDT"]}, None),
            (
                {"binance_page_cap_symbols": ["BTCUSDT"], "binance_read_through_ms": True},
                "bool",
            ),
            (
                {
                    "binance_page_cap_symbols": ["BTCUSDT"],
                    "binance_read_through_ms": "1780304400000",
                },
                "str",
            ),
            (
                {"binance_page_cap_symbols": ["BTCUSDT"], "binance_read_through_ms": -1},
                "int",
            ),
        ],
        ids=[
            "cap-list-alone",
            "untimed-list-alone",
            "deadline-list-alone",
            "bound-is-bool",
            "bound-is-str",
            "bound-is-negative",
        ],
    )
    async def test_a_stop_record_without_a_usable_bound_holds(
        self,
        flags: dict[str, Any],
        bad_type: str | None,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        # `_record_dq_flag` swallows its own exceptions, so a stop list whose
        # bound was lost must read as an incomplete read, never as "no stop":
        # stamping the newest fill would pass the stopped symbol's unread span.
        raw_fills = [
            _bfill("fill-btc", B_TS, "BTCUSDT"),
            _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
        ]
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        with caplog.at_level(logging.WARNING, logger=_WARNING_LOGGER):
            await _run_job(
                supabase=supabase,
                column=CURSOR_BEHIND_TS,
                raw_fills=raw_fills,
                fills_flags=dict(flags),
            )
        assert _the_advance(rec)["p_last_fetched_ts"] is None, (
            "a stop record without a usable bound must hold the fills cursor"
        )
        warnings = [
            r.getMessage()
            for r in caplog.records
            if r.levelno == logging.WARNING and STRATEGY_ID in r.getMessage()
            and "read-through bound" in r.getMessage()
        ]
        assert len(warnings) == 1, f"expected one WARNING, got {warnings}"
        expected_type = bad_type if bad_type is not None else "NoneType"
        assert expected_type in warnings[0]

    async def test_a_stop_record_without_a_usable_bound_anchors_a_null_column(
        self,
    ) -> None:
        # A NULL column plus a lost bound: holding protects nothing, so the
        # column is anchored at the read start (the daily seed) like any hold.
        supabase, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES)
        await _run_job(
            supabase=supabase,
            column=None,
            raw_fills=[
                _bfill("fill-btc", B_TS, "BTCUSDT"),
                _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
            ],
            fills_flags={"binance_page_cap_symbols": ["BTCUSDT"]},
        )
        assert _the_advance(rec)["p_last_fetched_ts"] == DAILY_NEWEST_DAY_START_ISO

    # ---- SC-2: unlisted and clamp never hold; a transient failure does -----

    @pytest.mark.parametrize(
        "flags",
        [
            {"binance_unlisted_symbols": ["DOGEUSDT"]},
            {"binance_fills_reach_clamped": True},
        ],
        ids=["unlisted-symbols", "reach-clamped"],
    )
    async def test_a_non_holding_flag_alone_stamps_the_newest_fill(
        self, flags: dict[str, Any]
    ) -> None:
        # SC-2: a venue-unlisted symbol raises ccxt.BadSymbol on EVERY run, so
        # holding on it would freeze the cursor of every healthy symbol for
        # good. The reach clamp only says the walk started at the venue's
        # reach. Neither leaves an unread span behind the newest fill.
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            raw_fills=[
                _bfill("fill-btc", B_TS, "BTCUSDT"),
                _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
            ],
            fills_flags=dict(flags),
        )
        assert _the_advance(rec)["p_last_fetched_ts"] == HEALTHY_NEWER_TS

    async def test_a_transiently_failed_symbol_holds_then_is_reread_clean(
        self,
    ) -> None:
        # SC-2 refuse-then-clean (the 232 shape with Binance symbols): ETHUSDT
        # failed with anything other than BadSymbol, BTCUSDT's fill came back.
        # Run 1 holds, so run 2 re-reads from the held cursor and covers the
        # span ETHUSDT never returned; the clean run stamps, so run 1's hold was
        # the flag's doing.
        shared_flags: dict[str, Any] = {}

        supabase1, rec1 = _make_supabase(
            trades_rows=DEFAULT_TRADES, flags=shared_flags
        )
        out1 = await _run_job(
            supabase=supabase1,
            column=CURSOR_BEHIND_TS,
            raw_fills=[_bfill("fill-btc", B_TS, "BTCUSDT")],
            fills_flags={"binance_partial_symbols": ["ETHUSDT"]},
        )
        stamped = _the_advance(rec1)["p_last_fetched_ts"]
        assert stamped is None, "a partial-symbol read must hold the cursor"

        supabase2, rec2 = _make_supabase(
            trades_rows=DEFAULT_TRADES, flags=shared_flags
        )
        out2 = await _run_job(
            supabase=supabase2,
            column=stamped or CURSOR_BEHIND_TS,
            raw_fills=[_bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT")],
        )

        assert out1.fetch_raw.call_args.kwargs["since_ms"] == CURSOR_BEHIND_MS
        assert out2.fetch_raw.call_args.kwargs["since_ms"] == CURSOR_BEHIND_MS, (
            "the clean run must re-read from the held cursor"
        )
        assert _the_advance(rec2)["p_last_fetched_ts"] == HEALTHY_NEWER_TS


# ---- Phase 253 plan 02 task 3: the interleave, D-03, the stall, the mirror, D-04 ------------

STRAT_A = "strat-253-a"
STRAT_B = "strat-253-b"
KEY_1 = "key-1"
L_TS = "2026-06-03T09:00:00+00:00"  # the shared case table's L; epoch ms HEALTHY_NEWER_MS


def _persisted_fills(rec: Any, strategy_id: str) -> list[dict[str, Any]]:
    """The `trades` rows a run's fills upsert wrote, as stored rows of `strategy_id`, so a
    second run's fake holds what the first run actually persisted."""
    return [
        {"strategy_id": strategy_id, "is_fill": True, "timestamp": row["timestamp"]}
        for batch in rec.upserted_batches
        for row in batch
    ]


def _ms(iso: str) -> int:
    from datetime import datetime

    return int(datetime.fromisoformat(iso).timestamp() * 1000)


class TestRereadBoundAcrossRuns:
    async def test_d02_three_step_interleave_b_rereads_from_its_bound_after_a_advances_the_column(
        self,
    ) -> None:
        # D-02 (locked), through the REAL job and one shared store and one shared column.
        # Step 1: strategy B stops below a column (2026-06-20) set by someone else. Step 2: a
        # DIFFERENT strategy A on the same key syncs cleanly and advances the column to
        # 2026-06-25; A never touches B's row. Step 3: B runs again against the moved column
        # and reads from its own bound; it completes and its row is cleared (case C5).
        bounds = RereadBounds()
        column: str | None = CURSOR_AHEAD_TS

        sb1, rec_b1 = _make_supabase(trades_rows=[], bounds=bounds)
        await _run_job(
            supabase=sb1,
            column=column,
            exchange="binance",
            strategy_id=STRAT_B,
            raw_fills=[
                _bfill("b-btc", "2026-06-02T09:00:00+00:00", "BTCUSDT"),
                _bfill("b-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
            ],
            fills_flags={
                "binance_page_cap_symbols": ["BTCUSDT"],
                "binance_read_through_ms": SECOND_STOP_MS,
            },
        )
        column = column_after_advance(column, _the_advance(rec_b1)["p_last_fetched_ts"])
        assert column == CURSOR_AHEAD_TS
        assert bounds.rows == {STRAT_B: (KEY_1, "2026-06-02T09:00:00+00:00")}

        sb_a, rec_a = _make_supabase(
            trades_rows=[
                {"strategy_id": STRAT_A, "is_fill": True, "timestamp": CURSOR_AHEAD_TS}
            ],
            bounds=bounds,
        )
        await _run_job(
            supabase=sb_a,
            column=column,
            exchange="binance",
            strategy_id=STRAT_A,
            raw_fills=[_bfill("a-btc", "2026-06-25T00:00:00+00:00", "BTCUSDT")],
        )
        column = column_after_advance(column, _the_advance(rec_a)["p_last_fetched_ts"])
        assert column == "2026-06-25T00:00:00+00:00", "A's clean read advances the shared column"
        assert bounds.rows == {STRAT_B: (KEY_1, "2026-06-02T09:00:00+00:00")}, (
            "A's run must never change B's row"
        )

        sb_b2, rec_b2 = _make_supabase(
            trades_rows=_persisted_fills(rec_b1, STRAT_B), bounds=bounds
        )
        out_b2 = await _run_job(
            supabase=sb_b2, column=column, exchange="binance", strategy_id=STRAT_B
        )
        assert out_b2.fetch_raw.call_args.kwargs["since_ms"] == SECOND_STOP_MS, (
            "B reads from its bound although the column moved past it and B's stored fills "
            f"end at {HEALTHY_NEWER_MS}"
        )
        assert STRAT_B not in bounds.rows, "B's complete read covered its bound and cleared it"

    async def test_sc1_a_failed_symbol_on_a_column_ahead_is_reread_from_the_reach(self) -> None:
        # SC-1 failed-symbol variant: no seed, column ahead, ETHUSDT failed, BTCUSDT healthy. Run
        # 1's bound is the reach minus 1 ms with `-infinity` coverage. Run 2's stored fills end
        # at the healthy fill (2026-06-03), so without the bound it seeds there; with it, at the
        # reach minus 1 ms exactly. Run 2 is clean, and a walk from the reach covers every bound,
        # so the row is cleared.
        bounds = RereadBounds()
        sb1, rec1 = _make_supabase(trades_rows=[], bounds=bounds)
        await _run_job(
            supabase=sb1,
            column=CURSOR_AHEAD_TS,
            exchange="binance",
            raw_fills=[_bfill("fill-btc", HEALTHY_NEWER_TS, "BTCUSDT")],
            fills_flags={"binance_partial_symbols": ["ETHUSDT"]},
        )
        assert bounds.calls[-1]["p_unread_from"] == "2026-04-21T11:59:59.999000+00:00"
        assert bounds.calls[-1]["p_covers_from"] == "-infinity"
        assert _the_advance(rec1)["p_last_fetched_ts"] is None

        sb2, _rec2 = _make_supabase(
            trades_rows=_persisted_fills(rec1, STRATEGY_ID), bounds=bounds
        )
        out2 = await _run_job(supabase=sb2, column=CURSOR_AHEAD_TS, exchange="binance")
        assert out2.fetch_raw.call_args.kwargs["since_ms"] == REACH_253_MS - 1, (
            f"pre-fix this is {HEALTHY_NEWER_MS}, the healthy symbol's fill"
        )
        assert STRATEGY_ID not in bounds.rows

    async def test_a_failed_bound_read_adds_no_term_and_the_rpc_keeps_the_stored_bound(
        self,
    ) -> None:
        # A2 (RESEARCH): when the bound READ fails the run has no bound term (never a
        # full-reach walk). It must not CLEAR a bound it could not read, so its covers_from is
        # the real walk start (2026-06-09T23:00Z, above the stored bound), never `-infinity`:
        # the RPC then keeps the stored row (case C6) and the first run whose read succeeds
        # re-reads it.
        bounds = RereadBounds({STRATEGY_ID: (KEY_1, "2026-06-02T09:00:00+00:00")})
        bounds.read_error = RuntimeError("relation does not exist")
        supabase, _rec = _make_supabase(
            trades_rows=[
                {"strategy_id": STRATEGY_ID, "is_fill": True, "timestamp": "2026-06-10T00:00:00+00:00"}
            ],
            bounds=bounds,
        )
        out = await _run_job(supabase=supabase, column=CURSOR_AHEAD_TS, exchange="binance")
        assert out.fetch_raw.call_args.kwargs["since_ms"] == _ms("2026-06-10T00:00:00+00:00")
        # The provisional write (the seed, covers NULL: RPC R5 LEAST keeps the stored 2026-06-02
        # row) and then the epilogue write (a complete read, covers the real walk start).
        assert bounds.calls[0]["p_covers_from"] is None
        assert bounds.calls[-1]["p_unread_from"] is None
        assert bounds.calls[-1]["p_covers_from"] == "2026-06-09T23:00:00+00:00"
        assert bounds.rows == {STRATEGY_ID: (KEY_1, "2026-06-02T09:00:00+00:00")}

    async def test_a_covered_repeated_stop_moves_the_bound_forward_and_the_next_run_seeds_there(
        self,
    ) -> None:
        # The stall (D-05): stored bound B, a run seeded at B stops again at L. It covered B
        # (its walk started at B minus 1 h), so the bound moves forward to L (case C4) instead
        # of staying at B for ever, and a third run seeds at L. The stored fill at 2026-06-10 is
        # later than both, so every seed here is the bound's doing.
        bounds = RereadBounds({STRATEGY_ID: (KEY_1, "2026-06-02T09:00:00+00:00")})
        stored = [
            {"strategy_id": STRATEGY_ID, "is_fill": True, "timestamp": "2026-06-10T00:00:00+00:00"}
        ]
        sb1, _r1 = _make_supabase(trades_rows=stored, bounds=bounds)
        out1 = await _run_job(
            supabase=sb1,
            column=CURSOR_AHEAD_TS,
            exchange="binance",
            fills_flags={
                "binance_deadline_symbols": ["BTCUSDT"],
                "binance_read_through_ms": HEALTHY_NEWER_MS,
            },
        )
        assert out1.fetch_raw.call_args.kwargs["since_ms"] == SECOND_STOP_MS
        assert bounds.rows == {STRATEGY_ID: (KEY_1, L_TS)}, "the covered stop advanced B to L"

        sb2, _r2 = _make_supabase(trades_rows=stored, bounds=bounds)
        out2 = await _run_job(supabase=sb2, column=CURSOR_AHEAD_TS, exchange="binance")
        assert out2.fetch_raw.call_args.kwargs["since_ms"] == HEALTHY_NEWER_MS

    @pytest.mark.parametrize(
        "flags, raw_error, ceilings_ms, stop_ms",
        [
            (
                {
                    "binance_page_cap_symbols": ["BTCUSDT"],
                    "binance_read_through_ms": SECOND_STOP_MS,
                },
                None,
                [SECOND_STOP_MS],
                SECOND_STOP_MS,
            ),
            (
                {
                    "binance_partial_symbols": ["BTCUSDT"],
                    "binance_deadline_symbols": ["ADAUSDT"],
                    "binance_read_through_ms": 1782000000000,  # 2026-06-21T00:00:00Z
                },
                None,
                [1782000000000, 1780304400000 - 3_600_000 - 1],
                1782000000000,
            ),
            (
                {},
                RuntimeError("venue refused the fills read"),
                [1780304400000 - 3_600_000 - 1],
                None,
            ),
        ],
        ids=["stop", "stop-plus-partial", "raised"],
    )
    async def test_d03_the_bound_sent_is_never_later_than_a_complete_through_instant(
        self,
        flags: dict[str, Any],
        raw_error: Exception | None,
        ceilings_ms: list[int],
        stop_ms: int | None,
    ) -> None:
        # D-03. Every instant a run is complete through is a CEILING for the bound it sends: the
        # stop bound of a stopped symbol, and the walk start minus 1 ms (the seed
        # 2026-06-01T09:00Z minus the 1 h overlap minus 1 ms) for a failed symbol or a raised
        # read. The bound sent is at or before ALL of them, and the column stamp, when one is
        # written, never passes the stop bound.
        bounds = RereadBounds()
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds)
        await _run_job(
            supabase=supabase,
            column=CURSOR_AHEAD_TS,
            exchange="binance",
            raw_fills=[
                _bfill("fill-btc", "2026-06-02T09:00:00+00:00", "BTCUSDT"),
                _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
            ],
            raw_error=raw_error,
            fills_flags=dict(flags) if flags else None,
        )
        assert len(bounds.calls) == 2
        # The provisional write (before the read) is the SEED, covers NULL: the next run's walk
        # start (seed minus the overlap) equals this run's walk start, so every instant a stop or
        # a failed symbol leaves unread is re-read. The epilogue write is the one a ceiling binds.
        provisional, epilogue = bounds.calls
        assert provisional["p_unread_from"] == FILL_STORED_TS
        assert provisional["p_covers_from"] is None
        sent = epilogue["p_unread_from"]
        assert sent is not None
        assert _ms(sent) <= min(ceilings_ms)
        stamp = _the_advance(rec)["p_last_fetched_ts"]
        if stamp is not None and stop_ms is not None:
            assert _ms(stamp) <= stop_ms

    async def test_d04_a_stop_run_calls_advance_sync_cursor_with_the_same_params_on_every_venue(
        self,
    ) -> None:
        # D-04: `advance_sync_cursor` is called exactly as before this phase: the same six keys,
        # no bound term, whatever the venue. Phase 255 NULLANCHOR (intent change, 2026-11-27): an
        # OKX key now makes one bound read and two bound writes like Binance, superseding Phase 253
        # D-04's "Binance-only".
        # (The values of `p_last_fetched_ts` are pinned by the Phase 250 arms above, which run
        # unchanged.)
        expected_keys = {
            "p_api_key_id",
            "p_job_id",
            "p_claim_token",
            "p_last_fetched_ts",
            "p_last_sync_at",
            "p_account_balance",
        }
        stop = {
            "binance_page_cap_symbols": ["BTCUSDT"],
            "binance_read_through_ms": SECOND_STOP_MS,
        }
        for exchange in ("okx", "binance"):
            bounds = RereadBounds()
            supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds)
            await _run_job(
                supabase=supabase,
                column=CURSOR_AHEAD_TS,
                exchange=exchange,
                raw_fills=[_bfill("fill-btc", "2026-06-02T09:00:00+00:00", "BTCUSDT")],
                fills_flags=dict(stop),
            )
            params = _the_advance(rec)
            assert set(params) == expected_keys
            assert params["p_last_fetched_ts"] == "2026-06-02T09:00:00+00:00"
            assert len(bounds.calls) == 2


# THE SHARED CASE TABLE of 253-01-PLAN.md and 253-02-PLAN.md, hand-typed (never read from the
# plan or the SQL): the same eleven cases `supabase/tests/test_strategy_fills_reread_bound.sql`
# proves on a real PostgreSQL. E, B, L are 09:00 UTC on 2026-06-01, -02 and -03; CV (covers B)
# is 2026-06-02 08:00 and NC (does not cover B) 2026-06-02 10:00. `-infinity` is the walk that
# started at the venue reach.
_E = "2026-06-01T09:00:00+00:00"
_B = "2026-06-02T09:00:00+00:00"
_L = "2026-06-03T09:00:00+00:00"
_CV = "2026-06-02T08:00:00+00:00"
_NC = "2026-06-02T10:00:00+00:00"
_K1 = "key-1"
_K2 = "key-2"
_CASE_TABLE = [
    ("C0", None, _K1, None, "-infinity", None),
    ("C1", None, _K1, _B, "-infinity", (_K1, _B)),
    ("C2", (_K1, _B), _K1, _L, _NC, (_K1, _B)),
    ("C3", (_K1, _B), _K1, _E, _NC, (_K1, _E)),
    ("C4", (_K1, _B), _K1, _L, _CV, (_K1, _L)),
    ("C5", (_K1, _B), _K1, None, _CV, None),
    ("C6", (_K1, _B), _K1, None, _NC, (_K1, _B)),
    ("C7", (_K1, _B), _K1, None, "-infinity", None),
    ("C8", (_K1, _B), _K2, _L, _NC, (_K2, _L)),
    ("C9", (_K1, _B), _K2, None, _NC, None),
    ("C10", (_K1, _B), _K1, None, _B, None),
]


@pytest.mark.parametrize(
    "before, key, unread_from, covers_from, after",
    [case[1:] for case in _CASE_TABLE],
    ids=[case[0] for case in _CASE_TABLE],
)
def test_the_mirror_matches_the_sql_case_table(
    before: tuple[str, str] | None,
    key: str,
    unread_from: str | None,
    covers_from: str | None,
    after: tuple[str, str] | None,
) -> None:
    # The stateful fake of every two-run arm above answers through `bound_after_set`; if it
    # drifted from the SQL, those arms would pass against a store that does not exist. This is
    # the Python half of the cross-check the SQL gate's arms C0 to C10 are the other half of.
    assert (
        bound_after_set(before, api_key_id=key, unread_from=unread_from, covers_from=covers_from)
        == after
    )


# ---- Phase 253 plan 04 (D-09): the next clean Binance sync clears the sync-time keys --------
#
# NEUTER, Phase 253 plan 04 (PROOF-01; recorded verbatim in the 253-04 SUMMARY):
#   F3  delete the `elif` that sets write_needed when the clear popped something:
#       test_a_clean_binance_sync_removes_the_keys_run_one_wrote_and_still_writes_the_row goes RED.
#   F4  drop `not phase2_failed` from the clear guard:
#       test_a_raised_binance_read_keeps_the_keys_run_one_wrote goes RED.
#   F8  drop `_binance_read` from the clear guard:
#       test_an_okx_sync_keeps_the_binance_keys goes RED.

_RUN_ONE_FLAGS: dict[str, Any] = {
    "binance_deadline_symbols": ["BTCUSDT"],
    "binance_read_through_ms": B_MS,
}
_ALL_NINE: dict[str, Any] = {
    "binance_fills_reach_clamped": True,
    "binance_fill_cursor_advance_plus1": True,
    "binance_stop_below_cursor": True,
    "binance_partial_symbols": ["BTCUSDT"],
    "binance_unlisted_symbols": ["XYZUSDT"],
    "binance_page_cap_symbols": ["BTCUSDT"],
    "binance_untimed_page_symbols": ["SOLUSDT"],
    "binance_deadline_symbols": ["BTCUSDT"],
    "binance_read_through_ms": B_MS,
}


class TestBinanceSyncFlagClearing:
    async def _run_one(self, shared: dict[str, Any]) -> None:
        # Run 1 (Binance, a deadline stop at B, above the set column so nothing is flagged below
        # it) writes binance_deadline_symbols and binance_read_through_ms onto the shared flags.
        supabase, _rec = _make_supabase(trades_rows=DEFAULT_TRADES, flags=shared)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            exchange="binance",
            raw_fills=[_bfill("fill-btc", B_TS, "BTCUSDT")],
            fills_flags=dict(_RUN_ONE_FLAGS),
        )
        assert shared["binance_deadline_symbols"] == ["BTCUSDT"]
        assert shared["binance_read_through_ms"] == B_MS

    async def test_a_clean_binance_sync_removes_the_keys_run_one_wrote_and_still_writes_the_row(
        self,
    ) -> None:
        shared: dict[str, Any] = {}
        await self._run_one(shared)
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES, flags=shared)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            exchange="binance",
            raw_fills=[_bfill("fill-btc2", HEALTHY_NEWER_TS, "BTCUSDT")],
        )
        assert "binance_deadline_symbols" not in shared
        assert "binance_read_through_ms" not in shared
        # Nothing else on the row changed, so only the clear can have caused this write.
        assert len(rec.analytics_upserts) == 1

    async def test_a_clean_binance_sync_removes_every_allowlisted_key_and_only_those(self) -> None:
        shared: dict[str, Any] = {
            **_ALL_NINE,
            "sync_truncated_okx": True,
            "daily_pnl_malformed_binance": True,
            "csv_source": True,
        }
        supabase, _rec = _make_supabase(trades_rows=DEFAULT_TRADES, flags=shared)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            exchange="binance",
            raw_fills=[_bfill("fill-btc", B_TS, "BTCUSDT")],
        )
        assert shared == {
            "sync_truncated_okx": True,
            "daily_pnl_malformed_binance": True,
            "csv_source": True,
        }

    async def test_a_sync_removes_only_the_keys_it_did_not_raise(self) -> None:
        shared: dict[str, Any] = {}
        await self._run_one(shared)
        supabase, _rec = _make_supabase(trades_rows=DEFAULT_TRADES, flags=shared)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            exchange="binance",
            raw_fills=[_bfill("fill-btc2", HEALTHY_NEWER_TS, "BTCUSDT")],
            fills_flags={
                "binance_page_cap_symbols": ["ETHUSDT"],
                "binance_read_through_ms": SECOND_STOP_MS,
            },
        )
        assert "binance_deadline_symbols" not in shared
        assert shared["binance_page_cap_symbols"] == ["ETHUSDT"]
        assert shared["binance_read_through_ms"] == SECOND_STOP_MS

    async def test_a_raised_binance_read_keeps_the_keys_run_one_wrote(self) -> None:
        shared: dict[str, Any] = {}
        await self._run_one(shared)
        supabase, _rec = _make_supabase(trades_rows=DEFAULT_TRADES, flags=shared)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            exchange="binance",
            raw_error=RuntimeError("venue refused the fills read"),
        )
        # A raised read is not evidence the span was read: the keys stay.
        assert shared["binance_deadline_symbols"] == ["BTCUSDT"]
        assert shared["binance_read_through_ms"] == B_MS
        assert shared["phase2_fill_ingestion_failed"] is True

    async def test_an_okx_sync_keeps_the_binance_keys(self) -> None:
        shared: dict[str, Any] = {}
        await self._run_one(shared)
        supabase, _rec = _make_supabase(trades_rows=DEFAULT_TRADES, flags=shared)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            exchange="okx",
            raw_fills=[_bfill("fill-okx", HEALTHY_NEWER_TS, "BTC-USDT-SWAP")],
        )
        assert shared["binance_deadline_symbols"] == ["BTCUSDT"]
        assert shared["binance_read_through_ms"] == B_MS

    async def test_a_switched_off_read_keeps_the_keys(self) -> None:
        shared: dict[str, Any] = {}
        await self._run_one(shared)
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES, flags=shared)
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            exchange="binance",
            ingestion=False,
        )
        assert shared["binance_deadline_symbols"] == ["BTCUSDT"]
        assert shared["binance_read_through_ms"] == B_MS
        assert rec.analytics_upserts == []

    async def test_a_failed_flag_load_pops_nothing_from_a_dict_the_run_never_read(self) -> None:
        # Pre-existing behaviour, pinned: with the load failed the run writes a new-keys-only
        # recovery payload. The clear must not turn that into an attempt to pop from {}.
        shared: dict[str, Any] = {}
        await self._run_one(shared)
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES, flags=shared)
        real_table = supabase.table.side_effect

        class _LoadRefused:
            def __init__(self, inner: Any) -> None:
                self._inner = inner

            def select(self, *_a: Any, **_k: Any) -> "_LoadRefused":
                return self

            def eq(self, *_a: Any, **_k: Any) -> "_LoadRefused":
                return self

            def maybe_single(self) -> "_LoadRefused":
                return self

            def execute(self) -> Any:
                raise RuntimeError("flag load refused")

            def upsert(self, payload: dict[str, Any], **kw: Any) -> Any:
                return self._inner.upsert(payload, **kw)

        def _table(name: str) -> Any:
            inner = real_table(name)
            return _LoadRefused(inner) if name == "strategy_analytics" else inner

        supabase.table.side_effect = _table
        await _run_job(
            supabase=supabase,
            column=CURSOR_BEHIND_TS,
            exchange="binance",
            raw_fills=[_bfill("fill-btc2", HEALTHY_NEWER_TS, "BTCUSDT")],
        )
        (written,) = [u["data_quality_flags"] for u in rec.analytics_upserts]
        assert written["phase2_fill_ingestion_failed"] is False
        assert not [k for k in written if k.startswith("binance_")]


# ---- Phase 253 round-1 fixes: CR-01 (a failed bound write), SFH-2 (a cancelled persist), SFH-1 ----
#
# ⚠️ ROUND 2 SUPERSEDED the post-read early write that R1-P1 to R1-P3 neutered: the bound is now
# written ONCE before the read (a provisional row at the seed, see the round-2 block below and its
# R2-P* neuters). The round-1 arms in this class still pin the OUTCOMES (run 2's walk start); their
# mechanism lines below name the retired early write and are kept as lineage.
#
# NEUTER, Phase 253 round-1 fixer (PROOF-01; recorded verbatim in 253-REVIEW-FIX.md, run against the
# pre-fix `job_worker.py` restored from a byte backup with `cp` and checked with `cmp`):
#   R1-P0  the pre-fix `run_sync_trades_job` (no early bound write; a failed epilogue write sets
#          `_p_last_fetched = None`): the NULL-column and the set-column CR-01 arms and the
#          CancelledError arm below go RED.
#   R1-P1  delete the early write's `except` body that discards the fills (`raw_fills = []` and
#          `phase2_failed = True`): the set-column CR-01 arm goes RED (the persisted healthy fill
#          moves the high-water past the span).
#   R1-P2  delete the early write (the `await db_execute(lambda: _set_bound(_early_unread_ms,
#          None))` call): the CancelledError arm goes RED.
#   R1-P3  send the run's real covers instead of None in the early write: the
#          never-advances arm goes RED (R4 moves a stored bound forward before the persist).
#   R1-P4  restore the old `_p_last_fetched = None` in the epilogue except: the NULL-column CR-01
#          arm goes RED even with the early write (a failed epilogue write after a persist
#          failure drops the bootstrap anchor).


def _two_run_walk_start_ms(out2: Any) -> int:
    """Run 2's walk start: the seed minus the overlap, or the reach (the smallest instant) when
    run 2 had no seed."""
    since = out2.fetch_raw.call_args.kwargs["since_ms"]
    return -1 if since is None else since - ex.OVERLAP_WINDOW_MS


class TestFailedBoundWriteStillRereadsTheSpan:
    """Round-1 CR-01 (HIGH). The outcome is run 2's walk start, never the stamp or a flag: a
    failed `set_strategy_fills_reread_bound` must not let the next run seed past the span."""

    async def test_cr01_a_null_column_run_whose_bound_write_fails_is_reread_by_the_next_run(
        self,
    ) -> None:
        # Run 1: NULL column, seed = the daily high-water 2026-05-07, a deadline stop at
        # 2026-05-08T00:00Z, and Phase 1 persists a daily row for 2026-07-14 (so the daily
        # high-water the next run would seed from moves far past the stop). The bound RPC is down.
        unread_ms = 1778198400000  # 2026-05-08T00:00:00Z
        bounds = RereadBounds()
        bounds.rpc_error = RuntimeError("rpc down")
        shared: dict[str, Any] = {}
        sb1, rec1 = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds, flags=shared)
        await _run_job(
            supabase=sb1,
            column=None,
            exchange="binance",
            raw_fills=[],
            daily_trades=[{"date": "2026-07-14", "daily_pnl": 1.0}],
            fills_flags={
                "binance_deadline_symbols": ["BTCUSDT"],
                "binance_read_through_ms": unread_ms,
            },
        )
        stamp = _the_advance(rec1)["p_last_fetched_ts"]

        # Run 2: the RPC is back, Phase 1 of run 1 moved the daily high-water, the column is
        # whatever run 1's stamp left.
        bounds.rpc_error = None
        rows2 = DAILY_ONLY_TRADES + [
            {"strategy_id": STRATEGY_ID, "is_fill": False, "timestamp": "2026-07-14T00:00:00+00:00"}
        ]
        sb2, _rec2 = _make_supabase(trades_rows=rows2, bounds=bounds, flags=shared)
        out2 = await _run_job(
            supabase=sb2, column=column_after_advance(None, stamp), exchange="binance"
        )
        assert _two_run_walk_start_ms(out2) <= unread_ms, (
            "run 2 must walk from at or before the unread start; pre-fix it seeds at the moved "
            "daily high-water 2026-07-14"
        )

    async def test_cr01_a_set_column_run_whose_bound_write_fails_is_reread_by_the_next_run(
        self,
    ) -> None:
        # Run 1: column 2026-06-20 ahead of the stored fills (2026-06-01T09:00Z), BTCUSDT capped at
        # 2026-06-02T09:00Z, ETHUSDT healthy up to 2026-06-03T09:00Z. The forward-only RPC drops any
        # stamp below the column, so only the bound could keep the span, and the bound RPC is down.
        # Pre-fix the run persists the ETH fill, moving run 2's seed to 2026-06-03T09:00Z.
        bounds = RereadBounds()
        bounds.rpc_error = RuntimeError("rpc down")
        shared: dict[str, Any] = {}
        sb1, rec1 = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds, flags=shared)
        await _run_job(
            supabase=sb1,
            column=CURSOR_AHEAD_TS,
            exchange="binance",
            raw_fills=[
                _bfill("fill-btc", "2026-06-02T09:00:00+00:00", "BTCUSDT"),
                _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
            ],
            fills_flags={
                "binance_page_cap_symbols": ["BTCUSDT"],
                "binance_read_through_ms": SECOND_STOP_MS,
            },
        )
        stamp = _the_advance(rec1)["p_last_fetched_ts"]
        assert shared["binance_stop_below_cursor"] is True, "the loss is loud"

        bounds.rpc_error = None
        sb2, _rec2 = _make_supabase(
            trades_rows=DEFAULT_TRADES + _persisted_fills(rec1, STRATEGY_ID),
            bounds=bounds,
            flags=shared,
        )
        out2 = await _run_job(
            supabase=sb2, column=column_after_advance(CURSOR_AHEAD_TS, stamp), exchange="binance"
        )
        assert _two_run_walk_start_ms(out2) <= SECOND_STOP_MS, (
            "run 2 must walk from at or before the stop; pre-fix it seeds at the healthy ETHUSDT "
            f"fill ({HEALTHY_NEWER_MS})"
        )
        assert shared.get("binance_stop_below_cursor") is None, (
            "run 2 re-read the span, so its clean read clears the flag"
        )


# ---- Phase 253 round-2 fixes: CR-02 (a NULL column, a 429 or a cancel after the Phase-1 store),
# CR-03 (a persist cancelled after the read frontier was recorded), SFH-R2-M1/M2 (IN-11) ----
#
# NEUTER, Phase 253 round-2 fixer (PROOF-01; recorded verbatim in 253-REVIEW-FIX.md under
# "Round 2", run against the fixed `job_worker.py`, each restored from a byte backup with `cp` and
# checked with `cmp`):
#   R2-P0  the post-merge `run_sync_trades_job` before the round-2 fix (the bound is written after
#          the read, Phase 251's daily store precedes it): the 429, cancel, stopped-persist,
#          complete-persist, orphan, failed-write and clear arms below go RED.
#   R2-P1  delete the provisional write call (`await db_execute(lambda: _set_bound(
#          _provisional_unread_ms, None))`): the same arms go RED.
#   R2-P2  write the walk start minus 1 ms instead of the seed (the reviewer's warned-off value):
#          the clear-on-complete arm goes RED (R7 keeps the row, covers never reaches it).
#   R2-P3  ignore the orphan answer (drop the `if not _bound_owned` branch): the orphan arms go RED.
#   R2-P4  let a failed provisional write fall through to the read (drop `_fills_read_skipped =
#          True` in its `except`): the failed-write arm goes RED.


def _cancel_the_second_persist(sb: Any) -> dict[str, int]:
    """Make the SECOND `trades` upsert raise `asyncio.CancelledError` (the handler's
    `asyncio.wait_for` cancelling mid-persist, which no `except Exception` catches). The first
    batch (100 rows) is stored."""
    persist_calls = {"n": 0}
    real_table = sb.table.side_effect

    def _table(name: str) -> Any:
        query = real_table(name)
        if name == "trades":
            real_upsert = query.upsert

            def _upsert(payload: list[dict[str, Any]], **kw: Any) -> Any:
                persist_calls["n"] += 1
                if persist_calls["n"] == 2:
                    def _cancelled() -> None:
                        raise asyncio.CancelledError()

                    return MagicMock(execute=_cancelled)
                return real_upsert(payload, **kw)

            query.upsert = _upsert
        return query

    sb.table.side_effect = _table
    return persist_calls


class TestProvisionalBoundBeforeTheRead:
    """Round-2 CR-02 and CR-03. Every arm is a TWO-RUN outcome: run 2's walk start must be at or
    before the earliest unread or unstored instant of run 1, with run 2's store carrying exactly
    what run 1 left (its stored fills, its daily row, the column through the forward-only RPC)."""

    @pytest.mark.parametrize(
        "raw_error", [ccxt.RateLimitExceeded("429"), asyncio.CancelledError()], ids=["429", "cancel"]
    )
    async def test_cr02_a_null_column_run_raised_or_cancelled_after_the_daily_store_is_reread(
        self, raw_error: BaseException
    ) -> None:
        # Run 1: NULL column, seed = the daily high-water 2026-05-07T00:00Z (1778112000000), and
        # Phase 1 (Phase 251) stores a daily row for 2026-07-14 BEFORE the fills read. The read
        # then raises a 429 or is cancelled: no epilogue, no anchor. Pre-fix nothing names the
        # span, and run 2 seeds from the moved daily high-water 2026-07-14.
        run1_seed_ms = 1778112000000
        bounds = RereadBounds()
        sb1, _rec1 = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds)
        with pytest.raises(type(raw_error)):
            await _run_job(
                supabase=sb1,
                column=None,
                exchange="binance",
                raw_error=raw_error,
                daily_trades=[{"date": "2026-07-14", "daily_pnl": 1.0}],
            )
        called = [c.args[0] for c in sb1.rpc.call_args_list]
        assert "sync_trades" in called, "the premise: Phase 1 stored the daily row first"

        rows2 = DAILY_ONLY_TRADES + [
            {"strategy_id": STRATEGY_ID, "is_fill": False, "timestamp": "2026-07-14T00:00:00+00:00"}
        ]
        sb2, _rec2 = _make_supabase(trades_rows=rows2, bounds=bounds)
        out2 = await _run_job(supabase=sb2, column=None, exchange="binance")
        assert _two_run_walk_start_ms(out2) <= run1_seed_ms - ex.OVERLAP_WINDOW_MS, (
            "run 2 must walk from run 1's walk start; pre-fix it seeds at the moved daily "
            "high-water 2026-07-14"
        )
        assert bounds.rows == {}, "run 2's clean read cleared the provisional bound (RPC R6)"
        # The mechanism, pinned last: the provisional bound precedes the daily store, or a cancel
        # between the two would leave the daily high-water moved and no row naming the span.
        assert called.index("set_strategy_fills_reread_bound") < called.index("sync_trades")

    async def test_cr03_a_stopped_read_cancelled_mid_persist_on_a_column_ahead_is_reread(
        self,
    ) -> None:
        # Column 2026-06-20 is AHEAD of the stored fill (2026-06-01T09:00Z): run 1's seed is that
        # fill, its walk starts 2026-06-01T08:00Z. BTCUSDT caps at 2026-06-02T09:00Z. Batch 1
        # stores 100 healthy ETHUSDT fills (2026-06-10), batch 2 (a healthy SOLUSDT fill at
        # 2026-06-01T20:00Z, BELOW the stop minus the overlap) is cancelled. The stored high-water
        # is now 2026-06-10. Pre-fix the early write recorded the stop (2026-06-02T09:00Z), run 2
        # walked from 2026-06-02T08:00Z and SOL was never re-read.
        sol_unstored_ms = 1780344000000  # 2026-06-01T20:00:00Z
        bounds = RereadBounds()
        raw_fills = [_bfill(f"eth-{i}", "2026-06-10T09:00:00+00:00", "ETHUSDT") for i in range(100)]
        raw_fills.append(_bfill("sol-1", "2026-06-01T20:00:00+00:00", "SOLUSDT"))
        sb1, rec1 = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds)
        _cancel_the_second_persist(sb1)
        with pytest.raises(asyncio.CancelledError):
            await _run_job(
                supabase=sb1,
                column=CURSOR_AHEAD_TS,
                exchange="binance",
                raw_fills=raw_fills,
                fills_flags={
                    "binance_page_cap_symbols": ["BTCUSDT"],
                    "binance_read_through_ms": SECOND_STOP_MS,
                },
            )
        assert len(_persisted_fills(rec1, STRATEGY_ID)) == 100, "the premise: batch 1 was stored"

        sb2, _rec2 = _make_supabase(
            trades_rows=DEFAULT_TRADES + _persisted_fills(rec1, STRATEGY_ID), bounds=bounds
        )
        out2 = await _run_job(supabase=sb2, column=CURSOR_AHEAD_TS, exchange="binance")
        assert _two_run_walk_start_ms(out2) <= sol_unstored_ms, (
            "run 2 must walk from at or before the unstored SOLUSDT fill; pre-fix it walks from "
            "the stop minus the overlap (2026-06-02T08:00Z)"
        )

    async def test_cr03_a_complete_read_cancelled_mid_persist_on_a_column_ahead_is_reread(
        self,
    ) -> None:
        # A COMPLETE read (no flags), so the pre-fix early write was skipped altogether. Same
        # column ahead of the stored fill; batch 1 stores 100 ETHUSDT fills (2026-06-10), batch 2
        # (a BTCUSDT fill at 2026-06-02T00:00Z, inside run 1's walk) is cancelled. Pre-fix no
        # bound exists and run 2 seeds at the stored 2026-06-10 fills.
        btc_unstored_ms = 1780358400000  # 2026-06-02T00:00:00Z
        bounds = RereadBounds()
        raw_fills = [_bfill(f"eth-{i}", "2026-06-10T09:00:00+00:00", "ETHUSDT") for i in range(100)]
        raw_fills.append(_bfill("btc-1", "2026-06-02T00:00:00+00:00", "BTCUSDT"))
        sb1, rec1 = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds)
        _cancel_the_second_persist(sb1)
        with pytest.raises(asyncio.CancelledError):
            await _run_job(
                supabase=sb1,
                column=CURSOR_AHEAD_TS,
                exchange="binance",
                raw_fills=raw_fills,
                fills_flags={},
            )
        assert len(_persisted_fills(rec1, STRATEGY_ID)) == 100, "the premise: batch 1 was stored"

        sb2, _rec2 = _make_supabase(
            trades_rows=DEFAULT_TRADES + _persisted_fills(rec1, STRATEGY_ID), bounds=bounds
        )
        out2 = await _run_job(supabase=sb2, column=CURSOR_AHEAD_TS, exchange="binance")
        assert _two_run_walk_start_ms(out2) <= btc_unstored_ms, (
            "run 2 must walk from at or before the unstored BTCUSDT fill; pre-fix it seeds at "
            "the stored ETHUSDT fills (2026-06-10)"
        )

    async def test_a_clean_run_clears_the_provisional_bound_it_wrote(self) -> None:
        # The provisional row must not live for ever: on a complete, persisted read the epilogue's
        # covers (the walk start, seed minus the overlap) is at or before it, so RPC R6 deletes it.
        # A provisional value of the walk start minus 1 ms would fail this (R7 keeps it).
        bounds = RereadBounds()
        supabase, _rec = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds)
        await _run_job(
            supabase=supabase,
            column=CURSOR_AHEAD_TS,
            exchange="binance",
            raw_fills=[_bfill("fill-btc", HEALTHY_NEWER_TS, "BTCUSDT")],
            fills_flags={},
        )
        assert [c["p_unread_from"] for c in bounds.calls] == [FILL_STORED_TS, None]
        assert bounds.rows == {}

    async def test_the_provisional_write_never_advances_a_stored_bound(self) -> None:
        # The provisional write passes covers NULL (RPC R5, LEAST): it can only lower a stored
        # bound. Stored bound 2026-06-02T09:00Z, seed = the stored fill 2026-06-01T09:00Z: the row
        # is at or before the stored one after the call, and a run cancelled before its epilogue
        # leaves it there (R4's forward move never ran).
        bounds = RereadBounds({STRATEGY_ID: (KEY_1, "2026-06-02T09:00:00+00:00")})
        sb, _rec = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds)
        real_table = sb.table.side_effect

        def _table(name: str) -> Any:
            query = real_table(name)
            if name == "trades":
                def _upsert(_payload: list[dict[str, Any]], **_kw: Any) -> Any:
                    def _cancelled() -> None:
                        raise asyncio.CancelledError()

                    return MagicMock(execute=_cancelled)

                query.upsert = _upsert
            return query

        sb.table.side_effect = _table
        with pytest.raises(asyncio.CancelledError):
            await _run_job(
                supabase=sb,
                column=CURSOR_AHEAD_TS,
                exchange="binance",
                raw_fills=[_bfill("fill-btc", HEALTHY_NEWER_TS, "BTCUSDT")],
                fills_flags={
                    "binance_deadline_symbols": ["BTCUSDT"],
                    "binance_read_through_ms": HEALTHY_NEWER_MS,
                },
            )
        assert bounds.rows == {STRATEGY_ID: (KEY_1, FILL_STORED_TS)}
        assert all(c["p_covers_from"] is None for c in bounds.calls), "only the epilogue has covers"

    async def test_in11_an_orphaned_run_stores_no_fill_and_the_next_run_rereads_the_span(
        self,
    ) -> None:
        # Column ahead of the stored fill, a stopped read with a healthy newer fill: pre-fix the
        # orphaned run's unfenced `trades` upsert stored the ETHUSDT fill (2026-06-03) with no
        # bound recorded, so run 2 (the re-claiming worker) seeded at that fill and the stopped
        # BTCUSDT span (2026-06-01T08:00Z walk start) was never read.
        bounds = RereadBounds()
        bounds.owned = False
        sb1, rec1 = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds)
        out1 = await _run_job(
            supabase=sb1,
            column=CURSOR_AHEAD_TS,
            exchange="binance",
            raw_fills=[
                _bfill("fill-btc", "2026-06-02T09:00:00+00:00", "BTCUSDT"),
                _bfill("fill-eth", HEALTHY_NEWER_TS, "ETHUSDT"),
            ],
            fills_flags={
                "binance_page_cap_symbols": ["BTCUSDT"],
                "binance_read_through_ms": SECOND_STOP_MS,
            },
        )
        stamp = _the_advance(rec1)["p_last_fetched_ts"]

        bounds.owned = True
        sb2, _rec2 = _make_supabase(
            trades_rows=DEFAULT_TRADES + _persisted_fills(rec1, STRATEGY_ID), bounds=bounds
        )
        out2 = await _run_job(
            supabase=sb2, column=column_after_advance(CURSOR_AHEAD_TS, stamp), exchange="binance"
        )
        assert _two_run_walk_start_ms(out2) <= FILL_STORED_MS - ex.OVERLAP_WINDOW_MS, (
            "run 2 must walk from the stored fill minus the overlap; pre-fix the orphaned run "
            "stored the healthy ETHUSDT fill and run 2 seeded past the stop"
        )
        assert out1.fetch_raw.call_count == 0, "an orphaned run reads nothing"

    async def test_a_failed_provisional_write_skips_the_read_and_stores_nothing(self) -> None:
        # The fail-closed branch (round-2 SFH-R2-M1): an unrecorded span is neither read nor
        # stored, the run is a failed Phase 2 (a NULL column keeps its bootstrap anchor), and
        # (round-3 WR-03) Phase 1's daily store is held too: it would move the daily high-water
        # the next run seeds from. The held store is the same hold a refused daily read has.
        bounds = RereadBounds()
        bounds.rpc_error = RuntimeError("rpc down")
        supabase, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds)
        out = await _run_job(
            supabase=supabase,
            column=None,
            exchange="binance",
            raw_fills=[_bfill("fill-btc", HEALTHY_NEWER_TS, "BTCUSDT")],
            daily_trades=[{"date": "2026-07-14", "daily_pnl": 1.0}],
        )
        assert out.fetch_raw.call_count == 0
        assert rec.upserted_batches == []
        assert "sync_trades" not in [c.args[0] for c in supabase.rpc.call_args_list], (
            "a run with no recorded bound holds the daily store (round-3 WR-03)"
        )
        assert out.result.trade_count == 0
        assert _the_advance(rec)["p_last_sync_at"] is None, "last_sync_at is held for the retry"
        flags = rec.analytics_upserts[-1]["data_quality_flags"]
        assert flags["phase2_fill_ingestion_failed"] is True
        assert "re-read bound write failed" in flags["phase2_error"]
        assert _the_advance(rec)["p_last_fetched_ts"] == "2026-05-07T00:00:00+00:00", (
            "the NULL column keeps its bootstrap anchor"
        )

    async def test_an_epilogue_orphan_after_a_landed_provisional_write_is_logged_once(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # The provisional write lands, the watchdog reclaims the job mid-run, the epilogue write
        # answers FALSE: one orphan WARNING, the job still completes (the cursor RPC is fenced on
        # its own).
        bounds = RereadBounds()
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES, bounds=bounds)
        real_rpc = bounds.rpc

        def _rpc_then_orphan(payload: dict[str, Any]) -> MagicMock:
            inner = real_rpc(payload)
            real_execute = inner.execute

            def _execute() -> MagicMock:
                result = real_execute()
                bounds.owned = False  # every call AFTER the first is an orphan
                return result

            return MagicMock(execute=_execute)

        bounds.rpc = _rpc_then_orphan  # type: ignore[method-assign]
        with caplog.at_level(logging.WARNING, logger=_WARNING_LOGGER):
            out = await _run_job(
                supabase=supabase,
                column=CURSOR_AHEAD_TS,
                exchange="binance",
                raw_fills=[_bfill("fill-btc", HEALTHY_NEWER_TS, "BTCUSDT")],
                fills_flags={},
            )
        orphan = [
            r.getMessage()
            for r in caplog.records
            if r.getMessage().startswith("worker_orphan_write_blocked")
        ]
        assert len(orphan) == 1, orphan
        assert out.fetch_raw.call_count == 1 and len(rec.upserted_batches) == 1
        assert bounds.rows == {STRATEGY_ID: (KEY_1, FILL_STORED_TS)}, (
            "the dropped epilogue write leaves the provisional row, which only over-fetches"
        )


# ---- Phase 253 round-3 fixes: WR-03, IN-14 (= SFH-R3 orphan), IN-15, IN-13 ----
#
# A Binance run whose provisional bound write raised (or answered orphan) holds Phase 1's daily
# `sync_trades` store, the way a refused daily read does: with no bound recorded, nothing may move
# the daily high-water that a NULL column or a set column with no stored fill seeds from.
#
# NEUTER, Phase 253 round-3 fixer (PROOF-01; recorded verbatim in 253-REVIEW-FIX.md under
# "Round 3", run against the fixed `job_worker.py`, each restored from a byte backup with `cp` and
# checked with `cmp`):
#   R3-P0  the committed pre-fix `run_sync_trades_job` (the daily store runs on both failure
#          branches): the set-column, orphan and NULL-column arms below go RED.
#   R3-P1  drop the hold on the failed-write branch: the set-column arm and the NULL-column arms
#          go RED.
#   R3-P2  drop the hold on the orphan branch: the orphan arm goes RED.
#   R3-P3  drop the orphan's flag-write skip: the orphan arm's stale `daily_pnl_*` key is popped.
#   R3-P4  `phase2_success` ignores `_fills_read_skipped` (review N5): the orphan arm's stale
#          `phase2_fill_ingestion_failed` is cleared.


_DAILY_ROW_2026_06_10 = {
    "strategy_id": STRATEGY_ID,
    "is_fill": False,
    "timestamp": "2026-06-10T00:00:00+00:00",
}
_RUN1_SEED_MS = 1778112000000  # 2026-05-07T00:00:00Z: the daily high-water of DAILY_ONLY_TRADES


def _store_after_run1(supabase: Any) -> list[dict[str, Any]]:
    """What run 1 left in `trades`: the stored daily row only when its `sync_trades` RPC ran."""
    stored = "sync_trades" in [c.args[0] for c in supabase.rpc.call_args_list]
    return DAILY_ONLY_TRADES + ([_DAILY_ROW_2026_06_10] if stored else [])


class TestHeldDailyStoreWhenNoBoundIsRecorded:
    """Every arm is a TWO-RUN outcome: run 2 walks from at or before run 1's walk start, over a
    store that carries exactly what run 1 left."""

    async def test_wr03_a_set_column_with_no_stored_fill_keeps_its_span_when_the_bound_rpc_is_down(
        self,
    ) -> None:
        # Column 2026-06-20 ahead of the daily seed 2026-05-07, NO stored fill, and the bound RPC
        # down for the WHOLE of run 1 (both the provisional and the epilogue write). Pre-fix
        # Phase 251 stored a daily row for 2026-06-10, so run 2 seeded there and the span in
        # between was never read; both flags then cleared on run 2's clean read.
        bounds = RereadBounds()
        bounds.rpc_error = RuntimeError("rpc down")
        shared: dict[str, Any] = {}
        sb1, rec1 = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds, flags=shared)
        out1 = await _run_job(
            supabase=sb1,
            column=CURSOR_AHEAD_TS,
            exchange="binance",
            raw_fills=[],
            daily_trades=[{"date": "2026-06-10", "daily_pnl": 1.0}],
        )
        assert out1.fetch_raw.call_count == 0, "the premise: the fills read was skipped"
        stamp = _the_advance(rec1)["p_last_fetched_ts"]
        assert shared["phase2_fill_ingestion_failed"] is True, "the loud signals are kept"

        bounds.rpc_error = None
        sb2, _rec2 = _make_supabase(
            trades_rows=_store_after_run1(sb1), bounds=bounds, flags=shared
        )
        out2 = await _run_job(
            supabase=sb2, column=column_after_advance(CURSOR_AHEAD_TS, stamp), exchange="binance"
        )
        assert _two_run_walk_start_ms(out2) <= _RUN1_SEED_MS - ex.OVERLAP_WINDOW_MS, (
            "run 2 must walk from run 1's walk start; pre-fix Phase 1's store moved the daily "
            "high-water to 2026-06-10 and the span before it was never read"
        )
        assert "sync_trades" not in [c.args[0] for c in sb1.rpc.call_args_list], (
            "the mechanism: a run with no recorded bound moves no seed term"
        )

    async def test_in14_an_orphaned_run_stores_no_daily_row_and_run_two_seeds_unchanged(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # The provisional write answers FALSE (the watchdog reclaimed the job). The orphan's
        # unfenced daily store would move the daily high-water the re-claiming worker seeds from,
        # and its unfenced flag write would pop a stored `daily_pnl_*` key and clear nothing
        # else. The stored flags carry a stale `phase2_fill_ingestion_failed` (IN-13): a skipped
        # read is neither a failed nor a clean Phase 2, so it must survive untouched.
        stale = {
            "phase2_fill_ingestion_failed": True,
            "phase2_error": "an earlier failure",
            "daily_pnl_unsupported_venue": True,
        }
        shared: dict[str, Any] = dict(stale)
        bounds = RereadBounds()
        bounds.owned = False
        sb1, rec1 = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds, flags=shared)
        with caplog.at_level(logging.WARNING, logger=_WARNING_LOGGER):
            out1 = await _run_job(
                supabase=sb1,
                column=CURSOR_AHEAD_TS,
                exchange="binance",
                raw_fills=[],
                daily_trades=[{"date": "2026-06-10", "daily_pnl": 1.0}],
            )
        assert out1.fetch_raw.call_count == 0
        assert any(
            r.getMessage().startswith("worker_orphan_write_blocked") for r in caplog.records
        ), "the loud signal is kept"
        assert "sync_trades" not in [c.args[0] for c in sb1.rpc.call_args_list]
        assert shared == stale, "an orphaned run writes no strategy flags, clears none (IN-13)"
        assert rec1.analytics_upserts == []

        bounds.owned = True
        sb2, _rec2 = _make_supabase(
            trades_rows=_store_after_run1(sb1), bounds=bounds, flags=shared
        )
        out2 = await _run_job(
            supabase=sb2,
            column=column_after_advance(CURSOR_AHEAD_TS, _the_advance(rec1)["p_last_fetched_ts"]),
            exchange="binance",
        )
        assert _two_run_walk_start_ms(out2) <= _RUN1_SEED_MS - ex.OVERLAP_WINDOW_MS, (
            "run 2 (the re-claiming worker) must seed where run 1 did; pre-fix the orphan's "
            "unfenced store moved the daily high-water to 2026-06-10"
        )

    @pytest.mark.parametrize(
        "error", [ccxt.RateLimitExceeded("429"), asyncio.CancelledError()], ids=["429", "cancel"]
    )
    async def test_in15_a_null_column_run_with_a_failed_bound_write_then_a_429_or_cancel_is_reread(
        self, error: BaseException
    ) -> None:
        # NULL column, seed = the daily high-water 2026-05-07, the bound RPC down, then the
        # balance read (after Phase 1's store, before the walk) raises a 429 or is cancelled: no
        # epilogue, so no bootstrap anchor either. Pre-fix the daily row stored in run 1 moved the
        # high-water and run 2 seeded from 2026-06-10.
        bounds = RereadBounds()
        bounds.rpc_error = RuntimeError("rpc down")
        sb1, _rec1 = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds)
        with pytest.raises(type(error)):
            await _run_job(
                supabase=sb1,
                column=None,
                exchange="binance",
                daily_trades=[{"date": "2026-06-10", "daily_pnl": 1.0}],
                balance_error=error,
            )

        bounds.rpc_error = None
        sb2, _rec2 = _make_supabase(trades_rows=_store_after_run1(sb1), bounds=bounds)
        out2 = await _run_job(supabase=sb2, column=None, exchange="binance")
        assert _two_run_walk_start_ms(out2) <= _RUN1_SEED_MS - ex.OVERLAP_WINDOW_MS, (
            "run 2 must walk from run 1's walk start; pre-fix the daily store moved the "
            "high-water to 2026-06-10 and no anchor was written"
        )
