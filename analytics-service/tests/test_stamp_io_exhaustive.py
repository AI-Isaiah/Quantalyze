"""Phase 164.6.7 round 4 (SFH-R4-01) — EVERY database call inside both terminal
stamp closures keeps the handler's curated cause when it fails.

Why this file exists
--------------------
Rounds 2, 3 and 4 each found the same defect one database call further into a
stamp closure: round 2 at the marker re-read, round 3 at the composite stamp's
status read, round 4 at the D-15 error-only write. The shape was always the
same. A read or write raises, its exception leaves the closure as itself,
``compute_jobs.last_error`` names only the I/O, no ERROR line carries the
curated cause, and on exhaustion the bridge writes generic copy over it. Fixing
it one site at a time did not converge, so round 4 routed every call through
one wrapper, ``services.job_worker._stamp_io``.

A hand-written list of "the calls a stamp makes" is how each round missed the
next one. So this file does not keep one. It wraps the fake Supabase client in
a recorder, runs each scenario once cleanly, and DISCOVERS every ``.execute()``
issued while ``_stamp_strategy_analytics_failed`` or the composite
``_stamp_failed`` is on the call stack. Then it makes each discovered call fail
in turn and asserts, for every one:

  (a) the job is filed ``transient``;
  (b) ``last_error`` carries the curated cause and names the failed call;
  (c) exactly one ERROR line carries the cause;
  (d) exactly one capture, tagged with the job id;
  (e) no ``strategy_analytics`` write landed (no partial terminal stamp).

A programming-error variant (``TypeError``, a ``_READ_PROGRAMMING_ERRORS``
member) asserts ``unknown`` instead, with the ERROR line and the capture still
present. A call added to either closure later is picked up by discovery and
held to the same assertions without editing this file.

⚠️ The one call with a DIFFERENT, asserted disposition is the single-key series
heal. It is identified by its own property, not by name: it is closure I/O
issued AFTER the closure's ``strategy_analytics`` write has landed. Its failure
loses no cause (``computation_error`` already carries it), so it keeps its
WARNING and the job stays ``permanent``. ``_stamp_io``'s docstring records why
it is not wrapped. The post-stamp test pins that disposition for every such
call.

Neuter to redden: make ``_stamp_io`` return ``await call()`` with no ``try``.
Every failing-call case goes RED on (a) (``unknown``). Measured 2026-09-26,
recorded in 164.6.7-REVIEW-FIX-R4.md.

Discovery needs every database call on ONE thread, so ``services.db.db_execute``
is patched inline too: ``db_read_with_retry`` calls it, and the real one hops to
a thread pool, where the closure's frame is not on the stack.
"""
from __future__ import annotations

import asyncio
import sys
from contextlib import ExitStack
from dataclasses import dataclass, field
from typing import Any, Callable
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import services.job_worker as _jw
from services.job_worker import DispatchOutcome
from tests.test_derive_broker_dailies_dualmode import _build_ctx, _patches_with_combine
from tests.test_ledger_refresh_reuse_collision import (
    _insufficient_combine,
    _stub_reads,
)
from tests.test_stitch_composite_job import (
    _STRATEGY_ID as _COMPOSITE_STRATEGY_ID,
    _apply,
    _deribit_patches,
    _LIVE_JOB_ABSENT,
    _FakeSupabase,
)

# The two closures under test, by the name their frames carry. Discovery keys
# on these; it never lists the CALLS they make.
_STAMP_CLOSURES = frozenset({"_stamp_strategy_analytics_failed", "_stamp_failed"})
_JOB_WORKER_FILE = _jw.__file__

_SINGLE_KEY_MARKER = "ledger-refresh"
_COMPOSITE_MARKER = "ledger-refresh-composite"
_SINGLE_KEY_STRATEGY_ID = "strat-ledger-1"
_JOB_ID = "job-stamp-io-1"

