"""PYAPI-05 — the status-attributability contract, expressed in code.

The prose contract lives at ``analytics-service/docs/STATUS_CONTRACT.md`` and is
the artifact Phase 140.2's TypeScript discriminator (SEAMCORE-01) consumes. This
module is its executable half: one helper that every deliberate error site calls
so the four classes cannot drift apart site-by-site.

The four classes (see STATUS_CONTRACT.md for the full reasoning)::

    CALLER              4xx   caller's request / credentials / authorization
    CALLER'S EXCHANGE   424   the third party the CALLER named is at fault
    SERVICE-TRANSIENT   503   one of OUR dependencies is temporarily unavailable
    SERVICE-PERMANENT   500   a misconfiguration or bug an identical retry cannot fix

Two rules are load-bearing:

* **R-1 — ``500`` means "do not retry".** An unhandled exception is a bodyless
  ``500 text/plain`` (Starlette's ``ServerErrorMiddleware``), so ``500`` MUST be
  safe to classify with no body at all. Never emit a deliberate transient fault
  as ``500``; never emit a permanent fault as ``503``.
* **R-2 — every deliberate 5xx body carries ``{code, dependency, retryable}``.**
  ``code`` is the stable machine discriminator; ``dependency`` names WHICH
  dependency failed so a breaker can be keyed per-dependency instead of globally.

**Envelope location.** The envelope ALWAYS lives at ``body["detail"]``. FastAPI's
default ``HTTPException`` handler serialises to ``{"detail": <detail>}``, so
:func:`service_error` puts the whole envelope there, and
:func:`service_error_response` (for ``BaseHTTPMiddleware`` sites that must RETURN
a response rather than raise) nests it identically. One rule, one location.
``body["detail"]["detail"]`` is always a scalar human string.

**The guards raise ``ValueError``.** A contract violation here is a programming
error at a raise site, not a runtime condition: the arguments are literals. A
``ValueError`` escaping becomes a bodyless ``500``, which R-1 makes safe — and
loud. The guards are pinned by tests so the failure is caught before deploy.
"""

from __future__ import annotations

from typing import Any, Final

from fastapi import HTTPException
from fastapi.responses import JSONResponse

# ---------------------------------------------------------------------------
# Dependency vocabulary
# ---------------------------------------------------------------------------

#: The dependencies OF THIS SERVICE. Only these may appear as ``dependency`` on a
#: 5xx. A breaker keyed on one of these values is keyed correctly (A-01: the
#: single global ``breaker:railway`` key is what makes one MT5 outage deny every
#: Deribit user).
SERVICE_DEPENDENCIES: Final[frozenset[str]] = frozenset(
    {"mt5-gateway", "kek", "supabase", "egress-proxy"}
)

# ---------------------------------------------------------------------------
# Retry-After — per-dependency LITERALS, declared ONCE (OPEN-2 / Cluster-D)
# ---------------------------------------------------------------------------

#: Seconds to advertise on a SERVICE-TRANSIENT ``503``, keyed by dependency.
#:
#: These are the ONLY Retry-After integers in the service — a raise site reads
#: ``RETRY_AFTER_SECONDS["<dependency>"]``, it NEVER inlines a number. A
#: dependency that has no transient arm is deliberately ABSENT: ``kek`` and
#: ``egress-proxy`` faults are permanent misconfigurations (``500``
#: ``retryable:false``), and advertising a wait for them would invite exactly the
#: self-sustaining retry loop R-1 exists to stop. Add a key here only when a
#: genuinely transient arm for that dependency exists.
RETRY_AFTER_SECONDS: Final[dict[str, int]] = {
    # A gateway restart on deploy is the modal cause; a Railway redeploy settles
    # well inside 30s.
    "mt5-gateway": 30,
    # PostgREST/Supabase blips are seconds, not minutes.
    "supabase": 15,
}

#: Used when a raise site supplies no human copy. Never leaks internals.
_FALLBACK_DETAIL: Final[str] = "The request could not be completed."


