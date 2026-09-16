"""Tests for analytics-service/services/mt5_concurrency.py (Phase 151, Plan 01).

Covers AUM-02 / MT5CONC-02: the MT5 terminal-lock registry was MOVED out of
``job_worker`` into a LEAF module so the holdings job kind
(``allocator_positions``, imported LAZILY by the job_worker handler to avoid an
import cycle) can contend on the SAME registry as the derive job kind. Four
required tests per the plan:

  1. test_registry_object_is_shared_across_modules   (the dict MOVED, not copied)
  2. test_lock_for_key_is_the_same_object            (per-key Lock identity)
  3. test_importing_leaf_does_not_import_job_worker  (leaf invariant)
  4. test_timeout_constants_survived_the_move        (FLIPRETRY-01 derivation)

Phase 153.3 plan 04 (D-29) adds ``mt5_terminal_lease`` to this module — the SAME
lease the three job call sites already take, expressed as a helper so the
INTERACTIVE validate path can bound its ACQUISITION separately from its operation.
Its cases live in the final section below. Their oracle is BLOCKING BEHAVIOUR, not
"a context manager entered": a lease nobody has watched block is worth nothing, so
every case observes ordering, elapsed time or a lock that is still held.

⚠️ The oracle for 1 and 2 is OBJECT IDENTITY (``is``), never "a lock was
acquired". 151-RESEARCH Pitfall 2: two independent registries each hand out a
perfectly functional ``asyncio.Lock``, so an acquire-succeeded assertion is green
under the exact defect these tests exist to catch — both job kinds would enter
the ONE shared Wine terminal's IPC region concurrently while every lock "worked".

Test 3 runs in a FRESH subprocess deliberately: asserting on ``sys.modules`` in
this process is meaningless because the test module itself imports
``job_worker`` for tests 1/2, so ``services.job_worker`` is already resident and
the assertion would pass for any import graph, including a cyclic one.

No network, no database, no MT5 terminal — pure import-graph and identity checks.
"""
from __future__ import annotations

import ast
import asyncio
import logging
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from services import job_worker as jw
from services import (
    mt5_client,
    mt5_concurrency,
    mt5_relogin,
    mt5_session_episodes,
    mt5_session_monitor,
)

# ⚠️ Imported from the module that OWNS them (`services.mt5_client`), never via a
# re-export. The 151 review-E2 trap: a name reached through a re-export is a
# DIFFERENT binding, so patching or asserting on it is a silent no-op.
from services.mt5_client import (
    _mt5_epoch_for,
    bump_mt5_terminal_epoch,
    mt5_terminal_key,
)

# ⛔ IMPORTED, NEVER COPIED (Phase 164.6.4 plan 05). These are the SHIPPED heal
# harness: the in-memory rpyc wire (`_install_client`), the lease WRAPPER that
# still runs the real lease (`_install_lease_counter`), the full env
# (`_set_full_env`), the `mt5_relogin` log filter (`_records`) and the PostgREST-
# shaped `cron_runs` double (`_FakeCronRuns`). A second copy here would drift
# from the one the heal's own suite exercises, and the criterion-4 test would
# then be measuring a harness rather than the shipped path. `tests.` imports are
# this suite's established idiom (a dozen modules already do it).
from tests.test_mt5_relogin import (  # noqa: PLC2701 — deliberate, see above
    _FAKE_HOST,
    _FAKE_PORT,
    _LOGGER_NAME as _RELOGIN_LOGGER_NAME,
    _FakeCronRuns,
    _install_client,
    _install_lease_counter,
    _records,
    _set_full_env,
)


@pytest.fixture(autouse=True)
def _reset_mt5_terminal_locks():
    """MT5CONC-02: clear the module-level per-terminal asyncio.Lock registry between
    tests so a Lock created here (``_mt5_terminal_lock_for`` inserts via setdefault)
    can never leak into another test — including the derive-branch suite, which
    shares this ONE process-wide registry when pytest runs both files.

    Since WIZFORM-ABANDON / D-36 it also clears the per-terminal EPOCH registry,
    via the ONE shared helper rather than a second hand-rolled `.clear()` here: a
    leaked epoch fences a client another test builds for the same key, which under
    `-n auto --dist loadgroup` is a sixth flake mechanism (RESEARCH Pitfall 8)."""
    mt5_concurrency.reset_terminal_state_for_tests()
    yield
    mt5_concurrency.reset_terminal_state_for_tests()


# ---------------------------------------------------------------------------
# 1 — the registry dict MOVED; job_worker re-binds the SAME object.
# ---------------------------------------------------------------------------
def test_registry_object_is_shared_across_modules() -> None:
    """A re-declared ``_MT5_TERMINAL_LOCKS = {}`` in job_worker would give the
    derive arm a private registry while allocator_positions used the leaf's — two
    registries, zero serialization of the ONE shared terminal (MT5CONC-02)."""
    from services import allocator_positions as ap

    assert jw._MT5_TERMINAL_LOCKS is mt5_concurrency._MT5_TERMINAL_LOCKS

    # Plan 151-03 arm: allocator_positions is the SECOND consumer — the whole
    # reason the registry was extracted into a leaf. Pin its binding too, since
    # the job_worker↔leaf assertions above stay green under a THIRD registry
    # declared here.
    assert ap._mt5_terminal_lock_for is mt5_concurrency._mt5_terminal_lock_for
    assert ap._mt5_bounded_restart is mt5_concurrency._mt5_bounded_restart
    assert ap._MT5_DERIVE_READ_TIMEOUT_S == mt5_concurrency._MT5_DERIVE_READ_TIMEOUT_S
    assert not hasattr(ap, "_MT5_TERMINAL_LOCKS"), (
        "allocator_positions must IMPORT the registry, never declare its own — "
        "a second dict serializes nothing (151-RESEARCH Pitfall 2)"
    )

    # A mutation through either name must be visible through the other — this is
    # what "same object" MEANS operationally, and it is the property a copied
    # dict breaks while `==` on two empty dicts would still pass.
    sentinel = asyncio.Lock()
    mt5_concurrency._MT5_TERMINAL_LOCKS["sentinel:1"] = sentinel
    assert jw._MT5_TERMINAL_LOCKS["sentinel:1"] is sentinel

    # ...and the helpers themselves are the same function objects, so a test that
    # monkeypatches `services.job_worker._mt5_terminal_lock_for` still intercepts
    # the call the leaf's own callers make.
    assert jw._mt5_terminal_lock_for is mt5_concurrency._mt5_terminal_lock_for
    assert jw._mt5_bounded_restart is mt5_concurrency._mt5_bounded_restart
    assert jw._Mt5PostReadVerificationError is mt5_concurrency._Mt5PostReadVerificationError

    # WIZFORM-ABANDON / plan 153.5-03 — the LEASE is now the acquisition verb at
    # every production call site (it is the only one with a release hook to bump
    # the abandoned-session epoch from), so it needs the same one-object pin the
    # registry has. A `mt5_terminal_lease` re-declared in either consumer would
    # wrap a DIFFERENT lock registry and bump a DIFFERENT epoch, and every
    # "the lease was entered" assertion would stay green while the two job kinds
    # serialized nothing and fenced nothing.
    assert jw.mt5_terminal_lease is mt5_concurrency.mt5_terminal_lease
    assert ap.mt5_terminal_lease is mt5_concurrency.mt5_terminal_lease


# ---------------------------------------------------------------------------
# 2 — one terminal_key resolves to ONE Lock object, whichever module asks.
# ---------------------------------------------------------------------------
def test_lock_for_key_is_the_same_object() -> None:
    """Identity, not acquirability: two registries would each mint a working Lock
    for ``h:1`` and an 'it locked' assertion would be green while the derive and
    holdings arms held DIFFERENT locks against the same Wine terminal."""
    from_job_worker = jw._mt5_terminal_lock_for("h:1")
    from_leaf = mt5_concurrency._mt5_terminal_lock_for("h:1")

    assert from_job_worker is from_leaf
    assert isinstance(from_job_worker, asyncio.Lock)

    # setdefault, not overwrite: asking again must NOT mint a replacement Lock —
    # a fresh object per call would silently strand any waiter already parked.
    assert jw._mt5_terminal_lock_for("h:1") is from_job_worker

    # Distinct terminals stay independently serialized (the registry is per-key,
    # not one global mutex that would needlessly serialize unrelated terminals).
    assert mt5_concurrency._mt5_terminal_lock_for("h:2") is not from_leaf


# ---------------------------------------------------------------------------
# 3 — leaf invariant: the module must not drag job_worker into the graph.
# ---------------------------------------------------------------------------
def test_importing_leaf_does_not_import_job_worker() -> None:
    """``allocator_positions`` is imported LAZILY by the job_worker handler purely
    to avoid an import cycle. If ``mt5_concurrency`` imported ``job_worker`` (even
    transitively), sharing the registry from ``allocator_positions`` would
    re-create that cycle and force a duplicate registry back into existence."""
    service_root = Path(__file__).resolve().parents[1]
    probe = (
        "import sys; "
        "import services.mt5_concurrency; "
        "assert 'services.job_worker' not in sys.modules, "
        "'mt5_concurrency pulled services.job_worker into the import graph'; "
        "print('LEAF_OK')"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=service_root,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"leaf-import probe failed:\nstdout={result.stdout}\nstderr={result.stderr}"
    )
    assert "LEAF_OK" in result.stdout


# ---------------------------------------------------------------------------
# 4 — the FLIPRETRY-01 timeout derivation survived the move.
# ---------------------------------------------------------------------------
def test_timeout_constants_survived_the_move() -> None:
    """The derive read ceiling is derived from the rpyc bound (+10s margin); the
    restart ceiling is the ~10s best-effort recovery cap. Their ORDER is
    load-bearing: a restart bounded ABOVE the read ceiling could not be a bounded
    recovery from a read that already timed out — it would nest-wedge the
    sequential worker instead."""
    read_s = mt5_concurrency._MT5_DERIVE_READ_TIMEOUT_S
    restart_s = mt5_concurrency._MT5_RESTART_TIMEOUT_S

    for name, value in (("read", read_s), ("restart", restart_s)):
        assert isinstance(value, float), f"{name} timeout must be a float"
        assert value > 0, f"{name} timeout must be positive"
        assert value == value and value != float("inf"), (
            f"{name} timeout must be finite — an inf/NaN bound serializes nothing "
            "and reopens the WEDGE-01 unbounded-hang class"
        )

    assert read_s > restart_s

    # The read ceiling is DERIVED from the rpyc round-trip bound, never a fresh
    # hardcode — pin the derivation so a retuned MT5_REQUEST_TIMEOUT_S carries
    # through the move (WR-02: derive and probe paths must not diverge).
    from services.mt5_client import MT5_REQUEST_TIMEOUT_S

    assert read_s == MT5_REQUEST_TIMEOUT_S + 10.0

    # job_worker's re-import must expose the very same values (a stale local
    # redefinition there would bound the derive arm differently from the
    # holdings arm against the same terminal).
    assert jw._MT5_DERIVE_READ_TIMEOUT_S == read_s
    assert jw._MT5_RESTART_TIMEOUT_S == restart_s


# --------------------------------------------------------------------------- #
# 5-11 — mt5_terminal_lease (Phase 153.3 plan 04, D-29)
#
# ⚠️ The oracle here is BLOCKING, never "the context manager ran". A lease that
# acquired nothing — or acquired a Lock from a second registry — enters and exits
# perfectly happily, and an "it worked" assertion is green under exactly the defect
# these cases exist to catch. So: ordering between two concurrent holders, elapsed
# time against a bound, and `lock.locked()` observed from OUTSIDE the lease.
# --------------------------------------------------------------------------- #


async def test_lease_serializes_two_holders_of_the_same_terminal() -> None:
    """⭐ THE POINT OF THE WHOLE PLAN. Two callers of the ONE shared Wine terminal
    must not overlap: MT5 binds one account per terminal AT A TIME, so an
    interleaved second ``login()`` re-points the terminal under the first caller and
    its capability verdict is judged against another account (T-153.3-17).

    Ordering, not "both finished": both finish under the defect too."""
    events: list[str] = []

    async def hold(name: str) -> None:
        async with mt5_concurrency.mt5_terminal_lease("h:1"):
            events.append(f"{name}-enter")
            await asyncio.sleep(0.05)  # a real await, so an unserialized second
            events.append(f"{name}-exit")  # caller WOULD interleave here

    await asyncio.gather(hold("a"), hold("b"))

    assert events == ["a-enter", "a-exit", "b-enter", "b-exit"], (
        "the second holder entered before the first released — the lease is not "
        "serializing the terminal (a second registry, or no acquire at all)"
    )


