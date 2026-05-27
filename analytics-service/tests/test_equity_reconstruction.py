"""Tests for analytics-service/services/equity_reconstruction.py (Phase 07, Plan 02).

TDD Red gate suite driving the implementation in Task 2. Covers:

  1. test_reconstruct_happy_path                 (60-day backfill + history_depth_months)
  2. test_reconstruct_idempotent                 (ON CONFLICT DO NOTHING semantics)
  3. test_reconstruct_okx_3month_terminus        (Pitfall 1 — clean break, log line)
  4. test_reconstruct_coingecko_fallback         (BadSymbol → CoinGecko + token_price_history)
  5. test_refresh_daily_appends_one_row          (per-key daily delta — reads api_key_id)
  6. test_history_depth_months_per_venue         (parametrized binance/okx/bybit — f9)
  7. test_refresh_daily_aggregates_across_keys   (two keys → single snapshot row — f1)

Mocks follow the test_allocator_positions.py style: AsyncMock for ccxt methods,
a FakeSupabaseClient with an in-memory dict keyed by (table, conflict-key),
and monkeypatched get_supabase. CoinGecko HTTP is mocked at the httpx.AsyncClient
level so we never hit the network.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import ccxt.async_support as ccxt
import pytest

# RED state on first run — this module does not exist yet. Task 2 creates it.
from services.equity_reconstruction import (  # noqa: E402
    VENUE_HISTORY_DEPTH_MONTHS,
    history_depth_months_for_venue,
    run_reconstruct_allocator_history_job,
    run_refresh_allocator_equity_daily_job,
)


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

    def gte(self, col: str, val):
        self._select_ranges.append((col, "gte", val))
        return self

    def lte(self, col: str, val):
        self._select_ranges.append((col, "lte", val))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def maybe_single(self):
        return self

    # --- execute ---
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
                if not all(row.get(c) == v for c, v in self._select_filters):
                    continue
                if any(row.get(c) == v for c, v in self._select_neq_filters):
                    continue
                if any(row.get(c) is not None for c in self._select_is_null_cols):
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
                if not all(row.get(c) == v for c, v in self._select_filters):
                    continue
                if any(row.get(c) == v for c, v in self._select_neq_filters):
                    continue
                if any(row.get(c) is not None for c in self._select_is_null_cols):
                    continue
                # range filters
                ok = True
                for col, op, val in self._select_ranges:
                    rv = row.get(col)
                    if rv is None:
                        ok = False
                        break
                    if op == "gte" and not (rv >= val):
                        ok = False
                        break
                    if op == "lte" and not (rv <= val):
                        ok = False
                        break
                if not ok:
                    continue
                matched.append(dict(row))

            if self._select_count_mode == "exact":
                return _FakeSelectResult(data=matched, count=len(matched))
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
        self.rpc_calls.append((name, params or {}))

        class _RPCShim:
            def execute(inner_self):
                return _FakeSelectResult(data=[])

        return _RPCShim()

    def rows_for(self, table: str) -> list[dict]:
        return [row for (tbl, _pk), row in self.store.items() if tbl == table]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_trade(ts_ms: int, symbol: str, side: str, price: float, amount: float) -> dict:
    """Shape matches ccxt.fetch_my_trades return rows."""
    return {
        "timestamp": ts_ms,
        "symbol": symbol,
        "side": side,
        "price": price,
        "amount": amount,
        "cost": price * amount,
        "fee": {"cost": 0.0, "currency": "USDT"},
    }


def _make_ohlcv_row(ts_ms: int, close: float) -> list:
    """[timestamp, open, high, low, close, volume]."""
    return [ts_ms, close, close, close, close, 0.0]


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
# Test 1 — happy path, 60-day backfill
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reconstruct_happy_path(monkeypatch):
    """Reconstruction over a 60-day window with synthetic trades + OHLCV
    produces 60 snapshot rows with source='exchange_primary' and the
    per-venue history_depth_months (Binance → 24)."""
    fake_supabase = FakeSupabaseClient()
    _install_fake_audit(monkeypatch)

    # 60 trading days of BTC data ending "today"
    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=59)

    trades: list[dict] = []
    ohlcv: list[list] = []
    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000
    # Buy 1 BTC at the start
    trades.append(_make_trade(ts, "BTC/USDT", "buy", 50000.0, 1.0))
    for day in range(60):
        day_ts = ts + day * day_ms
        ohlcv.append(_make_ohlcv_row(day_ts, 50000.0 + day * 100.0))

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    # Fix "now" so date math is deterministic.
    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    job = {"id": "job-1", "kind": "reconstruct_allocator_history", "api_key_id": API_KEY_ID_1}
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    rows = fake_supabase.rows_for("allocator_equity_snapshots")
    assert len(rows) >= 1, "expected at least one snapshot row"
    # Window may be clipped to whatever the handler's backfill range is.
    # We assert every row has the correct shape:
    for r in rows:
        assert r["allocator_id"] == ALLOCATOR_ID
        assert r["source"] in {"exchange_primary", "mixed"}
        assert r["history_depth_months"] == 24, (
            f"Binance rows must have history_depth_months=24; got {r!r}"
        )
        assert "value_usd" in r and r["value_usd"] is not None


# ---------------------------------------------------------------------------
# Test 2 — idempotency: run twice, identical row count, reconstructed_at not overwritten
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reconstruct_idempotent(monkeypatch):
    """Running the handler twice with the same fixture produces identical
    row count after the second run AND does NOT update reconstructed_at
    on conflict (proves DO NOTHING, not DO UPDATE)."""
    fake_supabase = FakeSupabaseClient()
    _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=9)
    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000

    trades = [_make_trade(ts, "BTC/USDT", "buy", 50000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + day * day_ms, 50000.0) for day in range(10)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, [], trades, []])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    job = {"id": "job-1", "kind": "reconstruct_allocator_history", "api_key_id": API_KEY_ID_1}

    await run_reconstruct_allocator_history_job(job)
    rows_first = fake_supabase.rows_for("allocator_equity_snapshots")
    first_reconstructed_at = {
        (r["allocator_id"], r["asof"]): r.get("reconstructed_at") for r in rows_first
    }

    # Simulate the real worker: after a successful run, compute_jobs has a
    # status='done' row for this api_key. The per-api_key gate (migration
    # 076) then short-circuits any subsequent reconstruct for the same
    # key, which is the production idempotency guarantee — not the
    # DO NOTHING at the persist layer. Without this seed, the second run
    # would legitimately purge + re-upsert (sole-key fresh-source
    # behavior from the 2026-04-22 /investigate fix).
    fake_supabase.store[("compute_jobs", ("done-first-run",))] = {
        "id": "done-first-run",
        "api_key_id": API_KEY_ID_1,
        "kind": "reconstruct_allocator_history",
        "status": "done",
    }

    # Second run — handler early-returns via the per-api_key gate; the
    # rows written by the first run remain untouched.
    await run_reconstruct_allocator_history_job(job)
    rows_second = fake_supabase.rows_for("allocator_equity_snapshots")

    assert len(rows_second) == len(rows_first), (
        f"idempotency violated: {len(rows_first)} → {len(rows_second)}"
    )

    # reconstructed_at must NOT have been updated on the second pass
    for r in rows_second:
        key = (r["allocator_id"], r["asof"])
        assert r.get("reconstructed_at") == first_reconstructed_at[key], (
            "ON CONFLICT DO NOTHING violated: reconstructed_at was rewritten on second run"
        )


# ---------------------------------------------------------------------------
# Test 3 — OKX 3-month terminus: clean break + sentinel log line
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reconstruct_okx_3month_terminus(monkeypatch, caplog):
    """Pitfall 1: OKX empty page for since < now-90d must NOT raise;
    handler logs sentinel 'OKX trade history capped at 3 months' and
    records history_depth_months=3 on the resulting rows (per f9)."""
    fake_supabase = FakeSupabaseClient()
    _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    # 60 days of trades INSIDE the 90-day window
    start_date = end_date - timedelta(days=60)
    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000

    trades = [_make_trade(ts, "BTC/USDT", "buy", 50000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + day * day_ms, 50000.0) for day in range(61)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "okx"
    # OKX now fans out across 5 instType passes (SPOT/MARGIN/SWAP/FUTURES/
    # OPTION). Trades land on the first pass; the remaining 4 are empty,
    # which matches a real account where activity is concentrated on one
    # instrument type. The second sentinel `[]` from the original pattern
    # is for the cursor-advance step within the SPOT pass.
    _trade_pages = iter([trades, []])

    async def _ft(_symbol, _since, _limit, _params=None):
        try:
            return next(_trade_pages)
        except StopIteration:
            return []

    mock_exchange.fetch_my_trades = AsyncMock(side_effect=_ft)
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "okx", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    job = {"id": "job-okx", "kind": "reconstruct_allocator_history", "api_key_id": API_KEY_ID_1}

    with caplog.at_level(logging.INFO, logger="quantalyze.analytics.equity_reconstruction"):
        result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    # MUST complete cleanly, not raise
    assert result.outcome == DispatchOutcome.DONE, result

    # Sentinel log line must be present
    sentinel = "OKX trade history capped at 3 months"
    assert any(sentinel in rec.getMessage() for rec in caplog.records), (
        f"expected sentinel log {sentinel!r}; got: "
        f"{[r.getMessage() for r in caplog.records]}"
    )

    # All rows must have history_depth_months == 3 (OKX per-venue cap / terminus)
    rows = fake_supabase.rows_for("allocator_equity_snapshots")
    assert len(rows) >= 1
    for r in rows:
        assert r["history_depth_months"] == 3, (
            f"OKX rows must have history_depth_months=3; got {r!r}"
        )


# ---------------------------------------------------------------------------
# Test 4 — CoinGecko fallback on BadSymbol
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reconstruct_coingecko_fallback(monkeypatch):
    """A deposit of symbol SYMX that the exchange cannot price via fetch_ohlcv
    must trigger a CoinGecko fallback. The handler writes to token_price_history
    and the resulting rows have source in {'coingecko_fallback', 'mixed'}."""
    fake_supabase = FakeSupabaseClient()
    _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=4)
    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000

    # One deposit of SYMX that the exchange doesn't list
    deposits = [{
        "timestamp": ts,
        "currency": "SYMX",
        "amount": 10.0,
        "status": "ok",
    }]
    # SYMX has no OHLCV on the exchange → BadSymbol
    # But BTC trade/OHLCV is fine
    trades = [_make_trade(ts, "BTC/USDT", "buy", 50000.0, 0.1)]
    btc_ohlcv = [_make_ohlcv_row(ts + day * day_ms, 50000.0) for day in range(5)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    mock_exchange.fetch_deposits = AsyncMock(return_value=deposits)
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])

    async def _ohlcv_side_effect(symbol, *_a, **_kw):
        if symbol.startswith("SYMX"):
            raise ccxt.BadSymbol(f"no market for {symbol}")
        return btc_ohlcv

    mock_exchange.fetch_ohlcv = AsyncMock(side_effect=_ohlcv_side_effect)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    # Mock httpx.AsyncClient.get for CoinGecko
    class _FakeResp:
        def __init__(self, data):
            self._data = data
            self.status_code = 200

        def json(self):
            return self._data

        def raise_for_status(self):
            return None

    prices_range = [[ts + day * day_ms, 1.50 + day * 0.01] for day in range(5)]
    fake_cg_response = {"prices": prices_range, "market_caps": [], "total_volumes": []}

    async def _fake_get(self, *args, **kwargs):
        return _FakeResp(fake_cg_response)

    monkeypatch.setattr("httpx.AsyncClient.get", _fake_get)

    # Stub httpx.AsyncClient.__aenter__ / __aexit__ so `async with` works on our mock
    async def _aenter(self):
        return self

    async def _aexit(self, *exc):
        return False

    monkeypatch.setattr("httpx.AsyncClient.__aenter__", _aenter)
    monkeypatch.setattr("httpx.AsyncClient.__aexit__", _aexit)

    # Zero-out the CoinGecko throttle so the test doesn't wait 2s per symbol.
    monkeypatch.setattr(er, "COINGECKO_MIN_SLEEP_SECS", 0.0)

    job = {"id": "job-cg", "kind": "reconstruct_allocator_history", "api_key_id": API_KEY_ID_1}
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    # CoinGecko rows were written into token_price_history
    price_rows = fake_supabase.rows_for("token_price_history")
    assert any(r.get("symbol") == "SYMX" for r in price_rows), (
        f"expected SYMX rows in token_price_history; got {price_rows!r}"
    )

    # Snapshot rows exist with source reflecting the fallback
    snap_rows = fake_supabase.rows_for("allocator_equity_snapshots")
    assert len(snap_rows) >= 1
    assert any(r["source"] in {"coingecko_fallback", "mixed"} for r in snap_rows), (
        f"expected at least one snapshot row with CoinGecko-fallback source; got {snap_rows!r}"
    )


# ---------------------------------------------------------------------------
# Test 5 — daily refresh appends exactly one row
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refresh_daily_appends_one_row(monkeypatch):
    """run_refresh_allocator_equity_daily_job reads api_key_id (NOT allocator_id)
    from the job dict and appends exactly one row for today.

    Per VOICES-ACCEPTED f1: allocator_id is derived from the preflight ctx's
    key_row['user_id'], never read from the job dict."""
    fake_supabase = FakeSupabaseClient()
    _install_fake_audit(monkeypatch)

    today = date(2026, 4, 15)

    # Pre-populate history ending yesterday so warm-up is satisfied
    for day in range(1, 31):
        d = today - timedelta(days=day)
        fake_supabase.store[("allocator_equity_snapshots", (ALLOCATOR_ID, d.isoformat()))] = {
            "allocator_id": ALLOCATOR_ID,
            "asof": d.isoformat(),
            "value_usd": 10000.0,
            "breakdown": {"BTC": 10000.0},
            "source": "exchange_primary",
            "reconstructed_at": "2026-04-14T00:00:00Z",
            "history_depth_months": 24,
        }
    # Today's holdings (populated by Phase 06 poll_allocator_positions earlier today)
    fake_supabase.store[("allocator_holdings", (ALLOCATOR_ID, "binance", "BTC", today.isoformat()))] = {
        "allocator_id": ALLOCATOR_ID,
        "api_key_id": API_KEY_ID_1,
        "venue": "binance",
        "symbol": "BTC",
        "asof": today.isoformat(),
        "quantity": 0.2,
        "mark_price": 50000.0,
        "value_usd": 10000.0,
        "holding_type": "spot",
    }

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_ohlcv = AsyncMock(
        return_value=[_make_ohlcv_row(int(datetime(2026, 4, 15).timestamp() * 1000), 50100.0)]
    )
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    today_dt = datetime(2026, 4, 15, 5, 0, tzinfo=timezone.utc)

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return today_dt if tz else today_dt.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    # f1 assertion: job has api_key_id, NOT allocator_id
    job = {
        "id": "refresh-job-1",
        "kind": "refresh_allocator_equity_daily",
        "api_key_id": API_KEY_ID_1,
    }
    assert "allocator_id" not in job, "refresh_allocator_equity_daily must be KEY-SCOPED (f1)"

    result = await run_refresh_allocator_equity_daily_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    rows = fake_supabase.rows_for("allocator_equity_snapshots")
    today_rows = [r for r in rows if r["asof"] == today.isoformat()]
    assert len(today_rows) == 1, (
        f"expected exactly one row for today; got {len(today_rows)}: {today_rows!r}"
    )
    assert today_rows[0]["allocator_id"] == ALLOCATOR_ID


# ---------------------------------------------------------------------------
# Test 6 — parametrized: per-venue history_depth_months
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("venue,expected_depth", [
    ("binance", 24),
    ("okx", 3),
    ("bybit", 24),
])
async def test_history_depth_months_per_venue(monkeypatch, venue, expected_depth):
    """Per VOICES-ACCEPTED f9: every non-fallback snapshot row carries the
    venue-specific history_depth_months."""
    # Sanity on the exported mapping
    assert VENUE_HISTORY_DEPTH_MONTHS[venue] == expected_depth
    assert history_depth_months_for_venue(venue) == expected_depth

    fake_supabase = FakeSupabaseClient()
    _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    # Stay inside the 90-day window to avoid an OKX-terminus override for
    # the binance/bybit cases.
    start_date = end_date - timedelta(days=10)
    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000

    trades = [_make_trade(ts, "BTC/USDT", "buy", 50000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + day * day_ms, 50000.0) for day in range(11)]

    mock_exchange = AsyncMock()
    mock_exchange.id = venue
    # Trades on the first call; empty thereafter. Works for both the legacy
    # 2-call pattern (binance/bybit: trades + cursor-advance empty) and the
    # OKX 5-instType fan-out (trades on first instType, empty on the rest).
    _trade_pages = iter([trades, []])

    async def _ft(_symbol, _since, _limit, _params=None):
        try:
            return next(_trade_pages)
        except StopIteration:
            return []

    mock_exchange.fetch_my_trades = AsyncMock(side_effect=_ft)
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, venue, fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    job = {"id": f"job-{venue}", "kind": "reconstruct_allocator_history", "api_key_id": API_KEY_ID_1}
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    rows = fake_supabase.rows_for("allocator_equity_snapshots")
    assert rows, f"expected non-empty snapshots for venue={venue}"
    for r in rows:
        # coingecko-fallback rows may have NULL; this test has no fallbacks
        assert r["history_depth_months"] == expected_depth, (
            f"venue={venue}: row {r!r} has history_depth_months={r['history_depth_months']}, "
            f"expected {expected_depth}"
        )


# ---------------------------------------------------------------------------
# Test 7 — two keys / one allocator → single snapshot row (aggregate at UPSERT)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refresh_daily_aggregates_across_keys(monkeypatch):
    """Per VOICES-ACCEPTED f1 + threat T-07-V5b: two api_keys for the same
    allocator running on the same day → ONE row in allocator_equity_snapshots.

    The second UPSERT is a no-op because ON CONFLICT (allocator_id, asof) DO NOTHING."""
    fake_supabase = FakeSupabaseClient()
    _install_fake_audit(monkeypatch)

    today = date(2026, 4, 15)

    # Pre-populate history so warm-up is satisfied (daily refresh expects
    # at least one existing snapshot row per the SQL fan-out gate).
    for day in range(1, 15):
        d = today - timedelta(days=day)
        fake_supabase.store[("allocator_equity_snapshots", (ALLOCATOR_ID, d.isoformat()))] = {
            "allocator_id": ALLOCATOR_ID,
            "asof": d.isoformat(),
            "value_usd": 10000.0,
            "source": "exchange_primary",
            "reconstructed_at": "2026-04-14T00:00:00Z",
            "history_depth_months": 24,
        }

    # Today's holdings from BOTH keys (same allocator)
    fake_supabase.store[("allocator_holdings", (ALLOCATOR_ID, "binance", "BTC", today.isoformat()))] = {
        "allocator_id": ALLOCATOR_ID,
        "api_key_id": API_KEY_ID_1,
        "venue": "binance",
        "symbol": "BTC",
        "asof": today.isoformat(),
        "quantity": 0.2,
        "mark_price": 50000.0,
        "value_usd": 10000.0,
        "holding_type": "spot",
    }
    fake_supabase.store[("allocator_holdings", (ALLOCATOR_ID, "okx", "ETH", today.isoformat()))] = {
        "allocator_id": ALLOCATOR_ID,
        "api_key_id": API_KEY_ID_2,
        "venue": "okx",
        "symbol": "ETH",
        "asof": today.isoformat(),
        "quantity": 2.0,
        "mark_price": 3000.0,
        "value_usd": 6000.0,
        "holding_type": "spot",
    }

    # Shared mock exchange (venue varies per preflight call)
    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_ohlcv = AsyncMock(
        return_value=[_make_ohlcv_row(int(datetime(2026, 4, 15).timestamp() * 1000), 50100.0)]
    )
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    today_dt = datetime(2026, 4, 15, 5, 0, tzinfo=timezone.utc)

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return today_dt if tz else today_dt.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    # Run once per key (same allocator_id, different api_key_id)
    job1 = {"id": "refresh-1", "kind": "refresh_allocator_equity_daily", "api_key_id": API_KEY_ID_1}
    job2 = {"id": "refresh-2", "kind": "refresh_allocator_equity_daily", "api_key_id": API_KEY_ID_2}

    result1 = await run_refresh_allocator_equity_daily_job(job1)
    result2 = await run_refresh_allocator_equity_daily_job(job2)

    from services.job_worker import DispatchOutcome
    assert result1.outcome == DispatchOutcome.DONE, result1
    assert result2.outcome == DispatchOutcome.DONE, result2

    rows = fake_supabase.rows_for("allocator_equity_snapshots")
    today_rows = [r for r in rows if r["asof"] == today.isoformat()]
    assert len(today_rows) == 1, (
        f"expected exactly ONE snapshot row for (allocator_id, today) across "
        f"both keys; got {len(today_rows)}: {today_rows!r}"
    )
    # Both keys reference the same allocator
    assert today_rows[0]["allocator_id"] == ALLOCATOR_ID


# ---------------------------------------------------------------------------
# Test 8 — WR-03 regression: CCXT linear-perp symbols strip the :settle
# suffix from the quote side so the quantities dict doesn't leak a
# phantom "USDT:USDT" key (or similar) that never gets priced.
# ---------------------------------------------------------------------------


def test_wr03_compute_daily_equity_strips_settle_suffix_from_perp_symbol():
    """WR-03 regression: CCXT normalises a Binance/Bybit linear perpetual
    as symbol 'BTC/USDT:USDT'. An early implementation did
    `split('/')[-1]` which returned 'USDT:USDT' — the buy-side cost flowed
    into a phantom 'USDT:USDT' key in `quantities` while the base 'BTC'
    side was credited normally, producing spurious base-only balances.

    Since M078 perp-aware replay, opening a long at fair value doesn't
    mutate spot balances at all (a perp is a contract, not a swap), but
    the `:settle` suffix stripping still matters for realised-PnL routing
    on closes. This test pins down the combined invariant: after a
    round-trip (open + close at same price), the USDT quote lands on the
    canonical 'USDT' key (no phantom ':USDT' or 'USDT:USDT' entry)."""
    from services.equity_reconstruction import _compute_daily_equity

    d0 = date(2026, 4, 15)
    d1 = date(2026, 4, 16)

    def _ts(d: date) -> int:
        return int(
            datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000
        )

    deposits = [
        {"timestamp": _ts(d0), "currency": "USDT", "amount": 50_000.0}
    ]
    trades = [
        {
            "timestamp": _ts(d0), "symbol": "BTC/USDT:USDT", "side": "buy",
            "amount": 1.0, "price": 50_000.0, "cost": 50_000.0,
        },
        {
            "timestamp": _ts(d1), "symbol": "BTC/USDT:USDT", "side": "sell",
            "amount": 1.0, "price": 50_000.0, "cost": 50_000.0,
        },
    ]
    ohlcv_by_symbol = {
        "BTC": [(d0.isoformat(), 50_000.0), (d1.isoformat(), 50_000.0)],
    }

    rows = _compute_daily_equity(
        trades=trades,
        deposits=deposits,
        withdrawals=[],
        ohlcv_by_symbol=ohlcv_by_symbol,
        coingecko_by_symbol={},
        start_date=d0,
        end_date=d1,
    )
    assert len(rows) == 2, f"expected 2 rows; got {rows!r}"
    for row in rows:
        breakdown = row["breakdown"]
        assert "USDT:USDT" not in breakdown, (
            f"phantom quote key leaked: {breakdown!r}"
        )
        for k in breakdown:
            assert not k.endswith(":USDT"), (
                f"suspicious unqualified :USDT key: {k!r} in {breakdown!r}"
            )
    # Round-trip at fair value → final equity equals deposited cash.
    assert rows[-1]["value_usd"] == pytest.approx(50_000.0, abs=0.01)


def test_wr03_compute_daily_equity_spot_symbol_unchanged():
    """Spot pair 'BTC/USDT' (no `:settle` suffix) must continue to behave
    correctly — the WR-03 fix must not regress the common case."""
    from services.equity_reconstruction import _compute_daily_equity

    asof = date(2026, 4, 15)
    ts_ms = int(
        datetime(asof.year, asof.month, asof.day, tzinfo=timezone.utc).timestamp() * 1000
    )

    trades = [
        {
            "timestamp": ts_ms,
            "symbol": "BTC/USDT",
            "side": "buy",
            "amount": 1.0,
            "cost": 50_000.0,
        }
    ]
    ohlcv_by_symbol = {"BTC": [(asof.isoformat(), 50_000.0)]}

    rows = _compute_daily_equity(
        trades=trades,
        deposits=[],
        withdrawals=[],
        ohlcv_by_symbol=ohlcv_by_symbol,
        coingecko_by_symbol={},
        start_date=asof,
        end_date=asof,
    )
    assert len(rows) == 1
    breakdown = rows[0]["breakdown"]
    assert "USDT:USDT" not in breakdown
    # Same buy-at-fair-value net-zero invariant holds for the spot symbol.
    assert rows[0]["value_usd"] == 0.0


def test_perp_position_invariant_and_mark():
    """H-1167: PerpPosition enforces the flat-position invariant
    (size == 0 ⟺ avg_entry == 0) at construction, is immutable (frozen=True),
    and mark() returns 0.0 when flat. Directly pins the contract the equity
    replay relies on when it collapsed the old two-field ghost-mark guard into a
    single `pos.size == 0.0` check — without this, a refactor that flipped the
    invariant or unfroze the class would pass every integration test (valid
    replays never construct an invariant-violating pair)."""
    import dataclasses

    from services.equity_reconstruction import PerpPosition

    # Flat is representable; mark() is 0.0 regardless of price.
    flat = PerpPosition()
    assert flat.size == 0.0 and flat.avg_entry == 0.0
    assert flat.mark(123.45) == 0.0

    # Long / short marks: signed size * (price - avg_entry).
    assert PerpPosition(size=2.0, avg_entry=50.0).mark(60.0) == pytest.approx(20.0)
    assert PerpPosition(size=-2.0, avg_entry=50.0).mark(60.0) == pytest.approx(-20.0)

    # Invariant violations raise at construction — BOTH directions.
    with pytest.raises(ValueError):
        PerpPosition(size=0.0, avg_entry=5.0)   # closed but ghost avg_entry
    with pytest.raises(ValueError):
        PerpPosition(size=2.0, avg_entry=0.0)   # open at price 0 (corrupt)

    # frozen=True: in-place mutation is forbidden, so the only way to change
    # state is to construct a fresh (re-validated) instance.
    with pytest.raises(dataclasses.FrozenInstanceError):
        PerpPosition(size=2.0, avg_entry=50.0).size = 0.0


# ---------------------------------------------------------------------------
# Test 9 — WR-04 regression: generic exceptions from fetch_deposits /
# fetch_withdrawals MUST bubble to the outer handler for classification,
# not be silently swallowed mid-backfill with a truncated row list.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wr04_fetch_transfers_auth_error_bubbles_to_outer_handler(monkeypatch):
    """WR-04 regression: a ccxt.AuthenticationError raised by
    fetch_deposits mid-loop must propagate to the handler's outer
    try/except where classify_exception + _emit_audit record it as
    permanent / reconstruct_failed. The pre-fix `except Exception: break`
    swallowed this, returning partial rows that looked identical to
    "allocator has no transfers" and never firing an audit event."""
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=10)
    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000

    trades = [_make_trade(ts, "BTC/USDT", "buy", 50000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + day * day_ms, 50000.0) for day in range(11)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    # fetch_deposits raises an AuthenticationError (e.g. read-only key had
    # its permissions revoked mid-backfill). This MUST bubble.
    mock_exchange.fetch_deposits = AsyncMock(
        side_effect=ccxt.AuthenticationError("invalid api key")
    )
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    job = {
        "id": "job-wr04",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    }
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome

    # Handler MUST report FAILED (not DONE) and error_kind='permanent'
    # for auth errors — this only happens if the exception bubbled out
    # of _fetch_transfers instead of being swallowed.
    assert result.outcome == DispatchOutcome.FAILED, (
        f"expected auth error to bubble to outer handler and produce "
        f"FAILED; got {result!r} — pre-fix `except Exception: break` "
        f"would swallow the error and return DONE with partial data."
    )
    assert result.error_kind == "permanent", (
        f"expected permanent classification for AuthenticationError; "
        f"got {result.error_kind!r}"
    )

    # An audit event MUST have been emitted (reconstruct_failed). Pre-fix,
    # the silent swallow left zero audit trail for the skipped window.
    audit_events = [
        call for call in audit_mock.call_args_list
        if "reconstruct_failed" in str(call)
    ]
    assert audit_events, (
        f"expected reconstruct_failed audit event; got {audit_mock.call_args_list!r}"
    )


# ---------------------------------------------------------------------------
# Test 10 — WR-05 regression: persist_equity_snapshots tags rows with
# history_depth_months ONLY when source == "exchange_primary". Mixed and
# coingecko_fallback rows get NULL so the dashboard's f9 warm-up copy
# isn't misapplied to rows whose limiting factor is CoinGecko.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wr05_persist_equity_snapshots_depth_by_source(monkeypatch):
    """WR-05 regression: a `mixed` source row must receive
    history_depth_months=NULL (per-venue retention does not cleanly
    apply when some symbols are priced via CoinGecko), not the venue
    cap. Only `exchange_primary` rows inherit the caller-supplied depth."""
    from services.equity_reconstruction import persist_equity_snapshots

    fake_supabase = FakeSupabaseClient()

    # Mix of three sources on consecutive days
    rows = [
        {
            "asof": "2026-04-01",
            "value_usd": 100.0,
            "breakdown": {"BTC": 100.0},
            "source": "exchange_primary",
        },
        {
            "asof": "2026-04-02",
            "value_usd": 150.0,
            "breakdown": {"BTC": 100.0, "SYMX": 50.0},
            "source": "mixed",
        },
        {
            "asof": "2026-04-03",
            "value_usd": 50.0,
            "breakdown": {"SYMX": 50.0},
            "source": "coingecko_fallback",
        },
    ]

    count = await persist_equity_snapshots(
        fake_supabase, rows, ALLOCATOR_ID, history_depth_months=24
    )
    assert count == 3

    stored = fake_supabase.rows_for("allocator_equity_snapshots")
    by_asof = {r["asof"]: r for r in stored}

    assert by_asof["2026-04-01"]["history_depth_months"] == 24, (
        "exchange_primary row must inherit the caller-supplied depth"
    )
    assert by_asof["2026-04-02"]["history_depth_months"] is None, (
        "mixed-source row must receive NULL history_depth_months (WR-05) — "
        "pre-fix it inherited 24 even though some symbols came from CoinGecko"
    )
    assert by_asof["2026-04-03"]["history_depth_months"] is None, (
        "coingecko_fallback row must receive NULL history_depth_months"
    )


# ---------------------------------------------------------------------------
# Adversarial review regression tests (2026-04-20)
#   WR-ADV-01: per-day source flags must reset each iteration (not latch)
#   WR-ADV-02: _fetch_transfers must paginate within each 90-day window
#   WR-ADV-03: persist_equity_snapshots must write in a single atomic upsert
# ---------------------------------------------------------------------------


def test_wr_adv_01_source_flags_reset_per_day():
    """Adversarial: `used_exchange` / `used_coingecko` must NOT latch across
    days. A day with only exchange_primary pricing that FOLLOWS a day with
    CoinGecko pricing must still be stamped source="exchange_primary",
    otherwise WR-05 NULLs out `history_depth_months` on all subsequent
    rows and the dashboard's warm-up copy breaks."""
    from services.equity_reconstruction import _compute_daily_equity

    day1 = date(2026, 4, 1)  # CoinGecko-only (SYMX deposit)
    day2 = date(2026, 4, 2)  # Exchange-only (pre-existing BTC position)

    ts_day1 = int(datetime(2026, 4, 1, tzinfo=timezone.utc).timestamp() * 1000)
    ts_day2 = int(datetime(2026, 4, 2, tzinfo=timezone.utc).timestamp() * 1000)

    # Day 1: a deposit of SYMX (priced via CoinGecko only).
    deposits = [{"timestamp": ts_day1, "currency": "SYMX", "amount": 10.0}]
    # Day 2: a BTC trade (priced via exchange OHLCV).
    trades = [{"timestamp": ts_day2, "symbol": "BTC/USDT", "side": "buy", "amount": 1.0, "cost": 0.0}]

    ohlcv_by_symbol = {
        "BTC": [(day1.isoformat(), 50_000.0), (day2.isoformat(), 51_000.0)],
    }
    coingecko_by_symbol = {
        "SYMX": {day1.isoformat(): 5.0, day2.isoformat(): 5.0},
    }

    rows = _compute_daily_equity(
        trades=trades,
        deposits=deposits,
        withdrawals=[],
        ohlcv_by_symbol=ohlcv_by_symbol,
        coingecko_by_symbol=coingecko_by_symbol,
        start_date=day1,
        end_date=day2,
    )

    by_asof = {r["asof"]: r for r in rows}

    # Day 1: only SYMX held, CoinGecko-only pricing.
    assert by_asof[day1.isoformat()]["source"] in {"coingecko_fallback", "mixed"}
    # Day 2: SYMX still held (deposit persists) + new BTC position. BTC
    # comes from OHLCV, SYMX from CoinGecko — this day IS mixed legitimately.
    # So to isolate the latching bug we also test a day where only BTC is
    # active (SYMX gone via withdrawal). That's the ADV-01b test below.


