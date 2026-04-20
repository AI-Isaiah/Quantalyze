"""Tests for analytics-service/services/allocator_positions.py (Phase 06, Plan 02).

Covers INGEST-03 (worker contract), INGEST-04 (idempotent upsert), and
INGEST-05 (error UX surfacing). Nine required tests per the plan:

  1. test_fetch_allocator_holdings_returns_both_types
  2. test_idempotent_upsert
  3. test_error_status_mapping                       (INGEST-05 core)
  4. test_stablecoin_mark_price_is_one               (D-16 / RESEARCH §1)
  5. test_partial_success_emits_warnings             (complete_with_warnings — Q2)
  6. test_raw_payload_cap_4kb                        (D-02 size cap)
  7. test_deribit_balance_per_currency_shape         (f3 Path B deferral)
  8. test_run_poll_allocator_positions_job_emits_sync_completed_audit_on_done (f7)
  9. test_run_poll_allocator_positions_job_auth_error_sets_revoked

Tests mock the CCXT exchange at the instance level and the Supabase
client via MagicMock — no network, no database. The handler-level
tests (8, 9) patch `services.job_worker` entry points directly so we
exercise the full preflight → fetch → persist → audit path without
needing a real KEK or live api_keys row.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import ccxt.async_support as ccxt
import pytest

# RED state on first run — this module does not exist yet. Task 2 creates it.
from services.allocator_positions import (  # noqa: E402
    DeribitNotSupportedError,
    _map_exception_to_sync_status,
    fetch_allocator_holdings,
    persist_allocator_holdings,
)


ALLOCATOR_ID = "00000000-0000-0000-0000-0000000000aa"
API_KEY_ID = "00000000-0000-0000-0000-000000000001"
TODAY = "2026-04-19"


# ---------------------------------------------------------------------------
# Test 1 — both spot and derivative rows returned in one list
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_allocator_holdings_returns_both_types(monkeypatch):
    """D-01: each sync emits BOTH spot (from fetch_balance) AND derivative
    (from fetch_positions) rows in a single flat list. Stablecoin (USDT)
    must be priced 1.0 WITHOUT a fetch_tickers call for that symbol."""
    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_balance = AsyncMock(return_value={
        "total": {"BTC": 0.5, "ETH": 2.0, "USDT": 1000.0},
    })
    # fetch_tickers called once with the non-stablecoin symbol list
    mock_exchange.fetch_tickers = AsyncMock(return_value={
        "BTC/USDT": {"last": 50000.0},
        "ETH/USDT": {"last": 3000.0},
    })

    # Patch fetch_positions at the allocator_positions module scope (not
    # at services.positions) because allocator_positions imports it once
    # at module load — monkeypatching the original binding doesn't catch
    # the re-exported reference.
    from services import allocator_positions as ap

    async def _fake_fetch_positions(exchange_name, exchange):
        return [
            {
                "symbol": "BTCUSDT",
                "side": "long",
                "size_base": 0.1,
                "size_usd": 6000.0,
                "entry_price": 59000.0,
                "mark_price": 61000.0,
                "unrealized_pnl": 200.0,
                "exchange": "binance",
            },
        ]

    monkeypatch.setattr(ap, "fetch_positions", _fake_fetch_positions)

    rows, warning = await fetch_allocator_holdings("binance", mock_exchange)

    assert warning is None
    spot = [r for r in rows if r["holding_type"] == "spot"]
    deriv = [r for r in rows if r["holding_type"] == "derivative"]
    assert len(spot) >= 2, f"expected >=2 spot rows, got {spot}"
    assert len(deriv) >= 1, f"expected >=1 derivative row, got {deriv}"

    # USDT row must have mark_price=1.0 — asserted independently of ticker map
    usdt_row = next((r for r in spot if r["symbol"] == "USDT"), None)
    assert usdt_row is not None, "expected a USDT spot row"
    assert usdt_row["mark_price"] == 1.0
    # fetch_tickers was called exactly once (bulk) and the USDT/USDT
    # pair is NOT in the requested symbol list (stablecoin skip).
    assert mock_exchange.fetch_tickers.await_count == 1
    call = mock_exchange.fetch_tickers.await_args
    requested = call.args[0] if call.args else []
    assert "USDT/USDT" not in requested, requested

    # Derivative row shape: D-06 — cost_basis_usd = entry_price * abs(qty)
    d = deriv[0]
    assert d["symbol"] == "BTCUSDT"
    assert d["cost_basis_usd"] == pytest.approx(59000.0 * 0.1)
    assert d["entry_price"] == 59000.0


# ---------------------------------------------------------------------------
# Test 2 — idempotent upsert using the INGEST-04 conflict key
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_idempotent_upsert(api_key_row_factory):
    """INGEST-04 / SC5: re-running persist with identical rows must use
    `on_conflict="allocator_id,venue,symbol,asof"` and produce the same
    row count. Idempotency is enforced by the DB constraint; the test
    asserts the client call shape."""
    rows = [
        {
            "venue": "binance",
            "symbol": "BTC",
            "holding_type": "spot",
            "side": "flat",
            "quantity": 0.5,
            "value_usd": 30000.0,
            "entry_price": None,
            "mark_price": 60000.0,
            "unrealized_pnl_usd": None,
            "cost_basis_usd": None,
            "raw_payload": {"asset": "BTC", "total": 0.5, "mark_price": 60000.0},
        },
        {
            "venue": "binance",
            "symbol": "BTCUSDT",
            "holding_type": "derivative",
            "side": "long",
            "quantity": 0.1,
            "value_usd": 6000.0,
            "entry_price": 59000.0,
            "mark_price": 61000.0,
            "unrealized_pnl_usd": 200.0,
            "cost_basis_usd": 5900.0,
            "raw_payload": {"symbol": "BTCUSDT"},
        },
    ]

    mock_supabase = MagicMock()
    mock_table = MagicMock()
    mock_upsert = MagicMock()
    mock_upsert.execute.return_value = MagicMock(data=rows)
    mock_table.upsert.return_value = mock_upsert
    mock_supabase.table.return_value = mock_table

    count_1 = await persist_allocator_holdings(
        mock_supabase, rows, ALLOCATOR_ID, API_KEY_ID, TODAY
    )
    count_2 = await persist_allocator_holdings(
        mock_supabase, rows, ALLOCATOR_ID, API_KEY_ID, TODAY
    )

    assert count_1 == 2
    assert count_2 == 2  # same shape, same count

    # The client must use the allocator-holdings table
    mock_supabase.table.assert_called_with("allocator_holdings")
    # The conflict target must be exactly the 4-tuple INGEST-04 spec
    assert mock_table.upsert.call_count == 2
    for call in mock_table.upsert.call_args_list:
        kwargs = call.kwargs
        assert kwargs.get("on_conflict") == "allocator_id,venue,symbol,asof"

    # allocator_id / api_key_id / asof are stamped on every row
    first_payload = mock_table.upsert.call_args_list[0].args[0]
    for r in first_payload:
        assert r["allocator_id"] == ALLOCATOR_ID
        assert r["api_key_id"] == API_KEY_ID
        assert r["asof"] == TODAY


# ---------------------------------------------------------------------------
# Test 3 — exception → sync_status mapping (INGEST-05)
# ---------------------------------------------------------------------------


def test_error_status_mapping():
    """INGEST-05 / D-07: CCXT exceptions map to api_keys.sync_status values.
    Deribit's custom deferral error must map to 'error' (NOT 'revoked')
    so the key stays usable for the derivative side."""
    cases: list[tuple[Exception, str]] = [
        (ccxt.AuthenticationError("401"), "revoked"),
        (ccxt.PermissionDenied("403"), "revoked"),
        (ccxt.RateLimitExceeded("429"), "rate_limited"),
        (ccxt.NetworkError("timeout"), "error"),
        (ccxt.ExchangeNotAvailable("down"), "error"),
        (Exception("boom"), "error"),
        (DeribitNotSupportedError("spot NYI"), "error"),
    ]
    for exc, expected in cases:
        got = _map_exception_to_sync_status(exc)
        assert got == expected, f"{type(exc).__name__} → got {got!r}, expected {expected!r}"


# ---------------------------------------------------------------------------
# Test 4 — stablecoin skip (no ticker call, mark_price=1.0)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stablecoin_mark_price_is_one(monkeypatch):
    """If the balance is entirely stablecoins, we emit rows with
    mark_price=1.0 without ever calling fetch_tickers (RESEARCH §1 — lower
    API cost, no rate-limit bleed)."""
    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_balance = AsyncMock(return_value={
        "total": {"USDT": 500.0, "USDC": 250.0, "DAI": 100.0},
    })

    # If this is called, the test fails.
    def _fail(*_a, **_kw):
        raise AssertionError("fetch_tickers should NOT be called for stablecoin-only balance")

    mock_exchange.fetch_tickers = AsyncMock(side_effect=_fail)
    mock_exchange.fetch_ticker = AsyncMock(side_effect=_fail)

    # Patch fetch_positions to return empty so we only exercise the spot path
    from services import allocator_positions as ap

    async def _no_positions(*_a, **_kw):
        return []

    monkeypatch.setattr(ap, "fetch_positions", _no_positions)

    rows, _warning = await fetch_allocator_holdings("binance", mock_exchange)
    stable_rows = {r["symbol"] for r in rows if r["holding_type"] == "spot"}
    assert stable_rows == {"USDT", "USDC", "DAI"}
    for r in rows:
        if r["holding_type"] == "spot":
            assert r["mark_price"] == 1.0, r

    mock_exchange.fetch_tickers.assert_not_called()
    mock_exchange.fetch_ticker.assert_not_called()


# ---------------------------------------------------------------------------
# Test 5 — partial success (spot OK, positions down) emits warning
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_partial_success_emits_warnings(monkeypatch):
    """RESEARCH Q2: if fetch_balance succeeds and fetch_positions raises
    a non-auth non-429 exception, we persist spot and return a warning
    string. The handler surfaces this as sync_status='complete_with_warnings'."""
    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_balance = AsyncMock(return_value={
        "total": {"USDT": 500.0},
    })
    mock_exchange.fetch_tickers = AsyncMock(return_value={})

    from services import allocator_positions as ap

    async def _down(*_a, **_kw):
        raise ccxt.ExchangeNotAvailable("down")

    monkeypatch.setattr(ap, "fetch_positions", _down)

    rows, warning = await fetch_allocator_holdings("binance", mock_exchange)
    assert warning is not None and "down" in warning
    # Spot row persisted even though derivative side failed
    assert any(r["holding_type"] == "spot" and r["symbol"] == "USDT" for r in rows)
    # Zero derivative rows (the fetch raised)
    assert all(r["holding_type"] != "derivative" for r in rows)


# ---------------------------------------------------------------------------
# Test 6 — raw_payload cap at ~4KB
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_raw_payload_cap_4kb(monkeypatch):
    """D-02: raw_payload is a JSONB-compatible dict capped at ~4KB. Feed
    a balance whose per-asset payload would exceed 4KB and assert every
    emitted row's raw_payload serializes to ≤4096 bytes."""
    # Construct a balance whose 'info' would be huge — but _fetch_spot_rows
    # caps its own payload. We just need at least one row and ensure its
    # raw_payload doesn't exceed the cap. A derivative row with a huge
    # position dict is the simplest way to exercise the branch too.
    mock_exchange = AsyncMock()
    mock_exchange.id = "binance"
    mock_exchange.fetch_balance = AsyncMock(return_value={
        "total": {"BTC": 0.5},
    })
    mock_exchange.fetch_tickers = AsyncMock(return_value={
        "BTC/USDT": {"last": 50000.0},
    })

    from services import allocator_positions as ap

    # A huge derivative snapshot — simulate 10KB of extra ccxt metadata
    huge_extra = "x" * 10_000

    async def _huge_positions(*_a, **_kw):
        return [{
            "symbol": "BTCUSDT",
            "side": "long",
            "size_base": 0.1,
            "size_usd": 6000.0,
            "entry_price": 59000.0,
            "mark_price": 61000.0,
            "unrealized_pnl": 200.0,
            "exchange": "binance",
            "ccxt_raw_info_blob": huge_extra,
        }]

    monkeypatch.setattr(ap, "fetch_positions", _huge_positions)

    rows, _warning = await fetch_allocator_holdings("binance", mock_exchange)
    for r in rows:
        assert len(json.dumps(r["raw_payload"], default=str)) <= 4096, (
            f"row {r['symbol']} raw_payload over 4KB cap"
        )


