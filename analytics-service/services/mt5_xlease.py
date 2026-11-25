"""The cross-process half of the ONE MT5 terminal lease (Phase 230 MT5NIGHTLY, MT5D-02).

WHY THIS EXISTS. ``services.mt5_concurrency._MT5_TERMINAL_LOCKS`` is an
``asyncio.Lock`` per process, so it serializes the shared Wine terminal only inside
one Railway service. The backfill worker's nightly derive (00:40Z) and the API
process's holdings poll (01:00Z) are two processes that log the ONE terminal into
different accounts at the same time; the derive's MT5CONC-02 login bracket then
refuses the read and the job is retried (230-DISCUSSION-LOG R-1 to R-3). Founder
decision D-01 (2026-11-25): one lease row per terminal in the database, "taken by
every MT5 terminal user: derive, holdings poll, balance sync, key validation".

This module is the client of that row. ``mt5_terminal_lease`` takes it AFTER its
in-process lock and BEFORE its body runs, so every production site already holds it
and no second lock registry or second lease helper exists. The row is the SQL half,
``supabase/migrations/20261126120000_mt5_terminal_lease.sql`` (plan 01): three
``SECURITY DEFINER`` RPCs, ``acquire_mt5_terminal_lease``,
``renew_mt5_terminal_lease`` and ``release_mt5_terminal_lease``, each returning
``boolean``. Free means the owner token is NULL or expired on the DATABASE clock; a
same-token acquire is idempotent; release clears the token; renew matches the token
regardless of expiry.

LEAF RULE. This module may import only ``services.db`` and ``services.mt5_handover``,
never ``services.job_worker``, ``main_worker`` or ``services.mt5_concurrency``
(``mt5_concurrency`` imports THIS module; the reverse would be a cycle). It therefore
raises its own plain exceptions, ``XLeaseBoundExpired`` and ``XLeaseUnavailable``,
which ``mt5_terminal_lease`` translates, and it never imports the epoch registry: the
self-fence is a callback (DEC-02-C).

DECISIONS (plan 230-02):
  * DEC-02-A. The database release runs INSIDE the local hold, in a nested
    try/finally in ``mt5_terminal_lease``, before ``lock.release()``. An in-process
    successor therefore never meets its own predecessor's row, which keeps the
    ``mt5_xlease_waited`` event a clean CROSS-PROCESS signal (the seven nights count
    it). Cancellation cannot strand the local lock: the nested ``finally`` still
    releases it.
  * DEC-02-B. Leaf with its own exceptions (above).
  * DEC-02-C. The self-fence is the ``on_lost`` callback.
  * DEC-02-D. The digest is ``sha256("mt5-terminal-lease/v1\\x00" + key.strip().lower())``.
    Lower-casing applies to the digest only, never to the in-process registry key.
  * DEC-02-E. Plain ``Final`` timing constants, no env override (the 227 pattern),
    validated at import by ``_validate_xlease_timing``.

REDACTION. Nothing this module writes to the database, logs or raises carries the raw
terminal key, a host, a port, a login or a server name. The row holds the digest, the
normalized holder and the normalized site. Exceptions carry fixed text; log lines
carry the exception CLASS NAME only.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import random
import time
import uuid
from collections.abc import Callable
from typing import Any, Final, Protocol

from services.db import db_execute, get_supabase, is_missing_rpc
from services.mt5_handover import normalize_mt5_holder, normalize_mt5_site

__all__ = [
    "XLEASE_ACQUIRE_RPC",
    "XLEASE_RELEASE_RPC",
    "XLEASE_RENEW_RPC",
    "XLeaseBackend",
    "XLeaseBoundExpired",
    "XLeaseHold",
    "XLeaseUnavailable",
    "acquire_terminal_xlease",
    "set_xlease_backend_for_tests",
    "terminal_lease_digest",
]

logger = logging.getLogger("quantalyze.analytics.mt5_xlease")


# --------------------------------------------------------------------------- #
# DEC-02-E — timing. Plain constants; no env override (the 227 pattern).
# --------------------------------------------------------------------------- #
def _validate_xlease_timing(
    poll_s: float,
    renew_s: float,
    ttl_s: float,
    rpc_timeout_s: float,
    error_budget_s: float,
) -> None:
    """Refuse contradictory timing constants at import, naming the broken
    inequality. Modelled on ``main_worker._validate_claim_renew_interval``.

    ``0 < poll < renew < ttl``: a poll slower than a renew, or a renew at or past the
    TTL, lets a healthy holder expire between two renewals. ``rpc_timeout < renew``:
    a renew that can outlast its own interval stacks. ``ttl >= 2 * renew +
    rpc_timeout``: the holder survives one missed renew plus one slow call before the
    row can expire, and the self-fence (``ttl - renew``) fires while the lease is
    still ours. ``rpc_timeout < error_budget``: one slow call must not by itself spend
    the budget an unbounded caller is allowed (DEC-04-C)."""
    if not 0.0 < poll_s < renew_s:
        raise ValueError(
            f"_MT5_XLEASE_POLL_S must be in (0, renew interval {renew_s}); got "
            f"{poll_s} - a poll at or above the renew interval is not a poll"
        )
    if not renew_s < ttl_s:
        raise ValueError(
            f"_MT5_XLEASE_RENEW_INTERVAL_S must be below _MT5_XLEASE_TTL_S "
            f"({ttl_s}); got {renew_s} - a renew at or past the TTL lets the row "
            f"expire between two renewals"
        )
    if not 0.0 < rpc_timeout_s < renew_s:
        raise ValueError(
            f"_MT5_XLEASE_RPC_TIMEOUT_S must be in (0, renew interval {renew_s}); "
            f"got {rpc_timeout_s} - a renew call that can outlast its interval "
            f"stacks"
        )
    if ttl_s < 2.0 * renew_s + rpc_timeout_s:
        raise ValueError(
            f"_MT5_XLEASE_TTL_S must be at least 2 * renew interval + rpc timeout "
            f"({2.0 * renew_s + rpc_timeout_s}); got {ttl_s} - one missed renew "
            f"plus one slow call would expire a live holder"
        )
    if not rpc_timeout_s < error_budget_s:
        raise ValueError(
            f"_MT5_XLEASE_ERROR_BUDGET_S must exceed _MT5_XLEASE_RPC_TIMEOUT_S "
            f"({rpc_timeout_s}); got {error_budget_s} - one slow call would spend the "
            f"whole error budget"
        )


_MT5_XLEASE_TTL_S: Final[float] = 90.0
_MT5_XLEASE_RENEW_INTERVAL_S: Final[float] = 20.0
#: Applied to EVERY lease RPC. The PostgREST session timeout is 120 s, so an
#: unbounded call would hold a pool thread for two minutes.
_MT5_XLEASE_RPC_TIMEOUT_S: Final[float] = 15.0
_MT5_XLEASE_POLL_S: Final[float] = 0.5
_MT5_XLEASE_POLL_JITTER_S: Final[float] = 0.25
#: The self-fence: no successful renew for this long means the lease is lost. Derived,
#: never hand-picked, so it stays under the TTL by exactly one renew interval.
_MT5_XLEASE_LOST_AFTER_S: Final[float] = (
    _MT5_XLEASE_TTL_S - _MT5_XLEASE_RENEW_INTERVAL_S
)
#: The least a single acquire RPC is given when the caller's remaining bound is
#: nearly spent. Without it a bounded caller whose local wait used the whole
#: ``wait_s`` would time out before the RPC future even started, turning a free
#: lease into "busy". It overshoots the caller's bound by at most this much, once.
_MT5_XLEASE_MIN_ATTEMPT_S: Final[float] = 0.5

#: DEC-04-C. How long an UNBOUNDED caller (a batch job) tolerates CONSECUTIVE backend
#: errors on the acquire before it raises ``XLeaseUnavailable``: a PostgREST blip must not
#: burn a derive attempt, the quantity the seven nights count. An answer from the
#: database, True or False, resets the window. A bounded caller ignores it and keeps
#: polling to its own deadline.
_MT5_XLEASE_ERROR_BUDGET_S: Final[float] = 60.0
#: Re-log the "lease RPC is missing" ERROR at most this often (the 227
#: ``_RENEW_UNAVAILABLE_RELOG_S`` cadence). Never latched: PGRST202 also fires on a
#: parameter-signature drift, so one line per process would hide a persistent fault
#: (DEC-04-B).
_MT5_XLEASE_UNAVAILABLE_RELOG_S: Final[float] = 900.0

_validate_xlease_timing(
    _MT5_XLEASE_POLL_S,
    _MT5_XLEASE_RENEW_INTERVAL_S,
    _MT5_XLEASE_TTL_S,
    _MT5_XLEASE_RPC_TIMEOUT_S,
    _MT5_XLEASE_ERROR_BUDGET_S,
)

XLEASE_ACQUIRE_RPC: Final[str] = "acquire_mt5_terminal_lease"
XLEASE_RENEW_RPC: Final[str] = "renew_mt5_terminal_lease"
XLEASE_RELEASE_RPC: Final[str] = "release_mt5_terminal_lease"

_DIGEST_PREFIX: Final[str] = "mt5-terminal-lease/v1\x00"


def terminal_lease_digest(terminal_key: str) -> str:
    """DEC-02-D — the lease row's key: 64 lower-case hex characters, never the key.

    Stripped and lower-cased so two spellings of one ``host:port`` (case, stray
    whitespace) collapse onto one row; the in-process registry key is NOT
    normalized, only this digest."""
    return hashlib.sha256(
        (_DIGEST_PREFIX + terminal_key.strip().lower()).encode("utf-8")
    ).hexdigest()


# --------------------------------------------------------------------------- #
# The backend seam.
# --------------------------------------------------------------------------- #
class XLeaseBackend(Protocol):
    """The three lease RPCs. ``True`` means the database said yes."""

    async def acquire(
        self, digest: str, token: uuid.UUID, holder: str, site: str, ttl_s: int
    ) -> bool: ...

    async def renew(self, digest: str, token: uuid.UUID, ttl_s: int) -> bool: ...

    async def release(self, digest: str, token: uuid.UUID) -> bool: ...


class _PostgrestXLeaseBackend:
    """The production backend: the three RPCs over PostgREST, through ``db_execute``.

    The client is resolved through the module-level name ``get_supabase`` AT CALL
    TIME unless one was passed in (plan 07's live test passes the lane client; the
    unit suite's conftest patches the module name so a test can never reach a real
    project through the lease)."""

    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    async def _call(self, rpc_name: str, params: dict[str, Any]) -> bool:
        client = self._client if self._client is not None else get_supabase()

        def _rpc() -> Any:
            return client.rpc(rpc_name, params).execute()

        result = await db_execute(_rpc)
        data = result.data
        if not isinstance(data, bool):
            # The three RPCs return `boolean`. Anything else (a NULL, a changed return
            # type) is a broken contract: reading it as False would poll forever as
            # "another process holds it" with nothing logged, so it raises and takes
            # the visible backend-error path. The fixed text carries no answer value.
            raise TypeError("the lease RPC answered something other than a boolean")
        return data

    async def acquire(
        self, digest: str, token: uuid.UUID, holder: str, site: str, ttl_s: int
    ) -> bool:
        return await self._call(
            XLEASE_ACQUIRE_RPC,
            {
                "p_terminal_digest": digest,
                "p_owner_token": str(token),
                "p_holder": holder,
                "p_site": site,
                "p_ttl_s": ttl_s,
            },
        )

    async def renew(self, digest: str, token: uuid.UUID, ttl_s: int) -> bool:
        return await self._call(
            XLEASE_RENEW_RPC,
            {
                "p_terminal_digest": digest,
                "p_owner_token": str(token),
                "p_ttl_s": ttl_s,
            },
        )

    async def release(self, digest: str, token: uuid.UUID) -> bool:
        return await self._call(
            XLEASE_RELEASE_RPC,
            {"p_terminal_digest": digest, "p_owner_token": str(token)},
        )


_BACKEND: XLeaseBackend = _PostgrestXLeaseBackend()


def set_xlease_backend_for_tests(backend: XLeaseBackend) -> XLeaseBackend:
    """Install ``backend`` and return the previous one (the caller restores it).

    Test-only. ``tests/conftest.py`` installs a granting default so no unit test can
    reach a real project; a test ABOUT the lease installs its own."""
    global _BACKEND
    previous = _BACKEND
    _BACKEND = backend
    return previous


# --------------------------------------------------------------------------- #
# Exceptions — fixed text, nothing in them.
# --------------------------------------------------------------------------- #
class XLeaseBoundExpired(Exception):
    """The bounded caller's deadline passed while another process held the terminal."""

    def __init__(self) -> None:
        super().__init__("the cross-process terminal lease was still held at the bound")


