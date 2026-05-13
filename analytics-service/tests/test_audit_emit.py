"""Unit tests for services.audit P907 + P908 typed-exception dispatch.

audit-2026-05-07 — the old emit() blanket-swallowed every exception and
only logged to stderr. This hid an entire class of operational failures
(permission_denied means the audit trail is fully dead; transient infra
blips were also indistinguishable from real bugs).

This file pins the post-fix behavior:

  Branch                       | Sentry capture | Metric | Re-raise?
  -----------------------------|----------------|--------|----------
  postgrest APIError code 42501| yes (tag set)  | no     | YES
  httpx.TimeoutException       | yes (tag set,  | yes    | NO
                                 level=error)
  httpx.NetworkError           | yes (tag set,  | yes    | NO
                                 level=error)
  ConnectionError (stdlib)     | yes            | yes    | NO
  RuntimeError / anything else | yes (tag set)  | no     | YES

The three branches are NEVER allowed to drop silently — every one of them
must surface via Sentry (so observability picks it up) and re-raise OR
increment the transient counter (so log aggregation has a stable metric).

Each test below FAILS against the pre-P907 code because the pre-P907
emit() used `except Exception` with no dispatch — every branch logged
and returned None. With the post-fix dispatch, the assertions on
re-raise and on the counter increment hold.
"""

from __future__ import annotations

import logging
from unittest.mock import MagicMock, patch

import httpx
import pytest
from postgrest.exceptions import APIError

from services import audit as audit_module
from services.audit import log_audit_event

DUMMY_USER = "00000000-0000-0000-0000-000000000001"
DUMMY_ENTITY = "00000000-0000-0000-0000-0000000000a0"


def _mock_supabase_raising(exc: BaseException) -> MagicMock:
    """Build a supabase client whose `.rpc(...).execute()` raises `exc`."""
    execute_mock = MagicMock(side_effect=exc)
    rpc_result = MagicMock(execute=execute_mock)
    rpc_method = MagicMock(return_value=rpc_result)
    return MagicMock(rpc=rpc_method)


@pytest.fixture(autouse=True)
def _reset_metric() -> None:
    """Reset the module-level transient-failure counter before each test.

    Tests assert on absolute counter values; without this reset they would
    leak state across the file.
    """
    audit_module.audit_emit_transient_failures_total = 0
    yield
    audit_module.audit_emit_transient_failures_total = 0


# ---------------------------------------------------------------------------
# Branch 1: PostgREST permission_denied (SQLSTATE 42501) → re-raise.
#
# This is the audit-trail-blackhole case P907 + P908 flagged. The old code
# swallowed it; the new code re-raises so the caller (and Sentry) see the
# auth regression immediately.
# ---------------------------------------------------------------------------


class TestPermissionDeniedReRaises:
    def test_apierror_42501_reraises(self, monkeypatch):
        denial = APIError(
            {
                "message": "permission denied for function log_audit_event_service",
                "code": "42501",
                "hint": None,
                "details": None,
            }
        )
        monkeypatch.setattr(
            audit_module, "get_supabase", lambda: _mock_supabase_raising(denial)
        )

        with patch.object(audit_module.sentry_sdk, "capture_exception") as cap, \
             patch.object(audit_module.sentry_sdk, "set_tag") as tag:
            with pytest.raises(APIError):
                log_audit_event(
                    user_id=DUMMY_USER,
                    action="bridge.score_candidates",
                    entity_type="bridge_run",
                    entity_id=DUMMY_ENTITY,
                )

            # Sentry MUST receive the exception so observability fires.
            cap.assert_called_once_with(denial)
            # The permission_denied tag is set so Sentry filters on this branch.
            tag.assert_any_call("audit_emit_permission_denied", "true")

    def test_apierror_42501_does_not_increment_transient_metric(self, monkeypatch):
        """permission_denied is NOT a transient failure — the counter must stay 0."""
        denial = APIError({"message": "x", "code": "42501"})
        monkeypatch.setattr(
            audit_module, "get_supabase", lambda: _mock_supabase_raising(denial)
        )

        with patch.object(audit_module.sentry_sdk, "capture_exception"), \
             patch.object(audit_module.sentry_sdk, "set_tag"):
            with pytest.raises(APIError):
                log_audit_event(
                    user_id=DUMMY_USER,
                    action="bridge.score_candidates",
                    entity_type="bridge_run",
                    entity_id=DUMMY_ENTITY,
                )

        assert audit_module.audit_emit_transient_failures_total == 0


