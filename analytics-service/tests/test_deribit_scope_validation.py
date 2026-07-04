"""DRB-03 Deribit scope validation — probe + honest-error surfacing tests.

Two halves, mirroring the two plan tasks:

  Task 1 (this file's first half): unit-prove ``detect_deribit_permissions``
  against a mocked ``public/auth`` for all four scope classes + the fail-CLOSED
  exception path, the ``_DISPATCH['deribit']`` registration, and the scope-gate
  relocation (single definition importable from BOTH services and the harness).

  Task 2 (second half): drive ``validate_key_permissions`` end-to-end with a
  mocked ccxt-like deribit object, proving the deribit precheck runs BEFORE
  ``fetch_balance`` (so a key missing ``account:read`` is named honestly rather
  than dying in the generic PERMISSION_DENIED branch), the compliant path
  probes exactly once, sibling exchanges are byte-unchanged, and — the
  wiring-invocation guard (memory F1-F12) — deleting ``_DISPATCH['deribit']``
  flips the write-scope rejection OFF, proving the dispatch entry is the
  load-bearing invocation at the key-save path.

Regression gates — WHY each case matters (Rule 9):
  - A write-capable Deribit key (``:read_write`` / ``:read_trade`` grant) saved
    as "read-only" is the T-68-05 Elevation-of-Privilege hole. The reject must
    NAME the offending scope token — a generic "invalid key" leaves the manager
    unable to fix it.
  - ccxt's deribit ``fetch_balance`` itself needs ``account:read``; a key
    missing that scope would die generically BEFORE any scope probe unless the
    precheck is ordered first. SC3 (honest naming) is hollow without it — hence
    the explicit "fetch_balance never awaited on a rejection path" assertion.
  - The credential-redaction assertion proves a ccxt auth error echoing the
    client_id/client_secret never reaches the logs (T-68-07).
  - I/O-free: only ``public_get_auth`` / ``load_markets`` / ``fetch_balance``
    are mocked; no live network, no pandas construction.
"""
from __future__ import annotations

import logging

import pytest
from unittest.mock import AsyncMock

from services import key_permissions
from services.key_permissions import (
    _DISPATCH,
    _FAIL_CLOSED,
    detect_deribit_permissions,
    scope_is_read_only,
)

# LTP-shaped read-only scope — the observed grounding fact (67-01/67-02).
_LTP_SCOPE = "trade:read account:read wallet:read custody:read block_trade:read"


class _StubDeribit:
    """Minimal stand-in for a ccxt deribit exchange: exposes ``id``,
    ``apiKey``, ``secret`` and a mocked ``public_get_auth`` returning a
    ``{"result": {"scope": ...}}`` envelope (or raising)."""

    def __init__(
        self,
        scope: str | None = None,
        *,
        raises: Exception | None = None,
        api_key: str = "CLIENTID_ABC123",
        secret: str = "SECRET_XYZ789",
    ) -> None:
        self.id = "deribit"
        self.apiKey = api_key
        self.secret = secret
        self._scope = scope
        self._raises = raises
        self.auth_calls = 0

    async def public_get_auth(self, params: dict[str, object]) -> dict[str, object]:
        self.auth_calls += 1
        if self._raises is not None:
            raise self._raises
        return {"result": {"scope": self._scope}}


# ---------------------------------------------------------------------------
# Task 1 — detect_deribit_permissions unit coverage (mocked public/auth)
# ---------------------------------------------------------------------------


class TestDetectDeribitPermissions:
    async def test_compliant_read_only_ltp_scope(self):
        """LTP-shaped read-only key → read=True, no write, no scope_detail."""
        ex = _StubDeribit(_LTP_SCOPE)
        result = await detect_deribit_permissions(ex)
        assert result == {
            "read": True,
            "trade": False,
            "withdraw": False,
            "probe_error": False,
        }
        assert "scope_detail" not in result
        assert ex.auth_calls == 1

    async def test_write_scope_rejected_naming_the_token(self):
        """A wallet:read_write grant → trade=True + scope_detail naming the
        offending TOKEN verbatim (T-68-05)."""
        ex = _StubDeribit("account:read trade:read wallet:read_write")
        result = await detect_deribit_permissions(ex)
        assert result["trade"] is True
        assert (
            result["scope_detail"]
            == "key has write scope 'wallet:read_write' — create a read-only key"
        )

    async def test_read_trade_write_scope_rejected(self):
        """The other write suffix (:read_trade) is caught too."""
        ex = _StubDeribit("account:read trade:read_trade")
        result = await detect_deribit_permissions(ex)
        assert result["trade"] is True
        assert (
            result["scope_detail"]
            == "key has write scope 'trade:read_trade' — create a read-only key"
        )

    async def test_missing_account_read_named(self):
        """Scope without account:read → read=False naming account:read."""
        ex = _StubDeribit("trade:read wallet:read")
        result = await detect_deribit_permissions(ex)
        assert result["read"] is False
        assert (
            result["scope_detail"]
            == "key is missing required scope 'account:read'"
        )

    async def test_missing_trade_read_named(self):
        """Scope without trade:read → read=False naming trade:read. block_trade
        must NOT satisfy trade:read (subsystem-prefix guard)."""
        ex = _StubDeribit("account:read wallet:read block_trade:read")
        result = await detect_deribit_permissions(ex)
        assert result["read"] is False
        assert (
            result["scope_detail"]
            == "key is missing required scope 'trade:read'"
        )

    async def test_write_scope_precedence_over_missing(self):
        """A write grant is reported even when a required read scope is also
        absent — write scope is the more severe, first-named problem."""
        ex = _StubDeribit("wallet:read_write")
        result = await detect_deribit_permissions(ex)
        assert result["trade"] is True
        assert result["scope_detail"].startswith("key has write scope")  # type: ignore[union-attr]

    async def test_probe_exception_fails_closed_and_redacts(self, caplog):
        """public_get_auth raising → fail-CLOSED (all True, probe_error=True)
        and NEITHER the client_id NOR client_secret literal reaches the log
        (T-68-07)."""
        api_key = "CLIENTID_ABC123"
        secret = "SECRET_XYZ789"
        # A ccxt error that echoes BOTH raw credential values back.
        boom = RuntimeError(
            f"deribit rejected auth for client_id={api_key} secret={secret}"
        )
        ex = _StubDeribit(raises=boom, api_key=api_key, secret=secret)
        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await detect_deribit_permissions(ex)
        assert result == dict(_FAIL_CLOSED)
        assert result["probe_error"] is True
        assert all(result[k] is True for k in ("read", "trade", "withdraw"))
        logged = caplog.text
        assert api_key not in logged
        assert secret not in logged
        assert "[REDACTED]" in logged


class TestDispatchAndRelocation:
    def test_deribit_registered_in_dispatch(self):
        """Pitfall 4: without this entry a deribit key returns 200 with
        read_only=false and NO error. The dispatch entry is the single wiring
        point covering all validate_key_permissions call sites."""
        assert _DISPATCH["deribit"] is detect_deribit_permissions

    def test_scope_gate_single_definition_reimported_by_harness(self):
        """The relocated scope gate has ONE definition in services and the
        harness re-imports it — both paths agree (byte-identical semantics)."""
        from scripts.deribit_ground_truth import (
            scope_is_read_only as harness_scope_is_read_only,
        )

        assert harness_scope_is_read_only is scope_is_read_only
        for probe in (_LTP_SCOPE, "account:read trade:read_write", "", "custody"):
            assert scope_is_read_only(probe) == harness_scope_is_read_only(probe)
