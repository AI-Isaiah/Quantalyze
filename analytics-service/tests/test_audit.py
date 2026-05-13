"""Unit tests for analytics-service/services/audit.py.

Sprint 6 closeout Task 7.1b — the fire-and-forget contract for the
Python cross-service audit emitter.

audit-2026-05-07 P907 + P908 superseded the blanket swallow-all contract.
The current contract is typed-exception dispatch:
  - permission_denied (SQLSTATE 42501) → re-raise (hard error).
  - httpx transient (Timeout / NetworkError / RemoteProtocolError) →
    Sentry + log + swallow.
  - anything else → Sentry + log + re-raise.

The new contract is fully covered by `test_audit_emit.py`. This file
keeps the orthogonal invariants:
  1. Happy path calls `log_audit_event_service` with the expected shape.
  2. NULL / empty user_id is caught at the Python layer (before the
     RPC) — nothing hits the wire and the log message is scrubbed.
  3. `metadata=None` default is normalized to `{}` on the RPC call.
  4. Payload scrubbing — `p_metadata` is redacted before the wire.
"""

from __future__ import annotations

import logging
from unittest.mock import MagicMock, patch

import pytest

from services import audit as audit_module
from services.audit import log_audit_event

DUMMY_USER = "00000000-0000-0000-0000-000000000001"
DUMMY_ENTITY = "00000000-0000-0000-0000-0000000000a0"


def _mock_supabase_with_rpc() -> tuple[MagicMock, MagicMock]:
    """Build a fake supabase client whose `.rpc(...).execute()` is mockable.

    Returns (supabase_client, rpc_method) so tests can assert on the rpc
    call args directly. The supabase-py shape is
    `supabase.rpc(name, params).execute()`, so we return a double that
    chains correctly.
    """
    execute_mock = MagicMock(return_value=MagicMock(data=None, error=None))
    rpc_result = MagicMock(execute=execute_mock)
    rpc_method = MagicMock(return_value=rpc_result)
    supabase = MagicMock(rpc=rpc_method)
    return supabase, rpc_method


class TestLogAuditEventHappyPath:
    def test_calls_rpc_with_expected_shape(self, monkeypatch):
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        log_audit_event(
            user_id=DUMMY_USER,
            action="bridge.score_candidates",
            entity_type="bridge_run",
            entity_id=DUMMY_ENTITY,
            metadata={"candidate_count": 5},
        )

        rpc.assert_called_once_with(
            "log_audit_event_service",
            {
                "p_user_id": DUMMY_USER,
                "p_action": "bridge.score_candidates",
                "p_entity_type": "bridge_run",
                "p_entity_id": DUMMY_ENTITY,
                "p_metadata": {"candidate_count": 5},
            },
        )

    def test_metadata_defaults_to_empty_dict(self, monkeypatch):
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        log_audit_event(
            user_id=DUMMY_USER,
            action="simulator.run",
            entity_type="simulator_run",
            entity_id=DUMMY_ENTITY,
        )

        call_args = rpc.call_args[0]
        assert call_args[1]["p_metadata"] == {}

    def test_coerces_uuid_to_str(self, monkeypatch):
        """supabase-py accepts UUID objects but normalizing to str now
        means the payload is JSON-serializable even when metadata carries
        non-str fields downstream."""
        from uuid import UUID

        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        uid_obj = UUID(DUMMY_USER)
        eid_obj = UUID(DUMMY_ENTITY)
        log_audit_event(
            user_id=uid_obj,
            action="reconcile.compare",
            entity_type="reconcile_run",
            entity_id=eid_obj,
        )

        call_args = rpc.call_args[0]
        assert call_args[1]["p_user_id"] == DUMMY_USER
        assert call_args[1]["p_entity_id"] == DUMMY_ENTITY

    def test_returns_none_not_awaitable(self, monkeypatch):
        supabase, _rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        result = log_audit_event(
            user_id=DUMMY_USER,
            action="optimizer.run",
            entity_type="optimizer_run",
            entity_id=DUMMY_ENTITY,
        )
        assert result is None


