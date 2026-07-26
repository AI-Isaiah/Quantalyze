"""PYAPI-04 (C-18) — `/process-key` must be AUTH-FIRST.

Before this phase the effective gate order on `/process-key` was::

    1. pydantic body validation   -> 422   (FastAPI, before the handler)
    2. slowapi @limiter.limit     -> 429   (decorator, wraps the coroutine)
    3. _verify_internal_token     -> 403   (FIRST STATEMENT of the handler body)

so an unauthenticated caller could (a) enumerate server-side feature flags out
of the 422 body (`SFOX_ENABLED is off` / `MT5_ENABLED is off` appear verbatim in
`msg`) and (b) reach the throttle layer at all. The fix moves the bearer check
into `main.verify_service_key` — Starlette middleware, which runs BEFORE routing
and therefore before both validation and slowapi. New order::

    1. INTERNAL_API_TOKEN bearer  -> 500 (secret unset) / 401 (bad or absent)
    2. pydantic body validation   -> 422
    3. slowapi @limiter.limit     -> 429
    4. _verify_internal_token     -> 403   (defence-in-depth, now unreachable
                                            through the full app)

These tests drive the REAL `main.app` stack via `httpx.ASGITransport` (which does
NOT run lifespan, so the worker loops never start) — the same harness
`test_verify_service_key_middleware.py` uses. Driving the isolated router app
would not exercise the middleware at all and the whole file would pass
vacuously.

⚠️ 140.1-08 (PYAPI-07) landed an app-global 422 handler that builds `detail`
from `type` + `loc` ONLY, so the flag names no longer appear in a 422 body for
ANY caller — authenticated or not. `_FLAG_SUBSTRINGS` is therefore asserted
absent on BOTH the 401 (this file's original claim) and the 422 (new). The two
fixes are additive: auth ORDERING closes the anonymous path, the handler closes
the body echo everywhere. Neither stands in for the other.

Oracle discipline (programme non-negotiable #3): every expected status, code and
substring below is a LITERAL. Nothing is read back out of the code under test.
"""

from __future__ import annotations

from typing import Any, Iterator

import httpx
import pytest

# The bearer the "authenticated" cases present. 64 chars, no newline (H-12).
_GOOD_TOKEN = "a" * 64

# A body that is GUARANTEED to fail pydantic validation while the founder flags
# are off: `_validate_source_per_flow` raises "SFOX-F2: ... (SFOX_ENABLED is
# off)." for source="sfox". It is the enumeration payload from C-18.
_FLAG_PROBE_BODY: dict[str, Any] = {
    "flow_type": "onboard",
    "source": "sfox",
    "context": {"strategy_id": "s1"},
}

# The substrings an unauthenticated caller must NEVER see. THIS is the real
# oracle for PYAPI-04a — a status check alone still passes if someone later
# moves the flag name into the auth error body.
_FLAG_SUBSTRINGS = ("SFOX_ENABLED", "SFOX", "MT5_ENABLED", "MT5")

# A body that PASSES validation, so the request reaches the limiter and the
# handler. Mirrors tests/test_process_key.py::_csv_validate_body.
_VALID_BODY: dict[str, Any] = {
    "flow_type": "csv",
    "source": "csv",
    "context": {
        "step": "validate",
        "wizard_session_id": "00000000-0000-0000-0000-000000000001",
        "fmt": "trades",
        "raw_bytes_base64": "Y29sCjE=",
    },
}


@pytest.fixture
def flags_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """Founder flags off — the state in which the 422 names them."""
    monkeypatch.delenv("SFOX_ENABLED", raising=False)
    monkeypatch.delenv("MT5_ENABLED", raising=False)


@pytest.fixture
def fresh_limiter() -> Iterator[Any]:
    """Isolate slowapi's module-global in-memory storage.

    `services.rate_limit.limiter` is a process-wide singleton with `memory://`
    storage (RESEARCH G-3), so counts leak between tests in the same session.
    Reset on the way in AND on the way out.
    """
    from services.rate_limit import limiter

    limiter.reset()
    yield limiter
    limiter.reset()


