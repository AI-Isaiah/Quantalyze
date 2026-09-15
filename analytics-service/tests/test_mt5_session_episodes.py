"""Phase 164.6.4 (MT5KEEPALIVE) plan 04 — THE DATASET-HONESTY GATES.

⭐ THE DATASET IS THE DELIVERABLE. This phase exists so a LATER decision can
choose the keepalive interval against MORE THAN ONE measured session lifetime,
and every property that makes those rows trustworthy is gated here: that a row
means a TRANSITION and not a tick; that an analytics deploy cannot silently
shorten a lifetime; that a reading which measured NOTHING never closes an
episode; that two overlapping Railway containers cannot leave an invisible
orphan; and — the biggest threat to the whole dataset — that the limit on what a
reading can attribute travels WITH the row rather than living in prose somebody
will not read.

⛔ HOW THIS SUITE DIFFERS FROM THE EPISODE TESTS IN ``tests/test_mt5_relogin.py``
AND WHY BOTH EXIST. Those are END-TO-END: they drive the real
``heal_mt5_terminal_session`` and prove the wiring. These drive
``record_mt5_session_reading`` DIRECTLY, so they can reach states the heal cannot
produce on demand — three simultaneously open rows, a row whose
``schema_version`` nothing recognises, a read that raises while a write does not,
a blind run six readings long. A property only reachable through a five-layer
path is a property that will be tested once and never again.

⭐ THE WRITE LIST IS THE LEVER. Every assertion about "a tick wrote nothing" is
made against an ORDERED list of every write the transport received, asserted
EMPTY rather than merely short — at a ten-minute cadence a per-tick write is
~144 rows a day, forever, into a shared and gated table, for no information.

⛔ THE HARNESS IS REUSED, NEVER COPIED. ``_FakeCronRuns`` honours every ``.eq()``
on an UPDATE, which is the only reason the compare-and-set and its absence are
distinguishable at all; a second copy of it here would be the drift shape this
repo has a dated record of. It is SUBCLASSED for the two things this suite needs
and that one does not: an ordered write log, and a hook that lands another
container's write BETWEEN our read and our write.
"""

from __future__ import annotations

import ast
import inspect
import logging
import math
import textwrap
from typing import Any, Callable

import pytest

from services import mt5_relogin, mt5_session_episodes, mt5_session_monitor
from tests.test_mt5_relogin import (
    _FAKE_HOST,
    _FAKE_LOGIN,
    _FAKE_PASSWORD,
    _FAKE_PORT,
    _FAKE_SERVER,
    _HEAL_GUARD_MUTANTS,
    _FakeCronRuns,
    _assert_no_secret_reached_any_row,
    _heal_guard_defects,
    _seed_open_row,
)

_LOGGER_NAME = "quantalyze.analytics.mt5_session_episodes"

#: The monitor's own source label — the caller these rows actually come from in
#: production. ⛔ Taken by SYMBOL so a retune of the label carries through.
_SOURCE = mt5_relogin.HEAL_SOURCE_SESSION_MONITOR

#: The monitor's DEFAULT detection cadence, by symbol. Every threshold in this
#: file is RECOMPUTED from it rather than hand-typed.
_CADENCE_S = mt5_session_monitor._MT5_SESSION_POLL_INTERVAL_DEFAULT_S


# --------------------------------------------------------------------------- #
# The harness — the shipped fake, SUBCLASSED twice.
# --------------------------------------------------------------------------- #


class _OrderedCronRuns(_FakeCronRuns):
    """``_FakeCronRuns`` plus ONE ORDERED LIST OF EVERY WRITE.

    ⭐ ``inserts`` and ``updates`` are separate lists on the shipped fake, so
    "exactly the close and then the open, IN THAT ORDER" is not expressible with
    them — and order is the whole content of the transition claim: an open that
    preceded its close would leave two rows open for the width of the operation
    and is a different (broken) implementation.

    ``after_select`` lands ANOTHER CONTAINER'S WRITE between our read and our
    write. That interleave is not reachable any other way: the window a
    compare-and-set closes is exactly the gap between those two statements, so a
    harness that cannot open that gap cannot tell the guarded implementation from
    the unguarded one — and a harness that cannot tell them apart is one that
    certifies the bug.
    """

    def __init__(self) -> None:
        super().__init__()
        self.writes: list[str] = []
        self.after_select: Callable[[], None] | None = None

    def table(self, name: str) -> Any:
        query = super().table(name)
        original = query.execute

        def _execute() -> Any:
            result = original()
            if query._op in ("insert", "update"):
                self.writes.append(query._op)
            elif query._op == "select" and self.after_select is not None:
                # ⛔ FIRED ONCE, and AFTER the rows have been computed: the
                # caller now holds a STALE copy, which is precisely container
                # B's situation.
                callback, self.after_select = self.after_select, None
                callback()
            return result

        query.execute = _execute  # type: ignore[method-assign]
        return query


class _RaisingCronRuns(_OrderedCronRuns):
    """A transport that raises on the chosen operations and on no others.

    ⭐ READ-ONLY and WRITE-ONLY faults are SEPARATE cases, not one "the sink is
    down" case: a recorder can be guarded around its read and unguarded around
    its write (or the reverse) and look fine under a total outage.
    """

    def __init__(self, *, fail_ops: frozenset[str]) -> None:
        super().__init__()
        self.fail_ops = fail_ops

    def table(self, name: str) -> Any:
        query = super().table(name)
        original = query.execute

        def _execute() -> Any:
            if query._op in self.fail_ops:
                raise RuntimeError(f"supabase is unreachable ({query._op})")
            return original()

        query.execute = _execute  # type: ignore[method-assign]
        return query


@pytest.fixture
def sink(monkeypatch: pytest.MonkeyPatch) -> Any:
    fake = _OrderedCronRuns()
    monkeypatch.setattr(mt5_session_episodes, "get_supabase", lambda: fake)
    mt5_session_episodes._reset_session_episode_state_for_tests()
    yield fake
    mt5_session_episodes._reset_session_episode_state_for_tests()


def _install_sink(monkeypatch: pytest.MonkeyPatch, fake: _FakeCronRuns) -> None:
    monkeypatch.setattr(mt5_session_episodes, "get_supabase", lambda: fake)


def _seed_closed_row(
    fake: _FakeCronRuns,
    state: str,
    *,
    measured: bool,
    row_id: str,
    completed_at: str = "2026-09-15T01:00:00+00:00",
) -> dict:
    """A run that is ALREADY CLOSED when the tick arrives.

    ``measured`` picks the two ends of the discriminator this phase adds: a
    genuinely measured close (which a successor COUNTS) and a superseded one
    (which it must not).
    """
    row = _seed_open_row(fake, state, id=row_id)
    metadata = dict(row["metadata"])
    metadata.update(
        {
            "closed_by": _SOURCE,
            "closing_kind": (
                mt5_session_episodes.KIND_NO_AUTHORIZED_ACCOUNT
                if measured
                else mt5_session_episodes.KIND_SUPERSEDED
            ),
            "closing_code": -6 if measured else None,
            "close_is_measured": measured,
        }
    )
    if not measured:
        metadata["completed_at_is_notice_time"] = True
    row["metadata"] = metadata
    row["completed_at"] = completed_at
    row["status"] = (
        "ok" if (measured and state == mt5_session_episodes.STATE_AUTHORIZED)
        else "error"
    )
    return row


# The four readings this suite drives, named rather than re-spelled per test.
_AUTHORIZED_READING = (mt5_session_episodes.KIND_ALREADY_AUTHORIZED, None)
_DARK_READING = (mt5_session_episodes.KIND_NO_AUTHORIZED_ACCOUNT, -6)
_BUSY_READING = (mt5_session_episodes.KIND_BUSY_SKIP, None)
_BUDGET_READING = (mt5_session_episodes.KIND_BUDGET_ABANDONED, None)
_ZERO_CODE_READING = (mt5_session_episodes.KIND_IPC_FAULT, 0)


async def _observe(
    reading: tuple[str, int | None],
    *,
    source: str = _SOURCE,
    poll_interval_s: float | None = _CADENCE_S,
) -> None:
    kind, code = reading
    await mt5_session_episodes.record_mt5_session_reading(
        kind, code, source=source, poll_interval_s=poll_interval_s
    )


