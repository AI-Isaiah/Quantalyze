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
# v1 SCOPE — a DOCUMENTED gap, not silently assumed: an asyncio.Lock is
# SINGLE-EVENT-LOOP. It serializes the shared terminal only WITHIN one worker
# process's event loop. The sequential main_worker.py:606 dispatch loop runs jobs
# one-at-a-time in-process, so in-process interleave is structurally impossible;
# ACROSS worker replicas / the separate FastAPI validate process it does NOT
# serialize. Cross-process serialization of the ONE gateway is a DOCUMENTED v1 gap
# (v1 = one serialized terminal, one worker replica); the plan-02 login bracket
# (account_info().login == expected, asserted pre+post the read) is the cross-process
# safety net. The dispatch-epilogue aclose_exchange close also sits OUTSIDE this lock
# — safe under the sequential per-process loop (no terminal IPC contends with it).
_MT5_TERMINAL_LOCKS: dict[str, asyncio.Lock] = {}


def _mt5_terminal_lock_for(terminal_key: str) -> asyncio.Lock:
    # setdefault is atomic across coroutine resumption — there is no await between
    # the lookup and the insert, so within one event loop two simultaneous first-
    # callers for the same terminal cannot end up with two different Lock objects.
    # Single-event-loop safe (see the cross-process gap noted above).
    return _MT5_TERMINAL_LOCKS.setdefault(terminal_key, asyncio.Lock())


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
