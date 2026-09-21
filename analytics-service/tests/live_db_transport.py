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
import threading
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
    "reset_retry_stats",
    "retry_stats",
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

# THE IDEMPOTENCY BOUNDARY (dated 2026-09-21, Phase 164.9 plan 05 review).
#
# A bounded retry is only safe over a call the server can execute twice with the
# same observable result. A 504 on a WRITE is exactly the case where that does not
# hold: the gateway timed out on the RESPONSE, so the INSERT may already have
# COMMITTED. Retrying it then either double-writes, or surfaces a 23505 that
# `is_transient_transport_fault` correctly classifies as NOT transient and
# hard-fails — manufacturing the very flake this module exists to absorb.
#
# ⛔ The fix is NEVER to reclassify 23505 (or any SQLSTATE) as transient: that
# would hide a double-write behind a green run. The fix is to NOT RETRY the call
# at all. So the retry applies ONLY to a chain that passed through no mutating
# builder method; a chain that did is executed exactly once and its transport
# fault propagates unretried, to be diagnosed rather than replayed.
#
# `rpc` is on this list deliberately, even though some RPCs are read-only: this
# module cannot see a function's body, and the measured victim
# (`test_compute_jobs_fencing.py`) drives claim/mark RPCs whose whole point is a
# once-only side effect. Fail-closed — an unretried RPC is a visible red, a
# replayed claim is a corrupted fence.
_NON_IDEMPOTENT_BUILDER_METHODS = frozenset(
    {"insert", "upsert", "update", "delete", "rpc"}
)


# WHY A COUNTER AND NOT JUST THE WARNING (dated 2026-09-21, Phase 164.9 plan 05
# review). The WARNING below is CAPTURED by pytest and rendered only in the report
# of a FAILING test. On the one run where it matters — a shared-TEST transport
# fault absorbed by attempt 2, the suite then GREEN — it prints nothing at all, and
# the degrading gateway this module exists to keep visible is laundered into a slow
# pass. Asserting through `caplog` proves the RECORD IS CREATED; it does not prove
# anyone ever SEES it, and those are different claims.
#
# So the retries are also counted here, and `tests/conftest.py` prints the total
# from `pytest_terminal_summary` UNCONDITIONALLY — a line that survives a green
# run. Narrower than switching `log_cli` on in `pytest.ini`, which would change the
# output of the whole suite for one module's benefit.
#
# A lock because `test_compute_jobs_fencing.py` drives the wrapped client from a
# ThreadPoolExecutor; xdist workers are separate PROCESSES, so cross-worker
# aggregation is conftest's job, not this lock's.
_RETRY_STATS_LOCK = threading.Lock()
_RETRY_STATS = {"retries": 0, "calls": 0}


def retry_stats() -> tuple[int, int]:
    """Return `(retries, calls)` for THIS process: the number of retry attempts
    made, and the number of `retry_transport` calls that needed at least one."""
    with _RETRY_STATS_LOCK:
        return (_RETRY_STATS["retries"], _RETRY_STATS["calls"])


def reset_retry_stats() -> None:
    """Zero the process-local counters. For tests of the counter itself."""
    with _RETRY_STATS_LOCK:
        _RETRY_STATS["retries"] = 0
        _RETRY_STATS["calls"] = 0


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
    retried = False
    for attempt in range(1, attempts + 1):
        try:
            result = fn()
        except Exception as exc:  # noqa: BLE001 — every exception must be classified
            if not is_transient_transport_fault(exc):
                raise
            last_exc = exc
            retried = True
            with _RETRY_STATS_LOCK:
                _RETRY_STATS["retries"] += 1
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
        else:
            if retried:
                with _RETRY_STATS_LOCK:
                    _RETRY_STATS["calls"] += 1
            return result
    with _RETRY_STATS_LOCK:
        _RETRY_STATS["calls"] += 1
    assert last_exc is not None  # every loop iteration above sets it before falling through
    raise TransportRetryExhausted(attempts=attempts, last_exc_type=type(last_exc)) from last_exc