class XLeaseUnavailable(Exception):
    """The lease database could not be asked (or answered an error)."""

    def __init__(self) -> None:
        super().__init__("the cross-process terminal lease could not be reached")


# --------------------------------------------------------------------------- #
# Late grants (RESEARCH Pitfall 2, Pattern 2).
#
# `db_execute` runs the RPC on a thread. When a caller gives up (its bound expires, it
# is cancelled, or one call outlives `_MT5_XLEASE_RPC_TIMEOUT_S`) the thread keeps
# running and the acquire may COMMIT afterwards, leaving a row held by a token nobody
# owns for a full TTL. So every acquire call is a future that outlives its awaiter,
# and a future abandoned in flight gets a done-callback that releases the token if the
# call turns out to have been granted. Release is idempotent: a release that finds no
# row held by the token is a no-op.
# --------------------------------------------------------------------------- #
#: Strong references to the scheduled cleanup releases, so the loop cannot garbage
#: collect one mid-flight. Each task discards itself on completion.
_CLEANUP_TASKS: set[asyncio.Task[None]] = set()


async def _cleanup_release(backend: XLeaseBackend, digest: str, token: uuid.UUID) -> None:
    """Release a late grant. NEVER raises ``Exception``: it runs detached, and a
    raising detached task would reach ``main.lifespan``'s crash handler, which stops
    dispatch (the reason the handover recorder never raises either)."""
    try:
        await asyncio.wait_for(backend.release(digest, token), _MT5_XLEASE_RPC_TIMEOUT_S)
    except Exception as exc:  # noqa: BLE001 — the row expires on its own TTL
        logger.warning(
            "mt5_xlease: releasing a late-landing grant failed (exc_class=%s); the "
            "row expires on its own TTL",
            type(exc).__name__,
            extra={"event_type": "mt5_xlease_release_failed"},
        )


