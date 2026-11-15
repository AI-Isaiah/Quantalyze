"""Worker-domain job failures (Phase 215 SC-4).

``run_csv_strategy_analytics`` is reached only from the worker
(``job_worker.run_compute_analytics_from_csv_job``). It used to raise
``fastapi.HTTPException`` at four sites, which can never render as an HTTP response
there and only worked by accident of ``classify_exception``'s HTTP arm. These
exceptions replace them. ``classify_exception`` maps each one to the SAME
``(ErrorKind, message)`` the HTTP exception produced, so the persisted
``compute_jobs`` error kind and text (read by the admin UI) are unchanged.

This is a LEAF module: it imports nothing from ``job_worker`` or ``analytics_runner``,
so both can import it without a cycle.

``message`` deliberately keeps the legacy numeric prefix ("404: ...") for byte-identical
persisted text. The classes carry no HTTP status or detail attribute on purpose:
that would re-import the HTTP vocabulary this module exists to remove.
"""

from __future__ import annotations

from typing import Literal

# Same alphabet as ``job_worker.ErrorKind`` (kept as its own alias: importing the
# worker's would make this module depend on the module that imports it).
FailureKind = Literal["transient", "permanent", "unknown"]


class WorkerJobFailure(Exception):
    """A worker job failed with a known disposition.

    ``error_kind`` decides retry vs permanent failure; ``message`` is the text the
    queue persists (``classify_exception`` appends a cause suffix when one is chained).
    """

    error_kind: FailureKind
    message: str

    def __init__(self, error_kind: FailureKind, message: str) -> None:
        super().__init__(message)
        self.error_kind = error_kind
        self.message = message

    def __str__(self) -> str:
        return self.message


class CsvStrategyNotFound(WorkerJobFailure):
    """The strategy row is gone (deleted between enqueue and run).

    ``unknown``, so it is retried: the same disposition the old 404 had, because a
    404 in a deploy-time race self-heals and the queue's own attempt cap bounds it.
    """

    def __init__(self) -> None:
        super().__init__("unknown", "404: Strategy not found")


class CsvInsufficientHistory(WorkerJobFailure):
    """Too few CSV return rows to compute analytics.

    ``permanent``: the input data is absent and no retry will conjure it. It must
    never be re-wrapped as ``CsvComputationFailed`` (``unknown``), which would retry a
    fault that can never clear.
    """

    def __init__(self) -> None:
        super().__init__("permanent", "400: Insufficient CSV history")


class CsvMalformedDenominatorConfig(WorkerJobFailure):
    """``returns_denominator_config`` is structurally malformed.

    ``permanent``: the config is operator data that only an operator can fix, so a
    retry repeats the same refusal. Raised ``from`` the underlying
    ``ReturnsDenominatorConfigError`` so the persisted text carries the cause suffix.
    """

    def __init__(self) -> None:
        super().__init__("permanent", "422: Malformed returns_denominator_config")


class CsvComputationFailed(WorkerJobFailure):
    """The catch-all: an unexpected failure while computing CSV analytics.

    ``unknown``, so it is retried: the cause is unclassified and may be transient.
    Raised WITHOUT a chained cause, as the old 500 was, so the persisted text is
    unchanged.
    """

    def __init__(self) -> None:
        super().__init__("unknown", "500: CSV analytics computation failed")
