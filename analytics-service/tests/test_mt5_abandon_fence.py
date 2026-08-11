"""153.5-05 / **D-37, guard #16** — the RUNTIME half, answering ONE question:

    is the abandon fence ENFORCED once the lease has moved on?

⭐ **TWO GUARDS, TWO QUESTIONS. This file is the half that static analysis
structurally cannot reach.**

| Guard | Question it answers | Can it catch abandonment? |
|---|---|---|
| `tests/test_mt5_abandon_roster.py` (D-36 static) | *"does every session-touching method CARRY the check?"* | ❌ never — and it must not be asked to |
| this file (D-37, guard #16) | *"is the check ENFORCED when the lease has moved on?"* | ✅ that is its only job |

⛔ **Why the ast roster cannot be extended to cover this.** Its enclosure proof is
LEXICAL: it answers "is this call WRITTEN inside the lease block?" — a syntactic
question. Abandonment is the case where work escapes its lexical block, which is
exactly what `asyncio.to_thread` + `asyncio.wait_for` do by construction. The
proof is concrete rather than theoretical:
`test_mt5_shutdown_roster.py::test_every_restart_call_site_holds_the_terminal_lease`
is **green on finding #5 today**, because the abandoned `restart` is written
inside the `async with` and merely RUNS outside it.

**The shape (D-37, verbatim).** The abandonment is SCHEDULED BY THE TEST, never by
the scheduler: a fake session records every touch into a shared ordered log, the
worker parks on a test-owned `threading.Event`, the local `wait_for` bound fires,
the harness unwinds, the lease releases and bumps the generation, THEN the test
sets the Event and the zombie proceeds. Every ordering claim is made on the log
INDEX relative to a release marker — ⛔ never on a wall-clock timestamp, which
would be a sleep-ordered race wearing a different hat, the fifth flake mechanism
this suite must not buy (it already carries four documented ones).

⛔ **Every wait in this file is BOUNDED**, under the rule the existing barriered
analog states (`test_mt5_derive_branch.py:958-967`): *a broken lock reds, never
hangs CI*. `asyncio.run` joins the default executor for
`THREAD_JOIN_TIMEOUT = 300`s, so an unbounded `Event.wait()` here would stall the
whole shard for five minutes instead of redding in under a second. The zombie
signals its own completion Event, the test joins on THAT, and every gate is set in
a `finally`.

**The negative control is EMBEDDED and permanent.** The same harness runs with the
fence neutered, and the post-release touch DOES land in the log. Without it, "no
post-release touch" is indistinguishable from a worker that never ran — and this
phase has already shipped one guard that could not see its own mutation (plan 02,
falsification D).

⚠️ **D-43's honest limit, stated rather than left for a reviewer to find.** The
fence cannot un-send a call already on the wire: `sync_request_timeout` is a purely
client-side TTL (verified against the pinned rpyc 5.2.3 wheel), so an in-flight
call completes server-side regardless. What this file proves is the post-release
REFUSAL — the zombie ARRIVING at a session touch after the release, which is the
common case. A zombie that had already dispatched its call is out of reach of any
client-side mechanism, and `_assert_expected_login`'s detection bracket stays for
exactly that residue.
"""
from __future__ import annotations

import asyncio
import threading
import time
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import patch

import pytest

from services import mt5_concurrency
from services.mt5_client import (
    Mt5Client,
    Mt5SessionAbandoned,
    _mt5_epoch_for,
)
from services.mt5_concurrency import mt5_terminal_lease
from tests.test_mt5_client_contract import _FakeMt5, _FakeNamedTuple

# --------------------------------------------------------------------------- #
# Bounds. Every one of them exists so a MIS-ORDERED TEST REDS FAST — none of them
# encodes an ordering. The ordering is set exclusively by the two Events.
# --------------------------------------------------------------------------- #

#: The LOCAL abandonment bound handed to `asyncio.wait_for`. ⭐ A local literal on
#: purpose: patching a module constant here would risk the E2 patch-target trap
#: (`test_mt5_derive_branch.py:882-890` — patching a merely RE-EXPORTED name is a
#: SILENT no-op that leaves the real bound in force while the test reports green).
#: Nothing is patched, so nothing can be mis-aimed.
_ABANDON_BOUND_S = 0.05

