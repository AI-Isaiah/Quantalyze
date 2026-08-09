import asyncio
import logging
import os
from functools import partial
from datetime import datetime, timezone
from typing import Any, Final
import ccxt
from fastapi import APIRouter, HTTPException, Request
from models.schemas import ValidateKeyRequest, FetchTradesRequest
from services.exchange import aclose_exchange, create_exchange, validate_key_permissions, fetch_all_trades, parse_since_ms, fetch_usdt_balance, AUTH_FAILED_DETAIL, RATE_LIMITED_DETAIL, NETWORK_ERROR_DETAIL, PERMANENT_VALIDATION_ERROR_CODES
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
from services.mt5_client import (
    Mt5Client,
    Mt5ClientError,
    Mt5AccountMismatchError,
    MT5_VALIDATE_REQUEST_TIMEOUT_S,
)
# D-29 — the ONE terminal-lock registry, imported (never re-declared) exactly as the
# three job call sites import it. `_MT5_LEASE_WAIT_S` is re-bound here as a module
# global so this path's bound is monkeypatchable/tunable independently of the batch's
# (which passes wait_s=None and keeps unbounded patient queueing).
from services.mt5_concurrency import (
    _MT5_LEASE_WAIT_S,
    Mt5TerminalBusyError,
    mt5_terminal_lease,
)
from services.mt5_validation import (
    Mt5ValidationError,
    classify_mt5_login_error,
    classify_trade_capability,
    mt5_probe_request,
    parse_mt5_credentials,
    terminal_trade_permission_off,
)
from services.db import get_supabase, db_execute, one, rows
# PYAPI-05 — the status-attributability contract. Every deliberate 5xx/424 in
# this file goes through service_error so the four classes cannot drift apart
# site-by-site. Contract: analytics-service/docs/STATUS_CONTRACT.md.
from services.error_contract import RETRY_AFTER_SECONDS, service_error
# PYAPIFIX2-01 — the FLAT venue-transient shape for the SEVEN classified-upstream
# sites on /api/validate-key. Deliberately NOT service_error: see the C1 raise
# block below and the class's own docstring for why an object at body.detail
# regresses three working wizard codes to UNKNOWN/500 on this seam.
from services.error_contract import VenueTransientHTTPException
# PYAPI-03 — the canonical process-wide Limiter. This module used to declare its
# own ``Limiter(key_func=get_remote_address)``, which (a) keyed on the Railway
# EDGE ip so both 100/hour budgets were platform-wide (G-10/G-11) and (b) got its
# own isolated ``memory://`` storage (G-3), so its counters were invisible to
# ``app.state.limiter``. Same repair, same reasoning as the Phase-19/API-5 fix
# documented in services/rate_limit.py's own docstring.
from services.rate_limit import limiter, tenant_or_platform_key
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["exchange"])
logger = logging.getLogger("quantalyze.analytics")

# --------------------------------------------------------------------------- #
# THE MT5 VALIDATE TIMEOUT CHAIN (153.3 / D-02 + D-03). Nested, and the NESTING is
# the property — each layer must fire strictly before the layer outside it, so a
# failure is diagnosed at the innermost layer that can name a cause:
#
#   initialize / login IPC   45 000 ms   (MT5's own pipe timeout — a real MT5 code)
#   rpyc round-trip          55 000 ms   MT5_VALIDATE_REQUEST_TIMEOUT_S
#   per-stage ceiling        60 000 ms   _MT5_VALIDATE_STAGE_TIMEOUT_S
#   end-to-end deadline      75 000 ms   _MT5_VALIDATE_DEADLINE_S
#   + release (OUTSIDE it)   10 000 ms   _MT5_RELEASE_TIMEOUT_S
#
# Server worst case = 75 + 10 = 85s; plan 153.3-04 adds a bounded 20s lease wait
# for 105s total, inside D-26's 120 000ms client ceiling with 15s of margin. The
# ordering is ASSERTED by tests/test_mt5_validate.py, not assumed.
# --------------------------------------------------------------------------- #

# The per-call MT5 IPC ceilings for the INTERACTIVE validate chain (D-25). Named
# constants, not inline literals, so the whole chain is readable in one place and
# pinnable by the ordering test.
_MT5_VALIDATE_INITIALIZE_TIMEOUT_MS: Final[int] = int(
    os.getenv("MT5_VALIDATE_INITIALIZE_TIMEOUT_MS", "45000")
)
_MT5_VALIDATE_LOGIN_TIMEOUT_MS: Final[int] = int(
    os.getenv("MT5_VALIDATE_LOGIN_TIMEOUT_MS", "45000")
)

