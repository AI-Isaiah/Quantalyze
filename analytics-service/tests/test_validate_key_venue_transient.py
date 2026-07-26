"""PYAPIFIX2-01 — the venue-transient class on the LIVE key-connect route.

**The defect.** `POST /api/validate-key` is the live key-connect path
(`create-with-key`, `composite/add-key`, `keys/validate-and-encrypt`). When a
venue is having a bad day, the router has ALREADY classified which condition
occurred — and then throws that classification away, emitting only a human
sentence: `HTTPException(400, detail="<scalar str>")`. The TypeScript seam
(`src/lib/analytics-client.ts:174-181`) wraps that sentence as an
`AnalyticsUpstreamError` **message** and `classifyKeyValidationError`
(`src/lib/wizardErrors.ts:936-1035`) SUBSTRING-MATCHES it. Two of the five
transient verdicts match no branch:

    EXCHANGE_UNAVAILABLE  "Exchange is currently unavailable…"  -> UNKNOWN / 500
    NETWORK_UNAVAILABLE   "Network error reaching the exchange…" -> UNKNOWN / 500

⇒ **a Binance maintenance window during key-connect renders as "something went
wrong, our team has been notified", with no retry affordance** — verbatim the
DOGFOOD-3 dead end `wizardErrors.ts` was written to kill.

**What this file pins.** The Python half of the fix, at ALL SEVEN members of the
class (enumerated by BEHAVIOUR, not by the two sites the review happened to
name — closing a class at a subset is the instance-not-class defect that cost
this programme 37 scrapped commits):

    C1  routers/exchange.py   sFOX HTTP 429                    (except SfoxApiError)
    C2  routers/exchange.py   sFOX 5xx / status==0 transport   (except SfoxApiError)
    C3  routers/exchange.py   MT5 probe timeout                (except asyncio.TimeoutError)
    C4  routers/exchange.py   MT5 account mismatch             (except Mt5AccountMismatchError)
    C5  routers/exchange.py   MT5 transient client error       (except Mt5ClientError)
    C6  routers/exchange.py   the ccxt verdict collapse        (if result["error"]:)
    C7  routers/portfolio.py  the verify-strategy collapse     (if validation.get("error"):)

Each now answers **400** with a FLAT body — `{detail, code, recoverable}` — where
`detail` is a scalar string **byte-identical to the copy that shipped before**,
so the substring cascade's INPUT is provably unchanged (zero regression on the
three codes that classify correctly today), while a machine `code` and a
`recoverable` boolean ride alongside for 140.3 to branch on.

C7 is a **DEAD ROUTE** — `/api/verify-strategy` has no TypeScript caller (zero
hits among the nine seam paths in `src/lib/analytics-client.ts`). It is closed
here on **CLASS INTEGRITY** grounds only, never on a "carries real traffic"
argument, which is false for this site (RESEARCH C-3).

Why each assertion matters (Rule 9 — these encode ECONOMICS, not the
implementation's own formula):

  - **`type(body["detail"]) is str`** is not a style check. `service_error(...)`
    nests an OBJECT at `body["detail"]`; through `error.detail ?? …` that
    stringifies to `"[object Object]"`, misses every cascade branch, and takes
    `RATE_LIMITED`, `PROBE_FAILED` and `DDOS_PROTECTION` from correct-or-nearly
    to the terminal dead end. **This assertion, together with the exact key-set
    pin, IS the 3-code regression fence** — a grep cannot be, because every
    `service_error` call in these routers is multi-line, so a regressing
    `service_error(\n    424,` scores zero grep hits and sails through.
  - **`body["detail"] == <literal typed here>`** is the cross-language contract.
    A reword on either side silently breaks classification.
  - **`recoverable` pinned in BOTH directions.** A field that is always `True`
    pins nothing. The permanent control (`AUTH_FAILED` ⇒ `False`) and the
    unknown-code control (⇒ `True`) are what give it teeth.
  - **status stays 400.** The classifier discards the upstream status entirely,
    so 400 -> 424 would be user-invisible; that remap is owed as ONE unit with
    TS-05 (ledger row TS-32) and is deliberately not done here. Pinned so it
    cannot drift in silently either.

ORACLE DISCIPLINE (programme non-negotiable #3). Every WIRE expectation below —
status, key set, `detail`, `code`, `recoverable` — is a **literal typed into
this file**. The `recoverable` derivation lives in the router and is imported
nowhere here. **Exactly one class of production import is permitted, and it is
REQUIRED**: the cross-artifact copy pins at the bottom of this file import the
copy constants from `services.exchange` *inside the pin function bodies* and
compare them to the same module-level `EXPECTED_*` literals the wire cases use.
That is the `tests/test_sfox_validate.py:462-471` pattern, and it is permitted
precisely because it makes the oracle CROSS-artifact (test literal vs production
constant) rather than self-referential.

⚠️ **Why the pins are not optional.** C1-C5 name their constant in the router,
so the wire cases genuinely prove byte-identity there. **C6 and C7 read
`result["error"]` / `validation["error"]` — values THIS FILE STUBS.** Those
cases prove PASS-THROUGH only; on their own they could not detect a reword of
the real production copy, so a copy change would silently break the cascade at
the two highest-traffic sites with every test still green. The pins close that.

⚠️ **ANALOG WARNING.** `tests/test_mt5_validate.py` imports the production
detail constants at module scope and asserts `ei.value.detail ==
NETWORK_ERROR_DETAIL` — the oracle reading its expectation out of the thing
under test, so rewording the constant ships green. That file's own 140.1.1
correction says so at `:483-489`. **Do not copy it.** The pattern copied here is
`tests/test_sfox_validate.py:48` / `:242` / `:462-471`.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient


# --------------------------------------------------------------------------- #
# The copy, typed here. Read once at HEAD and retyped — never imported at module
# scope. These are the EXACT strings the TS substring cascade classifies; if one
# of them changes, `classifyKeyValidationError` changes behaviour.
# --------------------------------------------------------------------------- #

EXPECTED_RATE_LIMITED_DETAIL = (
    "Exchange rate-limited the validation request. Wait a moment and try "
    "again — repeated failures may indicate a missing read scope."
)
EXPECTED_NETWORK_ERROR_DETAIL = (
    "Network error reaching the exchange. Check connectivity and try again."
)
EXPECTED_AUTH_FAILED_DETAIL = (
    "Authentication failed. Check your API key and secret."
)
EXPECTED_EXCHANGE_UNAVAILABLE_DETAIL = (
    "Exchange is currently unavailable. Try again in a few minutes."
)
EXPECTED_DDOS_PROTECTION_DETAIL = (
    "Exchange blocked the validation request at the edge "
    "(DDoS / WAF protection). Check region / IP allowlist."
)
EXPECTED_PROBE_FAILED_DETAIL = (
    "Could not verify the key's permission scopes — the permission probe "
    "failed. Try again in a moment."
)

# The synthetic unknown-code control. Deliberately NOT a member of any real
# vocabulary — if a future phase mints this string as a real code, this control
# stops testing what it claims to and must be re-synthesised.
UNKNOWN_CODE = "ZZ_UNRECOGNISED_VENUE_CODE"
UNKNOWN_CODE_DETAIL = "A synthetic verdict from a venue code this router has never seen."

# The contract's own shape. A key ADDED or DROPPED on either side reddens.
EXPECTED_BODY_KEYS = {"detail", "code", "recoverable"}
EXPECTED_STATUS = 400

_SERVICE_KEY = "venue-transient-suite-service-key"

# --------------------------------------------------------------------------- #
# The committed cross-language fixture. LOADED, never generated: the `python`
# and `frontend-test` CI jobs are siblings with no `needs:` edge, so a file one
# writes is invisible to the other. 140.3 binds its TS parity test to these same
# bytes (ledger row TS-35).
# --------------------------------------------------------------------------- #

_FIXTURE = Path(__file__).parent / "fixtures" / "validate_key_venue_transient_contract.json"
_SPEC: dict[str, Any] = json.loads(_FIXTURE.read_text(encoding="utf-8"))
_CASES: list[dict[str, Any]] = _SPEC["cases"]
_BY_TRIGGER: dict[str, dict[str, Any]] = {c["trigger"]: c for c in _CASES}


# --------------------------------------------------------------------------- #
# Harness
# --------------------------------------------------------------------------- #


@pytest.fixture()
def app_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """The FULL ``main.app`` as a TestClient.

    The BODY on the wire is what this file asserts, so the request MUST traverse
    the app's exception handlers — a bare ``FastAPI()`` with the router mounted
    would not have the ``VenueTransientHTTPException`` handler registered and
    would render the DEFAULT ``{"detail": …}`` shape, i.e. it would silently
    "pass" a body that never carried the machine code. Cloned from
    ``tests/test_process_key_onboard_contract.py``'s ``full_stack_client``.

    ``SERVICE_KEY`` is patched on the MODULE GLOBAL because that is what
    ``verify_service_key`` compares against (main.py captures it once at import).
    The sFOX/MT5 go-live gates are set via env, which
    ``sfox_enabled_server()`` / ``mt5_enabled_server()`` read PER CALL.

    The shared slowapi limiter is reset: PYAPI-03 made every router share one
    process-wide ``memory://`` store, so a sibling module's earlier requests can
    push these routes past their ceiling and a slowapi 429 would masquerade as
    the arm under test. The exact-status and exact-key-set assertions are the
    second, independent guard against that false green.
    """
    monkeypatch.setenv("SFOX_ENABLED", "true")
    monkeypatch.setenv("MT5_ENABLED", "true")
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    import main

    # Reset the limiter the APP holds, not whatever `services.rate_limit` resolves
    # to now — same stale-module hazard as `_handler_globals` documents.
    _reset = getattr(getattr(main.app.state, "limiter", None), "reset", None)
    if callable(_reset):
        _reset()

    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY)
    return TestClient(main.app, raise_server_exceptions=False)


def _handler_globals(path: str, method: str = "POST") -> dict[str, Any]:
    """The namespace the REGISTERED route handler actually reads at request time.

    ⚠️ Resolving the router by ``from routers import exchange`` is WRONG here and
    silently produces false greens. Several sibling suites call
    ``tests/limiter_stub.evict_module("routers.exchange")``, which pops the module
    from ``sys.modules``; the next import builds a **new module object**, while
    ``main.app``'s routes still hold the function objects from the FIRST import —
    whose ``__globals__`` is the ORIGINAL module dict. Patching the re-imported
    module therefore does not reach the code the wire request executes: run alone
    this file passed, run inside the full suite the venue boundary was UNPATCHED
    and the stubs never applied.

    So the namespace is taken from the registered endpoint itself (unwrapped past
    the slowapi decorator, whose own ``__globals__`` belongs to slowapi). That is
    the one dict the handler is guaranteed to read, whatever import order the rest
    of the suite imposed.
    """
    import inspect

    import main

    for route in main.app.routes:
        if getattr(route, "path", None) != path:
            continue
        if method not in (getattr(route, "methods", None) or set()):
            continue
        return inspect.unwrap(route.endpoint).__globals__
    raise AssertionError(
        f"no {method} {path} route is registered on main.app — the harness is "
        f"pointing at nothing and every assertion below would be vacuous"
    )


def _post_validate_key(client: TestClient, **overrides: Any) -> Any:
    fields: dict[str, Any] = {
        "exchange": "binance",
        "api_key": "synthetic-key",
        "api_secret": "synthetic-secret",
        "passphrase": None,
    }
    fields.update(overrides)
    return client.post(
        "/api/validate-key",
        json=fields,
        headers={"X-Service-Key": _SERVICE_KEY},
    )


def _verdict(error: str, error_code: str) -> dict[str, Any]:
    """A ``validate_key_permissions`` return whose ONLY variable is the verdict.

    The two producers of this shape (the ccxt path at C6 and verify-strategy at
    C7) are stubbed with the SAME helper so a divergence between the two sites
    cannot hide behind two different fakes.
    """
    return {
        "valid": False,
        "read_only": False,
        "error": error,
        "error_code": error_code,
        "markets_loaded": True,
        "markets_error": None,
        "probe_error": False,
    }


def _arrange_ccxt(monkeypatch: pytest.MonkeyPatch, verdict: dict[str, Any]) -> None:
    """Walk POST /api/validate-key's ccxt path down to the C6 collapse."""
    g = _handler_globals("/api/validate-key")

    monkeypatch.setitem(
        g, "create_exchange", MagicMock(return_value=MagicMock(name="ccxt"))
    )
    monkeypatch.setitem(g, "aclose_exchange", AsyncMock(return_value=None))
    monkeypatch.setitem(
        g, "validate_key_permissions", AsyncMock(return_value=verdict)
    )


