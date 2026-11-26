"""The app-global exception handlers (422, 429, venue-transient 424).

Moved out of ``main.py`` in Phase 215 SC-3 (2026-11-15), bodies unchanged, so the
production app and the test suite's app factory (``tests/app_factory.py``) install
the SAME handlers through ONE function, ``install_app_exception_handlers``. A test
app that skipped them answered with FastAPI's default 422 (which echoes the
request ``input``, credentials included) and slowapi's default 429, bodies
production never sends.

This module is a leaf: it must never import ``main`` (an early ``import main``
changes router module identity for the whole test process).
"""

import time
from typing import Any, Sequence, cast

import sentry_sdk
import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.responses import Response

from services.error_contract import VenueTransientHTTPException
from services.logging_config import correlation_id_var
from services.rate_limit import anon_aggregate_key, anon_bucket_key, limiter

# --------------------------------------------------------------------------
# PYAPI-07 (C-13 / C-14) — the app-global 422 handler.
#
# FastAPI's default is `content={"detail": jsonable_encoder(exc.errors())}`
# (fastapi/exception_handlers.py). pydantic v2 puts the *input value* in every
# error's `input` key, and for a `model_validator(mode="after")` failure — which
# routers/process_key.py::_validate_per_flow_required_keys is — `loc` is
# ["body"] and `input` is the ENTIRE payload, INCLUDING `context.api_secret`.
# src/lib/process-key-client.ts:245-250 forwards any non-2xx body untouched and
# src/app/api/verify-strategy/route.ts:194 returns it to an ANONYMOUS browser
# before its own response allowlist is ever reached. That is C-13.
#
# C-14 is the same body from the other end: `detail` is a LIST OF DICTS, so the
# three TS sites doing `err.detail ?? "..."` render "[object Object]".
#
# One handler closes both: build a SCALAR STRING from `type` + `loc` ONLY, and
# drop `input`, `ctx`, `msg` and `url`.
#   * `input`  — the credential carrier.
#   * `ctx`    — `ctx.error` re-embeds the validator's own message.
#   * `msg`    — the validator's message, which for a generic pydantic error can
#                embed the input (`union_tag_invalid` carries the tag value) and
#                for our own validators names server-side feature flags
#                ("SFOX_ENABLED is off" — the C-18 enumeration payload).
#   * `url`    — pydantic's docs link; noise.
#
# The status stays 422: a malformed body is a CALLER fault (STATUS_CONTRACT.md
# §1), so it never counts against this service's health.
#
# ⚠️ Deliberate divergence from STATUS_CONTRACT.md §2, which puts the envelope
# at `body.detail` as an OBJECT for `service_error()` sites: the 422 and 429
# handlers keep a SCALAR top-level `detail`, which is exactly what makes them
# require ZERO TypeScript change. §2 records the distinction; do not "unify"
# them without re-reading it.
# --------------------------------------------------------------------------

#: How many individual field errors the detail summarises before truncating.
#: Bounded because the error count is caller-controlled (one error per bad
#: field), and an unbounded summary is a caller-sized response.
_MAX_REPORTED_VALIDATION_ERRORS = 5

#: Per-`loc`-part cap. `loc` parts are STRUCTURAL — model field names and list
#: indices — not values; no request model in this service validates a
#: `dict[str, <concrete>]`, so a caller-supplied KEY cannot reach a `loc` today.
#: Capped anyway so that if one ever does, the echo is bounded.
_MAX_LOC_PART_CHARS = 60

_validation_log = structlog.get_logger("quantalyze.analytics.validation")


def _validation_detail(errors: Sequence[Any]) -> str:
    """Summarise pydantic errors as ONE scalar string, from `type` + `loc` only.

    Never reads `input`, `ctx`, `msg` or `url`. This function is the whole of
    PYAPI-07's credential safety — everything else is plumbing.
    """
    parts: list[str] = []
    for err in errors[:_MAX_REPORTED_VALIDATION_ERRORS]:
        loc = err.get("loc") or ()
        path = ".".join(str(p)[:_MAX_LOC_PART_CHARS] for p in loc) or "body"
        parts.append(f"{path}: {err.get('type') or 'invalid'}")
    overflow = len(errors) - _MAX_REPORTED_VALIDATION_ERRORS
    if overflow > 0:
        parts.append(f"(+{overflow} more)")
    return "; ".join(parts) or "body: invalid"


