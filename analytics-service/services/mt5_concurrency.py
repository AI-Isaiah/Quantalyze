"""Single source of truth for MT5 terminal-concurrency serialization.

Phase 151 (AUM-02) MOVED this machinery out of ``services.job_worker`` so that
EVERY job kind touching the ONE shared Wine terminal contends on the SAME lock
registry:

  * ``derive_broker_dailies`` — the deal-ledger read (``job_worker``);
  * ``sync_trades``'s mt5 balance arm (``job_worker._fetch_mt5_account_balance``);
  * the holdings / positions fetch (``services.allocator_positions``, Phase 151),
    which ``job_worker`` imports LAZILY precisely to avoid an import cycle — so
    the shared machinery cannot live in ``job_worker`` and be reachable from it.

⚠️ A SECOND ``dict[str, asyncio.Lock]`` terminal registry anywhere in the tree
SERIALIZES NOTHING (MT5CONC-02 / 151-RESEARCH Pitfall 2). Two registries mean two
distinct ``Lock`` objects per ``terminal_key``, so both job kinds enter the
terminal's IPC region concurrently and a holdings read can interleave with a
derive read against the same terminal. There must be exactly ONE registry — this
one. Import it; NEVER re-declare a terminal-lock dict elsewhere.

Leaf-module invariant (mirrors the ``closed_sets.py`` convention): this module
MUST NEVER import ``services.job_worker``, nor anything that does. Its only
in-tree import is one constant from ``services.mt5_client`` — itself a leaf over
``services.redact`` — so the derive read bound stays single-sourced from the rpyc
bound it is derived from instead of being re-hardcoded here.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Final

from services.mt5_client import MT5_REQUEST_TIMEOUT_S as _MT5_REQUEST_TIMEOUT_S

if TYPE_CHECKING:  # annotation only — deliberately NOT a runtime import
    from services.mt5_client import Mt5Client

logger = logging.getLogger("quantalyze.analytics.mt5_concurrency")


# MT5RECON-01 (Phase 136): the last-resort event-loop ceiling on the mt5 derive
# read block (login → account_info → history_deals_get, run OFF the loop via
# asyncio.to_thread). Each RPyC round-trip is already rpyc-bounded by
# MT5_REQUEST_TIMEOUT_S inside Mt5Client; this outer wait_for is the FLIPRETRY-01
# baseline so a hang OUTSIDE a bounded round-trip (netref materialization, a wedged
# Wine terminal) becomes a CLASSIFIED TRANSIENT at the bound, never an unbounded
# wedge of the SEQUENTIAL worker. Margin above one round-trip; deep hardening is
# delivered incrementally: restart-on-timeout landed in Phase 137 plan 01 (the
# _MT5_RESTART_TIMEOUT_S / _mt5_bounded_restart pair below + the TimeoutError-branch
# invocation), and the module-level per-terminal lock (_MT5_TERMINAL_LOCKS /
# _mt5_terminal_lock_for) + the account_info().login bracket (pre+post read) landed
# in plan 137-02 — both Phase-137 deltas now delivered. Derived
# from MT5_REQUEST_TIMEOUT_S (+10s margin) so a retuned rpyc bound carries through
# — mirrors ingestion/mt5.py:_MT5_PROBE_TIMEOUT_S so the derive and probe paths
# never diverge (WR-02).
_MT5_DERIVE_READ_TIMEOUT_S: Final[float] = float(
    os.getenv("MT5_DERIVE_READ_TIMEOUT_S", str(_MT5_REQUEST_TIMEOUT_S + 10.0))
)

# MT5CONC-01 (Phase 137 plan 01): the wall-clock ceiling on an ACTIVE terminal
# restart (bounded shutdown + re-connect) invoked on the derive read-timeout
# branch. The 10s magnitude mirrors exchange.py:_ACLOSE_TIMEOUT_S — a bounded
# teardown+rebuild is the same order as a bounded close. It MUST stay far under
# TIMEOUT_PER_KIND["derive_broker_dailies"] (15 min) so a hung restart can never
# itself push the job into the outer dispatch ceiling: the restart is best-effort
# recovery, and a restart that wedged is abandoned at this bound exactly like the
# hung read (never a nested wedge of the sequential worker).
_MT5_RESTART_TIMEOUT_S: Final[float] = float(
    os.getenv("MT5_RESTART_TIMEOUT_S", "10.0")
)

# D-29 (Phase 153.3, plan 04): the bound on ACQUIRING the terminal — which is a
# DIFFERENT thing from the bound on OPERATING it, and the distinction is the whole
# point of this constant. Every other ceiling in this module (and every wait_for at
# the three job call sites) sits INSIDE the lock: a queued caller's own timer starts
# only once it already holds the terminal, so its wait for the terminal is unbounded.
# An INTERACTIVE validation must be able to give up waiting for the terminal WITHOUT
# waiting for the terminal — a human is sitting in front of it and the client budget
# (D-26, 120 000 ms) is counting.
#
# ⚠️ It applies to the interactive validate path ONLY. The daily batch passes
# `wait_s=None` and keeps today's patient unbounded queueing: it has all day, it is
# sequential, and bounding it would convert serialization into batch FAILURE — a
# strictly worse outcome than waiting. This is why the three existing job call sites
# need no edit.
#
# ⛔ It is NOT an account cap. MT5 binds one account per terminal AT A TIME — a
# serialization constraint, not a capacity one — so ONE terminal cycles through
# hundreds of accounts across a day. Only concurrency is one; the number of MT5
# clients is not architecturally limited (D-29, REVISED 2026-08-08).
_MT5_LEASE_WAIT_S: Final[float] = float(os.getenv("MT5_LEASE_WAIT_S", "20.0"))

# Log a lease acquisition only when the caller actually had to QUEUE for a
# non-trivial time — an uncontended acquire is the normal case and logging it would
# bury the signal. Plan 153.3-05 turns this into the `stage` + `duration_ms` event
# that Phase 155 reads to set the real number (D-27 / D-32).
_MT5_LEASE_WAIT_LOG_THRESHOLD_S: Final[float] = 0.5


async def _mt5_bounded_restart(client: "Mt5Client") -> None:
    """MT5CONC-01 — ACTIVELY restart a wedged MT5 terminal, bounded so it can never
    itself nest-wedge the SEQUENTIAL worker.

    ``Mt5Client.restart()`` is blocking RPyC (like the read), so it runs OFF the
    event loop via ``to_thread`` and is capped by ``_MT5_RESTART_TIMEOUT_S`` (~10s,
    far under the 15-min dispatch ceiling). A hung restart is ABANDONED at the bound
    exactly like a hung read — the thread is never joined. Best-effort recovery: any
    failure (the ``wait_for`` firing, a transport raise) is logged and SWALLOWED so
    the restart can never mask or replace the caller's transient classification.
    Kept module-level (not nested in the branch) because plan 137-02 reuses it for
    the login-mismatch branch.
    """
    try:
        await asyncio.wait_for(
            asyncio.to_thread(client.restart), timeout=_MT5_RESTART_TIMEOUT_S
        )
    except (asyncio.TimeoutError, Exception):  # noqa: BLE001 — best-effort recovery
        logger.warning(
            "derive_broker_dailies: bounded mt5 terminal restart did not complete "
            "within its wall-clock bound — abandoning it; the transient retry will "
            "reconnect on the next attempt (MT5CONC-01)"
        )


# MT5CONC-02 (Phase 137 plan 02): module-level per-terminal asyncio.Lock registry,
# keyed by the process-wide terminal identity (host:port via Mt5Client.terminal_key),
# mirroring position_reconstruction.py:308-317. It MUST be module-level, NOT a
# Mt5Session attribute: _make_mt5_session builds a FRESH Mt5Session + Mt5Client per
# job, so a Session-attached lock would be a brand-new Lock object per job and
# serialize NOTHING (the Pitfall-1 anti-pattern). Keyed by terminal_key so every job
# hitting the ONE shared Wine terminal contends on the SAME Lock.
#
# Phase 151: this registry lives HERE, in a leaf module, and not in job_worker,
# because allocator_positions.py (the holdings job kind) is imported LAZILY by the
# job_worker handler to avoid an import cycle — it therefore cannot import the
# registry from job_worker, and a local copy would be a SECOND registry that
# serializes nothing (see the module docstring).
#
# The dict grows unboundedly BY DESIGN (same rationale as the reconstruct registry):
# evicting a Lock with waiters parked on it would silently break serialization, and
# terminal cardinality is bounded (v1 = ONE gateway terminal, O(1) keys).
#
# SCOPE — a DOCUMENTED gap, not silently assumed: an asyncio.Lock is
# SINGLE-EVENT-LOOP. It serializes the shared terminal only WITHIN one process's
# event loop.
#
# ⭐ CORRECTED 2026-08-09 (Phase 153.3 plan 04). This block used to say the lock
# does not serialize "the separate FastAPI validate process". That is stale: the
# worker loops run as background asyncio TASKS INSIDE the API process
# (main.py's lifespan — the dispatch/watchdog/enqueue loops), so the router and the
# worker share ONE event loop and this lock DOES serialize them against each other
# today. That is exactly what makes it correct for `routers/exchange.py` to take the
# same lease via `mt5_terminal_lease` below (D-29) rather than race the worker.
#
# ⛔ Do not read that as cross-process serialization. The honest remaining gap is
# REPLICAS: two gateway/API replicas each own their own event loop, their own
# registry and therefore their own Lock objects, and serialize NOTHING against each
# other. That is why D-33 pins the gateway to a SINGLE replica (recorded in
# docs/runbooks/mt5-go-live.md by plan 153.3-05) and why a scale-up is a correctness
# change, not a capacity knob. The plan-02 login bracket (account_info().login ==
# expected, asserted pre+post the read) remains the cross-replica safety net and is
# NOT weakened by the lease. The dispatch-epilogue aclose_exchange close also still
# sits OUTSIDE this lock — the residual D-35 closes in wave 6.
_MT5_TERMINAL_LOCKS: dict[str, asyncio.Lock] = {}


def _mt5_terminal_lock_for(terminal_key: str) -> asyncio.Lock:
    # setdefault is atomic across coroutine resumption — there is no await between
    # the lookup and the insert, so within one event loop two simultaneous first-
    # callers for the same terminal cannot end up with two different Lock objects.
    # Single-event-loop safe (see the cross-process gap noted above).
    return _MT5_TERMINAL_LOCKS.setdefault(terminal_key, asyncio.Lock())


class Mt5TerminalBusyError(Exception):
    """D-29 — the terminal was still held when the INTERACTIVE acquisition bound
    expired. We never touched it; nothing about the caller's credentials is known.

    Deliberately a PLAIN ``Exception``, NOT an ``Mt5ClientError`` subclass —
    the same discipline as ``_Mt5PostReadVerificationError`` below and for the same
    structural reason: the credential classify/stamp arms match on
    ``Mt5ClientError``, so a busy terminal that inherited from it could be absorbed
    into a USER-ATTRIBUTED verdict (``auth`` / ``wrong_server``) and blame a working
    key for our own queue. Plain ``Exception`` makes that structurally impossible.

    ⛔ It carries no host, port, terminal key, queue depth or account value. A busy
    terminal is OUR infrastructure, never the user's key, and nothing about it may
    reach a response body (WIZFORM-03).
    """


@asynccontextmanager
async def mt5_terminal_lease(
    terminal_key: str, *, wait_s: float | None = None
) -> AsyncIterator[None]:
    """D-29 — hold the ONE shared Wine terminal for the duration of the body.

    This is the SAME lease ``job_worker`` and ``allocator_positions`` already take;
    it is expressed as a helper only so the interactive validate path can bound its
    ACQUISITION. It is backed by ``_mt5_terminal_lock_for`` — the ONE registry.
    ⛔ It must never declare, copy or wrap a second ``dict[str, asyncio.Lock]``: two
    registries hand out two perfectly functional Lock objects per ``terminal_key``
    and serialize NOTHING (MT5CONC-02 / 151-RESEARCH Pitfall 2, and the module
    docstring above).

    ``wait_s=None`` (the default) → acquire with NO bound, i.e. byte-equivalent to
    today's ``async with _mt5_terminal_lock_for(key):``. That is the BATCH
    behaviour and it is why the three existing job call sites need no edit.

    ``wait_s`` a float → the acquisition is bounded and a caller that is still
    queued at the bound raises ``Mt5TerminalBusyError`` INSTEAD of waiting. That is
    the interactive behaviour (``_MT5_LEASE_WAIT_S``): a human validating a key must
    be able to give up waiting for the terminal without waiting for the terminal.

    ⚠️ Release discipline, both halves of it, because getting either wrong wedges
    the terminal for EVERY future caller:
      * the release is in a ``finally``, so an exception raised by the caller inside
        the body cannot strand the lock;
      * a timed-out acquisition releases NOTHING — it never held the lock, and
        releasing one it does not own would either raise ``RuntimeError`` or hand a
        second caller a lease over a live IPC region.
    Both are pinned by tests in ``tests/test_mt5_concurrency.py``.
    """
    lock = _mt5_terminal_lock_for(terminal_key)
    queued_at = time.monotonic()

    if wait_s is None:
        await lock.acquire()
    else:
        try:
            await asyncio.wait_for(lock.acquire(), timeout=wait_s)
        except asyncio.TimeoutError:
            # Names the bound only — never the terminal key, the host, the port or
            # the queue depth (T-153.3-20).
            logger.warning(
                "mt5_terminal_lease: gave up waiting for the terminal after %.1fs "
                "— the terminal is busy; refusing rather than queueing further "
                "(D-29)",
                wait_s,
            )
            raise Mt5TerminalBusyError(
                "the MT5 terminal was still in use when the acquisition bound expired"
            ) from None

    waited_s = time.monotonic() - queued_at
    try:
        if waited_s >= _MT5_LEASE_WAIT_LOG_THRESHOLD_S:
            # Queueing is REAL work and must be observable, or a slow validate looks
            # like a slow broker. Plan 153.3-05 promotes this to the structured
            # `stage` + `duration_ms` event.
            logger.info(
                "mt5_terminal_lease: waited %.2fs for the terminal before acquiring "
                "it (the terminal serializes; this is queueing, not broker latency)",
                waited_s,
            )
        yield
    finally:
        lock.release()


class _Mt5PostReadVerificationError(Exception):
    """IN-01 — a transient transport blip on the ASSERTION-ONLY POST login bracket.

    The POST bracket re-reads ``account_info()`` purely to re-assert the account
    AFTER the correct account's deals were already fetched successfully. A genuine
    network/terminal blip on that re-read surfaces as an ``Mt5ClientError``. Routing
    it through the shared ``except Mt5ClientError`` classify/stamp arm risks a
    PERMANENT user-attributed ``failed`` stamp (if ``classify_mt5_login_error``
    reads it as ``auth``/``wrong_server``) even though the economic read of the
    CORRECT account succeeded — a credential verdict for a mere verification gap.

    Deliberately a PLAIN ``Exception``, NOT an ``Mt5ClientError`` subclass, so the
    classify/stamp arm is structurally UNABLE to absorb it: it routes instead to a
    dedicated TRANSIENT (re-queue), no-stamp branch. It carries only the already-
    secret-scrubbed ``Mt5ClientError`` text.

    It does NOT weaken the trust guarantee: a genuine wrong-account POST read raises
    ``Mt5AccountMismatchError`` (a different type, raised by ``_assert_expected_login``
    OUTSIDE the wrapped ``account_info()`` call), which still routes to the
    mismatch arm — so ``api_verified`` can never be stamped on the wrong account.
    """
