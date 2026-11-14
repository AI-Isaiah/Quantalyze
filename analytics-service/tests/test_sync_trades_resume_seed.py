"""Phase 211 SYNCJOBS plan 04 (LASTSYNC-SEED, job half): the queued
`run_sync_trades_job` seeds its two reads from the strategy's STORED high-water,
never from `api_keys.last_sync_at`.

WHY THIS MATTERS. The daily holdings poll overwrites `api_keys.last_sync_at`
for every active key, so that column says "a poll ran recently", not "trades
are stored up to here". A queued sync seeded from it walked only
`[last_sync_at, now]` and never re-read a gap in the stored days. Plan 01 fixed
the route; this file pins the job. Both call ONE definition,
`services.trade_resume.load_strategy_high_waters`.

LASTSYNC-SEED decision 4 splits the old single `since_ms`:
  * the daily-P&L read (`fetch_all_trades`) seeds from the stored `is_fill =
    false` high-water and NEVER trusts the fills cursor;
  * the fills read (`fetch_raw_trades`) prefers `last_fetched_trade_timestamp`
    and falls back to the stored high-water when that cursor is NULL.

THE FAKE FILTERS. The `trades` table fake applies every `.eq`, `.order` and
`.limit`, because a bare `MagicMock` would make the helper fail open (full
reach, `since_ms None`) and the test could not tell a real seed from a failed
read (RESEARCH silent-pass hazard).

NEUTER (each recorded in the 211-04 SUMMARY, restored from a byte backup):
  N1 restore the single `since_ms` from `last_sync_at` with the fills cursor
     preferred, passed to both reads: cases (a), (b) and (c) go RED.
  N2 let the fills value fall back to `last_sync_at` instead of the high-water:
     case (a) goes RED on the `fetch_raw_trades` assertion while its
     `fetch_all_trades` assertion still passes (the two reads are pinned apart).
  N3 seed the daily read from `fills_since_ms`: case (b) goes RED on the
     `fetch_all_trades` assertion.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from services.job_worker import DispatchOutcome, run_sync_trades_job

STRATEGY_ID = "strat-211-job"

# Two DAILY rows and one FILL row newer than both: `is_fill = false` is
# provably the filter (the fill is the newest row overall).
DAILY_OLD_TS = "2026-04-20T00:00:00+00:00"
DAILY_NEWEST_TS = "2026-05-07T05:17:00+00:00"
FILL_NEWER_TS = "2026-06-01T09:00:00+00:00"
# Hand-typed: 00:00 UTC of 2026-05-07, the newest DAILY row's day.
DAILY_NEWEST_DAY_START_MS = 1778112000000

# A FRESH last_sync_at, as the daily holdings poll leaves it.
FRESH_LAST_SYNC_AT = "2026-11-13T06:00:00+00:00"

# A fills cursor between the daily high-water and the fill row.
FILLS_CURSOR = "2026-05-10T12:00:00+00:00"
# Hand-typed: FILLS_CURSOR in epoch ms (2026-05-10T12:00Z, NOT floored).
FILLS_CURSOR_MS = 1778414400000

DEFAULT_TRADES = [
    {"strategy_id": STRATEGY_ID, "is_fill": False, "timestamp": DAILY_OLD_TS},
    {"strategy_id": STRATEGY_ID, "is_fill": False, "timestamp": DAILY_NEWEST_TS},
    {"strategy_id": STRATEGY_ID, "is_fill": True, "timestamp": FILL_NEWER_TS},
]


class _Recorder:
    """What the fake Supabase saw: every `trades` high-water query."""

    def __init__(self) -> None:
        self.trades_queries: list[dict[str, Any]] = []


def _make_supabase(
    *,
    trades_rows: list[dict[str, Any]],
    trades_select_error: Exception | None = None,
) -> tuple[MagicMock, _Recorder]:
    rec = _Recorder()
    table_rows = list(trades_rows)

    class _FakeTradesQuery:
        """Applies every `.eq`, `.order` and `.limit` (shape copied from
        `tests/test_fetch_trades_resume_seed.py`)."""

        def __init__(self) -> None:
            self._eq: list[tuple[str, Any]] = []
            self._order: tuple[str, bool] | None = None
            self._limit: int | None = None

        def select(self, *_a: Any, **_k: Any) -> "_FakeTradesQuery":
            return self

        def eq(self, col: str, val: Any) -> "_FakeTradesQuery":
            self._eq.append((col, val))
            return self

        def order(self, col: str, desc: bool = False) -> "_FakeTradesQuery":
            self._order = (col, desc)
            return self

        def limit(self, n: int) -> "_FakeTradesQuery":
            self._limit = n
            return self

        def execute(self) -> Any:
            rec.trades_queries.append(
                {"eq": list(self._eq), "order": self._order, "limit": self._limit}
            )
            if trades_select_error is not None:
                raise trades_select_error
            matched = [
                r for r in table_rows if all(r.get(c) == v for c, v in self._eq)
            ]
            if self._order is not None:
                col, desc = self._order
                matched.sort(key=lambda r: r[col], reverse=desc)
            if self._limit is not None:
                matched = matched[: self._limit]
            return MagicMock(data=[{"timestamp": r["timestamp"]} for r in matched])

    supabase = MagicMock()

    def _rpc(name: str, _payload: dict[str, Any]) -> MagicMock:
        stub = MagicMock()
        # advance_sync_cursor answers owned/written (True).
        stub.execute.return_value = MagicMock(
            data=True if name == "advance_sync_cursor" else 0
        )
        return stub

    supabase.rpc.side_effect = _rpc

    def _table(name: str) -> Any:
        if name == "trades":
            return _FakeTradesQuery()
        return MagicMock()

    supabase.table.side_effect = _table
    return supabase, rec


async def _run_job(
    *,
    supabase: MagicMock,
    last_fetched_trade_timestamp: str | None,
) -> tuple[AsyncMock, AsyncMock]:
    """Drive the REAL `run_sync_trades_job`; return the `(fetch_all_trades,
    fetch_raw_trades)` mocks so the test reads the `since_ms` each read got."""
    mock_exchange = AsyncMock()
    mock_exchange.close = AsyncMock()

    mock_ctx = MagicMock()
    mock_ctx.exchange = mock_exchange  # ccxt shape, NOT Mt5Session
    mock_ctx.supabase = supabase
    mock_ctx.strategy_row = {"id": STRATEGY_ID, "user_id": "user-1"}
    mock_ctx.key_row = {
        "id": "key-1",
        "exchange": "okx",
        "user_id": "user-1",
        "last_sync_at": FRESH_LAST_SYNC_AT,
        "last_fetched_trade_timestamp": last_fetched_trade_timestamp,
    }

    fetch_all = AsyncMock(return_value=[])
    fetch_raw = AsyncMock(return_value=[])
    job = {"id": "job-211", "kind": "sync_trades", "strategy_id": STRATEGY_ID}

    with patch(
        "services.job_worker._exchange_preflight",
        new=AsyncMock(return_value=mock_ctx),
    ), patch(
        "services.job_worker.fetch_all_trades", new=fetch_all,
    ), patch(
        "services.job_worker.fetch_usdt_balance",
        new=AsyncMock(return_value=10000.0),
    ), patch(
        "services.job_worker.fetch_raw_trades", new=fetch_raw,
    ), patch(
        "services.job_worker.db_execute",
        new=AsyncMock(side_effect=lambda fn: fn()),
    ), patch(
        "services.job_worker._RAW_TRADE_INGESTION_ENABLED", True,
    ):
        result = await run_sync_trades_job(job)

    assert result.outcome == DispatchOutcome.DONE
    fetch_all.assert_awaited_once()
    fetch_raw.assert_awaited_once()
    return fetch_all, fetch_raw


class TestSyncTradesJobSeedsFromStoredHighWater:
    """LASTSYNC-SEED decisions 1 (job half), 2, 3 and 4.

    Neuters N1 to N3 are listed in the module docstring and recorded in the
    211-04 SUMMARY.
    """

    async def test_fresh_last_sync_at_and_no_fills_cursor_reach_back_to_stored_day(
        self,
    ) -> None:
        # Case (a): a fresh last_sync_at (the poll's write) and a NULL fills
        # cursor. Both reads must reach back to 00:00 UTC of the newest stored
        # DAILY row, ignoring the newer fill row and the fresh last_sync_at.
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        fetch_all, fetch_raw = await _run_job(
            supabase=supabase, last_fetched_trade_timestamp=None
        )

        assert fetch_all.call_args.kwargs["since_ms"] == DAILY_NEWEST_DAY_START_MS
        assert fetch_raw.call_args.kwargs["since_ms"] == DAILY_NEWEST_DAY_START_MS
        # The high-water read filters on is_fill = false, otherwise the newer
        # fill row would move the floor past the open gap.
        assert rec.trades_queries, "the stored high-water was never read"
        assert all(("is_fill", False) in q["eq"] for q in rec.trades_queries)

    async def test_failed_high_water_read_gives_full_reach_on_both_reads(
        self,
    ) -> None:
        # Case (c): the high-water read fails. LASTSYNC-SEED decision 3: full
        # reach (since_ms None) on the daily read, and on the fills read when
        # its cursor is NULL. NEVER the last_sync_at instant.
        supabase, _rec = _make_supabase(
            trades_rows=DEFAULT_TRADES,
            trades_select_error=RuntimeError("PostgREST 503 simulated"),
        )
        fetch_all, fetch_raw = await _run_job(
            supabase=supabase, last_fetched_trade_timestamp=None
        )

        assert fetch_all.call_args.kwargs["since_ms"] is None
        assert fetch_raw.call_args.kwargs["since_ms"] is None

    async def test_fills_cursor_governs_the_fills_read_only(self) -> None:
        # Case (b): a fills cursor is set (and a fresh last_sync_at). The fills
        # read keeps the cursor UNFLOORED (decision 4), while the daily read
        # never trusts it and still reaches back to the stored daily day.
        supabase, _rec = _make_supabase(trades_rows=DEFAULT_TRADES)
        fetch_all, fetch_raw = await _run_job(
            supabase=supabase, last_fetched_trade_timestamp=FILLS_CURSOR
        )

        assert fetch_raw.call_args.kwargs["since_ms"] == FILLS_CURSOR_MS
        assert fetch_all.call_args.kwargs["since_ms"] == DAILY_NEWEST_DAY_START_MS