async def validation_exception_handler(
    request: Request, exc: Exception
) -> Response:
    """422 for any `RequestValidationError`, on every router.

    Signature is `(Request, Exception) -> Response` to satisfy Starlette's
    `add_exception_handler` overloads under `mypy --strict`; narrowed with
    `cast`, never a mypy suppression comment (140.1-CONTEXT locked decision;
    the literal token is spelled out nowhere in this file so the acceptance
    grep stays a real gate rather than matching its own rationale).
    """
    detail = _validation_detail(cast(RequestValidationError, exc).errors())
    correlation_id = (
        correlation_id_var.get() or request.headers.get("x-correlation-id") or ""
    )
    # Server-side log carries the SAME type+loc summary, deliberately — not the
    # full pydantic errors. A log line is a second copy of the credential if it
    # carries `input`, and it is the copy that survives longest.
    _validation_log.warning(
        "request.validation_failed",
        path=request.url.path,
        detail=detail,
        correlation_id=correlation_id,
    )
    return JSONResponse(
        status_code=422,
        content={
            "ok": False,
            "code": "VALIDATION_FAILED",
            "human_message": (
                "Some of the values sent with this request are not valid."
            ),
            "detail": detail,
            "correlation_id": correlation_id,
            "recoverable": False,
        },
    )


# --------------------------------------------------------------------------
# PYAPI-08 (C-15) — the app-global 429 handler, replacing slowapi's default.
#
# slowapi's `_rate_limit_exceeded_handler` (extension.py:76-87 — byte-identical
# in the installed 0.1.9 and the requirements.txt-pinned 0.1.10, checked against
# the v0.1.10 tag) is::
#
#     JSONResponse({"error": f"Rate limit exceeded: {exc.detail}"}, 429)
#
# Two defects in one line:
#   * the key is `error`, not `detail`, so analytics-client.ts:179 reads
#     `err.detail` -> undefined -> the literal "Analytics service error", which
#     matches no classifier branch and renders as UNKNOWN (C-15 / G-9);
#   * it then calls `limiter._inject_headers(...)`, gated on `_headers_enabled`
#     — default False (extension.py:135 in BOTH versions) and never raised
#     anywhere in this repo — so there is no `Retry-After` and 140.3 cannot name
#     the real wait (B-11).
#
# The replacement carries BOTH a scalar `detail` string AND `code:"RATE_LIMITED"`
# — a code ALREADY registered as a recoverable WizardErrorCode
# (routers/process_key.py:358-359), reused rather than re-minted. Because
# `detail` is a scalar, the three TS `err.detail ?? "..."` sites work on this
# response with ZERO TypeScript change; 140.2 has nothing to do here.
#
# Scope note: this fixes the RESPONSE. It deliberately does NOT set
# `headers_enabled=True` on the shared Limiter — that only adds the
# X-RateLimit-* informational headers and would change every 2xx on 10 routes,
# which is a limiter-configuration change (Phase 146 / RATE-04), not a contract
# one.
# --------------------------------------------------------------------------

def _rate_limit_log() -> Any:
    """The rate-limit logger, looked up PER CALL rather than held at module scope.

    Same shape and reason as ``_stage_logger`` in ``services/mt5_client.py``.
    ``configure_logging()`` sets ``cache_logger_on_first_use=True``, so a
    module-scope proxy freezes onto the processor list in force at its first
    emission. Any later ``structlog.configure()`` installs a NEW list the frozen
    logger never sees, and ``structlog.testing.capture_logs()`` captures through
    that new list, so the 429 lines went missing from capture once a test in the
    same process had re-run ``configure_logging()`` after an earlier 429.
    """
    return structlog.get_logger("quantalyze.analytics.ratelimit")


def _retry_after_seconds(request: Request, exc: RateLimitExceeded) -> int:
    """Seconds the caller should wait, as a positive int.

    Prefers the TRUE remaining time in the current window, read from the
    limiter's storage via the `(RateLimitItem, [key, scope])` tuple slowapi
    stashes on `request.state.view_rate_limit` immediately before raising
    (extension.py:525). Falls back to the FULL window length, which is the
    only value that is safe to advertise when the true remainder is unknown:
    advertising less would invite the retry storm the header exists to prevent.
    """
    window = 60
    limit_item = getattr(getattr(exc, "limit", None), "limit", None)
    if limit_item is not None:
        try:
            window = max(int(limit_item.get_expiry()), 1)
        except (AttributeError, TypeError, ValueError):
            window = 60
    try:
        current = request.state.view_rate_limit
        reset_at, _remaining = limiter.limiter.get_window_stats(
            current[0], *current[1]
        )
        remaining = int(reset_at - time.time()) + 1
        if 0 < remaining <= window:
            return remaining
    except Exception:
        # Storage backends differ and `view_rate_limit` is slowapi-internal;
        # a failure here must degrade to the window, never to no header.
        pass
    return window


#: Fallback dedupe window when the refusing limit's expiry cannot be read. The
#: anonymous teaser limit is "30/hour", so an hour is the honest default.
_ANON_ALERT_DEFAULT_WINDOW_S = 3600