# ---------------------------------------------------------------------------
# Branch 2: transient network errors → Sentry + metric + NO re-raise.
#
# The fire-and-forget contract holds for these because they're infra-level
# (the audit emit is best-effort, the compute path keeps running).
# ---------------------------------------------------------------------------


class TestTransientNetworkErrorsAreCapturedAndCounted:
    @pytest.mark.parametrize(
        "exc",
        [
            httpx.ReadTimeout("read timed out"),
            httpx.ConnectTimeout("connect timed out"),
            httpx.PoolTimeout("pool exhausted"),
            httpx.ConnectError("connection refused"),
            httpx.ReadError("read failed"),
            httpx.RemoteProtocolError("server hung up"),
            ConnectionError("stdlib connection error"),
            TimeoutError("stdlib timeout"),
        ],
    )
    def test_transient_does_not_propagate_and_increments_counter(
        self, monkeypatch, exc
    ):
        monkeypatch.setattr(
            audit_module, "get_supabase", lambda: _mock_supabase_raising(exc)
        )

        before = audit_module.audit_emit_transient_failures_total
        with patch.object(audit_module.sentry_sdk, "capture_exception") as cap, \
             patch.object(audit_module.sentry_sdk, "set_tag") as tag:
            # No exception escapes — the contract for transient failures.
            log_audit_event(
                user_id=DUMMY_USER,
                action="bridge.score_candidates",
                entity_type="bridge_run",
                entity_id=DUMMY_ENTITY,
            )

            cap.assert_called_once_with(exc, level="error")
            tag.assert_any_call("audit_emit_transient", "true")

        after = audit_module.audit_emit_transient_failures_total
        assert after == before + 1, (
            f"transient counter must increment on {type(exc).__name__}; "
            f"before={before} after={after}"
        )

    def test_transient_logs_branch_marker(self, monkeypatch, caplog):
        """The structured log line carries the branch=transient marker so
        log aggregation can pivot on it independent of Sentry."""
        exc = httpx.ReadTimeout("read timed out")
        monkeypatch.setattr(
            audit_module, "get_supabase", lambda: _mock_supabase_raising(exc)
        )

        with patch.object(audit_module.sentry_sdk, "capture_exception"), \
             patch.object(audit_module.sentry_sdk, "set_tag"):
            with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
                log_audit_event(
                    user_id=DUMMY_USER,
                    action="bridge.score_candidates",
                    entity_type="bridge_run",
                    entity_id=DUMMY_ENTITY,
                )

        msgs = [r.getMessage() for r in caplog.records]
        assert any("branch=transient" in m for m in msgs), (
            f"missing branch=transient marker in logs: {msgs!r}"
        )
        assert any("log_audit_event_service call threw" in m for m in msgs)


# ---------------------------------------------------------------------------
# Branch 3: unexpected exceptions → Sentry + log + RE-RAISE (fail-loud).
#
# Rule 12 (project): "Completed" is wrong if anything was skipped silently.
# An unrecognized exception class means we have no validated response —
# raise so the operator finds out, instead of dropping audit events into
# the void.
# ---------------------------------------------------------------------------


