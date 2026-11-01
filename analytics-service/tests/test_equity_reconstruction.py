"""Shared fakes and two surviving tests for analytics-service/services/equity_reconstruction.py (Phase 07, Plan 02).

Phase 176 (D-02, D-04) deleted the legacy allocator equity writers, both job bodies, the bootstrap
twin and the history crawl, and with them the tests that drove them. This module stays for what
other test modules import from it (``FakeSupabaseClient``, ``_FakeTable``, ``_install_fake_preflight``,
``_install_fake_audit`` and the ids) and for the two tests of code that still exists:

  1. test_wr_adv_02_fetch_transfers_paginates_within_window
  2. test_v0_15_4_3_ohlcv_paginates_past_venue_page_cap

Mocks follow the test_allocator_positions.py style: AsyncMock for ccxt methods, a
FakeSupabaseClient with an in-memory dict keyed by (table, conflict-key), and monkeypatched
get_supabase.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError


ALLOCATOR_ID = "00000000-0000-0000-0000-0000000000aa"
API_KEY_ID_1 = "00000000-0000-0000-0000-000000000001"
API_KEY_ID_2 = "00000000-0000-0000-0000-000000000002"


# ---------------------------------------------------------------------------
# FakeSupabaseClient — in-memory store keyed by (table, PK-tuple).
# Mirrors the minimal surface the handlers consume:
#   .table(name).upsert(rows, on_conflict=..., ignore_duplicates=...).execute()
#   .table(name).select(...).eq(...).execute()  (returns .data)
#   .table(name).update(...).eq(...).execute()
# ---------------------------------------------------------------------------


class _FakeUpsertResult:
    def __init__(self, data: list[dict], count: int | None = None):
        self.data = data
        # L-0067/L-0066: production now requests count='exact' +
        # returning='minimal'. Mirror real PostgREST: when count was
        # requested, .count carries the authoritative write/delete count
        # and .data is empty (minimal). _result_row_count prefers .count.
        self.count = count


class _FakeSelectResult:
    def __init__(self, data: list[dict] | None = None, count: int | None = None):
        self.data = data if data is not None else []
        self.count = count


class _FakeUpdateResult:
    def __init__(self, data: list[dict] | None = None):
        self.data = data or []


class _FakeTable:
    """In-memory table. Rows keyed by a tuple of on_conflict columns."""

    def __init__(self, name: str, store: dict):
        self._name = name
        self._store = store  # { (table, pk_tuple): row_dict }
        # Filter state for chained .select(...).eq(...).execute()
        self._select_filters: list[tuple[str, Any]] = []
        self._select_neq_filters: list[tuple[str, Any]] = []
        self._select_is_null_cols: list[str] = []
        self._select_ranges: list[tuple[str, str, str]] = []  # (col, op, val)
        # PostgREST `.order(col, desc=...)` and `.limit(n)`: applied before the response cap, as
        # the server does (review WR-05: a newest-first limit-1 read must return the newest row).
        self._select_order: list[tuple[str, bool]] = []
        self._select_limit: int | None = None
        # PostgREST `.in_(col, values)`: col IN (values). Added for the daily
        # refresh's reconstruct-hold probe (Phase 167.1.2 plan 12, SFH-R2-01).
        self._select_in_filters: list[tuple[str, frozenset]] = []
        self._select_count_mode: str | None = None
        # Pending write
        self._pending_op: str | None = None  # 'upsert' | 'update' | 'insert' | 'delete'
        self._pending_rows: list[dict] = []
        self._pending_on_conflict: str | None = None
        self._pending_ignore_duplicates: bool = False
        self._pending_update_payload: dict = {}
        # L-0066/L-0067: write-path count='exact' / returning='minimal'.
        self._pending_count_mode: str | None = None
        self._pending_returning: str | None = None

    # --- write ops ---
    def upsert(
        self,
        rows,
        on_conflict: str | None = None,
        ignore_duplicates: bool = False,
        count: str | None = None,
        returning: str | None = None,
    ):
        self._pending_op = "upsert"
        self._pending_rows = rows if isinstance(rows, list) else [rows]
        self._pending_on_conflict = on_conflict
        self._pending_ignore_duplicates = ignore_duplicates
        # L-0067: production requests count='exact' + returning='minimal'.
        self._pending_count_mode = count
        self._pending_returning = returning
        return self

    def insert(self, rows):
        self._pending_op = "insert"
        self._pending_rows = rows if isinstance(rows, list) else [rows]
        return self

    def update(self, payload: dict):
        self._pending_op = "update"
        self._pending_update_payload = payload
        return self

    def delete(self, count: str | None = None, returning: str | None = None):
        self._pending_op = "delete"
        # L-0066: production requests count='exact' + returning='minimal'.
        self._pending_count_mode = count
        self._pending_returning = returning
        return self

    # --- select ops ---
    def select(self, *_args, count: str | None = None, head: bool = False, **_kwargs):
        self._pending_op = "select"
        self._select_count_mode = count
        return self

    def eq(self, col: str, val):
        self._select_filters.append((col, val))
        return self

    def neq(self, col: str, val):
        self._select_neq_filters.append((col, val))
        return self

    def is_(self, col: str, val):
        # Supabase-py: `.is_(col, "null")` or `.is_(col, None)` -> col IS NULL.
        # Any other value is treated as IS <literal>; for our tests NULL is all we need.
        if val in (None, "null", "NULL"):
            self._select_is_null_cols.append(col)
        else:
            self._select_filters.append((col, val))
        return self

    def in_(self, col: str, values):
        self._select_in_filters.append((col, frozenset(values)))
        return self

    def gt(self, col: str, val):
        self._select_ranges.append((col, "gt", val))
        return self

    def gte(self, col: str, val):
        self._select_ranges.append((col, "gte", val))
        return self

    def lte(self, col: str, val):
        self._select_ranges.append((col, "lte", val))
        return self

    def lt(self, col: str, val):
        self._select_ranges.append((col, "lt", val))
        return self

    def order(self, *args, **kwargs):
        if args:
            self._select_order.append((args[0], bool(kwargs.get("desc", False))))
        return self

    # PostgREST `.range(start, end)` (inclusive) and its per-response row ceiling.
    # `max_rows` is None unless a test sets it, so no other test sees a cap.
    max_rows: int | None = None
    _range: tuple[int, int] | None = None

    def range(self, start: int, end: int):
        self._range = (start, end)
        return self

    def limit(self, *args, **_kwargs):
        if args:
            self._select_limit = int(args[0])
        return self

    def maybe_single(self):
        return self

    # --- execute ---
    def _row_matches(self, row: dict) -> bool:
        """Every filter of this chain, for select AND delete (one predicate, so the two
        cannot drift: a delete that ignored a range or an in-list used to remove the whole
        table)."""
        if not all(row.get(c) == v for c, v in self._select_filters):
            return False
        if any(row.get(c) == v for c, v in self._select_neq_filters):
            return False
        if any(row.get(c) is not None for c in self._select_is_null_cols):
            return False
        if not all(row.get(c) in vals for c, vals in self._select_in_filters):
            return False
        for col, op, val in self._select_ranges:
            rv = row.get(col)
            if rv is None:
                return False
            if op == "gt" and not (rv > val):
                return False
            if op == "gte" and not (rv >= val):
                return False
            if op == "lte" and not (rv <= val):
                return False
            if op == "lt" and not (rv < val):
                return False
        return True

    def execute(self):
        if self._pending_op == "upsert":
            conflict_cols = (self._pending_on_conflict or "").split(",")
            conflict_cols = [c.strip() for c in conflict_cols if c.strip()]
            written: list[dict] = []
            for row in self._pending_rows:
                pk = tuple(row.get(c) for c in conflict_cols)
                key = (self._name, pk)
                if key in self._store:
                    # DO NOTHING / ignore_duplicates — benign no-op.
                    if self._pending_ignore_duplicates:
                        continue
                    # DO UPDATE — overwrite.
                    self._store[key] = dict(row)
                    written.append(dict(row))
                else:
                    self._store[key] = dict(row)
                    written.append(dict(row))
            # Mirror real PostgREST: count='exact' populates .count with the
            # affected-row count; returning='minimal' empties .data (the
            # response no longer echoes the inserted representation).
            if self._pending_count_mode == "exact":
                data_out = [] if self._pending_returning == "minimal" else written
                return _FakeUpsertResult(data_out, count=len(written))
            return _FakeUpsertResult(written)

        if self._pending_op == "insert":
            written: list[dict] = []
            for row in self._pending_rows:
                # Fabricate a fake PK if none; most tests only care about presence.
                # For token_price_history and compute_jobs we pass complete rows.
                # Use (symbol, asof) as PK for token_price_history.
                if self._name == "token_price_history":
                    key = (self._name, (row.get("symbol"), row.get("asof")))
                else:
                    key = (self._name, len(self._store))
                self._store[key] = dict(row)
                written.append(dict(row))
            return _FakeUpsertResult(written)

        if self._pending_op == "update":
            matched: list[dict] = []
            for (tbl, _pk), row in list(self._store.items()):
                if tbl != self._name:
                    continue
                if all(row.get(c) == v for c, v in self._select_filters):
                    row.update(self._pending_update_payload)
                    matched.append(row)
            return _FakeUpdateResult(matched)

        if self._pending_op == "delete":
            deleted: list[dict] = []
            for key in list(self._store.keys()):
                tbl, _pk = key
                if tbl != self._name:
                    continue
                row = self._store[key]
                if not self._row_matches(row):
                    continue
                deleted.append(dict(row))
                del self._store[key]
            # Mirror real PostgREST for the L-0066 count='exact' delete path.
            if self._pending_count_mode == "exact":
                data_out = [] if self._pending_returning == "minimal" else deleted
                return _FakeUpsertResult(data_out, count=len(deleted))
            return _FakeUpdateResult(deleted)

        if self._pending_op == "select":
            matched = []
            for (tbl, _pk), row in self._store.items():
                if tbl != self._name:
                    continue
                if not self._row_matches(row):
                    continue
                matched.append(dict(row))

            total_matched = len(matched)
            for col, desc in reversed(self._select_order):
                matched.sort(key=lambda r, c=col: (r.get(c) is None, r.get(c)), reverse=desc)
            if self._select_limit is not None:
                matched = matched[:self._select_limit]
            if self._range is not None:
                matched = matched[self._range[0]:self._range[1] + 1]
            if _FakeTable.max_rows is not None:
                matched = matched[:_FakeTable.max_rows]
            if self._select_count_mode == "exact":
                return _FakeSelectResult(data=matched, count=total_matched)
            return _FakeSelectResult(data=matched)

        return _FakeSelectResult()


class FakeSupabaseClient:
    """Minimal Supabase stub sufficient for equity_reconstruction handlers."""

    def __init__(self):
        # Key: (table_name, pk_tuple) → row dict
        self.store: dict[tuple, dict] = {}
        # Record of rpc calls
        self.rpc_calls: list[tuple[str, dict]] = []

    def table(self, name: str) -> _FakeTable:
        return _FakeTable(name, self.store)

    # Alias used by some supabase calls (from_ == table)
    def from_(self, name: str) -> _FakeTable:
        return self.table(name)

    def rpc(self, name: str, params: dict | None = None):
        params = params or {}
        self.rpc_calls.append((name, params))
        store = self.store

        # E4 (HIGH8): emulate the atomic replace_allocator_equity_snapshots
        # RPC against the in-memory store so the sole-key integration tests
        # still verify end-to-end behaviour (stale rows gone, fresh rows
        # written) now that the recovery path calls the RPC instead of
        # separate purge + persist. Mirrors the SQL function: DELETE every
        # row for p_allocator_id, then INSERT p_rows with the WR-05 per-row
        # depth rule, in one (logically atomic) operation. Returns the
        # inserted count under .data (scalar RETURNS integer).
        if name == "replace_allocator_equity_snapshots":
            alloc = params.get("p_allocator_id")
            new_rows = params.get("p_rows") or []
            depth = params.get("p_depth_months")
            # Purge (scoped strictly to this allocator).
            for key in list(store.keys()):
                tbl, _pk = key
                if tbl != "allocator_equity_snapshots":
                    continue
                if store[key].get("allocator_id") == alloc:
                    del store[key]
            # Insert; first-writer-wins on duplicate asof (ON CONFLICT DO NOTHING).
            inserted = 0
            for r in new_rows:
                pk = (alloc, r.get("asof"))
                key = ("allocator_equity_snapshots", pk)
                if key in store:
                    continue
                src = r.get("source", "exchange_primary")
                store[key] = {
                    "allocator_id": alloc,
                    "asof": r.get("asof"),
                    "value_usd": r.get("value_usd"),
                    "breakdown": r.get("breakdown"),
                    "source": src,
                    "history_depth_months": depth if src == "exchange_primary" else None,
                    # CL9 / NEW-C01-11: mirror the RPC's COALESCE(...false) so the
                    # in-memory store reflects the persisted per-row flag.
                    "pre_terminus_balance_unknown": bool(
                        r.get("pre_terminus_balance_unknown", False)
                    ),
                }
                inserted += 1

            class _ReplaceShim:
                def execute(inner_self):
                    return _FakeSelectResult(data=inserted)

            return _ReplaceShim()

        # Phase 167.2.1.1.2 ACCTREBUILD: a Python MIRROR of
        # replace_allocator_equity_snapshots_window (migration 20261028120000). It proves
        # only the worker's MAPPING (the arguments it sends and how it reads the answer or
        # the refusal); the SQL gate supabase/tests/test_replace_allocator_equity_snapshots_window.sql
        # proves the semantics. Same order as the SQL: validate the payload, find the stored
        # days inside the window the payload does not reproduce and REFUSE before touching
        # the store, else delete exactly the window, insert first-writer-wins with the
        # depth and CL9 rules above, and keep or drop the seam row.
        if name == "replace_allocator_equity_snapshots_window":
            alloc = params.get("p_allocator_id")
            payload_rows = params.get("p_rows")
            depth = params.get("p_depth_months")
            window_start = params.get("p_window_start")
            snapshot_table = "allocator_equity_snapshots"

            class _WindowShim:
                def execute(inner_self):
                    if (
                        not alloc
                        or not window_start
                        or not isinstance(payload_rows, list)
                        or not payload_rows
                        or any(not r.get("asof") for r in payload_rows)
                        or any(str(r["asof"]) < str(window_start) for r in payload_rows)
                        or len({r["asof"] for r in payload_rows}) != len(payload_rows)
                    ):
                        raise APIError(
                            {
                                "code": "22023",
                                "message": "replace_allocator_equity_snapshots_window: malformed input",
                                "details": None,
                                "hint": None,
                            }
                        )
                    payload_asofs = {str(r["asof"]) for r in payload_rows}
                    in_window = [
                        key
                        for key, row in store.items()
                        if key[0] == snapshot_table
                        and row.get("allocator_id") == alloc
                        and str(row.get("asof")) >= str(window_start)
                    ]
                    unreproduced = [
                        key for key in in_window if str(store[key].get("asof")) not in payload_asofs
                    ]
                    if unreproduced:
                        raise APIError(
                            {
                                "code": "P0001",
                                "message": "history_days_unreproduced",
                                "details": str(len(unreproduced)),
                                "hint": None,
                            }
                        )
                    for key in in_window:
                        del store[key]
                    inserted = 0
                    for r in payload_rows:
                        key = (snapshot_table, (alloc, r["asof"]))
                        if key in store:
                            continue
                        src = r.get("source", "exchange_primary")
                        store[key] = {
                            "allocator_id": alloc,
                            "asof": r["asof"],
                            "value_usd": r.get("value_usd"),
                            "breakdown": r.get("breakdown"),
                            "source": src,
                            "history_depth_months": depth if src == "exchange_primary" else None,
                            "pre_terminus_balance_unknown": bool(
                                r.get("pre_terminus_balance_unknown", False)
                            ),
                        }
                        inserted += 1
                    boundary_key = ("allocator_equity_derived", (alloc, "snapshot_rebuild_boundary"))
                    older_kept = any(
                        key[0] == snapshot_table
                        and store[key].get("allocator_id") == alloc
                        and str(store[key].get("asof")) < str(window_start)
                        for key in store
                    )
                    if older_kept:
                        store[boundary_key] = {
                            "allocator_id": alloc,
                            "kind": "snapshot_rebuild_boundary",
                            "payload": {"boundary_date": str(window_start)},
                        }
                    else:
                        store.pop(boundary_key, None)
                    return _FakeSelectResult(data=inserted)

            return _WindowShim()

        class _RPCShim:
            def execute(inner_self):
                return _FakeSelectResult(data=[])

        return _RPCShim()

    def rows_for(self, table: str) -> list[dict]:
        return [row for (tbl, _pk), row in self.store.items() if tbl == table]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _install_fake_preflight(monkeypatch, venue: str, fake_supabase: FakeSupabaseClient, exchange: Any):
    """Patch _allocator_key_preflight to return a ready _ExchangeContext.

    Derives allocator_id from ctx.key_row["user_id"] per VOICES-ACCEPTED f1.
    """
    from services import job_worker as jw
    from services import equity_reconstruction as er

    key_row = {
        "id": API_KEY_ID_1,
        "user_id": ALLOCATOR_ID,
        "exchange": venue,
        "label": "test",
        "is_active": True,
    }

    ctx = jw._ExchangeContext(
        supabase=fake_supabase,
        strategy_row=None,
        key_row=key_row,
        exchange=exchange,
    )

    async def _fake_preflight(job, caller_name):
        # The handler passes its own api_key_id; allow tests to override key
        requested_id = job.get("api_key_id")
        # Phase 167.1.2.1 D-04: a completed reconstruct stamps its key's
        # history_reconstructed_at, and that write FAILS the job when it matches
        # no api_keys row. So the key under reconstruction needs a row in the
        # store. Reconstruct jobs only (a refresh job would gain a phantom
        # eligible key), and setdefault, so a row a test seeded itself (a marker
        # it set, a sibling's fields) is left alone.
        if job.get("kind") == "reconstruct_allocator_history":
            _own_id = requested_id or API_KEY_ID_1
            fake_supabase.store.setdefault(("api_keys", (_own_id,)), {
                "id": _own_id,
                "user_id": ALLOCATOR_ID,
                "exchange": venue,
                "is_active": True,
                "history_reconstructed_at": None,
                "history_reconstruct_attempts": 0,
            })
        if requested_id and requested_id != API_KEY_ID_1:
            return jw._ExchangeContext(
                supabase=fake_supabase,
                strategy_row=None,
                key_row={**key_row, "id": requested_id},
                exchange=exchange,
            )
        return ctx

    monkeypatch.setattr(jw, "_allocator_key_preflight", _fake_preflight)
    # Handlers import the symbol locally from services.job_worker — patch
    # both bindings so whichever path the handler takes hits the fake.
    monkeypatch.setattr(er, "_allocator_key_preflight", _fake_preflight, raising=False)

    # Also make get_supabase return our fake
    from services import db as db_module
    monkeypatch.setattr(db_module, "get_supabase", lambda: fake_supabase)
    monkeypatch.setattr(er, "get_supabase", lambda: fake_supabase, raising=False)


def _install_fake_audit(monkeypatch):
    from services import audit as audit_module
    audit_mock = MagicMock()
    monkeypatch.setattr(audit_module, "log_audit_event", audit_mock)
    return audit_mock


# ---------------------------------------------------------------------------
# Adversarial review regression tests (2026-04-20)
#   WR-ADV-01: per-day source flags must reset each iteration (not latch)
#   WR-ADV-02: _fetch_transfers must paginate within each 90-day window
#   WR-ADV-03: persist_equity_snapshots must write in a single atomic upsert
# ---------------------------------------------------------------------------


    # Day 2: SYMX still held (deposit persists) + new BTC position. BTC
    # comes from OHLCV, SYMX from CoinGecko — this day IS mixed legitimately.
    # So to isolate the latching bug we also test a day where only BTC is
    # active (SYMX gone via withdrawal). That's the ADV-01b test below.


@pytest.mark.asyncio
async def test_wr_adv_02_fetch_transfers_paginates_within_window():
    """Adversarial: _fetch_transfers must paginate WITHIN each 90-day window.
    Pre-fix, a window containing >500 rows dropped everything past row 500
    when the loop advanced cursor_ms += window_ms unconditionally."""
    from services.ccxt_flow_fetch import fetch_ccxt_transfers

    # Simulate a single 90-day window with 750 deposits, forcing within-
    # window pagination. Two pages of 500 then 250.
    window_start_ms = int(datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
    now_ms = int(datetime(2026, 3, 1, tzinfo=timezone.utc).timestamp() * 1000)  # <90d
    day_ms = 24 * 60 * 60 * 1000

    # Each deposit 2 hours apart; fully inside the single window.
    all_events = [
        {"timestamp": window_start_ms + i * (2 * 60 * 60 * 1000), "currency": "USDT", "amount": 1.0}
        for i in range(750)
    ]

    call_log: list[tuple[int, int]] = []

    async def _fake_fetch_deposits(_unused_symbol, since_ms, limit, _params=None):
        call_log.append((since_ms, limit))
        # Filter events whose timestamp >= since_ms, return up to limit.
        matching = [e for e in all_events if e["timestamp"] >= since_ms]
        return matching[:limit]

    mock_exchange = MagicMock()
    mock_exchange.fetch_deposits = _fake_fetch_deposits

    rows = await fetch_ccxt_transfers(mock_exchange, "deposits", window_start_ms, now_ms)

    assert len(rows) == 750, (
        f"expected all 750 in-window deposits to be collected; got {len(rows)}. "
        f"Pre-fix this was 500 because the outer loop advanced the window "
        f"without paginating inside. Call log: {call_log!r}"
    )


# ---------------------------------------------------------------------------
# OHLCV pagination fix (/investigate 2026-04-24 — v0.15.4.3)
# ---------------------------------------------------------------------------
#
# _fetch_ohlcv_daily used to break the paginate loop on `len(page) < 1000`
# as an end-of-data heuristic. OKX's candles endpoint caps at 300 bars per
# request. For any backfill window wider than 300 days (we fetch 730 every
# time a reconstruct runs), the loop stopped after ONE page 300 days in,
# leaving the recent ~430 days of OHLCV unfetched. _price_on's bisect then
# returned the last bar's close for every date after Feb 2025 — production
# marked a 21-ETH short to a stale $2744.46 and reported PERP=-$16,846
# when real unrealised PnL was -$210. Dashboard rendered -1510%.


@pytest.mark.asyncio
async def test_v0_15_4_3_ohlcv_paginates_past_venue_page_cap():
    """Venue returns 300 bars per page, not 1000. The old `len < 1000`
    break ended pagination after one page. Fix: iterate until cursor
    reaches end_ms or the venue stops returning new data.
    """
    from services.equity_reconstruction import _fetch_ohlcv_daily

    day_ms = 24 * 60 * 60 * 1000

    class ShortPageExchange:
        def __init__(self):
            # 730 daily bars (2 years), simulating OKX's per-page cap of
            # 300. Each fetch returns up to 300 bars from `since` forward.
            self.start_ts = 1_700_000_000_000
            self.total_bars = 730
            self.rateLimit = 0
            self.call_count = 0

        async def fetch_ohlcv(self, symbol, timeframe, since_ms, limit):
            self.call_count += 1
            idx = (since_ms - self.start_ts) // day_ms
            if idx < 0:
                idx = 0
            if idx >= self.total_bars:
                return []
            page_cap = 300  # venue-enforced
            end_idx = min(idx + page_cap, self.total_bars)
            return [
                [self.start_ts + i * day_ms, 0, 0, 0, 100.0 + i, 0]
                for i in range(idx, end_idx)
            ]

    ex = ShortPageExchange()
    start_ms = ex.start_ts
    end_ms = ex.start_ts + 729 * day_ms
    rows = await _fetch_ohlcv_daily(ex, "ETH/USDT", start_ms, end_ms)

    assert len(rows) == 730, (
        f"Expected all 730 bars fetched via pagination. Got {len(rows)}. "
        f"If this is 300, the venue-page-cap bug is back (fetch_ohlcv "
        f"returned one short page and _fetch_ohlcv_daily broke out)."
    )
    assert ex.call_count >= 3, (
        f"Expected at least 3 paginated fetch_ohlcv calls (730 bars / "
        f"300/page). Got {ex.call_count}. Pagination did not fire."
    )
    # Closes should be monotonic per the stub (close = 100 + i)
    closes = [r[4] for r in rows]
    assert closes[0] == 100.0
    assert closes[-1] == 100.0 + 729