def _validate(
    status_code: int,
    code: str,
    dependency: str | None,
    retryable: bool,
    retry_after: int | None,
) -> None:
    """Enforce the four-class contract at construction time.

    Raises ``ValueError`` on any violation — see the module docstring for why
    that is the deliberate posture rather than a silent coercion.
    """
    if status_code < 400:
        raise ValueError(f"service_error is for error statuses only, got {status_code}")
    if not code or not code.strip():
        raise ValueError("service_error requires a non-empty machine code")
    if retry_after is not None and retry_after <= 0:
        raise ValueError(f"retry_after must be a positive number of seconds, got {retry_after}")
    if retry_after is not None and not retryable:
        raise ValueError("retry_after on a non-retryable error contradicts R-1")

    if status_code == 503:
        # SERVICE-TRANSIENT: Retry-After is REQUIRED and the dependency must be
        # one of ours, because 140.2 keys the breaker on it.
        if not retryable:
            raise ValueError("a 503 is SERVICE-TRANSIENT and must be retryable")
        if dependency not in SERVICE_DEPENDENCIES:
            raise ValueError(
                f"a 503 must name one of this service's dependencies "
                f"{sorted(SERVICE_DEPENDENCIES)}, got {dependency!r}"
            )
        if retry_after is None:
            raise ValueError("a 503 must carry Retry-After (see RETRY_AFTER_SECONDS)")
        # C4(a) — the advertised wait must come FROM the table, never from the
        # raise site. `.get`, deliberately NOT `RETRY_AFTER_SECONDS[dependency]`:
        # `kek` and `egress-proxy` pass the membership check above but are
        # ABSENT from the table by design, so a bare index would turn a contract
        # violation into an opaque KeyError — contradicting this module's
        # documented posture that the guards raise ValueError.
        _expected = RETRY_AFTER_SECONDS.get(dependency)
        if _expected is None:
            raise ValueError(
                f"{dependency!r} has no declared transient arm in "
                f"RETRY_AFTER_SECONDS {sorted(RETRY_AFTER_SECONDS)}, so it cannot "
                "be the dependency of a 503; a fault there is a permanent 500 "
                "(retryable:false) and advertising a wait would invite the retry "
                "loop R-1 exists to stop"
            )
        if retry_after != _expected:
            raise ValueError(
                f"a 503 naming {dependency!r} must advertise "
                f"RETRY_AFTER_SECONDS[{dependency!r}] == {_expected}, got "
                f"{retry_after}; a raise site never inlines its own wait"
            )
        return

    if status_code >= 500:
        # SERVICE-PERMANENT (R-1). 500 is the only permanent 5xx this service
        # emits; anything else in the 5xx range is a mistake at the raise site.
        if status_code != 500:
            raise ValueError(
                f"the only permanent 5xx in this contract is 500, got {status_code}; "
                "a transient fault is 503, an exchange fault is 424"
            )
        if retryable:
            raise ValueError("a 500 is SERVICE-PERMANENT and must not be retryable (R-1)")
        # MEMBERSHIP, not prohibition: six live sites legitimately name one of
        # ours here so an operator learns WHICH dependency is misconfigured, and
        # seven pass none at all. Only a name from OUTSIDE the vocabulary is
        # refused — 140.2 keys the breaker on this value (SEAMCORE-01), so a
        # venue name would mint a per-dependency breaker key for something that
        # is not ours (the A-01 defect class in a new disguise).
        if dependency is not None and dependency not in SERVICE_DEPENDENCIES:
            raise ValueError(
                f"a 500 may only name one of this service's dependencies "
                f"{sorted(SERVICE_DEPENDENCIES)}, got {dependency!r}; a fault at "
                "the caller's venue is 424, not 500"
            )
        return

    if status_code == 424:
        # CALLER'S EXCHANGE. `dependency` names the VENUE here, not one of ours —
        # see STATUS_CONTRACT.md. Breaker-inert by construction (4xx).
        if not dependency:
            raise ValueError("a 424 must name the venue that failed in `dependency`")
        if dependency in SERVICE_DEPENDENCIES:
            raise ValueError(
                f"{dependency!r} is one of OUR dependencies; a 424 names the "
                "caller's venue, and a fault in our own dependency is 500/503"
            )
        if not retryable:
            raise ValueError(
                "a 424 is recoverable — the venue may come back; marking it "
                "non-retryable produces the B-01/B-22 dead-end render"
            )
        return

    if status_code == 429:
        # CALLER, throttled. Unlike every other CALLER fault an identical retry
        # DOES succeed — after the advertised wait — so the generic arm's "a
        # retry cannot help" rule must not reach here. Still breaker-inert by
        # construction (4xx). The 424 arm above is the in-file precedent for a
        # retryable 4xx, so "4xx implies not retryable" is the DEFAULT arm's
        # rule, not an invariant of the contract.
        if dependency is not None:
            raise ValueError("a 429 is a CALLER fault and must not name a dependency")
        if not retryable:
            # retryable:false in the body beside a Retry-After header on the
            # wire is the self-contradicting response R-1 forbids. Chosen over
            # exempting 429 from the retry_after/retryable rule above.
            raise ValueError(
                "a 429 is recoverable after the advertised wait; retryable:false "
                "beside a Retry-After is the self-contradicting body R-1 forbids"
            )
        if retry_after is None:
            raise ValueError("a 429 must carry Retry-After (STATUS_CONTRACT.md §1)")
        return

    # CALLER (every other 4xx). Nothing of ours failed, so there is no dependency
    # to name and an identical retry cannot help.
    if dependency is not None:
        raise ValueError(
            f"a {status_code} is a CALLER fault and must not name a dependency"
        )
    if retryable:
        raise ValueError(
            f"a {status_code} is a CALLER fault; an identical retry cannot succeed"
        )


