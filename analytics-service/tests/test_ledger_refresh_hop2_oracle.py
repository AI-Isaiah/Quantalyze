"""Phase 161.1 / F1+F2 — the refresh guard's oracle may not be a column the
thing it guards writes.

Why this file exists
--------------------
The D-15/CR-03 guards ask ONE question — "was this strategy PUBLISHED before
this refresh started?" — and both of them used to answer it by reading
``strategy_analytics.computation_status`` LIVE, at the moment they needed it.
That column is written by the SQL status bridge
(``sync_strategy_analytics_status``, migration 20260825150000), which is
``PERFORM``ed in-RPC by ``mark_compute_job_done`` / ``mark_compute_job_failed``
on EVERY job transition for the strategy. So the guard's oracle was a column the
thing it guards writes, and the answer it got back was not the pre-refresh state
— it was whatever the bridge had most recently decided.

**Hop 2 (F1) — deterministic, not a race.** ``run_derive_broker_dailies_job``
enqueues the chained ``compute_analytics_from_csv`` job and THEN returns DONE;
``main_worker`` calls ``mark_compute_job_done``, whose in-RPC bridge call sees
the follow-on job already ``pending``. That is a non-terminal job, so branch (a)
fires — and branch (a)'s ``CASE`` preserves ``complete_with_warnings`` but
rewrites everything else to ``'computing'``. A strategy sitting at plain
``'complete'`` is therefore ALWAYS at ``'computing'`` by the time hop 2 starts,
so hop 2's snapshot read always answered ``'computing'``, was never in the
terminal-success pair, and every hop-2 failure took the destructive path:
publish state downgraded to ``failed``, ``data_quality_flags`` rebuilt
wholesale, and the persisted cash series DELETEd.

The 5 rows in the production ledger cohort are ``complete_with_warnings``, which
branch (a) happens to preserve — so the guard protected them by accident of
their status. The bridge migration's own header says plain ``'complete'`` "is
what every clean recompute leaves behind", i.e. the protection disappears the
first time a refresh actually succeeds.

**Hop 1 (F2) — the same bug, probabilistic.** Any OTHER job for the same
strategy (``poll_positions``, ``sync_funding``) reaching ``mark_compute_job_done``
while the refresh derive is in flight puts the row through branch (a) too. On a
plain-``complete`` row that writes ``'computing'``, and the stamp-time read then
declines to protect.

The fix, one root cause: read the publish state ONCE, at the earliest point the
refresh owns, and CARRY IT FORWARD — to hop 1's own stamp as a local, and across
the chain edge on the follow-on job's metadata. The guard's oracle is then a
value the bridge cannot write.

Falsifiability
--------------
Every test here was observed RED against the pre-fix tree; the neutering for
each is named on its class. The load-bearing property is that the ``'complete'``
cases and the ``'complete_with_warnings'`` cases are driven through the SAME
code path with the SAME assertions: pre-fix, the warned cases pass and the plain
cases fail, which is exactly the "protected by accident of their status" shape
the review described. A file that only exercised ``complete_with_warnings``
would have been green against the bug.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from services.job_worker import (
    DispatchOutcome,
    run_compute_analytics_from_csv_job,
    run_derive_broker_dailies_job,
)
from tests.test_derive_broker_dailies_dualmode import (
    _CCXT_VERDICT,
    _build_ctx,
    _patches_with_combine,
    _two_day_returns,
)

# Hand-typed, exactly as the fan-out migration spells it in
# `jsonb_build_object('source', …)`. This file is one END of a cross-language
# contract with no compiler between the two ends, so importing it would defeat
# the point (the same rule tests/test_ledger_refresh_nondestructive.py states).
_MARKER = "ledger-refresh"
_STRATEGY_ID = "strat-hop2-oracle"


def _bridge_branch_a(status: str | None, warned: bool) -> str:
    """What migration 20260825150000's branch (a) WRITES to
    ``computation_status`` while any job for the strategy is non-terminal.

    A faithful transcription of the branch's ``ON CONFLICT DO UPDATE ... CASE``::

        WHEN strategy_analytics.computation_status = 'complete_with_warnings'
             OR strategy_analytics.computation_warned
        THEN 'complete_with_warnings'
        ELSE 'computing'

    It is modelled here rather than executed because a Python test cannot run
    SQL. The END-TO-END proof of the bridge itself lives in
    ``supabase/tests/test_sync_status_marked_refresh_protected.sql``. What this
    model is for is the CONSUMER side: given that the bridge does this — and its
    own header says it does — the Python guards must still answer correctly.
    """
    if status == "complete_with_warnings" or warned:
        return "complete_with_warnings"
    return "computing"


def test_bridge_branch_a_model_matches_the_migration() -> None:
    """The model above is load-bearing for every test in this file, so pin it to
    the migration's actual text rather than to this author's reading of it.

    Neuter to redden: invert either arm of ``_bridge_branch_a``.
    """
    from pathlib import Path
    import re

    migration = (
        Path(__file__).resolve().parents[2]
        / "supabase"
        / "migrations"
        / "20260825150000_sync_status_protect_marked_refresh.sql"
    )
    body = "\n".join(
        re.sub(r"--.*$", "", line) for line in migration.read_text().splitlines()
    )
    # The one CASE that resolves branch (a)'s status write.
    match = re.search(
        r"SET\s+computation_status\s*=\s*CASE(.*?)END", body, re.DOTALL | re.IGNORECASE
    )
    assert match, (
        "could not locate branch (a)'s `SET computation_status = CASE ... END` in "
        f"{migration.name}. The extraction is broken, or the branch moved — "
        "either way the model below is no longer pinned to anything."
    )
    case = " ".join(match.group(1).split())
    assert "'complete_with_warnings'" in case, (
        f"branch (a) no longer preserves the warned status; CASE={case!r}"
    )
    assert "ELSE 'computing'" in case, (
        "branch (a)'s ELSE arm no longer writes 'computing'. If it now writes "
        "something else, every assertion in this file is aimed at the wrong "
        f"transient value. CASE={case!r}"
    )
    # And the model agrees with both arms of that CASE.
    assert _bridge_branch_a("complete_with_warnings", False) == "complete_with_warnings"
    assert _bridge_branch_a("complete", True) == "complete_with_warnings"
    assert _bridge_branch_a("complete", False) == "computing"


# ---------------------------------------------------------------------------
# Hop 1 — the derive, and the chain edge
# ---------------------------------------------------------------------------
def _stub_status_read(
    ctx: MagicMock, capture: dict[str, Any], row: dict[str, Any] | None
) -> None:
    """Give the shared harness a real ``.select().eq().maybe_single().execute()``.

    Without it the harness's bare ``MagicMock`` makes
    ``row.get('computation_status')`` another ``MagicMock``, which never equals a
    real status string — so EVERY case would route to the destructive branch and
    the protected assertions would pass or fail for reasons unrelated to the
    guard. Same trap tests/test_ledger_refresh_nondestructive.py documents.

    ⛔ TABLE-AWARE (REUSE-01). ``compute_jobs`` gets the LIVE job row, not the
    analytics row: the guard and the chain edge both re-read
    ``metadata->>'source'`` off their own job before honouring the marker, because
    the enqueue dedup can hand a user's resync a job the recurring refresh minted.
    Answering that read with an analytics row makes the marker look RETRACTED and
    every protected case here would fail for the wrong reason.
    """
    original = ctx.supabase.table.side_effect
    capture["selects"] = []
    live_job_row = {"metadata": {"source": _MARKER}}

    def _table(name: str) -> MagicMock:
        tbl: MagicMock = original(name)
        answer = live_job_row if name == "compute_jobs" else row

        def _select(columns: str, **_kw: object) -> MagicMock:
            capture["selects"].append({"table": name, "columns": columns})
            chain = MagicMock()
            chain.eq.return_value = chain
            chain.maybe_single.return_value = chain
            chain.execute.return_value = MagicMock(data=answer)
            return chain

        tbl.select.side_effect = _select
        return tbl

    ctx.supabase.table.side_effect = _table


async def _run_derive(
    *, published_status: str, fail: bool
) -> tuple[Any, dict[str, Any]]:
    """Drive a MARKED refresh derive over a row published at
    ``published_status``. ``fail`` selects the malformed-config arm, which is the
    earliest permanent failure in the handler and routes straight through
    ``_stamp_strategy_analytics_failed``.
    """
    strategy_row: dict[str, Any] = {"id": _STRATEGY_ID, "user_id": "user-1"}
    if fail:
        strategy_row["returns_denominator_config"] = {
            "denominator": "not-a-real-denominator"
        }
    ctx, capture = _build_ctx(
        key_row={"id": "key-1", "exchange": "binance", "user_id": "user-1"},
        strategy_row=strategy_row,
    )
    _stub_status_read(
        ctx,
        capture,
        {
            "computation_status": published_status,
            "computation_warned": published_status == "complete_with_warnings",
        },
    )
    job: dict[str, Any] = {
        "id": "job-1",
        "kind": "derive_broker_dailies",
        "strategy_id": _STRATEGY_ID,
        "metadata": {"source": _MARKER, "enqueued_at": "2026-08-25T00:00:00Z"},
    }
    combine = MagicMock(
        return_value=(
            _two_day_returns(),
            {"used_heuristic_capital": False, "series_completeness": _CCXT_VERDICT},
        )
    )
    patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await run_derive_broker_dailies_job(job)
    return result, capture


def _enqueued_metadata(capture: dict[str, Any]) -> dict[str, Any] | None:
    calls = [c for c in capture["rpc_calls"] if c[0] == "enqueue_compute_job"]
    assert len(calls) == 1, (
        "expected exactly one enqueue_compute_job RPC (the chained analytics "
        f"hop); got {capture['rpc_calls']!r}. If the derive did not reach its "
        "chain edge, the assertions below are aimed at nothing."
    )
    meta = calls[0][1].get("p_metadata")
    return dict(meta) if isinstance(meta, dict) else None


class TestChainEdgeCarriesThePreRefreshPublishState:
    """F1, at the seam that creates it.

    Neuter to redden: drop the pre-refresh publish keys from the metadata
    ``run_derive_broker_dailies_job`` puts on the chained job.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "published_status", ["complete", "complete_with_warnings"]
    )
    async def test_marked_derive_forwards_the_pre_refresh_publish_state(
        self, published_status: str
    ) -> None:
        result, capture = await _run_derive(
            published_status=published_status, fail=False
        )
        assert result.outcome == DispatchOutcome.DONE

        meta = _enqueued_metadata(capture)
        assert meta is not None and meta.get("source") == _MARKER
        assert meta.get("publish_status") == published_status, (
            "hop 2 of a MARKED refresh was handed no pre-refresh publish state. "
            "It cannot re-read one: this handler's own DONE transition runs the "
            "SQL bridge with the follow-on job already pending, and branch (a) "
            "rewrites a plain 'complete' row to 'computing' before hop 2 starts. "
            f"metadata={meta!r}"
        )
        assert meta.get("publish_warned") is (
            published_status == "complete_with_warnings"
        ), (
            "the warned marker did not ride along. Hop 2 RESTORES the pair, so a "
            f"dropped marker silently downgrades the row. metadata={meta!r}"
        )

    @pytest.mark.asyncio
    async def test_unpublished_row_forwards_no_publish_state(self) -> None:
        """FAIL-SAFE DIRECTION at the chain edge. A row that was not published
        when the refresh started has nothing to protect, and hop 2 must be told
        so rather than inventing a green state to restore."""
        _result, capture = await _run_derive(published_status="computing", fail=False)
        meta = _enqueued_metadata(capture)
        assert meta is not None and meta.get("source") == _MARKER, (
            "the marker itself stopped being forwarded; this case would then "
            "pass for the wrong reason."
        )
        assert "publish_status" not in meta, (
            "a marked refresh forwarded a publish state for a row that read "
            f"'computing' — i.e. was never published. metadata={meta!r}"
        )


