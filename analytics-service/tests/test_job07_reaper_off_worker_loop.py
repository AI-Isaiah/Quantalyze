"""Phase 142 (JOB-07) — the strategy_analytics stuck-`computing` reaper must
NEVER run on the worker's shared asyncio event loop.

Root cause this regression-proofs (WEDGE-01, v1.11 FLIP rollback): heavy
synchronous work on the shared loop froze the healthz heartbeat — the worker
went dark for ~12 minutes while the 90s auto-restart never fired because
``LAST_TICK_AT`` was stamped by the very loop that was wedged.

**Why this file is shaped the way it is.** The reaper lands in pg_cron BY
CONSTRUCTION (142-CONTEXT, "Reaper mechanism & scheduling"), so there is no
worker-loop code path to stall. That makes the naive behavioural form of this
gate — "drive a backlog, assert healthz stays 200" — *incapable of failing*: it
passes trivially, today and forever, for any implementation. A test that cannot
fail is not evidence. The gate therefore has two halves, and the teeth live in
the first plus the controls:

  * **STRUCTURAL (the enforceable property)** — no reaper identifier is
    reachable from the worker's dispatch surface. Comment-stripped token scan
    over the dispatch-reachable files, mirroring the established grep-gate style
    of ``tests/test_dark_path_deleted.py:23-118``. Paired with a scanner
    self-test so the gate is demonstrably capable of RED (a synthetic line
    bearing the cron jobname MUST be flagged), and an anti-vacuity assert so a
    broken path resolution cannot green-skip the whole file.
  * **BEHAVIOURAL + CONTROL PAIR** (``TestReaperOffWorkerLoopBehavior``, below)
    — a real healthz TCP probe against the real deployed server, plus the
    falsifier that gives the 200 meaning: the same work run BLOCKING
    (``time.sleep``) starves the probe and freezes ``LAST_TICK_AT``, while the
    YIELDING twin (``asyncio.sleep``) stays fast and green. The pair differs in
    exactly one token, so it pins the PROPERTY (blocking vs yielding), not an
    implementation detail.

**Honesty bound** (research §JOB-07; ``main_worker.py:637-641``): the heartbeat
catches a LOOP-BLOCKING freeze (a non-yielding await / CPU spin / deadlock). It
does NOT catch a YIELDING single-job hang — a dead upstream we keep awaiting
leaves the loop alive, so healthz stays green. That case is backstopped by the
per-kind outer ``wait_for`` and the DB watchdog re-claim, NOT by healthz. No
assertion in this file may be read as covering it.

Second direction (JOB-02 hygiene): the superseded one-off
``scripts/reset_stuck_computing_rows.py`` is DELETED in this phase and must stay
deleted — it is broken code, not a reference implementation (142-RESEARCH C-5).
"""

from __future__ import annotations

import asyncio
import time
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

import main_worker
import main_worker_healthz
from main_worker import dispatch_tick
from services.job_worker import DispatchOutcome, DispatchResult

# The TCP-probe helpers are IMPORTED, not forked, from the WORKER-02 analog
# (`tests/test_worker_isolation_e2e.py:48,62,80`). Re-typing them here would
# create a second implementation that could drift from the one the existing
# isolation suite trusts.
from tests.test_worker_isolation_e2e import (  # noqa: E402
    _free_ephemeral_port,
    _probe_healthz,
    _wait_port_listening,
)

# D-10: the scan surface is SHARED, not forked. This file previously carried its
# own `_py_scan_files` naming five files by hand — a strict subset of the union
# `test_computing_started_at_stamp` walked, while its docstring claimed parity.
from tests._scan_helpers import (
    _count_in_text,
    _is_pure_comment,
    _py_scan_files,
    _repo_root,
)

