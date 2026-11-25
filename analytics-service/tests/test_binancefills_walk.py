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
