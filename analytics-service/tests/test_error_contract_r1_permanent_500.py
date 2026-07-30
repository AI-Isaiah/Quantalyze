"""140.5-06 / WP-14 — R-1 is EXECUTABLE: a 500 must not be retryable.

Rule R-1 (``STATUS_CONTRACT.md``): 500 is the only permanent 5xx this service
emits, and a permanent fault must never advertise retryability. A body that says
"this is permanent" and "retry this" at once is the self-sustaining retry loop the
rule exists to stop — the client obeys the ``retryable`` flag and hammers a
condition only an operator or a deploy can clear.

**Why this file exists.** The rule was enforced at exactly one place — the
``raise ValueError("a 500 is SERVICE-PERMANENT and must not be retryable (R-1)")``
inside ``services.error_contract._validate`` — and **nothing pinned it**. Measured
at 140.5-06: that sentence appeared in the whole repository once, at the raise
site itself. Deleting the two-line guard would have left the Python suite green.

That mattered beyond tidiness, because three TypeScript suites were asserting a
body the guard refuses to construct:

  * ``src/app/api/keys/[id]/permissions/route.test.ts``
  * ``src/components/portfolio/PortfolioImpactPanel.test.tsx``
  * ``src/lib/analytics-client.test.ts``

all three carrying the byte-identical hand-typed fixture
``{"detail": {"code": "SEAM_DEGRADED", "dependency": "supabase",
"retryable": true, "detail": …}}`` at status 500. 140.5-06 corrected all three to
bodies their own upstreams really emit, with ``retryable`` false. Those
corrections are only as good as R-1 itself, so R-1 now has an oracle that can
fail: **this file is what those three fixtures lean on.**

ORACLE DISCIPLINE (programme non-negotiable #3). Every status code, flag and
dependency name below is a LITERAL typed into this file. Neither
``SERVICE_DEPENDENCIES`` nor any other table is imported from the module under
test — an oracle that reads its expectations back out of the code it guards
cannot fail when that code changes.

Both entry points are exercised for every case: ``service_error`` builds the
raisable and ``service_error_response`` the returnable, and a guard that lived in
only one of them would leave the other arm free to emit the refused body.
"""

from __future__ import annotations

import json
from typing import Any, Callable

import pytest

from services.error_contract import service_error, service_error_response

ENTRY_POINTS: list[Callable[..., Any]] = [service_error, service_error_response]
ENTRY_POINT_IDS = ["service_error", "service_error_response"]


def _envelope(constructed: Any) -> dict[str, Any]:
    """The R-2 envelope, from whichever of the two carriers built it.

    ``service_error`` returns an ``HTTPException`` whose ``.detail`` IS the
    envelope; ``service_error_response`` returns a ``JSONResponse`` whose
    serialised body nests it under ``"detail"``. Reading both through one helper
    is what lets every case below assert on the envelope for both entry points —
    the point being that a guard present in only one arm leaves the other free to
    emit the refused body.
    """
    detail = getattr(constructed, "detail", None)
    if isinstance(detail, dict):
        return detail
    body = json.loads(bytes(constructed.body).decode())
    assert isinstance(body.get("detail"), dict), (
        f"the envelope must be nested at .detail on the wire too, got {body!r}"
    )
    return body["detail"]

# Literals, never imported. `supabase` and `kek` are two of this service's own
# dependency names; `None` is the no-dependency case seven live 500 sites use.
_OUR_DEPENDENCIES: list[str | None] = ["supabase", "kek", None]


# --- the refusal: R-1 itself -------------------------------------------------


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
@pytest.mark.parametrize("dependency", _OUR_DEPENDENCIES)
def test_500_refuses_retryable_true(
    entry_point: Callable[..., Any], dependency: str | None
) -> None:
    """R-1: ``retryable=True`` at 500 is REFUSED, whichever dependency is named.

    Parametrised over the dependency because R-1 is about the STATUS, not about
    attribution: a permanent fault at Supabase, at the KEK, and at nothing in
    particular are all equally un-retryable. A guard that only refused the
    no-dependency form would let the two attributed shapes through, and those are
    the shapes the corrected TypeScript fixtures model.
    """
    with pytest.raises(ValueError) as excinfo:
        entry_point(
            500,
            "SEAM_DEGRADED",
            dependency=dependency,
            retryable=True,
            detail="The analytics store is not responding. Try again shortly.",
        )

    # The message must say WHY, not merely that something was invalid: this
    # ValueError is read by a developer at a raise site, and "invalid argument"
    # would send them to the call rather than to the contract.
    assert "retryable" in str(excinfo.value), (
        "the refusal must name the offending field, so the raise site is "
        f"actionable without reading _validate; got {excinfo.value!r}"
    )
    assert "500" in str(excinfo.value) or "PERMANENT" in str(excinfo.value).upper(), (
        "the refusal must say which rule was broken (a 500 is permanent), not "
        f"just that a value was wrong; got {excinfo.value!r}"
    )


# --- the positive counterparts: R-1 must not over-refuse ---------------------
#
# Without these, R-1 is satisfiable by refusing every 500, which would take out
# thirteen live raise sites. They are what make the refusal above a RULE rather
# than a blanket.


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
@pytest.mark.parametrize("dependency", _OUR_DEPENDENCIES)
def test_500_permits_retryable_false(
    entry_point: Callable[..., Any], dependency: str | None
) -> None:
    """The SAME call with ``retryable=False`` constructs — this is the exact body
    the three corrected TypeScript fixtures now assert, so if this case ever
    stopped constructing those suites would be vouching for an impossible body
    again, in the opposite direction."""
    constructed = entry_point(
        500,
        "SEAM_DEGRADED",
        dependency=dependency,
        retryable=False,
        detail="The analytics store is not responding. Try again shortly.",
    )

    assert constructed.status_code == 500  # literal
    env = _envelope(constructed)
    assert env["retryable"] is False  # literal
    assert env["dependency"] == dependency
    # R-1's companion: a permanent fault advertises NO wait. A Retry-After beside
    # retryable:false is the same self-contradiction from the header side.
    assert "Retry-After" not in (constructed.headers or {}), (
        "a permanent 500 must advertise no wait — a Retry-After here invites the "
        f"retry loop R-1 exists to stop; got {constructed.headers!r}"
    )


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_503_still_requires_retryable_true(entry_point: Callable[..., Any]) -> None:
    """The MIRROR case, and the reason R-1 cannot be implemented as "reject
    retryable on any 5xx": a 503 is SERVICE-TRANSIENT and ``retryable=False``
    there is refused for the opposite reason. Pinning both polarities is what
    distinguishes R-1 from a global prohibition."""
    with pytest.raises(ValueError):
        entry_point(
            503,
            "SEAM_DEGRADED",
            dependency="supabase",
            retryable=False,
            retry_after=30,
            detail="The analytics store is not responding. Try again shortly.",
        )
