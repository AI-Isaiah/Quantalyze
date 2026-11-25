"""Phase 250 BINANCEFILLS plan 01 (SC-5): the harness's own gates. The venue fake in
`tests/_binance_fills.py` keeps the venue's rules THROUGH real ccxt.

WHY THIS MATTERS. The fake is itself a gate. If it served every row after `startTime`
(the forbidden fake, CONTEXT [Tests]) it would go GREEN on today's code, and every RED
reading of the phase would be worthless. These arms prove, through a REAL
`ccxt.async_support.binance` (ccxt 4.5.89, recorded markets, no network), that:
  - ccxt's own implicit 7-day `endTime` cap reaches the fake, and the fake honours it;
  - a span longer than the window is refused (7 days linear and inverse, 24 hours spot);
  - no start and no end serves the last window only;
  - a since-only inverse request serves one forward window;
  - an out-of-reach `startTime` raises or reads empty by switch;
  - every recorded unified symbol routes to its endpoint, and a raw `BTCUSDT` with no slash
    routes to SPOT (the hazard RESEARCH Q1 measured);
  - a ccxt call that is none of the three replaced endpoints raises the network error.

DOCUMENTED rules (Binance USD-M and COIN-M "Account Trade List", spot `myTrades`):
7-day / 24-hour window, the last 7 days with no start and no end, `limit` default 500 and
maximum 1000, "past 3 months". ASSUMED (UNMEASURED, RESEARCH Q1 and A4): result order, a
lone `startTime` on COIN-M and spot, `endTime` inclusive, the reach rule, what an
out-of-reach `startTime` does. Expected values below are derived from the venue's `calls`
log and the hand-typed instants, never from the code under test. Every instant carries its
ISO form in a comment.

NEUTER (recorded verbatim in the 250-01 SUMMARY, restored from a byte backup with `cp`,
checked with `cmp`):
  N0 make every request that carries a `startTime` serve [startTime, now] in
     tests/_binance_fills.py (`endTime` and the window rule ignored): this file's
     test_a_since_only_linear_request_is_capped_at_seven_days_by_ccxt goes RED, and the
     strict-xfail reproduction in tests/test_binancefills_e2e.py is reported as a FAILED
     XPASS.
"""

from __future__ import annotations

from typing import Any

import ccxt
import pytest

from tests._binance_fills import (
    NOW_MS,
    BinanceFillsVenue,
    real_binance,
    venue_fill,
)

C_MS = 1792584000000  # 2026-10-21T12:00:00Z
C_PLUS_12H_MS = 1792627200000  # 2026-10-22T00:00:00Z
C_PLUS_1D_MS = 1792670400000  # 2026-10-22T12:00:00Z
C_PLUS_36H_MS = 1792713600000  # 2026-10-23T00:00:00Z
C_PLUS_7D_MS = 1793188800000  # 2026-10-28T12:00:00Z (ccxt's implicit end from C)
C_PLUS_10D_MS = 1793448000000  # 2026-10-31T12:00:00Z
NOW_MINUS_5D_MS = 1794744000000  # 2026-11-15T12:00:00Z
NOW_MINUS_6D_MS = 1794657600000  # 2026-11-14T12:00:00Z
NOW_MINUS_8D_MS = 1794484800000  # 2026-11-12T12:00:00Z
NOW_MINUS_1D_MS = 1795089600000  # 2026-11-19T12:00:00Z
NOW_MINUS_1H_MS = 1795172400000  # 2026-11-20T11:00:00Z
NOW_MINUS_85D_MS = 1787832000000  # 2026-08-27T12:00:00Z (inside the 89-day reach)
NOW_MINUS_120D_MS = 1784808000000  # 2026-07-23T12:00:00Z (older than the reach)


def _times(trades: list[dict[str, Any]]) -> list[int]:
    return [t["timestamp"] for t in trades]