_SINGLE_KEY_CAUSE = "Insufficient broker history"
_COMPOSITE_CAUSE = "Composite strategy has no member keys."


def _in_a_stamp_closure() -> bool:
    frame = sys._getframe(1)
    while frame is not None:
        code = frame.f_code
        if code.co_name in _STAMP_CLOSURES and code.co_filename == _JOB_WORKER_FILE:
            return True
        frame = frame.f_back  # type: ignore[assignment]
    return False


@dataclass
class _Call:
    target: str
    ops: tuple[str, ...]

    @property
    def is_analytics_write(self) -> bool:
        return self.target == "strategy_analytics" and bool(
            {"upsert", "update", "insert", "delete"} & set(self.ops)
        )

    def label(self) -> str:
        return f"{self.target}.{'.'.join(self.ops) or 'execute'}"


@dataclass
class _Recorder:
    """Counts ``.execute()`` calls made from inside a stamp closure, and makes
    the one at ``fail_at`` raise ``failure`` INSTEAD of reaching the fake, so a
    failed write leaves nothing behind in the fake's own write log."""

    fail_at: int | None = None
    failure: Callable[[str], BaseException] | None = None
    closure_calls: list[_Call] = field(default_factory=list)
    # Closure calls whose ``.execute()`` RETURNED. The single-key harness logs
    # an upsert when ``.upsert(...)`` is built, before ``.execute()``, so its own
    # log cannot say whether a write landed. This list can.
    landed: list[_Call] = field(default_factory=list)

    def on_execute(self, call: _Call) -> bool:
        if not _in_a_stamp_closure():
            return False
        index = len(self.closure_calls)
        self.closure_calls.append(call)
        if index == self.fail_at and self.failure is not None:
            raise self.failure(f"simulated failure of stamp call {index} {call.label()}")
        return True


class _Chain:
    """Forwards a PostgREST-style builder chain to ``inner``, recording the
    method names on the way, and reports ``.execute()`` to the recorder."""

    def __init__(self, inner: Any, recorder: _Recorder, target: str, ops: tuple[str, ...]):
        self._inner = inner
        self._recorder = recorder
        self._target = target
        self._ops = ops

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._inner, name)
        if name == "execute":

            def _execute(*args: Any, **kwargs: Any) -> Any:
                call = _Call(self._target, self._ops)
                in_closure = self._recorder.on_execute(call)
                answer = attr(*args, **kwargs)
                if in_closure:
                    self._recorder.landed.append(call)
                return answer

            return _execute
        if callable(attr):

            def _step(*args: Any, **kwargs: Any) -> Any:
                return _Chain(
                    attr(*args, **kwargs), self._recorder, self._target, self._ops + (name,)
                )

            return _step
        return attr


class _RecordingClient:
    def __init__(self, inner: Any, recorder: _Recorder):
        self._inner = inner
        self._recorder = recorder

    def table(self, name: str) -> _Chain:
        return _Chain(self._inner.table(name), self._recorder, name, ())

    def rpc(self, name: str, *args: Any, **kwargs: Any) -> _Chain:
        return _Chain(self._inner.rpc(name, *args, **kwargs), self._recorder, f"rpc:{name}", ())

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


# ---------------------------------------------------------------------------
# Scenarios. Each is one path through a stamp closure; discovery finds its calls.
# ---------------------------------------------------------------------------
@dataclass(frozen=True, eq=False)
class _Scenario:
    closure: str  # "single-key" | "composite"
    name: str
    marked: bool
    live_metadata: object  # what the live compute_jobs row holds
    published: bool  # whether strategy_analytics is terminal-success
    protected: bool  # whether the clean run takes the D-15 error-only path
    # Whether the live answer is an invariant breach (``NO_ROW``), which
    # ``_log_marker_not_confirmed`` logs at ERROR before the loud stamp.
    breach_line: bool = False


