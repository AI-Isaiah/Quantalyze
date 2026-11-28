"""Phase 255 NULLANCHOR plan 01: the SC-1 two-run matrix and the SC-2 pin, measured on unmodified code.

SC-1 AS ASSERTED HERE. After run 1 stored a daily row and its fills read then failed, run 2's
walk start is at or before run 1's walk start (run 1's seed minus `OVERLAP_WINDOW_MS`, or the
venue's reach anchor on a first sync). That implies the ROADMAP's wording "at or before run 1's
seed". Every arm drives the REAL `run_sync_trades_job` twice through
`tests/test_okxtrades_cursor.py::_run_job`, carrying run 1's moved daily row, its column (through
`column_after_advance`, the forward-only column RPC), the one bound store, the flags and the
persisted fills into run 2. The outcome is run 2's `since_ms`, never a stamp or a flag.

WHY A MATRIX. The TODOS evidence for the defect was OKX-only. The same epilogue serves Bybit and
Deribit, so the gate crosses three venues with a NULL column, a set column with no stored fill and
a first sync (no daily high-water, so run 1's seed is None), and with a 429, a cancel and a plain
raised read after run 1's Phase 1 moved the daily row. Three OKX truncated-read arms are included:
research found the truncated OKX read loses a span too.

HOW IT WAS MEASURED. The matrix was run once UNMARKED on the unmodified code at HEAD, and that run
was saved and recorded verbatim in the 255-01 SUMMARY. The 26 arms RED on unmodified code carried a
strict expected-failure marker (accepting only an AssertionError) until the fix commit of plan 02
removed it, so no marker is left in this module. An arm GREEN at HEAD stays as a regression pin.

Every instant is hand-typed with its ISO, never computed by the code under test:

    1778112000000  2026-05-07T00:00:00+00:00  run 1's seed on DAILY_ONLY_TRADES (the daily high-water day start)
    1781913600000  2026-06-20T00:00:00+00:00  CURSOR_AHEAD_TS, the set column (no stored fill)
    1783987200000  2026-07-14T00:00:00+00:00  the daily row run 1 stores before its fills read
    1784116800000  2026-07-15T12:00:00+00:00  the pinned clock
    3600000        OVERLAP_WINDOW_MS

SC-2 (class `TestAdvanceSyncCursorUnchanged`): `advance_sync_cursor` has ONE Python caller,
`_advance_cursor` in the `run_sync_trades_job` epilogue, so its params are pinned there. The golden
`p_last_fetched_ts` values were measured on the unmodified code at HEAD (saved output, copied by
hand) and are GREEN before and after the fix. A second pin keeps every `binance_*` flag Binance-only,
also when a later bound write fails.

NEUTER (PROOF-01; each recorded verbatim in the 255-03 SUMMARY, restored with cp from a byte backup and checked with cmp):
  N1 in `run_sync_trades_job`, `_bound_read = _reach_anchor_ms is not None` becomes
     `_bound_read = _binance_read` (the pre-fix, Binance-only gating on the fixed code):
     test_run2_walks_from_run1_walk_start[okx-null-429], [bybit-set-cancel], [deribit-set-plain],
     test_first_sync_run2_walks_from_the_reach_anchor[okx-first-429] and
     TestBoundOffBinance::test_a_clean_read_writes_the_seed_then_clears[okx] go RED.
  N2 `lambda: _set_bound(_provisional_unread_ms, None)` becomes `lambda: True` (no provisional row
     before the read): test_run2_walks_from_run1_walk_start[okx-null-429], [bybit-set-cancel] and
     [deribit-null-cancel] go RED.
  N3 the off-Binance `elif` of `_earliest_through` (`elif phase2_failed or any(`) gets the condition
     `False` (a wrong RPC R6 clear of a lost span): test_run2_walks_from_run1_walk_start[okx-set-plain]
     and test_okx_truncated_read_run2_walks_from_run1_walk_start[okx-set-trunc] go RED.
  N4 in the bybit anchor branch, `BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS * 86_400_000` becomes
     `730 * 86_400_000` (the history cap): TestBoundOffBinance::
     test_bybit_bound_stays_inside_the_venue_history_on_a_later_clock and
     test_a_first_sync_provisional_row_is_the_venue_reach_anchor[bybit] go RED.
  N5 `fills_since_ms if fills_since_ms is not None else _reach_anchor_ms` (the provisional value)
     becomes `fills_since_ms - _exchange.OVERLAP_WINDOW_MS - 1 if ...` (the walk start minus 1 ms, the
     Phase 253 R2-P2 class, so RPC R7 keeps the row after a clean read):
     TestBoundOffBinance::test_a_clean_read_writes_the_seed_then_clears[okx] goes RED.
  N6 remove the `_binance_read` conjunct from the `binance_stop_below_cursor` write condition:
     TestAdvanceSyncCursorUnchanged::test_no_binance_key_on_a_non_binance_run[okx-plain-set] goes RED.
  N7 `_bound_read = _reach_anchor_ms is not None` becomes `_bound_read = _binance_read =
     _reach_anchor_ms is not None` (the Binance predicates on every venue):
     test_okx_truncated_read_run2_walks_from_run1_walk_start[okx-set-trunc],
     test_no_binance_key_on_a_non_binance_run[okx-plain-set] and
     test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_raised_okx_read_never_sets_a_binance_flag
     go RED.
  N8 delete the orphan arm's `_bound_read = False` (the search text is it plus the neighbouring
     `_binance_read = False` line, so exactly one match): TestBoundOffBinance::
     test_an_orphan_answer_skips_the_read_the_store_and_the_epilogue_write[okx] goes RED.
  N9 drop the `if _binance_read:` guard around the failed-epilogue-write flag assignment (dedent it):
     TestAdvanceSyncCursorUnchanged::test_a_failed_epilogue_bound_write_sets_no_binance_flag[okx]
     goes RED.
  N10 (the SC-2 pin's own bite) `elif (phase2_failed or _fills_incomplete) and fills_anchor_iso is not
     None:` becomes `elif False:`: TestAdvanceSyncCursorUnchanged::
     test_advance_sync_cursor_params_are_unchanged[okx-plain-null] and [binance-plain-null] go RED.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any
from unittest.mock import MagicMock

import ccxt
import pytest

from services import exchange as ex
from services import job_worker as jw
from services.job_worker import BINANCE_SYNC_FILLS_READ_DEADLINE_S
from tests._binance_fills import RereadBounds, column_after_advance
from tests.test_binancefills_cursor import (
    _WARNING_LOGGER,
    _bfill,
    _persisted_fills,
    _two_run_walk_start_ms,
)
from tests.test_okxtrades_cursor import (
    CURSOR_AHEAD_TS,
    DAILY_ONLY_TRADES,
    STRATEGY_ID,
    _fill,
    _make_supabase,
    _run_job,
    _the_advance,
)

NOW_MS = 1784116800000  # 2026-07-15T12:00:00Z
RUN1_SEED_MS = 1778112000000  # 2026-05-07T00:00:00Z
# First-sync reach anchors under the pinned clock: OKX now minus 93 days, Bybit now minus 365 days,
# Deribit the epoch.
REACH_ANCHOR_MS = {
    "okx": 1776081600000,  # 2026-04-13T12:00:00Z
    "bybit": 1752580800000,  # 2025-07-15T12:00:00Z
    "deribit": 0,  # 1970-01-01T00:00:00Z
}
DAILY_MOVED: dict[str, Any] = {
    "strategy_id": STRATEGY_ID,
    "is_fill": False,
    "timestamp": "2026-07-14T00:00:00+00:00",
}
# The daily series run 1's Phase 1 stores (makes the `sync_trades` RPC fire).
DAILY_TRADES_RUN1: list[dict[str, Any]] = [{"date": "2026-07-14", "daily_pnl": 1.0}]
TRUNC_FILL_TS = "2026-07-14T09:00:00+00:00"


@pytest.fixture(autouse=True)
def _pinned_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    # tests/test_okxtrades_cursor.py pins no clock, and every reach anchor depends on it.
    monkeypatch.setattr(ex, "_now_ms", lambda: NOW_MS)


def _variant_error(variant: str) -> BaseException:
    """A FRESH exception per call (a reused instance would carry a stale traceback)."""
    if variant == "429":
        return ccxt.RateLimitExceeded("429")
    if variant == "cancel":
        return asyncio.CancelledError()
    if variant == "plain":
        return RuntimeError("venue refused the fills read")
    raise AssertionError(f"unknown variant {variant!r}")


async def _two_runs(
    venue: str,
    column: str | None,
    rows1: list[dict[str, Any]],
    variant: str,
    *,
    raw_fills: list[dict[str, Any]] | None = None,
    fills_flags: dict[str, Any] | None = None,
) -> Any:
    """Run 1 stores the daily row then its fills read fails (or, for variant "clean", reads
    `raw_fills` under `fills_flags`); run 2 is a clean read on what run 1 left. Returns run 2's
    `_Outcome`."""
    bounds = RereadBounds()
    flags: dict[str, Any] = {}
    sb1, rec1 = _make_supabase(trades_rows=rows1, bounds=bounds, flags=flags)
    if variant == "clean":
        await _run_job(
            supabase=sb1,
            column=column,
            exchange=venue,
            daily_trades=DAILY_TRADES_RUN1,
            raw_fills=raw_fills,
            fills_flags=fills_flags,
        )
    else:
        err = _variant_error(variant)
        if variant == "plain":
            await _run_job(
                supabase=sb1,
                column=column,
                exchange=venue,
                daily_trades=DAILY_TRADES_RUN1,
                raw_error=err,  # type: ignore[arg-type]
            )
        else:
            with pytest.raises(type(err)):
                await _run_job(
                    supabase=sb1,
                    column=column,
                    exchange=venue,
                    daily_trades=DAILY_TRADES_RUN1,
                    raw_error=err,  # type: ignore[arg-type]
                )
    called = [c.args[0] for c in sb1.rpc.call_args_list]
    assert "sync_trades" in called, (
        "NULLANCHOR-PREMISE: Phase 1 must have stored the daily row before the fills read"
    )
    stamp = rec1.advance_params[0]["p_last_fetched_ts"] if rec1.advance_params else None
    rows2 = rows1 + [DAILY_MOVED] + _persisted_fills(rec1, STRATEGY_ID)
    sb2, _rec2 = _make_supabase(trades_rows=rows2, bounds=bounds, flags=flags)
    out2 = await _run_job(
        supabase=sb2,
        column=column_after_advance(column, stamp),
        exchange=venue,
    )
    assert out2.fetch_raw.call_args.kwargs["since_ms"] is not None, (
        "NULLANCHOR-PREMISE: the moved daily row guarantees run 2 a seed; a None would make "
        "the walk-start measure pass vacuously"
    )
    return out2


def _walk_start_message(venue: str, kind: str, variant: str, out2: Any) -> str:
    return (
        f"NULLANCHOR-WALK-START: {venue} {kind} {variant}: run 2 walked from "
        f"since_ms={out2.fetch_raw.call_args.kwargs['since_ms']} after run 1's fills read failed"
    )


_MATRIX_PARAMS = [
    pytest.param("okx", None, "429", id="okx-null-429"),
    pytest.param("okx", None, "cancel", id="okx-null-cancel"),
    pytest.param("okx", None, "plain", id="okx-null-plain"),
    pytest.param("okx", CURSOR_AHEAD_TS, "429", id="okx-set-429"),
    pytest.param("okx", CURSOR_AHEAD_TS, "cancel", id="okx-set-cancel"),
    pytest.param("okx", CURSOR_AHEAD_TS, "plain", id="okx-set-plain"),
    pytest.param("bybit", None, "429", id="bybit-null-429"),
    pytest.param("bybit", None, "cancel", id="bybit-null-cancel"),
    pytest.param("bybit", None, "plain", id="bybit-null-plain"),
    pytest.param("bybit", CURSOR_AHEAD_TS, "429", id="bybit-set-429"),
    pytest.param("bybit", CURSOR_AHEAD_TS, "cancel", id="bybit-set-cancel"),
    pytest.param("bybit", CURSOR_AHEAD_TS, "plain", id="bybit-set-plain"),
    pytest.param("deribit", None, "429", id="deribit-null-429"),
    pytest.param("deribit", None, "cancel", id="deribit-null-cancel"),
    pytest.param("deribit", None, "plain", id="deribit-null-plain"),
    pytest.param("deribit", CURSOR_AHEAD_TS, "429", id="deribit-set-429"),
    pytest.param("deribit", CURSOR_AHEAD_TS, "cancel", id="deribit-set-cancel"),
    pytest.param("deribit", CURSOR_AHEAD_TS, "plain", id="deribit-set-plain"),
]

_FIRST_SYNC_PARAMS = [
    pytest.param("okx", "429", id="okx-first-429"),
    pytest.param("okx", "cancel", id="okx-first-cancel"),
    pytest.param("okx", "plain", id="okx-first-plain"),
    pytest.param("bybit", "429", id="bybit-first-429"),
    pytest.param("bybit", "cancel", id="bybit-first-cancel"),
    pytest.param("bybit", "plain", id="bybit-first-plain"),
    pytest.param("deribit", "429", id="deribit-first-429"),
    pytest.param("deribit", "cancel", id="deribit-first-cancel"),
    pytest.param("deribit", "plain", id="deribit-first-plain"),
]

_TRUNC_PARAMS = [
    pytest.param("null", id="okx-null-trunc"),
    pytest.param("set", id="okx-set-trunc"),
    pytest.param("first", id="okx-first-trunc"),
]


class TestNullAnchorMatrix:
    @pytest.mark.parametrize("venue,column,variant", _MATRIX_PARAMS)
    async def test_run2_walks_from_run1_walk_start(
        self, venue: str, column: str | None, variant: str
    ) -> None:
        out2 = await _two_runs(venue, column, DAILY_ONLY_TRADES, variant)
        kind = "null" if column is None else "set"
        assert _two_run_walk_start_ms(out2) <= RUN1_SEED_MS - ex.OVERLAP_WINDOW_MS, (
            _walk_start_message(venue, kind, variant, out2)
        )

    @pytest.mark.parametrize("venue,variant", _FIRST_SYNC_PARAMS)
    async def test_first_sync_run2_walks_from_the_reach_anchor(
        self, venue: str, variant: str
    ) -> None:
        # Never assert `since is None`: with the fix run 2's seed is the anchor.
        out2 = await _two_runs(venue, None, [], variant)
        assert _two_run_walk_start_ms(out2) <= REACH_ANCHOR_MS[venue], (
            _walk_start_message(venue, "first", variant, out2)
        )

    @pytest.mark.parametrize("kind", _TRUNC_PARAMS)
    async def test_okx_truncated_read_run2_walks_from_run1_walk_start(self, kind: str) -> None:
        rows1 = [] if kind == "first" else DAILY_ONLY_TRADES
        column = CURSOR_AHEAD_TS if kind == "set" else None
        out2 = await _two_runs(
            "okx",
            column,
            rows1,
            "clean",
            raw_fills=[_fill("okx-trunc-1", TRUNC_FILL_TS)],
            fills_flags={"sync_truncated_okx": True},
        )
        bound = REACH_ANCHOR_MS["okx"] if kind == "first" else RUN1_SEED_MS - ex.OVERLAP_WINDOW_MS
        assert _two_run_walk_start_ms(out2) <= bound, _walk_start_message(
            "okx", kind, "trunc", out2
        )


# ---- SC-2: the advance_sync_cursor params and the Binance-only flag surface ----------------------

EXPECTED_ADVANCE_KEYS = {
    "p_api_key_id",
    "p_job_id",
    "p_claim_token",
    "p_last_fetched_ts",
    "p_last_sync_at",
    "p_account_balance",
}
_CLEAN_STAMP = "2026-07-14T09:00:00+00:00"  # the one read fill's timestamp: a clean run stamps it
_DAILY_ANCHOR = "2026-05-07T00:00:00+00:00"  # the daily high-water day start: a NULL-column anchor


def _read_fill(venue: str) -> dict[str, Any]:
    if venue == "binance":
        return _bfill("bin-1", TRUNC_FILL_TS, "BTCUSDT")
    return {**_fill("v-1", TRUNC_FILL_TS), "exchange": venue}


async def _one_run(venue: str, scenario: str) -> Any:
    """One run on DAILY_ONLY_TRADES; returns the recorder. `scenario` is `{clean|plain|trunc}-{null|set}`."""
    kind, _, col = scenario.partition("-")
    column = None if col == "null" else CURSOR_AHEAD_TS
    sb, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=RereadBounds())
    if kind == "clean":
        await _run_job(
            supabase=sb,
            column=column,
            exchange=venue,
            daily_trades=DAILY_TRADES_RUN1,
            raw_fills=[_read_fill(venue)],
        )
    elif kind == "plain":
        await _run_job(
            supabase=sb,
            column=column,
            exchange=venue,
            daily_trades=DAILY_TRADES_RUN1,
            raw_error=RuntimeError("venue refused the fills read"),
        )
    else:
        await _run_job(
            supabase=sb,
            column=column,
            exchange=venue,
            daily_trades=DAILY_TRADES_RUN1,
            raw_fills=[_fill("okx-trunc-1", TRUNC_FILL_TS)],
            fills_flags={"sync_truncated_okx": True},
        )
    return rec


class _SecondBoundWriteFails(RereadBounds):
    """A bound store whose second and later `set_strategy_fills_reread_bound` calls raise."""

    def rpc(self, payload: dict[str, Any]) -> MagicMock:
        parent = super().rpc(payload)

        def _execute() -> MagicMock:
            if self.calls:
                self.calls.append(dict(payload))
                raise RuntimeError("bound write unavailable")
            result: MagicMock = parent.execute()
            return result

        return MagicMock(execute=_execute)


_ADVANCE_PARAMS = [
    pytest.param("binance", "clean-null", _CLEAN_STAMP, id="binance-clean-null"),
    pytest.param("binance", "clean-set", _CLEAN_STAMP, id="binance-clean-set"),
    pytest.param("binance", "plain-null", _DAILY_ANCHOR, id="binance-plain-null"),
    pytest.param("binance", "plain-set", None, id="binance-plain-set"),
    pytest.param("okx", "clean-null", _CLEAN_STAMP, id="okx-clean-null"),
    pytest.param("okx", "clean-set", _CLEAN_STAMP, id="okx-clean-set"),
    pytest.param("okx", "plain-null", _DAILY_ANCHOR, id="okx-plain-null"),
    pytest.param("okx", "plain-set", None, id="okx-plain-set"),
    pytest.param("bybit", "clean-null", _CLEAN_STAMP, id="bybit-clean-null"),
    pytest.param("bybit", "clean-set", _CLEAN_STAMP, id="bybit-clean-set"),
    pytest.param("bybit", "plain-null", _DAILY_ANCHOR, id="bybit-plain-null"),
    pytest.param("bybit", "plain-set", None, id="bybit-plain-set"),
    pytest.param("deribit", "clean-null", _CLEAN_STAMP, id="deribit-clean-null"),
    pytest.param("deribit", "clean-set", _CLEAN_STAMP, id="deribit-clean-set"),
    pytest.param("deribit", "plain-null", _DAILY_ANCHOR, id="deribit-plain-null"),
    pytest.param("deribit", "plain-set", None, id="deribit-plain-set"),
    pytest.param("okx", "trunc-null", _DAILY_ANCHOR, id="okx-trunc-null"),
    pytest.param("okx", "trunc-set", None, id="okx-trunc-set"),
]

_NO_BINANCE_KEY_PARAMS = [
    pytest.param("okx", "plain-null", id="okx-plain-null"),
    pytest.param("okx", "plain-set", id="okx-plain-set"),
    pytest.param("bybit", "plain-null", id="bybit-plain-null"),
    pytest.param("bybit", "plain-set", id="bybit-plain-set"),
    pytest.param("deribit", "plain-null", id="deribit-plain-null"),
    pytest.param("deribit", "plain-set", id="deribit-plain-set"),
    pytest.param("okx", "trunc-set", id="okx-trunc-set"),
]


class TestAdvanceSyncCursorUnchanged:
    @pytest.mark.parametrize("venue,scenario,golden", _ADVANCE_PARAMS)
    async def test_advance_sync_cursor_params_are_unchanged(
        self, venue: str, scenario: str, golden: str | None
    ) -> None:
        rec = await _one_run(venue, scenario)
        advance = _the_advance(rec)
        assert set(advance) == EXPECTED_ADVANCE_KEYS
        assert advance["p_last_fetched_ts"] == golden, (
            f"{venue} {scenario}: the stamp moved from the HEAD golden {golden!r}"
        )

    @pytest.mark.parametrize("venue,scenario", _NO_BINANCE_KEY_PARAMS)
    async def test_no_binance_key_on_a_non_binance_run(self, venue: str, scenario: str) -> None:
        rec = await _one_run(venue, scenario)
        flags = rec.analytics_upserts[-1]["data_quality_flags"]
        assert not [k for k in flags if k.startswith("binance_")], (
            f"{venue} {scenario}: a binance_* flag was written off Binance: {sorted(flags)}"
        )
        if scenario.startswith("plain"):
            assert flags["phase2_fill_ingestion_failed"] is True

    @pytest.mark.parametrize("venue", ["okx", "bybit", "deribit"])
    async def test_a_failed_epilogue_bound_write_sets_no_binance_flag(self, venue: str) -> None:
        sb, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=_SecondBoundWriteFails())
        await _run_job(
            supabase=sb,
            column=CURSOR_AHEAD_TS,
            exchange=venue,
            daily_trades=DAILY_TRADES_RUN1,
            raw_error=RuntimeError("venue refused the fills read"),
        )
        flags = rec.analytics_upserts[-1]["data_quality_flags"]
        assert "binance_stop_below_cursor" not in flags
        assert flags["phase2_fill_ingestion_failed"] is True


# ---- The off-Binance mechanism: the bound's write order, fail-closed arm and orphan arm ---------

_VENUES = [
    pytest.param("okx", id="okx"),
    pytest.param("bybit", id="bybit"),
    pytest.param("deribit", id="deribit"),
]
# First-sync provisional rows under the pinned clock (the hand-typed ISO of REACH_ANCHOR_MS).
_FIRST_SYNC_ROWS = [
    pytest.param("okx", "2026-04-13T12:00:00+00:00", id="okx"),
    pytest.param("bybit", "2025-07-15T12:00:00+00:00", id="bybit"),
    pytest.param("deribit", "1970-01-01T00:00:00+00:00", id="deribit"),
]
_LATER_CLOCK_MS = 1784203200000  # 2026-07-16T12:00:00Z
_LATER_CLOCK_MINUS_730D_MS = 1721131200000  # 2024-07-16T12:00:00Z: the `start_too_old` line
_KEY_1 = "key-1"


class TestBoundOffBinance:
    """The Phase 253 bound's mechanism on OKX, Bybit and Deribit: the provisional write precedes the
    daily store, a failed write is fail-closed, an orphan answer reads nothing, and a first sync
    records the venue's reach anchor. Each contract is the Binance arm's, with `exchange=venue`."""

    @pytest.mark.parametrize("venue", _VENUES)
    async def test_a_clean_read_writes_the_seed_then_clears(self, venue: str) -> None:
        bounds = RereadBounds()
        sb, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds)
        out = await _run_job(
            supabase=sb,
            column=CURSOR_AHEAD_TS,
            exchange=venue,
            daily_trades=DAILY_TRADES_RUN1,
            raw_fills=[_read_fill(venue)],
        )
        assert out.fetch_raw.call_count == 1
        assert bounds.reads == 1
        assert len(bounds.calls) == 2
        provisional, epilogue = bounds.calls
        assert provisional["p_unread_from"] == "2026-05-07T00:00:00+00:00"
        assert provisional["p_covers_from"] is None
        assert epilogue["p_unread_from"] is None
        assert epilogue["p_covers_from"] == "2026-05-06T23:00:00+00:00"
        assert bounds.rows == {}, "a clean read clears the row"
        called = [c.args[0] for c in sb.rpc.call_args_list]
        assert "sync_trades" in called, "the daily row was stored"
        assert called.index("set_strategy_fills_reread_bound") < called.index("sync_trades"), (
            "the provisional bound write must precede the daily store"
        )
        assert rec.upserted_batches, "the read fill was persisted"

    @pytest.mark.parametrize("venue", _VENUES)
    async def test_a_failed_bound_write_skips_the_read_and_holds_the_daily_store(
        self, venue: str
    ) -> None:
        bounds = RereadBounds()
        bounds.rpc_error = RuntimeError("rpc down")
        sb, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds)
        out = await _run_job(
            supabase=sb,
            column=None,
            exchange=venue,
            daily_trades=DAILY_TRADES_RUN1,
            raw_fills=[_read_fill(venue)],
        )
        assert out.fetch_raw.call_count == 0, "an unrecorded span is never read"
        assert rec.upserted_batches == []
        assert "sync_trades" not in [c.args[0] for c in sb.rpc.call_args_list], (
            "a run with no recorded bound holds the daily store"
        )
        assert out.result.trade_count == 0
        assert _the_advance(rec)["p_last_sync_at"] is None, "last_sync_at is held for the retry"
        flags = rec.analytics_upserts[-1]["data_quality_flags"]
        assert flags["phase2_fill_ingestion_failed"] is True
        assert "re-read bound write failed" in flags["phase2_error"]
        assert not [k for k in flags if k.startswith("binance_")]

    @pytest.mark.parametrize("venue", _VENUES)
    async def test_an_orphan_answer_skips_the_read_the_store_and_the_epilogue_write(
        self, venue: str, caplog: pytest.LogCaptureFixture
    ) -> None:
        bounds = RereadBounds()
        bounds.owned = False
        sb, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds)
        with caplog.at_level(logging.WARNING, logger=_WARNING_LOGGER):
            out = await _run_job(
                supabase=sb,
                column=CURSOR_AHEAD_TS,
                exchange=venue,
                daily_trades=DAILY_TRADES_RUN1,
                raw_fills=[_read_fill(venue)],
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
        assert "sync_trades" not in [c.args[0] for c in sb.rpc.call_args_list]
        assert not any(
            "phase2_fill_ingestion_failed" in u["data_quality_flags"]
            for u in rec.analytics_upserts
        ), "an orphaned run stamps no Phase 2 outcome either way"
        assert _the_advance(rec)["p_last_fetched_ts"] is None

    @pytest.mark.parametrize("venue,iso", _FIRST_SYNC_ROWS)
    async def test_a_first_sync_provisional_row_is_the_venue_reach_anchor(
        self, venue: str, iso: str
    ) -> None:
        bounds = RereadBounds()
        sb, _rec = _make_supabase(trades_rows=[], bounds=bounds)
        with pytest.raises(ccxt.RateLimitExceeded):
            await _run_job(
                supabase=sb,
                column=None,
                exchange=venue,
                daily_trades=DAILY_TRADES_RUN1,
                raw_error=ccxt.RateLimitExceeded("429"),
            )
        assert bounds.rows == {STRATEGY_ID: (_KEY_1, iso)}

    async def test_bybit_bound_stays_inside_the_venue_history_on_a_later_clock(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The anchor is the 365-day first-sync lookback, never the 730-day history cap: a bound at
        # the cap would, on a later day, sit past `start_too_old` and every later run would refuse.
        bounds = RereadBounds()
        flags: dict[str, Any] = {}
        sb1, rec1 = _make_supabase(trades_rows=[], bounds=bounds, flags=flags)
        await _run_job(
            supabase=sb1,
            column=None,
            exchange="bybit",
            daily_trades=DAILY_TRADES_RUN1,
            raw_error=RuntimeError("venue refused the fills read"),
        )
        stamp = rec1.advance_params[0]["p_last_fetched_ts"] if rec1.advance_params else None
        monkeypatch.setattr(ex, "_now_ms", lambda: _LATER_CLOCK_MS)
        sb2, _rec2 = _make_supabase(
            trades_rows=[DAILY_MOVED] + _persisted_fills(rec1, STRATEGY_ID),
            bounds=bounds,
            flags=flags,
        )
        out2 = await _run_job(
            supabase=sb2, column=column_after_advance(None, stamp), exchange="bybit"
        )
        walk_start = _two_run_walk_start_ms(out2)
        assert walk_start >= _LATER_CLOCK_MINUS_730D_MS, (
            "run 2 would start past the venue's 730-day history and refuse with start_too_old"
        )
        assert walk_start <= REACH_ANCHOR_MS["bybit"], (
            "run 2 must still walk from run 1's reach anchor"
        )


# ---- Review fix SFH-M1 (REVIEW IN-05): an OKX stuck-cursor stop is an incomplete read ------------

# 2026-07-14T09:00:00Z, hand-typed: the `ts` of every fill the fake OKX page serves.
_OKX_PAGE_TS = "1784019600000"


def _okx_full_page(prefix: str, last_bill_id: str) -> list[dict[str, Any]]:
    """A FULL (100-row) OKX fills-history page: 99 unique billIds, then `last_bill_id`.

    Phase 255 R2-CR-01: the pager's cursor is the last row's `billId` (the venue's `after` key),
    so the stuck-cursor fixtures vary the billId. Every row keeps a distinct tradeId."""
    rows = [
        {
            "instId": "BTC-USDT-SWAP",
            "side": "buy",
            "fillPx": "60000",
            "fillSz": "0.1",
            "fee": "-0.6",
            "feeCcy": "USDT",
            "ts": _OKX_PAGE_TS,
            "ordId": f"ord-{prefix}-{i}",
            "tradeId": f"{prefix}-{i}",
            "billId": f"{prefix}-bill-{i}",
            "execType": "T",
        }
        for i in range(99)
    ]
    rows.append(
        {**rows[0], "ordId": f"ord-{prefix}-tail", "tradeId": f"{prefix}-tail", "billId": last_bill_id}
    )
    return rows


def _okx_stuck_exchange(kind: str) -> Any:
    """A fake OKX whose SWAP history stops advancing: `missing` ends page 1 on an empty billId,
    `repeated` serves a second full page that ends on page 1's cursor. Other instTypes are empty."""
    state = {"swap_calls": 0}

    async def _history(params: dict[str, str]) -> dict[str, Any]:
        if params["instType"] != "SWAP":
            return {"data": []}
        state["swap_calls"] += 1
        if kind == "missing":
            return {"data": _okx_full_page("m", "")}
        if state["swap_calls"] == 1:
            return {"data": _okx_full_page("r1", "cursor-1")}
        return {"data": _okx_full_page("r2", "cursor-1")}

    exchange = MagicMock()
    exchange.id = "okx"
    exchange.private_get_trade_fills_history = _history
    return exchange


class TestOkxStuckCursorKeepsTheBound:
    """SFH-M1: `_fetch_raw_trades_okx_inst_type` stopped on a full page with a missing or repeated
    cursor as a NATURAL end, so no `sync_truncated_okx` was recorded and the worker's epilogue
    cleared the re-read bound and let the cursor advance past an unread span."""

    @pytest.mark.parametrize("kind", ["missing", "repeated"])
    async def test_a_stuck_full_page_records_sync_truncated_okx(self, kind: str) -> None:
        ex.get_and_clear_last_dq_flags()
        fills = await ex._fetch_raw_trades_okx(_okx_stuck_exchange(kind), None)
        flags = ex.get_and_clear_last_dq_flags()
        assert fills, "the pages read before the stop are still returned"
        assert flags.get("sync_truncated_okx") is True, (
            f"OKX {kind} cursor on a full page: the read stopped early but recorded no "
            f"sync_truncated_okx, so the worker would clear the bound: {flags}"
        )

    @pytest.mark.parametrize("kind", ["missing", "repeated"])
    async def test_the_workers_epilogue_keeps_the_bound_and_holds_the_cursor(
        self, kind: str
    ) -> None:
        # The REAL reader's fills and DQ flags feed the real `run_sync_trades_job`.
        ex.get_and_clear_last_dq_flags()
        fills = await ex._fetch_raw_trades_okx(_okx_stuck_exchange(kind), None)
        reader_flags = ex.get_and_clear_last_dq_flags()
        bounds = RereadBounds()
        sb, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds)
        await _run_job(
            supabase=sb,
            column=CURSOR_AHEAD_TS,
            exchange="okx",
            daily_trades=DAILY_TRADES_RUN1,
            raw_fills=fills,
            fills_flags=reader_flags,
        )
        assert bounds.rows != {}, (
            f"OKX {kind} cursor: the epilogue cleared the re-read bound over an unread span"
        )
        assert _the_advance(rec)["p_last_fetched_ts"] is None, "the fills cursor is held"


