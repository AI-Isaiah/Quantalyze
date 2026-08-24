"""Phase 135 / MT5SRC-02 — the ONE seam holding every [ASSUMED] investor-vs-master
rule + login-error classification for MT5 validate.

Consumed by ``services/ingestion/mt5.py`` (plan 135-01) and the FastAPI ``is_mt5``
router branch (plan 135-03). Concentrating the unproven rules here means the
Phase-134 live-spike refinement (MT5SPIKE-01 leg 2) is a ONE-LINE follow-up in a
single file, never a scatter of hand-copied retcode literals across the worker +
router (the closed-set discipline this module family exists to enforce).

The rules below are DEFENSIVE and fail-CLOSED: an ambiguous login error is
NEVER classified as an auth failure (which would falsely blame the user's
credentials) — it degrades to a wrong-server or transient outcome.

The capability rule (``classify_trade_capability``) is TRI-state, not boolean:

  * ``"trade_capable"`` — a positive signal from EITHER the account snapshot OR
    the order_check probe rejects the login (Pitfall 4 — a master password must
    never be persisted as read-only).
  * ``"read_only"`` — reachable ONLY when the terminal itself reports connected
    AND trade-permitting, so an account-level refusal is attributable to the
    ACCOUNT rather than to our terminal's own settings.
  * ``"undetermined"`` — a REFUSAL, never a fallback to read-only. It means the
    two negative signals prove nothing (D-31 / EVIDENCE §C12 Correction C-5:
    whenever the terminal's own trade permission is off, a MASTER password
    produces exactly the negatives an investor password produces). Refusing a
    legitimate investor key is the correct trade against storing a master key
    stamped read-only.

    ⚠️ 161-02: TWO independent settings can put it off — the Expert-Advisors
    *"Allow algorithmic trading"* option (``Enabled`` in ``[Experts]``, which is
    what ``trade_allowed`` actually reports and which the gateway re-sets off on
    every account change) and MetaQuotes' separate *"Disable automatic trading
    through the external Python API"* checkbox (``Api``, reported as
    ``tradeapi_disabled``). The VERDICT is the same either way; only the operator
    copy differs, which is why the cause is chosen at ONE seam
    (``mt5_probe.mt5_gateway_misconfigured_detail``) rather than assumed.

NEVER references the forbidden trade method by its call form — the grep gate
scans for the call token (the trade method name followed by an open paren), so
this module names that method only in prose, without call parentheses.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from services.mt5_client import Mt5ClientError

# MT5 order_check retcode meaning "the order request is valid and would be
# accepted" (TRADE_RETCODE_DONE). A login that can pass an order_check probe is
# trade-capable — i.e. a master, not an investor, password. [ASSUMED] pending
# MT5SPIKE-01 leg 2: the live spike confirms the exact investor-vs-master retcode
# signal; if it refines this, it is a one-line change HERE, not a rewrite.
_TRADE_RETCODE_DONE = 10009  # [ASSUMED]

# The DOCUMENTED investor-rejection signal: `TRADE_RETCODE_TRADE_DISABLED` from
# `enum_trade_return_codes` (EVIDENCE Correction C-6 —
# https://www.mql5.com/en/docs/constants/errorswarnings/enum_trade_return_codes).
# It is deliberately NOT a branch of its own: under rule 6 of
# classify_trade_capability a 10017 already yields "read_only". Naming it makes
# the expected value legible and lets the suite pin it.
#
# RESIDUAL, stated honestly: rule 6 accepts ANY non-10009 retcode as read_only,
# so an order_check rejected for an UNRELATED reason — e.g. `EURUSD` not being in
# the broker's symbol list, and `mt5_probe_request` hardcodes EURUSD below — is
# still classified read_only rather than undetermined. Tightening rule 6 to
# demand a trade-disabled-class retcode would REFUSE legitimate investor keys at
# such brokers, so it stays [ASSUMED]. Owner: **Phase 155 (MT5-VERIFY)**, to be
# resolved against a live master AND investor login.
_TRADE_RETCODE_TRADE_DISABLED = 10017  # [ASSUMED — documented, unverified live]

# MT5's IPC-transport failure codes — the terminal bridge itself is unreachable,
# which is OUR infrastructure, never the user's broker server and never their
# credentials. BOTH carry "ipc" in their text, so both are code-gated in
# ``classify_mt5_login_error`` BEFORE the token tables below (see there).
#
#   * ``-10004`` "No IPC connection" — the bridge isn't attached at all (gateway
#     down / mid-redeploy).
#   * ``-10005`` "IPC timeout" — the TIMEOUT sibling: the bridge is attached but
#     the terminal stopped answering. Observed LIVE on 2026-08-12 against a wedged
#     gateway terminal, where the wizard told the user "We could not find that
#     broker server." for a server string that was byte-for-byte CORRECT.
_IPC_TRANSPORT_CODES: tuple[int, ...] = (-10004, -10005)

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


class Mt5ValidationError(Exception):
    """Fail-CLOSED classification of an OFFLINE pre-probe credential-shape failure.

    ``kind`` is the login-failure class that BOTH call sites — the FastAPI
    ``_validate_mt5_key`` router branch (plan 135-03) and the
    ``Mt5Adapter.validate`` worker branch (plan 135-01) — map onto their own
    transport (an ``HTTPException`` detail / a ``ValidationResult``), so a
    missing/blank credential combination classifies IDENTICALLY on both paths.
    This is the single-seam guarantee WR-01 exists to enforce: the guard set and
    ordering live HERE, once, and cannot drift between the two hand-written
    copies they replaced.
    """

    def __init__(self, kind: Literal["auth", "wrong_server"]) -> None:
        self.kind = kind
        super().__init__(kind)


def parse_mt5_credentials(
    api_key: str | None, api_secret: str | None, passphrase: str | None
) -> tuple[int, str, str]:
    """Fail-CLOSED OFFLINE parse of the reused MT5 credential slots into
    ``(login: int, investor_pw: str, server: str)``.

    Credential-slot reuse (the one MT5 wrinkle, documented LOUDLY at the encrypt
    chokepoint): login -> ``api_key``, investor password -> ``api_secret``,
    broker server -> ``passphrase``. Raises ``Mt5ValidationError(kind)`` for any
    structurally-invalid request so NO live RPyC probe is burned on a request
    that can be rejected offline.

    The check ORDERING is the HTTP-boundary router's (server -> login ->
    password): the wizard copy + the 135-03/135-04 tests are aligned to it, so it
    is the canonical ordering both call sites defer to (WR-01 — the adapter was
    reconciled TO this ordering, not vice-versa).

      * blank/missing broker server -> ``"wrong_server"`` (a login without a
        server cannot resolve; distinct from a bad-password failure — F4 honesty)
      * blank/missing/non-numeric login -> ``"auth"`` (a bad credential, never
        our env; the SAME AUTH_FAILED classification a bad ccxt key emits)
      * blank investor password -> ``"auth"``

    The password is returned VERBATIM (never trimmed — MT5 passwords may be
    space-significant; the wizard client trims at submit); only its blank-ness is
    tested via ``.strip()``. Login and server ARE trimmed (the v1.11
    credential-trim convention)."""
    server = (passphrase or "").strip()
    if not server:
        raise Mt5ValidationError("wrong_server")
    raw_login = (api_key or "").strip()
    if not raw_login:
        raise Mt5ValidationError("auth")
    try:
        login = int(raw_login)
    except ValueError:
        raise Mt5ValidationError("auth") from None
    investor_pw = api_secret or ""
    if not investor_pw.strip():
        raise Mt5ValidationError("auth")
    return login, investor_pw, server


def mt5_probe_request(symbol: str = "EURUSD") -> dict[str, Any]:
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


def classify_trade_capability(
    account_info: dict[str, Any],
    order_check_result: dict[str, Any],
    terminal_info: dict[str, Any] | None,
) -> Literal["trade_capable", "read_only", "undetermined"]:
    """Tri-state, fail-CLOSED capability verdict for a logged-in MT5 session.

    Replaces the two-signal ``is_trade_capable`` boolean, which concluded
    "investor / read-only" from two NEGATIVE signals and therefore failed OPEN:
    per EVIDENCE §C12 / Correction C-5 both signals are ALSO negative for a
    **MASTER** password whenever the terminal's own trade permission is off. A
    trade-capable password then passed the investor probe and was persisted
    stamped ``read_only`` (D-31).

    ⚠️ 161-02 CORRECTION — TWO INDEPENDENT SETTINGS, not one. ``trade_allowed``
    is governed by the Expert-Advisors *"Allow algorithmic trading"* option
    (``Enabled`` in ``Config/terminal.ini`` ``[Experts]``). MetaQuotes'
    *"Disable automatic trading through the external Python API"* (``Api`` in the
    same block) is a SEPARATE checkbox, reported separately as
    ``tradeapi_disabled``, and it can be OFF while ``trade_allowed`` is still
    false. Founder-measured on the live gateway 2026-08-13: ``Api=0, Enabled=0``.
    Either one produces the identical two negatives, so the refusal is correct
    under both — but naming the wrong one to an operator sends them to a setting
    that is already right.

    The terminal signal is a REQUIRED argument, not an optional one: a callable
    two-signal form that can conclude ``read_only`` is exactly the defect, so no
    such form is left reachable in the tree.

    Returns:
      * ``"trade_capable"`` — reject (master password; never persist).
      * ``"read_only"``     — accept (investor password).
      * ``"undetermined"``  — REFUSE. We cannot classify, so we do not. Refusing
        a legitimate investor key is the correct trade against storing a master
        key we believe is read-only.
    """
    # 1. A POSITIVE account signal is conclusive and wins before any terminal
    #    reasoning — [DOC] ACCOUNT_TRADE_ALLOWED "Allowed trade for the current
    #    account". This preserves the pre-D-31 master-reject behaviour exactly.
    if account_info.get("trade_allowed"):
        return "trade_capable"
    # 2. An order_check the server WOULD accept is likewise conclusive.
    #    [DOC] TRADE_RETCODE_DONE = 10009. Still [ASSUMED] as the master signal
    #    pending the live spike, and it keeps its marker.
    retcode = order_check_result.get("retcode")
    if retcode == _TRADE_RETCODE_DONE:  # [ASSUMED]
        return "trade_capable"
    # 3. No terminal read (unreadable, wrong shape, or missing either field) →
    #    the two negatives above prove NOTHING, because we cannot rule out that
    #    our own terminal caused them. EVIDENCE §C12: "Anything else is 'cannot
    #    determine' and must fail closed".
    if (
        not isinstance(terminal_info, Mapping)
        or "connected" not in terminal_info
        or "trade_allowed" not in terminal_info
    ):
        return "undetermined"
    # 4. Terminal detached from the trade server. [DOC] MQL5 "Trade permission"
    #    lists "no connection to the trade server" as a SIBLING cause of the
    #    account-level refusal, so the negative is not attributable to investor
    #    mode.
    if not terminal_info.get("connected"):
        return "undetermined"
    # 5. ⭐ THE FIX (D-31). Terminal-level trade permission is OFF. Under it a
    #    MASTER password produces the identical two negatives an investor
    #    password produces, so NO read-only conclusion is available and we must
    #    refuse.
    #
    #    ⚠️ 161-02: this flag reports the Expert-Advisors "Allow algorithmic
    #    trading" option (`Enabled` in [Experts]) — NOT MetaQuotes' separate
    #    "Disable automatic trading through the external Python API" checkbox
    #    (`Api`, surfaced as `tradeapi_disabled`), which was founder-measured OFF
    #    on the live gateway while this flag was still false. Either one forces
    #    the refusal; the CAUSE is chosen for the operator elsewhere, once.
    if not terminal_info.get("trade_allowed"):
        return "undetermined"
    # 6. The terminal itself WOULD permit trading and the account still says no,
    #    so the refusal is attributable to the ACCOUNT — the composition EVIDENCE
    #    §C12 prescribes. The documented value here is
    #    _TRADE_RETCODE_TRADE_DISABLED (10017); see its residual note above for
    #    why an unrecognized retcode is admitted rather than refused.
    return "read_only"


def terminal_trade_permission_off(terminal_info: dict[str, Any] | None) -> bool:
    """True iff the terminal WAS read, IS connected, and its OWN trade permission
    is off — i.e. branch 5 of ``classify_trade_capability`` produced the
    ``"undetermined"`` verdict.

    This is the CAUSE predicate both call sites branch on to route an
    ``"undetermined"`` refusal, and it lives HERE rather than being re-derived at
    each site for the same reason the capability rule does: a four-condition shape
    test copied twice drifts, and the drift would be silent (an unreadable
    terminal routed to the operator arm looks identical in tests to a
    trade-disabled one until an operator is paged for a network blip).

      * ``True``  -> a setting in OUR gateway terminal. No retry can clear it;
        the remedy is an operator changing that setting (see the go-live
        runbook). Route to the PERMANENT operator-fault arm. ⚠️ 161-02: WHICH
        setting is not decided here — this predicate answers "is it ours?", and
        ``mt5_probe.mt5_gateway_misconfigured_detail`` answers "which one?" from
        the same dict. The measured default cause is the Expert-Advisors "Allow
        algorithmic trading" option, which the gateway re-sets off on every
        account change (``Account=1``/``Profile=1``) while the worker logs in on
        every job — which is why this fault RECURS after an operator clears it.
      * ``False`` -> the terminal was unreadable, malformed, or detached from the
        trade server. That is our bridge blipping and it clears on retry. Route
        to the TRANSIENT arm.
    """
    if not isinstance(terminal_info, Mapping) or "trade_allowed" not in terminal_info:
        return False  # unreadable / malformed shape -> transient, not operator
    if not terminal_info.get("connected"):
        return False  # detached from the trade server -> transient
    return not terminal_info.get("trade_allowed")


def classify_mt5_login_error(
    err: Mt5ClientError,
) -> Literal["auth", "wrong_server", "transient"]:
    """Map an ``Mt5ClientError`` to a login-failure class.

    Fail-CLOSED ordering: a server/connection/terminal signal wins first (never
    blame the credentials for what looks like a bridge/server problem); only a
    CLEAR auth token then yields ``"auth"``; anything unrecognized degrades to
    ``"transient"`` (which the caller PROPAGATES untouched — never auth-failed,
    never valid). The token tables are [ASSUMED] pending the live spike."""
    # _IPC_TRANSPORT_CODES — -10004 "No IPC connection" (the terminal bridge isn't
    # attached: gateway down / mid-redeploy) and its TIMEOUT sibling -10005 "IPC
    # timeout" (the bridge is attached but the terminal stopped answering; observed
    # live on 2026-08-12 against a wedged gateway terminal). NEITHER is a wrong
    # broker server. Code-gate them BEFORE the text tokens — their "ipc" text would
    # otherwise classify as wrong_server and PERMANENTLY reject a valid key during a
    # transient gateway outage. Both are infra faults → transient (the caller
    # propagates untouched, never a user-blame stamp).
    if err.code in _IPC_TRANSPORT_CODES:
        return "transient"
    text = str(err).lower()
    if any(tok in text for tok in _WRONG_SERVER_TOKENS):
        return "wrong_server"
    if any(tok in text for tok in _AUTH_TOKENS):
        return "auth"
    return "transient"
