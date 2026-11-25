"""Phase 250 BINANCEFILLS plan 04 (SC-1, SC-5): the Binance fills window walk, arm by arm.

WHY. 250-03 built the walk (`_fetch_raw_trades_binance`: since-aligned windows, an explicit
`until` on every request, a reach clamp, a 24-hour spot window) and proved the quiet stretch end
to end. A walk proven only on its happy path regresses silently on exactly the paths the venue
rules make dangerous: a start older than the venue's reach, an exclusive end, the 24-hour spot
rule, a venue that ignores `endTime`, the nightly reconcile's request shape, a same-millisecond
cluster. Each arm below pins one of them and has a named neuter of the production code that turns
it RED.

Every test drives the REAL `fetch_raw_trades` against `BinanceFillsVenue` on a real
`ccxt.binance` (`tests/_binance_fills.py`): ccxt's own `fetch_my_trades` (market routing, `until`
handling, the implicit linear `endTime` cap, `parse_trades`) runs unchanged, only its HTTP-method
layer is the venue's. Expected call sequences are read from the venue's `calls` log, never derived
from the code under test, and assertions are per symbol (the default fake has no suspension
point, so the per-symbol tasks run one after another and are not assumed to interleave).

INSTANTS. Hand-typed, each with its ISO form beside it (the table lives in 250-01-PLAN.md):
  NOW_MS               = 1795176000000   2026-11-20T12:00:00Z (the pinned clock)
  reach start          = 1787832000000   2026-08-27T12:00:00Z (NOW_MS - 85 days)
  NOW_MS - 120 days    = 1784808000000   2026-07-23T12:00:00Z
  NOW_MS - 60 days     = 1789992000000   2026-09-21T12:00:00Z
  NOW_MS - 25 h        = 1795086000000   2026-11-19T11:00:00Z
  NOW_MS - 24 h        = 1795089600000   2026-11-19T12:00:00Z

PROOF-01 NEUTER (each recorded verbatim in the 250-04 SUMMARY, restored from a byte backup of
`services/exchange.py` with `cp` and checked with `cmp`):
  N1r delete `params={"until": window_end}` from the `fetch_my_trades` call:
      test_a_reconcile_window_is_one_request_per_symbol_ending_now goes RED.
  N2  request with `since=None` when `since_ms` is None (no reach start):
      test_a_missing_start_walks_from_the_reach_never_a_startless_request goes RED.
  N3  start at `since_ms` even when it is older than the reach (drop the clamp):
      test_a_seed_older_than_the_reach_is_clamped_and_named (both parametrizations) and the e2e arm
      test_a_seed_older_than_the_reach_is_clamped_named_and_not_held go RED.
  N4  window span `window_ms + 1` instead of `window_ms - 1`:
      test_no_request_spans_more_than_one_window goes RED.
  N5  the next window starts at `window_end + 1` (no 1 ms overlap):
      test_a_fill_on_a_window_boundary_is_read_with_an_exclusive_end goes RED.
  N17 `_binance_fills_window_ms` returns the 7-day window for a spot market:
      test_a_spot_only_symbol_walks_one_day_windows goes RED.
  N18 delete the out-of-window check (`BinanceFillsOutOfWindow`):
      test_a_row_outside_its_window_is_refused_by_name goes RED.
  N19 delete the +1 step inside the same-millisecond block:
      test_a_full_page_on_one_millisecond_steps_past_it goes RED.
  N22 record `binance_fill_cursor_advance_plus1` with `_record_dq_flag` inside `_fetch_one`
      (the pre-250 placement) instead of carrying it in `advanced_plus1`:
      test_a_full_page_on_one_millisecond_steps_past_it goes RED on its flag assertion.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio

import services.exchange as ex
from tests._binance_fills import (
    NOW_MS,
    BinanceFillsVenue,
    real_binance,
    symbols_supabase,
    venue_fill,
)

STRATEGY_ID = "strat-250-walk"

HOUR_MS = 3_600_000
DAY_MS = 86_400_000
REACH_START_MS = 1787832000000  # 2026-08-27T12:00:00Z (NOW_MS - 85 days)
NOW_MINUS_120D_MS = 1784808000000  # 2026-07-23T12:00:00Z
NOW_MINUS_60D_MS = 1789992000000  # 2026-09-21T12:00:00Z


@pytest.fixture(autouse=True)
def _pinned_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    # raising=False: the same fixture runs on code that predates the ``_now_ms`` seam.
    monkeypatch.setattr(ex, "_now_ms", lambda: NOW_MS, raising=False)


@pytest_asyncio.fixture
async def open_exchanges() -> AsyncIterator[list[Any]]:
    """Every ccxt instance a test opens, closed in teardown."""
    opened: list[Any] = []
    yield opened
    for exchange in opened:
        await exchange.close()


async def _read(
    open_exchanges: list[Any],
    venue: BinanceFillsVenue,
    symbols: list[str],
    since_ms: int | None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """The REAL `fetch_raw_trades` on a venue-faked real ccxt.binance, then the drained flags."""
    exchange = await real_binance(venue)
    open_exchanges.append(exchange)
    fills = await ex.fetch_raw_trades(
        exchange, STRATEGY_ID, symbols_supabase(symbols), since_ms=since_ms
    )
    return fills, ex.get_and_clear_last_dq_flags()


def _ids(fills: list[dict[str, Any]], symbol: str | None = None) -> set[str]:
    return {
        str(f["exchange_fill_id"]) for f in fills if symbol is None or f["symbol"] == symbol
    }


class TestBinanceFillsWindowWalk:
    async def test_a_missing_start_walks_from_the_reach_never_a_startless_request(
        self, open_exchanges: list[Any]
    ) -> None:
        """SC-1 (CONTEXT [Window walk, R2-02] "Seed when `since_ms` is None?"): with no seed
        the walk starts `BINANCE_FILLS_REACH_DAYS` back. A request with no `startTime` would be
        served by the venue as "the last 7 days" while ccxt adds no `endTime` window rule, so
        the walk would silently read the wrong span."""
        venue = BinanceFillsVenue(
            {("linear", "BTCUSDT"): [venue_fill("linear", "BTCUSDT", 1, NOW_MINUS_60D_MS)]}
        )

        fills, flags = await _read(open_exchanges, venue, ["BTCUSDT"], None)

        assert _ids(fills) == {"1"}
        calls = venue.calls_for("linear")
        assert calls, "the venue was never asked"
        for request in calls:
            assert "startTime" in request and "endTime" in request, request
        assert calls[0]["startTime"] == REACH_START_MS
        assert "binance_fills_reach_clamped" not in flags
        assert "binance_partial_symbols" not in flags

    @pytest.mark.parametrize("out_of_reach", ["raise", "empty"])
    async def test_a_seed_older_than_the_reach_is_clamped_and_named(
        self, open_exchanges: list[Any], out_of_reach: str
    ) -> None:
        """SC-1 (CONTEXT [Window walk, R2-02] "A seed older than the venue's 3-month reach?"):
        a seed 120 days old starts at the reach and records `binance_fills_reach_clamped`, a
        NON-holding flag. The venue's behaviour for an out-of-reach start is UNMEASURED, so
        both readings are modelled: it refuses the request (`raise`) or serves nothing
        (`empty`). Either way no request is sent older than the reach, so no out-of-reach
        window is ever read as quiet and no symbol turns partial."""
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", 1, NOW_MINUS_120D_MS),
                    venue_fill("linear", "BTCUSDT", 2, NOW_MINUS_60D_MS),
                ]
            },
            out_of_reach=out_of_reach,
        )

        fills, flags = await _read(open_exchanges, venue, ["BTCUSDT"], NOW_MINUS_120D_MS)

        assert flags.get("binance_fills_reach_clamped") is True
        assert "binance_partial_symbols" not in flags
        calls = venue.calls_for("linear")
        assert calls[0]["startTime"] == REACH_START_MS
        assert all(request["startTime"] >= REACH_START_MS for request in calls), calls
        assert _ids(fills) == {"2"}