def _arrange_sfox(monkeypatch: pytest.MonkeyPatch, status: int) -> None:
    """Walk the sFOX branch into ``except SfoxApiError`` with the given status."""
    from services.sfox_client import SfoxApiError

    g = _handler_globals("/api/validate-key")

    client = MagicMock(name="SfoxClient-instance")
    client.get_balances = AsyncMock(side_effect=SfoxApiError(status, "synthetic"))
    client.aclose = AsyncMock(return_value=None)
    monkeypatch.setitem(g, "make_sfox_client", MagicMock(return_value=client))


def _arrange_mt5(
    monkeypatch: pytest.MonkeyPatch,
    *,
    login_raises: BaseException | None = None,
    account: dict[str, Any] | None = None,
) -> None:
    """Walk the MT5 branch to the probe with a stubbed synchronous Mt5Client."""
    g = _handler_globals("/api/validate-key")

    client = MagicMock(name="Mt5Client-instance")
    if login_raises is not None:
        client.login = MagicMock(side_effect=login_raises)
    else:
        client.login = MagicMock(return_value=None)
    client.account_info = MagicMock(return_value=account if account is not None else {})
    client.order_check = MagicMock(return_value={})
    client.close = MagicMock()
    monkeypatch.setitem(g, "Mt5Client", MagicMock(return_value=client))


