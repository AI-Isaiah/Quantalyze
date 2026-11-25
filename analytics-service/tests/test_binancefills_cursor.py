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
"""

from __future__ import annotations

import logging
from typing import Any

import pytest

from tests.test_okxtrades_cursor import (
    CURSOR_BEHIND_MS,
    CURSOR_BEHIND_TS,
    DAILY_NEWEST_DAY_START_ISO,
    DAILY_ONLY_TRADES,
    DEFAULT_TRADES,
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
