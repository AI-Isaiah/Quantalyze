"""Phase 161.1 silent-failure audit — F1 (CRITICAL), F4 (HIGH), F7 (LOW).

Three findings, one file, because they are three cuts of the SAME wound: a
`derive_broker_dailies` failure that an operator cannot see.

F1 — the chain tail. The <2-interpretable-days arm stamped a failure and then
returned ``DONE``. ``main_worker`` maps ``DONE`` to ``mark_compute_job_done``,
whose in-RPC ``sync_strategy_analytics_status`` then finds every job row
terminal-done and takes branch (c): ``computation_error = NULL`` and
``computed_at = now()``. So the failure the arm had just recorded was erased one
RPC later, and ``computed_at`` — which drives the factsheet's FreshnessChip and
the portfolio PDF's "Data as of" vintage — was restamped to today on a strategy
whose data had not moved. THE assertion below is therefore not "the guard ran";
it is that the job is never handed to ``mark_compute_job_done`` at all, driven
through the REAL ``dispatch_tick`` → ``dispatch`` → handler chain. Asserting the
guard was called is exactly how F1 shipped.

  Boundary note: everything past the mark RPC is SQL. Which mark RPC fires is
  the Python-side decision, and it alone selects branch (c) versus (b)/(b-prime).
  The branches' own behaviour is pinned by the pgTAP gates on migration
  20260825150000; this file pins the seam that chooses between them.

F4 — the CR-02 collapse routed four terminal-stamp sites through one closure
that heals (DELETEs both persisted basis-series rows). Only two of the four ever
healed. ``_dispose_broker_nav_error`` and the MT5-12 verdict refusal did not, so
the collapse handed them a destructive DELETE they never had — and the runbook's
repair marker is deliberately UNPROTECTED, which is precisely the path a failed
repair on an MT5 strategy takes. MT5 is 4 of the 5 live ledger-backed strategies.

F7 — the derive chain edge forwarded the marker union while this handler's own
D-15 guard protects one marker. Safe only by accident of which kind each fan-out
enqueues.

ANTI-VACUITY. Every "must not" assertion here is paired with a control that
shows the same machinery still firing where it should, because a globally broken
heal / a derive that never reaches its chain edge would satisfy the negative
assertions without doing anything.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from main_worker import dispatch_tick
from services.job_worker import (
    LEDGER_REFRESH_COMPOSITE_SOURCE,
    LEDGER_REFRESH_JOB_SOURCES,
    LEDGER_REFRESH_SINGLE_KEY_SOURCE,
    DispatchOutcome,
    run_derive_broker_dailies_job,
)
from tests.test_derive_broker_dailies_dualmode import (
    _CCXT_VERDICT,
    _build_ctx,
    _patches_with_combine,
    _two_day_returns,
)

_STRATEGY_ID = "strat-f1"
_CLAIM_RPC = "claim_compute_jobs_with_priority"

# The columns a terminal stamp writes that carry PUBLISH meaning, plus the
# freshness column F1 is about. None of them may appear on a protected refresh.
_PUBLISH_STATE_KEYS = (
    "computation_status",
    "computation_warned",
    "metrics_json_by_basis",
    "data_quality_flags",
)

_JOB_WORKER = Path(__file__).resolve().parents[1] / "services" / "job_worker.py"


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------
def _one_day_returns() -> pd.Series:
    """ONE interpretable day — fewer than the two a factsheet needs. This is
    what an MT5 terminal that has lost its login returns: a SUCCESSFUL crawl of
    an empty deal history."""
    return pd.Series([0.01], index=pd.DatetimeIndex(["2024-05-01"]), dtype="float64")


def _stub_status_read(
    ctx: MagicMock, row: dict[str, Any] | None, *, job_source: str | None
) -> None:
    """Give the harness a real ``.select().eq().maybe_single().execute()``.

    Without it the bare ``MagicMock`` makes ``row.get('computation_status')``
    another ``MagicMock``, which equals no real status string — so every case
    would route to the destructive branch and the protected assertions would
    pass or fail for reasons unrelated to the guard.

    ⛔ TABLE-AWARE (REUSE-01). ``compute_jobs`` is answered with the LIVE job row,
    built from THIS case's own ``job_source``. The guard and the chain edge both
    re-read ``metadata->>'source'`` off their own job before honouring the marker
    — the enqueue dedup can hand a user's resync a job the recurring refresh
    minted, and the claim-time metadata then stops describing reality. Answering
    that read with an analytics row makes the marker look RETRACTED on every
    marked case, so the protected assertions here would go red for a reason that
    has nothing to do with F1/F4/F7.
    """
    original = ctx.supabase.table.side_effect
    live_job_row: dict[str, Any] | None = (
        {"metadata": {"source": job_source}} if job_source is not None else None
    )

    def _table(name: str) -> MagicMock:
        tbl: MagicMock = original(name)
        answer = live_job_row if name == "compute_jobs" else row

        def _select(_columns: str, **_kw: object) -> MagicMock:
            chain = MagicMock()
            chain.eq.return_value = chain
            chain.maybe_single.return_value = chain
            chain.execute.return_value = MagicMock(data=answer)
            return chain

        tbl.select.side_effect = _select
        return tbl

    ctx.supabase.table.side_effect = _table


def _analytics_payloads(capture: dict[str, Any]) -> list[dict[str, Any]]:
    return [dict(u[1]) for u in capture["upserts"] if u[0] == "strategy_analytics"]


def _series_deletes(capture: dict[str, Any]) -> list[dict[str, Any]]:
    return [d for d in capture["deletes"] if d["table"] == "strategy_analytics_series"]


def _terminal_stamp(capture: dict[str, Any]) -> dict[str, Any]:
    payloads = _analytics_payloads(capture)
    assert len(payloads) == 1, (
        "expected exactly ONE strategy_analytics upsert from the terminal arm "
        f"under test; got {payloads!r}. More than one means the driver ran past "
        "that arm and the assertions below are aimed at the wrong write."
    )
    return payloads[0]


def _job(*, source: str | None) -> dict[str, Any]:
    job: dict[str, Any] = {
        "id": "job-1",
        "kind": "derive_broker_dailies",
        "strategy_id": _STRATEGY_ID,
        "claim_token": "tok-1",
    }
    if source is not None:
        job["metadata"] = {"source": source, "enqueued_at": "2026-08-25T00:00:00Z"}
    return job


def _ctx_for(
    *, published: bool, job_source: str | None = None
) -> tuple[MagicMock, dict[str, Any]]:
    ctx, capture = _build_ctx(
        key_row={"id": "key-1", "exchange": "binance", "user_id": "user-1"},
        strategy_row={"id": _STRATEGY_ID, "user_id": "user-1"},
    )
    _stub_status_read(
        ctx,
        {"computation_status": "complete_with_warnings"}
        if published
        # 'computing', NOT 'failed': an unpublished fixture must differ from the
        # destructive stamp's OWN output or the guarded and unguarded outcomes
        # coincide and the assertion cannot fail.
        else {"computation_status": "computing"},
        job_source=job_source,
    )
    return ctx, capture


async def _drive(
    *, combine: MagicMock, source: str | None, published: bool = True
) -> tuple[Any, dict[str, Any]]:
    """Handler-only driver."""
    ctx, capture = _ctx_for(published=published, job_source=source)
    patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await run_derive_broker_dailies_job(_job(source=source))
    return result, capture


async def _drive_through_worker(
    *, combine: MagicMock, source: str | None, published: bool = True
) -> tuple[list[tuple[str, dict[str, Any]]], dict[str, Any]]:
    """FULL Python-side chain: ``dispatch_tick`` claims the job, the REAL
    ``dispatch`` runs the REAL handler, and ``main_worker`` maps the outcome
    onto the mark RPC. Returns the worker-side RPC log + the analytics capture.

    Nothing about the outcome mapping is stubbed — patching ``dispatch`` (as the
    older main_worker tests do) would put the very seam under test behind a mock.
    """
    ctx, capture = _ctx_for(published=published, job_source=source)
    job = _job(source=source)
    worker_rpc: list[tuple[str, dict[str, Any]]] = []

    supabase = MagicMock()

    def _rpc(name: str, params: dict[str, Any] | None = None) -> MagicMock:
        worker_rpc.append((name, dict(params or {})))
        chain = MagicMock()
        chain.execute.return_value = MagicMock(
            data=[dict(job)] if name == _CLAIM_RPC else []
        )
        return chain

    supabase.rpc.side_effect = _rpc

    patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
    with patch("main_worker.get_supabase", return_value=supabase), patches[0], \
            patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        await dispatch_tick("worker-silent-failure")

    return worker_rpc, capture


def _insufficient_combine() -> MagicMock:
    return MagicMock(
        return_value=(
            _one_day_returns(),
            {"used_heuristic_capital": False, "series_completeness": _CCXT_VERDICT},
        )
    )


def _healthy_combine() -> MagicMock:
    return MagicMock(
        return_value=(
            _two_day_returns(),
            {"used_heuristic_capital": False, "series_completeness": _CCXT_VERDICT},
        )
    )


def _verdict_refusal_combine() -> MagicMock:
    """A series with NO ``series_completeness`` key — the MT5-12 refusal."""
    return MagicMock(return_value=(_two_day_returns(), {"used_heuristic_capital": False}))


def _mark_names(worker_rpc: list[tuple[str, dict[str, Any]]]) -> list[str]:
    return [name for name, _ in worker_rpc if name.startswith("mark_compute_job_")]


# ---------------------------------------------------------------------------
# F1 — a refresh that produced nothing must not terminate as a success
# ---------------------------------------------------------------------------
class TestF1InsufficientHistoryNeverReachesTheSuccessBranch:
    """Neuter to redden: change the <2-day arm's return back to
    ``DispatchResult(outcome=DispatchOutcome.DONE)``."""

    @pytest.mark.asyncio
    async def test_marked_refresh_is_never_marked_done(self) -> None:
        worker_rpc, capture = await _drive_through_worker(
            combine=_insufficient_combine(), source=LEDGER_REFRESH_SINGLE_KEY_SOURCE
        )

        marks = _mark_names(worker_rpc)
        assert marks, (
            "the job reached no mark RPC at all — dispatch_tick did not run the "
            f"job to completion, so nothing below is being tested. rpc={worker_rpc!r}"
        )
        assert "mark_compute_job_done" not in marks, (
            "a MARKED refresh that produced <2 interpretable days was handed to "
            "mark_compute_job_done. That RPC's sync_strategy_analytics_status "
            "then takes branch (c), which sets computation_error = NULL and "
            "computed_at = now() — erasing the error the D-15 guard just wrote "
            "and restamping the freshness column that drives the factsheet's "
            "Fresh badge and the PDF's 'Data as of' vintage. Operator sees a "
            f"green row for a stale account. marks={marks!r}"
        )
        assert "mark_compute_job_failed" in marks, (
            f"expected the failure to reach mark_compute_job_failed; marks={marks!r}"
        )

        payload = _terminal_stamp(capture)
        assert payload.get("computation_error"), (
            "the failure must stay VISIBLE in computation_error on the analytics "
            f"row. payload={payload!r}"
        )
        for key in (*_PUBLISH_STATE_KEYS, "computed_at"):
            assert key not in payload, (
                f"a MARKED refresh wrote {key!r} onto a published row. "
                f"payload={payload!r}"
            )

    @pytest.mark.asyncio
    async def test_unmarked_first_compute_is_never_marked_done(self) -> None:
        """CONTROL and a second live case. An UNMARKED <2-day derive writes the
        authoritative 'failed' clear — correct for a first compute — and branch
        (c) would overwrite it to 'complete' with a NULL error, handing the
        wizard poller a success for a strategy that has no factsheet."""
        worker_rpc, capture = await _drive_through_worker(
            combine=_insufficient_combine(), source=None, published=False
        )

        marks = _mark_names(worker_rpc)
        assert "mark_compute_job_done" not in marks, (
            "an UNMARKED <2-day derive stamped 'failed' and was then marked "
            f"done, which branch (c) resolves to 'complete'. marks={marks!r}"
        )
        assert "mark_compute_job_failed" in marks
        payload = _terminal_stamp(capture)
        assert payload["computation_status"] == "failed", (
            "the unguarded arm must still write the authoritative clear — if it "
            "does not, the protected arm's assertions above are vacuous."
        )

    @pytest.mark.asyncio
    async def test_healthy_derive_is_still_marked_done(self) -> None:
        """ANTI-VACUITY CONTROL for the whole class: a derive that DOES produce
        a series must still reach mark_compute_job_done. A handler that returned
        FAILED unconditionally would satisfy both tests above."""
        worker_rpc, _capture = await _drive_through_worker(
            combine=_healthy_combine(), source=LEDGER_REFRESH_SINGLE_KEY_SOURCE
        )
        marks = _mark_names(worker_rpc)
        assert marks == ["mark_compute_job_done"], (
            f"a successful derive no longer terminates as DONE; marks={marks!r}"
        )

    @pytest.mark.asyncio
    async def test_outcome_is_permanent_failed(self) -> None:
        """A brand-new/idle account does not grow history by being retried in a
        backoff loop (T-74-02). The next sync's `done` supersedes this
        failed_final per-kind, so the strategy un-poisons on real history."""
        result, _capture = await _drive(
            combine=_insufficient_combine(), source=LEDGER_REFRESH_SINGLE_KEY_SOURCE
        )
        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent"
        assert result.error_message and _STRATEGY_ID in result.error_message


# ---------------------------------------------------------------------------
# F4 — the collapse must not hand a destructive DELETE to paths that never had one
# ---------------------------------------------------------------------------
class TestF4CollapseDidNotAddDeletes:
    """Neuter to redden: drop ``heal_series=False`` from either call site."""

    @pytest.mark.asyncio
    async def test_mt5_verdict_refusal_does_not_delete_the_series(self) -> None:
        """THE runbook case. `ledger-refresh-repair` is deliberately
        unprotected, and the MT5-12 completeness refusal is the refusal an MT5
        repair trips — so an unconditional heal made the runbook's "a failed
        repair is not a fresh injury" false for 4 of the 5 live ledger
        strategies."""
        result, capture = await _drive(
            combine=_verdict_refusal_combine(), source=None, published=False
        )

        assert result.outcome == DispatchOutcome.FAILED
        assert _terminal_stamp(capture)["computation_status"] == "failed", (
            "the refusal must still be recorded — this test is about the DELETE, "
            "not about softening the stamp."
        )
        assert _series_deletes(capture) == [], (
            "the MT5-12 verdict refusal deleted persisted basis-series rows. It "
            "never did before the CR-02 collapse, and a completeness refusal is "
            "not a reason to destroy a live factsheet's series."
        )

    @pytest.mark.asyncio
    async def test_nav_reconstruction_error_does_not_delete_the_series(self) -> None:
        from services.nav_twr import NavReconstructionError

        result, capture = await _drive(
            combine=MagicMock(side_effect=NavReconstructionError("nav hole at day 3")),
            source=None,
            published=False,
        )

        assert result.outcome == DispatchOutcome.FAILED
        assert _terminal_stamp(capture)["computation_status"] == "failed"
        assert _series_deletes(capture) == [], (
            "`_dispose_broker_nav_error` deleted persisted basis-series rows. It "
            "never did before the CR-02 collapse."
        )

    @pytest.mark.asyncio
    async def test_insufficient_history_still_deletes_the_series(self) -> None:
        """ANTI-VACUITY CONTROL. `_mark_insufficient` is one of the two sites
        that ALWAYS healed, and the D3-SECONDARY guarantee for it is unchanged.
        Without this, disabling the heal outright would turn both tests above
        green."""
        _result, capture = await _drive(
            combine=_insufficient_combine(), source=None, published=False
        )
        assert _series_deletes(capture), (
            "the unmarked <2-day arm no longer heal-deletes both basis-series "
            "rows. The F4 opt-outs are meant to be exactly two sites, not a "
            "blanket removal of the D3-SECONDARY heal."
        )


# ---------------------------------------------------------------------------
# F7 — the guard and its forwarder must answer with the same marker
# ---------------------------------------------------------------------------
class TestF7GuardAndForwarderAgree:
    @staticmethod
    def _enqueue_payload(capture: dict[str, Any]) -> dict[str, Any]:
        calls = [c for c in capture["rpc_calls"] if c[0] == "enqueue_compute_job"]
        assert len(calls) == 1, (
            "expected exactly one enqueue_compute_job RPC (the chained analytics "
            f"hop); got {capture['rpc_calls']!r}. If the derive did not reach its "
            "chain edge, the assertion below is aimed at nothing."
        )
        return dict(calls[0][1])

    @pytest.mark.asyncio
    async def test_single_key_marker_is_forwarded(self) -> None:
        """ANTI-VACUITY CONTROL for the test below: forwarding still works."""
        _result, capture = await _drive(
            combine=_healthy_combine(), source=LEDGER_REFRESH_SINGLE_KEY_SOURCE
        )
        meta = self._enqueue_payload(capture).get("p_metadata")
        assert isinstance(meta, dict)
        assert meta["source"] == LEDGER_REFRESH_SINGLE_KEY_SOURCE
        assert meta["chained_from"] == "derive_broker_dailies"

    @pytest.mark.asyncio
    async def test_composite_marker_on_a_derive_is_not_forwarded(self) -> None:
        """Neuter to redden: restore ``in LEDGER_REFRESH_JOB_SOURCES`` at the
        chain edge.

        This handler's D-15 guard protects the SINGLE-KEY marker only, and the
        composite guard is deliberately a different string so the two cannot
        cross-fire. Forwarding the union while guarding one meant hop 2 could
        inherit a protection hop 1 had already declined — i.e. the destructive
        stamp had ALREADY fired here, and hop 2 would then decline to record the
        follow-on failure.
        """
        _result, capture = await _drive(
            combine=_healthy_combine(), source=LEDGER_REFRESH_COMPOSITE_SOURCE
        )
        assert self._enqueue_payload(capture).get("p_metadata") is None, (
            "a composite-marked derive forwarded its marker to hop 2, which this "
            "handler's own guard does not honour. The two sites must answer with "
            "the same marker."
        )

    def test_named_markers_are_the_inline_guard_literals(self) -> None:
        """The constants exist to give per-arm sites a handle — they must not
        become a THIRD spelling. Comments are stripped first: this file's and
        that file's prose discuss the contract, and prose must never satisfy a
        mechanical gate.

        Neuter to redden: change either constant's value.
        """
        src = "\n".join(
            ln
            for ln in _JOB_WORKER.read_text().splitlines()
            if not ln.lstrip().startswith("#")
        )
        guards = set(re.findall(r'job_source\s*==\s*"([^"]*)"', src))
        assert guards == {
            LEDGER_REFRESH_SINGLE_KEY_SOURCE,
            LEDGER_REFRESH_COMPOSITE_SOURCE,
        }, (
            "MARKER DRIFT: the inline guards compare against "
            f"{sorted(guards)} but the named constants are "
            f"{sorted({LEDGER_REFRESH_SINGLE_KEY_SOURCE, LEDGER_REFRESH_COMPOSITE_SOURCE})}."
        )
        assert set(LEDGER_REFRESH_JOB_SOURCES) == guards, (
            "the consumer set no longer equals the two inline guards."
        )
        assert LEDGER_REFRESH_SINGLE_KEY_SOURCE != LEDGER_REFRESH_COMPOSITE_SOURCE, (
            "the two arms' markers must stay DIFFERENT strings or the guards "
            "cross-fire."
        )