def _records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == _LOGGER_NAME]


def _warnings(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in _records(caplog) if r.levelno >= logging.WARNING]


# --------------------------------------------------------------------------- #
# (a) PER TRANSITION, NEVER PER TICK
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "state,reading",
    [
        pytest.param(
            mt5_session_episodes.STATE_AUTHORIZED, _AUTHORIZED_READING, id="authorized"
        ),
        pytest.param(mt5_session_episodes.STATE_DARK, _DARK_READING, id="dark"),
    ],
)
async def test_a_tick_that_observes_the_ALREADY_RECORDED_state_writes_NOTHING(
    sink: _OrderedCronRuns, state: str, reading: tuple[str, int | None]
) -> None:
    """⭐ THE ANTI-VACUITY LEG MATTERS MORE THAN THE POSITIVE ONE.

    The write list is asserted EMPTY, not merely short. At the ten-minute
    detection cadence a per-tick write is about 144 rows a day, forever, into a
    SHARED and gated table, for no information at all — and the sink's entire
    value is that a row means something CHANGED.
    """
    seeded = _seed_open_row(sink, state)

    await _observe(reading)

    assert sink.writes == [], (
        f"a tick observing the already-recorded {state!r} state wrote "
        f"{sink.writes} — the sink is per-TRANSITION, never per-tick"
    )
    assert sink.inserts == []
    assert sink.updates == []
    assert seeded["status"] == "running"
    assert seeded["completed_at"] is None
    assert len(sink.open_rows()) == 1


@pytest.mark.parametrize(
    "seeded_state,reading,opened_state,closing_kind,closing_code",
    [
        pytest.param(
            mt5_session_episodes.STATE_AUTHORIZED,
            _DARK_READING,
            mt5_session_episodes.STATE_DARK,
            mt5_session_episodes.KIND_NO_AUTHORIZED_ACCOUNT,
            -6,
            id="authorized-to-dark",
        ),
        pytest.param(
            mt5_session_episodes.STATE_DARK,
            _AUTHORIZED_READING,
            mt5_session_episodes.STATE_AUTHORIZED,
            mt5_session_episodes.KIND_ALREADY_AUTHORIZED,
            None,
            id="dark-to-authorized",
        ),
    ],
)
async def test_a_TRANSITION_writes_EXACTLY_TWO_WRITES_the_close_THEN_the_open(
    sink: _OrderedCronRuns,
    seeded_state: str,
    reading: tuple[str, int | None],
    opened_state: str,
    closing_kind: str,
    closing_code: int | None,
) -> None:
    """⛔ THE ORDER IS PART OF THE CLAIM. An open that preceded its close would
    leave TWO rows open for the width of the operation — a different
    implementation, and one whose orphan the next tick would then supersede,
    silently converting every transition into an anomaly."""
    seeded = _seed_open_row(sink, seeded_state)

    await _observe(reading)

    assert sink.writes == ["update", "insert"], (
        f"a transition must be exactly the CLOSE then the OPEN, got {sink.writes}"
    )
    assert seeded["status"] != "running", "the old run was left open"
    assert sink.metadata(seeded)["state"] == seeded_state
    assert sink.metadata(seeded)["close_is_measured"] is True
    assert sink.metadata(seeded)["closing_kind"] == closing_kind
    assert sink.metadata(seeded)["closing_code"] == closing_code

    opened = sink.open_rows()
    assert len(opened) == 1, "at most ONE open row per cron_name"
    assert sink.metadata(opened[0])["state"] == opened_state


async def test_the_EMPTY_write_list_assertion_can_actually_fail(
    sink: _OrderedCronRuns,
) -> None:
    """⛔ THE CALIBRATION FOR THE ASSERTION ABOVE, IN-SUITE.

    ``assert sink.writes == []`` is indistinguishable from a harness that never
    records a write at all. This drives a reading that MUST write, against the
    same fixture, so the empty-list assertions above are known to be capable of
    failing rather than merely observed passing.
    """
    _seed_open_row(sink, mt5_session_episodes.STATE_AUTHORIZED)
    await _observe(_DARK_READING)
    assert sink.writes, "the harness recorded no write for a real transition"


# --------------------------------------------------------------------------- #
# (b) THE OPEN EPISODE IS RE-READ, NOT REMEMBERED
# --------------------------------------------------------------------------- #


async def test_the_open_episode_is_RE_READ_from_the_database_every_observation(
    sink: _OrderedCronRuns,
) -> None:
    """⭐ THE DATABASE IS THE STATE, AND THE NUMBER THIS PROTECTS IS THE ONE THE
    PHASE EXISTS FOR.

    Railway deploys analytics on EVERY green ``main`` CI, so a process-memory
    ``authorized_since`` would be reset several times a day and every recorded
    lifetime would be biased SHORT — corrupting the exact quantity a successor
    chooses the keepalive interval from.

    Here the recorder takes a reading, then EVERY piece of module state it holds
    is discarded (the redeploy, expressed), and the next reading must still
    continue the SEEDED run rather than open a second one.
    """
    seeded = _seed_open_row(sink, mt5_session_episodes.STATE_AUTHORIZED, id="seeded")

    await _observe(_AUTHORIZED_READING)
    assert sink.writes == []

    # THE REDEPLOY: every module-level name the recorder mutates, cleared.
    mt5_session_episodes._reset_session_episode_state_for_tests()
    assert mt5_session_episodes._LAST_MEASURED_READING_MONOTONIC is None
    assert mt5_session_episodes._CONSECUTIVE_NOT_MEASURED_READINGS == 0

    await _observe(_DARK_READING)

    assert seeded["status"] == "ok", (
        "the observation after the state discard did not continue the SEEDED "
        "run — a recorder that remembered the episode in process memory would "
        "have opened a SECOND run and truncated this lifetime"
    )
    assert sink.metadata(seeded)["close_is_measured"] is True
    assert len(sink.open_rows()) == 1
    assert sink.lifetime_dataset() == ["seeded"]


def _module_globals_mutated(source: str) -> set[str]:
    """Every module-level name any function in ``source`` REBINDS."""
    return {
        name
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Global)
        for name in node.names
    }


#: ⭐ THE CLOSED SET, each entry with the reason it is NOT episode state. The
#: boot re-read D-5 demands is satisfied BY CONSTRUCTION — by there being nothing
#: to re-read INTO — rather than by remembering to do it, and this is the
#: assertion that keeps it that way.
_DECLARED_MUTABLE_MODULE_GLOBALS = {
    "_LAST_MEASURED_READING_MONOTONIC": (
        "a monotonic stamp of the PREVIOUS READING, used to measure a GAP. It "
        "names no episode, no row and no state, and losing it costs one "
        "`since_previous_reading_s` (recorded as `first_reading_after_boot`)."
    ),
    "_CONSECUTIVE_NOT_MEASURED_READINGS": (
        "the blind-run counter. It gates a LOG LEVEL and never a dataset value, "
        "so a redeploy resetting it costs a late escalation and nothing else."
    ),
}


def test_the_module_holds_NO_EPISODE_STATE_AT_ALL_by_construction() -> None:
    """⛔ STRUCTURAL, AND DELIBERATELY NOT A BEHAVIOUR TEST.

    A behaviour test proves the CURRENT code re-reads; it cannot prevent a future
    edit from caching the open row "to save a round-trip", which would reinstate
    the deploy-truncation bias silently and pass every other test in this file
    (the cache would be warm within one tick). This asserts the SHAPE: the only
    module-level names any function rebinds are the two declared bookkeeping
    counters, and after a full transition each holds a NUMBER — so none of them
    can be holding a row, a row id, a state or a transition timestamp.
    """
    source = inspect.getsource(mt5_session_episodes)
    assert _module_globals_mutated(source) == set(_DECLARED_MUTABLE_MODULE_GLOBALS), (
        "the recorder rebinds a module-level name that is not one of the two "
        "declared counters. ⛔ If it is episode state, an analytics redeploy now "
        "truncates a session lifetime; if it is not, add it to "
        "`_DECLARED_MUTABLE_MODULE_GLOBALS` WITH the reason it cannot be."
    )


