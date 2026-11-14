"""Phase 211 SYNCJOBS plan 01 (LASTSYNC-SEED, route half): `POST /fetch-trades`
seeds its resume point from the strategy's STORED high-water, never from
`api_keys.last_sync_at`.

WHY THIS MATTERS. The daily holdings poll overwrites `api_keys.last_sync_at`
for every active key, so that column says "a poll ran recently", not "trades
are stored up to here". A user-triggered fetch that resumed from it walked only
`[last_sync_at, now]` and never re-read a gap in the stored days. The cron was
fixed in Phase 167.1.2.2.2 (newest `is_fill = false` row, floored to 00:00 UTC);
the route kept the old seed. Both now call ONE definition,
`services.trade_resume.load_strategy_high_waters`.

NEUTER (each recorded in the 211-01 SUMMARY, restored from a byte backup):
  N1 restore `since_ms = parse_since_ms(key_data.get("last_sync_at"))` in
     `fetch_trades`: every case here reads the `last_sync_at` instant and goes RED.
  N2 let the new seed fall back to `key_data`'s `last_sync_at` when the stored
     high-water is None: the failed-read and no-stored-day cases go RED, the
     reach-back case stays GREEN (the two properties are told apart).

TRAP (211-PATTERNS): the route's span probe reads min/max `timestamp` over ALL
stored rows and nulls `since_ms` when the span is under 7 days. A single stored
row gives span 0, `since_ms` becomes None on old AND new code, and the test
could never go RED. The fixture therefore stores two daily rows more than 7
days apart.

The `stubbed_exchange_router` fixture is imported from the C-0202 suite
(pytest resolves a fixture imported into a test module's namespace).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from tests.test_exchange_router_c0202 import stubbed_exchange_router  # noqa: F401

STRATEGY_ID = "strat-211"
KEY_ID = "key-211"
USER_ID = "user-211"

# Two DAILY rows more than 7 days apart (so the span guard cannot fire) and one
# FILL row newer than both (so `is_fill = false` is provably the filter).
DAILY_OLD_TS = "2026-04-20T00:00:00+00:00"
DAILY_NEWEST_TS = "2026-05-07T05:17:00+00:00"
FILL_NEWER_TS = "2026-06-01T09:00:00+00:00"
# Hand-typed: 00:00 UTC of 2026-05-07, the newest DAILY row's day.
DAILY_NEWEST_DAY_START_MS = 1778112000000

# A FRESH last_sync_at, as the daily holdings poll leaves it.
FRESH_LAST_SYNC_AT = "2026-11-13T06:00:00+00:00"
# Hand-typed: FRESH_LAST_SYNC_AT in epoch ms.
FRESH_LAST_SYNC_AT_MS = 1794549600000

DEFAULT_TRADES = [
    {"strategy_id": STRATEGY_ID, "is_fill": False, "timestamp": DAILY_OLD_TS},
    {"strategy_id": STRATEGY_ID, "is_fill": False, "timestamp": DAILY_NEWEST_TS},
    {"strategy_id": STRATEGY_ID, "is_fill": True, "timestamp": FILL_NEWER_TS},
]


class _Recorder:
    """What the fake Supabase saw: every `trades` query and every `api_keys` update."""

    def __init__(self) -> None:
        self.trades_queries: list[dict[str, Any]] = []
        self.api_keys_updates: list[dict[str, Any]] = []


def _make_supabase(
    *,
    trades_rows: list[dict[str, Any]],
    trades_select_error: Exception | None = None,
    last_sync_at: str | None = FRESH_LAST_SYNC_AT,
) -> tuple[MagicMock, _Recorder]:
    rec = _Recorder()
    table_rows = list(trades_rows)

    class _FakeTradesQuery:
        """Applies every `.eq`, `.order` and `.limit` (shape copied from
        `tests/test_cron_router.py::_make_mock_supabase_for_cron_sync`, whose
        class is nested in a factory and cannot be imported). The span probe
        (no `is_fill` filter) and the high-water read (`is_fill = false`) are
        both served from the same row list."""

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

    def _single_row_chain(row: dict[str, Any]) -> MagicMock:
        chain = MagicMock()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.single.return_value = chain
        chain.execute.return_value = MagicMock(data=row)
        return chain

    class _FakeApiKeysTable:
        def __init__(self) -> None:
            self._row = {
                "id": KEY_ID,
                "user_id": USER_ID,
                "exchange": "okx",
                "is_active": True,
                "last_sync_at": last_sync_at,
            }

        def select(self, *_a: Any, **_k: Any) -> MagicMock:
            return _single_row_chain(self._row)

        def update(self, payload: dict[str, Any]) -> MagicMock:
            rec.api_keys_updates.append(dict(payload))
            chain = MagicMock()
            chain.eq.return_value = chain
            return chain

    api_keys_table = _FakeApiKeysTable()
    strategy_row = {"id": STRATEGY_ID, "user_id": USER_ID, "api_key_id": KEY_ID}

    supabase = MagicMock()

    def _table(name: str) -> Any:
        if name == "strategies":
            return MagicMock(select=lambda *_a, **_k: _single_row_chain(strategy_row))
        if name == "api_keys":
            return api_keys_table
        if name == "trades":
            return _FakeTradesQuery()
        raise AssertionError(f"unexpected table {name!r} in fetch_trades")

    supabase.table.side_effect = _table
    return supabase, rec


async def _run_fetch_trades(
    router: Any,
    monkeypatch: pytest.MonkeyPatch,
    supabase: MagicMock,
) -> AsyncMock:
    """Drive the REAL `fetch_trades` handler; return the `fetch_all_trades` mock
    so the test reads the `since_ms` the venue was actually asked for."""
    fetch_all = AsyncMock(return_value=[])  # [] skips the `sync_trades` rpc
    monkeypatch.setattr(router, "get_supabase", lambda: supabase)
    monkeypatch.setattr(router, "get_kek", lambda: b"\x00" * 32)
    monkeypatch.setattr(
        router, "decrypt_credentials", lambda *_a, **_k: ("k", "s", "p")
    )
    monkeypatch.setattr(router, "create_exchange", lambda *_a, **_k: MagicMock())
    monkeypatch.setattr(router, "fetch_all_trades", fetch_all)
    monkeypatch.setattr(router, "fetch_usdt_balance", AsyncMock(return_value=123.45))
    monkeypatch.setattr(router, "aclose_exchange", AsyncMock())

    req = MagicMock()
    req.strategy_id = STRATEGY_ID
    await router.fetch_trades(MagicMock(), req)
    return fetch_all


class TestFetchTradesSeedsFromStoredHighWater:
    """`POST /fetch-trades` resumes from the stored daily high-water, not
    from `api_keys.last_sync_at` (Phase 211 LASTSYNC-SEED decisions 1, 2, 3, 5)."""

    async def test_fresh_last_sync_at_still_reaches_back_to_the_stored_daily_day(
        self, stubbed_exchange_router, monkeypatch  # noqa: F811
    ) -> None:
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)

        fetch_all = await _run_fetch_trades(
            stubbed_exchange_router, monkeypatch, supabase
        )

        fetch_all.assert_awaited_once()
        since_ms = fetch_all.await_args.kwargs["since_ms"]
        assert since_ms == DAILY_NEWEST_DAY_START_MS, (
            f"since_ms={since_ms}: expected 00:00 UTC of the newest DAILY row's "
            f"day ({DAILY_NEWEST_DAY_START_MS}); the poll-written last_sync_at "
            f"instant would be {FRESH_LAST_SYNC_AT_MS}"
        )
        # The high-water read is the one query with the `is_fill = false` filter.
        hw_queries = [
            q for q in rec.trades_queries if ("is_fill", False) in q["eq"]
        ]
        assert len(hw_queries) == 1
        assert hw_queries[0]["order"] == ("timestamp", True)
        assert hw_queries[0]["limit"] == 1

    async def test_failed_high_water_read_fetches_full_reach_not_last_sync_at(
        self, stubbed_exchange_router, monkeypatch  # noqa: F811
    ) -> None:
        # Decision 3: the cron's direction. A failed read fails OPEN to a full
        # reach (over-fetch is idempotent), never back to the poll-written
        # `last_sync_at`. On the pre-change route the span probe raised and its
        # `except` kept the `last_sync_at` seed, so this case is RED there.
        supabase, _rec = _make_supabase(
            trades_rows=DEFAULT_TRADES,
            trades_select_error=RuntimeError("PostgREST 503 simulated"),
        )

        fetch_all = await _run_fetch_trades(
            stubbed_exchange_router, monkeypatch, supabase
        )

        fetch_all.assert_awaited_once()
        since_ms = fetch_all.await_args.kwargs["since_ms"]
        assert since_ms is None, (
            f"since_ms={since_ms}: a failed high-water read must fetch the full "
            f"reach (None), not the last_sync_at instant {FRESH_LAST_SYNC_AT_MS}"
        )

    async def test_strategy_with_no_stored_day_fetches_full_reach_without_probing(
        self, stubbed_exchange_router, monkeypatch  # noqa: F811
    ) -> None:
        supabase, rec = _make_supabase(trades_rows=[])

        fetch_all = await _run_fetch_trades(
            stubbed_exchange_router, monkeypatch, supabase
        )

        fetch_all.assert_awaited_once()
        since_ms = fetch_all.await_args.kwargs["since_ms"]
        assert since_ms is None, (
            f"since_ms={since_ms}: no stored daily row means full reach (None), "
            f"not the last_sync_at instant {FRESH_LAST_SYNC_AT_MS}"
        )
        # The span probe runs only on a non-None seed (decision 5), so the one
        # recorded query is the high-water read.
        assert len(rec.trades_queries) == 1
        assert ("is_fill", False) in rec.trades_queries[0]["eq"]

    async def test_route_still_writes_last_sync_at_and_balance_after_the_fetch(
        self, stubbed_exchange_router, monkeypatch  # noqa: F811
    ) -> None:
        # Decision 5: four other readers depend on `api_keys.last_sync_at`, so
        # it stops being a SEED but the route keeps WRITING it.
        supabase, rec = _make_supabase(trades_rows=DEFAULT_TRADES)

        await _run_fetch_trades(stubbed_exchange_router, monkeypatch, supabase)

        assert len(rec.api_keys_updates) == 1
        payload = rec.api_keys_updates[0]
        assert payload["last_sync_at"] != FRESH_LAST_SYNC_AT  # advanced to now
        assert payload["account_balance_usdt"] == 123.45
