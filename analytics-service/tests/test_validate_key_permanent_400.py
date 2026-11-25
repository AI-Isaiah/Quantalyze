"""CONNECTTRUTH CONN-05 (Phase 240 plan 03) - the PERMANENT 400 arms of the live
key-connect route answer the FLAT coded body.

**The defect.** `POST /api/validate-key` answers a ccxt credential failure with a
machine code (`{detail, code: "AUTH_FAILED", recoverable: false}`, via the C6
collapse) while an sFOX 401 or an MT5 bad password answered a bare `{detail}`. A
consumer branching on `body.code` therefore behaved differently per venue for ONE
condition (TODOS review M-07).

**What this file pins.** The eight arms whose codes the TypeScript roster already
knows (`AUTH_FAILED`, `MT5_WRONG_SERVER`, `MT5_MASTER_PASSWORD`) now raise
`VenueTransientHTTPException(status_code=400, ..., recoverable=False)`:

    P1  sFOX 401 / 403                        -> AUTH_FAILED
    P2  sFOX blank or whitespace-only token   -> AUTH_FAILED
    P3  sFOX control-character token          -> AUTH_FAILED
    P4  MT5 credential parse, wrong_server    -> MT5_WRONG_SERVER
    P5  MT5 credential parse, auth            -> AUTH_FAILED
    P6  MT5 login classified auth             -> AUTH_FAILED
    P7  MT5 login classified wrong_server     -> MT5_WRONG_SERVER
    P8  MT5 master (trade-capable) login      -> MT5_MASTER_PASSWORD

Plan 05 adds the three arms that introduce NEW codes (the go-dark gates and the
`create_exchange` ValueError), pinned beside P1-P8:

    P9  sFOX go-dark gate                     -> VENUE_DISABLED
    P10 MT5 go-dark gate                      -> VENUE_DISABLED
    P11 create_exchange ValueError            -> INVALID_REQUEST (empty message too)

Why each assertion matters (Rule 9):

  - **`detail` is a literal typed in this file.** The TS classifier substring-matches
    it, so a reword on either side moves a rendered verdict. It is typed here
    independently of `services/closed_sets.py` and `services/exchange.py`; the
    cross-artifact pins at the bottom compare the two.
  - **The exact key set `{detail, code, recoverable}`** is the contract. A missing
    `code` means the site still raises a plain `HTTPException`.
  - **`recoverable` is False on every arm**, and the ccxt-path control in
    `test_validate_key_venue_transient.py` pins the same value for the same code, so
    the field is pinned in the permanent direction on both routes.
  - **Status stays 400.** These are caller-request faults, not 424 venue faults.

Harness: imported by name from `tests.test_validate_key_venue_transient`. Importing
a fixture function by name registers it in this module and importing a helper does
not collect it (no `test_` name is imported), so there is no collection side effect.
Patching goes only through `_handler_globals("/api/validate-key")`, never by
re-importing `routers.exchange` (the stale-module hazard documented there).
"""

from __future__ import annotations

import ast
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from tests.test_validate_key_venue_transient import (  # noqa: F401  (app_client registers the fixture)
    _MT5_FIELDS,
    _arrange_mt5,
    _arrange_sfox,
    _handler_globals,
    _post_validate_key,
    app_client,
)

# --------------------------------------------------------------------------- #
# The copy, typed here. Read once at HEAD and retyped, never imported at module
# scope. These are the EXACT strings the TS substring cascade classifies.
# --------------------------------------------------------------------------- #

EXPECTED_AUTH_FAILED_DETAIL = (
    "Authentication failed. Check your API key and secret."
)
EXPECTED_MT5_WRONG_SERVER_DETAIL = (
    "Broker server not found — check the exact server name shown in your MT5 "
    "terminal login window."
)
EXPECTED_MT5_MASTER_PASSWORD_DETAIL = (
    "MT5 master password detected — this login can place trades. Reconnect "
    "using your read-only investor password."
)