async def test_lease_does_not_serialize_distinct_terminals() -> None:
    """The registry is PER-KEY, not one global mutex. Serializing unrelated
    terminals would be a self-inflicted throughput cut, and would hide a key
    derivation bug (every caller collapsing onto one key still "works")."""
    events: list[str] = []

    async def hold(name: str, key: str) -> None:
        async with mt5_concurrency.mt5_terminal_lease(key):
            events.append(f"{name}-enter")
            await asyncio.sleep(0.05)
            events.append(f"{name}-exit")

    await asyncio.gather(hold("a", "h:1"), hold("b", "h:2"))

    # Interleaved — b entered while a still held ITS terminal.
    assert events == ["a-enter", "b-enter", "a-exit", "b-exit"]


async def test_lease_without_a_bound_queues_patiently_and_never_raises(
    monkeypatch,
) -> None:
    """D-29: the BATCH behaviour. ``wait_s=None`` is byte-equivalent to today's
    ``async with _mt5_terminal_lock_for(key):`` — the daily sync has all day, and
    bounding it would convert patient queueing into batch FAILURE.

    ``_MT5_LEASE_WAIT_S`` is monkeypatched to a hair to prove the interactive bound
    is NOT silently applied to an unbounded caller."""
    monkeypatch.setattr(mt5_concurrency, "_MT5_LEASE_WAIT_S", 0.01)
    lock = mt5_concurrency._mt5_terminal_lock_for("h:1")
    await lock.acquire()

    async def _release_later() -> None:
        await asyncio.sleep(0.15)
        lock.release()

    releaser = asyncio.create_task(_release_later())
    started = time.monotonic()

    async with mt5_concurrency.mt5_terminal_lease("h:1"):  # must NOT raise
        waited = time.monotonic() - started
        assert lock.locked()

    await releaser
    assert waited >= 0.1, (
        "the unbounded lease was granted before the holder released — it did not "
        "actually wait for the terminal"
    )


async def test_lease_bound_expiry_raises_busy_and_never_acquires() -> None:
    """⭐ THE BOUNDED ACQUISITION (D-29) AND the 'never release what you never
    acquired' half of the release discipline (T-153.3-19).

    A timed-out acquisition that nevertheless ran ``lock.release()`` in a finally
    would hand a THIRD caller a lease over a live IPC region while the real holder
    is still using it — and the observable signature of that bug is precisely
    ``lock.locked()`` flipping to False here, while the busy error still raises and
    a naive test still passes."""
    lock = mt5_concurrency._mt5_terminal_lock_for("h:1")
    await lock.acquire()  # somebody else holds the terminal
    started = time.monotonic()

    with pytest.raises(mt5_concurrency.Mt5TerminalBusyError):
        async with mt5_concurrency.mt5_terminal_lease("h:1", wait_s=0.05):
            pytest.fail("the body must never run when the terminal was never acquired")

    elapsed = time.monotonic() - started
    assert elapsed < 1.0, "the bounded wait did not fire at its bound"
    assert lock.locked(), (
        "the timed-out waiter released a lock it never acquired — the real holder's "
        "terminal is now leasable by a third caller mid-IPC"
    )

    # The successor case: once the real holder releases, the terminal is cleanly
    # acquirable again — a bounded expiry must leave NO residue in the wait queue.
    lock.release()
    async with mt5_concurrency.mt5_terminal_lease("h:1", wait_s=0.05):
        assert lock.locked()
    assert not lock.locked()


async def test_lease_releases_when_the_body_raises() -> None:
    """T-153.3-19: a stranded lock wedges the terminal PERMANENTLY for every future
    caller — every subsequent validate and every daily job. The validate body raises
    on most of its paths (auth reject, master reject, mismatch, transient), so this
    is the common case, not the exotic one."""
    lock = mt5_concurrency._mt5_terminal_lock_for("h:1")

    with pytest.raises(ValueError):
        async with mt5_concurrency.mt5_terminal_lease("h:1"):
            assert lock.locked()
            raise ValueError("the caller's own failure")

    assert not lock.locked()
    # Acquirable IMMEDIATELY, not merely eventually.
    await asyncio.wait_for(lock.acquire(), timeout=0.05)
    lock.release()


async def test_lease_is_backed_by_the_one_registry() -> None:
    """⭐ The assertion that reds if anyone gives the lease its own
    ``dict[str, asyncio.Lock]``. A second registry hands out a perfectly functional
    Lock, so the lease would enter, exit and serialize its OWN callers — while the
    three job call sites held a different object against the same Wine terminal
    (MT5CONC-02 / 151-RESEARCH Pitfall 2).

    Object identity through the registry, observed from OUTSIDE the lease."""
    lock = mt5_concurrency._mt5_terminal_lock_for("h:1")

    async with mt5_concurrency.mt5_terminal_lease("h:1"):
        assert lock.locked(), (
            "the lease acquired some OTHER Lock object — a second registry "
            "serializes nothing"
        )
        assert mt5_concurrency._MT5_TERMINAL_LOCKS["h:1"] is lock
        # ...and the job sites' own accessor sees the very same held lock.
        assert jw._mt5_terminal_lock_for("h:1") is lock
        assert jw._mt5_terminal_lock_for("h:1").locked()

    assert not lock.locked()
    assert list(mt5_concurrency._MT5_TERMINAL_LOCKS) == ["h:1"], (
        "the lease minted an extra registry entry — it must key on the SAME "
        "terminal_key the job sites use"
    )


def test_busy_error_cannot_be_absorbed_into_a_credential_verdict() -> None:
    """STRUCTURAL, per the ``_Mt5PostReadVerificationError`` precedent: the classify
    /stamp arms match on ``Mt5ClientError``. If ``Mt5TerminalBusyError`` subclassed
    it, OUR busy terminal could be classified as the USER's ``auth`` /
    ``wrong_server`` failure and a working key blamed for our queue."""
    from services.mt5_client import Mt5ClientError

    assert issubclass(mt5_concurrency.Mt5TerminalBusyError, Exception)
    assert not issubclass(mt5_concurrency.Mt5TerminalBusyError, Mt5ClientError)

    # It carries no infrastructure: no host, port, terminal key or account value
    # may travel with it (T-153.3-20).
    message = str(mt5_concurrency.Mt5TerminalBusyError("the MT5 terminal was busy"))
    for leak in ("h:1", "18812", "localhost", "127.0.0.1"):
        assert leak not in message


# ---------------------------------------------------------------------------
# WIZFORM-ABANDON / D-36 — THE LEASE DRIVES THE ABANDONED-THREAD FENCE
#
# WHY these matter (Rule 9). `asyncio.to_thread` work is never cancelled: when a
# caller's `wait_for` fires it unwinds and RELEASES this lease while the abandoned
# thread keeps driving the SAME process-global MT5 session. The lease is the only
# thing that knows a terminal has changed hands, so it is where the generation is
# bumped — and a bump missed on ANY exit path leaves that path's zombies un-fenced
# while every other path looks fine. Hence one case per exit path, plus the
# negative: a caller that never held the terminal must not fence the one that does.
# ---------------------------------------------------------------------------


async def test_the_lease_bumps_the_terminal_epoch_on_a_normal_exit() -> None:
    """The ordinary path. The bump belongs to RELEASE, not to acquisition: bumping
    on acquire would fence the acquirer's own client on its very first touch."""
    before = _mt5_epoch_for("h:1")

    async with mt5_concurrency.mt5_terminal_lease("h:1"):
        assert _mt5_epoch_for("h:1") == before, (
            "the generation advanced on ACQUISITION — this holder's own session "
            "would be fenced on its first touch"
        )

    assert _mt5_epoch_for("h:1") == before + 1


async def test_the_lease_bumps_the_terminal_epoch_when_the_body_raises() -> None:
    """The COMMON path, not the exotic one: the validate body raises on most of
    its outcomes (auth reject, master reject, mismatch, transient). A bump that
    lived after the `yield` instead of in the `finally` would leave every failed
    hold's abandoned threads free to touch the next holder's terminal."""
    before = _mt5_epoch_for("h:1")

    with pytest.raises(ValueError):
        async with mt5_concurrency.mt5_terminal_lease("h:1"):
            raise ValueError("the caller's own failure")

    assert _mt5_epoch_for("h:1") == before + 1


