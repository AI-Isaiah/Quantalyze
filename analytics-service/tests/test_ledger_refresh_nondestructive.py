"""Phase 161.1 / D-15 — a maintenance refresh may not un-publish a funded account.

Why this file exists
--------------------
``_stamp_strategy_analytics_failed`` (services/job_worker.py) is an AUTHORITATIVE
clear: it upserts ``computation_status='failed'``, ``computation_warned=False``,
``metrics_json_by_basis=None``, ``data_quality_flags={'csv_source': True}``, and
then heal-DELETEs both persisted basis-series rows. That is exactly right for a
first compute that failed — the wizard poller must reach a terminal gate instead
of spinning forever.

It is exactly wrong for a RECURRING refresh. Every live ledger-backed strategy in
production is ``complete_with_warnings`` — healthy, published, funded. The venue
gateway is on record wedging into IPC timeouts three times in one day, and a
disabled venue flag fails the whole cohort at once. So the first tick after the
refresh fan-out is activated, landing on a wedged gateway, would downgrade every
one of those accounts and strip their series rows. Founder direction (D-15): a
maintenance job may never un-publish a funded account.

The guard is therefore keyed on the fan-out's job marker and on the row's CURRENT
status, and its fail-safe direction is NON-NEGOTIABLE: anything unrecognised —
no metadata, a different source, an unreadable status, no row at all — falls
through to the LOUD destructive stamp. Never fail toward suppression.

The failure is re-routed, not hidden. It still lands in ``compute_jobs`` (which
is what the fan-out's ATTEMPT cooldown reads), in ``computation_error``, in the
worker log, and in ``ledger_refresh_staleness`` — whose freshness key a failed
refresh cannot advance, so a persistently failing strategy keeps reading STALE
rather than healthy.

Falsifiability
--------------
Every test here must be able to fail, and two neuterings are mandated by the
plan: (1) delete the marker guard so the destructive stamp always fires — tests 1
and 2 must redden; (2) restore the series heal-delete into the non-destructive
branch — the "no basis-series delete" assertion must redden. Both were run and
observed RED before this file was accepted.

The subtlest way this file could have been vacuous is the status read. The shared
harness's ``_table`` returns a bare ``MagicMock``, so an UNSTUBBED
``.select().eq().maybe_single().execute()`` yields a ``MagicMock`` whose
``.get('computation_status')`` is another ``MagicMock`` — never equal to a real
status string, so every case would route to the destructive branch and tests 3-5
would pass for entirely the wrong reason while tests 1-2 failed inexplicably.
``_stub_status_read`` below closes that, and tests 1 and 2 assert the read
actually HAPPENED rather than trusting it did.

Driver: a malformed ``returns_denominator_config``. It is the earliest permanent
failure in ``run_derive_broker_dailies_job`` and it routes straight through the
closure under test with no exchange I/O at all.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from tests.test_derive_broker_dailies_dualmode import (
    _build_ctx,
    _patches,
    _two_day_returns,
)

# The fan-out's contract, spelled here exactly as the migration spells it in
# `jsonb_build_object('source', …)`. Hand-typed on purpose: this test is one END
# of a cross-language contract with no compiler between the two, so importing it
# from anywhere would defeat the point. Plan 05 gate 8 pins the two spellings.
_MARKER = "ledger-refresh"

_STRATEGY_ID = "strat-ledger-1"

# The four columns the destructive stamp writes that carry PUBLISH meaning. None
# of them may appear in a non-destructive payload.
_PUBLISH_STATE_KEYS = (
    "computation_status",
    "computation_warned",
    "metrics_json_by_basis",
    "data_quality_flags",
)


def _stub_status_read(
    ctx: MagicMock,
    capture: dict[str, Any],
    *,
    row: dict[str, Any] | None,
    raises: bool = False,
) -> None:
    """Give the shared harness a real ``.select().eq().maybe_single().execute()``.

    Wraps — rather than replaces — the harness's table factory, so the existing
    ``upsert`` / ``delete`` capture behaviour is untouched. Records every select
    into ``capture['selects']`` so a test can assert the read HAPPENED; see this
    module's docstring for why an unstubbed read would silently make most of this
    file vacuous.
    """
    original = ctx.supabase.table.side_effect
    capture["selects"] = []

    def _table(name: str) -> MagicMock:
        # The harness's factory is an untyped mock attribute, so its return is
        # Any; bind it to the concrete type the caller relies on.
        tbl: MagicMock = original(name)

        def _select(columns: str, **_kw: object) -> MagicMock:
            record: dict[str, Any] = {"table": name, "columns": columns, "filters": {}}
            capture["selects"].append(record)
            chain = MagicMock()

            def _eq(col: str, val: object) -> MagicMock:
                record["filters"][col] = val
                return chain

            def _execute() -> MagicMock:
                if raises:
                    raise RuntimeError("simulated strategy_analytics status read failure")
                return MagicMock(data=row)

            chain.eq.side_effect = _eq
            chain.maybe_single.return_value = chain
            chain.execute.side_effect = _execute
            return chain

        tbl.select.side_effect = _select
        return tbl

    ctx.supabase.table.side_effect = _table


async def _drive_failure(
    *,
    metadata: dict[str, Any] | None,
    existing_row: dict[str, Any] | None,
    read_raises: bool = False,
) -> dict[str, Any]:
    """Run the handler to a terminal failure and return the capture dict."""
    ctx, capture = _build_ctx(
        key_row={"id": "key-1", "exchange": "binance", "user_id": "user-1"},
        strategy_row={
            "id": _STRATEGY_ID,
            "user_id": "user-1",
            # Malformed on purpose — parse_returns_denominator_config raises
            # ReturnsDenominatorConfigError, which is the handler's earliest
            # permanent-failure arm and calls the closure under test directly.
            "returns_denominator_config": {"denominator": "not-a-real-denominator"},
        },
    )
    _stub_status_read(ctx, capture, row=existing_row, raises=read_raises)

    job: dict[str, Any] = {
        "id": "job-1",
        "kind": "derive_broker_dailies",
        "strategy_id": _STRATEGY_ID,
    }
    if metadata is not None:
        job["metadata"] = metadata

    patches = _patches(ctx, key_mode=False, returns=_two_day_returns())
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await run_derive_broker_dailies_job(job)

    assert result.outcome == DispatchOutcome.FAILED, (
        "the driver must reach a terminal failure or nothing under test ran; "
        f"got outcome={result.outcome!r}"
    )
    return capture


def _analytics_payload(capture: dict[str, Any], case: str) -> dict[str, Any]:
    upserts = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    assert len(upserts) == 1, (
        f"[{case}] expected exactly one strategy_analytics upsert; "
        f"got {capture['upserts']!r}"
    )
    payload: dict[str, Any] = dict(upserts[0][1])
    return payload


def _series_deletes(capture: dict[str, Any]) -> list[dict[str, Any]]:
    return [d for d in capture["deletes"] if d["table"] == "strategy_analytics_series"]


def _assert_non_destructive(capture: dict[str, Any], case: str) -> None:
    payload = _analytics_payload(capture, case)

    for key in _PUBLISH_STATE_KEYS:
        assert key not in payload, (
            f"[{case}] a marked refresh that FAILED wrote {key!r} onto an "
            f"already-published row — that un-publishes a funded account. "
            f"payload={payload!r}"
        )

    # What it MUST still write: the error, and the reaper anchor cleared (JOB-01).
    assert payload.get("strategy_id") == _STRATEGY_ID, (
        f"[{case}] the non-destructive stamp must still target the strategy; "
        f"payload={payload!r}"
    )
    assert payload.get("computation_error"), (
        f"[{case}] the non-destructive stamp must still RECORD the error — the "
        f"guard re-routes the failure, it does not hide it. payload={payload!r}"
    )
    assert "computing_started_at" in payload and payload["computing_started_at"] is None, (
        f"[{case}] computing_started_at must still be cleared on exit (JOB-01) or "
        f"a stale stamp can re-trigger the reaper. payload={payload!r}"
    )

    deletes = _series_deletes(capture)
    assert deletes == [], (
        f"[{case}] the non-destructive branch heal-DELETEd the basis series. "
        f"This is the half that is easy to miss: the status survived but the live "
        f"factsheet's series rows were stripped anyway. deletes={capture['deletes']!r}"
    )

    reads = [s for s in capture["selects"] if s["table"] == "strategy_analytics"]
    assert reads, (
        f"[{case}] the guard never READ the existing computation_status. Without "
        f"that read the branch cannot be status-conditional, and an unstubbed read "
        f"would silently route every case to the destructive stamp. "
        f"selects={capture['selects']!r}"
    )
    assert any(r["filters"].get("strategy_id") == _STRATEGY_ID for r in reads), (
        f"[{case}] the status read was not scoped to this strategy; reads={reads!r}"
    )


def _assert_destructive(capture: dict[str, Any], case: str) -> None:
    payload = _analytics_payload(capture, case)
    assert payload.get("computation_status") == "failed", (
        f"[{case}] the destructive stamp must fire BYTE-UNCHANGED here. Suppressing "
        f"it hangs the wizard poller on an infinite spinner, which is the entire "
        f"reason the helper exists. payload={payload!r}"
    )
    assert payload.get("computation_warned") is False, (
        f"[{case}] computation_warned must be cleared (SI-02); payload={payload!r}"
    )
    assert "metrics_json_by_basis" in payload and payload["metrics_json_by_basis"] is None, (
        f"[{case}] metrics_json_by_basis must be authoritatively cleared (F-4); "
        f"payload={payload!r}"
    )
    assert payload.get("data_quality_flags") == {"csv_source": True}, (
        f"[{case}] data_quality_flags must be stamped; payload={payload!r}"
    )
    assert _series_deletes(capture), (
        f"[{case}] the destructive stamp must still heal-delete both basis series "
        f"rows (D3 SECONDARY); deletes={capture['deletes']!r}"
    )


class TestRefreshFailureIsNonDestructive:
    """Tests 1-2: a marked refresh landing on a terminal-SUCCESS row."""

    @pytest.mark.asyncio
    async def test_1_marked_refresh_on_complete_with_warnings_preserves_publish_state(
        self,
    ) -> None:
        """The census case. All 5 live ledger rows carry this status, so a guard
        written for ``complete`` alone would protect exactly none of them."""
        capture = await _drive_failure(
            metadata={"source": _MARKER},
            existing_row={"computation_status": "complete_with_warnings"},
        )
        _assert_non_destructive(capture, "1: marked refresh / complete_with_warnings")

    @pytest.mark.asyncio
    async def test_2_marked_refresh_on_complete_preserves_publish_state(self) -> None:
        """The other half of the success PAIR (plan 01 D-04)."""
        capture = await _drive_failure(
            metadata={"source": _MARKER},
            existing_row={"computation_status": "complete"},
        )
        _assert_non_destructive(capture, "2: marked refresh / complete")


class TestGuardIsNotABlanketSuppression:
    """Tests 3-5 and 7: everything the guard must NOT swallow.

    These are the arms that stop D-15 degenerating into "never report a failure".
    Each one must reach the destructive stamp BYTE-UNCHANGED.
    """

    @pytest.mark.asyncio
    async def test_3_marked_refresh_with_no_existing_row_still_fails_loud(self) -> None:
        """An INITIAL compute that failed has nothing to protect."""
        capture = await _drive_failure(
            metadata={"source": _MARKER},
            existing_row=None,
        )
        _assert_destructive(capture, "3: marked refresh / no existing row")

    @pytest.mark.asyncio
    async def test_4_marked_refresh_on_failed_row_still_fails_loud(self) -> None:
        """A prior row that is not terminal-SUCCESS is not a publish state worth
        preserving."""
        capture = await _drive_failure(
            metadata={"source": _MARKER},
            existing_row={"computation_status": "failed"},
        )
        _assert_destructive(capture, "4: marked refresh / prior failed")

    @pytest.mark.asyncio
    async def test_5a_unmarked_job_with_no_metadata_still_fails_loud(self) -> None:
        """The user-triggered resync path. Its poller needs the terminal gate."""
        capture = await _drive_failure(
            metadata=None,
            existing_row={"computation_status": "complete_with_warnings"},
        )
        _assert_destructive(capture, "5a: no metadata / complete_with_warnings")

    @pytest.mark.asyncio
    async def test_5b_job_with_a_different_source_still_fails_loud(self) -> None:
        """Only the fan-out's exact marker disarms the downgrade. Any other
        source — including the A7 tracer's own, which is deliberately spelled
        differently — is an ordinary job."""
        capture = await _drive_failure(
            metadata={"source": "ledger-refresh-tracer"},
            existing_row={"computation_status": "complete_with_warnings"},
        )
        _assert_destructive(capture, "5b: different source / complete_with_warnings")

    @pytest.mark.asyncio
    async def test_7_unreadable_status_falls_through_to_the_loud_path(self) -> None:
        """⛔ The fail-safe DIRECTION. If the status cannot be read the guard must
        NOT assume the row is precious — a wrongly-suppressed failure is invisible,
        and this repo's rule is to fail loud."""
        capture = await _drive_failure(
            metadata={"source": _MARKER},
            existing_row={"computation_status": "complete_with_warnings"},
            read_raises=True,
        )
        _assert_destructive(capture, "7: status read raises / marked refresh")


