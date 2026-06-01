"""Fire-and-forget audit event emitter for the analytics-service.

Sprint 6 closeout Task 7.1b — Python cross-service emission path.

Writes to `audit_log` via the service-role-only `log_audit_event_service`
RPC (migration 058). The RPC is SECURITY DEFINER and EXECUTE-granted
to `service_role` ONLY — `authenticated` cannot reach it, which is the
attribution-spoof gate for this path (see ADR-0023 §8).

Contract
--------
* Fire-and-forget for transient infra errors only. Caller does NOT
  await. audit-2026-05-07 P907 + P908 promoted the wrapper from a
  blanket-swallow to typed-exception dispatch:
    - PostgREST APIError code 42501 (permission_denied) → re-raises.
      An auth regression that breaks the audit trail is never benign.
    - httpx network/timeout errors → captured to Sentry with
      `tag('audit_emit_transient'='true')` and `level='error'`,
      counter `audit_emit_transient_failures_total` increments, then
      swallowed so the parent compute path keeps running on a
      Railway blip.
    - Anything else → captured to Sentry + log + re-raises per
      Rule 12 (fail-loud).
  The drop is logged to stderr with the stable `[audit]` prefix for
  log-aggregation greps, and every branch carries `branch=<name>` so
  log aggregation can pivot on the classification.
* `user_id` is required (raises ValueError early — before the RPC —
  if NULL). The RPC itself would raise `invalid_parameter_value`, but
  we catch it at the Python layer so the stderr log is clearer and
  there's no masked-exception path through the RPC.
* Synchronous supabase-py call dispatched inside the caller's thread.
  No asyncio.to_thread indirection — the service-role client is
  thread-safe and this is a single RPC round trip; the overhead of
  to_thread is higher than the RPC for a sub-1ms operation.

Typical call site
-----------------
    from services.audit import log_audit_event

    # ... portfolio_bridge computes candidates ...
    log_audit_event(
        user_id=req.user_id,
        action="bridge.score_candidates",
        entity_type="bridge_run",
        entity_id=req.portfolio_id,
        metadata={
            "underperformer_strategy_id": req.underperformer_strategy_id,
            "candidate_count": len(candidates),
        },
    )
    return response

The call returns `None`. Do not await it.
"""

from __future__ import annotations

import logging
from typing import Any, Literal
from uuid import UUID

import httpx
import sentry_sdk
from postgrest.exceptions import APIError

from services.db import get_supabase
# Phase 18 / FIX-04 — Adversarial revision B3:
# Every logger.error formatter argument in this file passes through the
# canonical redactor BECAUSE stdlib logging.Logger.error does NOT run
# through the structlog processor pipeline (only structlog.get_logger() does).
# Without this, action / entity_id / exc strings can leak credential-shaped
# values into Railway stderr -> log aggregation -> Sentry breadcrumbs.
#
# String args use `scrub_freeform_string` (4-pass: SENSITIVE_KEY_VALUE +
# JWT_SHAPE + JWT_SUBSTRING + transitive re-walk) NOT `scrub_pii`. The latter
# is an object walker — on a non-JWT string it's a no-op, so a Supabase RPC
# error echoing `Bearer api_key=PROD_KEY...` would have leaked verbatim. The
# round-2 red team caught this in the first commit's `scrub_pii(str(exc))`
# pattern; switching to `scrub_freeform_string` redacts substring `key=value`
# shapes that the canonical denylist covers.
#
# The RPC payload (p_metadata) stays on `scrub_pii` because it IS a dict —
# the object-walker contract is correct there.
from services.redact import scrub_pii, scrub_freeform_string

logger = logging.getLogger("quantalyze.audit")


# audit-2026-05-07 P907 + P908 — module-level metric counter for transient
# audit-emit failures. The analytics-service does NOT currently bundle a
# prometheus_client / OpenTelemetry exporter; introducing one is out of
# scope for this hotfix. A module-level int gives:
#   * a single, stable name that log aggregation can alert on via stderr
#     grep (the [audit] prefix already pipes to Railway),
#   * a deterministic hook for unit tests to assert the counter incremented
#     on the transient branch,
#   * a forward-compatible surface — once prometheus_client lands service-
#     wide, replace this with a Counter() with no behavior change at the
#     call site.
audit_emit_transient_failures_total: int = 0


# audit-2026-05-07 P907 + P908 — PostgreSQL SQLSTATE 42501 is permission_denied
# (raised when an RLS policy or GRANT denies a service-role call). The
# postgrest-py APIError carries this code on `.code` when it surfaces a
# server-side denial. We re-raise on this class because:
#   * a permission_denied on an audit emit is a hard error — the service-
#     role context lost its privileges, or the RPC was renamed/dropped,
#   * silently swallowing it hides an auth regression that breaks the
#     ENTIRE audit trail (every emit drops), which is precisely the
#     observability blackhole P907 + P908 graded CRITICAL.
_SQLSTATE_PERMISSION_DENIED = "42501"
_SQLSTATE_INSUFFICIENT_PRIVILEGE_CLASS = "42"  # Class 42 — Syntax Error or Access Rule Violation