def test_wr_adv_01b_source_flags_reset_after_symbol_removal():
    """Adversarial (latching flags): day 3 has ONLY exchange_primary pricing
    because the CoinGecko symbol was fully withdrawn. Pre-fix, the
    used_coingecko flag set on day 1 latched through to day 3 and produced
    source="mixed" there; post-fix, day 3 is source="exchange_primary"."""
    from services.equity_reconstruction import _compute_daily_equity

    day1 = date(2026, 4, 1)  # SYMX deposit (CG pricing)
    day2 = date(2026, 4, 2)  # SYMX withdrawal — zeroes quantity
    day3 = date(2026, 4, 3)  # BTC-only (OHLCV pricing) — must NOT latch as mixed

    ts = lambda d: int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000)  # noqa: E731

    deposits = [{"timestamp": ts(day1), "currency": "SYMX", "amount": 10.0}]
    withdrawals = [{"timestamp": ts(day2), "currency": "SYMX", "amount": 10.0}]
    trades = [{"timestamp": ts(day1), "symbol": "BTC/USDT", "side": "buy", "amount": 1.0, "cost": 50_000.0}]

    ohlcv_by_symbol = {
        "BTC": [(d.isoformat(), 50_000.0) for d in (day1, day2, day3)],
    }
    coingecko_by_symbol = {
        "SYMX": {d.isoformat(): 5.0 for d in (day1, day2, day3)},
    }

    rows = _compute_daily_equity(
        trades=trades,
        deposits=deposits,
        withdrawals=withdrawals,
        ohlcv_by_symbol=ohlcv_by_symbol,
        coingecko_by_symbol=coingecko_by_symbol,
        start_date=day1,
        end_date=day3,
    )

    by_asof = {r["asof"]: r for r in rows}

    assert by_asof[day3.isoformat()]["source"] == "exchange_primary", (
        "Day 3 holds only BTC (priced via OHLCV). used_coingecko must have "
        "reset after day 2 — otherwise the flag latches from day 1's SYMX "
        "deposit and day 3 is mis-stamped as 'mixed', then WR-05 NULLs out "
        f"history_depth_months. Got: {by_asof[day3.isoformat()]!r}"
    )


