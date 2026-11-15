"""Phase 215 SC-4 -- the CSV runner's worker domain exceptions classify exactly as the
HTTP exceptions they replaced.

``run_csv_strategy_analytics`` used to raise ``fastapi.HTTPException`` at four sites.
It raises ``services.job_failure`` exceptions now. The persisted ``compute_jobs``
``error_kind`` and text are read by the admin UI and decide retry-vs-permanent, so this
file pins them two independent ways:

* an OLD-vs-NEW equivalence over the four sites (the old side is rebuilt here from
  ``HTTPException`` with the same status and detail), so a drift in either classifier
  arm shows up as a difference, and
* four hand-typed LITERAL tuples (an oracle that does not run the old arm), so the
  equivalence cannot pass by both sides drifting together.

The 400 must stay PERMANENT: ``unknown`` would retry a fault that can never clear.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from services.allocated_capital import ReturnsDenominatorConfigError
from services.job_failure import (
    CsvComputationFailed,
    CsvInsufficientHistory,
    CsvMalformedDenominatorConfig,
    CsvStrategyNotFound,
    WorkerJobFailure,
)
from services.job_worker import classify_exception


def _planted_cause() -> ReturnsDenominatorConfigError:
    return ReturnsDenominatorConfigError("boom")


def _new_422() -> CsvMalformedDenominatorConfig:
    new = CsvMalformedDenominatorConfig()
    new.__cause__ = _planted_cause()
    return new


def _old_422() -> HTTPException:
    old = HTTPException(status_code=422, detail="Malformed returns_denominator_config")
    old.__cause__ = _planted_cause()
    return old


_SITES = [
    pytest.param(
        CsvStrategyNotFound,
        lambda: HTTPException(status_code=404, detail="Strategy not found"),
        id="404-strategy-not-found",
    ),
    pytest.param(
        CsvInsufficientHistory,
        lambda: HTTPException(status_code=400, detail="Insufficient CSV history"),
        id="400-insufficient-history",
    ),
    pytest.param(
        _new_422,
        _old_422,
        id="422-malformed-config-with-cause",
    ),
    pytest.param(
        CsvComputationFailed,
        lambda: HTTPException(status_code=500, detail="CSV analytics computation failed"),
        id="500-computation-failed",
    ),
]


@pytest.mark.parametrize(("make_new", "make_old"), _SITES)
def test_domain_exception_classifies_like_the_http_exception_it_replaced(
    make_new, make_old
) -> None:
    """WHY: the persisted kind and text must not move when the raise type changes."""
    assert classify_exception(make_new()) == classify_exception(make_old())


def test_strategy_not_found_is_unknown_with_legacy_text() -> None:
    assert classify_exception(CsvStrategyNotFound()) == (
        "unknown",
        "404: Strategy not found",
    )


def test_insufficient_history_stays_permanent_with_legacy_text() -> None:
    """WHY: `unknown` would retry forever a fault that no retry can fix."""
    assert classify_exception(CsvInsufficientHistory()) == (
        "permanent",
        "400: Insufficient CSV history",
    )


def test_malformed_config_is_permanent_and_carries_the_cause_suffix() -> None:
    exc = CsvMalformedDenominatorConfig()
    exc.__cause__ = ReturnsDenominatorConfigError("boom")
    assert classify_exception(exc) == (
        "permanent",
        "422: Malformed returns_denominator_config "
        "(cause: ReturnsDenominatorConfigError('boom'))",
    )


def test_computation_failed_is_unknown_with_legacy_text() -> None:
    assert classify_exception(CsvComputationFailed()) == (
        "unknown",
        "500: CSV analytics computation failed",
    )


def test_computation_failed_without_a_cause_has_no_suffix() -> None:
    """The runner raises the 500 with no `from`, as before: no cause text in the row."""
    kind, text = classify_exception(CsvComputationFailed())
    assert kind == "unknown"
    assert "cause" not in text


def test_http_exception_arm_is_kept_for_other_callers() -> None:
    """WHY: portfolio and match helpers still raise HTTPException on the worker path."""
    assert classify_exception(HTTPException(status_code=400, detail="x")) == (
        "permanent",
        "400: x",
    )


def test_domain_exceptions_are_not_http_exceptions() -> None:
    """The point of SC-4: the worker's runner no longer speaks HTTP."""
    for cls in (
        CsvStrategyNotFound,
        CsvInsufficientHistory,
        CsvMalformedDenominatorConfig,
        CsvComputationFailed,
    ):
        exc = cls()
        assert isinstance(exc, WorkerJobFailure)
        assert not isinstance(exc, HTTPException)
        assert str(exc) == exc.message