def _release_late_grants(
    pending: set[asyncio.Future[bool]],
    backend: XLeaseBackend,
    digest: str,
    token: uuid.UUID,
) -> None:
    """Attach the late-grant callback to every still-pending acquire future and empty
    the set. A future that already finished True fires its callback at once, which
    only costs one idempotent extra release."""
    futures = list(pending)
    pending.clear()
    for fut in futures:
        fut.add_done_callback(_late_grant_callback(backend, digest, token))


def _late_grant_callback(
    backend: XLeaseBackend, digest: str, token: uuid.UUID
) -> Callable[[asyncio.Future[bool]], None]:
    def _on_done(fut: asyncio.Future[bool]) -> None:
        # Check cancelled() first, then exception(): both consume the outcome so
        # asyncio never logs "exception was never retrieved" for a call nobody
        # awaits any more.
        if fut.cancelled() or fut.exception() is not None or fut.result() is not True:
            return
        task = fut.get_loop().create_task(_cleanup_release(backend, digest, token))
        _CLEANUP_TASKS.add(task)
        task.add_done_callback(_CLEANUP_TASKS.discard)

    return _on_done


# --------------------------------------------------------------------------- #
# The missing-RPC fallback (plan 230-04, DEC-04-A/B).
#
# A lease RPC that does not exist (the worker deployed before the migration applied, or
# after a rollback) must not turn into a night of refused MT5 work, so the caller falls
# back to the in-process lock ALONE. That is exactly today's pre-230 behaviour and the
# one path where two processes may share the terminal, so it is LOUD and NEVER LATCHED.
# Only the structured codes in ``services.db.is_missing_rpc`` take this path; every
# other backend error fails closed.
# --------------------------------------------------------------------------- #
#: Seam for the relog clock. Tests patch THIS, never ``time.monotonic``, because
#: asyncio's own scheduler reads ``time.monotonic``.
_relog_clock: Callable[[], float] = time.monotonic
#: ``_relog_clock()`` at the last "RPC missing" line, None before the first. One clock
#: for acquire, renew and release: they share one fault and one line.
_UNAVAILABLE_LAST_LOGGED: float | None = None