async def test_the_lease_bumps_the_terminal_epoch_when_the_holder_is_cancelled() -> None:
    """⭐ THE PATH THIS PHASE EXISTS FOR. A holder abandoned at its own `wait_for`
    is cancelled, not returned-from and not raised-through — and it is exactly the
    holder whose `to_thread` work is still running. If the bump missed this path,
    the fence would be armed on every path EXCEPT the one that needs it."""
    before = _mt5_epoch_for("h:1")
    entered = asyncio.Event()

    async def _holder() -> None:
        async with mt5_concurrency.mt5_terminal_lease("h:1"):
            entered.set()
            await asyncio.sleep(3600)

    task = asyncio.create_task(_holder())
    await asyncio.wait_for(entered.wait(), timeout=1.0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert _mt5_epoch_for("h:1") == before + 1
    assert not mt5_concurrency._mt5_terminal_lock_for("h:1").locked()


async def test_a_timed_out_acquisition_bumps_nothing() -> None:
    """The twin of ``test_lease_bound_expiry_raises_busy_and_never_acquires``, and
    the same principle one level up: a caller that never held the terminal must
    change NOTHING about it. A bump placed above the bounded ``wait_for`` would let
    a queued interactive validate that gave up FENCE the daily job that actually
    holds the terminal — turning our queue into the other caller's failure."""
    lock = mt5_concurrency._mt5_terminal_lock_for("h:1")
    await lock.acquire()  # somebody else holds the terminal
    before = _mt5_epoch_for("h:1")

    with pytest.raises(mt5_concurrency.Mt5TerminalBusyError):
        async with mt5_concurrency.mt5_terminal_lease("h:1", wait_s=0.05):
            pytest.fail("the body must never run when the terminal was never acquired")

    assert _mt5_epoch_for("h:1") == before, (
        "a timed-out waiter bumped the generation — it just fenced the sessions of "
        "the holder that is legitimately mid-IPC"
    )
    assert lock.locked()
    lock.release()


async def test_the_occupancy_stamp_covers_the_hold_and_is_reset_after_it() -> None:
    """D-36 AMENDED (ii). The construction fence (plan 02) reads this stamp, so
    "set for the whole hold, absent outside it" is its entire contract. Reset via
    the Token — not ``set(None)`` — so a nested lease restores the OUTER value
    instead of flattening it."""
    assert mt5_client._MT5_LEASE_OCCUPANCY.get() is None
    epoch_at_acquire = _mt5_epoch_for("h:1")

    async with mt5_concurrency.mt5_terminal_lease("h:1"):
        assert mt5_client._MT5_LEASE_OCCUPANCY.get() == ("h:1", epoch_at_acquire)

    assert mt5_client._MT5_LEASE_OCCUPANCY.get() is None, (
        "the occupancy stamp outlived the lease in the CALLER's context — every "
        "later construction on this task would look lease-held"
    )


async def test_to_thread_work_carries_a_frozen_copy_of_the_occupancy_stamp() -> None:
    """⭐ THE PROPERTY THE WHOLE CONSTRUCTION FENCE RESTS ON, re-verified IN-REPO
    rather than trusted from a research note.

    ``asyncio.to_thread`` copies the caller's ``contextvars.Context`` at spawn, so
    an abandoned thread keeps carrying the occupancy tuple of the lease it was
    spawned under EVEN AFTER that lease released in the caller's context. That
    asymmetry — frozen in the thread, gone in the caller — is precisely what lets
    plan 02 tell a zombie construction from a live one. If contextvars ever stopped
    being copy-on-spawn, the construction fence would silently stop working and
    nothing else in the suite would notice.

    ⚠️ The gate is BOUNDED (0.25s) and set again in a ``finally``. ``asyncio.run``
    joins the default executor for ``THREAD_JOIN_TIMEOUT = 300``s, so an unbounded
    ``Event.wait()`` here would stall the WHOLE suite for five minutes instead of
    redding. The rule this copies from ``test_mt5_derive_branch.py``: a broken lock
    REDS, it never hangs CI.
    """
    gate = threading.Event()
    started = asyncio.Event()
    loop = asyncio.get_running_loop()
    observed: dict[str, object] = {}

    def _abandoned_worker() -> None:
        loop.call_soon_threadsafe(started.set)
        gate.wait(0.25)
        observed["in_thread"] = mt5_client._MT5_LEASE_OCCUPANCY.get()

    epoch_at_acquire = _mt5_epoch_for("h:1")
    try:
        async with mt5_concurrency.mt5_terminal_lease("h:1"):
            # Spawned INSIDE the hold — this is the work that will outlive it.
            worker = asyncio.create_task(asyncio.to_thread(_abandoned_worker))
            await asyncio.wait_for(started.wait(), timeout=1.0)

        # ...the lease has now released in the CALLER's context.
        assert mt5_client._MT5_LEASE_OCCUPANCY.get() is None
        gate.set()
        await asyncio.wait_for(worker, timeout=1.0)
    finally:
        gate.set()

    assert observed["in_thread"] == ("h:1", epoch_at_acquire), (
        "the abandoned thread did NOT keep a frozen copy of the occupancy stamp — "
        "the construction fence (D-36 AMENDED (ii)) has nothing to read"
    )


def test_the_epoch_registry_is_not_re_exported_anywhere() -> None:
    """The E2 patch-target trap, pre-empted for the epoch.

    ``_MT5_RESTART_TIMEOUT_S`` IS re-exported into ``job_worker``, and a
    monkeypatch aimed at that copy is a SILENT no-op
    (``test_mt5_derive_branch.py:869-877``). The epoch registry is deliberately not
    re-exported anywhere, so there is no second binding for anyone to reach — and
    this test is what keeps it that way."""
    from services import allocator_positions as ap

    # Vacuity floor: the owner really does hold it, so the negatives below mean
    # "not re-exported" rather than "the name was renamed and nobody noticed".
    assert hasattr(mt5_client, "_MT5_TERMINAL_EPOCHS")
    assert mt5_concurrency.bump_mt5_terminal_epoch is bump_mt5_terminal_epoch

    assert not hasattr(jw, "_MT5_TERMINAL_EPOCHS"), (
        "job_worker acquired a binding to the epoch registry — a second name is a "
        "second patch target, and patching the wrong one is a silent no-op"
    )
    assert not hasattr(ap, "_MT5_TERMINAL_EPOCHS"), (
        "allocator_positions acquired a binding to the epoch registry"
    )


# ---------------------------------------------------------------------------
# WIZFORM-ABANDON / D-36 / T-153.5-10 — the raw-acquisition class, pinned shut.
#
# THE DEFECT THIS EXISTS FOR: at 153.5 HEAD, THREE of the five production
# terminal acquisitions bypassed `mt5_terminal_lease` and took
# `_mt5_terminal_lock_for` directly — `job_worker.py:364`, `job_worker.py:3572`
# (finding #5's OWN path) and `allocator_positions.py:656`. The raw
# `asyncio.Lock` has no release hook, so those three released the terminal while
# bumping NOTHING: every abandoned-session fence downstream was disarmed on
# exactly the paths that motivated it, and the whole suite was green.
#
# Plan 153.5-03 converted all three. This test is what stops a fourth from being
# written — because "we already fixed those three" is how the instance-not-class
# mistake gets paid for a seventeenth time. It reasons over the AST, never a
# grep: both edited files still contain the literal string
# `_mt5_terminal_lock_for` in prose comments explaining why they no longer call
# it, so a grep-based pin would be permanently red.
# ---------------------------------------------------------------------------

#: The registry accessor that must never again be entered as a context manager
#: directly. Acquiring it is fine (`mt5_terminal_lease` does exactly that, as a
#: plain call); HOLDING it as the async-with target is what skips the release
#: hook.
_RAW_LOCK_ACCESSOR = "_mt5_terminal_lock_for"

#: `mt5_concurrency` itself is the ONE legitimate exemption: `mt5_terminal_lease`
#: is the thing every other module is required to go through, and it necessarily
#: reaches the registry. It does so as a plain call (`lock = _mt5_terminal_lock_for(k)`),
#: not an async-with, so it would not be reported anyway — the exclusion is
#: belt-and-braces and is stated so a future refactor of the lease into
#: `async with _mt5_terminal_lock_for(k):` does not silently inherit an exemption
#: it was never granted. ⚠️ Never widen this set to "the file I am editing".
_RAW_ACQUISITION_EXEMPT_FILES: frozenset[str] = frozenset(
    {"services/mt5_concurrency.py"}
)

#: Anti-vacuity floor. MEASURED at 153.5-03: `services/` + `routers/` hold 88
#: production `.py` files (77 + 11). A pin that walked zero files would pass in
#: silence, so the walk asserts it saw a plausible fraction of the tree. Hand-
#: typed deliberately — a floor computed from the same walk it is guarding proves
#: nothing.
_PRODUCTION_FILE_FLOOR = 40
_PRODUCTION_FILES_MEASURED_AT_153_5 = 88


def _raw_lock_acquisitions(source: str, rel: str) -> list[tuple[str, int]]:
    """Every `async with _mt5_terminal_lock_for(...):` item in ``source``.

    BOTH syntactic forms are matched — a bare `_mt5_terminal_lock_for(k)` and an
    attribute access `mt5_concurrency._mt5_terminal_lock_for(k)` — because a
    re-import under a module alias is the obvious way for the class to come back.
    """
    found: list[tuple[str, int]] = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.AsyncWith):
            continue
        for item in node.items:
            call = item.context_expr
            if not isinstance(call, ast.Call):
                continue
            func = call.func
            name = (
                func.id
                if isinstance(func, ast.Name)
                else func.attr
                if isinstance(func, ast.Attribute)
                else None
            )
            if name == _RAW_LOCK_ACCESSOR:
                found.append((rel, node.lineno))
    return found


#: ⛔ THE TOP-LEVEL ENTRYPOINTS, ADDED BY 164.6.2 / IN-05 — and the reason is that
#: a COMMENT was standing where a guard belonged. The walk globbed `services/`
#: and `routers/` only, so `main.py` and `main_worker.py` were INVISIBLE to it: a
#: `mt5_terminal_lease` taken in either would never have appeared in the roster
#: and the `==` below would have stayed green over a roster that had silently
#: stopped being complete. The old comment recorded that hole honestly; it did
#: not close it. Both files are production modules that already reach MT5 (`main`
#: starts the boot heal as a task), so the cheap close is simply to walk them.
_PRODUCTION_ENTRYPOINT_FILES: tuple[str, ...] = ("main.py", "main_worker.py")


def _production_python_files() -> list[Path]:
    root = Path(__file__).resolve().parents[1]  # analytics-service/
    packaged = [
        p
        for pkg in ("services", "routers")
        for p in (root / pkg).rglob("*.py")
    ]
    entrypoints = [root / name for name in _PRODUCTION_ENTRYPOINT_FILES]
    missing = [p.name for p in entrypoints if not p.is_file()]
    assert not missing, (
        f"the entrypoint walk names files that do not exist: {missing}. A "
        f"renamed entrypoint must be re-cut here DELIBERATELY — silently "
        f"dropping it restores the IN-05 hole this list closes."
    )
    return sorted(packaged + entrypoints)


def test_no_production_module_acquires_the_raw_terminal_lock() -> None:
    """Every production terminal acquisition must go through the LEASE.

    The oracle is the release hook, not tidiness: `mt5_terminal_lease`'s `finally`
    is the only place a terminal hand-over can be observed, so it is the only
    place the D-36 epoch can be bumped. A raw `async with _mt5_terminal_lock_for(k):`
    serializes perfectly and fences nothing — which is precisely why this class of
    defect survived every existing lock test.
    """
    root = Path(__file__).resolve().parents[1]
    files = _production_python_files()

    assert len(files) >= _PRODUCTION_FILE_FLOOR, (
        f"the walk scanned only {len(files)} production files, below the "
        f"hand-typed floor of {_PRODUCTION_FILE_FLOOR} "
        f"({_PRODUCTION_FILES_MEASURED_AT_153_5} were measured across "
        f"services/ + routers/ at 153.5-03). A pin over an empty or truncated "
        f"walk passes in silence — fix the walk, never the floor."
    )

    offenders: list[tuple[str, int]] = []
    for path in files:
        rel = path.relative_to(root).as_posix()
        if rel in _RAW_ACQUISITION_EXEMPT_FILES:
            continue
        offenders.extend(_raw_lock_acquisitions(path.read_text(), rel))

    assert not offenders, (
        f"these sites hold the per-terminal Lock DIRECTLY instead of taking "
        f"`mt5_terminal_lease`: {offenders}. The raw Lock has no release hook, so "
        f"the site releases the terminal without bumping the WIZFORM-ABANDON / "
        f"D-36 epoch — a `to_thread` body that outlived its `wait_for` is then "
        f"free to drive the NEXT holder's MT5 terminal, unfenced and silent. Take "
        f"the lease (no `wait_s` for batch callers — the bounded arm's "
        f"Mt5TerminalBusyError is the interactive path's contract, D-29)."
    )


def test_the_raw_acquisition_scanner_reports_and_does_not_over_report() -> None:
    """Self-test: the scanner above must BITE on the real shape and must NOT be
    fooled by the same text in prose.

    Both halves matter. Without the first, the pin is a no-op that would have been
    green throughout the three-site defect. Without the second, the pin is
    permanently red — `job_worker.py` and `allocator_positions.py` both still
    NAME `_mt5_terminal_lock_for` in the comments explaining why they no longer
    call it, which is exactly why this is an AST walk and not a grep.
    """
    offending = (
        "async def f(k):\n"
        "    async with _mt5_terminal_lock_for(k):\n"
        "        pass\n"
    )
    assert _raw_lock_acquisitions(offending, "synthetic.py") == [("synthetic.py", 2)]

    # The attribute form — a module-aliased re-import is the obvious way back in.
    aliased = (
        "async def f(k):\n"
        "    async with mt5_concurrency._mt5_terminal_lock_for(k):\n"
        "        pass\n"
    )
    assert _raw_lock_acquisitions(aliased, "synthetic.py") == [("synthetic.py", 2)]

    in_a_docstring = (
        "async def f(k):\n"
        '    """Historically this did:\n'
        "\n"
        "    async with _mt5_terminal_lock_for(k):\n"
        "        ...\n"
        "\n"
        '    It now takes the lease."""\n'
        "    async with mt5_terminal_lease(k):\n"
        "        pass\n"
    )
    assert _raw_lock_acquisitions(in_a_docstring, "synthetic.py") == []

    # A plain CALL is not an acquisition — `mt5_terminal_lease` itself does this,
    # and reporting it would make the exemption above load-bearing rather than
    # belt-and-braces.
    plain_call = "def f(k):\n    lock = _mt5_terminal_lock_for(k)\n    return lock\n"
    assert _raw_lock_acquisitions(plain_call, "synthetic.py") == []


# ---------------------------------------------------------------------------
# WIZFORM-ABANDON / D-36 — THE LATENT CONSTRAINT OF THE LAZY BIND, pinned.
#
# ⚠️ NOT A DEFECT TODAY. `Mt5Client._epoch` binds on the FIRST touch and never
# rebinds — the decision that makes a PREFLIGHT-built client exempt (D-36 AMENDED;
# an eager construction bind false-positives `job_worker._make_mt5_session`, which
# builds outside and before the lease). Its unwritten price: ONE `Mt5Client`
# instance used under TWO lease acquisitions is refused on the SECOND, because its
# epoch is still the first lease's and the release in between bumped the
# generation. The holder would be entirely legitimate and would read an
# `Mt5SessionAbandoned` saying the lease it operated under has ended — classified
# transient (D-40), i.e. a permanent-looking retry loop, on a path that plainly
# HELD the lease. That is the most confusing failure this subsystem can produce.
#
# The 153.5 verification ast-checked all five lease blocks and confirmed NO
# production path reuses a client across two of them — so the constraint holds by
# accident of structure, and nothing pinned it (warning W-153.5-3). These two
# cases are the pin.
#
# The BEHAVIOURAL half — "a fresh client per acquisition is never refused, a
# reused one is" — lives in `tests/test_mt5_client_contract.py`
# (`test_one_client_per_lease_acquisition_is_the_shape_the_lazy_bind_assumes`).
# This half is the STRUCTURAL one: it watches production source for the shape that
# would make the reuse reachable in the first place.
#
# ⛔ THE FIX IS NOT TO WEAKEN `_assert_live`. If a call site ever legitimately
# needs one client across two leases, the deliberate remedy is to REBIND ON LEASE
# ENTRY — a new mechanism the lease itself would drive — never to relax the fence
# and never to re-add a construction-time snapshot (RESEARCH §Open Q-1 rejected
# that; it refuses legitimate preflight builds).
# ---------------------------------------------------------------------------