@pytest.mark.asyncio
async def test_wr_adv_02_fetch_transfers_paginates_within_window():
    """Adversarial: _fetch_transfers must paginate WITHIN each 90-day window.
    Pre-fix, a window containing >500 rows dropped everything past row 500
    when the loop advanced cursor_ms += window_ms unconditionally."""
    from services.equity_reconstruction import _fetch_transfers

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

    async def _fake_fetch_deposits(_unused_symbol, since_ms, limit):
        call_log.append((since_ms, limit))
        # Filter events whose timestamp >= since_ms, return up to limit.
        matching = [e for e in all_events if e["timestamp"] >= since_ms]
        return matching[:limit]

    mock_exchange = MagicMock()
    mock_exchange.fetch_deposits = _fake_fetch_deposits

    rows = await _fetch_transfers(mock_exchange, "deposits", window_start_ms, now_ms)

    assert len(rows) == 750, (
        f"expected all 750 in-window deposits to be collected; got {len(rows)}. "
        f"Pre-fix this was 500 because the outer loop advanced the window "
        f"without paginating inside. Call log: {call_log!r}"
    )


@pytest.mark.asyncio
async def test_wr_adv_03_persist_equity_snapshots_is_atomic(monkeypatch):
    """Adversarial: persist_equity_snapshots must write all rows in ONE
    upsert call. A multi-batch approach (what I added then reverted)
    leaves partial state if an interior batch fails, and the outer
    existing>0 idempotency short-circuit then permanently truncates the
    allocator's history on retry."""
    from services.equity_reconstruction import persist_equity_snapshots

    fake_supabase = FakeSupabaseClient()

    rows = [
        {"asof": f"2026-04-{day:02d}", "value_usd": 100.0 + day, "breakdown": {"BTC": 100.0}, "source": "exchange_primary"}
        for day in range(1, 31)  # 30 days
    ]

    upsert_call_count = {"n": 0}
    orig_table = fake_supabase.table

    def _counting_table(name: str):
        tbl = orig_table(name)
        real_upsert = tbl.upsert

        def _wrapped(*args, **kwargs):
            upsert_call_count["n"] += 1
            return real_upsert(*args, **kwargs)

        tbl.upsert = _wrapped
        return tbl

    monkeypatch.setattr(fake_supabase, "table", _counting_table)

    count = await persist_equity_snapshots(
        fake_supabase, rows, ALLOCATOR_ID, history_depth_months=24
    )

    assert count == 30
    assert upsert_call_count["n"] == 1, (
        f"persist_equity_snapshots must make exactly ONE upsert call (atomic). "
        f"Got {upsert_call_count['n']} — re-introducing batching breaks the "
        f"existing>0 idempotency contract: a mid-run failure leaves rows>0 "
        f"with history truncated, and retries short-circuit permanently."
    )


# ---------------------------------------------------------------------------
# Migration 076 regression tests — per-api_key reconstruction gate.
#   M076-01: a 2nd api_key for the same allocator MUST backfill even when
#            the allocator already has snapshots from another key.
#   M076-02: when the SAME api_key already has a `done` reconstruct job in
#            compute_jobs, the handler short-circuits (gate still gates).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_m076_reconstruct_runs_for_new_api_key_when_allocator_has_other_key_snapshots(monkeypatch):
    """Migration 076 regression: pre-fix, the allocator-scoped snapshot
    count blocked every additional exchange the user added. With the
    per-api_key gate, KEY_2 must still backfill even though the allocator
    already has 30 days of snapshots from KEY_1."""
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    # Seed the allocator with 30 prior snapshots — these came from a
    # previous reconstruct against API_KEY_ID_1. Pre-fix: the handler
    # would short-circuit because COUNT(*) > 0 for this allocator.
    for day in range(1, 31):
        asof = f"2026-03-{day:02d}"
        fake_supabase.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID,
            "asof": asof,
            "value_usd": 100.0 + day,
            "breakdown": {"BTC": 100.0 + day},
            "source": "exchange_primary",
            "history_depth_months": 24,
            "reconstructed_at": "2026-04-01T00:00:00+00:00",
        }

    # NOTE: no compute_jobs row inserted for API_KEY_ID_2 — gate must
    # therefore allow the reconstruct to proceed.

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=9)
    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000

    trades = [_make_trade(ts, "BTC/USDT", "buy", 50000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + day * day_ms, 50000.0) for day in range(10)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    job = {
        "id": "job-m076-1",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_2,  # NEW key, allocator already has rows from KEY_1
    }
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    # Pre-fix: only the 30 seed rows remained, NO new fetches happened, and
    # the audit recorded reason=already_reconstructed (or
    # already_reconstructed_for_api_key with the new gate but still no
    # fetches). Post-fix: the handler called fetch_my_trades and persisted
    # additional snapshots.
    assert mock_exchange.fetch_my_trades.await_count > 0, (
        "Migration 076 regression: handler must fetch trades for a NEW api_key "
        "even if the allocator has prior snapshots from another key. "
        "Pre-fix the allocator-scoped snapshot count short-circuited."
    )

    # Audit should record reconstruct_STARTED + reconstruct_COMPLETE,
    # NOT a bare reconstruct_complete with reason=already_reconstructed_for_api_key.
    started_events = [
        c for c in audit_mock.call_args_list if "reconstruct_started" in str(c)
    ]
    assert started_events, (
        f"expected reconstruct_started audit event for new api_key; "
        f"got {audit_mock.call_args_list!r}"
    )
    short_circuit_events = [
        c for c in audit_mock.call_args_list
        if "already_reconstructed" in str(c)
    ]
    assert not short_circuit_events, (
        f"unexpected short-circuit audit for a new api_key: {short_circuit_events!r}"
    )


@pytest.mark.asyncio
async def test_m076_reconstruct_short_circuits_when_same_api_key_already_done(monkeypatch):
    """Migration 076 regression: the per-api_key gate must still gate.
    When a `done` reconstruct_allocator_history compute_jobs row exists
    for the SAME api_key, the handler must short-circuit without
    touching the exchange — protects against duplicate retries."""
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    # Pre-existing DONE reconstruct job for API_KEY_ID_1.
    fake_supabase.store[("compute_jobs", ("done-job-1",))] = {
        "id": "done-job-1",
        "api_key_id": API_KEY_ID_1,
        "kind": "reconstruct_allocator_history",
        "status": "done",
    }

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(return_value=[])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=[])
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    job = {
        "id": "job-m076-2",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,  # already done
    }
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    # No exchange calls — gate must short-circuit BEFORE any I/O.
    assert mock_exchange.fetch_my_trades.await_count == 0, (
        "per-api_key gate failed to short-circuit: handler still hit "
        "fetch_my_trades despite an existing done job for this key."
    )

    # Audit records the new short-circuit reason.
    short_circuit_events = [
        c for c in audit_mock.call_args_list
        if "already_reconstructed_for_api_key" in str(c)
    ]
    assert short_circuit_events, (
        f"expected audit event with reason=already_reconstructed_for_api_key; "
        f"got {audit_mock.call_args_list!r}"
    )


# ---------------------------------------------------------------------------
# Migration 077 regression — OKX instType fan-out.
# Pre-fix: _fetch_trades_with_pagination called fetch_my_trades(None) which
# defaults to instType=SPOT. SWAP-only / derivative-heavy accounts (the
# common OKX allocator profile) returned 0 trades and the equity curve
# collapsed to days_written=0 even though the account was actively trading.
# Post-fix: handler iterates over all 5 OKX instrument types per ccxt's
# /api/v5/trade/fills-history requirement.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_m077_okx_fan_out_captures_swap_trades(monkeypatch):
    """SWAP-only OKX account: spot fetch returns nothing, but the SWAP
    fetch returns real trades. The handler must aggregate across instType
    passes and produce non-zero equity rows.

    Pre-fix this test FAILED because the old single-pass call only ever
    asked OKX for SPOT trades, missed every SWAP fill, and reported
    days_written=0 — the exact state observed on prod for the demo
    allocator's OKX keys."""
    fake_supabase = FakeSupabaseClient()
    _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    # 30 days of SWAP activity well inside the OKX 90-day window
    start_date = end_date - timedelta(days=30)
    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000

    # The user's account opened a long ETH/USDT perpetual on day 0
    swap_trades = [
        {
            "timestamp": ts,
            "symbol": "ETH/USDT:USDT",
            "side": "buy",
            "price": 2300.0,
            "amount": 10.0,
            "cost": 23000.0,
            "fee": {"cost": 0.0, "currency": "USDT"},
        },
    ]
    ohlcv = [_make_ohlcv_row(ts + day * day_ms, 2300.0 + day * 5.0) for day in range(31)]

    # Per-instType return-value table. Spot/margin/futures/option are empty;
    # only the SWAP pass returns real trades. Empties on the second call of
    # each pass (cursor advance).
    returns_by_type: dict[str, list[list[dict]]] = {
        "spot":    [[], []],
        "margin":  [[], []],
        "swap":    [swap_trades, []],
        "futures": [[], []],
        "option":  [[], []],
    }
    call_log: list[str] = []

    async def _ft(_symbol, _since, _limit, params=None):
        params = params or {}
        inst = (params.get("type") or params.get("instType") or "spot").lower()
        call_log.append(inst)
        pages = returns_by_type.get(inst, [[]])
        return pages.pop(0) if pages else []

    mock_exchange = AsyncMock()
    mock_exchange.id = "okx"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=_ft)
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "okx", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    job = {
        "id": "job-m077-fan-out",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    }
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    # Handler must have asked OKX for ALL five instrument types — not just
    # the default SPOT. The bug pre-fix was that only "spot" appeared.
    assert "spot" in call_log, f"expected SPOT pass; got {call_log!r}"
    assert "swap" in call_log, (
        f"expected SWAP pass; pre-fix this was never called and SWAP-only "
        f"accounts produced empty equity charts. call_log={call_log!r}"
    )
    for required in ("margin", "futures", "option"):
        assert required in call_log, (
            f"expected {required.upper()} pass for completeness; got {call_log!r}"
        )

    # The SWAP trades MUST have produced non-zero equity rows. Pre-fix
    # this returned 0 because the single SPOT pass found nothing.
    rows = fake_supabase.rows_for("allocator_equity_snapshots")
    assert len(rows) >= 1, (
        f"expected SWAP trades to produce equity rows after fan-out; got 0. "
        f"This is the prod symptom: SWAP account → days_written=0."
    )
    # A later day must reflect ETH price appreciation. The trade-day row
    # legitimately nets to zero (buy at fair value: +$23k ETH, -$23k USDT),
    # but by day 30 the OHLCV price moved from $2300 → $2450 ($5/day for
    # 30 days), so 10 ETH × $150 PnL = +$1500 equity gain.
    by_asof = {r["asof"]: r for r in rows}
    last_day = end_date.date().isoformat()
    assert last_day in by_asof, (
        f"expected snapshot for {last_day}; got {sorted(by_asof.keys())!r}"
    )
    assert by_asof[last_day]["value_usd"] != 0.0, (
        f"end-of-window equity must reflect ETH appreciation (+$1500 PnL); "
        f"got {by_asof[last_day]!r} — pre-fix value would be 0 because the "
        f"SWAP trade was never captured."
    )


@pytest.mark.asyncio
async def test_m077_non_okx_venue_unchanged_single_pass(monkeypatch):
    """Binance / Bybit must NOT fan out — their fetch_my_trades returns
    the full book per call. Adding 5 instType passes for non-OKX venues
    would 5x the API call count and risk rate-limit hits for no benefit."""
    fake_supabase = FakeSupabaseClient()
    _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=10)
    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000

    trades = [_make_trade(ts, "BTC/USDT", "buy", 50000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + day * day_ms, 50000.0) for day in range(11)]

    call_log: list[dict | None] = []

    async def _ft(_symbol, _since, _limit, params=None):
        call_log.append(params)
        # First call returns trades; second (cursor advance) returns empty.
        return trades if len(call_log) == 1 else []

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=_ft)
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    job = {
        "id": "job-m077-non-okx",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    }
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    # Binance: at most one cursor walk (trades + empty page = 2 calls).
    # Adding instType fan-out here would multiply call count by 5.
    assert mock_exchange.fetch_my_trades.await_count <= 2, (
        f"non-OKX venues must use a single pass — got "
        f"{mock_exchange.fetch_my_trades.await_count} calls; "
        f"OKX fan-out should not apply to binance/bybit. call_log={call_log!r}"
    )
    # And the params payload must NOT include an instType selector — those
    # are OKX-specific and could break Binance's fetch_my_trades signature.
    for params in call_log:
        if not params:
            continue
        assert "type" not in params and "instType" not in params, (
            f"non-OKX call leaked OKX-specific instType param: {params!r}"
        )


# ---------------------------------------------------------------------------
# M078 regression — perpetuals replay (position tracking, mark-to-market).
# Before this fix, every trade was replayed as if it were a spot swap: a
# 21-ETH perp SHORT open credited +48,693 USDT and debited -21.957 ETH, so
# the replay during the open window marked to a synthetic short against
# current ETH close price. For accounts running many overlapping shorts,
# that produced the infamous V-shape: 100% → -224% → 100% once every
# position closed. These tests pin down that:
#   1) opening a perp doesn't cash-settle the notional,
#   2) an open position marks to market sensibly each day,
#   3) closing realises PnL into USDT,
#   4) flipping a position decomposes correctly,
#   5) spot trades are unaffected.
# ---------------------------------------------------------------------------


def _mk_perp_trade(
    *, iso: str, side: str, amount: float, price: float,
    symbol: str = "ETH/USDT:USDT",
) -> dict:
    ts_ms = int(
        datetime.fromisoformat(iso).replace(tzinfo=timezone.utc).timestamp() * 1000
    )
    return {
        "timestamp": ts_ms,
        "symbol": symbol,
        "side": side,
        "amount": amount,
        "price": price,
        "cost": amount * price,
    }


def test_m078_perp_short_mark_to_market_no_phantom_drawdown():
    """Short 21 ETH @ 2200 on day 0. Hold through day 1 (ETH close = 2300,
    price moved 100 against the short). Close on day 2 @ 2250. The replay
    must NOT show a -224% phantom: mid-window equity = starting deposit
    minus unrealised PnL (21 × 100 = 2100), not starting - full notional.
    """
    from services.equity_reconstruction import _compute_daily_equity

    d0 = date(2026, 4, 1)
    d1 = date(2026, 4, 2)
    d2 = date(2026, 4, 3)

    deposits = [{
        "timestamp": int(
            datetime(d0.year, d0.month, d0.day, tzinfo=timezone.utc).timestamp() * 1000
        ),
        "currency": "USDT",
        "amount": 10_000.0,
    }]
    trades = [
        _mk_perp_trade(iso=d0.isoformat(), side="sell", amount=21.0, price=2200.0),
        _mk_perp_trade(iso=d2.isoformat(), side="buy",  amount=21.0, price=2250.0),
    ]
    ohlcv_by_symbol = {
        "ETH": [
            (d0.isoformat(), 2200.0),
            (d1.isoformat(), 2300.0),
            (d2.isoformat(), 2250.0),
        ],
    }

    rows = _compute_daily_equity(
        trades=trades,
        deposits=deposits,
        withdrawals=[],
        ohlcv_by_symbol=ohlcv_by_symbol,
        coingecko_by_symbol={},
        start_date=d0,
        end_date=d2,
    )

    by_date = {r["asof"]: r for r in rows}

    # Day 0: opened short at fair value — unrealised PnL ≈ 0, cash intact.
    assert by_date[d0.isoformat()]["value_usd"] == pytest.approx(10_000.0, abs=0.01), (
        f"day 0 open should not move cash (only margin locked); got "
        f"{by_date[d0.isoformat()]!r}"
    )
    # Day 1: short held through a $100 rise. Unrealised PnL = -21 × 100 = -2100.
    # Expected equity = 10_000 - 2100 = 7900 (NOT deeply negative).
    assert by_date[d1.isoformat()]["value_usd"] == pytest.approx(7_900.0, abs=0.01), (
        f"day 1 should mark to market: 10k - 21 * (2300-2200) = 7900; got "
        f"{by_date[d1.isoformat()]!r}"
    )
    # Day 2: short closed at 2250. Realised PnL = 21 × (2200 - 2250) = -1050.
    # No open perp position remains, so unrealised = 0.
    assert by_date[d2.isoformat()]["value_usd"] == pytest.approx(8_950.0, abs=0.01), (
        f"day 2 close should realise 21 * (2200-2250) = -1050; got "
        f"{by_date[d2.isoformat()]!r}"
    )
    # Hard floor: NO day may swing anywhere near the pre-fix phantom (-40k
    # on a $10k account). This is the bug-signature guard.
    for iso_key, row in by_date.items():
        assert row["value_usd"] > 0, (
            f"equity went non-positive on {iso_key}: {row!r}"
        )


def test_m078_perp_long_realises_pnl_to_usdt_on_close():
    """Long 10 ETH @ 2000 on d0, close @ 2100 on d1. Realised PnL = 10 ×
    100 = +1000 USDT. End-of-window equity = 10,000 + 1000 = 11,000."""
    from services.equity_reconstruction import _compute_daily_equity

    d0 = date(2026, 4, 10)
    d1 = date(2026, 4, 11)
    deposits = [{
        "timestamp": int(
            datetime(d0.year, d0.month, d0.day, tzinfo=timezone.utc).timestamp() * 1000
        ),
        "currency": "USDT",
        "amount": 10_000.0,
    }]
    trades = [
        _mk_perp_trade(iso=d0.isoformat(), side="buy",  amount=10.0, price=2000.0),
        _mk_perp_trade(iso=d1.isoformat(), side="sell", amount=10.0, price=2100.0),
    ]
    ohlcv_by_symbol = {
        "ETH": [(d0.isoformat(), 2000.0), (d1.isoformat(), 2100.0)],
    }

    rows = _compute_daily_equity(
        trades=trades,
        deposits=deposits,
        withdrawals=[],
        ohlcv_by_symbol=ohlcv_by_symbol,
        coingecko_by_symbol={},
        start_date=d0,
        end_date=d1,
    )
    by_date = {r["asof"]: r for r in rows}
    assert by_date[d1.isoformat()]["value_usd"] == pytest.approx(11_000.0, abs=0.01)
    # Realised PnL must land in USDT breakdown, not in a phantom ETH entry.
    brk = by_date[d1.isoformat()]["breakdown"]
    assert "ETH:USDT:PERP" not in brk, (
        f"closed position must not leave a perp mark entry: {brk!r}"
    )
    assert brk.get("USDT") == pytest.approx(11_000.0, abs=0.01), brk