async def test_no_declared_module_global_can_hold_a_row_a_state_or_a_timestamp(
    sink: _OrderedCronRuns,
) -> None:
    """The behavioural half of the assertion above: after a full transition, each
    declared global holds a NUMBER or ``None`` — never a dict, a string or a
    list, which is what a cached row, a cached state or a cached stamp would be.
    """
    _seed_open_row(sink, mt5_session_episodes.STATE_AUTHORIZED)
    await _observe(_DARK_READING)
    await _observe(_BUSY_READING)

    for name in _DECLARED_MUTABLE_MODULE_GLOBALS:
        value = getattr(mt5_session_episodes, name)
        assert value is None or isinstance(value, (int, float)), (
            f"{name} holds {type(value).__name__} — a module global that can "
            f"hold a row, a state or a timestamp IS episode state, and a "
            f"redeploy resetting it biases every lifetime SHORT"
        )


def test_the_module_global_scanner_BITES() -> None:
    """⛔ THE CALIBRATION. A scanner that returned the empty set would make the
    assertion above pass over ANY amount of cached episode state."""
    source = inspect.getsource(mt5_session_episodes)
    anchor = "    global _CONSECUTIVE_NOT_MEASURED_READINGS"
    assert anchor in source, (
        f"the mutation anchor {anchor!r} is gone — the mutant would not apply "
        "and this calibration would pass VACUOUSLY"
    )
    mutated = source.replace(
        anchor, f"    global _OPEN_EPISODE_ROW\n{anchor}", 1
    )
    assert mutated != source
    found = _module_globals_mutated(mutated)
    assert "_OPEN_EPISODE_ROW" in found, found
    assert found != set(_DECLARED_MUTABLE_MODULE_GLOBALS), (
        "a cached open row was spliced in and the closed-set assertion still "
        "held — the gate cannot fire"
    )


# --------------------------------------------------------------------------- #
# (b2) A SECOND CONCURRENT WRITER, AND THE ORPHAN IT LEAVES
# --------------------------------------------------------------------------- #