#: The ONE verb every production terminal acquisition goes through (pinned by
#: `test_no_production_module_acquires_the_raw_terminal_lock` above).
_LEASE_VERB = "mt5_terminal_lease"

#: ⛔ HAND-TYPED, asserted with `==`, and keyed on `(file, enclosing function)`
#: rather than line numbers — the 153.5 CONTEXT recorded that two of its four line
#: citations had ROTTED before the phase was even planned, so a line-keyed roster
#: would be re-cut for reasons that are not about the invariant.
#:
#: MEASURED at 153.5 (five acquisitions, five DISTINCT enclosing functions — which
#: is the invariant: at most one lease per function means no function can carry a
#: client from one acquisition into the next).
#:
#: ⭐ RE-CUT 2026-09-13 (Phase 164.6.2 plan 02) to SIX, and the roster's own
#: question was answered before the literal was touched: does the new site touch an
#: `Mt5Client` that was ALREADY touched under a different lease? It does not — the
#: heal CONSTRUCTS its client inside this lease (inside the `to_thread` body, so
#: the unbounded rpyc connect is covered by the caller's `wait_for`) and closes it
#: before the lease releases, so the lazy bind's first touch and its only touches
#: all land on this one generation.
#:
#: ⭐ THE ROSTER'S FORMER SCOPE GAP, now CLOSED (164.6.2 / IN-05).
#: `_production_python_files` globbed `services/` and `routers/` only, so
#: `main.py` was INVISIBLE to this walk — a lease taken there would never have
#: appeared here and the `==` would have stayed green over a roster that had
#: silently stopped being complete. That was recorded in a comment, which is a
#: record of a hole and not a guard against it. The walk now includes both
#: top-level entrypoints, and measured 2026-09-14 neither takes a lease: the
#: roster below is unchanged by the widening, which is the point —
#: `services/mt5_relogin.py` is a `services/` module and `main.py` only CALLS it.
#:
#: ⭐ NOT RE-CUT 2026-09-15 (Phase 164.6.4 plan 05), AND THE REASONING IS RECORDED
#: HERE RATHER THAN IN A COMMIT MESSAGE — because a roster that did not move is
#: indistinguishable from a roster nobody checked, and the next reader would
#: otherwise have to re-derive this from scratch.
#:
#: Phase 164.6.4 adds a SESSION MONITOR that drives the same heal on a DETECTION
#: POLL CADENCE. The pattern-mapper's §5 expected that to make this roster SEVEN.
#: It is still SIX, and that is a DECISION rather than an oversight:
#: `services/mt5_session_monitor.run_mt5_session_monitor_tick` takes NO lease of
#: its own. It reads the kill switch and then `await`s
#: `heal_mt5_terminal_session` — the site already on this roster — which
#: CONSTRUCTS its client inside its own single bounded lease (inside the
#: `to_thread` body, so the unbounded rpyc connect is covered by the caller's
#: `wait_for`) and closes it before that lease releases.
#:
#: So the roster's OWN question — *does the new caller touch an `Mt5Client` that
#: was ALREADY touched under a DIFFERENT lease?* — is answered NO by
#: construction, not by inspection: the monitor never holds a client at all, and
#: every client the cadence creates begins and ends inside one acquisition. ⭐ The
#: roster staying at SIX is therefore a real argument FOR the delegating design
#: rather than an accident of it, and a seventh entry appearing here is the
#: signal that the delegation was replaced by a second acquisition.
#:
#: ⛔ "The roster did not change" is ALSO what a broken walk looks like, which is
#: why this note is not the evidence. `test_the_session_monitor_module_holds_NO_
#: lease_and_NO_raw_lock` aims an AST check at the monitor module BY NAME (with a
#: synthetic calibration proving the scanner would report a lease if one were
#: there), and `test_both_new_session_modules_are_MEMBERS_of_the_production_
#: lease_walk` asserts — positively, by name, one assertion each — that both new
#: `services/` modules are actually IN `_production_python_files()`' output. The
#: `>=` floor cannot do that job: MEASURED 2026-09-15 the walk returns 95 files
#: against a floor of 40, i.e. 55 files of headroom, so a walk that silently
#: stopped seeing exactly these two would leave this roster reading SIX and every
#: lease assertion in this file green while measuring nothing about them.
_PRODUCTION_LEASE_SITES: frozenset[tuple[str, str]] = frozenset(
    {
        ("services/allocator_positions.py", "_fetch_mt5_account_rows"),
        ("services/ingestion/mt5.py", "validate"),
        ("services/job_worker.py", "_fetch_mt5_account_balance"),
        ("services/job_worker.py", "run_derive_broker_dailies_job"),
        ("routers/exchange.py", "_validate_mt5_key_probe"),
        # Phase 164.6.2 / D-08 — the boot heal. See the re-cut note above.
        ("services/mt5_relogin.py", "heal_mt5_terminal_session"),
    }
)


def _lease_sites(source: str, rel: str) -> list[tuple[str, str]]:
    """Every `async with mt5_terminal_lease(...):` in ``source``, as
    ``(rel, dotted enclosing function name)``.

    Nested defs are reported by their FULL dotted path, so a lease taken inside a
    closure is not silently attributed to the enclosing coroutine — the closure is
    a different scope and can hold a different client.
    """
    tree = ast.parse(source)
    parents: dict[ast.AST, ast.AST] = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node

    found: list[tuple[str, str]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.AsyncWith):
            continue
        for item in node.items:
            call = item.context_expr
            if not isinstance(call, ast.Call):
                continue
            func = call.func
            name = (
                func.id
                if isinstance(func, ast.Name)
                else func.attr
                if isinstance(func, ast.Attribute)
                else None
            )
            if name != _LEASE_VERB:
                continue
            chain: list[str] = []
            cur: ast.AST = node
            while cur in parents:
                cur = parents[cur]
                if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    chain.append(cur.name)
            found.append((rel, ".".join(reversed(chain))))
    return found


def test_the_lease_walk_can_SEE_the_top_level_entrypoints() -> None:
    """164.6.2 / IN-05 — the scope of the walk, asserted rather than commented.

    Both roster pins below are of the form "everything the walk sees has property
    P", so a walk that cannot see a file is a hole neither of them can report. The
    hole was `main.py` and `main_worker.py`, and it was recorded in a comment for
    a whole phase. ⛔ This is the assertion that would have reported it, and it
    fails if either entrypoint drops out of the walk again.
    """
    walked = {p.name for p in _production_python_files()}
    for name in _PRODUCTION_ENTRYPOINT_FILES:
        assert name in walked, (
            f"{name} is no longer in the production lease walk — a "
            f"`{_LEASE_VERB}` taken there would be invisible to the `==` roster "
            "below, which would stay green over an incomplete roster (IN-05)"
        )


def test_no_production_function_holds_two_terminal_leases() -> None:
    """⭐ THE PIN FOR THE LAZY BIND'S LATENT CONSTRAINT (W-153.5-3).

    One `Mt5Client` per lease acquisition. The reachable way to break it is a
    function that takes the lease TWICE with one client spanning both — so this
    asserts the roster of lease sites is exactly the SIX on the hand-typed
    literal above (five measured at 153.5, one added by 164.6.2) AND
    that their enclosing functions are all distinct.

    Reds in both directions, and both reds are useful:
      * a SIXTH site, or a lease that MOVED, reds the equality — read as "check
        whether the client this lease touches was already touched under an earlier
        one"; then re-cut this roster deliberately.
      * a function holding TWO leases reds the distinctness assertion — that is the
        shape that produces the confusing refusal, and the failure message says
        what to do about it.

    ⚠️ HONEST CEILING, stated rather than implied: this is a LEXICAL, per-function
    property. A client constructed in one function and handed to two others that
    each take a lease would satisfy every assertion here. The ast walk cannot see
    that, no walk can see it cheaply, and pretending otherwise is how the sibling
    roster's "the ONLY thing standing between" claim had to be re-cut. What this
    pin buys is that the CHEAP shape cannot land silently, and that the constraint
    is written down where the next reader of a refusal will find it.
    """
    root = Path(__file__).resolve().parents[1]
    files = _production_python_files()

    assert len(files) >= _PRODUCTION_FILE_FLOOR, (
        f"the walk scanned only {len(files)} production files, below the "
        f"hand-typed floor of {_PRODUCTION_FILE_FLOOR}. A pin over a truncated "
        f"walk passes in silence — fix the walk, never the floor."
    )

    sites: list[tuple[str, str]] = []
    for path in files:
        sites.extend(_lease_sites(path.read_text(), path.relative_to(root).as_posix()))

    assert set(sites) == _PRODUCTION_LEASE_SITES, (
        f"the production terminal-lease roster moved: {sorted(sites)}, expected "
        f"{sorted(_PRODUCTION_LEASE_SITES)}. Before re-cutting this literal, check "
        f"the ONE thing it exists for: does the new site touch an `Mt5Client` that "
        f"was ALREADY touched under a different lease? If so it will be refused "
        f"with `Mt5SessionAbandoned` — legitimately holding the lease and told the "
        f"lease has ended — because the lazy bind never rebinds (D-36 AMENDED)."
    )

    duplicated = sorted({site for site in sites if sites.count(site) > 1})
    assert not duplicated, (
        f"these functions take `{_LEASE_VERB}` more than once: {duplicated}. That "
        f"is the ONE shape in which a single `Mt5Client` can span two acquisitions, "
        f"and the lazy bind would refuse it on the second — a false refusal of a "
        f"legitimate holder, surfacing as a permanent-looking transient loop. If "
        f"the two leases genuinely use DISTINCT client instances this is safe; say "
        f"so at the site and re-cut this pin. ⛔ The remedy for a genuine reuse is "
        f"to REBIND ON LEASE ENTRY, never to weaken `Mt5Client._assert_live`."
    )


def test_the_lease_site_scanner_reports_the_reuse_shape_and_ignores_prose() -> None:
    """Self-test. Without it, a `_lease_sites` that silently returned nothing would
    make the pin above green forever — the vacuous-derivation failure the sibling
    rosters carry their floors and self-tests to prevent.
    """
    two_in_one_function = (
        "async def f(k):\n"
        "    client = build()\n"
        "    async with mt5_terminal_lease(k):\n"
        "        client.account_info()\n"
        "    async with mt5_terminal_lease(k):\n"
        "        client.account_info()\n"
    )
    assert _lease_sites(two_in_one_function, "synthetic.py") == [
        ("synthetic.py", "f"),
        ("synthetic.py", "f"),
    ]

    # The attribute form — a module-aliased import is the obvious way back in.
    aliased = (
        "async def f(k):\n"
        "    async with mt5_concurrency.mt5_terminal_lease(k):\n"
        "        pass\n"
    )
    assert _lease_sites(aliased, "synthetic.py") == [("synthetic.py", "f")]

    # A closure is its OWN scope, and must be reported as such: a lease taken in a
    # nested def is not the outer coroutine's, and attributing it there would hide
    # a genuine second acquisition.
    nested = (
        "async def outer(k):\n"
        "    async def inner():\n"
        "        async with mt5_terminal_lease(k):\n"
        "            pass\n"
        "    await inner()\n"
    )
    assert _lease_sites(nested, "synthetic.py") == [("synthetic.py", "outer.inner")]

    in_prose = (
        "async def f(k):\n"
        '    """Historically:\n'
        "\n"
        "    async with mt5_terminal_lease(k):\n"
        "        ...\n"
        '    """\n'
        "    return None\n"
    )
    assert _lease_sites(in_prose, "synthetic.py") == []


