"""Bounded retry at the live-DB transport boundary.

Phase 164.9 plan 05, `[164.9-SHARED-TEST-TRANSPORT-FLAKE]` (Python half). ROADMAP
criterion 11 asked for the shared-TEST flakiness to be MEASURED before a remedy was
prescribed. It now is: run `34763669052` at commit `e64b0811` on `main` (2026-09-13)
needed THREE attempts of the SAME job on IDENTICAL code to reach green — attempt 1
RED with `postgrest.exceptions.APIError` naming `504 Gateway Timeout` on
`tests/test_compute_jobs_fencing.py`, attempt 2 RED with a DIFFERENT signature on a
DIFFERENT test set — `httpx.ConnectError: [Errno 104] Connection reset by peer` on
`tests/test_drain_semantics.py` — attempt 3 GREEN. Non-deterministic victims across
attempts is the proof this is TRANSPORT, not logic. A live probe at the time showed
the shared PostgREST pool idle and responsive (three sub-second 200s), so this is
NOT the wedged-pool mechanism and must never be triaged as it — no task here
terminates a backend on shared infrastructure.

The remedy is NEVER a bare re-run: a re-run is what made attempt 3 go green and it
taught nothing. This module keeps a transient transport fault DISTINGUISHABLE from a
clean run (every retry logs a line) instead of laundering it into either a silent
pass or a reported code defect.

DATED CENSUS (2026-09-21, Phase 164.9 plan 05) — measured, not assumed. Every module
in analytics-service/tests/ that constructs a live-DB client against the shared TEST
Supabase project, its client-factory symbol, and its `admin` fixture's return
expression before this plan wrapped it:

  - tests/test_compute_jobs_fencing.py  — `_need_supabase()` + `admin` fixture.
    Rebuilds the PostgREST session with `http2=False` and a 60s timeout before
    returning `client` (see that file's `admin` fixture docstring for why).
  - tests/test_drain_semantics.py       — `_need_supabase()` + `admin` fixture.
    `return create_client(SUPABASE_URL, SUPABASE_KEY)`.
  - tests/test_compute_similarity_sql.py — `_need_supabase()` + `admin` fixture.
    `return create_client(SUPABASE_URL, SUPABASE_KEY)`.
  - tests/test_transition_rpc.py         — `_need_supabase()` + `admin` fixture.
    `return create_client(SUPABASE_URL, SUPABASE_KEY)`.

  All four share the same pair of env vars (SUPABASE_TEST_URL /
  SUPABASE_TEST_SERVICE_KEY) and the same `_need_supabase()` skip/hard-fail guard
  shape; `tests/conftest.py`'s `_DB_MODULE_SENTINELS` already groups all four onto
  one serialized xdist worker by content, not by a hard-coded file list.

  Exception types classified at this boundary (`is_transient_transport_fault`
  below), against the two measured signatures above plus the obvious siblings in
  the same family:

  TRANSIENT (retried):
    - `httpx.TransportError` and every subclass — `ConnectError` (the measured
      "Connection reset by peer" signature), `ReadTimeout`, `ConnectTimeout`,
      `RemoteProtocolError` (a documented sibling: `test_compute_jobs_fencing.py`'s
      `admin` fixture already works around an HTTP/2 GOAWAY surfacing as this),
      `PoolTimeout`, `NetworkError`, `ReadError`, `WriteError`, `WriteTimeout` — all
      network-level faults with no application response to reason about.
    - `httpx.HTTPStatusError` whose `response.status_code` is 502, 503, or 504 — an
      explicit upstream-gateway signal, for a caller that raises on status.
    - `postgrest.exceptions.APIError` whose `.code` casts to 502, 503, or 504. This
      is the measured signature: when PostgREST's own gateway returns a non-JSON
      504 body, `postgrest/_sync/request_builder.py`'s `generate_default_error_message`
      sets `code = r.status_code` (an int) rather than a Postgres SQLSTATE — that is
      the ONE case an `APIError` means "the transport failed", not "the database
      rejected the statement".

  NOT TRANSIENT (propagates on the first attempt, unretried):
    - `postgrest.exceptions.APIError` whose `.code` is a Postgres SQLSTATE (e.g.
      "23505" unique_violation, "23514" check_violation, "42501"
      insufficient_privilege, or a non-numeric SQLSTATE like "P0001") — an
      application-level rejection, not a transport fault. `int(sqlstate)` either
      lands outside {502, 503, 504} or raises `ValueError`/`TypeError`, and both
      outcomes classify as NOT transient — fail-closed, never fail-open.
    - `AssertionError` — a test's own assertion failure is never a transport
      symptom.
    - Any other exception type. An unrecognized exception is NOT retried by
      default (T-164.9-05-02: an over-broad classifier launders real defects into
      slow passes).

No new pip dependency: `httpx` and `postgrest` are already pinned transitive
dependencies of `supabase` in `analytics-service/requirements.txt` and are already
imported by the four factory modules above (or their siblings) — this module adds
no new package.
"""
from __future__ import annotations

