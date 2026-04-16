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

logger = logging.getLogger("quantalyze.analytics")


PermissionDict = dict[str, bool]


def _cache_ttl_seconds() -> int:
    """Read TTL from env at call time so tests can monkeypatch the env var."""
    raw = os.getenv("KEY_PERMISSION_CACHE_TTL", "900")
    try:
        return max(0, int(raw))
    except ValueError:
        return 900


# Module-level cache: {(api_key_id, exchange_id): (expires_at_epoch, value)}
_perm_cache: dict[tuple[str, str], tuple[float, PermissionDict]] = {}


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
        # Fail-closed: signal "scopes unknown but assume worst" by setting all
        # three to True. The legacy validator surfaced a generic "could not
        # verify" error in this case; the new wizard surfaces it as "key has
        # trading/withdrawal perms" via the derived ``read_only`` shim, which
        # is a stricter UX (we'd rather over-reject than under-reject).
        return {"read": True, "trade": True, "withdraw": True}

    can_withdraw = bool(api_restrictions.get("enableWithdrawals", False))
    can_trade = bool(
        api_restrictions.get("enableSpotAndMarginTrading", False)
        or api_restrictions.get("enableFutures", False)
    )
    return {"read": True, "trade": can_trade, "withdraw": can_withdraw}


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
        # Mirror legacy fallback in services.exchange.validate_key_permissions:
        # if balance fetch worked but permission check fails, the key likely
        # IS read-only (OKX's permission endpoint is finicky on sub-accounts).
        return {"read": True, "trade": False, "withdraw": False}

    data = config.get("data", [{}])
    if isinstance(data, list) and len(data) > 0:
        perm_str = (data[0].get("permType") or data[0].get("perm") or "").lower()
    else:
        perm_str = ""

    has_trade = "trade" in perm_str
    has_withdraw = "withdraw" in perm_str
    return {"read": True, "trade": has_trade, "withdraw": has_withdraw}


async def detect_bybit_permissions(exchange: ccxt.Exchange) -> PermissionDict:
    """Bybit: ``GET /v5/user/query-api`` returns a ``permissions`` object
    keyed by category (``ContractTrade``, ``Spot``, ``Exchange``, ``Wallet``…).
    Trade = any of the trading-category arrays is non-empty;
    Withdraw = ``Wallet`` is non-empty.
    """
    try:
        api_info = await exchange.private_get_v5_user_query_api()
    except Exception as exc:
        logger.warning("Bybit permission probe failed: %s", exc)
        return {"read": True, "trade": True, "withdraw": True}

    permissions = api_info.get("result", {}).get("permissions", {})
    has_trade = bool(
        permissions.get("ContractTrade")
        or permissions.get("Spot")
        or permissions.get("Exchange")
    )
    has_withdraw = bool(permissions.get("Wallet"))
    return {"read": True, "trade": has_trade, "withdraw": has_withdraw}


# ---------------------------------------------------------------------------
# Dispatcher + cache
# ---------------------------------------------------------------------------


_DISPATCH = {
    "binance": detect_binance_permissions,
    "okx": detect_okx_permissions,
    "bybit": detect_bybit_permissions,
}


async def detect_permissions(
    exchange: ccxt.Exchange,
    api_key_id: Optional[str] = None,
) -> PermissionDict:
    """Detect ``{read, trade, withdraw}`` for ``exchange``.

    When ``api_key_id`` is provided, the result is cached for
    ``KEY_PERMISSION_CACHE_TTL`` seconds (default 900) keyed by
    ``(api_key_id, exchange.id)``. Calling without an ``api_key_id`` (e.g. the
    pre-store validate path in the wizard) bypasses the cache because there's
    no stable identity to key on.
    """
    detector = _DISPATCH.get(exchange.id)
    if detector is None:
        # Unknown exchange — be conservative.
        return {"read": False, "trade": False, "withdraw": False}

    cache_key: Optional[tuple[str, str]] = (
        (api_key_id, exchange.id) if api_key_id else None
    )

    if cache_key is not None:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    result = await detector(exchange)

    if cache_key is not None:
        _cache_set(cache_key, result)

    return result