def test_m078_perp_flip_long_to_short_in_one_trade():
    """Long 5 ETH @ 2000, then a single 10-ETH sell @ 2100 closes the long
    (realising +500) and opens a new 5-ETH short @ 2100. A subsequent day
    with ETH close 2050 should show unrealised on the short of +250."""
    from services.equity_reconstruction import _compute_daily_equity

    d0 = date(2026, 4, 15)
    d1 = date(2026, 4, 16)
    d2 = date(2026, 4, 17)
    deposits = [{
        "timestamp": int(
            datetime(d0.year, d0.month, d0.day, tzinfo=timezone.utc).timestamp() * 1000
        ),
        "currency": "USDT",
        "amount": 10_000.0,
    }]
    trades = [
        _mk_perp_trade(iso=d0.isoformat(), side="buy",  amount=5.0,  price=2000.0),
        _mk_perp_trade(iso=d1.isoformat(), side="sell", amount=10.0, price=2100.0),
    ]
    ohlcv_by_symbol = {
        "ETH": [
            (d0.isoformat(), 2000.0),
            (d1.isoformat(), 2100.0),
            (d2.isoformat(), 2050.0),
        ],
    }
    rows = _compute_daily_equity(
        trades=trades,
        deposits=deposits,
        withdrawals=[],
        ohlcv_by_symbol=ohlcv_by_symbol,
        coingecko_by_symbol={},
        start_date=d0,
        end_date=d2,
    )
    by_date = {r["asof"]: r for r in rows}

    # After flip on d1: realised +500, new short 5 @ 2100. d1 marks @ 2100
    # → unrealised 0. Total = 10,000 + 500 + 0 = 10,500.
    assert by_date[d1.isoformat()]["value_usd"] == pytest.approx(10_500.0, abs=0.01), (
        f"flip must realise the closed lot and mark the new lot at entry; "
        f"got {by_date[d1.isoformat()]!r}"
    )
    # d2: short 5 @ 2100 marked at 2050 → unrealised = -5 × (2050 - 2100) = +250.
    assert by_date[d2.isoformat()]["value_usd"] == pytest.approx(10_750.0, abs=0.01), (
        f"d2 should carry realised 500 + unrealised 250 on the remaining "
        f"short; got {by_date[d2.isoformat()]!r}"
    )


def test_m078_spot_trade_path_unchanged():
    """Regression guard: spot symbols (no `:settle` suffix) must continue
    to replay base/quote swaps the classical way. Buying 1 BTC with 50k
    USDT at $50k price nets to $0 equity delta; selling it back at 55k
    yields +5k."""
    from services.equity_reconstruction import _compute_daily_equity

    d0 = date(2026, 4, 20)
    d1 = date(2026, 4, 21)
    deposits = [{
        "timestamp": int(
            datetime(d0.year, d0.month, d0.day, tzinfo=timezone.utc).timestamp() * 1000
        ),
        "currency": "USDT",
        "amount": 50_000.0,
    }]
    ts0 = int(datetime(d0.year, d0.month, d0.day, tzinfo=timezone.utc).timestamp() * 1000)
    ts1 = int(datetime(d1.year, d1.month, d1.day, tzinfo=timezone.utc).timestamp() * 1000)
    trades = [
        {
            "timestamp": ts0, "symbol": "BTC/USDT", "side": "buy",
            "amount": 1.0, "price": 50_000.0, "cost": 50_000.0,
        },
        {
            "timestamp": ts1, "symbol": "BTC/USDT", "side": "sell",
            "amount": 1.0, "price": 55_000.0, "cost": 55_000.0,
        },
    ]
    ohlcv_by_symbol = {
        "BTC": [(d0.isoformat(), 50_000.0), (d1.isoformat(), 55_000.0)],
    }
    rows = _compute_daily_equity(
        trades=trades,
        deposits=deposits,
        withdrawals=[],
        ohlcv_by_symbol=ohlcv_by_symbol,
        coingecko_by_symbol={},
        start_date=d0,
        end_date=d1,
    )
    by_date = {r["asof"]: r for r in rows}
    # d0: bought 1 BTC at fair value → net equity still 50k.
    assert by_date[d0.isoformat()]["value_usd"] == pytest.approx(50_000.0, abs=0.01)
    # d1: sold at 55k → cash = 0 + 55k = 55k. No perp mark entries.
    assert by_date[d1.isoformat()]["value_usd"] == pytest.approx(55_000.0, abs=0.01)
    for row in rows:
        for k in row["breakdown"]:
            assert ":PERP" not in k, (
                f"spot trade leaked a perp mark into breakdown: {row!r}"
            )


# ---------------------------------------------------------------------------
# Stale-snapshot replacement regression (2026-04-22 /investigate report).
#
# Bug: persist_equity_snapshots uses ON CONFLICT (allocator_id, asof)
# DO NOTHING. When a user uploads a new read-only key (either replacing a
# deleted key or after a pre-v0.15.3.0 reconstruction left buggy rows in
# place), the fresh reconstruct runs end-to-end but writes ZERO rows —
# every (allocator_id, asof) already exists. The dashboard keeps serving
# the stale (often mathematically incorrect, e.g. perpetual-as-spot
# V-shape) data with no user-actionable recovery path. Migration 077
# only cascades snapshots on HARD DELETE with cascade=true AND last-key,
# which leaves the "I just uploaded a new key" door wide open.
#
# Fix invariant: when the allocator has NO other api_keys (this key is
# the sole authoritative source), any pre-existing snapshots are orphans
# or stale and must be wiped before the fresh reconstruct upserts its
# rows. When the allocator has other keys, DO NOTHING semantics are
# preserved to protect multi-key aggregation (threat T-07-V5b).
#
# Also fixes: persist_equity_snapshots returned len(stamped) even when
# every row was a DO-NOTHING no-op — audit logs reported days_written=730
# while the dashboard showed zero change. Must return the actual number
# of rows Postgres wrote (upsert .data length).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stale_snapshots_replaced_on_new_key_when_no_siblings(monkeypatch):
    """The user's case: stale snapshots exist (from a deleted key's old
    reconstruct, or from a pre-v0.15.3.0 buggy run); user uploads a new
    read-only key; allocator has NO OTHER api_keys. A fresh reconstruct
    MUST replace the stale rows with the new computed values."""
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=9)

    # Seed 10 days of STALE snapshots for the allocator. Simulates the
    # pre-v0.15.3.0 state: obviously-wrong perp-as-spot V-shape numbers.
    # Key insight: these rows predate the new api_key. The old key that
    # wrote them has been deleted (compute_jobs rows cascaded away), so
    # api_keys has NO row for this allocator other than the new one.
    for day_offset in range(10):
        asof = (start_date + timedelta(days=day_offset)).date().isoformat()
        fake_supabase.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID,
            "asof": asof,
            "value_usd": -999_999.0,  # STALE / WRONG sentinel
            "breakdown": {"STALE": -999_999.0},
            "source": "exchange_primary",
            "history_depth_months": 24,
            "reconstructed_at": "2026-03-01T00:00:00+00:00",
        }

    # The allocator has ONLY this new api_key — no siblings, so fresh
    # reconstruct must take over. The fake preflight already sets up
    # key_row with id=API_KEY_ID_1; we also seed an api_keys row to make
    # the sibling-count query answer 0 cleanly.
    fake_supabase.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1,
        "user_id": ALLOCATOR_ID,
        "exchange": "binance",
    }

    # Mock exchange returns a single clean BTC trade + 10 days of OHLCV.
    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000
    trades = [_make_trade(ts, "BTC/USDT", "buy", 50_000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + d * day_ms, 50_000.0) for d in range(10)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    job = {
        "id": "job-sole-key-replace",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    }
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    # The stale rows MUST be gone — their value_usd=-999_999 sentinel
    # cannot appear in the final snapshot set.
    stored = fake_supabase.rows_for("allocator_equity_snapshots")
    stale_survivors = [r for r in stored if r.get("value_usd") == -999_999.0]
    assert not stale_survivors, (
        "PRE-FIX BUG: stale snapshots survived the new-key reconstruct. "
        "The UPSERT's ignore_duplicates=True silently dropped every "
        "fresh row because (allocator_id, asof) already collided with "
        f"the stale rows. Stale survivors: {stale_survivors!r}"
    )

    # The fresh reconstruct should have produced BTC-priced rows for
    # days where the trade was in scope (5x 50000 = 50000 equity per day).
    assert stored, (
        "expected at least one fresh snapshot row after reconstruct; "
        "got an empty table."
    )
    btc_rows = [r for r in stored if "BTC" in (r.get("breakdown") or {})]
    assert btc_rows, (
        "expected fresh reconstruct to write BTC-priced rows; "
        f"got {stored!r}"
    )

    # H-1184: the user-actionable observability signal is the
    # `stale_snapshots_purged` audit field on reconstruct_complete. The
    # sole-source purge fired and deleted all 10 stale rows, so the audit
    # trail MUST report 10. A regression that wipes the table but emits
    # purged=0 (or vice-versa) silently breaks the operator's only window
    # into "we replaced N stale rows vs touched nothing".
    complete_calls = [
        c for c in audit_mock.call_args_list
        if c.kwargs.get("action") == "allocator.equity.reconstruct_complete"
    ]
    assert complete_calls, audit_mock.call_args_list
    meta = complete_calls[-1].kwargs.get("metadata") or {}
    assert meta.get("stale_snapshots_purged") == 10, (
        "sole-source purge wiped 10 stale rows but the audit field "
        f"reported {meta.get('stale_snapshots_purged')!r}; the user-actionable "
        f"observability signal is broken. metadata={meta!r}"
    )


@pytest.mark.asyncio
async def test_stale_snapshots_preserved_when_other_key_exists(monkeypatch):
    """Multi-key safety: when the allocator has ANOTHER CONNECTED api_key,
    the fresh reconstruct MUST NOT wipe existing rows. DO NOTHING semantics
    protect multi-key aggregation (T-07-V5b). This guards the fix against
    over-correction. (Disconnected siblings are covered by the separate
    test_stale_snapshots_replaced_when_sibling_is_disconnected test —
    per migration 075 a disconnected key cannot produce new data and must
    not block the sole-source purge.)"""
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=9)

    # Seed rows from a prior key's reconstruct.
    for day_offset in range(10):
        asof = (start_date + timedelta(days=day_offset)).date().isoformat()
        fake_supabase.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID,
            "asof": asof,
            "value_usd": 12345.0,  # legit first-key value
            "breakdown": {"ETH": 12345.0},
            "source": "exchange_primary",
            "history_depth_months": 24,
            "reconstructed_at": "2026-04-01T00:00:00+00:00",
        }

    # Allocator has BOTH api_keys — the new one (API_KEY_ID_1) and the
    # prior one (API_KEY_ID_2). The prior key's existence is the signal
    # that stale rows are legitimately aggregated, not orphaned. Both
    # must be ACTIVE + CONNECTED for the sibling-count filter to see
    # them (H-1162 / H-1164: the filter mirrors migration 075's worker
    # dispatch — is_active=true AND disconnected_at IS NULL AND
    # sync_status != 'revoked').
    fake_supabase.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1, "user_id": ALLOCATOR_ID, "exchange": "binance",
        "is_active": True, "disconnected_at": None, "sync_status": "ok",
    }
    fake_supabase.store[("api_keys", (API_KEY_ID_2,))] = {
        "id": API_KEY_ID_2, "user_id": ALLOCATOR_ID, "exchange": "okx",
        "is_active": True, "disconnected_at": None, "sync_status": "ok",
    }

    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000
    trades = [_make_trade(ts, "BTC/USDT", "buy", 50_000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + d * day_ms, 50_000.0) for d in range(10)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    job = {
        "id": "job-multi-key-preserve",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    }
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    # Prior-key rows must ALL survive — 12345.0 sentinel still present.
    stored = fake_supabase.rows_for("allocator_equity_snapshots")
    prior_survivors = [r for r in stored if r.get("value_usd") == 12345.0]
    assert len(prior_survivors) == 10, (
        "Multi-key safety regression: prior key's rows were clobbered. "
        "Expected all 10 seeded rows to survive (DO NOTHING preserves "
        "first-writer-wins aggregation per T-07-V5b), "
        f"got {len(prior_survivors)} survivors: {stored!r}"
    )

    # H-1184: a connected sibling means the purge MUST NOT fire — the
    # audit field must report stale_snapshots_purged=0. If a regression
    # let the purge run anyway (over-correction) the table assertion above
    # would still pass on the multi-key path's collisions, but this catches
    # the inverse: the observability signal must agree that nothing was wiped.
    complete_calls = [
        c for c in audit_mock.call_args_list
        if c.kwargs.get("action") == "allocator.equity.reconstruct_complete"
    ]
    assert complete_calls, audit_mock.call_args_list
    meta = complete_calls[-1].kwargs.get("metadata") or {}
    assert meta.get("stale_snapshots_purged") == 0, (
        "sibling exists → purge must NOT fire → stale_snapshots_purged must "
        f"be 0; got {meta.get('stale_snapshots_purged')!r}. metadata={meta!r}"
    )


@pytest.mark.asyncio
async def test_stale_snapshots_replaced_when_sibling_is_disconnected(monkeypatch):
    """/investigate 2026-04-24: disconnected sibling must not block purge.

    Reproduces the v0.15.3.3 follow-up bug: user soft-disconnected their
    previous exchange key (migration 075: api_keys.disconnected_at set),
    then added a new read-only key and hit Sync now. The stale V-shaped
    curve persisted because _allocator_has_other_api_keys counted the
    disconnected row as a sibling, the sole-source purge was skipped,
    and DO NOTHING protected the stale rows.

    Expected: disconnected sibling is NOT a live contributor (worker
    dispatch skips it per migration 075 STEP 4). The purge MUST fire
    and the fresh reconstruct must own the series.

    FAILS without the `.is_("disconnected_at", "null")` filter on the
    sibling-count query."""
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=9)

    # Seed stale rows from the (now-disconnected) prior key's era.
    # Sentinel value -999_999 makes it trivial to detect the wipe.
    for day_offset in range(10):
        asof = (start_date + timedelta(days=day_offset)).date().isoformat()
        fake_supabase.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID,
            "asof": asof,
            "value_usd": -999_999.0,  # stale sentinel — must be replaced
            "breakdown": {"STALE": -999_999.0},
            "source": "exchange_primary",
            "history_depth_months": 24,
            "reconstructed_at": "2026-04-01T00:00:00+00:00",
        }

    # New (active) key the user just uploaded + disconnected prior key.
    fake_supabase.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1, "user_id": ALLOCATOR_ID, "exchange": "binance",
        "is_active": True, "sync_status": "ok",
        "disconnected_at": None,
    }
    # SPEC-PTA-8 (specialist apply 2026-05-16): mirror production-shape
    # api_keys row so the ONLY remaining sibling-exclusion path is the
    # ``disconnected_at`` filter. Pre-fix this fixture omitted is_active /
    # sync_status, so the FakeTable's missing-key comparison excluded the
    # row via the is_active filter and the test would still pass if a
    # regression silently dropped the disconnected_at clause from
    # _allocator_has_other_api_keys.
    fake_supabase.store[("api_keys", (API_KEY_ID_2,))] = {
        "id": API_KEY_ID_2, "user_id": ALLOCATOR_ID, "exchange": "okx",
        "is_active": True, "sync_status": "ok",
        "disconnected_at": "2026-04-20T12:00:00+00:00",  # soft-disconnected
    }

    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000
    trades = [_make_trade(ts, "BTC/USDT", "buy", 50_000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + d * day_ms, 50_000.0) for d in range(10)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    job = {
        "id": "job-disconnected-sibling",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    }
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    # Stale sentinel rows MUST be purged — disconnected sibling is not a
    # live contributor, so sole-source semantics apply.
    stored = fake_supabase.rows_for("allocator_equity_snapshots")
    stale_survivors = [r for r in stored if r.get("value_usd") == -999_999.0]
    assert not stale_survivors, (
        "Disconnected-sibling regression: stale snapshots survived because "
        "the sole-source purge was skipped. A disconnected key (migration 075) "
        "cannot produce new data (worker dispatch filters disconnected_at IS "
        "NULL) and must not block the fresh reconstruct. "
        f"Got {len(stale_survivors)} stale sentinel rows still in store: {stored!r}"
    )
    # And the fresh reconstruct's rows must now be present.
    assert stored, "Fresh reconstruct wrote zero rows — upstream regression"

    # H-1184: disconnected sibling is not a live contributor, so the
    # sole-source purge fires and wipes all 10 stale rows. The audit field
    # MUST report 10 — this is the operator-visible proof that the
    # disconnected-sibling recovery path actually purged rather than no-op'd.
    complete_calls = [
        c for c in audit_mock.call_args_list
        if c.kwargs.get("action") == "allocator.equity.reconstruct_complete"
    ]
    assert complete_calls, audit_mock.call_args_list
    meta = complete_calls[-1].kwargs.get("metadata") or {}
    assert meta.get("stale_snapshots_purged") == 10, (
        "disconnected sibling → purge fires on 10 stale rows → "
        f"stale_snapshots_purged must be 10; got "
        f"{meta.get('stale_snapshots_purged')!r}. metadata={meta!r}"
    )


@pytest.mark.asyncio
async def test_persist_equity_snapshots_returns_actual_written_count(monkeypatch):
    """persist_equity_snapshots must return the number of rows Postgres
    actually wrote, not len(input). Pre-fix it returned len(stamped)
    unconditionally, so audit logs reported days_written=N while every
    row was a DO-NOTHING no-op — the user sees reconstruct_complete in
    the audit trail but the dashboard stays stale."""
    from services.equity_reconstruction import persist_equity_snapshots

    fake_supabase = FakeSupabaseClient()

    # Pre-seed 5 rows with the SAME (allocator_id, asof) keys we're about
    # to upsert. Every upsert must collide → DO NOTHING → 0 writes.
    for day in range(1, 6):
        asof = f"2026-04-{day:02d}"
        fake_supabase.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID,
            "asof": asof,
            "value_usd": 1.0,
            "breakdown": {"BTC": 1.0},
            "source": "exchange_primary",
            "history_depth_months": 24,
        }

    rows = [
        {
            "asof": f"2026-04-{day:02d}",
            "value_usd": 9999.0,  # different value — would overwrite if not ignore
            "breakdown": {"BTC": 9999.0},
            "source": "exchange_primary",
        }
        for day in range(1, 6)
    ]

    count = await persist_equity_snapshots(
        fake_supabase, rows, ALLOCATOR_ID, history_depth_months=24
    )

    assert count == 0, (
        "PRE-FIX BUG: persist_equity_snapshots returned len(stamped) even "
        "though every row was a DO-NOTHING no-op. The audit log then "
        "reported days_written=5 while the dashboard showed zero change. "
        f"Got count={count}; must reflect actual Postgres writes."
    )