EXPECTED_SFOX_DISABLED_DETAIL = "sFOX integration is not yet available."
EXPECTED_MT5_DISABLED_DETAIL = "MT5 integration is not yet available."
EXPECTED_UNSUPPORTED_EXCHANGE_DETAIL = "Unsupported exchange: nasdaq"
# The router's own fallback when create_exchange's ValueError carries no message.
EXPECTED_INVALID_REQUEST_FALLBACK_DETAIL = "Unsupported exchange."

EXPECTED_BODY_KEYS = {"detail", "code", "recoverable"}
EXPECTED_STATUS = 400

_FIXTURE = Path(__file__).parent / "fixtures" / "validate_key_permanent_400_contract.json"
_SPEC: dict[str, Any] = json.loads(_FIXTURE.read_text(encoding="utf-8"))
_CASES: list[dict[str, Any]] = _SPEC["cases"]
# Looked up by trigger, never by position: key order and case order are not part
# of the contract.
_BY_TRIGGER: dict[str, dict[str, Any]] = {c["trigger"]: c for c in _CASES}

# The census of cases this suite CLAIMS, retyped from the fixture. One-to-one in
# both directions with the committed fixture AND with the call sites below.
EXPECTED_FIXTURE_TRIGGERS = {
    "sfox_http_401",
    "sfox_blank_token",
    "sfox_control_char_token",
    "mt5_credential_wrong_server",
    "mt5_credential_auth",
    "mt5_login_auth",
    "mt5_login_wrong_server",
    "mt5_master_password",
    "sfox_disabled",
    "mt5_disabled",
    "unsupported_exchange",
    "unsupported_exchange_empty_message",
}


def _assert_flat_permanent_body(
    response: Any,
    *,
    trigger: str,
    detail: str,
    code: str,
) -> None:
    assert response.status_code == EXPECTED_STATUS, (
        f"{trigger}: status must stay {EXPECTED_STATUS}, got {response.status_code} "
        f"with text {response.text!r}. A bodyless 500 here is a flat-body constructor "
        f"guard (an empty detail) escaping as an unhandled error."
    )
    body = response.json()

    assert response.status_code == EXPECTED_STATUS, (
        f"{trigger}: status must stay {EXPECTED_STATUS}. These arms are "
        f"CALLER-REQUEST faults (a credential the caller sent was refused), "
        f"not the 424 venue-transient class. got {response.status_code} with {body!r}"
    )
    assert set(body) == EXPECTED_BODY_KEYS, (
        f"{trigger}: the wire body must be EXACTLY {sorted(EXPECTED_BODY_KEYS)}, "
        f"got {sorted(body)}. A missing 'code' means the site still raises a plain "
        f"HTTPException (or the app-global handler never matched)."
    )
    assert type(body["detail"]) is str, (
        f"{trigger}: body.detail MUST be a scalar string, got "
        f"{type(body['detail']).__name__}"
    )
    assert body["detail"] == detail, (
        f"{trigger}: the human string is a classification channel. This literal is "
        f"typed in the test; a mismatch means the copy was reworded."
    )
    assert body["code"] == code, f"{trigger}: the machine discriminator must be {code!r}."
    assert type(body["recoverable"]) is bool, (
        f"{trigger}: recoverable must be a JSON boolean, not a truthy value."
    )
    assert body["recoverable"] is False, (
        f"{trigger}: a permanent credential verdict must answer recoverable=false. "
        f"A wrong True invites a pointless retry on a key that can never work."
    )

    # Fixture parity: the committed case table is the TypeScript reader's input,
    # so it must not drift from the pins above or from the real wire body.
    spec = _BY_TRIGGER[trigger]
    assert spec["status"] == EXPECTED_STATUS
    assert spec["body"] == {"detail": detail, "code": code, "recoverable": False}, (
        f"{trigger}: the committed fixture disagrees with the literals pinned here."
    )
    assert spec["body"] == body, (
        f"{trigger}: the committed fixture disagrees with the REAL wire body."
    )