# ---- Review round 2 R2-CR-01: the OKX pager's `after` cursor is a billId ------------------------

_OKX_BILL_BASE = 317_321_390_265_368_576  # an 18-digit billId, as in OKX's own sample row
_OKX_TRADE_BASE = 107_601_752  # a 9-digit tradeId: a different number space from a billId


def _okx_bill_ordered_exchange(total: int) -> Any:
    """A fake OKX `fills-history` that serves `total` SWAP fills newest first and honours `after`
    ONLY as the docs define it: "records earlier than the requested billId" (GET
    /api/v5/trade/fills-history, read 2026-11-27). A tradeId sent as `after` is a 9-digit number
    below every 18-digit billId, so it answers an EMPTY page, which the reader reads as a natural
    end. Rows carry a distinct tradeId and billId. Other instTypes are empty."""
    rows = [
        {
            "instId": "BTC-USDT-SWAP",
            "side": "buy",
            "fillPx": "60000",
            "fillSz": "0.1",
            "fee": "-0.6",
            "feeCcy": "USDT",
            "ts": _OKX_PAGE_TS,
            "ordId": f"ord-{n}",
            "tradeId": str(_OKX_TRADE_BASE + n),
            "billId": str(_OKX_BILL_BASE + n),
            "execType": "T",
        }
        for n in range(total)
    ]
    rows.sort(key=lambda r: int(r["billId"]), reverse=True)

    async def _history(params: dict[str, str]) -> dict[str, Any]:
        if params["instType"] != "SWAP":
            return {"data": []}
        older = [
            r for r in rows if "after" not in params or int(r["billId"]) < int(params["after"])
        ]
        return {"data": older[:100]}

    exchange = MagicMock()
    exchange.id = "okx"
    exchange.private_get_trade_fills_history = _history
    return exchange