_SCENARIOS: tuple[_Scenario, ...] = (
    _Scenario("single-key", "protected", True, {"source": _SINGLE_KEY_MARKER}, True, True),
    _Scenario(
        "single-key", "loud-over-retracted-row", True,
        {"refresh_marker_retracted": _SINGLE_KEY_MARKER}, True, False,
    ),
    _Scenario("single-key", "loud-over-missing-row", True, None, True, False, True),
    _Scenario("single-key", "unmarked", False, None, True, False),
    _Scenario("composite", "protected", True, {"source": _COMPOSITE_MARKER}, True, True),
    _Scenario(
        "composite", "loud-over-retracted-row", True,
        {"refresh_marker_retracted": _COMPOSITE_MARKER}, True, False,
    ),
    _Scenario("composite", "loud-over-missing-row", True, _LIVE_JOB_ABSENT, True, False, True),
    _Scenario("composite", "unmarked-first-compute", False, _LIVE_JOB_ABSENT, False, False),
)


@dataclass
class _Outcome:
    result: Any
    analytics_writes: list[dict[str, Any]]
    log: MagicMock
    sentry: MagicMock
    recorder: _Recorder


async def _drive(scenario: _Scenario, recorder: _Recorder) -> _Outcome:
    log = MagicMock()
    sentry = MagicMock()
    inline_db = patch(
        "services.db.db_execute", new=AsyncMock(side_effect=lambda fn: fn())
    )
    no_backoff = (
        patch("services.db.DB_READ_BACKOFF_BASE_S", 0.0),
        patch("services.db.DB_READ_JITTER_MAX_S", 0.0),
    )
    if scenario.closure == "single-key":
        ctx, capture = _build_ctx(
            key_row={"id": "key-1", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": _SINGLE_KEY_STRATEGY_ID, "user_id": "user-1"},
        )
        _stub_reads(
            ctx,
            analytics_row=(
                {"computation_status": "complete_with_warnings"}
                if scenario.published
                else None
            ),
            job_row=(
                {"metadata": scenario.live_metadata}
                if isinstance(scenario.live_metadata, dict)
                else None
            ),
        )
        ctx.supabase = _RecordingClient(ctx.supabase, recorder)
        job: dict[str, Any] = {
            "id": _JOB_ID,
            "kind": "derive_broker_dailies",
            "strategy_id": _SINGLE_KEY_STRATEGY_ID,
        }
        if scenario.marked:
            job["metadata"] = {"source": _SINGLE_KEY_MARKER}
        patches = _patches_with_combine(
            ctx, key_mode=False, combine_mock=_insufficient_combine()
        )
        with ExitStack() as stack:
            for p in (*patches, inline_db, *no_backoff):
                stack.enter_context(p)
            stack.enter_context(patch.object(_jw, "logger", log))
            stack.enter_context(patch("services.job_worker.sentry_sdk", sentry))
            result = await _jw.dispatch(job)
        writes = [
            dict(u[1]) for u in capture["upserts"] if u[0] == "strategy_analytics"
        ]
        return _Outcome(result, writes, log, sentry, recorder)

    fake = _FakeSupabase(
        members=[],
        existing_flags={},
        existing_status="complete_with_warnings" if scenario.published else None,
        live_job_metadata=scenario.live_metadata,
        live_job_id=_JOB_ID,
    )
    job = {"id": _JOB_ID, "kind": "stitch_composite", "strategy_id": _COMPOSITE_STRATEGY_ID}
    if scenario.marked:
        job["metadata"] = {"source": _COMPOSITE_MARKER}
    client = _RecordingClient(fake, recorder)
    with ExitStack() as stack:
        stack.enter_context(
            _apply(_deribit_patches(client, combine_returns=[], has_option_activity=False))  # type: ignore[arg-type]
        )
        for p in (inline_db, *no_backoff):
            stack.enter_context(p)
        stack.enter_context(patch("services.job_worker.logger", log))
        stack.enter_context(patch("services.job_worker.sentry_sdk", sentry))
        result = await _jw.dispatch(job)
    writes = [
        dict(payload)
        for table, payload, _conflict in fake.upserts
        if table == "strategy_analytics" and isinstance(payload, dict)
    ]
    return _Outcome(result, writes, log, sentry, recorder)


def _expected_errors_before(scenario: _Scenario, index: int) -> int:
    """ERROR lines the clean path emits BEFORE closure call ``index``: only the
    ``NO_ROW`` breach line, once the marker re-read (the closure's first
    ``compute_jobs`` call) has answered. Pins the runbook's alert-volume rows."""
    calls = _discovered(scenario)
    reads = [i for i, c in enumerate(calls) if c.target == "compute_jobs"]
    return int(scenario.breach_line and bool(reads) and index > reads[0])


def _cause_of(scenario: _Scenario) -> str:
    return _SINGLE_KEY_CAUSE if scenario.closure == "single-key" else _COMPOSITE_CAUSE


def _rendered_errors(log: MagicMock) -> list[str]:
    return [
        str(c.args[0]) % tuple(c.args[1:]) if len(c.args) > 1 else str(c.args[0])
        for c in log.error.call_args_list
        if c.args
    ]


# ---------------------------------------------------------------------------
# Discovery, at collection time, from a clean run of each scenario.
# ---------------------------------------------------------------------------
def _discover(scenario: _Scenario) -> list[_Call]:
    recorder = _Recorder()
    asyncio.run(_drive(scenario, recorder))
    return list(recorder.closure_calls)


_DISCOVERED: dict[str, list[_Call]] = {}


def _discovered(scenario: _Scenario) -> list[_Call]:
    key = f"{scenario.closure}-{scenario.name}"
    if key not in _DISCOVERED:
        _DISCOVERED[key] = _discover(scenario)
    return _DISCOVERED[key]


def _stamp_index(calls: list[_Call]) -> int:
    writes = [i for i, c in enumerate(calls) if c.is_analytics_write]
    assert len(writes) == 1, (
        f"expected exactly one strategy_analytics write inside the stamp "
        f"closure, discovered {[c.label() for c in calls]!r}. Discovery is "
        "broken or the closure writes twice."
    )
    return writes[0]


def _cases(post_stamp: bool) -> list[Any]:
    cases = []
    for scenario in _SCENARIOS:
        calls = _discovered(scenario)
        stamp_at = _stamp_index(calls)
        for index, call in enumerate(calls):
            if (index > stamp_at) != post_stamp:
                continue
            cases.append(
                pytest.param(
                    scenario,
                    index,
                    id=f"{scenario.closure}-{scenario.name}-call{index}-{call.label()}",
                )
            )
    return cases


def pytest_generate_tests(metafunc: pytest.Metafunc) -> None:
    if "pre_stamp_case" in metafunc.fixturenames:
        metafunc.parametrize(("scenario", "pre_stamp_case"), _cases(post_stamp=False))
    elif "post_stamp_case" in metafunc.fixturenames:
        metafunc.parametrize(("scenario", "post_stamp_case"), _cases(post_stamp=True))


# ---------------------------------------------------------------------------
# Anti-vacuity: discovery must see what the closures are known to do.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("scenario", _SCENARIOS, ids=lambda s: f"{s.closure}-{s.name}")
def test_discovery_sees_the_stamp(scenario: _Scenario) -> None:
    """A broken recorder (a thread hop, a renamed closure) would discover zero
    calls and every parametrised case below would vanish, passing vacuously.
    Each scenario must discover a read BEFORE its one ``strategy_analytics``
    write, and the marked scenarios must discover the live ``compute_jobs``
    re-read."""
    calls = _discovered(scenario)
    stamp_at = _stamp_index(calls)
    assert stamp_at >= 1 or scenario.closure == "single-key", (
        f"no read precedes the stamp: {[c.label() for c in calls]!r}"
    )
    targets = [c.target for c in calls[:stamp_at]]
    if scenario.marked:
        assert "compute_jobs" in targets, (
            f"the marked scenario discovered no live marker re-read: "
            f"{[c.label() for c in calls]!r}"
        )
    if scenario.closure == "composite":
        assert targets and targets[0] == "strategy_analytics", (
            "the composite stamp's first call must be its status read: "
            f"{[c.label() for c in calls]!r}"
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "scenario", [s for s in _SCENARIOS if s.protected], ids=lambda s: f"{s.closure}-{s.name}"
)
async def test_the_protected_path_with_nothing_failing_pages_nobody(
    scenario: _Scenario,
) -> None:
    """Item 4 of the round-4 brief: the wrapper adds no event on a success.
    D-15 protected the row, so 0 ERROR and 0 captures."""
    outcome = await _drive(scenario, _Recorder())
    assert outcome.result.error_kind == "permanent", outcome.result
    assert outcome.analytics_writes and not any(
        "computation_status" in w for w in outcome.analytics_writes
    ), outcome.analytics_writes
    assert outcome.log.error.call_count == 0, outcome.log.error.call_args_list
    assert outcome.sentry.capture_exception.call_count == 0


# ---------------------------------------------------------------------------
# Every call up to and including the stamp write.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_a_failing_stamp_call_keeps_the_cause_and_files_transient(
    scenario: _Scenario, pre_stamp_case: int
) -> None:
    recorder = _Recorder(fail_at=pre_stamp_case, failure=RuntimeError)
    outcome = await _drive(scenario, recorder)
    cause = _cause_of(scenario)
    failed = recorder.closure_calls[pre_stamp_case]
    message = outcome.result.error_message or ""

    assert outcome.result.outcome == DispatchOutcome.FAILED
    # (a)
    assert outcome.result.error_kind == "transient", (
        f"a failed {failed.label()} was filed {outcome.result.error_kind!r}, not "
        f"transient: {message!r}"
    )
    # (b)
    assert cause in message, (
        f"last_error lost the curated cause behind a failed {failed.label()}: {message!r}"
    )
    assert "RuntimeError: simulated failure of stamp call" in message, (
        f"last_error does not name the failed call: {message!r}"
    )
    # (c)
    cause_lines = [line for line in _rendered_errors(outcome.log) if cause in line]
    assert len(cause_lines) == 1, (
        f"expected exactly one ERROR line carrying the cause, got {cause_lines!r}"
    )
    assert "could not" in cause_lines[0], cause_lines
    # The runbook's alert-volume rows for a failed stamp call: ``_stamp_io``'s
    # one ERROR, plus the breach line when the live row was missing.
    assert outcome.log.error.call_count == 1 + _expected_errors_before(
        scenario, pre_stamp_case
    ), outcome.log.error.call_args_list
    # (d)
    assert outcome.sentry.capture_exception.call_count == 1, (
        outcome.sentry.capture_exception.call_args_list
    )
    outcome.sentry.new_scope.return_value.__enter__.return_value.set_tag.assert_any_call(
        "compute_job_id", _JOB_ID
    )
    # (e)
    landed_writes = [c.label() for c in recorder.landed if c.is_analytics_write]
    assert not landed_writes, (
        f"a failed {failed.label()} left a strategy_analytics write behind: "
        f"{landed_writes!r}"
    )
    if scenario.closure == "composite":
        # The composite fake logs at ``.execute()``, so its own log agrees.
        assert not outcome.analytics_writes, outcome.analytics_writes