_MT5_FIELDS: dict[str, Any] = {
    # Credential-slot reuse: login -> api_key, investor pw -> api_secret,
    # broker server -> passphrase.
    "exchange": "mt5",
    "api_key": "123456",
    "api_secret": "investor-pw",
    "passphrase": "Broker-Demo",
}


# --------------------------------------------------------------------------- #
# THE assertion. Every wire case funnels through here so no site can be pinned
# more weakly than any other — a per-site helper is how a class gets closed at a
# subset without anyone noticing.
# --------------------------------------------------------------------------- #


def _assert_flat_venue_body(
    response: Any,
    *,
    trigger: str,
    detail: str,
    code: str,
    recoverable: bool,
) -> None:
    body = response.json()

    assert response.status_code == EXPECTED_STATUS, (
        f"{trigger}: status must stay {EXPECTED_STATUS} — the TS classifier "
        f"derives BOTH the wizard code and the returned status from the message "
        f"string and discards the upstream status entirely, so a remap here is "
        f"user-invisible and is owed as ONE unit with TS-05 (ledger TS-32). "
        f"got {response.status_code} with {body!r}"
    )
    assert set(body) == EXPECTED_BODY_KEYS, (
        f"{trigger}: the wire body must be EXACTLY {sorted(EXPECTED_BODY_KEYS)} — "
        f"got {sorted(body)}. A missing 'code' means the site still raises a "
        f"plain HTTPException (or the app-global handler never matched); extra "
        f"keys mean the envelope drifted."
    )
    assert type(body["detail"]) is str, (
        f"{trigger}: body.detail MUST be a scalar string. An object here "
        f"stringifies to '[object Object]' through analytics-client.ts's "
        f"`error.detail ?? …`, misses every substring branch, and regresses "
        f"RATE_LIMITED / PROBE_FAILED / DDOS_PROTECTION from correct "
        f"classification to UNKNOWN/500. got {type(body['detail']).__name__}"
    )
    assert body["detail"] == detail, (
        f"{trigger}: the human string IS the classification channel today. This "
        f"literal is typed in the test; a mismatch means the copy was reworded "
        f"and classifyKeyValidationError's behaviour changed with it."
    )
    assert body["code"] == code, (
        f"{trigger}: the machine discriminator must be {code!r} — reused from "
        f"the vocabulary the site already computes, never re-minted at the route."
    )
    assert type(body["recoverable"]) is bool, (
        f"{trigger}: recoverable must be a JSON boolean, not a truthy value."
    )
    assert body["recoverable"] is recoverable, (
        f"{trigger}: expected recoverable={recoverable}. A wrong False is the "
        f"defect this phase exists to kill — a real venue blip rendered with no "
        f"retry affordance. A wrong True on a permanent credential fault invites "
        f"a pointless retry on a key that can never work."
    )

    # Fixture parity — the committed case table is 140.3's TS input, so it must
    # not be allowed to drift away from the pins above.
    spec = _BY_TRIGGER[trigger]
    assert spec["status"] == EXPECTED_STATUS
    assert spec["body"] == {
        "detail": detail,
        "code": code,
        "recoverable": recoverable,
    }, (
        f"{trigger}: the committed fixture disagrees with the literals pinned in "
        f"this test. The fixture is what 140.3's TypeScript parity test reads; a "
        f"drift here hands the other language a contract nobody emits."
    )
    assert spec["body"] == body, (
        f"{trigger}: the committed fixture disagrees with the REAL wire body."
    )


