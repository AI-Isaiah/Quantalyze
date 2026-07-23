import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from models.schemas import ValidateKeyRequest, FetchTradesRequest
from services.exchange import aclose_exchange, create_exchange, validate_key_permissions, fetch_all_trades, parse_since_ms, fetch_usdt_balance, AUTH_FAILED_DETAIL, RATE_LIMITED_DETAIL, NETWORK_ERROR_DETAIL
from services.encryption import encrypt_credentials, decrypt_credentials, get_kek, get_kek_version
from services.sfox_client import SfoxApiError, SFOX_PROD_BASE_URL
from services.sfox_factory import make_sfox_client
from services.closed_sets import (
    sfox_enabled_server,
    SFOX_DISABLED_DETAIL,
    mt5_enabled_server,
    MT5_DISABLED_DETAIL,
    MT5_MASTER_PASSWORD_DETAIL,
    MT5_WRONG_SERVER_DETAIL,
)
from services.mt5_client import Mt5Client, Mt5ClientError, MT5_REQUEST_TIMEOUT_S
from services.mt5_validation import (
    Mt5ValidationError,
    classify_mt5_login_error,
    is_trade_capable,
    mt5_probe_request,
    parse_mt5_credentials,
)
from services.db import get_supabase, db_execute, one, rows
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["exchange"])
logger = logging.getLogger("quantalyze.analytics")
limiter = Limiter(key_func=get_remote_address)

# The event-loop bound for the SYNCHRONOUS Mt5Client probe (login+read+order_check
# run off the loop via asyncio.to_thread). A margin above the client's own rpyc
# sync_request_timeout so a hung terminal fails its round-trip first and this outer
# wait_for is the last-resort ceiling — a hung RPyC pipe must NEVER wedge the
# event loop / healthz (the v1.11 WEDGE-01 failure class, T-135-12).
_MT5_PROBE_TIMEOUT_S = MT5_REQUEST_TIMEOUT_S + 5.0


class EncryptKeyRequest(BaseModel):
    exchange: str
    api_key: str
    api_secret: str
    passphrase: str | None = None


