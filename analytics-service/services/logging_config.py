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

import logging
import sys
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
from services.redact import scrub_freeform_string, scrub_pii as _redact_scrub_pii


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


class _StdlibRedactFilter(logging.Filter):
    """NEW-C13-10 — stdlib filter that scrubs PII from a LogRecord's msg / args.

    Kept alongside the LogRecord-factory approach below for defence-in-depth.
    A future maintainer who attaches a handler with explicit `.addFilter(...)`
    can use this class directly; the factory does the same work at record
    creation time so the filter is normally redundant but never harmful.

    Fail-open invariant: NEVER raises.
    """

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        _scrub_record_in_place(record)
        return True


def _scrub_record_in_place(record: logging.LogRecord) -> None:
    """Mutate `record.msg` and `record.args` through scrub_freeform_string.

    Fail-open: any exception leaves the record unchanged AND writes a single
    line to stderr so a redaction bug surfaces without recursing through the
    very logger we just intercepted (logging.error here would re-enter the
    factory). Per type-design specialist L conf=9, the prior bare `except:
    pass` made a swallowed scrub bug invisible to ops.
    """
    try:
        if isinstance(record.msg, str):
            record.msg = scrub_freeform_string(record.msg)
        args = record.args
        if args:
            # Perf L conf=9: skip the allocation/comprehension entirely when
            # the args container has no string values — avoids reallocating
            # the tuple/dict on every record (job_worker tight loop pays this
            # cost at 100+ records/sec during backfill windows).
            if isinstance(args, dict):
                if any(isinstance(v, str) for v in args.values()):
                    record.args = {
                        k: (scrub_freeform_string(v) if isinstance(v, str) else v)
                        for k, v in args.items()
                    }
            elif isinstance(args, tuple):
                if any(isinstance(v, str) for v in args):
                    record.args = tuple(
                        scrub_freeform_string(v) if isinstance(v, str) else v
                        for v in args
                    )
            elif isinstance(args, list):
                # Type-design M conf=8: some 3rd-party logging setups pass
                # list-typed args. Stdlib accepts it; without this branch the
                # values would slip through unscrubbed. List → list to keep
                # the original container shape.
                if any(isinstance(v, str) for v in args):
                    record.args = [
                        scrub_freeform_string(v) if isinstance(v, str) else v
                        for v in args
                    ]
        # Security H conf=9 (2026-05-28 specialist): logger.exception()
        # attaches str(exc) via exc_info; the stdlib Formatter renders that
        # through traceback.format_exception AFTER our msg/args scrub.
        # Mutate exc.args so the next traceback render uses scrubbed strings,
        # preventing HMAC-bearing ccxt messages from leaking into the
        # formatted traceback line. Downstream re-raise sees the scrubbed args
        # — desirable for credential cases; benign exceptions hit the
        # scrub_freeform_string fast-path.
        if record.exc_info and len(record.exc_info) > 1:
            exc_value = record.exc_info[1]
            if exc_value is not None and getattr(exc_value, "args", None):
                try:
                    exc_value.args = tuple(
                        scrub_freeform_string(a) if isinstance(a, str) else a
                        for a in exc_value.args
                    )
                except (AttributeError, TypeError):
                    # Some exception types (BaseException subclasses with
                    # __slots__, frozen exceptions, etc.) resist .args
                    # mutation. Fail-open here; scrub_freeform_string on
                    # exc_text below is the secondary line.
                    pass
        # Security H conf=9 (same): scrub record.stack_info — set by
        # log.* with stack_info=True; can carry credentials baked into the
        # formatted frame (e.g. f-string with the URL on the calling frame).
        if record.stack_info and isinstance(record.stack_info, str):
            record.stack_info = scrub_freeform_string(record.stack_info)
    except Exception as exc:  # noqa: BLE001 — fail-open is the documented contract
        sys.stderr.write(f"[logging_config] redact bridge raised: {exc!r}\n")


# NEW-C13-10 — module-private slot for the original LogRecord factory so
# configure_logging() is idempotent. On a second call we re-wrap the already-
# wrapped factory only if it's NOT already our wrapper.
_ORIGINAL_LOG_RECORD_FACTORY: "logging._LogRecordFactory | None" = None
_REDACT_FACTORY_INSTALLED = False


def _redact_log_record_factory(*args, **kwargs) -> logging.LogRecord:
    """Wrapped LogRecord factory that scrubs msg/args at record creation.

    Bridges the structlog _redact_processor protection to ALL stdlib log
    records — regardless of which logger emits or which handler emits.
    Without this, `logger.warning("ccxt: %s", str(exc))` in exchange.py would
    leak the HMAC signature embedded in the ccxt exception message.
    """
    base = _ORIGINAL_LOG_RECORD_FACTORY or logging.LogRecord
    record = base(*args, **kwargs)
    _scrub_record_in_place(record)
    return record


def configure_logging() -> None:
    """Configure structlog ONCE at process startup. Call BEFORE app = FastAPI()."""
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.dict_tracebacks,
            # Security L conf=9 (2026-05-28 specialist): _redact_processor
            # MUST run AFTER dict_tracebacks so the formatted traceback text
            # (carrying str(exc) verbatim) walks the redact pass. Prior
            # position-2 placement missed the traceback content, leaking
            # HMAC-bearing ccxt exceptions to JSON.
            _redact_processor,
            structlog.processors.JSONRenderer(sort_keys=True),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(20),  # INFO+
        cache_logger_on_first_use=True,
    )
    # NEW-C13-10 — install the stdlib bridge via setLogRecordFactory. Factory
    # is handler- and logger-agnostic: every LogRecord created anywhere in the
    # process passes through our wrapper BEFORE any handler can emit. A
    # per-logger filter would miss records that originate at a child logger
    # and propagate to a root-attached handler. Idempotent: install-state
    # gate prevents recursive re-wrapping on a second configure_logging()
    # call (lifespan restart, test setup).
    global _ORIGINAL_LOG_RECORD_FACTORY, _REDACT_FACTORY_INSTALLED  # noqa: PLW0603
    if not _REDACT_FACTORY_INSTALLED:
        _ORIGINAL_LOG_RECORD_FACTORY = logging.getLogRecordFactory()
        logging.setLogRecordFactory(_redact_log_record_factory)
        _REDACT_FACTORY_INSTALLED = True


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
