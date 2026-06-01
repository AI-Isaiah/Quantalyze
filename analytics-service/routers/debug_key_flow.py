"""Phase 16 / OBSERV-07 — internal router for the /api/debug-key-flow SSE endpoint.

Asserted invariants:
  1. X-Internal-Token gate (mirrors routers/internal.py — checked via secrets.compare_digest
     against env INTERNAL_API_TOKEN).
  2. Reads DEBUG_KEY_FLOW_<BROKER>_{KEY,SECRET,PASSPHRASE} env vars as raw plaintext
     testnet credentials. The Phase 16 design called for KEK-Fernet-encrypted env-blobs;
     Phase 18 reverted to raw plaintext after Plan 16-07 founder-gate review concluded
     that testnet sandbox credentials are low-sensitivity (read-only scope, separate
     accounts from prod, easily rotated from each broker dashboard) and the encrypt
     wrapping was over-engineered. See day-2-decision.md hypothesis #13.
  3. NEVER persists submitted credentials — purely in-memory exchange call against the
     test broker. Exchange instances are explicitly closed in `finally` blocks.
  4. Each step (validate / encrypt / fetch-trades) returns a structured JSON response
     consumed by the Next.js SSE handler.

CREDENTIAL LIFETIME: Python `str` is immutable, so we cannot zero the underlying
bytes after use. The `creds` dict goes out of scope at function-return and the
GC reclaims it; that is the only "scrub" the language permits. A real wipe would
require pre-allocated bytearrays exchanged with the exchange client. We do NOT
pretend to scrub by rebinding `creds = None` — that achieves nothing measurable.
Phase-16 IN-05 dropped the misleading rebinds; the lifetime guarantee here is
"function-scoped + GC", documented honestly.
"""

from __future__ import annotations

import logging
import os
import secrets
import time
from typing import Any, Literal

import ccxt
import structlog
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from services.exchange import create_exchange, validate_key_permissions

logger = structlog.get_logger()
log = logging.getLogger("quantalyze.debug_key_flow")

router = APIRouter(prefix="/internal/debug-key-flow", tags=["internal", "phase-16"])

# Universal symbol for fetch-trades probe — exists on OKX/Binance/Bybit spot
# markets. Returns up to FETCH_TRADES_LIMIT recent fills; 0 fills is a valid
# response on a fresh testnet account and counts as ok.
FETCH_TRADES_PROBE_SYMBOL = "BTC/USDT"
FETCH_TRADES_LIMIT = 5


def _verify_internal_token(token: str | None) -> None:
    expected = os.getenv("INTERNAL_API_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="INTERNAL_API_TOKEN not configured")
    if not token or not secrets.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="Invalid internal token")


Broker = Literal["okx", "binance", "bybit"]


def _maybe_enable_sandbox(exchange: ccxt.Exchange) -> None:
    """Switch the exchange to its testnet endpoint by default.

    DEBUG_KEY_FLOW_<BROKER>_* env vars hold testnet-only credentials. Sent at
    the prod endpoint they authenticate as the wrong account and surface as
    AuthenticationError — root cause of the 4/6 smoke fails on staged Railway
    after Phase 18 #14 wired the real ccxt paths. ccxt's set_sandbox_mode flips
    the base URL (or x-simulated-trading: 1 on OKX) to match. Set
    DEBUG_KEY_FLOW_SANDBOX=false to point this router at a prod broker — the
    smoke script would have to change too.
    """
    if os.getenv("DEBUG_KEY_FLOW_SANDBOX", "true").lower() != "false":
        exchange.set_sandbox_mode(True)


def _read_test_creds(broker: Broker) -> dict[str, str]:
    """Read DEBUG_KEY_FLOW_<BROKER>_{KEY,SECRET,PASSPHRASE} env vars (raw plaintext).

    Returns dict with keys "key", "secret", and (for OKX) "passphrase". Raises
    HTTPException 503 if KEY or SECRET is unset. Passphrase absence is OK for
    Binance/Bybit (they don't use one).
    """
    upper = broker.upper()
    creds = {
        "key": os.getenv(f"DEBUG_KEY_FLOW_{upper}_KEY"),
        "secret": os.getenv(f"DEBUG_KEY_FLOW_{upper}_SECRET"),
        "passphrase": os.getenv(f"DEBUG_KEY_FLOW_{upper}_PASSPHRASE"),
    }
    if not creds["key"] or not creds["secret"]:
        raise HTTPException(
            status_code=503,
            detail=f"DEBUG_KEY_FLOW_{upper}_* env not configured",
        )
    # Drop None values so callers can rely on dict membership for passphrase.
    return {k: v for k, v in creds.items() if v is not None}


