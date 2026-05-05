"""Phase 16 / OBSERV-07 — internal router for the /api/debug-key-flow SSE endpoint.

Asserted invariants:
  1. X-Internal-Token gate (mirrors routers/internal.py — checked via secrets.compare_digest
     against env INTERNAL_API_TOKEN).
  2. Decrypts DEBUG_KEY_FLOW_<BROKER>_{KEY,SECRET,PASSPHRASE} env-blobs via the existing
     KEK Fernet at services/encryption.py — NEVER reads raw user credentials.
  3. NEVER persists submitted credentials — purely in-memory exchange call against the
     test broker.
  4. Each step (validate / encrypt / fetch-trades) returns a structured JSON response
     consumed by the Next.js SSE handler.

EXECUTOR NOTE: the validate / encrypt / fetch-trades step bodies use placeholder
summary dicts that preserve the StepResponse shape so the Next.js SSE handler can
be developed in parallel. Wiring the real unified-pipeline calls
(services.exchange.validate_key_permissions / fetch_raw_trades) happens at the
[BLOCKING] founder checkpoint (Task 5) once DEBUG_KEY_FLOW_* env-blobs are staged
in Railway. Test creds are SEPARATE blobs — NEVER user-real keys.

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
from typing import Literal

import structlog
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from services import encryption  # decrypt_credentials per planning-time read

logger = structlog.get_logger()
log = logging.getLogger("quantalyze.debug_key_flow")

router = APIRouter(prefix="/internal/debug-key-flow", tags=["internal", "phase-16"])


def _verify_internal_token(token: str | None) -> None:
    expected = os.getenv("INTERNAL_API_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="INTERNAL_API_TOKEN not configured")
    if not token or not secrets.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="Invalid internal token")


Broker = Literal["okx", "binance", "bybit"]


def _read_test_creds(broker: Broker) -> dict[str, str]:
    """Read DEBUG_KEY_FLOW_<BROKER>_{KEY,SECRET,PASSPHRASE} env-blobs.

    Each value is a Fernet-encrypted blob (KEK encrypted). Returns the decrypted
    plaintext dict. NEVER caches; NEVER persists.

    NOTE: encryption.decrypt_credentials is invoked with the env-blob value here
    (1-arg form). The Phase 7 test path mocks this — production wiring is
    completed at the founder Task-5 checkpoint when the real KEK-Fernet wrapping
    layout is finalized for the DEBUG_KEY_FLOW_* env vars.
    """
    upper = broker.upper()
    blobs = {
        "key": os.getenv(f"DEBUG_KEY_FLOW_{upper}_KEY"),
        "secret": os.getenv(f"DEBUG_KEY_FLOW_{upper}_SECRET"),
        "passphrase": os.getenv(f"DEBUG_KEY_FLOW_{upper}_PASSPHRASE"),  # may be None for non-OKX
    }
    if not blobs["key"] or not blobs["secret"]:
        raise HTTPException(
            status_code=503,
            detail=f"DEBUG_KEY_FLOW_{upper}_* env-blobs not configured",
        )
    decrypted: dict[str, str] = {}
    for k, v in blobs.items():
        if v is None:
            continue
        decrypted[k] = encryption.decrypt_credentials(v)  # adjust per actual API at founder-gate
    return decrypted


class StepRequest(BaseModel):
    broker: Broker


class StepResponse(BaseModel):
    step: str
    status: Literal["ok", "error"]
    duration_ms: int
    detail: dict | None = None
    error: dict | None = None


@router.post("/validate", response_model=StepResponse)
async def validate_key(
    body: StepRequest,
    x_internal_token: str | None = Header(default=None),
) -> StepResponse:
    _verify_internal_token(x_internal_token)
    t0 = time.monotonic()
    try:
        creds = _read_test_creds(body.broker)
        # Placeholder — preserves StepResponse shape. Real call wired at founder-gate.
        validation_result = {"valid": True, "broker": body.broker, "fields_decrypted": list(creds.keys())}
        return StepResponse(
            step="validate_key",
            status="ok",
            duration_ms=int((time.monotonic() - t0) * 1000),
            detail=validation_result,
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


@router.post("/encrypt", response_model=StepResponse)
async def encrypt_key(
    body: StepRequest,
    x_internal_token: str | None = Header(default=None),
) -> StepResponse:
    _verify_internal_token(x_internal_token)
    t0 = time.monotonic()
    try:
        creds = _read_test_creds(body.broker)
        # Re-encrypt round-trip placeholder — proves env-blob decrypt path is healthy.
        encrypted_summary = {
            "broker": body.broker,
            "decrypted_field_lengths": {k: len(v) for k, v in creds.items()} if creds else {},
        }
        return StepResponse(
            step="encrypt_key",
            status="ok",
            duration_ms=int((time.monotonic() - t0) * 1000),
            detail=encrypted_summary,
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
    try:
        # Single-page trades fetch placeholder — preserves StepResponse shape.
        # _read_test_creds is invoked to prove the env-blob decrypt path is
        # healthy; the result is intentionally unused until the real
        # services.exchange.fetch_raw_trades wiring lands at founder-gate.
        _read_test_creds(body.broker)
        trades_summary = {"broker": body.broker, "fetched": 0}
        return StepResponse(
            step="fetch_trades",
            status="ok",
            duration_ms=int((time.monotonic() - t0) * 1000),
            detail=trades_summary,
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
