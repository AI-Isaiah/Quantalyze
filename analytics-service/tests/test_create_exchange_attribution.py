"""PYAPIFIX-03 (H-2) — a failure in code that does NO network I/O is OURS.

``services/exchange.py`` ``create_exchange`` is ``EXCHANGE_CLASSES.get()``, a
dict build, ``cls(config)`` and two attribute sets. **Zero network I/O.** So when
a non-``ValueError`` escapes it, nothing has been sent to any venue: the escape is
a ``TypeError`` / ``AttributeError`` / ``ImportError`` / OOM in our own adapter
construction. Attributing it to the caller (400) or to the caller's venue (424)
puts a plain bug in our code into a bucket that pages nobody.

**Why this file exists.** The class has THREE members, and until Phase 140.1.1
plan 04 only ONE was named by anyone:

  * **B1** ``routers/internal.py`` — the code review's named subject (S-11).
    Answered 424. Pinned by ``tests/test_status_contract_exchange_internal.py``.
  * **B2** ``routers/exchange.py`` ``validate_key`` — answered
    ``HTTPException(400, "Failed to initialize exchange connection")``.
  * **B3** ``routers/portfolio.py`` ``verify_strategy`` — answered
    ``HTTPException(400, "Failed to initialise exchange connection")``. Named by
    NOBODY: not the review, not RESEARCH, not CONTEXT. It differs from B2 only in
    **British spelling**, which is precisely what defeats a
    ``grep "Failed to initialize"`` sweep.

**B2 and B3 had no test of any kind.** ``grep`` of ``tests/`` for
``Failed to initiali[sz]e exchange connection`` returned **zero hits** before this
file — both arms shipped, and stayed wrong, entirely unobserved. This file is
their first oracle.

**The in-repo proof the class is real, and that 500 is the right answer:**
``routers/portfolio.py`` calls ``create_exchange`` **twice in the same function**
(``verify_strategy``), ~50 lines apart. B3 is the first call and answered **400**;
the second call's handler already answers **500 "Strategy verification failed"**
(B4). One function, one callee, two different verdicts. B4 was already correct and
is deliberately NOT touched by this plan.

**Non-members, enumerated so nobody "finds" them again** (PATTERNS §3):
``exchange.py:602``, ``cron.py:224``, ``debug_key_flow.py:129/:212``,
``funding_fetch.py:852``, ``job_worker.py:968`` and the ingestion adapters. Each
was read: none wraps ``create_exchange`` in a venue- or caller-attributing
``except`` anywhere up its stack, so each escapes to the generic handler as a
bodyless 500 — which is already the R-1-correct outcome.

ORACLE DISCIPLINE (programme non-negotiable #3): every expected status, code and
copy string below is a **literal typed into this file**. Nothing is imported from
``routers.*`` or ``services.error_contract`` — an oracle that reads its expectation
out of the thing under test cannot fail.
"""

from __future__ import annotations

import asyncio
import importlib
import sys
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException


# The ONE copy string, the ONE machine code, shared by all three class members.
# Typed here as literals, NEVER imported: the point of the class fix is that the
# three sites do not drift, and an oracle that read the string out of one of them
# could not detect drift in the other two.
_ADAPTER_INIT_CODE = "ADAPTER_INIT_FAILED"
_ADAPTER_INIT_COPY = (
    "Something went wrong on our side while opening this connection. "
    "Nothing is wrong with your key."
)


def _assert_permanent_adapter_500(exc: HTTPException, *, venue: str) -> None:
    """The SERVICE-PERMANENT verdict, asserted whole.

    ``venue`` is the exchange the caller named — it must appear NOWHERE in the
    response. 140.2 keys its breaker on ``dependency`` (SEAMCORE-01), so a venue
    name on a 500 mints a per-dependency breaker key for something that is not
    ours; and a body that blames the venue teaches the caller a remedy (wait for
    Binance) that cannot possibly work on a bug in our own adapter code.
    """
    assert exc.status_code == 500
    assert exc.detail == {
        "code": _ADAPTER_INIT_CODE,
        "dependency": None,
        "retryable": False,
        "detail": _ADAPTER_INIT_COPY,
    }
    # R-1: a permanent fault never advertises a wait — only a deploy clears it.
    assert not (exc.headers or {}).get("Retry-After")
    assert venue not in repr(exc.detail), (
        f"a SERVICE-PERMANENT body named the venue {venue!r}; the venue is not "
        "at fault and naming it poisons 140.2's breaker key"
    )


# --------------------------------------------------------------------------- #
# B2 — routers/exchange.py :: validate_key
# --------------------------------------------------------------------------- #


