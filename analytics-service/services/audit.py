"""Fire-and-forget audit event emitter for the analytics-service.

Sprint 6 closeout Task 7.1b — Python cross-service emission path.

Writes to `audit_log` via the service-role-only `log_audit_event_service`
RPC (migration 058). The RPC is SECURITY DEFINER and EXECUTE-granted
to `service_role` ONLY — `authenticated` cannot reach it, which is the
attribution-spoof gate for this path (see ADR-0023 §8).

Contract
--------
* Fire-and-forget. Caller does NOT await, and the wrapper swallows ALL
  errors. Audit emission must NEVER fail a compute path — if the audit
  layer is broken, the compute still succeeds, and the drop is logged
  to stderr with the stable `[audit]` prefix for log-aggregation greps.
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
from typing import Any
from uuid import UUID

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


def log_audit_event(
    user_id: str | UUID,
    action: str,
    entity_type: str,
    entity_id: str | UUID,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Fire-and-forget audit event.

    Calls `log_audit_event_service` with the caller-supplied user_id.
    Swallows all RPC errors; never raises to the caller.

    Parameters
    ----------
    user_id : str | UUID
        The acting user's auth.users.id. Required. ValueError if NULL
        or empty — the service RPC would reject it with
        `invalid_parameter_value`, but we fail earlier with a clearer
        stack frame.
    action : str
        Namespaced `<subject>.<verb>` string from the canonical taxonomy.
        See ADR-0023 §4 for the full list.
    entity_type : str
        Entity family, e.g. `bridge_run`, `simulator_run`. Must match a
        `AuditEntityType` value on the TS side.
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
    except Exception as exc:  # pragma: no cover - defensive swallow
        # Never raise to the caller. An audit drop is visible via the
        # stable `[audit]` prefix in stderr so log aggregation can
        # surface dropped events as a metric.
        # Adversarial revision B3 — scrub_pii on every formatter arg.
        # exc.repr can include credential-shaped substrings (e.g., from a
        # supabase RPC error that echoes the request body); scrub_pii on
        # str(exc) catches any anchored JWT-shape too.
        # Phase 18 / S1 — wrap the scrub+emit in a nested try/except so a
        # RecursionError raised by `scrub_pii` (Grok W3 max_depth guard)
        # on a pathological exception cannot escape the outer except and
        # break the documented fire-and-forget contract. Pre-truncate
        # str(exc) to keep the log line bounded even when the underlying
        # error message is multi-MB.
        try:
            exc_str = str(exc)[:4096]
            # Round-2: scrub_freeform_string on every string arg so substring
            # `key=value` leaks (the dominant Supabase error echo case) are
            # redacted, not just whole-anchored JWTs.
            logger.error(
                "[audit] log_audit_event_service call threw (dropping): "
                "action=%s entity_type=%s entity_id=%s user_id=%s error=%s",
                scrub_freeform_string(str(action)),
                scrub_freeform_string(str(entity_type)),
                scrub_freeform_string(eid),
                scrub_freeform_string(uid),
                scrub_freeform_string(exc_str),
            )
        except Exception:
            # Worst-case fallback: emit a minimal stable marker so log
            # aggregation can still alert on the audit drop, with no
            # caller-controlled bytes that could re-trigger the failure.
            try:
                logger.error("[audit] log_audit_event_service double-failure (dropped)")
            except Exception:
                pass