# --------------------------------------------------------------------------- #
# C1 / C2 — the sFOX arms
# --------------------------------------------------------------------------- #


def test_c1_sfox_rate_limited_carries_a_machine_code(app_client, monkeypatch) -> None:
    """C1 — sFOX answered 429.

    A throttle is an UPSTREAM condition, never bad credentials. This verdict
    already classifies correctly today (the copy contains "rate"), so the value
    of this case is the ZERO-REGRESSION half: the string must not move by a
    single byte while the machine code is added beside it.
    """
    _arrange_sfox(monkeypatch, 429)

    r = _post_validate_key(app_client, exchange="sfox", api_key="tok")

    _assert_flat_venue_body(
        r,
        trigger="sfox_http_429",
        detail=EXPECTED_RATE_LIMITED_DETAIL,
        code="RATE_LIMITED",
        recoverable=True,
    )


def test_c2_sfox_transport_failure_carries_a_machine_code(
    app_client, monkeypatch
) -> None:
    """C2 — sFOX answered 5xx (exchange down) or status==0 (transport blip).

    An upstream/transport problem, never the user's key. Today's copy matches no
    cascade branch, so this is one of the two verdicts that renders as the
    UNKNOWN/500 dead end.
    """
    _arrange_sfox(monkeypatch, 503)

    r = _post_validate_key(app_client, exchange="sfox", api_key="tok")

    _assert_flat_venue_body(
        r,
        trigger="sfox_http_503",
        detail=EXPECTED_NETWORK_ERROR_DETAIL,
        code="NETWORK_UNAVAILABLE",
        recoverable=True,
    )


# --------------------------------------------------------------------------- #
# C3 / C4 / C5 — the three MT5 arms the call-graph enumeration missed
#
# `_validate_mt5_key` never calls `validate_key_permissions`, so an enumeration
# by "consumers of validate_key_permissions" finds none of these three — they
# are found only by the BEHAVIOURAL predicate. They are structurally identical
# to C2 and were outside TS-32's carve-out entirely.
# --------------------------------------------------------------------------- #


def test_c3_mt5_probe_timeout_carries_a_machine_code(app_client, monkeypatch) -> None:
    """C3 — the MT5 RPyC probe timed out: a hung upstream bridge.

    The code is `NETWORK_UNAVAILABLE` because that is what the copy this arm
    already emits SAYS. Vocabulary reused, never re-minted (the ADAPTER_INIT_FAILED
    lesson: a second name for one condition is the defect the contract exists to
    stop).
    """
    _arrange_mt5(monkeypatch, login_raises=asyncio.TimeoutError())

    r = _post_validate_key(app_client, **_MT5_FIELDS)

    _assert_flat_venue_body(
        r,
        trigger="mt5_probe_timeout",
        detail=EXPECTED_NETWORK_ERROR_DETAIL,
        code="NETWORK_UNAVAILABLE",
        recoverable=True,
    )


def test_c4_mt5_account_mismatch_carries_a_machine_code(
    app_client, monkeypatch
) -> None:
    """C4 — a concurrent validate re-logged the shared terminal mid-probe.

    An INFRA/concurrency fault the router's own comment calls "never the user's
    key". Driven through the REAL `_assert_expected_login` bracket (the stubbed
    `account_info` returns a DIFFERENT login than the request's), not by stubbing
    the exception in — so the case proves the production bracket still routes
    here.
    """
    _arrange_mt5(monkeypatch, account={"login": 999999})

    r = _post_validate_key(app_client, **_MT5_FIELDS)

    _assert_flat_venue_body(
        r,
        trigger="mt5_account_mismatch",
        detail=EXPECTED_NETWORK_ERROR_DETAIL,
        code="NETWORK_UNAVAILABLE",
        recoverable=True,
    )


def test_c5_mt5_transient_client_error_carries_a_machine_code(
    app_client, monkeypatch
) -> None:
    """C5 — `Mt5ClientError` classified `transient` by the ONE mt5_validation seam.

    Code -10004 ("No IPC connection") is the canonical case: the terminal bridge
    is detached (gateway down / mid-redeploy), which the classifier deliberately
    code-gates to `transient` so a valid key is never permanently rejected during
    an outage.
    """
    from services.mt5_client import Mt5ClientError

    _arrange_mt5(monkeypatch, login_raises=Mt5ClientError(-10004, "No IPC connection"))

    r = _post_validate_key(app_client, **_MT5_FIELDS)

    _assert_flat_venue_body(
        r,
        trigger="mt5_client_error_transient",
        detail=EXPECTED_NETWORK_ERROR_DETAIL,
        code="NETWORK_UNAVAILABLE",
        recoverable=True,
    )


# --------------------------------------------------------------------------- #
# C6 — the ccxt verdict collapse on the live route
# --------------------------------------------------------------------------- #


def test_c6_ccxt_rate_limited_carries_a_machine_code(app_client, monkeypatch) -> None:
    """C6 / RATE_LIMITED — classifies correctly today; must still classify
    correctly after. The whole point of the flat shape is that this stays true."""
    _arrange_ccxt(
        monkeypatch, _verdict(EXPECTED_RATE_LIMITED_DETAIL, "RATE_LIMITED")
    )

    r = _post_validate_key(app_client)

    _assert_flat_venue_body(
        r,
        trigger="ccxt_rate_limited",
        detail=EXPECTED_RATE_LIMITED_DETAIL,
        code="RATE_LIMITED",
        recoverable=True,
    )


