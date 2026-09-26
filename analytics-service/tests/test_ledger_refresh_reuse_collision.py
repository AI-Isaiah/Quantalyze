"""Phase 161.1 / REUSE-01 — protection is NOT inheritable across a dedup collision.

The defect
----------
The D-15 refresh marker is a property of a JOB ROW, and a job row can be REUSED
by a caller who never asked for it. ``_enqueue_compute_job_internal``
(supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql
:229-262) dedupes on ``(target, kind)`` over
``('pending','running','done_pending_children')`` and RETURNS the existing id.
``p_metadata`` is DISCARDED — there is no merge arm. So:

1. the recurring fan-out enqueues ``derive_broker_dailies`` marked
   ``source='ledger-refresh'``;
2. the user resyncs → ``POST /process-key`` → ``process_key_long`` (a different
   kind, so no dedup);
3. ``process_key_long``'s tail enqueues ``derive_broker_dailies`` — and is served
   by the MARKED job, its own ``correlation_id`` discarded;
4. every later failure of that job is SUPPRESSED, at both hops and in the SQL
   bridge, on behalf of a request the user is watching.

MEASURED, not reasoned, before this file was written — against the real function
bodies on a throwaway Postgres:

* the resync enqueue returns the fan-out's job id, ``correlation_id`` does not
  survive, and the row keeps the marker;
* driving the real ``sync_strategy_analytics_status``: with the reused job
  pending, branch (a) rewrites a plain ``complete`` row to ``computing`` (loud)
  but PRESERVES ``complete_with_warnings``. The production ledger cohort is
  ``complete`` 0 / ``complete_with_warnings`` 5, so the arming case is 5/5 of live
  and the fail-safe case is 0/5. ``useStrategySyncPoller`` reads
  ``complete_with_warnings`` as TERMINAL on its first poll and stops.

The fix, and what each test pins
--------------------------------
The resync path RETRACTS the marker from the row it discovers it inherited
(``_retract_refresh_marker_on_reuse``), and every site about to HONOUR the marker
re-asks the ROW rather than trusting the claim-time snapshot
(``_refresh_marker_still_on_row``). The refresh path never LAUNDERS its marker
onto a foreign row it collided with — the mirror direction resolves toward LOUD
too, and is made VISIBLE rather than closed.

⛔ THE WINDOW THIS FILE MODELS, deliberately. A test that retracts the marker
"before the handler runs" is green against the bug, because the handler's own
entry read would then see the retraction and be loud for free. The window where
the defect actually bites is the other one: the marked job is claimed the moment
the fan-out enqueues it, the user's resync attaches MINUTES later, and the
handler's in-memory metadata still says ``ledger-refresh``. Every LOUD assertion
here therefore drives a job dict that STILL CARRIES THE MARKER against a row that
has been retracted.

Falsifiability
--------------
Every test here was observed RED before the fix and the neutering that reddens it
is named on the class. The protected/forwarded CONTROLS exist because "did not
write a publish column" passes trivially against a handler that wrote nothing at
all — if the driver breaks, the control fails first.
"""
from __future__ import annotations

import copy
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

import services.job_worker as _jw
from services.ingestion.long_fetch import (
    _retract_refresh_marker_on_reuse,
    run_process_key_long_job,
)
from services.job_worker import (
    DispatchOutcome,
    run_derive_broker_dailies_job,
)
from services.nav_twr import NavReconstructionError
from tests.test_derive_broker_dailies_dualmode import (
    _CCXT_VERDICT,
    _build_ctx,
    _patches_with_combine,
    _two_day_returns,
)
from tests.test_long_fetch_follow_on_guard import _job as _long_fetch_job
from tests.test_long_fetch_follow_on_guard import _ledger_adapter

# Hand-typed, like the other end of every cross-language contract in this phase.
_MARKER = "ledger-refresh"
_COMPOSITE_MARKER = "ledger-refresh-composite"
_STRATEGY_ID = "s-deribit-d15"  # the strategy the long_fetch driver resyncs
_DERIVE_KIND = "derive_broker_dailies"
_CSV_KIND = "compute_analytics_from_csv"

_PUBLISH_STATE_KEYS = (
    "computation_status",
    "computation_warned",
    "metrics_json_by_basis",
    "data_quality_flags",
)


# ---------------------------------------------------------------------------
# A queue double that reproduces the RPC's dedup semantics, not a stub of them
# ---------------------------------------------------------------------------
class _Queue:
    """In-memory ``compute_jobs`` with ``_enqueue_compute_job_internal``'s
    contract: dedup on ``(strategy_id, kind)`` over the three in-flight statuses,
    return the EXISTING id, and DISCARD ``p_metadata``.

    Spelled out rather than mocked because the discard IS the defect — a double
    that merged metadata would make every test here vacuous.
    """

    IN_FLIGHT = ("pending", "running", "done_pending_children")

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}
        self._next = 0

    def seed(
        self, *, kind: str, metadata: dict[str, Any] | None, status: str = "pending"
    ) -> str:
        self._next += 1
        job_id = f"job-{self._next}"
        self.rows[job_id] = {
            "id": job_id,
            "strategy_id": _STRATEGY_ID,
            "kind": kind,
            "status": status,
            "metadata": copy.deepcopy(metadata),
        }
        return job_id

    def enqueue(self, payload: dict[str, Any]) -> str:
        kind = payload["p_kind"]
        for row in self.rows.values():
            if (
                row["strategy_id"] == payload.get("p_strategy_id")
                and row["kind"] == kind
                and row["status"] in self.IN_FLIGHT
            ):
                return str(row["id"])  # ⛔ p_metadata discarded, exactly as in SQL
        return self.seed(kind=kind, metadata=payload.get("p_metadata"))

    def source_of(self, job_id: str) -> Any:
        metadata = self.rows[job_id]["metadata"]
        return metadata.get("source") if isinstance(metadata, dict) else None