# --------------------------------------------------------------------------- #
# P1 - sFOX 401 / 403
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("status", [401, 403])
def test_p1_sfox_rejected_token_answers_the_coded_400(
    app_client, monkeypatch, status
) -> None:
    """P1 - sFOX rejected the token (401 or 403): permanent for these credentials.
    The 403 answers the identical body, so both drive the one fixture case."""
    _arrange_sfox(monkeypatch, status)

    r = _post_validate_key(app_client, exchange="sfox", api_key="tok")

    _assert_flat_permanent_body(
        r,
        trigger="sfox_http_401",
        detail=EXPECTED_AUTH_FAILED_DETAIL,
        code="AUTH_FAILED",
    )


# --------------------------------------------------------------------------- #
# P2 / P3 - the other sFOX arms
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("token", ["", "   "])
def test_p2_sfox_blank_token_answers_the_coded_400_not_500(
    app_client, monkeypatch, token
) -> None:
    """P2 - an empty or whitespace-only sFOX token fails CLOSED with the flat 400,
    never a 500, and the client is never built (nothing to leak)."""
    factory = MagicMock(side_effect=AssertionError("no client may be built for a blank token"))
    monkeypatch.setitem(_handler_globals("/api/validate-key"), "make_sfox_client", factory)

    r = _post_validate_key(app_client, exchange="sfox", api_key=token)

    _assert_flat_permanent_body(
        r,
        trigger="sfox_blank_token",
        detail=EXPECTED_AUTH_FAILED_DETAIL,
        code="AUTH_FAILED",
    )
    factory.assert_not_called()


def test_p3_sfox_control_char_token_answers_the_coded_400_and_never_echoes_it(
    app_client, monkeypatch
) -> None:
    """P3 - a token with an embedded control character makes aiohttp raise a bare
    ValueError whose message can embed the token. It is a credential problem: the
    flat 400, and the token appears nowhere in the response text (T-240-10)."""
    token = "tok_abc\ndef"
    client = MagicMock(name="SfoxClient-instance")
    client.get_balances = AsyncMock(side_effect=ValueError(f"Invalid header value {token!r}"))
    client.aclose = AsyncMock(return_value=None)
    monkeypatch.setitem(
        _handler_globals("/api/validate-key"), "make_sfox_client", MagicMock(return_value=client)
    )

    r = _post_validate_key(app_client, exchange="sfox", api_key=token)

    _assert_flat_permanent_body(
        r,
        trigger="sfox_control_char_token",
        detail=EXPECTED_AUTH_FAILED_DETAIL,
        code="AUTH_FAILED",
    )
    assert "tok_abc" not in r.text
    assert "def" not in r.text
    client.aclose.assert_awaited_once()


# --------------------------------------------------------------------------- #
# P4 / P5 - MT5 credential-shape parse (offline, before any client is built)
# --------------------------------------------------------------------------- #


def _forbid_mt5_client(monkeypatch: pytest.MonkeyPatch) -> Any:
    factory = MagicMock(side_effect=AssertionError("Mt5Client must not be built on a bad request shape"))
    monkeypatch.setitem(_handler_globals("/api/validate-key"), "Mt5Client", factory)
    return factory


def test_p4_mt5_blank_server_answers_the_coded_wrong_server_400(
    app_client, monkeypatch
) -> None:
    """P4 - a blank broker server is the `wrong_server` kind of the credential parse."""
    factory = _forbid_mt5_client(monkeypatch)

    r = _post_validate_key(app_client, **{**_MT5_FIELDS, "passphrase": "   "})

    _assert_flat_permanent_body(
        r,
        trigger="mt5_credential_wrong_server",
        detail=EXPECTED_MT5_WRONG_SERVER_DETAIL,
        code="MT5_WRONG_SERVER",
    )
    factory.assert_not_called()


@pytest.mark.parametrize(
    "override",
    [
        pytest.param({"api_key": "not-a-login"}, id="non-numeric-login"),
        pytest.param({"api_secret": "   "}, id="blank-investor-password"),
    ],
)
def test_p5_mt5_bad_credential_shape_answers_the_coded_auth_400(
    app_client, monkeypatch, override
) -> None:
    """P5 - a non-numeric login or a blank investor password is the `auth` kind."""
    factory = _forbid_mt5_client(monkeypatch)

    r = _post_validate_key(app_client, **{**_MT5_FIELDS, **override})

    _assert_flat_permanent_body(
        r,
        trigger="mt5_credential_auth",
        detail=EXPECTED_AUTH_FAILED_DETAIL,
        code="AUTH_FAILED",
    )
    factory.assert_not_called()