async def _validate_sfox_key(api_key: str) -> dict[str, Any]:
    """Validate a sFOX Bearer token via the non-ccxt SfoxClient (SFOX-03).

    Proof-of-auth + read access is a single `get_balances()` (GET
    /v1/user/balance) — a list body (even empty) means the token authenticates
    AND can read. On success we return ``read_only=True`` asserted STRUCTURALLY,
    NOT probed: the SfoxClient adapter has no order/withdraw/transfer surface
    (Phase-118 WR-03, HTTP verb hardcoded to GET) and sFOX exposes no per-key
    scope endpoint, so we NEVER emit a probed ``{read, trade, withdraw}`` triple
    or claim an observed read-only scope (A1 — no invented data).

    Error mapping (F4 — every arm fails CLOSED; NEVER returns {"valid": true},
    and only a genuine 401/403 blames the user's credentials):
      * 401/403 → HTTPException(400, AUTH_FAILED_DETAIL) — the exact same string
        the ccxt AUTH_FAILED arm emits → TS classifyKeyValidationError maps it to
        KEY_AUTH_FAILED with zero TS edits.
      * 429 → HTTPException(400, RATE_LIMITED_DETAIL) — the SAME shared string the
        ccxt RateLimitExceeded arm emits → KEY_RATE_LIMIT. A throttle is upstream,
        not a bad key (recreates the 110.1 honesty fix for sFOX).
      * 5xx or status==0 (transport/shape) → HTTPException(400, NETWORK_ERROR_DETAIL)
        — the SAME shared string the ccxt NetworkError arm emits, mapped identically.
      * a malformed-token ValueError raised by aiohttp at request time (F5) →
        HTTPException(400, AUTH_FAILED_DETAIL): a control-char token IS a
        credential problem, and must not escape as an unhandled 500.

    `api_secret` is intentionally ignored: sFOX auth is a single Bearer token
    (Q1 worker contract), so the branch takes only `api_key`. No proxy is wired
    here (the phase-121 static-IP egress seam is threaded later).
    """
    # IN-01: an empty/whitespace-only Bearer token cannot authenticate.
    # SfoxClient.__init__ raises ValueError("… non-empty api_key") on an empty
    # token (sfox_client.py:108); constructed BELOW the try/finally that
    # ValueError would escape the fail-closed mapping and surface as an unhandled
    # FastAPI 500 (an 8-space token arrives here as "" after analytics-client's
    # trimCredential). Guard up front and fail CLOSED with the SAME AUTH_FAILED
    # string a bad ccxt key emits, so the TS classifyKeyValidationError maps it to
    # KEY_AUTH_FAILED — matching this function's documented fail-closed contract
    # rather than leaking a raw 500. Keeps the ctor's non-empty invariant intact.
    if not api_key or not api_key.strip():
        raise HTTPException(status_code=400, detail=AUTH_FAILED_DETAIL)
    try:
        client = make_sfox_client(api_key, base_url=SFOX_PROD_BASE_URL)
    except ValueError:
        # A CONSTRUCTION-time ValueError is a SERVER egress-proxy misconfig
        # (WORKER_EGRESS_PROXY_URL malformed) — NOT the user's key. It was thrown
        # OUTSIDE the get_balances try below, so it used to escape as an unhandled
        # 500 + Sentry traceback (and pre-fix carried the proxy token in the
        # message). Fail as a clean 503 — never a 500, never a misleading
        # AUTH_FAILED that blames the user's credentials. The factory's ValueError
        # is already secret-free (sfox_factory.py), but do not log it here either.
        logger.error("validate_key: sFOX client construction failed (egress proxy misconfig)")
        raise HTTPException(status_code=503, detail=NETWORK_ERROR_DETAIL)
    try:
        await client.get_balances()
        return {"valid": True, "read_only": True}
    except SfoxApiError as e:
        if e.status in (401, 403):
            raise HTTPException(status_code=400, detail=AUTH_FAILED_DETAIL)
        if e.status == 429:
            # F4: a throttle is an UPSTREAM condition, not bad credentials —
            # recreates the 110.1 honesty fix the ccxt path already made. Emit the
            # SAME shared RATE_LIMITED_DETAIL the ccxt RateLimitExceeded arm emits,
            # so classifyKeyValidationError maps it to KEY_RATE_LIMIT (not the
            # misleading "check your credentials"). Fails CLOSED (never valid:true);
            # logged at WARNING (not exception) since a throttle is not Sentry-grade.
            logger.warning("validate_key: sFOX rate-limited (status=429)")
            raise HTTPException(status_code=400, detail=RATE_LIMITED_DETAIL)
        # 5xx (exchange down) or status==0 (transport/shape blip): an UPSTREAM /
        # transport problem, never the user's key. Same shared NETWORK_ERROR_DETAIL
        # the ccxt NetworkError arm emits so the TS classifier maps it identically.
        # Still fails CLOSED; WARNING-level (mirrors the ccxt transient arms) so a
        # transient blip no longer spams Sentry via logger.exception.
        logger.warning("validate_key: sFOX transient upstream failure (status=%s)", e.status)
        raise HTTPException(status_code=400, detail=NETWORK_ERROR_DETAIL)
    except ValueError:
        # F5: a token with an embedded control char (\n / \r survive
        # trimCredential, which strips only LEADING/TRAILING whitespace) makes
        # aiohttp raise a bare ValueError("Forbidden control character in
        # header ...") at request time — neither SfoxApiError nor
        # aiohttp.ClientError, so it would otherwise escape this function as an
        # unhandled FastAPI 500 (same class as the IN-01 empty-token wart). A
        # malformed token IS a credential problem: fail CLOSED with the honest
        # AUTH_FAILED classification (400 → KEY_AUTH_FAILED), never a 500.
        # Deliberately DO NOT log the exception: aiohttp's message can embed the
        # offending header value (the token), so this branch never writes it
        # anywhere. Fails CLOSED — never returns {"valid": true}.
        raise HTTPException(status_code=400, detail=AUTH_FAILED_DETAIL)
    finally:
        await client.aclose()