import logging
import time
from typing import Callable, TypeVar

import httpx
from postgrest.exceptions import APIError

logger = logging.getLogger(__name__)

T = TypeVar("T")

__all__ = [
    "RETRY_ATTEMPTS",
    "RETRY_BACKOFF_BASE_SECONDS",
    "TransportRetryExhausted",
    "is_transient_transport_fault",
    "retry_transport",
    "wrap_live_db_client",
]


# RETRY_ATTEMPTS=3 (dated 2026-09-21, Phase 164.9 plan 05): ROADMAP criterion 11's
# own measurement needed exactly 3 attempts of run `34763669052` — RED, RED (a
# DIFFERENT signature), GREEN — to reach a clean run on identical code. A budget of
# 3 in-process attempts covers that observed worst case with no headroom removed;
# it is not a round number picked without evidence.
RETRY_ATTEMPTS = 3

# RETRY_BACKOFF_BASE_SECONDS=0.5 (dated 2026-09-21, Phase 164.9 plan 05): small
# enough that a retried-but-recovering suite loses well under a second, non-zero so
# consecutive attempts do not hammer an already-degraded shared gateway (DoS
# disposition, T-164.9-05-03: "No task terminates a backend on shared
# infrastructure" applies equally to hammering one with retries). Multiplied by the
# attempt number in `retry_transport` below so the backoff is non-decreasing
# (Behaviour 5).
RETRY_BACKOFF_BASE_SECONDS = 0.5

# The gateway-level HTTP status codes a PostgREST or httpx transport can surface
# for an upstream fault rather than an application response. 504 is the measured
# signature; 502/503 are the obvious siblings in the same family (Bad Gateway /
# Service Unavailable).
_TRANSIENT_GATEWAY_STATUS_CODES = frozenset({502, 503, 504})


class TransportRetryExhausted(RuntimeError):
    """Raised when a bounded retry over a live-DB transport call exhausts its
    budget without success.

    T-164.9-05-01 (Information Disclosure): the message names ONLY the exception
    TYPE and the attempt count — never the original exception's message body, a
    host, a DSN, or anything connection-string shaped. The original exception is
    chained via `from` for local debugging (a traceback, not a rendered string),
    never re-interpolated into this message.
    """

    def __init__(self, *, attempts: int, last_exc_type: type[BaseException]) -> None:
        self.attempts = attempts
        self.last_exc_type = last_exc_type
        super().__init__(
            f"live-DB transport retry exhausted after {attempts} attempt(s); "
            f"last exception type: {last_exc_type.__name__}"
        )


