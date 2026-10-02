"""PYAPIFIX-06(a) / M-1 — a 429 carrying ``Retry-After`` must be CONSTRUCTABLE.

Two rules in ``services/error_contract._validate`` collided at HEAD ``56fb7167``:

* ``retry_after is not None and not retryable`` -> raise — a ``Retry-After``
  REQUIRES ``retryable=True``.
* the generic CALLER arm ``if retryable:`` -> raise — any non-424 4xx FORBIDS
  ``retryable=True``.

A 429 is neither 503, nor ``>=500``, nor 424, so it fell through to the generic
arm and **both** rules fired. No argument tuple produced one — while
``docs/STATUS_CONTRACT.md`` promises ``Retry-After`` "on 429 only" and
``140.1-VERIFICATION.md`` gap 1 / obligation TS-23 both MANDATE migrating the
two in-handler 429 sites onto that envelope. The Python change that unblocks
TS-23 has nowhere else to land: 140.2/140.3 are TypeScript-only and 146 owns the
limiter surface, not this helper.

The 424 arm is the in-file precedent: it already REQUIRES ``retryable=True`` on
a 4xx, so "4xx implies not retryable" is the *default arm's* rule, not an
invariant of the contract.

**Why ``retryable=True`` rather than exempting 429 from the retry_after rule**
(OQ-4b, decided in plan 140.1.1-01): the alternative emits ``retryable:false``
in the body while sending a ``Retry-After`` header — the self-contradicting body
R-1 forbids, and the exact defect PYAPIFIX-02 closes one requirement away in the
same phase.

Oracle discipline (programme non-negotiable #3): every expected value below is a
**LITERAL**. Nothing is read back out of ``services/error_contract`` — not the
status, not the header value, not ``RETRY_AFTER_SECONDS``.

Both entry points are exercised for EVERY case (criterion 6c): a guard that
fires through ``service_error`` but not ``service_error_response`` leaves the
four ``main.py`` middleware sites unguarded.
"""

from __future__ import annotations

from typing import Any, Callable

import pytest

from services.error_contract import service_error, service_error_response

# Both public entry points. `service_error` raises an HTTPException; the
# middleware sites in `main.py` cannot raise (they sit above ExceptionMiddleware)
# and call `service_error_response` instead. The contract must be identical.
ENTRY_POINTS: list[Callable[..., Any]] = [service_error, service_error_response]
ENTRY_POINT_IDS = ["service_error", "service_error_response"]


def _retry_after_header(constructed: Any) -> str | None:
    """Read the wire header off either an HTTPException or a JSONResponse."""
    headers = constructed.headers or {}
    return headers.get("Retry-After")


# --- the positive case: a 429 + Retry-After CONSTRUCTS -----------------------


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_429_with_retry_after_is_constructable(entry_point: Callable[..., Any]) -> None:
    """M-1 closed: the envelope TS-23 must migrate onto can now be built."""
    constructed = entry_point(
        429,
        "RATE_LIMITED",
        retryable=True,
        retry_after=30,
        detail="Too many requests. Try again in 30 seconds.",
    )

    # Literal, NOT imported from RETRY_AFTER_SECONDS and NOT read back from the
    # `retry_after=30` argument above — this pins the WIRE value, which is a
    # string, not the int that was passed in.
    assert _retry_after_header(constructed) == "30"


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_429_status_and_envelope_are_the_caller_shape(
    entry_point: Callable[..., Any],
) -> None:
    """A 429 is still a CALLER fault: 4xx (breaker-inert by construction) and it
    names no dependency of ours. Only the retry affordance differs."""
    constructed = entry_point(
        429,
        "RATE_LIMITED",
        retryable=True,
        retry_after=30,
    )

    assert constructed.status_code == 429  # literal


# --- the four rejections, each through BOTH entry points ---------------------


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_429_rejects_retryable_false(entry_point: Callable[..., Any]) -> None:
    """`retryable:false` in the body beside a `Retry-After` header on the wire is
    a body that contradicts itself — R-1 forbids it."""
    with pytest.raises(ValueError):
        entry_point(429, "RATE_LIMITED", retryable=False, retry_after=30)


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_429_rejects_absent_retry_after(entry_point: Callable[..., Any]) -> None:
    """STATUS_CONTRACT.md 1 makes Retry-After REQUIRED on a 429. Without it 140.3
    has no real wait to name and falls back to a guess (B-11)."""
    with pytest.raises(ValueError):
        entry_point(429, "RATE_LIMITED", retryable=True, retry_after=None)


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_429_rejects_non_positive_retry_after(entry_point: Callable[..., Any]) -> None:
    """A zero-second wait advertises "retry immediately", which is the
    self-sustaining retry loop R-1 exists to stop."""
    with pytest.raises(ValueError):
        entry_point(429, "RATE_LIMITED", retryable=True, retry_after=0)


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_429_rejects_a_dependency(entry_point: Callable[..., Any]) -> None:
    """Nothing of ours failed when we throttle a caller, and 140.2 keys the
    breaker on `dependency` (SEAMCORE-01) — a venue name here would mint a
    breaker key for something that is not ours."""
    with pytest.raises(ValueError):
        entry_point(
            429,
            "RATE_LIMITED",
            dependency="binance",
            retryable=True,
            retry_after=30,
        )