# NOTE — `TestLogAuditEventSwallowsErrors` was removed as part of the
# audit-2026-05-07 P907 + P908 fix. The blanket swallow-all contract
# the class encoded is no longer correct; only httpx-transient errors
# are swallowed, and the typed-dispatch path is covered exhaustively in
# `test_audit_emit.py` (TestPermissionDeniedReRaises,
# TestTransientNetworkErrorsAreCapturedAndCounted,
# TestUnexpectedExceptionReRaises).


class TestLogAuditEventNullGuards:
    def test_none_user_id_logs_and_returns_without_rpc_call(
        self, monkeypatch, caplog
    ):
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
            log_audit_event(
                user_id=None,  # type: ignore[arg-type]
                action="bridge.score_candidates",
                entity_type="bridge_run",
                entity_id=DUMMY_ENTITY,
            )

        # RPC must NOT be called when user_id is None.
        rpc.assert_not_called()
        assert any(
            "NULL user_id" in rec.getMessage() for rec in caplog.records
        )

    def test_empty_string_user_id_logs_and_returns_without_rpc_call(
        self, monkeypatch, caplog
    ):
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
            log_audit_event(
                user_id="",
                action="bridge.score_candidates",
                entity_type="bridge_run",
                entity_id=DUMMY_ENTITY,
            )

        rpc.assert_not_called()
        assert any(
            "empty user_id" in rec.getMessage() for rec in caplog.records
        )


# ---------------------------------------------------------------------------
# Phase 18 / FIX-04 — Adversarial revision B3 + redact wire-up.
# audit.py uses stdlib `logging.getLogger("quantalyze.audit")` (NOT structlog),
# so the structlog processor pipeline does NOT cover its `logger.error` calls.
# Every formatter argument MUST pass through services.redact.scrub_pii directly.
# ---------------------------------------------------------------------------


class TestAuditPayloadScrubbed:
    """The RPC payload (`p_metadata`) must be scrubbed BEFORE the wire."""

    def test_audit_payload_scrubbed(self, monkeypatch):
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        log_audit_event(
            user_id=DUMMY_USER,
            action="bridge.score_candidates",
            entity_type="bridge_run",
            entity_id=DUMMY_ENTITY,
            metadata={"api_key": "leaky-key-AAA", "safe": "ok"},
        )

        call_args = rpc.call_args[0]
        sent_payload = call_args[1]["p_metadata"]
        # api_key MUST be redacted before the RPC executes.
        assert sent_payload["api_key"] == "[REDACTED]"
        # Non-sensitive fields preserved.
        assert sent_payload["safe"] == "ok"

    def test_audit_payload_scrubbed_nested(self, monkeypatch):
        """Nested credentials inside metadata are also redacted (recursive)."""
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        log_audit_event(
            user_id=DUMMY_USER,
            action="bridge.score_candidates",
            entity_type="bridge_run",
            entity_id=DUMMY_ENTITY,
            metadata={
                "broker": "okx",
                "creds": {"api_secret": "leaky", "passphrase": "leaky2"},
            },
        )

        call_args = rpc.call_args[0]
        sent = call_args[1]["p_metadata"]
        assert sent["broker"] == "okx"
        assert sent["creds"]["api_secret"] == "[REDACTED]"
        assert sent["creds"]["passphrase"] == "[REDACTED]"