# ---------------------------------------------------------------------------
# CONC-2 / D-08 — THE PREFLIGHT TOUCHES NOTHING, and until Phase 164.6.2 plan 02
# NOTHING PINNED IT.
#
# `job_worker._make_mt5_session` builds the derive/holdings job's `Mt5Client` in
# PREFLIGHT — OUTSIDE and BEFORE the terminal lease. `Mt5Client._epoch` binds on
# FIRST TOUCH and never rebinds, so a session verb called from there stamps the
# generation EARLY; an unrelated lease releasing anywhere in the
# preflight-to-lease window then bumps the terminal, and the job's own, entirely
# legitimate derive read is refused with `Mt5SessionAbandoned` — "the lease it
# operated under has ended", said to a caller that plainly holds the lease. D-40
# classifies that transient, so it RETRIES, and retries the same way: a
# permanent-looking loop with the most confusing message this subsystem can
# produce.
#
# ⭐ That measurement is precisely what STRUCK D-01 (heal on session open) and
# replaced it with D-08 (heal at startup only). This gate is the structural half
# of that decision: the reasoning lives in CONTEXT.md, and from here on the SHAPE
# cannot come back silently.
#
# ⛔ The verb set is DERIVED from `Mt5Client`'s own source, never hand-typed, so a
# session verb added in a future phase is covered WITHOUT a pin edit — which is
# the whole difference between this gate and a roster that rots.
# ---------------------------------------------------------------------------

#: The construction site the gate watches. Hand-named because it is the SUBJECT of
#: the invariant, not a derived member of a set.
_PREFLIGHT_FUNCTION = "_make_mt5_session"

#: ⛔ HAND-TYPED anti-vacuity floor, and it is NEVER computed from the set it
#: bounds — a derivation that collapsed would yield an EMPTY verb set, and "none of
#: these verbs is called" is satisfied vacuously by an empty set, so a fully
#: broken gate and a fully clean preflight would be indistinguishable.
#: MEASURED 2026-09-13 (Phase 164.6.2 plan 02): 10 fenced methods on `Mt5Client`
#: (`login`, `account_info`, `terminal_info`, `history_deals_get`, `order_check`,
#: `restart`, `assert_session_authorized`, `initialize_with_credentials`,
#: `_raise_last`, `_materialize_rows`). The floor sits below that so a deliberate
#: verb removal does not red it, and far enough above zero to catch a collapse.
_SESSION_VERB_FLOOR = 8
_SESSION_VERBS_MEASURED_AT_164_6_2 = 10


def _mt5_session_touching_methods(source: str) -> frozenset[str]:
    """Every ``Mt5Client`` method that reaches the terminal's MT5 session, DERIVED
    from that class's own source.

    The derivation is ``self._assert_live(...)``: the WIZFORM-ABANDON / D-36 fence
    is applied to exactly the methods that perform a session touch, and its four
    exemptions (``__init__``, ``close``, ``release``, ``_teardown_transport``) are
    exactly the methods that touch only OUR OWN rpyc socket — which is the same
    line this gate needs to draw. ⛔ Deriving from "calls ``self._mt5.<x>``" instead
    would MISS the verbs that reach the session through a helper, and hand-typing
    the list would rot on the first new verb.
    """
    tree = ast.parse(source)
    cls = next(
        (
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.ClassDef) and node.name == "Mt5Client"
        ),
        None,
    )
    if cls is None:
        return frozenset()
    names: set[str] = set()
    for node in cls.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for call in ast.walk(node):
            if (
                isinstance(call, ast.Call)
                and isinstance(call.func, ast.Attribute)
                and call.func.attr == "_assert_live"
                and isinstance(call.func.value, ast.Name)
                and call.func.value.id == "self"
            ):
                names.add(node.name)
                break
    return frozenset(names)


def _session_touches_in(
    source: str, function_name: str, verbs: frozenset[str]
) -> list[tuple[str, int]]:
    """Every ``<anything>.<verb>(...)`` call inside ``function_name``, as
    ``(verb, lineno)``.

    Deliberately receiver-BLIND. The receiver in the preflight is a local
    (``Mt5Client(host, port)``'s result, or the `Mt5Session` wrapping it) and a
    walk that insisted on a particular name would be defeated by renaming a
    variable. Over-reporting is the safe direction here: the preflight calls
    ``os.getenv`` and two module-level functions and nothing else, so a false
    positive means somebody added an attribute call whose name collides with an
    MT5 session verb, which is itself worth a look.
    """
    tree = ast.parse(source)
    target = next(
        (
            node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == function_name
        ),
        None,
    )
    if target is None:
        return []
    found: list[tuple[str, int]] = []
    for node in ast.walk(target):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in verbs
        ):
            found.append((node.func.attr, node.lineno))
    return sorted(found)


def test_the_mt5_preflight_touches_no_terminal_session() -> None:
    """⛔ D-08 — ``job_worker._make_mt5_session`` must CONSTRUCT and nothing more.

    A terminal touch there stamps `Mt5Client._epoch` on the PREFLIGHT generation,
    outside the lease. An unrelated lease release in the window between the
    preflight and this job's own acquisition then makes that stamp stale, and the
    job's LEGITIMATE derive read is refused with `Mt5SessionAbandoned` — which D-40
    classifies TRANSIENT, so it retries into the same refusal. That is the most
    confusing failure this subsystem can produce, and it is why the per-session
    half of Phase 164.6.2's criterion 1 (D-01) was STRUCK and replaced by a
    startup-only heal (D-08).

    ⛔ The remedy for a red here is to MOVE the touch inside a lease, never to
    relax `Mt5Client._assert_live` and never to delete a verb from the derivation.
    """
    root = Path(__file__).resolve().parents[1]
    verbs = _mt5_session_touching_methods(
        (root / "services" / "mt5_client.py").read_text()
    )

    assert len(verbs) >= _SESSION_VERB_FLOOR, (
        f"the Mt5Client session-verb derivation COLLAPSED — the DERIVATION is "
        f"broken, not the code. Nothing below can fail while it is empty: 'the "
        f"preflight calls none of these verbs' is satisfied VACUOUSLY by an empty "
        f"set, so a preflight that touches the terminal and one that does not "
        f"become indistinguishable from here. derived={sorted(verbs)}, "
        f"floor={_SESSION_VERB_FLOOR} "
        f"({_SESSION_VERBS_MEASURED_AT_164_6_2} measured at 164.6.2-02). "
        f"⛔ Fix the derivation; never lower the floor."
    )

    job_worker_src = (root / "services" / "job_worker.py").read_text()
    assert f"def {_PREFLIGHT_FUNCTION}(" in job_worker_src, (
        f"harness: services/job_worker.py no longer defines "
        f"{_PREFLIGHT_FUNCTION} — this gate's subject moved; re-anchor it rather "
        f"than deleting it."
    )

    touches = _session_touches_in(job_worker_src, _PREFLIGHT_FUNCTION, verbs)
    assert not touches, (
        f"{_PREFLIGHT_FUNCTION} performs MT5 session touches {touches}. It runs in "
        f"PREFLIGHT, outside and before the terminal lease, so each of those binds "
        f"`Mt5Client._epoch` to a generation nobody holds; an unrelated lease "
        f"release before this job acquires the terminal then refuses its own "
        f"legitimate read with `Mt5SessionAbandoned` and D-40 retries it forever. "
        f"⛔ Move the touch INSIDE a lease (Phase 164.6.2's boot heal is the worked "
        f"example — it constructs its client inside its own lease); never weaken "
        f"the fence."
    )

    assert (
        _lease_sites(job_worker_src, "services/job_worker.py")
        and (
            "services/job_worker.py",
            _PREFLIGHT_FUNCTION,
        )
        not in _lease_sites(job_worker_src, "services/job_worker.py")
    ), (
        f"{_PREFLIGHT_FUNCTION} now takes a terminal lease. The preflight builds a "
        f"client for a job whose OWN lease comes later, so a lease here would be "
        f"a SECOND acquisition over one client — the exact shape "
        f"`test_no_production_function_holds_two_terminal_leases` exists to keep "
        f"out (D-36 AMENDED: the lazy bind never rebinds)."
    )


def test_the_preflight_touch_scanner_fires_on_a_spliced_session_verb() -> None:
    """CALIBRATION — the gate above must be able to FAIL, and must name the verb.

    A structural pin nobody has watched bite is worth nothing: `_session_touches_in`
    returning an empty list unconditionally would leave the gate permanently,
    silently green. This drives the SAME predicate over a hand-written copy of the
    preflight with one session verb spliced in, and over the clean copy, so both
    directions are measured.
    """
    root = Path(__file__).resolve().parents[1]
    verbs = _mt5_session_touching_methods(
        (root / "services" / "mt5_client.py").read_text()
    )

    clean = (
        "def _make_mt5_session(api_key, api_secret, passphrase):\n"
        "    login, investor_pw, server = parse_mt5_credentials(\n"
        "        api_key, api_secret, passphrase\n"
        "    )\n"
        "    host = os.getenv('MT5_GATEWAY_HOST')\n"
        "    port_raw = os.getenv('MT5_GATEWAY_PORT')\n"
        "    return Mt5Session(\n"
        "        client=Mt5Client(host, int(port_raw)),\n"
        "        login=login,\n"
        "        investor_password=investor_pw,\n"
        "        server=server,\n"
        "    )\n"
    )
    assert _session_touches_in(clean, "_make_mt5_session", verbs) == []

    spliced = (
        "def _make_mt5_session(api_key, api_secret, passphrase):\n"
        "    login, investor_pw, server = parse_mt5_credentials(\n"
        "        api_key, api_secret, passphrase\n"
        "    )\n"
        "    host = os.getenv('MT5_GATEWAY_HOST')\n"
        "    port_raw = os.getenv('MT5_GATEWAY_PORT')\n"
        "    client = Mt5Client(host, int(port_raw))\n"
        "    client.login(login, investor_pw, server)\n"
        "    return Mt5Session(\n"
        "        client=client,\n"
        "        login=login,\n"
        "        investor_password=investor_pw,\n"
        "        server=server,\n"
        "    )\n"
    )
    fired = _session_touches_in(spliced, "_make_mt5_session", verbs)
    assert fired == [("login", 8)], (
        f"the preflight scanner did not report the spliced session touch: {fired}. "
        f"A gate that cannot fire is worthless — fix the scanner, never the gate."
    )

    # And the verb NAME comes from the derivation, not from a literal in this test:
    # a `login` removed from Mt5Client would drop out of `verbs` and this
    # calibration would stop reporting it, which is the honest coupling.
    assert "login" in verbs


# ---------------------------------------------------------------------------
# 164.6.4 / CRITERION 4 — THE PERIODIC TOUCH MUST NOT STEAL THE ONE SHARED
# TERMINAL FROM LIVE JOB PROCESSING, AND THE TEST FAILS IF IT CAN.
#
# ⭐ THE NAIVE READING PICKS THE WRONG HAZARD, and the phase's own research
# disposed of it: D-08's lease hazard does NOT transfer (the terminal epoch binds
# on FIRST TOUCH rather than at construction, and the construction fence is a
# ContextVar preflight never carries). The REAL cost is the ASYMMETRY, which
# `mt5_relogin`'s own IN-04 comment states: the heal refuses to queue behind real
# work by taking a BOUNDED acquire, but real work DOES queue behind the heal —
# the three job sites acquire with `wait_s=None`, i.e. UNBOUNDED. So a tick can
# make a job wait for up to the tick's budget, and Phase 164.6.4 turns that from
# a once-per-boot event into a permanent CADENCE.
#
# ⛔ THE BUSY-SKIP DOCTRINE IS NOT INHERITED WITH THE BEHAVIOUR. The boot heal
# reasons that "a busy terminal is a terminal somebody is already successfully
# using, which is itself evidence that the session is fine". That is cheap and
# defensible once per boot and UNSOUND for a loop: it is a standing claim about
# session state the tick DID NOT MEASURE, and a terminal held by a FAILING job is
# exactly where it is most wrong. The BEHAVIOUR is kept — skip, never queue — and
# the CLAIM is refused: the skip is recorded as `not_measured` (the recorder's own
# arm, gated in `tests/test_mt5_relogin.py`). Nothing below treats a skip as
# evidence about the session.
#
# ⚠️ EVERY ORACLE HERE IS ORDERING, A ROUND-TRIP COUNT OR AN EPOCH DELTA — never
# "the tick returned". The tick returns `None` on every path BY CONSTRUCTION
# (it is structurally never-raising), so "it did not blow up" is green under
# precisely the defect this section exists to catch.
# ---------------------------------------------------------------------------