async def _validate_mt5_key(
    api_key: str, api_secret: str, passphrase: str | None
) -> dict[str, Any]:
    """Validate an MT5 investor login via the Phase-134 read-only ``Mt5Client``
    (RPyC facade) — the MT5SRC-02 worker half.

    This is the ``is_mt5`` clone of ``_validate_sfox_key`` (same fail-CLOSED
    posture: every arm 400s and NEVER returns ``{"valid": true}`` on any failure),
    with the MT5-specific divergences:

    Credential-slot reuse (the ONE MT5 wrinkle, documented LOUDLY at the encrypt
    chokepoint below): login -> ``api_key``, investor password -> ``api_secret``,
    broker server -> ``passphrase``. No new columns; the Next.js caller populates
    these slots in this order and this branch reads them back identically.

    read_only=True is asserted STRUCTURALLY (the sFOX A1 posture): ``Mt5Client``
    composes ONLY read methods + the ``order_check`` probe, exposes no trade
    surface and no ``__getattr__`` passthrough — so this NEVER emits a probed
    ``{read, trade, withdraw}`` scope triple. On TOP of that structural guarantee
    it runs a BEHAVIORAL investor-vs-master probe sFOX has no analog for: a
    trade-capable (master) login is REJECTED with a targeted 400 and is NEVER
    persisted (the TS caller only proceeds to /encrypt-key after ``valid:true``).

    THREE distinguishable failure paths (each pinned to the exact 135-01 contract
    string so the TS ``classifyKeyValidationError`` substring matcher routes them
    with zero TS edits):
      * bad creds -> ``AUTH_FAILED_DETAIL`` (KEY_AUTH_FAILED byte-identity)
      * master (trade-capable) login -> ``MT5_MASTER_PASSWORD_DETAIL`` (persisted
        NOTHING)
      * wrong / missing broker server -> ``MT5_WRONG_SERVER_DETAIL``

    The synchronous RPyC probe runs off the event loop
    (``asyncio.to_thread`` + a ``wait_for`` ceiling) — a blocking round-trip on
    the loop reopens the v1.11 WEDGE-01 wedge (T-135-12). The forbidden
    trade-submit method (named here in prose only, without call parentheses, so
    the grep gate stays clean) is NEVER wrapped — the probe is ``order_check``
    only.
    """
    # Offline pre-probe credential-shape validation via the ONE mt5_validation
    # seam (server-required, numeric login, non-blank password, in the canonical
    # server->login->password ordering). BOTH this router and Mt5Adapter.validate
    # call parse_mt5_credentials, so every missing/blank combination classifies
    # IDENTICALLY on the two paths and cannot drift (WR-01). Guard BEFORE any
    # client construction — never a live probe on a structurally-invalid request.
    try:
        login, investor_pw, server = parse_mt5_credentials(
            api_key, api_secret, passphrase
        )
    except Mt5ValidationError as e:
        # wrong_server -> the required/mismatched broker-server copy
        # (distinguishable from bad-password by wording, so the wizard surfaces a
        # distinct remedy); auth -> the byte-identical AUTH_FAILED string a bad
        # ccxt key emits (-> KEY_AUTH_FAILED, zero TS edits). Both fail CLOSED with
        # a 400, never a 500, never {"valid": true}.
        if e.kind == "wrong_server":
            raise HTTPException(status_code=400, detail=MT5_WRONG_SERVER_DETAIL)
        raise HTTPException(status_code=400, detail=AUTH_FAILED_DETAIL)

    # Gateway config: a missing/malformed MT5_GATEWAY_HOST / MT5_GATEWAY_PORT is a
    # SERVER misconfig, NEVER the user's key — mirror the sfox construction-time
    # 503 posture. Log secret-free (no login/pw/server values) and fail as a clean
    # 503, never a 500, never a misleading AUTH_FAILED. (Phase 139 sets these live;
    # unset now = the server-misconfig path.)
    host = os.getenv("MT5_GATEWAY_HOST")
    port_raw = os.getenv("MT5_GATEWAY_PORT")
    if not host or not port_raw:
        logger.error("validate_key: MT5 gateway not configured (server misconfig)")
        raise HTTPException(status_code=503, detail=NETWORK_ERROR_DETAIL)
    try:
        port = int(port_raw)
    except ValueError:
        logger.error("validate_key: MT5 gateway port malformed (server misconfig)")
        raise HTTPException(status_code=503, detail=NETWORK_ERROR_DETAIL)

    client = Mt5Client(host, port)
    try:
        # Mt5Client is SYNCHRONOUS blocking RPyC. Run the login+read+probe body off
        # the event loop and bound it with a wait_for ceiling so a hung terminal
        # can never wedge the loop / healthz (WEDGE-01, T-135-12). The terminal-
        # restart recovery machinery is Phase 137 — not built here.
        def _probe() -> tuple[dict[str, Any], dict[str, Any]]:
            client.login(login, investor_pw, server)  # falsy -> Mt5ClientError
            info = client.account_info()  # proves auth + read
            probe = client.order_check(mt5_probe_request())  # PROBE ONLY
            return info, probe

        try:
            info, probe = await asyncio.wait_for(
                asyncio.to_thread(_probe), timeout=_MT5_PROBE_TIMEOUT_S
            )
        except asyncio.TimeoutError:
            # A hung upstream bridge — transient, not the user's key. Fail CLOSED
            # with the shared NETWORK detail (mirrors the sfox transient arm);
            # WARNING (not exception) so a blip does not spam Sentry.
            logger.warning("validate_key: MT5 probe timed out (upstream bridge hung)")
            raise HTTPException(status_code=400, detail=NETWORK_ERROR_DETAIL)
        except Mt5ClientError as e:
            # Classify via the ONE mt5_validation seam. NEVER log the interpolated
            # remote text (it can carry the scrubbed code only) and never
            # login/pw/server values.
            kind = classify_mt5_login_error(e)
            if kind == "auth":
                raise HTTPException(status_code=400, detail=AUTH_FAILED_DETAIL)
            if kind == "wrong_server":
                raise HTTPException(status_code=400, detail=MT5_WRONG_SERVER_DETAIL)
            # transient -> fail CLOSED with the shared NETWORK detail (sfox F4
            # posture: never auth-failed, never valid). WARNING with the scrubbed
            # code only.
            logger.warning(
                "validate_key: MT5 transient upstream failure (code=%s)", e.code
            )
            raise HTTPException(status_code=400, detail=NETWORK_ERROR_DETAIL)

        if is_trade_capable(info, probe):
            # Master (trade-capable) login REJECTED — never persisted (the TS
            # caller only encrypts after valid:true). The EoP gate (T-135-09).
            raise HTTPException(
                status_code=400, detail=MT5_MASTER_PASSWORD_DETAIL
            )

        # Investor (read-only) login. read_only=True is STRUCTURAL (Mt5Client
        # exposes no trade surface — the sFOX A1 posture), PLUS the behavioral
        # investor-vs-master probe above that sfox lacks.
        return {"valid": True, "read_only": True}
    finally:
        # Idempotent close on EVERY path after construction (success,
        # master-reject, auth/server fail, transient/timeout) so the terminal
        # session never leaks.
        client.close()