class TestLoggerErrorScrubsPiiMetadata:
    """Adversarial revision 2026-05-06: B3 — every `logger.error` formatter arg
    in audit.py passes through scrub_pii before the message hits stderr.

    Three audit.py callsites are covered:
      1. NULL user_id branch (line ~88)
      2. Empty user_id branch (line ~100)
      3. RPC-throw branch (line ~125)
    """

    def test_null_user_id_action_arg_is_scrubbed(self, monkeypatch, caplog):
        # Inject a JWT-shaped action string — scrub_pii on a JWT-shape returns
        # the redaction token, proving the formatter arg passes through scrub_pii.
        jwt = "aaaaaaaaaa.bbbbbbbbbb.cccccccccc"
        supabase, _rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
            log_audit_event(
                user_id=None,  # type: ignore[arg-type]
                action=jwt,
                entity_type="bridge_run",
                entity_id=DUMMY_ENTITY,
            )

        msg = caplog.records[0].getMessage()
        assert jwt not in msg, f"raw JWT leaked into log message: {msg!r}"
        assert "[REDACTED_JWT]" in msg or "[REDACTED]" in msg

    def test_empty_user_id_action_arg_is_scrubbed(self, monkeypatch, caplog):
        jwt = "ddddddddd0.eeeeeeeeee.ffffffffff"
        supabase, _rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
            log_audit_event(
                user_id="",
                action=jwt,
                entity_type="bridge_run",
                entity_id=DUMMY_ENTITY,
            )

        msg = caplog.records[0].getMessage()
        assert jwt not in msg, f"raw JWT leaked into log message: {msg!r}"
        assert "[REDACTED_JWT]" in msg or "[REDACTED]" in msg

    def test_rpc_throw_branch_scrubs_args(self, monkeypatch, caplog):
        # When the RPC call throws an UNEXPECTED exception, the wrapper now
        # logs + Sentry-captures + re-raises (audit-2026-05-07 P907 + P908).
        # The log line emitted before the re-raise must still scrub PII in
        # every formatter arg (action/entity_type/entity_id/user_id/exc).
        jwt_action = "1234567890.0987654321.abcdefghij"
        rpc_method = MagicMock(side_effect=RuntimeError("network down"))
        supabase = MagicMock(rpc=rpc_method)
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
            with pytest.raises(RuntimeError):
                log_audit_event(
                    user_id=DUMMY_USER,
                    action=jwt_action,
                    entity_type="bridge_run",
                    entity_id=DUMMY_ENTITY,
                )

        msg = caplog.records[-1].getMessage()
        assert jwt_action not in msg, f"raw JWT leaked: {msg!r}"
        assert "[REDACTED_JWT]" in msg or "[REDACTED]" in msg
        # Confirm we hit the RPC-throw branch.
        assert "log_audit_event_service call threw" in msg

    # Phase 18 / round-2 red team — `scrub_pii` on a non-JWT string is a
    # no-op; only `scrub_freeform_string` redacts substring `key=value` shapes.
    # The B3 commit originally used `scrub_pii(str(exc))` and was operationally
    # silent on the dominant Supabase-error-echo case. The cases below pin the
    # post-fix behavior.
    def test_rpc_throw_substring_leak_redacted(self, monkeypatch, caplog):
        """Supabase RPC error that echoes a `key=value` substring (NOT a JWT
        shape) must be redacted. This was leaking under the old `scrub_pii`
        wrapper that only matched whole-anchored JWTs. Under
        audit-2026-05-07 P907 + P908, an unexpected RuntimeError now
        re-raises after logging — the scrub of the log line still applies."""
        leaky_msg = "request body: {'metadata': 'api_key=PROD_LEAK_VALUE_42 ok'}"
        rpc_method = MagicMock(side_effect=RuntimeError(leaky_msg))
        supabase = MagicMock(rpc=rpc_method)
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
            with pytest.raises(RuntimeError):
                log_audit_event(
                    user_id=DUMMY_USER,
                    action="bridge.run",
                    entity_type="bridge_run",
                    entity_id=DUMMY_ENTITY,
                )

        msg = caplog.records[-1].getMessage()
        assert "PROD_LEAK_VALUE_42" not in msg, (
            f"substring api_key=value leaked: {msg!r}"
        )
        assert "[REDACTED]" in msg
        assert "log_audit_event_service call threw" in msg

    def test_null_user_id_substring_leak_redacted(self, monkeypatch, caplog):
        """The NULL user_id branch logs `action` raw via formatter — a caller
        passing an action string with a `passphrase=value` substring must be
        redacted (e.g. a misuse where the caller stuffed credentials into
        action by mistake)."""
        supabase, _rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        leaky_action = "bridge.run passphrase=NULLBRANCH_LEAK_VALUE_99"
        with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
            log_audit_event(
                user_id=None,  # type: ignore[arg-type]
                action=leaky_action,
                entity_type="bridge_run",
                entity_id=DUMMY_ENTITY,
            )

        msg = caplog.records[0].getMessage()
        assert "NULLBRANCH_LEAK_VALUE_99" not in msg, (
            f"NULL-branch substring leaked: {msg!r}"
        )
        assert "[REDACTED]" in msg