def _process_key_limiter_hits(limiter: Any) -> int:
    """Total slowapi hits recorded against the /process-key path.

    slowapi builds each storage key as ``LIMITER/<key>/<scope>/<limit>`` where
    ``scope`` is ``request["path"]`` (RESEARCH G-2, `_key_style == "url"`), so
    every `/process-key` counter contains the literal path segment. Zero here
    means the limiter was never reached.
    """
    storage = limiter._storage.storage
    return sum(v for k, v in storage.items() if "/process-key" in k)


def _client(**kwargs: Any) -> httpx.AsyncClient:
    import main

    transport = httpx.ASGITransport(app=main.app, **kwargs)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


# ---------------------------------------------------------------------------
# PYAPI-04a — unauthenticated requests never reach validation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unauthenticated_process_key_is_401_and_names_no_flag(
    monkeypatch: pytest.MonkeyPatch, flags_off: None, fresh_limiter: Any
) -> None:
    """PYAPI-04a: no bearer + a body that would 422 naming SFOX_ENABLED.

    Two assertions, and the SECOND is the one that matters: the status could be
    fixed while the copy still leaked. Under the old order this answered 422
    with "SFOX-F2: sFOX integration is not yet available (SFOX_ENABLED is off)."
    to an anonymous caller.
    """
    monkeypatch.setenv("INTERNAL_API_TOKEN", _GOOD_TOKEN)

    async with _client() as client:
        resp = await client.post("/process-key", json=_FLAG_PROBE_BODY)

    assert resp.status_code == 401, (
        "PYAPI-04a: an unauthenticated /process-key POST must be refused by the "
        "middleware BEFORE pydantic validation. 422 here means the gate is "
        f"still third. Got {resp.status_code}: {resp.text}"
    )
    body = resp.text
    for needle in _FLAG_SUBSTRINGS:
        assert needle not in body, (
            f"PYAPI-04a: the pre-auth refusal body leaked {needle!r} — "
            f"server-side feature flags are enumerable by anyone. Body: {body}"
        )
    assert resp.json() == {
        "detail": {
            "code": "UNAUTHENTICATED",
            "dependency": None,
            "retryable": False,
            "detail": "Unauthorized",
        }
    }


# ---------------------------------------------------------------------------
# PYAPI-04b — unauthenticated requests burn no throttle budget
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unauthenticated_requests_consume_no_throttle_budget(
    monkeypatch: pytest.MonkeyPatch, fresh_limiter: Any
) -> None:
    """PYAPI-04b: limit+5 unauthenticated POSTs record ZERO limiter hits.

    The oracle is limiter STORAGE, not the response status: an anonymous caller
    lands in its own bucket either way (RESEARCH's partial correction to C-18),
    so "the next authenticated call is not 429" alone is vacuous. Counting the
    hits proves the request never reached slowapi at all — which is exactly what
    reverting the middleware gate (mutation M3) undoes.
    """
    monkeypatch.setenv("INTERNAL_API_TOKEN", _GOOD_TOKEN)

    async with _client() as client:
        for _ in range(105):  # the 100/hour limit + 5
            resp = await client.post("/process-key", json=_VALID_BODY)
            assert resp.status_code == 401

        assert _process_key_limiter_hits(fresh_limiter) == 0, (
            "PYAPI-04b: 105 unauthenticated requests recorded slowapi hits on "
            "/process-key — the throttle layer is reachable pre-auth."
        )

    # ... and the authenticated caller that follows is NOT throttled.
    async with _client(raise_app_exceptions=False) as client:
        resp = await client.post(
            "/process-key",
            json=_VALID_BODY,
            headers={"Authorization": f"Bearer {_GOOD_TOKEN}"},
        )

    assert resp.status_code not in (429, 422), (
        "PYAPI-04b: an authenticated caller must reach the handler after an "
        f"anonymous flood. Got {resp.status_code}: {resp.text[:400]}"
    )


