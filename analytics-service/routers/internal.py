"""Internal-only routes — VPC-gated by ``X-Internal-Token`` shared secret.

Sprint 5 Task 5.8 — Live Key Permission Viewer.

Why a separate router
---------------------
The other routers in this service auth via ``X-Service-Key`` (the global
service-to-service header validated in ``main.verify_service_key`` middleware).
This file intentionally uses a *separate* shared secret (``INTERNAL_API_TOKEN``)
because the routes here are even narrower: they're called only by the Next.js
app's per-key permission proxy, and we want a distinct rotateable secret so a
leak of ``SERVICE_KEY`` doesn't automatically grant access to the live-probe
endpoint.

v1 boundary note
----------------
"VPC-only" in v1 means: the secret must match. The middleware in ``main.py``
already enforces ``SERVICE_KEY`` for everything under ``/api/*`` — those
checks stack on top of this one for ``/internal/*``. Sprint 7 will add
network-level allowlist (Railway/Vercel private networking) so the endpoint
becomes physically unreachable from the public internet.

Per-key rate limit
------------------
We use a tiny in-process token bucket keyed by ``key_id`` (10 calls/minute).
The analytics service is single-process per the existing architecture, so an
in-memory bucket is sufficient — multi-instance deploys would need Redis.
The cap is intentionally low because each call decrypts a credential and
hits the exchange.
"""

from __future__ import annotations

import logging
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from services.db import get_supabase
from services.encryption import decrypt_credentials, get_kek
from services.exchange import create_exchange
from services.key_permissions import detect_permissions

router = APIRouter(prefix="/internal", tags=["internal"])
logger = logging.getLogger("quantalyze.analytics")


# ---------------------------------------------------------------------------
# Per-key token bucket (10 / minute)
# ---------------------------------------------------------------------------

_RATE_LIMIT_MAX = 10
_RATE_LIMIT_WINDOW_S = 60

# {key_id: [monotonic_ts, monotonic_ts, ...]} — only entries inside the window
# are kept; older ones are pruned on each touch.
_call_log: dict[str, list[float]] = {}


def _consume_rate_limit(key_id: str) -> bool:
    """Return True if the call should proceed, False if rate-limited.

    A monotonic-time list-prune approach keeps memory usage O(allowed bursts)
    per key rather than per second. We don't need exact precision — slowapi's
    decorator-based limiter works on the IP key, which is the wrong dimension
    for "per-key" here.
    """
    now = time.monotonic()
    window_start = now - _RATE_LIMIT_WINDOW_S
    bucket = _call_log.get(key_id, [])
    # Prune expired calls
    bucket = [ts for ts in bucket if ts >= window_start]
    if len(bucket) >= _RATE_LIMIT_MAX:
        _call_log[key_id] = bucket  # persist pruned list
        return False
    bucket.append(now)
    _call_log[key_id] = bucket
    return True


def _reset_rate_limit() -> None:
    """Test-only helper to clear the bucket between cases."""
    _call_log.clear()


# ---------------------------------------------------------------------------
# Internal-token gate
# ---------------------------------------------------------------------------


def _verify_internal_token(request: Request) -> None:
    """Raise 403 if the X-Internal-Token header doesn't match.

    Constant-time compare (``secrets.compare_digest``) — non-negotiable on
    auth headers. A naive ``==`` is timing-side-channel vulnerable.
    """
    expected = os.getenv("INTERNAL_API_TOKEN")
    if not expected:
        # Fail closed: an unconfigured secret means the route is not safe.
        logger.error("INTERNAL_API_TOKEN not set; rejecting /internal call")
        raise HTTPException(status_code=403, detail="Internal API not configured")

    provided = request.headers.get("X-Internal-Token", "")
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="Forbidden")


# ---------------------------------------------------------------------------
# POST /internal/keys/{key_id}/permissions
# ---------------------------------------------------------------------------


@router.post("/keys/{key_id}/permissions")
async def get_key_permissions(key_id: str, request: Request) -> dict:
    """Return live ``{read, trade, withdraw}`` scopes for an api_keys row.

    Flow:
      1. Auth via ``X-Internal-Token`` (constant-time compare).
      2. Per-key rate limit (10/min, in-memory token bucket).
      3. Audit insert into ``key_permission_audit`` (caller_ip, requested_at).
         Best-effort — a write failure here logs and continues; we'd rather
         answer the call than fail closed on an audit hiccup.
      4. Load + decrypt the api_keys row.
      5. Open a CCXT exchange + call ``detect_permissions`` (TTL-cached).
      6. Return the triple plus a ``detected_at`` ISO timestamp.

    Errors:
      403 — bad/missing X-Internal-Token, or INTERNAL_API_TOKEN unconfigured.
      404 — key_id not found.
      429 — per-key rate limit hit.
      502 — exchange returned an error during the live probe.
    """
    _verify_internal_token(request)

    if not _consume_rate_limit(key_id):
        raise HTTPException(
            status_code=429,
            detail="Too many permission probes for this key. Try again in a moment.",
            headers={"Retry-After": str(int(_RATE_LIMIT_WINDOW_S))},
        )

    supabase = get_supabase()

    # Caller IP — Railway/Vercel forward via X-Forwarded-For. Take the
    # leftmost (original client) entry. Fall back to direct peer.
    forwarded = request.headers.get("x-forwarded-for", "")
    caller_ip: Optional[str]
    if forwarded:
        caller_ip = forwarded.split(",")[0].strip() or None
    else:
        caller_ip = request.client.host if request.client else None

    # Load the api_keys row FIRST. We deliberately insert the audit row
    # AFTER the FK target is confirmed to exist — otherwise an unknown
    # key_id would fire a stream of FK-failing audit inserts and silently
    # log them (the prior ordering swallowed those by best-effort), making
    # 404 attempts invisible to the audit trail.
    api_key_row = supabase.table("api_keys").select("*").eq("id", key_id).maybe_single().execute()
    if not api_key_row.data:
        raise HTTPException(status_code=404, detail="API key not found")

    # Audit: best-effort — never let an audit failure break the call.
    try:
        supabase.table("key_permission_audit").insert({
            "api_key_id": key_id,
            "caller_ip": caller_ip,
        }).execute()
    except Exception as exc:
        logger.warning(
            "key_permission_audit insert failed for key=%s: %s", key_id, exc
        )

    key_data = api_key_row.data

    try:
        kek = get_kek()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Encryption not configured")

    try:
        api_key, api_secret, passphrase = decrypt_credentials(key_data, kek)
    except Exception:
        logger.error("Failed to decrypt API key %s for permission probe", key_id)
        raise HTTPException(status_code=500, detail="Failed to decrypt credentials")

    exchange_name = key_data.get("exchange")
    if not exchange_name:
        raise HTTPException(status_code=502, detail="API key has no exchange set")

    try:
        exchange = create_exchange(exchange_name, api_key, api_secret, passphrase)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=502, detail="Failed to initialise exchange connection")

    try:
        perms = await detect_permissions(exchange, api_key_id=key_id)
    except Exception as exc:
        logger.error(
            "Permission detection failed for key=%s exchange=%s: %s",
            key_id, exchange_name, exc,
        )
        raise HTTPException(status_code=502, detail="Exchange permission probe failed")
    finally:
        try:
            await exchange.close()
        except Exception:
            pass

    return {
        "read": bool(perms.get("read", False)),
        "trade": bool(perms.get("trade", False)),
        "withdraw": bool(perms.get("withdraw", False)),
        "detected_at": datetime.now(timezone.utc).isoformat(),
    }
