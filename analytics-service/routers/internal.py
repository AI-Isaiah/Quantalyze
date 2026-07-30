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
from typing import Any, Optional

import sentry_sdk
from fastapi import APIRouter, HTTPException, Query, Request

from services.db import get_supabase, one
from services.encryption import decrypt_credentials, get_kek
# PYAPI-05 — the status-attributability contract. Every deliberate 5xx/424 in
# this file goes through service_error. Contract: docs/STATUS_CONTRACT.md.
from services.error_contract import service_error
from services.exchange import aclose_exchange, create_exchange
from services.key_permissions import detect_permissions

router = APIRouter(prefix="/internal", tags=["internal"])
logger = logging.getLogger("quantalyze.analytics")


# ---------------------------------------------------------------------------
# KEK-misconfiguration operator signal (PYAPI-06 site 4)
# ---------------------------------------------------------------------------

# A missing/rotated KEK leaves NO operator signal today: internal.py's arm logged
# nothing at all, and the response was a 4xx-shaped "encryption not configured"
# that nobody pages on. It gains one — but BOUNDED. A stale KEK fires on EVERY
# permission probe, and the dashboard renders five badges per page, so an
# unbounded capture turns the signal into a flood that gets muted, which is
# indistinguishable from having no signal.
_KEK_ALERT_WINDOW_S = 300.0
_last_kek_alert_at: float | None = None


def _reset_kek_alert() -> None:
    """Test-only helper to clear the capture window between cases."""
    global _last_kek_alert_at
    _last_kek_alert_at = None


def _alert_kek_unavailable() -> None:
    """Emit at most one Sentry capture per ``_KEK_ALERT_WINDOW_S`` for a KEK
    misconfiguration, plus a structured log on EVERY occurrence.

    Shape cloned from ``services/audit.py:428-467``: ``set_tag`` before the
    capture so events are greppable per-cause, and the whole capture wrapped in
    ``try/except: pass`` because a Sentry transport failure (DSN misconfigured,
    network down before the SDK connected) must never mask or crash the path it
    is reporting on.

    Neither the tag nor the message may carry any substring of any secret — an
    alert that leaks the credential it is complaining about is worse than the
    outage it reports. Nothing here reads the KEK value or the caller's token.
    """
    global _last_kek_alert_at
    # Logged every time: the RATE of rejection is itself the operator's evidence.
    logger.error(
        "KEK unavailable — /internal permission probe rejected; "
        "operator action required (no retry can clear this)"
    )
    now = time.monotonic()
    if _last_kek_alert_at is not None and (now - _last_kek_alert_at) < _KEK_ALERT_WINDOW_S:
        return
    _last_kek_alert_at = now
    try:
        sentry_sdk.set_tag("kek_unavailable", "true")
        sentry_sdk.capture_message(
            "KEK unavailable: /internal permission probe cannot decrypt credentials",
            level="error",
        )
    except Exception:
        pass  # never mask the original failure via a Sentry failure


# ---------------------------------------------------------------------------
# Per-key token bucket (10 / minute)
# ---------------------------------------------------------------------------

_RATE_LIMIT_MAX = 10
_RATE_LIMIT_WINDOW_S = 60
_CALL_LOG_MAX_KEYS = 200