# The event-loop bound for ONE stage of the SYNCHRONOUS Mt5Client probe (connect,
# then login+read+order_check — all run off the loop via asyncio.to_thread). A
# margin above the client's own rpyc sync_request_timeout so a hung terminal fails
# its round-trip first and this outer bound is the last-resort ceiling — a hung
# RPyC pipe must NEVER wedge the event loop / healthz (the v1.11 WEDGE-01 failure
# class, T-135-12).
#
# D-02 — what the `+ 5.0` IS: a DIAGNOSTIC ORDERING MARGIN over the inner rpyc
# sync_request_timeout, sized only so the inner client timeout fires FIRST and the
# caller gets a real MT5 error with venue detail instead of a bare
# asyncio.TimeoutError that names nothing. It is NOT a budget, and it must never be
# treated as one: the request's budget is the end-to-end deadline below. Widening
# this margin buys no time and only degrades the diagnosis.
_MT5_VALIDATE_STAGE_TIMEOUT_S: Final[float] = MT5_VALIDATE_REQUEST_TIMEOUT_S + 5.0

# D-03 — the ONE end-to-end deadline for the whole validate probe. Before 153.3 the
# stage ceiling was applied SEPARATELY to connect, probe and close, so the honest
# worst case was ~3x it (~105s) before any terminal contention — a number no client
# budget was ever set against. One deadline now governs connect + probe together.
#
# Arithmetic: it must EXCEED the stage ceiling (60s), so that in the ordinary hung-
# terminal case a stage fires first and carries venue detail, and this fires only
# when the stages themselves are somehow outlived. Together with the release bound
# below (10s) and the bounded lease wait plan 153.3-04 adds (20s), the server worst
# case is 105s — inside D-26's 120 000ms client ceiling with 15s of margin. D-26 and
# its seam-budget gate are Phase 153.4's; this file must stay under that ceiling.
# Env-overridable following the mt5_concurrency.py derived-constant convention, so
# Phase 155 can retune from measurement without a deploy of new code.
_MT5_VALIDATE_DEADLINE_S: Final[float] = float(os.getenv("MT5_VALIDATE_DEADLINE_S", "75.0"))

