"""Phase 19 / BACKBONE-02 — IngestionAdapter Protocol shape tests.

Verifies:
  1. Protocol is `@runtime_checkable` and exposes the 5 method names
     (validate, fetch_raw, compute_metrics, compute_fingerprint,
     reconstruct_positions).
  2. The shared dataclasses re-export from `services.ingestion.adapter`
     succeeds for KeySubmissionRequest, VerificationResult, Trade,
     Position, MetricsSnapshot, Fingerprint, ValidationResult.
  3. `Fingerprint().to_jsonb()` returns the exact 5-component shape +
     `version: 1` per CONTEXT.md L66-72; arrays are length 4/4/4/10/24.
  4. `get_adapter('mt5')` raises ValueError with 'Unsupported source'.
  5. The 4 Literal type aliases (FlowType, Source, TrustTier, Status)
     match the canonical enum exactly.
"""
from __future__ import annotations

import typing


def test_protocol_runtime_checkable() -> None:
    from services.ingestion import IngestionAdapter

    # @runtime_checkable means we can isinstance-check at runtime against
    # the Protocol; the Protocol decorator records this as __runtime_checkable__.
    assert getattr(IngestionAdapter, "_is_runtime_protocol", False) is True, (
        "IngestionAdapter must be decorated with @runtime_checkable so the "
        "registry can structurally verify concrete adapters."
    )

    # The 5 methods must be declared on the Protocol body.
    expected_methods = {
        "validate",
        "fetch_raw",
        "compute_metrics",
        "compute_fingerprint",
        "reconstruct_positions",
    }
    declared = {
        name
        for name in dir(IngestionAdapter)
        if not name.startswith("_")
    }
    missing = expected_methods - declared
    assert not missing, f"Protocol missing methods: {missing}"


def test_dataclasses_importable() -> None:
    from services.ingestion.adapter import (  # noqa: F401
        Fingerprint,
        KeySubmissionRequest,
        MetricsSnapshot,
        Position,
        Trade,
        ValidationResult,
        VerificationResult,
    )


def test_fingerprint_to_jsonb_shape() -> None:
    from services.ingestion.adapter import Fingerprint

    fp = Fingerprint()
    jsonb = fp.to_jsonb()

    assert jsonb["version"] == 1
    # Arrays exactly 4 / 4 / 4 / 10 / 24 floats per CONTEXT.md L66-72.
    assert len(jsonb["trade_size_buckets"]) == 4
    assert len(jsonb["hold_duration_buckets"]) == 4
    assert len(jsonb["asset_class_mix"]) == 4
    assert len(jsonb["instrument_concentration"]) == 10
    assert len(jsonb["temporal_pattern"]) == 24

    # Exactly 6 keys: version + 5 array components.
    assert set(jsonb.keys()) == {
        "version",
        "trade_size_buckets",
        "hold_duration_buckets",
        "asset_class_mix",
        "instrument_concentration",
        "temporal_pattern",
    }


def test_get_adapter_unknown_source() -> None:
    import pytest

    from services.ingestion import get_adapter

    with pytest.raises(ValueError) as exc_info:
        get_adapter("mt5")

    assert "Unsupported source" in str(exc_info.value)


def test_okx_adapter_protocol_conforms() -> None:
    from services.ingestion import IngestionAdapter
    from services.ingestion.okx import OkxAdapter

    assert isinstance(OkxAdapter(), IngestionAdapter)
    assert OkxAdapter.SOURCE == "okx"


def test_binance_adapter_protocol_conforms() -> None:
    from services.ingestion import IngestionAdapter
    from services.ingestion.binance import BinanceAdapter

    assert isinstance(BinanceAdapter(), IngestionAdapter)
    assert BinanceAdapter.SOURCE == "binance"


def test_bybit_adapter_protocol_conforms() -> None:
    from services.ingestion import IngestionAdapter
    from services.ingestion.bybit import BybitAdapter

    assert isinstance(BybitAdapter(), IngestionAdapter)
    assert BybitAdapter.SOURCE == "bybit"


def test_bybit_adapter_does_not_repatch_fetchcurrencies() -> None:
    """Per RESEARCH.md gotcha L809: Bybit fetchCurrencies is already
    patched in services/exchange.py:35-46. The adapter must NOT add
    its own patch — wrap, don't modify."""
    import inspect

    from services.ingestion import bybit as bybit_module

    src = inspect.getsource(bybit_module)
    assert "fetchCurrencies" not in src, (
        "BybitAdapter must not re-patch fetchCurrencies; it is already "
        "handled in services/exchange.py:35-46."
    )


def test_get_adapter_returns_concrete_classes() -> None:
    from services.ingestion import get_adapter

    assert get_adapter("okx").__class__.__name__ == "OkxAdapter"
    assert get_adapter("binance").__class__.__name__ == "BinanceAdapter"
    assert get_adapter("bybit").__class__.__name__ == "BybitAdapter"
    # `csv` covered separately in tests/test_csv_adapter.py to keep the
    # CSV-specific behavior contract co-located.


def test_binance_fetch_raw_does_not_require_supabase_in_context() -> None:
    """CR-01 regression (REVIEW.md 2026-05-08).

    The pre-fix `BinanceAdapter.fetch_raw` read `creds_or_file["supabase"]`
    which raised KeyError on every Binance teaser/onboard call once the
    unified-backbone flag flipped on. The thin adapters in src/app/api/*
    serialize the envelope as JSON; a Python supabase client cannot
    survive that round-trip. After the fix, fetch_raw builds the
    supabase client locally via services.db.get_supabase().

    This test verifies:
      1. The KeyError on `supabase` is gone (no `creds_or_file["supabase"]`
         lookup remains).
      2. Missing `strategy_id` produces a clear ValueError instead of a
         leaky KeyError.
    """
    import asyncio
    import inspect
    from unittest.mock import patch

    import pytest

    from services.ingestion.binance import BinanceAdapter

    # Source-level guard — strip comments so the descriptive comment that
    # references the legacy lookup string does not produce a false positive.
    src_lines = inspect.getsource(BinanceAdapter.fetch_raw).splitlines()
    code_only = "\n".join(
        ln for ln in src_lines if not ln.lstrip().startswith("#")
    )
    assert 'creds_or_file["supabase"]' not in code_only, (
        "BinanceAdapter.fetch_raw must build the supabase client "
        "internally per CR-01; expecting it on the JSON envelope is "
        "structurally impossible from the thin adapters."
    )

    # Behavioral guard — missing strategy_id surfaces ValueError, not KeyError.
    adapter = BinanceAdapter()
    # Patch get_supabase so the test does not require live SUPABASE_URL.
    with patch("services.db.get_supabase", return_value=object()):
        with pytest.raises(ValueError) as exc_info:
            asyncio.run(
                adapter.fetch_raw(
                    {
                        "api_key": "k",
                        "api_secret": "s",
                        # strategy_id intentionally absent — teaser-flow shape.
                    }
                )
            )
    assert "strategy_id" in str(exc_info.value)


def test_literal_types() -> None:
    from services.ingestion.adapter import FlowType, Source, Status, TrustTier

    assert set(typing.get_args(FlowType)) == {
        "teaser",
        "onboard",
        "internal_report",
        "csv",
        "resync",
    }
    assert set(typing.get_args(Source)) == {"okx", "binance", "bybit", "csv"}
    assert set(typing.get_args(TrustTier)) == {
        "api_verified",
        "csv_uploaded",
        "self_reported",
    }
    assert set(typing.get_args(Status)) == {
        "draft",
        "validated",
        "metrics_captured",
        "encrypted",
        "report_queued",
        "published",
    }
