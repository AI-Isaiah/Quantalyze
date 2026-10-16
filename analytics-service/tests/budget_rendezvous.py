"""Deterministic expiry of a wall-clock budget, for tests that need a REAL
``asyncio`` timeout to land at a known await.

A HELPER, NOT A TEST MODULE (same convention as ``tests/qstats_gate.py``).

WHY IT EXISTS
-------------
A test that drives the real "the worker's per-job budget expired" path used to
write ``asyncio.wait_for(handler(), timeout=0.1)`` and rely on 100 ms being long
enough for the handler to reach the step the test aims at. Between the start of
the budget and that step sit thread-pool hops (``db_execute`` is one each), and a
hop is only as fast as the CPU lets a pool thread run. Under a many-worker xdist
run on a loaded box the budget occasionally expired FIRST: the cancellation then
landed somewhere other than the intended await, and the test asserted against a
run that never reached the state it claimed to test. Widening the bound only
makes that rarer; a stopwatch cannot order two events.

THE FIX IS A RENDEZVOUS. The step the test aims at announces itself on an
``asyncio.Event``; the budget starts open-ended and is pulled to "now" only once
that event is set. The expiry therefore always lands while the handler is parked
at the aimed step, however slow the box is.

``asyncio.timeout`` is the primitive ``asyncio.wait_for`` is built on (Python
3.12), so the cancellation is delivered the way the worker's own
``asyncio.wait_for(handler(job), timeout=...)`` delivers it: a real
``CancelledError`` into the handler, converted to ``TimeoutError`` at the
boundary.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

#: Ceiling for a handler that never reaches the aimed step. It is NEVER the cancel
#: point; it only turns a would-be hang into a LOUD FAILURE. Both helpers below
#: check, when the budget expires, that the rendezvous had been reached, and fail
#: with ``_never_reached_message`` if it had not. Without that check a ceiling
#: expiry raises the very ``TimeoutError`` the test is waiting for and passes,
#: whatever the handler was doing.
#:
#: ⛔ It is armed with ``asyncio.timeout_at`` (an ABSOLUTE loop time).
#: ``asyncio.timeout`` takes a DELAY, so ``timeout(loop.time() + 30)`` was a ceiling
#: of the loop clock's value in seconds (days, on a long-running box): it never
#: bit, and a handler that never reached the aimed step simply hung.
_NEVER_REACHED_CEILING_S = 30.0


def _never_reached_message(what: str) -> str:
    return (
        f"{what} expired at the {_NEVER_REACHED_CEILING_S:.0f} s never-reached "
        "ceiling, NOT at the aimed step: the rendezvous was never reached, so the "
        "code under test never got to the step this test aims its cancellation at. "
        "Do not read this as the expected timeout."
    )


async def expire_budget_when_reached(awaitable: Any, reached: asyncio.Event) -> None:
    """Await ``awaitable`` under a real ``asyncio.timeout`` budget that expires at
    the moment ``reached`` is set, and assert it raised ``TimeoutError``.

    ``reached`` must be set by the code path the test aims the cancellation at,
    from the event-loop thread (a ``threading.Event`` set from a worker thread
    must be bridged with ``loop.call_soon_threadsafe(reached.set)``).

    FAILS CLOSED: a ``TimeoutError`` while ``reached`` is still unset can only be
    the never-reached ceiling (or a ``TimeoutError`` the awaitable raised on its
    own, which is not the aimed expiry either), so it fails the test with a message
    naming that, instead of satisfying ``pytest.raises``.
    """
    loop = asyncio.get_running_loop()

    with pytest.raises(asyncio.TimeoutError):
        async with asyncio.timeout_at(
            loop.time() + _NEVER_REACHED_CEILING_S
        ) as budget:

            async def _expire_when_reached() -> None:
                await reached.wait()
                budget.reschedule(loop.time())

            watcher = asyncio.ensure_future(_expire_when_reached())
            try:
                await awaitable
            finally:
                watcher.cancel()
    if not reached.is_set():
        pytest.fail(_never_reached_message("the budget"), pytrace=False)


class _AsyncioWithRendezvousBudget:
    """A stand-in for the ``asyncio`` name inside ONE module, identical to the
    real one except that ``wait_for`` with a numeric timeout starts that timeout's
    clock at the rendezvous instead of at the call.

    For code that OWNS the timer (a production ``asyncio.wait_for(..., timeout=
    budget)`` the test cannot reach), so ``expire_budget_when_reached`` has no
    call site to wrap. Before ``reached`` is set every such wait is open-ended
    (bounded only by ``_NEVER_REACHED_CEILING_S``); once it is set the wait expires
    ``timeout`` seconds later. A wait that starts after ``reached`` is already set
    is therefore an ordinary ``wait_for``. Several nested waits all arm at the same
    rendezvous and keep their relative order (the smallest timeout fires first), so
    a test that aims at the OUTER deadline or at one STAGE bound still hits the one
    it names.

    Scoped to the module namespace the test patches, never the global ``asyncio``,
    so no other module's timers are touched.

    A wait that expires while ``reached`` is still unset (the never-reached
    ceiling) FAILS the test rather than raising the ``TimeoutError`` the route
    maps to the very detail the test asserts. This also covers the deliberate
    never-set exemption below: that wait is not meant to expire at all, so a hang
    long enough to reach the ceiling is a failure there too.
    """

    def __init__(
        self, reached: asyncio.Event, only: Any = None, after: float | None = None
    ) -> None:
        self._reached = reached
        self._only = only
        self._after = after

    def __getattr__(self, name: str) -> Any:
        return getattr(asyncio, name)

    async def wait_for(self, awaitable: Any, timeout: float | None) -> Any:
        if timeout is None or (self._only is not None and not self._only(awaitable)):
            return await asyncio.wait_for(awaitable, timeout)
        loop = asyncio.get_running_loop()
        try:
            async with asyncio.timeout_at(
                loop.time() + _NEVER_REACHED_CEILING_S
            ) as budget:

                async def _arm_at_rendezvous() -> None:
                    await self._reached.wait()
                    budget.reschedule(
                        loop.time() + (timeout if self._after is None else self._after)
                    )

                watcher = asyncio.ensure_future(_arm_at_rendezvous())
                try:
                    return await awaitable
                finally:
                    watcher.cancel()
        except asyncio.TimeoutError:
            # FAILS CLOSED. This budget is only ever pulled in once ``reached`` is
            # set, so an expiry with it unset is the never-reached ceiling. The
            # route would map it to the very timeout detail the test asserts, so
            # fail with a ``BaseException`` (``pytest.fail``) that an
            # ``except Exception`` in the code under test cannot swallow.
            if budget.expired() and not self._reached.is_set():
                pytest.fail(
                    _never_reached_message("a rendezvous-armed wait_for"),
                    pytrace=False,
                )
            raise


def expire_module_budget_when_reached(
    monkeypatch: pytest.MonkeyPatch,
    module: Any,
    reached: asyncio.Event,
    *,
    only: Any = None,
    after: float | None = None,
) -> None:
    """Patch ``module.asyncio`` so every budget its ``wait_for`` enforces starts
    counting when ``reached`` is set (see ``_AsyncioWithRendezvousBudget``). Undone
    by ``monkeypatch`` at teardown.

    ``only``, if given, is a predicate on the awaited object; ``wait_for`` calls it
    does not accept are the real ``asyncio.wait_for``. Pass an event that is NEVER
    set to take one named wait out of the race altogether (it then never arms, and
    a hang that reaches the 30 s ceiling fails the test), while the module's other
    timers, such as a loop's pacing ``wait_for``, keep working.

    ``after``, if given, replaces the timeout of the waits ``only`` accepts: they
    expire ``after`` seconds past the rendezvous instead of ``timeout`` seconds. It
    lets a test bite ONE wait (the probe) without shrinking the module constant
    that its sibling waits (a ``close()`` in a ``finally``) also read.

    ``reached`` must be set from the event-loop thread; a worker thread bridges
    with ``loop.call_soon_threadsafe(reached.set)``.

    ``module`` must reach asyncio through the module-level name ``asyncio``;
    one that did ``from asyncio import wait_for`` would be unaffected and the
    test would then run on its real (stopwatch) budget.
    """
    monkeypatch.setattr(
        module, "asyncio", _AsyncioWithRendezvousBudget(reached, only, after)
    )