# ---------------------------------------------------------------------------
# OKX contract-size regression (/investigate 2026-04-24 — v0.15.4.0)
# ---------------------------------------------------------------------------
#
# The v0.15.3.0 perp replay treated ccxt's trade['amount'] as base units,
# but ccxt's `safe_trade` (base/exchange.py:4412) never scales amount by
# contractSize. For OKX ETH-USDT-SWAP the venue returns fillSz in CONTRACTS
# with ctVal=0.1 ETH/contract (cross-checked against
# /api/v5/public/instruments?instType=SWAP on 2026-04-24 — the earlier
# v0.15.4.0 comment claiming 0.01 was wrong, which is part of why the
# cost/price fix didn't fully land on production). A 21.464 ETH position
# lands as amount=214.64 contracts, and a naive base-unit replay marks
# MTM 10x too hard, producing the impossible V-shaped curve on demo-
# allocator@quantalyze.test.

def _mk_okx_perp_trade(
    *,
    iso: str,
    side: str,
    base_amount: float,
    price: float,
    contract_size: float = 0.1,
    symbol: str = "ETH/USDT:USDT",
) -> dict:
    """Build a trade row matching the shape ccxt returns for OKX perps.

    base_amount is the real position size in base units (e.g. 21.464 ETH).
    The fixture writes amount = base_amount / contract_size (i.e. contracts,
    as the venue reports fillSz) and cost = contracts × price × contract_size
    (i.e. quote units, as ccxt's safe_trade computes).
    """
    contracts = base_amount / contract_size
    ts_ms = int(
        datetime.fromisoformat(iso).replace(tzinfo=timezone.utc).timestamp() * 1000
    )
    return {
        "timestamp": ts_ms,
        "symbol": symbol,
        "side": side,
        "amount": contracts,
        "price": price,
        "cost": contracts * price * contract_size,
        # /investigate 2026-04-24 (v0.15.4.2): the defensive ctVal override
        # fires only for real OKX SWAP fills, signalled by info.instType.
        # Stamp it here so the fixture exercises the production code path.
        "info": {"instType": "SWAP", "instId": symbol.replace("/", "-").replace(":USDT", "-SWAP")},
    }


def test_okx_contract_size_bug_no_100x_inflation_on_eth_perp():
    """Regression: OKX perp trades arrive with amount in contracts, not base
    units. For ETH/USDT:USDT the contractSize is 0.01 ETH, so a 21.464 ETH
    position lands as amount=2146.4. The pre-fix replay summed MTM on the
    raw contract count and blew the curve up 100x (demo allocator's
    2026-04-12 snapshot = -$152,771 for an account that could only ever
    mark ±a few thousand dollars against a 21 ETH position).

    The fix derives base-unit size from cost/price, which is correct for
    any linear contract regardless of contractSize, and reduces to amount
    on spot-amount-shaped fixtures (the legacy _mk_perp_trade helper).
    """
    from services.equity_reconstruction import _compute_daily_equity

    d0 = date(2026, 4, 10)  # open short 21.464 ETH @ 2500
    d1 = date(2026, 4, 11)  # hold; ETH close rises to 2571 (+$71)
    d2 = date(2026, 4, 12)  # close short @ 2571

    deposits = [{
        "timestamp": int(
            datetime(d0.year, d0.month, d0.day, tzinfo=timezone.utc).timestamp() * 1000
        ),
        "currency": "USDT",
        "amount": 50_000.0,
    }]
    trades = [
        _mk_okx_perp_trade(iso=d0.isoformat(), side="sell", base_amount=21.464, price=2500.0),
        _mk_okx_perp_trade(iso=d2.isoformat(), side="buy",  base_amount=21.464, price=2571.0),
    ]
    ohlcv_by_symbol = {
        "ETH": [
            (d0.isoformat(), 2500.0),
            (d1.isoformat(), 2571.0),
            (d2.isoformat(), 2571.0),
        ],
    }

    rows = _compute_daily_equity(
        trades=trades,
        deposits=deposits,
        withdrawals=[],
        ohlcv_by_symbol=ohlcv_by_symbol,
        coingecko_by_symbol={},
        start_date=d0,
        end_date=d2,
    )
    by_date = {r["asof"]: r for r in rows}

    # Day 0: open short at entry → no MTM move yet. Equity = 50,000.
    assert by_date[d0.isoformat()]["value_usd"] == pytest.approx(50_000.0, abs=0.01), (
        f"day 0 open must not move cash: {by_date[d0.isoformat()]!r}"
    )
    # Day 1: short 21.464 ETH held through +$71 move. Unrealised = -21.464
    # × 71 = -1523.94. Equity = 50,000 - 1523.94 = 48,476.06.
    # PRE-FIX: unrealised = -2146.4 × 71 = -152,394. Equity = -102,394. V-shape.
    expected_d1 = 50_000.0 - 21.464 * 71.0
    assert by_date[d1.isoformat()]["value_usd"] == pytest.approx(expected_d1, abs=0.5), (
        f"day 1 MTM must scale by contractSize — treating amount as base "
        f"units inflates 100x and drops equity to ~-$102k (the production "
        f"V-shape). Expected ~{expected_d1:.2f}; got "
        f"{by_date[d1.isoformat()]!r}"
    )
    # Day 2: close at 2571 → realised = -21.464 × (2571-2500) = -1523.94.
    # Equity = 50,000 - 1523.94 = 48,476.06. No open position → no perp mark.
    assert by_date[d2.isoformat()]["value_usd"] == pytest.approx(
        50_000.0 - 21.464 * 71.0, abs=0.5
    ), f"day 2 close: {by_date[d2.isoformat()]!r}"
    # Hard floor: equity must never go negative on a fully-collateralised
    # $50k account running a 21 ETH short — that only happens when the
    # contract-size inflation bug multiplies MTM by 100x.
    for iso_key, row in by_date.items():
        assert row["value_usd"] > 0, (
            f"equity went non-positive on {iso_key} — contract-size "
            f"inflation regression: {row!r}"
        )