@pytest.mark.asyncio
async def test_a_programming_error_in_a_stamp_call_is_unknown_and_captured(
    scenario: _Scenario, pre_stamp_case: int
) -> None:
    """SFH-R4-02 / IN-02: a ``_READ_PROGRAMMING_ERRORS`` member is a bug, not a
    database answer. It is filed ``unknown`` under its own text, and it is still
    logged at ERROR with the cause and captured once."""
    recorder = _Recorder(fail_at=pre_stamp_case, failure=TypeError)
    outcome = await _drive(scenario, recorder)
    cause = _cause_of(scenario)
    assert outcome.result.error_kind == "unknown", outcome.result
    assert "simulated failure of stamp call" in (outcome.result.error_message or "")
    cause_lines = [line for line in _rendered_errors(outcome.log) if cause in line]
    assert len(cause_lines) == 1, cause_lines
    assert "programming error" in cause_lines[0], cause_lines
    assert outcome.log.error.call_count == 1 + _expected_errors_before(
        scenario, pre_stamp_case
    ), outcome.log.error.call_args_list
    assert outcome.sentry.capture_exception.call_count == 1
    outcome.sentry.new_scope.return_value.__enter__.return_value.set_tag.assert_any_call(
        "compute_job_id", _JOB_ID
    )
    assert not [c for c in recorder.landed if c.is_analytics_write], recorder.landed


