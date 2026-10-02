"""PYAPI-07 (C-13, C-14) — the 422 must never echo the request body.

FastAPI's default `RequestValidationError` handler is::

    content={"detail": jsonable_encoder(exc.errors())}

and pydantic v2 puts the *input value* in every error's ``input`` key. For a
``@model_validator(mode="after")`` failure — which
``routers/process_key.py::_ProcessKeyBody._validate_per_flow_required_keys``
is — ``loc`` is ``["body"]`` and ``input`` is the **ENTIRE model input**,
including ``context.api_secret``. Verbatim, on the wire, in a 422.

`src/lib/process-key-client.ts:245-250` forwards any non-2xx body untouched,
and `src/app/api/verify-strategy/route.ts:194` returns it to an **anonymous
browser** before its own response allowlist is ever reached. That is C-13.

C-14 is the same body seen from the other end: ``detail`` is a *list of dicts*,
so the three TypeScript sites that do ``err.detail ?? "..."`` render
``"[object Object]"``.

Both are closed by one app-global handler in `main.py` that builds a **scalar
string** detail from ``type`` + ``loc`` ONLY and drops ``input``, ``ctx``,
``msg`` and ``url``.

Oracle discipline (programme non-negotiable #3): every expected status, key,
code and string below is a **LITERAL**. Nothing is read back out of `main.py`.

The headline oracle is a **canary**: a recognisable secret-shaped token is put
in the request and asserted to appear **zero** times in the ENTIRE serialised
response — body *and* headers. A field-by-field assertion ("``input`` is
absent") is strictly weaker: it passes for any handler that moves the echo to a
differently-named key.
"""

from __future__ import annotations

from typing import Any, Iterator

import httpx
import pytest

# The bearer `/process-key` requires since PYAPI-04 made it auth-first
# (main.py:_gate_process_key). The 422 is now POST-auth, so the canary case must
# authenticate to reach validation at all — the anonymous leak path is closed by
# auth ORDERING, and this handler closes it for authenticated callers and for
# every other route. Two separate additive fixes; neither stands in for the
# other.
_GOOD_TOKEN = "a" * 64

# The X-Service-Key every non-/process-key route needs to clear
# main.verify_service_key.
_SERVICE_KEY = "test-service-key-for-validation-contract"

# The canary. Secret-SHAPED (long, high-entropy, unmistakable) so a grep over
# the whole response is unambiguous, and containing no substring that any
# plausible error message would produce on its own.
_CANARY = "CANARY_SECRET_98d1"

# A `/process-key` body that fails `_validate_per_flow_required_keys`: flow_type
# 'onboard' requires BOTH api_key and api_secret, so supplying only api_secret
# fails the model validator WHILE carrying the canary in the payload pydantic
# echoes. Verified against the pre-fix service: the canary landed in
# `detail[0].input.context.api_secret`.
_CANARY_BODY: dict[str, Any] = {
    "flow_type": "onboard",
    "source": "okx",
    "context": {
        "strategy_id": "s1",
        "wizard_session_id": "wiz-canary",
        "api_secret": _CANARY,
    },
}

# The SECOND route — a different router entirely, so a green here proves the
# handler is app-global rather than point-patched onto /process-key.
# `/api/match/recompute` has no slowapi limiter (PYAPI-03 / plan 07), so a 429
# can never pre-empt the 422.
_SECOND_ROUTE = "/api/match/recompute"
_SECOND_ROUTE_CANARY_BODY: dict[str, Any] = {
    "allocator_id": _CANARY,
    "force": False,
}


