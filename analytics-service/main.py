import asyncio
import os
import secrets
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, Final, Sequence, cast
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from starlette.responses import Response
from dotenv import load_dotenv

# PYAPI-06 — imported as a MODULE (not `from sentry_sdk import capture_message`)
# so the operator-signal captures below resolve through `main.sentry_sdk` and can
# be spied on in tests. Importing the module has no side effects; `init_sentry()`
# further down is what configures it.
import sentry_sdk
import structlog

load_dotenv()

# Root logging config. FastAPI / uvicorn don't configure the root logger,
# so any `logging.getLogger(...).info(...)` from our code silently drops
# on stdout. Explicit basicConfig here guarantees worker-loop events
# ("Worker starting as ...", "Claimed N jobs", "Job X done") land in
# Railway's deploy log stream alongside uvicorn's access log. LOG_LEVEL
# env var lets ops bump to DEBUG without a code change.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)

from routers import cron, exchange, internal, match, optimizer, portfolio, simulator, csv
from routers import process_key as process_key_router
from routers.debug_key_flow import router as debug_key_flow_router

# PYAPI-05 — the shared status contract (analytics-service/docs/STATUS_CONTRACT.md).
# service_error_RESPONSE is the middleware-safe half: it RETURNS a JSONResponse
# carrying the same envelope the raise sites nest under `detail`.
from services.error_contract import (
    VenueTransientHTTPException,
    service_error_response,
)

# Phase 16 / OBSERV-02 + OBSERV-09: configure structlog ONCE at process startup
# (idempotent), and import the CorrelationMiddleware so we can mount it BEFORE
# CORSMiddleware below. structlog wraps stdlib logging — coexists with
# logging.basicConfig() above; both can emit at the same time.
from services.logging_config import (
    CorrelationMiddleware,
    configure_logging,
    correlation_id_var,
)

configure_logging()

# Phase 16 / OBSERV-04 + OBSERV-05 — initialize sentry-sdk[fastapi] AFTER
# configure_logging() (so structlog is wired before any sentry import side
# effects) and BEFORE app = FastAPI() (so the FastAPI/Starlette integrations
# are registered before any router instantiation). Replaces the previous
# inline minimal init block — sentry-sdk is now a hard requirement (pinned in
# requirements.txt), not an optional ImportError fallback. PII redactor
# mirrors src/lib/admin/pii-scrub.ts FULL surface (FIX 7).
from sentry_init import init_sentry

init_sentry()

logger = logging.getLogger("quantalyze.analytics")

# API-5 fix — single shared Limiter for the process. Routers that need rate
# limits import the same instance from services.rate_limit so the
# `@limiter.limit(...)` decorator and `app.state.limiter` reference the
# same storage. Pre-fix, main.py and routers/process_key.py each owned a
# separate Limiter() and the route's metrics were never visible on
# app.state (and any future storage backend swap would only cover one).
from services.rate_limit import limiter


# --------------------------------------------------------------------------
# Lifespan: run the compute_jobs worker loops (dispatch + watchdog + daily
# enqueue + 3 Hobby-plan cron backfills) as background asyncio tasks inside
# the API process. Previously main_worker.py ran these as a separate Railway
# service; merging them eliminates the "forgot to deploy the worker" failure
# mode (incident 2026-04-20 → 2026-04-22, jobs queued but never processed).
# --------------------------------------------------------------------------
# Liveness ties /health to WORKER_LAST_TICK_AT — Railway's healthcheck
# restarts the pod if the dispatch loop goes silent for >90s, so a silent
# worker-task crash cannot masquerade as a healthy API.
WORKER_LAST_TICK_AT: float = 0.0
WORKER_STALE_THRESHOLD_S = 90.0
# Captured at module import so /health can grant a startup-grace window
# before failing on a stale dispatch tick. Defined at the top of the module
# alongside WORKER_LAST_TICK_AT (Phase-16 IN-04: previously assigned at the
# bottom of the file, AFTER health() referenced it — worked at call-time
# but mis-read on a top-down scan).
_PROCESS_START_AT = time.time()