# ---------------------------------------------------------------------------
# Refresh-job perp-notional regression (/investigate 2026-04-24 — v0.15.4.0)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_refresh_daily_uses_unrealized_pnl_for_perp_not_notional(monkeypatch):
    """allocator_positions.py:191 writes derivative value_usd = size_usd
    (full notional) because the positions table also feeds the strategy
    engine. The refresh job used to sum value_usd across all rows, so a
    21.464 ETH perp position at $2336 added $50,172 to today's equity on
    TOP of the USDT margin that was already counted in the spot row —
    demo allocator's 2026-04-23 snapshot landed at $245,665 when actual
    equity was ~$195,493 + a few hundred of unrealised PnL.

    The fix skips value_usd on derivative rows and instead contributes
    unrealized_pnl_usd (which is the genuine equity delta vs the margin
    already sitting in the USDT line). Spot rows are unchanged.
    """
    fake_supabase = FakeSupabaseClient()
    _install_fake_audit(monkeypatch)

    today = date(2026, 4, 23)

    # Seed yesterday so refresh doesn't short-circuit on empty history.
    y = today - timedelta(days=1)
    fake_supabase.store[("allocator_equity_snapshots", (ALLOCATOR_ID, y.isoformat()))] = {
        "allocator_id": ALLOCATOR_ID,
        "asof": y.isoformat(),
        "value_usd": 200_000.0,
        "breakdown": {"USDT": 200_000.0},
        "source": "exchange_primary",
        "reconstructed_at": "2026-04-22T00:00:00Z",
        "history_depth_months": 3,
    }

    # Today: $195,493.36 USDT spot (includes perp margin on OKX unified
    # margin) + one open ETH perp at 21.464 ETH notional $50,172.12 with
    # $123.45 unrealised PnL. Pre-fix total = 195,493 + 50,172 = 245,665.
    # Post-fix total = 195,493 + 123.45 = 195,616.81.
    fake_supabase.store[("allocator_holdings", (ALLOCATOR_ID, "okx", "USDT", today.isoformat()))] = {
        "allocator_id": ALLOCATOR_ID,
        "api_key_id": API_KEY_ID_1,
        "venue": "okx",
        "symbol": "USDT",
        "asof": today.isoformat(),
        "quantity": 195_493.357,
        "mark_price": 1.0,
        "value_usd": 195_493.36,
        "unrealized_pnl_usd": None,
        "holding_type": "spot",
    }
    fake_supabase.store[("allocator_holdings", (ALLOCATOR_ID, "okx", "ETHUSDT", today.isoformat()))] = {
        "allocator_id": ALLOCATOR_ID,
        "api_key_id": API_KEY_ID_1,
        "venue": "okx",
        "symbol": "ETHUSDT",
        "asof": today.isoformat(),
        "quantity": 21.464,
        "mark_price": 2336.94,
        "value_usd": 50_172.12,       # notional — must NOT contribute
        "unrealized_pnl_usd": 123.45,  # the only legitimate derivative contribution
        "holding_type": "derivative",
    }

    mock_exchange = AsyncMock()
    mock_exchange.id = "okx"
    mock_exchange.close = AsyncMock()
    _install_fake_preflight(monkeypatch, "okx", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    today_dt = datetime(today.year, today.month, today.day, 5, 0, tzinfo=timezone.utc)

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return today_dt if tz else today_dt.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    result = await run_refresh_allocator_equity_daily_job(
        {"id": "refresh-1", "kind": "refresh_allocator_equity_daily", "api_key_id": API_KEY_ID_1}
    )

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    written = [
        r for r in fake_supabase.rows_for("allocator_equity_snapshots")
        if r["asof"] == today.isoformat()
    ]
    assert len(written) == 1, f"expected one row for today; got {written!r}"
    row = written[0]

    expected_total = 195_493.36 + 123.45
    assert row["value_usd"] == pytest.approx(expected_total, abs=0.05), (
        f"PRE-FIX BUG: refresh summed perp notional (50,172.12) as equity "
        f"on top of USDT margin that was already counted in the spot line, "
        f"inflating today's snapshot by $50k. Expected {expected_total:.2f} "
        f"(USDT cash + unrealised PnL); got {row['value_usd']}"
    )
    brk = row["breakdown"]
    assert "ETHUSDT" not in brk, (
        f"perp notional must NOT appear in the breakdown under the bare "
        f"symbol — that key is reserved for spot holdings. Got {brk!r}"
    )
    assert brk.get("USDT") == pytest.approx(195_493.36, abs=0.01)
    # The perp contribution sits under a :PERP-tagged key so it can't
    # collide with a spot line of the same base currency. Post-fix the
    # refresh job emits the CANONICAL 3-part ``BASE:QUOTE:PERP`` shape
    # (H-1157 / H-1165 / H-1169) — pre-fix it emitted ``ETHUSDT:PERP``
    # which silently split the dashboard's grouping between reconstruct
    # and refresh paths.
    assert brk.get("ETH:USDT:PERP") == pytest.approx(123.45, abs=0.01), brk
    assert "ETHUSDT:PERP" not in brk, (
        "Legacy 2-part PERP key reappeared — refresh path must emit "
        "the canonical 3-part shape, see breakdown_key_for_perp()."
    )


# ---------------------------------------------------------------------------
# Defensive contract-size handler (/investigate 2026-04-24 — v0.15.4.2)
# ---------------------------------------------------------------------------
#
# The v0.15.4.0 fix relied on ccxt's safe_trade populating cost = amount ×
# price × contractSize. In practice the contractSize multiplication only
# fires when ccxt's okx.parse_trade leaves cost=None (it does) AND the
# market resolved inside safe_market carries a non-None contractSize. When
# the latter fails — markets not pre-loaded, fills-history returning a
# SWAP trade resolved against a spot market record, certain ccxt versions
# stripping contractSize during safe_market fallback — cost collapses to
# amount × price and cost/price returns raw contract counts. Production
# snapshots on 2026-04-24 01:28 (reconstructed AFTER the v0.15.4.0 deploy
# and migration 078 healing) still showed PERP = -$16,846 on a 21.064 ETH
# OKX position where the true mark is -$210. Ratio = 80x, consistent with
# position size in contracts (210.64) instead of base units (21.064).
#
# v0.15.4.2 switches to an explicit per-symbol contractSize table for
# OKX perps that survives every ccxt-path quirk.

def test_v0_15_4_2_defensive_resolves_base_units_when_cost_is_broken():
    """Reproduces the production bug: ccxt returned cost = amount × price
    (no contractSize multiplier). The v0.15.4.0 `cost/price` path would
    treat raw contract count as base units and blow up the MTM 10-100x.
    The v0.15.4.2 table-driven fallback recovers real base units.
    """
    from services.equity_reconstruction import _resolve_perp_amt_base, _PerpAmtSource

    # 21.464 ETH position on OKX ETH-USDT-SWAP (ctVal=0.1). Amount lands
    # as 214.64 contracts. When safe_trade fails to apply contractSize,
    # cost = 214.64 × 2295 = 492,508.80 (NO ctVal multiplier) and the
    # v0.15.4.0 path computes amt_base = 492508.80 / 2295 = 214.64 —
    # contracts, not ETH. The v0.15.4.2 table overrides this.
    broken_cost = 214.64 * 2295.0  # ctVal NOT applied (the production bug)
    recovered, source, _drift = _resolve_perp_amt_base(
        "ETH/USDT:USDT", amount=214.64, price=2295.0, cost=broken_cost,
        inst_type="SWAP", venue="okx",
    )
    assert recovered == pytest.approx(21.464, abs=0.001), (
        f"Defensive ctVal table must recover 21.464 ETH from the "
        f"broken-cost shape that production exhibited on 2026-04-24. "
        f"Got {recovered} — if this equals 214.64 the table didn't "
        f"fire and we're back to the contract-count inflation bug."
    )
    assert source == _PerpAmtSource.CTVAL_TABLE, source


def test_v0_15_4_2_defensive_preserves_proper_cost_path():
    """When safe_trade correctly applies contractSize (cost = amount ×
    price × ctVal), cost/price is already in base units and agrees with
    the explicit table. The defensive layer must NOT corrupt this case.
    """
    from services.equity_reconstruction import _resolve_perp_amt_base, _PerpAmtSource

    # cost = 214.64 × 2295 × 0.1 = 49,258.88 (ctVal applied correctly).
    proper_cost = 214.64 * 2295.0 * 0.1
    recovered, source, _drift = _resolve_perp_amt_base(
        "ETH/USDT:USDT", amount=214.64, price=2295.0, cost=proper_cost,
        inst_type="SWAP", venue="okx",
    )
    assert recovered == pytest.approx(21.464, abs=0.001), (
        f"Proper-cost path must still return 21.464 ETH. Got {recovered}"
    )
    assert source == _PerpAmtSource.COST_DIV_PRICE, source


def test_v0_15_4_2_defensive_backward_compat_with_synthetic_fixtures():
    """The legacy `_mk_perp_trade` test helper writes cost = amount × price
    and treats amount as base units (implicit contractSize=1). These
    fixtures are NOT in the OKX ctVal table, so the defensive layer must
    fall through to cost/price.
    """
    from services.equity_reconstruction import _resolve_perp_amt_base, _PerpAmtSource

    recovered, source, _drift = _resolve_perp_amt_base(
        "TEST/USDT:USDT", amount=10.0, price=100.0, cost=1000.0,
    )
    assert recovered == pytest.approx(10.0, abs=0.001), (
        f"Fixture compat broken. Got {recovered}"
    )
    assert source == _PerpAmtSource.COST_DIV_PRICE, source


# ---------------------------------------------------------------------------
# Audit closure M-1035 — the contract-size regression block only covered ETH
# (ctVal=0.1). The CHANGELOG names BTC-USDT-SWAP among the affected perps and
# the per-symbol OKX_PERP_CONTRACT_SIZE table has DISTINCT scales (BTC 0.01,
# SOL 1.0, DOGE 1000.0). A regression that hard-coded ETH-style scaling, or
# that broke the per-symbol table lookup for a different ctVal, would pass the
# ETH test but silently corrupt BTC/SOL base-unit recovery. These pin the
# recovery for two more scales: BTC (broken cost → ctVal table fires) and SOL
# (ctVal=1 → no distortion, cost/price already correct).
# Values hand-derived against the production table in equity_reconstruction.py
# (BTC/USDT:USDT → 0.01, SOL/USDT:USDT → 1.0) and the 5% divergence threshold.
# ---------------------------------------------------------------------------


def test_okx_contract_size_btc_perp_ctval_0_01_no_inflation():
    """BTC/USDT:USDT ctVal=0.01. A 0.5 BTC position lands as amount=50
    contracts. When safe_trade fails to apply contractSize the broken
    cost = 50 × 70000 = 3,500,000, so cost/price = 50 — contract COUNT, a
    100x inflation. The defensive ctVal table must recover 50 × 0.01 = 0.5
    BTC (real base units) via CTVAL_TABLE."""
    from services.equity_reconstruction import _resolve_perp_amt_base, _PerpAmtSource

    contracts = 0.5 / 0.01  # 50 contracts for a 0.5 BTC position
    broken_cost = contracts * 70_000.0  # ctVal NOT applied (production bug shape)
    recovered, source, _drift = _resolve_perp_amt_base(
        "BTC/USDT:USDT", amount=contracts, price=70_000.0, cost=broken_cost,
        inst_type="SWAP", venue="okx",
    )
    assert recovered == pytest.approx(0.5, abs=1e-6), (
        f"BTC ctVal table must recover 0.5 BTC from the broken-cost shape; "
        f"got {recovered}. If this equals 50 the table didn't fire and BTC "
        f"perps are back to the 100x contract-count inflation bug."
    )
    assert source == _PerpAmtSource.CTVAL_TABLE, source


def test_okx_contract_size_btc_perp_proper_cost_path_unchanged():
    """BTC with safe_trade correctly applying contractSize (cost = amount ×
    price × ctVal) → cost/price already in base units; the defensive layer
    must NOT corrupt this case."""
    from services.equity_reconstruction import _resolve_perp_amt_base, _PerpAmtSource

    contracts = 0.5 / 0.01
    proper_cost = contracts * 70_000.0 * 0.01
    recovered, source, _drift = _resolve_perp_amt_base(
        "BTC/USDT:USDT", amount=contracts, price=70_000.0, cost=proper_cost,
        inst_type="SWAP", venue="okx",
    )
    assert recovered == pytest.approx(0.5, abs=1e-6), recovered
    assert source == _PerpAmtSource.COST_DIV_PRICE, source


def test_okx_contract_size_sol_perp_ctval_1_no_distortion():
    """SOL/USDT:USDT ctVal=1.0 — amount IS already base units, so cost/price
    and the ctVal table agree (relative_err=0, below the 5% threshold). The
    defensive layer must leave it on the cost/price path with no scaling
    distortion. A regression that blanket-multiplied by a non-1 ctVal for all
    OKX perps would wrongly rescale SOL."""
    from services.equity_reconstruction import _resolve_perp_amt_base, _PerpAmtSource

    sol_contracts = 10.0 / 1.0  # 10 contracts == 10 SOL
    cost = sol_contracts * 150.0  # ctVal=1 → cost == amount × price already
    recovered, source, _drift = _resolve_perp_amt_base(
        "SOL/USDT:USDT", amount=sol_contracts, price=150.0, cost=cost,
        inst_type="SWAP", venue="okx",
    )
    assert recovered == pytest.approx(10.0, abs=1e-6), (
        f"SOL ctVal=1 must not distort base units; got {recovered}"
    )
    assert source == _PerpAmtSource.COST_DIV_PRICE, source


# ---------------------------------------------------------------------------
# Equity-anchor fix (/investigate 2026-04-24 — v0.15.4.2)
# ---------------------------------------------------------------------------
#
# Pure trade-replay from genesis cannot reconstruct the USDT balance that
# pre-dates the exchange's trade-history cut-off. On OKX that cut-off is
# 90 days, so a fully-collateralised $195k account that's been running
# for years comes out of _compute_daily_equity with value_usd hovering
# near zero and drifting into deep negative territory whenever a perp
# marks against the phantom zero-cash balance. The frontend renders the
# result as "equity change vs window start", giving catastrophic pct
# numbers like -1510% on an account that's actually down ~2.3%.
#
# v0.15.4.2 anchors the reconstructed series to the exchange's own
# total-equity number: compute `offset = today_exchange_equity -
# last_replay_row.value_usd` and apply it uniformly to every row.
# Historical day-to-day *deltas* are preserved; absolute levels match
# reality at the right-hand edge of the curve.

@pytest.mark.asyncio
async def test_v0_15_4_2_anchor_offsets_reconstructed_series_to_exchange_balance(
    monkeypatch,
):
    """The replay produces last-day value = -2,000 (phantom negative from
    the genesis-cash hole). Exchange reports $195,493 (USDT balance) today.
    The anchor must lift every row by ~$197,493 so the final row matches
    the balance total.

    NEW-C01-05: venue is OKX (unified-margin). fetch_balance['total'] already
    includes unrealised perp PnL, so unrealizedPnl from fetch_positions must
    NOT be added to the anchor — that would double-count the perp mark-to-
    market and corrupt the anchor offset for every OKX reconstruction.
    """
    from services.equity_reconstruction import _fetch_and_price_window

    class FakeExchange:
        def __init__(self):
            self.rateLimit = 0
            self.markets = {"ETH/USDT:USDT": {"contractSize": 0.1, "inverse": False}}
        async def load_markets(self):
            return self.markets
        async def fetch_my_trades(self, *a, **kw):
            return []
        async def fetch_deposits(self, *a, **kw):
            return []
        async def fetch_withdrawals(self, *a, **kw):
            return []
        async def fetch_ohlcv(self, *a, **kw):
            return []
        async def fetch_balance(self):
            return {"total": {"USDT": 195_493.36}}
        async def fetch_positions(self):
            return [{"unrealizedPnl": 123.45}]
        async def fetch_ticker(self, *a, **kw):
            return {"last": 0.0}
        async def close(self):
            pass

    # Stub _compute_daily_equity to return a V-shaped series that mimics
    # the genesis-cash hole. We're testing the anchor arithmetic only.
    def fake_compute_daily_equity(*a, **kw):
        return [
            {"asof": "2026-04-22", "value_usd": -500.0, "breakdown": {"USDT": -500.0}, "source": "exchange_primary"},
            {"asof": "2026-04-23", "value_usd": -18_447.14, "breakdown": {"USDT": -1600.54, "ETH:USDT:PERP": -16_846.60}, "source": "exchange_primary"},
            {"asof": "2026-04-24", "value_usd": -2_000.0, "breakdown": {"USDT": -1600.54, "ETH:USDT:PERP": -399.46}, "source": "exchange_primary"},
        ]
    monkeypatch.setattr(
        "services.equity_reconstruction._compute_daily_equity",
        fake_compute_daily_equity,
    )

    class StubSupabase:
        def table(self, *a, **kw): return self
        def select(self, *a, **kw): return self
        def eq(self, *a, **kw): return self
        def gte(self, *a, **kw): return self
        def lte(self, *a, **kw): return self
        def upsert(self, *a, **kw): return self
        def execute(self):
            class R: data = []
            return R()

    rows, _terminus, _telemetry = await _fetch_and_price_window(
        FakeExchange(), "okx", StubSupabase(),
        date(2026, 4, 22), date(2026, 4, 24),
    )

    # NEW-C01-05: OKX is a unified-margin venue — fetch_balance['total']
    # already marks all open perp positions to market (uPnL included).
    # Adding unrealizedPnl from fetch_positions on top would double-count
    # the uPnL and lift the entire reconstructed curve by 123.45 via the
    # anchor offset. The correct anchor is the balance total alone.
    #
    # Last row pre-anchor = -2,000.
    # Correct anchor   = 195,493.36 (USDT balance only, uPnL not additive).
    # Correct offset   = 195,493.36 - (-2,000) = 197,493.36.
    # Correct last row = 195,493.36.
    #
    # The WRONG (pre-C01-05) anchor would have been:
    #   195,493.36 + 123.45 = 195,616.81 — a double-count of the perp uPnL
    #   already embedded in the OKX unified balance.
    expected_anchor = 195_493.36  # USDT balance; uPnL NOT additive on OKX
    assert rows[-1]["value_usd"] == pytest.approx(expected_anchor, abs=0.05), (
        f"OKX anchor must equal fetch_balance total without adding uPnL "
        f"(unified-margin venue — uPnL already in balance). "
        f"Got {rows[-1]!r}"
    )
    # Historical relative deltas must be preserved (not flattened).
    delta_22_to_23_pre = -18_447.14 - (-500.0)           # -17,947.14
    delta_22_to_23_post = rows[1]["value_usd"] - rows[0]["value_usd"]
    assert delta_22_to_23_post == pytest.approx(delta_22_to_23_pre, abs=0.05), (
        f"Day-to-day deltas must survive the anchor offset. Expected "
        f"{delta_22_to_23_pre:.2f}, got {delta_22_to_23_post:.2f}"
    )
    # STARTING_BALANCE key must appear in every row carrying the offset.
    for r in rows:
        assert "STARTING_BALANCE" in r["breakdown"], r


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


# ---------------------------------------------------------------------------
# Audit-2026-05-07 regression suite - equity_reconstruction.py
# ---------------------------------------------------------------------------
# Tests for the findings in FIX-BRIEF.md (C-0326..0330, H-1156..1174,
# M-1022..1034).


# ---- C-0327 - OKX FUTURES contract-size gate -----------------------------

def test_c0327_okx_futures_inflation_gate_no_100x_on_btc_quarterly():
    """OKX expiring FUTURES carry instType='FUTURES' (not 'SWAP'), so the
    v0.15.4.2 defensive override at line 169 silently skipped them.
    Post-fix the override covers both SWAP and FUTURES.
    """
    from services.equity_reconstruction import (
        _resolve_perp_amt_base,
        _PerpAmtSource,
        OKX_FUTURES_CONTRACT_SIZE,
    )

    broken_cost = 100.0 * 60_000.0
    recovered, source, _drift = _resolve_perp_amt_base(
        "BTC/USDT:USDT-251226",
        amount=100.0,
        price=60_000.0,
        cost=broken_cost,
        inst_type="FUTURES",
        venue="okx",
    )
    expected_base = 100.0 * OKX_FUTURES_CONTRACT_SIZE["BTC/USDT:USDT"]
    assert recovered == pytest.approx(expected_base, abs=0.0001), recovered
    assert source == _PerpAmtSource.CTVAL_TABLE, source


# ---- C-0326 - Inverse perp safety ---------------------------------------

def test_c0326_inverse_perp_returns_unsupported_sentinel():
    """Inverse perps (BTC/USD:BTC) carry cost in BASE units, not quote.
    The resolver must short-circuit with INVERSE_UNSUPPORTED rather than
    silently corrupt position state via cost/price.
    """
    from services.equity_reconstruction import (
        _resolve_perp_amt_base,
        _is_inverse_perp,
        _PerpAmtSource,
    )

    assert _is_inverse_perp("BTC/USD:BTC")
    assert _is_inverse_perp("ETH/USD:ETH")
    assert not _is_inverse_perp("BTC/USDT:USDT")
    assert not _is_inverse_perp("BTC/USDT")

    _amt, source, _drift = _resolve_perp_amt_base(
        "BTC/USD:BTC",
        amount=1.0, price=60_000.0, cost=1.0,
        inst_type="SWAP", venue="okx",
    )
    assert source == _PerpAmtSource.INVERSE_UNSUPPORTED, source


def test_c0326_compute_daily_equity_records_inverse_perp_skip():
    """The replay loop must SKIP inverse-perp fills and surface them via
    inverse_perp_symbols.
    """
    from services.equity_reconstruction import _compute_daily_equity

    d0 = date(2026, 4, 10)
    inverse_trade = {
        "timestamp": int(
            datetime(d0.year, d0.month, d0.day, tzinfo=timezone.utc).timestamp() * 1000
        ),
        "symbol": "BTC/USD:BTC",
        "side": "buy",
        "amount": 1.0,
        "price": 60_000.0,
        "cost": 1.0,
        "info": {"instType": "SWAP"},
    }
    inverse_set: set[str] = set()
    _rows = _compute_daily_equity(
        trades=[inverse_trade],
        deposits=[],
        withdrawals=[],
        ohlcv_by_symbol={"BTC": [(d0.isoformat(), 60_000.0)]},
        coingecko_by_symbol={},
        start_date=d0,
        end_date=d0,
        venue="okx",
        inverse_perp_symbols=inverse_set,
    )
    assert "BTC/USD:BTC" in inverse_set, inverse_set


# ---- C-0329 - Unknown OKX perp surfaces silent-inflation signal ---------

def test_c0329_unknown_okx_swap_surfaces_via_unknown_perp_symbols():
    """An OKX SWAP fill not in the ctVal table must be surfaced via
    unknown_perp_symbols.
    """
    from services.equity_reconstruction import _compute_daily_equity

    d0 = date(2026, 4, 10)
    unknown_trade = {
        "timestamp": int(
            datetime(d0.year, d0.month, d0.day, tzinfo=timezone.utc).timestamp() * 1000
        ),
        "symbol": "WLD/USDT:USDT",
        "side": "buy",
        "amount": 50.0,
        "price": 3.0,
        "cost": 50.0 * 3.0,
        "info": {"instType": "SWAP"},
    }
    unknown_set: set[str] = set()
    _rows = _compute_daily_equity(
        trades=[unknown_trade],
        deposits=[],
        withdrawals=[],
        ohlcv_by_symbol={"WLD": [(d0.isoformat(), 3.0)]},
        coingecko_by_symbol={},
        start_date=d0,
        end_date=d0,
        venue="okx",
        unknown_perp_symbols=unknown_set,
    )
    assert "WLD/USDT:USDT" in unknown_set, unknown_set


# ---- C-0330 - Skipped-symbol surfacing -----------------------------------

def test_c0330_skipped_symbols_are_surfaced_when_ohlcv_is_missing():
    """Symbols with missing OHLCV must be added to skipped_symbols."""
    from services.equity_reconstruction import _compute_daily_equity

    d0 = date(2026, 4, 10)
    trade = {
        "timestamp": int(
            datetime(d0.year, d0.month, d0.day, tzinfo=timezone.utc).timestamp() * 1000
        ),
        "symbol": "ETH/USDT",
        "side": "buy",
        "amount": 1.0,
        "price": 2000.0,
        "cost": 2000.0,
    }
    skipped: set[str] = set()
    _rows = _compute_daily_equity(
        trades=[trade],
        deposits=[],
        withdrawals=[],
        ohlcv_by_symbol={},
        coingecko_by_symbol={},
        start_date=d0,
        end_date=d0,
        venue="binance",
        skipped_symbols=skipped,
    )
    assert "ETH" in skipped, skipped


# ---- M-1022 - Bybit perp must NOT use OKX ctVal table -------------------

def test_m1022_bybit_perp_skips_okx_ctval_table():
    """Bybit V5 also stamps instType='SWAP'. The override must be
    venue-gated so non-OKX fills always use cost/price.
    """
    from services.equity_reconstruction import _resolve_perp_amt_base, _PerpAmtSource

    recovered, source, _drift = _resolve_perp_amt_base(
        "ETH/USDT:USDT",
        amount=10.0,
        price=2000.0,
        cost=10.0 * 2000.0,
        inst_type="SWAP",
        venue="bybit",
    )
    assert recovered == pytest.approx(10.0, abs=0.001), recovered
    assert source == _PerpAmtSource.COST_DIV_PRICE, source


# ---- H-1157 / H-1165 / H-1169 - Canonical PERP breakdown key shape ------

def test_h1157_breakdown_key_for_perp_canonical_shape():
    from services.equity_reconstruction import (
        breakdown_key_for_perp,
        split_holdings_symbol_to_base_quote,
    )

    assert breakdown_key_for_perp("ETH", "USDT") == "ETH:USDT:PERP"
    assert breakdown_key_for_perp("btc", "usdt") == "BTC:USDT:PERP"

    base, quote = split_holdings_symbol_to_base_quote("ETHUSDT")
    assert (base, quote) == ("ETH", "USDT")
    assert breakdown_key_for_perp(base, quote) == "ETH:USDT:PERP"

    base, quote = split_holdings_symbol_to_base_quote("BTCUSDC")
    assert (base, quote) == ("BTC", "USDC")


# ---- H-1161 / M-1023 - Refresh-job derivative NULL-vs-zero --------------

@pytest.mark.asyncio
async def test_h1161_refresh_logs_audit_when_perp_upnl_is_none(monkeypatch):
    """NULL upnl emits perp_upnl_missing audit so the upstream gap is
    visible.
    """
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    today = date(2026, 4, 23)

    fake_supabase.store[("allocator_holdings", (ALLOCATOR_ID, "okx", "USDT", today.isoformat()))] = {
        "allocator_id": ALLOCATOR_ID, "api_key_id": API_KEY_ID_1,
        "venue": "okx", "symbol": "USDT", "asof": today.isoformat(),
        "value_usd": 100_000.0, "holding_type": "spot",
        "unrealized_pnl_usd": None,
    }
    fake_supabase.store[("allocator_holdings", (ALLOCATOR_ID, "okx", "ETHUSDT", today.isoformat()))] = {
        "allocator_id": ALLOCATOR_ID, "api_key_id": API_KEY_ID_1,
        "venue": "okx", "symbol": "ETHUSDT", "asof": today.isoformat(),
        "value_usd": 50_000.0, "holding_type": "derivative",
        "unrealized_pnl_usd": None,
    }

    mock_exchange = AsyncMock()
    mock_exchange.id = "okx"
    mock_exchange.close = AsyncMock()
    _install_fake_preflight(monkeypatch, "okx", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    today_dt = datetime(today.year, today.month, today.day, 5, 0, tzinfo=timezone.utc)

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return today_dt if tz else today_dt.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    result = await run_refresh_allocator_equity_daily_job(
        {"id": "refresh-null-upnl", "kind": "refresh_allocator_equity_daily", "api_key_id": API_KEY_ID_1}
    )

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    audit_actions = [c.kwargs.get("action") for c in audit_mock.call_args_list]
    assert "allocator.equity.perp_upnl_missing" in audit_actions, audit_actions


@pytest.mark.asyncio
async def test_h1161_refresh_keeps_perp_breakdown_entry_when_upnl_is_zero(monkeypatch):
    """upnl=0.0 (fresh open at entry) must surface a 0-valued breakdown
    key, not be silently dropped.
    """
    fake_supabase = FakeSupabaseClient()
    _install_fake_audit(monkeypatch)

    today = date(2026, 4, 23)
    fake_supabase.store[("allocator_holdings", (ALLOCATOR_ID, "okx", "USDT", today.isoformat()))] = {
        "allocator_id": ALLOCATOR_ID, "api_key_id": API_KEY_ID_1,
        "venue": "okx", "symbol": "USDT", "asof": today.isoformat(),
        "value_usd": 100_000.0, "holding_type": "spot",
        "unrealized_pnl_usd": None,
    }
    fake_supabase.store[("allocator_holdings", (ALLOCATOR_ID, "okx", "ETHUSDT", today.isoformat()))] = {
        "allocator_id": ALLOCATOR_ID, "api_key_id": API_KEY_ID_1,
        "venue": "okx", "symbol": "ETHUSDT", "asof": today.isoformat(),
        "value_usd": 50_000.0, "holding_type": "derivative",
        "unrealized_pnl_usd": 0.0,
    }

    mock_exchange = AsyncMock()
    mock_exchange.id = "okx"
    mock_exchange.close = AsyncMock()
    _install_fake_preflight(monkeypatch, "okx", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    today_dt = datetime(today.year, today.month, today.day, 5, 0, tzinfo=timezone.utc)

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return today_dt if tz else today_dt.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    result = await run_refresh_allocator_equity_daily_job(
        {"id": "refresh-zero-upnl", "kind": "refresh_allocator_equity_daily", "api_key_id": API_KEY_ID_1}
    )

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    written = [
        r for r in fake_supabase.rows_for("allocator_equity_snapshots")
        if r["asof"] == today.isoformat()
    ]
    assert len(written) == 1
    brk = written[0]["breakdown"]
    assert brk.get("ETH:USDT:PERP") == 0.0, brk


# ---- H-1162 / H-1164 - is_active sibling filter -------------------------

@pytest.mark.asyncio
async def test_h1162_sibling_with_is_active_false_does_not_block_purge(monkeypatch):
    """Deactivated sibling (is_active=false) must NOT block the
    sole-source purge.
    """
    fake_supabase = FakeSupabaseClient()
    _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=9)

    for d in range(10):
        asof = (start_date + timedelta(days=d)).date().isoformat()
        fake_supabase.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID, "asof": asof,
            "value_usd": -777_777.0, "breakdown": {"STALE": -777_777.0},
            "source": "exchange_primary", "history_depth_months": 24,
            "reconstructed_at": "2026-04-01T00:00:00+00:00",
        }

    fake_supabase.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1, "user_id": ALLOCATOR_ID, "exchange": "binance",
        "is_active": True, "disconnected_at": None, "sync_status": "ok",
    }
    fake_supabase.store[("api_keys", (API_KEY_ID_2,))] = {
        "id": API_KEY_ID_2, "user_id": ALLOCATOR_ID, "exchange": "okx",
        "is_active": False,
        "disconnected_at": None, "sync_status": "ok",
    }

    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000
    trades = [_make_trade(ts, "BTC/USDT", "buy", 50_000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + d * day_ms, 50_000.0) for d in range(10)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    result = await run_reconstruct_allocator_history_job({
        "id": "job-deactivated-sibling",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    })

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    stored = fake_supabase.rows_for("allocator_equity_snapshots")
    stale = [r for r in stored if r.get("value_usd") == -777_777.0]
    assert not stale, (
        f"Got {len(stale)} stale rows: {stored!r}"
    )


@pytest.mark.asyncio
async def test_h1162_sibling_with_revoked_sync_status_does_not_block_purge(
    monkeypatch,
):
    """Symmetric: revoked sibling must not block purge either."""
    fake_supabase = FakeSupabaseClient()
    _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=9)

    for d in range(10):
        asof = (start_date + timedelta(days=d)).date().isoformat()
        fake_supabase.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID, "asof": asof,
            "value_usd": -555_555.0, "breakdown": {"STALE": -555_555.0},
            "source": "exchange_primary", "history_depth_months": 24,
            "reconstructed_at": "2026-04-01T00:00:00+00:00",
        }

    fake_supabase.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1, "user_id": ALLOCATOR_ID, "exchange": "binance",
        "is_active": True, "disconnected_at": None, "sync_status": "ok",
    }
    fake_supabase.store[("api_keys", (API_KEY_ID_2,))] = {
        "id": API_KEY_ID_2, "user_id": ALLOCATOR_ID, "exchange": "okx",
        "is_active": True, "disconnected_at": None,
        "sync_status": "revoked",
    }

    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000
    trades = [_make_trade(ts, "BTC/USDT", "buy", 50_000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + d * day_ms, 50_000.0) for d in range(10)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    result = await run_reconstruct_allocator_history_job({
        "id": "job-revoked-sibling",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    })

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    stored = fake_supabase.rows_for("allocator_equity_snapshots")
    stale = [r for r in stored if r.get("value_usd") == -555_555.0]
    assert not stale, stored


# ---- H-1163 / C-0328 - Sibling-lookup failure surfacing ------------------

@pytest.mark.asyncio
async def test_h1163_sibling_lookup_exception_returns_fail_safe(monkeypatch):
    """A sibling-count query exception returns SiblingCheckResult with
    has_siblings=True and lookup_failed=True (fail-safe).
    """
    from services.equity_reconstruction import _allocator_has_other_api_keys

    fake_supabase = FakeSupabaseClient()

    fake_supabase.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1, "user_id": ALLOCATOR_ID, "exchange": "binance",
        "is_active": True, "disconnected_at": None, "sync_status": "ok",
    }

    class _RaisingTable:
        def select(self, *a, **kw): return self
        def eq(self, *a, **kw): return self
        def neq(self, *a, **kw): return self
        def is_(self, *a, **kw): return self
        def execute(self):
            raise RuntimeError("simulated transient 503 from supabase")

    original_table = fake_supabase.table

    def _table(name):
        if name == "api_keys":
            return _RaisingTable()
        return original_table(name)

    monkeypatch.setattr(fake_supabase, "table", _table)

    result = await _allocator_has_other_api_keys(
        fake_supabase, ALLOCATOR_ID, API_KEY_ID_1,
    )

    assert bool(result) is True, bool(result)
    assert result.lookup_failed is True
    assert result.error_message and "transient" in result.error_message


