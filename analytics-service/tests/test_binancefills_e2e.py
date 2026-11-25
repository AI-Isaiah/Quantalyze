"""Phase 250 BINANCEFILLS plan 01 (SC-1, SC-5): the Binance fills read inside the REAL
`run_sync_trades_job`, on a REAL ccxt instance, against a fake that answers like the venue.

WHY THIS MATTERS. The fills read and the cursor gate are only proven together when the
REAL read runs inside the REAL job. R2-02: ccxt caps a since-only LINEAR request at
since + 7 days, so a cursor older than a week reads one window, the stored fills inside it
are all the job sees, and the cursor then stamps a stale fill while a newer fill past the
quiet stretch is never read. A mock `fetch_my_trades` cannot show that: it skips ccxt's
`market()`, `until` handling, implicit linear cap and `parse_trades`. Every arm here drives
the REAL `run_sync_trades_job` with the REAL `services.exchange.fetch_raw_trades` on a
venue-faked real `ccxt.binance` (`tests/_binance_fills.py`), and `get_and_clear_last_dq_flags`
is NOT patched, so the job's real cursor gate reads the real drain.

INSTANTS. Hand-typed, each with its ISO form beside it, never computed by the code under
test (the table lives in 250-01-PLAN.md; later plans cite it):
  NOW_MS = 1795176000000          2026-11-20T12:00:00Z
  C      = 1792584000000          2026-10-21T12:00:00Z (the cursor, and a stored fill)
  C + 2d = 1792756800000          2026-10-23T12:00:00Z
  NOW_MS - 5d = 1794744000000     2026-11-15T12:00:00Z

NEUTER (each recorded verbatim in the 250-01 SUMMARY, restored from a byte backup with `cp`
and checked with `cmp`; later plans extend this list):
  N0 let the venue fake ignore `endTime` and the window rule (serve [startTime, now], the
     forbidden fake) in tests/_binance_fills.py: tests/test_binancefills_harness.py
     test_a_since_only_linear_request_is_capped_at_seven_days_by_ccxt goes RED and the
     strict-xfail reproduction below is reported as a FAILED XPASS.
  N24 (250-07) hold the semaphore across a symbol's whole walk instead of per request:
     test_repeated_deadline_stops_advance_the_frontier_every_run goes RED (symbols beyond the
     five slots never start in a deadline-stopped run, so the bound sits at the walk start).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import ccxt
import pytest

import services.exchange as ex
from services.job_worker import DispatchOutcome, run_sync_trades_job
from tests._binance_fills import (
    DAY_MS,
    HOUR_MS,
    NOW_MS,
    BinanceFillsVenue,
    real_binance,
    recorded_markets,
    symbols_supabase,
    venue_fill,
)
from tests.test_okxtrades_cursor import (
    STRATEGY_ID,
    _make_supabase,
    _Recorder,
    _the_advance,
)

C_MS = 1792584000000  # 2026-10-21T12:00:00Z
C_ISO = "2026-10-21T12:00:00+00:00"
C_PLUS_2D_MS = 1792756800000  # 2026-10-23T12:00:00Z
C_PLUS_2D_ISO = "2026-10-23T12:00:00+00:00"
NOW_MINUS_5D_MS = 1794744000000  # 2026-11-15T12:00:00Z
NOW_MINUS_5D_ISO = "2026-11-15T12:00:00+00:00"
NOW_MINUS_3D_MS = 1794916800000  # 2026-11-17T12:00:00Z
NOW_MINUS_3D_ISO = "2026-11-17T12:00:00+00:00"
NOW_MINUS_120D_MS = 1784808000000  # 2026-07-23T12:00:00Z (older than the 85-day reach)
NOW_MINUS_120D_ISO = "2026-07-23T12:00:00+00:00"
NOW_MINUS_60D_MS = 1789992000000  # 2026-09-21T12:00:00Z
NOW_MINUS_60D_ISO = "2026-09-21T12:00:00+00:00"

# The budget `run_sync_trades_job` passes to its fills read (founder ruling 2026-11-25 UTC: "about 14
# of its 15 minutes for reading"). Hand-typed so the ordering arm's clock step is not computed from
# the constant under test; `test_the_sync_job_passes_the_long_read_budget` asserts it is equal to
# `BINANCE_SYNC_FILLS_READ_DEADLINE_S`, so the two cannot drift apart.
SYNC_READ_BUDGET_S = 840.0


@pytest.fixture(autouse=True)
def _pinned_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    # raising=False: the same fixture runs on code that predates the ``_now_ms`` seam.
    monkeypatch.setattr(ex, "_now_ms", lambda: NOW_MS, raising=False)


async def _run_live(
    venue: BinanceFillsVenue,
    *,
    column: str | None,
    stored_fills: list[str],
    symbols: list[str],
    flags: dict[str, Any] | None = None,
) -> tuple[_Recorder, AsyncMock]:
    """Drive the REAL `run_sync_trades_job` with the REAL `fetch_raw_trades` on a
    venue-faked real ccxt.binance. `stored_fills` are the ISO timestamps of fills already
    stored, so the job's seed is min(cursor, newest stored fill). `flags` is shared across
    runs, so a second run reads what the first wrote. Returns the recorder and the fills
    read mock (its `since_ms` is what the job asked for)."""
    supabase, rec = _make_supabase(
        trades_rows=[
            {"strategy_id": STRATEGY_ID, "is_fill": True, "timestamp": ts}
            for ts in stored_fills
        ],
        flags=flags,
    )

    mock_exchange = AsyncMock()
    mock_exchange.close = AsyncMock()
    mock_ctx = MagicMock()
    mock_ctx.exchange = mock_exchange  # ignored: the read builds its own ccxt.binance
    mock_ctx.supabase = supabase
    mock_ctx.strategy_row = {"id": STRATEGY_ID, "user_id": "user-1"}
    mock_ctx.key_row = {
        "id": "key-1",
        "exchange": "binance",
        "user_id": "user-1",
        "last_sync_at": "2026-11-13T06:00:00+00:00",
        "last_fetched_trade_timestamp": column,
    }

    async def _real_read(
        _job_exchange: Any,
        strategy_id: str,
        _job_supabase: Any,
        since_ms: int | None = None,
        **read_kwargs: Any,
    ) -> list[dict[str, Any]]:
        # `read_kwargs` carries whatever the job passes beyond the seed (the read budget), so
        # the REAL walk reads with the budget the REAL job asked for.
        binance = await real_binance(venue)
        try:
            return await ex.fetch_raw_trades(
                binance, strategy_id, symbols_supabase(symbols), since_ms=since_ms, **read_kwargs
            )
        finally:
            await binance.close()

    fetch_raw = AsyncMock(side_effect=_real_read)
    job = {"id": "job-250", "kind": "sync_trades", "strategy_id": STRATEGY_ID}

    patches: list[Any] = [
        patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=mock_ctx),
        ),
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[])),
        patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=10000.0),
        ),
        patch("services.job_worker.fetch_raw_trades", new=fetch_raw),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
        patch("services.job_worker._RAW_TRADE_INGESTION_ENABLED", True),
    ]
    for p in patches:
        p.start()
    try:
        result = await run_sync_trades_job(job)
    finally:
        for p in reversed(patches):
            p.stop()

    assert result.outcome == DispatchOutcome.DONE
    return rec, fetch_raw


EIGHT_LINEAR = [
    # (stored name, venue id): the eight non-spot linear markets of the cassette.
    ("BTCUSDT", "BTCUSDT"),
    ("ETHUSDT", "ETHUSDT"),
    ("BCHUSDT", "BCHUSDT"),
    ("XRPUSDT", "XRPUSDT"),
    ("LTCUSDT", "LTCUSDT"),
    ("TRXUSDT", "TRXUSDT"),
    ("BTCUSDCC", "BTCUSDC"),
    (
        next(
            m["symbol"].replace("/", "").replace(":USDT", "").replace(":USD", "")
            for m in recorded_markets()
            if m["type"] == "future"
        ),
        "BTCUSDT_261225",
    ),
]


class TestBinanceFillsThroughTheSyncJob:
    async def test_a_fill_inside_the_first_window_is_read_and_stamped(self) -> None:
        """The driver's own guard: a fill two days after the cursor sits inside the first
        7-day window ccxt reads, so it is read, persisted and stamped on HEAD code. It
        stays green through the walk."""
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", 1, C_MS),
                    venue_fill("linear", "BTCUSDT", 2, C_PLUS_2D_MS),
                ]
            }
        )
        rec, _fetch = await _run_live(
            venue, column=C_ISO, stored_fills=[C_ISO], symbols=["BTCUSDT"]
        )

        assert _the_advance(rec)["p_last_fetched_ts"] == C_PLUS_2D_ISO

    async def test_tracer_a_quiet_stretch_is_walked_and_the_cursor_stamps_the_newer_fill(
        self,
    ) -> None:
        """SC-1: a fill at the cursor, 20 quiet days, then a fill 5 days before now. The
        walk reads past the quiet stretch and the cursor stamps the newer fill.

        R2-02 history: this arm was a strict xfail (250-01) until the window walk landed;
        250-03 promoted it. Every venue call must carry both bounds and span at most one
        7-day venue window, so no request depends on ccxt's implicit linear-only cap."""
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", 1, C_MS),
                    venue_fill("linear", "BTCUSDT", 2, NOW_MINUS_5D_MS),
                ]
            }
        )
        rec, fetch = await _run_live(
            venue, column=C_ISO, stored_fills=[C_ISO], symbols=["BTCUSDT"]
        )

        assert fetch.await_args is not None
        assert fetch.await_args.kwargs["since_ms"] == C_MS
        assert _the_advance(rec)["p_last_fetched_ts"] == NOW_MINUS_5D_ISO

        # 604799999 = 7 days - 1 ms: the longest span the walk may ask for in one request.
        assert venue.calls, "the venue was never asked"
        for _kind, request in venue.calls:
            assert "startTime" in request and "endTime" in request, request
            assert 0 < request["endTime"] - request["startTime"] <= 604799999, request

    async def test_a_seed_older_than_the_reach_is_clamped_named_and_not_held(self) -> None:
        """SC-1 (CONTEXT [Window walk, R2-02] "A seed older than the venue's 3-month reach?"):
        a cursor 120 days old, past the 85-day reach, with a stored fill there, and a venue
        fill 60 days old. The venue is the default STRICT one (a start past its reach is
        refused with ccxt.BadRequest), so a walk that sent the old seed would turn the
        symbol partial and the stamp would stay None. The walk starts at the reach instead,
        names the clamp in `binance_fills_reach_clamped`, never holds on it, and the stamp
        reaches the fill past the clamp.

        The job writes the drained flags through its `strategy_analytics` upsert
        (`rec.analytics_upserts[-1]["data_quality_flags"]`), read here the same way
        250-03's sibling gates read them."""
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", 1, NOW_MINUS_120D_MS),
                    venue_fill("linear", "BTCUSDT", 2, NOW_MINUS_60D_MS),
                ]
            }
        )
        rec, fetch = await _run_live(
            venue,
            column=NOW_MINUS_120D_ISO,
            stored_fills=[NOW_MINUS_120D_ISO],
            symbols=["BTCUSDT"],
        )

        assert fetch.await_args is not None
        assert fetch.await_args.kwargs["since_ms"] == NOW_MINUS_120D_MS
        assert _the_advance(rec)["p_last_fetched_ts"] == NOW_MINUS_60D_ISO
        assert rec.analytics_upserts, "the job wrote no data_quality_flags"
        flags = rec.analytics_upserts[-1]["data_quality_flags"]
        assert flags.get("binance_fills_reach_clamped") is True
        assert "binance_partial_symbols" not in flags

    async def test_tracer_an_unlisted_symbol_is_named_and_the_healthy_symbol_stamps(
        self,
    ) -> None:
        """SC-2 (CONTEXT [Unlisted symbols, R2-01] "How do healthy symbols advance while a dead
        symbol is still named?"): two symbols are discovered, BTCUSDT (listed, fills at the
        cursor and 5 days before now) and DELISTEDUSDT (absent from the loaded markets, so
        ccxt raises BadSymbol client-side). The dead symbol is named in
        `binance_unlisted_symbols` on the run and does NOT hold the cursor: the healthy fill
        is stored and stamped. Filed under the holding `binance_partial_symbols` (the 250-04
        behaviour) the stamp stays None forever and every healthy symbol stops past
        C + 7 days.

        The job writes the drained flags through its `strategy_analytics` upsert
        (`rec.analytics_upserts[-1]["data_quality_flags"]`)."""
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", 1, C_MS),
                    venue_fill("linear", "BTCUSDT", 2, NOW_MINUS_5D_MS),
                ]
            }
        )
        rec, _fetch = await _run_live(
            venue,
            column=C_ISO,
            stored_fills=[C_ISO],
            symbols=["BTCUSDT", "DELISTEDUSDT"],
        )

        assert _the_advance(rec)["p_last_fetched_ts"] == NOW_MINUS_5D_ISO
        persisted = {
            str(f["exchange_fill_id"]): f["timestamp"]
            for batch in rec.upserted_batches
            for f in batch
        }
        assert persisted.get("2") == NOW_MINUS_5D_ISO, persisted
        assert rec.analytics_upserts, "the job wrote no data_quality_flags"
        flags = rec.analytics_upserts[-1]["data_quality_flags"]
        assert flags.get("binance_unlisted_symbols") == ["DELISTEDUSDT"]
        assert "binance_partial_symbols" not in flags

    async def test_a_transient_symbol_is_reread_on_the_next_clean_run(self) -> None:
        """SC-2 transient (T-250-09): only a BadSymbol skips without a hold. ETHUSDT's venue
        requests raise `ccxt.NetworkError` on run 1, so run 1 holds the cursor (stamp None) and
        names ETHUSDT in the HOLDING `binance_partial_symbols`. With the fault cleared, run 2
        reads ETHUSDT from the cursor C and stores BOTH its fills (the one at C + 2 days sits
        inside the span run 1 could not read), then stamps the newest fill (BTCUSDT's, 3 days before now). No fill of the
        transient symbol is skipped.

        Run 2's stored fills are run 1's persisted fills plus the stored fill at C, and the
        column is still C (run 1 held it)."""
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [venue_fill("linear", "BTCUSDT", 1, NOW_MINUS_3D_MS)],
                ("linear", "ETHUSDT"): [
                    venue_fill("linear", "ETHUSDT", 11, C_PLUS_2D_MS),
                    venue_fill("linear", "ETHUSDT", 12, NOW_MINUS_5D_MS),
                ],
            }
        )
        venue.effects["ETHUSDT"] = ccxt.NetworkError("simulated venue fault")
        shared_flags: dict[str, Any] = {}

        rec1, fetch1 = await _run_live(
            venue,
            column=C_ISO,
            stored_fills=[C_ISO],
            symbols=["BTCUSDT", "ETHUSDT"],
            flags=shared_flags,
        )

        assert _the_advance(rec1)["p_last_fetched_ts"] is None, "a transient failure holds"
        flags1 = rec1.analytics_upserts[-1]["data_quality_flags"]
        assert flags1.get("binance_partial_symbols") == ["ETHUSDT"]
        assert "binance_unlisted_symbols" not in flags1
        persisted1 = [f["timestamp"] for batch in rec1.upserted_batches for f in batch]
        assert persisted1, "the healthy symbol's fill still persists"

        venue.effects.clear()
        rec2, fetch2 = await _run_live(
            venue,
            column=C_ISO,
            stored_fills=[C_ISO, *persisted1],
            symbols=["BTCUSDT", "ETHUSDT"],
            flags=shared_flags,
        )

        assert fetch2.await_args is not None
        assert fetch2.await_args.kwargs["since_ms"] == C_MS
        persisted2 = {
            str(f["exchange_fill_id"]) for batch in rec2.upserted_batches for f in batch
        }
        assert {"11", "12"} <= persisted2, persisted2
        assert _the_advance(rec2)["p_last_fetched_ts"] == NOW_MINUS_3D_ISO
        # A clean run with nothing to name writes no flags at all; if it does write, the
        # holding flag must not be re-recorded.
        for upsert in rec2.analytics_upserts:
            assert "binance_partial_symbols" not in upsert["data_quality_flags"]

    async def test_a_capped_symbol_resumes_past_the_cap_on_the_next_run(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """SC-3 end to end (CONTEXT [Page cap stop] "How is a capped symbol flagged and
        resumed?"), lowered caps (3 rows a page, 2 pages: two full pages read 5 DISTINCT fills,
        because the walk advances `since` to the last row's timestamp without +1 and the second
        page re-serves its boundary row).

        Run 1 (column C): BTCUSDT holds seven fills, all later than C, two hours apart, so it
        caps at its fifth fill B; ETHUSDT (never caps) holds two fills NEWER than B. The cap is
        named with the bound B, so the REAL gate stamps B and not ETHUSDT's newer fill (a stamp
        past B would skip BTCUSDT's sixth and seventh fills for good). Run 2 is seeded by the
        real job at B: stored fills are run 1's persisted fills plus the one at C, the column is
        B. Its walk starts at B - 1 h (BTCUSDT's fourth fill is two hours before B, outside it),
        reads BTCUSDT's fifth to seventh fills in one full page and one short page, persists the
        sixth and seventh, and stamps the newest fill. The union persisted over both runs is
        every venue fill.

        Instants (hand-typed): C = 1792584000000 (2026-10-21T12:00:00Z); BTCUSDT f1..f7 at
        14:00, 16:00, 18:00, 20:00, 22:00 on the 21st and 00:00, 02:00 on the 22nd:
        f1 = 1792591200000, f5 = B = 1792620000000 (2026-10-21T22:00:00Z), f6 = 1792627200000,
        f7 = 1792634400000 (2026-10-22T02:00:00Z); ETHUSDT 1792623600000 (23:00Z) and
        1792630800000 (2026-10-22T01:00:00Z)."""
        monkeypatch.setattr(ex, "BINANCE_FILLS_PAGE_LIMIT", 3)
        monkeypatch.setattr(ex, "BINANCE_PAGE_CAP", 2)
        b_iso = "2026-10-21T22:00:00+00:00"
        f7_iso = "2026-10-22T02:00:00+00:00"
        btc_times = [
            1792591200000,
            1792598400000,
            1792605600000,
            1792612800000,
            1792620000000,
            1792627200000,
            1792634400000,
        ]
        venue = BinanceFillsVenue(
            {
                ("linear", "BTCUSDT"): [
                    venue_fill("linear", "BTCUSDT", i + 1, t) for i, t in enumerate(btc_times)
                ],
                ("linear", "ETHUSDT"): [
                    venue_fill("linear", "ETHUSDT", 11, 1792623600000),
                    venue_fill("linear", "ETHUSDT", 12, 1792630800000),
                ],
            }
        )

        rec1, fetch1 = await _run_live(
            venue, column=C_ISO, stored_fills=[C_ISO], symbols=["BTCUSDT", "ETHUSDT"]
        )

        assert fetch1.await_args is not None
        assert fetch1.await_args.kwargs["since_ms"] == C_MS
        persisted1 = {
            str(f["exchange_fill_id"]): f["timestamp"]
            for batch in rec1.upserted_batches
            for f in batch
        }
        assert {"1", "2", "3", "4", "5", "11", "12"} <= set(persisted1), persisted1
        assert "6" not in persisted1 and "7" not in persisted1, "the capped symbol read past its cap"
        assert _the_advance(rec1)["p_last_fetched_ts"] == b_iso, (
            "the stamp passed the capped symbol's newest read fill"
        )
        assert rec1.analytics_upserts, "the job wrote no data_quality_flags"
        flags1 = rec1.analytics_upserts[-1]["data_quality_flags"]
        assert flags1.get("binance_page_cap_symbols") == ["BTCUSDT"]

        rec2, fetch2 = await _run_live(
            venue,
            column=b_iso,
            stored_fills=[C_ISO, *persisted1.values()],
            symbols=["BTCUSDT", "ETHUSDT"],
        )

        assert fetch2.await_args is not None
        assert fetch2.await_args.kwargs["since_ms"] == 1792620000000
        persisted2 = {
            str(f["exchange_fill_id"]) for batch in rec2.upserted_batches for f in batch
        }
        assert {"6", "7"} <= persisted2, persisted2
        assert set(persisted1) | persisted2 == {"1", "2", "3", "4", "5", "6", "7", "11", "12"}
        assert _the_advance(rec2)["p_last_fetched_ts"] == f7_iso
        for upsert in rec2.analytics_upserts:
            assert "binance_page_cap_symbols" not in upsert["data_quality_flags"]

    async def test_a_cap_stamp_whose_overlap_hour_is_full_resumes_past_the_cap(self) -> None:
        """SC-3 with no exception (orchestrator decision 2026-11-25, T-250-15), REAL constants,
        REAL job, two runs. Pages that re-read the 1 h overlap below the caller's pre-overlap seed
        do NOT count toward `BINANCE_PAGE_CAP`, so a cap stamp B whose overlap hour holds more
        fills than 20 pages can serve is still passed on the next run.

        Venue: BTCUSDT holds 21,000 fills f(k) 150 ms apart, f(k) = 1792587600000 + 150 x (k - 1)
        (f(1) = 1792587600000, 2026-10-21T13:00:00Z), ids 1..21000; the stored fill at C is not
        served by the venue. Run 1 (column C): every page ends after C, so 20 pages count under
        either counting: 20 calls, the cap named, the bound B = f(19981) = 1792590597000
        (2026-10-21T13:49:57Z), the stamp B. Between the runs 100 late fills g(m) = f(9000 + m)
        + 75 ms (ids 21001..21100, 1792588950075 = 2026-10-21T13:22:30.075Z to 1792588964925)
        appear at the venue INSIDE the hour below B, so that hour [B - 1 h, B] holds 20,081 fills,
        more than 20 pages' 20,000 rows serve (RESEARCH Pitfall 4's corner). Run 2 is seeded at B
        (column B, stored fills = run 1's persisted fills plus the fill at C): its walk starts at
        B - 1 h = 1792586997000, before f(1). Pages 1-20 end before B (exempt, uncounted), page
        21 ends at f(20880) = 1792590731850 (counted: 1), page 22 serves the last 121 rows and
        ends the window. Run 2 persists every late fill, names no cap, and stamps f(21000) =
        1792590749850 (2026-10-21T13:52:29.850Z), strictly later than B. Counting every page
        instead caps run 2 at f(19881) = 1792590582000, before B, and never persists
        f(19882)..f(21000).

        Instants are compared PARSED (the fills sit 75 to 150 ms apart), and set sizes and the
        first missing id are asserted, so a RED run prints one short line."""
        t1 = 1792587600000

        def _f(k: int) -> dict[str, Any]:
            return venue_fill("linear", "BTCUSDT", k, t1 + 150 * (k - 1))

        base_fills = [_f(k) for k in range(1, 21001)]
        late_fills = [
            venue_fill("linear", "BTCUSDT", 21000 + m, t1 + 150 * (9000 + m - 1) + 75)
            for m in range(1, 101)
        ]
        assert late_fills[0]["time"] == 1792588950075 and late_fills[-1]["time"] == 1792588964925
        b_instant = datetime(2026, 10, 21, 13, 49, 57, tzinfo=timezone.utc)  # f(19981)
        last_instant = datetime(2026, 10, 21, 13, 52, 29, 850000, tzinfo=timezone.utc)  # f(21000)

        venue1 = BinanceFillsVenue({("linear", "BTCUSDT"): base_fills})
        rec1, fetch1 = await _run_live(
            venue1, column=C_ISO, stored_fills=[C_ISO], symbols=["BTCUSDT"]
        )

        assert fetch1.await_args is not None
        assert fetch1.await_args.kwargs["since_ms"] == C_MS
        assert len(venue1.calls_for("linear")) == 20
        assert rec1.analytics_upserts, "the job wrote no data_quality_flags"
        flags1 = rec1.analytics_upserts[-1]["data_quality_flags"]
        assert flags1.get("binance_page_cap_symbols") == ["BTCUSDT"]
        assert flags1.get("binance_read_through_ms") == 1792590597000
        stamp1 = _the_advance(rec1)["p_last_fetched_ts"]
        assert stamp1 is not None and datetime.fromisoformat(stamp1) == b_instant
        persisted1 = {
            str(f["exchange_fill_id"]): f["timestamp"]
            for batch in rec1.upserted_batches
            for f in batch
        }
        assert len(persisted1) == 19_981, f"run 1 persisted {len(persisted1)} distinct fills"

        venue2 = BinanceFillsVenue({("linear", "BTCUSDT"): [*base_fills, *late_fills]})
        rec2, fetch2 = await _run_live(
            venue2,
            column=stamp1,
            stored_fills=[C_ISO, *persisted1.values()],
            symbols=["BTCUSDT"],
        )

        assert fetch2.await_args is not None
        assert fetch2.await_args.kwargs["since_ms"] == 1792590597000
        persisted2 = {
            str(f["exchange_fill_id"]) for batch in rec2.upserted_batches for f in batch
        }
        late_ids = {str(21000 + m) for m in range(1, 101)}
        assert late_ids <= persisted2, f"{len(late_ids - persisted2)} late fills were not persisted"
        for upsert in rec2.analytics_upserts:
            assert "binance_page_cap_symbols" not in upsert["data_quality_flags"], (
                "run 2 capped again"
            )
        stamp2 = _the_advance(rec2)["p_last_fetched_ts"]
        assert stamp2 is not None, "run 2 stamped nothing"
        assert datetime.fromisoformat(stamp2) == last_instant, f"run 2 stamped {stamp2}"
        assert datetime.fromisoformat(stamp2) > b_instant
        union = set(persisted1) | persisted2
        assert len(union) == 21_100, f"{len(union)} of 21100 venue fills persisted"
        first_missing = next((k for k in range(1, 21_101) if str(k) not in union), None)
        assert first_missing is None, f"first venue fill never persisted: {first_missing}"

    async def test_repeated_deadline_stops_advance_the_frontier_every_run(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """SC-3, T-250-17: with one suspension per venue request (as the network gives every
        real request) the per-request semaphore INTERLEAVES the symbol tasks, so under a
        deadline every symbol starts every run and the frontier moves. Held across a symbol's
        whole walk (N24) the symbols beyond the five semaphore slots would never start, the
        bound would sit at the walk start minus 1 ms, and the stamp would never move.

        Fixture: eight symbols (more than the 5 slots); column C with a stored fill at C; every
        symbol has a venue fill every 2 days from C + 1 day (2026-10-22T12:00:00Z) to
        NOW - 1 day (2026-11-19T12:00:00Z), 15 fills, offset by its index in hours. A run reads
        through the REAL sync job with the budget the job passes (840 s); the clock is pinned to
        one tick of 70 s per venue request (840 / 12), so every run sends exactly 12 requests and
        the 13th check stops it. A symbol's walk from its start to NOW is 5 requests (the 7-day
        windows reach 28 days from C - 1 h, the fifth ends at NOW), so 12 requests across 8
        symbols cannot reach now from the first run's start. Each deadline-stopped run covers a
        prefix of about 7 days from its start and every symbol holds a fill every 2 days, so the
        covered prefix always holds a stored fill after the column.

        Run loop, at most 12 runs: each run's stored fills are the stored fill at C plus every
        fill persisted so far, its column the previous run's stamp (flags are not shared across
        runs: that would test the self-heal, not the producer)."""
        step = SYNC_READ_BUDGET_S / 12
        rows: dict[tuple[str, str], list[dict[str, Any]]] = {}
        time_by_id: dict[str, int] = {}
        for idx, (_stored, venue_id) in enumerate(EIGHT_LINEAR):
            fills = []
            for k in range(15):
                fill_id = (idx + 1) * 1000 + k + 1
                at = C_MS + DAY_MS + 2 * DAY_MS * k + idx * HOUR_MS
                fills.append(venue_fill("linear", venue_id, fill_id, at))
                time_by_id[str(fill_id)] = at
            rows[("linear", venue_id)] = fills
        venue = BinanceFillsVenue(rows, suspend_per_request=True)
        monkeypatch.setattr(ex, "_monotonic", lambda: float(len(venue.calls)) * step)
        symbols = [stored for stored, _venue_id in EIGHT_LINEAR]

        column = C_ISO
        persisted: dict[str, str] = {}
        stopped_runs = 0
        prev_frontier: int | None = None
        final_stamp: str | None = None
        ended = False
        for run in range(1, 13):
            calls_before = len(venue.calls)
            rec, _fetch = await _run_live(
                venue,
                column=column,
                stored_fills=[C_ISO, *persisted.values()],
                symbols=symbols,
            )
            run_calls = venue.calls[calls_before:]
            flags = (
                rec.analytics_upserts[-1]["data_quality_flags"] if rec.analytics_upserts else {}
            )
            for batch in rec.upserted_batches:
                for f in batch:
                    persisted[str(f["exchange_fill_id"])] = f["timestamp"]
            stamp = _the_advance(rec)["p_last_fetched_ts"]
            if "binance_deadline_symbols" not in flags:
                final_stamp = stamp
                ended = True
                break

            stopped_runs += 1
            assert len(run_calls) == 12, f"run {run} sent {len(run_calls)} requests"
            asked = {req["symbol"] for kind, req in run_calls if kind == "linear"}
            assert asked == {venue_id for _s, venue_id in EIGHT_LINEAR}, (
                f"run {run}: symbols that never sent a request: "
                f"{sorted({v for _s, v in EIGHT_LINEAR} - asked)}"
            )
            frontier = flags.get("binance_read_through_ms")
            assert isinstance(frontier, int), f"run {run} recorded no read-through bound"
            if prev_frontier is not None:
                assert frontier > prev_frontier, (
                    f"run {run}: the frontier did not advance ({frontier} <= {prev_frontier})"
                )
            prev_frontier = frontier
            assert stamp is not None, f"run {run} stamped nothing"
            assert datetime.fromisoformat(stamp) > datetime.fromisoformat(column), (
                f"run {run}: the stamp {stamp} did not pass its column {column}"
            )
            stamp_ms = int(datetime.fromisoformat(stamp).timestamp() * 1000)
            unpersisted = [
                fid for fid, at in time_by_id.items() if at <= stamp_ms and fid not in persisted
            ]
            assert not unpersisted, f"run {run}: stamped past unpersisted fills {unpersisted[:3]}"
            column = stamp

        assert ended, "no run reached now within 12 runs"
        assert stopped_runs >= 3, f"only {stopped_runs} deadline-stopped runs before reaching now"
        assert final_stamp is not None
        # The newest venue fill: symbol 7's last, C + 29 days + 7 h = 1795114800000.
        assert datetime.fromisoformat(final_stamp) == datetime(
            2026, 11, 19, 19, 0, tzinfo=timezone.utc
        )
        assert set(persisted) == set(time_by_id), "a venue fill was never persisted"