class TestBinanceFillsVenueIsFaithful:
    async def test_a_since_only_linear_request_is_capped_at_seven_days_by_ccxt(self) -> None:
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", 1, C_MS),
                    venue_fill("linear", "BTCUSDT", 2, NOW_MINUS_5D_MS),
                ]
            }
        )
        binance = await real_binance(venue)
        try:
            capped = await binance.fetch_my_trades("BTC/USDT:USDT", since=C_MS, limit=1000)
            explicit = await binance.fetch_my_trades(
                "BTC/USDT:USDT",
                since=NOW_MINUS_6D_MS,
                limit=1000,
                params={"until": NOW_MS},
            )
        finally:
            await binance.close()

        assert venue.calls == [
            (
                "linear",
                {
                    "symbol": "BTCUSDT",
                    "startTime": C_MS,
                    "endTime": C_PLUS_7D_MS,
                    "limit": 1000,
                },
            ),
            (
                "linear",
                {
                    "symbol": "BTCUSDT",
                    "startTime": NOW_MINUS_6D_MS,
                    "endTime": NOW_MS,
                    "limit": 1000,
                },
            ),
        ]
        # The fill 25 days after the cursor is past ccxt's implicit end, so the capped
        # read does not see it; an explicit `until` reaches it.
        assert _times(capped) == [C_MS]
        assert _times(explicit) == [NOW_MINUS_5D_MS]

    @pytest.mark.parametrize(
        ("symbol", "kind", "window_ms"),
        [
            ("BTC/USDT:USDT", "linear", 604_800_000),
            ("ETH/BTC", "spot", 86_400_000),
        ],
    )
    async def test_a_span_longer_than_the_window_is_refused(
        self, symbol: str, kind: str, window_ms: int
    ) -> None:
        venue = BinanceFillsVenue()
        binance = await real_binance(venue)
        try:
            with pytest.raises(ccxt.BadRequest):
                await binance.fetch_my_trades(
                    symbol,
                    since=C_MS,
                    limit=1000,
                    params={"until": C_MS + window_ms + 1},
                )
            # The boundary is not off by one: a span of exactly the window is served.
            assert (
                await binance.fetch_my_trades(
                    symbol,
                    since=C_MS,
                    limit=1000,
                    params={"until": C_MS + window_ms},
                )
                == []
            )
        finally:
            await binance.close()

        assert [k for k, _req in venue.calls] == [kind, kind]

    async def test_no_start_and_no_end_serves_only_the_last_window(self) -> None:
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", 1, NOW_MINUS_8D_MS),
                    venue_fill("linear", "BTCUSDT", 2, NOW_MINUS_6D_MS),
                    venue_fill("linear", "BTCUSDT", 3, NOW_MINUS_1H_MS),
                ],
                ("spot", "BTCUSDT"): [
                    venue_fill("spot", "BTCUSDT", 1, NOW_MINUS_6D_MS),
                    venue_fill("spot", "BTCUSDT", 2, NOW_MINUS_1H_MS),
                ],
            }
        )

        linear = await venue.fapi({"symbol": "BTCUSDT"})
        spot = await venue.spot({"symbol": "BTCUSDT"})

        assert [r["id"] for r in linear] == [2, 3]  # last 7 days: 8 days ago is out
        assert [r["id"] for r in spot] == [2]  # last 24 hours: 6 days ago is out

    async def test_a_since_only_inverse_request_serves_one_forward_window(self) -> None:
        venue = BinanceFillsVenue(
            {
                ("inverse", "BTCUSD_PERP"): [
                    venue_fill("inverse", "BTCUSD_PERP", 1, C_PLUS_1D_MS),
                    venue_fill("inverse", "BTCUSD_PERP", 2, C_PLUS_10D_MS),
                ]
            }
        )
        binance = await real_binance(venue)
        try:
            trades = await binance.fetch_my_trades("BTC/USD:BTC", since=C_MS, limit=1000)
        finally:
            await binance.close()

        # ccxt adds no endTime for an inverse market, so the venue's own forward window
        # (7 days from startTime) decides: 1 day after is read, 10 days after is not.
        assert venue.calls == [
            ("inverse", {"symbol": "BTCUSD_PERP", "startTime": C_MS, "limit": 1000})
        ]
        assert _times(trades) == [C_PLUS_1D_MS]

    @pytest.mark.parametrize(
        ("mode", "expected_read"),
        [("raise", None), ("empty", [])],
    )
    async def test_an_out_of_reach_start_raises_or_reads_empty_by_switch(
        self, mode: str, expected_read: list[Any] | None
    ) -> None:
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", 1, NOW_MINUS_120D_MS),
                    venue_fill("linear", "BTCUSDT", 2, NOW_MINUS_85D_MS),
                ]
            },
            out_of_reach=mode,
        )
        binance = await real_binance(venue)
        try:
            if expected_read is None:
                with pytest.raises(ccxt.BadRequest):
                    await binance.fetch_my_trades(
                        "BTC/USDT:USDT", since=NOW_MINUS_120D_MS, limit=1000
                    )
            else:
                out_of_reach = await binance.fetch_my_trades(
                    "BTC/USDT:USDT", since=NOW_MINUS_120D_MS, limit=1000
                )
                assert out_of_reach == expected_read
            # A start inside the reach is served under either switch.
            served = await binance.fetch_my_trades(
                "BTC/USDT:USDT", since=NOW_MINUS_85D_MS, limit=1000
            )
        finally:
            await binance.close()

        assert _times(served) == [NOW_MINUS_85D_MS]

    @pytest.mark.parametrize(
        ("symbol", "kind", "venue_id"),
        [
            ("BTC/USDT:USDT", "linear", "BTCUSDT"),
            ("BTC/USDC:USDC", "linear", "BTCUSDC"),
            ("BTC/USDT:USDT-261225", "linear", "BTCUSDT_261225"),
            ("BTC/USD:BTC", "inverse", "BTCUSD_PERP"),
            ("ETH/BTC", "spot", "ETHBTC"),
            ("BTC/USDC", "spot", "BTCUSDC"),
            # The hazard RESEARCH Q1 measured: a raw stored name (no slash) routes to SPOT.
            ("BTCUSDT", "spot", "BTCUSDT"),
        ],
    )
    async def test_each_recorded_market_routes_to_its_endpoint(
        self, symbol: str, kind: str, venue_id: str
    ) -> None:
        venue = BinanceFillsVenue()
        binance = await real_binance(venue)
        try:
            await binance.fetch_my_trades(symbol, since=NOW_MINUS_1D_MS, limit=1000)
        finally:
            await binance.close()

        assert [(k, req["symbol"]) for k, req in venue.calls] == [(kind, venue_id)]

    async def test_a_test_cannot_reach_the_network(self) -> None:
        venue = BinanceFillsVenue()
        binance = await real_binance(venue)
        try:
            # A public call that is none of the three replaced endpoints reaches
            # ccxt's low-level `fetch`, which the helper replaced with a raising mock.
            with pytest.raises(AssertionError, match="reached the network"):
                await binance.fetch_time()
        finally:
            await binance.close()

        assert venue.calls == []
