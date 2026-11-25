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
from unittest.mock import AsyncMock

import inspect

import ccxt
import pytest
import pytest_asyncio

import services.exchange as ex
from services.job_worker import TIMEOUT_PER_KIND
from tests._binance_fills import (
    NOW_MS,
    recorded_markets,
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
    **exchange_switches: Any,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """The REAL `fetch_raw_trades` on a venue-faked real ccxt.binance, then the drained flags.
    `exchange_switches` are `real_binance`'s additive keywords (`markets_loaded`, `market_order`)."""
    exchange = await real_binance(venue, **exchange_switches)
    open_exchanges.append(exchange)
    fills = await ex.fetch_raw_trades(
        exchange, STRATEGY_ID, symbols_supabase(symbols), since_ms=since_ms
    )
    return fills, ex.get_and_clear_last_dq_flags()


def _strip(unified_symbol: str) -> str:
    """The stored-name strip `normalize_symbol` applies to a ccxt unified symbol."""
    return unified_symbol.replace("/", "").replace(":USDT", "").replace(":USD", "")


# The dated future's stored name, derived from the cassette with the same strip.
_DATED_FUTURE_STRIP = next(
    _strip(m["symbol"]) for m in recorded_markets() if m["type"] == "future"
)


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

    async def test_no_request_spans_more_than_one_window(
        self, open_exchanges: list[Any]
    ) -> None:
        """SC-1 (CONTEXT [Window walk, R2-02] "Shape of the fix?"): the venue refuses a span
        over 7 days (futures), so every request carries both bounds and spans at most
        7 days - 1 ms (604799999). The seed is 2026-10-21T12:00:00Z, 30 days before the
        clock, so the read is several windows long; the venue fake raises on a longer span, which
        would hold the symbol, so the assertion is on the calls the venue actually received."""
        c_ms = 1792584000000  # 2026-10-21T12:00:00Z
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", 1, c_ms),
                    venue_fill("linear", "BTCUSDT", 2, NOW_MS - 3 * DAY_MS),
                ]
            }
        )

        fills, flags = await _read(open_exchanges, venue, ["BTCUSDT"], c_ms)

        calls = venue.calls_for("linear")
        assert len(calls) >= 4, "a 30-day read must take several 7-day windows"
        for request in calls:
            assert "startTime" in request and "endTime" in request, request
            assert 0 < request["endTime"] - request["startTime"] <= 604799999, request
        assert _ids(fills) == {"1", "2"}
        assert "binance_partial_symbols" not in flags

    async def test_a_fill_on_a_window_boundary_is_read_with_an_exclusive_end(
        self, open_exchanges: list[Any]
    ) -> None:
        """SC-1: whether the venue's `endTime` is inclusive is UNMEASURED. With an exclusive
        end, a fill exactly on the first window's last millisecond belongs to no window unless
        the next window starts at (not after) the previous end, the 1 ms overlap the trades
        unique index absorbs. The first window starts one overlap hour before the seed
        (2026-10-21T11:00:00Z = 1792580400000), so it ends at
        1792580400000 + 604799999 = 1793185199999 (2026-10-28T10:59:59.999Z)."""
        c_ms = 1792584000000  # 2026-10-21T12:00:00Z
        first_end_ms = 1793185199999  # 2026-10-28T10:59:59.999Z
        venue = BinanceFillsVenue(
            {("linear", "BTCUSDT"): [venue_fill("linear", "BTCUSDT", 7, first_end_ms)]},
            exclusive_end=True,
        )

        fills, flags = await _read(open_exchanges, venue, ["BTCUSDT"], c_ms)

        calls = venue.calls_for("linear")
        assert calls[0]["endTime"] == first_end_ms, "the first window ends where the fixture says"
        assert "7" in _ids(fills), "the fill on the first window's end was never read"
        assert "binance_partial_symbols" not in flags

    async def test_a_spot_only_symbol_walks_one_day_windows(
        self, open_exchanges: list[Any]
    ) -> None:
        """SC-1 (research N17): a stored spot-only name (`ETHBTC`, resolved by the existing
        reverse map to the spot market `ETH/BTC`) is read in 24-hour windows, because the spot
        `myTrades` endpoint refuses a span over 24 hours. A 7-day window sent to it would be
        refused (and hold the symbol), and a start-only request serves one 24-hour window, so
        the later of two fills 3 days apart would be lost."""
        venue = BinanceFillsVenue(
            {
                ("spot", "ETHBTC"): [
                    venue_fill("spot", "ETHBTC", 11, NOW_MS - 5 * DAY_MS),
                    venue_fill("spot", "ETHBTC", 12, NOW_MS - 2 * DAY_MS),
                ]
            }
        )

        fills, flags = await _read(open_exchanges, venue, ["ETHBTC"], NOW_MS - 6 * DAY_MS)

        assert _ids(fills) == {"11", "12"}
        assert "binance_partial_symbols" not in flags
        assert venue.calls_for("linear") == [] and venue.calls_for("inverse") == []
        calls = venue.calls_for("spot")
        assert len(calls) >= 6, "6 days of 24-hour windows"
        for request in calls:
            assert "startTime" in request and "endTime" in request, request
            assert 0 < request["endTime"] - request["startTime"] <= 86399999, request

    async def test_a_row_outside_its_window_is_refused_by_name(
        self,
        open_exchanges: list[Any],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """SC-1 / T-250-01: a venue that ignores `endTime` serves BTCUSDT [startTime, now]
        whatever window was asked for, so the first window's reply holds a fill 3 days before
        the clock, long past that window's end. The walk must not trust it: the symbol fails
        inside its own task, is named in the HOLDING `binance_partial_symbols`, and none of
        its rows is returned. The healthy ETHUSDT symbol is read in full."""
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", 21, NOW_MS - 19 * DAY_MS),
                    venue_fill("linear", "BTCUSDT", 22, NOW_MS - 3 * DAY_MS),
                ],
                ("linear", "ETHUSDT"): [
                    venue_fill("linear", "ETHUSDT", 31, NOW_MS - 19 * DAY_MS),
                    venue_fill("linear", "ETHUSDT", 32, NOW_MS - 3 * DAY_MS),
                ],
            },
            ignore_end_for=frozenset({"BTCUSDT"}),
        )

        with caplog.at_level("WARNING"):
            fills, flags = await _read(
                open_exchanges, venue, ["BTCUSDT", "ETHUSDT"], NOW_MS - 20 * DAY_MS
            )

        assert flags["binance_partial_symbols"] == ["BTCUSDT"]
        assert {"21", "22"} & _ids(fills) == set(), "a refused symbol's rows must never be returned"
        assert _ids(fills) == {"31", "32"}
        assert any(
            "BTCUSDT" in record.getMessage() and record.levelname == "WARNING"
            for record in caplog.records
        ), "the refusal must be named in a WARNING"

    async def test_a_reconcile_window_is_one_request_per_symbol_ending_now(
        self, open_exchanges: list[Any]
    ) -> None:
        """T-250-03 (research N1 at the reconcile arm): the nightly reconcile reads
        `since = now - 24 h`, which is LIVE in PROD. After the one overlap hour that is a start
        of NOW_MS - 25 h = 1795086000000 (2026-11-19T11:00:00Z) and the whole read fits one
        7-day window, so each symbol costs exactly ONE request, now carrying an explicit
        `endTime` = the read's one clock instant (1795176000000, 2026-11-20T12:00:00Z). Without
        the explicit end the request depends on ccxt's implicit cap."""
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [venue_fill("linear", "BTCUSDT", 1, NOW_MS - 3 * HOUR_MS)],
                ("linear", "ETHUSDT"): [venue_fill("linear", "ETHUSDT", 2, NOW_MS - 2 * HOUR_MS)],
            }
        )

        fills, flags = await _read(
            open_exchanges, venue, ["BTCUSDT", "ETHUSDT"], 1795089600000  # NOW_MS - 24 h
        )

        assert _ids(fills) == {"1", "2"}
        assert "binance_partial_symbols" not in flags
        for venue_id in ("BTCUSDT", "ETHUSDT"):
            requests = [r for r in venue.calls_for("linear") if r["symbol"] == venue_id]
            assert len(requests) == 1, (venue_id, requests)
            assert requests[0]["startTime"] == 1795086000000, requests
            assert requests[0]["endTime"] == 1795176000000, requests

    async def test_a_same_millisecond_cluster_across_pages_is_read_in_full(
        self, open_exchanges: list[Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """NEW-C13-03: the cursor advances to the last row's timestamp WITHOUT +1, so two fills
        sharing one millisecond are never lost when the page boundary falls between them. With
        a page of 3 the first page ends on the first of the two fills on T, the second page
        restarts at T and re-serves it. Every page after the first re-serves its boundary row,
        so the assertion is on the SET of fill ids.

        T = 1795089600000 (2026-11-19T12:00:00Z, NOW_MS - 24 h), inside the walk's one window."""
        monkeypatch.setattr(ex, "BINANCE_FILLS_PAGE_LIMIT", 3)
        t_ms = 1795089600000
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", 51, t_ms - 2000),
                    venue_fill("linear", "BTCUSDT", 52, t_ms - 1000),
                    venue_fill("linear", "BTCUSDT", 53, t_ms),
                    venue_fill("linear", "BTCUSDT", 54, t_ms),
                    venue_fill("linear", "BTCUSDT", 55, t_ms + 1000),
                ]
            }
        )

        fills, flags = await _read(open_exchanges, venue, ["BTCUSDT"], NOW_MS - 2 * DAY_MS)

        assert _ids(fills) == {"51", "52", "53", "54", "55"}
        assert "binance_partial_symbols" not in flags
        assert len(venue.calls_for("linear")) >= 3, "the cluster must straddle a page boundary"

    async def test_a_full_page_on_one_millisecond_steps_past_it(
        self, open_exchanges: list[Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """red-team/H-4: a full page lying entirely on the window's first millisecond leaves the
        cursor where it was, so the walk takes the +1 step to get past it instead of asking for
        the same page again until the page cap. The step is recorded as
        `binance_fill_cursor_advance_plus1`, and it must reach the DRAIN: the per-symbol reads
        run in gathered tasks that hold a copy of the context, so only the parent can record it.

        The window starts at W = 1794999600000 (2026-11-18T11:00:00Z: the seed
        NOW_MS - 2 days, one overlap hour back). Three fills sit on W, two follow."""
        monkeypatch.setattr(ex, "BINANCE_FILLS_PAGE_LIMIT", 3)
        w_ms = 1794999600000
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", 41, w_ms),
                    venue_fill("linear", "BTCUSDT", 42, w_ms),
                    venue_fill("linear", "BTCUSDT", 43, w_ms),
                    venue_fill("linear", "BTCUSDT", 44, w_ms + 1000),
                    venue_fill("linear", "BTCUSDT", 45, w_ms + 2000),
                ]
            }
        )

        fills, flags = await _read(open_exchanges, venue, ["BTCUSDT"], NOW_MS - 2 * DAY_MS)

        assert venue.calls_for("linear")[0]["startTime"] == w_ms
        assert _ids(fills) == {"41", "42", "43", "44", "45"}
        assert flags.get("binance_fill_cursor_advance_plus1") is True
        assert "binance_partial_symbols" not in flags

    def test_the_walk_constants_are_pinned(self) -> None:
        """CONTEXT [Page cap stop]: "BINANCE_PAGE_CAP stays 20". Raising a cap is not a close
        of the page-cap survivor (Phase 232 precedent), and the window and reach constants are
        the venue rules the walk was derived from."""
        assert ex.BINANCE_PAGE_CAP == 20
        assert ex.BINANCE_FILLS_PAGE_LIMIT == 1000
        assert ex.BINANCE_FILLS_WINDOW_DAYS == 7
        assert ex.BINANCE_SPOT_FILLS_WINDOW_HOURS == 24
        assert ex.BINANCE_FILLS_REACH_DAYS == 85