# ---------------------------------------------------------------------------
# Forbidden tokens — LOCAL literals, deliberately never a shared constant.
# ---------------------------------------------------------------------------
# Nothing in production Python may know these names. Importing them from a
# shared module would defeat the gate twice over: the import site would itself
# be a reachable reference, and the scan would then be comparing the surface
# against a value the surface supplies.
#
#   * REAPER_CRON_JOBNAME — the pg_cron job created by plan 142-04's migration.
#     Its presence anywhere on the dispatch surface means reaper work was wired
#     onto the worker loop (the WEDGE-01 regression).
#   * DELETED_ONE_OFF_STEM — the superseded script; guards resurrection.
REAPER_CRON_JOBNAME = "reap_strategy_analytics_stuck_computing"
DELETED_ONE_OFF_STEM = "reset_stuck_computing_rows"
FORBIDDEN_TOKENS = (REAPER_CRON_JOBNAME, DELETED_ONE_OFF_STEM)


# ---------------------------------------------------------------------------
# Scan surface — see tests/_scan_helpers.py.
# ---------------------------------------------------------------------------
# ``_py_scan_files`` is the SHARED union defined in ``tests/_scan_helpers.py``:
# ``{main_worker.py, main.py} ∪ services/** ∪ routers/** ∪ scripts/**``. Any
# wiring of reaper work onto the shared event loop lands in one of these.
#
# ⚠️ It was NOT always this wide. Until phase 142.1 (D-10) this file carried a
# private copy that named five files by hand — ``services/analytics_runner.py``,
# ``services/job_worker.py``, ``routers/cron.py`` and the two entrypoints — and
# its docstring simultaneously claimed the same list as
# ``test_dark_path_deleted`` (true) AND coverage of "any wiring of reaper work"
# (FALSE: ``services/`` was cherry-picked to two modules, so a reaper wired into
# e.g. ``services/basis_series.py`` was invisible while this gate stayed green).
# The claim is honest again only because the surface is now the walked union;
# do not re-narrow it to a hand list.


# ---------------------------------------------------------------------------
# STRUCTURAL — the reaper identifier is unreachable from the worker surface.
# ---------------------------------------------------------------------------


def test_no_reaper_identifier_on_worker_surface() -> None:
    """ZERO comment-stripped occurrences of the reaper cron jobname (or the
    deleted one-off's module stem) anywhere on the dispatch-reachable Python
    surface.

    This is the JOB-07 property in its enforceable form. The reaper is a
    pg_cron-scheduled SQL function in a separate failure domain; the moment any
    of its identifiers becomes reachable from ``dispatch_tick``, someone has
    started running janitor work on the money-pipeline worker's shared loop —
    the WEDGE-01 class. Failure message names file:line per hit so the
    offending wiring is findable without re-grepping.
    """
    scan = _py_scan_files()
    # Anti-vacuity (S-5): a broken _repo_root/rglob would return [] and every
    # assert below would pass over nothing.
    assert scan, "the py scan found no files — path resolution is broken"
    assert any(f.name == "main_worker.py" for f in scan), (
        "the scan surface must include main_worker.py (the dispatch_tick "
        "entrypoint); without it the gate cannot see the loop it guards"
    )

    offenders: list[str] = []
    for path in scan:
        text = path.read_text()
        for lineno, line in enumerate(text.splitlines(), start=1):
            if _is_pure_comment(line):
                continue
            for token in FORBIDDEN_TOKENS:
                if token in line:
                    offenders.append(f"{path}:{lineno}: {token}")

    assert not offenders, (
        "JOB-07 violated: a reaper identifier is reachable from the worker's "
        "dispatch surface. The strategy_analytics stuck-`computing` reaper runs "
        "in pg_cron precisely so no janitor work can block the shared asyncio "
        "event loop (WEDGE-01). Move it back to pg_cron:\n"
        + "\n".join(offenders)
    )