def test_c6_ccxt_ddos_protection_carries_a_machine_code(
    app_client, monkeypatch
) -> None:
    """C6 / DDOS_PROTECTION — routes to KEY_IP_ALLOWLIST today (wrong code, right
    flavour). The machine code is what lets 140.3 fix the code without touching
    the copy."""
    _arrange_ccxt(
        monkeypatch, _verdict(EXPECTED_DDOS_PROTECTION_DETAIL, "DDOS_PROTECTION")
    )

    r = _post_validate_key(app_client)

    _assert_flat_venue_body(
        r,
        trigger="ccxt_ddos_protection",
        detail=EXPECTED_DDOS_PROTECTION_DETAIL,
        code="DDOS_PROTECTION",
        recoverable=True,
    )


def test_c6_binance_maintenance_shape_is_machine_classifiable(
    app_client, monkeypatch
) -> None:
    """⭐ C6 / EXCHANGE_UNAVAILABLE — **the phase's headline case**.

    This is the Binance-maintenance-shaped failure during key-connect. Its copy
    matches NO branch of the substring cascade, so today it renders as
    `UNKNOWN`/500 — "something went wrong, our team has been notified", with no
    retry affordance — for a condition that will clear itself in minutes.

    After this plan the wire carries `code=EXCHANGE_UNAVAILABLE` and
    `recoverable=true`: a machine discriminator a wizard can branch on, with the
    human string untouched so nothing that works today stops working. The render
    half (a `WizardErrorCode` branch reading `body.code`) is 140.3's obligation,
    ledger row TS-35 — deliberately NOT attempted here.
    """
    _arrange_ccxt(
        monkeypatch,
        _verdict(EXPECTED_EXCHANGE_UNAVAILABLE_DETAIL, "EXCHANGE_UNAVAILABLE"),
    )

    r = _post_validate_key(app_client)

    _assert_flat_venue_body(
        r,
        trigger="ccxt_exchange_unavailable",
        detail=EXPECTED_EXCHANGE_UNAVAILABLE_DETAIL,
        code="EXCHANGE_UNAVAILABLE",
        recoverable=True,
    )


def test_c6_ccxt_network_unavailable_carries_a_machine_code(
    app_client, monkeypatch
) -> None:
    """C6 / NETWORK_UNAVAILABLE — the second of the two UNKNOWN/500 verdicts.

    The copy contains "Network", but the cascade branch tests "timeout" /
    "etimedout": a two-string near-miss. Rewording the copy to squeak past the
    cascade was considered and rejected as a bandaid (CLAUDE.md Rule 6) — the
    machine code is the root-cause fix.
    """
    _arrange_ccxt(
        monkeypatch, _verdict(EXPECTED_NETWORK_ERROR_DETAIL, "NETWORK_UNAVAILABLE")
    )

    r = _post_validate_key(app_client)

    _assert_flat_venue_body(
        r,
        trigger="ccxt_network_unavailable",
        detail=EXPECTED_NETWORK_ERROR_DETAIL,
        code="NETWORK_UNAVAILABLE",
        recoverable=True,
    )


def test_c6_ccxt_probe_failed_carries_a_machine_code(app_client, monkeypatch) -> None:
    """C6 / PROBE_FAILED — classifies correctly today ("could not verify"). Pinned
    so the flat shape does not cost us a code that already works."""
    _arrange_ccxt(monkeypatch, _verdict(EXPECTED_PROBE_FAILED_DETAIL, "PROBE_FAILED"))

    r = _post_validate_key(app_client)

    _assert_flat_venue_body(
        r,
        trigger="ccxt_probe_failed",
        detail=EXPECTED_PROBE_FAILED_DETAIL,
        code="PROBE_FAILED",
        recoverable=True,
    )


def test_c6_permanent_auth_failure_is_not_recoverable(app_client, monkeypatch) -> None:
    """C6 / AUTH_FAILED — the PERMANENT control, and half of what gives
    `recoverable` teeth.

    `AUTH_FAILED` is in `PERMANENT_VALIDATION_ERROR_CODES`, so `recoverable` must
    be `False`: no number of retries turns a bad key into a good one, and telling
    the user to try again is the mirror-image of the defect this phase fixes.
    Without this case a hard-coded `recoverable=True` would pass every other
    assertion in this file.

    Note also that the `code` rides for EVERY verdict at this site, permanent ones
    included. That is CLOSING THE SITE — not absorbing the separate,
    still-open gap that the permanent-only arms (C1's siblings at the
    AUTH_FAILED / MT5_WRONG_SERVER raises) carry no machine code either.
    """
    _arrange_ccxt(monkeypatch, _verdict(EXPECTED_AUTH_FAILED_DETAIL, "AUTH_FAILED"))

    r = _post_validate_key(app_client)

    _assert_flat_venue_body(
        r,
        trigger="ccxt_auth_failed_permanent_control",
        detail=EXPECTED_AUTH_FAILED_DETAIL,
        code="AUTH_FAILED",
        recoverable=False,
    )


def test_c6_unrecognised_code_still_offers_a_retry_affordance(
    app_client, monkeypatch
) -> None:
    """C6 / unknown code — the FAIL-SAFE control, the other polarity.

    `PERMANENT_VALIDATION_ERROR_CODES` is an ALLOW-LIST OF PERMANENT, not a
    denylist of transient. Non-membership therefore means "not known to be
    permanent", which that constant's own contract defines as retryable — so an
    unrecognised future code MUST yield `recoverable=True`.

    The harm asymmetry is what decides it, and it is decided for THIS route: a
    wrong `True` here costs one pointless user click, because nothing on
    `/api/validate-key` consumes this field in an automated loop (the worker's
    automated-retry decision is a different field on a different path). A wrong
    `False` is the UNKNOWN/500 dead end — an unrecognised venue verdict must
    still offer a retry affordance. ⚠️ If 140.3 ever wires `recoverable` into an
    AUTOMATED retry loop this polarity must be re-derived; recorded in the
    ledger as part of TS-35.
    """
    _arrange_ccxt(monkeypatch, _verdict(UNKNOWN_CODE_DETAIL, UNKNOWN_CODE))

    r = _post_validate_key(app_client)

    _assert_flat_venue_body(
        r,
        trigger="unknown_future_code_control",
        detail=UNKNOWN_CODE_DETAIL,
        code=UNKNOWN_CODE,
        recoverable=True,
    )