# {key_id: [monotonic_ts, monotonic_ts, ...]} — only entries inside the window
# are kept; older ones are pruned on each touch. Bounded at _CALL_LOG_MAX_KEYS
# entries; oldest insertion is evicted when full so an attacker can't grow
# the dict by spraying random key_ids.
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
    # Bound the total number of tracked keys (dict preserves insertion order).
    while len(_call_log) > _CALL_LOG_MAX_KEYS:
        oldest = next(iter(_call_log))
        if oldest == key_id:
            break
        _call_log.pop(oldest, None)
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
async def get_key_permissions(
    key_id: str,
    request: Request,
    force_refresh: bool = Query(
        False,
        description=(
            "When true, bypass the in-memory permission cache and re-probe "
            "the exchange. Used by the wizard finalize-scope-recheck so a "
            "user broadening their key in the exchange dashboard between "
            "Connect and Submit cannot be masked by the 15-minute TTL."
        ),
    ),
) -> dict[str, Any]:
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

    Errors (PYAPI-05 — see ``docs/STATUS_CONTRACT.md``; the status line alone is
    decidable, and only a genuine service fault counts against our health):
      403 — bad/missing X-Internal-Token, or INTERNAL_API_TOKEN unconfigured.
      404 — key_id not found.
      422 — the caller's own api_keys row has no exchange set (S-10).
      429 — per-key rate limit hit.
      424 — the caller's EXCHANGE did not answer the permission probe (S-12).
            Breaker-inert; `dependency` names the venue.
      500 — KEK unavailable (S-08), the stored key is undecryptable (S-09), or
            OUR adapter construction failed (S-11 — `create_exchange` does no
            network I/O, so its non-ValueError escapes are ours, not the
            venue's; PYAPIFIX-03). All are `retryable:false`: permanent until
            an operator or a deploy acts, and none names a venue.
    """
    _verify_internal_token(request)

    if not _consume_rate_limit(key_id):
        # PYAPIFIX2-03. This throttle answers the service's OWN envelope: the
        # 429 arm of `error_contract._validate` existed but had zero call sites
        # — unadopted, not unreachable — so a throttle carried no machine
        # `code` and read, to a discriminator keying on `body.detail.code`, like
        # any other 4xx. It is the one CALLER fault an identical retry clears.
        #
        # `code` is REUSED from the app-global RateLimitExceeded handler's
        # vocabulary (`main.py`'s 429 JSONResponse), never re-minted — two
        # synonyms for one condition is the defect this contract exists to stop.
        # The explicit `headers={"Retry-After": ...}` kwarg is REPLACED, not
        # dropped: `service_error` sets the header itself from `retry_after` via
        # `_retry_after_headers`. `dependency` is omitted (a 429 is ours to
        # impose, so naming one would mint a breaker key for our own throttle).
        #
        # ⚠️ This makes a THIRD 429 body shape coexist in the service: the flat
        # `main.py` handler body, this nested envelope, and the bare scalar
        # `{"detail": "<string>"}` still raised at match.py / simulator.py /
        # portfolio.py. Deliberate. Picking the winner belongs to TS-23's owner
        # (140.2 / 146) when it migrates those two — not here.
        raise service_error(
            429,
            "RATE_LIMITED",
            retryable=True,
            retry_after=int(_RATE_LIMIT_WINDOW_S),
            detail="Too many permission probes for this key. Try again in a moment.",
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
    api_key_row = one(
        supabase.table("api_keys").select("*").eq("id", key_id).maybe_single().execute()
    )
    # maybe_single().execute() returns None (not an APIResponse) for an unknown
    # key_id; one() collapses both that and a null/non-dict .data to None so the
    # intended 404 fires instead of a 500.
    if not api_key_row:
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

    key_data = api_key_row

    try:
        kek = get_kek()
    except RuntimeError:
        # S-08 / PYAPI-05 + PYAPI-06 — the same missing/rotated KEK as S-07 on
        # /api/encrypt-key, on the endpoint the findings doc never listed. It is
        # permanent until an operator acts, so R-1 makes it 500 retryable:false
        # and it can never feed the breaker.
        _alert_kek_unavailable()
        raise service_error(
            500,
            "KEK_UNAVAILABLE",
            dependency="kek",
            retryable=False,
            detail="Credential encryption is not configured. This needs an operator, not a retry.",
        )

    try:
        api_key, api_secret, passphrase = decrypt_credentials(key_data, kek)
    except Exception:
        # S-09 / PYAPI-05 — A-02. The status was already right; what was missing
        # is the machine code and the explicit retryable:false. A key that cannot
        # be decrypted will never decrypt on an identical retry, so counting it
        # guarantees a self-sustaining outage.
        logger.error("Failed to decrypt API key %s for permission probe", key_id)
        raise service_error(
            500,
            "KEY_UNDECRYPTABLE",
            dependency="kek",
            retryable=False,
            detail="This stored key could not be decrypted. It must be reconnected.",
        )

    exchange_name = key_data.get("exchange")
    if not exchange_name:
        # S-10 / PYAPI-05 — the clearest mis-attribution in the file. A NULL
        # column on the CALLER'S OWN row answered 502, i.e. "our upstream is
        # broken", which is false under any reading and counted against our
        # health. It is caller data: CALLER class, 422.
        raise service_error(
            422,
            "KEY_MISSING_EXCHANGE",
            retryable=False,
            detail="This API key has no exchange set and cannot be probed.",
        )

    # SFOX-05 (F2): sfox is NOT a ccxt exchange — create_exchange RAISES ValueError
    # for it, which the ccxt path below maps to a misleading 400/502 at the
    # finalize-wizard permission probe. Branch BEFORE create_exchange and probe via
    # the GET-only SfoxClient (mirroring routers/exchange._validate_sfox_key). sFOX
    # exposes NO per-key scope endpoint, so read-only is STRUCTURAL (the adapter is
    # GET-only, HTTP verb hardcoded) — a successful auth probe returns the honest
    # structural triple {read:True, trade:False, withdraw:False}; there is no
    # trade/withdraw surface to grant. This closes the phase-119 F2 misdirection.
    if exchange_name == "sfox":
        from services.closed_sets import SFOX_DISABLED_DETAIL, sfox_enabled_server
        from services.sfox_client import SfoxApiError
        from services.sfox_factory import make_sfox_client

        # SFOX-06 founder gate: NEVER fire a live sFOX read while the integration
        # is disabled — mirrors routers/exchange.validate_key + process_key. The DB
        # CHECK admits 'sfox' unconditionally, so a stored sfox key can exist
        # pre-go-live; without this gate the permission probe would decrypt its
        # token and hit sFOX production behind the static-egress proxy.
        if not sfox_enabled_server():
            raise HTTPException(status_code=400, detail=SFOX_DISABLED_DETAIL)

        now_iso = datetime.now(timezone.utc).isoformat()
        api_key_str = api_key.strip()
        if not api_key_str:
            # An empty/whitespace credential cannot authenticate — fail CLOSED
            # (probe_error), never a 500 from SfoxClient.__init__'s empty-key guard.
            return {
                "read": False,
                "trade": False,
                "withdraw": False,
                "probe_error": True,
                "detected_at": now_iso,
            }

        sfox_client = None
        try:
            # Construct INSIDE the try so a make_sfox_client / SfoxClient ctor
            # ValueError (e.g. a misconfigured WORKER_EGRESS_PROXY_URL) fails CLOSED
            # as a probe error, not an unhandled 500 at the finalize-wizard probe.
            sfox_client = make_sfox_client(api_key_str)
            await sfox_client.get_balances()
            # Auth + read proven; the structural read-only triple (no scope probe).
            return {
                "read": True,
                "trade": False,
                "withdraw": False,
                "probe_error": False,
                "detected_at": now_iso,
            }
        except SfoxApiError as exc:
            if exc.status in (401, 403):
                # DEFINITIVE auth rejection: the exchange ANSWERED, rejecting the
                # key. Consistent with routers/exchange._validate_sfox_key, which
                # maps a sfox 401/403 to the definitive AUTH_FAILED — the two
                # surfaces must agree on the same upstream signal, else a revoked
                # key reads as KEY_AUTH_FAILED at connect but a misleading
                # KEY_NETWORK_TIMEOUT ("could not contact") at the finalize probe.
                # Honestly scopeless: reads nothing, probe_error:False (the exchange
                # WAS contacted — not a network/"try again" state).
                # NOTE: the "a 4xx behind the shared static-egress proxy could be a
                # transient IP/WAF block, not a revoked key" ambiguity is real but
                # applies to BOTH surfaces identically; changing it is a founder
                # decision that must move validate_key + this probe together, not a
                # unilateral split here (see deferred-items).
                return {
                    "read": False,
                    "trade": False,
                    "withdraw": False,
                    "probe_error": False,
                    "detected_at": now_iso,
                }
            # 429 / 5xx / shape(0): an UPSTREAM/transport failure that yields NO
            # clear answer about the key -> fail CLOSED transient (probe_error:True,
            # not cached), the ccxt _FAIL_CLOSED semantics. Never a false grant.
            logger.warning(
                "internal permission probe: sFOX transient upstream failure "
                "(status=%s) for key=%s", exc.status, key_id,
            )
            return {
                "read": False,
                "trade": False,
                "withdraw": False,
                "probe_error": True,
                "detected_at": now_iso,
            }
        except ValueError as exc:
            logger.warning(
                "internal permission probe: sFOX client construction failed for "
                "key=%s: %s", key_id, exc,
            )
            return {
                "read": False,
                "trade": False,
                "withdraw": False,
                "probe_error": True,
                "detected_at": now_iso,
            }
        finally:
            if sfox_client is not None:
                await sfox_client.aclose()

    try:
        exchange = create_exchange(exchange_name, api_key, api_secret, passphrase)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        # S-11 / PYAPIFIX-03 (H-2) — the 424 this arm used to raise was wrong,
        # and deliberately reversed here. `services/exchange.py` create_exchange
        # is EXCHANGE_CLASSES.get(), a dict build, cls(config) and two attribute
        # sets: ZERO network I/O. Nothing has been sent to the venue when this
        # fires, so a non-ValueError escape is a TypeError / AttributeError /
        # ImportError / OOM in OUR adapter construction — ours, always.
        #
        # As a 424 it was breaker-inert AND a 4xx, so an outright bug in our own
        # code counted nowhere and paged nobody, while the body told the user
        # their venue was down. R-1 classes it SERVICE-PERMANENT: 500,
        # retryable:false, no Retry-After (only a deploy can clear it).
        #
        # No `dependency`: 140.2 keys its breaker on that field (SEAMCORE-01), so
        # a venue name on a 500 mints a per-dependency breaker key for something
        # that is not ours. Plan 140.1.1-01's C3 membership guard now REFUSES it
        # at construction — this is enforced, not merely intended.
        #
        # Code is ADAPTER_INIT_FAILED, not EXCHANGE_INIT_FAILED: the code names
        # OUR adapter construction. A code that names the exchange contradicts a
        # SERVICE-PERMANENT attribution in the one field 140.2 discriminates on.
        #
        # logger.error, not warning: a 500 is page-worthy, and the sibling arm
        # 18 lines below (permission detection) already uses error. The raw
        # exception stays in the log, never in the body.
        logger.error(
            "Adapter init failed for key=%s exchange=%s (our fault — create_exchange does no network I/O)",
            key_id, exchange_name,
        )
        raise service_error(
            500,
            "ADAPTER_INIT_FAILED",
            retryable=False,
            detail="Something went wrong on our side while opening this connection. Nothing is wrong with your key.",
        )

    try:
        perms = await detect_permissions(
            exchange,
            api_key_id=key_id,
            force_refresh=force_refresh,
        )
    except Exception as exc:
        logger.error(
            "Permission detection failed for key=%s exchange=%s: %s",
            key_id, exchange_name, exc,
        )
        # S-12 / PYAPI-05 — C-12's headline. Binance maintenance, a key revoked
        # at the venue and an IP-allowlist change ALL land here, uncached, five
        # badges per dashboard render. As a 502 that was five recorded failures
        # and a platform-wide trip that then denied Deribit users, the optimizer,
        # admin match and CSV finalize. As a 424 it is zero recorded failures,
        # and the user is told which venue is not answering.
        raise service_error(
            424,
            "EXCHANGE_PROBE_FAILED",
            dependency=str(exchange_name),
            retryable=True,
            detail="Your exchange did not answer the permission check. This is a problem at the venue — try again shortly.",
        )
    finally:
        try:
            await aclose_exchange(exchange)
        except Exception:
            pass

    return {
        "read": bool(perms.get("read", False)),
        "trade": bool(perms.get("trade", False)),
        "withdraw": bool(perms.get("withdraw", False)),
        # Forward probe_error so the Next layer (and downstream
        # KeyPermissionBadge) can distinguish "exchange API down" from
        # "key actually revoked / read missing". Defaults to False so a
        # successful probe stays explicit. See key_permissions._FAIL_CLOSED.
        "probe_error": bool(perms.get("probe_error", False)),
        "detected_at": datetime.now(timezone.utc).isoformat(),
    }