async def test_THREE_open_rows_collapse_to_EXACTLY_ONE_so_the_read_is_not_limit_1(
    sink: _OrderedCronRuns, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ THE CASE A ``limit 1`` READ LEAVES ORPHANED FOREVER, AND A TWO-ROW TEST
    CANNOT SEE.

    A read that took ONE row and self-healed would pass a two-row test by closing
    the second-newest and leaving the THIRD open with a null ``completed_at`` for
    the life of the table. Nothing ever looks back far enough to find it again,
    and the episode it represents is LOST from the very lifetime dataset
    criterion 1 exists to build.

    ⭐ The reading here matches the NEWEST row's state on purpose: there is no
    transition to write, so a recorder that returned early on "nothing changed"
    would never reach the orphan at all.
    """
    oldest = _seed_open_row(
        sink,
        mt5_session_episodes.STATE_DARK,
        id="oldest",
        started_at="2026-09-15T00:00:00+00:00",
    )
    middle = _seed_open_row(
        sink,
        mt5_session_episodes.STATE_AUTHORIZED,
        id="middle",
        started_at="2026-09-15T01:00:00+00:00",
    )
    newest = _seed_open_row(
        sink,
        mt5_session_episodes.STATE_DARK,
        id="newest",
        started_at="2026-09-15T02:00:00+00:00",
    )

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await _observe(_DARK_READING)

    assert sink.inserts == [], "nothing TRANSITIONED, so nothing may be opened"
    assert newest["status"] == "running", "the NEWEST row is the live one"
    assert newest["completed_at"] is None

    for orphan in (oldest, middle):
        assert orphan["status"] == "error", (
            f"{orphan['id']} was left open — a `limit 1` read closes at most "
            f"one stale row and orphans the rest"
        )
        assert (
            sink.metadata(orphan)["closing_kind"]
            == mt5_session_episodes.KIND_SUPERSEDED
        )
        assert sink.metadata(orphan)["close_is_measured"] is False
        assert orphan["error"] == mt5_session_episodes.KIND_SUPERSEDED

    assert len(sink.open_rows()) == 1, (
        f"{len(sink.open_rows())} open rows survived; the invariant is EXACTLY "
        f"one per cron_name, not 'at least one'"
    )
    assert sink.lifetime_dataset() == [], (
        "an orphan reached the lifetime dataset as a measured episode"
    )
    assert any(
        "3 open rows" in r.getMessage() for r in _warnings(caplog)
    ), [r.getMessage() for r in _warnings(caplog)]


async def test_the_ONE_OPEN_ROW_invariant_is_restored_by_the_WRITE_not_a_lucky_read(
    sink: _OrderedCronRuns,
) -> None:
    """⭐ A ROW THAT APPEARED BETWEEN OUR READ AND OUR WRITE.

    Restoring the invariant only in ``record_mt5_session_reading``'s read would
    leave the window between that read and the insert unguarded — which is
    exactly the window a second container's open lands in. ``_open_row`` is
    driven DIRECTLY here, with a row already standing, because that is the
    operation whose own re-read is the property under test.
    """
    standing = _seed_open_row(
        sink, mt5_session_episodes.STATE_AUTHORIZED, id="appeared-late"
    )

    await mt5_session_episodes._open_row(
        mt5_session_episodes.classify_reading(*_DARK_READING),
        source=_SOURCE,
        poll_interval_s=_CADENCE_S,
        since_previous_reading_s=None,
        first_reading_after_boot=True,
        started_at_is_lower_bound=True,
    )

    assert standing["status"] == "error", (
        "the open did not close the row standing at that instant — the "
        "invariant is restored by every WRITE, not only by a read that looked"
    )
    assert (
        sink.metadata(standing)["closing_kind"]
        == mt5_session_episodes.KIND_SUPERSEDED
    )
    assert len(sink.open_rows()) == 1
    assert sink.writes == ["update", "insert"], (
        f"the close must precede the insert, got {sink.writes}"
    )


async def test_the_CRASH_case_a_closed_row_with_NO_open_row_opens_exactly_one(
    sink: _OrderedCronRuns,
) -> None:
    """A process that died BETWEEN a close and its paired open leaves a closed
    row and no open one. The next observation must open ONE run, marked
    ``started_at_is_lower_bound`` because nothing measured when that state began,
    and must not write a second row trying to reconstruct the gap."""
    _seed_closed_row(
        sink, mt5_session_episodes.STATE_AUTHORIZED, measured=True, row_id="before"
    )

    await _observe(_DARK_READING)

    assert sink.writes == ["insert"], (
        f"the crash case must be exactly ONE insert, got {sink.writes}"
    )
    opened = sink.open_rows()
    assert len(opened) == 1
    assert sink.metadata(opened[0])["started_at_is_lower_bound"] is True, (
        "the run's true start is UNBOUNDEDLY earlier than `started_at` — there "
        "was no open run to continue and no transition was observed"
    )
    assert sink.lifetime_dataset() == ["before"], (
        "the crash case disturbed an already-measured episode"
    )


async def test_a_SUPERSEDED_close_cannot_OVERWRITE_a_GENUINE_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⛔ THE DIRECTION NO OTHER LEG IN THIS FILE CAN SEE, AND IT IS THE ONE THAT
    LOSES A REAL EPISODE.

    Container B reads row R as live. Container A then closes R GENUINELY, with
    ``close_is_measured: true``. B — still mid-open, holding its stale copy —
    issues its SUPERSEDED close against R. Without the compare-and-set that write
    stamps ``false`` over ``true``, and the successor's ``close_is_measured``
    filter then EXCLUDES a genuinely measured episode from the lifetime dataset.
    The loss is SILENT and PERMANENT: the row still exists, still looks plausible,
    and simply never appears in the only query anyone runs over it.

    ⚠️ Reading the row first and branching in Python does NOT fix this. The
    interleave is between the READ and the WRITE, which is exactly the window a
    compare-and-set closes and a read-then-write does not — which is why the
    guard belongs in the UPDATE's own predicate and never in a preceding ``if``.
    """
    fake = _OrderedCronRuns()
    _install_sink(monkeypatch, fake)
    mt5_session_episodes._reset_session_episode_state_for_tests()

    row = _seed_open_row(fake, mt5_session_episodes.STATE_AUTHORIZED, id="R")

    def _container_a_closes_it_genuinely() -> None:
        metadata = dict(row["metadata"])
        metadata.update(
            {
                "closed_by": _SOURCE,
                "closing_kind": mt5_session_episodes.KIND_NO_AUTHORIZED_ACCOUNT,
                "closing_code": -6,
                "close_is_measured": True,
            }
        )
        row["metadata"] = metadata
        row["status"] = "ok"
        row["completed_at"] = "2026-09-15T03:00:00+00:00"

    # B's read returns R as live; A's genuine close lands immediately after it.
    fake.after_select = _container_a_closes_it_genuinely

    await mt5_session_episodes._open_row(
        mt5_session_episodes.classify_reading(*_DARK_READING),
        source=_SOURCE,
        poll_interval_s=_CADENCE_S,
        since_previous_reading_s=None,
        first_reading_after_boot=True,
        started_at_is_lower_bound=True,
    )

    assert row["metadata"]["close_is_measured"] is True, (
        "the superseded close stamped `false` over a GENUINE `true` — the "
        "`status='running'` predicate is missing from the UPDATE"
    )
    assert (
        row["metadata"]["closing_kind"]
        == mt5_session_episodes.KIND_NO_AUTHORIZED_ACCOUNT
    )
    assert row["completed_at"] == "2026-09-15T03:00:00+00:00", (
        "the superseded close overwrote a MEASURED completion time"
    )
    assert row["status"] == "ok"

    # ⭐ AND THE CONSEQUENCE, because the field alone is not the point: the
    # successor's own query still returns the episode.
    assert fake.lifetime_dataset() == ["R"], (
        "a genuinely measured episode was DELETED from the lifetime dataset by "
        "an overlapping container's superseded close"
    )
    # ...and the no-op is MEASURED rather than inferred.
    assert fake.updates[-1]["applied"] == 0, (
        "the superseded UPDATE matched a row that was no longer `running`"
    )
    assert ("status", "running") in fake.updates[-1]["filters"], (
        "the UPDATE's predicate no longer carries the compare-and-set"
    )


@pytest.mark.parametrize(
    "broken_metadata",
    [
        pytest.param({"state": None}, id="state-absent"),
        pytest.param({"state": "AUTHORISED"}, id="state-malformed"),
        pytest.param({"schema_version": 99}, id="unrecognised-schema-version"),
    ],
)
async def test_a_row_NOTHING_PARSED_takes_the_SUPERSEDED_path_not_the_measured_one(
    sink: _OrderedCronRuns, broken_metadata: dict
) -> None:
    """⛔ "DIFFERS" IS A TOTAL RELATION, which is why the unparsed case needs its
    own arm rather than falling into the measured-close one. A row whose start
    state was never established would otherwise be closed
    ``close_is_measured: true`` — fabricating a measured lifetime out of a row
    NOTHING PARSED, which the successor-shaped filter would then COUNT."""
    broken = _seed_open_row(
        sink,
        mt5_session_episodes.STATE_AUTHORIZED,
        id="unparsed",
        metadata=broken_metadata,
    )

    await _observe(_DARK_READING)

    assert broken["status"] == "error"
    assert sink.metadata(broken)["close_is_measured"] is False
    assert sink.metadata(broken)["close_is_measured"] is not True, (
        "an unparsed row closed as a MEASURED transition"
    )
    assert (
        sink.metadata(broken)["closing_kind"] == mt5_session_episodes.KIND_SUPERSEDED
    )
    assert sink.metadata(broken)["completed_at_is_notice_time"] is True
    assert sink.lifetime_dataset() == [], (
        "a row nothing parsed reached the lifetime dataset"
    )
    assert len(sink.open_rows()) == 1
    assert sink.metadata(sink.open_rows()[0])["started_at_is_lower_bound"] is True, (
        "the run opened after an UNPARSED predecessor has no measured start "
        "either — nothing established what it superseded"
    )


async def test_the_SUPERSEDED_row_is_EXCLUDED_from_the_dataset_a_successor_computes(
    sink: _OrderedCronRuns,
) -> None:
    """⛔ THE FALSIFIER THAT MAKES ``close_is_measured`` WORTH HAVING.

    A discriminator nothing filters on is decoration. The dataset is computed the
    way a successor would compute it — measured closes only — and the superseded
    row must be ABSENT from it while the genuine one is PRESENT. Asserting that
    the FIELD exists proves nothing about the number anybody will derive.
    """
    _seed_closed_row(
        sink, mt5_session_episodes.STATE_AUTHORIZED, measured=True, row_id="genuine"
    )
    _seed_closed_row(
        sink,
        mt5_session_episodes.STATE_AUTHORIZED,
        measured=False,
        row_id="superseded",
    )

    dataset = sink.lifetime_dataset()

    assert "genuine" in dataset, "a measured episode fell OUT of the dataset"
    assert "superseded" not in dataset, (
        "a SUPERSEDED close was counted as a measured session lifetime — the "
        "dataset this phase exists to build would be corrupted in a NEW way"
    )
    assert dataset == ["genuine"]


async def test_a_SUPERSEDED_close_carries_the_error_status_REGARDLESS_of_state(
    sink: _OrderedCronRuns,
) -> None:
    """⭐ ``status='ok'`` MUST KEEP MEANING EXACTLY ONE THING: "an authorized run
    whose end we MEASURED". A superseded close of an AUTHORIZED run that borrowed
    ``ok`` would be indistinguishable from a measured session lifetime to any
    reader who filtered on ``status`` alone — and ``status`` is the only column
    the table indexes."""
    orphan = _seed_open_row(
        sink,
        mt5_session_episodes.STATE_AUTHORIZED,
        id="orphan",
        started_at="2026-09-15T00:00:00+00:00",
    )
    _seed_open_row(
        sink,
        mt5_session_episodes.STATE_AUTHORIZED,
        id="newest",
        started_at="2026-09-15T02:00:00+00:00",
    )

    await _observe(_AUTHORIZED_READING)

    assert orphan["status"] == "error", (
        "a superseded close of an AUTHORIZED run borrowed `status='ok'`"
    )
    assert orphan["error"] == mt5_session_episodes.KIND_SUPERSEDED
    assert sink.metadata(orphan)["completed_at_is_notice_time"] is True, (
        "a superseded row's `completed_at` is the time we NOTICED, not a "
        "measured transition — the mirror of `started_at_is_lower_bound`"
    )
    assert orphan["completed_at"] is not None


# --------------------------------------------------------------------------- #
# (c) A `not_measured` READING CLOSES NOTHING
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "reading,label",
    [
        pytest.param(_BUSY_READING, "busy skip", id="busy-skip"),
        pytest.param(_BUDGET_READING, "budget abandon", id="budget-abandon"),
        pytest.param(_ZERO_CODE_READING, "code=0 sentinel", id="code-zero"),
    ],
)
async def test_a_reading_that_MEASURED_NOTHING_writes_nothing_and_closes_nothing(
    sink: _OrderedCronRuns, reading: tuple[str, int | None], label: str
) -> None:
    """⛔ THE ONE A NAIVE IMPLEMENTATION GETS WRONG. It did not measure that the
    session recovered, so it may never close an episode.

    ⚠️ AND DO NOT COPY THE BOOT HEAL'S BUSY-SKIP RATIONALE. "A busy terminal is a
    terminal somebody is already successfully using, which is itself evidence the
    session is fine" is cheap for a once-per-boot heal and UNSOUND for a loop: it
    is a standing claim about state the tick DID NOT MEASURE, and a terminal held
    by a FAILING job is exactly where it is most wrong.
    """
    seeded = _seed_open_row(sink, mt5_session_episodes.STATE_AUTHORIZED, id="open")

    await _observe(reading)

    assert sink.writes == [], (
        f"the {label} reading wrote {sink.writes} — it MEASURED NOTHING, so it "
        f"may neither open nor close an episode"
    )
    assert seeded["status"] == "running", f"the {label} reading closed an episode"
    assert seeded["completed_at"] is None
    assert len(sink.open_rows()) == 1

    classified = mt5_session_episodes.classify_reading(*reading)
    assert classified.state == mt5_session_episodes.STATE_NOT_MEASURED
    assert classified.state != mt5_session_episodes.STATE_AUTHORIZED, (
        "a reading that measured nothing was recorded as a healthy session"
    )
    assert classified.state != mt5_session_episodes.STATE_DARK