@pytest.mark.asyncio
async def test_a_stamp_call_cut_off_by_the_handler_deadline_logs_the_cause() -> None:
    """SFH-R5-01: ``dispatch``'s per-kind ``wait_for`` cancels a stamp call
    that is still waiting. ``CancelledError`` is a ``BaseException``, so
    ``_stamp_io``'s ``except Exception`` never sees it. Before its own arm, the
    job was filed ``transient`` with only "Handler exceeded timeout" and the
    curated cause was on no line at all. Now ONE ERROR line carries it, with no
    capture, and the cancel still propagates (the filing is unchanged).

    Neuter to redden: delete the ``except asyncio.CancelledError`` arm in
    ``_stamp_io``. No ERROR line carries the cause."""

    async def _hang(_fn: Any) -> Any:
        await asyncio.sleep(30)

    fake = _FakeSupabase(members=[], existing_flags={}, existing_status=None)
    log = MagicMock()
    sentry = MagicMock()
    job = {"id": _JOB_ID, "kind": "stitch_composite", "strategy_id": _COMPOSITE_STRATEGY_ID}
    with ExitStack() as stack:
        stack.enter_context(
            _apply(_deribit_patches(fake, combine_returns=[], has_option_activity=False))
        )
        stack.enter_context(patch.dict(_jw.TIMEOUT_PER_KIND, {"stitch_composite": 0.2}))
        stack.enter_context(patch.object(_jw, "db_read_with_retry", _hang))
        stack.enter_context(patch("services.job_worker.logger", log))
        stack.enter_context(patch("services.job_worker.sentry_sdk", sentry))
        result = await _jw.dispatch(job)

    assert result.error_kind == "transient", result
    assert (result.error_message or "").startswith("Handler exceeded timeout"), result
    cause_lines = [line for line in _rendered_errors(log) if _COMPOSITE_CAUSE in line]
    assert len(cause_lines) == 1, log.error.call_args_list
    assert "CANCELLED" in cause_lines[0], cause_lines
    assert _jw._STAMP_OP_STATUS_READ in cause_lines[0], cause_lines
    assert log.error.call_count == 1, log.error.call_args_list
    assert sentry.capture_exception.call_count == 0
    assert not fake.upserts, fake.upserts