class StepRequest(BaseModel):
    broker: Broker


class StepResponse(BaseModel):
    step: str
    status: Literal["ok", "error"]
    duration_ms: int
    detail: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


@router.post("/validate", response_model=StepResponse)
async def validate_key(
    body: StepRequest,
    x_internal_token: str | None = Header(default=None),
) -> StepResponse:
    _verify_internal_token(x_internal_token)
    t0 = time.monotonic()
    exchange = None
    try:
        creds = _read_test_creds(body.broker)
        exchange = create_exchange(
            body.broker,
            creds["key"],
            creds["secret"],
            creds.get("passphrase"),
        )
        _maybe_enable_sandbox(exchange)
        result = await validate_key_permissions(exchange)
        return StepResponse(
            step="validate_key",
            status="ok" if result.get("valid") else "error",
            duration_ms=int((time.monotonic() - t0) * 1000),
            detail={"broker": body.broker, **result},
            error=None if result.get("valid") else {
                "code": result.get("error_code") or "VALIDATION_FAILED",
                "human_message": result.get("error") or "validate_key_permissions returned valid=False",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        log.exception("[debug-key-flow] validate_key failed")
        return StepResponse(
            step="validate_key",
            status="error",
            duration_ms=int((time.monotonic() - t0) * 1000),
            error={"code": e.__class__.__name__, "human_message": str(e)},
        )
    finally:
        if exchange is not None:
            try:
                await exchange.close()
            except Exception:  # noqa: BLE001 — best-effort cleanup
                pass


@router.post("/encrypt", response_model=StepResponse)
async def encrypt_key(
    body: StepRequest,
    x_internal_token: str | None = Header(default=None),
) -> StepResponse:
    """Sanity check: confirm credentials are readable and parseable.

    Original Phase 16 design framed this as a Fernet-decrypt round-trip proving
    the env-blob layer was healthy. With raw-plaintext storage (Phase 18 #13),
    the step degenerates to a "creds present and non-empty" check — kept as a
    distinct step so the Next.js SSE handler doesn't need a shape change.
    """
    _verify_internal_token(x_internal_token)
    t0 = time.monotonic()
    try:
        creds = _read_test_creds(body.broker)
        return StepResponse(
            step="encrypt_key",
            status="ok",
            duration_ms=int((time.monotonic() - t0) * 1000),
            detail={
                "broker": body.broker,
                "field_lengths": {k: len(v) for k, v in creds.items()},
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        log.exception("[debug-key-flow] encrypt_key failed")
        return StepResponse(
            step="encrypt_key",
            status="error",
            duration_ms=int((time.monotonic() - t0) * 1000),
            error={"code": e.__class__.__name__, "human_message": str(e)},
        )


@router.post("/fetch-trades", response_model=StepResponse)
async def fetch_trades(
    body: StepRequest,
    x_internal_token: str | None = Header(default=None),
) -> StepResponse:
    _verify_internal_token(x_internal_token)
    t0 = time.monotonic()
    exchange = None
    try:
        creds = _read_test_creds(body.broker)
        exchange = create_exchange(
            body.broker,
            creds["key"],
            creds["secret"],
            creds.get("passphrase"),
        )
        _maybe_enable_sandbox(exchange)
        # Direct ccxt.fetch_my_trades — bypasses services.exchange.fetch_raw_trades
        # to avoid the supabase-write side-effect (this endpoint is explicitly
        # non-persisting per invariant 3). BTC/USDT is universal across the 3
        # supported brokers; an empty list is a valid result on a fresh testnet
        # account and still counts as ok (broker reachability + auth + scope).
        trades = await exchange.fetch_my_trades(
            FETCH_TRADES_PROBE_SYMBOL, limit=FETCH_TRADES_LIMIT
        )
        first_ts = trades[0].get("timestamp") if trades else None
        return StepResponse(
            step="fetch_trades",
            status="ok",
            duration_ms=int((time.monotonic() - t0) * 1000),
            detail={
                "broker": body.broker,
                "symbol": FETCH_TRADES_PROBE_SYMBOL,
                "fetched": len(trades),
                "first_ts": first_ts,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        log.exception("[debug-key-flow] fetch_trades failed")
        return StepResponse(
            step="fetch_trades",
            status="error",
            duration_ms=int((time.monotonic() - t0) * 1000),
            error={"code": e.__class__.__name__, "human_message": str(e)},
        )
    finally:
        if exchange is not None:
            try:
                await exchange.close()
            except Exception:  # noqa: BLE001 — best-effort cleanup
                pass