def _note_unavailable(rpc_name: str, site: str) -> None:
    """Log that a lease RPC is missing, at most once per relog window.

    ⭐ ``mt5_xlease_unavailable`` IS A CONTRACT. Plan 09 counts this event in BOTH
    services' logs each night, and a night that carries one does not count toward the
    seven (its terminal was serialized in-process only). Neither the event name nor its
    ``rpc`` and ``site`` keys may change without that plan. Carries the RPC name and the
    site only: never the exception text (a PostgREST message can echo a URL), a key, a
    host or a port.

    Never raises: it runs inside the renew task and the release path, where a raise
    would escape into ``main.lifespan``'s crash handler or mask the body's exception."""
    global _UNAVAILABLE_LAST_LOGGED
    now = _relog_clock()
    last = _UNAVAILABLE_LAST_LOGGED
    if last is not None and now - last < _MT5_XLEASE_UNAVAILABLE_RELOG_S:
        return
    _UNAVAILABLE_LAST_LOGGED = now
    logger.error(
        "mt5_xlease: the terminal lease RPC %s is missing from the database; this "
        "terminal is serialized in-process only until it exists (site=%s)",
        rpc_name,
        site,
        extra={"event_type": "mt5_xlease_unavailable", "rpc": rpc_name, "site": site},
    )