# ---------------------------------------------------------------------------
# Every call AFTER the stamp write landed (the single-key series heal).
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_a_failing_post_stamp_call_keeps_the_landed_stamp(
    scenario: _Scenario, post_stamp_case: int
) -> None:
    """The stamp has landed with the cause in ``computation_error``, so a
    failure here loses nothing: the job stays ``permanent``, the stamp stays,
    the heal's WARNING names the failure, and ``_stamp_io`` logs nothing."""
    recorder = _Recorder(fail_at=post_stamp_case, failure=RuntimeError)
    outcome = await _drive(scenario, recorder)
    cause = _cause_of(scenario)
    assert outcome.result.error_kind == "permanent", outcome.result
    assert len(outcome.analytics_writes) == 1
    assert cause in (outcome.analytics_writes[0].get("computation_error") or "")
    assert outcome.sentry.capture_exception.call_count == 0
    assert not [line for line in _rendered_errors(outcome.log) if "could not" in line]
    # The heal adds no ERROR: the count is the landed loud stamp's own row
    # (the "no longer protects it" line when marked, plus the breach line).
    assert outcome.log.error.call_count == int(scenario.marked) + int(
        scenario.breach_line
    ), outcome.log.error.call_args_list
    assert any(
        c.args and "heal-delete failed" in str(c.args[0])
        for c in outcome.log.warning.call_args_list
    ), outcome.log.warning.call_args_list