# tech-debt #9: expose the deployed git commit in /health so a post-merge probe
# (or a human) can assert "prod is running main HEAD" — Railway skips the deploy
# silently when main CI is red, leaving the worker on stale code with no signal.
# Railway injects RAILWAY_GIT_COMMIT_SHA into the runtime env; fall back to the
# generic GIT_COMMIT_SHA, else "unknown" in local/dev where neither is set.
_DEPLOYED_SHA = (
    os.getenv("RAILWAY_GIT_COMMIT_SHA")
    or os.getenv("GIT_COMMIT_SHA")
    or "unknown"
)


# --------------------------------------------------------------------------
# PYAPI-06 (C-11) — an operator signal for a missing or stale platform secret.
#
# C-11 has two directions and BOTH were silent:
#   * Railway side — `SERVICE_KEY` unset ⇒ every guarded route refuses, while
#     /process-key and /internal/* keep working (they are skipped below). No
#     log, no Sentry, /health green.
#   * Vercel side — a stale `ANALYTICS_SERVICE_KEY` ⇒ a 401 storm. 4xx, so
#     140.2's breaker never trips and /health stays green. Indistinguishable
#     from an attacker.
#
# THE CONSTRAINT THAT OUTRANKS THE SIGNAL: no log, tag or capture may contain a
# secret VALUE, or any substring of one — not the configured secret, and not the
# value the caller presented (on a rotation that IS the previous real secret).
# Naming the env var is the whole point; naming its value turns the operator
# signal into the leak it exists to detect.
# --------------------------------------------------------------------------

#: The platform secrets that gate the seam. Enumerated by BEHAVIOUR — "which
#: secret's absence changes what a route answers" — not by grep:
#: `SERVICE_KEY` guards every route except /health, /internal/* and
#: /process-key; `INTERNAL_API_TOKEN` guards /process-key.
#:
#: KEK is deliberately ABSENT. It already has its own startup validation
#: (`services.encryption.validate_kek_on_startup`, called from the same
#: lifespan) plus plan 03's request-time captures at the S-07/S-08 sites; a
#: second, weaker probe here would only create a competing source of truth.
REQUIRED_PLATFORM_SECRETS: Final[tuple[str, ...]] = (
    "SERVICE_KEY",
    "INTERNAL_API_TOKEN",
)

#: Minimum seconds between two identical captures. T-140.1-23: a stale key
#: fires on EVERY request, so an unthrottled capture is its own outage — the
#: signal would DoS the thing it is meant to alert.
_SECRET_CAPTURE_MIN_INTERVAL_S = 300.0

#: `"<fault>:<secret name>" -> monotonic seconds`. Never holds a secret value.
_secret_capture_last_at: dict[str, float] = {}

_config_log = structlog.get_logger("quantalyze.analytics.config")


def _platform_secret_is_set(name: str) -> bool:
    """Is `name` configured, AS THE GATE THAT USES IT SEES IT?

    `SERVICE_KEY` is read from the MODULE GLOBAL because that is precisely what
    `verify_service_key` compares against (it is captured once at import).
    Reading `os.getenv` here instead would let /health report "configured"
    while the gate refuses every request, which is the same class of silent
    disagreement C-11 is about.
    """
    if name == "SERVICE_KEY":
        return bool(SERVICE_KEY)
    return bool(os.getenv(name))


def _degraded_platform_secrets() -> list[str]:
    """Required secrets that are absent or empty, in declaration order."""
    return [n for n in REQUIRED_PLATFORM_SECRETS if not _platform_secret_is_set(n)]


def _capture_secret_misconfig(fault: str, secret_name: str) -> None:
    """Rate-limited Sentry capture naming the SECRET, never its value.

    `fault` is `"unset"` (nobody configured it — a deploy/config fault) or
    `"mismatched"` (a caller presented the wrong value — rotation drift, or an
    attack). They are separate tags on purpose: collapsing them into one event
    is what makes a rotation indistinguishable from an attacker, which is C-11
    site 3 verbatim.

    Follows `services/audit.py:441`'s tag-then-capture shape, with the
    `new_scope()` isolation `CorrelationMiddleware` uses so the tags do not
    leak onto unrelated events. The whole emit is wrapped in try/except: a
    Sentry transport failure must never turn a config warning into a 500.
    """
    throttle_key = f"{fault}:{secret_name}"
    now = time.monotonic()
    last = _secret_capture_last_at.get(throttle_key)
    if last is not None and (now - last) < _SECRET_CAPTURE_MIN_INTERVAL_S:
        return
    _secret_capture_last_at[throttle_key] = now
    try:
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("config_fault", fault)
            scope.set_tag("config_secret", secret_name)
            sentry_sdk.capture_message(
                f"Platform secret {secret_name} is {fault}", level="error"
            )
    except Exception:
        pass