# --------------------------------------------------------------------------- #
# (d) `code=0` IS RECORDED `unattributed`, NEVER GUESSED
# --------------------------------------------------------------------------- #


async def test_a_code_zero_fault_is_UNATTRIBUTED_and_never_authorized_or_dark(
    sink: _OrderedCronRuns, caplog: pytest.LogCaptureFixture
) -> None:
    """⚠️ IN-02, AND IT IS LOAD-BEARING FOR THIS WHOLE PHASE. ``_raise_last`` uses
    ``0`` as the sentinel for THREE distinct faults — an unknown ``last_error``, a
    malformed ``last_error`` shape, and a transport raise converted by its own
    except arm. And ``-6`` is ONLY ever observable through the SECOND
    ``last_error()`` round-trip, so whenever THAT is the broken one the fault
    classifies as ``0`` and the session is healed not at all: the one fault this
    entire mechanism exists to catch becomes undetectable.

    ⭐ WHERE THE MARKER LIVES, and it is a plan-04 refinement of the plan's own
    wording: an unattributed reading opens and closes NOTHING by construction, so
    there is no row of its own to carry the word. The ABSENCE of a row is the
    record that nothing was measured, and the LOG LINE names why — which is why
    this asserts the line rather than a field. A row asserting either state would
    be the guess IN-02 forbids.
    """
    reading = mt5_session_episodes.classify_reading(*_ZERO_CODE_READING)
    assert reading.unattributed is True
    assert reading.state == mt5_session_episodes.STATE_NOT_MEASURED
    assert reading.state != mt5_session_episodes.STATE_AUTHORIZED
    assert reading.state != mt5_session_episodes.STATE_DARK

    _seed_open_row(sink, mt5_session_episodes.STATE_AUTHORIZED)
    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await _observe(_ZERO_CODE_READING)

    assert sink.writes == []
    messages = [r.getMessage() for r in _records(caplog)]
    assert any("unattributed=True" in m for m in messages), messages
    assert not any("state=authorized" in m for m in messages), messages


@pytest.mark.parametrize(
    "code,expect_unattributed",
    [
        pytest.param(0, True, id="zero-is-the-sentinel"),
        pytest.param(-10004, False, id="a-real-ipc-code-is-not"),
        pytest.param(-10005, False, id="a-modal-dialog-code-is-not"),
        pytest.param(None, False, id="no-code-at-all-is-not"),
    ],
)
def test_only_the_zero_sentinel_marks_a_reading_unattributed(
    code: int | None, expect_unattributed: bool
) -> None:
    reading = mt5_session_episodes.classify_reading(
        mt5_session_episodes.KIND_IPC_FAULT, code
    )
    assert reading.unattributed is expect_unattributed
    assert reading.state == mt5_session_episodes.STATE_NOT_MEASURED


# --------------------------------------------------------------------------- #
# (e) THE HONESTY FIELDS, EACH ASSERTED BY NAME
# --------------------------------------------------------------------------- #

#: ⛔ A CLOSED SET, not a presence list, and the difference is the whole
#: disclosure control: a presence list tolerates an ADDED key, and the key a
#: future edit would add is the composed verdict (whose tail is terminal-supplied
#: text — T-164.6.4-08). Rows outlive every log.
_OPEN_ROW_METADATA_KEYS = frozenset(
    {
        "schema_version",
        "state",
        "opened_by",
        "opening_kind",
        "opening_code",
        "poll_interval_s",
        "since_previous_reading_s",
        "first_reading_after_boot",
        "started_at_is_lower_bound",
        "reading_attributes_account",
        "attribution_limit",
    }
)
_CLOSE_METADATA_KEYS = frozenset(
    {"closed_by", "closing_kind", "closing_code", "close_is_measured"}
)


async def test_every_honesty_field_is_present_on_a_written_row_by_NAME(
    sink: _OrderedCronRuns,
) -> None:
    """Each field gets its OWN assertion so a partial regression says WHICH one
    vanished. ⭐ The anti-vacuity leg first: a row that is empty or unrelated
    would satisfy a list of ``in`` checks for free."""
    await _observe(_DARK_READING, poll_interval_s=_CADENCE_S)

    assert len(sink.rows) == 1
    row = sink.rows[0]
    meta = sink.metadata(row)

    # --- ANTI-VACUITY: a row was actually written, with actual fields -------- #
    assert row["cron_name"] == mt5_session_episodes.MT5_SESSION_EPISODE_CRON_NAME
    assert row["started_at"], "the row carries no `started_at`"
    assert len(meta) >= 10, f"the row carries only {len(meta)} metadata fields"

    # --- the attribution limit, which is the biggest threat to the dataset --- #
    assert meta["reading_attributes_account"] is False
    assert meta["attribution_limit"] == mt5_session_episodes.ATTRIBUTION_LIMIT
    assert "cannot attribute" in meta["attribution_limit"]

    # --- the contract, the state, and who wrote it -------------------------- #
    assert meta["schema_version"] == mt5_session_episodes.SCHEMA_VERSION
    assert meta["state"] == mt5_session_episodes.STATE_DARK
    assert meta["opened_by"] == _SOURCE

    # --- what produced the reading ------------------------------------------ #
    assert meta["opening_kind"] == mt5_session_episodes.KIND_NO_AUTHORIZED_ACCOUNT
    assert meta["opening_code"] == -6

    # --- the cadence and the MEASURED latency bound ------------------------- #
    assert meta["poll_interval_s"] == _CADENCE_S
    assert meta["since_previous_reading_s"] is None
    assert meta["first_reading_after_boot"] is True
    assert meta["started_at_is_lower_bound"] is True

    # --- and NOTHING ELSE ---------------------------------------------------- #
    assert set(meta) == _OPEN_ROW_METADATA_KEYS, (
        f"the open row's metadata keys drifted: "
        f"{set(meta) ^ _OPEN_ROW_METADATA_KEYS}. ⛔ An ADDED key is the "
        f"disclosure risk — the one a future edit reaches for is the composed "
        f"verdict, whose tail is terminal-supplied text."
    )


async def test_first_reading_after_boot_is_true_EXACTLY_when_the_gap_is_None(
    sink: _OrderedCronRuns,
) -> None:
    """⛔ BOTH DIRECTIONS. The flag and the gap are one fact stated twice, and a
    successor filtering on either must get the same rows — a cadence constant
    substituted for a missing measurement is the defect class this phase is
    about."""
    await _observe(_DARK_READING)
    first = sink.metadata(sink.rows[0])
    assert first["since_previous_reading_s"] is None
    assert first["first_reading_after_boot"] is True

    await _observe(_AUTHORIZED_READING)
    second = sink.metadata(sink.rows[1])
    assert second["since_previous_reading_s"] is not None, (
        "the SECOND reading of a process has a MEASURED wall-clock gap"
    )
    assert second["since_previous_reading_s"] >= 0.0
    assert second["since_previous_reading_s"] != _CADENCE_S, (
        "the configured cadence was substituted for the measured gap"
    )
    assert second["first_reading_after_boot"] is False


async def test_started_at_is_lower_bound_is_true_EXACTLY_with_no_run_to_continue(
    sink: _OrderedCronRuns,
) -> None:
    """⭐ BOUNDED VERSUS UNBOUNDED, and a successor that cannot tell them apart
    must discard every row to stay honest.

    An opening with NO open run to continue (a boot, a crash, an orphan) starts
    at an UNKNOWABLE and unbounded time before we first looked. An opening at an
    OBSERVED TRANSITION starts inside the last ``since_previous_reading_s``
    seconds — still a lower bound, but one the row itself NAMES.
    """
    await _observe(_DARK_READING)
    boot_row = sink.metadata(sink.rows[0])
    assert boot_row["started_at_is_lower_bound"] is True

    await _observe(_AUTHORIZED_READING)
    transition_row = sink.metadata(sink.rows[1])
    assert transition_row["started_at_is_lower_bound"] is False, (
        "a run opened at an OBSERVED transition was marked unbounded — a "
        "successor must then discard it, losing the measurement this phase "
        "exists to collect"
    )
    assert transition_row["since_previous_reading_s"] is not None, (
        "a bounded start MUST carry the bound; otherwise `false` is a claim "
        "with nothing behind it"
    )