# audit-2026-05-07 H-0656 / H-0657 / M-0660 (type-design + code-simplifier c9) —
# Mirror the canonical TS audit taxonomy into the Python emitter so a typo'd
# action / entity_type fails type-check instead of silently writing garbage to
# audit_log (UPDATE/DELETE on audit_log are revoked by migration 049, so a bad
# row survives indefinitely).
#
# The TS source of truth is `src/lib/audit.ts` — `AuditAction` and
# `AuditEntityType` string-literal unions. These Python `Literal[...]` aliases
# are kept byte-for-byte in sync with that file; the regression test
# `TestAuditTaxonomySyncWithTypeScript` in tests/test_audit.py parses
# src/lib/audit.ts and asserts the two vocabularies match, so a one-sided edit
# (add to TS, forget Python, or vice versa) fails the suite.
#
# There is no mypy gate on this file in CI, so the annotations alone have no
# runtime teeth — the sync test is what makes the contract enforceable: it
# fails loudly the moment the canonical TS list and this list diverge.
AuditAction = Literal[
    # --- 7.1a pilot ---------------------------------------------------------
    "api_key.decrypt",
    "intro.send",
    "intro.resend_noop",
    "intro.send_failed",
    "deletion.request.create",
    # --- 7.2 RBAC -----------------------------------------------------------
    "role.grant",
    "role.revoke",
    "role.state_observed",
    "role.revoke_noop",
    # --- 7.3 GDPR workflow --------------------------------------------------
    "account.sanitize",
    "account.export",
    "account.export_refused",
    "account.export_rate_limited",
    "account.export_resigned",
    "deletion.request.approve",
    "deletion.request.reject",
    # --- 7.1b TS fanout -----------------------------------------------------
    "allocation.update",
    "contact_request.status_change",
    "portfolio_document.create",
    "alert.acknowledge",
    "allocator.approve",
    "manager.approve",
    "notification_preferences.update",
    "attestation.accept",
    "user_note.portfolio.update",
    "user_note.holding.update",
    "user_note.bridge_outcome.update",
    "user_note.strategy.update",
    "admin.kill_switch",
    "match.decision_record",
    "match.decision_delete",
    "strategy.delete",
    "strategy.approve",
    "strategy.reject",
    "api_key.revoke",
    "trades.upload",
    "admin.partner_import",
    # --- /review follow-up (T4-C1 + T4-M6) ----------------------------------
    "lead.process",
    "lead.unprocess",
    "sync.start",
    # --- 7.1b Python cross-service (via log_audit_event_service) ------------
    "bridge.score_candidates",
    "simulator.run",
    # routers/simulator.py failure-path emit. The action column is free-text
    # TEXT (no DB CHECK/enum), so this row is already written in prod; it was
    # simply absent from this Literal. Python-only emit — the TS mirror in
    # src/lib/audit.ts has no matching member because Next.js never raises it.
    "simulator.run.failed",
    "optimizer.run",
    "reconcile.compare",
    # --- Bridge outcome tracker ---------------------------------------------
    "bridge_outcome.record",
    "bridge_outcome.update",
    "bridge_outcome.dismiss",
    # --- Sprint 8 Phase 2: Mandate profile builder -------------------------
    "mandate_preference.update",
    "mandate_preference.admin_update",
    # --- Sprint 8 Phase 4: Feedback loop ------------------------------------
    "feedback.overrides_updated",
    # --- Phase 06: allocator API ingestion (INGEST-05 / -06 / -07) — D-18 ---
    "allocator.holdings.sync_requested",
    "allocator.holdings.sync_completed",
    "allocator.holdings.sync_failed",
    # --- Phase 16 / OBSERV-07: admin-gated diagnostic SSE endpoint ----------
    "debug_key_flow.invoke",
    # --- audit-2026-05-07 P700: break-glass ADMIN_EMAIL fallback grant ------
    "admin.access.via_env_email_fallback",
    # --- audit-2026-05-07 (admin-auth cluster): /api/admin/* probe anchor ---
    "admin.access.denied",
]