def test_the_post_stamp_set_is_the_heal_and_only_on_the_single_key_loud_path() -> None:
    """Pins where post-stamp calls exist, so the post-stamp test above cannot
    silently collect zero cases (or collect a composite call that should have
    been wrapped)."""
    for scenario in _SCENARIOS:
        calls = _discovered(scenario)
        after = calls[_stamp_index(calls) + 1 :]
        if scenario.closure == "single-key" and not scenario.protected:
            assert after and all(c.target == "strategy_analytics_series" for c in after), (
                f"{scenario.name}: {[c.label() for c in calls]!r}"
            )
        else:
            assert not after, f"{scenario.closure}-{scenario.name}: {[c.label() for c in after]!r}"


# ---------------------------------------------------------------------------
# IN-04: the marker logger's refusal cannot be caught by an ``except ValueError``.
# ---------------------------------------------------------------------------
def test_the_marker_logger_refusal_is_not_a_value_error() -> None:
    """The composite MTM ``try`` has an F-5 ``except ValueError`` arm that calls
    ``_stamp_failed`` again under a different cause. A refusal raised inside the
    first stamp must pass through it. Neuter: make ``MarkerStateNotLoggable``
    subclass ``ValueError`` and the ``except ValueError`` below catches it."""
    assert not issubclass(_jw.MarkerStateNotLoggable, ValueError)
    for state in (_jw.MarkerLiveState.PRESENT, object()):
        try:
            _jw._log_marker_not_confirmed(
                state,  # type: ignore[arg-type]
                site="test-site",
                job_id="job-1",
                strategy_id="s",
                consequence="Taking the LOUD terminal path",
            )
        except ValueError:  # the F-5 arm's shape
            pytest.fail(f"an except ValueError arm caught the refusal for {state!r}")
        except _jw.MarkerStateNotLoggable:
            pass
        else:
            pytest.fail(f"no refusal for {state!r}")


@pytest.mark.asyncio
async def test_an_unloggable_state_in_the_mtm_stamp_is_not_restamped_by_f5() -> None:
    """End to end at the site IN-04 names: the degenerate-length MTM stamp sits
    inside the MTM ``try`` whose F-5 ``except ValueError`` stamps again. A
    stand-in future ``MarkerLiveState`` member reaches the logger's refusal from
    inside that first stamp. It must propagate (``unknown``) after ONE marker
    read, not be caught and re-stamped under the chain-break cause (two reads)."""
    import pandas as pd

    from tests.test_stitch_composite_job import _member, _returns

    fake = _FakeSupabase(
        members=[_member(1, "2024-01-01", "2024-02-01"), _member(2, "2024-02-01", None)],
        existing_status="complete_with_warnings",
    )
    cash_m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    cash_m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    mtm_m1 = _returns([("2024-01-01", 0.10)])
    mtm_m2 = pd.Series(
        [float("nan")], index=pd.DatetimeIndex(["2024-02-01"]).as_unit("us"),
        dtype="float64",
    )
    future_state = object()
    marker_read = AsyncMock(return_value=future_state)
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(cash_m1, {}), (cash_m2, {}), (mtm_m1, {}), (mtm_m2, {})],
        has_option_activity=False,
    )), patch.object(_jw, "_read_refresh_marker_state", marker_read), \
         patch("services.job_worker.sentry_sdk"):
        result = await _jw.dispatch(
            {
                "id": _JOB_ID,
                "kind": "stitch_composite",
                "strategy_id": _COMPOSITE_STRATEGY_ID,
                "metadata": {"source": _COMPOSITE_MARKER},
            }
        )
    assert marker_read.await_count == 1, (
        "the F-5 except ValueError arm caught the logger's refusal and ran "
        f"_stamp_failed again ({marker_read.await_count} marker reads)"
    )
    assert result.error_kind == "unknown", result
    assert "no arm" in (result.error_message or ""), result
    assert not [
        p for t, p, _c in fake.upserts
        if t == "strategy_analytics" and isinstance(p, dict) and "computation_error" in p
    ], "a stamp landed although the logger refused the state"