async def test_a_CLOSED_row_carries_the_closing_honesty_fields_by_NAME(
    sink: _OrderedCronRuns,
) -> None:
    seeded = _seed_open_row(sink, mt5_session_episodes.STATE_AUTHORIZED, id="closed")

    await _observe(_DARK_READING)

    meta = sink.metadata(seeded)
    assert meta["closed_by"] == _SOURCE
    assert meta["closing_kind"] == mt5_session_episodes.KIND_NO_AUTHORIZED_ACCOUNT
    assert meta["closing_code"] == -6
    assert meta["close_is_measured"] is True
    assert "completed_at_is_notice_time" not in meta, (
        "a MEASURED close claimed its completion time was only a notice time"
    )
    assert seeded["completed_at"] is not None
    assert set(meta) == _OPEN_ROW_METADATA_KEYS | _CLOSE_METADATA_KEYS, (
        f"the closed row's metadata keys drifted: "
        f"{set(meta) ^ (_OPEN_ROW_METADATA_KEYS | _CLOSE_METADATA_KEYS)}"
    )


# --------------------------------------------------------------------------- #
# (f) `status` IS OVERLOADED AND `metadata.state` IS THE DISCRIMINATOR
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "seeded_state,reading,expect_status",
    [
        pytest.param(
            mt5_session_episodes.STATE_AUTHORIZED,
            _DARK_READING,
            "ok",
            id="a-measured-AUTHORIZED-close-is-ok",
        ),
        pytest.param(
            mt5_session_episodes.STATE_DARK,
            _AUTHORIZED_READING,
            "error",
            id="a-measured-DARK-close-is-error",
        ),
    ],
)
async def test_the_status_mapping_holds_in_BOTH_directions(
    sink: _OrderedCronRuns,
    seeded_state: str,
    reading: tuple[str, int | None],
    expect_status: str,
) -> None:
    """⛔ ``cron_runs``' CHECK admits only ``running``/``ok``/``error`` — lifecycle
    tokens for a cron RUN, not a vocabulary for a terminal's authorization. A DARK
    run therefore closes ``error`` and the real meaning lives in
    ``metadata.state``. A reader who infers the state from ``status`` alone will
    mis-infer, which is why the state is asserted present on EVERY row."""
    seeded = _seed_open_row(sink, seeded_state)

    await _observe(reading)

    assert seeded["status"] == expect_status
    assert sink.metadata(seeded)["state"] == seeded_state, (
        "the state must stay readable on a CLOSED row; `status` cannot carry it"
    )
    assert sink.open_rows()[0]["status"] == "running", (
        "an open run of either kind is `running`"
    )
    for row in sink.rows:
        assert sink.metadata(row).get("state") in (
            mt5_session_episodes.STATE_AUTHORIZED,
            mt5_session_episodes.STATE_DARK,
        ), f"a row carries no readable `metadata.state`: {row}"


def test_the_migration_forbids_FORCE_ROW_LEVEL_SECURITY_and_so_does_this_module(
) -> None:
    """⛔ T-164.6.4-24. The heartbeat migration's own note calls
    ``FORCE ROW LEVEL SECURITY`` "the one clause under which owning a table stops
    being an exemption", and adding it while "hardening" the new writer would
    silently drop the dormancy rows this repo's ledger gates depend on. The
    prohibition is asserted to be IN THE MODULE, where an editor will see it."""
    source = inspect.getsource(mt5_session_episodes)
    assert "FORCE ROW LEVEL SECURITY" in source
    assert "NEVER ADD ``FORCE ROW LEVEL SECURITY``" in source


# --------------------------------------------------------------------------- #
# TASK 2 (a) — THE RECORDER IS STRUCTURALLY NEVER-RAISING
# --------------------------------------------------------------------------- #

#: The recorder's two public entry points. Both run under `main.lifespan`'s
#: `_crash_handler`, which calls `SHUTDOWN.set()` on ANY background-task
#: exception — so a raise here stops the dispatch, watchdog and enqueue loops
#: behind a green `/health`.
_GUARDED_SYMBOLS = (
    mt5_session_episodes.record_mt5_session_reading,
    mt5_session_episodes.record_mt5_heal_outcome,
)


def _recorder_source(symbol: Any) -> str:
    return textwrap.dedent(inspect.getsource(symbol))


@pytest.mark.parametrize(
    "symbol", _GUARDED_SYMBOLS, ids=lambda s: s.__name__
)
def test_the_recorder_satisfies_the_SHARED_never_raises_predicate(symbol: Any) -> None:
    """⭐ THE ONE PREDICATE, WIDENED — never a second copy. A copied structural
    gate is the drift shape this repo has a dated record of, and the copy is what
    rots.

    ``required_names`` is EMPTY here: the recorder carries no kill switch of its
    own, because it is INSTRUMENTATION and is disabled by its caller not running.
    """
    assert _heal_guard_defects(_recorder_source(symbol), required_names=()) == [], (
        symbol.__name__
    )


@pytest.mark.parametrize("mutant_id", sorted(_HEAL_GUARD_MUTANTS))
@pytest.mark.parametrize(
    "symbol", _GUARDED_SYMBOLS, ids=lambda s: s.__name__
)
def test_the_never_raises_predicate_REDS_on_every_escape_route_HERE_TOO(
    symbol: Any, mutant_id: str
) -> None:
    """⛔ THE CALIBRATION, RUN AGAINST THIS MODULE'S OWN SOURCE.

    The predicate passing over the recorder is not evidence it WOULD fire over
    the recorder: the shipped mutant table is calibrated against
    ``heal_mt5_terminal_session``, and a predicate can be blind to a shape that
    only this module has. Each mutant is spliced into a COPY — nothing on disk is
    touched — and must PARSE and then produce a NAMED defect.
    """
    needle, replacement = _HEAL_GUARD_MUTANTS[mutant_id]
    source = _recorder_source(symbol)
    if needle == "APPEND":
        mutated = source.rstrip("\n") + replacement
    else:
        assert needle in source, (
            f"the mutation anchor {needle!r} is not in {symbol.__name__}'s "
            "source — the mutant would not apply and this test would pass "
            "VACUOUSLY. ⛔ Give this module its own anchor; never drop the leg."
        )
        mutated = source.replace(needle, replacement, 1)
    assert mutated != source

    # ⛔ Parsed OUTSIDE any try, deliberately: an unparseable mutant must FAIL
    # this test rather than be excused by it.
    defects = _heal_guard_defects(mutated, required_names=())
    assert defects, (
        f"the never-raises predicate tolerated the {mutant_id!r} mutant in "
        f"{symbol.__name__} — that escape route reaches `main.lifespan`'s "
        f"`_crash_handler`, which calls SHUTDOWN.set() and stops the dispatch, "
        f"watchdog and enqueue loops behind a green /health"
    )


def _basexception_handlers_guarding_an_await(source: str) -> list[str]:
    """Every ``try`` whose handler catches ``BaseException`` while its GUARDED
    body contains an ``await``.

    ⚠️ MEASURED on this venv (Python 3.12.13): ``asyncio.CancelledError`` is NOT
    an ``Exception`` subclass, so ``except Exception`` correctly lets shutdown
    cancellation through while ``except BaseException`` would SWALLOW it and hang
    ``lifespan``'s 10-second gather.
    """
    defects: list[str] = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Try):
            continue
        catches_base = any(
            isinstance(handler.type, ast.Name) and handler.type.id == "BaseException"
            for handler in node.handlers
        )
        if not catches_base:
            continue
        if any(
            isinstance(inner, ast.Await)
            for statement in node.body
            for inner in ast.walk(statement)
        ):
            defects.append(f"an `except BaseException` guards an `await` at line {node.lineno}")
    return defects


def test_no_except_BaseException_in_this_module_ever_wraps_an_await() -> None:
    assert _basexception_handlers_guarding_an_await(
        inspect.getsource(mt5_session_episodes)
    ) == []


def test_the_BaseException_over_await_scanner_BITES() -> None:
    """⛔ THE CALIBRATION. A scanner returning the empty list is
    indistinguishable from a clean module."""
    mutated = textwrap.dedent(
        """
        async def f():
            try:
                await g()
            except BaseException:
                pass
        """
    )
    assert _basexception_handlers_guarding_an_await(mutated), (
        "the scanner tolerated a `BaseException` handler around an `await`"
    )