def is_transient_transport_fault(exc: BaseException) -> bool:
    """Classify `exc` as a transient TRANSPORT fault crossing the httpx/PostgREST
    boundary to the shared TEST project — never a database-level rejection, a test
    assertion, or an unrecognized exception type. See the module census above for
    the evidence behind each branch.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _TRANSIENT_GATEWAY_STATUS_CODES
    if isinstance(exc, httpx.TransportError):
        return True
    if isinstance(exc, APIError):
        try:
            code = int(exc.code)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return False
        return code in _TRANSIENT_GATEWAY_STATUS_CODES
    return False


def retry_transport(
    fn: Callable[[], T],
    *,
    attempts: int = RETRY_ATTEMPTS,
    backoff_base: float = RETRY_BACKOFF_BASE_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> T:
    """Call `fn()` up to `attempts` times, retrying ONLY a transient transport
    fault (`is_transient_transport_fault`). A non-transient exception propagates on
    the first attempt, unretried. Every retry logs a WARNING naming the attempt
    number, the budget, and the exception TYPE — a run that retried is
    DISTINGUISHABLE from one that did not (T-164.9-05-05: a silent retry hides a
    degrading transport).

    Raises `TransportRetryExhausted` if the budget runs out without a success.
    """
    if attempts < 1:
        raise ValueError(f"attempts must be >= 1, got {attempts}")
    last_exc: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 — every exception must be classified
            if not is_transient_transport_fault(exc):
                raise
            last_exc = exc
            # T-164.9-05-05: this line, not the module name in the record, is what
            # makes a retried run distinguishable — the logger's own %(name)s
            # already carries module identity, so this string is deliberately
            # NOT prefixed with the module name (it would collide with the
            # Task 2 factory-coverage scan's "which module imports the helper"
            # substring match over this very file).
            logger.warning(
                "retry attempt %d/%d after %s",
                attempt,
                attempts,
                type(exc).__name__,
            )
            if attempt < attempts:
                sleep(backoff_base * attempt)
    assert last_exc is not None  # every loop iteration above sets it before falling through
    raise TransportRetryExhausted(attempts=attempts, last_exc_type=type(last_exc)) from last_exc


class _RetryingClientProxy:
    """Transparent proxy over a live-DB client (or any chained builder object it
    returns). Every attribute access passes through to the wrapped target
    unmodified EXCEPT `.execute()`, whose terminal HTTP call goes through
    `retry_transport`. A callable attribute's return value is wrapped again so a
    chain like `client.table(...).select(...).eq(...).execute()` stays covered end
    to end without the call site needing to know about the proxy.
    """

    __slots__ = ("_target", "_attempts", "_backoff_base", "_sleep")

    def __init__(
        self,
        target: object,
        *,
        attempts: int,
        backoff_base: float,
        sleep: Callable[[float], None],
    ) -> None:
        object.__setattr__(self, "_target", target)
        object.__setattr__(self, "_attempts", attempts)
        object.__setattr__(self, "_backoff_base", backoff_base)
        object.__setattr__(self, "_sleep", sleep)

    def __getattr__(self, name: str):
        target = object.__getattribute__(self, "_target")
        attempts = object.__getattribute__(self, "_attempts")
        backoff_base = object.__getattribute__(self, "_backoff_base")
        sleep = object.__getattribute__(self, "_sleep")
        attr = getattr(target, name)

        if name == "execute" and callable(attr):
            def _retrying_execute(*args, **kwargs):
                return retry_transport(
                    lambda: attr(*args, **kwargs),
                    attempts=attempts,
                    backoff_base=backoff_base,
                    sleep=sleep,
                )

            return _retrying_execute

        if callable(attr):
            def _chained(*args, **kwargs):
                result = attr(*args, **kwargs)
                return _wrap(result, attempts=attempts, backoff_base=backoff_base, sleep=sleep)

            return _chained

        return _wrap(attr, attempts=attempts, backoff_base=backoff_base, sleep=sleep)


def _wrap(
    obj: object,
    *,
    attempts: int,
    backoff_base: float,
    sleep: Callable[[float], None],
):
    if obj is None or isinstance(obj, (str, bytes, int, float, bool)):
        return obj
    return _RetryingClientProxy(obj, attempts=attempts, backoff_base=backoff_base, sleep=sleep)


def wrap_live_db_client(
    client: object,
    *,
    attempts: int = RETRY_ATTEMPTS,
    backoff_base: float = RETRY_BACKOFF_BASE_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
):
    """Given a live-DB client (e.g. a `supabase.create_client(...)` result), return
    a transparent proxy whose terminal `.execute()` calls retry transient
    transport faults. `.table()`, `.select()`, `.rpc()`, `.eq()`, and every other
    chained builder are passed through unmodified — this is a transport shim, not
    a façade.
    """
    return _wrap(client, attempts=attempts, backoff_base=backoff_base, sleep=sleep)