class _RetryingClientProxy:
    """Transparent proxy over a live-DB client (or any chained builder object it
    returns). Every attribute access passes through to the wrapped target
    unmodified EXCEPT `.execute()`, whose terminal HTTP call goes through
    `retry_transport`. A callable attribute's return value is wrapped again so a
    chain like `client.table(...).select(...).eq(...).execute()` stays covered end
    to end without the call site needing to know about the proxy.

    SPECIAL-METHOD LOOKUP BYPASSES `__getattr__` (dated 2026-09-21, Phase 164.9
    plan 05 review). CPython resolves `len(p)`, `bool(p)`, `iter(p)`, `p[k]`,
    `p == q`, `repr(p)` and attribute ASSIGNMENT on the TYPE, never through
    `__getattr__`, so a proxy that defines only `__getattr__` does not forward
    them. Most of those fail loudly with a `TypeError`. `bool()` is the QUIET one:
    a class with neither `__bool__` nor `__len__` is ALWAYS TRUTHY, so a wrapped
    empty list would satisfy `if results:` and fail `if not results:` — a silent
    wrong answer, not an error. The dunders below are therefore delegated
    explicitly. `__iter__`/`__getitem__` hand back the TARGET's own objects
    unwrapped: past a terminal call those are data rows, not chainable builders,
    and re-wrapping them would be the surprising behaviour.

    ⚠️ MEASURED, not assumed: no live-DB fixture assigns through a proxy today.
    `test_compute_jobs_fencing.py`'s `admin` fixture does rebuild
    `client.postgrest.session`, but it does so on the RAW client and wraps
    afterwards, so the assignment never reaches `__setattr__`. `__setattr__` is
    delegated so that ordering stops being load-bearing.
    """

    __slots__ = ("_target", "_attempts", "_backoff_base", "_sleep", "_retry_safe")

    def __init__(
        self,
        target: object,
        *,
        attempts: int,
        backoff_base: float,
        sleep: Callable[[float], None],
        retry_safe: bool = True,
    ) -> None:
        object.__setattr__(self, "_target", target)
        object.__setattr__(self, "_attempts", attempts)
        object.__setattr__(self, "_backoff_base", backoff_base)
        object.__setattr__(self, "_sleep", sleep)
        object.__setattr__(self, "_retry_safe", retry_safe)

    def __getattr__(self, name: str):
        target = object.__getattribute__(self, "_target")
        attempts = object.__getattribute__(self, "_attempts")
        backoff_base = object.__getattribute__(self, "_backoff_base")
        sleep = object.__getattribute__(self, "_sleep")
        retry_safe = object.__getattribute__(self, "_retry_safe")
        attr = getattr(target, name)

        if name == "execute" and callable(attr):
            if not retry_safe:
                # The idempotency boundary above: this chain passed through a
                # mutating builder, so the terminal call runs EXACTLY ONCE and a
                # transport fault propagates unretried.
                return attr

            def _retrying_execute(*args, **kwargs):
                return retry_transport(
                    lambda: attr(*args, **kwargs),
                    attempts=attempts,
                    backoff_base=backoff_base,
                    sleep=sleep,
                )

            return _retrying_execute

        # A mutating builder method taints the REST of the chain, never the
        # chain that produced it: `client.table(t)` stays retry-safe, and only
        # the object returned by `.insert(...)` loses the retry.
        child_retry_safe = retry_safe and name not in _NON_IDEMPOTENT_BUILDER_METHODS

        if callable(attr):
            def _chained(*args, **kwargs):
                result = attr(*args, **kwargs)
                return _wrap(
                    result,
                    attempts=attempts,
                    backoff_base=backoff_base,
                    sleep=sleep,
                    retry_safe=child_retry_safe,
                )

            return _chained

        return _wrap(
            attr,
            attempts=attempts,
            backoff_base=backoff_base,
            sleep=sleep,
            retry_safe=child_retry_safe,
        )

    # ── delegated special methods (see the class docstring) ──────────────────

    def __setattr__(self, name: str, value: object) -> None:
        setattr(object.__getattribute__(self, "_target"), name, value)

    def __delattr__(self, name: str) -> None:
        delattr(object.__getattribute__(self, "_target"), name)

    def __repr__(self) -> str:
        return repr(object.__getattribute__(self, "_target"))

    def __bool__(self) -> bool:
        return bool(object.__getattribute__(self, "_target"))

    def __len__(self) -> int:
        return len(object.__getattribute__(self, "_target"))  # type: ignore[arg-type]

    def __iter__(self):
        return iter(object.__getattribute__(self, "_target"))  # type: ignore[call-overload]

    def __contains__(self, item: object) -> bool:
        return item in object.__getattribute__(self, "_target")  # type: ignore[operator]

    def __getitem__(self, key: object):
        return object.__getattribute__(self, "_target")[key]  # type: ignore[index]

    def __eq__(self, other: object) -> bool:
        return object.__getattribute__(self, "_target") == _unwrap(other)

    def __ne__(self, other: object) -> bool:
        return object.__getattribute__(self, "_target") != _unwrap(other)

    def __hash__(self) -> int:
        return hash(object.__getattribute__(self, "_target"))


def _unwrap(obj: object) -> object:
    """Return the target behind a proxy, or `obj` itself. Keeps `proxy == proxy`
    comparing the two TARGETS rather than a proxy against a proxy."""
    if isinstance(obj, _RetryingClientProxy):
        return object.__getattribute__(obj, "_target")
    return obj


def _wrap(
    obj: object,
    *,
    attempts: int,
    backoff_base: float,
    sleep: Callable[[float], None],
    retry_safe: bool = True,
):
    if obj is None or isinstance(obj, (str, bytes, int, float, bool)):
        return obj
    return _RetryingClientProxy(
        obj,
        attempts=attempts,
        backoff_base=backoff_base,
        sleep=sleep,
        retry_safe=retry_safe,
    )


def wrap_live_db_client(
    client: object,
    *,
    attempts: int = RETRY_ATTEMPTS,
    backoff_base: float = RETRY_BACKOFF_BASE_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
):
    """Given a live-DB client (e.g. a `supabase.create_client(...)` result), return
    a transparent proxy whose terminal `.execute()` calls retry transient
    transport faults. `.table()`, `.select()`, `.eq()`, and every other chained
    builder are passed through unmodified — this is a transport shim, not a
    façade.

    ⚠️ The retry stops at the idempotency boundary: a chain that passed through
    `insert`/`upsert`/`update`/`delete`/`rpc` (see
    `_NON_IDEMPOTENT_BUILDER_METHODS`) executes EXACTLY ONCE and propagates a
    transport fault unretried, because a 504 on a write may name a request that
    already committed.
    """
    return _wrap(client, attempts=attempts, backoff_base=backoff_base, sleep=sleep)