@pytest.mark.asyncio
async def test_a_non_object_flags_value_is_stamped_once_not_restamped_by_f5() -> None:
    """SFH-R5-05: ``data_quality_flags`` is ``jsonb``, so a non-object value is
    storable. ``dict()`` on it used to raise ``ValueError`` after the status read
    and before any write. At the degenerate-length MTM stamp that raise sits
    inside the MTM ``try``, whose F-5 ``except ValueError`` called
    ``_stamp_failed`` AGAIN under the chain-break cause. Now the value is
    dropped with a WARNING and the FIRST stamp lands, once, under its own cause.

    Neuter to redden: restore ``dict(existing_row.get("data_quality_flags") or
    {})`` in the composite ``_stamp_failed``. No stamp lands."""
    import pandas as pd

    from tests.test_stitch_composite_job import _member, _returns

    fake = _FakeSupabase(
        members=[_member(1, "2024-01-01", "2024-02-01"), _member(2, "2024-02-01", None)],
        existing_status=None,
    )
    real_read = _jw.db_read_with_retry
    status_reads: list[int] = []

    async def _read_with_a_non_object_flags_value(fn: Any) -> Any:
        # The fake serves a dict copy of its flags, so the malformed jsonb value
        # is put on the stamp's status-read answer here.
        row = await real_read(fn)
        if isinstance(row, dict) and "data_quality_flags" in row:
            status_reads.append(1)
            row = {**row, "data_quality_flags": "not-an-object"}
        return row

    cash_m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    cash_m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    mtm_m1 = _returns([("2024-01-01", 0.10)])
    mtm_m2 = pd.Series(
        [float("nan")], index=pd.DatetimeIndex(["2024-02-01"]).as_unit("us"),
        dtype="float64",
    )
    log = MagicMock()
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(cash_m1, {}), (cash_m2, {}), (mtm_m1, {}), (mtm_m2, {})],
        has_option_activity=False,
    )), patch("services.job_worker.logger", log), \
         patch.object(_jw, "db_read_with_retry", _read_with_a_non_object_flags_value), \
         patch("services.job_worker.sentry_sdk"):
        result = await _jw.dispatch(
            {"id": _JOB_ID, "kind": "stitch_composite", "strategy_id": _COMPOSITE_STRATEGY_ID}
        )
    stamps = [
        p for t, p, _c in fake.upserts
        if t == "strategy_analytics" and isinstance(p, dict) and "computation_error" in p
    ]
    assert len(status_reads) == 1, (
        f"_stamp_failed ran {len(status_reads)} times: the F-5 arm re-stamped"
    )
    assert len(stamps) == 1, (result, stamps)
    assert stamps[0]["data_quality_flags"] == {"csv_source": True, "composite": True}
    assert result.error_kind == "permanent", result
    assert any(
        c.args and "non-object data_quality_flags" in str(c.args[0])
        for c in log.warning.call_args_list
    ), log.warning.call_args_list