#: The two actors in the interleave log. A job HOLDS the terminal lease across a
#: measurable window; a monitor tick tries to use the terminal inside it.
_JOB_TAG = "job"
_TICK_TAG = "tick"

#: The tick's ACQUISITION bound, driven through the SHIPPED env knob rather than a
#: `setattr` on the constant — CR-02 moved that read per-call, so a `setattr`
#: would be a silent no-op leaving the 2.0 s default in force and the test would
#: pass or fail for harness reasons. `0.1` is the knob's own FLOOR
#: (`_MT5_RELOGIN_LEASE_WAIT_FLOOR_S`), so the real parse and the real range check
#: both still run.
_TICK_LEASE_WAIT_S = "0.1"

#: How long the job keeps the terminal when nothing interrupts it. FIVE TIMES the
#: tick's bound, so "the tick gave up while the job still held the terminal" is
#: established by construction rather than by a timing race. ⚠️ It is a CEILING,
#: not a sleep: in the neutered arm the job leaves as soon as the tick's touch is
#: observed, so the control costs nothing.
_JOB_HOLD_CEILING_S = 0.5

#: The `services.mt5_client` logger — where the D-36 refusal WARNING lands. It is
#: the PARENT of `mt5_relogin`'s logger, so raising both to INFO is two calls and
#: the second must be the one whose level the capturing handler keeps.
_CLIENT_LOGGER_NAME = "quantalyze.analytics"


@pytest.fixture
def _episode_sink(monkeypatch: pytest.MonkeyPatch):
    """The shipped `cron_runs` double, wired at the TRANSPORT seam.

    The heal calls the REAL `record_mt5_session_reading` / `record_mt5_heal_outcome`
    on every path this section drives, and those reach Supabase. Replacing
    `get_supabase` is the same seam `_install_client` replaces for the rpyc wire —
    everything between the tick and the wire stays real. ⛔ The recorder is NOT
    stubbed out: a harness that removed it would stop exercising the code the
    cadence actually runs.
    """
    fake = _FakeCronRuns()
    monkeypatch.setattr(mt5_session_episodes, "get_supabase", lambda: fake)
    mt5_session_episodes._reset_session_episode_state_for_tests()
    yield fake
    mt5_session_episodes._reset_session_episode_state_for_tests()


async def _run_job_and_one_monitor_tick(
    monkeypatch: pytest.MonkeyPatch, *, neuter_lock: bool
):
    """Drive ONE monitor tick concurrently with a job that HOLDS the terminal lease.

    Returns ``(order, fake, constructions, acquisitions)`` where ``order`` is the
    shared interleave log of ``(tag, "enter"/"exit"/"touch")``.

    The shape is the shipped `_run_two_concurrent_mt5` harness's: an ordered
    transport appending into a SHARED list, an index assertion, and an embedded
    negative control. The job parks (BOUNDED) until the tick's first touch is
    observed — under the real lock the tick can never touch, so the job times out
    at its ceiling and its terminal window stays contiguous; with the lock neutered
    the touch lands and the job leaves immediately. ⛔ A broken lock REDS here, it
    never hangs CI.
    """
    _set_full_env(monkeypatch)
    monkeypatch.setenv("MT5_RELOGIN_LEASE_WAIT_S", _TICK_LEASE_WAIT_S)

    # The terminal answers the credential-free detector cleanly, so the ONLY reason
    # the tick can fail to touch it is the lease. ⛔ Deliberately the simplest
    # scenario available: a tick that failed for a SECOND reason would make an
    # empty round-trip list ambiguous.
    fake, constructions = _install_client(monkeypatch, {"initialize": True})
    acquisitions = _install_lease_counter(monkeypatch)

    order: list[tuple[str, str]] = []
    loop = asyncio.get_running_loop()
    job_holds = asyncio.Event()
    tick_touched = asyncio.Event()

    real_initialize = fake.initialize

    def _recording_initialize(**kwargs):
        # Appended from the TICK's worker thread. `list.append` is atomic, and the
        # job's own `exit` is ordered AFTER this append by the event below — so the
        # ordering under test rests on a happens-before, not on a sleep.
        order.append((_TICK_TAG, "touch"))
        loop.call_soon_threadsafe(tick_touched.set)
        return real_initialize(**kwargs)

    # WRAPPED, never replaced: `real_initialize` still records the round-trip into
    # the double's own `round_trips` list, which is the separate oracle below.
    fake.initialize = _recording_initialize

    if neuter_lock:
        # ⚠️ THE REGISTRY'S OWN MODULE, and nothing else. `mt5_terminal_lease`
        # resolves `_mt5_terminal_lock_for` from `services.mt5_concurrency`'s OWN
        # globals, so a patch aimed at a re-export (`services.job_worker`'s, which
        # bound before the lease refactor) is a DOCUMENTED SILENT NO-OP — the
        # shipped `_run_two_concurrent_mt5` carries that observation. A FRESH Lock
        # per call serializes NOTHING, which is the whole point of the control.
        monkeypatch.setattr(
            mt5_concurrency, "_mt5_terminal_lock_for", lambda _k: asyncio.Lock()
        )
        # ⭐ ONE CONTROL, ONE VARIABLE. This arm isolates the LOCK; the
        # abandoned-session FENCE is a DIFFERENT variable and must be held still or
        # the control stops measuring what it names. With the lock neutered the two
        # flows genuinely interleave against a LIVE epoch registry, and the job's
        # lease release legitimately fences the tick's in-flight client — an
        # `Mt5SessionAbandoned` that would be swallowed by the tick's own guard and
        # would silently change WHY the tick made no further round-trip. The shipped
        # harness records 2 failures in 10 consecutive local runs before it pinned
        # this, and ⛔ it explicitly forbids "fixing" it by catching the abandonment:
        # a harness that swallows a refusal stays green when a future change makes
        # the fence fire where it should not.
        #
        # ⚠️ The target is `services.mt5_concurrency`, NOT the `services.mt5_client`
        # that DEFINES the function — the lease binds the name into mt5_concurrency's
        # globals at import, so that module is the READER (the 151 review-E2 rule).
        monkeypatch.setattr(mt5_concurrency, "bump_mt5_terminal_epoch", lambda _k: 0)

    # ⛔ THROUGH `mt5_terminal_key`, never a second hand-spelled `f"{host}:{port}"`:
    # the epoch registry and the lock registry must be keyed byte-identically or
    # the D-36 fence guards a different terminal than the lock serializes.
    key = mt5_terminal_key(_FAKE_HOST, int(_FAKE_PORT))

    async def _job() -> None:
        # The JOB SITES' acquisition form: `wait_s=None`, i.e. UNBOUNDED. That
        # asymmetry is the hazard — it is what makes a tick able to cost a job
        # real time — so the stand-in must not quietly bound itself.
        async with mt5_concurrency.mt5_terminal_lease(key):
            order.append((_JOB_TAG, "enter"))
            job_holds.set()
            try:
                await asyncio.wait_for(
                    tick_touched.wait(), timeout=_JOB_HOLD_CEILING_S
                )
            except asyncio.TimeoutError:
                pass
            order.append((_JOB_TAG, "exit"))

    job = asyncio.create_task(_job())
    # The job holds the terminal BEFORE the tick starts — established by an event,
    # never by a sleep, so the ordering under test cannot be timing-lucky.
    await asyncio.wait_for(job_holds.wait(), timeout=5.0)
    await mt5_session_monitor.run_mt5_session_monitor_tick()
    await asyncio.wait_for(job, timeout=5.0)
    return order, fake, constructions, acquisitions


def _tick_touch_indices(order: list[tuple[str, str]]) -> tuple[int, int, list[int]]:
    """``(job enter index, job exit index, tick touches strictly between them)``."""
    assert (_JOB_TAG, "enter") in order and (_JOB_TAG, "exit") in order, (
        f"harness: the job never bracketed its terminal window: {order!r}"
    )
    enter_i = order.index((_JOB_TAG, "enter"))
    exit_i = order.index((_JOB_TAG, "exit"))
    inside = [
        i
        for i, (tag, _event) in enumerate(order)
        if tag == _TICK_TAG and enter_i < i < exit_i
    ]
    return enter_i, exit_i, inside


async def test_CRITERION_4_a_monitor_tick_cannot_land_inside_a_live_jobs_terminal_window(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    _episode_sink,
) -> None:
    """⭐ CRITERION 4, WITH TEETH. A monitor tick must not steal the ONE shared
    terminal from live job processing, and this fails if it can.

    THREE ORACLES, because they are three different failures:

      1. ORDERING — no touch attributable to the tick falls between the job's
         `enter` and `exit`.
      2. THE EMPTY ROUND-TRIP LIST — ⛔ asserted EMPTY, never merely short. A tick
         that QUEUED and then ran AFTER the job satisfies an ordering-only
         assertion perfectly while having made the job wait, which is the exact
         cost IN-04 names.
      3. THE SKIP ITSELF — the bounded-acquire INFO line, naming the caller. A
         tick that made no round-trip because the CLIENT failed to build would
         satisfy (2) for a reason that has nothing to do with the lease.

    THE TEETH ARE EMBEDDED IN THIS SAME TEST, deliberately: a positive assertion
    with no failing control is indistinguishable from one that cannot fail. With
    the lock neutered the tick's touch DOES land inside the job's window.
    """
    caplog.set_level(logging.INFO, logger=_CLIENT_LOGGER_NAME)
    caplog.set_level(logging.INFO, logger=_RELOGIN_LOGGER_NAME)

    order, fake, constructions, acquisitions = await _run_job_and_one_monitor_tick(
        monkeypatch, neuter_lock=False
    )

    # ---- 1. ORDERING -------------------------------------------------------
    _enter_i, _exit_i, inside = _tick_touch_indices(order)
    assert not inside, (
        f"a monitor tick touched the terminal INSIDE a live job's terminal "
        f"window: {order!r}. The tick must take a BOUNDED acquire and SKIP — it "
        f"can never pre-empt or interleave with real work on the ONE shared "
        f"terminal (criterion 4)."
    )

    # ---- 2. AND IT MADE NO ROUND-TRIP AT ALL --------------------------------
    assert fake.round_trips == [], (
        f"the tick reached the terminal: {fake.round_trips!r}. ⛔ EMPTY, not "
        f"short: a tick that QUEUED behind the job and ran afterwards would pass "
        f"the ordering assertion above while having made the job wait for up to "
        f"the tick's whole budget — and the three job sites acquire UNBOUNDED, so "
        f"they cannot defend themselves (IN-04)."
    )
    assert constructions == [], (
        f"the tick built an Mt5Client while the job held the terminal: "
        f"{constructions!r}. The lease is taken BEFORE any client exists "
        f"precisely so a skip opens no transport at all."
    )

    # ---- 3. AND IT SKIPPED, SAYING SO, AT INFO ------------------------------
    skips = [
        r
        for r in _records(caplog)
        if "skipped — the terminal was already in use" in r.getMessage()
    ]
    assert len(skips) == 1, (
        f"the bounded-acquire skip was not reported exactly once: "
        f"{[r.getMessage() for r in _records(caplog)]}"
    )
    assert skips[0].levelno == logging.INFO, (
        f"the skip was logged at {skips[0].levelname}. A busy terminal is the "
        f"DESIGNED outcome of a bounded acquire, not a fault — and an operator "
        f"taught that a healthy cadence warns is an operator who stops reading "
        f"the channel this milestone exists to fill."
    )
    assert "mt5 session monitor" in skips[0].getMessage(), (
        f"the skip does not name the CALLER that made it: "
        f"{skips[0].getMessage()!r}. At a cadence the caller is the whole "
        f"difference between one boot-time line and 144 a day."
    )

    # ---- THE BOUND ITSELF, ASSERTED RATHER THAN ASSUMED ---------------------
    # ⚠️ Read BEFORE the control runs: `_install_lease_counter` WRAPS the lease, so
    # a second installation in the same test nests and both lists would grow.
    assert len(acquisitions) == 1, (
        f"the tick took {len(acquisitions)} lease acquisitions, not one: "
        f"{acquisitions!r}. ONE acquisition per function is the shape the lazy "
        f"epoch bind assumes (D-36 AMENDED); a second would be refused."
    )
    acquired_key, wait_s = acquisitions[0]
    assert acquired_key == mt5_terminal_key(_FAKE_HOST, int(_FAKE_PORT)), (
        f"the tick leased {acquired_key!r}. ⛔ The key must come from "
        f"`mt5_terminal_key`, never a second hand-spelled host-and-port string: "
        f"the epoch registry and the lock registry must be keyed byte-identically "
        f"or the D-36 fence guards a different terminal than the lock serializes."
    )
    assert wait_s is not None, (
        "the tick acquired the terminal with `wait_s=None` — the UNBOUNDED form "
        "the three BATCH job sites use. On a cadence that is the wedge: the tick "
        "would queue ahead of real work forever rather than skipping."
    )
    assert isinstance(wait_s, float) and 0.0 < wait_s < float("inf"), (
        f"the acquisition bound is not a finite positive float: {wait_s!r}"
    )
    assert wait_s == mt5_relogin._relogin_lease_wait_s(), (
        f"the tick's bound ({wait_s}) is not the shipped knob's value — it was "
        f"hardcoded somewhere instead of read per call, so a retune would not "
        f"reach it."
    )

    # ---- THE NEGATIVE CONTROL, IN THE SAME TEST ----------------------------
    # ⚠️ SELF-DETECTING MIS-AIM. If the patch above were re-pointed at a re-export,
    # the REAL registry would serialize the two flows and this arm would red with
    # the fully-contiguous order printed — which is exactly what 153.5-03 OBSERVED
    # before it re-pointed the shipped harness. Green here therefore means the
    # patch genuinely bound. The structural half of the same claim is asserted
    # directly below.
    lease_impl = getattr(mt5_concurrency.mt5_terminal_lease, "__wrapped__", None)
    assert lease_impl is not None and lease_impl.__globals__ is vars(
        mt5_concurrency
    ), (
        "`mt5_terminal_lease` no longer reads its names out of "
        "`services.mt5_concurrency`'s own globals, so the control below is "
        "patching a module the lease does not read — the silent-no-op class."
    )

    (
        neutered_order,
        neutered_fake,
        neutered_constructions,
        neutered_acquisitions,
    ) = await _run_job_and_one_monitor_tick(monkeypatch, neuter_lock=True)

    _n_enter, _n_exit, n_inside = _tick_touch_indices(neutered_order)
    assert n_inside, (
        f"WITH THE LOCK NEUTERED the tick's touch MUST land inside the job's "
        f"terminal window — otherwise the positive assertion above is vacuous. "
        f"Observed order: {neutered_order!r}. If that log is fully contiguous "
        f"(no `tick` entry at all) the patch is MIS-AIMED: "
        f"`_mt5_terminal_lock_for` must be patched on "
        f"`services.mt5_concurrency`, the module `mt5_terminal_lease` actually "
        f"reads it from — a patch aimed at `services.job_worker`'s re-export is a "
        f"documented SILENT NO-OP since the lease refactor."
    )
    assert neutered_fake.round_trips == ["initialize"], (
        f"the neutered arm did not reach the terminal: "
        f"{neutered_fake.round_trips!r}. The control must show the tick CAN make "
        f"the round-trip the lock is what prevents."
    )
    assert neutered_constructions, (
        "the neutered arm built no client — the control is not exercising the "
        "path the positive assertion denies."
    )
    assert len(neutered_acquisitions) == 1, (
        f"the neutered arm took {len(neutered_acquisitions)} acquisitions: "
        f"{neutered_acquisitions!r}"
    )