class TestOkxPagerCursorIsABillId:
    """R2-CR-01: `_fetch_raw_trades_okx_inst_type` sent `after=<tradeId>`, but OKX defines `after`
    as a billId. Against a venue that reads it that way page 2 came back empty and read as a
    natural end, so each instType kept only its newest 100 fills with no flag."""

    async def test_every_page_is_read_and_exchange_fill_id_stays_the_trade_id(self) -> None:
        ex.get_and_clear_last_dq_flags()
        fills = await ex._fetch_raw_trades_okx(_okx_bill_ordered_exchange(250), None)
        flags = ex.get_and_clear_last_dq_flags()
        assert len(fills) == 250, (
            f"the pager read {len(fills)} of 250 fills: `after` is not the last row's billId"
        )
        assert flags.get("sync_truncated_okx") is None
        assert {f["exchange_fill_id"] for f in fills} == {
            str(_OKX_TRADE_BASE + n) for n in range(250)
        }, "exchange_fill_id is the tradeId, so the stored dedup key is unchanged"


# ---- Review fix WR-01: a Bybit fills read honours the read deadline ------------------------------

_DAY_MS = 86_400_000
_BYBIT_DEADLINE_S = 840.0  # run_sync_trades_job's budget inside the handler's 900 s
_SECONDS_PER_BYBIT_REQUEST = 400.0  # the fake clock's cost of one request