# --------------------------------------------------------------------------- #
# P6 / P7 / P8 - the MT5 login and trade-capability arms (inside the probe)
# --------------------------------------------------------------------------- #


def test_p6_mt5_login_classified_auth_answers_the_coded_auth_400(
    app_client, monkeypatch
) -> None:
    """P6 - the terminal refused the investor password (classified `auth`)."""
    from services.mt5_client import Mt5ClientError

    _arrange_mt5(monkeypatch, login_raises=Mt5ClientError(134, "invalid account or password"))

    r = _post_validate_key(app_client, **_MT5_FIELDS)

    _assert_flat_permanent_body(
        r,
        trigger="mt5_login_auth",
        detail=EXPECTED_AUTH_FAILED_DETAIL,
        code="AUTH_FAILED",
    )


def test_p7_mt5_login_classified_wrong_server_answers_the_coded_400(
    app_client, monkeypatch
) -> None:
    """P7 - the terminal could not find the broker server (classified `wrong_server`)."""
    from services.mt5_client import Mt5ClientError

    _arrange_mt5(monkeypatch, login_raises=Mt5ClientError(0, "trade server not found"))

    r = _post_validate_key(app_client, **_MT5_FIELDS)

    _assert_flat_permanent_body(
        r,
        trigger="mt5_login_wrong_server",
        detail=EXPECTED_MT5_WRONG_SERVER_DETAIL,
        code="MT5_WRONG_SERVER",
    )


def test_p8_mt5_master_password_answers_the_coded_400(app_client, monkeypatch) -> None:
    """P8 - a trade-capable (master) login is REJECTED: never persisted as read-only.

    Driven through the REAL `classify_trade_capability` seam: the account says
    trade_allowed, the probe is a refusal, the terminal itself is healthy, so the
    refusal is attributable to the account and the verdict is `trade_capable`."""
    _arrange_mt5(monkeypatch, account={"trade_allowed": True, "login": 123456, "server": "Broker-Demo"})
    client = _handler_globals("/api/validate-key")["Mt5Client"].return_value
    client.order_check = MagicMock(
        return_value={"retcode": 10017, "comment": "Trade disabled"}
    )
    client.terminal_info = MagicMock(
        return_value={"connected": True, "trade_allowed": True, "build": 4410}
    )

    r = _post_validate_key(app_client, **_MT5_FIELDS)

    _assert_flat_permanent_body(
        r,
        trigger="mt5_master_password",
        detail=EXPECTED_MT5_MASTER_PASSWORD_DETAIL,
        code="MT5_MASTER_PASSWORD",
    )


# --------------------------------------------------------------------------- #
# P9 / P10 / P11 - the arms that introduce NEW codes (plan 05)
# --------------------------------------------------------------------------- #


def test_p9_sfox_go_dark_gate_answers_the_coded_400(app_client, monkeypatch) -> None:
    """P9 - SFOX_ENABLED is not true: the gate refuses BEFORE any client is built, with
    the flat coded body and the SFOX_DISABLED_DETAIL literal unchanged."""
    monkeypatch.delenv("SFOX_ENABLED", raising=False)
    factory = MagicMock(side_effect=AssertionError("no sFOX client may be built while the venue is dark"))
    monkeypatch.setitem(_handler_globals("/api/validate-key"), "make_sfox_client", factory)

    r = _post_validate_key(app_client, exchange="sfox", api_key="tok")

    _assert_flat_permanent_body(
        r,
        trigger="sfox_disabled",
        detail=EXPECTED_SFOX_DISABLED_DETAIL,
        code="VENUE_DISABLED",
    )
    factory.assert_not_called()