# --------------------------------------------------------------------------- #
# C7 — the verify-strategy collapse (DEAD ROUTE, closed for CLASS INTEGRITY)
# --------------------------------------------------------------------------- #


def _post_verify_strategy(client: TestClient, email: str) -> Any:
    return client.post(
        "/api/verify-strategy",
        json={
            "email": email,
            "exchange": "binance",
            "api_key": "synthetic-key",
            "api_secret": "synthetic-secret",
            "passphrase": None,
        },
        headers={"X-Service-Key": _SERVICE_KEY},
    )


def _arrange_verify_strategy(
    monkeypatch: pytest.MonkeyPatch, verdict: dict[str, Any]
) -> None:
    g = _handler_globals("/api/verify-strategy")

    monkeypatch.setitem(
        g, "create_exchange", MagicMock(return_value=MagicMock(name="ccxt"))
    )
    monkeypatch.setitem(g, "aclose_exchange", AsyncMock(return_value=None))
    monkeypatch.setitem(
        g, "validate_key_permissions", AsyncMock(return_value=verdict)
    )


def test_c7_dead_route_collapse_carries_a_machine_code(
    app_client, monkeypatch
) -> None:
    """C7 — the structurally identical collapse in `verify_strategy`.

    ⚠️ **This route is DEAD.** `/api/verify-strategy` appears among none of the
    nine seam paths in `src/lib/analytics-client.ts`; the Next.js route of the
    same name calls `/process-key`, not this handler. The rationale for closing
    it is therefore **CLASS INTEGRITY, not user impact** — a class closed at six
    of its seven structurally identical sites re-opens the moment the seventh is
    revived, and "we fixed the ones with traffic" is exactly how the
    instance-not-class defect gets re-introduced.

    Same producer (`validate_key_permissions`), same verdict shape, so it must
    answer with the same envelope and the same `recoverable` rule.
    """
    _arrange_verify_strategy(
        monkeypatch,
        _verdict(EXPECTED_EXCHANGE_UNAVAILABLE_DETAIL, "EXCHANGE_UNAVAILABLE"),
    )

    r = _post_verify_strategy(app_client, "c7-transient@example.test")

    _assert_flat_venue_body(
        r,
        trigger="verify_strategy_exchange_unavailable",
        detail=EXPECTED_EXCHANGE_UNAVAILABLE_DETAIL,
        code="EXCHANGE_UNAVAILABLE",
        recoverable=True,
    )


def test_c7_permanent_auth_failure_is_not_recoverable(app_client, monkeypatch) -> None:
    """C7 / AUTH_FAILED — the permanent control at the SECOND collapse site.

    Duplicated deliberately. The `recoverable` derivation has to be the same rule
    at both sites, not a rule that happens to hold at the one with traffic; a
    site-local re-derivation is how two sites drift apart.
    """
    _arrange_verify_strategy(
        monkeypatch, _verdict(EXPECTED_AUTH_FAILED_DETAIL, "AUTH_FAILED")
    )

    r = _post_verify_strategy(app_client, "c7-permanent@example.test")

    _assert_flat_venue_body(
        r,
        trigger="verify_strategy_auth_failed_permanent_control",
        detail=EXPECTED_AUTH_FAILED_DETAIL,
        code="AUTH_FAILED",
        recoverable=False,
    )


# --------------------------------------------------------------------------- #
# The exception class's own guard
# --------------------------------------------------------------------------- #


def test_venue_transient_exception_refuses_a_non_scalar_detail() -> None:
    """The second layer of the 3-code regression fence, at CONSTRUCTION time.

    `service_error(...)` nests an object at `body["detail"]`. If someone later
    "unifies" these seven sites onto it — a natural-looking cleanup — the wire
    body becomes `{"detail": {...}}`, `error.detail ?? …` yields an object,
    `AnalyticsUpstreamError.message` becomes "[object Object]", and three codes
    that classify correctly today collapse to UNKNOWN/500.

    The class refuses to be constructed with a non-scalar detail, so the mistake
    cannot even reach the wire. A `ValueError` escaping a raise site becomes a
    bodyless 500, which contract rule R-1 makes safe — and loud.
    """
    from services.error_contract import VenueTransientHTTPException

    # The exact shape `service_error(...)` would nest here, typed as Any so the
    # test states the runtime contract without a `# type: ignore`.
    nested_envelope: Any = {
        "code": "EXCHANGE_UNAVAILABLE",
        "dependency": None,
        "retryable": True,
        "detail": EXPECTED_EXCHANGE_UNAVAILABLE_DETAIL,
    }

    with pytest.raises(ValueError) as ei:
        VenueTransientHTTPException(
            status_code=400,
            code="EXCHANGE_UNAVAILABLE",
            detail=nested_envelope,
            recoverable=True,
        )

    assert "scalar" in str(ei.value).lower()


