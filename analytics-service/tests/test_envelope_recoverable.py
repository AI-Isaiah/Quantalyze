"""PYAPIFIX-02 (Phase 140.1.1) — the `recoverable` field of `/process-key`'s
DESIGN-05 envelope, tested DIRECTLY on `_envelope_error`.

Why a direct unit oracle and not only the route-level parametrisation: A2 (the
`recoverable` derivation) is a SEPARATE defect from A1 (the status code). No
status-code change fixes it — before this phase the route could answer 424
"retry" while the body it carried said `recoverable: false`, and the pre-140.1.1
403 arm said `recoverable: false` beside the human copy "Try again in a moment."
This file pins the field itself so the fix cannot be silently absorbed into the
status-code change.

ORACLE DISCIPLINE (programme non-negotiable #3): every expected value below is a
LITERAL typed in this file. `PERMANENT_VALIDATION_ERROR_CODES` is NEVER imported
here — an oracle that iterated the set under test could not fail when a member is
added to or removed from it, which is the exact self-referential shape that let
the review's mutation survivors ship green.
"""

from __future__ import annotations

import pytest

from routers.process_key import _envelope_error

_CID = "11111111-1111-4111-8111-111111111111"


# The five VENUE-TRANSIENT probe codes. Each is minted by
# services/exchange.py's ccxt classification arms (DDOS_PROTECTION :1112,
# RATE_LIMITED :1123, EXCHANGE_UNAVAILABLE :1135, NETWORK_UNAVAILABLE :1145)
# or by its fail-CLOSED permission-probe arm (PROBE_FAILED :1207). None of
# them is a statement about the caller's credentials; an identical retry CAN
# succeed, so the body must say so.
_TRANSIENT_CODES = [
    "PROBE_FAILED",
    "DDOS_PROTECTION",
    "RATE_LIMITED",
    "EXCHANGE_UNAVAILABLE",
    "NETWORK_UNAVAILABLE",
]

# The five PERMANENT caller-fault codes. Each names something wrong with the
# submitted credentials or their scopes; no retry of an identical request
# changes the verdict.
_PERMANENT_CODES = [
    "AUTH_FAILED",
    "PERMISSION_DENIED",
    "TRADE_SCOPE",
    "WITHDRAW_SCOPE",
    "MISSING_SCOPE",
]


@pytest.mark.parametrize("code", _TRANSIENT_CODES, ids=_TRANSIENT_CODES)
def test_venue_transient_code_is_recoverable(code: str) -> None:
    """A fault at the caller's VENUE is recoverable — literal True.

    Pre-fix the derivation was an allow-list of RECOVERABLE codes
    ({RATE_LIMITED, EXCHANGE_UNAVAILABLE, NETWORK_UNAVAILABLE}), which omitted
    PROBE_FAILED and DDOS_PROTECTION and therefore failed UNSAFE: an unknown or
    forgotten venue code was reported terminal.
    """
    body = _envelope_error(code, "some message", _CID, None)
    assert body["recoverable"] is True, (
        f"{code} is a fault at the caller's venue — an identical retry can "
        f"succeed, so the body must not tell the caller their credentials are "
        f"unfixably wrong; got {body['recoverable']!r}"
    )


@pytest.mark.parametrize("code", _PERMANENT_CODES, ids=_PERMANENT_CODES)
def test_caller_fault_code_is_not_recoverable(code: str) -> None:
    """A genuine caller fault is NOT recoverable — literal False.

    This is the negative half of the allow-list. MISSING_SCOPE is the
    load-bearing member: it is absent from long_fetch's local `permanent_codes`,
    so a naive "reuse the existing set" fix would drop a permanently-missing
    read scope into the retryable default and mint an infinitely-retried key.
    """
    body = _envelope_error(code, "some message", _CID, None)
    assert body["recoverable"] is False, (
        f"{code} names something wrong with the submitted credentials; "
        f"retrying an identical request cannot change the verdict"
    )


# Codes this ROUTE mints itself, with the recoverable value each carried BEFORE
# PYAPIFIX-02. They are listed as literals so the new derivation provably does
# not flip a non-probe code: a blanket "not in the permanent allow-list" default
# would mark STRATEGY_NOT_OWNED recoverable, which is wrong — no retry makes the
# caller the owner of someone else's strategy.
_ROUTE_CODES = [
    "STRATEGY_NOT_OWNED",
    "MISSING_STRATEGY_ID",
    "CSV_FINALIZE_FAILED",
    "VALIDATION_UNEXPECTED",
    "UNKNOWN",
]


@pytest.mark.parametrize("code", _ROUTE_CODES, ids=_ROUTE_CODES)
def test_route_minted_code_keeps_its_pre_fix_recoverable_value(code: str) -> None:
    """Every code the route mints itself stayed at `recoverable: false`.

    The scope fence for A2: the derivation was widened for PROBE codes only.
    `VALIDATION_UNEXPECTED` belongs here because the code STRING alone cannot
    say whether it was our own fallback (permanent) or adapter-set (may be
    transient) — defaulting it terminal is the safe half, and the 424 arm, the
    only place an adapter-set one can land, states `recoverable=True` outright.
    """
    body = _envelope_error(code, "some message", _CID, None)
    assert body["recoverable"] is False, (
        f"{code} is minted by /process-key itself, not by a venue probe; the "
        f"probe-code derivation must not reach it"
    )


def test_absent_code_is_not_recoverable() -> None:
    """`code=None` renders as "UNKNOWN" and stays terminal (pre-fix value)."""
    body = _envelope_error(None, None, _CID, None)
    assert body["code"] == "UNKNOWN"
    assert body["recoverable"] is False


def test_explicit_recoverable_overrides_the_code_derivation() -> None:
    """The 424 arm STATES its verdict rather than deriving it.

    Everything on the venue-transient arm is retryable by construction — that
    is what selected the arm. An adapter-SET VALIDATION_UNEXPECTED lands there
    and must carry `recoverable: true`, even though the same code string
    derives to False when it is our own fallback on the 403 arm.
    """
    body = _envelope_error(
        "VALIDATION_UNEXPECTED", "boom", _CID, "ver-1", recoverable=True
    )
    assert body["recoverable"] is True

    # And the override works in the other direction too, so a future arm can
    # pin a probe code terminal without editing the shared allow-list.
    body = _envelope_error("RATE_LIMITED", "slow down", _CID, None, recoverable=False)
    assert body["recoverable"] is False


def test_envelope_key_set_is_unchanged() -> None:
    """T-140.1.1-06: the 424 reuses the EXISTING key set — no new fields.

    Pinned as a literal set so adding a field to the wizard-facing envelope is
    a deliberate act with a failing test, not a silent information-disclosure
    surface.
    """
    body = _envelope_error("RATE_LIMITED", "slow down", _CID, "ver-1")
    assert set(body) == {
        "ok",
        "code",
        "human_message",
        "debug_context",
        "correlation_id",
        "recoverable",
    }
    assert body["ok"] is False
    assert body["correlation_id"] == _CID
    assert body["debug_context"] == {"verification_id": "ver-1"}
