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

import asyncio
import subprocess
import sys
import time
from pathlib import Path

import pytest

from services import job_worker as jw
from services import mt5_concurrency


@pytest.fixture(autouse=True)
def _reset_mt5_terminal_locks():
    """MT5CONC-02: clear the module-level per-terminal asyncio.Lock registry between
    tests so a Lock created here (``_mt5_terminal_lock_for`` inserts via setdefault)
    can never leak into another test — including the derive-branch suite, which
    shares this ONE process-wide registry when pytest runs both files."""
    mt5_concurrency._MT5_TERMINAL_LOCKS.clear()
    yield
    mt5_concurrency._MT5_TERMINAL_LOCKS.clear()


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