# ---------------------------------------------------------------------------
# Hop 2 — the whole chain, with the bridge in between
# ---------------------------------------------------------------------------
def _runner_supabase(
    rows: list[dict[str, Any]], *, row_status: str, row_warned: bool
) -> MagicMock:
    """A supabase fake for ``run_csv_strategy_analytics`` whose ``strategy_analytics``
    row is STATEFUL: what the runner writes is what the next read returns.

    Stateful on purpose (the same F15 lesson ``test_ledger_refresh_publish_guard``
    records): a fake that answers every status read with a canned value cannot
    observe an ordering bug, and would keep this file green against exactly the
    class of defect it exists for.
    """
    sb = MagicMock()
    table_mock = MagicMock()
    sb.table.return_value = table_mock
    sb.row = {"computation_status": row_status, "computation_warned": row_warned}

    def _select(columns: str, *_a: object, **_kw: object) -> MagicMock:
        chain = MagicMock()
        chain.eq.return_value = chain
        chain.order.return_value = chain
        chain.range.return_value = chain
        chain.single.return_value = chain
        chain.maybe_single.return_value = chain
        if "computation_status" in columns:
            data: Any = None if sb.row is None else dict(sb.row)
        elif "data_quality_flags" in columns:
            data = {"data_quality_flags": {"csv_source": True}}
        elif "daily_return" in columns:
            data = rows
        else:
            data = {"id": "s1", "user_id": "u1"}
        chain.execute.return_value = MagicMock(data=data)
        return chain

    table_mock.select.side_effect = _select
    sb.upserts = []
    sb.deletes = []

    def _upsert(payload: dict[str, Any], **_kw: object) -> MagicMock:
        sb.upserts.append(dict(payload))
        row = dict(sb.row) if sb.row is not None else {}
        for column in ("computation_status", "computation_warned"):
            if column in payload:
                row[column] = payload[column]
        sb.row = row or None
        return MagicMock(execute=MagicMock(return_value=MagicMock(data=[])))

    def _delete(**_kw: object) -> MagicMock:
        record: dict[str, Any] = {"filters": {}}
        sb.deletes.append(record)
        chain = MagicMock()
        chain.eq.side_effect = lambda c, v: (record["filters"].__setitem__(c, v), chain)[1]
        chain.execute.return_value = MagicMock(data=[])
        return chain

    table_mock.upsert.side_effect = _upsert
    table_mock.delete.side_effect = _delete
    sb.rpc.return_value = MagicMock(execute=MagicMock(return_value=MagicMock(data=[])))
    return sb


