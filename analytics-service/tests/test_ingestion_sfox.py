"""Phase 120 (SFOX-05) — SfoxAdapter unit + registration pins.

The sfox ingestion adapter mirrors ``DeribitAdapter`` (the broker-dailies
analog): its ``compute_metrics`` FAILS LOUD so sFOX returns can only ever flow
through the balance-history usd_value series → the broker-dailies ONE-path
(``chain_linked_twr`` → ``derive_basis_series``), never a fill-based
``process_key`` metrics snapshot (the BYB-02 silently-empty/wrong-track-record
corruption class). ``fetch_raw`` is likewise fail-loud: no synchronous flow
routes sfox to a bespoke Trade normalization (there is no consumer — the raise
is the tripwire against unverifiable invented mapping).

Regression gates — WHY each case matters (Rule 9):
  - compute_metrics fail-loud (T-120-01): a fill-based sfox snapshot is the
    BYB-02 economic-corruption class. The message names the ONE-path so a
    future refactor that "helpfully" delegates to EquityCurveBuilder reddens.
  - validate auth honesty (T-120-02): only a genuine 401/403 blames the user's
    key (→ AUTH_FAILED, byte-identical to the ccxt arm so the TS classifier maps
    KEY_AUTH_FAILED with zero edits). A transient (0/429/5xx) must NEVER read as
    auth-failed NOR as valid — it PROPAGATES (the 119 F4 honesty rule).
  - aclose on EVERY path: the adapter owns an aiohttp session via SfoxClient; a
    missed aclose leaks a session. Asserted on success + auth-fail + transient.
  - registration lockstep: get_adapter("sfox") resolves + caches; the Source
    Literal and SUPPORTED_SOURCES admit sfox TOGETHER (the 119 deferral was
    exactly a Literal-without-registry split).
"""
from __future__ import annotations

import asyncio
import typing
from unittest.mock import AsyncMock, MagicMock

import pytest

from services.exchange import AUTH_FAILED_DETAIL
from services.ingestion import IngestionAdapter
from services.ingestion.adapter import (
    KeySubmissionRequest,
    MetricsSnapshot,
)
from services.ingestion.sfox import SfoxAdapter
from services.sfox_client import SfoxApiError


def _make_client(get_balances_side_effect=None):
    """A mock SfoxClient instance: async get_balances + async aclose."""
    client = MagicMock(name="SfoxClient-instance")
    client.get_balances = AsyncMock(side_effect=get_balances_side_effect)
    client.aclose = AsyncMock()
    return client


def _install_sfox_client(monkeypatch, client):
    """Patch the sfox-adapter module's make_sfox_client factory to return `client`;
    return the factory spy so the test can assert construction args. (121-02: the
    adapter now constructs via the make_sfox_client egress-proxy factory, not
    SfoxClient directly — same behavior, the injection seam moved.)"""
    factory = MagicMock(return_value=client)
    monkeypatch.setattr("services.ingestion.sfox.make_sfox_client", factory)
    return factory


def _req(api_key="  tok_abc  ", api_secret=""):
    # single-Bearer contract: empty api_secret is legal (Q1).
    return KeySubmissionRequest(
        flow_type="onboard",
        source="sfox",
        context={"api_key": api_key, "api_secret": api_secret},
    )


_METRICS_SENTINEL = MetricsSnapshot(
    sharpe=None,
    twr=None,
    ytd=None,
    max_drawdown=None,
    total_pnl=None,
    trade_count=0,
    win_rate=None,
)


# --------------------------------------------------------------------------- #
# Fail-loud RETURNS axis
# --------------------------------------------------------------------------- #


def test_compute_metrics_fails_loud_naming_the_one_path() -> None:
    adapter = SfoxAdapter()
    with pytest.raises(NotImplementedError) as exc:
        adapter.compute_metrics([])
    msg = str(exc.value)
    # Names the broker-dailies ONE-path so a future EquityCurveBuilder
    # delegation (the corruption path) can't slip in silently.
    assert "chain_linked_twr" in msg
    assert "derive_basis_series" in msg


