import asyncio
import os
import secrets
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, Sequence, cast
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.responses import Response
from dotenv import load_dotenv
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
from services.error_contract import service_error_response

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


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from services.encryption import validate_kek_on_startup

    validate_kek_on_startup()
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
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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
        return service_error_response(
            500,
            "SERVICE_KEY_UNCONFIGURED",
            retryable=False,
            detail="Service not configured",
        )

    provided = request.headers.get("X-Service-Key", "")
    if not secrets.compare_digest(provided, SERVICE_KEY):
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
    body = {
        "status": "stale" if stale else "ok",
        "version": "0.1.0",
        "git_sha": _DEPLOYED_SHA,
        "worker_last_tick_at": WORKER_LAST_TICK_AT,
        "worker_age_s": (now - WORKER_LAST_TICK_AT) if WORKER_LAST_TICK_AT else None,
    }
    if stale:
        return JSONResponse(body, status_code=503)
    return body