def service_error_body(
    code: str,
    *,
    dependency: str | None = None,
    retryable: bool,
    detail: str | None = None,
    correlation_id: str | None = None,
) -> dict[str, Any]:
    """Build the R-2 envelope dict.

    Key set is exactly ``{code, dependency, retryable, detail}``, plus
    ``correlation_id`` when one is supplied. ``dependency`` is always present
    (``None`` when nothing of ours failed) so a consumer never has to probe for
    the key's existence.
    """
    body: dict[str, Any] = {
        "code": code,
        "dependency": dependency,
        "retryable": retryable,
        "detail": detail if detail else _FALLBACK_DETAIL,
    }
    if correlation_id is not None:
        body["correlation_id"] = correlation_id
    return body


def _retry_after_headers(retry_after: int | None) -> dict[str, str] | None:
    if retry_after is None:
        return None
    return {"Retry-After": str(retry_after)}


def service_error(
    status_code: int,
    code: str,
    *,
    dependency: str | None = None,
    retryable: bool,
    retry_after: int | None = None,
    detail: str | None = None,
    correlation_id: str | None = None,
) -> HTTPException:
    """Return the ``HTTPException`` for a deliberate error, per the contract.

    Use as ``raise service_error(...)``. The envelope lands at ``body["detail"]``
    once FastAPI's default handler serialises it.
    """
    _validate(status_code, code, dependency, retryable, retry_after)
    return HTTPException(
        status_code=status_code,
        detail=service_error_body(
            code,
            dependency=dependency,
            retryable=retryable,
            detail=detail,
            correlation_id=correlation_id,
        ),
        headers=_retry_after_headers(retry_after),
    )


def service_error_response(
    status_code: int,
    code: str,
    *,
    dependency: str | None = None,
    retryable: bool,
    retry_after: int | None = None,
    detail: str | None = None,
    correlation_id: str | None = None,
) -> JSONResponse:
    """The same envelope as a RETURNED ``JSONResponse``.

    For ``BaseHTTPMiddleware`` sites, which sit ABOVE the ``ExceptionMiddleware``
    that would translate an ``HTTPException`` — raising there escapes to
    ``ServerErrorMiddleware``, which renders a 500 AND re-raises (Sentry
    QUANTALYZE-4). See the comment at ``main.py:221-228``.

    The envelope is nested under ``detail`` here TOO, so there is exactly one
    place a consumer looks for it regardless of which mechanism emitted it.
    """
    _validate(status_code, code, dependency, retryable, retry_after)
    return JSONResponse(
        status_code=status_code,
        content={
            "detail": service_error_body(
                code,
                dependency=dependency,
                retryable=retryable,
                detail=detail,
                correlation_id=correlation_id,
            )
        },
        headers=_retry_after_headers(retry_after),
    )