def _queue_supabase(queue: _Queue, capture: dict[str, Any]) -> MagicMock:
    """Supabase double over ``queue``: a real ``compute_jobs`` select/update, the
    dedup-honest ``enqueue_compute_job`` RPC, and a 'draft' verification row so
    ``run_process_key_long_job`` runs its state machine through to the tail."""
    sb = MagicMock()

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()
        if name != "compute_jobs":
            tbl.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
                data={"status": "draft"}
            )
            return tbl

        def _select(_columns: str, **_kw: object) -> MagicMock:
            chain = MagicMock()
            state: dict[str, Any] = {}

            def _eq(col: str, val: object) -> MagicMock:
                state[col] = val
                return chain

            def _execute() -> MagicMock:
                row = queue.rows.get(str(state.get("id")))
                return MagicMock(data=copy.deepcopy(row))

            chain.eq.side_effect = _eq
            chain.maybe_single.return_value = chain
            chain.execute.side_effect = _execute
            return chain

        def _update(payload: dict[str, Any], **_kw: object) -> MagicMock:
            chain = MagicMock()
            state: dict[str, Any] = {}

            def _eq(col: str, val: object) -> MagicMock:
                state[col] = val
                return chain

            def _execute() -> MagicMock:
                job_id = str(state.get("id"))
                capture["job_updates"].append((job_id, copy.deepcopy(payload)))
                if job_id in queue.rows:
                    queue.rows[job_id].update(copy.deepcopy(payload))
                return MagicMock(data=[])

            chain.eq.side_effect = _eq
            chain.execute.side_effect = _execute
            return chain

        tbl.select.side_effect = _select
        tbl.update.side_effect = _update
        return tbl

    sb.table.side_effect = _table

    def _rpc(name: str, payload: dict[str, Any]) -> MagicMock:
        capture["rpc_calls"].append((name, copy.deepcopy(payload)))
        stub = MagicMock()
        data = queue.enqueue(payload) if name == "enqueue_compute_job" else None
        stub.execute.return_value = MagicMock(data=data)
        return stub

    sb.rpc.side_effect = _rpc
    return sb


def _one_day_returns() -> pd.Series:
    """<2 interpretable days — the ``_mark_insufficient`` trigger, the most
    destructive of the handler's terminal arms (it also DELETEs both persisted
    basis-series rows)."""
    return pd.Series([0.01], index=pd.DatetimeIndex(["2024-05-01"]), dtype="float64")


def _success_combine() -> MagicMock:
    """The two-interpretable-day success shape the sibling hop-2 driver uses —
    ``series_completeness`` included, or the MT5-12 verdict refusal fires and the
    handler never reaches its chain edge."""
    return MagicMock(
        return_value=(
            _two_day_returns(),
            {"used_heuristic_capital": False, "series_completeness": _CCXT_VERDICT},
        )
    )


def _insufficient_combine() -> MagicMock:
    return MagicMock(
        return_value=(
            _one_day_returns(),
            {"used_heuristic_capital": False, "series_completeness": _CCXT_VERDICT},
        )
    )


def _stub_reads(
    ctx: MagicMock, *, analytics_row: dict[str, Any] | None, job_row: dict[str, Any] | None
) -> None:
    """Table-aware select stub: ``compute_jobs`` answers with the LIVE job row,
    everything else with the ``strategy_analytics`` row."""
    original = ctx.supabase.table.side_effect

    def _table(name: str) -> MagicMock:
        tbl: MagicMock = original(name)
        answer = job_row if name == "compute_jobs" else analytics_row

        def _select(_columns: str, **_kw: object) -> MagicMock:
            chain = MagicMock()
            chain.eq.return_value = chain
            chain.maybe_single.return_value = chain
            chain.execute.return_value = MagicMock(data=copy.deepcopy(answer))
            return chain

        tbl.select.side_effect = _select
        return tbl

    ctx.supabase.table.side_effect = _table


async def _drive_derive(
    *,
    claimed_metadata: dict[str, Any] | None,
    live_job_row: dict[str, Any] | None,
    published_status: str = "complete_with_warnings",
    combine: MagicMock | None = None,
) -> tuple[Any, dict[str, Any]]:
    """Drive the real derive handler.

    ``claimed_metadata`` is what the CLAIM returned (the handler's in-memory
    copy); ``live_job_row`` is what ``compute_jobs`` holds NOW. Keeping them
    separate is the whole point — see this module's docstring.
    """
    ctx, capture = _build_ctx(
        key_row={"id": "key-1", "exchange": "binance", "user_id": "user-1"},
        strategy_row={"id": _STRATEGY_ID, "user_id": "user-1"},
    )
    _stub_reads(
        ctx,
        analytics_row={"computation_status": published_status},
        job_row=live_job_row,
    )
    job: dict[str, Any] = {
        "id": "job-1",
        "kind": _DERIVE_KIND,
        "strategy_id": _STRATEGY_ID,
    }
    if claimed_metadata is not None:
        job["metadata"] = claimed_metadata

    patches = _patches_with_combine(
        ctx, key_mode=False, combine_mock=combine or _insufficient_combine()
    )
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await run_derive_broker_dailies_job(job)
    return result, capture


def _analytics_payloads(capture: dict[str, Any]) -> list[dict[str, Any]]:
    return [dict(u[1]) for u in capture["upserts"] if u[0] == "strategy_analytics"]


def _terminal_stamp(capture: dict[str, Any]) -> dict[str, Any]:
    payloads = _analytics_payloads(capture)
    assert len(payloads) == 1, (
        "expected exactly one strategy_analytics upsert from a terminal-failure "
        f"arm; got {payloads!r}. More than one means the driver ran past the arm "
        "under test."
    )
    return payloads[0]


def _tail_enqueue(capture: dict[str, Any]) -> dict[str, Any]:
    calls = [p for (n, p) in capture["rpc_calls"] if n == "enqueue_compute_job"]
    assert calls, "the derive handler enqueued no chain-edge job at all"
    return calls[-1]