def _reset_xlease_state_for_tests() -> None:
    """Cancel and forget the cleanup tasks and the relog clock. Called from
    ``mt5_concurrency.reset_terminal_state_for_tests``. Never touches the installed
    backend, which ``tests/conftest.py`` owns. Safe after the test's loop closed: a
    task on a closed loop is only dropped, never cancelled."""
    for task in list(_CLEANUP_TASKS):
        try:
            if not task.done() and not task.get_loop().is_closed():
                task.cancel()
        except RuntimeError:
            pass
    _CLEANUP_TASKS.clear()
    global _UNAVAILABLE_LAST_LOGGED
    _UNAVAILABLE_LAST_LOGGED = None


# --------------------------------------------------------------------------- #
# The hold.
# --------------------------------------------------------------------------- #
class XLeaseHold:
    """One granted lease: the token and digest stay private to this object."""

    def __init__(
        self,
        *,
        backend: XLeaseBackend,
        digest: str,
        token: uuid.UUID,
        site: str,
        pending: set[asyncio.Future[bool]],
        on_lost: Callable[[], None],
        cross_process: bool = True,
    ) -> None:
        self._backend = backend
        self._digest = digest
        self._token = token
        self._site = site
        self._on_lost = on_lost
        self._lost = False
        #: Acquire calls that timed out client-side and may still land (Pitfall 2).
        self._pending = pending
        self._renew_task: asyncio.Task[None] | None = None
        #: False for the missing-RPC fallback (DEC-04-A): the caller holds the
        #: in-process lock only, so there is nothing to renew or release.
        self._cross_process = cross_process

    @property
    def cross_process(self) -> bool:
        """True when a database lease row backs this hold; False for the fallback."""
        return self._cross_process

    @property
    def lost(self) -> bool:
        """True once the renew task declared the lease lost (the self-fence ran)."""
        return self._lost

    def start_renewing(self) -> None:
        """Start the renew task on the running loop (called once, on grant)."""
        self._renew_task = asyncio.get_running_loop().create_task(self._renew_loop())

    async def _renew_loop(self) -> None:
        """Keep the row while the body runs; declare it lost when it cannot be kept.

        Each tick sleeps one renew interval, then renews under the RPC bound. A False
        answer (the database no longer recognises the token) or no SUCCESSFUL renew
        for ``_MT5_XLEASE_LOST_AFTER_S`` (``ttl - renew``, measured on the monotonic
        clock so it fires while the lease is still ours) is a loss: one ERROR line,
        the ``on_lost`` self-fence, and the loop ends.

        ⛔ A RAISING BACKGROUND TASK REACHES ``main.lifespan``'s crash handler, which
        stops dispatch behind a green ``/health`` (the reason the handover recorder
        never raises either). So the body is one ``try/except Exception`` that logs the
        exception CLASS only and keeps looping; ``CancelledError`` is not an
        ``Exception`` and passes through."""
        last_success = time.monotonic()
        while True:
            await asyncio.sleep(_MT5_XLEASE_RENEW_INTERVAL_S)
            try:
                renewed: bool | None = None
                try:
                    renewed = await asyncio.wait_for(
                        self._backend.renew(
                            self._digest, self._token, int(_MT5_XLEASE_TTL_S)
                        ),
                        _MT5_XLEASE_RPC_TIMEOUT_S,
                    )
                except Exception as exc:  # noqa: BLE001 — no success is counted
                    if is_missing_rpc(exc):
                        # The RPC went away (a rollback): the row went with it, so
                        # there is nothing to renew and nothing that was LOST. Stop
                        # renewing WITHOUT the self-fence; the holder keeps its
                        # in-process lock, as in the acquire fallback.
                        _note_unavailable(XLEASE_RENEW_RPC, self._site)
                        return
                    logger.warning(
                        "mt5_xlease: a lease renew failed (exc_class=%s); the "
                        "lease is lost if none succeeds within %.0fs",
                        type(exc).__name__,
                        _MT5_XLEASE_LOST_AFTER_S,
                        extra={"event_type": "mt5_xlease_renew_failed"},
                    )
                now = time.monotonic()
                if renewed is True:
                    last_success = now
                    continue
                if renewed is False or now - last_success >= _MT5_XLEASE_LOST_AFTER_S:
                    self._declare_lost()
                    return
            except Exception as exc:  # noqa: BLE001 — see the docstring
                try:
                    logger.warning(
                        "mt5_xlease: the renew loop hit an error (exc_class=%s)",
                        type(exc).__name__,
                    )
                except BaseException:  # noqa: BLE001 — never let the task raise
                    pass

    def _declare_lost(self) -> None:
        self._lost = True
        logger.error(
            "mt5_xlease: the terminal lease was lost while its holder was still "
            "running (site=%s); fencing the holder's session",
            self._site,
            extra={"event_type": "mt5_xlease_lost", "site": self._site},
        )
        try:
            self._on_lost()
        except Exception as exc:  # noqa: BLE001 — the loss is already recorded
            logger.error(
                "mt5_xlease: the self-fence callback failed (exc_class=%s)",
                type(exc).__name__,
            )

    def stop_renewing(self) -> None:
        """Cancel the renew task. Synchronous on purpose: it is called first in the
        lease's ``finally``, where an ``await`` could be cancelled."""
        task = self._renew_task
        if task is not None and not task.done():
            task.cancel()

    async def release(self) -> None:
        """Release the row. NEVER raises ``Exception``; ``CancelledError`` passes
        through and the shielded RPC still lands. The local-only fallback hold has no
        row, so it makes no call."""
        if not self._cross_process:
            return
        self.stop_renewing()
        fut: asyncio.Future[bool] = asyncio.ensure_future(
            self._backend.release(self._digest, self._token)
        )
        fut.add_done_callback(_consume_future)
        try:
            await asyncio.wait_for(asyncio.shield(fut), _MT5_XLEASE_RPC_TIMEOUT_S)
        except Exception as exc:  # noqa: BLE001 — a release failure must not mask the body
            if is_missing_rpc(exc):
                _note_unavailable(XLEASE_RELEASE_RPC, self._site)
            else:
                logger.warning(
                    "mt5_xlease: the lease release failed (exc_class=%s); the row "
                    "expires on its own TTL",
                    type(exc).__name__,
                    extra={"event_type": "mt5_xlease_release_failed"},
                )
        finally:
            # An acquire that timed out client-side may land AFTER this release and
            # re-take the row for this token; release it again when it does.
            _release_late_grants(self._pending, self._backend, self._digest, self._token)