def test_this_module_never_catches_OSError() -> None:
    """⚠️ ``asyncio.TimeoutError is TimeoutError`` and its MRO runs through
    ``OSError``, so an ``OSError`` handler on this path silently eats a budget
    expiry — the one signal that says the terminal is wedged."""
    caught: list[str] = []
    for node in ast.walk(ast.parse(inspect.getsource(mt5_session_episodes))):
        if isinstance(node, ast.ExceptHandler):
            names = (
                [node.type]
                if isinstance(node.type, ast.Name)
                else list(getattr(node.type, "elts", []))
            )
            caught.extend(
                n.id for n in names if isinstance(n, ast.Name)
            )
    assert caught, "the scanner found no handlers at all — it cannot fire"
    assert "OSError" not in caught, caught
    assert "TimeoutError" not in caught, caught


# --------------------------------------------------------------------------- #
# TASK 2 (b) — A SINK FAILURE CHANGES NOTHING
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "fail_ops,label",
    [
        pytest.param(frozenset({"select"}), "the READ raises", id="read"),
        pytest.param(
            frozenset({"insert", "update"}), "the WRITE raises", id="write"
        ),
        pytest.param(
            frozenset({"select", "insert", "update"}), "BOTH raise", id="both"
        ),
    ],
)
async def test_a_sink_failure_leaves_the_caller_observing_EXACTLY_what_it_did(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    fail_ops: frozenset[str],
    label: str,
) -> None:
    """⛔ INSTRUMENTATION MUST NOT CHANGE WHAT A CALLER OBSERVES (T-153.3-24).

    ⭐ A DB WRITE INSIDE A NEVER-RAISING PATH IS A NEW RAISE SOURCE, and this is
    the property that keeps it from becoming one. The caller-visible surface at
    the recorder's boundary is its RETURN VALUE and its EXCEPTION BEHAVIOUR, and
    both must be byte-identical to the healthy case — otherwise a Supabase blip
    reaches ``_crash_handler``, which calls ``SHUTDOWN.set()`` and stops the
    dispatch, watchdog and enqueue loops behind a green ``/health``.
    """
    # --- the HEALTHY observation, for comparison ---------------------------- #
    healthy_sink = _OrderedCronRuns()
    _install_sink(monkeypatch, healthy_sink)
    mt5_session_episodes._reset_session_episode_state_for_tests()
    _seed_open_row(healthy_sink, mt5_session_episodes.STATE_AUTHORIZED)
    healthy_return = await mt5_session_episodes.record_mt5_session_reading(
        *_DARK_READING, source=_SOURCE, poll_interval_s=_CADENCE_S
    )
    assert healthy_sink.writes, "the healthy control wrote nothing; it proves nothing"

    # --- the SAME observation against a failing transport ------------------- #
    failing = _RaisingCronRuns(fail_ops=fail_ops)
    _install_sink(monkeypatch, failing)
    mt5_session_episodes._reset_session_episode_state_for_tests()
    _seed_open_row(failing, mt5_session_episodes.STATE_AUTHORIZED)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        failed_return = await mt5_session_episodes.record_mt5_session_reading(
            *_DARK_READING, source=_SOURCE, poll_interval_s=_CADENCE_S
        )

    assert failed_return is healthy_return is None, (
        f"{label}: the recorder's return value changed under a sink outage"
    )
    warnings = _warnings(caplog)
    assert len(warnings) == 1, (
        f"{label}: expected EXACTLY one warning, got {len(warnings)}: "
        f"{[r.getMessage() for r in warnings]}"
    )
    assert "could not be recorded" in warnings[0].getMessage()
    assert "exc_class=RuntimeError" in warnings[0].getMessage(), (
        "the warning does not name the failure CLASS, so an outage and a bug "
        "are indistinguishable in the logs"
    )