def assert_platform_secrets_configured() -> list[str]:
    """Startup check. Loud, once per missing secret — and NEVER fatal.

    Returns the degraded names so a caller (and the tests) can see the verdict.

    ⚠️ DELIBERATELY NOT `sys.exit`. Railway restarts a pod that exits, so a hard
    failure here is a crash-loop: an unset env var — a thirty-second fix an
    operator can only make against a RUNNING service — becomes a total outage,
    and the /health signal added below never gets served. Loud-and-degraded
    beats dead (T-140.1-24).
    """
    degraded = _degraded_platform_secrets()
    for name in degraded:
        logger.error(
            "PYAPI-06: platform secret %s is not configured — the routes it "
            "guards will refuse every request until an operator sets it",
            name,
        )
        _config_log.error("config.secret_unset", secret=name)
        _capture_secret_misconfig("unset", name)
    if not degraded:
        _config_log.info(
            "config.secrets_ok", count=len(REQUIRED_PLATFORM_SECRETS)
        )
    return degraded


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from services.encryption import validate_kek_on_startup

    validate_kek_on_startup()
    # PYAPI-06 — runs BEFORE the worker loops start, so the operator sees the
    # config fault even if a loop crashes on the way up.
    assert_platform_secrets_configured()
    logger.info("Startup validation complete")

    # Import lazily so unit tests that import main.py without env vars
    # don't pay the import cost.
    import main_worker
    from main_worker import (
        SHUTDOWN,
        WORKER_ID,
        daily_enqueue_loop,
        dispatch_loop,
        watchdog_loop,
    )

    # Bridge the worker's healthz signal into /health: every dispatch_tick
    # writes to main_worker_healthz.LAST_TICK_AT; read it on /health and
    # return 503 when stale. Same contract as the stand-alone worker had.
    import main_worker_healthz

    async def _bridge_healthz() -> None:
        global WORKER_LAST_TICK_AT
        while not SHUTDOWN.is_set():
            WORKER_LAST_TICK_AT = main_worker_healthz.LAST_TICK_AT
            try:
                await asyncio.wait_for(SHUTDOWN.wait(), timeout=5.0)
                break
            except asyncio.TimeoutError:
                pass

    logger.info("Worker starting as %s (merged into API)", WORKER_ID)
    tasks = [
        asyncio.create_task(dispatch_loop(WORKER_ID), name="dispatch_loop"),
        asyncio.create_task(watchdog_loop(), name="watchdog_loop"),
        asyncio.create_task(daily_enqueue_loop(), name="daily_enqueue_loop"),
        asyncio.create_task(_bridge_healthz(), name="healthz_bridge"),
    ]

    # Fail loudly if any loop crashes. done_callback ensures a silent
    # unhandled exception in a background task still gets logged with
    # full traceback and sets SHUTDOWN so the remaining loops (and the
    # API) terminate rather than silently drifting.
    def _crash_handler(task: asyncio.Task) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            logger.error(
                "Worker task %s crashed: %s", task.get_name(), exc, exc_info=exc
            )
            SHUTDOWN.set()

    for t in tasks:
        t.add_done_callback(_crash_handler)

    try:
        yield
    finally:
        logger.info("Shutting down worker loops...")
        SHUTDOWN.set()
        # Give loops up to 10s to exit cleanly on their SHUTDOWN check.
        try:
            await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True), timeout=10.0
            )
        except asyncio.TimeoutError:
            logger.warning("Some worker tasks did not exit in 10s; cancelling")
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        logger.info("Worker loops stopped")


app = FastAPI(
    title="Quantalyze Analytics Service",
    version="0.1.0",
    lifespan=lifespan,
)
app.state.limiter = limiter

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


app.add_exception_handler(RequestValidationError, validation_exception_handler)


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

