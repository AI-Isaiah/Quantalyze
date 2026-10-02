"""PYAPIFIX-06(b) / M-2 — a 500 may only name one of OUR dependencies.

At HEAD ``56fb7167`` the ``>=500`` arm of ``services/error_contract._validate``
inspected only ``status_code != 500`` and ``retryable``. ``dependency`` was never
read, so ``service_error(500, "X", dependency="binance", retryable=False)``
validated — contradicting ``SERVICE_DEPENDENCIES``' own docstring ("Only these
may appear as ``dependency`` on a 5xx") which the 503 arm already enforces.

Why it cannot wait for a later phase: **Phase 140.2 keys the breaker on
``dependency`` (SEAMCORE-01)**. A venue name on a 500 mints a per-dependency
breaker key for something that is not ours — the A-01 defect class in a new
disguise — and 140.2 is TypeScript-only, so it cannot add a Python guard.

**The guard is MEMBERSHIP, never PROHIBITION.** Six production 500 sites
legitimately name one of ours (``internal.py:276``, ``:292``,
``exchange.py:124``, ``:242``, ``:253``, ``:525``) and seven name none
(``main.py:597``, ``:691``, ``exchange.py:492``, ``simulator.py:459``,
``portfolio.py:1197``, ``match.py:1797``, ``:1881``). A prohibition reading
would redden all thirteen and destroy six legitimate operator signals. The four
permitted cases below are the executable fence against that misreading.

Oracle discipline (programme non-negotiable #3): the dependency names below are
**LITERALS** typed into this file. ``SERVICE_DEPENDENCIES`` is deliberately NOT
imported — an oracle that iterates the set under test cannot fail when a member
is removed from it.

Both entry points are exercised for every case (criterion 6c).
"""

from __future__ import annotations

from typing import Any, Callable

import pytest

from services.error_contract import service_error, service_error_response

ENTRY_POINTS: list[Callable[..., Any]] = [service_error, service_error_response]
ENTRY_POINT_IDS = ["service_error", "service_error_response"]

# Literal, NOT imported from SERVICE_DEPENDENCIES. These four are the values the
# six live 500-with-dependency sites actually pass, plus `supabase` for
# completeness of the vocabulary.
OUR_DEPENDENCIES = ["kek", "egress-proxy", "mt5-gateway", "supabase"]


# --- the rejection -----------------------------------------------------------


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_500_rejects_a_venue_dependency(entry_point: Callable[..., Any]) -> None:
    """A fault at the CALLER'S venue is a 424 naming the venue, never a 500.
    Allowing it here poisons SEAMCORE-01's per-dependency breaker key."""
    with pytest.raises(ValueError):
        entry_point(500, "X", dependency="binance", retryable=False)


# --- the four permitted cases (the anti-PROHIBITION fence) -------------------


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
@pytest.mark.parametrize("dependency", OUR_DEPENDENCIES)
def test_500_permits_each_of_our_dependencies(
    entry_point: Callable[..., Any], dependency: str
) -> None:
    """Six live sites name one of ours on a permanent 500 so an operator learns
    WHICH of our dependencies is misconfigured. A prohibition guard would break
    every one of them."""
    constructed = entry_point(
        500, "KEK_UNAVAILABLE", dependency=dependency, retryable=False
    )

    assert constructed.status_code == 500  # literal


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_500_permits_no_dependency(entry_point: Callable[..., Any]) -> None:
    """Seven live sites pass none — the fault is ours but not attributable to a
    named dependency. `dependency=None` must stay legal."""
    constructed = entry_point(500, "EVAL_FAILED", retryable=False)

    assert constructed.status_code == 500  # literal