class TestBinanceFillsSymbols:
    """Phase 250 BINANCEFILLS plan 05 (SC-2, SC-5): which stored names are named and which hold.

    Only a `ccxt.BadSymbol` (ccxt raises it client-side for a name absent from the loaded
    markets, and maps the venue codes -1108, -1121 and -20121 to it) skips a symbol without
    holding the cursor; it is named in `binance_unlisted_symbols` on every run. Every other
    failure keeps the holding `binance_partial_symbols`. The all-failed raise counts both.

    PROOF-01 NEUTER (recorded verbatim in the 250-05 SUMMARY, restored from a byte backup of
    `services/exchange.py` with `cp` and checked with `cmp`):
      N6  remove the `isinstance(item, ccxt.BadSymbol)` branch:
          test_an_unlisted_symbol_is_named_and_not_held goes RED.
      N8b compare `len(failed_symbols)` alone in the total-failure raise:
          test_every_symbol_unlisted_still_raises goes RED.
      N14 remove the `load_markets()` call before the reverse map:
          test_unloaded_markets_are_loaded_before_the_map goes RED.
      N15 remove the spot precedence in the map build (last write wins):
          test_a_strip_collision_resolves_to_the_derivative_whatever_the_order goes RED.
      N23 widen the unlisted branch from `ccxt.BadSymbol` to every exception:
          test_a_transient_failure_keeps_the_hold goes RED.
      R1-N1 (round-1 review SFH-3) choose the window with `exchange.markets.get(ccxt_symbol)`
          instead of `exchange.market(ccxt_symbol)`:
          test_a_name_ccxt_resolves_by_venue_id_is_windowed_by_that_market goes RED.
    """

    async def test_an_unlisted_symbol_is_named_and_not_held(
        self, open_exchanges: list[Any], caplog: pytest.LogCaptureFixture
    ) -> None:
        """SC-2: DELISTEDUSDT is absent from the markets, so ccxt raises BadSymbol for it. It
        is named in `binance_unlisted_symbols`, NOT in the holding `binance_partial_symbols`,
        and the healthy ETHUSDT fills past C + 7 days are returned."""
        c_ms = 1792584000000  # 2026-10-21T12:00:00Z
        venue = BinanceFillsVenue(
            {
                ("linear", "ETHUSDT"): [
                    venue_fill("linear", "ETHUSDT", 1, c_ms),
                    venue_fill("linear", "ETHUSDT", 2, NOW_MS - 5 * DAY_MS),
                ]
            }
        )

        with caplog.at_level("WARNING"):
            fills, flags = await _read(
                open_exchanges, venue, ["ETHUSDT", "DELISTEDUSDT"], c_ms
            )

        assert flags.get("binance_unlisted_symbols") == ["DELISTEDUSDT"]
        assert "binance_partial_symbols" not in flags
        assert _ids(fills, "ETHUSDT") == {"1", "2"}
        assert any(
            "DELISTEDUSDT" in record.getMessage() and record.levelname == "WARNING"
            for record in caplog.records
        ), "the unlisted symbol must be named in a WARNING"

    async def test_every_symbol_unlisted_still_raises(
        self, open_exchanges: list[Any]
    ) -> None:
        """RESEARCH Pitfall 3: when EVERY symbol failed or was unlisted the read looks empty
        and would cement a zero-fills success, so `BinancePerSymbolFetchError` is still raised,
        naming both."""
        venue = BinanceFillsVenue({})

        with pytest.raises(ex.BinancePerSymbolFetchError) as excinfo:
            await _read(open_exchanges, venue, ["DELISTEDUSDT", "GONEUSDT"], NOW_MS - 2 * DAY_MS)

        assert set(excinfo.value.failed_symbols) == {"DELISTEDUSDT", "GONEUSDT"}
        ex.get_and_clear_last_dq_flags()

    async def test_a_transient_failure_keeps_the_hold(
        self, open_exchanges: list[Any]
    ) -> None:
        """T-250-09: only a BadSymbol skips without a hold. ETHUSDT is LISTED but its venue
        requests raise `ccxt.NetworkError`, so it stays in the HOLDING `binance_partial_symbols`
        (the cursor gate re-reads its span on the next clean run), never in the non-holding
        unlisted flag. The healthy BTCUSDT fills are still returned."""
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [venue_fill("linear", "BTCUSDT", 1, NOW_MS - 3 * DAY_MS)],
                ("linear", "ETHUSDT"): [venue_fill("linear", "ETHUSDT", 2, NOW_MS - 3 * DAY_MS)],
            }
        )
        venue.effects["ETHUSDT"] = ccxt.NetworkError("simulated venue fault")

        fills, flags = await _read(
            open_exchanges, venue, ["BTCUSDT", "ETHUSDT"], NOW_MS - 5 * DAY_MS
        )

        assert flags.get("binance_partial_symbols") == ["ETHUSDT"]
        assert "binance_unlisted_symbols" not in flags
        assert _ids(fills) == {"1"}

    async def test_unloaded_markets_are_loaded_before_the_map(
        self, open_exchanges: list[Any]
    ) -> None:
        """SC-2 map (T-250-12): the reconcile and the onboarding read hand the walk an exchange
        whose markets are NOT loaded. The reverse map was then empty, a stored `BTCUSDT` went to
        ccxt raw and ccxt routed it to SPOT: the 7-day window was refused by the 24-hour spot rule
        and 0 fills were read. With markets loaded first the stored name maps to
        `BTC/USDT:USDT`, so the linear endpoint answers, the fill is returned and the spot
        endpoint is never asked."""
        venue = BinanceFillsVenue(
            {("linear", "BTCUSDT"): [venue_fill("linear", "BTCUSDT", 1, NOW_MS - 3 * DAY_MS)]}
        )

        fills, flags = await _read(
            open_exchanges, venue, ["BTCUSDT"], NOW_MS - 5 * DAY_MS, markets_loaded=False
        )

        assert _ids(fills) == {"1"}
        assert len(venue.calls_for("linear")) >= 1
        assert venue.calls_for("spot") == [], "a stored linear name was read from the spot endpoint"
        assert "binance_partial_symbols" not in flags

    @pytest.mark.parametrize(
        "market_order",
        [
            pytest.param(None, id="recorded-order"),
            pytest.param(["BTC/USDT:USDT", "BTC/USDT"], id="spot-listed-after-linear"),
        ],
    )
    async def test_a_strip_collision_resolves_to_the_derivative_whatever_the_order(
        self, open_exchanges: list[Any], market_order: list[str] | None
    ) -> None:
        """SC-2 map (T-250-12; RESEARCH Q1 measured 451 collisions on the live metadata, every
        one a linear swap against a spot market): spot `BTC/USDT` and swap `BTC/USDT:USDT`
        both strip to the stored name `BTCUSDT`. A last-write-wins map resolved it by which one
        the venue listed last. The derivative wins by rule, so stored BTCUSDT reads the linear
        endpoint whatever the order."""
        venue = BinanceFillsVenue(
            {("linear", "BTCUSDT"): [venue_fill("linear", "BTCUSDT", 1, NOW_MS - 3 * DAY_MS)]}
        )

        fills, flags = await _read(
            open_exchanges,
            venue,
            ["BTCUSDT"],
            NOW_MS - 5 * DAY_MS,
            market_order=market_order,
        )

        assert _ids(fills) == {"1"}
        assert venue.calls_for("spot") == [], "the spot market replaced the derivative"
        assert "binance_partial_symbols" not in flags

    @pytest.mark.parametrize(
        ("stored", "kind", "venue_id"),
        [
            pytest.param("BTCUSDCC", "linear", "BTCUSDC", id="usdc-margined-linear"),
            pytest.param("BTCUSD:BTC", "inverse", "BTCUSD_PERP", id="coin-margined-inverse"),
            pytest.param(_DATED_FUTURE_STRIP, "linear", "BTCUSDT_261225", id="dated-future"),
            pytest.param("BTCUSDC", "spot", "BTCUSDC", id="spot-usdc"),
            pytest.param("ETHBTC", "spot", "ETHBTC", id="spot-only"),
        ],
    )
    async def test_each_stored_shape_resolves_to_its_endpoint(
        self, open_exchanges: list[Any], stored: str, kind: str, venue_id: str
    ) -> None:
        """SC-2 map (RESEARCH Q1 stored-shape table): every shape `normalize_symbol` stores
        resolves through the loaded markets to its own endpoint, and only that endpoint is asked.
        The dated future's stored form is derived from the cassette with the same strip
        expression `normalize_symbol` uses. A spot name is read in 24-hour windows."""
        venue = BinanceFillsVenue(
            {(kind, venue_id): [venue_fill(kind, venue_id, 7, NOW_MS - 3 * HOUR_MS)]}
        )

        fills, flags = await _read(open_exchanges, venue, [stored], NOW_MS - 2 * DAY_MS)

        assert _ids(fills) == {"7"}
        assert len(venue.calls_for(kind)) >= 1
        for other in {"linear", "inverse", "spot"} - {kind}:
            assert venue.calls_for(other) == [], (stored, other)
        assert "binance_partial_symbols" not in flags
        assert "binance_unlisted_symbols" not in flags

    async def test_a_name_ccxt_resolves_by_venue_id_is_windowed_by_that_market(
        self, open_exchanges: list[Any]
    ) -> None:
        """SFH-3 (round-1 review): the window is chosen from the market ccxt will route to
        (`exchange.market()`), not from `exchange.markets.get(name)`. `markets` is keyed by
        unified symbol, so a name that is a VENUE ID misses `.get()` while ccxt resolves it by
        id, spot first, and sends it to the spot endpoint, whose 24-hour rule refuses a 7-day
        window for good (the holding `binance_partial_symbols`).

        The recorded markets always map their own stored names, so the miss is built here: the
        spot `ETH/BTC` entry is re-keyed, which drops the stored name `ETHBTC` from the reverse
        map and leaves it resolvable by id only. Both fills (3 days apart) must be read through
        24-hour windows from the spot endpoint, with nothing partial."""
        venue = BinanceFillsVenue(
            {
                ("spot", "ETHBTC"): [
                    venue_fill("spot", "ETHBTC", 1, NOW_MS - 4 * DAY_MS),
                    venue_fill("spot", "ETHBTC", 2, NOW_MS - 1 * DAY_MS),
                ]
            }
        )
        exchange = await real_binance(venue)
        open_exchanges.append(exchange)
        exchange.markets = {
            ("ETH/BTC#by-id-only" if sym == "ETH/BTC" else sym): market
            for sym, market in exchange.markets.items()
        }
        assert exchange.markets.get("ETHBTC") is None
        assert exchange.market("ETHBTC")["spot"] is True

        fills = await ex.fetch_raw_trades(
            exchange, STRATEGY_ID, symbols_supabase(["ETHBTC"]), since_ms=NOW_MS - 5 * DAY_MS
        )
        flags = ex.get_and_clear_last_dq_flags()

        assert _ids(fills) == {"1", "2"}
        assert "binance_partial_symbols" not in flags
        requests = venue.calls_for("spot")
        assert requests and all(
            r["endTime"] - r["startTime"] < DAY_MS for r in requests
        ), "a spot request spanned more than the 24-hour rule"