_rate_limit_log = structlog.get_logger("quantalyze.analytics.ratelimit")


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
    _rate_limit_log.warning(
        "request.rate_limited",
        path=request.url.path,
        limit=str(throttle.detail),
        retry_after_seconds=retry_after,
        correlation_id=correlation_id,
    )
    return JSONResponse(
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


app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)


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
# Status stays 400. The 400 -> 424 remap is user-invisible while the classifier
# discards the status, and it is owed as ONE unit with TS-05 (ledger row TS-32).
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


app.add_exception_handler(
    VenueTransientHTTPException, venue_transient_exception_handler
)

# Phase 16 / OBSERV-02 + plan acceptance: CorrelationMiddleware is registered
# BEFORE CORSMiddleware in source order. In Starlette this means CORS wraps
# correlation in the runtime middleware stack — CORS handles preflight and
# error responses outermost, while correlation_id binding still wraps every
# router/business-logic call (including verify_service_key below). The plan's
# acceptance criterion explicitly requires this source-line ordering.

app.add_middleware(CorrelationMiddleware)

# CORS
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "X-Service-Key", "X-Correlation-Id"],
)

# Service-to-service auth (no default, fail closed)
SERVICE_KEY = os.getenv("SERVICE_KEY")

# PYAPI-04 / PYAPI-06 — the /process-key auth gate's own logger. Three DISTINCT
# events, because an operator has to tell three different situations apart from
# the log alone: a secret nobody set (deploy/config fault), a caller that sent
# nothing (a rotation that dropped the header, or an unauthenticated prober),
# and a caller that sent the WRONG value (a stale token mid-rotation, or an
# attack). Collapsing them into one line is what made C-11's "no operator
# signal" true. NONE of them may carry token material — not the token, not a
# prefix, not a length.
_auth_log = structlog.get_logger("quantalyze.analytics.auth")


def _gate_process_key(request: Request) -> JSONResponse | None:
    """PYAPI-04 — authenticate /process-key BEFORE routing.

    Returns the refusal to send, or ``None`` to admit the request.

    NEVER raises: the caller is a ``BaseHTTPMiddleware``, which sits ABOVE the
    ExceptionMiddleware that would translate an ``HTTPException``. A raise here
    escapes to ServerErrorMiddleware, which renders a bodyless 500 ``text/plain``
    AND re-raises into Sentry (QUANTALYZE-4). Note this is exactly where a
    copy-paste of ``routers/process_key.py:_verify_internal_token`` — which DOES
    ``raise HTTPException`` — would reintroduce that bug.

    ARM ORDER IS LOAD-BEARING. The unset-secret arm runs FIRST, before any
    comparison, and it is not an optimisation: the naive shape

        secrets.compare_digest(provided, os.getenv("INTERNAL_API_TOKEN") or "")

    compares ``""`` against ``""`` when the secret is unset and an empty bearer
    is on the wire — which is TRUE, so it ADMITS the request. That is the exact
    misconfiguration state PYAPI-06 exists to detect, and it must fail CLOSED.

    An unset secret answers **500 `retryable:false`** (SERVICE-PERMANENT, R-1 in
    docs/STATUS_CONTRACT.md), mirroring the SERVICE_KEY arm below: it is OUR
    misconfiguration, so 401 would blame the caller for it and 503 would make an
    operator-only fault flap 140.2's breaker forever. A missing or mismatched
    bearer answers **401** (CALLER) — "we do not know who you are" is
    authentication, so it is 401 rather than the handler's legacy 403.
    """
    expected = os.getenv("INTERNAL_API_TOKEN")
    if not expected:
        _auth_log.error("process_key.auth.secret_unset", path=request.url.path)
        # PYAPI-06 site 2 — rate-limited, so a stale deploy cannot flood Sentry.
        _capture_secret_misconfig("unset", "INTERNAL_API_TOKEN")
        return service_error_response(
            500,
            "INTERNAL_TOKEN_UNCONFIGURED",
            retryable=False,
            detail="Service not configured",
        )

    # Accept both wire shapes for the same reason _verify_internal_token does:
    # the Phase-19 thin adapters post `Authorization: Bearer <token>`, and any
    # internal caller piggybacking on this seam may send a bare token.
    auth = request.headers.get("Authorization", "")
    provided = auth[len("Bearer ") :] if auth.startswith("Bearer ") else auth

    if not provided:
        _auth_log.warning("process_key.auth.token_absent", path=request.url.path)
        return service_error_response(
            401, "UNAUTHENTICATED", retryable=False, detail="Unauthorized"
        )

    if not secrets.compare_digest(provided, expected):
        _auth_log.warning("process_key.auth.token_mismatch", path=request.url.path)
        # PYAPI-06 site 3 — a DISTINCT tag from the unset arm above. A stale
        # `INTERNAL_API_TOKEN` on the Vercel side and an attacker both land
        # here; conflating them with "nobody configured it" is what made a
        # rotation indistinguishable from an attack.
        _capture_secret_misconfig("mismatched", "INTERNAL_API_TOKEN")
        return service_error_response(
            401, "UNAUTHENTICATED", retryable=False, detail="Unauthorized"
        )

    return None