# ---------------------------------------------------------------------------
# 1 — THE STORY. A user's resync inherits a marked refresh and must be LOUD.
# ---------------------------------------------------------------------------
class TestUserResyncInheritsAMarkedRefresh:
    """Neuter to redden: delete the ``_retract_refresh_marker_on_reuse`` call in
    ``services/ingestion/long_fetch.py``'s tail block (the retraction stops
    happening), OR delete the ``_refresh_marker_still_on_row`` gate inside
    ``_stamp_strategy_analytics_failed`` (the retraction stops being seen).
    BOTH must be present: either alone leaves the suppression intact, which is
    why both are neutered in this file's RED record.
    """

    @pytest.mark.asyncio
    async def test_tail_enqueue_that_deduped_onto_a_refresh_retracts_the_marker(
        self,
    ) -> None:
        """Half one, driven through the REAL ``run_process_key_long_job``.

        The queue double implements the RPC's actual contract (return the
        existing id, discard ``p_metadata``), so the collision is reproduced
        rather than asserted.
        """
        queue = _Queue()
        marked_id = queue.seed(kind=_DERIVE_KIND, metadata={"source": _MARKER})
        capture: dict[str, Any] = {"rpc_calls": [], "job_updates": []}
        sb = _queue_supabase(queue, capture)

        with patch("services.ingestion.long_fetch.get_adapter", return_value=_ledger_adapter()), \
             patch("services.ingestion.long_fetch.get_supabase", return_value=sb), \
             patch("services.encryption.encrypt_credentials", return_value={"v": 1}), \
             patch("services.encryption.get_kek", return_value=b"0" * 32):
            result = await run_process_key_long_job(_long_fetch_job())

        assert result.outcome == DispatchOutcome.DONE

        # The collision itself — the premise, asserted so a future change to the
        # double cannot make everything below vacuously true.
        enqueues = [p for (n, p) in capture["rpc_calls"] if n == "enqueue_compute_job"]
        assert enqueues and enqueues[-1]["p_kind"] == _DERIVE_KIND
        assert len(queue.rows) == 1, (
            "the tail enqueue MINTED a second derive job, so no collision "
            "happened and this test is not about the defect. The double's dedup "
            "predicate has drifted from the RPC's."
        )

        assert queue.source_of(marked_id) != _MARKER, (
            "REUSE-01: a user's resync was served by the recurring refresh's job "
            "and the refresh marker SURVIVED on it. Every later failure of this "
            "job is now suppressed — at both hops and in the SQL bridge's "
            "is_protected — on behalf of a request the user is watching, whose "
            "poller has already read the row as a terminal success."
        )
        metadata = queue.rows[marked_id]["metadata"]
        assert metadata["refresh_marker_retracted"] == _MARKER, (
            "the retraction must PRESERVE what it retracted; an operator reading "
            "compute_jobs has to be able to see this was a refresh job."
        )
        assert metadata["correlation_id"] == "cid-d15", (
            "the correlation_id the dedup discarded must be restored, or nothing "
            "joins this job to the request it is actually serving."
        )

    @pytest.mark.asyncio
    async def test_a_retracted_marker_is_seen_after_the_claim(self) -> None:
        """Half two — THE WINDOW. The handler's in-memory metadata still carries
        the marker (it was claimed before the user attached); only the ROW knows.
        """
        _result, capture = await _drive_derive(
            claimed_metadata={"source": _MARKER, "enqueued_at": "2026-08-25T00:00:00Z"},
            live_job_row={"metadata": {"refresh_marker_retracted": _MARKER}},
        )

        payload = _terminal_stamp(capture)
        assert payload.get("computation_status") == "failed", (
            "REUSE-01: the failure of a job a USER is waiting on was suppressed "
            "because the job had been minted by the recurring refresh. The wizard "
            "poller's terminal test is `nextStatus === 'failed' || "
            "isComputedAnalytics(nextStatus)`, and complete_with_warnings — 5 of "
            "the 5 live ledger strategies — is terminal-success, so the poller "
            "stops on its first read and SyncPreviewStep renders the PRE-RESYNC "
            f"factsheet over a resync that failed. payload={payload!r}"
        )

    @pytest.mark.asyncio
    async def test_control_an_unwatched_refresh_is_still_protected(self) -> None:
        """CONTROL. Same driver, marker STILL on the row: D-15 must hold. Without
        this the assertion above could be satisfied by a handler that had stopped
        protecting anything at all."""
        _result, capture = await _drive_derive(
            claimed_metadata={"source": _MARKER, "enqueued_at": "2026-08-25T00:00:00Z"},
            live_job_row={"metadata": {"source": _MARKER}},
        )

        payload = _terminal_stamp(capture)
        for key in _PUBLISH_STATE_KEYS:
            assert key not in payload, (
                f"REUSE-01 has broken D-15: an unwatched marked refresh wrote "
                f"{key!r} onto a published row. payload={payload!r}"
            )
        assert payload.get("computation_error"), (
            "the failure must stay VISIBLE in computation_error."
        )


# ---------------------------------------------------------------------------
# 2 — the chain edge, forward direction
# ---------------------------------------------------------------------------
class TestChainEdgeDoesNotForwardARetractedMarker:
    """Neuter to redden: delete the ``_refresh_marker_still_on_row`` gate above
    ``_enqueue_csv_analytics``.

    Hop 2 is where the factsheet is COMPILED and it has five terminal-failure
    stamps of its own. It learns the marker from this metadata and from nothing
    else, so a retracted marker forwarded here re-opens the whole defect one hop
    down, where no re-read can save it.
    """

    @pytest.mark.asyncio
    async def test_retracted_marker_is_not_forwarded(self) -> None:
        _result, capture = await _drive_derive(
            claimed_metadata={"source": _MARKER},
            live_job_row={"metadata": {"refresh_marker_retracted": _MARKER}},
            combine=_success_combine(),
        )
        payload = _tail_enqueue(capture)
        assert payload["p_kind"] == _CSV_KIND
        assert "p_metadata" not in payload, (
            "the chain edge forwarded a RETRACTED marker to hop 2, which compiles "
            f"the factsheet and cannot re-check it. payload={payload!r}"
        )

    @pytest.mark.asyncio
    async def test_control_a_live_marker_is_still_forwarded(self) -> None:
        """CONTROL for CR-03: with the marker still on the row, hop 2 must keep
        receiving it AND the pre-refresh publish state. Without this the
        assertion above passes against a chain edge that forwards nothing."""
        _result, capture = await _drive_derive(
            claimed_metadata={"source": _MARKER},
            live_job_row={"metadata": {"source": _MARKER}},
            combine=_success_combine(),
        )
        metadata_out = _tail_enqueue(capture)["p_metadata"]
        assert metadata_out["source"] == _MARKER
        assert metadata_out["publish_status"] == "complete_with_warnings", (
            "CR-03/F1 regression: hop 2 must still receive the pre-refresh "
            "publish state minted by hop 1."
        )


