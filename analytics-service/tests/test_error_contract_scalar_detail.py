"""PYAPIFIX-04 / C1 — ``body.detail.detail`` is a scalar string, ENFORCED.

The guarantee is asserted three times — ``services/error_contract``'s module
docstring, ``docs/STATUS_CONTRACT.md`` §2, and R-2 — and at HEAD ``56fb7167``
it was enforced **nowhere**. ``_validate`` never received ``detail``;
``service_error_body`` passed it straight through
(``detail if detail else _FALLBACK_DETAIL``). The review proved by execution
that ``detail=['a','b']`` and ``detail={'k':'v'}`` emit verbatim.

The only protection was the ``detail: str | None`` annotation, in a module whose
callers routinely hand it ``Any`` (``key_data.get(...)``, ``exc.args``,
``err.detail``) — which ``mypy --strict`` cannot narrow at the call boundary.
Tightening the annotation alone closes nothing; the runtime guard is the point.
Every other class rule in that module is a hard guard. This one was a suggestion.

**Phase 140.2 renders from ``body.detail.detail`` (O-5).** A list or dict there
is the ``"[object Object]"`` render (C-14) reintroduced, and worse: the
non-scalars that reach a ``detail=`` argument in practice are ``exc.args`` and
raw upstream payloads — internal structures on the wire to an untrusted caller
(threat T-140.1.1-01).

Two properties this file pins that a narrower test would miss:

1. **The guard tests the POSITIVE property** (``isinstance(detail, str)``).
   ``isinstance(detail, (list, dict))`` would miss ``int``, ``bytes`` and a
   pydantic model — the Class-A "enumerate by behaviour, not by syntax" lesson.
   Hence ``int`` and ``bytes`` are here alongside ``list`` and ``dict``.
2. **It raises; it does not coerce.** ``str(['a','b'])`` emits ``"['a', 'b']"``
   to a user — the same defect wearing a string costume — and hides the calling
   bug that produced a non-scalar. So these are ``pytest.raises(ValueError)``,
   matching the eleven out-of-class constructions the module already refuses.

Oracle discipline (programme non-negotiable #3): every non-scalar below is built
**IN this file**. ``_FALLBACK_DETAIL`` and every other ``error_contract``
constant are deliberately NOT imported.

Both entry points are exercised for every case (criterion 6c).
"""

from __future__ import annotations

from typing import Any, Callable

import pytest

from services.error_contract import service_error, service_error_response

ENTRY_POINTS: list[Callable[..., Any]] = [service_error, service_error_response]
ENTRY_POINT_IDS = ["service_error", "service_error_response"]

# Built HERE, never imported. Four different runtime types, deliberately
# including two an `isinstance(detail, (list, dict))` guard would let through.
NON_SCALAR_DETAILS: list[Any] = [
    ["first problem", "second problem"],  # list — pydantic's error list shape
    {"msg": "boom", "input": "sk-secret"},  # dict — a raw upstream payload
    500,  # int — not a container, still not a string
    b"bytes are not human copy",  # bytes — not a container either
]
NON_SCALAR_IDS = ["list", "dict", "int", "bytes"]


def _envelope(constructed: Any) -> dict[str, Any]:
    """The R-2 envelope, wherever this entry point put it."""
    detail = getattr(constructed, "detail", None)
    if isinstance(detail, dict):
        return detail
    # service_error_response nests it inside the JSONResponse's rendered body.
    import json

    body = json.loads(constructed.body)
    assert isinstance(body["detail"], dict)
    return body["detail"]


# --- the four rejections, each through BOTH entry points ---------------------


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
@pytest.mark.parametrize("detail", NON_SCALAR_DETAILS, ids=NON_SCALAR_IDS)
def test_non_scalar_detail_raises_at_construction(
    entry_point: Callable[..., Any], detail: Any
) -> None:
    """A non-scalar can never reach a wire body — the failure is a ValueError at
    the raise site, where the programming error actually is."""
    with pytest.raises(ValueError):
        entry_point(500, "INTERNAL", retryable=False, detail=detail)


# --- the two pass-cases ------------------------------------------------------


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_absent_detail_still_falls_back(entry_point: Callable[..., Any]) -> None:
    """`detail=None` is the documented "raise site supplied no human copy" case
    and must keep falling back, not raise."""
    constructed = entry_point(500, "INTERNAL", retryable=False, detail=None)

    body = _envelope(constructed)
    # Literal, NOT imported from _FALLBACK_DETAIL — an oracle that read the
    # fallback out of the module under test could not fail when it changes.
    assert body["detail"] == "The request could not be completed."


@pytest.mark.parametrize("entry_point", ENTRY_POINTS, ids=ENTRY_POINT_IDS)
def test_string_detail_passes_through_unchanged(
    entry_point: Callable[..., Any],
) -> None:
    """The overwhelmingly common case: a string literal at the raise site."""
    constructed = entry_point(
        500, "INTERNAL", retryable=False, detail="a string"
    )

    body = _envelope(constructed)
    assert body["detail"] == "a string"  # literal