#: The zombie's bounded park. 5x the abandonment bound, so the sequence
#: "bound fires → lease releases → marker → gate set" completes with a wide margin
#: — and if the test ever failed to release the barrier, the worker proceeds on
#: its own after this and the run REDS instead of hanging.
_BARRIER_BOUND_S = 0.25

#: Bounded wait for the worker to reach the barrier, and for the zombie to finish.
#: ⭐ The arrival wait removes the ONLY genuine nondeterminism in this test —
#: thread-pool start latency on a loaded CI box, which could otherwise beat the
#: 50ms bound and invert the whole ordering. It is NOT a sleep-ordered wait: the
#: ordering is decided by the Event, and the 5ms poll only decides how quickly the
#: loop notices.
_ARRIVAL_BOUND_S = 2.0
_COMPLETION_BOUND_S = 2.0

#: The sentinel appended to the shared log the instant the lease has released.
#: ⭐ Ordering is asserted as "index relative to this marker", never as a
#: comparison of two `time.monotonic()` readings.
_RELEASE_MARKER = "<lease released>"

_HOST, _PORT = "spy-gateway", 18812
_TERMINAL_KEY = f"{_HOST}:{_PORT}"


@pytest.fixture(autouse=True)
def _reset_terminal_state():
    """The ONE shared per-terminal reset (plan 153.5-01), never a sixth
    hand-rolled `.clear()`. This module BUMPS a terminal's generation; a bump
    leaked into the next test fences a client built for the same `host:port`, and
    under `-n auto --dist loadgroup` that is a sixth flake mechanism in a suite
    that already carries five documented ones."""
    mt5_concurrency.reset_terminal_state_for_tests()
    yield
    mt5_concurrency.reset_terminal_state_for_tests()


# --------------------------------------------------------------------------- #
# The spy session
# --------------------------------------------------------------------------- #


class _SpyMt5(_FakeMt5):
    """The shipped offline double, SUBCLASSED, with every session touch recorded
    into a SHARED ordered log as `(method, epoch_seen)`.

    Subclassed rather than reinvented, per the D-35 commit's own discipline ("fake
    transports in 4 test modules gained a counting `_MetaTrader5__conn`, so no test
    silently exercises the 'no transport close reachable' WARNING branch") — a
    second, differently-shaped double is a second contract that will diverge from
    the one the rest of the suite asserts against.

    `epoch_seen` is read at the MOMENT of the touch, so the log answers the
    question the fence exists for: *did a touch land while the terminal was on a
    generation this session was never bound to?*

    ⚠️ The log is appended from a worker thread and read from the event loop.
    `list.append` is atomic under the GIL and the existing barriered analog relies
    on exactly that (`_OrderedMt5Transport._order`) — but it is read ONLY after the
    zombie's done-Event round-trip, never while the zombie may still be running.
    """

    def __init__(
        self,
        scenario: dict,
        *,
        log: list[tuple[str, int]],
        gate: threading.Event,
        entered: threading.Event,
        gate_releases: list[bool],
    ) -> None:
        super().__init__(scenario)
        self._log = log
        self._gate = gate
        self._entered = entered
        self._gate_releases = gate_releases

    def _record(self, method: str) -> None:
        self._log.append((method, _mt5_epoch_for(_TERMINAL_KEY)))

    def initialize(self, **kwargs: Any) -> Any:
        self._record("initialize")
        return super().initialize(**kwargs)

    def login(self, login: Any, **kwargs: Any) -> Any:
        self._record("login")
        # ⭐ THE BARRIER. The worker announces its arrival and then parks until the
        # TEST releases it — which the test only does after the lease has released
        # and the generation has been bumped. That is what makes the abandonment
        # scheduled rather than raced.
        #
        # `.wait(timeout)`, never `.wait()`: a test that failed to release this
        # must RED in a quarter of a second, not stall the shard for the 300s the
        # default executor is joined for. `gate_releases` records WHICH of the two
        # happened, so a timeout-driven proceed is reported as a broken test rather
        # than silently reinterpreted as a product verdict.
        self._entered.set()
        self._gate_releases.append(self._gate.wait(_BARRIER_BOUND_S))
        return super().login(login, **kwargs)

    def account_info(self) -> Any:
        self._record("account_info")
        return super().account_info()


# --------------------------------------------------------------------------- #
# The harness
# --------------------------------------------------------------------------- #