def test_p10_mt5_go_dark_gate_answers_the_coded_400(app_client, monkeypatch) -> None:
    """P10 - MT5_ENABLED is not true: the gate refuses BEFORE any client or probe."""
    monkeypatch.delenv("MT5_ENABLED", raising=False)
    factory = _forbid_mt5_client(monkeypatch)

    r = _post_validate_key(app_client, **_MT5_FIELDS)

    _assert_flat_permanent_body(
        r,
        trigger="mt5_disabled",
        detail=EXPECTED_MT5_DISABLED_DETAIL,
        code="VENUE_DISABLED",
    )
    factory.assert_not_called()


def test_p11_create_exchange_value_error_answers_the_coded_400(
    app_client, monkeypatch
) -> None:
    """P11 - the ccxt path: create_exchange refuses an unknown exchange name with a
    ValueError. The detail is its message verbatim, the code is INVALID_REQUEST."""
    monkeypatch.setitem(
        _handler_globals("/api/validate-key"),
        "create_exchange",
        MagicMock(side_effect=ValueError(EXPECTED_UNSUPPORTED_EXCHANGE_DETAIL)),
    )

    r = _post_validate_key(app_client, exchange="nasdaq")

    _assert_flat_permanent_body(
        r,
        trigger="unsupported_exchange",
        detail=EXPECTED_UNSUPPORTED_EXCHANGE_DETAIL,
        code="INVALID_REQUEST",
    )


def test_p11_create_exchange_empty_value_error_answers_the_coded_400_not_500(
    app_client, monkeypatch
) -> None:
    """P11 edge - a ValueError with an EMPTY message must not reach the flat-body
    constructor's non-empty-detail guard (a bodyless 500, the G-8 class): the router
    substitutes its fixed fallback detail."""
    monkeypatch.setitem(
        _handler_globals("/api/validate-key"),
        "create_exchange",
        MagicMock(side_effect=ValueError()),
    )

    r = _post_validate_key(app_client, exchange="nasdaq")

    _assert_flat_permanent_body(
        r,
        trigger="unsupported_exchange_empty_message",
        detail=EXPECTED_INVALID_REQUEST_FALLBACK_DETAIL,
        code="INVALID_REQUEST",
    )


def test_real_create_exchange_message_is_the_unsupported_exchange_literal(
    app_client,
) -> None:
    """The fallback is unreachable today: the REAL create_exchange raises the
    non-empty literal. Un-patched, an unknown exchange name proves it on the wire."""
    r = _post_validate_key(app_client, exchange="nasdaq")

    assert r.status_code == 400
    assert r.json() == {
        "detail": EXPECTED_UNSUPPORTED_EXCHANGE_DETAIL,
        "code": "INVALID_REQUEST",
        "recoverable": False,
    }


# --------------------------------------------------------------------------- #
# Adjacency: two venues answering the same condition answer the same body
# --------------------------------------------------------------------------- #


def test_adjacency_sfox_401_and_mt5_bad_password_answer_the_same_body(
    app_client, monkeypatch
) -> None:
    """One condition, one body: an sFOX 401 and an MT5 bad password give the same
    code, recoverable and detail."""
    from services.mt5_client import Mt5ClientError

    _arrange_sfox(monkeypatch, 401)
    sfox = _post_validate_key(app_client, exchange="sfox", api_key="tok").json()

    _arrange_mt5(monkeypatch, login_raises=Mt5ClientError(134, "invalid account or password"))
    mt5 = _post_validate_key(app_client, **_MT5_FIELDS).json()

    assert sfox == mt5
    assert sfox["code"] == "AUTH_FAILED"
    assert sfox["recoverable"] is False
    assert sfox["detail"] == EXPECTED_AUTH_FAILED_DETAIL


# --------------------------------------------------------------------------- #
# Census: the fixture, the typed set and the call sites agree, both ways
# --------------------------------------------------------------------------- #