def _slow_bybit_exchange(clock: list[float]) -> Any:
    """A fake Bybit whose every (empty-window) request costs `_SECONDS_PER_BYBIT_REQUEST` of the
    fake clock. Returns the exchange; `exchange.calls` counts the requests."""

    async def _execution_list(params: dict[str, str]) -> dict[str, Any]:
        exchange.calls += 1
        clock[0] += _SECONDS_PER_BYBIT_REQUEST
        return {"result": {"list": [], "nextPageCursor": ""}}

    exchange = MagicMock()
    exchange.id = "bybit"
    exchange.calls = 0
    exchange.private_get_v5_execution_list = _execution_list
    return exchange


async def _slow_bybit_read(monkeypatch: pytest.MonkeyPatch) -> BaseException:
    """Drive the REAL `fetch_raw_trades` over 30 days (five seven-day windows, one request each)
    with the 840 s budget the worker passes; returns the exception it raised."""
    clock = [0.0]
    monkeypatch.setattr(ex, "_monotonic", lambda: clock[0])
    exchange = _slow_bybit_exchange(clock)
    since = int(time.time() * 1000) - 30 * _DAY_MS
    with pytest.raises(ex.BybitTradeWindowIncomplete) as raised:
        await ex.fetch_raw_trades(
            exchange, STRATEGY_ID, MagicMock(), since_ms=since, read_deadline_s=_BYBIT_DEADLINE_S
        )
    # Requests 1 to 3 start at 0, 400 and 800 s, inside the budget; the 4th would start at 1200 s.
    assert exchange.calls == 3, f"the read ran {exchange.calls} requests past its budget"
    return raised.value


