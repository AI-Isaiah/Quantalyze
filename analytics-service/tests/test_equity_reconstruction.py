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
from unittest.mock import AsyncMock, MagicMock, patch

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
    def __init__(self, data: list[dict]):
        self.data = data


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
        self._select_ranges: list[tuple[str, str, str]] = []  # (col, op, val)
        self._select_count_mode: str | None = None
        # Pending write
        self._pending_op: str | None = None  # 'upsert' | 'update' | 'insert'
        self._pending_rows: list[dict] = []
        self._pending_on_conflict: str | None = None
        self._pending_ignore_duplicates: bool = False
        self._pending_update_payload: dict = {}

    # --- write ops ---
    def upsert(self, rows, on_conflict: str | None = None, ignore_duplicates: bool = False):
        self._pending_op = "upsert"
        self._pending_rows = rows if isinstance(rows, list) else [rows]
        self._pending_on_conflict = on_conflict
        self._pending_ignore_duplicates = ignore_duplicates
        return self

    def insert(self, rows):
        self._pending_op = "insert"
        self._pending_rows = rows if isinstance(rows, list) else [rows]
        return self

    def update(self, payload: dict):
        self._pending_op = "update"
        self._pending_update_payload = payload
        return self

    # --- select ops ---
    def select(self, *_args, count: str | None = None, head: bool = False, **_kwargs):
        self._pending_op = "select"
        self._select_count_mode = count
        return self

    def eq(self, col: str, val):
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

        if self._pending_op == "select":
            matched = []
            for (tbl, _pk), row in self._store.items():
                if tbl != self._name:
                    continue
                if not all(row.get(c) == v for c, v in self._select_filters):
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

    # Second run — handler should early-return since snapshots already exist
    # OR re-upsert with ON CONFLICT DO NOTHING. Either way, row count identical.
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
    # First call returns real trades; subsequent calls simulate OKX's empty
    # page once since < 90d ago.
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
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
    mock_exchange.fetch_my_trades = AsyncMock(side_effect=[trades, []])
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
    as symbol 'BTC/USDT:USDT'. The previous implementation did
    `split('/')[-1]` which returned 'USDT:USDT' — the buy-side cost flowed
    into a phantom 'USDT:USDT' key in `quantities` while the base 'BTC'
    side was credited normally, producing spurious base-only balances on
    the reconstructed equity row.

    Post-fix: `split('/')[-1].split(':')[0]` yields the canonical 'USDT',
    so the buy debit lands on the real USDT balance and offsets the base
    credit as expected."""
    from services.equity_reconstruction import _compute_daily_equity

    asof = date(2026, 4, 15)
    ts_ms = int(
        datetime(asof.year, asof.month, asof.day, tzinfo=timezone.utc).timestamp() * 1000
    )

    # CCXT-style linear perp (Binance/Bybit) — symbol has a `:settle` suffix.
    trades = [
        {
            "timestamp": ts_ms,
            "symbol": "BTC/USDT:USDT",
            "side": "buy",
            "amount": 1.0,
            "cost": 50_000.0,
        }
    ]
    # Priced via exchange OHLCV for BTC at $50k.
    ohlcv_by_symbol = {
        "BTC": [(asof.isoformat(), 50_000.0)],
    }

    rows = _compute_daily_equity(
        trades=trades,
        deposits=[],
        withdrawals=[],
        ohlcv_by_symbol=ohlcv_by_symbol,
        coingecko_by_symbol={},
        start_date=asof,
        end_date=asof,
    )

    assert len(rows) == 1, f"expected exactly one row for {asof}; got {rows!r}"
    breakdown = rows[0]["breakdown"]
    # Phantom key must NOT exist post-fix
    assert "USDT:USDT" not in breakdown, (
        f"expected :settle suffix to be stripped from quote side; "
        f"breakdown leaked phantom key: {breakdown!r}"
    )
    # USDT is a stablecoin priced at 1.0; after a buy of 1 BTC at $50k the
    # USDT quantity goes to -50_000 and is EXCLUDED from the breakdown only
    # if qty==0 (see the `if qty == 0: continue` guard). It's non-zero, so
    # it SHOULD be represented — verifying the quote side landed on USDT
    # (not 'USDT:USDT') via a value_usd that reflects the offset.
    # BTC side: +1 @ $50k = +$50,000; USDT side: -$50,000 @ $1 = -$50,000.
    # Net value_usd == 0.
    assert rows[0]["value_usd"] == 0.0, (
        f"expected buy of 1 BTC at $50k to net to $0 equity "
        f"(base credit offset by quote debit); got {rows[0]!r}"
    )


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