# ---------------------------------------------------------------------------
# 3 — the retraction helper, at its own boundary
# ---------------------------------------------------------------------------
class TestRetractionHelper:
    """Neuter to redden: make ``_retract_refresh_marker_on_reuse`` return early
    unconditionally (case 1 goes RED), or drop its marker test so it rewrites
    every row it is handed (cases 2 and 3 go RED)."""

    @staticmethod
    def _run(row_metadata: dict[str, Any] | None) -> tuple[_Queue, dict[str, Any], str]:
        queue = _Queue()
        job_id = queue.seed(kind=_DERIVE_KIND, metadata=row_metadata)
        capture: dict[str, Any] = {"rpc_calls": [], "job_updates": []}
        sb = _queue_supabase(queue, capture)
        _retract_refresh_marker_on_reuse(sb, job_id, correlation_id="cid-1")
        return queue, capture, job_id

    def test_single_key_marker_is_retracted(self) -> None:
        queue, capture, job_id = self._run({"source": _MARKER, "enqueued_at": "t"})
        assert capture["job_updates"], "no compute_jobs update was issued"
        assert queue.source_of(job_id) is None
        assert queue.rows[job_id]["metadata"]["enqueued_at"] == "t", (
            "the retraction must be a MERGE, not a replacement — losing the rest "
            "of the row's metadata is a second bug, not a fix."
        )

    def test_composite_marker_is_retracted_too(self) -> None:
        """The UNION, and here the union is the SAFE direction: retraction
        resolves toward LOUD, so widening it can only make more failures
        visible. (F5/F7 narrow a PROTECTION to its own arm — the opposite
        direction, for the opposite reason.)"""
        queue, capture, job_id = self._run({"source": _COMPOSITE_MARKER})
        assert capture["job_updates"]
        assert queue.source_of(job_id) is None

    def test_an_unmarked_job_is_left_alone(self) -> None:
        """A tail enqueue that MINTED its own job must not be rewritten — the
        retraction is a response to a collision, not a routine write."""
        _queue, capture, _job_id = self._run({"correlation_id": "cid-1"})
        assert not capture["job_updates"], (
            "the retraction rewrote a job that carried no refresh marker; it is "
            "then an unconditional write to every tail enqueue in the system."
        )

    def test_no_metadata_at_all_is_left_alone(self) -> None:
        _queue, capture, _job_id = self._run(None)
        assert not capture["job_updates"]


