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
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import services.exchange as ex
from services.job_worker import DispatchOutcome, run_sync_trades_job
from tests._binance_fills import (
    NOW_MS,
    BinanceFillsVenue,
    real_binance,
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
        _job_exchange: Any, strategy_id: str, _job_supabase: Any, since_ms: int | None = None
    ) -> list[dict[str, Any]]:
        binance = await real_binance(venue)
        try:
            return await ex.fetch_raw_trades(
                binance, strategy_id, symbols_supabase(symbols), since_ms=since_ms
            )
        finally:
            await binance.close()

    fetch_raw = AsyncMock(side_effect=_real_read)
    job = {"id": "job-250", "kind": "sync_trades", "strategy_id": STRATEGY_ID}

    patches = [
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

    @pytest.mark.xfail(
        strict=True,
        reason=(
            "R2-02: ccxt caps a since-only linear request at since + 7 days, so a fill "
            "past a 20-day quiet stretch is never read and the cursor stamps the stale "
            "fill. Plan 250-03 (the window walk) removes this marker; strict mode turns "
            "a pass that arrives early into a failure."
        ),
    )
    async def test_tracer_a_quiet_stretch_is_walked_and_the_cursor_stamps_the_newer_fill(
        self,
    ) -> None:
        """SC-1: a fill at the cursor, 20 quiet days, then a fill 5 days before now. The
        walk reads past the quiet stretch and the cursor stamps the newer fill."""
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

        assert fetch.await_args.kwargs["since_ms"] == C_MS
        assert _the_advance(rec)["p_last_fetched_ts"] == NOW_MINUS_5D_ISO