#: ``time.monotonic()`` of the last Sentry emit per bucket key, per PROCESS. The
#: same shape as ``main._secret_capture_last_at`` and ``routers/internal.py``'s
#: KEK alert. Tests clear it before and after.
_anon_alert_last_at: dict[str, float] = {}


def _log_anon_alert_failure() -> None:
    """Log a swallowed alert failure with its traceback; this call itself never raises.

    Called only from inside an ``except`` block (``exc_info=True`` reads the exception
    being handled). Without it a slowapi shape change or a sentry-sdk API break would
    silently turn the only saturation signal into a no-op.
    """
    try:
        _rate_limit_log().warning("request.anon_bucket_alert_failed", exc_info=True)
    except Exception:
        pass  # the failure report must never change or fail the 429 either


def _alert_anon_bucket_saturated(request: Request, throttle: RateLimitExceeded) -> None:
    """Raise a Sentry event when a SHARED anonymous ``/process-key`` bucket refuses.

    Two keys are shared by many visitors: the legacy bucket
    (``anon_bucket_key("process_key")``, "30/hour", every bare-``public`` claim) and
    the anonymous aggregate (``anon_aggregate_key("process_key")``, "200/hour", all
    anonymous visitors together). When either saturates, many visitors are refused
    at once and, before this hook, nobody was told. Observability only: it runs
    AFTER the 429 response is built, reads nothing the response depends on, and
    swallows every failure, so the status, body and headers are identical with and
    without it.

    A per-IP refusal (``process_key:anon:<hex>``) is NOT this signal: it is one
    visitor over their own window. Alerting on it would page on normal fairness
    refusals and grow ``_anon_alert_last_at`` by one key per pseudonym without
    bound. A tenant-bucket refusal is one customer over their own limit and the
    platform-ceiling refusal has its own meaning; neither is this signal either. The refusing bucket is read from
    ``request.state.view_rate_limit`` (slowapi stores ``(limit, [key, scope])``
    for the limit that failed). Never recompute it via ``exc.limit.key_func``:
    that re-runs the key function and re-logs ``tenant_claim_unverified``.

    A structured warning is logged on EVERY refusal; the Sentry event is
    de-duplicated to at most one per limit window PER PROCESS, so a deployment
    with N replicas can emit up to N per window. This handler adds only a fixed
    message, fingerprint and tags (no IP, header, claim or correlation id); the
    request context the SDK integrations attach is redacted by sentry_init.
    Routing the event to a human needs a Sentry issue-alert rule on the
    ``anon_bucket_saturated`` tag, which lives outside this repo.
    """
    try:
        refusing_key = request.state.view_rate_limit[1][0]
    except (AttributeError, IndexError, TypeError):
        _log_anon_alert_failure()
        return
    if refusing_key not in (
        anon_bucket_key("process_key"),
        anon_aggregate_key("process_key"),
    ):
        return
    _rate_limit_log().warning(
        "request.anon_bucket_saturated",
        path=request.url.path,
        limit=str(throttle.detail),
    )
    window = float(_ANON_ALERT_DEFAULT_WINDOW_S)
    if throttle.limit is not None:
        try:
            window = float(throttle.limit.limit.get_expiry())
        except Exception:
            pass  # keep the default window
    now = time.monotonic()
    last = _anon_alert_last_at.get(refusing_key)
    if last is not None and (now - last) < window:
        return
    _anon_alert_last_at[refusing_key] = now
    try:
        with sentry_sdk.new_scope() as scope:
            scope.fingerprint = ["anon-bucket-saturated", "process_key"]
            scope.set_tag("anon_bucket_saturated", "process_key")
            scope.set_tag("limit", str(throttle.detail))
            sentry_sdk.capture_message(
                "Anonymous teaser bucket saturated on /process-key",
                level="warning",
            )
    except Exception:
        # a Sentry failure must never change or fail the 429 it reports on
        _log_anon_alert_failure()


async def rate_limit_exceeded_handler(
    request: Request, exc: Exception
) -> Response:
    """429 for any `RateLimitExceeded`, on every decorated route.

    Signature is `(Request, Exception) -> Response` for the same
    `add_exception_handler` overload reason as the 422 handler above; narrowed
    with `cast`.
    """
    throttle = cast(RateLimitExceeded, exc)
    retry_after = _retry_after_seconds(request, throttle)
    correlation_id = (
        correlation_id_var.get() or request.headers.get("x-correlation-id") or ""
    )
    # `exc.detail` is the LIMIT string ("5 per 1 hour") built at decoration time
    # from a literal in the router — server configuration, never caller input.
    _rate_limit_log().warning(
        "request.rate_limited",
        path=request.url.path,
        limit=str(throttle.detail),
        retry_after_seconds=retry_after,
        correlation_id=correlation_id,
    )
    response = JSONResponse(
        status_code=429,
        content={
            "ok": False,
            "code": "RATE_LIMITED",
            "human_message": (
                "Too many requests. Please wait a moment and try again."
            ),
            "detail": f"Rate limit exceeded: {throttle.detail}",
            "correlation_id": correlation_id,
            "recoverable": True,
            "retry_after_seconds": retry_after,
        },
        headers={"Retry-After": str(retry_after)},
    )
    # After the response exists, so the alert cannot shape it (SC-7 c).
    _alert_anon_bucket_saturated(request, throttle)
    return response