# ---------------------------------------------------------------------------
# 164.6.4 / CRITERION 4's INHERITED HALF — ZERO NEW LEASE SITES, ASSERTED
# POSITIVELY RATHER THAN READ OFF AN UNCHANGED ROSTER.
#
# The `==` pin on `_PRODUCTION_LEASE_SITES` already reds if a SEVENTH site
# appears. But "the roster did not change" is ALSO what a BROKEN WALK looks like,
# and the two new `services/` modules carry no lease — so a walk that stopped
# seeing them would leave the roster reading exactly SIX and every lease
# assertion in this file green while measuring nothing about them. These two
# cases close that, from the two independent directions: the MODULE holds no
# lease (AST, by name, synthetically calibrated), and the WALK can SEE it.
# ---------------------------------------------------------------------------

#: The two modules Phase 164.6.4 added. Spelled as walk-relative paths because
#: that is the form `_production_python_files()` yields and the roster is keyed
#: on.
_SESSION_MONITOR_REL = "services/mt5_session_monitor.py"
_SESSION_EPISODES_REL = "services/mt5_session_episodes.py"

#: The one statement in the monitor that reaches the terminal at all — it is an
#: `await` on the heal (WR-06 wraps it in `asyncio.wait_for` so a degraded
#: Supabase cannot silently stretch a tick past its own cadence; the heal call
#: itself, and the roster's reasoning, are unchanged), which is the site
#: ALREADY on the roster. ⛔ TWO LINES, not one: `mt5_session_monitor_loop`'s
#: OWN `await asyncio.wait_for(SHUTDOWN.wait(), ...)` shares the first line's
#: text, so the anchor must include the second line to stay unique. Used as the
#: splice anchor for the calibration below, and asserted UNIQUE before it is
#: used: a mutation that does not APPLY reads as GREEN.
_MONITOR_DELEGATION_ANCHOR = (
    "            await asyncio.wait_for(\n                heal_mt5_terminal_session(\n"
)


def test_the_session_monitor_module_holds_NO_lease_and_NO_raw_lock() -> None:
    """⭐ THE MONITOR ADDS ZERO LEASE SITES, AIMED AT THE MODULE BY NAME.

    It delegates: `run_mt5_session_monitor_tick` reads the kill switch and awaits
    `heal_mt5_terminal_session`, which constructs its client INSIDE its own single
    bounded lease and closes it before that lease releases. That is why
    `_PRODUCTION_LEASE_SITES` stays at SIX (the reasoning is recorded beside the
    roster itself), and it is why criterion 4's "must not steal the terminal" is
    INHERITED rather than re-argued — the heal's acquire is bounded, so a busy
    terminal means SKIP.

    ⛔ THE SYNTHETIC HALF IS NOT OPTIONAL. "The monitor holds no lease" is
    satisfied equally by a monitor that holds none and by a scanner that sees
    nothing, so both scanners are driven over a MUTATED COPY of the monitor's own
    text and must report the spliced acquisition, attributed to the monitor's real
    enclosing function. This is the discipline
    `test_the_raw_acquisition_scanner_reports_and_does_not_over_report` already
    applies, pointed at this module.
    """
    root = Path(__file__).resolve().parents[1]
    source = (root / _SESSION_MONITOR_REL).read_text()

    assert _lease_sites(source, _SESSION_MONITOR_REL) == [], (
        "`services/mt5_session_monitor.py` now takes a terminal lease of its own. "
        "Before re-cutting the roster, answer the question it exists for: does "
        "the new site touch an `Mt5Client` that was ALREADY touched under a "
        "DIFFERENT lease? The monitor's whole design is that it holds no client "
        "at all — it delegates to the heal, which owns one lease and one client "
        "lifetime. ⛔ A second acquisition on a CADENCE is the wedge class D-25 "
        "forbids, not a refactor."
    )
    assert _raw_lock_acquisitions(source, _SESSION_MONITOR_REL) == [], (
        "the monitor holds the per-terminal Lock DIRECTLY. The raw Lock has no "
        "release hook, so it releases the terminal without bumping the D-36 "
        "epoch — and on a cadence that disarms the fence periodically, forever."
    )

    # ---- CALIBRATION, on the monitor's OWN text ----------------------------
    assert source.count(_MONITOR_DELEGATION_ANCHOR) == 1, (
        f"harness: the splice anchor is no longer unique in "
        f"{_SESSION_MONITOR_REL} (found "
        f"{source.count(_MONITOR_DELEGATION_ANCHOR)}). ⛔ A mutation that does not "
        f"APPLY reads as GREEN — re-anchor this calibration rather than deleting "
        f"it."
    )

    # The spliced acquisition wraps the real delegation, so the scanner must
    # attribute it to the monitor's REAL enclosing function. The continuation
    # lines stay put: they sit inside the call's parentheses, where indentation
    # carries no meaning.
    spliced_lease = source.replace(
        _MONITOR_DELEGATION_ANCHOR,
        "            async with mt5_terminal_lease(_k):\n    "
        + _MONITOR_DELEGATION_ANCHOR,
    )
    assert spliced_lease != source, "harness: the lease splice did not apply"
    assert _lease_sites(spliced_lease, _SESSION_MONITOR_REL) == [
        (_SESSION_MONITOR_REL, "run_mt5_session_monitor_tick")
    ], (
        "the lease scanner did NOT report a lease spliced into the monitor's own "
        "delegation — so the clean assertion above measures nothing. Fix the "
        "scanner, never the assertion."
    )

    spliced_raw = source.replace(
        _MONITOR_DELEGATION_ANCHOR,
        "            async with _mt5_terminal_lock_for(_k):\n    "
        + _MONITOR_DELEGATION_ANCHOR,
    )
    assert spliced_raw != source, "harness: the raw-lock splice did not apply"
    fired = _raw_lock_acquisitions(spliced_raw, _SESSION_MONITOR_REL)
    assert len(fired) == 1 and fired[0][0] == _SESSION_MONITOR_REL, (
        f"the raw-acquisition scanner did not report a raw lock spliced into the "
        f"monitor's own delegation: {fired!r}"
    )


def test_both_new_session_modules_are_MEMBERS_of_the_production_lease_walk() -> None:
    """⛔ MEMBERSHIP, NOT HEADROOM — and it is a SHIPPED assertion, not a look.

    `_PRODUCTION_FILE_FLOOR` is a `>=` floor and MEASURED 2026-09-15 the walk
    returns 95 files against a floor of 40 — 55 files of headroom. A walk that
    silently truncated to 41 files would still clear the floor; and because the
    two NEW `services/` modules carry NO lease, a walk that stopped seeing THEM
    specifically would leave `_PRODUCTION_LEASE_SITES` reading exactly SIX and
    every lease assertion in this file green while measuring nothing about them.

    ⚠️ The sibling test above reads the monitor module directly BY PATH, so it
    proves the MODULE holds no lease and says nothing whatever about the WALK.
    This is the other half, and it cannot be expressed as a count: a count cannot
    distinguish "the walk grew by two" from "the walk lost two and gained four".
    One assertion each, so a partial regression says WHICH module vanished.

    ⛔ Fix the walk, never the floor.
    """
    root = Path(__file__).resolve().parents[1]
    walked = {p.relative_to(root).as_posix() for p in _production_python_files()}

    assert _SESSION_MONITOR_REL in walked, (
        f"{_SESSION_MONITOR_REL} is NOT in the production walk the lease roster "
        f"derives from. It is the module Phase 164.6.4 added to drive the "
        f"terminal ON A CADENCE, so a lease taken there would be invisible to the "
        f"`==` roster — which would stay green at SIX over a roster that had "
        f"silently stopped being complete (the IN-05 hole, re-opened)."
    )
    assert _SESSION_EPISODES_REL in walked, (
        f"{_SESSION_EPISODES_REL} is NOT in the production walk the lease roster "
        f"derives from. The episode recorder runs on every tick; a lease taken "
        f"there would be invisible to the `==` roster."
    )


# ---------------------------------------------------------------------------
# 164.6.4 / T-164.6.4-27 — THE CADENCE-BORNE ABANDONMENT, which is the one
# GENUINELY NEW exposure this phase creates.
#
# A tick abandoned at its budget leaves a round-trip in flight against the shared
# terminal on a thread that was NOT cancelled. That was true of the boot heal too
# — but once per deploy. The monitor makes it PERIODIC, so the fence that makes it
# safe now matters on a cadence rather than at one moment nobody is watching.
#
# ⛔ The remedy is NEVER to join the thread: that holds the lease for exactly as
# long as the hang, which is the WEDGE-01 class D-25 forbids. The design is that
# the lease's `finally` runs in its load-bearing order — bump the epoch, un-stamp
# the occupancy, release the lock — and the zombie's next touch is then refused by
# the client's own liveness fence.
# ---------------------------------------------------------------------------


