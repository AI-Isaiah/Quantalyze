"""C4(a) — a 503's ``Retry-After`` must come FROM ``RETRY_AFTER_SECONDS``.

``RETRY_AFTER_SECONDS``' docstring says a raise site reads
``RETRY_AFTER_SECONDS["<dependency>"]`` and "NEVER inlines a number" (OPEN-2 /
Cluster-D). At HEAD ``56fb7167`` nothing in ``_validate`` tied a 503's
``retry_after`` to that table, so the rule was prose only: a helper site could
inline any positive integer and ship green. That is exactly the class of defect
this phase exists to close — "enforce, don't document".

Two properties are pinned here:

1. **Drift.** A 503 whose ``retry_after`` disagrees with the table entry for its
   ``dependency`` raises.
2. **No-transient-arm dependencies raise a ValueError, NOT a KeyError.** ``kek``
   and ``egress-proxy`` ARE in ``SERVICE_DEPENDENCIES`` (so they pass the 503
   arm's membership check) but are deliberately ABSENT from
   ``RETRY_AFTER_SECONDS``: every fault of theirs is a permanent
   misconfiguration (500, ``retryable:false``), and advertising a wait for them
   would invite the self-sustaining retry loop R-1 exists to stop. An
   implementation that bare-indexes ``RETRY_AFTER_SECONDS[dependency]`` would
   turn that contract violation into an opaque ``KeyError``, contradicting the
   module docstring's promise that "The guards raise ``ValueError``" — and a
   ``KeyError`` is NOT a ``ValueError``, so ``pytest.raises(ValueError)`` below
   fails against that implementation. That is the point of the third case.

Oracle discipline (programme non-negotiable #3): 15, 16, 30 and 31 below are
**LITERALS, NOT imported from RETRY_AFTER_SECONDS**. An oracle that read the
expected wait out of the table under test would survive the exact mutation the
code review caught elsewhere (``RETRY_AFTER_SECONDS["supabase"]`` 15 -> 900
SURVIVED).

Both entry points are exercised for every case (criterion 6c).
"""

from __future__ import annotations

from typing import Any, Callable

import pytest

from services.error_contract import service_error, service_error_response

ENTRY_POINTS: list[Callable[..., Any]] = [service_error, service_error_response]
ENTRY_POINT_IDS = ["service_error", "service_error_response"]


# --- supabase: 15 is the declared wait ---------------------------------------


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_503_supabase_rejects_a_drifted_retry_after(
    entry_point: Callable[..., Any],
) -> None:
    # 16: Literal, NOT imported from RETRY_AFTER_SECONDS. One second off the
    # declared value — the smallest possible drift a helper site could inline.
    with pytest.raises(ValueError):
        entry_point(
            503,
            "ADMIN_CHECK_UNAVAILABLE",
            dependency="supabase",
            retryable=True,
            retry_after=16,
        )


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_503_supabase_accepts_the_declared_retry_after(
    entry_point: Callable[..., Any],
) -> None:
    # 15: Literal, NOT imported from RETRY_AFTER_SECONDS.
    constructed = entry_point(
        503,
        "ADMIN_CHECK_UNAVAILABLE",
        dependency="supabase",
        retryable=True,
        retry_after=15,
    )

    assert constructed.status_code == 503  # literal
    assert (constructed.headers or {}).get("Retry-After") == "15"  # literal


# --- mt5-gateway: 30 is the declared wait (the control) ----------------------


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_503_mt5_gateway_rejects_a_drifted_retry_after(
    entry_point: Callable[..., Any],
) -> None:
    # 31: Literal, NOT imported from RETRY_AFTER_SECONDS.
    with pytest.raises(ValueError):
        entry_point(
            503,
            "MT5_GATEWAY_UNREACHABLE",
            dependency="mt5-gateway",
            retryable=True,
            retry_after=31,
        )


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_503_mt5_gateway_accepts_the_declared_retry_after(
    entry_point: Callable[..., Any],
) -> None:
    # 30: Literal, NOT imported from RETRY_AFTER_SECONDS.
    constructed = entry_point(
        503,
        "MT5_GATEWAY_UNREACHABLE",
        dependency="mt5-gateway",
        retryable=True,
        retry_after=30,
    )

    assert constructed.status_code == 503  # literal
    assert (constructed.headers or {}).get("Retry-After") == "30"  # literal


# --- kek / egress-proxy: in SERVICE_DEPENDENCIES, absent from the table ------


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
@pytest.mark.parametrize("dependency", ["kek", "egress-proxy"])
def test_503_rejects_a_dependency_with_no_declared_transient_arm(
    entry_point: Callable[..., Any], dependency: str
) -> None:
    """checker W-2: this MUST be a ValueError. A bare
    ``RETRY_AFTER_SECONDS[dependency]`` raises ``KeyError``, which is not a
    ``ValueError``, so that implementation fails here."""
    with pytest.raises(ValueError):
        entry_point(
            503,
            "KEK_UNAVAILABLE",
            dependency=dependency,
            retryable=True,
            retry_after=15,
        )