@pytest.fixture()
def exchange_router(monkeypatch):
    """``routers.exchange`` with slowapi stubbed so the handler can be awaited
    directly. Cloned from ``tests/test_status_contract_exchange_internal.py``
    (Rule 11 — match the existing idiom rather than inventing a second one).
    """
    from tests.limiter_stub import evict_module, patch_shared_limiter

    class _NoopLimiter:
        def __init__(self, *args, **kwargs):
            pass

        def limit(self, *args, **kwargs):
            def decorator(fn):
                return fn

            return decorator

    slowapi_stub = MagicMock()
    slowapi_stub.Limiter = _NoopLimiter
    slowapi_util_stub = MagicMock()
    slowapi_util_stub.get_remote_address = lambda *a, **k: "1.2.3.4"

    monkeypatch.setitem(sys.modules, "slowapi", slowapi_stub)
    monkeypatch.setitem(sys.modules, "slowapi.util", slowapi_util_stub)
    patch_shared_limiter(monkeypatch)

    evict_module("routers.exchange")
    from routers import exchange as exchange_router

    yield exchange_router

    evict_module("routers.exchange")


def _validate_req(exchange: str = "binance"):
    from models.schemas import ValidateKeyRequest

    return ValidateKeyRequest(
        exchange=exchange,
        api_key="AKID0123456789abcdef",
        api_secret="s" * 24,
        passphrase=None,
    )


@pytest.mark.asyncio
async def test_b2_validate_key_adapter_construction_bug_is_a_permanent_500(
    exchange_router,
):
    """B2 (``routers/exchange.py`` ``validate_key``) — was a 400 blaming the user.

    A ``TypeError`` out of ``create_exchange`` is a ccxt signature change or an
    ``ImportError`` on a missing extra — our bug, on a code path that has not yet
    contacted the venue. The shipped 400 told the user their *request* was
    malformed, which is a lie they cannot act on, and 4xx meant the bug never
    counted against our own health.
    """
    router = exchange_router
    router.create_exchange = MagicMock(
        side_effect=TypeError("ccxt.binance() got an unexpected keyword argument")
    )

    with pytest.raises(HTTPException) as ei:
        await router.validate_key(MagicMock(name="request"), _validate_req())

    _assert_permanent_adapter_500(ei.value, venue="binance")


@pytest.mark.asyncio
async def test_b2_validate_key_unsupported_exchange_name_stays_a_caller_400(
    exchange_router,
):
    """The half of B2 that must NOT move. ``create_exchange`` raises
    ``ValueError`` for a name absent from ``EXCHANGE_CLASSES`` — and the name came
    off the caller's own request, so that IS caller input and stays a 400. Pinned
    so the remap cannot later widen into "every escape is a 500"."""
    router = exchange_router
    router.create_exchange = MagicMock(
        side_effect=ValueError("Unsupported exchange: nasdaq")
    )

    with pytest.raises(HTTPException) as ei:
        await router.validate_key(MagicMock(name="request"), _validate_req())

    assert ei.value.status_code == 400
    assert ei.value.detail == "Unsupported exchange: nasdaq"


@pytest.mark.asyncio
async def test_b2_raw_exception_text_never_reaches_the_response_body(exchange_router):
    """C-13's class on a response body: the adapter's own exception text may carry
    HMAC material and internal state, so it stays in the log and never on the
    wire."""
    router = exchange_router
    router.create_exchange = MagicMock(
        side_effect=RuntimeError("CANARY_ERR_b2_7f13 internal adapter state")
    )

    with pytest.raises(HTTPException) as ei:
        await router.validate_key(MagicMock(name="request"), _validate_req())

    assert "CANARY_ERR_b2_7f13" not in repr(ei.value.detail)


# --------------------------------------------------------------------------- #
# B3 — routers/portfolio.py :: verify_strategy  (the British-spelling member)
# --------------------------------------------------------------------------- #


def _real_portfolio_module():
    """Import ``routers.portfolio`` against the REAL fastapi/slowapi packages.

    Cloned verbatim in intent from ``tests/test_verify_strategy_redaction.py``:
    sibling portfolio test files install ``MagicMock`` stubs into ``sys.modules``
    at import time, which turn the slowapi-decorated ``verify_strategy`` into a
    non-awaitable ``MagicMock``. Evict those and re-import so this file is
    isolation-safe regardless of collection order.
    """
    real_pkgs = [
        "supabase",
        "slowapi",
        "slowapi.util",
        "fastapi",
        "fastapi.routing",
        "ccxt",
        "ccxt.async_support",
        "starlette",
        "starlette.requests",
    ]
    evicted = False
    for name in real_pkgs:
        mod = sys.modules.get(name)
        if isinstance(mod, MagicMock):
            del sys.modules[name]
            evicted = True
    if evicted:
        for name in list(sys.modules):
            if name == "routers.portfolio" or name.startswith("routers."):
                del sys.modules[name]
    importlib.import_module("fastapi")
    importlib.import_module("slowapi")
    mod = importlib.import_module("routers.portfolio")

    # The 5/hour slowapi budget shares ONE memory:// store process-wide, so an
    # unreset counter makes the 6th verify_strategy call in a pytest session
    # raise RateLimitExceeded before the arm under test is reached.
    _reset = getattr(mod.limiter, "reset", None)
    if callable(_reset):
        _reset()
    return mod