@dataclass
class _Run:
    """Everything one abandoned-probe run observed. Assertions are made on THIS,
    never on a live object, so the zombie can never be read mid-flight."""

    log: list[tuple[str, int]] = field(default_factory=list)
    outcomes: list[BaseException | None] = field(default_factory=list)
    gate_releases: list[bool] = field(default_factory=list)
    epoch_before: int = -1
    epoch_after: int = -1
    bound_fired: bool = False
    ticks: int = 0
    release_ticks: int = 0
    release_elapsed_s: float = 0.0

    @property
    def marker_index(self) -> int:
        indices = [i for i, (m, _) in enumerate(self.log) if m == _RELEASE_MARKER]
        assert len(indices) == 1, (
            f"expected exactly ONE {_RELEASE_MARKER!r} in the touch log, found "
            f"{len(indices)}: {self.log}"
        )
        return indices[0]

    @property
    def touches_before_release(self) -> list[tuple[str, int]]:
        return self.log[: self.marker_index]

    @property
    def touches_after_release(self) -> list[tuple[str, int]]:
        return self.log[self.marker_index + 1 :]


async def _await_flag(flag: threading.Event, bound_s: float, what: str) -> None:
    """Wait for a worker-thread Event from the event loop, BOUNDED, without
    blocking the loop.

    ⛔ Not a sleep-ordered wait: the ordering is decided by the Event and the 5ms
    poll only decides how quickly the loop notices. The bound exists so a
    mis-ordered test reds in under a second rather than stalling the suite.
    """
    deadline = time.monotonic() + bound_s
    while not flag.is_set():
        assert time.monotonic() < deadline, (
            f"{what} within {bound_s}s. This is the TEST's own scheduling gate, "
            "not a product verdict — it is bounded on purpose so a mis-ordered "
            "harness reds fast instead of stalling the shard for the 300s "
            "asyncio.run joins the default executor for."
        )
        await asyncio.sleep(0.005)


async def _run_abandoned_probe(*, neuter_fence: bool) -> _Run:
    """Drive ONE abandoned-`to_thread` probe end to end and return what it did.

    The object under test is a REAL `Mt5Client` over the shipped `_connect=` seam,
    driven through the REAL `mt5_terminal_lease` — the two things whose interaction
    IS the property. Only the transport is a double.

    ⭐ ONE CONTROL, ONE VARIABLE. `neuter_fence` replaces `Mt5Client._assert_live`
    with a no-op and changes NOTHING else. The patch names the class object this
    module imported from `services.mt5_client`, which is the same object the
    instance dispatches through — there is no re-exported name here to mis-aim
    (the E2 trap).

    The client is built OUTSIDE the lease, deliberately: that is the preflight
    shape (`job_worker._make_mt5_session`), it carries no occupancy token, and it
    keeps this test about the METHOD fence alone. The CONSTRUCTION fence is a
    different mechanism with its own cases in `tests/test_mt5_client_contract.py`.
    """
    run = _Run()
    gate = threading.Event()
    entered = threading.Event()
    done = threading.Event()

    fake = _SpyMt5(
        {"account": _FakeNamedTuple(equity=110_500.0, balance=110_500.0, login=123456)},
        log=run.log,
        gate=gate,
        entered=entered,
        gate_releases=run.gate_releases,
    )

    def _connect(*, host: str, port: int, timeout: float) -> Any:
        return fake

    client = Mt5Client(_HOST, _PORT, _connect=_connect)

    def _probe() -> None:
        """The abandoned body. `login` binds this session's generation and parks;
        `account_info` is the touch that happens AFTER the lease has moved on."""
        try:
            client.login(123456, "hunter2", "Broker-Demo")
            client.account_info()
        except BaseException as exc:  # noqa: BLE001 — recorded, then re-examined
            run.outcomes.append(exc)
        else:
            run.outcomes.append(None)
        finally:
            done.set()

    ticks = {"n": 0}

    async def _ticker() -> None:
        while True:
            ticks["n"] += 1
            await asyncio.sleep(0.01)

    ticker_task = asyncio.create_task(_ticker())
    probe_task: asyncio.Task[None] | None = None
    try:
        with patch.object(
            Mt5Client,
            "_assert_live",
            (lambda self, stage: None) if neuter_fence else Mt5Client._assert_live,
        ):
            run.epoch_before = _mt5_epoch_for(_TERMINAL_KEY)
            async with mt5_terminal_lease(_TERMINAL_KEY):
                # Spawned INSIDE the lease — the defect's shape exactly.
                probe_task = asyncio.ensure_future(asyncio.to_thread(_probe))
                # ⭐ The worker's ARRIVAL is a precondition of applying the bound.
                # Without this, thread-pool start latency could exceed 50ms on a
                # loaded box, the bound would fire before the worker bound its
                # generation, and the zombie's FIRST touch would legitimately bind
                # the NEW generation — inverting the whole scenario. The bound
                # below is still a real `wait_for` on a real `to_thread` future.
                await _await_flag(
                    entered,
                    _ARRIVAL_BOUND_S,
                    "the worker never reached the barrier",
                )
                try:
                    await asyncio.wait_for(probe_task, timeout=_ABANDON_BOUND_S)
                except asyncio.TimeoutError:
                    run.bound_fired = True
                # Snapshot taken at the moment the caller gives up, so the
                # loop-liveness measurement can isolate the RELEASE window — the
                # window the ⛔ REJECTED "hold the lease until the worker confirms
                # it stopped" design would block the loop for (WEDGE-01).
                ticks_at_bound = ticks["n"]
                released_from = time.monotonic()
            run.release_elapsed_s = time.monotonic() - released_from
            run.release_ticks = ticks["n"] - ticks_at_bound
            run.epoch_after = _mt5_epoch_for(_TERMINAL_KEY)

            # The marker goes in BEFORE the gate is released, so its index is
            # deterministic: the zombie provably cannot append anything between
            # these two statements — it is parked.
            run.log.append((_RELEASE_MARKER, run.epoch_after))
            gate.set()
            await _await_flag(
                done, _COMPLETION_BOUND_S, "the zombie never finished"
            )
    finally:
        # ⛔ EVERY gate set in a `finally`. If an assertion above fires while the
        # zombie is parked, this is what stops the worker thread outliving the test
        # by the full barrier bound.
        gate.set()
        ticker_task.cancel()
        if probe_task is not None:
            await asyncio.gather(probe_task, return_exceptions=True)
    run.ticks = ticks["n"]
    return run