# The bound on releasing our own transport — deliberately SMALL and deliberately
# OUTSIDE the end-to-end deadline (see the finally block). Mirrors the magnitude of
# services/exchange.py's _ACLOSE_TIMEOUT_S (EXCHANGE_CLOSE_TIMEOUT_S, 10s): giving
# up a socket is not a venue round-trip and must never be given a venue-sized
# budget.
_MT5_RELEASE_TIMEOUT_S: Final[float] = float(os.getenv("MT5_RELEASE_TIMEOUT_S", "10.0"))


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
        # message). Never a misleading AUTH_FAILED that blames the user's
        # credentials. The factory's ValueError is already secret-free
        # (sfox_factory.py), but do not log it here either.
        #
        # S-01 / PYAPI-05: this is SERVICE-PERMANENT, not transient. A malformed
        # env var stays malformed until an operator edits it, so no retry can
        # ever clear it — the previous 503 made the platform breaker trip,
        # expire, re-probe and re-trip forever (A-08/A-25). R-1: 500,
        # retryable:false. See docs/STATUS_CONTRACT.md.
        logger.error("validate_key: sFOX client construction failed (egress proxy misconfig)")
        raise service_error(
            500,
            "EGRESS_PROXY_MISCONFIGURED",
            dependency="egress-proxy",
            retryable=False,
            detail="The service's outbound proxy is misconfigured. This needs an operator, not a retry.",
        )
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
            # PYAPIFIX2-01 (C1). Flat shape, NOT service_error: this reply is
            # classified by a SUBSTRING CASCADE over body.detail
            # (wizardErrors.ts:936-1035, reached via analytics-client.ts's
            # `error.detail ?? …`), so nesting an envelope under `detail` would
            # stringify to "[object Object]" and regress RATE_LIMITED,
            # PROBE_FAILED and DDOS_PROTECTION to UNKNOWN/500. Same reasoning,
            # same shape as main.py's app-global 429 (PYAPI-08): scalar `detail`
            # byte-unchanged so the TS side needs ZERO change (TS-07 is the
            # negative obligation confirming it), machine `code` beside it so
            # 140.3 can retire the cascade. DO NOT "unify" these seven sites onto
            # service_error.
            #
            # ⚠️ STATUS IS 424, REMAPPED FROM 400 BY 140.3-06 (ledger row TS-32).
            # 424 is CALLER'S EXCHANGE in STATUS_CONTRACT.md §5: the third party
            # THE CALLER NAMED is at fault. A 400 here said the caller's request
            # was malformed, which is a false accusation on every one of these
            # seven arms — the venue failed, not the user.
            #
            # The row's stated `BLOCKED-BY: TS-05` named the WRONG row. The remap
            # is BODY-NEUTRAL: main.py's handler serialises {detail, code,
            # recoverable} from `verdict.status_code` independent of status, and
            # the class guard already admits any 400 <= status < 500, so nothing
            # about the body moves and "[object Object]" is structurally
            # impossible. The real blocker was TS-35 — `classifyKeyValidationError`
            # deriving everything from the message string — and it landed in
            # 140.3-05, which made the wizard read `body.code` first.
            #
            # Breaker-safe by construction: 424 is a 4xx, and
            # src/lib/seam-discriminator.ts classifies it `caller-exchange` /
            # `counts:false` / `breakerKey:null`, so a Binance outage cannot open
            # OUR breaker. This flat shape carries no `dependency` — unlike the
            # nested `service_error(424, …)` form, whose `_validate` arm REQUIRES
            # a venue slug there — so the two 424 shapes cannot be confused and
            # the venue vocabulary never collides with SERVICE_DEPENDENCIES.
            raise VenueTransientHTTPException(
                status_code=424,
                code="RATE_LIMITED",
                detail=RATE_LIMITED_DETAIL,
                recoverable=True,
            )
        # 5xx (exchange down) or status==0 (transport/shape blip): an UPSTREAM /
        # transport problem, never the user's key. Same shared NETWORK_ERROR_DETAIL
        # the ccxt NetworkError arm emits so the TS classifier maps it identically.
        # Still fails CLOSED; WARNING-level (mirrors the ccxt transient arms) so a
        # transient blip no longer spams Sentry via logger.exception.
        logger.warning("validate_key: sFOX transient upstream failure (status=%s)", e.status)
        # PYAPIFIX2-01 (C2) — see the C1 block above for the shape rationale. The
        # code matches what the copy already says; vocabulary reused, never
        # re-minted.
        raise VenueTransientHTTPException(
            status_code=424,
            code="NETWORK_UNAVAILABLE",
            detail=NETWORK_ERROR_DETAIL,
            recoverable=True,
        )
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
    # posture. Log secret-free (no login/pw/server values), never a misleading
    # AUTH_FAILED. (Phase 139 sets these live; unset now = the server-misconfig
    # path.)
    #
    # S-02 / S-03 / PYAPI-05: SERVICE-PERMANENT. Unset env is deterministic — it
    # is exactly half of A-01, where the 503 tripped the ONE global breaker key
    # and denied every Deribit user over an MT5 config gap. R-1: 500,
    # retryable:false. The genuinely transient MT5 arms are S-04/S-05 below.
    host = os.getenv("MT5_GATEWAY_HOST")
    port_raw = os.getenv("MT5_GATEWAY_PORT")
    if not host or not port_raw:
        logger.error("validate_key: MT5 gateway not configured (server misconfig)")
        raise service_error(
            500,
            "MT5_GATEWAY_UNCONFIGURED",
            dependency="mt5-gateway",
            retryable=False,
            detail="The MetaTrader gateway is not configured. This needs an operator, not a retry.",
        )
    try:
        port = int(port_raw)
    except ValueError:
        logger.error("validate_key: MT5 gateway port malformed (server misconfig)")
        raise service_error(
            500,
            "MT5_GATEWAY_UNCONFIGURED",
            dependency="mt5-gateway",
            retryable=False,
            detail="The MetaTrader gateway is not configured. This needs an operator, not a retry.",
        )

    # D-03 — the probe is ONE bounded unit. Connect and probe were previously timed
    # SEPARATELY at the same ceiling (and so was the close), so the honest worst case
    # was ~3x it before any terminal contention — a number no client budget was ever
    # set against. They now share a single end-to-end deadline; each keeps its own
    # inner stage ceiling so the inner-fires-first ordering (D-02) survives and a
    # timeout is still attributable to a STAGE.
    #
    # `client` is assigned from inside this coroutine so the finally below can
    # release it even when the END-TO-END deadline fires mid-probe. Keeping that
    # release outside the deadline is load-bearing — see the finally's own comment.
    client: Mt5Client | None = None

    async def _connect_and_probe() -> tuple[
        dict[str, Any], dict[str, Any], dict[str, Any] | None
    ]:
        nonlocal client

        # STAGE 1 — connect.
        #
        # RED-TEAM: Mt5Client.__init__ opens the RPyC socket SYNCHRONOUSLY (a
        # blocking connect). Run construction — and the release in the finally — OFF
        # the event loop under a ceiling; a hung/unreachable gateway connect on the
        # loop would wedge FastAPI / healthz (the v1.11 WEDGE-01 class), exactly what
        # the probe body already guards. A connect failure is a server/bridge fault,
        # never the user's key.
        #
        # D-25: the INTERACTIVE chain is passed per-instance. Raising the module
        # constants instead would lengthen the SEQUENTIAL worker's chain too and
        # reopen WEDGE-01 for every job; the worker keeps 30s / 20 000ms.
        #
        # S-04 / S-05 / PYAPI-05: these two are the GENUINELY transient MT5 arms —
        # the gateway restarts on every deploy — so they stay 503. What they gain is
        # the dependency name (so 140.2 keys the breaker on `mt5-gateway` instead of
        # the single global `breaker:railway` that made A-01 a platform outage) and
        # an honest Retry-After from the ONE literal table in
        # services/error_contract.py.
        try:
            connected = await asyncio.wait_for(
                asyncio.to_thread(
                    lambda: Mt5Client(
                        host,
                        port,
                        request_timeout_s=MT5_VALIDATE_REQUEST_TIMEOUT_S,
                        initialize_timeout_ms=_MT5_VALIDATE_INITIALIZE_TIMEOUT_MS,
                        login_timeout_ms=_MT5_VALIDATE_LOGIN_TIMEOUT_MS,
                    )
                ),
                timeout=_MT5_VALIDATE_STAGE_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            logger.warning("validate_key: MT5 gateway connect timed out (bridge hung)")
            raise service_error(
                503,
                "MT5_GATEWAY_UNREACHABLE",
                dependency="mt5-gateway",
                retryable=True,
                retry_after=RETRY_AFTER_SECONDS["mt5-gateway"],
                detail="The MetaTrader gateway is not responding. Try again shortly.",
            )
        except Exception:  # noqa: BLE001 — connect failure is server/bridge, not the key
            logger.warning("validate_key: MT5 gateway connect failed (server/bridge)")
            raise service_error(
                503,
                "MT5_GATEWAY_UNREACHABLE",
                dependency="mt5-gateway",
                retryable=True,
                retry_after=RETRY_AFTER_SECONDS["mt5-gateway"],
                detail="The MetaTrader gateway is not responding. Try again shortly.",
            )
        # Publish the client to the enclosing scope IMMEDIATELY: from this line on a
        # fired deadline must still find something to release.
        client = connected

        # STAGE 2 — login + read + probe.
        #
        # Mt5Client is SYNCHRONOUS blocking RPyC. Run the login+read+probe body off
        # the event loop and bound it with its own stage ceiling so a hung terminal
        # can never wedge the loop / healthz (WEDGE-01, T-135-12).
        def _assert_expected_login(info: dict[str, Any]) -> None:
            # RED-TEAM login bracket, cloned from the worker derive arm (MT5CONC-02):
            # FastAPI serves validates CONCURRENTLY against the ONE shared terminal,
            # so a second request's login(...) can switch the terminal onto another
            # account mid-probe. Without this bracket the capability verdict could be
            # judged against the WRONG account — a master password wrongly accepted
            # as read-only (the EoP gate T-135-09 defeated), or an investor login
            # wrongly rejected. STRICT equality on the parsed login; a missing "login"
            # field FAILS LOUD, never default-matches. A mismatch → the transient
            # fail-closed arm below (Mt5AccountMismatchError is NOT an Mt5ClientError,
            # so the classify arm can never absorb it into a verdict).
            #
            # 153.3-04 / D-29: the race this DETECTS is now also PREVENTED in-process
            # — this whole body runs under `mt5_terminal_lease`, so a second validate
            # (or an in-process worker read) queues instead of interleaving. The
            # bracket nonetheless STAYS EXACTLY AS IT IS: an asyncio.Lock serializes
            # nothing ACROSS REPLICAS, and this is the guarantee that `api_verified`
            # is never stamped on another account's numbers. A prevention is not a
            # licence to delete the detection.
            _actual = info.get("login")
            if _actual != login:
                raise Mt5AccountMismatchError(login, _actual)

        def _read_terminal() -> dict[str, Any] | None:
            # An UNREADABLE terminal must yield NO signal (-> "undetermined" ->
            # refusal), and it must NOT flow into the classify_mt5_login_error arm
            # below: that table's "terminal"/"ipc"/"connect" tokens would classify
            # OUR gateway's condition as the user's wrong broker server and blame
            # their credentials for it. Caught here, logged secret-free with the
            # scrubbed code only.
            try:
                return connected.terminal_info()
            except Mt5ClientError as terminal_err:
                logger.warning(
                    "validate_key: MT5 terminal_info unreadable (code=%s) — "
                    "capability undetermined",
                    terminal_err.code,
                )
                return None

        def _probe() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any] | None]:
            connected.login(login, investor_pw, server)  # falsy -> Mt5ClientError
            info = connected.account_info()  # proves auth + read
            _assert_expected_login(info)  # PRE-probe bracket
            # D-31: the TERMINAL's own state, read once ATTACHED (it describes the
            # terminal we are logged into) and INSIDE the PRE/POST login bracket
            # so the whole probe stays framed by the account-mismatch guard.
            terminal = _read_terminal()
            probe = connected.order_check(mt5_probe_request())  # PROBE ONLY
            _assert_expected_login(connected.account_info())  # POST-probe bracket
            return info, probe, terminal

        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_probe), timeout=_MT5_VALIDATE_STAGE_TIMEOUT_S
            )
        except asyncio.TimeoutError:
            # A hung upstream bridge — transient, not the user's key. Fail CLOSED
            # with the shared NETWORK detail (mirrors the sfox transient arm);
            # WARNING (not exception) so a blip does not spam Sentry.
            logger.warning("validate_key: MT5 probe timed out (upstream bridge hung)")
            # PYAPIFIX2-01 (C3) — see the C1 block for the shape rationale. This
            # arm and the two below were found by the BEHAVIOURAL predicate, not
            # by the consumer list: `_validate_mt5_key` never calls
            # `validate_key_permissions`, so a call-graph enumeration misses all
            # three even though they are structurally identical to C2.
            raise VenueTransientHTTPException(
                status_code=424,
                code="NETWORK_UNAVAILABLE",
                detail=NETWORK_ERROR_DETAIL,
                recoverable=True,
            )
        except Mt5AccountMismatchError:
            # RED-TEAM: a concurrent validate re-logged the shared terminal onto
            # another account mid-probe — an INFRA/concurrency fault, never the
            # user's key. Fail CLOSED transient (never valid, never auth-failed,
            # never a wrong-account verdict). No account values in the log line.
            logger.warning(
                "validate_key: MT5 terminal account mismatch mid-probe "
                "(concurrent validate) — failing closed transient"
            )
            # PYAPIFIX2-01 (C4) — see the C1 block for the shape rationale.
            raise VenueTransientHTTPException(
                status_code=424,
                code="NETWORK_UNAVAILABLE",
                detail=NETWORK_ERROR_DETAIL,
                recoverable=True,
            )
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
            # PYAPIFIX2-01 (C5) — see the C1 block for the shape rationale.
            raise VenueTransientHTTPException(
                status_code=424,
                code="NETWORK_UNAVAILABLE",
                detail=NETWORK_ERROR_DETAIL,
                recoverable=True,
            )

    # ⭐ D-29 — TAKE THE LEASE. Until this line `routers/exchange.py` acquired the
    # per-terminal lock ZERO times while `job_worker.py` (x2) and
    # `allocator_positions.py` all took it — the wizard's validate path was the ONE
    # caller that skipped it. Two concurrent submissions therefore both called
    # login(...) on the ONE shared Wine terminal and made each OTHER fail via the
    # mismatch bracket below, instead of queueing (153-EVIDENCE §4).
    #
    # ⭐ PLACEMENT IS THE WHOLE POINT. The acquisition wait sits OUTSIDE the
    # end-to-end deadline: `_MT5_VALIDATE_DEADLINE_S` must start counting when we
    # HOLD the terminal, not when we start queueing for it, or the two budgets
    # silently share one number and a queued caller gets a truncated probe. The
    # release stays INSIDE the lease — the terminal is held until our transport is
    # given up (the finally's Pitfall-6 block still runs inside this `async with`).
    #
    # ⛔ What is capped here is CONCURRENCY, and nothing else — there is no limit on
    # how many accounts exist. MT5 binds one account per terminal AT A TIME — a
    # serialization constraint, not a capacity one — so one terminal cycles through
    # hundreds of accounts across a day (D-29, REVISED 2026-08-08).
    #
    # The key MUST be byte-identical to `Mt5Client.terminal_key` (`f"{host}:{port}"`,
    # mt5_client.py's `terminal_key` property), because that is what the three job
    # sites key on: a divergent format yields a DIFFERENT Lock object and serializes
    # nothing (MT5CONC-02 / Pitfall 2). It is derived from the same host/port
    # resolved above, and BEFORE construction — construction opens the rpyc socket
    # that races, so the lease must already be held when it happens.
    terminal_key = f"{host}:{port}"
    try:
        async with mt5_terminal_lease(terminal_key, wait_s=_MT5_LEASE_WAIT_S):
            try:
                # ⭐ THE ONE END-TO-END DEADLINE (D-03). It bounds connect + probe TOGETHER;
                # the release in the finally is deliberately NOT inside it (see below).
                try:
                    info, probe, terminal = await asyncio.wait_for(
                        _connect_and_probe(), timeout=_MT5_VALIDATE_DEADLINE_S
                    )
                except asyncio.TimeoutError:
                    # The end-to-end deadline fired — the stages themselves were outlived, so
                    # no stage can name a cause. Same verdict as a probe-stage timeout (a hung
                    # terminal, transient, never the user's key) but a DISTINCT warning, so
                    # the two are separable in Railway logs: a stage timeout means one
                    # round-trip hung, this means the whole probe did. Names a stage and a
                    # bound only — no login, password or broker server (T-153.3-15).
                    logger.warning(
                        "validate_key: MT5 validate exceeded the end-to-end deadline "
                        "(%.0fs, connect+probe) — hung terminal",
                        _MT5_VALIDATE_DEADLINE_S,
                    )
                    raise VenueTransientHTTPException(
                        status_code=424,
                        code="NETWORK_UNAVAILABLE",
                        detail=NETWORK_ERROR_DETAIL,
                        recoverable=True,
                    )

                verdict = classify_trade_capability(info, probe, terminal)

                if verdict == "trade_capable":
                    # Master (trade-capable) login REJECTED — never persisted (the TS
                    # caller only encrypts after valid:true). The EoP gate (T-135-09).
                    raise HTTPException(
                        status_code=400, detail=MT5_MASTER_PASSWORD_DETAIL
                    )

                if verdict == "undetermined":
                    # D-31: we CANNOT distinguish investor from master, so we refuse
                    # rather than stamp read-only. Routed BY CAUSE off the SAME terminal
                    # dict that produced the verdict (never a re-probe), using only arms
                    # that already exist — 153.1 owns the user-facing code table.
                    operator_fault = terminal_trade_permission_off(terminal)
                    if operator_fault:
                        # A setting in OUR gateway terminal ("Disable automatic trading
                        # through the external Python API", MetaQuotes' default). No
                        # retry can clear it; the remedy is an operator turning it off
                        # (docs/runbooks/mt5-go-live.md). PERMANENT operator fault.
                        logger.warning(
                            "validate_key: MT5 capability undetermined (terminal trade "
                            "permission off) — refusing rather than stamping read-only"
                        )
                        raise service_error(
                            500,
                            "MT5_GATEWAY_UNCONFIGURED",
                            dependency="mt5-gateway",
                            retryable=False,
                            detail="The MetaTrader gateway is not configured. This needs an operator, not a retry.",
                        )
                    if not operator_fault:
                        # Terminal unreadable or detached from the trade server — our
                        # bridge blipping, and it clears on retry. TRANSIENT.
                        logger.warning(
                            "validate_key: MT5 capability undetermined (terminal signal "
                            "unavailable) — refusing rather than stamping read-only"
                        )
                        raise VenueTransientHTTPException(
                            status_code=424,
                            code="NETWORK_UNAVAILABLE",
                            detail=NETWORK_ERROR_DETAIL,
                            recoverable=True,
                        )

                # Investor (read-only) login — reachable ONLY when the terminal itself
                # reported connected AND trade-permitting, so the account's refusal is
                # attributable to the ACCOUNT. read_only=True is STRUCTURAL (Mt5Client
                # exposes no trade surface — the sFOX A1 posture), PLUS the behavioral
                # investor-vs-master probe above that sfox lacks.
                return {"valid": True, "read_only": True}
            finally:
                # RED-TEAM: bounded, off-loop RELEASE. Blocking RPyC (a hung teardown on the
                # loop would wedge FastAPI), so off-loop under its own small ceiling.
                #
                # ⭐ D-30 — this RELEASES our transport and does NOT call shutdown().
                # `mt5linux` serves every rpyc connection from ONE ThreadedServer process
                # over ONE shared MetaTrader5 instance holding ONE IPC pipe (153-EVIDENCE
                # §A2 / Correction C-1), so the close() this used to call destroyed that pipe
                # for every CONCURRENT caller, who then observed `-10004 No IPC connection`.
                # A per-request shutdown of a shared session is a denial of service against
                # ourselves. Attach once; release the lease, never the pipe.
                #
                # ⛔ Pitfall 6 — this is LEXICALLY OUTSIDE the end-to-end wait_for above, and
                # must stay there. Wrapping it inside means a deadline fired during the probe
                # abandons the RPyC session unreleased — the session leak this block exists to
                # prevent, and a WEDGE-01-class regression. Its bound is therefore the small
                # release ceiling, never the stage ceiling and never the deadline.
                #
                # Runs on EVERY path (success, master-reject, undetermined, auth/server fail,
                # mismatch, transient/timeout, END-TO-END DEADLINE) so the session never
                # leaks. `client is None` means the connect stage never produced one — there
                # is nothing to release, and the same is true of every pre-construction guard
                # above, which return before this block is ever entered.
                #
                # 📌 RESIDUAL (recorded, not fixed here): the WORKER path still reaches
                # shutdown() via services/exchange.py:924-938 (`aclose_exchange`'s mt5 arm)
                # and services/ingestion/mt5.py, so a worker job can still tear the shared
                # pipe down under a concurrent validate. Those files are outside this
                # sub-phase's ownership; D-30 scopes the REQUEST path. Wave 6 / D-35 closes
                # the class at the sink. Tracked in TODOS.md.
                if client is not None:
                    try:
                        await asyncio.wait_for(
                            asyncio.to_thread(client.release),
                            timeout=_MT5_RELEASE_TIMEOUT_S,
                        )
                    except asyncio.TimeoutError:
                        logger.warning(
                            "validate_key: MT5 client.release() timed out — abandoning session"
                        )
                    except Exception:  # noqa: BLE001 — release must never mask the probe verdict
                        logger.warning(
                            "validate_key: MT5 client.release() failed — abandoning session"
                        )
    except Mt5TerminalBusyError:
        # The terminal was still held when the INTERACTIVE acquisition bound
        # expired. We never touched it, so nothing is known about this key — routed
        # to the EXISTING transient arm, by cause, minting no new code (153.1 owns
        # the user-facing code table).
        #
        # WHY this arm: it is genuinely RECOVERABLE — the terminal frees up — so
        # "try again" is honest advice rather than a shrug, which is what
        # WIZFORM-04's "copy names an action" requires of the server leg. And it
        # leaks NO infrastructure (WIZFORM-03): no terminal key, host, port, queue
        # depth or wait value reaches the body; the WARNING below names the bound
        # only, and it is DISTINCT from the deadline/probe warnings so queueing is
        # separable from hanging in Railway logs.
        #
        # 📌 A distinct USER-VISIBLE "waiting for the connection" state — different
        # from "validating" — plus the long-wait card and `Stop waiting` are
        # **Phase 153.4's** (D-05 / D-29's UI clause). 153.4 may re-map this arm
        # onto 153.1's honest `serialized` code once that lands. ⛔ Nothing here
        # depends on it.
        logger.warning(
            "validate_key: MT5 terminal busy — gave up queueing at the %.0fs "
            "acquisition bound (serialized, not hung; D-29)",
            _MT5_LEASE_WAIT_S,
        )
        raise VenueTransientHTTPException(
            status_code=424,
            code="NETWORK_UNAVAILABLE",
            detail=NETWORK_ERROR_DETAIL,
            recoverable=True,
        )


