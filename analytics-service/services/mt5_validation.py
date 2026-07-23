"""Phase 135 / MT5SRC-02 — the ONE seam holding every [ASSUMED] investor-vs-master
rule + login-error classification for MT5 validate.

Consumed by ``services/ingestion/mt5.py`` (plan 135-01) and the FastAPI ``is_mt5``
router branch (plan 135-03). Concentrating the unproven rules here means the
Phase-134 live-spike refinement (MT5SPIKE-01 leg 2) is a ONE-LINE follow-up in a
single file, never a scatter of hand-copied retcode literals across the worker +
router (the closed-set discipline this module family exists to enforce).

The rules below are DEFENSIVE and fail-CLOSED: an ambiguous login error is
NEVER classified as an auth failure (which would falsely blame the user's
credentials) — it degrades to a wrong-server or transient outcome. A
trade-capable signal from EITHER the account snapshot OR the order_check probe
rejects the login (Pitfall 4 — a master password must never be persisted as
read-only).

NEVER references the forbidden trade method by its call form — the grep gate
scans for the call token (the trade method name followed by an open paren), so
this module names that method only in prose, without call parentheses.
"""
from __future__ import annotations

from typing import Any, Literal

from services.mt5_client import Mt5ClientError

# MT5 order_check retcode meaning "the order request is valid and would be
# accepted" (TRADE_RETCODE_DONE). A login that can pass an order_check probe is
# trade-capable — i.e. a master, not an investor, password. [ASSUMED] pending
# MT5SPIKE-01 leg 2: the live spike confirms the exact investor-vs-master retcode
# signal; if it refines this, it is a one-line change HERE, not a rewrite.
_TRADE_RETCODE_DONE = 10009  # [ASSUMED]

# Server / connection / terminal failure tokens — a login error carrying any of
# these is a wrong-server / bridge problem, NOT a credential problem, so it must
# NOT blame the user's password. [ASSUMED] token table pending the live spike.
_WRONG_SERVER_TOKENS: tuple[str, ...] = (
    "server",
    "connect",
    "ipc",
    "network",
    "terminal",
    "not found",
)

# Genuine authentication-failure tokens — only a clear auth signal blames the
# credentials (fail-CLOSED honesty). [ASSUMED] token table pending the live spike.
_AUTH_TOKENS: tuple[str, ...] = (
    "authoriz",
    "account",
    "invalid",
    "password",
    "login",
)


def mt5_probe_request(symbol: str = "EURUSD") -> dict:
    """A minimal market-order-shaped request for ``order_check`` (PROBE ONLY —
    never submitted). ``order_check`` validates margin/funds and does NOT place an
    order. Mirrors ``scripts/mt5_spike.py:124`` ``_probe_request`` (the shape the
    134 spike leg-2 exercised); the numeric constants are the well-known MT5
    request enums (TRADE_ACTION_DEAL / ORDER_TYPE_BUY / ORDER_FILLING_IOC)."""
    return {
        "action": 1,  # TRADE_ACTION_DEAL — immediate market execution shape
        "symbol": symbol,
        "volume": 0.01,
        "type": 0,  # ORDER_TYPE_BUY
        "type_filling": 1,  # ORDER_FILLING_IOC
    }


def is_trade_capable(
    account_info: dict[str, Any], order_check_result: dict[str, Any]
) -> bool:
    """True iff the logged-in account can place trades (a MASTER password).

    DEFENSIVE (Pitfall 4): EITHER positive trade-capable signal rejects the login
    — the account snapshot's ``trade_allowed`` flag OR an ``order_check`` probe
    that would be accepted (retcode ``TRADE_RETCODE_DONE``). An investor
    (read-only) password fails BOTH signals. The retcode rule is [ASSUMED] pending
    MT5SPIKE-01 leg 2; combining it with ``trade_allowed`` means a refinement of
    either signal alone still fails closed."""
    if account_info.get("trade_allowed"):
        return True
    retcode = order_check_result.get("retcode")
    if retcode == _TRADE_RETCODE_DONE:  # [ASSUMED]
        return True
    return False


def classify_mt5_login_error(
    err: Mt5ClientError,
) -> Literal["auth", "wrong_server", "transient"]:
    """Map an ``Mt5ClientError`` to a login-failure class.

    Fail-CLOSED ordering: a server/connection/terminal signal wins first (never
    blame the credentials for what looks like a bridge/server problem); only a
    CLEAR auth token then yields ``"auth"``; anything unrecognized degrades to
    ``"transient"`` (which the caller PROPAGATES untouched — never auth-failed,
    never valid). The token tables are [ASSUMED] pending the live spike."""
    text = str(err).lower()
    if any(tok in text for tok in _WRONG_SERVER_TOKENS):
        return "wrong_server"
    if any(tok in text for tok in _AUTH_TOKENS):
        return "auth"
    return "transient"