@pytest.fixture
def platform_secrets(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Both platform secrets configured — this file tests validation, not auth."""
    import main

    monkeypatch.setenv("INTERNAL_API_TOKEN", _GOOD_TOKEN)
    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY)
    yield


@pytest.fixture
def fresh_limiter() -> Iterator[Any]:
    """`services.rate_limit.limiter` is a process-wide singleton with `memory://`
    storage, so counts leak between tests in the same session. Reset both ways.
    """
    from services.rate_limit import limiter

    limiter.reset()
    yield limiter
    limiter.reset()


def _client(**kwargs: Any) -> httpx.AsyncClient:
    import main

    transport = httpx.ASGITransport(app=main.app, **kwargs)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def _whole_response(resp: httpx.Response) -> str:
    """Body AND headers, serialised, as ONE string.

    The canary oracle asserts against this, not against `resp.json()["detail"]`.
    A handler that relocated the echo into a header, or into a key this test
    does not know to look at, would still be caught.
    """
    header_blob = "\n".join(f"{k}: {v}" for k, v in resp.headers.items())
    return f"{resp.text}\n{header_blob}"


# ---------------------------------------------------------------------------
# PYAPI-07a — the canary
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_07a_canary_secret_appears_zero_times_in_the_whole_response(
    platform_secrets: None, fresh_limiter: Any
) -> None:
    """C-13, closed at the source. Zero occurrences, body + headers."""
    async with _client() as client:
        resp = await client.post(
            "/process-key",
            json=_CANARY_BODY,
            headers={"Authorization": f"Bearer {_GOOD_TOKEN}"},
        )

    assert resp.status_code == 422, (
        "the canary body must still FAIL validation — otherwise 07a passes "
        f"vacuously. Got {resp.status_code}: {resp.text[:400]}"
    )
    haystack = _whole_response(resp)
    assert haystack.count(_CANARY) == 0, (
        "PYAPI-07a: the 422 echoed a caller-supplied credential. This body is "
        "forwarded verbatim to an ANONYMOUS browser by "
        "src/app/api/verify-strategy/route.ts:194. Response was:\n"
        f"{haystack[:1200]}"
    )


@pytest.mark.asyncio
async def test_07a_canary_absent_on_a_second_route_too(
    platform_secrets: None, fresh_limiter: Any
) -> None:
    """App-global proof: a DIFFERENT router's 422 must not echo either."""
    async with _client() as client:
        resp = await client.post(
            _SECOND_ROUTE,
            json=_SECOND_ROUTE_CANARY_BODY,
            headers={"X-Service-Key": _SERVICE_KEY},
        )

    assert resp.status_code == 422, (
        f"{_SECOND_ROUTE} must 422 on a non-UUID allocator_id. "
        f"Got {resp.status_code}: {resp.text[:400]}"
    )
    haystack = _whole_response(resp)
    assert haystack.count(_CANARY) == 0, (
        "PYAPI-07a: the handler is point-patched, not app-global — "
        f"{_SECOND_ROUTE} still echoes the request body:\n{haystack[:1200]}"
    )


# ---------------------------------------------------------------------------
# PYAPI-07b — detail is a SCALAR STRING
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_07b_detail_is_a_scalar_string(
    platform_secrets: None, fresh_limiter: Any
) -> None:
    """C-14: `detail` as a list of dicts is what renders "[object Object]".

    `type(x) is str` — deliberately NOT `isinstance`, so a str subclass or a
    coerced value cannot satisfy it.
    """
    async with _client() as client:
        resp = await client.post(
            "/process-key",
            json=_CANARY_BODY,
            headers={"Authorization": f"Bearer {_GOOD_TOKEN}"},
        )

    detail = resp.json()["detail"]
    assert type(detail) is str, (
        "PYAPI-07b: `detail` must be a scalar string. A list/dict here is the "
        f"'[object Object]' render at analytics-client.ts:179. Got {type(detail)!r}"
    )


@pytest.mark.asyncio
async def test_07b_detail_is_a_scalar_string_on_the_second_route(
    platform_secrets: None, fresh_limiter: Any
) -> None:
    async with _client() as client:
        resp = await client.post(
            _SECOND_ROUTE,
            json=_SECOND_ROUTE_CANARY_BODY,
            headers={"X-Service-Key": _SERVICE_KEY},
        )

    assert type(resp.json()["detail"]) is str


# ---------------------------------------------------------------------------
# PYAPI-07c — the envelope, and the keys that must NOT survive
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_07c_body_is_exactly_the_validation_envelope(
    platform_secrets: None, fresh_limiter: Any
) -> None:
    """Literal key set + literal code. The key set is asserted as EQUALITY so a
    later "just add the original errors under a debug key" cannot slip past.
    """
    async with _client() as client:
        resp = await client.post(
            "/process-key",
            json=_CANARY_BODY,
            headers={"Authorization": f"Bearer {_GOOD_TOKEN}"},
        )

    body = resp.json()
    assert set(body.keys()) == {
        "ok",
        "code",
        "human_message",
        "detail",
        "correlation_id",
        "recoverable",
    }, f"PYAPI-07c: unexpected 422 envelope keys: {sorted(body.keys())}"
    assert body["ok"] is False
    assert body["code"] == "VALIDATION_FAILED"
    assert body["recoverable"] is False
    assert type(body["human_message"]) is str and body["human_message"]
    assert type(body["correlation_id"]) is str and body["correlation_id"]


@pytest.mark.asyncio
async def test_07c_pydantic_echo_keys_appear_nowhere_in_the_body(
    platform_secrets: None, fresh_limiter: Any
) -> None:
    """`input` is the credential carrier; `ctx.error` re-embeds the validator's
    message; `url` is pydantic's docs link. None may survive anywhere in the
    serialised body — asserted as a substring scan, not a key probe, so a
    nested reappearance is caught too.
    """
    async with _client() as client:
        resp = await client.post(
            "/process-key",
            json=_CANARY_BODY,
            headers={"Authorization": f"Bearer {_GOOD_TOKEN}"},
        )

    text = resp.text
    for banned in ('"input"', '"ctx"', '"url"', '"msg"', '"loc"'):
        assert banned not in text, (
            f"PYAPI-07c: the pydantic key {banned} survived into the 422 body: {text}"
        )


@pytest.mark.asyncio
async def test_07c_status_is_still_422(
    platform_secrets: None, fresh_limiter: Any
) -> None:
    """A malformed body is a CALLER fault (STATUS_CONTRACT.md §1), so the status
    is unchanged. Pinned because "make the body safe" is a tempting excuse to
    also move the status.
    """
    async with _client() as client:
        resp = await client.post(
            "/process-key",
            json=_CANARY_BODY,
            headers={"Authorization": f"Bearer {_GOOD_TOKEN}"},
        )

    assert resp.status_code == 422
    assert "Retry-After" not in resp.headers


# ---------------------------------------------------------------------------
# Anti-vacuity — the detail is DERIVED, not a constant
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_detail_names_the_failing_field_path_not_a_constant(
    platform_secrets: None, fresh_limiter: Any
) -> None:
    """Without this, a handler returning the fixed string "invalid" would pass
    07a/07b/07c. The detail must carry the `loc` path and the pydantic error
    `type`, and NOTHING else — both literals here.
    """
    async with _client() as client:
        resp = await client.post(
            _SECOND_ROUTE,
            json=_SECOND_ROUTE_CANARY_BODY,
            headers={"X-Service-Key": _SERVICE_KEY},
        )

    assert resp.json()["detail"] == "body.allocator_id: uuid_parsing", (
        "the detail must be built from loc + type. Got: "
        f"{resp.json()['detail']!r}"
    )


@pytest.mark.asyncio
async def test_detail_for_a_model_validator_failure_is_the_body_scope(
    platform_secrets: None, fresh_limiter: Any
) -> None:
    """The `model_validator(mode="after")` case — the one whose `loc` is `["body"]`
    and whose `input` is the WHOLE payload. Literal expected value.
    """
    async with _client() as client:
        resp = await client.post(
            "/process-key",
            json=_CANARY_BODY,
            headers={"Authorization": f"Bearer {_GOOD_TOKEN}"},
        )

    assert resp.json()["detail"] == "body: value_error"


@pytest.mark.asyncio
async def test_correlation_id_is_echoed_from_the_request_header(
    platform_secrets: None, fresh_limiter: Any
) -> None:
    """140.2 joins the client-side and server-side traces on this value, so it
    must be the caller's id, not a fresh one.
    """
    cid = "11111111-2222-3333-4444-555555555555"
    async with _client() as client:
        resp = await client.post(
            "/process-key",
            json=_CANARY_BODY,
            headers={
                "Authorization": f"Bearer {_GOOD_TOKEN}",
                "X-Correlation-Id": cid,
            },
        )

    assert resp.json()["correlation_id"] == cid
    assert resp.headers["X-Correlation-Id"] == cid


@pytest.mark.asyncio
async def test_multiple_errors_are_all_summarised_and_none_echo(
    platform_secrets: None, fresh_limiter: Any
) -> None:
    """Two simultaneous field failures — the detail names both paths and the
    canary still appears zero times.
    """
    async with _client() as client:
        resp = await client.post(
            _SECOND_ROUTE,
            json={"allocator_id": _CANARY, "force": _CANARY},
            headers={"X-Service-Key": _SERVICE_KEY},
        )

    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert "body.allocator_id" in detail
    assert "body.force" in detail
    assert _whole_response(resp).count(_CANARY) == 0