def test_scanner_flags_a_synthetic_reaper_identifier() -> None:
    """Positive control for the structural gate: the scanner MUST flag a
    synthetic source line that wires the reaper jobname onto the worker, and
    MUST NOT flag a comment that merely mentions it.

    Without this, ``test_no_reaper_identifier_on_worker_surface`` green could
    mean either "the property holds" or "the scanner is broken/never matches".
    This is the SC-4 structural half proving it is capable of RED.
    """
    violating_source = (
        "async def dispatch_tick(worker_id):\n"
        f'    await run_cron_job("{REAPER_CRON_JOBNAME}")\n'
    )
    assert _count_in_text(violating_source, REAPER_CRON_JOBNAME) == 1, (
        "the scanner failed to flag a synthetic line wiring the reaper jobname "
        "into dispatch_tick — the structural gate cannot fail, so its GREEN is "
        "worthless"
    )

    commented_source = (
        f"# the reaper is pg_cron-only: {REAPER_CRON_JOBNAME}\n"
        "async def dispatch_tick(worker_id):\n"
        "    return None\n"
    )
    assert _count_in_text(commented_source, REAPER_CRON_JOBNAME) == 0, (
        "grep-gate hygiene broken: a pure comment mentioning the jobname must "
        "neither trip nor satisfy the gate"
    )

    # Same two directions for the deleted-script stem, so a resurrection guard
    # that silently stopped matching is caught too.
    assert (
        _count_in_text(f'    subprocess.run(["python", "-m", "scripts.{DELETED_ONE_OFF_STEM}"])\n', DELETED_ONE_OFF_STEM)
        == 1
    )
    assert _count_in_text(f"    # {DELETED_ONE_OFF_STEM}\n", DELETED_ONE_OFF_STEM) == 0


def test_superseded_one_off_stays_deleted() -> None:
    """``analytics-service/scripts/reset_stuck_computing_rows.py`` stays deleted.

    It is NOT a working reference implementation. It selects and filters on
    ``updated_at`` — a column ``strategy_analytics`` does not have — so under
    PostgREST it raises SQLSTATE 42703 and reaps nothing (142-RESEARCH C-5).
    Its user-facing message ("interrupted during platform upgrade") is a false,
    dated cause, and it never clears ``computation_warned``, so a row it *did*
    reach could launder through the status bridge into
    ``complete_with_warnings`` — a false success on a money surface.

    The pg_cron reaper introduced by this phase's migration supersedes it. If
    the script is ever recreated, this assert is the loud stop.
    """
    svc = _repo_root() / "analytics-service"
    rel = f"scripts/{DELETED_ONE_OFF_STEM}.py"
    assert not (svc / rel).exists(), (
        f"{rel} was recreated — it must stay deleted: it filters on a "
        "non-existent `updated_at` column (42703), misattributes the cause, and "
        "omits the `computation_warned = FALSE` clear. The pg_cron reaper "
        "supersedes it; do not resurrect the one-off."
    )


# ===========================================================================
# BEHAVIOURAL — the real healthz TCP probe, plus the control pair that gives
# its 200 any meaning.
# ===========================================================================

# How long the simulated janitor pass occupies the worker. Long enough that a
# BLOCKING arm is unambiguously distinguishable from a yielding one at the
# thresholds asserted below, short enough to keep the file well under 15s.
_WORK_S = 0.5

# Shrunk copies of the two production knobs. Both are read at request/tick time
# (`main_worker_healthz._handle_healthz` reads STALE_THRESHOLD per request;
# `_heartbeat` reads the interval per loop), so monkeypatching the module
# attributes takes effect without touching production defaults.
_FAST_HEARTBEAT_S = 0.02
_TIGHT_STALE_THRESHOLD_S = 0.2


def _stranded_backlog_supabase(
    jobs: list[dict[str, Any]], *, backlog_rows: int
) -> MagicMock:
    """A supabase double whose `strategy_analytics` surface holds a large
    stranded-`computing` backlog while the claim RPC returns a normal small
    batch — i.e. exactly the DB state the pg_cron reaper exists to drain."""
    mock_supabase = MagicMock()

    claim_chain = MagicMock()
    claim_chain.execute.return_value = MagicMock(data=jobs)
    mock_supabase.rpc.return_value = claim_chain

    backlog = [
        {
            "strategy_id": f"s-stranded-{i}",
            "computation_status": "computing",
            "computing_started_at": "2026-08-01T00:00:00+00:00",
        }
        for i in range(backlog_rows)
    ]
    table_chain = MagicMock()
    for builder in ("select", "eq", "lt", "is_", "order", "limit"):
        getattr(table_chain, builder).return_value = table_chain
    table_chain.execute.return_value = MagicMock(data=backlog)
    mock_supabase.table.return_value = table_chain

    return mock_supabase