class TestUnexpectedExceptionReRaises:
    def test_runtime_error_reraises(self, monkeypatch):
        exc = RuntimeError("something else entirely")
        monkeypatch.setattr(
            audit_module, "get_supabase", lambda: _mock_supabase_raising(exc)
        )

        with patch.object(audit_module.sentry_sdk, "capture_exception") as cap, \
             patch.object(audit_module.sentry_sdk, "set_tag") as tag:
            with pytest.raises(RuntimeError, match="something else entirely"):
                log_audit_event(
                    user_id=DUMMY_USER,
                    action="bridge.score_candidates",
                    entity_type="bridge_run",
                    entity_id=DUMMY_ENTITY,
                )

            cap.assert_called_once_with(exc)
            tag.assert_any_call("audit_emit_unexpected", "true")

    def test_value_error_reraises(self, monkeypatch):
        """ValueError from a misbehaving supabase-py serializer must NOT be
        masked — the operator needs the traceback."""
        exc = ValueError("bad payload")
        monkeypatch.setattr(
            audit_module, "get_supabase", lambda: _mock_supabase_raising(exc)
        )

        with patch.object(audit_module.sentry_sdk, "capture_exception"), \
             patch.object(audit_module.sentry_sdk, "set_tag"):
            with pytest.raises(ValueError, match="bad payload"):
                log_audit_event(
                    user_id=DUMMY_USER,
                    action="bridge.score_candidates",
                    entity_type="bridge_run",
                    entity_id=DUMMY_ENTITY,
                )

    def test_apierror_non_42501_reraises(self, monkeypatch):
        """A PostgREST APIError with a non-permission-denied SQLSTATE
        falls through to the unexpected branch and re-raises."""
        exc = APIError({"message": "unique violation", "code": "23505"})
        monkeypatch.setattr(
            audit_module, "get_supabase", lambda: _mock_supabase_raising(exc)
        )

        with patch.object(audit_module.sentry_sdk, "capture_exception") as cap, \
             patch.object(audit_module.sentry_sdk, "set_tag") as tag:
            with pytest.raises(APIError):
                log_audit_event(
                    user_id=DUMMY_USER,
                    action="bridge.score_candidates",
                    entity_type="bridge_run",
                    entity_id=DUMMY_ENTITY,
                )

            cap.assert_called_once_with(exc)
            tag.assert_any_call("audit_emit_unexpected", "true")


# ---------------------------------------------------------------------------
# Sentry capture failure must NOT mask the original exception (defense
# against an SDK-level bug or DSN misconfiguration during a hot incident).
# ---------------------------------------------------------------------------


class TestSentryFailureNeverMasksOriginalException:
    def test_sentry_capture_raising_does_not_swallow_permission_denied(
        self, monkeypatch
    ):
        denial = APIError({"message": "permission denied", "code": "42501"})
        monkeypatch.setattr(
            audit_module, "get_supabase", lambda: _mock_supabase_raising(denial)
        )

        def _broken_capture(*a, **k):
            raise RuntimeError("sentry transport dead")

        with patch.object(audit_module.sentry_sdk, "capture_exception", _broken_capture):
            with pytest.raises(APIError):
                log_audit_event(
                    user_id=DUMMY_USER,
                    action="bridge.score_candidates",
                    entity_type="bridge_run",
                    entity_id=DUMMY_ENTITY,
                )

    def test_sentry_capture_raising_does_not_break_transient_swallow(
        self, monkeypatch
    ):
        """For transient errors, a Sentry-side crash must NOT cause the
        original to re-raise — the fire-and-forget contract for transient
        infra blips still holds."""
        exc = httpx.ReadTimeout("read timed out")
        monkeypatch.setattr(
            audit_module, "get_supabase", lambda: _mock_supabase_raising(exc)
        )

        def _broken_capture(*a, **k):
            raise RuntimeError("sentry transport dead")

        with patch.object(audit_module.sentry_sdk, "capture_exception", _broken_capture):
            # No exception escapes despite the Sentry failure.
            log_audit_event(
                user_id=DUMMY_USER,
                action="bridge.score_candidates",
                entity_type="bridge_run",
                entity_id=DUMMY_ENTITY,
            )

        # Counter still increments — Sentry health is independent of the
        # operational metric for log aggregation.
        assert audit_module.audit_emit_transient_failures_total == 1


# ---------------------------------------------------------------------------
# Per-branch log message redaction: every branch must scrub action/error
# strings through scrub_freeform_string before stderr. Mirrors the
# Phase 18 / FIX-04 contract pinned in test_audit.py for the old path.
# ---------------------------------------------------------------------------


class TestPerBranchLogRedaction:
    def test_transient_branch_redacts_jwt_in_action(self, monkeypatch, caplog):
        jwt = "aaaaaaaaaa.bbbbbbbbbb.cccccccccc"
        exc = httpx.ReadTimeout("read timed out")
        monkeypatch.setattr(
            audit_module, "get_supabase", lambda: _mock_supabase_raising(exc)
        )

        with patch.object(audit_module.sentry_sdk, "capture_exception"), \
             patch.object(audit_module.sentry_sdk, "set_tag"):
            with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
                log_audit_event(
                    user_id=DUMMY_USER,
                    action=jwt,
                    entity_type="bridge_run",
                    entity_id=DUMMY_ENTITY,
                )

        msg = caplog.records[-1].getMessage()
        assert jwt not in msg
        assert "[REDACTED_JWT]" in msg or "[REDACTED]" in msg