@app.middleware("http")
async def verify_service_key(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)

    # /internal/* uses its own X-Internal-Token gate (Sprint 5 Task 5.8) —
    # validated inside routers/internal.py with secrets.compare_digest.
    # Skipping X-Service-Key here means /internal can be hit by a caller
    # that holds only the rotateable internal-token secret, which is the
    # whole point of using a separate gate for the live key probe.
    if request.url.path.startswith("/internal/"):
        return await call_next(request)

    # /process-key (Phase 19 / BACKBONE-01) authenticates via the rotateable
    # INTERNAL_API_TOKEN gate (Authorization: Bearer <token>), NOT X-Service-Key
    # — without that carve-out this middleware rejected every Vercel→FastAPI
    # call with 401 before the route's own auth ran (API-1).
    #
    # PYAPI-04 (C-18): the carve-out used to be a bare `return await
    # call_next(request)`, which made auth the THIRD gate on this route —
    # pydantic 422 → slowapi 429 → handler 403 (RESEARCH G-4/G-5/G-6). Two
    # consequences, both live: an anonymous caller read server-side feature
    # flags straight out of the 422 body ("SFOX_ENABLED is off"), and the
    # throttle layer was reachable with no credential at all. Middleware is the
    # ONLY layer that runs earlier than both — a decorator cannot get ahead of
    # pydantic, which resolves before any handler decorator. So the skip becomes
    # a GATE. X-Service-Key is still not required here; API-1 is preserved.
    #
    # `_verify_internal_token` stays as the first statement of the handler body:
    # this gate is ADDITIVE defence-in-depth, not a move (the router is mounted
    # bare in unit tests, where it is the only thing standing).
    if request.url.path == "/process-key" or request.url.path.startswith(
        "/process-key/"
    ):
        refusal = _gate_process_key(request)
        if refusal is not None:
            return refusal
        return await call_next(request)

    # Return a JSONResponse directly — do NOT `raise HTTPException` here. This
    # function is a Starlette BaseHTTPMiddleware, which sits ABOVE the
    # ExceptionMiddleware that would translate an HTTPException into a clean
    # response. A raise escapes to ServerErrorMiddleware, which renders a 500
    # AND re-raises (so the Sentry integration captures it): every
    # missing/empty X-Service-Key produced a 500 + a captured error instead of
    # a clean 401 (Sentry QUANTALYZE-4). Returning the response fails closed
    # with the correct status and zero Sentry noise.
    # PYAPI-05 S-23: SERVICE-PERMANENT, not transient. An unset SERVICE_KEY is
    # an operator-only fault: every request to every guarded route answers the
    # same way until a human sets the env var. As a 503 it was the worst shape
    # of the permanent flap — 140.2's breaker would trip, expire, re-probe and
    # trip again forever, with no retry able to clear it (A-08/A-25/C-17). R-1
    # makes it a 500 with retryable:false, which never counts.
    #
    # service_error_response (NOT service_error) because of the never-raise
    # rule documented above: it nests the SAME envelope under `detail` as the
    # HTTPException sites, so 140.2 reads one shape from one location.
    if not SERVICE_KEY:
        # PYAPI-06 site 1 — C-11's Railway half. Rate-limited: this arm fires on
        # EVERY request to EVERY guarded route while the env var is unset.
        # M-14: `error` matches the `process_key.auth.secret_unset` sibling at
        # :594 — an unset platform secret is a deploy fault that refuses every
        # request until a human acts. The Sentry capture below is the throttled
        # half; the log is the trail that survives Sentry being muted, over
        # quota, or simply not where the operator is looking.
        _auth_log.error("service_key.secret_unset", path=request.url.path)
        _capture_secret_misconfig("unset", "SERVICE_KEY")
        return service_error_response(
            500,
            "SERVICE_KEY_UNCONFIGURED",
            retryable=False,
            detail="Service not configured",
        )

    provided = request.headers.get("X-Service-Key", "")
    if not secrets.compare_digest(provided, SERVICE_KEY):
        # PYAPI-06 site 5 — C-11's HEADLINE, seen from the receiving end. A
        # stale `ANALYTICS_SERVICE_KEY` on Vercel produces exactly this 401,
        # and a 401 never trips 140.2's breaker, so before this capture the
        # entire seam could be down with /health green and zero alerts.
        #
        # Only a NON-EMPTY wrong key is captured. An absent header is an
        # unauthenticated prober — internet background noise — and capturing it
        # would make the signal meaningless. The response is unchanged either
        # way: this is additive observability, not a new refusal.
        if provided:
            # M-14: `warning` matches the `process_key.auth.token_mismatch`
            # sibling at :620 — a mismatched credential is a rotation mid-flight
            # or an attacker, not the operator-must-act-now fault an unset
            # secret is. This line MUST stay inside `if provided:`: dedented one
            # level it fires on every unauthenticated prober on the internet,
            # which buries the real signal exactly the way C-11 was buried.
            _auth_log.warning("service_key.mismatch", path=request.url.path)
            _capture_secret_misconfig("mismatched", "SERVICE_KEY")
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)

    return await call_next(request)