# ---------------------------------------------------------------------------
# PYAPI-04c — positive control
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_authenticated_invalid_body_reaches_validation_and_422s(
    monkeypatch: pytest.MonkeyPatch, flags_off: None, fresh_limiter: Any
) -> None:
    """PYAPI-04c: the SAME body with a VALID bearer reaches VALIDATION and 422s.

    This is what stops 04a passing vacuously — it proves 04a's silence is the
    auth gate and not a broken harness (e.g. a body that stopped failing
    validation, or a route that stopped existing).

    ⚠️ REWRITTEN by 140.1-08 (PYAPI-07), and the change is a real contract
    change, not a test repair. This test used to assert::

        assert "SFOX_ENABLED" in resp.text

    i.e. that an AUTHENTICATED caller still saw the flag name echoed out of
    pydantic's ``msg``. PYAPI-07's app-global 422 handler builds ``detail`` from
    ``type`` + ``loc`` ONLY and drops ``msg``/``ctx``/``input``/``url``, so the
    flag name is now absent for EVERY caller — a strictly stronger property than
    04a's (which only closed the ANONYMOUS path, by ordering). The two fixes are
    additive and neither stands in for the other; the flag assertion is
    therefore inverted below rather than deleted.

    The anti-vacuity role survives intact, carried by a DIFFERENT literal: the
    422 detail names ``body.source`` — the exact field ``_validate_source_per_flow``
    rejects. A broken harness (route gone, body no longer invalid, validation
    skipped) cannot produce that string.
    """
    monkeypatch.setenv("INTERNAL_API_TOKEN", _GOOD_TOKEN)

    async with _client() as client:
        resp = await client.post(
            "/process-key",
            json=_FLAG_PROBE_BODY,
            headers={"Authorization": f"Bearer {_GOOD_TOKEN}"},
        )

    assert resp.status_code == 422, (
        "PYAPI-04c positive control: a VALID bearer with the same invalid body "
        f"must still reach validation. Got {resp.status_code}: {resp.text[:400]}"
    )
    assert resp.json()["detail"] == "body.source: value_error", (
        "PYAPI-04c positive control: the 422 must name the field the flag "
        "validator rejected — otherwise 04a proves nothing about auth. Got: "
        f"{resp.text[:400]}"
    )
    assert resp.json()["code"] == "VALIDATION_FAILED"
    for needle in _FLAG_SUBSTRINGS:
        assert needle not in resp.text, (
            f"PYAPI-07: the 422 body leaked {needle!r} to an AUTHENTICATED "
            f"caller — the handler is echoing pydantic's `msg`. Body: {resp.text}"
        )


# ---------------------------------------------------------------------------
# PYAPI-04d — the unset-secret arm (plan-check blocker B4)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unset_internal_token_rejects_empty_bearer_with_500(
    monkeypatch: pytest.MonkeyPatch, fresh_limiter: Any
) -> None:
    """PYAPI-04d: the empty-vs-empty ADMISSION, pinned shut.

    A naive gate reads ``compare_digest(provided, os.getenv("INTERNAL_API_TOKEN")
    or "")``. With the secret UNSET server-side and an EMPTY bearer on the wire
    that compares "" against "" — TRUE — and the request is ADMITTED. That is
    the exact misconfiguration state PYAPI-06 exists to detect, so it must fail
    CLOSED.

    The status is 500 `retryable:false`, NOT 401: an unset platform secret is
    OUR misconfiguration (SERVICE-PERMANENT per R-1); 401 would blame the caller
    for it, and 503 would make an operator-only fault flap 140.2's breaker
    forever.
    """
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)

    async with _client() as client:
        resp = await client.post(
            "/process-key",
            json=_VALID_BODY,
            headers={"Authorization": "Bearer "},
        )

    assert resp.status_code == 500, (
        "PYAPI-04d: with INTERNAL_API_TOKEN unset an EMPTY bearer must be "
        f"REFUSED. Got {resp.status_code} — 200 means empty-vs-empty admitted "
        "the request; 401 blames the caller for our misconfiguration."
    )
    assert resp.json() == {
        "detail": {
            "code": "INTERNAL_TOKEN_UNCONFIGURED",
            "dependency": None,
            "retryable": False,
            "detail": "Service not configured",
        }
    }
    assert "Retry-After" not in resp.headers


