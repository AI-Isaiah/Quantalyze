"""Phase 70 / DRB-08 (70-06) — DeribitAdapter + ingestion-registry widening.

The D-13 Source-widening half: the ingestion registry becomes deribit-capable
and a read-only-gated ``DeribitAdapter`` wraps the Phase-70 fetch behind the
5-method ``IngestionAdapter`` Protocol (mirrors ``BybitAdapter``).

The subtlest guard proven here is ``compute_metrics`` FAILING LOUD: Deribit
``type=trade`` fills carry ZERO realized cashflow (Wave-0 A3 — realized
crystallizes at settlement, captured only in the txn-log ledger, 70-03/70-05).
If ``DeribitAdapter.compute_metrics`` silently delegated to the shared
fill-based ``EquityCurveBuilder`` (as OKX/Bybit legitimately do), a Deribit
strategy would persist a silently-empty/wrong track record via
``long_fetch.process_key`` — the BYB-02 corruption class. The
``test_deribit_compute_metrics_fails_loud`` guard goes RED the moment that
delegation is (re)introduced.
"""
from __future__ import annotations

import asyncio
import inspect
import typing
from datetime import datetime, timezone

import pytest

# ---------------------------------------------------------------------------
# Shared fixtures / stubs.
# ---------------------------------------------------------------------------


class _StubExchange:
    """Minimal ccxt-shaped stub — only aclose needs to be awaitable."""

    id = "deribit"

    async def close(self) -> None:  # ccxt.aclose_exchange awaits close()
        return None


def _sample_fill(trade_id: str = "t1") -> dict[str, object]:
    """A FillRow-shaped dict as ``fetch_deribit_fills`` emits (via
    ``_make_fill_dict``): the keys ``_normalize_trade`` reads."""
    return {
        "exchange": "deribit",
        "symbol": "BTC-PERPETUAL",
        "side": "buy",
        "price": "50000.0",
        "quantity": "0.5",
        "fee": "0.1",
        "fee_currency": "BTC",
        "timestamp": datetime(2026, 1, 2, tzinfo=timezone.utc).isoformat(),
        "exchange_order_id": "o1",
        "exchange_fill_id": trade_id,
        "is_maker": False,
    }


def _sample_trade() -> object:
    from services.ingestion.adapter import Trade

    return Trade(
        exchange="deribit",
        symbol="BTC-PERPETUAL",
        side="buy",
        price=50000.0,
        quantity=0.5,
        fee=0.1,
        fee_currency="BTC",
        timestamp=datetime(2026, 1, 2, tzinfo=timezone.utc),
        order_type="fill",
        is_fill=True,
    )


# ===========================================================================
# Task 1 — DeribitAdapter.
# ===========================================================================


def test_deribit_adapter_conforms_protocol() -> None:
    from services.ingestion import IngestionAdapter
    from services.ingestion.deribit import DeribitAdapter

    assert isinstance(DeribitAdapter(), IngestionAdapter)
    assert DeribitAdapter.SOURCE == "deribit"


def test_deribit_fetch_raw_delegates(monkeypatch: pytest.MonkeyPatch) -> None:
    """fetch_raw normalizes ``fetch_deribit_fills`` output into Trade[] and
    creates + closes the exchange around the fetch."""
    import services.deribit_ingest as deribit_ingest
    import services.exchange as exchange_service
    from services.ingestion.adapter import Trade
    from services.ingestion.deribit import DeribitAdapter

    created: dict[str, object] = {}
    closed: dict[str, bool] = {"aclosed": False}

    def _fake_create(name, key, secret, passphrase=None):  # type: ignore[no-untyped-def]
        created["name"] = name
        return _StubExchange()

    async def _fake_aclose(ex):  # type: ignore[no-untyped-def]
        closed["aclosed"] = True

    async def _fake_fetch(ex, since_ms=None, *, sleep=None):  # type: ignore[no-untyped-def]
        return [_sample_fill("t1"), _sample_fill("t2")]

    monkeypatch.setattr(exchange_service, "create_exchange", _fake_create)
    monkeypatch.setattr(exchange_service, "aclose_exchange", _fake_aclose)
    monkeypatch.setattr(deribit_ingest, "fetch_deribit_fills", _fake_fetch)

    adapter = DeribitAdapter()
    trades = asyncio.run(
        adapter.fetch_raw({"api_key": "k", "api_secret": "s"})
    )

    assert created["name"] == "deribit"
    assert closed["aclosed"] is True
    assert len(trades) == 2
    assert all(isinstance(t, Trade) for t in trades)
    assert all(t.exchange == "deribit" for t in trades)
    assert trades[0].symbol == "BTC-PERPETUAL"