# ---- H-1166 - Purge count semantics --------------------------------------

@pytest.mark.asyncio
async def test_h1166_purge_count_reflects_actual_deletions(monkeypatch):
    """_purge_allocator_equity_snapshots returns the actual deletion
    count via _result_row_count.
    """
    from services.equity_reconstruction import _purge_allocator_equity_snapshots

    fake_supabase = FakeSupabaseClient()

    for d in range(5):
        asof = f"2026-04-{d + 1:02d}"
        fake_supabase.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID, "asof": asof, "value_usd": 1.0,
        }

    purged = await _purge_allocator_equity_snapshots(fake_supabase, ALLOCATOR_ID)
    assert purged == 5, purged

    purged_empty = await _purge_allocator_equity_snapshots(
        fake_supabase, ALLOCATOR_ID,
    )
    assert purged_empty == 0


# ---- L-0066 / L-0067 - count='exact' + returning='minimal' contract ------

@pytest.mark.asyncio
async def test_l0067_persist_requests_exact_count_minimal_returning(monkeypatch):
    """L-0067/M-1026: persist_equity_snapshots must request count='exact'
    and returning='minimal' so the audit count comes from the authoritative
    res.count (Content-Range) and PostgREST does NOT echo the full inserted-
    row JSONB representation back over the wire just to be len()'d.

    Fails before the fix (the upsert omitted both kwargs and relied on
    len(res.data) from return=representation)."""
    from services.equity_reconstruction import persist_equity_snapshots

    fake_supabase = FakeSupabaseClient()
    captured: dict = {}
    orig_table = fake_supabase.table

    def _capturing_table(name: str):
        tbl = orig_table(name)
        real_upsert = tbl.upsert

        def _wrapped(rows, **kwargs):
            captured.update(kwargs)
            return real_upsert(rows, **kwargs)

        tbl.upsert = _wrapped
        return tbl

    monkeypatch.setattr(fake_supabase, "table", _capturing_table)

    rows = [
        {"asof": f"2026-04-{d:02d}", "value_usd": 100.0 + d,
         "breakdown": {"BTC": 100.0}, "source": "exchange_primary"}
        for d in range(1, 8)  # 7 fresh rows, no collisions
    ]
    count = await persist_equity_snapshots(
        fake_supabase, rows, ALLOCATOR_ID, history_depth_months=24
    )

    assert captured.get("count") == "exact", (
        f"upsert must request count='exact'; got {captured!r}"
    )
    assert captured.get("returning") == "minimal", (
        f"upsert must request returning='minimal' (no representation "
        f"over-fetch); got {captured!r}"
    )
    # Count must survive even though returning='minimal' empties res.data —
    # proves _result_row_count read res.count, not len(res.data).
    assert count == 7, count


@pytest.mark.asyncio
async def test_l0066_purge_requests_exact_count_minimal_returning(monkeypatch):
    """L-0066: _purge_allocator_equity_snapshots must request count='exact'
    + returning='minimal' so stale_snapshots_purged comes from res.count and
    not len(res.data) (which silently reports 0 under return=minimal even
    when rows were wiped). Fails before the fix (delete() took no kwargs)."""
    from services.equity_reconstruction import _purge_allocator_equity_snapshots

    fake_supabase = FakeSupabaseClient()
    for d in range(3):
        asof = f"2026-04-{d + 1:02d}"
        fake_supabase.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID, "asof": asof, "value_usd": 1.0,
        }

    captured: dict = {}
    orig_table = fake_supabase.table

    def _capturing_table(name: str):
        tbl = orig_table(name)
        real_delete = tbl.delete

        def _wrapped(**kwargs):
            captured.update(kwargs)
            return real_delete(**kwargs)

        tbl.delete = _wrapped
        return tbl

    monkeypatch.setattr(fake_supabase, "table", _capturing_table)

    purged = await _purge_allocator_equity_snapshots(fake_supabase, ALLOCATOR_ID)

    assert captured.get("count") == "exact", (
        f"delete must request count='exact'; got {captured!r}"
    )
    assert captured.get("returning") == "minimal", (
        f"delete must request returning='minimal'; got {captured!r}"
    )
    # Count survives minimal returning → proves it read res.count.
    assert purged == 3, purged


# ---- H-1168 - Distinct audit kinds for no-op vs no-data ------------------

@pytest.mark.asyncio
async def test_h1168_reconstruct_no_data_emits_distinct_audit_kind(
    monkeypatch,
):
    """Empty replay must emit reconstruct_no_data, distinct from
    reconstruct_complete.
    """
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)

    fake_supabase.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1, "user_id": ALLOCATOR_ID, "exchange": "binance",
        "is_active": True, "disconnected_at": None, "sync_status": "ok",
    }

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(return_value=[])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=[])
    mock_exchange.fetch_balance = AsyncMock(return_value={"total": {}})
    mock_exchange.fetch_positions = AsyncMock(return_value=[])
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    result = await run_reconstruct_allocator_history_job({
        "id": "no-data",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    })

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    actions = [c.kwargs.get("action") for c in audit_mock.call_args_list]
    assert "allocator.equity.reconstruct_no_data" in actions, actions
    assert "allocator.equity.reconstruct_complete" not in actions


# ---- M-1029 - Purge failure bubbles -------------------------------------