# ---------------------------------------------------------------------------
# 4 — the MIRROR direction: protection LOST, deliberately, and made VISIBLE
# ---------------------------------------------------------------------------
class TestMirrorDirection:
    """Neuter to redden: delete the mirror warning after
    ``await db_execute(_enqueue_csv_analytics)``.

    Same root cause, opposite sign: a MARKED refresh's chain edge dedupes onto an
    already-in-flight UNMARKED ``compute_analytics_from_csv`` and the RPC discards
    the marker + publish state, so hop 2 runs unprotected.

    ⛔ THAT OUTCOME IS THE DECISION, not an oversight. Laundering the marker onto
    the foreign row is the FORWARD defect wearing the other hat — it would grant a
    suppression to a job this refresh did not create and whose caller may be
    watching it, and a suppressed failure under a watcher is a stopped poller over
    a stale factsheet. Protection is not inherited across a collision in EITHER
    direction; both resolve toward LOUD. What must not happen is that the loss is
    silent.
    """

    @pytest.mark.asyncio
    async def test_the_lost_protection_is_logged_and_not_laundered(self) -> None:
        queue = _Queue()
        foreign_id = queue.seed(kind=_CSV_KIND, metadata=None, status="running")
        capture: dict[str, Any] = {"rpc_calls": [], "job_updates": []}
        sb = _queue_supabase(queue, capture)

        ctx, ctx_capture = _build_ctx(
            key_row={"id": "key-1", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": _STRATEGY_ID, "user_id": "user-1"},
        )
        # The analytics reads keep the shared harness's shape; the queue double
        # owns compute_jobs and the enqueue RPC so the collision is real.
        original = ctx.supabase.table.side_effect

        def _table(name: str) -> MagicMock:
            return sb.table(name) if name == "compute_jobs" else original(name)

        def _select_analytics(_columns: str, **_kw: object) -> MagicMock:
            chain = MagicMock()
            chain.eq.return_value = chain
            chain.maybe_single.return_value = chain
            chain.execute.return_value = MagicMock(
                data={"computation_status": "complete_with_warnings"}
            )
            return chain

        def _table_with_analytics(name: str) -> MagicMock:
            tbl = _table(name)
            if name != "compute_jobs":
                tbl.select.side_effect = _select_analytics
            return tbl

        ctx.supabase.table.side_effect = _table_with_analytics
        ctx.supabase.rpc.side_effect = sb.rpc.side_effect

        job = {
            "id": "job-hop1",
            "kind": _DERIVE_KIND,
            "strategy_id": _STRATEGY_ID,
            "metadata": {"source": _MARKER},
        }
        # hop 1's own row is still marked, so the forward gate does NOT fire and
        # the marker really is offered to the chain edge.
        queue.rows["job-hop1"] = {
            "id": "job-hop1",
            "strategy_id": _STRATEGY_ID,
            "kind": _DERIVE_KIND,
            "status": "running",
            "metadata": {"source": _MARKER},
        }

        patches = _patches_with_combine(
            ctx,
            key_mode=False,
            combine_mock=_success_combine(),
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], \
             patch.object(_jw, "logger") as mock_logger:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE
        assert len(queue.rows) == 2, (
            "the chain edge MINTED a second compute_analytics_from_csv, so no "
            "collision happened and this test is not about the mirror."
        )
        assert queue.source_of(foreign_id) is None, (
            "the refresh LAUNDERED its marker onto a job it did not create. That "
            "grants a suppression to a caller who may be watching — the forward "
            "defect in mirror form."
        )
        assert not capture["job_updates"], (
            "the mirror path wrote to compute_jobs. It must observe and report, "
            "never rewrite a foreign row's metadata."
        )
        warnings = [
            c for c in mock_logger.warning.call_args_list
            if c.args and "DEDUPED onto" in c.args[0]
        ]
        assert warnings, (
            "the LOSS OF A SAFETY PROPERTY was silent. Silence is how REUSE-01 "
            "survived review in the first place; the mirror is accepted only "
            f"because it is loud. warnings seen: {mock_logger.warning.call_args_list!r}"
        )
        # And none of that is satisfied by hop 1 failing early: this test must
        # run the SUCCESS path all the way to the chain edge, so no terminal
        # publish-state stamp may appear anywhere in the capture.
        assert not [
            p for p in _analytics_payloads(ctx_capture) if "computation_status" in p
        ], (
            "hop 1 stamped a terminal publish state; this test is meant to reach "
            "the chain edge on the SUCCESS path, where the mirror lives."
        )


# ---------------------------------------------------------------------------
# 5 — fail-safe direction of the re-read itself
# ---------------------------------------------------------------------------
class TestReReadFailsSafe:
    """Neither direction of a failed or missing re-read may SUPPRESS a failure.

    CONTEXT D-09, amended 2026-09-26: a re-read that RAISES is not an answer, so
    the single-key stamp closure now does what the composite site does. It writes
    nothing at all (neither the error-only write that preserves the publish state
    nor the destructive stamp), and the job fails TRANSIENT so the queue retries
    it. A DEFINITIVE answer (no id, no row, another source, a retraction) still
    takes the LOUD path.

    📜 Lineage: until 2026-09-26 this class pinned the opposite for a raising read
    (``test_an_unreadable_row_takes_the_loud_path``: the single-key site stamped
    ``failed``, un-publishing a funded account on one gateway blip). D-09 was
    first decided for the composite site only; its amendment extended it here.

    Neuter to redden: delete the ``READ_ERROR`` arm in
    ``_stamp_strategy_analytics_failed`` (the read error falls through to the
    loud stamp) and both parametrised cases go RED. Change the helper's
    except-arm to return ``PRESENT`` (the suppression direction) and both go RED
    too. Measured 2026-09-26: under either neuter the first assertion to fire is
    the error kind, ``'permanent'`` where ``'transient'`` is required.

    WR-03 / SFH-R2-01 (round 2): the transient result must still NAME the
    handler's real cause, because ``error_message`` becomes
    ``compute_jobs.last_error``. Neuter by dropping ``scrubbed`` from the raise,
    or by passing an empty cause to the pre-read ERROR line; measured
    2026-09-26, both parametrised cases go RED on each."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("combine", "cause"),
        [
            pytest.param(
                _insufficient_combine,
                "Insufficient broker history",
                id="insufficient-history-caller",
            ),
            pytest.param(
                lambda: MagicMock(
                    side_effect=NavReconstructionError("simulated structural refusal")
                ),
                "Broker return reconstruction failed on a structural input",
                id="nav-error-caller-inside-an-except-arm",
            ),
        ],
    )
    async def test_an_unreadable_row_writes_nothing_and_fails_transient(
        self, combine: Any, cause: str
    ) -> None:
        ctx, capture = _build_ctx(
            key_row={"id": "key-1", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": _STRATEGY_ID, "user_id": "user-1"},
        )
        original = ctx.supabase.table.side_effect

        def _table(name: str) -> MagicMock:
            tbl: MagicMock = original(name)

            def _select(_columns: str, **_kw: object) -> MagicMock:
                chain = MagicMock()
                chain.eq.return_value = chain
                chain.maybe_single.return_value = chain
                if name == "compute_jobs":
                    chain.execute.side_effect = RuntimeError("simulated read failure")
                else:
                    chain.execute.return_value = MagicMock(
                        data={"computation_status": "complete_with_warnings"}
                    )
                return chain

            tbl.select.side_effect = _select
            return tbl

        ctx.supabase.table.side_effect = _table

        patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine())
        # Driven through ``dispatch``, the production entry: the retry is an
        # EXCEPTION leaving the handler, and only ``dispatch`` turns it into the
        # job's error kind. A caller that swallowed the raise would turn this
        # back into the permanent FAILED the arm returns after its stamp.
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], \
             patch.object(_jw, "logger") as log, \
             patch("services.job_worker.sentry_sdk") as sentry:
            result = await _jw.dispatch(
                {
                    "id": "job-1",
                    "kind": _DERIVE_KIND,
                    "strategy_id": _STRATEGY_ID,
                    "metadata": {"source": _MARKER},
                }
            )

        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "transient", (
            "a re-read that RAISED did not fail the job TRANSIENT "
            f"({result.error_kind!r}: {result.error_message!r}). Without the "
            "retry the failure is final, and the next marked refresh is the "
            "earliest anything re-decides it."
        )
        payloads = _analytics_payloads(capture)
        assert not payloads, (
            "a transient re-read failure wrote to strategy_analytics "
            f"({payloads!r}). Nothing is known about the row yet: a destructive "
            "stamp un-publishes a funded account on one gateway blip, and an "
            "error-only write suppresses a failure nobody decided to protect. "
            "The retry decides."
        )
        assert sentry.capture_exception.call_count == 1
        assert any(
            c.args and "could not re-read" in str(c.args[0])
            for c in log.error.call_args_list
        ), f"no ERROR-level re-read line: {log.error.call_args_list!r}"
        assert not any(
            c.args and "RETRACTED" in str(c.args[0])
            for c in log.warning.call_args_list
        ), "a read failure was logged as a RETRACTION; nothing was retracted."
        # WR-03 / SFH-R2-01: the retry must not ERASE the failure it postponed.
        # ``error_message`` is what ``compute_jobs.last_error`` records, and it is
        # the operator's first read. Before the fix it named only the read
        # failure (and said "retrying" even on the final attempt).
        assert cause in (result.error_message or ""), (
            "the job's last_error lost the handler's real failure cause "
            f"{cause!r}: {result.error_message!r}"
        )
        assert "retrying" not in (result.error_message or ""), (
            "last_error claims the job is retrying, which is false on the final "
            f"attempt: {result.error_message!r}"
        )
        assert any(
            any(cause in str(a) for a in c.args) for c in log.error.call_args_list
        ), (
            "the curated cause was not logged at ERROR before the re-read, so "
            f"a stamp with no detail left no record of it: {log.error.call_args_list!r}"
        )

    @pytest.mark.asyncio
    async def test_a_missing_job_id_takes_the_loud_path(self) -> None:
        assert (
            await _jw._refresh_marker_still_on_row(MagicMock(), None, _MARKER)
        ) is _jw.MarkerLiveState.NO_ID


# ---------------------------------------------------------------------------
# 5b — the re-read says WHY the marker is not confirmed (SFH-02 / WR-02)
# ---------------------------------------------------------------------------
class _Gateway504(Exception):
    """A PostgREST gateway timeout, in the structured shape
    ``services.db._is_gateway_timeout`` keys on."""

    code = "504"


def _job_read_client(execute: Any) -> MagicMock:
    """A client whose ``compute_jobs`` maybe_single read answers ``execute``
    (a value, or a side_effect list / exception)."""
    sb = MagicMock()
    chain = sb.table.return_value.select.return_value.eq.return_value
    chain = chain.maybe_single.return_value
    if isinstance(execute, (list, BaseException)):
        chain.execute.side_effect = execute
    else:
        chain.execute.return_value = execute
    return sb


class TestLiveStateNamesItsReason:
    """Every answer the live re-read can give is a DIFFERENT fact, and four call
    sites log from it. A bare bool made them all say "RETRACTED … a
    user-initiated request was served", including when nothing was retracted.

    Neuter to redden: collapse any two states (e.g. return ``RETRACTED`` for
    every non-``PRESENT`` row), and the parametrised case for the other goes RED.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("answer", "expected"),
        [
            (MagicMock(data={"metadata": {"source": _MARKER}}), "PRESENT"),
            (
                MagicMock(data={"metadata": {"refresh_marker_retracted": _MARKER}}),
                "RETRACTED",
            ),
            (MagicMock(data={"metadata": {"source": _COMPOSITE_MARKER}}), "OTHER_SOURCE"),
            (MagicMock(data={"metadata": {}}), "OTHER_SOURCE"),
            (MagicMock(data={"metadata": "not-a-dict"}), "OTHER_SOURCE"),
            (MagicMock(data=None), "NO_ROW"),
            # postgrest 2.31: maybe_single().execute() returns None for 0 rows.
            (None, "NO_ROW"),
        ],
        ids=[
            "present", "retracted", "other-marker", "no-source",
            "non-dict-metadata", "data-none", "response-none",
        ],
    )
    async def test_each_row_shape_maps_to_its_own_state(
        self, answer: Any, expected: str
    ) -> None:
        state = await _jw._refresh_marker_still_on_row(
            _job_read_client(answer), "job-1", _MARKER
        )
        assert state is _jw.MarkerLiveState[expected]

    @pytest.mark.asyncio
    async def test_a_raising_read_is_read_error_and_reaches_sentry(self) -> None:
        with patch.object(_jw, "logger") as log, \
             patch("services.job_worker.sentry_sdk") as sentry:
            state = await _jw._refresh_marker_still_on_row(
                _job_read_client(RuntimeError("boom")), "job-1", _MARKER
            )
        assert state is _jw.MarkerLiveState.READ_ERROR
        assert log.error.call_count == 1, (
            "a failed re-read must be logged at ERROR: a WARNING is only a "
            "Sentry breadcrumb, and this read decides whether a live factsheet "
            "is un-published."
        )
        assert sentry.capture_exception.call_count == 1

    @pytest.mark.asyncio
    async def test_a_gateway_504_is_retried_before_it_counts(self) -> None:
        """WR-03: the read goes through ``db_read_with_retry``, so a gateway
        timeout is retried inside its budget instead of deciding the job on the
        first blip. Neuter: read through ``db_execute`` again → READ_ERROR."""
        answer = MagicMock(data={"metadata": {"source": _MARKER}})
        sb = _job_read_client([_Gateway504(), _Gateway504(), answer])
        with patch("services.db.DB_READ_BACKOFF_BASE_S", 0.0), \
             patch("services.db.DB_READ_JITTER_MAX_S", 0.0):
            state = await _jw._refresh_marker_still_on_row(sb, "job-1", _MARKER)
        assert state is _jw.MarkerLiveState.PRESENT

    def test_a_state_cannot_be_used_as_a_bool(self) -> None:
        """Every member would be truthy, so ``not await …`` would read as
        "still marked" for EVERY state — failing toward suppression. A caller
        must compare against ``PRESENT`` explicitly."""
        with pytest.raises(TypeError):
            bool(_jw.MarkerLiveState.NO_ROW)


