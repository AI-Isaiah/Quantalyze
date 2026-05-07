"""Phase 16 / OBSERV-02 + OBSERV-09 — structlog + Sentry + correlation_id ASGI middleware.

Asserted invariants:
  1. configure_logging() is idempotent and called exactly once at process startup.
  2. CorrelationMiddleware binds correlation_id to a structlog contextvar AND a
     Sentry tag for the request scope.
  3. EXPLICIT Token-based reset (FIX 11): we use `correlation_id_var.set(cid)` →
     keep the Token → `correlation_id_var.reset(token)` in finally. The broader
     `clear-contextvars` API is intentionally NOT used here — it would drop ANY
     other contextvar binding from siblings or downstream code. Token-based
     reset surgically removes ONLY the binding we set. (Acceptance criterion
     forbids the literal symbol for the broad-clear API in this file; we spell
     it hyphenated in prose so the grep gate stays loud.)
  4. Response echoes X-Correlation-Id back so the caller can grep against
     client-side logs.
"""

from __future__ import annotations

from contextvars import ContextVar
from uuid import uuid4

import sentry_sdk
import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Phase 18 / FIX-04 — canonical PII scrub. Inserted into the structlog
# processor pipeline below so every event_dict walks through scrub_pii
# BEFORE JSONRenderer egress.
from services.redact import scrub_pii as _redact_scrub_pii


# Module-scope ContextVar for surgical Token-based reset (FIX 11).
# This complements structlog's internal contextvars — we register an explicit
# one so we can hold the Token and reset it precisely on request teardown.
correlation_id_var: ContextVar[str | None] = ContextVar(
    "correlation_id", default=None
)


def _redact_processor(_logger, _method_name, event_dict):
    """structlog processor — walks every event_dict through scrub_pii so
    denylisted key shapes never leak into the JSON log line.

    Fail-open invariant: NEVER raises. A redaction bug here must not break
    the request lifecycle. On any exception we fall through with the
    unscrubbed event_dict and the request keeps moving.

    Phase 18 / FIX-04. Inserted between merge_contextvars and add_log_level
    so the contextvar-bound fields ARE included in the scrub pass (covers
    correlation_id and any future user_id-bound contextvar) and the level/
    timestamp/JSON-render processors still see the scrubbed dict.
    """
    try:
        scrubbed = _redact_scrub_pii(event_dict)
        # scrub_pii on a Mapping returns a plain dict — that's exactly what
        # the next processor in the chain expects.
        if isinstance(scrubbed, dict):
            return scrubbed
        return event_dict
    except Exception:
        return event_dict


def configure_logging() -> None:
    """Configure structlog ONCE at process startup. Call BEFORE app = FastAPI()."""
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            # Phase 18 / FIX-04 — redact processor BEFORE add_log_level so
            # downstream processors operate on the already-scrubbed event_dict.
            _redact_processor,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(sort_keys=True),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(20),  # INFO+
        cache_logger_on_first_use=True,
    )


class CorrelationMiddleware(BaseHTTPMiddleware):
    """ASGI middleware that binds correlation_id for the request scope.

    Header on the wire is `X-Correlation-Id` (PascalCase per Next.js precedent
    in src/lib/analytics-client.ts:70-71). Read lower-case here per HTTP
    normalization.

    FIX 11 (outside-voice review): Uses explicit Token-based reset instead of
    the broader `clear-contextvars` API. The Token captures the previous value
    of correlation_id_var so reset() restores it exactly. This protects against:
      - bleed across sequential requests (the headline invariant)
      - collateral damage to other contextvars bound by sibling middleware
      - test brittleness from a clear-contextvars-style call wiping unrelated state
    """

    HEADER_NAME = "x-correlation-id"

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        cid = request.headers.get(self.HEADER_NAME) or str(uuid4())

        # Capture the Token so we can surgically reset (FIX 11).
        cv_token = correlation_id_var.set(cid)
        # Also bind via structlog's contextvars helper so the merge_contextvars
        # processor picks up the value automatically. structlog 21.1+ returns
        # a Mapping[str, Token] from bind_contextvars so we can pass it back to
        # reset_contextvars(**tokens) for surgical removal of only THIS scope.
        sl_tokens = structlog.contextvars.bind_contextvars(
            correlation_id=cid,
            method=request.method,
            path=request.url.path,
        )
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("correlation_id", cid)
            try:
                response: Response = await call_next(request)
            finally:
                # Surgical reset (FIX 11) — Token-based, NOT the broad clear-contextvars API.
                # If sl_tokens is a Mapping (newer structlog), unbind via
                # reset_contextvars(**tokens). Older versions returned None and
                # we fall back to unbind_contextvars by key name.
                try:
                    if sl_tokens is not None:
                        structlog.contextvars.reset_contextvars(**sl_tokens)
                    else:
                        structlog.contextvars.unbind_contextvars(
                            "correlation_id", "method", "path"
                        )
                except (AttributeError, TypeError):
                    structlog.contextvars.unbind_contextvars(
                        "correlation_id", "method", "path"
                    )
                correlation_id_var.reset(cv_token)
        # Echo header back so caller can join client-side and server-side logs.
        response.headers["X-Correlation-Id"] = cid
        return response
