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

from services.db import db_execute, get_supabase
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
    poll_s: float, renew_s: float, ttl_s: float, rpc_timeout_s: float
) -> None:
    """Refuse contradictory timing constants at import, naming the broken
    inequality. Modelled on ``main_worker._validate_claim_renew_interval``.

    ``0 < poll < renew < ttl``: a poll slower than a renew, or a renew at or past the
    TTL, lets a healthy holder expire between two renewals. ``rpc_timeout < renew``:
    a renew that can outlast its own interval stacks. ``ttl >= 2 * renew +
    rpc_timeout``: the holder survives one missed renew plus one slow call before the
    row can expire, and the self-fence (``ttl - renew``) fires while the lease is
    still ours."""
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

_validate_xlease_timing(
    _MT5_XLEASE_POLL_S,
    _MT5_XLEASE_RENEW_INTERVAL_S,
    _MT5_XLEASE_TTL_S,
    _MT5_XLEASE_RPC_TIMEOUT_S,
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
        return bool(result.data is True)

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
    ) -> None:
        self._backend = backend
        self._digest = digest
        self._token = token
        self._renew_task: asyncio.Task[None] | None = None

    def stop_renewing(self) -> None:
        """Cancel the renew task. Synchronous on purpose: it is called first in the
        lease's ``finally``, where an ``await`` could be cancelled."""
        task = self._renew_task
        if task is not None and not task.done():
            task.cancel()

    async def release(self) -> None:
        """Release the row. NEVER raises ``Exception``; ``CancelledError`` passes
        through and the shielded RPC still lands."""
        self.stop_renewing()
        fut: asyncio.Future[bool] = asyncio.ensure_future(
            self._backend.release(self._digest, self._token)
        )
        fut.add_done_callback(_consume_future)
        try:
            await asyncio.wait_for(asyncio.shield(fut), _MT5_XLEASE_RPC_TIMEOUT_S)
        except Exception as exc:  # noqa: BLE001 — a release failure must not mask the body
            logger.warning(
                "mt5_xlease: the lease release failed (exc_class=%s); the row "
                "expires on its own TTL",
                type(exc).__name__,
                extra={"event_type": "mt5_xlease_release_failed"},
            )


def _consume_future(fut: asyncio.Future[Any]) -> None:
    """Retrieve a finished future's outcome so asyncio never logs "exception was
    never retrieved" for an RPC nobody is waiting on any more."""
    if not fut.cancelled():
        fut.exception()


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
    raises ``XLeaseBoundExpired``; ``bound_s <= 0`` makes exactly one attempt. A
    backend exception raises ``XLeaseUnavailable`` (fail closed: the caller never
    proceeds unserialized). ``on_lost`` is called by the renew task if the lease is
    lost while held (the self-fence)."""
    backend = _BACKEND
    digest = terminal_lease_digest(terminal_key)
    token = uuid.uuid4()
    holder_n = normalize_mt5_holder(holder)
    site_n = normalize_mt5_site(site)
    ttl_s = int(_MT5_XLEASE_TTL_S)
    started = time.monotonic()
    deadline = None if bound_s is None else started + max(0.0, bound_s)

    while True:
        remaining = None if deadline is None else deadline - time.monotonic()
        rpc_bound = _MT5_XLEASE_RPC_TIMEOUT_S
        if remaining is not None:
            rpc_bound = min(rpc_bound, max(remaining, _MT5_XLEASE_MIN_ATTEMPT_S))
        try:
            granted = await asyncio.wait_for(
                backend.acquire(digest, token, holder_n, site_n, ttl_s), rpc_bound
            )
        except Exception:  # noqa: BLE001 — any backend failure fails closed
            raise XLeaseUnavailable() from None
        if granted:
            return XLeaseHold(backend=backend, digest=digest, token=token)
        remaining = None if deadline is None else deadline - time.monotonic()
        if remaining is not None and remaining <= 0.0:
            raise XLeaseBoundExpired() from None
        sleep_s = _MT5_XLEASE_POLL_S + random.uniform(0.0, _MT5_XLEASE_POLL_JITTER_S)
        if remaining is not None:
            sleep_s = min(sleep_s, remaining)
        await asyncio.sleep(sleep_s)