class TestBybitReadDeadline:
    """WR-01: only Binance honoured `read_deadline_s`, so a Bybit read longer than the handler's
    900 s was cancelled before the epilogue on every run: no `phase2_fill_ingestion_failed`, no
    cursor advance, and the provisional bound pinned the seed so the next run walked the same span."""

    async def test_a_read_past_the_deadline_refuses_by_name(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        refusal = await _slow_bybit_read(monkeypatch)
        assert isinstance(refusal, ex.BybitTradeWindowIncomplete)
        assert refusal.reason == "deadline"

    async def test_no_deadline_reads_the_whole_span(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # The deadline is opt-in on the reader: a caller that passes none (the ingestion adapter,
        # `fetch_raw` for the teaser and onboarding reads) walks unbounded, as before.
        clock = [0.0]
        monkeypatch.setattr(ex, "_monotonic", lambda: clock[0])
        exchange = _slow_bybit_exchange(clock)
        since = int(time.time() * 1000) - 30 * _DAY_MS
        await ex._fetch_raw_trades_bybit(exchange, since)
        assert exchange.calls == 5

    async def test_the_worker_keeps_the_bound_and_stamps_phase2_failed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The REAL reader's refusal feeds the real `run_sync_trades_job`, which must reach its
        # epilogue (a handler cancel never does).
        refusal = await _slow_bybit_read(monkeypatch)
        bounds = RereadBounds()
        sb, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds)
        out = await _run_job(
            supabase=sb,
            column=CURSOR_AHEAD_TS,
            exchange="bybit",
            daily_trades=DAILY_TRADES_RUN1,
            raw_error=refusal,  # type: ignore[arg-type]
        )
        flags = rec.analytics_upserts[-1]["data_quality_flags"]
        assert flags["phase2_fill_ingestion_failed"] is True
        assert "read budget passed" in flags["phase2_error"]
        assert bounds.rows != {}, "the epilogue keeps the re-read bound over the unread span"
        assert _the_advance(rec)["p_last_fetched_ts"] is None, "the fills cursor is held"
        # Round 2 R2-WR-02: the Bybit read gets the handler budget REMAINING, never more than 840 s.
        deadline = out.fetch_raw.call_args.kwargs["read_deadline_s"]
        assert 0 < deadline <= BINANCE_SYNC_FILLS_READ_DEADLINE_S

    @pytest.mark.parametrize(
        ("venue", "want_s"),
        [
            # INTENT CHANGE 2026-11-28 (Phase 257 SEEDHOLD plan 03): the Bybit read has its own
            # budget, BYBIT_SYNC_FILLS_READ_DEADLINE_S = 420 s, so the persist that now follows a
            # deadline stop fits the 900 s handler; 420 - 100 = 320. The remaining-budget
            # behaviour this test pins is unchanged.
            ("bybit", 320.0),  # Phase 1 used 100 s
            ("binance", BINANCE_SYNC_FILLS_READ_DEADLINE_S),  # the founder-ruled fixed budget
        ],
    )
    async def test_the_bybit_read_gets_the_handler_budget_remaining(
        self, monkeypatch: pytest.MonkeyPatch, venue: str, want_s: float
    ) -> None:
        # A fake handler clock: 0 s at the handler's start, then 100 s once Phase 1 has run.
        ticks = iter([0.0])
        monkeypatch.setattr(jw, "_monotonic", lambda: next(ticks, 100.0))
        bounds = RereadBounds()
        sb, _rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds)
        out = await _run_job(
            supabase=sb,
            column=CURSOR_AHEAD_TS,
            exchange=venue,
            daily_trades=DAILY_TRADES_RUN1,
            raw_fills=[],
        )
        assert out.fetch_raw.call_args.kwargs["read_deadline_s"] == want_s