def _verify_req(exchange: str = "binance"):
    from models.schemas import VerifyStrategyRequest

    return VerifyStrategyRequest(
        email="trader@example.com",
        exchange=exchange,
        api_key="AKID0123456789abcdef",
        api_secret="s" * 24,
    )


def _starlette_request():
    from starlette.requests import Request as StarletteRequest

    return StarletteRequest(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/verify-strategy",
            "headers": [],
            "client": ("127.0.0.1", 12345),
            "query_string": b"",
        }
    )


def _drive_verify_strategy(monkeypatch, side_effect, exchange: str = "binance"):
    portfolio_mod = _real_portfolio_module()
    monkeypatch.setattr(
        portfolio_mod, "_check_verify_strategy_email_rate", lambda _email: True
    )
    monkeypatch.setattr(
        portfolio_mod, "create_exchange", MagicMock(side_effect=side_effect)
    )
    with pytest.raises(HTTPException) as ei:
        asyncio.run(
            portfolio_mod.verify_strategy(_starlette_request(), _verify_req(exchange))
        )
    return ei.value


def test_b3_verify_strategy_adapter_construction_bug_is_a_permanent_500(monkeypatch):
    """B3 (``routers/portfolio.py`` ``verify_strategy``, FIRST ``create_exchange``).

    The member nobody named. Byte-for-byte the same defect as B2, differing only
    in the British spelling of "initialise" — which is why every grep sweep for
    the American spelling missed it, and why a point-fix of the review's named
    site would have shipped a 2-of-3 class closure with a green suite.
    """
    exc = _drive_verify_strategy(
        monkeypatch, TypeError("ccxt.binance() got an unexpected keyword argument")
    )

    _assert_permanent_adapter_500(exc, venue="binance")


def test_b3_verify_strategy_unsupported_exchange_name_stays_a_caller_400(monkeypatch):
    """B3's other half — unchanged, for the same reason as B2's."""
    exc = _drive_verify_strategy(monkeypatch, ValueError("Unsupported exchange: nasdaq"))

    assert exc.status_code == 400
    assert exc.detail == "Unsupported exchange: nasdaq"


def test_b3_raw_exception_text_never_reaches_the_response_body(monkeypatch):
    """``verify_strategy`` already runs ``_redact_credentials`` on its LOG line;
    the body must carry no adapter text at all."""
    exc = _drive_verify_strategy(
        monkeypatch, RuntimeError("CANARY_ERR_b3_2a90 internal adapter state")
    )

    assert "CANARY_ERR_b3_2a90" not in repr(exc.detail)


# --------------------------------------------------------------------------- #
# The class, closed at 3/3
# --------------------------------------------------------------------------- #


def test_the_three_members_answer_with_one_code_and_one_copy(monkeypatch):
    """One code, one copy, three sites, zero drift.

    This is the assertion that fails if a future edit "improves" the wording at
    one site: three independently-maintained copies of the same verdict is how
    the class fragmented in the first place (B2 "initialize" vs B3 "initialise").
    B1 is pinned in ``tests/test_status_contract_exchange_internal.py`` against
    the SAME literals typed there; B2 and B3 are driven here.
    """
    from tests.limiter_stub import evict_module, patch_shared_limiter

    bodies = []

    # B3 first: it re-imports routers.* against the real packages, so running it
    # after the slowapi-stubbed B2 fixture would fight over sys.modules.
    bodies.append(
        _drive_verify_strategy(monkeypatch, TypeError("adapter ctor blew up")).detail
    )

    class _NoopLimiter:
        def __init__(self, *args, **kwargs):
            pass

        def limit(self, *args, **kwargs):
            return lambda fn: fn

    slowapi_stub = MagicMock()
    slowapi_stub.Limiter = _NoopLimiter
    slowapi_util_stub = MagicMock()
    slowapi_util_stub.get_remote_address = lambda *a, **k: "1.2.3.4"
    monkeypatch.setitem(sys.modules, "slowapi", slowapi_stub)
    monkeypatch.setitem(sys.modules, "slowapi.util", slowapi_util_stub)
    patch_shared_limiter(monkeypatch)
    evict_module("routers.exchange")
    from routers import exchange as exchange_mod

    exchange_mod.create_exchange = MagicMock(side_effect=TypeError("adapter ctor blew up"))
    with pytest.raises(HTTPException) as ei:
        asyncio.run(exchange_mod.validate_key(MagicMock(name="request"), _validate_req()))
    bodies.append(ei.value.detail)
    evict_module("routers.exchange")

    assert len(bodies) == 2
    for body in bodies:
        assert body["code"] == _ADAPTER_INIT_CODE
        assert body["detail"] == _ADAPTER_INIT_COPY
        assert body["dependency"] is None
        assert body["retryable"] is False
    assert bodies[0] == bodies[1], (
        "B2 and B3 must emit byte-identical verdicts; the class fragmented "
        "originally because two sites carried two copies of the same sentence"
    )