def _entry_read_ctx(entry_answers: list[Any]) -> tuple[MagicMock, dict[str, Any]]:
    """A derive context whose ``strategy_analytics`` select answers
    ``entry_answers`` in order (a value or an exception each), and whose
    ``compute_jobs`` select answers the live marker. Only the ENTRY
    publish-state read selects from ``strategy_analytics`` on these paths."""
    ctx, capture = _build_ctx(
        key_row={"id": "key-1", "exchange": "binance", "user_id": "user-1"},
        strategy_row={"id": _STRATEGY_ID, "user_id": "user-1"},
    )
    original = ctx.supabase.table.side_effect
    capture["entry_reads"] = 0

    def _table(name: str) -> MagicMock:
        tbl: MagicMock = original(name)

        def _select(_columns: str, **_kw: object) -> MagicMock:
            chain = MagicMock()
            chain.eq.return_value = chain
            chain.maybe_single.return_value = chain

            def _execute() -> Any:
                if name == "compute_jobs":
                    return MagicMock(data={"metadata": {"source": _MARKER}})
                capture["entry_reads"] += 1
                answer = entry_answers.pop(0) if entry_answers else None
                if isinstance(answer, BaseException):
                    raise answer
                return answer

            chain.execute.side_effect = _execute
            return chain

        tbl.select.side_effect = _select
        return tbl

    ctx.supabase.table.side_effect = _table
    return ctx, capture


