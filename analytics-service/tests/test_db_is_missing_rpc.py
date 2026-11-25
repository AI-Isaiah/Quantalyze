"""Parity of ``services.db.is_missing_rpc`` with ``main_worker._is_missing_rpc``
(Phase 230 MT5NIGHTLY, plan 04, MT5D-02).

The predicate exists twice on purpose: ``services/mt5_xlease.py`` is a pinned leaf that
may import ``services.db`` but never ``main_worker`` (which imports half the service),
so the lease client cannot reuse the worker's copy (DEC-04-D). A duplicated predicate
drifts silently, so this file pins the twins together over ONE exception-shape matrix:
each shape is asserted against its expected value AND against the twin, so neither a
change to one copy nor a wrong expectation can pass quietly.

WHY STRUCTURED CODES ONLY. A message that merely mentions ``42883`` (a proxy error page,
a log line, an unrelated function named in the text) must never route the lease client
into its unserialized fallback: the fallback is the one path where two processes may
share the terminal, so it needs the database's own structured answer.
"""
from __future__ import annotations

from typing import Any

import pytest
from postgrest.exceptions import APIError

import main_worker
from services import db


class _Shaped(Exception):
    """An exception carrying exactly the attributes a case names, nothing else."""

    def __init__(self, message: str = "", **attrs: Any) -> None:
        super().__init__(message)
        for name, value in attrs.items():
            setattr(self, name, value)


_MATRIX: list[tuple[str, BaseException, bool]] = [
    ("code 42883", _Shaped(code="42883"), True),
    ("details dict 42883", _Shaped(details={"code": "42883"}), True),
    ("code PGRST202", _Shaped(code="PGRST202"), True),
    ("details dict PGRST202", _Shaped(details={"code": "PGRST202"}), True),
    (
        "postgrest APIError PGRST202",
        APIError(
            {
                "message": "Could not find the function public.acquire_mt5_terminal_lease",
                "code": "PGRST202",
                "details": None,
                "hint": None,
            }
        ),
        True,
    ),
    (
        "postgrest APIError 42883",
        APIError({"message": "function does not exist", "code": "42883"}),
        True,
    ),
    # --- the False shapes: every one of these must fail CLOSED in the lease client ---
    ("message mentions 42883, no code", _Shaped("ERROR: 42883 function does not exist"), False),
    ("message mentions PGRST202, no code", _Shaped("PGRST202 could not find"), False),
    ("code 42P01 (a missing TABLE)", _Shaped(code="42P01"), False),
    ("code PGRST205", _Shaped(code="PGRST205"), False),
    ("plain RuntimeError", RuntimeError("boom"), False),
    ("non-dict details string", _Shaped(details="42883"), False),
    ("non-dict details list", _Shaped(details=["PGRST202"]), False),
    ("details dict with another code", _Shaped(details={"code": "XX000"}), False),
    ("integer code 42883 is not the SQLSTATE string", _Shaped(code=42883), False),
    ("a 504 gateway timeout", _Shaped(code="504"), False),
    ("no attributes at all", _Shaped(), False),
    (
        "postgrest APIError with another code",
        APIError({"message": "boom", "code": "23505"}),
        False,
    ),
]


@pytest.mark.parametrize(
    ("exc", "expected"),
    [pytest.param(exc, expected, id=name) for name, exc, expected in _MATRIX],
)
def test_is_missing_rpc_matches_its_expectation_and_the_main_worker_twin(
    exc: BaseException, expected: bool
) -> None:
    assert db.is_missing_rpc(exc) is expected, (
        f"services.db.is_missing_rpc({exc!r}) should be {expected}"
    )
    assert db.is_missing_rpc(exc) == main_worker._is_missing_rpc(exc), (
        "the two predicates diverged: services.db.is_missing_rpc and "
        "main_worker._is_missing_rpc must answer identically for every shape"
    )


def test_matrix_covers_both_answers() -> None:
    """A matrix of only True (or only False) shapes would pass a predicate that always
    answers one way."""
    answers = {expected for _, _, expected in _MATRIX}
    assert answers == {True, False}