def test_deribit_validate_rejects_write_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A write-capable key → valid=False / read_only=False. The read-only
    scope gate (validate_key_permissions/detect_deribit_permissions) is
    enforced; no write path is opened."""
    import services.exchange as exchange_service
    from services.ingestion.adapter import KeySubmissionRequest
    from services.ingestion.deribit import DeribitAdapter

    def _fake_create(name, key, secret, passphrase=None):  # type: ignore[no-untyped-def]
        return _StubExchange()

    async def _fake_aclose(ex):  # type: ignore[no-untyped-def]
        return None

    async def _fake_validate(ex):  # type: ignore[no-untyped-def]
        return {
            "valid": False,
            "read_only": False,
            "error_code": "TRADE_SCOPE",
            "error": "write scope present",
        }

    monkeypatch.setattr(exchange_service, "create_exchange", _fake_create)
    monkeypatch.setattr(exchange_service, "aclose_exchange", _fake_aclose)
    monkeypatch.setattr(
        exchange_service, "validate_key_permissions", _fake_validate
    )

    adapter = DeribitAdapter()
    req = KeySubmissionRequest(
        flow_type="onboard",
        source="deribit",
        context={"api_key": "k", "api_secret": "s"},
    )
    result = asyncio.run(adapter.validate(req))

    assert result.valid is False
    assert result.read_only is False
    assert result.error_code == "TRADE_SCOPE"


def test_deribit_compute_metrics_fails_loud() -> None:
    """THE BYB-02-class corruption guard. Deribit fills carry zero realized
    cashflow (A3); a fill-based MetricsSnapshot would be a silently-empty/
    wrong track record. compute_metrics MUST raise (ledger is the returns
    source via the broker-dailies ONE-path, 70-05) — it must NOT return a
    zero-PnL snapshot. Re-introducing shared fill-metrics delegation turns
    this RED."""
    from services.ingestion.adapter import MetricsSnapshot
    from services.ingestion.deribit import DeribitAdapter

    adapter = DeribitAdapter()
    with pytest.raises(NotImplementedError) as exc_info:
        adapter.compute_metrics([_sample_trade()])

    msg = str(exc_info.value).lower()
    assert "ledger" in msg
    # Structural guard: the method body must not delegate to the shared
    # fill-based EquityCurveBuilder metrics (that is the corruption path).
    src = inspect.getsource(DeribitAdapter.compute_metrics)
    assert "to_metrics_snapshot" not in src, (
        "DeribitAdapter.compute_metrics must FAIL LOUD, never delegate to the "
        "shared fill-based EquityCurveBuilder — Deribit fills carry zero "
        "realized cashflow (A3); returns come from the txn-log ledger (70-05)."
    )
    # Sanity: it raises rather than returning a MetricsSnapshot instance.
    assert not isinstance(exc_info.value, MetricsSnapshot)


def test_deribit_fingerprint_positions_delegate() -> None:
    """compute_fingerprint / reconstruct_positions (execution-detail axis)
    delegate to the shared exchange-agnostic impls — same shapes as bybit
    for an identical Trade list. ONLY the returns axis (compute_metrics) is
    guarded."""
    from services.ingestion.adapter import Fingerprint
    from services.ingestion.bybit import BybitAdapter
    from services.ingestion.deribit import DeribitAdapter

    trades = [_sample_trade()]
    deribit = DeribitAdapter()
    bybit = BybitAdapter()

    fp = deribit.compute_fingerprint(trades, None)  # type: ignore[arg-type]
    assert isinstance(fp, Fingerprint)
    assert fp.version == 1

    positions = asyncio.run(deribit.reconstruct_positions(trades))
    bybit_positions = asyncio.run(bybit.reconstruct_positions(trades))
    assert isinstance(positions, list)
    assert len(positions) == len(bybit_positions)


def test_deribit_adapter_does_not_repatch_exchange_quirks() -> None:
    """Canonical exchange fixes live in services/exchange.py; the adapter
    must just wrap create_exchange, never re-patch quirks."""
    from services.ingestion import deribit as deribit_module

    src = inspect.getsource(deribit_module)
    assert "exchange.has[" not in src, (
        "DeribitAdapter must not re-patch exchange quirks — canonical fixes "
        "live in services/exchange.py."
    )


# ===========================================================================
# Task 2 — registry widening (SUPPORTED_SOURCES + _FACTORIES + get_adapter).
# ===========================================================================


def test_supported_sources_includes_deribit() -> None:
    from services.ingestion import SUPPORTED_SOURCES

    assert "deribit" in SUPPORTED_SOURCES


def test_get_adapter_deribit_resolves() -> None:
    from services.ingestion import ADAPTERS, get_adapter
    from services.ingestion.deribit import DeribitAdapter

    # Clear any cached instance so the resolve path is exercised.
    ADAPTERS.pop("deribit", None)
    adapter = get_adapter("deribit")
    assert isinstance(adapter, DeribitAdapter)
    # Cached: a second call returns the SAME instance.
    assert get_adapter("deribit") is adapter


def test_unknown_source_still_rejected() -> None:
    from services.ingestion import get_adapter

    with pytest.raises(ValueError, match="Unsupported source"):
        get_adapter("kraken")


def test_source_literal_and_registry_agree() -> None:
    """Registry/Literal parity: every Source Literal value is admitted by
    SUPPORTED_SOURCES (deribit now agrees). Pins the widening did not drift
    the two apart."""
    from services.ingestion import SUPPORTED_SOURCES
    from services.ingestion.adapter import Source

    assert set(typing.get_args(Source)) == set(SUPPORTED_SOURCES)


def test_adapter_comment_reflects_phase_70_ships() -> None:
    """adapter.py must no longer say the registry EXCLUDES deribit until
    Phase 70 — Phase 70 now ships the ingestion path."""
    from services.ingestion import adapter as adapter_module

    src = inspect.getsource(adapter_module)
    # Case-insensitive so any casing of the stale "exclude … until Phase 70"
    # note reddens (subsumes the exact-case check; the `or True` dead assertion
    # that always passed is removed).
    assert "exclude deribit until phase 70" not in src.lower()