async def _drive_probe_against_dispatch(
    monkeypatch: pytest.MonkeyPatch, *, blocking: bool
) -> dict[str, Any]:
    """Run ONE real ``dispatch_tick`` whose handler occupies the worker for
    ``_WORK_S`` and probe the REAL healthz server while it does.

    The two arms differ in exactly one token — ``time.sleep`` (blocks the shared
    event loop, the WEDGE-01 shape a reaper wrongly run on the worker would
    have) versus ``await asyncio.sleep`` (yields). Everything else — the mock
    supabase, the port, the heartbeat interval, the staleness threshold, the
    probe timing — is shared code, so any observed difference is attributable to
    the blocking-vs-yielding property and nothing else.

    Returns the observations: LAST_TICK_AT sampled immediately before and
    immediately after the work (both sampled INSIDE the handler, so the
    "after" sample is taken before the loop can run anything else), the probe
    response bytes, and the probe latency measured from the instant the work is
    released.
    """
    monkeypatch.setattr(main_worker, "_HEARTBEAT_INTERVAL_S", _FAST_HEARTBEAT_S)
    monkeypatch.setattr(
        main_worker_healthz, "STALE_THRESHOLD", _TIGHT_STALE_THRESHOLD_S
    )

    port = _free_ephemeral_port()
    monkeypatch.setenv("PORT", str(port))

    jobs = [{"id": "job-janitor-sim", "kind": "sync_trades", "strategy_id": "s-1"}]
    mock_supabase = _stranded_backlog_supabase(jobs, backlog_rows=5_000)

    entered = asyncio.Event()
    release = asyncio.Event()
    obs: dict[str, Any] = {}

    async def _work(job: dict[str, Any]) -> DispatchResult:
        entered.set()
        # Wait until the probe has been issued, so both arms are probed at the
        # same point in the handler's life — no timing asymmetry between them.
        await release.wait()
        obs["tick_before_work"] = main_worker_healthz.LAST_TICK_AT
        if blocking:
            time.sleep(_WORK_S)  # <-- the ONLY difference between the arms
        else:
            await asyncio.sleep(_WORK_S)  # <-- the ONLY difference
        obs["tick_after_work"] = main_worker_healthz.LAST_TICK_AT
        return DispatchResult(outcome=DispatchOutcome.DONE)

    _saved_latch = (main_worker._FALLBACK_CLAIM_RPC, main_worker._FALLBACK_LATCHED_AT)
    _saved_tick = main_worker_healthz.LAST_TICK_AT
    main_worker._FALLBACK_CLAIM_RPC = False
    main_worker._FALLBACK_LATCHED_AT = 0.0

    server_task = asyncio.create_task(main_worker_healthz.start_healthz_server())
    try:
        await _wait_port_listening(port)
        with patch("main_worker.get_supabase", return_value=mock_supabase), patch(
            "main_worker.dispatch", new=_work
        ):
            dt = asyncio.create_task(dispatch_tick("worker-job07"))
            await entered.wait()
            probe_task = asyncio.create_task(_probe_healthz(port))
            # One loop turn so the probe has opened its connection before the
            # work starts — otherwise the blocking arm would wedge the loop
            # before the request is even on the wire and we would be measuring
            # connect latency instead of service latency.
            await asyncio.sleep(0)
            started_at = time.monotonic()
            release.set()
            obs["response"] = await probe_task
            obs["latency"] = time.monotonic() - started_at
            # Recorded, NOT asserted here: whether the probe was serviced while
            # the dispatch was still in flight is itself part of the asymmetry
            # the two arms expose (the yielding twin asserts it; a wedged loop
            # by definition cannot service anything until it releases).
            obs["probe_landed_mid_dispatch"] = not dt.done()
            await dt
    finally:
        server_task.cancel()
        try:
            await server_task
        except asyncio.CancelledError:
            pass
        main_worker_healthz.LAST_TICK_AT = _saved_tick
        (
            main_worker._FALLBACK_CLAIM_RPC,
            main_worker._FALLBACK_LATCHED_AT,
        ) = _saved_latch

    return obs


