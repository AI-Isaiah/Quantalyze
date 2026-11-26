"""Phase 250 BINANCEFILLS plan 05 (SC-1, SC-5): the LIVE onboarding caller of the Binance fills
read, `BinanceAdapter.fetch_raw`, driven UNEDITED through the window walk.

WHY THIS MATTERS. `process_key_long` (the onboarding path) reaches the Binance fills read
through `services/ingestion/binance.py::BinanceAdapter.fetch_raw`, which calls
`_fetch_raw_trades_binance` directly with `since_ms` taken from a context no caller sets
(CONTEXT, orchestrator decision 2026-11-25, third caller). Before this phase that read sent no
`startTime`, so the venue answered only its last 7 days and every older fill was lost; with the
exchange `create_exchange` returns (markets NOT loaded) a stored linear name also resolved to the
SPOT endpoint and nothing at all was read. After this phase it walks from the reach
(`BINANCE_FILLS_REACH_DAYS` = 85 days back) through 7-day windows on the linear endpoint. The
adapter file is not edited; this arm only proves what it now reads.

The module-level imports name no phase-new production symbol (only pytest, the standard library,
`services.ingestion.binance` and `tests._binance_fills`), so the module collects against the
phase base's `services/exchange.py`: the RED-on-HEAD reading in the 250-05 SUMMARY swaps that file
in and runs this module unchanged.

INSTANTS. Hand-typed, each with its ISO form beside it (the table lives in 250-01-PLAN.md):
  NOW_MS               = 1795176000000   2026-11-20T12:00:00Z (the pinned clock)
  reach start          = 1787832000000   2026-08-27T12:00:00Z (NOW_MS - 85 days)
  fill 30 days back    = 1792584000000   2026-10-21T12:00:00Z
  fill 2 days back     = 1795003200000   2026-11-18T12:00:00Z

PROOF-01 NEUTER (recorded verbatim in the 250-05 SUMMARY, restored from a byte backup of
`services/exchange.py` with `cp` and checked with `cmp`):
  N30 start the walk at `read_now - BINANCE_FILLS_WINDOW_DAYS` days instead of the reach when
      `since_ms` is None (HEAD's last-7-days span, `startTime` still sent):
      test_onboarding_without_a_since_walks_from_the_reach_and_returns_a_fill_older_than_seven_days
      goes RED in both parametrizations (the 2026-10-21 fill is lost).
  N14 remove the `load_markets()` call before the reverse map: the `markets_loaded=False`
      parametrization goes RED beside the walk arm.
"""
from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from services.ingestion.binance import BinanceAdapter
from tests._binance_fills import (
    NOW_MS,
    BinanceFillsVenue,
    real_binance,
    symbols_supabase,
    venue_fill,
)

REACH_START_MS = 1787832000000  # 2026-08-27T12:00:00Z (NOW_MS - 85 days)
FILL_30D_MS = 1792584000000  # 2026-10-21T12:00:00Z, 30 days before NOW_MS
FILL_2D_MS = 1795003200000  # 2026-11-18T12:00:00Z, 2 days before NOW_MS


@pytest.fixture(autouse=True)
def _pinned_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    # The name exists at the phase base too, so the module runs unchanged against HEAD.
    monkeypatch.setattr("services.exchange._now_ms", lambda: NOW_MS)


class TestBinanceFillsThroughTheOnboardingAdapter:
    @pytest.mark.parametrize("markets_loaded", [True, False], ids=["loaded", "unloaded"])
    async def test_onboarding_without_a_since_walks_from_the_reach_and_returns_a_fill_older_than_seven_days(
        self, monkeypatch: pytest.MonkeyPatch, markets_loaded: bool
    ) -> None:
        """Third caller (CONTEXT, orchestrator decision 2026-11-25): `fetch_raw` given a context
        with NO `since_ms` walks from the reach, sends every request with both `startTime` and
        `endTime`, reads only the linear endpoint for the stored `BTCUSDT`, and returns BOTH the
        fill 30 days back and the fill 2 days back. A read that sent no `startTime` is served
        only the venue's last 7 days and loses the first.

        `markets_loaded=True` lists spot `BTC/USDT` BEFORE `BTC/USDT:USDT`, so a last-write-wins
        map also resolves BTCUSDT to the linear market and the HEAD reading of this case isolates
        the missing `startTime`. `markets_loaded=False` is the exchange `create_exchange` returns:
        only the markets-load fix lets the stored linear name reach the linear endpoint."""
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", 1, FILL_30D_MS),
                    venue_fill("linear", "BTCUSDT", 2, FILL_2D_MS),
                ]
            }
        )
        binance = await real_binance(
            venue,
            markets_loaded=markets_loaded,
            market_order=["BTC/USDT", "BTC/USDT:USDT"] if markets_loaded else None,
        )
        monkeypatch.setattr("services.exchange.create_exchange", lambda *_a, **_k: binance)
        monkeypatch.setattr("services.exchange.aclose_exchange", AsyncMock())
        monkeypatch.setattr(
            "services.db.get_supabase", lambda: symbols_supabase(["BTCUSDT"])
        )

        try:
            trades = await BinanceAdapter().fetch_raw(
                {"api_key": "k", "api_secret": "s", "strategy_id": "strat-onboard"}
            )
        finally:
            await binance.close()

        assert sorted(t.timestamp for t in trades) == [
            datetime.fromtimestamp(FILL_30D_MS / 1000, tz=UTC),
            datetime.fromtimestamp(FILL_2D_MS / 1000, tz=UTC),
        ]
        assert venue.calls, "the venue was never asked"
        assert venue.calls_for("spot") == [] and venue.calls_for("inverse") == []
        linear = venue.calls_for("linear")
        assert linear, "the linear endpoint was never asked"
        for request in linear:
            assert "startTime" in request and "endTime" in request, request
            assert 0 < request["endTime"] - request["startTime"] <= 604799999, request
        assert linear[0]["startTime"] == REACH_START_MS