@pytest.mark.asyncio
async def test_unset_internal_token_rejects_absent_header_with_500(
    monkeypatch: pytest.MonkeyPatch, fresh_limiter: Any
) -> None:
    """PYAPI-04d sibling: no Authorization header at all, secret unset.

    The unset-secret arm must be evaluated BEFORE any comparison, so the answer
    is the operator signal (500) regardless of what the caller sent — not the
    caller-blaming 401.
    """
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)

    async with _client() as client:
        resp = await client.post("/process-key", json=_VALID_BODY)

    assert resp.status_code == 500
    assert resp.json()["detail"]["code"] == "INTERNAL_TOKEN_UNCONFIGURED"
    assert resp.json()["detail"]["retryable"] is False


@pytest.mark.asyncio
async def test_wrong_bearer_is_401_not_403(
    monkeypatch: pytest.MonkeyPatch, fresh_limiter: Any
) -> None:
    """A mismatched bearer answers 401 at the middleware.

    The handler's `_verify_internal_token` 403 survives as defence-in-depth
    (it is still the first statement of the handler body) but is no longer
    reachable through the full app.
    """
    monkeypatch.setenv("INTERNAL_API_TOKEN", _GOOD_TOKEN)

    async with _client() as client:
        resp = await client.post(
            "/process-key",
            json=_VALID_BODY,
            headers={"Authorization": "Bearer wrong-token"},
        )

    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == "UNAUTHENTICATED"


# ---------------------------------------------------------------------------
# API-1 — the gate is ADDITIVE: /process-key still needs no X-Service-Key
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_valid_bearer_passes_without_x_service_key(
    monkeypatch: pytest.MonkeyPatch, fresh_limiter: Any
) -> None:
    """API-1 regression, upgraded from a source grep to a behaviour check.

    `/process-key` authenticates with INTERNAL_API_TOKEN, NOT X-Service-Key.
    The PYAPI-04 gate replaces the middleware's blanket SKIP with a bearer
    check — it must not start demanding X-Service-Key as well, or every
    Vercel->FastAPI call regresses to 401 (the original API-1 defect).
    """
    import main

    monkeypatch.setenv("INTERNAL_API_TOKEN", _GOOD_TOKEN)
    monkeypatch.setattr(main, "SERVICE_KEY", "some-unrelated-service-key")

    async with _client(raise_app_exceptions=False) as client:
        resp = await client.post(
            "/process-key",
            json=_VALID_BODY,
            headers={"Authorization": f"Bearer {_GOOD_TOKEN}"},
        )

    assert resp.status_code != 401, (
        "API-1: a valid INTERNAL_API_TOKEN bearer must pass verify_service_key "
        "with NO X-Service-Key header. Got 401 — the middleware is demanding "
        "the service key on /process-key again."
    )


# ---------------------------------------------------------------------------
# QUANTALYZE-4 — the middleware must RETURN, never RAISE
# ---------------------------------------------------------------------------


def test_verify_service_key_contains_no_raise() -> None:
    """`verify_service_key` is a BaseHTTPMiddleware: it sits ABOVE the
    ExceptionMiddleware that would translate an HTTPException, so a `raise`
    escapes to ServerErrorMiddleware, which renders a bodyless 500 `text/plain`
    AND re-raises into Sentry (QUANTALYZE-4, 24 prod events).

    The PYAPI-04 gate is the highest-risk place to reintroduce it, because the
    check it mirrors — `routers/process_key.py:_verify_internal_token` — DOES
    raise HTTPException. A copy-paste of that function into the middleware is
    the regression this guards.
    """
    import ast
    import inspect
    import textwrap

    import main

    # BOTH functions: the middleware body AND the gate helper it delegates the
    # /process-key refusal arms to. Checking only `verify_service_key` would let
    # a raise hide one call away.
    for fn in (main.verify_service_key, main._gate_process_key):
        src = textwrap.dedent(inspect.getsource(fn))
        # AST, not a substring grep: both functions' comment blocks contain the
        # word "raise" (they document this very trap), so a grep would be
        # permanently red. `ast.Raise` counts statements only.
        raises = [n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Raise)]
        assert raises == [], (
            f"QUANTALYZE-4: {fn.__name__} must RETURN a JSONResponse on every "
            f"refusal arm, never raise. Found {len(raises)} raise statement(s) "
            f"at line(s) {[n.lineno for n in raises]} of:\n{src}"
        )
