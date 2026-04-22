import asyncio
import os
import secrets
import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv

load_dotenv()

# Sentry error tracking (optional, production only)
SENTRY_DSN = os.getenv("SENTRY_DSN")
if SENTRY_DSN:
    try:
        import sentry_sdk
        sentry_sdk.init(
            dsn=SENTRY_DSN,
            traces_sample_rate=0.1,
            send_default_pii=False,
            before_send_transaction=lambda event, hint: event,
        )
    except ImportError:
        logging.getLogger("quantalyze.analytics").warning("SENTRY_DSN set but sentry-sdk not installed")

from routers import analytics, cron, exchange, internal, match, portfolio, simulator

logger = logging.getLogger("quantalyze.analytics")

limiter = Limiter(key_func=get_remote_address)


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
        _scheduled_daily_loop,
        daily_enqueue_loop,
        dispatch_loop,
        watchdog_loop,
    )
    from services.scheduled_tasks import (
        cleanup_ack_tokens_tick,
        enqueue_reconcile_strategies_tick,
        enqueue_sync_funding_tick,
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
        asyncio.create_task(
            _scheduled_daily_loop("sync_funding", enqueue_sync_funding_tick),
            name="sync_funding_loop",
        ),
        asyncio.create_task(
            _scheduled_daily_loop(
                "reconcile_strategies", enqueue_reconcile_strategies_tick
            ),
            name="reconcile_strategies_loop",
        ),
        asyncio.create_task(
            _scheduled_daily_loop("cleanup_ack_tokens", cleanup_ack_tokens_tick),
            name="cleanup_ack_tokens_loop",
        ),
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

# CORS
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "X-Service-Key"],
)

# Service-to-service auth (no default, fail closed)
SERVICE_KEY = os.getenv("SERVICE_KEY")


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

    if not SERVICE_KEY:
        raise HTTPException(status_code=503, detail="Service not configured")

    provided = request.headers.get("X-Service-Key", "")
    if not secrets.compare_digest(provided, SERVICE_KEY):
        raise HTTPException(status_code=401, detail="Unauthorized")

    return await call_next(request)


app.include_router(analytics.router)
app.include_router(cron.router)
app.include_router(exchange.router)
app.include_router(match.router)
app.include_router(portfolio.router)
app.include_router(simulator.router)
app.include_router(internal.router)


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
        "worker_last_tick_at": WORKER_LAST_TICK_AT,
        "worker_age_s": (now - WORKER_LAST_TICK_AT) if WORKER_LAST_TICK_AT else None,
    }
    if stale:
        return JSONResponse(body, status_code=503)
    return body


_PROCESS_START_AT = time.time()