@router.post("/validate-key")
@limiter.limit("100/hour")
async def validate_key(request: Request, req: ValidateKeyRequest) -> dict[str, Any]:
    """Validate that an API key is read-only and functional.

    Phase 18 / observability: the swallowed ccxt exception classes are
    now logged via `logger.exception` so Railway logs surface the actual
    upstream error (e.g., `ccxt.PermissionDenied: 451 Unavailable`) with
    full traceback. User-facing `detail` strings are unchanged so the
    Next.js classifier in `/api/strategies/create-with-key` and the
    wizard envelope wording remain stable. (Pre-fix: a bare `except
    Exception:` discarded the ccxt class + message, leaving operators
    debug-blind on the recurring "code: UNKNOWN" wizard fail. Found
    2026-05-05 via Bybit E2E + Railway log archaeology.)
    """
    # SFOX-03: sFOX is NOT a ccxt exchange, so it must NOT route through
    # create_exchange/EXCHANGE_CLASSES (a dict of ccxt classes — sfox
    # ValueErrors there). Intercept BEFORE the ccxt path and validate via the
    # Phase-118 non-ccxt SfoxClient. The ccxt branch below is byte-for-byte
    # unchanged for every real exchange.
    if req.exchange == "sfox":
        # F2 (Phase 122 — STRUCTURAL worker gate): sFOX is founder-gated until
        # go-live. Fail CLOSED with an honest "not yet available" 400 BEFORE
        # _validate_sfox_key constructs a client or fires a live get_balances()
        # probe — never a live probe when disabled, never a false AUTH_FAILED.
        # A clean 400 (not a 500) so the TS layer surfaces it as a normal
        # rejection. Mirrors the TS isSfoxEnabledServer() gate at the three key
        # routes; defense-in-depth for any direct/worker caller of /validate-key.
        if not sfox_enabled_server():
            raise HTTPException(status_code=400, detail=SFOX_DISABLED_DETAIL)
        return await _validate_sfox_key(req.api_key)

    # MT5SRC-02 (Phase 135): MT5 is NOT a ccxt exchange — it speaks RPyC to a
    # terminal bridge, never ccxt — so it must NOT route through
    # create_exchange/EXCHANGE_CLASSES. Intercept BEFORE the ccxt path (cloning the
    # sfox intercept shape + F2 gate comment) and validate via the Phase-134
    # read-only Mt5Client. The ccxt branch below stays byte-for-byte unchanged.
    if req.exchange == "mt5":
        # Go-dark gate (Q-C, mirrors the sfox F2 gate): MT5 is founder-gated until
        # go-live (Phase 139). Fail CLOSED with an honest "not yet available" 400
        # BEFORE any client construction or live probe — never a live probe when
        # disabled, never a false AUTH_FAILED. Mirrors the TS isMt5EnabledServer()
        # gate at the key routes; defense-in-depth for any direct/worker caller.
        if not mt5_enabled_server():
            raise HTTPException(status_code=400, detail=MT5_DISABLED_DETAIL)
        return await _validate_mt5_key(req.api_key, req.api_secret, req.passphrase)

    try:
        exchange = create_exchange(req.exchange, req.api_key, req.api_secret, req.passphrase)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "validate_key: create_exchange(%s) failed — %s: %s",
            req.exchange,
            type(e).__name__,
            e,
        )
        raise HTTPException(status_code=400, detail="Failed to initialize exchange connection")

    try:
        result = await validate_key_permissions(exchange)
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "validate_key: validate_key_permissions raised on %s — %s: %s",
            req.exchange,
            type(e).__name__,
            e,
        )
        raise HTTPException(status_code=500, detail="Key validation failed. Please check your credentials.")
    finally:
        try:
            await aclose_exchange(exchange)
        except Exception:
            pass

    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])

    return {"valid": result["valid"], "read_only": result["read_only"]}