# ---------------------------------------------------------------------------
# Test 7 — f3 Path B: Deribit spot raises DeribitNotSupportedError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_deribit_balance_per_currency_shape(monkeypatch):
    """f3 Path B — Deribit spot ingestion is deferred until a test key
    is available. Rather than silently emit zero rows from {'total': {}},
    the worker raises DeribitNotSupportedError BEFORE fetch_balance is
    even called. _map_exception_to_sync_status routes this to 'error'
    (NOT 'revoked') so the allocator sees the deferral and the
    derivative side continues to sync."""
    # Subclass check — this is the contract-level proof that Path B
    # (not Path A: per-currency branch) was taken.
    assert issubclass(DeribitNotSupportedError, ccxt.NotSupported)

    mock_exchange = AsyncMock()
    mock_exchange.id = "deribit"
    # If fetch_balance gets called, Path A was taken — fail the test.
    mock_exchange.fetch_balance = AsyncMock(return_value={
        "total": {},
        "info": {"result": {"BTC": {"balance": 0.5}, "ETH": {"balance": 2.0}}},
    })

    with pytest.raises(DeribitNotSupportedError) as excinfo:
        await fetch_allocator_holdings("deribit", mock_exchange)

    assert "Deribit spot" in str(excinfo.value)
    # fetch_balance MUST NOT be called — guard fires first
    mock_exchange.fetch_balance.assert_not_called()

    # Mapping: error, not revoked (key stays usable for derivatives)
    assert _map_exception_to_sync_status(excinfo.value) == "error"