def test_fetch_raw_fails_loud() -> None:
    adapter = SfoxAdapter()
    with pytest.raises(NotImplementedError):
        asyncio.run(adapter.fetch_raw({"api_key": "tok"}))


# --------------------------------------------------------------------------- #
# validate — auth honesty + aclose
# --------------------------------------------------------------------------- #


def test_validate_success_valid_readonly_and_aclose(monkeypatch) -> None:
    client = _make_client(get_balances_side_effect=None)
    client.get_balances.return_value = []  # empty list is still valid auth+read
    factory = _install_sfox_client(monkeypatch, client)

    result = asyncio.run(SfoxAdapter().validate(_req(api_key="  tok_abc  ")))

    assert result.valid is True
    assert result.read_only is True
    assert result.error_code is None
    # Credential trimmed at the chokepoint (v1.11 convention).
    factory.assert_called_once()
    # 121-02: the adapter calls make_sfox_client(api_key) positionally.
    assert factory.call_args.args[0] == "tok_abc"
    client.get_balances.assert_awaited_once()
    client.aclose.assert_awaited_once()


@pytest.mark.parametrize("status", [401, 403])
def test_validate_auth_failure_maps_to_auth_failed(monkeypatch, status) -> None:
    client = _make_client(
        get_balances_side_effect=SfoxApiError(status, "unauthorized")
    )
    _install_sfox_client(monkeypatch, client)

    result = asyncio.run(SfoxAdapter().validate(_req()))

    assert result.valid is False
    assert result.error_code == "AUTH_FAILED"
    assert result.human_message == AUTH_FAILED_DETAIL
    client.aclose.assert_awaited_once()


@pytest.mark.parametrize("status", [0, 429, 500, 503])
def test_validate_transient_propagates_untouched(monkeypatch, status) -> None:
    # A transient/contract failure must never read as auth-failed OR valid —
    # it PROPAGATES so the caller classifies it honestly (119 F4).
    client = _make_client(
        get_balances_side_effect=SfoxApiError(status, "upstream blip")
    )
    _install_sfox_client(monkeypatch, client)

    with pytest.raises(SfoxApiError) as exc:
        asyncio.run(SfoxAdapter().validate(_req()))
    assert exc.value.status == status
    # aclose still ran on the propagating path (session never leaks).
    client.aclose.assert_awaited_once()


# --------------------------------------------------------------------------- #
# Execution-detail axis — delegation, not re-implementation
# --------------------------------------------------------------------------- #


def test_compute_fingerprint_delegates_and_returns(monkeypatch) -> None:
    fp = SfoxAdapter().compute_fingerprint([], _METRICS_SENTINEL)
    # Shared impl returns the versioned Fingerprint (empty → all-zeros default).
    assert fp.version == 1


def test_reconstruct_positions_delegates_and_returns() -> None:
    positions = asyncio.run(SfoxAdapter().reconstruct_positions([]))
    assert positions == []


def test_sfox_adapter_satisfies_protocol() -> None:
    assert isinstance(SfoxAdapter(), IngestionAdapter)


# --------------------------------------------------------------------------- #
# Registration lockstep (Phase 120 resolves the 119 deferral)
# --------------------------------------------------------------------------- #


def test_get_adapter_sfox_resolves_and_caches() -> None:
    from services.ingestion import ADAPTERS, get_adapter

    ADAPTERS.pop("sfox", None)
    adapter = get_adapter("sfox")
    assert isinstance(adapter, SfoxAdapter)
    # Cached: a second call returns the SAME instance.
    assert get_adapter("sfox") is adapter


def test_unknown_source_still_rejected() -> None:
    from services.ingestion import get_adapter

    with pytest.raises(ValueError, match="Unsupported source"):
        get_adapter("kraken")


def test_source_literal_admits_sfox() -> None:
    from services.ingestion import SUPPORTED_SOURCES
    from services.ingestion.adapter import Source

    assert "sfox" in typing.get_args(Source)
    assert "sfox" in SUPPORTED_SOURCES