@router.post("/validate-key")
@limiter.limit(
    "100/hour", key_func=partial(tenant_or_platform_key, scope="validate_key")
)
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
        # B2 / PYAPIFIX-03 (H-2). create_exchange is EXCHANGE_CLASSES.get(), a
        # dict build, cls(config) and two attribute sets — ZERO network I/O — so
        # nothing has been sent to the venue when this fires. A non-ValueError
        # escape is a ccxt signature change, an ImportError on a missing extra or
        # an OOM: OURS. The shipped 400 told the user their REQUEST was malformed
        # — a lie they cannot act on — and being a 4xx it meant a plain bug in our
        # code counted against nothing and paged nobody.
        #
        # SERVICE-PERMANENT (R-1): 500, retryable:false, no dependency (140.2 keys
        # its breaker on that field — SEAMCORE-01), no Retry-After. The same code
        # and the same copy as B1 (routers/internal.py) and B3
        # (routers/portfolio.py): one class, one verdict, no drift. The raw
        # exception stays in the logger.exception above, never in the body.
        raise service_error(
            500,
            "ADAPTER_INIT_FAILED",
            retryable=False,
            detail="Something went wrong on our side while opening this connection. Nothing is wrong with your key.",
        )

    try:
        result = await validate_key_permissions(exchange)
    # S-06 / PYAPI-05 — the SPLIT. services/exchange.py:982-1021 already
    # classifies every known ccxt error into a stable `error_code`, so a ccxt
    # exception ESCAPING to here is by definition unclassified — but a `ccxt.*`
    # escape is still attributable to the VENUE, not to us. Answer 424 (CALLER'S
    # EXCHANGE): a 4xx, therefore breaker-inert by construction, carrying the
    # venue name so the UI can say which venue. A 5xx here is C-12 verbatim —
    # five keys on one dashboard render during a Binance maintenance window
    # becomes five 5xx and a platform-wide trip. This arm MUST stay above the
    # generic one.
    except ccxt.BaseError as e:
        logger.warning(
            "validate_key: venue-attributable ccxt escape on %s — %s",
            req.exchange,
            type(e).__name__,
        )
        raise service_error(
            424,
            "EXCHANGE_PROBE_FAILED",
            dependency=req.exchange,
            retryable=True,
            detail="Your exchange did not complete the permission check. This is a problem at the venue — try again shortly.",
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "validate_key: validate_key_permissions raised on %s — %s: %s",
            req.exchange,
            type(e).__name__,
            e,
        )
        # C-16: the shipped copy here was "Key validation failed. Please check
        # your credentials." — an accusation aimed at the user for OUR
        # unclassified bug, and one they cannot act on. A non-ccxt escape is
        # SERVICE-PERMANENT: 500, retryable:false, and copy that names no
        # credential. The raw exception stays in the log above, never in the body.
        raise service_error(
            500,
            "INTERNAL",
            retryable=False,
            detail="Something went wrong on our side while checking this key. Nothing is wrong with your key.",
        )
    finally:
        try:
            await aclose_exchange(exchange)
        except Exception:
            pass

    if result["error"]:
        # PYAPIFIX2-01 (C6) — the LIVE key-connect collapse, and the site the
        # whole class is named after. `validate_key_permissions` computes a
        # stable `error_code` discriminator and this raise used to DISCARD it,
        # leaving the human sentence as the only carrier. See the C1 block for
        # why the shape is flat and why service_error is forbidden here.
        #
        # The code is carried VERBATIM — no fallback, no route-minted default.
        # A default here would hand the wizard a fabricated code and hide a real
        # service-layer bug behind a plausible-looking envelope (CLAUDE.md
        # Rule 12: fail loud). It is safe because the producer's invariant holds:
        # every branch of `validate_key_permissions` that sets `error` also sets
        # `error_code` in the same branch — verified branch-by-branch, and
        # mechanised as a test so a future branch that breaks it reddens at the
        # PRODUCER rather than raising here. If it is ever broken anyway, the
        # exception class's own guard raises a loud ValueError.
        #
        # `recoverable` derives from PERMANENT_VALIDATION_ERROR_CODES, which is
        # an ALLOW-LIST OF PERMANENT: non-membership means "not known to be
        # permanent", which that constant's contract defines as retryable. So an
        # unrecognised future code fails SAFE (offers a retry). The code rides
        # for EVERY verdict here, permanent ones included — that is closing the
        # site, not absorbing the separate permanent-only gap.
        raise VenueTransientHTTPException(
            status_code=424,
            code=result["error_code"],
            detail=result["error"],
            recoverable=result["error_code"] not in PERMANENT_VALIDATION_ERROR_CODES,
        )

    return {"valid": result["valid"], "read_only": result["read_only"]}


@router.post("/encrypt-key")
@limiter.limit(
    "100/hour", key_func=partial(tenant_or_platform_key, scope="encrypt_key")
)
async def encrypt_key(request: Request, req: EncryptKeyRequest) -> dict[str, Any]:
    """Encrypt exchange credentials for storage. Returns encrypted fields to store in Supabase."""
    try:
        kek = get_kek()
    except RuntimeError:
        # S-07 / PYAPI-05 — C-17 verbatim. A missing or rotated KEK is permanent
        # until an operator acts, and /api/encrypt-key is the busiest seam
        # endpoint, so the previous 503 was the self-sustaining-outage shape at
        # its worst: trip, expire, re-probe, re-trip, forever. R-1: 500,
        # retryable:false, so it can never feed the breaker.
        logger.error("encrypt_key: KEK unavailable (encryption not configured)")
        raise service_error(
            500,
            "KEK_UNAVAILABLE",
            dependency="kek",
            retryable=False,
            detail="Credential encryption is not configured. This needs an operator, not a retry.",
        )

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
@limiter.limit(
    "10/hour", key_func=partial(tenant_or_platform_key, scope="fetch_trades")
)
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