def test_every_fixture_case_is_named_and_driven_here() -> None:
    """One-to-one, both ways, between the committed fixture and this suite.

    1. **Named.** `EXPECTED_FIXTURE_TRIGGERS` is typed above. A case added to the
       JSON and not to that set reddens.
    2. **Driven.** The literal set could itself be padded in the same edit, so the
       second oracle reads the CALL SITES: every wire case funnels through
       `_assert_flat_permanent_body(..., trigger="...")`, and those trigger
       literals are extracted from this module's own AST.
    """
    source = Path(__file__).read_text(encoding="utf-8")
    driven: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        if getattr(node.func, "id", None) != "_assert_flat_permanent_body":
            continue
        for kw in node.keywords:
            if kw.arg == "trigger" and isinstance(kw.value, ast.Constant):
                driven.add(kw.value.value)

    assert set(_BY_TRIGGER) == EXPECTED_FIXTURE_TRIGGERS, (
        "the committed fixture's case set drifted from the census typed in this "
        f"file. only in fixture: {sorted(set(_BY_TRIGGER) - EXPECTED_FIXTURE_TRIGGERS)}; "
        f"only in census: {sorted(EXPECTED_FIXTURE_TRIGGERS - set(_BY_TRIGGER))}."
    )
    assert driven == EXPECTED_FIXTURE_TRIGGERS, (
        "the fixture cases exercised by a wire test in this file do not match the "
        f"census. named but not driven: {sorted(EXPECTED_FIXTURE_TRIGGERS - driven)}; "
        f"driven but not named: {sorted(driven - EXPECTED_FIXTURE_TRIGGERS)}."
    )


# --------------------------------------------------------------------------- #
# Cross-artifact copy pin: the literal typed here against the production constant
# --------------------------------------------------------------------------- #


def test_copy_pins_are_cross_artifact() -> None:
    from services.closed_sets import (
        MT5_DISABLED_DETAIL,
        MT5_MASTER_PASSWORD_DETAIL,
        MT5_WRONG_SERVER_DETAIL,
        SFOX_DISABLED_DETAIL,
    )
    from routers.exchange import _INVALID_REQUEST_FALLBACK_DETAIL
    from services.exchange import AUTH_FAILED_DETAIL

    assert SFOX_DISABLED_DETAIL == EXPECTED_SFOX_DISABLED_DETAIL
    assert MT5_DISABLED_DETAIL == EXPECTED_MT5_DISABLED_DETAIL
    assert _INVALID_REQUEST_FALLBACK_DETAIL == EXPECTED_INVALID_REQUEST_FALLBACK_DETAIL
    assert AUTH_FAILED_DETAIL == EXPECTED_AUTH_FAILED_DETAIL
    assert MT5_WRONG_SERVER_DETAIL == EXPECTED_MT5_WRONG_SERVER_DETAIL
    assert MT5_MASTER_PASSWORD_DETAIL == EXPECTED_MT5_MASTER_PASSWORD_DETAIL


# --------------------------------------------------------------------------- #
# Census: no BARE HTTPException 400 is left on the validate-key path (plan 05)
# --------------------------------------------------------------------------- #

#: The four functions that make up the validate-key path. A function NESTED in one of
#: them (`_connect_and_probe` lives inside `_validate_mt5_key_probe`) is in scope too.
VALIDATE_KEY_PATH_FUNCTIONS = frozenset(
    {"validate_key", "_validate_sfox_key", "_validate_mt5_key", "_validate_mt5_key_probe"}
)

_EXCHANGE_ROUTER = Path(__file__).parent.parent / "routers" / "exchange.py"


def _int_constant(node: ast.expr | None) -> int | None:
    if isinstance(node, ast.Constant) and type(node.value) is int:
        return node.value
    return None