app.include_router(cron.router)
app.include_router(exchange.router)
app.include_router(match.router)
app.include_router(portfolio.router)
app.include_router(optimizer.router)
app.include_router(simulator.router)
app.include_router(internal.router)
app.include_router(csv.router)
# Phase 19 / BACKBONE-01 — unified key-submission backbone. Slots in AFTER
# csv.router per CONTEXT.md §IngestionAdapter L58. M-21 — import moved to
# the top with the other router imports; the noqa: E402 is no longer
# needed.
app.include_router(process_key_router.router)
# Phase 16 / OBSERV-07 — admin-gated diagnostic SSE backend (founder-only)
app.include_router(debug_key_flow_router)


@app.get("/health")
async def health():
    # Report 503 when the merged worker's dispatch_tick hasn't bumped the
    # heartbeat in >STALE_THRESHOLD_S. Railway's healthcheckPath=/health
    # then restarts the pod, which restores job processing automatically
    # instead of leaving a zombie API serving with dead worker loops.
    # Skip the stale check for STALE_THRESHOLD_S after process start so a
    # freshly booted pod doesn't fail its first probe before dispatch_tick
    # has had a chance to run.
    now = time.time()
    startup_grace_ok = (now - _PROCESS_START_AT) < WORKER_STALE_THRESHOLD_S
    stale = (
        not startup_grace_ok
        and (now - WORKER_LAST_TICK_AT) > WORKER_STALE_THRESHOLD_S
    )
    # PYAPI-06 (C-11) — config integrity, reported as a TERM and never as a
    # STATUS. C-11's headline is "/health green while every guarded route
    # refuses"; this closes the reporting gap without closing the pod.
    #
    # ⚠️ The status deliberately does NOT move. Railway's healthcheckPath is
    # /health, so a red /health restarts the pod — turning an unset env var
    # (which only a human can fix, against a RUNNING service) into a restart
    # loop (T-140.1-24). `status` stays the WORKER-heartbeat verdict and
    # `config_ok` stays the SECRET verdict; crossing them is the bug.
    #
    # Only secret NAMES appear here, never values — /health is unauthenticated
    # (the middleware skips it), so this is the one payload where an echo would
    # be a straight public disclosure.
    degraded_secrets = _degraded_platform_secrets()
    body = {
        "status": "stale" if stale else "ok",
        "version": "0.1.0",
        "git_sha": _DEPLOYED_SHA,
        "worker_last_tick_at": WORKER_LAST_TICK_AT,
        "worker_age_s": (now - WORKER_LAST_TICK_AT) if WORKER_LAST_TICK_AT else None,
        "config_ok": not degraded_secrets,
        "config_degraded_secrets": degraded_secrets,
    }
    if stale:
        return JSONResponse(body, status_code=503)
    return body