# ---- Review fix WR-02: the OKX read never sends a `begin` older than the documented reach --------

# Round 2 R2-WR-01: now minus three CALENDAR months plus one day (it was a flat 89 days).
_OKX_BEGIN_FLOOR_MS = 1776340800000  # 2026-04-16T12:00:00Z under the pinned clock
_OKX_BEGIN_FLOOR_ISO = "2026-04-16T12:00:00+00:00"


def _begin_capturing_okx_exchange() -> Any:
    """A fake OKX that answers every page empty and records the params it was sent."""
    sent: list[dict[str, str]] = []

    async def _history(params: dict[str, str]) -> dict[str, Any]:
        sent.append(dict(params))
        return {"data": []}

    exchange = MagicMock()
    exchange.id = "okx"
    exchange.private_get_trade_fills_history = _history
    exchange.sent = sent
    return exchange


class TestOkxBeginStaysInsideTheDocumentedReach:
    """WR-02: OKX documents `fills-history` as "the last 3 months" and says nothing of an older
    `begin`. A retry after a failed first sync seeds from a bound about 93 days old, so the reader
    sent a `begin` at least 93 days old on every page. The sent `begin` is clamped to three calendar
    months plus one day back, and a raised start records the non-holding `okx_fills_reach_clamped`."""

    @pytest.mark.parametrize(
        ("now_iso", "floor_iso"),
        [
            ("2026-07-15T12:00:00.250+00:00", "2026-04-16T12:00:00.250+00:00"),
            ("2026-05-31T09:30:00+00:00", "2026-03-01T09:30:00+00:00"),  # Feb 28 + 1 day (2026)
            ("2028-05-31T00:00:00+00:00", "2028-03-01T00:00:00+00:00"),  # Feb 29 + 1 day (leap)
            ("2026-03-31T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),  # Dec 31 + 1 day, year wrap
            ("2026-11-27T12:00:00+00:00", "2026-08-28T12:00:00+00:00"),
        ],
    )
    def test_the_floor_is_three_calendar_months_plus_one_day(
        self, now_iso: str, floor_iso: str
    ) -> None:
        from datetime import datetime

        now_ms = round(datetime.fromisoformat(now_iso).timestamp() * 1000)
        want_ms = round(datetime.fromisoformat(floor_iso).timestamp() * 1000)
        assert ex._okx_fills_begin_floor_ms(now_ms) == want_ms

    async def test_the_flag_is_set_only_when_the_clamp_raises_the_start(self) -> None:
        for seed, clamped in (
            (REACH_ANCHOR_MS["okx"], True),
            (NOW_MS - 10 * _DAY_MS, False),
            (None, False),
        ):
            ex.get_and_clear_last_dq_flags()
            await ex._fetch_raw_trades_okx(_begin_capturing_okx_exchange(), seed)
            flags = ex.get_and_clear_last_dq_flags()
            assert flags.get("okx_fills_reach_clamped") is (True if clamped else None), (
                f"seed {seed}: {flags}"
            )

    async def test_the_flag_names_the_clamp_but_never_holds_the_cursor(self) -> None:
        # The REAL reader, clamped by an old seed, feeds the real worker.
        async def _history(params: dict[str, str]) -> dict[str, Any]:
            if params["instType"] != "SWAP":
                return {"data": []}
            return {"data": _okx_full_page("c", "c-bill-last")[:1]}

        exchange = MagicMock()
        exchange.id = "okx"
        exchange.private_get_trade_fills_history = _history
        ex.get_and_clear_last_dq_flags()
        fills = await ex._fetch_raw_trades_okx(exchange, REACH_ANCHOR_MS["okx"])
        reader_flags = ex.get_and_clear_last_dq_flags()
        bounds = RereadBounds()
        sb, rec = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds)
        await _run_job(
            supabase=sb,
            column=CURSOR_AHEAD_TS,
            exchange="okx",
            daily_trades=DAILY_TRADES_RUN1,
            raw_fills=fills,
            fills_flags=reader_flags,
        )
        assert reader_flags, "the old seed was clamped and the reader named it"
        assert _the_advance(rec)["p_last_fetched_ts"] is not None, (
            "okx_fills_reach_clamped recurs on every run the seed is old, so it must not hold"
        )
        assert bounds.rows == {}, "the clamp flag must not keep the re-read bound"

    def test_the_hand_typed_floor_matches_its_iso(self) -> None:
        # The pin on the pinned clock's arithmetic, so the two tests below cannot pass vacuously.
        from datetime import datetime

        assert datetime.fromisoformat(_OKX_BEGIN_FLOOR_ISO).timestamp() * 1000 == _OKX_BEGIN_FLOOR_MS

    async def test_a_retry_seeded_from_a_93_day_bound_sends_the_clamped_begin(self) -> None:
        exchange = _begin_capturing_okx_exchange()
        # `fetch_raw_trades` subtracts the 1 h overlap: the seed is the failed first sync's bound,
        # the OKX reach anchor (93 days back) under the pinned clock.
        await ex.fetch_raw_trades(
            exchange, STRATEGY_ID, MagicMock(), since_ms=REACH_ANCHOR_MS["okx"]
        )
        assert exchange.sent, "the fake OKX saw no request"
        assert {p["begin"] for p in exchange.sent} == {str(_OKX_BEGIN_FLOOR_MS)}, (
            "a `begin` older than the documented 3-month reach was sent to OKX"
        )

    async def test_a_begin_inside_the_reach_is_sent_as_it_is(self) -> None:
        exchange = _begin_capturing_okx_exchange()
        since = NOW_MS - 10 * _DAY_MS
        await ex.fetch_raw_trades(exchange, STRATEGY_ID, MagicMock(), since_ms=since)
        assert {p["begin"] for p in exchange.sent} == {str(since - ex.OVERLAP_WINDOW_MS)}

    async def test_no_seed_sends_no_begin(self) -> None:
        exchange = _begin_capturing_okx_exchange()
        await ex.fetch_raw_trades(exchange, STRATEGY_ID, MagicMock(), since_ms=None)
        assert exchange.sent and all("begin" not in p for p in exchange.sent)
