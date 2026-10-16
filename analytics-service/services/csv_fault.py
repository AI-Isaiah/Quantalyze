"""170.1 / D-14 (SFH-L1): report an INTERNAL fault in the CSV path so an operator
can find it, without the text of the exception ever leaving the process.

Context. `validate_csv` is contracted to return an envelope for any file content
(`tests/test_csv_never_raises_170_1.py` pins that over a hostile corpus), so an
exception reaching a caller's `except Exception` arm is a BUG, not a client error.
The arms used to log only `type(e).__name__`, which closed a leak (a pandas /
pandera / int() message routinely quotes the offending CELL) and also made the
fault impossible to locate. This module gives the arms one shared way to report:

  * the LOG line carries the exception type and the INNERMOST FRAME
    (`ValueError at services/csv_validator.py:411 in _maybe_auto_normalize...`) and
    never the exception text;
  * the fault is CAPTURED TO SENTRY through a scoped `capture_exception`, the same
    shape as `main.py`'s `_capture_secret_misconfig`, and the event then goes
    through the existing `sentry_init._redact_before_send` like any other.

Why the capture withholds more than that hook does. `_redact_before_send` scrubs
credential SHAPES (JWTs, URL userinfo, `key=value` secrets) and denylisted KEYS.
It has no notion of a cell, so on its own it passes
`could not convert string to float: '<the cell>'` straight through
`exception.values[].value`, and it passes frame locals under any key it does not
name. The scope's event processor therefore runs before the hook and withholds,
for this capture only:

  * every `exception.values[].value`: the TYPE stays, the text goes. The SDK lists
    each exception of a chain as its own entry, so a chained `__context__` is
    covered by the same loop;
  * every frame's `vars`: production sets `include_local_variables=False`, but this
    must not depend on an init flag that someone can flip;
  * the request body: `/process-key` carries the whole upload as
    `raw_bytes_base64` in its JSON body and the request integration attaches that
    body to every event raised during the request.

What is kept is what locates the fault: the exception type and the full stack
(file, line, function, source lines), plus a `csv_fault` tag.

The log line is written on its own logger, which is told to the Sentry logging
integration as ignored. Without that, every `logger.error` in the process is also
sent to Sentry as an event of its own, carrying the same request, next to the
exception event this module captures: two issues for one fault.
"""
from __future__ import annotations

import logging
import os
import traceback
from typing import Any

import sentry_sdk
from sentry_sdk.integrations.logging import ignore_logger

# A dedicated child of the service logger: it propagates to the same handlers (so
# Railway logs and `caplog` see it) and is excluded from Sentry's logging
# integration, because the exception event below is the one Sentry issue.
_LOGGER_NAME = "quantalyze.analytics.csv_fault"
logger = logging.getLogger(_LOGGER_NAME)
ignore_logger(_LOGGER_NAME)

#: analytics-service root; a frame under it is shown relative to it.
_SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _short_path(filename: str) -> str:
    """`services/csv_validator.py` for our own code, the last three path parts for
    anything else (a dependency's frame), so the line stays short and carries no
    home directory."""
    absolute = os.path.abspath(filename)
    if absolute.startswith(_SERVICE_ROOT + os.sep):
        return os.path.relpath(absolute, _SERVICE_ROOT)
    parts = absolute.split(os.sep)
    return "/".join(parts[-3:])


def describe_fault(exc: BaseException) -> str:
    """`<Type> at <file>:<line> in <function>` for the INNERMOST frame of `exc`,
    or just `<Type>` when it carries no traceback. Never reads the exception text."""
    name = type(exc).__name__
    try:
        frames = traceback.extract_tb(exc.__traceback__)
    except Exception:  # defensive: a hostile __traceback__ must not lose the log line
        return name
    if not frames:
        return name
    last = frames[-1]
    return f"{name} at {_short_path(last.filename)}:{last.lineno} in {last.name}"


def _withhold_cells(event: Any, hint: Any) -> Any:
    """Scope event processor: drop everything a cell could ride in. See the module
    docstring for why each part goes. Never raises."""
    try:
        exception = event.get("exception")
        if isinstance(exception, dict):
            for value in exception.get("values") or []:
                if not isinstance(value, dict):
                    continue
                value["value"] = value.get("type") or "exception"
                stacktrace = value.get("stacktrace")
                if isinstance(stacktrace, dict):
                    for frame in stacktrace.get("frames") or []:
                        if isinstance(frame, dict):
                            frame.pop("vars", None)
        request = event.get("request")
        if isinstance(request, dict):
            request.pop("data", None)
    except Exception:  # pragma: no cover - defensive; the event is still sent
        pass
    return event


def report_csv_internal_fault(exc: BaseException, *, source: str = "csv-validator") -> str:
    """Log and capture an internal fault; returns the log fragment.

    `source` is the bracketed prefix of the log line (`csv-validator`,
    `csv-adapter`). Safe to call from an `except` arm: nothing in here raises, so
    it can never turn a handled fault into a second one.
    """
    where = describe_fault(exc)
    logger.error("[%s] unexpected error: %s", source, where)
    try:
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("csv_fault", source)
            scope.add_event_processor(_withhold_cells)
            sentry_sdk.capture_exception(exc)
    except Exception:  # pragma: no cover - a Sentry failure must not cost the response
        pass
    return where