def _terminal(sb: MagicMock) -> dict[str, Any]:
    failed = [
        u for u in sb.upserts
        if u.get("computation_status") != "computing"
        and u.get("computation_error") is not None
    ]
    assert failed, f"expected a terminal-failure upsert; got {sb.upserts!r}"
    payload: dict[str, Any] = failed[-1]
    return payload


class TestTwoHopRefreshOverAPublishedRow:
    """F1 END TO END: hop 1 → the bridge → hop 2, with hop 2 failing.

    ⛔ THE PLAIN-``complete`` CASE IS THE POINT. Pre-fix it was RED and the
    ``complete_with_warnings`` case was GREEN, from the SAME driver and the SAME
    assertions — because branch (a) preserves the warned status and rewrites the
    plain one. That asymmetry IS the bug: the hop-2 guard protected the current
    production cohort only by accident of its status.

    Neuter to redden: make hop 2 read the publish state from
    ``strategy_analytics`` again instead of taking it from the job it was handed.
    """

    _ROWS = [{"date": "2024-01-01", "daily_return": 0.005}]

    async def _drive_hop_two(
        self, *, published_status: str
    ) -> MagicMock:
        # Hop 1: a MARKED derive that SUCCEEDS and enqueues the analytics hop.
        _result, capture = await _run_derive(
            published_status=published_status, fail=False
        )
        metadata = _enqueued_metadata(capture)

        # The bridge, in between. `main_worker` calls `mark_compute_job_done` for
        # the derive, which PERFORMs sync_strategy_analytics_status with the
        # follow-on job already `pending` — a non-terminal job, so branch (a)
        # fires before hop 2 is ever claimed.
        bridged = _bridge_branch_a(
            published_status, published_status == "complete_with_warnings"
        )
        sb = _runner_supabase(
            self._ROWS,
            row_status=bridged,
            row_warned=published_status == "complete_with_warnings",
        )

        # Hop 2: the real handler, with the real job the chain edge produced.
        # ONE daily-return row drives the `Insufficient CSV history` arm.
        with patch("services.analytics_runner.get_supabase", return_value=sb):
            with pytest.raises(HTTPException):
                await run_compute_analytics_from_csv_job(
                    {
                        "id": "job-2",
                        "kind": "compute_analytics_from_csv",
                        "strategy_id": _STRATEGY_ID,
                        "metadata": metadata,
                    }
                )
        return sb

    @pytest.mark.asyncio
    async def test_plain_complete_survives_hop_two_failure(self) -> None:
        sb = await self._drive_hop_two(published_status="complete")
        payload = _terminal(sb)
        assert payload["computation_status"] == "complete", (
            "hop 2 of a MARKED refresh un-published a strategy that was at plain "
            f"'complete' when the refresh started; it wrote "
            f"{payload['computation_status']!r}. The guard read the row LIVE, and "
            "by then the SQL bridge's branch (a) had already rewritten the row to "
            "'computing' — deterministically, because hop 1's own DONE transition "
            "runs the bridge with hop 2 already pending. A guard whose oracle is "
            "a column the bridge writes is inert for every plain-'complete' row."
        )
        assert payload["computation_warned"] is False
        assert "data_quality_flags" not in payload, (
            "the wholesale {csv_source: True} rebuild would destroy the "
            "NAV_TWR_GUARD_KEYS the derive pre-stamped."
        )
        assert payload.get("computation_error"), "the failure must stay visible"

    @pytest.mark.asyncio
    async def test_complete_with_warnings_survives_hop_two_failure(self) -> None:
        """The cohort that was protected BY ACCIDENT. Same driver, same
        assertions — it must stay protected on purpose."""
        sb = await self._drive_hop_two(published_status="complete_with_warnings")
        payload = _terminal(sb)
        assert payload["computation_status"] == "complete_with_warnings"
        assert payload["computation_warned"] is True
        assert "data_quality_flags" not in payload

    @pytest.mark.asyncio
    async def test_unpublished_row_still_fails_loud_through_the_whole_chain(
        self,
    ) -> None:
        """CONTROL + fail-safe direction. A strategy that was NOT published when
        the refresh started must still reach a loud terminal 'failed' — a
        wrongly-suppressed failure hangs the wizard poller forever."""
        sb = await self._drive_hop_two(published_status="computing")
        payload = _terminal(sb)
        assert payload["computation_status"] == "failed", (
            "a marked refresh protected a row that was never published; it wrote "
            f"{payload['computation_status']!r}."
        )
        assert payload["computation_warned"] is False


