import os
import secrets
import logging
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

from routers import analytics, exchange

logger = logging.getLogger("quantalyze.analytics")

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Quantalyze Analytics Service",
    version="0.1.0",
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

    if not SERVICE_KEY:
        raise HTTPException(status_code=503, detail="Service not configured")

    provided = request.headers.get("X-Service-Key", "")
    if not secrets.compare_digest(provided, SERVICE_KEY):
        raise HTTPException(status_code=401, detail="Unauthorized")

    return await call_next(request)


app.include_router(analytics.router)
app.include_router(exchange.router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