def test_venue_transient_exception_refuses_an_empty_code() -> None:
    """Fail LOUD, never default (CLAUDE.md Rule 12).

    C6/C7 carry `result["error_code"]` VERBATIM — there is no route-minted
    fallback, because a route-minted code default is the refuted shape this phase
    fences out. The invariant that makes that safe (`error` set ⇒ `error_code`
    set) lives in `services/exchange.py` and was verified branch-by-branch. This
    guard is what happens if that invariant is ever broken there: a loud
    `ValueError` naming the contract, never a plausible-looking fabricated code
    handed to the wizard on the live key-connect route.
    """
    from services.error_contract import VenueTransientHTTPException

    bad_codes: list[Any] = ["", None]
    for bad in bad_codes:
        with pytest.raises(ValueError):
            VenueTransientHTTPException(
                status_code=400,
                code=bad,
                detail="anything",
                recoverable=True,
            )


# --------------------------------------------------------------------------- #
# The HANDLER's parity with the handler it SHADOWS
# --------------------------------------------------------------------------- #


def test_venue_transient_handler_forwards_exception_headers() -> None:
    """A shadowing handler must not be lossy.

    `VenueTransientHTTPException` is an `HTTPException` SUBCLASS, so Starlette's
    `type(exc).__mro__` walk routes it to `main.venue_transient_exception_handler`
    INSTEAD of FastAPI's default `HTTPException` handler — which forwards
    `exc.headers` onto the response. Dropping them here would make the shadowing
    silently lossy for any future site, and the sibling handler two blocks above
    in `main.py` exists PRECISELY to emit a `Retry-After`, so "a venue-transient
    site that wants a header" is a plausible next step rather than a hypothetical.

    Asserted at the handler rather than over the wire because no raise site sets a
    header today (the subclass `__init__` forwards none) — there is no request
    that could exercise it end to end, and a test that waits for one is a test
    that never runs.
    """
    import main
    from services.error_contract import VenueTransientHTTPException

    verdict = VenueTransientHTTPException(
        status_code=EXPECTED_STATUS,
        code="NETWORK_UNAVAILABLE",
        detail=EXPECTED_NETWORK_ERROR_DETAIL,
        recoverable=True,
    )
    verdict.headers = {"Retry-After": "37", "X-Venue-Probe": "synthetic"}

    response = asyncio.run(
        main.venue_transient_exception_handler(cast(Any, None), verdict)
    )

    assert response.headers["Retry-After"] == "37", (
        "the handler dropped exc.headers. FastAPI's default HTTPException "
        "handler — the one this subclass handler shadows — forwards them, so "
        "dropping them makes the shadowing lossy with no trace."
    )
    assert response.headers["X-Venue-Probe"] == "synthetic"

    # …and forwarding headers must not have disturbed the body contract.
    assert json.loads(bytes(response.body)) == {
        "detail": EXPECTED_NETWORK_ERROR_DETAIL,
        "code": "NETWORK_UNAVAILABLE",
        "recoverable": True,
    }


def test_venue_transient_handler_handles_the_no_header_case() -> None:
    """`exc.headers` is `None` at all seven current sites — the forwarding must
    be a no-op there, not a crash. This is the case every wire test above
    actually exercises; it is pinned directly so the two cannot drift apart.
    """
    import main
    from services.error_contract import VenueTransientHTTPException

    verdict = VenueTransientHTTPException(
        status_code=EXPECTED_STATUS,
        code="RATE_LIMITED",
        detail=EXPECTED_RATE_LIMITED_DETAIL,
        recoverable=True,
    )
    assert verdict.headers is None

    response = asyncio.run(
        main.venue_transient_exception_handler(cast(Any, None), verdict)
    )

    assert response.status_code == EXPECTED_STATUS
    assert "retry-after" not in {k.lower() for k in response.headers}
    assert json.loads(bytes(response.body)) == {
        "detail": EXPECTED_RATE_LIMITED_DETAIL,
        "code": "RATE_LIMITED",
        "recoverable": True,
    }


# --------------------------------------------------------------------------- #
# W-3 — the CROSS-ARTIFACT copy pins.
#
# THE ONE permitted production import in this file, and it is REQUIRED. The wire
# cases at C6/C7 stub `result["error"]`, so on their own they prove PASS-THROUGH,
# not byte-identity with the REAL production copy: a reword in
# services/exchange.py would break `classifyKeyValidationError` at the two
# highest-traffic sites with every wire case still green.
#
# The imports live INSIDE these functions and appear in no wire case. Compared
# against the SAME module-level EXPECTED_* literals the wire cases use, this
# makes the oracle cross-artifact (test literal vs production constant) rather
# than self-referential — the justification `tests/test_sfox_validate.py:470`
# already carries.
# --------------------------------------------------------------------------- #


def test_hoisted_copy_constants_match_the_literals_pinned_here() -> None:
    """The three HOISTED constants C1-C5 and two C6 verdicts emit."""
    from services.exchange import (
        AUTH_FAILED_DETAIL,
        NETWORK_ERROR_DETAIL,
        RATE_LIMITED_DETAIL,
    )

    assert RATE_LIMITED_DETAIL == EXPECTED_RATE_LIMITED_DETAIL
    assert NETWORK_ERROR_DETAIL == EXPECTED_NETWORK_ERROR_DETAIL
    assert AUTH_FAILED_DETAIL == EXPECTED_AUTH_FAILED_DETAIL

    # The substring the cascade actually keys on, asserted separately: equality
    # to a literal proves the string did not move, this proves WHY it matters.
    assert "rate" in RATE_LIMITED_DETAIL.lower()
    assert "authentication failed" in AUTH_FAILED_DETAIL.lower()