# --------------------------------------------------------------------------
# PYAPIFIX2-01 — the venue-transient handler, deliberately beside the 429 above
# because it exists for the SAME reason and answers the SAME constraint.
#
# `/api/validate-key` is the LIVE key-connect path. When a venue is having a bad
# day the router has already classified WHICH condition occurred and then threw
# that classification away, emitting only a human sentence. The TS seam
# (analytics-client.ts:174-181) turns `error.detail` into an
# AnalyticsUpstreamError MESSAGE and classifyKeyValidationError
# (wizardErrors.ts:936-1035) substring-matches it — deriving both the wizard code
# AND the returned status from the string, discarding the upstream status
# entirely. Two of the five transient verdicts match no branch, so a Binance
# maintenance window during key-connect rendered as "something went wrong, our
# team has been notified" with no retry affordance.
#
# Same fix as the 429 above, for the same reason: a FLAT body carrying a scalar
# `detail` AND a machine `code`. Because `detail` stays a scalar — byte-identical
# to the copy that shipped before — the three TS `err.detail ?? "..."` sites keep
# working with ZERO TypeScript change and nothing that classifies correctly today
# stops doing so. `recoverable` rides alongside as a RENDER hint.
#
# ⚠️ The nested `service_error(...)` envelope is FORBIDDEN at these sites: it puts
# an OBJECT at body.detail, which stringifies to "[object Object]" and regresses
# RATE_LIMITED / PROBE_FAILED / DDOS_PROTECTION to UNKNOWN/500. The exception
# class refuses a non-scalar detail at construction time so the mistake cannot
# reach the wire; see services/error_contract.py's VenueTransientHTTPException
# docstring for the full rationale and the TS-07 negative obligation.
#
# Status is 424 (CALLER'S EXCHANGE, STATUS_CONTRACT.md §5), remapped from 400 by
# 140.3-06 (ledger row TS-32). This handler is STATUS-AGNOSTIC — it echoes
# `verdict.status_code` — which is exactly why the remap was body-neutral and
# needed no change here. Do not reintroduce a hard-coded status.
#
# Starlette resolves handlers by walking `type(exc).__mro__`, so this subclass
# handler wins over FastAPI's default HTTPException handler. That is NOT assumed:
# tests/test_validate_key_venue_transient.py asserts the WIRE body's exact key
# set, so a lookup that fell through to the default would redden immediately.
# --------------------------------------------------------------------------


async def venue_transient_exception_handler(
    request: Request, exc: Exception
) -> Response:
    """The FLAT `{detail, code, recoverable}` body for a classified venue verdict.

    Signature is `(Request, Exception) -> Response` for the same
    `add_exception_handler` overload reason as the two handlers above; narrowed
    with `cast`.
    """
    verdict = cast(VenueTransientHTTPException, exc)
    return JSONResponse(
        status_code=verdict.status_code,
        content={
            # SCALAR, and byte-identical to what this site emitted before the
            # machine fields existed. This is the classifier's input — do not
            # reword, do not nest.
            "detail": verdict.detail,
            "code": verdict.code,
            "recoverable": verdict.recoverable,
        },
        # Parity with the FastAPI default `HTTPException` handler this one
        # SHADOWS: that handler forwards `exc.headers`, so dropping them here
        # would make the shadowing lossy. `HTTPException.headers` is
        # `Mapping[str, str] | None` and `JSONResponse` accepts `None`, so this
        # is a no-op for every current site (the subclass `__init__` forwards
        # no header today). It is here so the sibling handler two blocks above
        # — which exists PRECISELY to emit `Retry-After` — stays a viable
        # pattern for a future venue-transient site instead of a silent
        # header-eater. Deliberately NOT a `Retry-After` default: this class is
        # a CALLER-class 4xx that names no wait.
        headers=verdict.headers,
    )


def install_app_exception_handlers(app: FastAPI) -> None:
    """Register the three app-global handlers on ``app``.

    ``main.py`` and ``tests/app_factory.py`` both call this, so a test app and
    production cannot drift (Phase 215 SC-3). Registration order is the one
    ``main.py`` always used: 422, 429, venue-transient.
    """
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
    app.add_exception_handler(
        VenueTransientHTTPException, venue_transient_exception_handler
    )