@router.post("/encrypt-key")
@limiter.limit("100/hour")
async def encrypt_key(request: Request, req: EncryptKeyRequest) -> dict[str, Any]:
    """Encrypt exchange credentials for storage. Returns encrypted fields to store in Supabase."""
    try:
        kek = get_kek()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Encryption not configured")

    # ==============================================================================
    # MT5 CREDENTIAL-SLOT MAPPING (MT5SRC-02, CONTEXT-locked) — THE ONE CHOKEPOINT
    # ------------------------------------------------------------------------------
    # For exchange == 'mt5' the three MT5 login fields REUSE the existing encrypted
    # credential slots — NO new columns:
    #     login            -> api_key
    #     investor password -> api_secret
    #     broker server     -> passphrase
    # The Next.js key wizard populates these slots in exactly this order, and the
    # worker is_mt5 validate branch (_validate_mt5_key above) reads them back
    # identically (api_key=login, api_secret=investor pw, passphrase=broker server).
    # encrypt_credentials is exchange-agnostic — it just encrypts whatever three
    # fields it is handed — so there is deliberately NO mt5 carve-out here; this
    # comment IS the contract. Change the slot order on ONE side and MT5 validate
    # silently breaks, so the mapping lives loudly at this single chokepoint.
    # ==============================================================================
    encrypted = encrypt_credentials(req.api_key, req.api_secret, req.passphrase, kek)
    return encrypted