class TestEntryPublishStateReadFailsTransient:
    """D-09, extended 2026-09-26 to the ENTRY publish-state read (round 2,
    SFH-R2-02). That read is the oracle both hops' D-15 guards use. When it
    raised, the handler logged a WARNING and carried on with no snapshot, so a
    marked refresh that then failed stamped ``failed`` over a live factsheet: a
    failed READ became a destructive stamp, one screen above the site D-09 had
    already fixed. It now fails the job TRANSIENT before any crawl.

    Neuter to redden: restore the ``_entry_row = {}`` fallback in the except
    arm. ``test_a_failed_entry_read_fails_transient_before_the_crawl`` goes RED
    on the error kind (the insufficient-history stamp returns ``permanent``) and
    on the destructive ``failed`` write. Read through ``db_execute`` again and
    ``test_a_gateway_504_on_the_entry_read_is_retried`` goes RED."""

    @pytest.mark.asyncio
    async def test_a_failed_entry_read_fails_transient_before_the_crawl(self) -> None:
        ctx, capture = _entry_read_ctx([RuntimeError("simulated entry read failure")])
        combine = _insufficient_combine()
        patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
        with patches[0], patches[1], patches[2] as aclose, patches[3], patches[4], \
             patches[5], patches[6], \
             patch.object(_jw, "logger") as log, \
             patch("services.job_worker.sentry_sdk") as sentry:
            result = await _jw.dispatch(
                {
                    "id": "job-1",
                    "kind": _DERIVE_KIND,
                    "strategy_id": _STRATEGY_ID,
                    "metadata": {"source": _MARKER},
                }
            )

        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "transient", (
            "a failed entry publish-state read did not fail the job TRANSIENT "
            f"({result.error_kind!r}: {result.error_message!r}). Without it the "
            "refresh runs with no snapshot and its failure un-publishes."
        )
        payloads = _analytics_payloads(capture)
        assert not payloads, (
            "a failed entry read still reached a strategy_analytics write "
            f"({payloads!r}); nothing is known about the publish state yet."
        )
        assert combine.call_count == 0, (
            "the venue crawl ran after the entry read failed; the retry must "
            "cost one queue round trip, not a crawl"
        )
        assert not capture["rpc_calls"], (
            f"a follow-on was enqueued after a failed entry read: {capture['rpc_calls']!r}"
        )
        assert aclose.await_count == 1, (
            "the exchange the preflight opened was not closed on the early raise"
        )
        assert sentry.capture_exception.call_count == 1
        assert any(
            c.args and "pre-refresh publish" in str(c.args[0])
            for c in log.error.call_args_list
        ), f"the failed entry read did not go out at ERROR: {log.error.call_args_list!r}"

    @pytest.mark.asyncio
    async def test_a_gateway_504_on_the_entry_read_is_retried(self) -> None:
        """The entry read goes through ``db_read_with_retry``: two gateway
        timeouts then a published row, and the refresh stays protected."""
        ctx, capture = _entry_read_ctx(
            [
                _Gateway504(),
                _Gateway504(),
                MagicMock(data={"computation_status": "complete_with_warnings"}),
            ]
        )
        patches = _patches_with_combine(
            ctx, key_mode=False, combine_mock=_insufficient_combine()
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], \
             patches[5], patches[6], \
             patch("services.db.DB_READ_BACKOFF_BASE_S", 0.0), \
             patch("services.db.DB_READ_JITTER_MAX_S", 0.0):
            result = await run_derive_broker_dailies_job(
                {
                    "id": "job-1",
                    "kind": _DERIVE_KIND,
                    "strategy_id": _STRATEGY_ID,
                    "metadata": {"source": _MARKER},
                }
            )
        assert result.error_kind == "permanent", result
        assert capture["entry_reads"] == 3
        stamp = _terminal_stamp(capture)
        assert not any(k in stamp for k in ("computation_status", "computation_warned")), (
            "the entry read answered on its third attempt with a published row, "
            f"so the failure must be recorded error-only: {stamp!r}"
        )

    @pytest.mark.asyncio
    async def test_control_no_row_is_a_definitive_answer_and_stays_loud(self) -> None:
        """CONTROL: zero rows is an ANSWER (nothing published), not a failed
        read. It must keep the loud path and must not retry."""
        ctx, capture = _entry_read_ctx([None])
        patches = _patches_with_combine(
            ctx, key_mode=False, combine_mock=_insufficient_combine()
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], \
             patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(
                {
                    "id": "job-1",
                    "kind": _DERIVE_KIND,
                    "strategy_id": _STRATEGY_ID,
                    "metadata": {"source": _MARKER},
                }
            )
        assert result.error_kind == "permanent", result
        assert _terminal_stamp(capture).get("computation_status") == "failed"