class TestBinanceFillsStops:
    """Phase 250 BINANCEFILLS plan 06 (SC-3, SC-5): every early stop of a symbol's walk is named
    with ONE read-through bound the cursor gate stamps at.

    A symbol whose window holds more fills than `BINANCE_PAGE_CAP` pages serve stops its walk
    and is named in `binance_page_cap_symbols`; a full page whose last row has no timestamp is
    named in `binance_untimed_page_symbols`. Both carry a bound (the newest fill the walk read)
    and `binance_read_through_ms` is recorded ONCE, as the minimum over every stopped symbol
    (RESEARCH Pitfall 7: `_record_dq_flag` SUMS two ints, so a per-symbol record would stamp
    past the older symbol's unread fills).

    PROOF-01 NEUTER (each recorded verbatim in the 250-06 SUMMARY, restored from a byte backup
    of `services/exchange.py` with `cp` and checked with `cmp`):
      N9  delete the `_record_dq_flag` call for `binance_page_cap_symbols`:
          test_a_capped_window_is_named_with_its_read_through_bound goes RED.
      N21 delete the cap branch's WARNING call in `_fetch_one`:
          test_a_capped_window_is_named_with_its_read_through_bound goes RED (caplog).
      N16 record `binance_read_through_ms` once per stopped symbol instead of once as the min:
          test_two_stopped_symbols_record_the_smaller_bound_once goes RED.
      N25 delete the `_record_dq_flag` call for `binance_untimed_page_symbols` and drop the
          untimed kind from the bounds list:
          test_a_page_it_cannot_page_past_is_named_with_a_bound goes RED.
      N29 count every full page toward the cap (the overlap exemption always false):
          tests/test_binancefills_e2e.py
          test_a_cap_stamp_whose_overlap_hour_is_full_resumes_past_the_cap goes RED.

    Plan 07 adds the read DEADLINE as a third stop (SC-3, T-250-10): checked inside the semaphore
    immediately before EVERY request, exempt overlap pages included, so no request passes it.
    A stopped symbol keeps what it read and carries a bound by the same rule as the cap (the
    newest fill read in the current window, else that window's start minus 1 ms, a symbol that
    sent no request at the walk start minus 1 ms). The sync job reads with a longer budget than
    the nightly reconcile (founder ruling 2026-11-25 UTC): the nightly must stay inside its 300 s
    handler, the sync owns a cursor and needs the long budget to shrink the quiet-prefix region.
      N13 delete the deadline check in `_fetch_one`:
          test_a_deadline_stops_every_symbol_with_a_read_through_bound goes RED (all four cases,
          case (d) because the exempt overlap page no longer stops the walk).
      N27 `fetch_raw_trades` calls `_fetch_raw_trades_binance` without the keyword:
          test_the_read_budget_reaches_the_walk_through_fetch_raw_trades goes RED.
      (N24, N26 and N28 live in tests/test_binancefills_e2e.py.)
    """

    async def test_a_capped_window_is_named_with_its_read_through_bound(
        self, open_exchanges: list[Any], caplog: pytest.LogCaptureFixture
    ) -> None:
        """SC-3 producer, REAL constants (20 pages x 1000): one linear symbol holds 21,000 fills
        one second apart inside ONE window, every one at or after the `since_ms` passed (so no
        page re-reads the overlap). The walk reads exactly 20 pages in that window and asks for
        no later window. The walk advances `since` to the last row's timestamp without +1, so
        every page after the first re-serves its boundary row: 20 x 1000 = 20,000 rows hold the
        oldest 19,981 DISTINCT fills (ids 1..19981). The symbol is named, the bound is the
        19,981st fill's timestamp (the newest it read), and the cap WARNING names it.

        f(k) = 1792587600000 + 1000 x (k - 1): f(1) = 1792587600000 (2026-10-21T13:00:00Z),
        f(19981) = 1792607580000 (2026-10-21T18:33:00Z), f(21000) = 1792608599000. The seed is
        f(1); the walk starts one overlap hour back at 1792584000000 (2026-10-21T12:00:00Z) and
        its one window ends at 1793188799999 (2026-10-28T11:59:59.999Z)."""
        first_ms = 1792587600000  # f(1) 2026-10-21T13:00:00Z
        bound_ms = 1792607580000  # f(19981) 2026-10-21T18:33:00Z
        window_end_ms = 1793188799999  # 2026-10-28T11:59:59.999Z
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", k, first_ms + 1000 * (k - 1))
                    for k in range(1, 21001)
                ]
            }
        )

        with caplog.at_level("WARNING"):
            fills, flags = await _read(open_exchanges, venue, ["BTCUSDT"], first_ms)

        requests = venue.calls_for("linear")
        assert len(requests) == 20, f"expected exactly 20 pages, got {len(requests)}"
        assert {r["endTime"] for r in requests} == {window_end_ms}, "a later window was asked for"
        assert len(fills) == 20_000
        ids = _ids(fills)
        assert len(ids) == 19_981, f"{len(ids)} distinct fills"
        missing = [k for k in range(1, 19_982) if str(k) not in ids]
        assert not missing, f"first missing oldest fill id: {missing[0]}"
        assert flags.get("binance_page_cap_symbols") == ["BTCUSDT"]
        assert flags.get("binance_read_through_ms") == bound_ms
        assert "binance_partial_symbols" not in flags
        cap_warnings = [
            record
            for record in caplog.records
            if record.levelname == "WARNING"
            and "page cap" in record.getMessage()
            and "BTCUSDT" in record.getMessage()
        ]
        assert len(cap_warnings) == 1, "exactly one cap WARNING must name the symbol"

    async def test_two_stopped_symbols_record_the_smaller_bound_once(
        self, open_exchanges: list[Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """RESEARCH Pitfall 7 (T-250-11): two symbols cap at DIFFERENT instants beside a healthy
        third. `binance_read_through_ms` is the SMALLER bound and is recorded by exactly ONE
        `_record_dq_flag` call: `_record_dq_flag` SUMS two ints, so a record per symbol would
        stamp the sum, an instant after BOTH bounds, past the older symbol's unread fills.

        Lowered caps (3 rows a page, 2 pages: a symbol caps at its fifth fill in a window; the
        healthy symbol carries two). Every fill is after the `since_ms` passed, so no page is
        exempt. S = 1794916800000 (2026-11-17T12:00:00Z). BTCUSDT: one fill an hour for seven
        hours from S + 1 h, so it caps at S + 5 h = 1794934800000 (2026-11-17T17:00:00Z).
        ETHUSDT: one fill an hour from S + 10 h, so it caps at S + 14 h = 1794967200000
        (2026-11-18T02:00:00Z). BTCUSDCC (stored name of the BTC/USDC:USDC swap, venue id
        BTCUSDC): two fills, never stopped."""
        monkeypatch.setattr(ex, "BINANCE_FILLS_PAGE_LIMIT", 3)
        monkeypatch.setattr(ex, "BINANCE_PAGE_CAP", 2)
        seed_ms = 1794916800000
        smaller_bound_ms = 1794934800000
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", i, seed_ms + i * HOUR_MS) for i in range(1, 8)
                ],
                ("linear", "ETHUSDT"): [
                    venue_fill("linear", "ETHUSDT", 20 + i, seed_ms + (9 + i) * HOUR_MS)
                    for i in range(1, 8)
                ],
                ("linear", "BTCUSDC"): [
                    venue_fill("linear", "BTCUSDC", 40, seed_ms + 2 * HOUR_MS),
                    venue_fill("linear", "BTCUSDC", 41, seed_ms + 3 * HOUR_MS),
                ],
            }
        )
        recorded: list[tuple[str, Any]] = []
        real_record = ex._record_dq_flag

        def _spy(key: str, value: Any) -> None:
            recorded.append((key, value))
            real_record(key, value)

        monkeypatch.setattr(ex, "_record_dq_flag", _spy)

        _fills, flags = await _read(
            open_exchanges, venue, ["BTCUSDT", "ETHUSDT", "BTCUSDCC"], seed_ms
        )

        assert sorted(flags.get("binance_page_cap_symbols", [])) == ["BTCUSDT", "ETHUSDT"]
        assert flags.get("binance_read_through_ms") == smaller_bound_ms
        assert [v for k, v in recorded if k == "binance_read_through_ms"] == [smaller_bound_ms], (
            "the bound must be recorded once, as the minimum"
        )
        assert "binance_untimed_page_symbols" not in flags
        assert "binance_partial_symbols" not in flags

    @pytest.mark.parametrize(
        ("capped_beside", "bound_ms"),
        [
            pytest.param(False, 1794924000000, id="untimed-alone"),
            pytest.param(True, 1794917100000, id="beside-a-capped-symbol"),
        ],
    )
    async def test_a_page_it_cannot_page_past_is_named_with_a_bound(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        capped_beside: bool,
        bound_ms: int,
    ) -> None:
        """T-250-16: a FULL page whose last row has no numeric timestamp cannot be paged past (no
        cursor to advance to). The symbol's walk stops, it is named in
        `binance_untimed_page_symbols` (not the holding partial flag), and its bound is the newest
        numeric timestamp read in that window, folded into the ONE `binance_read_through_ms`; a
        healthy symbol's newer fills cannot move it, and with a capped symbol beside it the bound
        is the smaller of the two.

        This arm uses a NON-ccxt double on purpose: real ccxt's `parse_trades` DROPS a row without
        a timestamp whenever `since` is set (measured in 250-03), so the branch is unreachable
        through `real_binance`. The double is an AsyncMock with `markets = {}` (so the awaited
        `load_markets()` is a no-op) and a `fetch_my_trades` that honours `since`, `until` and
        `limit`; a row without a timestamp sorts last.

        S = 1794916800000 (2026-11-17T12:00:00Z), page of 3. BTCUSDT's one page holds fills at
        S + 1 h and S + 2 h = 1794924000000 (2026-11-17T14:00:00Z) and a row with no timestamp,
        so the bound is 1794924000000 and it is asked ONCE. ETHUSDT (healthy, two fills at
        S + 5 h and S + 6 h, newer than BTCUSDT's rows). With a capped symbol beside it, ETHUSDT
        instead holds seven fills a minute apart from S + 1 min and caps at its fifth,
        S + 5 min = 1794917100000 (2026-11-17T12:05:00Z), the smaller bound."""
        monkeypatch.setattr(ex, "_now_ms", lambda: NOW_MS)
        monkeypatch.setattr(ex, "BINANCE_FILLS_PAGE_LIMIT", 3)
        monkeypatch.setattr(ex, "BINANCE_PAGE_CAP", 2)
        seed_ms = 1794916800000

        def _row(fill_id: int, ts: int | None) -> dict[str, Any]:
            row: dict[str, Any] = {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "order": f"ord-{fill_id}",
                "id": f"fill-{fill_id}",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                "info": {},
            }
            if ts is not None:
                row["timestamp"] = ts
            return row

        eth_times = (
            [seed_ms + i * 60_000 for i in range(1, 8)]
            if capped_beside
            else [seed_ms + 5 * HOUR_MS, seed_ms + 6 * HOUR_MS]
        )
        rows_by_symbol = {
            "BTCUSDT": [
                _row(1, seed_ms + HOUR_MS),
                _row(2, seed_ms + 2 * HOUR_MS),
                _row(3, None),
            ],
            "ETHUSDT": [_row(10 + i, t) for i, t in enumerate(eth_times)],
        }
        calls: list[tuple[str, int | None]] = []

        async def _fetch_my_trades(
            symbol: str,
            since: int | None = None,
            limit: int | None = None,
            params: dict[str, Any] | None = None,
        ) -> list[dict[str, Any]]:
            assert since is not None and params is not None
            calls.append((symbol, since))
            served = [
                r
                for r in rows_by_symbol[symbol]
                if "timestamp" not in r or since <= r["timestamp"] <= params["until"]
            ]
            served.sort(key=lambda r: r.get("timestamp", float("inf")))
            return served[:limit]

        double = AsyncMock()
        double.id = "binance"
        double.markets = {}
        double.fetch_my_trades = _fetch_my_trades

        with caplog.at_level("WARNING"):
            await ex.fetch_raw_trades(
                double, STRATEGY_ID, symbols_supabase(["BTCUSDT", "ETHUSDT"]), since_ms=seed_ms
            )
        flags = ex.get_and_clear_last_dq_flags()

        assert flags.get("binance_untimed_page_symbols") == ["BTCUSDT"]
        assert flags.get("binance_read_through_ms") == bound_ms
        assert [c for c in calls if c[0] == "BTCUSDT"] == [("BTCUSDT", seed_ms - HOUR_MS)], (
            "no later page or window may be asked for the untimed symbol"
        )
        assert any(
            "BTCUSDT" in record.getMessage() and "missing 'timestamp'" in record.getMessage()
            for record in caplog.records
            if record.levelname == "WARNING"
        ), "the missing-timestamp WARNING must name the symbol"
        assert "binance_partial_symbols" not in flags
        if capped_beside:
            assert flags.get("binance_page_cap_symbols") == ["ETHUSDT"]
        else:
            assert "binance_page_cap_symbols" not in flags

    @pytest.mark.parametrize(
        ("since_ms", "symbols", "rows", "calls_allowed", "bound_ms", "named", "expected_ids"),
        [
            # (a) stopped mid-window with rows read. Page of 3, five fills S + 1 h .. S + 5 h,
            # one request: the first page holds the first three, the second request is refused,
            # the bound is the third fill, S + 3 h = 1794927600000 (2026-11-17T15:00:00Z).
            pytest.param(
                1794916800000,  # S 2026-11-17T12:00:00Z
                ["BTCUSDT"],
                {("linear", "BTCUSDT"): [1794916800000 + i * HOUR_MS for i in range(1, 6)]},
                1,
                1794927600000,
                ["BTCUSDT"],
                {"BTCUSDT": {"1", "2", "3"}},
                id="a-mid-window-with-rows",
            ),
            # (b) stopped at a window start. S = NOW - 10 d = 1794312000000
            # (2026-11-10T12:00:00Z), so the walk (start S - 1 h) has a second window. Two fills
            # in the first window, one request: the window completes, the second window's first
            # request is refused, the bound is the second window's start minus 1 ms,
            # S - 1 h + 7 d - 1 ms - 1 ms = 1794913199998 (2026-11-17T10:59:59.998Z).
            pytest.param(
                1794312000000,
                ["BTCUSDT"],
                {("linear", "BTCUSDT"): [1794312000000 + HOUR_MS, 1794312000000 + 2 * HOUR_MS]},
                1,
                1794913199998,
                ["BTCUSDT"],
                {"BTCUSDT": {"1", "2"}},
                id="b-at-a-window-start",
            ),
            # (c) two symbols, one request. The symbol that sent it completes its first window
            # and stops at the next window start (bound 1794913199998); the other never started,
            # so its bound is the walk start minus 1 ms, S - 1 h - 1 ms = 1794308399999
            # (2026-11-10T10:59:59.999Z), the smaller one.
            pytest.param(
                1794312000000,
                ["BTCUSDT", "ETHUSDT"],
                {
                    ("linear", "BTCUSDT"): [1794312000000 + HOUR_MS, 1794312000000 + 2 * HOUR_MS],
                    ("linear", "ETHUSDT"): [1794312000000 + HOUR_MS, 1794312000000 + 2 * HOUR_MS],
                },
                1,
                1794308399999,
                ["BTCUSDT", "ETHUSDT"],
                {"BTCUSDT": {"1", "2"}, "ETHUSDT": {"11", "12"}},
                id="c-one-started-one-never-started",
            ),
            # (d) the deadline inside 250-06's exempt overlap pages (T-250-15, T-250-18), through
            # `fetch_raw_trades` with since_ms = C = 1792584000000 (2026-10-21T12:00:00Z): the walk
            # starts at C - 1 h = 1792580400000 and `pre_overlap_seed_ms` is C. Five fills in the
            # hour below C (1792581000000, 1792581600000, 1792582200000, 1792582800000,
            # 1792583400000: 11:10Z to 11:50Z, ten minutes apart) and one at 1792670400000
            # (2026-10-22T12:00:00Z). One request: the first page is full and exempt (its last row
            # is below C), the check refuses the second request, the bound is the third overlap
            # fill, 1792582200000, below C.
            pytest.param(
                1792584000000,
                ["BTCUSDT"],
                {
                    ("linear", "BTCUSDT"): [
                        1792581000000,
                        1792581600000,
                        1792582200000,
                        1792582800000,
                        1792583400000,
                        1792670400000,
                    ]
                },
                1,
                1792582200000,
                ["BTCUSDT"],
                {"BTCUSDT": {"1", "2", "3"}},
                id="d-inside-the-exempt-overlap-pages",
            ),
        ],
    )
    async def test_a_deadline_stops_every_symbol_with_a_read_through_bound(
        self,
        open_exchanges: list[Any],
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        since_ms: int,
        symbols: list[str],
        rows: dict[tuple[str, str], list[int]],
        calls_allowed: int,
        bound_ms: int,
        named: list[str],
        expected_ids: dict[str, set[str]],
    ) -> None:
        """SC-3, T-250-10 (CONTEXT [Budget]): once the read deadline has passed no request is
        sent, every symbol is named in `binance_deadline_symbols` and keeps the fills it read, and
        `binance_read_through_ms` is the smaller bound. The default (non-suspending) venue runs
        the symbol tasks one after another; these arms pass no keyword, so the 240 s default
        applies, and `_monotonic` is pinned to pass the deadline after exactly `calls_allowed`
        venue calls. Which symbol sent the request is read from the venue's `calls` log, never
        assumed (discovery comes from a set)."""
        monkeypatch.setattr(ex, "BINANCE_FILLS_PAGE_LIMIT", 3)
        venue = BinanceFillsVenue(
            {
                key: [
                    venue_fill("linear", key[1], (0 if key[1] == "BTCUSDT" else 10) + i + 1, at)
                    for i, at in enumerate(times)
                ]
                for key, times in rows.items()
            }
        )
        monkeypatch.setattr(
            ex, "_monotonic", lambda: 0.0 if len(venue.calls) < calls_allowed else 1e12
        )

        with caplog.at_level("WARNING"):
            fills, flags = await _read(open_exchanges, venue, symbols, since_ms)

        assert len(venue.calls) == calls_allowed, "a request was sent after the deadline"
        assert sorted(flags.get("binance_deadline_symbols", [])) == sorted(named)
        assert flags.get("binance_read_through_ms") == bound_ms
        started = venue.calls[0][1]["symbol"]
        assert _ids(fills) == expected_ids[started]
        assert "binance_partial_symbols" not in flags
        deadline_warnings = [
            r for r in caplog.records if r.levelname == "WARNING" and "read deadline" in r.getMessage()
        ]
        assert len(deadline_warnings) == 1, "exactly one deadline WARNING per stopped read"

    async def test_the_read_budget_reaches_the_walk_through_fetch_raw_trades(
        self, open_exchanges: list[Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """T-250-10, per caller: the public entry passes `read_deadline_s` to the Binance walk.
        One stored linear symbol, no seed (the walk starts at the reach: 13 windows, one request
        each on an empty venue), the clock pinned to 120 s per venue request and a FRESH venue
        per read. Without the keyword the 240 s default stops the walk after exactly 2 requests
        (the check `>=` fires at 240 s: request 3); with `BINANCE_SYNC_FILLS_READ_DEADLINE_S`
        (840 s) after exactly 7 (840 / 120, request 8). Both name the symbol."""

        async def _calls_with(**budget: float) -> tuple[int, dict[str, Any]]:
            venue = BinanceFillsVenue({})
            monkeypatch.setattr(ex, "_monotonic", lambda: float(len(venue.calls)) * 120.0)
            exchange = await real_binance(venue)
            open_exchanges.append(exchange)
            await ex.fetch_raw_trades(
                exchange, STRATEGY_ID, symbols_supabase(["BTCUSDT"]), since_ms=None, **budget
            )
            return len(venue.calls), ex.get_and_clear_last_dq_flags()

        default_calls, default_flags = await _calls_with()
        long_calls, long_flags = await _calls_with(
            read_deadline_s=ex.BINANCE_SYNC_FILLS_READ_DEADLINE_S
        )

        assert default_calls == 2, f"the default budget sent {default_calls} requests"
        assert long_calls == 7, f"the long budget sent {long_calls} requests"
        assert default_flags.get("binance_deadline_symbols") == ["BTCUSDT"]
        assert long_flags.get("binance_deadline_symbols") == ["BTCUSDT"]

    def test_the_read_deadlines_are_pinned(self) -> None:
        """Founder ruling 2026-11-25 (UTC): the sync gets about 14 of its 15 minutes for reading
        (840 s), the nightly reconcile keeps the 240 s default; each budget sits below its
        handler's timeout. A caller that passes no budget reads with the default, never with the
        sync's, and never without one (the keyword is not None-able)."""
        assert ex.BINANCE_FILLS_READ_DEADLINE_S == 240.0
        assert ex.BINANCE_SYNC_FILLS_READ_DEADLINE_S == 840.0
        assert ex.BINANCE_SYNC_FILLS_READ_DEADLINE_S < TIMEOUT_PER_KIND["sync_trades"]
        assert ex.BINANCE_FILLS_READ_DEADLINE_S < TIMEOUT_PER_KIND["reconcile_strategy"]
        for fn in (ex.fetch_raw_trades, ex._fetch_raw_trades_binance):
            param = inspect.signature(fn).parameters["read_deadline_s"]
            assert param.kind is inspect.Parameter.KEYWORD_ONLY
            assert param.default == 240.0