def _consume_future(fut: asyncio.Future[Any]) -> None:
    """Retrieve a finished future's outcome so asyncio never logs "exception was
    never retrieved" for an RPC nobody is waiting on any more."""
    if not fut.cancelled():
        fut.exception()


def _log_gave_up(site: str, exc_class: str, started: float, attempts: int) -> None:
    """ERROR, once, when an acquire gives up on the database (SF-M3).

    ⭐ ``mt5_xlease_acquire_gave_up`` IS DISTINCT from the six other ``mt5_xlease_*``
    events on purpose (plan 09 counts ``mt5_xlease_unavailable`` and
    ``mt5_xlease_waited`` and a shared prefix match must not mix them in). The
    ``rpc_error`` WARNING is one line at the FIRST failure; this one says the lease gave
    up, after how long and how many tries, and on which failure class. Class name only:
    a PostgREST message can echo a URL."""
    duration_ms = int((time.monotonic() - started) * 1000)
    logger.error(
        "mt5_xlease: gave up acquiring the terminal lease after %d attempts "
        "(exc_class=%s site=%s duration_ms=%d); the lease database did not answer",
        attempts,
        exc_class,
        site,
        duration_ms,
        extra={
            "event_type": "mt5_xlease_acquire_gave_up",
            "rpc": XLEASE_ACQUIRE_RPC,
            "site": site,
            "exc_class": exc_class,
            "duration_ms": duration_ms,
            "attempts": attempts,
        },
    )


