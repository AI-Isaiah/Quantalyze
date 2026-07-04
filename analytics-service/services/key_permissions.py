"""Per-exchange API key permission detection.

Sprint 5 Task 5.8 — Live Key Permission Viewer.

This module owns the per-exchange "what scopes does this key actually have?"
calls that previously lived inline inside ``services.exchange.validate_key_permissions``.
That older function inferred a single ``read_only`` boolean; the new viewer
needs the finer ``{read, trade, withdraw}`` triple so the UI can render a
per-scope badge. We keep ``validate_key_permissions`` as a thin shim that
derives ``read_only`` from these results so existing callers (the create-key
wizard, ``/api/strategies/create-with-key``) keep working unchanged.

A small TTL cache sits in front of ``detect_permissions``. The exchange
permission endpoints are slow (200-600ms) and their answers don't change
between exchange dashboard mutations, so caching for 15 minutes keeps the
UI snappy on Re-check spam without hiding genuine permission changes for
long. The cache key is ``(api_key_id, exchange_id)``; pure exchange
instances without a known DB row pass ``api_key_id=None`` and bypass the
cache entirely (used by the wizard's first-time validate path).

NOTE: ``functools.lru_cache`` does NOT support TTL — an un-rotated cache
on credential metadata is a footgun, so we build a tiny dict-based TTL
cache here instead. TTL is configurable via ``KEY_PERMISSION_CACHE_TTL``
(seconds) for tests and ops.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional

import ccxt.async_support as ccxt

from services.redact import scrub_freeform_string

logger = logging.getLogger("quantalyze.analytics")


# Shape contract: detect_*_permissions return
# {"read": bool, "trade": bool, "withdraw": bool, "probe_error": bool}.
# DRB-03 (OQ1, 68-CONTEXT) widened the payload ADDITIVELY so the deribit
# probe may carry an optional ``scope_detail: str`` naming the exact
# offending/missing scope alongside the bool triple; sibling probes never
# set it and existing callers ignore it. The value type is ``object`` (not a
# TypedDict) deliberately: the three sibling detectors return
# ``dict(_FAIL_CLOSED)`` on their exception path, and mypy --strict types that
# copy as ``dict[str, object]`` — incompatible with a TypedDict return — so a
# TypedDict would break the frozen sibling bodies. ``dict[str, object]``
# carries the additive contract (bool keys + optional str scope_detail)
# without touching them.
PermissionDict = dict[str, object]


# probe_error=True means we caught an exception and returned the
# fail-CLOSED default (all scopes True so the wizard rejects). Callers
# (and the cache layer) MUST NOT cache rows where probe_error is True —
# they're transient defaults, not real signals.
_FAIL_CLOSED: PermissionDict = {
    "read": True,
    "trade": True,
    "withdraw": True,
    "probe_error": True,
}


def _cache_ttl_seconds() -> int:
    """Read TTL from env at call time so tests can monkeypatch the env var."""
    raw = os.getenv("KEY_PERMISSION_CACHE_TTL", "900")
    try:
        return max(0, int(raw))
    except ValueError:
        return 900


# Module-level cache: {(api_key_id, exchange_id): (expires_at_epoch, value)}
# Bounded at _PERM_CACHE_MAX so an attacker can't spray new (api_key_id,
# exchange_id) tuples to grow it without limit.
_perm_cache: dict[tuple[str, str], tuple[float, PermissionDict]] = {}
_PERM_CACHE_MAX = 100


def _cache_get(key: tuple[str, str]) -> Optional[PermissionDict]:
    entry = _perm_cache.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if expires_at < time.monotonic():
        # Expired — drop and miss.
        _perm_cache.pop(key, None)
        return None
    return value


def _cache_set(key: tuple[str, str], value: PermissionDict) -> None:
    ttl = _cache_ttl_seconds()
    if ttl <= 0:
        return
    _perm_cache[key] = (time.monotonic() + ttl, value)
    # Bound size — dict preserves insertion order, so the oldest key is
    # next(iter(...)). Drop it without touching the just-inserted row.
    while len(_perm_cache) > _PERM_CACHE_MAX:
        oldest = next(iter(_perm_cache))
        if oldest == key:
            break
        _perm_cache.pop(oldest, None)


def _cache_clear() -> None:
    """Test helper. Not exported into the public surface."""
    _perm_cache.clear()


# ---------------------------------------------------------------------------
# Per-exchange detectors
# ---------------------------------------------------------------------------


async def detect_binance_permissions(exchange: ccxt.Exchange) -> PermissionDict:
    """Binance: ``GET /sapi/v1/account/apiRestrictions`` returns booleans for
    every scope. ``read`` is implicit — if we got back a non-error response,
    the key can read. ``trade`` covers spot/margin OR futures; ``withdraw``
    is the explicit withdrawal flag.

    On any error (network, auth, parse), we fail closed: scopes are unknown,
    treat as "trade and withdraw might be on" so the UI shows the badges as
    on (red) and the wizard rejection path keeps working.
    """
    try:
        api_restrictions = await exchange.sapi_get_account_apirestrictions()
    except Exception as exc:
        logger.warning("Binance permission probe failed: %s", exc)
        # Fail-CLOSED: scopes unknown -> assume worst so the wizard rejects.
        # probe_error=True so the cache layer does NOT persist this transient
        # default (otherwise a single network blip pins the UI for 15 min).
        return dict(_FAIL_CLOSED)

    can_withdraw = bool(api_restrictions.get("enableWithdrawals", False))
    can_trade = bool(
        api_restrictions.get("enableSpotAndMarginTrading", False)
        or api_restrictions.get("enableFutures", False)
    )
    return {
        "read": True,
        "trade": can_trade,
        "withdraw": can_withdraw,
        "probe_error": False,
    }


async def detect_okx_permissions(exchange: ccxt.Exchange) -> PermissionDict:
    """OKX: ``GET /api/v5/account/config`` returns a ``perm`` string like
    ``read_only`` or ``read_only,trade``. Comma-separated scopes.

    OKX's permission strings are inconsistent across account types —
    sometimes ``permType`` is the field name, sometimes ``perm``. We try
    both. If neither yields a parseable string but the call succeeded, we
    fall back to "read but not trade/withdraw" because the balance fetch in
    the legacy validator already proved at least read works.
    """
    try:
        config = await exchange.private_get_account_config()
    except Exception as exc:
        logger.warning("OKX permission probe failed: %s", exc)
        # Fail-CLOSED, matching Binance/Bybit. The legacy fail-OPEN here
        # was a security mismatch — a flaky OKX permissions endpoint must
        # not silently mark a trading key as read-only.
        return dict(_FAIL_CLOSED)

    data = config.get("data", [{}])
    if isinstance(data, list) and len(data) > 0:
        perm_str = (data[0].get("permType") or data[0].get("perm") or "").lower()
    else:
        perm_str = ""

    has_trade = "trade" in perm_str
    has_withdraw = "withdraw" in perm_str
    return {
        "read": True,
        "trade": has_trade,
        "withdraw": has_withdraw,
        "probe_error": False,
    }


async def detect_bybit_permissions(exchange: ccxt.Exchange) -> PermissionDict:
    """Bybit: ``GET /v5/user/query-api`` returns a ``readOnly`` integer
    flag plus a ``permissions`` object.

    Bybit V5 quirk (confirmed 2026-05-05 against a live production read-only
    key and re-confirmed 2026-05-06 against a testnet read-only key):
    the ``permissions`` arrays describe the SCOPE of read access (which
    API categories the key can query) rather than active write capability.
    A read-only key can show ``ContractTrade: ["Order", "Position"]``,
    ``Spot: ["SpotTrade"]``, AND ``Wallet: ["AccountTransfer",
    "SubMemberTransfer"]`` while having ``readOnly: "1"`` at the top
    level — those entries indicate the key can READ orders/positions/spot
    data and READ wallet-transfer history, not that it can place trades
    or move funds.

    The authoritative trade-AND-withdraw flag is ``readOnly``: ``1`` means
    the key cannot trade OR withdraw, regardless of what's in the
    permissions object. PR #118 fixed the trade-detection false positive;
    this docstring revision (Phase 18 follow-up) extends the same
    "readOnly supersedes permissions arrays" rule to withdraw detection
    after live testnet evidence falsified the original
    "read-only key returns Wallet=[]" assumption.
    """
    try:
        api_info = await exchange.private_get_v5_user_query_api()
    except Exception as exc:
        logger.warning("Bybit permission probe failed: %s", exc)
        return dict(_FAIL_CLOSED)

    result = api_info.get("result", {})
    permissions = result.get("permissions", {})

    # Authoritative trade-capability flag. Bybit sets readOnly=1 only for
    # keys created via the dashboard's "Read-only" toggle. Bybit's V5 API
    # (and ccxt's bybit module) returns numeric fields as STRINGS (e.g.
    # readOnly: "1", retCode: "0"); a naive `== 1` check would silently
    # always be False. Compare against str("1") to handle both wire shapes.
    # Verified 2026-05-05 by direct call against a real read-only key
    # (id 8qI8luq5LQeo023aDp): ccxt returned readOnly as Python `str`.
    is_bybit_read_only = str(result.get("readOnly", "")) == "1"

    if is_bybit_read_only:
        # readOnly="1" supersedes the permissions arrays for BOTH trade
        # AND withdraw detection. Bybit V5 contract: readOnly=1 means the
        # key cannot trade OR withdraw, regardless of populated Wallet
        # entries (which list READ scopes for wallet subsystems like
        # AccountTransfer / SubMemberTransfer). Pre-fix the defense-in-
        # depth Wallet check produced false-positive WITHDRAW_SCOPE
        # rejections on live read-only testnet keys.
        return {
            "read": True,
            "trade": False,
            "withdraw": False,
            "probe_error": False,
        }

    # readOnly="0" path: the permissions arrays ARE authoritative.
    has_withdraw = bool(permissions.get("Wallet"))
    has_trade = bool(
        permissions.get("ContractTrade")
        or permissions.get("Spot")
        or permissions.get("Exchange")
    )
    return {
        "read": True,
        "trade": has_trade,
        "withdraw": has_withdraw,
        "probe_error": False,
    }


# ---------------------------------------------------------------------------
# Deribit read-only scope gate (DRB-03) — single definition.
# ---------------------------------------------------------------------------
#
# Relocated verbatim from scripts/deribit_ground_truth.py so PRODUCTION key
# validation does not depend on a scripts module (68-CONTEXT "reuse, do not
# re-implement" — one definition). The harness re-imports these names from
# here, keeping its call sites and tests valid.

# Deribit exposes write capability as :read_write / :read_trade scope suffixes.
# A read-only key carries only :read-suffixed grants (observed grounding fact:
# "trade:read account:read wallet:read custody:read block_trade:read").
_WRITE_SCOPE_SUFFIXES: tuple[str, ...] = (":read_write", ":read_trade")


def scope_is_read_only(scope: str) -> bool:
    """True iff a Deribit public/auth ``scope`` string is strictly read-only.

    Rejects (returns False) if ANY whitespace-split token is a write grant
    (ends with :read_write / :read_trade). Requires at least one :read-suffixed
    token — a scope with zero read grants is not a usable read-only key and
    must not silently pass the gate.
    """
    tokens = scope.split()
    if any(tok.endswith(_WRITE_SCOPE_SUFFIXES) for tok in tokens):
        return False
    return any(tok.endswith(":read") for tok in tokens)


# DRB-03 requires MORE than read-only: 'account:read' AND 'trade:read' must be
# present BY NAME. Match is suffix/prefix-tolerant (caveat A1 — the exact live
# scope string is 67-03-blocked on the founder key; Phase 72 acceptance gates
# re-verify end-to-end), never exact-string equality on the whole scope blob.
_DERIBIT_REQUIRED_SCOPES: tuple[str, ...] = ("account:read", "trade:read")


def _deribit_scope_present(tokens: list[str], name: str) -> bool:
    """True iff required scope ``name`` (e.g. ``account:read``) is granted.

    Tolerant of provider prefixing (A1): matches an exact token OR any
    ``<subsystem>:...:read`` token for the SAME subsystem. The subsystem
    prefix guard stops ``trade:read`` from being satisfied by ``block_trade:read``.
    """
    prefix = name.split(":", 1)[0] + ":"
    return any(
        tok == name or (tok.startswith(prefix) and tok.endswith(":read"))
        for tok in tokens
    )


async def detect_deribit_permissions(exchange: ccxt.Exchange) -> PermissionDict:
    """Deribit: ``public/auth`` (grant_type=client_credentials) returns a
    ``result.scope`` string of whitespace-joined grant tokens (e.g.
    ``"trade:read account:read wallet:read custody:read block_trade:read"``).

    Unlike the three sibling exchanges there is no boolean permission object —
    the scope STRING is the ground truth (67-01/67-02 harness). DRB-03 rejects
    any write grant (:read_write / :read_trade) and requires ``account:read``
    AND ``trade:read`` present BY NAME, naming the exact offending/missing scope
    via the additive ``scope_detail`` field (OQ1). Sibling probes never set it.

    Fail-CLOSED (all-True, probe_error=True) on ANY exception so an unreadable
    auth response can never mark a trading key read-only (ASVS V4). The probe
    exception path scrubs the message AND strips the literal apiKey/secret
    values — a ccxt auth error may echo the credential (T-68-07). Scope strings
    themselves are NOT secrets.
    """
    try:
        response = await exchange.public_get_auth(
            {
                "grant_type": "client_credentials",
                "client_id": exchange.apiKey,
                "client_secret": exchange.secret,
            }
        )
        result_obj = response.get("result", {}) if isinstance(response, dict) else {}
        scope = (
            str(result_obj.get("scope", "")) if isinstance(result_obj, dict) else ""
        )
    except Exception as exc:
        # Credential-redaction (PATTERNS §shared): a ccxt auth error can echo
        # client_id/client_secret. Scrub key:value shapes AND strip the literal
        # credential values before logging.
        message = str(scrub_freeform_string(str(exc)))
        for secret in (exchange.apiKey, exchange.secret):
            if secret:
                message = message.replace(secret, "[REDACTED]")
        logger.warning("Deribit permission probe failed: %s", message)
        return dict(_FAIL_CLOSED)

    tokens = scope.split()

    # 1. Any write grant → reject, naming the first offending token.
    for tok in tokens:
        if tok.endswith(_WRITE_SCOPE_SUFFIXES):
            return {
                "read": True,
                "trade": True,
                "withdraw": False,
                "probe_error": False,
                "scope_detail": (
                    f"key has write scope '{tok}' — create a read-only key"
                ),
            }

    # 2. Required read scopes must each be present BY NAME (suffix-tolerant).
    for required in _DERIBIT_REQUIRED_SCOPES:
        if not _deribit_scope_present(tokens, required):
            return {
                "read": False,
                "trade": False,
                "withdraw": False,
                "probe_error": False,
                "scope_detail": f"key is missing required scope '{required}'",
            }

    # 3. Compliant read-only key.
    return {
        "read": True,
        "trade": False,
        "withdraw": False,
        "probe_error": False,
    }


# ---------------------------------------------------------------------------
# Dispatcher + cache
# ---------------------------------------------------------------------------


_DISPATCH = {
    "binance": detect_binance_permissions,
    "okx": detect_okx_permissions,
    "bybit": detect_bybit_permissions,
    "deribit": detect_deribit_permissions,
}


async def detect_permissions(
    exchange: ccxt.Exchange,
    api_key_id: Optional[str] = None,
    force_refresh: bool = False,
) -> PermissionDict:
    """Detect ``{read, trade, withdraw, probe_error}`` for ``exchange``.

    When ``api_key_id`` is provided, the result is cached for
    ``KEY_PERMISSION_CACHE_TTL`` seconds (default 900) keyed by
    ``(api_key_id, exchange.id)``. Calling without an ``api_key_id`` (e.g. the
    pre-store validate path in the wizard) bypasses the cache because there's
    no stable identity to key on.

    Cache safety: if the underlying probe raised and the per-exchange
    detector returned the fail-CLOSED default (``probe_error=True``), we do
    NOT write that into the cache — otherwise a single transient blip
    would pin the UI to "all scopes on" for the full TTL.

    ``force_refresh=True`` bypasses the in-memory cache entirely:
    we skip the lookup AND drop any pre-existing entry so a stale
    "trade=False" cannot survive the refresh. The fresh result is then
    re-cached on the normal write path. This is the path the wizard
    finalize-scope-recheck uses to defend against scope-broadening
    after the read-only validation that gates wizard entry — a single
    user re-keying through the exchange dashboard between "Connect"
    and "Submit" must not be masked by either TTL layer.
    """
    detector = _DISPATCH.get(exchange.id)
    if detector is None:
        # Unknown exchange — be conservative.
        return {
            "read": False,
            "trade": False,
            "withdraw": False,
            "probe_error": False,
        }

    cache_key: Optional[tuple[str, str]] = (
        (api_key_id, exchange.id) if api_key_id else None
    )

    if cache_key is not None and not force_refresh:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    if cache_key is not None and force_refresh:
        # Drop any pre-existing entry so a stale value can't survive the
        # refresh on the off-chance that the new probe fails open.
        _perm_cache.pop(cache_key, None)

    result = await detector(exchange)

    # Don't persist transient fail-closed defaults — see docstring above.
    if cache_key is not None and not result.get("probe_error", False):
        _cache_set(cache_key, result)

    return result