AuditEntityType = Literal[
    # --- 7.1a / 7.2 / 7.3 ---------------------------------------------------
    "api_key",
    "contact_request",
    "data_deletion_request",
    "user_app_role",
    "user",
    # --- 7.1b fanout entities -----------------------------------------------
    "allocation",
    "portfolio_document",
    "alert",
    "system_flag",
    "match_decision",
    "strategy",
    "partner_import",
    "user_note",
    "investor_attestation",
    "trades_upload",
    # --- /review follow-up (T4-C1 + T4-M6) ----------------------------------
    "for_quants_lead",
    "sync",
    # --- 7.1b Python cross-service entities ---------------------------------
    "bridge_run",
    "simulator_run",
    "optimizer_run",
    "reconcile_run",
    # --- Bridge outcome tracker ---------------------------------------------
    "bridge_outcome",
    "bridge_outcome_dismissal",
    # --- Sprint 8 Phase 2: Mandate profile builder -------------------------
    "allocator_preference_mandate",
    # --- Sprint 8 Phase 4: Feedback loop ------------------------------------
    "allocator_preference_feedback",
    # --- Phase 16 / OBSERV-07: admin-gated diagnostic SSE endpoint ----------
    "debug_session",
]


def _is_permission_denied(exc: BaseException) -> bool:
    """Return True iff `exc` is a PostgREST APIError signaling auth denial.

    Matches on the canonical SQLSTATE 42501 (`insufficient_privilege`). The
    APIError shape is `{message, code, hint, details}`; `code` is the
    SQLSTATE string. We deliberately do NOT match on substrings of
    `message` because Supabase error messages localize and the SQLSTATE
    is the only stable handle.
    """
    if not isinstance(exc, APIError):
        return False
    code = getattr(exc, "code", None)
    if code == _SQLSTATE_PERMISSION_DENIED:
        return True
    # Defensive: some postgrest versions stash the SQLSTATE inside a `details`
    # dict on the APIError; check both surfaces. Never re-raise on a non-string
    # code — the int 42501 from a future schema would slip past.
    details = getattr(exc, "details", None)
    if isinstance(details, dict) and details.get("code") == _SQLSTATE_PERMISSION_DENIED:
        return True
    return False


def _is_transient_network_error(exc: BaseException) -> bool:
    """Return True iff `exc` looks like a transient infra blip.

    Covered classes:
      * httpx.TimeoutException     — read/connect/pool/write timeouts
      * httpx.NetworkError         — connect/read/write/close errors
      * httpx.RemoteProtocolError  — server hung up mid-response
      * ConnectionError            — stdlib base class (covers cases where
                                     postgrest-py wraps the underlying
                                     httpx error and re-raises a stdlib
                                     ConnectionError).
      * TimeoutError               — stdlib timeout (defensive)

    These are infra-level. Re-raising on them would convert a Railway
    network blip into a worker crash, which is worse than dropping the
    audit emit (the compute path must keep running per the
    fire-and-forget contract). Per P907 + P908 they capture to Sentry
    with `level='error'` so we have visibility without breaking the
    parent flow.
    """
    return isinstance(
        exc,
        (
            httpx.TimeoutException,
            httpx.NetworkError,
            httpx.RemoteProtocolError,
            ConnectionError,
            TimeoutError,
        ),
    )