# ---------------------------------------------------------------------------
# Test 8 — f7: handler emits allocator.holdings.sync_completed audit event
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_poll_allocator_positions_job_emits_sync_completed_audit_on_done(
    monkeypatch, api_key_row_factory
):
    """f7: on DONE, run_poll_allocator_positions_job MUST route an audit
    emission through services.audit.log_audit_event — NOT a local no-op.
    Verified by patching services.audit.log_audit_event and asserting
    exact call shape (action/entity_type/entity_id/metadata)."""
    from services import job_worker as jw
    from services import audit as audit_module

    key_row = api_key_row_factory(id=API_KEY_ID, user_id=ALLOCATOR_ID, exchange="binance")
    mock_supabase = MagicMock()

    # Stub the preflight to return a ready _ExchangeContext. The real
    # preflight would touch KEK / Supabase / ccxt — unnecessary here.
    mock_exchange = MagicMock()
    mock_exchange.close = AsyncMock()

    fake_ctx = jw._ExchangeContext(
        supabase=mock_supabase,
        strategy_row=None,
        key_row=key_row,
        exchange=mock_exchange,
    )

    async def _fake_preflight(job, name):
        return fake_ctx

    monkeypatch.setattr(jw, "_allocator_key_preflight", _fake_preflight)

    # Stub fetch + persist
    spot_row = {
        "venue": "binance", "symbol": "BTC", "holding_type": "spot",
        "side": "flat", "quantity": 0.5, "value_usd": 30000.0,
        "entry_price": None, "mark_price": 60000.0,
        "unrealized_pnl_usd": None, "cost_basis_usd": None,
        "raw_payload": {"asset": "BTC"},
    }
    deriv_row = {
        "venue": "binance", "symbol": "BTCUSDT", "holding_type": "derivative",
        "side": "long", "quantity": 0.1, "value_usd": 6000.0,
        "entry_price": 59000.0, "mark_price": 61000.0,
        "unrealized_pnl_usd": 200.0, "cost_basis_usd": 5900.0,
        "raw_payload": {"symbol": "BTCUSDT"},
    }

    async def _fake_fetch(venue, exchange):
        return ([spot_row, deriv_row], None)

    async def _fake_persist(supa, rows, allocator_id, api_key_id, asof):
        return len(rows)

    # Patch module-local lookups in the handler. The handler does a local
    # import from services.allocator_positions — patch the symbols on that
    # module so the import binding picks up the mock.
    from services import allocator_positions as ap_mod
    monkeypatch.setattr(ap_mod, "fetch_allocator_holdings", _fake_fetch)
    monkeypatch.setattr(ap_mod, "persist_allocator_holdings", _fake_persist)

    # Make the supabase update path a no-op
    mock_update = MagicMock()
    mock_update.execute.return_value = MagicMock(data=[])
    mock_eq = MagicMock()
    mock_eq.execute.return_value = MagicMock(data=[])
    mock_update.eq.return_value = mock_eq
    mock_table = MagicMock()
    mock_table.update.return_value = mock_update
    mock_supabase.table.return_value = mock_table

    # The f7 patch target — log_audit_event lives in services.audit.
    # The handler does `from services.audit import log_audit_event`,
    # which binds the name at call time. Patch on the audit module so
    # the import inside _emit_audit resolves to our mock.
    log_audit_mock = MagicMock()
    monkeypatch.setattr(audit_module, "log_audit_event", log_audit_mock)

    job = {
        "id": "job-1",
        "kind": "poll_allocator_positions",
        "api_key_id": API_KEY_ID,
    }

    result = await jw.run_poll_allocator_positions_job(job)

    assert result.outcome == jw.DispatchOutcome.DONE

    # Audit emission — exact shape per ADR-0023 taxonomy
    log_audit_mock.assert_called_once()
    _args, kwargs = log_audit_mock.call_args
    assert kwargs["user_id"] == ALLOCATOR_ID
    assert kwargs["action"] == "allocator.holdings.sync_completed"
    assert kwargs["entity_type"] == "api_key"
    assert kwargs["entity_id"] == API_KEY_ID
    assert kwargs["metadata"] == {
        "row_count": 2,
        "holding_type_counts": {"spot": 1, "derivative": 1},
    }


