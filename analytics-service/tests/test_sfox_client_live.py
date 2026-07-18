"""Phase 118 (SFOX-01, SC-3) — FOUNDER-GATED live sandbox smoke test.

This is the SC-3 *empirical* gate: docs-only is NOT green (CONTEXT lock). The
plan-01 contract (`services/sfox_client.py`) is proven against reality here — a
real Bearer-authed read against the sFOX **sandbox** host `api.staging.sfox.com`
that succeeds AND returns a real payload. There is deliberately NO mocking, NO
network-stubbing fixture, and NO fallback path in this file: it performs a real
request or it SKIPS, nothing in between. The adapter must never fabricate a green
(Rule 12 fail-loud; T-118-06 anti-fake-green).

Canonical env var: ``SFOX_SANDBOX_KEY``.
  (118-RESEARCH.md sketched ``SFOX_SANDBOX_API_KEY``; the phase standardizes on
  ``SFOX_SANDBOX_KEY`` per 118-VALIDATION.md — this docstring is the single name
  the founder runbook uses.)

Founder runbook to flip SC-3 from human_needed → green:
  1. Mint a sandbox API key at ``beta.sfox.com`` (separate from prod keys).
  2. Ask ``support@sfox.com`` to fund/enable the sandbox account if needed.
  3. ``export SFOX_SANDBOX_KEY=<sandbox key>``
  4. ``cd analytics-service && python -m pytest tests/test_sfox_client_live.py -q``
  Expect: auth 200 + a (possibly empty) list payload from ``get_balances()``.

Without ``SFOX_SANDBOX_KEY`` the module SKIPS cleanly with a verbose reason so CI
stays green — a silent skip would be a fail-loud violation (Rule 12). A skip is
NOT a pass: the phase's SC-3 stays ``human_needed`` until this runs green.

Security posture (T-118-05 / T-118-07, mirrors the deribit_ground_truth runbook):
the sandbox key lives ONLY as an env var — never a tracked file. Assertion
messages here carry only the payload TYPE and length, never its contents and
never the key or Authorization header, because this file's output may be pasted
into phase evidence.
"""
from __future__ import annotations

import os

import pytest

from services.sfox_client import (
    SFOX_SANDBOX_BASE_URL,
    SfoxClient,
)

# Module-level founder-gate. Verbose reason (Rule 12): a silent skip is a
# fail-loud violation, and a skip must never read as a pass — SC-3 stays
# human_needed until a founder runs this with a real sandbox key.
pytestmark = pytest.mark.skipif(
    not os.environ.get("SFOX_SANDBOX_KEY"),
    reason=(
        "FOUNDER-GATED SC-3 smoke: SFOX_SANDBOX_KEY unset. Mint a sandbox key at "
        "beta.sfox.com (separate from prod keys; support@sfox.com funds sandbox "
        "accounts), export SFOX_SANDBOX_KEY, then run "
        "`cd analytics-service && python -m pytest tests/test_sfox_client_live.py -q`. "
        "Skipping keeps CI green, but phase 118 SC-3 stays human_needed until this "
        "runs green — a skip is NOT a pass."
    ),
)

# 2015-01-01T00:00:00Z in epoch-ms — a start well before any sandbox account
# could exist, so balance-history returns the full available depth (A1 probe).
_BALANCE_HISTORY_START_MS = 1_420_070_400_000


async def test_sandbox_get_balances_authenticates_and_returns_list() -> None:
    """SC-3 primary gate: Bearer auth against api.staging.sfox.com succeeds and
    get_balances() returns a real list payload.

    An EMPTY list is a PASS — the SC-3 bar is *auth + real payload*, not
    non-empty data (RESEARCH Open Question 3: a fresh sandbox account may hold
    nothing). A raised SfoxApiError (e.g. 401) is a FAIL: it propagates, never
    caught-and-passed. Assertion message carries only the payload type, never
    its contents or the key.
    """
    client = SfoxClient(
        api_key=os.environ["SFOX_SANDBOX_KEY"],
        base_url=SFOX_SANDBOX_BASE_URL,
        proxy=None,
    )
    try:
        balances = await client.get_balances()
    finally:
        await client.aclose()

    assert isinstance(balances, list), (
        "sFOX sandbox get_balances() must return a list "
        f"(auth OK + real payload); got type {type(balances).__name__}"
    )


async def test_sandbox_get_balance_history_returns_list() -> None:
    """SC-3 secondary probe (A1): balance/history returns a real list.

    Doubles as the first empirical probe of historical depth (RESEARCH
    Assumption A1) without weakening the primary balances assertion. Same
    fail-loud posture: SfoxApiError propagates; the message carries only type +
    length, never contents or the key.
    """
    client = SfoxClient(
        api_key=os.environ["SFOX_SANDBOX_KEY"],
        base_url=SFOX_SANDBOX_BASE_URL,
        proxy=None,
    )
    try:
        history = await client.get_balance_history(
            start_date_ms=_BALANCE_HISTORY_START_MS
        )
    finally:
        await client.aclose()

    assert isinstance(history, list), (
        "sFOX sandbox get_balance_history() must return a list "
        f"(auth OK + real payload); got type {type(history).__name__} "
        f"len={len(history) if isinstance(history, list) else 'n/a'}"
    )