# --------------------------------------------------------------------------- #
# Guard #16
# --------------------------------------------------------------------------- #


async def test_a_zombies_post_release_touch_is_refused_and_the_control_proves_it() -> (
    None
):
    """⭐ GUARD #16 (D-37). Work abandoned by its `wait_for` cannot touch the MT5
    session once the lease it operated under has released — and the same harness
    with the fence neutered shows the touch landing, so the positive assertion is
    provably non-vacuous.

    The oracle is the recorded TOUCH LOG, never "the expected exception was
    raised". A refusal that raised the right type while the call still reached the
    terminal would satisfy an exception-shaped assertion perfectly; only the log
    can say whether the shared IPC pipe was touched. (This is also why the
    exception assertions come LAST: a half-fix must red on the HARM, not on a
    type.)
    """
    run = await _run_abandoned_probe(neuter_fence=False)

    # -- the scenario really happened (non-vacuity, before any verdict) --------
    assert run.bound_fired, (
        "the `wait_for` bound never fired, so nothing was abandoned and this run "
        "proves nothing. The worker parks on a test-owned Event for "
        f"{_BARRIER_BOUND_S}s and the bound is {_ABANDON_BOUND_S}s — if this "
        "reds, the barrier was released early."
    )
    assert run.gate_releases == [True], (
        "the zombie's barrier TIMED OUT instead of being released by the test "
        f"(gate_releases={run.gate_releases}). The ordering this case asserts was "
        "never established, so its verdict is meaningless."
    )
    assert run.epoch_after == run.epoch_before + 1, (
        f"the lease did not bump the terminal generation on release "
        f"({run.epoch_before} -> {run.epoch_after}). The fence has nothing to "
        "compare against and every assertion below is vacuous."
    )
    assert (
        "login",
        run.epoch_before,
    ) in run.touches_before_release, (
        "the zombie never bound its generation under the OLD lease "
        f"(pre-release touches: {run.touches_before_release}). 'No touch after "
        "the release' would then be satisfied by a worker that never ran at all."
    )

    # -- THE PROPERTY ---------------------------------------------------------
    assert run.touches_after_release == [], (
        "a session touch landed AFTER the lease released: "
        f"{run.touches_after_release} (full ordered log: {run.log}). The MT5 "
        "gateway serves every rpyc connection from ONE ThreadedServer over ONE "
        "MetaTrader5 instance holding ONE IPC pipe, so a touch made under the "
        "NEXT holder's lease is that holder's session — a re-`login()` re-points "
        "the shared terminal onto another account, and a `shutdown()` answers it "
        "`-10004 No IPC connection` (WIZFORM-ABANDON / D-36)."
    )
    assert not any(
        epoch == run.epoch_after for _method, epoch in run.touches_after_release
    ), "a post-release touch carried the LIVE generation — the fence let it through"

    # …and the zombie learned about it, loudly and as itself.
    assert len(run.outcomes) == 1, run.outcomes
    refusal = run.outcomes[0]
    assert isinstance(refusal, Mt5SessionAbandoned), (
        f"the zombie's own outcome was {refusal!r}, expected Mt5SessionAbandoned. "
        "A refusal absorbed into an Mt5ClientError would be classifiable as a "
        "USER fault (D-42), and a silent no-op would reproduce the silent-UNKNOWN "
        "class this milestone has spent four phases closing (D-36)."
    )
    assert refusal.stage == "account_info", refusal.stage

    # -- TEETH: the EMBEDDED negative control, permanently ---------------------
    # Neuter `_assert_live` and NOTHING else. The post-release touch must LAND —
    # otherwise "no post-release touch" is a claim the harness makes about itself.
    neutered = await _run_abandoned_probe(neuter_fence=True)
    assert neutered.bound_fired and neutered.gate_releases == [True]
    assert neutered.epoch_after == neutered.epoch_before + 1
    assert neutered.touches_after_release == [
        ("account_info", neutered.epoch_after)
    ], (
        "with the fence neutered the post-release touch MUST land (else the "
        "positive assertion above is vacuous — a worker that silently never ran "
        f"would satisfy it too); got {neutered.touches_after_release} from the "
        f"full log {neutered.log}"
    )
    assert neutered.outcomes == [None], (
        "with the fence neutered the abandoned probe must COMPLETE — the harness "
        f"itself must not be what stops it; got {neutered.outcomes}"
    )