async def test_a_tick_abandoned_at_its_budget_bumps_the_epoch_and_fences_the_zombie(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    _episode_sink,
) -> None:
    """⭐ THE EPOCH DELTA IS THE ORACLE, not "no exception escaped".

    A fence that stopped bumping would leave every behavioural assertion in this
    file green — the tick still returns `None`, the lock is still released, the
    log line still says ABANDONED — while every zombie round-trip the cadence
    produces landed unfenced on the NEXT holder's terminal. So the delta across
    the abandoned tick is asserted directly.

    Three claims, measured in order:
      * the tick does NOT join the abandoned thread (it returns while the thread
        is still parked mid-round-trip);
      * the lease's `finally` still advanced the terminal's generation by EXACTLY
        one;
      * the zombie's NEXT touch is refused by `Mt5Client._assert_live` — the
        refusal reaches the log (D-39: on the abandoned path the raise reaches
        nobody, so the WARNING is the whole signal) and the round-trip never
        reaches the wire.

    ⚠️ Every wait here is BOUNDED. A "fix" that joined the thread would red this
    test at the gate's own bound rather than hanging CI.
    """
    caplog.set_level(logging.INFO, logger=_CLIENT_LOGGER_NAME)
    caplog.set_level(logging.INFO, logger=_RELOGIN_LOGGER_NAME)

    _set_full_env(monkeypatch)
    # ⛔ The ENVIRONMENT, not a module attribute — CR-02 made the budget a per-call
    # read, so a `setattr` on the constant would be a NO-OP leaving the ~160 s
    # default in force. IN-03 floors the budget at ONE ROUND-TRIP, so the floor is
    # lowered FOR THIS TEST: the real parse, the real range check and the real
    # `wait_for` all still run, and the only thing moved is the bound whose whole
    # purpose is to be too large to observe in a unit test.
    monkeypatch.setattr(mt5_relogin, "_MT5_RELOGIN_BUDGET_FLOOR_S", 0.01)
    monkeypatch.setenv("MT5_RELOGIN_BUDGET_S", "0.05")

    # A terminal that ANSWERS the detector falsily, so the probe goes on to read
    # `last_error()` — i.e. there IS a second touch for the fence to refuse. A
    # scenario whose first call succeeded would leave the fence unexercised.
    fake, constructions = _install_client(
        monkeypatch, {"initialize": False, "last_error": (-6, "no account")}
    )

    gate = threading.Event()
    entered = threading.Event()
    finished = threading.Event()

    real_initialize = fake.initialize

    def _hanging_initialize(**kwargs):
        entered.set()
        # BOUNDED (5 s): a tick that JOINED the thread must RED at this bound, not
        # hang the suite. `asyncio.run` joins the default executor for 300 s, so an
        # unbounded park here would stall the whole run instead of failing.
        gate.wait(5.0)
        return real_initialize(**kwargs)

    fake.initialize = _hanging_initialize

    # `close()` is deliberately EXEMPT from the D-36 fence (D-41) precisely so a
    # teardown is never stranded — which makes the transport close the one signal
    # that the zombie has finished unwinding.
    conn = fake._MetaTrader5__conn
    real_close = conn.close

    def _closing() -> None:
        real_close()
        finished.set()

    conn.close = _closing

    key = mt5_terminal_key(_FAKE_HOST, int(_FAKE_PORT))
    before = _mt5_epoch_for(key)

    started = time.monotonic()
    assert await mt5_session_monitor.run_mt5_session_monitor_tick() is None
    elapsed = time.monotonic() - started

    # ---- THE TICK DID NOT JOIN THE THREAD ----------------------------------
    assert entered.wait(1.0), "harness: the round-trip never started"
    assert not finished.is_set(), (
        "the tick waited for the abandoned thread. ⛔ Joining it holds the lease "
        "for exactly as long as the hang — the WEDGE-01 class D-25 forbids, and "
        "on a CADENCE it is a periodic wedge of the ONE shared terminal."
    )
    assert elapsed < 2.0, (
        f"the tick took {elapsed:.3f}s to return against a 0.05s budget — it did "
        f"not abandon at its bound."
    )

    # ---- THE EPOCH ADVANCED BY EXACTLY ONE ---------------------------------
    assert _mt5_epoch_for(key) - before == 1, (
        f"the abandoned tick advanced the terminal generation by "
        f"{_mt5_epoch_for(key) - before}, not 1. The lease's `finally` is the ONLY "
        f"place a hand-over can be observed and therefore the only place the "
        f"D-36 fence can be armed; at a cadence, a bump that stopped happening "
        f"un-fences a zombie round-trip every interval, forever — with every "
        f"other assertion here still green."
    )

    # ---- THE ZOMBIE'S NEXT TOUCH IS REFUSED --------------------------------
    gate.set()
    assert finished.wait(5.0), "harness: the abandoned thread never unwound"

    assert "last_error" not in fake.round_trips, (
        f"the zombie's next round-trip reached the wire: {fake.round_trips!r}. It "
        f"was driving the shared terminal AFTER the lease it began under had "
        f"released — which is the tampering this fence exists to refuse."
    )
    refusals = [
        r
        for r in caplog.records
        if "refusing the last_error round-trip" in r.getMessage()
    ]
    assert len(refusals) == 1, (
        f"the fence did not report refusing the zombie's touch: "
        f"{[r.getMessage() for r in caplog.records]}. ⭐ On the abandoned path the "
        f"raise reaches NOBODY (`_copy_future_state` returns early on a cancelled "
        f"destination), so the WARNING is the whole signal (D-39)."
    )
    assert refusals[0].levelno == logging.WARNING

    # ...and the ERROR arm named the in-flight call, rather than sharing the
    # catch-all's transient wording with a busy-terminal SKIP (WR-05).
    abandoned = [
        r for r in _records(caplog) if "ABANDONED at the" in r.getMessage()
    ]
    assert len(abandoned) == 1 and abandoned[0].levelno == logging.ERROR, (
        f"the budget expiry was not reported under its own ERROR arm: "
        f"{[(r.levelname, r.getMessage()) for r in _records(caplog)]}"
    )
    assert "mt5 session monitor" in abandoned[0].getMessage(), (
        "the abandonment does not name the CADENCE as its caller — at a cadence "
        "the distinction between one boot-time abandonment and a periodic one is "
        "the entire operational story."
    )
    assert constructions, "harness: no client was ever constructed"


# ---------------------------------------------------------------------------
# 164.6.4 / MT5CONC-02 + T-164.6.4-28 — THE ACCOUNT BRACKET.
#
# MT5 binds ONE account per terminal AT A TIME, so the standing question about any
# new terminal toucher is what it does to the AUTHORIZED ACCOUNT. The monitor's
# answer has three parts and they are stated here rather than left implicit:
#
#   (i)  on the overwhelmingly common path it sends NO CREDENTIAL AT ALL, so it
#        switches no account — the only reading it takes is the credential-free
#        detector (D-1, criterion 3);
#   (ii) it sends one ONLY after a `-6`, which BY DEFINITION means no account is
#        authorized — so there is no per-customer session for it to displace;
#   (iii) it can never do either while a job HOLDS the lease, because the acquire
#        is bounded and it skips — measured by
#        `test_CRITERION_4_a_monitor_tick_cannot_land_inside_a_live_jobs_terminal_window`
#        above, whose oracle is an EMPTY round-trip list.
#
# ⚠️ AND THE ROSTER'S OWN CEILING, SAID OUT LOUD WHILE WE ARE HERE:
# `_PRODUCTION_LEASE_SITES` is a LEXICAL, per-function property. It cannot see a
# client constructed in one function and handed to two others that each take a
# lease. This argument is therefore about the SITES, not a proof about every
# possible client lifetime — and pretending otherwise is how the sibling roster's
# "the ONLY thing standing between" claim had to be re-cut.
# ---------------------------------------------------------------------------


async def test_MT5CONC_02_the_monitor_never_switches_the_terminals_authorized_account(
    monkeypatch: pytest.MonkeyPatch, _episode_sink
) -> None:
    """The account bracket for the cadence, in both of its arms."""
    _set_full_env(monkeypatch)
    monkeypatch.setenv("MT5_RELOGIN_LEASE_WAIT_S", _TICK_LEASE_WAIT_S)

    # ---- (i) THE COMMON PATH: an authorized terminal is sent NOTHING --------
    authorized, _c = _install_client(monkeypatch, {"initialize": True})
    acquisitions = _install_lease_counter(monkeypatch)
    await mt5_session_monitor.run_mt5_session_monitor_tick()

    assert authorized.call_order == ["initialize"], (
        f"the tick made more than the credential-free probe on an ALREADY "
        f"AUTHORIZED terminal: {authorized.call_order!r}. ⛔ A credential sent to "
        f"a terminal that did not need one is a disclosure surface opened for "
        f"nothing — and on a cadence it is opened 144 times a day."
    )
    assert all("login" not in kw for kw in authorized.initialize_kwargs), (
        f"a credential rode into the probe: "
        f"{[sorted(kw) for kw in authorized.initialize_kwargs]} (KEYS only — "
        f"never the values). The detector must stay credential-FREE, or it could "
        f"not be used to DECIDE whether to send one: it would already have sent "
        f"it."
    )

    # (iii), asserted here too rather than only referenced: the acquisition that
    # would have to expire for the SKIP to happen is a BOUNDED one.
    assert len(acquisitions) == 1 and acquisitions[0][1] is not None, (
        f"the tick's acquisition is not bounded: {acquisitions!r} — a `None` wait "
        f"is the BATCH form, which queues rather than skipping."
    )

    # ---- (ii) AFTER A `-6`, WHICH MEANS NO ACCOUNT IS AUTHORIZED -----------
    dark, _c2 = _install_client(
        monkeypatch, {"initialize": False, "last_error": (-6, "no account")}
    )
    await mt5_session_monitor.run_mt5_session_monitor_tick()

    assert dark.round_trips == [
        "initialize",
        "last_error",
        "initialize_credentialed",
        "initialize",
    ], (
        f"the credentialed verb did not follow a MEASURED `-6`: "
        f"{dark.round_trips!r}. The order is the argument: the bare probe, then "
        f"`last_error()` answering `-6` — the ONE reading that establishes no "
        f"account is authorized — and only THEN the credential. A credential sent "
        f"on any other code would be re-pointing a terminal whose session nobody "
        f"measured, and would re-collapse the IPC-vs-session distinction Phase "
        f"164.1 built."
    )
    assert "login" not in dark.initialize_kwargs[0], (
        "the DETECTOR carried a credential — it can no longer decide whether to "
        "send one"
    )
    assert "login" in dark.initialize_kwargs[1], (
        f"the heal arm sent no credential: "
        f"{[sorted(kw) for kw in dark.initialize_kwargs]}"
    )

    # ---- (ii-b) AND ON ANY OTHER CODE, NOTHING IS SENT ---------------------
    # ⭐ THIS ARM IS WHY (ii) IS A CLAIM RATHER THAN AN OBSERVATION, and it was
    # ADDED after the calibration found the gate could not fire without it. The
    # `-6` arm above drives a terminal whose code IS `-6`, so it exercises the
    # branch's TRUE side twice and its FALSE side not at all: MEASURED 2026-09-15,
    # deleting the code check from `_heal_blocking` entirely (`if False:`) left
    # everything above GREEN. That is the one-property-measured-twice shape this
    # phase's wave 2 found four instances of, and it is the same shape here.
    #
    # An IPC fault means the terminal is WEDGED, UNREACHABLE or behind a modal
    # dialog — the session was never measured at all. Re-sending a credential
    # heals nothing there and re-collapses exactly the distinction Phase 164.1
    # built; on a CADENCE it would also re-point the terminal's account every
    # interval for the whole duration of a gateway outage.
    ipc_fault, _c3 = _install_client(
        monkeypatch, {"initialize": False, "last_error": (-10004, "no ipc")}
    )
    await mt5_session_monitor.run_mt5_session_monitor_tick()

    assert ipc_fault.round_trips == ["initialize", "last_error"], (
        f"the tick did more than PROBE on an IPC fault: "
        f"{ipc_fault.round_trips!r}. `-10004` is a wedged pipe, not a lapsed "
        f"session — the credential is reserved for the ONE code that establishes "
        f"no account is authorized."
    )
    assert all("login" not in kw for kw in ipc_fault.initialize_kwargs), (
        f"a credential was sent on an IPC fault: "
        f"{[sorted(kw) for kw in ipc_fault.initialize_kwargs]} (KEYS only). The "
        f"terminal's authorized account must never be re-pointed on a reading "
        f"that measured nothing about the session."
    )