@router.post("/fetch-trades")
@limiter.limit("10/hour")
async def fetch_trades(request: Request, req: FetchTradesRequest) -> dict[str, Any]:
    """Fetch trades from exchange for a strategy using stored encrypted API key."""
    try:
        kek = get_kek()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Encryption not configured")

    supabase = get_supabase()

    # Look up strategy
    strategy_result = one(supabase.table("strategies").select("id, user_id, api_key_id").eq(
        "id", req.strategy_id
    ).single().execute())

    if not strategy_result or not strategy_result.get("api_key_id"):
        raise HTTPException(status_code=400, detail="Strategy has no connected API key")

    # Fetch encrypted API key and verify ownership.
    #
    # C-0202 (audit-2026-05-07) — filter on is_active=True. A deactivated
    # key (user revoked, admin disabled, sole-source purge) must NOT be
    # usable by /fetch-trades; otherwise the deactivation gate becomes a
    # paper-only control. .single() returns no row when the filter rejects,
    # and the existing 404 below fires with an operator-safe message
    # (doesn't disclose that the key exists but is deactivated).
    api_key_row = one(supabase.table("api_keys").select("*").eq(
        "id", strategy_result["api_key_id"]
    ).eq("is_active", True).single().execute())

    if not api_key_row:
        raise HTTPException(status_code=404, detail="API key not found")

    # Verify the API key belongs to the same user as the strategy
    if api_key_row.get("user_id") != strategy_result.get("user_id"):
        raise HTTPException(status_code=403, detail="API key does not belong to strategy owner")

    key_data = api_key_row

    # Decrypt credentials
    try:
        api_key, api_secret, passphrase = decrypt_credentials(key_data, kek)
    except Exception:
        logger.error("Failed to decrypt API key %s", key_data["id"])
        raise HTTPException(status_code=500, detail="Failed to decrypt credentials")

    exchange = create_exchange(key_data["exchange"], api_key, api_secret, passphrase)
    since_ms = parse_since_ms(key_data.get("last_sync_at"))

    # PR #260 follow-up: if this strategy's existing trade history is below
    # the gate threshold, ignore `since_ms` and force a full-lookback walk.
    # A poisoned checkpoint scenario (e.g. v0.24.5.10's pre-fix Bybit code
    # advanced `last_sync_at` after a truncated 7-day pull) leaves stale
    # users in a state where every re-verify only walks `[last_sync_at..now]`
    # and the trades table can never accumulate enough history to pass the
    # gate. The data fix for known affected users went in directly; this
    # guard prevents the same pattern recurring from any future truncation
    # regression.
    if since_ms is not None:
        try:
            span = (
                supabase.table("trades")
                .select("timestamp")
                .eq("strategy_id", req.strategy_id)
                .order("timestamp", desc=False)
                .limit(1)
                .execute()
            )
            span_max = (
                supabase.table("trades")
                .select("timestamp")
                .eq("strategy_id", req.strategy_id)
                .order("timestamp", desc=True)
                .limit(1)
                .execute()
            )
            _span_rows = rows(span)
            _span_max_rows = rows(span_max)
            earliest = _span_rows[0]["timestamp"] if _span_rows else None
            latest = _span_max_rows[0]["timestamp"] if _span_max_rows else None
            if earliest and latest:
                from datetime import datetime as _dt

                e = _dt.fromisoformat(earliest.replace("Z", "+00:00"))
                lt = _dt.fromisoformat(latest.replace("Z", "+00:00"))
                span_days = (lt - e).total_seconds() / 86400.0
                STRATEGY_GATE_MIN_DAYS = 7
                if span_days < STRATEGY_GATE_MIN_DAYS:
                    logger.info(
                        "fetch-trades: trade-span %.2fd < %dd for strategy %s; ignoring stale since_ms checkpoint to walk full lookback",
                        span_days,
                        STRATEGY_GATE_MIN_DAYS,
                        req.strategy_id,
                    )
                    since_ms = None
        except Exception as e:
            # Best-effort guard. If the trade-table probe fails for any
            # reason (RLS shift, schema drift, network blip) we fall
            # through to the original since_ms — degrades to pre-guard
            # behaviour, never worse.
            logger.warning("fetch-trades clamp probe failed: %s", e)

    try:
        trades = await fetch_all_trades(exchange, since_ms=since_ms)
        account_balance = await fetch_usdt_balance(exchange)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to fetch trades from exchange")
    finally:
        await aclose_exchange(exchange)

    # Store trades atomically with advisory lock (prevents concurrent sync race).
    # Pass `trades` (list[dict]) directly — pre-serializing via json.dumps causes
    # PostgREST to cast the JSON string into a JSONB scalar string instead of a
    # JSONB array, which trips migration 007's `jsonb_array_elements(p_trades)`
    # with 22023 "cannot extract elements from a scalar". The supabase Python
    # client does the JSON serialization once on the request body.
    if trades:
        result = supabase.rpc("sync_trades", {
            "p_strategy_id": req.strategy_id,
            "p_trades": trades,
        }).execute()
        logger.info("Synced %s trades for strategy %s (atomic)", result.data, req.strategy_id)

    # Always advance the sync cursor (even when no new trades) to avoid re-fetching the same window
    update_data: dict[str, Any] = {"last_sync_at": datetime.now(timezone.utc).isoformat()}
    if account_balance is not None:
        update_data["account_balance_usdt"] = account_balance
    supabase.table("api_keys").update(update_data).eq("id", key_data["id"]).execute()

    return {"trades_fetched": len(trades), "strategy_id": req.strategy_id}