async def test_the_release_does_not_block_the_event_loop_on_the_zombie() -> None:
    """⛔ The REJECTED design, guarded against: *"refuse to release the lease until
    the worker confirms it stopped"* (D-36).

    Correct in isolation, wrong in system — it holds the terminal for as long as
    the hung thread, which is the WEDGE-01 class D-25 forbids and which this
    project has already paid for once (PR #632: heavy pandas on the shared loop
    froze healthz). The hang would propagate from one job to every subsequent
    lease waiter.

    ⚠️ A bare `ticks > 0` cannot see this and is NOT the assertion here: the
    ticker has already accumulated ticks during the bound's own 50ms before the
    release is ever reached, so it stays green under the rejected design. The
    discriminator is the RELEASE WINDOW specifically — under the accepted design
    the release is instantaneous, while a release that joined the zombie would
    block the loop for the full barrier bound (the test cannot release the barrier
    until the `async with` has returned, so the join is a deadlock bounded only by
    `_BARRIER_BOUND_S`) and would accumulate ZERO ticks across it.
    """
    run = await _run_abandoned_probe(neuter_fence=False)

    assert run.ticks > 0, (
        "the event loop never advanced during the abandoned probe — the session "
        "work is not running off the loop at all (`asyncio.to_thread`), so a hung "
        "terminal blocks FastAPI and healthz (WEDGE-01 / D-25)."
    )
    assert run.release_ticks > 0 or run.release_elapsed_s < _ABANDON_BOUND_S, (
        f"releasing the lease blocked the event loop for "
        f"{run.release_elapsed_s:.3f}s and the 10ms ticker advanced "
        f"{run.release_ticks} times across it. That is the ⛔ REJECTED "
        "'hold the lease until the worker confirms it stopped' design: it wedges "
        "the terminal for as long as the hung thread and propagates the hang to "
        "every subsequent lease waiter (WEDGE-01). The fence refuses the zombie's "
        "TOUCHES; it must never wait for the zombie."
    )