class TestReaperOffWorkerLoopBehavior:
    """The deployed healthz server, probed over a real TCP socket while a real
    ``dispatch_tick`` is in flight — with the control pair that makes a 200
    mean something."""

    @pytest.mark.asyncio
    async def test_healthz_stays_200_with_large_stranded_backlog(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """With 5,000 stranded ``computation_status='computing'`` rows present,
        a mid-dispatch probe of the REAL healthz server answers 200 and
        ``LAST_TICK_AT`` advances.

        ⚠️ READ THIS BEFORE TRUSTING THIS TEST. **On its own it cannot fail for
        the JOB-07 property.** The reaper is a pg_cron-scheduled SQL function,
        so there is no worker-loop reap path that a backlog could stall — this
        assertion passes trivially for every possible implementation of the
        reaper, including a catastrophically wrong one. It is kept because it
        pins the *composed* worker (real server + real dispatch_tick +
        heartbeat) against the backlog state, not because it is evidence.

        The teeth for JOB-07 live in
        ``test_no_reaper_identifier_on_worker_surface`` (the structural gate,
        with its scanner self-test) and in the blocking-vs-yielding control pair
        below, which CAN and does fail. Do not cite this test as proof that the
        reaper is off the loop.
        """
        monkeypatch.setattr(main_worker, "_HEARTBEAT_INTERVAL_S", _FAST_HEARTBEAT_S)

        port = _free_ephemeral_port()
        monkeypatch.setenv("PORT", str(port))

        jobs = [{"id": "job-slow", "kind": "sync_trades", "strategy_id": "s-slow"}]
        mock_supabase = _stranded_backlog_supabase(jobs, backlog_rows=5_000)

        # The fixture really does represent the backlog it claims to (a docstring
        # that lies about its own setup is the SEAMUX-08 defect class).
        stranded = mock_supabase.table("strategy_analytics").select("*").eq(
            "computation_status", "computing"
        ).execute().data
        assert len(stranded) == 5_000
        assert all(r["computation_status"] == "computing" for r in stranded)

        started = asyncio.Event()

        async def _slow_dispatch(job: dict[str, Any]) -> DispatchResult:
            started.set()
            await asyncio.sleep(0.3)  # ~15 heartbeat intervals, all yielding
            return DispatchResult(outcome=DispatchOutcome.DONE)

        _saved_tick = main_worker_healthz.LAST_TICK_AT
        server_task = asyncio.create_task(main_worker_healthz.start_healthz_server())
        try:
            await _wait_port_listening(port)

            with patch(
                "main_worker.get_supabase", return_value=mock_supabase
            ), patch("main_worker.dispatch", new=_slow_dispatch):
                dt = asyncio.create_task(dispatch_tick("worker-job07-backlog"))
                await started.wait()
                start_stamp = main_worker_healthz.LAST_TICK_AT
                await asyncio.sleep(0.05)
                mid_dispatch_resp = await _probe_healthz(port)
                assert not dt.done(), (
                    "probe must be captured WHILE the dispatch is in flight"
                )
                await dt

            assert b"200 OK" in mid_dispatch_resp, mid_dispatch_resp[:120]
            assert (
                b'"last_tick_at":null'
                not in mid_dispatch_resp.replace(b" ", b"")
            )
            assert main_worker_healthz.LAST_TICK_AT > start_stamp, (
                "the heartbeat must refresh LAST_TICK_AT while a dispatch runs "
                "with a large stranded backlog present"
            )
        finally:
            server_task.cancel()
            try:
                await server_task
            except asyncio.CancelledError:
                pass
            main_worker_healthz.LAST_TICK_AT = _saved_tick

    @pytest.mark.asyncio
    async def test_probe_starved_by_loop_blocking_sync_work(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """SC-4b, blocking arm — the falsifier.

        A reap run SYNCHRONOUSLY on the shared event loop (``time.sleep``, a
        stand-in for a blocking DB sweep or a pandas pass) starves the healthz
        probe: the response cannot be produced until the block releases, and the
        heartbeat cannot advance ``LAST_TICK_AT`` while the loop is wedged. That
        is WEDGE-01 exactly.

        The `LAST_TICK_AT`-did-not-advance assertion is the deterministic one:
        both samples are taken INSIDE the handler, so no scheduling race can
        smear them. The latency/503 assertion is the user-visible symptom.
        """
        obs = await _drive_probe_against_dispatch(monkeypatch, blocking=True)

        assert obs["tick_before_work"] == obs["tick_after_work"], (
            "LAST_TICK_AT advanced across a loop-BLOCKING span — impossible if "
            "the block is real, so the arm is not exercising the property "
            f"(before={obs['tick_before_work']!r} after={obs['tick_after_work']!r})"
        )

        starved_by_latency = obs["latency"] >= _WORK_S * 0.8
        starved_by_staleness = (
            b"503 Service Unavailable" in obs["response"]
            and b'"status": "stale"' in obs["response"]
        )
        assert starved_by_latency or starved_by_staleness, (
            "a loop-blocking reap must be OBSERVABLE at the healthz boundary — "
            f"expected latency >= {_WORK_S * 0.8:.2f}s or a 503 stale body, got "
            f"latency={obs['latency']:.3f}s response={obs['response'][:120]!r}. "
            "If neither holds, healthz is lying about a wedged worker."
        )

    @pytest.mark.asyncio
    async def test_probe_healthy_when_same_work_yields(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """SC-4b, yielding twin — the same driver, the same duration, the same
        thresholds, one token changed (``await asyncio.sleep``).

        The probe returns fast and 200, and the heartbeat DOES advance
        ``LAST_TICK_AT`` across the work. Paired with the blocking arm this pins
        the PROPERTY rather than an implementation: swapping the yielding sleep
        for a blocking one flips exactly one of these two tests, which is the
        red asymmetry that proves the control is live rather than decorative.
        """
        obs = await _drive_probe_against_dispatch(monkeypatch, blocking=False)

        assert obs["tick_after_work"] > obs["tick_before_work"], (
            "the heartbeat must advance LAST_TICK_AT across YIELDING work; if "
            "it does not, the twin is not actually yielding and the pair proves "
            "nothing"
        )
        assert obs["latency"] < 0.1, (
            "a yielding reap must not delay healthz — got "
            f"{obs['latency']:.3f}s (the blocking arm's symptom must be absent here)"
        )
        assert b"200 OK" in obs["response"], obs["response"][:120]
        assert obs["probe_landed_mid_dispatch"], (
            "the yielding twin's probe must be serviced WHILE the dispatch is "
            "still in flight — otherwise the 200 was captured after the work "
            "finished and proves nothing about liveness during it"
        )

    @pytest.mark.asyncio
    async def test_healthz_503_when_tick_stale(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The cheap deployed-server staleness proof (mirrors
        ``test_worker_isolation_e2e.py:182``): with ``LAST_TICK_AT`` forced past
        ``STALE_THRESHOLD`` and no dispatch running, the same real-socket probe
        returns 503 — so the probe used above exercises the real staleness
        contract and is not a stub that always answers 200.

        Honesty bound (``main_worker.py:637-641``): this is loop-liveness only.
        A YIELDING single-job hang leaves the loop alive, so healthz stays green;
        that case is covered by the per-kind outer ``wait_for`` and the DB
        watchdog re-claim, never by this probe.
        """
        port = _free_ephemeral_port()
        monkeypatch.setenv("PORT", str(port))

        _saved_tick = main_worker_healthz.LAST_TICK_AT
        server_task = asyncio.create_task(main_worker_healthz.start_healthz_server())
        try:
            await _wait_port_listening(port)
            main_worker_healthz.LAST_TICK_AT = time.time() - (
                main_worker_healthz.STALE_THRESHOLD + 10
            )
            resp = await _probe_healthz(port)
            assert b"503 Service Unavailable" in resp, resp[:120]
            assert b'"status": "stale"' in resp
        finally:
            server_task.cancel()
            try:
                await server_task
            except asyncio.CancelledError:
                pass
            main_worker_healthz.LAST_TICK_AT = _saved_tick