def test_inline_verdict_copy_matches_the_literals_pinned_here() -> None:
    """The three verdict strings that are NOT hoisted constants.

    `EXCHANGE_UNAVAILABLE`, `DDOS_PROTECTION` and `PROBE_FAILED` are written
    inline inside `validate_key_permissions`' except/if arms, so there is no
    constant to import. They are extracted from the SOURCE by AST — the literal
    assigned to `result["error"]` in the same branch that assigns the matching
    `result["error_code"]` — and compared to the literals typed at the top of
    this file. A reword of any of them changes what
    `classifyKeyValidationError` sees, and for `DDOS_PROTECTION` it would
    actively break a code that classifies correctly today (via "ip" + "allow").
    """
    import ast
    import inspect

    import services.exchange as exchange_service

    source = inspect.getsource(exchange_service)
    tree = ast.parse(source)

    by_code: dict[str, str] = {}
    for node in ast.walk(tree):
        if not (
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == "validate_key_permissions"
        ):
            continue
        # Walk the branch bodies so an `error` literal is paired with the
        # `error_code` assigned in the SAME branch, never with a neighbour's.
        for block in ast.walk(node):
            body = getattr(block, "body", None)
            if not isinstance(body, list):
                continue
            pending: str | None = None
            for stmt in body:
                if not (isinstance(stmt, ast.Assign) and len(stmt.targets) == 1):
                    continue
                target = ast.unparse(stmt.targets[0])
                if target == "result['error']" and isinstance(stmt.value, ast.Constant):
                    pending = stmt.value.value
                elif target == "result['error_code']" and isinstance(
                    stmt.value, ast.Constant
                ):
                    if pending is not None:
                        by_code[stmt.value.value] = pending
                    pending = None

    assert by_code.get("EXCHANGE_UNAVAILABLE") == EXPECTED_EXCHANGE_UNAVAILABLE_DETAIL
    assert by_code.get("DDOS_PROTECTION") == EXPECTED_DDOS_PROTECTION_DETAIL
    assert by_code.get("PROBE_FAILED") == EXPECTED_PROBE_FAILED_DETAIL

    # The substrings the cascade keys on for the one of the three that works.
    ddos = by_code["DDOS_PROTECTION"].lower()
    assert "ip" in ddos and "allow" in ddos
    assert "could not verify" in by_code["PROBE_FAILED"].lower()


def test_error_implies_error_code_at_every_producer_branch() -> None:
    """The invariant that makes "carry the code VERBATIM, no fallback" safe.

    C6 and C7 read `result["error_code"]` with NO default, because a
    route-minted code default is the refuted shape this phase fences out and
    would mask a real service-layer bug behind a plausible envelope. That is only
    correct while EVERY branch which sets `error` also sets `error_code`. This
    test is that invariant, mechanised: if someone adds a branch in
    `validate_key_permissions` that sets `error` alone, it reddens HERE — at the
    producer — instead of surfacing as a `ValueError` on the live key-connect
    route.

    ⚠️ Two failure modes of the walk itself are fenced, because a mechanised
    invariant that stops matching its own subject passes vacuously:

    * **Order.** The obligation is "the SAME branch also sets `error_code`", not
      "sets it AFTERWARDS". A branch writing the code first is correct and must
      not be reported as unpaired, so the two assignment sets are collected over
      the whole statement list and compared, never walked as a pending pair.
    * **Vacuity.** If a refactor moves the producer off bare
      `result["error"] = …` (e.g. onto `result.update({...})`, an `ast.Call`
      this walk cannot see), the walk finds NOTHING and every branch trivially
      satisfies the invariant. `found` is therefore asserted non-empty against a
      literal floor, so that refactor reddens HERE and forces the walk to be
      re-pointed rather than silently going blind.
    """
    import ast
    import inspect

    import services.exchange as exchange_service

    tree = ast.parse(inspect.getsource(exchange_service))

    # The number of `result["error"] = …` sites the walk must keep seeing. A
    # literal FLOOR, not `==`: 12 were counted at HEAD, and the slack is
    # deliberate so that adding or retiring a correctly-paired branch is not a
    # test edit, while the walk going blind (12 -> ~0) still reddens.
    MIN_ERROR_ASSIGNMENTS = 9

    # `body` alone is not the whole tree: an `else:` / `finally:` suite is a
    # separate statement list, so a branch that set `error` there would be an
    # invisible false green. None exist at HEAD; scanning them keeps it that way.
    _STMT_LISTS = ("body", "orelse", "finalbody")

    unpaired: list[int] = []
    found: list[int] = []
    for node in ast.walk(tree):
        if not (
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == "validate_key_permissions"
        ):
            continue
        for block in ast.walk(node):
            for attr in _STMT_LISTS:
                suite = getattr(block, attr, None)
                if not isinstance(suite, list):
                    continue
                error_lines: list[int] = []
                code_assigned = False
                for stmt in suite:
                    if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1:
                        target = ast.unparse(stmt.targets[0])
                        if target == "result['error']":
                            error_lines.append(stmt.lineno)
                            continue
                        if target == "result['error_code']":
                            code_assigned = True
                            continue
                found.extend(error_lines)
                if error_lines and not code_assigned:
                    unpaired.extend(error_lines)

    assert unpaired == [], (
        "validate_key_permissions sets result['error'] with no result['error_code'] "
        f"anywhere in the same branch at line(s) {unpaired}. The routers carry the "
        "code VERBATIM with no fallback (a route-minted default is forbidden), so "
        "this branch would raise on the LIVE key-connect route. Set the code in the "
        "same branch in services/exchange.py."
    )
    assert len(found) >= MIN_ERROR_ASSIGNMENTS, (
        f"this walk found only {len(found)} `result['error'] = …` assignment(s) in "
        f"validate_key_permissions, below the floor of {MIN_ERROR_ASSIGNMENTS} read "
        "at HEAD. The producer invariant is unchecked, not satisfied: the sites "
        "probably moved to a form this AST walk cannot see (result.update({...}), "
        "a helper, a comprehension). Re-point the walk — do not lower the floor to "
        "make this pass."
    )