def scan_raw_400s(
    source: str, scope: frozenset[str] | None = VALIDATE_KEY_PATH_FUNCTIONS
) -> set[tuple[str, int]]:
    """(innermost enclosing function name, 400) of every BARE `HTTPException(...)` call.

    Walks `ast.parse(source)`, so a commented-out raise is invisible by construction and
    the subclass `VenueTransientHTTPException` is a different `ast.Name`. The status is
    read from the `status_code` keyword or the first positional argument and accepted only
    as an int literal. `scope=None` scans the whole module. Keyed by function NAME, never
    by line: a line number is the thing that drifts.
    """
    found: set[tuple[str, int]] = set()

    class _Walker(ast.NodeVisitor):
        def __init__(self) -> None:
            self.chain: list[str] = []

        def _enter(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
            self.chain.append(node.name)
            self.generic_visit(node)
            self.chain.pop()

        visit_FunctionDef = _enter
        visit_AsyncFunctionDef = _enter

        def visit_Call(self, node: ast.Call) -> None:
            if isinstance(node.func, ast.Name) and node.func.id == "HTTPException":
                keyword = next((kw for kw in node.keywords if kw.arg == "status_code"), None)
                status = (
                    _int_constant(keyword.value)
                    if keyword is not None
                    else _int_constant(node.args[0] if node.args else None)
                )
                in_scope = scope is None or any(name in scope for name in self.chain)
                if status == 400 and self.chain and in_scope:
                    found.add((self.chain[-1], status))
            self.generic_visit(node)

    _Walker().visit(ast.parse(source))
    return found


class TestNoRaw400OnValidateKeyArms:
    """CONN-05 SC-1: a census proving no uncoded 400 remains on the validate-key path."""

    def test_the_real_validate_key_path_has_no_bare_400(self) -> None:
        source = _EXCHANGE_ROUTER.read_text(encoding="utf-8")

        offenders = scan_raw_400s(source)

        assert offenders == set(), (
            "a bare HTTPException(400) is back on the validate-key path: "
            f"{sorted(offenders)}. Raise VenueTransientHTTPException(status_code=400, "
            "code=..., detail=..., recoverable=False) so every 400 body carries a "
            "machine code."
        )

    def test_the_census_is_not_vacuous_it_sees_the_deliberate_fetch_trades_400(self) -> None:
        """A scanner that matched nothing would report the path clean forever. The whole
        module still holds ONE deliberate raw 400 (`fetch_trades`, a different route), and
        the scanner must see it, and every in-scope function must exist to be scanned."""
        source = _EXCHANGE_ROUTER.read_text(encoding="utf-8")

        whole_module = scan_raw_400s(source, scope=None)
        defined = {
            n.name
            for n in ast.walk(ast.parse(source))
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
        }

        assert ("fetch_trades", 400) in whole_module
        assert VALIDATE_KEY_PATH_FUNCTIONS <= defined

    def test_self_a_positional_400_is_detected(self) -> None:
        src = "def validate_key():\n    raise HTTPException(400, 'x')\n"
        assert scan_raw_400s(src) == {("validate_key", 400)}

    def test_self_a_keyword_400_in_a_function_nested_in_the_probe_is_detected(self) -> None:
        src = (
            "async def _validate_mt5_key_probe():\n"
            "    async def _connect_and_probe():\n"
            "        raise HTTPException(status_code=400, detail='x')\n"
        )
        assert scan_raw_400s(src) == {("_connect_and_probe", 400)}

    def test_self_a_commented_out_raise_is_not_detected(self) -> None:
        src = "def validate_key():\n    # raise HTTPException(status_code=400, detail='x')\n    return 1\n"
        assert scan_raw_400s(src) == set()

    def test_self_a_raw_400_in_fetch_trades_is_out_of_scope(self) -> None:
        src = "async def fetch_trades():\n    raise HTTPException(status_code=400, detail='x')\n"
        assert scan_raw_400s(src) == set()
        assert scan_raw_400s(src, scope=None) == {("fetch_trades", 400)}

    def test_self_a_venue_transient_400_is_not_flagged(self) -> None:
        src = (
            "def validate_key():\n"
            "    raise VenueTransientHTTPException(status_code=400, code='X', detail='x', recoverable=False)\n"
        )
        assert scan_raw_400s(src) == set()

    def test_self_a_non_400_status_is_not_flagged(self) -> None:
        src = "def validate_key():\n    raise HTTPException(status_code=503, detail='x')\n"
        assert scan_raw_400s(src) == set()
