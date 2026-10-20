"""170.1 / T-170.1-51 (event-loop half): run CSV validation OFF the event loop.

`validate_csv` is synchronous and CPU-bound (pandas parsing, a per-cell date-zone
check), and its two callers, `routers/csv.py` and `CsvAdapter.validate`, are
`async def`. The service is one uvicorn process, so calling it directly stalled
every route for as long as the validation ran (measured worst shape: 58.8 s).
This helper is the one place both callers hand the work to a thread.

Why a dedicated ONE-worker executor rather than `asyncio.to_thread`:

  * `validate_csv` uses `warnings.catch_warnings()`, which saves and restores a
    PROCESS-WIDE filter list and is not thread-safe. Two overlapping validations
    can restore each other's stale snapshot and leave `ignore` installed for the
    whole process. One worker serialises validations, so the only code in the
    process that can interleave with the filter swap is not another validation.
  * the default executor is shared with the exchange and match routes' blocking
    calls; a burst of slow uploads must not starve those.

The caller's context is copied into the worker (`contextvars.copy_context`, what
`asyncio.to_thread` does too), so Sentry's scopes, which live in contextvars,
follow the call. Exceptions propagate to the caller unchanged: the callers'
`except Exception` arms (`report_csv_internal_fault`, `from None`) are untouched
and still run on the loop thread.
"""
from __future__ import annotations

import asyncio
import contextvars
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="csv-validate")


async def run_csv_validation(
    validate: Callable[[bytes, str], dict[str, Any]], raw: bytes, fmt: str
) -> dict[str, Any]:
    """`validate(raw, fmt)` in the CSV worker thread, awaited without blocking the
    loop. `validate` is passed in (not imported here) so each caller keeps resolving
    `validate_csv` through its own module, as its tests patch it there."""
    context = contextvars.copy_context()
    return await asyncio.get_running_loop().run_in_executor(
        _EXECUTOR, context.run, validate, raw, fmt
    )