class TestFreshnessColumnSurvivesEveryPath:
    @pytest.mark.asyncio
    async def test_6_no_terminal_stamp_ever_writes_returns_series(self) -> None:
        """Pins plan 01 D-03's load-bearing claim rather than leaving it to
        inspection: the freshness verdict keys on ``max(date)`` inside
        ``returns_series``, and the whole design rests on a terminal-failure stamp
        being unable to touch that column. If any arm here ever wrote it, a failed
        refresh could move the staleness verdict and a broken strategy would stop
        surfacing as stale."""
        cases: list[tuple[str, dict[str, Any] | None, dict[str, Any] | None, bool]] = [
            ("marked / complete_with_warnings", {"source": _MARKER}, {"computation_status": "complete_with_warnings"}, False),
            ("marked / complete", {"source": _MARKER}, {"computation_status": "complete"}, False),
            ("marked / no row", {"source": _MARKER}, None, False),
            ("marked / failed", {"source": _MARKER}, {"computation_status": "failed"}, False),
            ("unmarked", None, {"computation_status": "complete_with_warnings"}, False),
            ("other source", {"source": "ledger-refresh-tracer"}, {"computation_status": "complete_with_warnings"}, False),
            ("read raises", {"source": _MARKER}, {"computation_status": "complete_with_warnings"}, True),
        ]
        for case, metadata, existing_row, read_raises in cases:
            capture = await _drive_failure(
                metadata=metadata,
                existing_row=existing_row,
                read_raises=read_raises,
            )
            for name, payload, _oc in capture["upserts"]:
                if name != "strategy_analytics":
                    continue
                assert "returns_series" not in payload, (
                    f"[6/{case}] a terminal-failure stamp wrote returns_series. "
                    f"The staleness view's freshness key would then be movable by a "
                    f"FAILED run, and a rotting strategy would read fresh. "
                    f"payload={payload!r}"
                )