def log_audit_event(
    user_id: str | UUID,
    action: AuditAction,
    entity_type: AuditEntityType,
    entity_id: str | UUID,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Fire-and-forget audit event.

    Calls `log_audit_event_service` with the caller-supplied user_id.
    audit-2026-05-07 P907 + P908: re-raises permission_denied
    (SQLSTATE 42501) and unrecognized exceptions; swallows only
    transient httpx network/timeout errors (which capture to Sentry
    and increment `audit_emit_transient_failures_total`).

    Parameters
    ----------
    user_id : str | UUID
        The acting user's auth.users.id. Required. ValueError if NULL
        or empty — the service RPC would reject it with
        `invalid_parameter_value`, but we fail earlier with a clearer
        stack frame.
    action : AuditAction
        Namespaced `<subject>.<verb>` literal from the canonical taxonomy
        (`AuditAction`). Mirrors the TS `AuditAction` union in
        `src/lib/audit.ts`; a value outside the union is a type error.
        See ADR-0023 §4 for the full list.
    entity_type : AuditEntityType
        Entity family literal (`AuditEntityType`), e.g. `bridge_run`,
        `simulator_run`. Mirrors the TS `AuditEntityType` union in
        `src/lib/audit.ts`.
    entity_id : str | UUID
        The row id the action acted on. Usually the portfolio id for
        bridge/simulator/optimizer, the strategy id for reconcile.
    metadata : dict, optional
        JSON-serializable payload. Defaults to {}.
    """
    if user_id is None:
        # Adversarial revision B3 + round-2: scrub_freeform_string on every
        # string arg so substring `key=value` leaks are redacted, not just
        # whole-anchored JWTs.
        logger.error(
            "[audit] log_audit_event called with NULL user_id (dropping): "
            "action=%s entity_type=%s entity_id=%s",
            scrub_freeform_string(str(action)),
            scrub_freeform_string(str(entity_type)),
            scrub_freeform_string(str(entity_id)),
        )
        return

    # Coerce to string for the RPC call. supabase-py handles UUID objects
    # but JSON-serializing a UUID in metadata requires str(). Normalize
    # now so the RPC args are uniform.
    uid = str(user_id)
    if not uid or uid == "None":
        # Adversarial revision B3 + round-2: scrub_freeform_string on action.
        logger.error(
            "[audit] log_audit_event called with empty user_id (dropping): "
            "action=%s", scrub_freeform_string(str(action)),
        )
        return

    eid = str(entity_id)
    # Phase 18 / FIX-04 — scrub the metadata payload BEFORE the RPC executes.
    # Defense-in-depth: the audit_log table's p_metadata column should never
    # land credential-shaped data even if a future caller accidentally posts
    # it. scrub_pii on a None-defaulted-to-{} payload is safe (returns {}).
    raw_payload = metadata if metadata is not None else {}
    payload = scrub_pii(raw_payload)

    try:
        supabase = get_supabase()
        supabase.rpc(
            "log_audit_event_service",
            {
                "p_user_id": uid,
                "p_action": action,
                "p_entity_type": entity_type,
                "p_entity_id": eid,
                "p_metadata": payload,
            },
        ).execute()
    except Exception as exc:
        # audit-2026-05-07 P907 + P908 — typed exception dispatch.
        #
        # The old behavior was a blanket-swallow that logged to stderr and
        # returned. That hid three operationally distinct failure classes:
        #   1. permission_denied (auth regression — re-raise, hard error).
        #   2. transient network errors (Railway blip — Sentry + metric,
        #      do NOT re-raise so the parent compute path keeps running
        #      per the fire-and-forget contract).
        #   3. anything else (unknown — Sentry + log + re-raise per
        #      Rule 12, fail-loud).
        #
        # Sentry capture is wrapped in try/except because sentry_sdk can
        # itself raise during transport setup (DSN misconfigured, network
        # down before the SDK connected). A Sentry failure must never
        # mask the original exception we want to surface; it must also
        # never crash the worker.
        #
        # Phase 18 / S1 inheritance — the scrub+emit block is wrapped in
        # a nested try/except so a RecursionError from scrub_pii
        # (max_depth guard) on a pathological exception cannot break the
        # documented contract.
        if _is_permission_denied(exc):
            # Branch 1 — hard error. Re-raise after capture + log.
            try:
                sentry_sdk.set_tag("audit_emit_permission_denied", "true")
                sentry_sdk.capture_exception(exc)
            except Exception:
                pass  # never mask the original exception via Sentry failure
            _log_audit_throw(action, entity_type, eid, uid, exc, branch="permission_denied")
            raise

        if _is_transient_network_error(exc):
            # Branch 2 — transient infra blip. Capture + metric, no re-raise.
            global audit_emit_transient_failures_total
            audit_emit_transient_failures_total += 1
            try:
                sentry_sdk.set_tag("audit_emit_transient", "true")
                sentry_sdk.capture_exception(exc, level="error")
            except Exception:
                pass
            _log_audit_throw(action, entity_type, eid, uid, exc, branch="transient")
            return

        # Branch 3 — unknown. Capture + log + re-raise (fail-loud).
        try:
            sentry_sdk.set_tag("audit_emit_unexpected", "true")
            sentry_sdk.capture_exception(exc)
        except Exception:
            pass
        _log_audit_throw(action, entity_type, eid, uid, exc, branch="unexpected")
        raise


def _log_audit_throw(
    action: AuditAction,
    entity_type: AuditEntityType,
    eid: str,
    uid: str,
    exc: BaseException,
    branch: str,
) -> None:
    """Emit the canonical `[audit] log_audit_event_service call threw` line.

    Centralized so all three branches of `emit()` log the same shape (and
    test fixtures match on the same substring). Every formatter arg passes
    through the freeform-string scrubber per the Phase 18 / FIX-04 leak
    audit (B3 + round-2 substring redaction).

    The whole emit is wrapped in try/except so a RecursionError or
    serializer bug inside scrub_freeform_string cannot escape and break
    the caller's exception-handling contract (re-raise on hard errors,
    return on transient).
    """
    try:
        exc_str = str(exc)[:4096]
        logger.error(
            "[audit] log_audit_event_service call threw (branch=%s): "
            "action=%s entity_type=%s entity_id=%s user_id=%s error=%s",
            scrub_freeform_string(branch),
            scrub_freeform_string(str(action)),
            scrub_freeform_string(str(entity_type)),
            scrub_freeform_string(eid),
            scrub_freeform_string(uid),
            scrub_freeform_string(exc_str),
        )
    except Exception:
        try:
            logger.error("[audit] log_audit_event_service double-failure (dropped)")
        except Exception:
            pass