# --------------------------------------------------------------------------- #
# The acquire.
# --------------------------------------------------------------------------- #
async def acquire_terminal_xlease(
    terminal_key: str,
    *,
    holder: str | None,
    site: str | None,
    bound_s: float | None,
    on_lost: Callable[[], None],
) -> XLeaseHold:
    """Take the cross-process lease for ``terminal_key`` or raise.

    One ``uuid4`` token per acquisition, the SAME token on every poll, so a grant that
    landed after its caller gave up is idempotent for the retry and releasable by
    token. ``bound_s=None`` polls until granted; a float polls to its deadline and then
    raises ``XLeaseBoundExpired`` (or ``XLeaseUnavailable`` when the database never
    answered at all); ``bound_s <= 0`` makes exactly one attempt. A
    backend exception that is a MISSING RPC returns a local-only hold (``cross_process``
    False, logged by ``_note_unavailable``). Any other backend exception fails closed:
    an unbounded caller keeps polling for ``_MT5_XLEASE_ERROR_BUDGET_S`` of consecutive
    errors and then raises ``XLeaseUnavailable``; a bounded caller keeps polling to its
    deadline and gets ``XLeaseBoundExpired``, or ``XLeaseUnavailable`` if every attempt
    errored or timed out. Either way it never proceeds
    unserialized. ``on_lost`` is called by the renew task if the lease is
    lost while held (the self-fence)."""
    backend = _BACKEND
    digest = terminal_lease_digest(terminal_key)
    token = uuid.uuid4()
    holder_n = normalize_mt5_holder(holder)
    site_n = normalize_mt5_site(site)
    ttl_s = int(_MT5_XLEASE_TTL_S)
    started = time.monotonic()
    deadline = None if bound_s is None else started + max(0.0, bound_s)
    pending: set[asyncio.Future[bool]] = set()
    refusals = 0
    #: Start of the current run of consecutive backend errors; None while the database
    #: is answering. Only an unbounded caller is cut off by it (DEC-04-C).
    first_error_at: float | None = None
    error_logged = False
    attempts = 0
    #: True once the database has answered at all (True or False). A bounded caller that
    #: reaches its deadline with NO answer met an outage, not a busy terminal (SF-M1).
    answered = False
    last_failure = ""

    try:
        while True:
            remaining = None if deadline is None else deadline - time.monotonic()
            rpc_bound = _MT5_XLEASE_RPC_TIMEOUT_S
            if remaining is not None:
                rpc_bound = min(rpc_bound, max(remaining, _MT5_XLEASE_MIN_ATTEMPT_S))
            if pending:
                # CR-01: an earlier call outlived its RPC bound and is STILL in flight.
                # Wait on it again instead of starting another: a hung database would
                # otherwise get a new pool thread (up to 120 s each) every poll, and
                # `pending` would grow without limit. At most one call is ever pending.
                fut = next(iter(pending))
            else:
                # The call is a FUTURE that outlives this await: `asyncio.wait` neither
                # cancels it on a timeout nor when this task is cancelled, so the RPC's
                # outcome stays observable (Pitfall 2). It joins `pending` BEFORE the
                # await, so a cancellation mid-call is covered too.
                fut = asyncio.ensure_future(
                    backend.acquire(digest, token, holder_n, site_n, ttl_s)
                )
                fut.add_done_callback(_consume_future)
                pending.add(fut)
            done, _ = await asyncio.wait({fut}, timeout=rpc_bound)
            attempts += 1
            #: The exception class name when this wait ended with no answer.
            failure: str | None = None
            if fut in done:
                pending.discard(fut)
                try:
                    granted = fut.result()
                except Exception as exc:  # noqa: BLE001 — see below
                    if is_missing_rpc(exc):
                        # DEC-04-A: the RPC is not deployed. Loud, never latched
                        # (the next acquisition asks again).
                        _note_unavailable(XLEASE_ACQUIRE_RPC, site_n)
                        return XLeaseHold(
                            backend=backend,
                            digest=digest,
                            token=token,
                            site=site_n,
                            pending=pending,
                            on_lost=on_lost,
                            cross_process=False,
                        )
                    # Any OTHER backend failure fails closed, but a blip is tolerated
                    # for the budget (unbounded) or to the deadline (bounded): the
                    # caller never proceeds unserialized.
                    failure = type(exc).__name__
                else:
                    answered = True
                    first_error_at = None  # the database answered: the window restarts
                    if granted:
                        break
                    refusals += 1
            else:
                # The call outlived its RPC bound: no answer, so it counts toward the
                # error window exactly like a raised error (DEC-04-C) (CR-01).
                failure = "TimeoutError"
            if failure is not None:
                last_failure = failure
                error_now = time.monotonic()
                if first_error_at is None:
                    first_error_at = error_now
                if not error_logged:
                    error_logged = True
                    # Class name only: a PostgREST message can echo a URL.
                    logger.warning(
                        "mt5_xlease: the lease acquire RPC failed (exc_class=%s "
                        "site=%s); retrying",
                        failure,
                        site_n,
                        extra={
                            "event_type": "mt5_xlease_rpc_error",
                            "rpc": XLEASE_ACQUIRE_RPC,
                            "site": site_n,
                            "exc_class": failure,
                        },
                    )
                if (
                    bound_s is None
                    and error_now - first_error_at >= _MT5_XLEASE_ERROR_BUDGET_S
                ):
                    _log_gave_up(site_n, failure, started, attempts)
                    raise XLeaseUnavailable() from None
            remaining = None if deadline is None else deadline - time.monotonic()
            if remaining is not None and remaining <= 0.0:
                if not answered:
                    # Every attempt errored or timed out: the database never said the
                    # terminal was held, so this is an outage and not "busy" (SF-M1).
                    _log_gave_up(site_n, last_failure, started, attempts)
                    raise XLeaseUnavailable() from None
                raise XLeaseBoundExpired() from None
            if pending:
                continue  # the in-flight call is awaited next; no new poll to space out
            sleep_s = _MT5_XLEASE_POLL_S + random.uniform(0.0, _MT5_XLEASE_POLL_JITTER_S)
            if remaining is not None:
                sleep_s = min(sleep_s, remaining)
            await asyncio.sleep(sleep_s)
    except BaseException:
        # Abandoned (bound expiry, cancellation, an unreachable database): whatever is
        # still in flight must release itself if it is granted after all.
        _release_late_grants(pending, backend, digest, token)
        raise

    if refusals:
        # ⭐ `mt5_xlease_waited` IS A CONTRACT. Plan 09's seven nights count this event
        # as the positive signal that a cross-process collision happened and was
        # serialized, so neither its name nor its extra keys may change without that
        # plan. Counts and the site only: never the key, the host, the digest or the
        # holder.
        duration_ms = int((time.monotonic() - started) * 1000)
        logger.info(
            "mt5_xlease: waited for another process to release the terminal "
            "(site=%s duration_ms=%d)",
            site_n,
            duration_ms,
            extra={
                "event_type": "mt5_xlease_waited",
                "site": site_n,
                "duration_ms": duration_ms,
                "refusals": refusals,
            },
        )
    hold = XLeaseHold(
        backend=backend,
        digest=digest,
        token=token,
        site=site_n,
        pending=pending,
        on_lost=on_lost,
    )
    hold.start_renewing()
    return hold