def _log_lines(log: MagicMock) -> list[str]:
    return [
        str(c.args[0])
        for method in (log.warning, log.error)
        for c in method.call_args_list
        if c.args
    ]


class TestSingleKeySitesNameTheRealCause:
    """SFH-02, closed across the class: the stamp closure and the chain edge say
    "RETRACTED" only for a recorded retraction, and a missing live row goes out
    at ERROR.

    Neuter to redden: log the RETRACTED sentence for every non-``PRESENT``
    state at either site."""

    @pytest.mark.asyncio
    async def test_stamp_closure_says_retracted_for_a_retraction(self) -> None:
        with patch.object(_jw, "logger") as log:
            await _drive_derive(
                claimed_metadata={"source": _MARKER},
                live_job_row={"metadata": {"refresh_marker_retracted": _MARKER}},
            )
        assert any("RETRACTED" in m for m in _log_lines(log)), _log_lines(log)

    @pytest.mark.asyncio
    async def test_stamp_closure_calls_a_missing_row_an_error(self) -> None:
        with patch.object(_jw, "logger") as log:
            _result, capture = await _drive_derive(
                claimed_metadata={"source": _MARKER}, live_job_row=None
            )
        assert _terminal_stamp(capture).get("computation_status") == "failed"
        assert not any("RETRACTED" in m for m in _log_lines(log)), (
            f"a missing job row was reported as a retraction: {_log_lines(log)!r}"
        )
        assert any("no live" in str(c.args[0]) for c in log.error.call_args_list), (
            "a claimed job whose row has vanished is an invariant breach; it must "
            f"go out at ERROR. errors: {log.error.call_args_list!r}"
        )

    @pytest.mark.asyncio
    async def test_chain_edge_calls_a_missing_row_an_error(self) -> None:
        with patch.object(_jw, "logger") as log:
            _result, capture = await _drive_derive(
                claimed_metadata={"source": _MARKER},
                live_job_row=None,
                combine=_success_combine(),
            )
        assert "p_metadata" not in _tail_enqueue(capture)
        assert not any("RETRACTED" in m for m in _log_lines(log)), _log_lines(log)
        assert any("no live" in str(c.args[0]) for c in log.error.call_args_list), (
            log.error.call_args_list
        )

    @pytest.mark.asyncio
    async def test_mirror_does_not_call_a_missing_tail_row_a_dedup(self) -> None:
        """The mirror check reads the TAIL job. "DEDUPED onto an unmarked job" is
        a claim about that row; with no row there is nothing to claim it about,
        and the loss must still be loud — at ERROR."""
        ctx, capture = _build_ctx(
            key_row={"id": "key-1", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": _STRATEGY_ID, "user_id": "user-1"},
        )
        rows_by_id: dict[Any, Any] = {"job-1": {"metadata": {"source": _MARKER}}}
        original = ctx.supabase.table.side_effect

        def _table(name: str) -> MagicMock:
            tbl: MagicMock = original(name)

            def _select(_columns: str, **_kw: object) -> MagicMock:
                chain = MagicMock()
                seen: dict[str, Any] = {}

                def _eq(col: str, val: object) -> MagicMock:
                    seen[col] = val
                    return chain

                def _execute() -> Any:
                    if name != "compute_jobs":
                        return MagicMock(data={"computation_status": "complete_with_warnings"})
                    return MagicMock(data=copy.deepcopy(rows_by_id.get(seen.get("id"))))

                chain.eq.side_effect = _eq
                chain.maybe_single.return_value = chain
                chain.execute.side_effect = _execute
                return chain

            tbl.select.side_effect = _select
            return tbl

        ctx.supabase.table.side_effect = _table
        patches = _patches_with_combine(
            ctx, key_mode=False, combine_mock=_success_combine()
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], \
             patch.object(_jw, "logger") as log:
            result = await run_derive_broker_dailies_job(
                {
                    "id": "job-1",
                    "kind": _DERIVE_KIND,
                    "strategy_id": _STRATEGY_ID,
                    "metadata": {"source": _MARKER},
                }
            )
        assert result.outcome == DispatchOutcome.DONE
        assert _tail_enqueue(capture)["p_metadata"]["source"] == _MARKER
        lines = _log_lines(log)
        assert not any("DEDUPED onto" in m for m in lines), (
            f"a missing tail row was reported as a dedup collision: {lines!r}"
        )
        assert log.error.call_args_list, (
            "hop 2 may be running unprotected and nothing was logged at ERROR"
        )


def test_the_handler_and_the_resync_agree_on_one_marker_spelling() -> None:
    """Cross-end pin. The retraction (long_fetch) and the re-read (job_worker)
    are two ends of the same contract with no compiler between them, and both
    must agree with the marker the fan-out writes."""
    assert _jw.LEDGER_REFRESH_SINGLE_KEY_SOURCE == _MARKER
    assert _jw.LEDGER_REFRESH_JOB_SOURCES == {_MARKER, _COMPOSITE_MARKER}


class TestNoStrayEnqueueLostItsReadBack:
    """The retraction is only reachable if the tail enqueue's return value is
    actually captured. A future edit that drops ``.data`` would leave the
    retraction permanently no-op with every test above still green on the
    handler side — so pin the call shape at its source."""

    def test_tail_enqueue_captures_the_returned_job_id(self) -> None:
        import inspect

        import services.ingestion.long_fetch as _lf

        src = inspect.getsource(_lf.run_process_key_long_job)
        assert "tail_job_id = supabase.rpc(" in src, (
            "the tail enqueue no longer binds the RPC's returned job id, so "
            "_retract_refresh_marker_on_reuse can never see the row it must "
            "retract."
        )
        assert "_retract_refresh_marker_on_reuse(" in src, (
            "the tail block no longer calls the retraction. A user's resync can "
            "again inherit a recurring refresh's D-15 protection."
        )