# ---------------------------------------------------------------------------
# Test 9 — auth error maps to sync_status='revoked' + sync_failed audit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_poll_allocator_positions_job_auth_error_sets_revoked(
    monkeypatch, api_key_row_factory
):
    """INGEST-05 / D-07: AuthenticationError → api_keys.sync_status='revoked'
    with sanitized sync_error. Audit emits 'allocator.holdings.sync_failed'
    with error_kind/sanitized_message metadata."""
    from services import job_worker as jw
    from services import audit as audit_module
    from services import allocator_positions as ap_mod

    key_row = api_key_row_factory(id=API_KEY_ID, user_id=ALLOCATOR_ID, exchange="binance")
    mock_supabase = MagicMock()
    mock_exchange = MagicMock()
    mock_exchange.close = AsyncMock()

    fake_ctx = jw._ExchangeContext(
        supabase=mock_supabase,
        strategy_row=None,
        key_row=key_row,
        exchange=mock_exchange,
    )

    async def _fake_preflight(job, name):
        return fake_ctx

    monkeypatch.setattr(jw, "_allocator_key_preflight", _fake_preflight)

    async def _fail_auth(venue, exchange):
        raise ccxt.AuthenticationError("401 invalid api key")

    monkeypatch.setattr(ap_mod, "fetch_allocator_holdings", _fail_auth)

    # Capture the UPDATE call payload
    update_payloads: list[dict] = []

    def _update_payload_capture(payload):
        update_payloads.append(payload)
        m = MagicMock()
        m.eq.return_value.execute.return_value = MagicMock(data=[])
        return m

    mock_table = MagicMock()
    mock_table.update.side_effect = _update_payload_capture
    mock_supabase.table.return_value = mock_table

    log_audit_mock = MagicMock()
    monkeypatch.setattr(audit_module, "log_audit_event", log_audit_mock)

    job = {
        "id": "job-2",
        "kind": "poll_allocator_positions",
        "api_key_id": API_KEY_ID,
    }

    result = await jw.run_poll_allocator_positions_job(job)

    # Handler returns FAILED with error_kind='permanent' so the
    # dispatch loop transitions compute_jobs → failed
    assert result.outcome == jw.DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert "401" in (result.error_message or "")

    # The api_keys row was updated with sync_status='revoked' + a sanitized error
    revoked_updates = [p for p in update_payloads if p.get("sync_status") == "revoked"]
    assert revoked_updates, f"expected a revoked UPDATE; got {update_payloads!r}"
    assert revoked_updates[0].get("sync_error")
    assert len(revoked_updates[0]["sync_error"]) <= 500

    # Audit emitted with the failure action + error_kind metadata
    log_audit_mock.assert_called_once()
    _args, kwargs = log_audit_mock.call_args
    assert kwargs["action"] == "allocator.holdings.sync_failed"
    assert kwargs["entity_type"] == "api_key"
    assert kwargs["entity_id"] == API_KEY_ID
    assert kwargs["metadata"]["error_kind"] == "permanent"
    assert "sanitized_message" in kwargs["metadata"]