async def test_the_heal_outcome_recorder_also_survives_a_dead_sink(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The second entry point is guarded too — it is the one the heal actually
    calls, and it makes TWO recorder calls per tick."""
    failing = _RaisingCronRuns(fail_ops=frozenset({"select", "insert", "update"}))
    _install_sink(monkeypatch, failing)
    mt5_session_episodes._reset_session_episode_state_for_tests()

    outcome = mt5_session_episodes.HealOutcome(
        verdict="mt5 session monitor: healed",
        first_kind=mt5_session_episodes.KIND_NO_AUTHORIZED_ACCOUNT,
        first_code=-6,
        final_kind=mt5_session_episodes.KIND_HEALED,
        final_code=None,
    )

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        result = await mt5_session_episodes.record_mt5_heal_outcome(
            outcome, source=_SOURCE, poll_interval_s=_CADENCE_S
        )

    assert result is None
    assert failing.rows == []
    assert _warnings(caplog), "a total sink outage was recorded SILENTLY"


# --------------------------------------------------------------------------- #
# TASK 2 (c) — NO SECRET IN ANY FIELD, EVER
# --------------------------------------------------------------------------- #


async def test_no_credential_host_or_port_reaches_ANY_field_of_ANY_row(
    monkeypatch: pytest.MonkeyPatch, sink: _OrderedCronRuns
) -> None:
    """⛔ T-164.6.4-18. Rows OUTLIVE every log, and this repo is PUBLIC.

    ⭐ THE COMPOSED VERDICT IS THE HAZARD, and it is driven here rather than
    imagined: ``HealOutcome.verdict`` carries the terminal's own text, which a
    broker is free to echo the submitted account and server into. The recorder
    receives that whole string and must write the verdict CLASS and the CODE and
    nothing else. Every literal is checked INDIVIDUALLY and per column, so a
    partial leak names WHICH value escaped and WHERE.
    """
    monkeypatch.setenv("MT5_LOGIN", _FAKE_LOGIN)
    monkeypatch.setenv("MT5_PASSWORD", _FAKE_PASSWORD)
    monkeypatch.setenv("MT5_SERVER", _FAKE_SERVER)
    monkeypatch.setenv("MT5_GATEWAY_HOST", _FAKE_HOST)
    monkeypatch.setenv("MT5_GATEWAY_PORT", _FAKE_PORT)

    outcome = mt5_session_episodes.HealOutcome(
        verdict=(
            f"mt5 session monitor: NOT HEALED — Terminal: Authorization failed "
            f"for {_FAKE_SERVER} account {_FAKE_LOGIN} via {_FAKE_HOST}:"
            f"{_FAKE_PORT} (password={_FAKE_PASSWORD})"
        ),
        first_kind=mt5_session_episodes.KIND_NO_AUTHORIZED_ACCOUNT,
        first_code=-6,
        final_kind=mt5_session_episodes.KIND_HEALED,
        final_code=None,
    )

    await mt5_session_episodes.record_mt5_heal_outcome(
        outcome, source=_SOURCE, poll_interval_s=_CADENCE_S
    )

    # --- ANTI-VACUITY: the absences pass on nothing unless rows exist ------- #
    assert len(sink.rows) == 2, (
        f"the transition wrote {len(sink.rows)} rows; the scan below would "
        f"otherwise pass over an empty table"
    )
    assert all(sink.metadata(r) for r in sink.rows), "a row carries no fields"

    _assert_no_secret_reached_any_row(sink)

    # ...and the verdict STRING itself never reached a row, only its CLASS.
    for row in sink.rows:
        meta = sink.metadata(row)
        assert "verdict" not in meta, (
            "the composed verdict reached a row; its tail is terminal-supplied "
            "text (T-164.6.4-08)"
        )
        assert set(meta) <= _OPEN_ROW_METADATA_KEYS | _CLOSE_METADATA_KEYS | {
            "completed_at_is_notice_time"
        }, f"an undeclared field reached a row: {set(meta)}"
    assert (
        sink.metadata(sink.rows[0])["opening_kind"]
        == mt5_session_episodes.KIND_NO_AUTHORIZED_ACCOUNT
    ), "the row must carry the verdict CLASS"


def test_no_class_constant_this_module_writes_carries_free_text() -> None:
    """The classes are the ONLY strings that reach a row from the terminal's side
    of the boundary, so they are asserted to be closed-vocabulary tokens rather
    than anything a terminal could have influenced."""
    kinds = [
        value
        for name, value in vars(mt5_session_episodes).items()
        if name.startswith("KIND_") and isinstance(value, str)
    ]
    assert len(kinds) >= 9, f"the scanner found only {len(kinds)} classes"
    for kind in kinds:
        assert kind.replace("_", "").isalnum(), (
            f"the class {kind!r} is not a closed-vocabulary token"
        )
        assert " " not in kind
        for literal in (_FAKE_LOGIN, _FAKE_PASSWORD, _FAKE_SERVER, _FAKE_HOST):
            assert literal not in kind


# --------------------------------------------------------------------------- #
# TASK 2 (d) — A BLIND INSTRUMENT MUST NOT LOOK LIKE A HEALTHY ONE
# --------------------------------------------------------------------------- #


def test_the_independent_window_AGREES_with_the_monitors_own_ceiling() -> None:
    """⛔ THE RE-SPELLING IS PINNED. ``_INDEPENDENT_INSTRUMENT_WINDOW_S`` cannot
    be imported from ``mt5_session_monitor`` (that module imports ``mt5_relogin``,
    which imports this one — the edge would be a cycle), so it is re-spelled. A
    re-spelled constant that nothing pins is a constant that drifts."""
    assert (
        mt5_session_episodes._INDEPENDENT_INSTRUMENT_WINDOW_S
        == mt5_session_monitor._MT5_SESSION_POLL_INTERVAL_CEILING_S
    ), (
        "the recorder's independent-instrument window and the monitor's cadence "
        "CEILING have drifted apart; both name the hourly production prober"
    )


@pytest.mark.parametrize("cadence", [120.0, 600.0, 900.0, 3600.0, 7200.0])
def test_the_escalation_threshold_is_DERIVED_from_the_cadence(cadence: float) -> None:
    """⭐ RECOMPUTED IN THE TEST, so a retune of the cadence carries through
    instead of stranding a hand-typed count that nobody remembers to move."""
    expected = max(
        1,
        math.ceil(
            mt5_session_episodes._INDEPENDENT_INSTRUMENT_WINDOW_S / cadence
        ),
    )
    assert (
        mt5_session_episodes.blind_run_escalation_threshold(cadence) == expected
    )


@pytest.mark.parametrize("no_cadence", [None, 0.0, -600.0])
def test_no_cadence_means_no_derivable_threshold(no_cadence: float | None) -> None:
    """⚠️ THE BOOT HEAL'S ANSWER, and it is correct rather than degenerate: that
    caller fires ONCE per process, so a blind run there can never exceed one and
    no wall-clock span can be derived from a cadence that does not exist. ⛔
    Substituting the monitor's default would be an assumed number wearing a
    measured name."""
    assert mt5_session_episodes.blind_run_escalation_threshold(no_cadence) is None


async def test_a_blind_run_ESCALATES_only_once_it_covers_the_independent_window(
    sink: _OrderedCronRuns, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ BOTH DIRECTIONS AND THE RESET, because an escalation that fires on the
    first blind reading is noise and one that never fires is the defect this
    phase exists to remove, pointed at the fix: a mechanism that has measured
    nothing for over an hour is INDISTINGUISHABLE from a quiet healthy one while
    it stays at INFO."""
    threshold = mt5_session_episodes.blind_run_escalation_threshold(_CADENCE_S)
    assert threshold is not None and threshold > 1, (
        f"the threshold is {threshold}; a threshold of 1 would make the "
        "below-threshold half of this test vacuous"
    )

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        # --- BELOW the threshold: quiet ---------------------------------- #
        for _ in range(threshold - 1):
            await _observe(_BUSY_READING)
        assert _warnings(caplog) == [], (
            f"the {threshold - 1}th consecutive blind reading escalated; the "
            f"run has not yet covered the independent instrument's window"
        )
        assert len(_records(caplog)) == threshold - 1, "the readings were silent"

        # --- AT the threshold: escalated --------------------------------- #
        await _observe(_BUSY_READING)
        at_threshold = _warnings(caplog)
        assert len(at_threshold) == 1, (
            "the blind run reached the independent instrument's own window and "
            "stayed at INFO — a blind instrument that looks healthy"
        )
        assert f"consecutive_not_measured={threshold}" in at_threshold[0].getMessage()
        assert "blind=True" in at_threshold[0].getMessage()

        # --- ABOVE the threshold: still escalated ------------------------ #
        await _observe(_BUDGET_READING)
        assert len(_warnings(caplog)) == 2

        # --- a single MEASURED reading RESETS it ------------------------- #
        caplog.clear()
        await _observe(_DARK_READING)
        assert mt5_session_episodes._CONSECUTIVE_NOT_MEASURED_READINGS == 0
        await _observe(_BUSY_READING)
        assert _warnings(caplog) == [], (
            "the blind run was not reset by a reading that MEASURED something"
        )


async def test_the_boot_heals_single_shot_caller_never_escalates(
    sink: _OrderedCronRuns, caplog: pytest.LogCaptureFixture
) -> None:
    """With no cadence there is no derivable window, so the level stays quiet
    however many blind readings arrive — the boot heal fires once per process and
    cannot accumulate a run at all."""
    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        for _ in range(20):
            await _observe(_BUSY_READING, poll_interval_s=None)

    assert _warnings(caplog) == []
    assert len(_records(caplog)) == 20, "the readings were not logged at all"
    assert all("blind=False" in r.getMessage() for r in _records(caplog))


async def test_a_DARK_reading_resets_the_blind_run_because_it_MEASURED_something(
    sink: _OrderedCronRuns,
) -> None:
    """⭐ Darkness is not blindness. The instrument reporting `-6` is the
    instrument WORKING — it is the observation this whole phase exists to make —
    so it ends the blind run exactly as an `authorized` reading does."""
    for _ in range(3):
        await _observe(_BUSY_READING)
    assert mt5_session_episodes._CONSECUTIVE_NOT_MEASURED_READINGS == 3

    await _observe(_DARK_READING)

    assert mt5_session_episodes._CONSECUTIVE_NOT_MEASURED_READINGS == 0
    assert sink.writes == ["insert"], "the dark reading did not record an episode"


# --------------------------------------------------------------------------- #
# TASK 2 (e) — THE MODULE HEADER EARNS ITS PLACE
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "fragment,why",
    [
        pytest.param(
            "D-5",
            "the founder DECISION that chose this sink, so the choice is "
            "traceable rather than folklore",
            id="the-founder-decision",
        ),
        pytest.param(
            "public.mt5_session_episodes",
            "the semantically exact SUCCESSOR table, NAMED — a deferral that "
            "does not name its successor is a gap wearing a decision's clothes",
            id="the-named-successor",
        ),
        pytest.param(
            "Heartbeat rows written by cron jobs",
            "the table's own COMMENT, quoted, so the SEMANTIC STRETCH is stated "
            "rather than hidden from whoever finds episodes in a heartbeat table",
            id="the-semantic-stretch",
        ),
        pytest.param(
            "FORCE ROW LEVEL SECURITY",
            "the prohibition (T-164.6.4-24), where an editor hardening this "
            "writer will actually see it",
            id="the-force-rls-prohibition",
        ),
        pytest.param(
            "latest_cron_success",
            "the stale-alert function takes a NAME and does not enumerate them, "
            "which is why a new cron_name raises no false alert",
            id="the-no-false-alert-reasoning",
        ),
    ],
)
def test_the_module_header_records_what_this_sink_is_and_is_NOT(
    fragment: str, why: str
) -> None:
    """Each claim asserted INDIVIDUALLY, so a partial regression says which one
    was dropped rather than that "the docstring changed"."""
    header = mt5_session_episodes.__doc__ or ""
    assert fragment in header, f"the module header no longer records {why}"


def test_the_header_gate_is_not_vacuous() -> None:
    """⛔ ANTI-VACUITY: every fragment above is checked against a docstring that
    might not exist. A missing ``__doc__`` would turn all five into assertions
    over the empty string."""
    header = mt5_session_episodes.__doc__ or ""
    assert len(header) > 2000, f"the module header is {len(header)} chars"
    assert "a-fragment-that-is-not-in-the-header" not in header