class TestHop1StampUsesTheEntrySnapshot:
    """F2 — hop 1's own guard must not re-read the column either.

    A sibling job (``poll_positions``, ``sync_funding``) reaching
    ``mark_compute_job_done`` while the refresh derive is in flight runs the same
    bridge. The derive's own job is non-terminal for its whole run, so branch (a)
    fires on that sibling's transition and rewrites a plain-``complete`` row to
    ``'computing'`` — and the stamp-time read then declines to protect the very
    account the guard exists for.

    ⛔ THE FLIP HAPPENS INSIDE ``combine_realized_and_funding``, and that
    placement is the whole test. That call is the venue crawl — MINUTES of I/O,
    the window in which a sibling job realistically transitions — and it sits
    between the handler's entry and its terminal stamp. A fake that instead
    flipped the row "after the first read" would be answered by the pre-fix code
    on its first (and only, stamp-time) read, so it would pass against the bug.
    Measured: that version was GREEN pre-fix.

    Unlike F1 this is a race rather than a certainty. It is the same defect.

    Neuter to redden: move the publish read back into
    ``_stamp_strategy_analytics_failed``.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "published_status", ["complete", "complete_with_warnings"]
    )
    async def test_sibling_bridge_call_mid_derive_does_not_un_protect(
        self, published_status: str
    ) -> None:
        from services.nav_twr import NavReconstructionError

        ctx, capture = _build_ctx(
            key_row={"id": "key-1", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": _STRATEGY_ID, "user_id": "user-1"},
        )

        warned = published_status == "complete_with_warnings"
        state: dict[str, Any] = {
            "reads": 0,
            "row": {
                "computation_status": published_status,
                "computation_warned": warned,
            },
        }
        original = ctx.supabase.table.side_effect
        # REUSE-01: the marker is STILL on the row here — this scenario is a
        # sibling bridge call, not a user attaching to the job — so the guard's
        # re-read must not be what decides it. `state['reads']` deliberately
        # counts ONLY the analytics reads it is about.
        live_job_row = {"metadata": {"source": _MARKER}}

        def _table(name: str) -> MagicMock:
            tbl: MagicMock = original(name)
            is_job_table = name == "compute_jobs"

            def _select(columns: str, **_kw: object) -> MagicMock:
                chain = MagicMock()
                chain.eq.return_value = chain
                chain.maybe_single.return_value = chain
                if is_job_table:
                    chain.execute.return_value = MagicMock(data=dict(live_job_row))
                    return chain
                state["reads"] += 1
                chain.execute.return_value = MagicMock(data=dict(state["row"]))
                return chain

            tbl.select.side_effect = _select
            return tbl

        ctx.supabase.table.side_effect = _table

        def _combine_then_fail(*_a: object, **_kw: object) -> Any:
            # A sibling job's mark_compute_job_done lands mid-crawl: its in-RPC
            # bridge call sees this derive still non-terminal and branch (a)
            # rewrites the row.
            state["row"] = {
                "computation_status": _bridge_branch_a(published_status, warned),
                "computation_warned": warned,
            }
            # …and then the crawl itself fails structurally, which routes through
            # `_dispose_broker_nav_error` → the ONE guarded stamp closure.
            raise NavReconstructionError("simulated structural NAV failure")

        job: dict[str, Any] = {
            "id": "job-1",
            "kind": "derive_broker_dailies",
            "strategy_id": _STRATEGY_ID,
            "metadata": {"source": _MARKER},
        }
        combine = MagicMock(side_effect=_combine_then_fail)
        patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.FAILED, (
            "the driver must reach a terminal failure or nothing under test ran; "
            f"got outcome={result.outcome!r}"
        )
        assert combine.called, (
            "the venue crawl never ran, so the sibling bridge call this test "
            "models never happened and the assertion below is aimed at nothing."
        )
        assert state["reads"] >= 1, (
            "the handler never read the publish state at all, so this test is "
            "aimed at nothing."
        )
        payloads = [
            dict(u[1]) for u in capture["upserts"] if u[0] == "strategy_analytics"
        ]
        assert len(payloads) == 1, (
            f"expected exactly one strategy_analytics upsert; got {payloads!r}"
        )
        payload = payloads[0]
        assert "computation_status" not in payload, (
            "a MARKED refresh un-published a funded account because a SIBLING "
            "job's bridge call moved the column while the derive was crawling the "
            "venue. The guard must key on a snapshot the refresh took itself, not "
            f"on a live re-read at stamp time. payload={payload!r}"
        )
        assert payload.get("computation_error"), (
            "the non-destructive stamp must still RECORD the error."
        )

    @pytest.mark.asyncio
    async def test_unpublished_at_entry_still_fails_loud(self) -> None:
        """CONTROL + fail-safe direction for the entry snapshot. A row that was
        already unpublished when the derive STARTED must still take the loud
        destructive stamp — otherwise a first compute that fails leaves the
        wizard poller spinning forever.

        It also proves the assertion above is not passing because the driver
        stopped writing anything: this is the identical path, and it must write
        the full destructive payload.
        """
        from services.nav_twr import NavReconstructionError

        ctx, capture = _build_ctx(
            key_row={"id": "key-1", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": _STRATEGY_ID, "user_id": "user-1"},
        )
        _stub_status_read(ctx, capture, {"computation_status": "computing"})

        def _fail(*_a: object, **_kw: object) -> Any:
            raise NavReconstructionError("simulated structural NAV failure")

        job: dict[str, Any] = {
            "id": "job-1",
            "kind": "derive_broker_dailies",
            "strategy_id": _STRATEGY_ID,
            "metadata": {"source": _MARKER},
        }
        patches = _patches_with_combine(
            ctx, key_mode=False, combine_mock=MagicMock(side_effect=_fail)
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.FAILED
        payloads = [
            dict(u[1]) for u in capture["upserts"] if u[0] == "strategy_analytics"
        ]
        assert len(payloads) == 1, (
            f"expected exactly one strategy_analytics upsert; got {payloads!r}"
        )
        assert payloads[0].get("computation_status") == "failed", (
            "the destructive stamp must fire BYTE-UNCHANGED over an unpublished "
            f"row; payload={payloads[0]!r}"
        )