@pytest.mark.asyncio
async def test_m1029_purge_failure_bubbles_to_outer_handler(monkeypatch):
    """Purge crash must bubble and result in reconstruct_failed audit."""
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=9)

    for d in range(10):
        asof = (start_date + timedelta(days=d)).date().isoformat()
        fake_supabase.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID, "asof": asof,
            "value_usd": 12345.0, "breakdown": {"USDT": 12345.0},
        }

    fake_supabase.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1, "user_id": ALLOCATOR_ID, "exchange": "binance",
        "is_active": True, "disconnected_at": None, "sync_status": "ok",
    }

    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000
    trades = [_make_trade(ts, "BTC/USDT", "buy", 50_000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + d * day_ms, 50_000.0) for d in range(10)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.fetch_balance = AsyncMock(return_value={"total": {}})
    mock_exchange.fetch_positions = AsyncMock(return_value=[])
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    original_table = fake_supabase.table

    def _table(name):
        t = original_table(name)
        if name == "allocator_equity_snapshots":
            orig_run = t.execute
            def _wrapped_execute():
                if t._pending_op == "delete":
                    raise RuntimeError("simulated delete failure")
                return orig_run()
            t.execute = _wrapped_execute
        return t

    monkeypatch.setattr(fake_supabase, "table", _table)
    from services import db as db_module
    monkeypatch.setattr(db_module, "get_supabase", lambda: fake_supabase)
    monkeypatch.setattr(er, "get_supabase", lambda: fake_supabase, raising=False)

    result = await run_reconstruct_allocator_history_job({
        "id": "purge-fail",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    })

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.FAILED, result

    actions = [c.kwargs.get("action") for c in audit_mock.call_args_list]
    assert "allocator.equity.reconstruct_failed" in actions, actions


# ---------------------------------------------------------------------------
# Specialist-apply 2026-05-16 regression suite (PR-Y1 + audit-2026-05-07)
# ---------------------------------------------------------------------------

# ---- PTA-5: split_holdings_symbol_to_base_quote longest-first ordering ----

def test_pta5_split_holdings_longest_first_prevents_usdc_collapse():
    """Pin the longest-first stablecoin ordering. Without it ``BTCUSDC``
    would split as ``('BTC','USD')`` with a 'C' orphan because USD is a
    valid suffix prefix of USDC. The existing h1157 test only proves
    USDC is recognised, NOT that it is preferred over USD."""
    from services.equity_reconstruction import (
        split_holdings_symbol_to_base_quote,
        _STABLECOINS_LONGEST_FIRST,
    )

    # Order invariant: USDC must precede USD so endswith() picks the
    # longer suffix first.
    idx_usdc = _STABLECOINS_LONGEST_FIRST.index("USDC")
    idx_usd = _STABLECOINS_LONGEST_FIRST.index("USD")
    assert idx_usdc < idx_usd, _STABLECOINS_LONGEST_FIRST

    assert split_holdings_symbol_to_base_quote("BTCUSDC") == ("BTC", "USDC")
    assert split_holdings_symbol_to_base_quote("ETHUSDT") == ("ETH", "USDT")
    assert split_holdings_symbol_to_base_quote("") == ("", "USDT")
    assert split_holdings_symbol_to_base_quote("UNKNOWNTOKEN") == (
        "UNKNOWNTOKEN", "USDT",
    )


# ---- PTA-6: _result_row_count bool/False guard ---------------------------

def test_pta6_result_row_count_excludes_bool_masquerading_as_int():
    """Stage-D red-team `isinstance(count, bool)` exclusion must remain.
    Pre-guard a `count=False` from an older supabase-py / mock would be
    accepted as int 0 (bool subclasses int in Python) and collapse a
    non-empty result to zero."""
    from services.equity_reconstruction import _result_row_count

    class R:  # count=False; data has 2 rows. Must fall through to len(data).
        count = False
        data = [{"a": 1}, {"b": 2}]

    class R2:  # count=True (also bool); must fall through to len(data).
        count = True
        data = [{"a": 1}]

    class R3:  # count is an int; pass through unchanged.
        count = 5
        data: list = []

    class R4:  # no count attr; len(data) wins.
        data = [{"x": 1}, {"y": 2}, {"z": 3}]

    assert _result_row_count(R()) == 2
    assert _result_row_count(R2()) == 1
    assert _result_row_count(R3()) == 5
    assert _result_row_count(R4()) == 3


# ---- PTA-11: _is_inverse_perp dated-FUTURES suffix tolerance --------------

def test_pta11_is_inverse_perp_tolerates_dated_futures_suffix():
    """`_is_inverse_perp` strips `-YYMMDD` before settle vs base
    comparison so dated inverse futures (`BTC/USD:BTC-251226`) are
    still detected. A regression that drops the .split('-')[0] would
    silently misclassify dated inverse FUTURES as linear and let
    cost-in-BASE values poison position state."""
    from services.equity_reconstruction import _is_inverse_perp

    assert _is_inverse_perp("BTC/USD:BTC-251226") is True
    assert _is_inverse_perp("ETH/USD:ETH-260327") is True
    # Linear-future dated symbols still linear.
    assert _is_inverse_perp("BTC/USDT:USDT-251226") is False
    assert _is_inverse_perp("ETH/USDT:USDT-260327") is False


# ---- PTA-10: OKX FUTURES dated-suffix fallback path ----------------------

def test_pta10_okx_futures_dated_suffix_strip_fallback():
    """The dated-FUTURES suffix-strip fallback must keep working when
    the dated symbol itself is NOT pre-populated in the table — the
    base symbol entry covers it. Pin against the BTC/ETH-only fixture
    in OKX_FUTURES_CONTRACT_SIZE."""
    from services.equity_reconstruction import (
        _resolve_perp_amt_base,
        _PerpAmtSource,
        OKX_FUTURES_CONTRACT_SIZE,
    )

    # The dated symbol is NOT in the table; the base IS. Suffix-strip
    # must fall through to the base entry.
    assert "ETH/USDT:USDT-260327" not in OKX_FUTURES_CONTRACT_SIZE
    assert "ETH/USDT:USDT" in OKX_FUTURES_CONTRACT_SIZE

    broken_cost = 100.0 * 2_000.0  # contractSize NOT applied
    recovered, source, _drift = _resolve_perp_amt_base(
        "ETH/USDT:USDT-260327",
        amount=100.0, price=2_000.0, cost=broken_cost,
        inst_type="FUTURES", venue="okx",
    )
    expected = 100.0 * OKX_FUTURES_CONTRACT_SIZE["ETH/USDT:USDT"]
    assert recovered == pytest.approx(expected, abs=0.0001), recovered
    assert source == _PerpAmtSource.CTVAL_TABLE, source


# ---- PTA-13: FALLBACK_AMOUNT branch (price<=0) ---------------------------

def test_pta13_resolve_perp_amt_base_zero_or_negative_price_falls_back():
    """price<=0 returns (amount, FALLBACK_AMOUNT, None). The caller
    pre-filters this path, but the contract is public and tests
    pin it so a downstream consumer can rely on the shape."""
    from services.equity_reconstruction import (
        _resolve_perp_amt_base,
        _PerpAmtSource,
    )

    recovered, source, drift = _resolve_perp_amt_base(
        "ETH/USDT:USDT",
        amount=10.0, price=0.0, cost=20000.0,
        inst_type="SWAP", venue="okx",
    )
    assert recovered == 10.0
    assert source == _PerpAmtSource.FALLBACK_AMOUNT, source
    assert drift is None

    recovered2, source2, _ = _resolve_perp_amt_base(
        "ETH/USDT:USDT",
        amount=10.0, price=-5.0, cost=0.0,
        inst_type="SWAP", venue="okx",
    )
    assert source2 == _PerpAmtSource.FALLBACK_AMOUNT, source2


# ---- PTA-14: amt_explicit<=0 safety fallback ------------------------------

def test_pta14_resolve_perp_amt_base_zero_explicit_falls_back_to_cost():
    """Guard against negative-or-zero amount*ctval propagating into
    perp replay state. A flipped comparator would silently invert
    positions."""
    from services.equity_reconstruction import (
        _resolve_perp_amt_base,
        _PerpAmtSource,
    )

    # amount=0 → amt_explicit = 0*ctval = 0 → must fall back to cost/price.
    recovered, source, _drift = _resolve_perp_amt_base(
        "ETH/USDT:USDT",
        amount=0.0, price=2_000.0, cost=200.0,
        inst_type="SWAP", venue="okx",
    )
    assert source == _PerpAmtSource.COST_DIV_PRICE, source
    assert recovered == pytest.approx(200.0 / 2_000.0, abs=1e-9)


# ---- PTA-1 / SPEC-CR-1: reconstruct_unexpected_noop only on sole-key -----

@pytest.mark.asyncio
async def test_pta1_unexpected_noop_audit_fires_when_rows_collide_sole_key(
    monkeypatch,
):
    """Sole-key path with rows in hand but persist count==0 (e.g. every
    snapshot collides against a leftover row) must stamp
    ``reconstruct_unexpected_noop`` — exactly the silent-regression
    pattern H-1168 was meant to expose."""
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=4)

    # Sole-key allocator (no siblings).
    fake_supabase.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1, "user_id": ALLOCATOR_ID, "exchange": "binance",
        "is_active": True, "sync_status": "ok", "disconnected_at": None,
    }

    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000
    trades = [_make_trade(ts, "BTC/USDT", "buy", 50_000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + d * day_ms, 50_000.0) for d in range(5)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    # Force persist_equity_snapshots to report count=0 with non-empty rows
    # → simulates ON CONFLICT DO NOTHING collisions on a sole-key reconstruct.
    async def _fake_persist(supabase, rows, allocator_id, depth_months):
        return 0

    monkeypatch.setattr(er, "persist_equity_snapshots", _fake_persist)

    job = {
        "id": "pta1-noop",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    }
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    actions = [c.kwargs.get("action") for c in audit_mock.call_args_list]
    assert "allocator.equity.reconstruct_unexpected_noop" in actions, actions
    assert "allocator.equity.reconstruct_complete" not in actions
    assert "allocator.equity.reconstruct_no_data" not in actions


# ---- SPEC-CR-1: multi-key adds DO NOT stamp unexpected_noop --------------

@pytest.mark.asyncio
async def test_pta1_multikey_count_zero_with_rows_is_NOT_unexpected_noop(
    monkeypatch,
):
    """A multi-key allocator legitimately collides on ON CONFLICT DO
    NOTHING against a sibling's snapshots. The new audit kind must NOT
    fire there — that's the T-07-V5b aggregation invariant, not a
    silent regression."""
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=4)

    # Two ACTIVE sibling keys → has_siblings=True.
    fake_supabase.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1, "user_id": ALLOCATOR_ID, "exchange": "binance",
        "is_active": True, "sync_status": "ok", "disconnected_at": None,
    }
    fake_supabase.store[("api_keys", (API_KEY_ID_2,))] = {
        "id": API_KEY_ID_2, "user_id": ALLOCATOR_ID, "exchange": "okx",
        "is_active": True, "sync_status": "ok", "disconnected_at": None,
    }

    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000
    trades = [_make_trade(ts, "BTC/USDT", "buy", 50_000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + d * day_ms, 50_000.0) for d in range(5)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    async def _fake_persist(supabase, rows, allocator_id, depth_months):
        return 0  # DO NOTHING collided across the board

    monkeypatch.setattr(er, "persist_equity_snapshots", _fake_persist)

    job = {
        "id": "pta1-multikey-noop",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    }
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    actions = [c.kwargs.get("action") for c in audit_mock.call_args_list]
    # Multi-key DO-NOTHING is the expected aggregation invariant — must
    # land as ``reconstruct_complete``, NOT unexpected_noop.
    assert "allocator.equity.reconstruct_complete" in actions, actions
    assert "allocator.equity.reconstruct_unexpected_noop" not in actions, actions


# ---- PTA-2: sibling_lookup_failed audit at caller site -------------------

@pytest.mark.asyncio
async def test_pta2_sibling_lookup_failure_emits_caller_audit_and_skips_purge(
    monkeypatch,
):
    """When _allocator_has_other_api_keys returns lookup_failed=True, the
    caller emits ``sibling_lookup_failed`` audit AND skips purge.
    Pre-test: only the helper-level lookup_failed flag was pinned."""
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=4)

    # Seed stale rows that MUST survive (purge gets skipped).
    for d in range(5):
        asof = (start_date + timedelta(days=d)).date().isoformat()
        fake_supabase.store[("allocator_equity_snapshots", (ALLOCATOR_ID, asof))] = {
            "allocator_id": ALLOCATOR_ID, "asof": asof,
            "value_usd": -999_999.0,
            "breakdown": {"STALE": -999_999.0},
            "source": "exchange_primary",
        }

    fake_supabase.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1, "user_id": ALLOCATOR_ID, "exchange": "binance",
        "is_active": True, "sync_status": "ok", "disconnected_at": None,
    }

    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000
    trades = [_make_trade(ts, "BTC/USDT", "buy", 50_000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + d * day_ms, 50_000.0) for d in range(5)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    async def _fake_sibling(*_a, **_k):
        return er.SiblingCheckResult(
            has_siblings=True,
            lookup_failed=True,
            error_message="db boom",
        )

    monkeypatch.setattr(er, "_allocator_has_other_api_keys", _fake_sibling)

    job = {
        "id": "pta2-sibling-fail",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    }
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    actions = [c.kwargs.get("action") for c in audit_mock.call_args_list]
    assert "allocator.equity.sibling_lookup_failed" in actions, actions

    # The fail-safe pretends siblings exist, so purge MUST be skipped:
    # stale sentinel rows survive.
    stored = fake_supabase.rows_for("allocator_equity_snapshots")
    stale_survivors = [r for r in stored if r.get("value_usd") == -999_999.0]
    assert stale_survivors, (
        "sibling_lookup_failed must trigger fail_safe_skip_purge — stale "
        "rows must survive when the lookup errored."
    )

    # Main audit metadata records sibling_check_failed=True.
    main_audit_calls = [
        c for c in audit_mock.call_args_list
        if c.kwargs.get("action", "").startswith("allocator.equity.reconstruct_")
        and c.kwargs.get("action") != "allocator.equity.sibling_lookup_failed"
    ]
    assert main_audit_calls, audit_mock.call_args_list
    main_meta = main_audit_calls[-1].kwargs.get("metadata") or {}
    assert main_meta.get("sibling_check_failed") is True, main_meta


# ---- PTA-7: refresh non-numeric upnl branch ------------------------------

@pytest.mark.asyncio
async def test_pta7_refresh_skips_non_numeric_upnl(monkeypatch):
    """A non-numeric ``unrealized_pnl_usd`` (string, list, NaN-str) must
    be skipped and logged — NOT swallowed by a broad except that would
    re-introduce the silent-drop anti-pattern."""
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    today = date(2026, 4, 15)
    today_iso = today.isoformat()

    fake_supabase.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1, "user_id": ALLOCATOR_ID, "exchange": "okx",
        "is_active": True, "sync_status": "ok", "disconnected_at": None,
    }

    # Seed holdings rows: spot USDT + a derivative with garbage upnl.
    fake_supabase.store[
        ("allocator_holdings", (ALLOCATOR_ID, today_iso, "USDT"))
    ] = {
        "allocator_id": ALLOCATOR_ID, "asof": today_iso, "symbol": "USDT",
        "holding_type": "spot", "value_usd": 100.0,
    }
    fake_supabase.store[
        ("allocator_holdings", (ALLOCATOR_ID, today_iso, "BTCUSDT"))
    ] = {
        "allocator_id": ALLOCATOR_ID, "asof": today_iso, "symbol": "BTCUSDT",
        "holding_type": "derivative", "value_usd": 1000.0,
        "unrealized_pnl_usd": "not_a_number",
    }

    mock_exchange = AsyncMock()
    mock_exchange.id = "okx"
    mock_exchange.close = AsyncMock()
    _install_fake_preflight(monkeypatch, "okx", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(today.year, today.month, today.day, tzinfo=timezone.utc)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    job = {
        "id": "pta7-refresh",
        "kind": "refresh_allocator_equity_daily",
        "api_key_id": API_KEY_ID_1,
    }
    result = await run_refresh_allocator_equity_daily_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    actions = [c.kwargs.get("action") for c in audit_mock.call_args_list]
    # Refresh must complete (loop didn't crash).
    assert "allocator.equity.refresh_complete" in actions, actions
    # Garbage-upnl row was SKIPPED → no breakdown entry for BTC:USDT:PERP,
    # but spot USDT entry should still be present.
    rows = fake_supabase.rows_for("allocator_equity_snapshots")
    assert rows, "Refresh failed to upsert any snapshot"
    breakdown = rows[-1].get("breakdown", {})
    assert "BTC:USDT:PERP" not in breakdown, breakdown
    assert "USDT" in breakdown, breakdown


# ---- PTA-9: telemetry keys surface into reconstruct audit metadata -------

@pytest.mark.asyncio
async def test_pta9_telemetry_surfaces_into_reconstruct_complete_audit(
    monkeypatch,
):
    """End-to-end audit-payload integrity: the reconstruct audit metadata
    must carry the C-0326/9/30 telemetry keys (typo / accidental key
    rename / drop is otherwise invisible)."""
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    end_date = datetime(2026, 4, 15, tzinfo=timezone.utc)
    start_date = end_date - timedelta(days=4)

    fake_supabase.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1, "user_id": ALLOCATOR_ID, "exchange": "binance",
        "is_active": True, "sync_status": "ok", "disconnected_at": None,
    }

    ts = int(start_date.timestamp() * 1000)
    day_ms = 24 * 60 * 60 * 1000
    trades = [_make_trade(ts, "BTC/USDT", "buy", 50_000.0, 1.0)]
    ohlcv = [_make_ohlcv_row(ts + d * day_ms, 50_000.0) for d in range(5)]

    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
    mock_exchange.fetch_deposits = AsyncMock(return_value=[])
    mock_exchange.fetch_withdrawals = AsyncMock(return_value=[])
    mock_exchange.fetch_ohlcv = AsyncMock(return_value=ohlcv)
    mock_exchange.close = AsyncMock()

    _install_fake_preflight(monkeypatch, "binance", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return end_date if tz else end_date.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    job = {
        "id": "pta9-telemetry",
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
    }
    result = await run_reconstruct_allocator_history_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    # Find the main reconstruct audit emission.
    main_calls = [
        c for c in audit_mock.call_args_list
        if c.kwargs.get("action", "").startswith("allocator.equity.reconstruct_")
        and "failed" not in c.kwargs.get("action", "")
    ]
    assert main_calls, audit_mock.call_args_list
    meta = main_calls[-1].kwargs.get("metadata") or {}

    # All five telemetry surfaces must be present (even if empty list).
    for key in (
        "skipped_symbols",
        "unknown_perp_symbols",
        "inverse_perp_symbols",
        "ctval_drift_warnings",
        "sibling_check_failed",
    ):
        assert key in meta, f"missing telemetry key {key}: {meta}"
    assert meta["sibling_check_failed"] is False, meta


# ---- SPEC-SFH-4: refresh perp_upnl_missing aggregation -------------------

@pytest.mark.asyncio
async def test_spec_sfh4_refresh_perp_upnl_missing_is_aggregated(monkeypatch):
    """Pre-fix: every derivative row with NULL upnl emitted its own audit
    event each daily refresh (unbounded inflation of audit_events).
    Post-fix: ONE event per handler run carrying a symbols list."""
    fake_supabase = FakeSupabaseClient()
    audit_mock = _install_fake_audit(monkeypatch)

    today = date(2026, 4, 15)
    today_iso = today.isoformat()

    fake_supabase.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1, "user_id": ALLOCATOR_ID, "exchange": "okx",
        "is_active": True, "sync_status": "ok", "disconnected_at": None,
    }

    # Three derivative rows all with NULL upnl.
    for sym in ("BTCUSDT", "ETHUSDT", "SOLUSDT"):
        fake_supabase.store[
            ("allocator_holdings", (ALLOCATOR_ID, today_iso, sym))
        ] = {
            "allocator_id": ALLOCATOR_ID, "asof": today_iso, "symbol": sym,
            "holding_type": "derivative", "value_usd": 1000.0,
            "unrealized_pnl_usd": None,
        }
    fake_supabase.store[
        ("allocator_holdings", (ALLOCATOR_ID, today_iso, "USDT"))
    ] = {
        "allocator_id": ALLOCATOR_ID, "asof": today_iso, "symbol": "USDT",
        "holding_type": "spot", "value_usd": 50.0,
    }

    mock_exchange = AsyncMock()
    mock_exchange.id = "okx"
    mock_exchange.close = AsyncMock()
    _install_fake_preflight(monkeypatch, "okx", fake_supabase, mock_exchange)

    from services import equity_reconstruction as er

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(today.year, today.month, today.day, tzinfo=timezone.utc)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)

    job = {
        "id": "sfh4-batch",
        "kind": "refresh_allocator_equity_daily",
        "api_key_id": API_KEY_ID_1,
    }
    result = await run_refresh_allocator_equity_daily_job(job)

    from services.job_worker import DispatchOutcome
    assert result.outcome == DispatchOutcome.DONE, result

    upnl_missing_calls = [
        c for c in audit_mock.call_args_list
        if c.kwargs.get("action") == "allocator.equity.perp_upnl_missing"
    ]
    # Exactly ONE event for the whole handler run (was previously N).
    assert len(upnl_missing_calls) == 1, upnl_missing_calls
    meta = upnl_missing_calls[0].kwargs.get("metadata") or {}
    assert "symbols" in meta and "missing_count" in meta, meta
    assert sorted(meta["symbols"]) == ["BTCUSDT", "ETHUSDT", "SOLUSDT"], meta
    assert meta["missing_count"] == 3, meta


# ---- L-0065 - _cap_breakdown cardinality short-circuit -------------------

def test_l0065_cap_breakdown_skips_serialise_for_small_breakdown(monkeypatch):
    """L-0065: a breakdown at/below _BREAKDOWN_TOP_N must NOT call json.dumps
    — the truncation branch can never shrink it, so serialising is pure
    hot-path waste (~730 rows/reconstruct × every connected key). Pre-fix
    json.dumps ran unconditionally; we prove it is skipped by making it raise.
    """
    from services import equity_reconstruction as er

    def _boom(*_a, **_kw):
        raise AssertionError(
            "json.dumps must NOT be called for a small (<=top-N) breakdown"
        )

    monkeypatch.setattr(er.json, "dumps", _boom)

    breakdown = {"BTC": 1000.0, "ETH": 250.0, "USDT": 5.0}
    capped = er._cap_breakdown(breakdown)

    # Identity-preserving: same object/content returned, no truncation flag.
    assert capped is breakdown
    assert "__truncated__" not in capped


def test_l0065_cap_breakdown_still_truncates_large_breakdown():
    """L-0065 guard: the >top-N path is unchanged — a breakdown that exceeds
    both the cardinality floor AND the byte cap is still truncated to top-N
    by absolute value with the __truncated__ sentinel."""
    from services.equity_reconstruction import (
        _cap_breakdown,
        _BREAKDOWN_TOP_N,
        RAW_PAYLOAD_CAP_BYTES,
    )
    import json

    # 150 long-named symbols → exceeds 4096-byte cap and the top-N floor.
    breakdown = {f"TOKEN_{i:04d}_USDT_PERP": float(i + 1) for i in range(150)}
    assert len(json.dumps(breakdown, default=str)) > RAW_PAYLOAD_CAP_BYTES

    capped = _cap_breakdown(breakdown)
    assert capped["__truncated__"] is True
    # top-N symbols (excluding the sentinel key) retained.
    assert len(capped) == _BREAKDOWN_TOP_N + 1
    # Highest-value symbol (TOKEN_0149...) must survive the top-N cut.
    assert "TOKEN_0149_USDT_PERP" in capped
